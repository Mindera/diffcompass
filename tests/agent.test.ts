import { expect, test } from "bun:test";
import { buildCopilotArgs, buildGeminiArgs, parseClaudeJson, parseCodexJsonLines, parseGeminiStreamJson, TourAgent } from "../src/agent.ts";
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

test("extracts Gemini session continuity and only assistant text from JSONL", () => {
  expect(parseGeminiStreamJson([
    "Gemini CLI startup notice",
    JSON.stringify({ type: "init", session_id: "gemini-session", model: "gemini-test" }),
    JSON.stringify({ type: "message", role: "user", content: "untrusted input" }),
    JSON.stringify({ type: "tool_result", content: "private tool output" }),
    JSON.stringify({ type: "message", role: "assistant", content: "First " }),
    JSON.stringify({ type: "message", role: "assistant", content: [{ text: "answer" }] }),
  ].join("\n"))).toEqual({ sessionId: "gemini-session", message: "First answer" });
});

test("accepts Gemini's non-streaming response fallback without treating errors as answers", () => {
  expect(parseGeminiStreamJson(JSON.stringify({ response: "Fallback answer" }))).toEqual({ message: "Fallback answer" });
  expect(parseGeminiStreamJson(JSON.stringify({ type: "error", message: "credential leaked" }))).toEqual({ message: "" });
});

test("builds Gemini invocations as read-only resumable argv without shell interpolation", () => {
  const prompt = "explain; touch /tmp/should-not-run $(whoami)";
  const args = buildGeminiArgs(prompt, "pro", "session-123");
  expect(args).toContain("plan");
  expect(args).toContain("--resume");
  expect(args).toContain("session-123");
  expect(args).toContain("--model");
  expect(args.at(-1)).toBe(prompt);
  expect(args).not.toContain("--yolo");
  expect(buildGeminiArgs("prompt", "auto")).toContain("auto");
  expect(buildGeminiArgs("prompt", "auto", undefined, "/private/tmp/owned/review.diff")).toContain("/private/tmp/owned");
});

test("builds Copilot invocations with exact sessions and a defense-in-depth read-only policy", () => {
  const prompt = "review && rm -rf ignored";
  const args = buildCopilotArgs(prompt, "550e8400-e29b-41d4-a716-446655440000", "gpt-5.4", "high");
  expect(args.slice(0, 3)).toEqual(["copilot", "--prompt", prompt]);
  expect(args).toContain("--session-id");
  expect(args).toContain("--available-tools=view,glob,grep");
  expect(args).toContain("--allow-tool=read");
  expect(args).toContain("--deny-tool=write");
  expect(args).toContain("--deny-tool=shell");
  expect(args).toContain("--deny-tool=url");
  expect(args).toContain("--disable-builtin-mcps");
  expect(args).toContain("--no-custom-instructions");
  expect(args).toContain("--no-auto-update");
  expect(args).toContain("--no-remote-export");
  expect(args).toContain("--model=gpt-5.4");
  expect(args).toContain("--effort=high");
  expect(args).not.toContain("--allow-all");
  expect(buildCopilotArgs("prompt", "550e8400-e29b-41d4-a716-446655440000", "auto", undefined, "/private/tmp/owned/review.diff"))
    .toContain("/private/tmp/owned/review.diff");
});

test("creates and restores adapter-specific continuation identifiers without cross-wiring", () => {
  const copilot = new TourAgent("/tmp/repository", { adapterId: "copilot", modelId: "auto" });
  const created = copilot.continuation();
  expect(created?.adapterId).toBe("copilot");
  expect(created?.id).toMatch(/^[0-9a-f-]{36}$/);

  const gemini = new TourAgent(
    "/tmp/repository",
    { adapterId: "gemini", modelId: "auto" },
    undefined,
    { adapterId: "gemini", id: "gemini-session-123" },
  );
  expect(gemini.continuation()).toEqual({ adapterId: "gemini", id: "gemini-session-123" });
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
