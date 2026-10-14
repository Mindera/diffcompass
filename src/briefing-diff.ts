import { diffSourceIdentity, loadCapturedSource } from "./diff-sources.ts";
import type { BriefingDocument, BriefingEvidence } from "./briefing.ts";
import type { DiffFile, DiffRow, GitComparison } from "./types.ts";

export type BriefingDiff =
  | { available: false; reason: string }
  | { available: true; oldPath: string | null; newPath: string | null; blobs: { old: string | null; new: string | null }; rows: DiffRow[] };

const lines = (text: string) => {
  if (!text) return [];
  const result = text.split(/\r?\n/);
  if (text.endsWith("\n")) result.pop();
  return result;
};

/** Reconstruct the line mapping from the captured patch, verifying both sides.
 * Fill omitted context from the same immutable blobs, never from the worktree. */
function mappedRows(file: DiffFile | undefined, before: string[], after: string[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldLine = 1, newLine = 1;
  function append(row: DiffRow) {
    if (row.kind === "meta") { rows.push(row); return; }
    if (row.oldLine !== null && (row.oldLine !== oldLine || before[oldLine - 1] !== row.content)) throw new Error("Old source does not match the captured patch.");
    if (row.newLine !== null && (row.newLine !== newLine || after[newLine - 1] !== row.content)) throw new Error("New source does not match the captured patch.");
    rows.push(row);
    if (row.oldLine !== null) oldLine++;
    if (row.newLine !== null) newLine++;
  }
  function contextUntil(oldEnd: number, newEnd: number) {
    while (oldLine < oldEnd && newLine < newEnd) append({ kind: "context", content: before[oldLine - 1]!, oldLine, newLine });
    if (oldLine !== oldEnd || newLine !== newEnd) throw new Error("Captured line mapping is incomplete.");
  }
  for (const hunk of file?.hunks ?? []) {
    contextUntil(hunk.oldStart + (hunk.oldCount === 0 ? 1 : 0), hunk.newStart + (hunk.newCount === 0 ? 1 : 0));
    for (const row of hunk.rows) append({ ...row, content: row.content.replace(/\r$/, "") });
  }
  contextUntil(before.length + 1, after.length + 1);
  return rows;
}

/** Include the opposite side of a replacement, not just the cited side.
 * Large replacements are bounded with explicit omissions; cited lines win. */
function excerptRows(rows: DiffRow[], evidence: BriefingEvidence): DiffRow[] {
  const selected = rows.flatMap((row, i) => {
    const line = evidence.side === "old" ? row.oldLine : row.newLine;
    return line !== null && line >= evidence.startLine && line <= evidence.endLine ? [i] : [];
  });
  if (selected.length !== evidence.endLine - evidence.startLine + 1 || selected.map(i => rows[i]!.content).join("\n") !== evidence.quote) throw new Error("The citation does not match this diff.");
  let first = selected[0]!, last = selected.at(-1)!;
  for (let i = 0; i < rows.length;) {
    if (rows[i]!.kind === "context") { i++; continue; }
    const start = i;
    while (i < rows.length && rows[i]!.kind !== "context") i++;
    const group = rows.slice(start, i);
    if (start <= last && i > first && group.some(r => r.kind === "addition") && group.some(r => r.kind === "deletion")) {
      first = Math.min(first, start); last = Math.max(last, i - 1);
    }
  }
  // Padding adds unchanged context only, not an unrelated neighboring edit.
  for (let n = 0; n < 2 && first > 0 && rows[first - 1]!.kind === "context"; n++) first--;
  for (let n = 0; n < 2 && last + 1 < rows.length && rows[last + 1]!.kind === "context"; n++) last++;
  if (rows[last + 1]?.kind === "meta") last++;
  const range = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const priority = [...new Set([...selected, ...range.slice(0, 24), ...range.slice(-24), ...range])];
  const keep = new Set<number>(); let chars = 0;
  for (const i of priority) if (keep.size < 120 && chars + rows[i]!.content.length <= 24000) { keep.add(i); chars += rows[i]!.content.length; }
  const result: DiffRow[] = []; let omitted = 0;
  const flush = () => { if (omitted) result.push({ kind: "meta", content: `… ${omitted} lines omitted …`, oldLine: null, newLine: null }); omitted = 0; };
  for (const i of range) { if (keep.has(i)) { flush(); result.push(rows[i]!); } else omitted++; }
  flush(); return result;
}

/** Add diffs to older saved documents only when their captured comparison still
 * matches. Never silently pair an old citation with the latest working copy. */
export async function captureBriefingDiffs(comparison: GitComparison, document: BriefingDocument, sources = new Map<string, Promise<{ text: string; blob: string | null }>>()): Promise<void> {
  if (document.comparisonId !== diffSourceIdentity(comparison)) return;
  const captured = (side: "old" | "new", path: string | null) => {
    if (path === null) return Promise.resolve({ text: "", blob: null });
    const key = `${side}:${path}`;
    if (!sources.has(key)) sources.set(key, loadCapturedSource(comparison, side, path));
    return sources.get(key)!;
  };
  const cache = new Map<string, Promise<{ oldPath: string | null; newPath: string | null; blobs: { old: string | null; new: string | null }; rows: DiffRow[] }>>();
  for (const evidence of document.evidence) {
    if (!evidence.available || evidence.kind !== "code" || evidence.diff !== undefined) continue;
    const file = comparison.files.find(f => [f.path, f.oldPath, f.newPath].includes(evidence.path));
    const key = file?.path ?? evidence.path;
    if (!cache.has(key)) cache.set(key, (async () => {
      const oldPath = file ? file.oldPath : evidence.path, newPath = file ? file.newPath : evidence.path;
      const [before, after] = await Promise.all([
        captured("old", oldPath), captured("new", newPath),
      ]);
      return { oldPath, newPath, blobs: { old: before.blob, new: after.blob }, rows: mappedRows(file, lines(before.text), lines(after.text)) };
    })());
    try {
      const source = await cache.get(key)!;
      if (source.blobs[evidence.side] !== evidence.blob) throw new Error("The citation belongs to another captured source.");
      evidence.diff = { available: true, ...source, rows: excerptRows(source.rows, evidence) };
    } catch { evidence.diff = { available: false, reason: "The before-and-after diff could not be verified against the saved source." }; }
  }
}

export function validBriefingDiff(value: unknown): value is BriefingDiff {
  if (!value || typeof value !== "object") return false;
  const d = value as Record<string, any>;
  if (d.available === false) return typeof d.reason === "string" && d.reason.length > 0 && d.reason.length <= 500;
  const path = (p: unknown) => p === null || (typeof p === "string" && p.length > 0 && p.length <= 4096 && !p.startsWith("/") && !/[\\\x00-\x1f:]/.test(p) && p.split("/").every(s => s && s !== "." && s !== ".."));
  const blob = (b: unknown) => b === null || (typeof b === "string" && /^[a-f0-9]{40,64}$/.test(b));
  const line = (n: unknown) => Number.isSafeInteger(n) && (n as number) > 0;
  return d.available === true && path(d.oldPath) && path(d.newPath) && d.blobs && blob(d.blobs.old) && blob(d.blobs.new) &&
    (d.oldPath !== null || d.newPath !== null) && (d.oldPath === null) === (d.blobs.old === null) && (d.newPath === null) === (d.blobs.new === null) &&
    Array.isArray(d.rows) && d.rows.length > 0 && d.rows.length <= 160 && d.rows.every((r: any) => r && typeof r.content === "string" && !r.content.includes("\n") &&
      (r.kind === "context" ? line(r.oldLine) && line(r.newLine) : r.kind === "addition" ? r.oldLine === null && line(r.newLine) : r.kind === "deletion" ? line(r.oldLine) && r.newLine === null : r.kind === "meta" && r.oldLine === null && r.newLine === null)) &&
    d.rows.reduce((n: number, r: DiffRow) => n + r.content.length, 0) <= 25000;
}

export function briefingEvidenceText(e: BriefingEvidence): string {
  if (!e.available) return e.reason ?? "Source unavailable";
  if (e.kind !== "code") return e.quote;
  if (!e.diff?.available) return e.diff?.reason ?? "Diff unavailable in this saved Briefing.";
  return e.diff.rows.map(r => `${r.kind === "addition" ? "+" : r.kind === "deletion" ? "-" : r.kind === "context" ? " " : ""}${r.content}`).join("\n");
}
