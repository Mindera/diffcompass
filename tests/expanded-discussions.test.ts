import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareTestFixture } from "../src/test-fixture.ts";
import { ReviewSession } from "../src/session.ts";
import { loadPersistedSession, savePersistedSession } from "../src/store.ts";
import { diffSourceIdentity } from "../src/diff-sources.ts";

test("expanded discussions use captured Before/After context, survive reload, and track source changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "diffcompass-expanded-discussions-"));
  const path = "src/context.ts";
  const before = Array.from({ length: 80 }, (_, index) => `// line ${index + 1}\r`).join("\n") + "\n";
  const after = before.replace("// line 40\r", "// changed 40\r");
  let session: ReviewSession | undefined;
  try {
    const fixture = await prepareTestFixture({ root: join(root, "fixture"), extraFiles: { [path]: { before, after } } });
    const saved = await loadPersistedSession(fixture.stateFile);
    saved.bridgeToken = crypto.randomUUID();
    saved.selection = { ...saved.selection!, adapterId: "attached", modelId: "Fixture responder (not AI)" };
    await savePersistedSession(fixture.stateFile, saved);
    const options = { resume: true, stateFile: fixture.stateFile, attached: true, agentAdapters: [], callerModel: "Fixture responder (not AI)" };
    session = await ReviewSession.create(fixture.repository, undefined, options);
    const identity = diffSourceIdentity(session.comparison);
    expect(session.comparison.files.find(file => file.path === path)!.hunks.every(hunk => hunk.rows.every(row => row.newLine !== 10))).toBe(true);
    const input = { path, side: "new" as const, line: 10, scope: "line" as const, context: "// line 10\r", body: "Expanded context" };
    const first = await session.addComment(input, identity);
    const commentId = first.comments.at(-1)!.id;
    expect(first.comments.at(-1)).toMatchObject({ lineContent: "// line 10\r", status: "active", publishToGitHub: false, githubUnavailableReason: expect.stringContaining("Local only") });
    await expect(session.setCommentPublication(commentId, true)).rejects.toThrow("expanded context remain local");
    await session.addComment({ ...input, side: "old", body: "Before context" }, identity);
    const context = after.split("\n").slice(7, 12).join("\n");
    const quoted = await session.addComment({ ...input, scope: "range", line: 8, endLine: 12, context, selectedText: "line 11", body: "Quote across expanded lines" }, identity);
    expect(quoted.comments.at(-1)).toMatchObject({ publishToGitHub: false, githubUnavailableReason: expect.stringContaining("Local only") });
    const crossing = after.split("\n").slice(34, 44).join("\n");
    await session.addComment({ ...input, scope: "range", line: 35, endLine: 44, context: crossing, body: "Cross the original hunk boundary" }, identity);

    // Later workspace writes must not replace the source the reviewer saw.
    const changed = after.replace("// line 10\r", "// different live value\r");
    await writeFile(join(fixture.repository, path), changed);
    await expect(session.addComment({ ...input, context: "// different live value\r" }, identity)).rejects.toThrow("context does not match");
    for (const invalid of [{ ...input, line: 81 }, { ...input, side: "invalid" as "new" }, { ...input, path: "../outside" }, { ...input, scope: "range" as const, endLine: 110 }]) {
      await expect(session.addComment(invalid, identity)).rejects.toThrow();
    }
    const asking = session.ask("Why this unchanged line?", undefined, { stepId: null, anchor: { path, side: "new", line: 10, content: input.context, context: input.context } }, identity);
    const events = await session.bridge!.eventsAfter(0, 1_000);
    const prompt = events.find(event => event.type === "agent.prompt" && event.kind === "review.question");
    if (!prompt || prompt.type !== "agent.prompt") throw Error("Question prompt missing");
    expect(prompt.prompt).toContain("Captured code: // line 10");
    expect(prompt.prompt).toContain("captured location still matches");
    await session.bridge!.respond(prompt.id, "Captured context answer."); await session.bridge!.ack(prompt.id); await asking;

    const refreshed = await session.refreshComparison();
    expect(refreshed.comments.find(comment => comment.id === commentId)!.status).toBe("outdated");
    expect(refreshed.comments.find(comment => comment.body === "Before context")!.status).toBe("active");
    expect(refreshed.comments.find(comment => comment.body === "Quote across expanded lines")!.status).toBe("outdated");
    expect(refreshed.comments.find(comment => comment.body === "Cross the original hunk boundary")!.status).toBe("active");
    await expect(session.ask("Stale question", undefined, { anchor: { path, side: "new", line: 10, content: input.context } }, identity)).rejects.toThrow("previous comparison");
    const next = await session.addComment({ ...input, context: "// different live value\r" }, diffSourceIdentity(session.comparison));
    expect(next.comments.at(-1)!.lineContent).toBe("// different live value\r");
    await session.dispose(); session = await ReviewSession.create(fixture.repository, undefined, options);
    expect(session.snapshot().comments.find(comment => comment.body === "Before context")!.status).toBe("active");
    expect(session.snapshot().messages.some(message => message.body === "Why this unchanged line?")).toBe(true);
  } finally { await session?.dispose(); await rm(root, { recursive: true, force: true }); }
});
