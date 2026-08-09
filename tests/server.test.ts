import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AttachedAgentBridge } from "../src/bridge.ts";
import { captureWorkingTreeSnapshot, createChangePatch, createProposalWorkspace, loadComparison, removeProposalWorkspace } from "../src/git.ts";
import { runProcess } from "../src/process.ts";
import { startServer } from "../src/server.ts";
import { ReviewSession } from "../src/session.ts";
import { savePersistedSession } from "../src/store.ts";
import type { PersistedReviewSession } from "../src/types.ts";

const repositories: string[] = [];
const servers: Array<ReturnType<typeof startServer>> = [];

afterEach(async () => {
  for (const server of servers.splice(0)) server.stop(true);
  await Promise.all(repositories.splice(0).map((repository) => rm(repository, { recursive: true, force: true })));
});

async function git(cwd: string, ...args: string[]) {
  return runProcess(["git", ...args], cwd);
}

type ReviewSessionConstructor = new (
  comparison: Awaited<ReturnType<typeof loadComparison>>,
  adapters: [],
  defaults: Record<string, never>,
  bridge: AttachedAgentBridge,
) => ReviewSession;

async function fixture() {
  const repository = await mkdtemp(join(tmpdir(), "review-tour-server-"));
  repositories.push(repository);
  await git(repository, "init", "-b", "main");
  await git(repository, "config", "user.name", "Review Tour Test");
  await git(repository, "config", "user.email", "review-tour@example.test");
  await writeFile(join(repository, "app.ts"), "const base = 1;\n");
  await git(repository, "add", "app.ts");
  await git(repository, "commit", "-m", "base");
  const base = (await git(repository, "rev-parse", "HEAD")).stdout.trim();
  await git(repository, "update-ref", "refs/remotes/origin/main", base);
  await git(repository, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  await git(repository, "switch", "-c", "feature");
  await writeFile(join(repository, "app.ts"), "const base = 1;\nconst changed = 2;\n");

  const comparison = await loadComparison(repository);
  const bridge = new AttachedAgentBridge("bridge-token-0123456789");
  const session = new (ReviewSession as unknown as ReviewSessionConstructor)(comparison, [], {}, bridge);
  const server = startServer(session, 0, join(repository, ".test-sessions"));
  servers.push(server);
  const url = `http://${server.hostname}:${server.port}`;
  return { bridge, comparison, repository, session, url };
}

function browserHeaders(url: string, token: string, headers: HeadersInit = {}): Headers {
  return new Headers({
    "content-type": "application/json",
    "origin": url,
    "x-review-tour-token": token,
    ...headers,
  });
}

async function jsonRequest(url: string, path: string, init: RequestInit = {}) {
  return fetch(`${url}${path}`, init);
}

test("browser and bridge endpoints require their own non-interchangeable token", async () => {
  const { bridge, session, url } = await fixture();

  expect((await jsonRequest(url, "/api/session")).status).toBe(401);
  expect((await jsonRequest(url, "/api/session", {
    headers: { "x-review-tour-token": bridge.token },
  })).status).toBe(401);
  expect((await jsonRequest(url, "/api/session", {
    headers: { "x-review-tour-token": session.browserToken },
  })).status).toBe(200);

  expect((await jsonRequest(url, "/api/bridge/context", {
    headers: { "x-review-tour-token": session.browserToken },
  })).status).toBe(401);
  expect((await jsonRequest(url, "/api/bridge/context", {
    headers: { "x-review-tour-token": bridge.token },
  })).status).toBe(200);
});

test("GitHub publication requires confirmation, current head, and uses only selected comments", async () => {
  const { comparison, repository, session, url } = await fixture();
  const headers = browserHeaders(url, session.browserToken);
  const head = (await git(repository, "rev-parse", "HEAD")).stdout.trim();
  const base = comparison.mergeBase;
  let publishedPayload: Record<string, unknown> | undefined;
  const runner = async (command: string[], _cwd: string, _accepted: number[] = [0], options: { input?: string } = {}) => {
    let value: unknown;
    if (command.slice(0, 3).join(" ") === "gh repo view") value = { nameWithOwner: "acme/widgets" };
    else if (command.slice(0, 3).join(" ") === "gh pr view") value = { number: 7, title: "PR", body: "", url: "https://github.com/acme/widgets/pull/7", author: { login: "author" }, baseRefName: "main", baseRefOid: base, headRefName: "feature", headRefOid: head, commits: [], statusCheckRollup: [], reviewDecision: "REVIEW_REQUIRED" };
    else if (command.includes("graphql")) value = { data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false }, nodes: [] } } } } };
    else if (command.at(-1)?.includes("reviews?per_page")) value = [];
    else if (command.includes("--method")) { publishedPayload = JSON.parse(options.input ?? "{}"); value = { id: 77 }; }
    else throw new Error(`Unexpected command: ${command.join(" ")}`);
    return { stdout: JSON.stringify(value), stderr: "", exitCode: 0 };
  };
  session.pullRequest = { repository: "acme/widgets", number: 7, url: "https://github.com/acme/widgets/pull/7", title: "PR", body: "", author: "author", baseRefName: "main", baseRefOid: base, headRefName: "feature", headRefOid: head, sourceRepositoryRoot: repository, workspaceRoot: repository, refNamespace: "refs/code-review-tour/test", commits: [], checks: [], threads: [], threadsTruncated: false, updatedAt: new Date().toISOString() };
  (session as unknown as { defaults: { githubRunner?: typeof runner } }).defaults.githubRunner = runner;

  const added = await (await jsonRequest(url, "/api/comments", { method: "POST", headers, body: JSON.stringify({ path: "app.ts", side: "new", line: 2, body: "Fix this" }) })).json() as { comments: Array<{ id: string }> };
  const commentId = added.comments[0].id;
  expect((await jsonRequest(url, "/api/github/review", { method: "POST", headers, body: JSON.stringify({ outcome: "feedback", headOid: head, confirm: false }) })).status).toBe(422);
  expect((await jsonRequest(url, "/api/github/review", { method: "POST", headers, body: JSON.stringify({ outcome: "feedback", headOid: "0".repeat(40), confirm: true }) })).status).toBe(409);
  expect((await jsonRequest(url, "/api/close", { method: "POST", headers, body: JSON.stringify({ outcome: "feedback" }) })).status).toBe(409);
  const deselected = await jsonRequest(url, `/api/comments/${commentId}/github`, { method: "PATCH", headers, body: JSON.stringify({ publish: false }) });
  expect(deselected.status).toBe(200);
  const published = await jsonRequest(url, "/api/github/review", { method: "POST", headers, body: JSON.stringify({ outcome: "feedback", headOid: head, confirm: true }) });
  expect(published.status).toBe(200);
  expect(publishedPayload).toMatchObject({ commit_id: head, event: "REQUEST_CHANGES", comments: [] });
});

test("serves the early theme bootstrap before the stylesheet", async () => {
  const { url } = await fixture();
  const page = await (await jsonRequest(url, "/")).text();
  const theme = await jsonRequest(url, "/theme.js");

  expect(theme.status).toBe(200);
  expect(theme.headers.get("content-type")).toContain("text/javascript");
  expect(await theme.text()).toContain("prefers-color-scheme: dark");
  expect(page.indexOf('src="/theme.js"')).toBeGreaterThan(-1);
  expect(page.indexOf('src="/theme.js"')).toBeLessThan(page.indexOf('href="/styles.css"'));
});

test("flow edits are validated and exports are authenticated downloadable artifacts", async () => {
  const { session, url } = await fixture();
  const headers = browserHeaders(url, session.browserToken);
  session.outline = {
    title: "<script>Review</script>",
    summary: "Summary",
    steps: [{ id: "step", title: "Step", objective: "Inspect", anchor: { path: "app.ts", side: "new", startLine: 2, endLine: 2 } }],
    findings: [],
    flows: [{ id: "flow", title: "Old", summary: "Old", mermaid: "sequenceDiagram\n  A->>B: old", provenance: "partial", blastRadiusSize: 2 }],
  };

  expect((await jsonRequest(url, "/api/export?format=html")).status).toBe(401);
  const exported = await jsonRequest(url, "/api/export?format=html", { headers });
  expect(exported.status).toBe(200);
  expect(exported.headers.get("content-type")).toContain("text/html");
  expect(exported.headers.get("content-disposition")).toMatch(/attachment; filename="[A-Za-z0-9._-]+-review\.html"/);
  expect(await exported.text()).toContain("&lt;script&gt;Review&lt;/script&gt;");

  const invalid = await jsonRequest(url, "/api/flows/flow", {
    method: "PATCH", headers, body: JSON.stringify({ title: "Flow", summary: "Summary", mermaid: "graph TD\nA-->B", provenance: "verified", blastRadiusSize: 1 }),
  });
  expect(invalid.status).toBe(409);
  const edited = await (await jsonRequest(url, "/api/flows/flow", {
    method: "PATCH", headers, body: JSON.stringify({ title: "Flow", summary: "Updated", mermaid: "sequenceDiagram\n  A->>B: call\n  Note right of B: checked", provenance: "verified", blastRadiusSize: 3 }),
  })).json() as { outline: { flows: Array<{ summary: string; blastRadiusSize: number }> } };
  expect(edited.outline.flows[0]).toMatchObject({ summary: "Updated", blastRadiusSize: 3 });
});

test("diff ergonomics API searches changes, expands context, and persists reviewed files", async () => {
  const { session, url } = await fixture();
  const headers = browserHeaders(url, session.browserToken);

  const search = await (await jsonRequest(url, "/api/diff/search?q=changed&status=modified", { headers })).json() as { paths: string[] };
  expect(search.paths).toEqual(["app.ts"]);
  const statusOnly = await (await jsonRequest(url, "/api/diff/search?status=modified", { headers })).json() as { paths: string[] };
  expect(statusOnly.paths).toEqual(["app.ts"]);
  expect((await jsonRequest(url, "/api/diff/search?q=changed&status=unknown", { headers })).status).toBe(422);

  const expanded = await (await jsonRequest(url, "/api/diff?path=app.ts&context=25", { headers })).json() as { context: number; file: { path: string } };
  expect(expanded).toMatchObject({ context: 25, file: { path: "app.ts" } });

  const reviewed = await (await jsonRequest(url, "/api/files/reviewed", {
    method: "POST", headers, body: JSON.stringify({ path: "app.ts", reviewed: true }),
  })).json() as { reviewedFiles: string[] };
  expect(reviewed.reviewedFiles).toEqual(["app.ts"]);
  const unreviewed = await (await jsonRequest(url, "/api/files/reviewed", {
    method: "POST", headers, body: JSON.stringify({ path: "app.ts", reviewed: false }),
  })).json() as { reviewedFiles: string[] };
  expect(unreviewed.reviewedFiles).toEqual([]);
});

test("bridge responses require the active event lease", async () => {
  const { bridge, url } = await fixture();
  const answer = bridge.send("Explain", "tour.explanation");
  const eventResponse = await jsonRequest(url, "/api/bridge/events?after=0", {
    headers: { "x-review-tour-token": bridge.token },
  });
  const { events } = await eventResponse.json() as { events: Array<{ id: string; leaseId: string }> };
  const event = events[0]!;
  const headers = { "content-type": "application/json", "x-review-tour-token": bridge.token };

  expect((await jsonRequest(url, "/api/bridge/respond", {
    method: "POST", headers, body: JSON.stringify({ eventId: event.id, leaseId: "wrong", message: "No" }),
  })).status).toBe(409);
  expect((await jsonRequest(url, "/api/bridge/renew", {
    method: "POST", headers, body: JSON.stringify({ eventId: event.id, leaseId: event.leaseId }),
  })).status).toBe(200);
  expect((await jsonRequest(url, "/api/bridge/respond", {
    method: "POST", headers, body: JSON.stringify({ eventId: event.id, leaseId: event.leaseId, message: "Yes" }),
  })).status).toBe(200);
  await expect(answer).resolves.toBe("Yes");
});

test("a same-code-unit Unicode token mismatch is rejected as unauthorized rather than crashing", async () => {
  const { session, url } = await fixture();
  (session as { browserToken: string }).browserToken = "é";

  const response = await jsonRequest(url, "/api/session", {
    headers: { "x-review-tour-token": "a" },
  });
  expect(response.status).toBe(401);
});

test("browser mutations require an authenticated same-origin JSON request", async () => {
  const { session, url } = await fixture();
  const validComment = { path: "app.ts", side: "new", line: 2, body: "Explain this branch." };

  expect((await jsonRequest(url, "/api/comments", {
    method: "POST",
    headers: { "content-type": "application/json", "x-review-tour-token": session.browserToken },
    body: JSON.stringify(validComment),
  })).status).toBe(403);
  expect((await jsonRequest(url, "/api/comments", {
    method: "POST",
    headers: browserHeaders(url, session.browserToken, { origin: "http://attacker.invalid" }),
    body: JSON.stringify(validComment),
  })).status).toBe(403);
  expect((await jsonRequest(url, "/api/comments", {
    method: "POST",
    headers: browserHeaders(url, session.browserToken),
    body: JSON.stringify(validComment),
  })).status).toBe(200);
});

test("comment API rejects malformed bodies and anchors outside the diff", async () => {
  const { session, url } = await fixture();
  const headers = browserHeaders(url, session.browserToken);

  expect((await jsonRequest(url, "/api/comments", {
    method: "POST",
    headers: browserHeaders(url, session.browserToken, { "content-type": "text/plain" }),
    body: "not json",
  })).status).toBe(415);
  expect((await jsonRequest(url, "/api/comments", {
    method: "POST",
    headers,
    body: JSON.stringify({ path: "app.ts", side: "new", line: 2, body: "Note", unexpected: true }),
  })).status).toBe(422);
  expect((await jsonRequest(url, "/api/comments", {
    method: "POST",
    headers,
    body: JSON.stringify({ path: "app.ts", side: "new", line: 2, body: "x".repeat(20_000) }),
  })).status).toBe(413);
  expect((await jsonRequest(url, "/api/comments", {
    method: "POST",
    headers,
    body: JSON.stringify({ path: "missing.ts", side: "new", line: 1, body: "Fake feedback" }),
  })).status).toBe(409);
  expect((await jsonRequest(url, "/api/comments", {
    method: "POST",
    headers,
    body: JSON.stringify({ path: "app.ts", side: "old", line: 200, body: "Bad line" }),
  })).status).toBe(409);
});

test("close is terminal while an identical close remains idempotent", async () => {
  const { session, url } = await fixture();
  const headers = browserHeaders(url, session.browserToken);

  expect((await jsonRequest(url, "/api/close", {
    method: "POST",
    headers,
    body: JSON.stringify({ outcome: "accepted" }),
  })).status).toBe(200);
  expect((await jsonRequest(url, "/api/close", {
    method: "POST",
    headers,
    body: JSON.stringify({ outcome: "accepted" }),
  })).status).toBe(200);
  expect((await jsonRequest(url, "/api/close", {
    method: "POST",
    headers,
    body: JSON.stringify({ outcome: "feedback" }),
  })).status).toBe(409);
  expect((await jsonRequest(url, "/api/comments", {
    method: "POST",
    headers,
    body: JSON.stringify({ path: "app.ts", side: "new", line: 2, body: "Too late" }),
  })).status).toBe(409);
});

test("activity API previews, applies, and undoes an isolated proposal", async () => {
  const { repository, session, url } = await fixture();
  const workspace = await createProposalWorkspace(repository);
  await writeFile(join(workspace.path, "app.ts"), "const base = 1;\nconst proposed = 7;\n");
  const result = await captureWorkingTreeSnapshot(workspace.path);
  const patch = await createChangePatch(workspace.path, workspace.tree, result.tree);
  await removeProposalWorkspace(repository, workspace);
  session.activities.push({
    id: "activity-1",
    requestMessageId: "message-1",
    request: "Change the implementation.",
    adapterId: "attached",
    modelId: "current-session",
    files: [{ path: "app.ts", change: "modified", before: { status: "modified", additions: 1, deletions: 0 }, after: { status: "modified", additions: 1, deletions: 0 } }],
    verification: "checked",
    status: "verified",
    changeStatus: "pending",
    proposal: { patch, baselineTree: workspace.tree, resultTree: result.tree },
    createdAt: "2026-08-09T10:00:00.000Z",
    updatedAt: "2026-08-09T10:00:00.000Z",
  });
  const headers = browserHeaders(url, session.browserToken);

  const browserSnapshot = await (await jsonRequest(url, "/api/session", { headers })).json() as { activities: Array<{ proposal?: unknown; changeStatus?: string }> };
  expect(browserSnapshot.activities[0]).toMatchObject({ changeStatus: "pending" });
  expect(browserSnapshot.activities[0]!.proposal).toBeUndefined();
  expect((await jsonRequest(url, "/api/activities/activity-1/diff?path=app.ts")).status).toBe(401);
  const preview = await (await jsonRequest(url, "/api/activities/activity-1/diff?path=app.ts", { headers })).json() as { file: { hunks: Array<{ rows: Array<{ content: string }> }> } };
  expect(preview.file.hunks.flatMap((hunk) => hunk.rows).some((row) => row.content.includes("proposed = 7"))).toBe(true);
  expect((await jsonRequest(url, "/api/close", { method: "POST", headers, body: JSON.stringify({ outcome: "accepted" }) })).status).toBe(409);

  expect((await jsonRequest(url, "/api/activities/activity-1", { method: "POST", headers, body: JSON.stringify({ action: "apply" }) })).status).toBe(200);
  expect(await readFile(join(repository, "app.ts"), "utf8")).toContain("proposed = 7");
  expect((await jsonRequest(url, "/api/activities/activity-1", { method: "POST", headers, body: JSON.stringify({ action: "undo" }) })).status).toBe(200);
  expect(await readFile(join(repository, "app.ts"), "utf8")).toContain("changed = 2");
});

test("session library API lists, renames, archives, and explicitly deletes sessions", async () => {
  const { repository, session, url } = await fixture();
  const directory = join(repository, ".test-sessions");
  const state: PersistedReviewSession = {
    schemaVersion: 1,
    repositoryRoot: repository,
    base: "origin/main",
    browserToken: "another-browser-token",
    currentStepIndex: -1,
    comments: [],
    messages: [],
    revision: 1,
    status: "open",
    updatedAt: "2026-08-09T10:00:00.000Z",
  };
  await savePersistedSession(join(directory, "cccccccc-3333.json"), state);
  const headers = browserHeaders(url, session.browserToken);

  const listed = await (await jsonRequest(url, "/api/sessions", { headers })).json() as { sessions: Array<{ id: string; name: string }> };
  expect(listed.sessions).toEqual([expect.objectContaining({ id: "cccccccc-3333" })]);

  expect((await jsonRequest(url, "/api/sessions/cccc", {
    method: "PATCH", headers, body: JSON.stringify({ action: "rename", name: "API review" }),
  })).status).toBe(200);
  expect((await jsonRequest(url, "/api/sessions/cccc", {
    method: "PATCH", headers, body: JSON.stringify({ action: "archive" }),
  })).status).toBe(200);
  const archived = await (await jsonRequest(url, "/api/sessions?all=true", { headers })).json() as { sessions: Array<{ name: string; archived: boolean }> };
  expect(archived.sessions).toEqual([expect.objectContaining({ name: "API review", archived: true })]);

  expect((await jsonRequest(url, "/api/sessions/cccc", {
    method: "DELETE", headers, body: JSON.stringify({ confirm: false }),
  })).status).toBe(422);
  expect((await jsonRequest(url, "/api/sessions/cccc", {
    method: "DELETE", headers, body: JSON.stringify({ confirm: true }),
  })).status).toBe(200);
  const empty = await (await jsonRequest(url, "/api/sessions?all=true", { headers })).json() as { sessions: unknown[] };
  expect(empty.sessions).toEqual([]);
});
