import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TourAgent } from "../src/agent.ts";
import { buildBriefing, resolveBriefingQuestion, validBriefingDocument, type BriefingDocument } from "../src/briefing.ts";
import { briefingMarkdown } from "../src/briefing-export.ts";
import { BriefingSourceValidationError, captureBriefingSourceDecisions, missingBriefingSources } from "../src/briefing-sources.ts";
import { loadComparison } from "../src/git.ts";
import { loadPersistedSession, savePersistedSession } from "../src/store.ts";
import { prepareTestFixture } from "../src/test-fixture.ts";
import { ReviewSession } from "../src/session.ts";
import type { GitComparison, PersistedReviewSession } from "../src/types.ts";

let root: string, fixture: Awaited<ReturnType<typeof prepareTestFixture>>, saved: PersistedReviewSession, comparison: GitComparison, document: BriefingDocument;
const diagramId = "architecture-journey";
let callId: string, externalIds: string[];
const callAnchor = { path: "src/receipt.ts", side: "new" as const, startLine: 4, endLine: 4, quote: "  const amount = total(items, discount);" };
const proposal = { title: "Show a discounted receipt", sections: [{ id: "flow", title: "Calculate, then format", blocks: [{ id: "components", kind: "diagram" as const, diagramId }] }] };
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "briefing-sources-"));
  fixture = await prepareTestFixture({ root: join(root, "fixture") });
  saved = await loadPersistedSession(fixture.stateFile);
  comparison = await loadComparison(fixture.repository, saved.base);
  const outline = structuredClone(saved.outline!);
  outline.architecture!.elementSources = outline.architecture!.elementSources!.filter(source => ["cart", "receipt"].includes(source.elementId));
  document = await buildBriefing(comparison, outline, "", proposal);
  const diagram = document.diagrams.find(d => d.id === diagramId)!;
  callId = (diagram.ir.connections as Array<{ id: string; from: string; to: string }>).find(edge => edge.from === "receipt" && edge.to === "cart")!.id;
  externalIds = missingBriefingSources(document)[0]!.elements.map(element => element.id).filter(id => id !== callId);
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });
const decisions = () => [
  ...externalIds.map(elementId => ({ elementId, status: "external", reason: "The checkout caller is outside the captured sample; its implementation is not included." })),
  { elementId: callId, status: "bound", reason: "The receipt calls total with its items and optional discount.", anchors: [callAnchor] },
];
const link = (value: unknown, doc = document) => captureBriefingSourceDecisions(JSON.stringify(value), doc, diagramId, [...externalIds, callId], comparison);

test("only missing elements in the story are checked; bindings reuse exact evidence and retain the diagram", async () => {
  expect(missingBriefingSources(document).map(target => target.diagram.id)).toEqual([diagramId]);
  const original = structuredClone(document);
  const linked = await link({ decisions: decisions() });
  expect(document).toEqual(original);
  expect(validBriefingDocument(linked)).toBe(true);
  const diagram = linked.diagrams.find(d => d.id === diagramId)!;
  expect(diagram.ir).toEqual(original.diagrams.find(d => d.id === diagramId)!.ir);
  const call = diagram.elements.find(element => element.id === callId)!;
  const source = linked.evidence.find(e => e.id === call.evidenceIds[0])!;
  expect(source).toMatchObject({ ...callAnchor, available: true, diff: { available: true } });
  expect(linked.evidence.length).toBe(original.evidence.length);
  expect(call.sourceReview?.status).toBe("bound");
  for (const id of externalIds) expect(diagram.elements.find(e => e.id === id)).toMatchObject({ evidenceIds: [], sourceReview: { status: "external" } });
  expect(briefingMarkdown(linked)).toContain("checkout caller is outside the captured sample");
  expect(resolveBriefingQuestion(linked, { documentId: linked.id, items: [{ blockId: "components", elementId: externalIds[0] }] }).items[0]!.text).toContain("Source inspection (external)");
});

test("source linking rejects missing, repeated, unknown and label-only identities, invalid quotes and unsafe paths", async () => {
  const bound = decisions().at(-1)!;
  for (const value of [
    { decisions: decisions().slice(1) },
    { decisions: [...decisions().slice(0, -1), decisions()[0]] },
    { decisions: [...decisions().slice(0, -1), { ...bound, elementId: "calculates amount with" }] },
    { decisions: [...decisions().slice(0, -1), { ...bound, anchors: [] }] },
    { decisions: [...decisions().slice(0, -1), { ...bound, anchors: [{ ...callAnchor, quote: "invented();" }] }] },
    { decisions: [...decisions().slice(0, -1), { ...bound, anchors: [{ ...callAnchor, path: "../outside.ts" }] }] },
    { decisions: [...decisions().slice(0, -1), { ...bound, anchors: [{ ...callAnchor, startLine: 6, endLine: 8, quote: "}\n" }] }] },
    { decisions: [...decisions().slice(0, -1), { ...bound, status: "external" }] },
  ]) await expect(link(value)).rejects.toBeInstanceOf(BriefingSourceValidationError);
  await expect(link({ decisions: decisions() }, { ...document, comparisonId: "0".repeat(64) })).rejects.toThrow("different captured comparison");
});

test("verification uses captured source despite worktree edits and preserves old-side anchors", async () => {
  const path = join(fixture.repository, "src/receipt.ts"), original = await readFile(path, "utf8");
  try {
    await writeFile(path, original.replace(callAnchor.quote, "  const amount = 0;"));
    expect((await link({ decisions: decisions() })).evidence.some(e => e.quote === callAnchor.quote && e.available)).toBe(true);
    const removed = { path: "src/cart.ts", side: "old", startLine: 6, endLine: 6, quote: "export function total(items: Item[]): number {" };
    const linked = await link({ decisions: [...decisions().slice(0, -1), { ...decisions().at(-1), anchors: [removed] }] });
    expect(linked.evidence.find(e => e.side === "old" && e.quote === removed.quote)).toMatchObject({ available: true, diff: { available: true } });
  } finally { await writeFile(path, original); }
});

test("a full citation budget reports the limit without dropping the element or inventing a binding", async () => {
  const full = structuredClone(document);
  while (full.evidence.length < 40) full.evidence.push({ ...full.evidence[0]!, id: `filler-${full.evidence.length}` });
  const anchor = { ...callAnchor, startLine: 3, endLine: 4, quote: "export function receipt(items: Item[], discount?: Discount): string {\n  const amount = total(items, discount);" };
  const linked = await link({ decisions: [...decisions().slice(0, -1), { ...decisions().at(-1), anchors: [anchor] }] }, full);
  expect(linked.evidence).toHaveLength(40);
  expect(linked.diagrams.find(d => d.id === diagramId)!.elements.find(e => e.id === callId)).toMatchObject({ evidenceIds: [], sourceReview: { status: "limit" } });
});

test("unchanged supporting documents can supply a domain relationship", async () => {
  const doc = structuredClone(document);
  const domain = doc.diagrams.find(diagram => diagram.family === "domain")!;
  const relationship = domain.elements.find(element => element.kind === "connections")!;
  const source = doc.evidence.find(evidence => evidence.id === relationship.evidenceIds[0])!;
  expect(comparison.files.some(file => file.path === source.path)).toBe(false);
  relationship.evidenceIds = [];
  doc.evidence = doc.evidence.filter(evidence => evidence.id !== source.id);
  // Other elements may share this glossary entry; retain the remaining links.
  for (const diagram of doc.diagrams) for (const element of diagram.elements) element.evidenceIds = element.evidenceIds.filter(id => id !== source.id);
  const linked = await captureBriefingSourceDecisions(JSON.stringify({ decisions: [{
    elementId: relationship.id, status: "bound", reason: "The glossary defines the relationship between receipt and cart.",
    anchors: [{ path: source.path, side: source.side, startLine: source.startLine, endLine: source.endLine, quote: source.quote }],
  }] }), doc, domain.id, [relationship.id], comparison);
  expect(linked.evidence.find(evidence => evidence.quote === source.quote)).toMatchObject({ available: true, kind: "document" });
});

test("the same source-linking pass covers all six families and preserves their exact IR", async () => {
  const doc = structuredClone(document);
  doc.sections = doc.diagrams.map((diagram, index) => ({ id: `s-${index}`, title: diagram.title, blocks: [{ id: `b-${index}`, kind: "diagram", diagramId: diagram.id }] }));
  for (const diagram of doc.diagrams) for (const element of diagram.elements) element.evidenceIds = [];
  const inspected = new Set<string>();
  const agent = new TourAgent(fixture.repository, { adapterId: "attached", modelId: "test" }, { async send(prompt) {
    const { diagram } = JSON.parse(prompt.split("Exact diagram and existing source evidence: ")[1]!.split("\nRequested element IDs:")[0]!);
    const ids = JSON.parse(prompt.split("Requested element IDs: ")[1]!) as string[];
    inspected.add(diagram.family);
    return JSON.stringify({ decisions: ids.map(elementId => ({ elementId, status: "unavailable", reason: "This test response supplies no supporting source; no binding can be established." })) });
  } });
  const linked = await agent.bindBriefingSources(comparison, doc);
  expect([...inspected].sort()).toEqual(["architecture", "call-flow", "data-model", "domain", "lifecycle", "sequence"]);
  expect(linked.value.diagrams.map(diagram => diagram.ir)).toEqual(doc.diagrams.map(diagram => diagram.ir));
  expect(linked.value.diagrams.every(diagram => diagram.elements.every(element => element.sourceReview?.status === "unavailable"))).toBe(true);
});

test("the agent receives exact endpoints and retries asynchronous source validation before returning", async () => {
  const prompts: string[] = [];
  const withHtml = structuredClone(document);
  withHtml.diagrams.find(d => d.id === diagramId)!.archifyHtml = "<html>private-renderer-payload</html>";
  const agent = new TourAgent(fixture.repository, { adapterId: "attached", modelId: "test" }, { async send(prompt) {
    prompts.push(prompt);
    const result = decisions();
    if (prompts.length === 1) result[result.length - 1] = { ...result.at(-1)!, anchors: [{ ...callAnchor, quote: "wrong" }] };
    return { message: JSON.stringify({ decisions: result }), receipt: `link-${prompts.length}` };
  } });
  const linked = await agent.bindBriefingSources(comparison, withHtml);
  expect(prompts).toHaveLength(2);
  expect(prompts[0]).toContain(callId);
  expect(prompts[0]).toContain('"from":"receipt","to":"cart"');
  expect(prompts[0]).toContain(comparison.sourceTree!);
  expect(prompts[0]).not.toContain("private-renderer-payload");
  expect(prompts[1]).toContain("source quote does not match");
  expect(linked.receipts).toEqual(["link-1", "link-2"]);
  const prose = { ...document, sections: [{ id: "s", title: "Text", blocks: [{ id: "p", kind: "prose" as const, text: "No diagram needed." }] }] };
  await agent.bindBriefingSources(comparison, prose);
  expect(prompts).toHaveLength(2);
});

test("a malformed source-link pass fails after two repairs instead of returning unchecked links", async () => {
  let attempts = 0;
  const agent = new TourAgent(fixture.repository, { adapterId: "attached", modelId: "test" }, { async send() { attempts++; return '{"decisions":[]}'; } });
  await expect(agent.bindBriefingSources(comparison, document)).rejects.toBeInstanceOf(BriefingSourceValidationError);
  expect(attempts).toBe(3);
});

test("new tours complete diagram source links before saving their first Briefing", async () => {
  const initial = structuredClone(saved);
  delete initial.outline;
  initial.currentStepIndex = -1;
  initial.selection = { adapterId: "attached", modelId: "test", includeFindings: false, includeFlows: false };
  initial.bridgeToken = "initial-source-links"; initial.bridgeSequence = 0;
  const stateFile = join(root, "initial.json"); await savePersistedSession(stateFile, initial);
  const session = await ReviewSession.create(fixture.repository, undefined, { stateFile, resume: true, agentAdapters: [] });
  try {
    const generation = session.startTour();
    const first = (await session.bridge!.eventsAfter(0, 3000)).find(event => event.type === "agent.prompt");
    if (!first || first.type !== "agent.prompt") throw new Error("Missing planning request");
    const outline = structuredClone(saved.outline!);
    delete outline.briefing;
    delete outline.dryRunPlans;
    outline.briefingProposal = proposal;
    outline.phases[0]!.fileChanges.push({ path: "tests/cart.test.ts", summary: "Adds a receipt assertion that supplies a fractional discount and checks two decimal places." });
    outline.architecture!.elementSources = outline.architecture!.elementSources!.filter(source => ["receipt", "cart"].includes(source.elementId));
    await session.bridge!.respond(first.id, JSON.stringify(outline)); await session.bridge!.ack(first.id);
    const linking = (await session.bridge!.eventsAfter(first.sequence, 3000)).find(event => event.type === "agent.prompt");
    if (!linking || linking.type !== "agent.prompt") throw new Error("Missing source linking request");
    expect(linking.prompt).toContain("attaching inspected source");
    await session.bridge!.respond(linking.id, JSON.stringify({ decisions: decisions() })); await session.bridge!.ack(linking.id);
    await generation;
    const persisted = await loadPersistedSession(stateFile);
    expect(persisted.outline!.briefing!.diagrams.find(d => d.id === diagramId)!.elements.find(e => e.id === callId)!.sourceReview?.status).toBe("bound");
    expect(session.currentStepIndex).toBe(0);
  } finally { await session.dispose(); }
});

test("failed source inspection during regeneration preserves the saved Briefing and tour", async () => {
  const initial = structuredClone(saved);
  initial.selection = { adapterId: "attached", modelId: "test" };
  initial.bridgeToken = "failed-source-links"; initial.bridgeSequence = 0;
  const stateFile = join(root, "failed.json"); await savePersistedSession(stateFile, initial);
  const session = await ReviewSession.create(fixture.repository, undefined, { stateFile, resume: true, agentAdapters: [] });
  try {
    const original = structuredClone(session.outline), step = session.currentStepIndex;
    const regeneration = session.regenerateBriefing().then(() => null, error => error);
    const first = (await session.bridge!.eventsAfter(0, 3000)).find(event => event.type === "agent.prompt");
    if (!first || first.type !== "agent.prompt") throw new Error("Missing regeneration request");
    await session.bridge!.respond(first.id, JSON.stringify(proposal)); await session.bridge!.ack(first.id);
    let sequence = first.sequence;
    for (let attempt = 0; attempt < 3; attempt++) {
      const linking = (await session.bridge!.eventsAfter(sequence, 3000)).find(event => event.type === "agent.prompt");
      if (!linking || linking.type !== "agent.prompt") throw new Error("Missing source linking request");
      expect(linking.prompt).toContain("attaching inspected source");
      sequence = linking.sequence;
      await session.bridge!.respond(linking.id, '{"decisions":[]}'); await session.bridge!.ack(linking.id);
    }
    expect(await regeneration).toBeInstanceOf(BriefingSourceValidationError);
    expect(session.outline).toEqual(original);
    expect(session.currentStepIndex).toBe(step);
    expect((await loadPersistedSession(stateFile)).outline!.briefing).toEqual(original!.briefing);
  } finally { await session.dispose(); }
});
