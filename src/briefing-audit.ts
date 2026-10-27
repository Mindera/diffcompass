import { validBriefingProposal, type BriefingProposal } from "./briefing.ts";
import { validateReviewFlow } from "./flows.ts";
import { groundedSequenceSources } from "./sequence-sources.ts";
import type { GitComparison, ReviewFlow } from "./types.ts";

export interface ReviewedBriefing {
  proposal: BriefingProposal;
  flows: ReviewFlow[];
}

export class BriefingAuditValidationError extends Error {}

export function briefingSequenceFlows(proposal: BriefingProposal, flows: ReviewFlow[]): ReviewFlow[] {
  const used = new Set(proposal.sections.flatMap(section => section.blocks.flatMap(block => block.kind === "diagram" ? [block.diagramId] : [])));
  return flows.filter(flow => used.has(`sequence-${flow.id}`));
}

export const BRIEFING_AUDIT_PROMPT = `You are reviewing the causal completeness of sequences in a draft briefing. Syntax and source-quotation checks do not establish that its story is complete. Do not modify files.
Independently trace each supplied sequence against the captured source, from the triggering action to the outcome claimed by the surrounding prose. Check where consumed data comes from, which request returns it, what transforms it, and what delivers the final result. In particular, a fetch followed by a state update must not skip the returned data or the calculation that explains that update. Check ordering, guards, success/failure scope, and active-observer preconditions. Distinguish events from synchronous calls: do not require a return for a fire-and-forget message or add ceremonial acknowledgements. An intentionally scoped sequence can omit unrelated implementation details.
Keep a sequence only when the chosen scenario is supported and understandable. Revise a sequence to repair an evidenced omission or misleading ordering, preserving its flow id. Rebuild messageSources with the final message ordinals and exact captions. Do not invent interactions, infer execution merely from names, or claim runtime verification. When essential evidence is unavailable, omit the diagram from the briefing and rewrite its introduction using the supported prose and source excerpts. Preserve the outcome-first story and unrelated content.
Return only {"decisions":[{"flowId":"every supplied flow id exactly once","disposition":"kept|revised|omitted","reason":"the inspected source and causal chain supporting this decision"}],"briefingProposal":{...complete corrected proposal...}}. For each revised decision add a flow object containing the complete replacement in the supplied ReviewFlow schema, including id, title, summary, mermaid, provenance, affectedFiles and messageSources. Do not add other flows or diagrams. Use messageSources for revised sequences rather than guessing renderer element IDs. Remove obsolete diagramSources for a revised or omitted sequence. A kept or omitted decision must not include a flow object. Every omitted diagram must also be absent from the returned proposal.`;

/** Validate the review's coverage and repairs; semantic judgment remains the reviewer's. */
export function parseBriefingAudit(message: string, proposal: BriefingProposal, flows: ReviewFlow[], comparison: GitComparison): ReviewedBriefing {
  try {
    const start = message.indexOf("{"), end = message.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("Expected a Briefing audit JSON object.");
    const value = JSON.parse(message.slice(start, end + 1));
    const selected = briefingSequenceFlows(proposal, flows);
    if (!Array.isArray(value.decisions) || value.decisions.length !== selected.length || !validBriefingProposal(value.briefingProposal)) throw new Error("Return one decision per supplied sequence and a valid complete briefingProposal.");
    const expected = new Map(selected.map(flow => [flow.id, flow]));
    const reviewed = new Map<string, ReviewFlow | null>();
    const changed = new Set<string>();
    for (const decision of value.decisions) {
      if (!decision || !expected.has(decision.flowId) || reviewed.has(decision.flowId) || !["kept", "revised", "omitted"].includes(decision.disposition) || typeof decision.reason !== "string" || !decision.reason.trim() || decision.reason.length > 2000) throw new Error("Each supplied flow needs one unique, explained decision.");
      if (decision.disposition === "revised") {
        const flow = validateReviewFlow(decision.flow);
        if (flow.id !== decision.flowId || !flow.affectedFiles?.length || flow.affectedFiles.some(path => !comparison.files.some(file => file.path === path))) throw new Error("A revised flow must preserve its id and reference only changed paths.");
        const diagnostics: string[] = [];
        flow.messageSources = groundedSequenceSources(flow, comparison, diagnostics);
        if (diagnostics.length) throw new Error(diagnostics.join("\n"));
        reviewed.set(flow.id, flow);
        changed.add(`sequence-${flow.id}`);
      } else {
        if (decision.flow !== undefined) throw new Error("Only revised decisions may provide a flow.");
        reviewed.set(decision.flowId, decision.disposition === "kept" ? expected.get(decision.flowId)! : null);
        if (decision.disposition === "omitted") changed.add(`sequence-${decision.flowId}`);
      }
    }
    const allowed = new Set(proposal.sections.flatMap(section => section.blocks.flatMap(block => block.kind === "diagram" ? [block.diagramId] : [])));
    for (const [id, flow] of reviewed) if (!flow) allowed.delete(`sequence-${id}`);
    const corrected = value.briefingProposal as BriefingProposal;
    for (const block of corrected.sections.flatMap(section => section.blocks)) {
      if (block.kind === "diagram" && !allowed.has(block.diagramId)) throw new Error("The reviewed briefing references an omitted or unreviewed diagram.");
    }
    if (corrected.diagramSources?.some(binding => changed.has(binding.diagramId))) throw new Error("Remove obsolete diagramSources for revised or omitted sequences; use messageSources for replacements.");
    const retained = flows.flatMap(flow => {
      if (!reviewed.has(flow.id)) return [flow];
      const replacement = reviewed.get(flow.id);
      return replacement ? [replacement] : [];
    });
    return { proposal: corrected, flows: retained };
  } catch (error) {
    throw new BriefingAuditValidationError(error instanceof Error ? error.message : String(error));
  }
}
