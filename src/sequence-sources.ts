import type { ArchifyArtifact, DiffRow, GitComparison, ReviewFlow, SequenceMessageSource, SequenceSourceAnchor } from "./types.ts";
import { sequenceCandidate } from "./archify.ts";
import { resolveSymbolPeek } from "./symbol-peek.ts";
import { loadRepositoryFile } from "./git.ts";

export const SEQUENCE_SOURCE_PROMPT = `For sequence diagrams include messageSources for messages supported by inspected code in the supplied diff (including context rows): [{"message":1,"label":"exact message caption","anchors":[{"path":"repository/path","side":"new","startLine":10,"endLine":12,"quote":"exact source lines joined with newline"}]}]. Count only arrow messages, one-based, in Mermaid order, including self calls and returns. Each caption must match exactly. Use old for removed behavior, new for current behavior. Include 1–8 supporting locations per message, at most 20 lines per location. Never guess line numbers or link a participant merely because it has a similar name. If a message is inferred or its source is outside the supplied diff, leave it unlinked. Source anchors are evidence for the message, not a claim of verified runtime execution.`;

export function sequenceMessageLabels(mermaid: string): string[] {
  return mermaid.split("\n").flatMap((line) => {
    const match = /^\s*[A-Za-z0-9_.-]+?\s*-{1,2}(?:>>|>|x|\))\s*[A-Za-z0-9_.-]+\s*:\s*(.+)$/.exec(line);
    return match ? [match[1]!.trim()] : [];
  });
}
export function validateSequenceSources(value: unknown, mermaid: string): SequenceMessageSource[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 40) throw new Error("messageSources must contain at most 40 messages.");
  const labels = sequenceMessageLabels(mermaid), seen = new Set<number>();
  return value.map((entry) => {
    if (!entry || !Number.isInteger(entry.message) || entry.message < 1 || entry.message > labels.length || typeof entry.label !== "string" || seen.has(entry.message) || entry.label !== labels[entry.message - 1]) throw new Error("messageSources must reference unique message ordinals and exact captions.");
    seen.add(entry.message);
    if (!Array.isArray(entry.anchors) || !entry.anchors.length || entry.anchors.length > 8) throw new Error("A sequence message needs 1–8 source anchors.");
    const anchors = entry.anchors.map((anchor: SequenceSourceAnchor) => {
      if (!anchor || typeof anchor.path !== "string" || !anchor.path || anchor.path.length > 4096 || anchor.path.startsWith("/") || anchor.path.includes("\\") || anchor.path.includes(":") || anchor.path.split("/").some((part) => !part || part === "." || part === "..") || /[\x00-\x1f]/.test(anchor.path) || !["old", "new"].includes(anchor.side) || !Number.isSafeInteger(anchor.startLine) || !Number.isSafeInteger(anchor.endLine) || anchor.startLine < 1 || anchor.endLine < anchor.startLine || anchor.endLine - anchor.startLine > 19 || typeof anchor.quote !== "string" || !anchor.quote.trim() || anchor.quote.length > 8000) throw new Error("Invalid sequence source anchor.");
      return { path: anchor.path, side: anchor.side, startLine: anchor.startLine, endLine: anchor.endLine, quote: anchor.quote };
    });
    return { message: entry.message, label: entry.label, anchors };
  });
}

/** Shared quote check for authored evidence and candidate navigation parity. */
export function sequenceAnchorEvidence(anchor: SequenceSourceAnchor, comparison: GitComparison): { rows?: DiffRow[]; issue?: string } {
  if (!Number.isSafeInteger(anchor.startLine) || !Number.isSafeInteger(anchor.endLine) || anchor.startLine < 1 || anchor.endLine < anchor.startLine || anchor.endLine - anchor.startLine > 19) return { issue: "Invalid source excerpt range." };
  const file = comparison.files.find((file) => anchor.side === "old" ? file.oldPath === anchor.path || file.path === anchor.path : file.path === anchor.path);
  const rows = new Map<number, DiffRow>();
  for (const hunk of file?.hunks ?? []) for (const row of hunk.rows) {
    const line = anchor.side === "old" ? row.oldLine : row.newLine;
    if (line != null) rows.set(line, row);
  }
  const evidence: DiffRow[] = [];
  for (let line = anchor.startLine; line <= anchor.endLine; line++) {
    if (!rows.has(line)) return { issue: `${anchor.path}:${line} is not available on the ${anchor.side} side of the diff.` };
    evidence.push(rows.get(line)!);
  }
  if (evidence.map(row => row.content).join("\n") !== anchor.quote) return { issue: `source quote does not match ${anchor.path}:${anchor.startLine}.` };
  return { rows: evidence };
}

export function groundedSequenceSources(flow: ReviewFlow, comparison: GitComparison, diagnostics: string[] = []): SequenceMessageSource[] {
  let entries: SequenceMessageSource[];
  try { entries = validateSequenceSources(flow.messageSources, flow.mermaid) ?? []; }
  catch (error) { diagnostics.push(`Flow ${flow.id}: ${String(error)}`); return []; }
  return entries.flatMap((entry) => {
    const anchors = entry.anchors.filter((anchor) => {
      const { issue } = sequenceAnchorEvidence(anchor, comparison);
      if (issue) { diagnostics.push(`Flow ${flow.id}, message ${entry.message}: ${issue}`); return false; }
      return true;
    });
    return anchors.length ? [{ ...entry, anchors }] : [];
  });
}

/** Only bind current, source-backed captions to the exact rendered message. */
export function sequenceArtifactSources(artifact: ArchifyArtifact, flows: ReviewFlow[], comparison: GitComparison): Record<string, SequenceSourceAnchor[]> {
  const flow = flows.find((flow) => artifact.id === `sequence-${flow.id}` && !flow.outdated);
  if (artifact.type !== "sequence" || !flow || !Array.isArray(artifact.ir.messages)) return {};
  const expected = sequenceCandidate(flow)?.ir;
  if (!expected || JSON.stringify(expected.messages) !== JSON.stringify(artifact.ir.messages) || JSON.stringify(expected.participants) !== JSON.stringify(artifact.ir.participants)) return {};
  const result: Record<string, SequenceSourceAnchor[]> = {};
  for (const entry of groundedSequenceSources(flow, comparison)) {
    const message = artifact.ir.messages[entry.message - 1];
    if (message && typeof message === "object" && !Array.isArray(message) && typeof message.id === "string" && message.label === entry.label) result[message.id] = entry.anchors;
  }
  return result;
}

/** Find definition candidates, never silently equate a name match with call evidence. */
export async function lookupSequenceDefinition(artifact: ArchifyArtifact, flows: ReviewFlow[], comparison: GitComparison, edgeId: string): Promise<SequenceSourceAnchor[]> {
  const flow = flows.find((flow) => artifact.id === `sequence-${flow.id}` && !flow.outdated);
  const expected = flow && sequenceCandidate(flow)?.ir;
  if (artifact.type !== "sequence" || !expected || JSON.stringify(expected.messages) !== JSON.stringify(artifact.ir.messages) || JSON.stringify(expected.participants) !== JSON.stringify(artifact.ir.participants)) return [];
  const message = (artifact.ir.messages as { id: string; label: string }[]).find((message) => message.id === edgeId);
  // Only a call-shaped caption is a lookup query; prose/return labels are not identifiers.
  const match = message && /^(?:[\w$]+\.)*([\p{L}_$][\p{L}\p{N}_$]*)\s*\([^\n]*\)\s*$/u.exec(message.label);
  if (!match) return [];
  const found = await resolveSymbolPeek(comparison, { symbol: match[1]! });
  const anchors: SequenceSourceAnchor[] = [];
  for (const definition of found.definitions.slice(0, 8)) {
    try {
      const lines = (await loadRepositoryFile(comparison, definition.path)).split(/\r?\n/);
      const quote = lines[definition.line - 1];
      if (!quote || !quote.includes(match[1]!)) continue;
      const anchor: SequenceSourceAnchor = { path: definition.path, side: "new", startLine: definition.line, endLine: definition.line, quote, definition: true };
      // Matching a captured row permits opening that exact comparison line;
      // it does not turn a name match into authored evidence of this call.
      if (sequenceAnchorEvidence(anchor, comparison).rows) anchor.comparisonMatch = true;
      anchors.push(anchor);
    } catch { /* Missing, binary or inaccessible definitions are not navigable. */ }
  }
  return anchors;
}
