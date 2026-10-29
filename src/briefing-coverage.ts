import type { BriefingDocument } from "./briefing.ts";
import { lineRanges, type LineRange, type LineSide } from "./change-facts.ts";
import { diffSourceIdentity } from "./diff-sources.ts";
import type { DiffRow, GitComparison } from "./types.ts";

export type HunkCoverageState = "explained" | "partly-explained" | "not-explained";
export interface HunkCoverage { path: string; hunk: number; header: string; state: HunkCoverageState; changedLines: number; cited: LineRange[]; expanded: LineRange[]; unexplained: LineRange[] }
export interface BriefingCoverage { state: "measured" | "unavailable"; reason?: string; comparisonId: string; documentId: string; hunks: HunkCoverage[]; totals: { hunks: number; explained: number; partlyExplained: number; notExplained: number; changedLines: number; cited: number; expanded: number; unexplained: number }; evidenceWithoutDiff: number }

const emptyTotals = () => ({ hunks: 0, explained: 0, partlyExplained: 0, notExplained: 0, changedLines: 0, cited: 0, expanded: 0, unexplained: 0 });

function changedLine(row: DiffRow): { side: LineSide; line: number } | undefined {
  const side: LineSide | undefined = row.kind === "deletion" ? "old" : row.kind === "addition" ? "new" : undefined;
  const line = side === "old" ? row.oldLine : side === "new" ? row.newLine : null;
  return side && line !== null ? { side, line } : undefined;
}

function shownEvidenceIds(document: BriefingDocument): Set<string> {
  const ids = new Set<string>(), diagrams = new Set<string>();
  for (const block of document.sections.flatMap(s => s.blocks)) {
    if (block.kind === "source") ids.add(block.evidenceId);
    else if (block.kind === "diagram") diagrams.add(block.diagramId);
  }
  for (const diagram of document.diagrams) if (diagrams.has(diagram.id)) for (const element of diagram.elements) for (const id of element.evidenceIds) ids.add(id);
  return ids;
}

export function briefingCoverage(comparison: GitComparison, document: BriefingDocument): BriefingCoverage {
  const comparisonId = diffSourceIdentity(comparison), documentId = document.id;
  if (document.comparisonId !== comparisonId) return { state: "unavailable", reason: "The Briefing belongs to another captured comparison.", comparisonId, documentId, hunks: [], totals: emptyTotals(), evidenceWithoutDiff: 0 };
  const ids = shownEvidenceIds(document);
  const shown = new Map<string, Set<number>>(), cited = new Map<string, Set<number>>();
  const mark = (map: Map<string, Set<number>>, key: string, line: number) => { let set = map.get(key); if (!set) map.set(key, set = new Set()); set.add(line); };
  let evidenceWithoutDiff = 0;
  for (const evidence of document.evidence) {
    if (!ids.has(evidence.id) || !evidence.available) continue;
    if (evidence.kind === "document") {
      const file = comparison.files.find(f => (evidence.side === "new" ? f.newPath : f.oldPath) === evidence.path);
      if (!file) continue;
      for (let line = evidence.startLine; line <= evidence.endLine; line++) { mark(shown, `${file.path}\0${evidence.side}`, line); mark(cited, `${file.path}\0${evidence.side}`, line); }
      continue;
    }
    if (evidence.diff === undefined) { evidenceWithoutDiff++; continue; }
    const diff = evidence.diff;
    if (!diff.available) continue;
    const file = comparison.files.find(f => [f.path, f.oldPath, f.newPath].includes(evidence.path) && f.oldPath === diff.oldPath && f.newPath === diff.newPath);
    if (!file) continue;
    for (const row of diff.rows) {
      const changed = changedLine(row);
      if (!changed) continue;
      const { side, line } = changed;
      mark(shown, `${file.path}\0${side}`, line);
      if (side === evidence.side && line >= evidence.startLine && line <= evidence.endLine) mark(cited, `${file.path}\0${side}`, line);
    }
  }
  const hunks: HunkCoverage[] = [], totals = emptyTotals();
  for (const file of comparison.files) {
    file.hunks.forEach((hunk, index) => {
      const lists = { cited: { old: [] as number[], new: [] as number[] }, expanded: { old: [] as number[], new: [] as number[] }, unexplained: { old: [] as number[], new: [] as number[] } };
      let changed = 0;
      for (const row of hunk.rows) {
        const at = changedLine(row);
        if (!at) continue;
        const { side, line } = at;
        changed++;
        const key = `${file.path}\0${side}`;
        (cited.get(key)?.has(line) ? lists.cited : shown.get(key)?.has(line) ? lists.expanded : lists.unexplained)[side].push(line);
      }
      const ranges = (kind: keyof typeof lists) => [...lineRanges("old", lists[kind].old), ...lineRanges("new", lists[kind].new)];
      const count = (kind: keyof typeof lists) => lists[kind].old.length + lists[kind].new.length;
      const unexplained = count("unexplained");
      const state: HunkCoverageState = unexplained === 0 ? "explained" : unexplained === changed ? "not-explained" : "partly-explained";
      hunks.push({ path: file.path, hunk: index, header: hunk.header, state, changedLines: changed, cited: ranges("cited"), expanded: ranges("expanded"), unexplained: ranges("unexplained") });
      totals.hunks++; totals.changedLines += changed; totals.cited += count("cited"); totals.expanded += count("expanded"); totals.unexplained += unexplained;
      if (state === "explained") totals.explained++; else if (state === "not-explained") totals.notExplained++; else totals.partlyExplained++;
    });
  }
  return { state: "measured", comparisonId, documentId, hunks, totals, evidenceWithoutDiff };
}
