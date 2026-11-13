import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_REVIEW_PREFERENCES, DEFAULT_REVIEW_POLICY } from "../src/config.ts";
import { TourAgent } from "../src/agent.ts";
import { ReviewSession } from "../src/session.ts";
import { runProcess } from "../src/process.ts";
import { loadPersistedSession } from "../src/store.ts";
import { prepareAndOpenReviewPage } from "../src/open-review.ts";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const phases = [{ id: "value", title: "Change value", summary: "The result becomes two.", fileChanges: [{ path: "app.ts", summary: "Changes the exported value from one to two. Consumers receive two." }], steps: [{ id: "value-step", title: "Return two", objective: "The exported value becomes two.", anchor: { path: "app.ts", side: "new", startLine: 1, endLine: 1 } }] }];
const proposal = { title: "Return two", sections: [{ id: "outcome", title: "The value becomes two", blocks: [{ id: "text", kind: "prose", text: "Consumers now receive two.", basis: "observed" }, { id: "code", kind: "source", evidenceId: "source" }] }], evidence: [{ id: "source", path: "app.ts", side: "new", startLine: 1, endLine: 1, quote: "export const value = 2;" }] };
const selection = { adapterId: "attached" as const, modelId: "current-session", includeArchitecture: false, includeCallFlows: false, includeFlows: false, includeAdaptiveDiagrams: false, includeDryRuns: false, includeArchify: false, includeFindings: true };
async function fixture() {
  const repository = await mkdtemp(join(tmpdir(), "briefing-startup-"));
  cleanups.push(() => rm(repository, { recursive: true, force: true }));
  for (const args of [["init", "-b", "main"], ["config", "user.email", "test@example.com"], ["config", "user.name", "Test"]]) await runProcess(["git", ...args], repository);
  await writeFile(join(repository, "app.ts"), "export const value = 1;\n");
  await runProcess(["git", "add", "."], repository); await runProcess(["git", "commit", "-m", "Initial"], repository);
  await writeFile(join(repository, "app.ts"), "export const value = 2;\n");
  const stateFile = join(repository, ".git", "review.json");
  const session = await ReviewSession.create(repository, "main", { attached: true, stateFile, agentAdapters: [], preferences: { ...DEFAULT_REVIEW_PREFERENCES, prefetchSteps: 0 }, reviewPolicy: { ...DEFAULT_REVIEW_POLICY, findings: { ...DEFAULT_REVIEW_POLICY.findings, enabled: true } } });
  cleanups.push(() => session.dispose());
  const requests: string[] = [], workers = new Set<TourAgent>();
  let steps = deferred<string>(), briefing = deferred<string>(), explanation = deferred<string>(), findings = deferred<string>();
  const factory = () => {
    const agent = new TourAgent(repository, selection, { async send(prompt) {
      requests.push(prompt);
      if (prompt.includes("Prepare shared change analysis")) return JSON.stringify({ title: "Return two", summary: "Consumers receive two instead of one.", planningNotes: ["app.ts:1 exports the new value."], phases: [], flows: [], callFlows: [], findings: [], structuralBlastRadii: [], structuralAnalysisOmissionReason: "No callable declarations changed." });
      if (prompt.includes("Prepare tour steps from")) return steps.promise;
      if (prompt.includes("Return only the briefingProposal object itself")) return briefing.promise;
      if (prompt.includes("focused findings auditor")) return findings.promise;
      return explanation.promise;
    } });
    workers.add(agent); return agent;
  };
  (session as unknown as { createAgent: () => TourAgent }).createAgent = factory;
  return { session, repository, stateFile, requests, workers,
    get steps() { return steps; }, get briefing() { return briefing; }, explanation, get findings() { return findings; },
    retryFindings() { findings = deferred<string>(); },
    retrySteps() { steps = deferred<string>(); }, retryBriefing() { briefing = deferred<string>(); } };
}
async function until(predicate: () => boolean) {
  for (let i = 0; i < 300 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 5));
  expect(predicate()).toBe(true);
}

test("shared analysis fans out; verified briefing opens before steps and findings finish", async () => {
  const f = await fixture();
  const starting = f.session.startTour(selection);
  const opened: string[][] = [];
  const opening = prepareAndOpenReviewPage(starting, "http://review.test", { open: command => { opened.push(command); } });
  await until(() => f.requests.some(p => p.includes("Prepare tour steps from")) && f.requests.some(p => p.includes("Return only the briefingProposal")));
  expect(f.workers.size).toBe(3); // primary analysis plus two independent conversations
  expect(opened).toHaveLength(0);
  const savedAnalysis = await loadPersistedSession(f.stateFile);
  expect(savedAnalysis.outline?.phases).toEqual([]);
  expect(savedAnalysis.currentStepIndex).toBe(-1);
  f.briefing.resolve(JSON.stringify(proposal));
  expect(await opening).toBe(true);
  expect(opened).toHaveLength(1);
  expect(f.session.outline?.preparation).toMatchObject({ briefing: "ready", steps: "pending", findings: "pending" });
  expect(f.session.outline?.briefing?.evidence[0]?.available).toBe(true);
  expect((await loadPersistedSession(f.stateFile)).outline?.briefing?.mode).toBe("authored");
  await expect(f.session.navigate("next")).rejects.toThrow("still being prepared");
  const documentId = f.session.outline!.briefing!.id;
  f.steps.resolve(JSON.stringify({ phases }));
  await until(() => f.requests.some(p => p.includes("focused findings auditor")));
  f.explanation.resolve("The exported value changes from one to two.");
  await until(() => f.session.outline?.preparation?.steps === "ready");
  expect(f.session.snapshot().tourState).toBe("active");
  expect(f.session.outline?.preparation?.findings).toBe("pending");
  expect(f.session.outline?.briefing?.id).toBe(documentId);
  f.findings.resolve('{"candidateDecisions":[],"findings":[]}');
  await until(() => f.session.outline?.preparation?.findings === "ready");
  expect((await loadPersistedSession(f.stateFile)).outline?.phases[0]?.steps[0]?.explanation).toContain("one to two");
});

test("step failure preserves briefing and retries without repeating shared analysis", async () => {
  const f = await fixture(); const starting = f.session.startTour(selection);
  await until(() => f.requests.some(p => p.includes("Return only the briefingProposal")));
  f.briefing.resolve(JSON.stringify(proposal)); await starting;
  f.steps.reject(new Error("Step provider unavailable"));
  await until(() => f.session.outline?.preparation?.steps === "failed");
  const documentId = f.session.outline!.briefing!.id;
  f.retrySteps(); await f.session.startTour();
  f.steps.resolve(JSON.stringify({ phases })); f.explanation.resolve("Prepared after retry.");
  f.findings.resolve('{"candidateDecisions":[],"findings":[]}');
  await until(() => f.session.outline?.preparation?.steps === "ready");
  expect(f.session.outline?.briefing?.id).toBe(documentId);
  expect(f.requests.filter(p => p.includes("Prepare shared change analysis"))).toHaveLength(1);
});

test("briefing failure does not roll back completed steps; retry only authors briefing", async () => {
  const f = await fixture(); const starting = f.session.startTour(selection).catch(error => error);
  await until(() => f.requests.some(p => p.includes("Return only the briefingProposal")));
  f.steps.resolve(JSON.stringify({ phases })); f.explanation.resolve("Ready."); f.findings.resolve('{"candidateDecisions":[],"findings":[]}');
  await until(() => f.session.outline?.preparation?.steps === "ready");
  f.briefing.reject(new Error("Briefing unavailable")); expect(await starting).toBeInstanceOf(Error);
  expect(f.session.outline?.preparation).toMatchObject({ briefing: "failed", steps: "ready" });
  f.retryBriefing(); const retry = f.session.startTour(); f.briefing.resolve(JSON.stringify(proposal)); await retry;
  expect(f.requests.filter(p => p.includes("Prepare tour steps from"))).toHaveLength(1);
  expect(f.session.outline?.preparation?.briefing).toBe("ready");
});

for (const action of ["refresh", "close", "dispose"] as const) test(`late preparation cannot publish after ${action}`, async () => {
  const f = await fixture(); const starting = f.session.startTour(selection).catch(error => error);
  await until(() => f.requests.some(p => p.includes("Return only the briefingProposal")));
  if (action === "refresh") {
    await writeFile(join(f.repository, "app.ts"), "export const value = 3;\n"); await f.session.refreshComparison();
  } else if (action === "close") await f.session.close("cancelled");
  else await f.session.dispose();
  f.steps.resolve(JSON.stringify({ phases })); f.briefing.resolve(JSON.stringify(proposal));
  expect(await starting).toBeInstanceOf(Error);
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(f.session.outline?.briefing).toBeUndefined();
  expect(f.session.outline?.phases).toEqual([]);
  if (action === "close") expect((await loadPersistedSession(f.stateFile)).status).toBe("cancelled");
});

test("saved briefing with interrupted background work resumes with an explicit retry state", async () => {
  const f = await fixture(); const starting = f.session.startTour(selection);
  await until(() => f.requests.some(p => p.includes("Return only the briefingProposal")));
  f.briefing.resolve(JSON.stringify(proposal)); await starting;
  const saved = JSON.parse(await readFile(f.stateFile, "utf8"));
  expect(saved.outline.preparation.steps).toBe("pending");
  const resumed = await ReviewSession.create(f.repository, "main", { stateFile: f.stateFile, resume: true, agentAdapters: [] });
  cleanups.push(() => resumed.dispose());
  expect(resumed.outline?.briefing?.id).toBe(f.session.outline?.briefing?.id);
  expect(resumed.outline?.preparation?.steps).toBe("failed");
  expect(resumed.outline?.preparation?.stepsError).toContain("interrupted");
});


test("failure to persist shared analysis does not publish readiness or launch workers", async () => {
  const f = await fixture();
  (f.session as unknown as { defaults: { stateFile: string } }).defaults.stateFile = "/dev/null/review.json";
  await expect(f.session.startTour(selection)).rejects.toThrow();
  expect(f.session.outline).toBeUndefined();
  expect(f.requests).toHaveLength(1);
});

test("failed findings audit can retry without rewriting the briefing or steps", async () => {
  const f = await fixture(); const starting = f.session.startTour(selection);
  await until(() => f.requests.some(p => p.includes("Return only the briefingProposal")));
  f.briefing.resolve(JSON.stringify(proposal)); f.steps.resolve(JSON.stringify({ phases }));
  f.explanation.resolve("Ready."); await starting;
  await until(() => f.requests.some(p => p.includes("focused findings auditor")));
  f.findings.reject(new Error("Audit unavailable"));
  await until(() => f.session.outline?.preparation?.findings === "failed");
  expect(f.session.outline?.briefing).toBeDefined();
  const before = f.requests.filter(p => p.includes("Return only the briefingProposal") || p.includes("Prepare tour steps from")).length;
  f.retryFindings();
  await f.session.startTour();
  await until(() => f.requests.filter(p => p.includes("focused findings auditor")).length === 2);
  f.findings.resolve('{"candidateDecisions":[],"findings":[]}');
  await until(() => f.session.outline?.preparation?.findings === "ready");
  expect(f.requests.filter(p => p.includes("Return only the briefingProposal") || p.includes("Prepare tour steps from"))).toHaveLength(before);
});
