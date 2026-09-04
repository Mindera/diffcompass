import { expect, test } from "bun:test";
import { TourAgent, type AgentTransport } from "../src/agent.ts";
import { AttachedAgentBridge } from "../src/bridge.ts";
import { DEFAULT_REVIEW_POLICY } from "../src/config.ts";
import type { AgentRunActivity, GitComparison } from "../src/types.ts";

const comparison: GitComparison = {
  repositoryRoot: "/tmp/repository", repositoryName: "repository", base: "main", mergeBase: "base", head: "head", patch: "+changed", repositoryFiles: ["app.ts"],
  files: [{ oldPath: "app.ts", newPath: "app.ts", path: "app.ts", status: "modified", metadata: [], additions: 1, deletions: 0,
    hunks: [{ header: "@@ -0,0 +1 @@", oldStart: 0, oldCount: 0, newStart: 1, newCount: 1, rows: [{ kind: "addition", content: "changed", oldLine: null, newLine: 1 }] }],
  }],
};
const diagram = {
  title: "Components", summary: "App calls the service.",
  mermaid: `flowchart LR
  app["App"]:::touched
  service["Service"]:::external
  app -->|calls| service
  classDef new stroke:#2e7d32,stroke-width:3px
  classDef touched stroke:#f9a825,stroke-width:3px
  classDef removed stroke:#c62828,stroke-width:3px,stroke-dasharray:4 3
  classDef external stroke:#888888,stroke-dasharray:3 3`,
  dependencyChanges: ["No dependency-direction changes."], affectedFiles: ["app.ts"],
};
const outline = {
  title: "Review", summary: "Summary", behaviorArchitectureStatus: "implemented",
  behaviorArchitecture: diagram, architecture: diagram,
  phases: [{ id: "phase", title: "Change", summary: "Change", fileChanges: [{ path: "app.ts", summary: "Change" }], steps: [{ id: "step", title: "Step", objective: "Inspect", anchor: { path: "app.ts", side: "new", startLine: 1, endLine: 1 } }] }],
  findings: [], flows: [], callFlows: [],
};

test("attached outline repairs both rejected diagrams and retains every response receipt", async () => {
  const bridge = new AttachedAgentBridge();
  const agent = new TourAgent("/tmp/repository", { adapterId: "attached", modelId: "current-session", includeFindings: false }, bridge);
  const pending = agent.createOutline(comparison, DEFAULT_REVIEW_POLICY);
  const [initial] = await bridge.eventsAfter(0, 1000);
  await bridge.respond(initial!.id, JSON.stringify({ ...outline,
    behaviorArchitecture: { ...diagram, mermaid: "flowchart LR\n  F[Breaching Finding] --> A[Attribution]" },
    architecture: { ...diagram, mermaid: diagram.mermaid
      .replace('service["Service"]', 'graph["Service"]')
      .replace("app -->|calls| service", "app -->|calls| graph") },
  }));
  await bridge.ack(initial!.id);
  const [repair] = await bridge.eventsAfter(initial!.sequence, 1000);
  if (!repair || repair.type !== "agent.prompt") throw new Error("Expected correction prompt");
  expect(repair.kind).toBe("tour.outline");
  expect(repair.prompt).toContain("behaviorArchitecture: Architecture contains unsupported Mermaid syntax");
  expect(repair.prompt).toContain("architecture: Architecture component id is reserved by Mermaid: graph");
  expect(repair.prompt).toContain("Never use Mermaid keywords");
  expect(repair.prompt).toContain("complete corrected outline JSON");
  await bridge.respond(repair.id, JSON.stringify(outline));
  const result = await pending;
  expect(result.value.architecture).toEqual(diagram);
  expect(result.value.behaviorArchitecture).toEqual(diagram);
  expect(result.receipts).toEqual([initial!.id, repair.id]);
  bridge.prepareCommitResponses(result.receipts);
  await bridge.ack(repair.id);
});

test.each([
  ["missing diagrams", { ...outline, architecture: undefined, behaviorArchitecture: undefined }, "Required diagram is missing"],
  ["unknown paths", { ...outline, architecture: { ...diagram, affectedFiles: ["unrelated.ts"] } }, "unknown: unrelated.ts"],
  ["missing behaviour status", { ...outline, behaviorArchitectureStatus: undefined }, "behaviorArchitectureStatus"],
])("%s fail visibly after two correction attempts", async (_label, response, error) => {
  let calls = 0;
  const activities: AgentRunActivity[] = [];
  const transport: AgentTransport = { async send() { calls++; return JSON.stringify(response); } };
  const agent = new TourAgent("/tmp/repository", { adapterId: "attached", modelId: "current-session", includeFindings: false }, transport, undefined, (activity) => activities.push(activity));
  await expect(agent.createOutline(comparison, DEFAULT_REVIEW_POLICY)).rejects.toThrow(String(error));
  expect(calls).toBe(3);
  expect(activities.at(-1)).toMatchObject({ status: "failed", error: expect.stringContaining(String(error)) });
  expect(activities.at(-1)!.updates).toHaveLength(2);
});

test("valid diagrams need no retries and unrelated outline errors are not retried", async () => {
  for (const response of [outline, { ...outline, phases: [] }]) {
    let calls = 0;
    const transport: AgentTransport = { async send() { calls++; return JSON.stringify(response); } };
    const agent = new TourAgent("/tmp/repository", { adapterId: "attached", modelId: "current-session", includeFindings: false }, transport);
    if (response.phases.length) expect((await agent.createOutline(comparison, DEFAULT_REVIEW_POLICY)).value.architecture).toEqual(diagram);
    else await expect(agent.createOutline(comparison, DEFAULT_REVIEW_POLICY)).rejects.toThrow("invalid tour outline");
    expect(calls).toBe(1);
  }
});

test("cancellation does not start a diagram correction request", async () => {
  let calls = 0;
  const transport: AgentTransport = { async send() { calls++; agent.cancel(); return JSON.stringify({ ...outline, architecture: undefined }); } };
  const agent = new TourAgent("/tmp/repository", { adapterId: "attached", modelId: "current-session", includeFindings: false }, transport);
  await expect(agent.createOutline(comparison, DEFAULT_REVIEW_POLICY)).rejects.toThrow("Required diagram is missing");
  expect(calls).toBe(1);
});

test("explicitly disabled architecture needs no diagrams or correction requests", async () => {
  let calls = 0;
  const transport: AgentTransport = { async send() { calls++; return JSON.stringify({ ...outline, architecture: undefined, behaviorArchitecture: undefined }); } };
  const agent = new TourAgent("/tmp/repository", { adapterId: "attached", modelId: "current-session", includeArchitecture: false, includeFindings: false }, transport);
  expect((await agent.createOutline(comparison, DEFAULT_REVIEW_POLICY)).value.architecture).toBeUndefined();
  expect(calls).toBe(1);
});
