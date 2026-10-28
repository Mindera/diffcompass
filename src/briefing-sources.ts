import { validAnchor, validBriefingDocument, type BriefingDiagram, type BriefingDocument, type BriefingEvidence } from "./briefing.ts";
import { captureBriefingDiffs } from "./briefing-diff.ts";
import { diffSourceIdentity, loadCapturedSource } from "./diff-sources.ts";
import type { GitComparison } from "./types.ts";

export class BriefingSourceValidationError extends Error {}

/** Only inspect diagrams used in the story, after sequence repairs and ID creation. */
export function missingBriefingSources(document: BriefingDocument) {
  const used = new Set(document.sections.flatMap(section => section.blocks.flatMap(block => block.kind === "diagram" ? [block.diagramId] : [])));
  const available = new Set(document.evidence.filter(e => e.available).map(e => e.id));
  return document.diagrams.filter(diagram => used.has(diagram.id)).flatMap(diagram => {
    const elements = diagram.elements.filter(element => !element.evidenceIds.some(id => available.has(id)));
    return elements.length ? [{ diagram, elements }] : [];
  });
}

export const BRIEFING_SOURCE_PROMPT = `You are attaching inspected source to the finished diagrams in a Briefing. Do not modify files, the narrative, or the diagrams.
For every requested element, inspect the captured repository source and return one decision using its exact supplied ID. The diagram IR supplies exact endpoints, directions, and IDs; never match a relationship by its label alone or guess an ID. Trace calls, imports, wiring, handlers, state transitions, data relationships, and domain definitions as appropriate for the diagram family. For an arrow, cite the call site or declaration that establishes that particular relationship, rather than merely citing its target's implementation. For a sequence message, cite the corresponding interaction and preserve the audited ordering. Documentation can support domain concepts and proposed designs; it is not proof of runtime behavior.
Use existing verified excerpts when they establish the same relationship. Otherwise inspect the captured Git trees for a short exact excerpt, including unchanged supporting files when necessary. Cite the old side for removed behavior and the new side for current behavior. Inspect both sides when needed. Do not invent source or infer a call from a diagram's label. A matching quotation proves its location, not its semantic relevance; explain why it supports this element.
Return only {"decisions":[{"elementId":"exact requested ID","status":"bound","reason":"why the inspected code or document establishes this element","anchors":[{"path":"relative/path","side":"old|new","startLine":1,"endLine":3,"quote":"exact contiguous captured source"}]},{"elementId":"another requested ID","status":"external|unavailable","reason":"specific boundary or source limitation"}]}.
Every requested ID must appear exactly once. Bound decisions require 1–8 anchors, each at most 30 lines and 8000 characters. External means the element belongs outside the captured repository; unchanged local code is not external. Unavailable means the relationship cannot be established from inspected source, and the reason must say what is missing or uncertain. These decisions must not contain anchors. Reasons are plain text, at most 2000 characters, suitable for the reader. Do not classify a supported relationship as unavailable simply to avoid inspecting it. The entire Briefing retains at most 40 distinct excerpts, so prefer reusing an existing exact citation.`;

export function briefingSourceContext(document: BriefingDocument, diagram: BriefingDiagram) {
  // Never send renderer HTML, scripts, styles or embedded fonts to the agent.
  const { archifyHtml: _html, ...saved } = diagram;
  return { diagram: saved, evidence: document.evidence.map(({ diff: _diff, ...source }) => source) };
}

/** A response is applied atomically only after IDs, coverage and quotes validate. */
export async function captureBriefingSourceDecisions(message: string, document: BriefingDocument, diagramId: string, elementIds: string[], comparison: GitComparison): Promise<BriefingDocument> {
  try {
    if (document.comparisonId !== diffSourceIdentity(comparison)) throw new Error("The Briefing belongs to a different captured comparison.");
    if (message.length > 1_000_000) throw new Error("The source-link response is too large.");
    const start = message.indexOf("{"), end = message.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("Expected a source-link JSON object.");
    const value = JSON.parse(message.slice(start, end + 1));
    if (!Array.isArray(value?.decisions) || value.decisions.length !== elementIds.length) throw new Error("Return exactly one decision for every requested element.");
    const result = structuredClone(document);
    const diagram = result.diagrams.find(diagram => diagram.id === diagramId);
    if (!diagram) throw new Error("The requested diagram does not exist.");
    const pending = new Set(elementIds);
    const sources = new Map<string, ReturnType<typeof loadCapturedSource>>();
    for (const decision of value.decisions) {
      if (!decision || !pending.delete(decision.elementId)) throw new Error("Source decisions must use each requested element ID exactly once.");
      const element = diagram.elements.find(element => element.id === decision.elementId);
      if (!element || !["bound", "external", "unavailable"].includes(decision.status) || typeof decision.reason !== "string" || !decision.reason.trim() || decision.reason.length > 2000) throw new Error("Each source decision needs a valid status and a specific reason.");
      if (decision.status !== "bound") {
        if (decision.anchors !== undefined) throw new Error("External or unavailable elements must not include source anchors.");
        element.evidenceIds = [];
        element.sourceReview = { status: decision.status, reason: decision.reason };
        continue;
      }
      if (!Array.isArray(decision.anchors) || !decision.anchors.length || decision.anchors.length > 8 || !decision.anchors.every(validAnchor)) throw new Error("Bound elements need 1–8 valid exact source anchors.");
      const bound: string[] = [];
      let limited = false;
      for (const anchor of decision.anchors) {
        const key = `${anchor.side}:${anchor.path}`;
        if (!sources.has(key)) sources.set(key, loadCapturedSource(comparison, anchor.side, anchor.path));
        let source;
        try { source = await sources.get(key)!; }
        catch { throw new Error(`Captured source is unavailable for ${anchor.side} ${anchor.path}. Inspect another captured source or explain the limitation.`); }
        const lines = source.text.split(/\r?\n/);
        if (source.text.endsWith("\n")) lines.pop();
        if (!source.blob || anchor.endLine > lines.length || lines.slice(anchor.startLine - 1, anchor.endLine).join("\n") !== anchor.quote) throw new Error(`The source quote does not match ${anchor.side} ${anchor.path}:${anchor.startLine}–${anchor.endLine} in the captured Git tree.`);
        let evidence = result.evidence.find(e => e.available && e.path === anchor.path && e.side === anchor.side && e.startLine === anchor.startLine && e.endLine === anchor.endLine && e.quote === anchor.quote);
        if (!evidence) {
          if (result.evidence.length >= 40) { limited = true; continue; }
          let index = result.evidence.length + 1;
          while (result.evidence.some(e => e.id === `source-${index}`)) index++;
          evidence = { id: `source-${index}`, kind: /\.md$/i.test(anchor.path) ? "document" : "code", path: anchor.path, side: anchor.side, startLine: anchor.startLine, endLine: anchor.endLine, quote: anchor.quote, available: true, blob: source.blob } satisfies BriefingEvidence;
          result.evidence.push(evidence);
        }
        if (!bound.includes(evidence.id)) bound.push(evidence.id);
      }
      element.evidenceIds = bound;
      element.sourceReview = limited
        ? { status: "limit", reason: "Supporting source was found, but this Briefing reached its limit of 40 saved excerpts." }
        : { status: "bound", reason: decision.reason };
    }
    await captureBriefingDiffs(comparison, result, sources);
    if (!validBriefingDocument(result)) throw new Error("The source decisions produced an invalid saved Briefing.");
    return result;
  } catch (error) {
    throw new BriefingSourceValidationError(error instanceof Error ? error.message : String(error));
  }
}
