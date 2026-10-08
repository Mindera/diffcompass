import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TourAgent } from "../src/agent.ts";
import { AttachedAgentBridge } from "../src/bridge.ts";
import { DEFAULT_REVIEW_POLICY } from "../src/config.ts";
import { fileExplanationFor, fileSummarySource, FILE_EXPLANATION_PROMPT } from "../src/file-explanations.ts";
import { semanticExport } from "../src/semantic-diff-export.ts";
import { semanticDiffForFile } from "../src/semantic-diff.ts";
import { createRequestHandler } from "../src/server.ts";
import { ReviewSession } from "../src/session.ts";
import { loadPersistedSession, savePersistedSession } from "../src/store.ts";
import { semanticPresentation } from "../public/semantic-diff-presentation.js";
import type { GitComparison, TourOutline } from "../src/types.ts";

const comparison = (): GitComparison => ({ repositoryRoot: "/tmp/unused-explanation-fixture", repositoryName: "fixture", base: "main", mergeBase: "a".repeat(40), sourceTree: "b".repeat(40), head: "c".repeat(40), patch: "saved diff", repositoryFiles: ["next.py"], files: [{ path: "next.py", oldPath: "prior.py", newPath: "next.py", status: "renamed", metadata: [], additions: 1, deletions: 1, hunks: [{ header: "@@ -1 +1 @@", oldStart: 1, newStart: 1, oldCount: 1, newCount: 1, rows: [{ kind: "deletion", content: "return amount", oldLine: 1, newLine: null }, { kind: "addition", content: "return max(0, amount - discount)", oldLine: null, newLine: 1 }] }] }] });
const narrative = "The calculation subtracts the discount and clamps the result to zero. This prevents a negative returned amount; check whether discounts above the amount should instead be rejected.";
const outline = (value: GitComparison): TourOutline => ({ title: "Discounts", summary: "Clamp the calculated amount.", structuralBlastRadii: [], structuralAnalysisOmissionReason: "No structural graph is available for this fixture.", phases: [{ id: "calculation", title: "Calculate payable amount", summary: "Clamp after subtracting the discount.", fileChanges: [{ path: "next.py", summary: narrative, summarySource: fileSummarySource(value) }], steps: [{ id: "calculate", title: "Subtract and clamp", objective: "The amount is clamped after discounting.", anchor: { path: "next.py", side: "old", startLine: 1, endLine: 1 } }] }], callFlows: [], flows: [], findings: [] });
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

test("future generation requests an explanation and stamps the existing summary, ignoring agent-supplied provenance", async () => {
  const captured = comparison(), response = outline(captured);
  response.phases[0]!.fileChanges[0]!.summarySource = "f".repeat(64);
  const bridge = new AttachedAgentBridge();
  const agent = new TourAgent(captured.repositoryRoot, { adapterId: "attached", modelId: "current-session", includeArchitecture: false, includeCallFlows: false, includeFlows: false, includeFindings: false, includeAdaptiveDiagrams: false }, bridge);
  try {
    const pending = agent.createOutline(captured, DEFAULT_REVIEW_POLICY);
    const [event] = await bridge.eventsAfter(0, 1_000);
    if (!event || event.type !== "agent.prompt") throw new Error("Expected generation prompt");
    expect(event.prompt).toContain(FILE_EXPLANATION_PROMPT);
    expect(event.prompt).toContain(captured.patch);
    expect(event.prompt).toContain(captured.sourceTree!);
    expect(event.prompt).toContain("never substitute current workspace files");
    expect(event.prompt).not.toContain("every phase and file summary to one sentence");
    await bridge.respond(event.id, JSON.stringify(response)); await bridge.ack(event.id);
    const generated = (await pending).value;
    expect(generated.phases[0]!.fileChanges[0]).toEqual({ path: "next.py", summary: narrative, summarySource: fileSummarySource(captured) });
    expect(fileExplanationFor(captured, generated, "next.py").entries[0]!.summary).toBe(narrative);
    const asking = agent.answer("Explain this change");
    const [question] = await bridge.eventsAfter(event.sequence, 1_000);
    if (!question || question.type !== "agent.prompt") throw new Error("Expected question prompt");
    expect(question.prompt).toContain(`before ${captured.mergeBase}, after ${captured.sourceTree}`);
    await bridge.respond(question.id, "Captured explanation."); await asking;
  } finally { agent.cancel(); }
});

test("missing, legacy and stale explanations are distinct, and all comparison identities invalidate cached stamps", () => {
  const captured = comparison(), tour = outline(captured), source = fileSummarySource(captured);
  expect(fileExplanationFor(captured, undefined, "next.py").status).toBe("missing");
  expect(fileExplanationFor(captured, tour, "absent.py").status).toBe("missing");
  for (const key of ["sourceTree", "mergeBase", "head", "base", "patch"] as const) {
    const prior = captured[key]; captured[key] = `other-${key}`;
    expect(fileSummarySource(captured)).not.toBe(source);
    expect(fileExplanationFor(captured, tour, "next.py").status).toBe("stale");
    captured[key] = prior!;
  }
  expect(fileSummarySource(captured)).toBe(source);
  tour.phases[0]!.steps[0]!.outdated = true;
  expect(fileExplanationFor(captured, tour, "next.py").status).toBe("stale");
  delete tour.phases[0]!.steps[0]!.outdated;
  delete tour.phases[0]!.fileChanges[0]!.summarySource;
  expect(fileExplanationFor(captured, tour, "next.py").status).toBe("stale");
  expect(fileExplanationFor({ ...captured, sourceTree: undefined }, outline(captured), "next.py").status).toBe("stale");
});

test("rename and deleted-file links retain the old source path; impossible ranges have no links", () => {
  const captured = comparison(), tour = outline(captured);
  expect(fileExplanationFor(captured, tour, "next.py").entries[0]!.steps[0]!.anchor.path).toBe("prior.py");
  tour.phases[0]!.steps[0]!.anchor.side = "new";
  expect(fileExplanationFor(captured, tour, "next.py").entries[0]!.steps[0]!.anchor.path).toBe("next.py");
  tour.phases[0]!.steps[0]!.anchor.endLine = Number.MAX_SAFE_INTEGER;
  expect(fileExplanationFor(captured, tour, "next.py").entries[0]!.steps).toEqual([]);
  const file = captured.files[0]!; file.status = "deleted"; file.newPath = null;
  file.hunks[0]!.rows = file.hunks[0]!.rows.filter((row) => row.kind === "deletion");
  tour.phases[0]!.steps[0]!.anchor.endLine = 1; tour.phases[0]!.steps[0]!.anchor.side = "old";
  expect(fileExplanationFor(captured, tour, "next.py").entries[0]!.steps[0]!.anchor.path).toBe("prior.py");
});

test("projection bounds phase notes and links, rejects overlong summaries and escapes agent text", () => {
  const captured = comparison(), tour = outline(captured), phase = tour.phases[0]!;
  phase.fileChanges[0]!.summary = '<img src=x onerror=alert(1)> & "explain"';
  phase.steps = Array.from({ length: 20 }, () => structuredClone(phase.steps[0]!));
  tour.phases = Array.from({ length: 9 }, () => structuredClone(phase));
  const result = fileExplanationFor(captured, tour, "next.py");
  expect(result.entries).toHaveLength(6); expect(result.omitted).toBe(3); expect(result.entries[0]!.steps).toHaveLength(8);
  const html = semanticPresentation.explanationHtml("next.py", result);
  expect(html).not.toContain("<img"); expect(html).toContain("&lt;img");
  for (const item of tour.phases) item.fileChanges[0]!.summary = "x".repeat(4_001);
  expect(fileExplanationFor(captured, tour, "next.py").entries).toEqual([]);
});

test("the optional stamp survives existing persistence; legacy outlines load without acquiring a false stamp", async () => {
  const root = await mkdtemp(join(tmpdir(), "file-explanation-store-")); roots.push(root);
  const path = join(root, "review.json"), tour = outline(comparison());
  const saved = { schemaVersion: 2 as const, repositoryRoot: root, base: "main", browserToken: "browser", bridgeToken: "bridge", outline: tour, currentStepIndex: 0, comments: [], messages: [], revision: 1, status: "open" as const, selection: { adapterId: "attached", modelId: "current-session" }, updatedAt: new Date().toISOString() };
  await savePersistedSession(path, saved);
  expect((await loadPersistedSession(path)).outline!.phases[0]!.fileChanges).toEqual(tour.phases[0]!.fileChanges);
  delete tour.phases[0]!.fileChanges[0]!.summarySource;
  await savePersistedSession(path, saved);
  expect((await loadPersistedSession(path)).outline!.phases[0]!.fileChanges[0]!.summarySource).toBeUndefined();
  tour.phases[0]!.fileChanges[0]!.summarySource = "invalid";
  await savePersistedSession(path, saved);
  await expect(loadPersistedSession(path)).rejects.toThrow();
});

test("exports include saved explanations even without parser requests, with separate coverage and no live actions", async () => {
  const captured = comparison(), tour = outline(captured);
  for (const format of ["html", "markdown"] as const) {
    const exported = semanticExport(captured, format, tour);
    expect(exported).toContain("Saved tour explanations: 1 of 1");
    expect(exported).toContain("Requested change summaries: 0 of 1");
    expect(exported).toContain("clamps the result to zero");
    expect(exported).toContain("Before prior.py:1–1");
    expect(exported).toContain(captured.sourceTree!);
    expect(exported).not.toMatch(/<button|data-semantic-explain|href="\//);
  }
  await semanticDiffForFile(captured, "next.py");
  for (const format of ["html", "markdown"] as const) {
    const exported = semanticExport(captured, format, tour);
    expect(exported).toContain("This file type isn’t supported");
    expect(exported).toContain("clamps the result to zero");
    expect(exported).toContain("Requested change summaries: 1 of 1");
  }
  captured.sourceTree = "f".repeat(40);
  expect(semanticExport(captured, "html", tour)).not.toContain(narrative);
});

test("API projects narrative even for unsupported syntax and rejects in-flight comparison replacement", async () => {
  const captured = comparison();
  type Constructor = new (comparison: GitComparison, adapters: [], defaults: Record<string, never>, bridge: AttachedAgentBridge) => ReviewSession;
  const session = new (ReviewSession as unknown as Constructor)(captured, [], {}, new AttachedAgentBridge());
  session.outline = outline(captured);
  const handler = createRequestHandler(session, "/tmp/unused-explanation-sessions");
  const request = () => new Request("http://127.0.0.1/api/diff/semantic?path=next.py", { headers: { "x-diffcompass-token": session.browserToken } });
  const response = await handler(request());
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.status).toBe("unsupported"); expect(result.explanation.entries[0].summary).toBe(narrative);
  const pending = handler(request());
  Object.assign(session, { comparison: { ...captured, sourceTree: "f".repeat(40) } });
  const stale = await pending;
  expect(stale.status).toBeGreaterThanOrEqual(400); expect(await stale.text()).toContain("comparison changed");
});

test("export coverage discloses its file bound and cached stale results keep a stale explanation notice", async () => {
  const captured = comparison(), tour = outline(captured);
  const original = captured.files[0]!;
  captured.files = Array.from({ length: 202 }, (_, i) => ({ ...structuredClone(original), path: `file${i}.py` }));
  tour.phases[0]!.fileChanges = captured.files.map((file) => ({ path: file.path, summary: narrative, summarySource: fileSummarySource(captured) }));
  tour.phases[0]!.steps = [];
  for (const format of ["html", "markdown"] as const) {
    const value = semanticExport(captured, format, tour);
    expect(value).toContain("Saved tour explanations: 200 of 202");
    expect(value).toContain("2 additional explanations omitted");
    expect(value).not.toContain("file201.py");
  }
  await semanticDiffForFile(captured, "file201.py");
  delete tour.phases[0]!.fileChanges[201]!.summarySource;
  expect(semanticExport(captured, "html", tour)).toContain("source version was not recorded");
});
