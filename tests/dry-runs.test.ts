import { expect, test } from "bun:test";
import { comparisonFingerprint, dryRunFlowFingerprint, traceIsStale, validateDryRunPlans, validateDryRunPlanSourceAnchors, validateGeneratedDryRun, validateTraceSourceAnchors } from "../src/dry-runs.ts";
import { AttachedAgentBridge } from "../src/bridge.ts";
import type { GitComparison, TourOutline } from "../src/types.ts";

const comparison: GitComparison = {
  repositoryRoot: "/fixture",
  repositoryName: "fixture",
  base: "base",
  mergeBase: "merge",
  head: "head",
  patch: "diff --git a/src/receipt.ts b/src/receipt.ts\n@@ -0,0 +1,2 @@\n+export const receipt = (amount: number) => amount.toFixed(2);\n+export const unchanged = true;\n",
  repositoryFiles: ["src/receipt.ts", "src/support.ts"],
  files: [{
    path: "src/receipt.ts", oldPath: null, newPath: "src/receipt.ts", status: "added", metadata: [], additions: 2, deletions: 0,
    hunks: [{ header: "@@ -0,0 +1,2 @@", oldStart: 0, oldCount: 0, newStart: 1, newCount: 2, rows: [
      { kind: "addition", content: "export const receipt = (amount: number) => amount.toFixed(2);", oldLine: null, newLine: 1 },
      { kind: "addition", content: "export const unchanged = true;", oldLine: null, newLine: 2 },
    ] }],
  }],
};

function behaviorPlan() {
  return {
    flowId: "format-receipt",
    flowKind: "behavior",
    title: "Format a receipt",
    summary: "Format a supplied amount without relying on any diagram renderer.",
    source: { anchors: [{ path: "src/receipt.ts", side: "new", startLine: 1, endLine: 1, changed: true }] },
    scenarios: [{
      id: "primary", title: "Primary amount", reason: "Formats the changed output.", source: "invented",
      inputs: { amount: 20 }, mocks: {}, assumptions: ["The amount is finite."],
    }, {
      id: "boundary", title: "Zero amount", reason: "Checks the format boundary.", source: "invented",
      inputs: { amount: 0 }, mocks: {}, assumptions: ["The amount is finite."],
    }],
  };
}

function outline(): TourOutline {
  return {
    title: "Fixture", summary: "A dry-run validation fixture.", phases: [], callFlows: [], flows: [], findings: [], dryRunPlans: [behaviorPlan()] as TourOutline["dryRunPlans"],
  };
}

test("dry-run behavior plans do not require call-flow or sequence artifacts", () => {
  const plans = validateDryRunPlans([behaviorPlan()], { callFlows: [], flows: [] }, comparison, { suggested: true });
  expect(plans).toEqual([expect.objectContaining({ flowId: "format-receipt", flowKind: "behavior" })]);
  expect(plans[0]?.callFlowId).toBeUndefined();
  expect(plans[0]?.sequenceFlowId).toBeUndefined();
});

test("plan evidence is bounded against actual source before it can be saved", async () => {
  const plans = validateDryRunPlans([behaviorPlan()], { callFlows: [], flows: [] }, comparison, { suggested: true });
  await expect(validateDryRunPlanSourceAnchors(plans, async () => "one line\n")).resolves.toBeUndefined();
  plans[0]!.source.anchors[0]!.endLine = 3;
  await expect(validateDryRunPlanSourceAnchors(plans, async () => "one line\n")).rejects.toThrow("not present");
});

test("a trace may anchor unchanged support source and rejects out-of-bounds source only after real content validation", async () => {
  const currentOutline = outline();
  const scenario = currentOutline.dryRunPlans![0]!.scenarios[0]!;
  const trace = validateGeneratedDryRun({
    assumptions: ["Source-derived only."],
    steps: [{
      id: "support", order: 1, kind: "calculation", title: "Use support", explanation: "An unchanged helper participates in the derived result.",
      source: { path: "src/support.ts", side: "new", startLine: 1, endLine: 1, changed: false }, function: "support", arguments: {}, locals: {}, valueChanges: [],
    }],
    outcome: { summary: "A simulated result." },
  }, comparison, currentOutline, "format-receipt", "behavior", scenario);
  await expect(validateTraceSourceAnchors(trace, async (path) => path === "src/support.ts" ? "export const support = true;\n" : "export const receipt = (amount: number) => amount.toFixed(2);\n")).resolves.toBeUndefined();
  const invalid = structuredClone(trace);
  invalid.steps[0]!.source.endLine = 8;
  await expect(validateTraceSourceAnchors(invalid, async () => "one line\n")).rejects.toThrow("not present");
});

test("normal generated walkthroughs stay compact while a reviewer can request a bounded detailed trace", () => {
  const currentOutline = outline();
  const scenario = currentOutline.dryRunPlans![0]!.scenarios[0]!;
  const steps = Array.from({ length: 9 }, (_, index) => ({
    id: `step-${index + 1}`,
    order: index + 1,
    kind: "calculation" as const,
    title: `Calculation ${index + 1}`,
    explanation: "A distinct source-derived calculation detail.",
    source: { path: "src/receipt.ts", side: "new" as const, startLine: 1, endLine: 1, changed: true },
    function: "receipt",
    arguments: {},
    locals: {},
    valueChanges: [],
  }));
  const response = { assumptions: [], steps, outcome: { summary: "A simulated result." } };
  expect(() => validateGeneratedDryRun(response, comparison, currentOutline, "format-receipt", "behavior", scenario)).toThrow("compact");
  const detailed = validateGeneratedDryRun(response, comparison, currentOutline, "format-receipt", "behavior", scenario, "detailed");
  expect(detailed).toMatchObject({ detail: "detailed" });
  expect(detailed.steps).toHaveLength(9);
});

test("flow fingerprints make a trace stale when behavior evidence changes", () => {
  const currentOutline = outline();
  const scenario = currentOutline.dryRunPlans![0]!.scenarios[0]!;
  const trace = validateGeneratedDryRun({
    assumptions: [],
    steps: [{
      id: "format", order: 1, kind: "return", title: "Return text", explanation: "The changed formatter returns a string.",
      source: { path: "src/receipt.ts", side: "new", startLine: 1, endLine: 1, changed: true }, function: "receipt", arguments: { amount: 20 }, locals: {}, valueChanges: [{ name: "result", after: "20.00" }],
    }],
    outcome: { summary: "20.00", value: "20.00" },
  }, comparison, currentOutline, "format-receipt", "behavior", scenario);
  expect(trace.comparison.fingerprint).toBe(comparisonFingerprint(comparison));
  expect(trace.flowFingerprint).toBe(dryRunFlowFingerprint(currentOutline, "behavior", "format-receipt"));
  currentOutline.dryRunPlans![0]!.summary = "Changed behavior evidence.";
  expect(traceIsStale(trace, comparison, currentOutline)).toBe(true);
});

test("a saved trace is stale when a refreshed scenario keeps its id but changes execution inputs", () => {
  const currentOutline = outline();
  const scenario = currentOutline.dryRunPlans![0]!.scenarios[0]!;
  const trace = validateGeneratedDryRun({
    assumptions: [],
    steps: [{
      id: "format", order: 1, kind: "return", title: "Return text", explanation: "The changed formatter returns a string.",
      source: { path: "src/receipt.ts", side: "new", startLine: 1, endLine: 1, changed: true }, function: "receipt", arguments: { amount: 20 }, locals: {}, valueChanges: [{ name: "result", after: "20.00" }],
    }],
    outcome: { summary: "20.00", value: "20.00" },
  }, comparison, currentOutline, "format-receipt", "behavior", scenario);
  currentOutline.dryRunPlans![0]!.scenarios[0]!.inputs = { amount: 99 };
  expect(traceIsStale(trace, comparison, currentOutline)).toBe(true);
});

test("cancelling an attached dry-run request removes its pending prompt and prevents a late response", async () => {
  const bridge = new AttachedAgentBridge("dry-run-test-token");
  const controller = new AbortController();
  const preparing = bridge.send("prepare simulated execution", "dry-run.trace", undefined, undefined, controller.signal);
  const [prompt] = await bridge.eventsAfter(0, 100);
  expect(prompt).toMatchObject({ type: "agent.prompt", kind: "dry-run.trace" });
  controller.abort();
  await expect(preparing).rejects.toThrow("cancelled");
  await expect(bridge.eventsAfter(prompt!.sequence, 0)).resolves.toEqual([]);
  await expect(bridge.respond(prompt!.id, "late trace")).rejects.toThrow("No unanswered bridge event");
});
