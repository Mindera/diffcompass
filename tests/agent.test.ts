import { expect, test } from "bun:test";
import { parseClaudeJson, parseCodexJsonLines, TourAgent } from "../src/agent.ts";
import { AttachedAgentBridge } from "../src/bridge.ts";
import type { GitComparison } from "../src/types.ts";

test("extracts the thread and final agent messages from Codex JSONL", () => {
  const parsed = parseCodexJsonLines([
    JSON.stringify({ type: "thread.started", thread_id: "thread-123" }),
    JSON.stringify({ type: "item.completed", item: { type: "reasoning", text: "hidden" } }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Hello" } }),
  ].join("\n"));

  expect(parsed).toEqual({ threadId: "thread-123", message: "Hello" });
});

test("extracts the resumable Claude session and result", () => {
  expect(parseClaudeJson(JSON.stringify({
    type: "result",
    result: "Here is the next stop.",
    session_id: "session-123",
  }))).toEqual({ sessionId: "session-123", message: "Here is the next stop." });
});

test("normalizes context findings and derives all priority levels from the documented contract", async () => {
  const bridge = new AttachedAgentBridge();
  const agent = new TourAgent("/tmp/repository", { adapterId: "attached", modelId: "current-session" }, bridge);
  const comparison: GitComparison = {
    repositoryRoot: "/tmp/repository",
    repositoryName: "repository",
    base: "main",
    mergeBase: "base",
    head: "head",
    patch: "",
    repositoryFiles: ["app.ts"],
    files: [{
      oldPath: "app.ts", newPath: "app.ts", path: "app.ts", status: "modified", metadata: [], additions: 1, deletions: 0,
      hunks: [{ header: "@@ -1,1 +1,2 @@", oldStart: 1, oldCount: 1, newStart: 1, newCount: 2, rows: [
        { kind: "context", content: "const base = 1;", oldLine: 1, newLine: 1 },
        { kind: "addition", content: "const changed = 2;", oldLine: null, newLine: 2 },
      ] }],
    }],
  };
  const pending = agent.createOutline(comparison);
  const [event] = await bridge.eventsAfter(0, 1_000);
  const finding = (id: string, line: number, side: "old" | "new", blastRadiusSize: number, tested: boolean, pinScope: "line" | "symbol" | "file") => ({
    id, path: "app.ts", side, line, message: `${id} issue`, category: "correctness", severity: "medium", confidence: "high",
    evidence: "The diff demonstrates the issue.", priority: "P3", introduced: true, recallGuard: false, blastRadiusSize, tested, pinScope, status: "open",
  });
  await bridge.respond(event!.id, JSON.stringify({
    title: "Review", summary: "Review changes", flows: [],
    steps: [{ id: "step", title: "Step", objective: "Inspect", anchor: { path: "app.ts", side: "new", startLine: 2, endLine: 2 } }],
    findings: [
      finding("p0", 2, "new", 8, false, "line"),
      finding("p1", 2, "new", 4, true, "line"),
      finding("p2", 2, "new", 1, true, "symbol"),
      finding("p3", 1, "old", 1, true, "file"),
    ],
  }));

  const outline = await pending;
  expect(outline.findings.map(({ id, priority }) => [id, priority])).toEqual([["p0", "P0"], ["p1", "P1"], ["p2", "P2"], ["p3", "P3"]]);
  expect(outline.findings[3]).toMatchObject({ side: "new", line: 1 });
});
