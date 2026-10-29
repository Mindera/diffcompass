import { expect, test } from "bun:test";
import { TourAgent } from "../src/agent.ts";
import { AttachedAgentBridge } from "../src/bridge.ts";
import { DEFAULT_REVIEW_POLICY } from "../src/config.ts";
import { validateDryRunPlans } from "../src/dry-runs.ts";
import type { GitComparison } from "../src/types.ts";

const comparison: GitComparison = {
  repositoryRoot: "/tmp/repository", repositoryName: "repository", base: "main", mergeBase: "base", head: "head", patch: "+call()", repositoryFiles: ["app.ts"],
  files: [{ path: "app.ts", oldPath: "app.ts", newPath: "app.ts", status: "modified", metadata: [], additions: 1, deletions: 0,
    hunks: [{ header: "@@ -0,0 +1 @@", oldStart: 0, oldCount: 0, newStart: 1, newCount: 1,
      rows: [{ kind: "addition", content: "call()", oldLine: null, newLine: 1 }] }],
  }],
};

function outline(valid = false) {
  return {
    title: "Review", summary: "Review the changed call.",
    structuralBlastRadii: [], structuralAnalysisOmissionReason: "Only a top-level call changed in this fixture.",
    phases: [{ id: "behavior", title: "Behavior", summary: "Changes behavior.", fileChanges: [{ path: "app.ts", summary: "Changes call." }],
      steps: [{ id: "step", title: "Call", objective: "Inspect call.", anchor: { path: "app.ts", side: "new" as const, startLine: 1, endLine: 1 } }] }],
    callFlows: [{ id: "call", title: "Call", summary: "Changed call", entrypointNodeId: "entry", provenance: "partial",
      nodes: [{ id: "entry", label: "entry", kind: "function", change: "modified", newLocation: { path: "app.ts", side: "new", line: 1 } },
        { id: "child", label: "child", kind: "external", change: "unchanged" }],
      edges: [{ id: "edge", from: "entry", to: "child", change: "added", newCallSite: { path: "app.ts", side: "new", line: valid ? 1 : 99 } }],
    }],
    dryRunPlans: [{ flowId: "behavior", flowKind: "behavior" as const, title: "Call", summary: "Simulate call.", callFlowId: "call",
      source: { anchors: [{ path: "app.ts", side: "new" as const, startLine: 1, endLine: 1, changed: true }] },
      scenarios: ["primary", "boundary"].map(id => ({ id, title: id, reason: "Exercise call", source: "invented" as const, inputs: {}, mocks: {}, assumptions: [] })),
    }], flows: [], findings: [],
  };
}

function start() {
  const bridge = new AttachedAgentBridge();
  const agent = new TourAgent(comparison.repositoryRoot, {
    adapterId: "attached", modelId: "current-session", includeArchitecture: false,
    includeFindings: false, includeAdaptiveDiagrams: false, includeDryRuns: true,
  }, bridge);
  return { bridge, agent, pending: agent.createOutline(comparison, DEFAULT_REVIEW_POLICY) };
}

async function respond(bridge: AttachedAgentBridge, after: number, value: unknown) {
  const [event] = await bridge.eventsAfter(after, 1_000);
  if (!event || event.type !== "agent.prompt") throw new Error("Expected outline request");
  await bridge.respond(event.id, JSON.stringify(value));
  await bridge.ack(event.id);
  return event;
}

test("repairs invalid call evidence with exact diagnostics and the original response", async () => {
  const { bridge, pending } = start();
  const first = await respond(bridge, 0, outline());
  const retry = await respond(bridge, first.sequence, outline(true));
  expect(retry.prompt).toContain("callFlows[0] was omitted: newCallSite must point to an added or removed diff row");
  expect(retry.prompt).toContain('<previous-outline>\n' + JSON.stringify(outline()));
  const result = await pending;
  expect(result.value.callFlows).toHaveLength(1);
  expect(result.value.dryRunPlans?.[0]?.callFlowId).toBe("call");
  expect(result.value.planningNotes).toEqual([]);
  expect(result.receipts).toEqual([first.id, retry.id]);
});

test("after two retries keeps the valid route and scenarios with a bounded visible warning", async () => {
  const { bridge, pending } = start();
  const value = { ...outline(), planningNotes: Array.from({ length: 20 }, (_, i) => `Note ${i}`) };
  let after = 0;
  for (let i = 0; i < 3; i++) after = (await respond(bridge, after, value)).sequence;
  const result = await pending;
  expect(result.value.callFlows).toEqual([]);
  expect(result.value.phases).toEqual(value.phases);
  expect(result.value.dryRunPlans?.[0]?.callFlowId).toBeUndefined();
  expect(result.value.dryRunPlans?.[0]?.scenarios).toEqual(value.dryRunPlans[0]!.scenarios);
  expect(result.value.planningNotes).toHaveLength(20);
  expect(result.value.planningNotes?.[0]).toContain("optional link was removed");
  expect(result.value.planningNotes?.every(note => note.length <= 2_000)).toBe(true);
  expect(result.receipts).toHaveLength(3);
});

test("a missing sequence correlation can be omitted without losing valid call evidence", async () => {
  const { bridge, pending } = start();
  const value = outline(true);
  Object.assign(value.dryRunPlans[0]!, { sequenceFlowId: "missing" });
  let after = 0;
  for (let i = 0; i < 3; i++) after = (await respond(bridge, after, value)).sequence;
  const result = await pending;
  expect(result.value.callFlows).toHaveLength(1);
  expect(result.value.dryRunPlans?.[0]?.callFlowId).toBe("call");
  expect(result.value.dryRunPlans?.[0]?.sequenceFlowId).toBeUndefined();
});

test("fallback never accepts invalid independent dry-run source evidence", async () => {
  const { bridge, pending } = start();
  const rejected = pending.then(() => undefined, error => error);
  const value = outline();
  value.dryRunPlans[0]!.source.anchors[0]!.path = "missing.ts";
  let after = 0;
  for (let i = 0; i < 3; i++) after = (await respond(bridge, after, value)).sequence;
  expect((await rejected)?.message).toContain("path must reference a repository file");
});

function misplacedAnchors() {
  const value = outline(true);
  const { source, ...plan } = value.dryRunPlans[0]!;
  return { ...value, dryRunPlans: [{ ...plan, anchors: source.anchors }] };
}

test("repairs misplaced dry-run anchors using the exact schema and preserves response receipts", async () => {
  const { bridge, pending } = start();
  const outcome = pending.then(value => ({ value }), error => ({ error }));
  try {
    const invalid = misplacedAnchors();
    const first = await respond(bridge, 0, invalid);
    const shape = JSON.parse(first.prompt.match(/^Dry-run plan JSON shape: (.+)$/m)?.[1] ?? "null");
    expect(shape?.dryRunPlans[0].source.anchors).toBeArray();
    // The advertised example must satisfy the real validator after replacing
    // its illustrative path and omitting the optional diagram correlations.
    const example = shape.dryRunPlans[0];
    example.source.anchors[0].path = "app.ts";
    delete example.callFlowId; delete example.sequenceFlowId;
    expect(validateDryRunPlans([example], { callFlows: [], flows: [] }, comparison, { suggested: true })).toHaveLength(1);
    const retry = await respond(bridge, first.sequence, outline(true));
    expect(retry.prompt).toContain("dryRunPlans[0] contains an unsupported field: anchors");
    expect(retry.prompt).toContain("source.anchors");
    expect(retry.prompt).toContain(`<previous-response>\n${JSON.stringify(invalid)}`);
    const result = await outcome;
    if ("error" in result) throw result.error;
    expect(result.value.value.phases).toEqual(outline(true).phases);
    expect(result.value.value.dryRunPlans).toEqual(outline(true).dryRunPlans);
    expect(result.value.receipts).toEqual([first.id, retry.id]);
  } finally { bridge.dispose(); }
});

test("malformed dry-run plans exhaust two repairs without silently dropping source evidence", async () => {
  const { bridge, pending } = start();
  const rejected = pending.then(() => undefined, error => error);
  try {
    let after = 0;
    for (let i = 0; i < 3; i++) after = (await respond(bridge, after, misplacedAnchors())).sequence;
    expect((await rejected)?.message).toContain("dryRunPlans[0] contains an unsupported field: anchors");
    expect(await bridge.eventsAfter(after, 0)).toEqual([]);
  } finally { bridge.dispose(); }
});

test("non-array dry-run plans are repaired instead of becoming an empty plan list", async () => {
  const { bridge, pending } = start();
  const outcome = pending.then(value => ({ value }), error => ({ error }));
  try {
    const first = await respond(bridge, 0, { ...outline(true), dryRunPlans: {} });
    const retry = await respond(bridge, first.sequence, outline(true));
    expect(retry.prompt).toContain("Dry-run plans must contain at most 16 flows");
    const result = await outcome;
    if ("error" in result) throw result.error;
    expect(result.value.value.dryRunPlans).toHaveLength(1);
  } finally { bridge.dispose(); }
});

test("on-demand dry-run planning uses the same schema and bounded repair path", async () => {
  const bridge = new AttachedAgentBridge();
  const agent = new TourAgent(comparison.repositoryRoot, { adapterId: "attached", modelId: "current-session" }, bridge);
  const pending = agent.generateDryRunPlans(comparison, { callFlows: [], flows: [] });
  const outcome = pending.then(value => ({ value }), error => ({ error }));
  try {
    const invalid = misplacedAnchors().dryRunPlans;
    const first = await respond(bridge, 0, { dryRunPlans: invalid });
    expect(first.kind).toBe("dry-run.plan");
    expect(first.prompt).toContain("Dry-run plan JSON shape:");
    const valid = outline(true).dryRunPlans.map(({ callFlowId, ...plan }) => plan);
    const retry = await respond(bridge, first.sequence, { dryRunPlans: valid });
    expect(retry.prompt).toContain("dryRunPlans[0] contains an unsupported field: anchors");
    const result = await outcome;
    if ("error" in result) throw result.error;
    expect(result.value.value).toEqual(valid);
    expect(result.value.receipts).toEqual([first.id, retry.id]);
  } finally { bridge.dispose(); }
});
