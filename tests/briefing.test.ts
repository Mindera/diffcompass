import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareTestFixture } from "../src/test-fixture.ts";
import { loadComparison } from "../src/git.ts";
import { loadPersistedSession, savePersistedSession } from "../src/store.ts";
import { buildBriefing, briefingFingerprint, briefingIntent, resolveBriefingQuestion, validBriefingDocument, validBriefingProposal } from "../src/briefing.ts";
import { ReviewSession } from "../src/session.ts";
import { briefingMarkdown, withBriefingExport } from "../src/briefing-export.ts";
import { exportReview } from "../src/export.ts";
import type { GitComparison, PersistedReviewSession } from "../src/types.ts";
let root: string, fixture: Awaited<ReturnType<typeof prepareTestFixture>>, persisted: PersistedReviewSession, comparison: GitComparison;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "briefing-test-"));
  fixture = await prepareTestFixture({ root: join(root, "fixture") });
  persisted = await loadPersistedSession(fixture.stateFile);
  comparison = await loadComparison(fixture.repository, persisted.base);
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

test("saved Briefing covers six diagram families and validates component evidence independently from message evidence", () => {
  const doc = persisted.outline!.briefing!;
  expect(validBriefingDocument(doc)).toBe(true);
  expect(new Set(doc.diagrams.map(d => d.family)).size).toBe(6);
  const component = doc.diagrams.find(d => d.id === "architecture-journey")!.elements.find(e => e.id === "receipt")!;
  const source = doc.evidence.find(e => e.id === component.evidenceIds[0])!;
  expect(source.available).toBe(true);
  expect(source.startLine).toBe(3);
  expect(source.endLine).toBe(6);
  expect(source.quote).toContain("export function receipt");
  const flow = doc.diagrams.find(d => d.family === "sequence")!;
  expect(flow.elements).toHaveLength(4);
  expect(flow.elements[0]!.evidenceIds).toHaveLength(0);
  expect(flow.elements[2]!.evidenceIds).toHaveLength(2);
  expect(doc.diagrams.find(d => d.family === "domain")!.elements.every(e => e.evidenceIds.every(id => doc.evidence.find(e => e.id === id)?.kind === "document"))).toBe(true);
});

test("unverified excerpts never become quoted code and source capture ignores workspace drift", async () => {
  const outline = structuredClone(persisted.outline!);
  outline.architecture!.elementSources = [{ elementId: "receipt", anchors: [{ path: "src/receipt.ts", side: "new", startLine: 3, endLine: 3, quote: "invented code" }] }];
  const actual = await readFile(join(fixture.repository, "src/receipt.ts"), "utf8");
  try {
    await writeFile(join(fixture.repository, "src/receipt.ts"), "workspace drift");
    const doc = await buildBriefing(comparison, outline);
    const bad = doc.evidence.find(e => !e.available)!;
    expect(bad.quote).not.toContain("invented code");
    expect(bad.reason).toContain("could not be verified");
    expect(doc.evidence.some(e => e.available && e.quote.includes("export function receipt"))).toBe(true);
    expect(doc.evidence.some(e => e.quote.includes("workspace drift"))).toBe(false);
  } finally { await writeFile(join(fixture.repository, "src/receipt.ts"), actual); }
});

test("basic overview follows tour phases with captured code and does not append a diagram gallery", async () => {
  const outline = structuredClone(persisted.outline!);
  delete outline.briefingProposal;
  const doc = await buildBriefing(comparison, outline);
  expect(doc.mode).toBe("overview");
  expect(validBriefingDocument(doc)).toBe(true);
  expect(doc.sections.slice(1).map(s => s.title)).toEqual(outline.phases.map(p => p.title));
  expect(doc.sections.flatMap(s => s.blocks).some(b => b.kind === "diagram")).toBe(false);
  const excerpts = doc.sections.flatMap(s => s.blocks).flatMap(b => b.kind === "source" ? [doc.evidence.find(e => e.id === b.evidenceId)!] : []);
  expect(excerpts).toHaveLength(2);
  expect(excerpts.every(e => e.available && e.endLine - e.startLine < 12)).toBe(true);
  expect(excerpts[0]!.quote).toContain("export function subtotal");
  expect(excerpts[1]!.quote).toContain("export function receipt");
  for (const step of outline.phases[0]!.steps) step.outdated = true;
  const stale = await buildBriefing(comparison, outline);
  expect(stale.outdated).toBe(true);
  expect(stale.sections[1]!.blocks.some(b => b.kind === "source")).toBe(false);
});

test("Markdown keeps implementation excerpts at their authored position in the story", () => {
  const doc = persisted.outline!.briefing!, markdown = briefingMarkdown(doc);
  const firstCode = markdown.indexOf("export function subtotal"), nextSection = markdown.indexOf("### Apply the discount once");
  expect(firstCode).toBeGreaterThan(markdown.indexOf("### From a cart total to a discounted receipt"));
  expect(firstCode).toBeLessThan(nextSection);
  const unavailable = structuredClone(doc);
  unavailable.evidence.find(e => e.id === "subtotal-body")!.available = false;
  const story = briefingMarkdown(unavailable).split("### Briefing evidence")[0]!;
  expect(story).not.toContain("export function subtotal");
  expect(story).toContain("Source unavailable");
});

test("additional diagram evidence uses exact element IDs and keeps domain code separate from glossary evidence", async () => {
  const base = persisted.outline!.briefing!, domain = base.diagrams.find(d => d.family === "domain")!;
  const proposal = { title: base.title, sections: base.sections, evidence: [], diagramSources: [
    { diagramId: domain.id, elementId: domain.elements[0]!.id, anchors: [{ path: "src/receipt.ts", side: "new" as const, startLine: 4, endLine: 4, quote: "  const amount = total(items, discount);" }] },
    { diagramId: domain.id, elementId: "similar-label-is-not-an-id", anchors: [{ path: "src/receipt.ts", side: "new" as const, startLine: 4, endLine: 4, quote: "  const amount = total(items, discount);" }] },
  ] };
  const document = await buildBriefing(comparison, persisted.outline!, "", proposal);
  const concept = document.diagrams.find(d => d.id === domain.id)!.elements[0]!;
  expect(concept.id).toBe(domain.elements[0]!.id);
  expect(concept.evidenceIds.map(id => document.evidence.find(e => e.id === id)!.kind)).toEqual(["document", "code"]);
  expect(document.diagrams.flatMap(d => d.elements).some(e => e.id === "similar-label-is-not-an-id")).toBe(false);
});

test("selection validates exact quotation, stable IDs, count and total context budget", () => {
  const doc = persisted.outline!.briefing!;
  const selected = resolveBriefingQuestion(doc, { documentId: doc.id, items: [{ blockId: "intent-text", quote: "fractional percentage" }, { blockId: "components", elementId: "receipt" }] });
  expect(selected.items[0]!.text).toBe("fractional percentage");
  expect(selected.items[1]!.evidence[0]!.quote).toContain("export function receipt");
  for (const item of [{ blockId: "missing" }, { blockId: "intent-text", quote: "invented rationale" }, { blockId: "components", elementId: "nearby-file" }]) expect(() => resolveBriefingQuestion(doc, { documentId: doc.id, items: [item] })).toThrow();
  expect(() => resolveBriefingQuestion(doc, { documentId: "old-document", items: [{ blockId: "intent-text" }] })).toThrow();
  expect(() => resolveBriefingQuestion(doc, { documentId: doc.id, items: Array(9).fill({ blockId: "intent-text" }) })).toThrow();
  const large = structuredClone(doc);
  large.sections[0]!.blocks = [{ id: "a", kind: "prose", text: "a".repeat(5000) }, { id: "b", kind: "prose", text: "b".repeat(5000) }];
  expect(() => resolveBriefingQuestion(large, { documentId: large.id, items: [{ blockId: "a" }, { blockId: "b" }] })).toThrow("8,000");
});

test("contract rejects oversized or duplicate documents and restores a valid tour without malformed optional Briefing", async () => {
  const doc = structuredClone(persisted.outline!.briefing!);
  doc.sections[0]!.blocks.push(doc.sections[0]!.blocks[0]!);
  expect(validBriefingDocument(doc)).toBe(false);
  expect(validBriefingProposal({ title: "Too large", sections: Array(13).fill({ id: "s", title: "s", blocks: [] }) })).toBe(false);
  const saved = structuredClone(persisted); saved.outline!.briefing = doc;
  const path = join(root, "invalid-briefing.json"); await savePersistedSession(path, saved);
  const resumed = await loadPersistedSession(path);
  expect(resumed.outline!.title).toBe(persisted.outline!.title);
  expect(resumed.outline!.briefing).toBeUndefined();
});

test("freshness responds to source and stated intent, not assessment timestamps or tour progress", () => {
  const intent = briefingIntent({ pullRequest: persisted.pullRequest, reviewerTask: persisted.pullRequest?.reviewerTask });
  const changed = structuredClone(persisted.pullRequest!);
  changed.checks = []; if (changed.reviewerTask) changed.reviewerTask.updatedAt = "tomorrow";
  expect(briefingIntent({ pullRequest: changed, reviewerTask: changed.reviewerTask })).toBe(intent);
  expect(briefingFingerprint({ ...comparison, sourceTree: "a".repeat(40) }, intent)).not.toBe(briefingFingerprint(comparison, intent));
  changed.title = "Different intent";
  expect(briefingIntent({ pullRequest: changed, reviewerTask: changed.reviewerTask })).not.toBe(intent);
});

test("offline reader is inserted after bundled scripts containing HTML boundary strings", () => {
  const bundled = '<html><body><nav class="tabs"></nav><script>const template = "</body>";</script></body></html>';
  const exported = withBriefingExport(bundled, persisted.outline!.briefing!, comparison);
  expect(exported).toContain('<script>const template = "</body>";</script>');
  expect(exported.indexOf('id="export-briefing"')).toBeGreaterThan(exported.indexOf('</script>'));
  expect(exported.endsWith('</body></html>')).toBe(true);
});

test("Briefing questions persist frozen evidence and follow-ups keep it after regeneration without inheriting a stop", async () => {
  const saved = structuredClone(persisted);
  saved.bridgeToken = "briefing-test-bridge"; saved.bridgeSequence = 0;
  saved.messages = []; saved.selection = { adapterId: "attached", modelId: "current-session" };
  const stateFile = join(root, "conversation.json"); await savePersistedSession(stateFile, saved);
  const session = await ReviewSession.create(fixture.repository, undefined, { stateFile, resume: true, agentAdapters: [] });
  try {
    const request = { documentId: session.outline!.briefing!.id, items: [{ blockId: "components", elementId: "receipt" }] };
    const asking = session.ask("Why this boundary?", undefined, { stepId: null, briefingContext: request });
    const event = (await session.bridge!.eventsAfter(0, 1000)).find(e => e.type === "agent.prompt");
    if (!event || event.type !== "agent.prompt") throw new Error("Missing question prompt");
    expect(event.prompt).toContain("Frozen Briefing context"); expect(event.prompt).not.toContain("Current tour step:");
    await session.bridge!.respond(event.id, "The formatter owns presentation."); await session.bridge!.ack(event.id); await asking;
    const original = session.messages[0]!;
    expect(original.stepId).toBeUndefined(); expect(original.briefingContext?.items[0]?.evidence[0]?.quote).toContain("export function receipt");
    session.outline!.briefing = { ...session.outline!.briefing!, id: crypto.randomUUID(), title: "Regenerated" };
    session.currentStepIndex = 1;
    const followup = session.ask("And the arithmetic?", undefined, { threadId: original.id });
    const next = (await session.bridge!.eventsAfter(event.sequence, 1000)).find(e => e.type === "agent.prompt");
    if (!next || next.type !== "agent.prompt") throw new Error("Missing followup prompt");
    expect(next.prompt).toContain(original.briefingContext!.documentId); expect(next.prompt).not.toContain("Current tour step:");
    await session.bridge!.respond(next.id, "Arithmetic remains with the cart."); await session.bridge!.ack(next.id); await followup;
    expect((await loadPersistedSession(stateFile)).messages[0]!.briefingContext).toEqual(original.briefingContext);
    await expect(session.ask("Retarget", undefined, { threadId: original.id, briefingContext: request })).rejects.toThrow("original Briefing context");
    const md = exportReview(session, "markdown").content, html = exportReview(session, "html").content;
    expect(md).toContain("#briefing-evidence-receipt-body"); expect(md).toContain("Stated intent");
    expect(html).toContain('id="export-briefing-tab"'); expect(html).toContain("createBriefingReader"); expect(html).toContain("export function receipt");
  } finally { await session.dispose(); }
});

test("explicit regeneration replaces only the Briefing and keeps tour progress and review decisions", async () => {
  const saved = structuredClone(persisted);
  saved.bridgeToken = "briefing-regenerate-bridge"; saved.bridgeSequence = 0;
  saved.selection = { adapterId: "attached", modelId: "current-session" };
  const stateFile = join(root, "regenerate.json"); await savePersistedSession(stateFile, saved);
  const session = await ReviewSession.create(fixture.repository, undefined, { stateFile, resume: true, agentAdapters: [] });
  try {
    const oldId = session.outline!.briefing!.id, phases = structuredClone(session.outline!.phases), step = session.currentStepIndex;
    const reviewed = [...session.reviewedFiles], comments = structuredClone(session.comments);
    const regeneration = session.regenerateBriefing();
    const event = (await session.bridge!.eventsAfter(0, 3000)).find(e => e.type === "agent.prompt");
    if (!event || event.type !== "agent.prompt") throw new Error("Missing regeneration prompt");
    expect(event.prompt).toContain("Return only the briefingProposal object itself");
    expect(event.prompt).toContain("exact element IDs");
    await session.bridge!.respond(event.id, JSON.stringify({ title: "Refined narrative", sections: [{ id: "summary", title: "What changes", blocks: [{ id: "text", kind: "prose", text: "A focused revision of the reading document.", basis: "observed" }] }] }));
    await session.bridge!.ack(event.id); await regeneration;
    expect(session.outline!.briefing!.id).not.toBe(oldId);
    expect(session.outline!.briefing!.title).toBe("Refined narrative");
    expect(session.outline!.phases).toEqual(phases);
    expect(session.currentStepIndex).toBe(step); expect([...session.reviewedFiles]).toEqual(reviewed); expect(session.comments).toEqual(comments);
  } finally { await session.dispose(); }
});
