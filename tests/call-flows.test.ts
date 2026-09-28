import { expect, test } from "bun:test";
import { validateCallFlow } from "../src/call-flows.ts";
import type { GitComparison } from "../src/types.ts";

const comparison: GitComparison = {
  repositoryRoot: "/tmp/repository", repositoryName: "repository", base: "main", mergeBase: "base", head: "head", patch: "",
  repositoryFiles: ["src/entry.ts", "src/service.ts"],
  files: [
    { path: "src/entry.ts", oldPath: "src/entry.ts", newPath: "src/entry.ts", status: "modified", metadata: [], hunks: [{ header: "@@ -5 +5 @@", oldStart: 5, oldCount: 1, newStart: 5, newCount: 1, rows: [{ kind: "deletion", content: "oldCall()", oldLine: 5, newLine: null }, { kind: "addition", content: "service()", oldLine: null, newLine: 5 }] }], additions: 1, deletions: 1 },
    { path: "src/service.ts", oldPath: "src/service.ts", newPath: "src/service.ts", status: "modified", metadata: [], hunks: [], additions: 1, deletions: 0 },
  ],
};

const flow = {
  id: "request", title: "Request path", summary: "The entrypoint now delegates to the service.", entrypointNodeId: "entry", provenance: "verified",
  nodes: [
    { id: "entry", label: "handle", kind: "function", change: "modified", oldLocation: { path: "src/entry.ts", side: "old", line: 4 }, newLocation: { path: "src/entry.ts", side: "new", line: 4 } },
    { id: "service", label: "Service.run", kind: "method", change: "added", newLocation: { path: "src/service.ts", side: "new", line: 8 } },
  ],
  edges: [{ id: "entry-service", from: "entry", to: "service", label: "delegates", change: "added", newCallSite: { path: "src/entry.ts", side: "new", line: 5 } }],
  affectedFiles: ["src/entry.ts"],
};

test("validates a bounded call-graph diff and derives its affected changed files", () => {
  expect(validateCallFlow(flow, comparison)).toMatchObject({ id: "request", affectedFiles: ["src/entry.ts"] });
});

test("rejects ungrounded changed edges, unknown nodes, and mismatched affected files", () => {
  expect(() => validateCallFlow({ ...flow, edges: [{ ...flow.edges[0], newCallSite: undefined }] }, comparison)).toThrow("new call-site");
  expect(() => validateCallFlow({ ...flow, edges: [{ ...flow.edges[0], to: "missing" }] }, comparison)).toThrow("declared nodes");
  expect(() => validateCallFlow({ ...flow, affectedFiles: ["src/service.ts"] }, comparison)).toThrow("exactly match");
});

test("rejects call-site evidence outside the changed comparison", () => {
  const withUnchanged = { ...comparison, repositoryFiles: [...comparison.repositoryFiles, "src/unchanged.ts"] };
  expect(() => validateCallFlow({ ...flow, edges: [{ ...flow.edges[0], newCallSite: { path: "src/unchanged.ts", side: "new", line: 1 } }], affectedFiles: ["src/unchanged.ts"] }, withUnchanged)).toThrow("changed file");
});

test("rejects a call-site in unchanged context even when its file changed", () => {
  expect(() => validateCallFlow({ ...flow, edges: [{ ...flow.edges[0], newCallSite: { path: "src/entry.ts", side: "new", line: 4 } }] }, comparison)).toThrow("added or removed diff row");
});

test("accepts unchanged context calls without counting them as changed evidence", () => {
  const contextEdge = {
    id: "context", from: "entry", to: "service", change: "unchanged",
    oldCallSite: { path: "src/service.ts", side: "old", line: 4 },
    newCallSite: { path: "src/service.ts", side: "new", line: 4 },
  };
  expect(validateCallFlow({ ...flow, edges: [contextEdge, ...flow.edges] }, comparison).affectedFiles).toEqual(["src/entry.ts"]);
  expect(() => validateCallFlow({ ...flow, edges: [{ ...contextEdge, newCallSite: { ...contextEdge.newCallSite, side: "old" } }, ...flow.edges] }, comparison)).toThrow("matching old or new side");
  expect(() => validateCallFlow({ ...flow, edges: [{ ...contextEdge, newCallSite: { ...contextEdge.newCallSite, line: 0 } }, ...flow.edges] }, comparison)).toThrow("positive integer");
  expect(() => validateCallFlow({ ...flow, edges: [{ ...contextEdge, change: "removed", newCallSite: undefined }, ...flow.edges] }, comparison)).toThrow("added or removed diff row");
});

test("rejects disconnected graphs and graphs without a changed call", () => {
  expect(() => validateCallFlow({ ...flow, nodes: [...flow.nodes, { id: "orphan", label: "orphan", kind: "external", change: "unchanged" }] }, comparison)).toThrow("reachable");
  expect(() => validateCallFlow({ ...flow, edges: [{ ...flow.edges[0], change: "unchanged", oldCallSite: { path: "src/entry.ts", side: "old", line: 5 } }] }, comparison)).toThrow("added or removed");
});
