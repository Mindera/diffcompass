import { expect, test } from "bun:test";
import { TourAgent } from "../src/agent.ts";
import { AttachedAgentBridge } from "../src/bridge.ts";
import { DEFAULT_REVIEW_POLICY } from "../src/config.ts";
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
    phases: [{ id: "behavior", title: "Behavior", summary: "Changes behavior.", fileChanges: [{ path: "app.ts", summary: "Changes call." }],
      steps: [{ id: "step", title: "Call", objective: "Inspect call.", anchor: { path: "app.ts", side: "new" as const, startLine: 1, endLine: 1 } }] }],
    callFlows: [{ id: "call", title: "Call", summary: "Changed call", entrypointNodeId: "entry", provenance: "partial",
      nodes: [{ id: "entry", label: "entry", kind: "function", change: "modified", newLocation: { path: "app.ts", side: "new", line: 1 } },
        { id: "child", label: "child", kind: "external", change: "unchanged" }],
      edges: [{ id: "edge", from: "entry", to: "child", change: "added", newCallSite: { path: "app.ts", side: "new", line: valid ? 1 : 99 } }],
    }],
    dryRunPlans: [{ flowId: "behavior", flowKind: "behavior", title: "Call", summary: "Simulate call.", callFlowId: "call",
      source: { anchors: [{ path: "app.ts", side: "new", startLine: 1, endLine: 1, changed: true }] },
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
  await respond(bridge, 0, value);
  expect((await rejected)?.message).toContain("path must reference a repository file");
});
