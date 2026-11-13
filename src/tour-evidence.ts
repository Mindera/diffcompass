import { createHash } from "node:crypto";
import type { DiffFile, DiffHunk, DiffRow, GitComparison, TourAnchor, TourOutline, TourStep, TourStepEvidence } from "./types.ts";
import { tourSteps } from "./tour.ts";

export const MAX_TOUR_ANCHORS = 8;
export const tourAnchors = (step: TourStep): TourAnchor[] => [step.anchor, ...(step.relatedAnchors ?? [])];
const lineAt = (row: DiffRow, side: TourAnchor["side"]) => side === "old" ? row.oldLine : row.newLine;
const fingerprint = (hunk: DiffHunk) => createHash("sha256").update(JSON.stringify(hunk.rows.map(row => [row.kind, row.content]))).digest("hex");
const firstLine = (hunk: DiffHunk, side: TourAnchor["side"]) => hunk.rows.map(row => lineAt(row, side)).find((line): line is number => line !== null);
const intersects = (hunk: DiffHunk, anchor: TourAnchor) => hunk.rows.some(row => {
  const line = lineAt(row, anchor.side);
  return line !== null && line >= anchor.startLine && line <= anchor.endLine;
});

export function validTourAnchor(value: unknown, comparison: GitComparison, paths?: ReadonlySet<string>): value is TourAnchor {
  if (!value || typeof value !== "object") return false;
  const a = value as TourAnchor;
  if (typeof a.path !== "string" || !["old", "new"].includes(a.side) || !Number.isSafeInteger(a.startLine) || !Number.isSafeInteger(a.endLine) || a.startLine < 1 || a.endLine < a.startLine || a.endLine - a.startLine > 500 || (paths && !paths.has(a.path))) return false;
  const file = comparison.files.find(file => file.path === a.path);
  if (!file) return false;
  const lines = new Set(file.hunks.flatMap(hunk => hunk.rows.map(row => lineAt(row, a.side))));
  for (let line = a.startLine; line <= a.endLine; line++) if (!lines.has(line)) return false;
  return true;
}

/** Store content identities and range offsets, not line-number identities. */
export function captureTourEvidence(step: TourStep, comparison: GitComparison): TourStepEvidence {
  return { version: 1, anchors: tourAnchors(step).map(anchor => {
    const file = comparison.files.find(file => file.path === anchor.path);
    const blocks = (file?.hunks ?? []).filter(hunk => intersects(hunk, anchor)).map(hunk => {
      const start = firstLine(hunk, anchor.side)!;
      const lines = hunk.rows.map(row => lineAt(row, anchor.side)).filter((line): line is number => line !== null && line >= anchor.startLine && line <= anchor.endLine);
      return { fingerprint: fingerprint(hunk), startOffset: Math.min(...lines) - start, endOffset: Math.max(...lines) - start };
    });
    return { anchor: { ...anchor }, blocks };
  }) };
}

/** Missing or ambiguous content stays stale; never accept whatever moved onto the old line. */
export function reconcileTourEvidence(outline: TourOutline | undefined, comparison: GitComparison): void {
  const indexed = new Map(comparison.files.map(file => [file.path, file.hunks.map(hunk => ({ hunk, fingerprint: fingerprint(hunk) }))]));
  for (const step of tourSteps(outline)) {
    if (step.evidence?.version !== 1 || !step.evidence.anchors?.length) {
      step.freshness = step.outdated ? "outdated" : "unverified";
      continue;
    }
    let missing = 0;
    const anchors: TourAnchor[] = [];
    for (const saved of step.evidence.anchors) {
      const ranges: Array<[number, number]> = [];
      const file = comparison.files.find(file => file.path === saved.anchor.path);
      const entries = file ? indexed.get(file.path) ?? [] : [];
      if (!saved.blocks.length) missing++;
      for (const block of saved.blocks) {
        const matches = entries.filter(entry => entry.fingerprint === block.fingerprint);
        if (matches.length !== 1) { missing++; continue; }
        const start = firstLine(matches[0]!.hunk, saved.anchor.side);
        if (start === undefined) { missing++; continue; }
        ranges.push([start + block.startOffset, start + block.endOffset]);
      }
      if (ranges.length && file) anchors.push({ ...saved.anchor, path: file.path, startLine: Math.min(...ranges.map(range => range[0])), endLine: Math.max(...ranges.map(range => range[1])) });
    }
    step.missingEvidence = missing;
    step.outdated = missing > 0 || anchors.length !== step.evidence.anchors.length;
    step.freshness = step.outdated ? "outdated" : "current";
    if (!step.outdated) {
      step.anchor = anchors[0]!;
      if (anchors.length > 1) step.relatedAnchors = anchors.slice(1);
    }
  }
}

export interface UncoveredTourBlock {
  id: string; path: string; anchor?: TourAnchor; reason: string; partial: boolean;
}
export interface TourCoverage {
  total: number; covered: number; partial: number; unverifiedSteps: number;
  uncovered: UncoveredTourBlock[]; omitted: number;
}
function blockAnchor(file: DiffFile, hunk: DiffHunk): TourAnchor | undefined {
  const side = file.status === "deleted" ? "old" : "new";
  const lines = hunk.rows.map(row => lineAt(row, side)).filter((line): line is number => line !== null);
  return lines.length ? { path: file.path, side, startLine: Math.min(...lines), endLine: Math.max(...lines) } : undefined;
}
const generated = (path: string) => /(?:^|\/)(?:Cargo\.lock|package-lock\.json|bun\.lockb?|yarn\.lock|pnpm-lock\.yaml|go\.sum)$|\.min\.[cm]?js$|\.snap$/.test(path);

/** Count changed rows, not surrounding context. A partial block is never reported covered. */
export function tourCoverage(outline: TourOutline | undefined, comparison: GitComparison): TourCoverage {
  const steps = tourSteps(outline);
  const anchors = steps.filter(step => step.freshness === "current" && !step.outdated).flatMap(tourAnchors);
  const result: TourCoverage = { total: 0, covered: 0, partial: 0, unverifiedSteps: steps.filter(step => step.freshness === "unverified").length, uncovered: [], omitted: 0 };
  const append = (block: UncoveredTourBlock) => result.uncovered.length < 100 ? result.uncovered.push(block) : result.omitted++;
  for (const file of comparison.files) {
    const hunks = file.hunks.filter(hunk => hunk.rows.some(row => row.kind === "addition" || row.kind === "deletion"));
    if (!hunks.length) {
      result.total++;
      append({ id: `${file.path}:metadata`, path: file.path, partial: false, reason: "Binary, empty-file, rename or metadata change; inspect this file separately." });
      continue;
    }
    for (const [index, hunk] of hunks.entries()) {
      result.total++;
      const changed = hunk.rows.filter(row => row.kind === "addition" || row.kind === "deletion");
      // A before/after replacement is one change. Covering its new range also
      // covers the paired deletions (and vice versa), but not a separate edit.
      let covered = 0;
      for (let at = 0; at < hunk.rows.length;) {
        if (!["addition", "deletion"].includes(hunk.rows[at]!.kind)) { at++; continue; }
        const run: DiffRow[] = [];
        while (at < hunk.rows.length && ["addition", "deletion"].includes(hunk.rows[at]!.kind)) run.push(hunk.rows[at++]!);
        const sides = (["old", "new"] as const).map(side => run.filter(row => lineAt(row, side) !== null));
        const complete = sides.some((rows, i) => rows.length && rows.every(row => anchors.some(anchor => anchor.path === file.path && anchor.side === (i ? "new" : "old") && lineAt(row, anchor.side)! >= anchor.startLine && lineAt(row, anchor.side)! <= anchor.endLine)));
        if (complete) covered += run.length;
        else covered += run.filter(row => anchors.some(anchor => anchor.path === file.path && lineAt(row, anchor.side) !== null && lineAt(row, anchor.side)! >= anchor.startLine && lineAt(row, anchor.side)! <= anchor.endLine)).length;
      }
      if (covered === changed.length) { result.covered++; continue; }
      if (covered) result.partial++;
      append({ id: `${file.path}:${fingerprint(hunk)}:${index}`, path: file.path, anchor: blockAnchor(file, hunk), partial: covered > 0,
        reason: covered ? "Only part of this changed block is covered by current tour stops." : generated(file.path) ? "Generated or lockfile change outside the current tour stops." : "No current tour stop covers this changed block." });
    }
  }
  return result;
}

/** Small, read-only before/after groups for the focused step viewer. */
export function tourCode(step: TourStep, comparison: GitComparison) {
  const groups: Array<{ id: string; path: string; anchor: TourAnchor; rows: DiffRow[]; limited: boolean }> = [];
  let budget = 600;
  let characters = 100_000;
  let limited = false;
  const used = new Set<DiffHunk>();
  if (!step.outdated) for (const anchor of tourAnchors(step)) {
    const file = comparison.files.find(file => file.path === anchor.path);
    for (const hunk of file?.hunks ?? []) {
      if (!intersects(hunk, anchor) || (used.has(hunk) && hunk.rows.length <= 160)) continue;
      used.add(hunk);
      const hit = hunk.rows.findIndex(row => {
        const line = lineAt(row, anchor.side);
        return line !== null && line >= anchor.startLine;
      });
      const start = hunk.rows.length > 160 ? Math.max(0, hit - 4) : 0;
      const rows: DiffRow[] = [];
      for (const row of hunk.rows.slice(start, start + Math.min(160, budget))) {
        if (row.content.length > characters) { limited = true; break; }
        rows.push(row); characters -= row.content.length;
      }
      if (!rows.length) { limited = true; continue; }
      budget -= rows.length;
      groups.push({ id: `tour-${groups.length}`, path: file!.path, anchor, rows, limited: rows.length !== hunk.rows.length });
    }
  }
  return { stepId: step.id, freshness: step.freshness ?? "unverified", groups, limited: limited || budget <= 0 };
}
