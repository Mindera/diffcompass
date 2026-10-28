import { createHash } from "node:crypto";
import { captureBriefingDiagrams } from "./briefing-diagrams.ts";
import { archifyCandidates } from "./archify.ts";
import { validDomainDetails } from "./domain-context.ts";
import { validateMapNodeRoles } from "./map-node-roles.ts";
import { diffSourceIdentity, loadCapturedSource } from "./diff-sources.ts";
import { ReviewError } from "./errors.ts";
import { briefingEvidenceText, captureBriefingDiffs, validBriefingDiff, type BriefingDiff } from "./briefing-diff.ts";
import type { ArchifyArtifact, GitComparison, TourOutline, TourAnchor, SequenceSourceAnchor } from "./types.ts";

export type BriefingFamily = "sequence" | "architecture" | "lifecycle" | "data-model" | "call-flow" | "domain";
export interface ElementSource { elementId: string; anchors: SequenceSourceAnchor[] }
export interface BriefingEvidence extends SequenceSourceAnchor { id: string; kind: "code" | "document"; blob?: string; available: boolean; reason?: string; diff?: BriefingDiff }
export interface BriefingElement { id: string; label: string; kind: string; evidenceIds: string[]; sourceReview?: { status: "bound" | "external" | "unavailable" | "limit"; reason: string } }
export interface BriefingDiagram { id: string; title: string; family: BriefingFamily; outdated?: boolean; mermaid?: string; archifyHtml?: string; nodeRoles?: ArchifyArtifact["nodeRoles"]; domainDetails?: ArchifyArtifact["domainDetails"]; ir: Record<string, unknown>; elements: BriefingElement[] }
export type NarrativeBlock =
  | { id: string; kind: "prose"; text: string; basis?: "stated" | "observed" | "inferred" }
  | { id: string; kind: "example"; text: string; language?: string }
  | { id: string; kind: "diagram"; diagramId: string }
  | { id: string; kind: "source"; evidenceId: string };
export interface NarrativeSection { id: string; title: string; blocks: NarrativeBlock[] }
export interface BriefingProposal { title: string; sections: NarrativeSection[]; evidence?: Array<SequenceSourceAnchor & { id: string }>; diagramSources?: Array<ElementSource & { diagramId: string }> }
export interface BriefingDocument {
  version: 1; id: string; title: string; createdAt: string; fingerprint: string; comparisonId: string;
  mode: "authored" | "overview"; sections: NarrativeSection[]; evidence: BriefingEvidence[]; diagrams: BriefingDiagram[];
  intent: string; outdated?: boolean;
}
export interface BriefingSelection { blockId: string; elementId?: string; quote?: string }
export interface BriefingQuestionRequest { documentId: string; items: BriefingSelection[] }
export interface BriefingQuestionContext { documentId: string; fingerprint: string; title: string; items: Array<BriefingSelection & { label: string; text: string; evidence: BriefingEvidence[] }> }
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const record = (v: unknown): v is Record<string, any> => Boolean(v && typeof v === "object" && !Array.isArray(v));
const str = (v: unknown, max = 128): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const id = (v: unknown): v is string => str(v) && /^[A-Za-z0-9_.:-]+$/.test(v);
export function briefingFingerprint(comparison: GitComparison, intent: string): string { return hash([diffSourceIdentity(comparison), intent]); }
/** Intentionally plain text: quotation offsets refer to the same text the reader displays. */
export function briefingBlockText(block: NarrativeBlock): string { return "text" in block ? block.text : ""; }
export function validBriefingProposal(v: unknown): v is BriefingProposal {
  if (!record(v) || !str(v.title, 500) || !Array.isArray(v.sections) || !v.sections.length || v.sections.length > 12) return false;
  const ids = new Set<string>(); let blocks = 0, chars = 0;
  const unique = (value: unknown) => id(value) && !ids.has(value) && Boolean(ids.add(value));
  for (const s of v.sections) {
    if (!record(s) || !unique(s.id) || !str(s.title, 200) || !Array.isArray(s.blocks) || !s.blocks.length) return false;
    for (const b of s.blocks) {
      if (!record(b) || !unique(b.id) || ++blocks > 60) return false;
      if (b.kind === "prose" || b.kind === "example") {
        if (!str(b.text, 8000) || (chars += b.text.length) > 24000) return false;
        if (b.kind === "example" && b.language !== undefined && !str(b.language, 32)) return false;
        if (b.kind === "prose" && b.basis !== undefined && !["stated", "observed", "inferred"].includes(b.basis)) return false;
      } else if (b.kind === "diagram") { if (!id(b.diagramId)) return false; }
      else if (b.kind === "source") { if (!id(b.evidenceId)) return false; }
      else return false;
    }
  }
  if (v.diagramSources !== undefined && (!Array.isArray(v.diagramSources) || v.diagramSources.length > 40 || !v.diagramSources.every((binding: any) => record(binding) && id(binding.diagramId) && id(binding.elementId) && Array.isArray(binding.anchors) && binding.anchors.length <= 8 && binding.anchors.every(validAnchor)))) return false;
  return v.evidence === undefined || (Array.isArray(v.evidence) && v.evidence.length <= 40 && v.evidence.every(e => record(e) && id(e.id) && validAnchor(e)) && new Set(v.evidence.map(e => e.id)).size === v.evidence.length);
}
export function validAnchor(a: unknown): a is SequenceSourceAnchor {
  return record(a) && str(a.path, 4096) && !a.path.startsWith("/") && !/[\\\x00-\x1f:]/.test(a.path) && a.path.split("/").every((p: string) => p && p !== "." && p !== "..") && ["old", "new"].includes(a.side) && Number.isSafeInteger(a.startLine) && a.startLine > 0 && Number.isSafeInteger(a.endLine) && a.endLine >= a.startLine && a.endLine - a.startLine < 30 && str(a.quote, 8000);
}
export function validBriefingDocument(value: unknown): value is BriefingDocument {
  if (!validBriefingProposal(value)) return false;
  const v = value as unknown as Record<string, any>;
  if (!record(v) || v.version !== 1 || !id(v.id) || !str(v.createdAt) || !/^[a-f0-9]{64}$/.test(v.fingerprint) || !/^[a-f0-9]{64}$/.test(v.comparisonId) || !["authored", "overview"].includes(v.mode) || typeof v.intent !== "string" || v.intent.length > 24000 || !Array.isArray(v.evidence) || !Array.isArray(v.diagrams) || v.diagrams.length > 24) return false;
  if (!v.evidence.every((e: any) => typeof e.available === "boolean" && validAnchor(e as unknown) && ["code", "document"].includes(e.kind) && (!e.available || /^[a-f0-9]{40,64}$/.test(e.blob)) && (e.diff === undefined || validBriefingDiff(e.diff)))) return false;
  const evidence = new Set(v.evidence.map((e: any) => e.id)), diagrams = new Set<string>();
  for (const d of v.diagrams) {
    if (!record(d) || !id(d.id) || diagrams.has(d.id) || !str(d.title, 8000) || !["sequence", "architecture", "lifecycle", "data-model", "call-flow", "domain"].includes(d.family) || !record(d.ir) || JSON.stringify(d.ir).length > 200000 || (d.mermaid !== undefined && !str(d.mermaid, 50000)) || !Array.isArray(d.elements) || d.elements.length > 240 || (d.outdated !== undefined && typeof d.outdated !== "boolean")) return false;
    if (d.archifyHtml !== undefined && (d.family === "call-flow" || !str(d.archifyHtml, 5 * 1024 * 1024))) return false;
    if (!validDomainDetails(d.domainDetails)) return false;
    try { validateMapNodeRoles(d.nodeRoles); } catch { return false; }
    diagrams.add(d.id); const elements = new Set<string>();
    for (const e of d.elements) {
      if (!record(e) || !id(e.id) || elements.has(e.id) || !str(e.label, 8000) || !str(e.kind) || !Array.isArray(e.evidenceIds) || e.evidenceIds.length > 8 || !e.evidenceIds.every((key: string) => evidence.has(key))) return false;
      if (e.sourceReview !== undefined && (!record(e.sourceReview) || !["bound", "external", "unavailable", "limit"].includes(e.sourceReview.status) || !str(e.sourceReview.reason, 2000))) return false;
      elements.add(e.id);
    }
  }
  return (v.sections as NarrativeSection[]).every(s => s.blocks.every(b => b.kind === "diagram" ? diagrams.has(b.diagramId) : b.kind === "source" ? evidence.has(b.evidenceId) : true));
}

export function briefingIntent(input: { pullRequest?: { title: string; body?: string; linkedIssue?: unknown }; reviewerTask?: unknown }): string {
  const issue = record(input.pullRequest?.linkedIssue) ? input.pullRequest.linkedIssue : undefined;
  const task = record(input.reviewerTask) ? input.reviewerTask : undefined;
  return JSON.stringify({ pullRequest: input.pullRequest ? { title: input.pullRequest.title, body: input.pullRequest.body?.slice(0, 10000), linkedIssue: issue ? { title: issue.title, body: issue.body, acceptanceCriteria: issue.acceptanceCriteria } : undefined } : undefined, reviewerTask: task ? { body: task.body, acceptanceCriteria: task.acceptanceCriteria } : undefined }).slice(0, 24000);
}

export function normalizeElementSources(value: unknown): ElementSource[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  return value.slice(0, 80).flatMap(s => {
    if (!record(s) || !id(s.elementId) || seen.has(s.elementId) || !Array.isArray(s.anchors)) return [];
    seen.add(s.elementId);
    const anchors = s.anchors.slice(0, 8).filter(validAnchor).map(a => ({ path: a.path, side: a.side, startLine: a.startLine, endLine: a.endLine, quote: a.quote }));
    return anchors.length ? [{ elementId: s.elementId, anchors }] : [];
  });
}

export const BRIEFING_PROMPT = `Also return briefingProposal, a concise, outcome-first reading document. Schema: {title,sections:[{id,title,blocks:[{id,kind:"prose",text,basis:"stated"|"observed"|"inferred"}|{id,kind:"diagram",diagramId}|{id,kind:"example",text,language}|{id,kind:"source",evidenceId}]}],evidence:[{id,path,side:"old"|"new",startLine,endLine,quote}]}.
The title must make the concrete change understandable on its own: name what becomes possible, changes, or is prevented. Prefer "Show completed challenges on the profile" to "Reactive summary architecture". For internal changes, name the concrete technical outcome; do not invent a user-facing benefit or claim a guarantee the evidence does not establish. Do not use a generic topic or artifact list as the title.
Open with a short prose paragraph explaining the outcome and the relevant before-to-after difference. Establish why it matters using supplied author intent; when intent is absent, describe observed behavior and label any inferred rationale explicitly. Place a decisive diff in the opening section for code changes. Then follow how the implementation achieves that outcome, weaving a concrete scenario and design decisions into that same story where they clarify it. Finish with meaningful boundaries or tradeoffs. Choose section titles that advance the explanation, rather than categories of artifacts. Scale the story to the change; these are reading principles, not mandatory sections. Text is plain text, not Markdown; basis is metadata, not a repeated prose heading.
Weave short, exact source blocks into the explanation at the point they substantiate a claim. All implementation code is displayed as a unified before-and-after diff, derived from the captured comparison. Cite the decisive changed range on either side; the reader includes the corresponding replacement and surrounding context. Do not duplicate the same change as separate before and after blocks or author diff markers in the quote. For code changes, show the first useful diff early; do not hide all code in citations or the inspector. Prefer a complete small function or decisive branch, usually 3–12 lines. Use illustrative examples for inputs and outcomes, not standalone implementation code. Documentation-only changes can use documentary excerpts instead. Include evidence entries for every source block.
Choose diagrams by the question they answer: responsibility boundaries, request ordering, state transitions, data relationships, calls, or domain concepts. Introduce each diagram with the specific relationship it explains and connect it to the nearby code and the next narrative step. Supporting six diagram families does not mean using all six. Never append a diagram gallery, stack unrelated maps, or repeat the same explanation in multiple diagram types. A small change may need only a few paragraphs and one excerpt, with no diagram. No findings dashboard, review effort, checklist, question form, or explanation of the review UI in the story.
For each diagram used in the story, bind the components or steps supported by inspected source through elementSources, messageSources, or diagramSources below. Reuse the same focused excerpts as the surrounding narrative where appropriate. Nearby source blocks alone do not create diagram bindings. Keep external or otherwise unverified elements explicitly unbound; do not invent evidence to fill them in.
Limits: 12 sections, 60 blocks, 24000 text characters, 40 exact captured evidence excerpts, each at most 30 lines and 8000 characters. Use diagramId architecture-behavior, architecture-journey, sequence-{flow.id}, lifecycle-state-machine, dataflow-data-model, call-flow-{callFlow.id}, or domain-{model.id}, only for diagrams present in this outline. Architecture, stateDiagram and dataModel may include elementSources:[{elementId,anchors:[{path,side,startLine,endLine,quote}]}]. Use exact renderer IR element IDs supplied during regeneration; for new architecture components use their Mermaid node IDs. Never guess a relationship ID, code location, or match by label. Evidence unavailable is preferable to an invented binding. Existing sequence messageSources and call-flow old/new locations are reused. For lifecycle state elements use the state identifier; for data-model entities use data-{ENTITY}. For existing diagrams, briefingProposal may additionally include diagramSources:[{diagramId,elementId,anchors:[{path,side,startLine,endLine,quote}]}] using only supplied exact IDs. This can supply relationship evidence and separate implementation excerpts for domain concepts. Domain vocabulary evidence is documentary, never proof of runtime behavior.`;

/** Capture a saved document, including its exact diagram identities and source text. */
export async function buildBriefing(comparison: GitComparison, outline: TourOutline, intent = "", proposal: unknown = outline.briefingProposal): Promise<BriefingDocument> {
  const evidence: BriefingEvidence[] = [], cache = new Map<string, Promise<{ text: string; blob: string | null }>>();
  async function add(anchor: SequenceSourceAnchor, kind: "code" | "document" = "code", proposedId?: string): Promise<string | undefined> {
    if (!validAnchor(anchor)) return undefined;
    const identical = evidence.find(e => e.path === anchor.path && e.side === anchor.side && e.startLine === anchor.startLine && e.endLine === anchor.endLine && e.quote === anchor.quote && (!proposedId || e.id === proposedId));
    if (identical) return identical.id;
    if (evidence.length >= 40) return undefined;
    const e: BriefingEvidence = { id: proposedId ?? `e-${evidence.length + 1}`, kind, path: anchor.path, side: anchor.side, startLine: anchor.startLine, endLine: anchor.endLine, quote: anchor.quote, available: false };
    if (evidence.some(item => item.id === e.id)) e.id = `source-${hash(e).slice(0, 16)}`;
    evidence.push(e);
    try {
      const key = `${anchor.side}:${anchor.path}`;
      if (!cache.has(key)) cache.set(key, loadCapturedSource(comparison, anchor.side, anchor.path));
      const source = await cache.get(key)!;
      if (source.text.split(/\r?\n/).slice(anchor.startLine - 1, anchor.endLine).join("\n") !== anchor.quote) throw new Error("The proposed excerpt does not match the captured source.");
      if (!source.blob) throw new Error("Captured source is unavailable.");
      e.blob = source.blob; e.available = true;
    } catch { e.quote = "Source unavailable"; e.reason = "The source excerpt could not be verified against the captured Git tree."; }
    return e.id;
  }
  const authored = validBriefingProposal(proposal) ? proposal : undefined;
  for (const e of authored?.evidence ?? []) await add(e, /\.md$/i.test(e.path) ? "document" : "code", e.id);
  // Reserve evidence space for the reading path before capturing optional maps.
  let sections = authored ? structuredClone(authored.sections) : await overviewSections(outline, async anchor => {
    if (!Number.isSafeInteger(anchor.startLine) || anchor.startLine < 1 || !Number.isSafeInteger(anchor.endLine) || anchor.endLine < anchor.startLine) return undefined;
    const endLine = Math.min(anchor.endLine, anchor.startLine + 11);
    try {
      const key = `${anchor.side}:${anchor.path}`;
      if (!cache.has(key)) cache.set(key, loadCapturedSource(comparison, anchor.side, anchor.path));
      const source = await cache.get(key)!;
      const quote = source.text.split(/\r?\n/).slice(anchor.startLine - 1, endLine).join("\n");
      return await add({ ...anchor, endLine, quote }, /\.md$/i.test(anchor.path) ? "document" : "code");
    } catch { return undefined; }
  });
  const diagrams: BriefingDiagram[] = [];
  for (const candidate of archifyCandidates(outline)) {
    const flow = outline.flows.find(f => candidate.id === `sequence-${f.id}`);
    const model = outline.domainModels?.find(m => candidate.id === `domain-${m.id}`);
    const source = candidate.id === "architecture-behavior" ? outline.behaviorArchitecture : candidate.id === "architecture-journey" ? outline.architecture : candidate.type === "lifecycle" ? outline.stateDiagram : candidate.type === "dataflow" ? outline.dataModel : undefined;
    const family: BriefingFamily = model ? "domain" : flow ? "sequence" : candidate.type === "lifecycle" ? "lifecycle" : candidate.type === "dataflow" ? "data-model" : "architecture";
    const d: BriefingDiagram = { id: candidate.id, title: candidate.title, family, mermaid: flow?.mermaid ?? source?.mermaid, ir: structuredClone(candidate.ir), ...(flow?.outdated || (source && "outdated" in source && source.outdated) ? { outdated: true } : {}), elements: [] };
    d.nodeRoles = structuredClone(candidate.nodeRoles);
    d.domainDetails = structuredClone(candidate.domainDetails);
    const groups = family === "sequence" ? ["messages"] : family === "lifecycle" ? ["states", "transitions"] : family === "data-model" ? ["nodes", "flows"] : ["components", "connections"];
    for (const group of groups) for (const [index, value] of ((candidate.ir[group] ?? []) as Record<string, unknown>[]).entries()) {
      if (!id(value.id)) continue;
      const label = String(value.label ?? value.id);
      const element: BriefingElement = { id: value.id, label, kind: group, evidenceIds: [] };
      let anchors = flow?.messageSources?.find(m => m.message === index + 1 && m.label === label)?.anchors ?? normalizeElementSources(source?.elementSources)?.find(s => s.elementId === value.id)?.anchors ?? [];
      if (model) {
        const documentary = group === "components" ? model.concepts.find(c => c.id === value.id)?.source : model.relationships[index]?.source;
        anchors = documentary ? [{ path: documentary.path, side: "new", startLine: documentary.line, endLine: documentary.line + documentary.quote.split("\n").length - 1, quote: documentary.quote }] : [];
      }
      for (const a of anchors.slice(0, 8)) { const key = await add(a, model ? "document" : "code"); if (key) element.evidenceIds.push(key); }
      d.elements.push(element);
    }
    diagrams.push(d);
  }
  for (const flow of outline.callFlows ?? []) {
    const d: BriefingDiagram = { id: `call-flow-${flow.id}`, family: "call-flow", title: flow.title, ...(flow.outdated ? { outdated: true } : {}), ir: structuredClone(flow) as unknown as Record<string, unknown>, elements: [] };
    for (const item of [...flow.nodes, ...flow.edges]) {
      const e: BriefingElement = { id: item.id, label: item.label || item.id, kind: "from" in item ? "call site" : "symbol", evidenceIds: [] };
      const locations = "from" in item ? [item.oldCallSite, item.newCallSite] : [item.oldLocation, item.newLocation];
      for (const location of locations) {
        if (!location) continue;
        try {
          const source = await loadCapturedSource(comparison, location.side, location.path), quote = source.text.split(/\r?\n/)[location.line - 1];
          if (!quote?.trim()) continue;
          const key = await add({ path: location.path, side: location.side, startLine: location.line, endLine: location.line, quote }); if (key) e.evidenceIds.push(key);
        } catch { /* Keep the element with an explicit unavailable card. */ }
      }
      d.elements.push(e);
    }
    diagrams.push(d);
  }
  for (const binding of authored?.diagramSources ?? []) {
    const element = diagrams.find(d => d.id === binding.diagramId)?.elements.find(e => e.id === binding.elementId);
    if (!element) continue;
    for (const source of binding.anchors) {
      if (element.evidenceIds.length >= 8) break;
      const key = await add(source, "code");
      if (key && !element.evidenceIds.includes(key)) element.evidenceIds.push(key);
    }
  }
  // Invalid optional references cannot invalidate the rest of a tour/document.
  sections = sections.map(s => ({ ...s, blocks: s.blocks.map(b => b.kind === "diagram" && !diagrams.some(d => d.id === b.diagramId) || b.kind === "source" && !evidence.some(e => e.id === b.evidenceId) ? { id: b.id, kind: "prose" as const, text: "The referenced evidence is unavailable in this snapshot." } : b) }));
  const document: BriefingDocument = { version: 1, id: crypto.randomUUID(), title: authored?.title ?? outline.title.slice(0, 500), createdAt: new Date().toISOString(), fingerprint: briefingFingerprint(comparison, intent), comparisonId: diffSourceIdentity(comparison), mode: authored ? "authored" : "overview", ...(!authored && (outline.phases.some(p => p.steps.some(s => s.outdated)) || diagrams.some(d => d.outdated)) ? { outdated: true } : {}), sections, diagrams, evidence, intent };
  await captureBriefingDiffs(comparison, document, cache);
  await captureBriefingDiagrams(document, outline.archifyArtifacts);
  return document;
}
async function overviewSections(outline: TourOutline, capture: (anchor: TourAnchor) => Promise<string | undefined>): Promise<NarrativeSection[]> {
  const sections: NarrativeSection[] = [{ id: "summary", title: "What changes", blocks: [{ id: "summary-text", kind: "prose", text: outline.summary.slice(0, 4000) }] }];
  for (const [i, phase] of outline.phases.slice(0, 6).entries()) {
    const blocks: NarrativeBlock[] = [{ id: `phase-text-${i}`, kind: "prose", text: phase.summary.slice(0, 2000), basis: "observed" }];
    for (const step of phase.steps) {
      if (step.outdated) continue;
      const evidenceId = await capture(step.anchor);
      if (evidenceId) { blocks.push({ id: `phase-source-${i}`, kind: "source", evidenceId }); break; }
    }
    sections.push({ id: `phase-${i}`, title: phase.title.slice(0, 200), blocks });
  }
  // Saved tours provide an order and source anchors, not authored transitions
  // between diagrams. Keep the basic overview short until explicit regeneration.
  return sections;
}
export function resolveBriefingQuestion(document: BriefingDocument | undefined, value: unknown): BriefingQuestionContext {
  if (!document || !record(value) || value.documentId !== document.id || !Array.isArray(value.items) || !value.items.length || value.items.length > 8) throw new ReviewError("Select up to eight items from the current Briefing.");
  let chars = 0; const keys = new Set<string>();
  const items = value.items.map((input: unknown) => {
    if (!record(input) || !id(input.blockId) || (input.elementId !== undefined && !id(input.elementId))) throw new ReviewError("Invalid Briefing selection.");
    const block = document.sections.flatMap(s => s.blocks).find(b => b.id === input.blockId);
    if (!block) throw new ReviewError("The selected passage is no longer available.");
    const diagram = block.kind === "diagram" ? document.diagrams.find(d => d.id === block.diagramId) : undefined;
    const element = input.elementId ? diagram?.elements.find(e => e.id === input.elementId) : undefined;
    if (input.elementId && !element) throw new ReviewError("The selected diagram element is unavailable.");
    const nativeElements = diagram ? Object.values(diagram.ir).flatMap(value => Array.isArray(value) ? value.filter(record) : []) : [];
    const nativeElement = element ? nativeElements.find(e => e.id === element.id) : undefined;
    let text = diagram ? element ? `${diagram.family}${diagram.outdated ? " (saved diagram; source changed)" : ""}: ${diagram.title}\n${element.kind} [${element.id}]: ${element.label}${nativeElement ? `\nSaved diagram element: ${JSON.stringify(nativeElement)}` : ""}` : `${diagram.family}${diagram.outdated ? " (saved diagram; source changed)" : ""}: ${diagram.title}\n${diagram.mermaid ?? JSON.stringify(diagram.ir)}` : briefingBlockText(block);
    if (input.quote !== undefined) {
      if (!str(input.quote, 8000) || !text.includes(input.quote)) throw new ReviewError("The quotation must match the saved passage exactly.");
      text = input.quote;
    }
    if (element?.sourceReview) text += `\nSource inspection (${element.sourceReview.status}): ${element.sourceReview.reason}`;
    const evidenceIds = element?.evidenceIds ?? (block.kind === "source" ? [block.evidenceId] : []);
    const sources = document.evidence.filter(e => evidenceIds.includes(e.id));
    if (block.kind === "source") text = sources.map(e => `${e.path}:${e.startLine}\n${briefingEvidenceText(e)}`).join("\n");
    chars += text.length + (block.kind === "source" ? 0 : sources.reduce((n, e) => n + briefingEvidenceText(e).length, 0));
    if (chars > 8000) throw new ReviewError("Selected Briefing context exceeds 8,000 characters. Remove an item or select a shorter passage.");
    const key = JSON.stringify([block.id, input.elementId, input.quote]); if (keys.has(key)) throw new ReviewError("Duplicate Briefing selection."); keys.add(key);
    return { blockId: block.id, ...(element ? { elementId: element.id } : {}), ...(input.quote ? { quote: input.quote } : {}), label: element?.label ?? diagram?.title ?? text.slice(0, 100), text, evidence: structuredClone(sources) };
  });
  return { documentId: document.id, fingerprint: document.fingerprint, title: document.title, items };
}
export function validBriefingQuestionContext(v: unknown): v is BriefingQuestionContext {
  return record(v) && id(v.documentId) && str(v.fingerprint) && str(v.title, 500) && Array.isArray(v.items) && v.items.length <= 8 && v.items.every(i => record(i) && id(i.blockId) && str(i.label, 8000) && typeof i.text === "string" && i.text.length <= 8000 && Array.isArray(i.evidence) && i.evidence.length <= 8 && i.evidence.every((e: any) => record(e) && (e.diff === undefined || validBriefingDiff(e.diff)) && validAnchor(e))) && JSON.stringify(v).length < 100000;
}
