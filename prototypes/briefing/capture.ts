import { buildBriefing, validBriefingDocument, type BriefingDocument, type BriefingProposal, type NarrativeBlock, type NarrativeSection } from "../../src/briefing.ts";
import { validateReviewArchitecture } from "../../src/architecture.ts";
import { loadCapturedSource } from "../../src/diff-sources.ts";
import { loadComparisonBetweenTrees } from "../../src/git.ts";
import type { GitComparison, SequenceSourceAnchor, TourOutline } from "../../src/types.ts";

import type { Approach } from "./content.ts";

export type Evidence = SequenceSourceAnchor & { id: string };
export const p = (id: string, text: string, basis: "observed" | "stated" | "inferred" = "observed"): NarrativeBlock => ({ id, kind: "prose", text, basis });
export const code = (id: string, evidenceId: string): NarrativeBlock => ({ id, kind: "source", evidenceId });
export const diagram = (id: string, diagramId = "architecture-journey"): NarrativeBlock => ({ id, kind: "diagram", diagramId });
export const example = (id: string, text: string): NarrativeBlock => ({ id, kind: "example", text });
export const section = (id: string, title: string, ...blocks: NarrativeBlock[]): NarrativeSection => ({ id, title, blocks });
export const changeClasses = '\nclassDef new stroke:#2e7d32,stroke-width:3px\nclassDef touched stroke:#f9a825,stroke-width:3px\nclassDef removed stroke:#c62828,stroke-width:3px,stroke-dasharray:4 3\nclassDef external stroke:#888888,stroke-dasharray:3 3';

export async function comparison(repository: string, base: string, head: string, repositoryName = "diffcompass") {
  return loadComparisonBetweenTrees(repository, { base, mergeBase: base, head, sourceTree: head, repositoryName, branch: head.slice(0, 7) });
}
export async function excerpt(comparison: GitComparison, id: string, path: string, startLine: number, endLine: number, side: "old" | "new" = "new"): Promise<Evidence> {
  const source = await loadCapturedSource(comparison, side, path);
  return { id, path, side, startLine, endLine, quote: source.text.split(/\r?\n/).slice(startLine - 1, endLine).join("\n") };
}
export function outline(title: string): TourOutline { return { title, summary: title, phases: [], callFlows: [], flows: [], findings: [] }; }
export async function documents(comparison: GitComparison, source: TourOutline, evidence: Evidence[], stories: Record<Approach, { title: string; sections: NarrativeSection[] }>): Promise<Record<Approach, BriefingDocument>> {
  if (source.architecture) source.architecture = validateReviewArchitecture(source.architecture);
  const entries = [];
  for (const [approach, story] of Object.entries(stories)) {
    const prefix = `${comparison.head.slice(0, 7)}-${approach}`;
    const proposal: BriefingProposal = { ...story, evidence, sections: story.sections.map(s => ({ ...s, id: `${prefix}-section-${s.id}`, blocks: s.blocks.map(b => ({ ...b, id: `${prefix}-block-${b.id}` })) })) };
    const document = await buildBriefing(comparison, source, JSON.stringify({ source: "Pinned repository history", head: comparison.head }), proposal);
    // Authored experiments must fail visibly if a historical citation drifts.
    if (document.mode !== "authored" || !validBriefingDocument(document) || document.evidence.some(e => !e.available || (e.kind === "code" && !e.diff?.available))) throw new Error(`Invalid captured evidence for ${comparison.head} / ${approach}`);
    for (const block of proposal.sections.flatMap(s => s.blocks)) {
      if (block.kind !== "diagram") continue;
      const rendered = document.diagrams.find(d => d.id === block.diagramId);
      if (!rendered || rendered.elements.some(e => !e.evidenceIds.length)) throw new Error(`Missing diagram or element evidence for ${block.diagramId} / ${approach}`);
    }
    entries.push([approach, document]);
  }
  return Object.fromEntries(entries) as Record<Approach, BriefingDocument>;
}

