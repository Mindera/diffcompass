import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseUnifiedDiff } from "../src/diff.ts";
import { githubSuggestionBody, githubSuggestionRangeMatches } from "../src/github-suggestions.ts";
import { runProcess } from "../src/process.ts";
import { ReviewSession } from "../src/session.ts";
import { loadPersistedSession, savePersistedSession } from "../src/store.ts";
import { createRequestHandler } from "../src/server.ts";
import type { PullRequestContext } from "../src/types.ts";
import type { GitHubRunner } from "../src/github.ts";

const roots: string[] = [];
const sessions: ReviewSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map(session => session.dispose()));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "diffcompass-native-suggestions-")));
  roots.push(root);
  const repository = join(root, "repo"), stateFile = join(root, "review.json");
  await mkdir(repository);
  const git = (...args: string[]) => runProcess(["git", ...args], repository);
  await git("init", "-b", "main");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Suggestion Test");
  const lines = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`);
  await writeFile(join(repository, "file.txt"), lines.join("\n") + "\n");
  await git("add", "file.txt"); await git("commit", "-m", "base");
  const base = (await git("rev-parse", "HEAD")).stdout.trim();
  lines[4] = "changed 5"; lines[5] = "changed 6"; lines[24] = "changed 25";
  const content = lines.join("\n") + "\n";
  await writeFile(join(repository, "file.txt"), content);
  await git("add", "file.txt"); await git("commit", "-m", "feature");
  const head = (await git("rev-parse", "HEAD")).stdout.trim();
  const context: PullRequestContext = { repository: "test/suggestions", number: 7, title: "Suggestions", body: "", author: "author", url: "https://github.com/test/suggestions/pull/7",
    baseRefName: "main", baseRefOid: base, headRefName: "feature", headRefOid: head, sourceRepositoryRoot: repository, workspaceRoot: repository,
    refNamespace: "refs/diffcompass/native-test", commits: [], checks: [], threads: [], threadsTruncated: false, updatedAt: new Date().toISOString() };
  const remote = { head, posts: [] as any[], reviews: [] as any[], loseResponse: false };
  const runner: GitHubRunner = async (command, _cwd, _accepted, options) => {
    let value: unknown;
    if (command.slice(0, 3).join(" ") === "gh repo view") value = { nameWithOwner: context.repository };
    else if (command.slice(0, 3).join(" ") === "gh pr view") value = { ...context, headRefOid: remote.head, author: { login: "author" }, statusCheckRollup: [], reviewDecision: "REVIEW_REQUIRED" };
    else if (command.includes("graphql")) value = { data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false }, nodes: [] } } } } };
    else if (command.at(-1)?.includes("reviews?per_page")) value = remote.reviews;
    else if (command.includes("--method")) {
      const payload = JSON.parse(options?.input ?? "{}"); remote.posts.push(payload);
      value = { id: 77, body: payload.body, html_url: "https://github.com/test/suggestions/pull/7#pullrequestreview-77" };
      remote.reviews.push(value);
      if (remote.loseResponse) throw new Error("Response lost after publication");
    } else throw new Error(`Unexpected GitHub command: ${command.join(" ")}`);
    return { stdout: JSON.stringify(value), stderr: "", exitCode: 0 };
  };
  const defaults = { agentAdapters: [], stateFile, pullRequest: context, githubRunner: runner };
  const session = await ReviewSession.create(repository, base, defaults); sessions.push(session);
  return { session, repository, stateFile, git, head, content, remote, defaults };
}

test("suggestion Markdown preserves multiline replacements, deletion and literal fences", () => {
  expect(githubSuggestionBody("one\ntwo\n")).toBe("```suggestion\none\ntwo\n\n```");
  expect(githubSuggestionBody("")).toBe("```suggestion\n\n```");
  expect(githubSuggestionBody("```ts\nconst x = `value`;\n```\n````")).toBe("`````suggestion\n```ts\nconst x = `value`;\n```\n````\n`````");
});

test("GitHub ranges require matching contiguous After rows in a single hunk", () => {
  const files = parseUnifiedDiff("diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n-old\n+new\n context\n@@ -10 +10 @@\n-before\n+after\n");
  const edit = { path: "f", line: 1, endLine: 2, expectedContent: "new\ncontext", replacement: "x", sourceTree: "a".repeat(40) };
  expect(githubSuggestionRangeMatches(files, edit)).toBe(true);
  for (const invalid of [{ line: 0 }, { line: 1.2 }, { endLine: 10 }, { endLine: 102 }, { expectedContent: "old\ncontext" }, { path: "other" }]) {
    expect(githubSuggestionRangeMatches(files, { ...edit, ...invalid })).toBe(false);
  }
});

test("queueing persists an exact multiline draft, is reversible and never changes local files", async () => {
  const { session, repository, stateFile, content, git, head, remote, defaults } = await fixture();
  const replacement = "changed 5\nextra\nchanged 6"; // Patch inserts only; native anchor must retain both selected lines.
  const proposed = await session.proposeInlineEdit("file.txt", "new", 5, "changed 5\nchanged 6", replacement, 6);
  expect(proposed.session.activities[0]?.canQueueGitHubSuggestion).toBe(true);
  const queued = await session.setSuggestionPublication(proposed.activityId, true, head);
  expect(queued.activities[0]?.changeStatus).toBe("queued");
  expect(queued.comments[0]).toMatchObject({ line: 5, endLine: 6, side: "new", scope: "range", body: githubSuggestionBody(replacement), publishToGitHub: true,
    suggestion: { headOid: head, activityId: proposed.activityId, replacement } });
  await session.setSuggestionPublication(proposed.activityId, true, head);
  expect(session.comments).toHaveLength(1);
  expect(remote.posts).toHaveLength(0);
  expect(await readFile(join(repository, "file.txt"), "utf8")).toBe(content);
  expect((await git("status", "--porcelain")).stdout).toBe("");
  await expect(session.updateActivity(proposed.activityId, "apply")).rejects.toThrow("pending");
  await expect(session.updateActivity(proposed.activityId, "reject")).rejects.toThrow("pending");
  await expect(session.updateComment(session.comments[0]!.id, "changed")).rejects.toThrow("Return this suggestion");
  await expect(session.removeComment(session.comments[0]!.id)).rejects.toThrow("Return to local");
  expect((await loadPersistedSession(stateFile)).comments[0]?.suggestion?.replacement).toBe(replacement);
  const resumed = await ReviewSession.create(repository, session.comparison.base, { ...defaults, resume: true }); sessions.push(resumed);
  await resumed.setSuggestionPublication(proposed.activityId, false);
  expect(resumed.comments).toHaveLength(0);
  expect(resumed.activities[0]).toMatchObject({ changeStatus: "pending", inlineEdit: { replacement } });
  await resumed.updateActivity(proposed.activityId, "apply");
  expect(await readFile(join(repository, "file.txt"), "utf8")).toBe(content.replace("changed 5\nchanged 6", replacement));
});

test.each(["new\nreplacement", "", "```ts\n`value`\n```"])("confirmed native publication emits correct multiline coordinates and replacement %j", async replacement => {
  const { session, repository, head, content, remote } = await fixture();
  const { activityId } = await session.proposeInlineEdit("file.txt", "new", 5, "changed 5\nchanged 6", replacement, 6);
  await session.setSuggestionPublication(activityId, true, head);
  await expect(session.publishPullRequest("feedback", head, "request-changes", undefined, [])).rejects.toThrow("selected review comments changed");
  const fetch = createRequestHandler(session, join(repository, "unused"));
  const request = (confirm: boolean, headOid = head) => fetch(new Request("http://127.0.0.1/api/github/review", { method: "POST", headers: {
    "content-type": "application/json", origin: "http://127.0.0.1", "x-diffcompass-token": session.browserToken,
  }, body: JSON.stringify({ outcome: "feedback", confirm, headOid }) }));
  expect((await request(false)).status).toBe(422);
  expect((await request(true, "a".repeat(40))).status).toBe(409);
  expect(remote.posts).toHaveLength(0);
  const response = await request(true);
  expect(response.status).toBe(200);
  expect(remote.posts).toHaveLength(1);
  expect(remote.posts[0]).toMatchObject({ commit_id: head, event: "REQUEST_CHANGES", comments: [{ path: "file.txt", side: "RIGHT", line: 6, start_line: 5, start_side: "RIGHT", body: githubSuggestionBody(replacement) }] });
  expect(await readFile(join(repository, "file.txt"), "utf8")).toBe(content);
});

test("single-line suggestions omit range fields and recover a lost publication response without duplicates", async () => {
  const { session, stateFile, head, remote, defaults, repository } = await fixture();
  const { activityId } = await session.proposeInlineEdit("file.txt", "new", 5, "changed 5", "new");
  await session.setSuggestionPublication(activityId, true, head);
  remote.loseResponse = true;
  await expect(session.publishPullRequest("feedback", head)).rejects.toThrow("Response lost");
  expect(remote.posts[0].comments).toEqual([{ path: "file.txt", line: 5, side: "RIGHT", body: githubSuggestionBody("new") }]);
  expect((await loadPersistedSession(stateFile)).pullRequest?.publication?.status).toBe("pending");
  await expect(session.setSuggestionPublication(activityId, false)).rejects.toThrow("publication has started");
  const resumed = await ReviewSession.create(repository, session.comparison.base, { ...defaults, resume: true }); sessions.push(resumed);
  await resumed.publishPullRequest("feedback", head);
  expect(remote.posts).toHaveLength(1);
  expect(resumed.status).toBe("feedback");
});

test("draft eligibility rejects expanded context, cross-hunk ranges and oversized bodies without removing local edits", async () => {
  const { session, head } = await fixture();
  for (const [line, endLine, expected, replacement] of [
    [15, 15, "line 15", "new"],
    [5, 25, Array.from({ length: 21 }, (_, i) => i === 0 ? "changed 5" : i === 1 ? "changed 6" : i === 20 ? "changed 25" : `line ${i + 5}`).join("\n"), "new"],
    [5, 5, "changed 5", "x".repeat(8_000)],
  ] as const) {
    const result = await session.proposeInlineEdit("file.txt", "new", line, expected, replacement, endLine);
    const draft = result.session.activities.find(activity => activity.id === result.activityId)!;
    expect(draft.canQueueGitHubSuggestion).toBe(false);
    expect(draft.changeStatus).toBe("pending");
    await expect(session.setSuggestionPublication(result.activityId, true, head)).rejects.toThrow();
  }
  expect(session.comments).toHaveLength(0);
});

test("stale PR head, changed captured source and changed queued replacement fail closed at publication", async () => {
  const { session, head, remote } = await fixture();
  const { activityId } = await session.proposeInlineEdit("file.txt", "new", 5, "changed 5", "new");
  await expect(session.setSuggestionPublication(activityId, true, "a".repeat(40))).rejects.toThrow("outdated");
  await session.setSuggestionPublication(activityId, true, head);
  const comment = session.comments[0]!;
  comment.body = "changed body";
  await expect(session.publishPullRequest("feedback", head)).rejects.toThrow("saved replacement");
  comment.body = githubSuggestionBody("new");
  const tree = session.comparison.sourceTree;
  session.comparison.sourceTree = "a".repeat(40);
  await expect(session.publishPullRequest("feedback", head)).rejects.toThrow("outdated PR source");
  session.comparison.sourceTree = tree;
  remote.head = "b".repeat(40);
  await expect(session.publishPullRequest("feedback", head)).rejects.toThrow("changed on GitHub");
  expect(remote.posts).toHaveLength(0);
});

test("non-PR and locally changed PR drafts remain local; persisted malformed suggestions are rejected", async () => {
  const { session, head, repository, stateFile } = await fixture();
  await writeFile(join(repository, "file.txt"), (await readFile(join(repository, "file.txt"), "utf8")).replace("changed 5", "local 5"));
  const result = await session.proposeInlineEdit("file.txt", "new", 5, "local 5", "new");
  expect(result.session.activities[0]?.canQueueGitHubSuggestion).toBe(false);
  await expect(session.setSuggestionPublication(result.activityId, true, head)).rejects.toThrow();
  session.pullRequest = undefined;
  await expect(session.setSuggestionPublication(result.activityId, true, head)).rejects.toThrow();
  const persisted = await loadPersistedSession(stateFile);
  persisted.activities![0]!.inlineEdit!.line = 0;
  await savePersistedSession(stateFile, persisted);
  await expect(loadPersistedSession(stateFile)).rejects.toThrow();
});

test("queue and return endpoints enforce authentication, input shape and captured source identity", async () => {
  const { session, head, repository, remote } = await fixture();
  const { activityId } = await session.proposeInlineEdit("file.txt", "new", 5, "changed 5", "new");
  const fetch = createRequestHandler(session, join(repository, "unused"));
  const request = (body: unknown, extra: Record<string, string> = {}) => fetch(new Request(`http://127.0.0.1/api/activities/${activityId}/github`, {
    method: "POST", headers: { "content-type": "application/json", origin: "http://127.0.0.1", "x-diffcompass-token": session.browserToken, ...extra }, body: JSON.stringify(body),
  }));
  expect((await request({ queue: true, headOid: head }, { "x-diffcompass-token": "wrong" })).status).toBe(401);
  expect((await request({ queue: "true", headOid: head })).status).toBe(422);
  expect((await request({ queue: true })).status).toBe(422);
  expect((await request({ queue: true, headOid: head, replacement: "injected" })).status).toBe(422);
  expect((await request({ queue: true, headOid: head }, { "x-diffcompass-comparison": "stale" })).status).toBe(409);
  expect((await request({ queue: true, headOid: head })).status).toBe(200);
  expect((await request({ queue: true, headOid: head })).status).toBe(200);
  expect(session.comments).toHaveLength(1);
  expect((await request({ queue: false })).status).toBe(200);
  expect(session.comments).toHaveLength(0);
  expect(remote.posts).toHaveLength(0);
});

test("failed draft persistence rolls queue and return mutations back together", async () => {
  const { session, head } = await fixture();
  const { activityId } = await session.proposeInlineEdit("file.txt", "new", 5, "changed 5", "new");
  const internals = session as unknown as { persist(): Promise<void> };
  const persist = internals.persist.bind(session);
  const fail = async () => { throw new Error("Storage unavailable"); };
  internals.persist = fail;
  await expect(session.setSuggestionPublication(activityId, true, head)).rejects.toThrow("Storage unavailable");
  expect(session.activities[0]?.changeStatus).toBe("pending");
  expect(session.comments).toHaveLength(0);
  internals.persist = persist;
  await session.setSuggestionPublication(activityId, true, head);
  internals.persist = fail;
  await expect(session.setSuggestionPublication(activityId, false)).rejects.toThrow("Storage unavailable");
  expect(session.activities[0]?.changeStatus).toBe("queued");
  expect(session.comments).toHaveLength(1);
  internals.persist = persist;
});
