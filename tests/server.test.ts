import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AttachedAgentBridge } from "../src/bridge.ts";
import { captureWorkingTreeSnapshot, createChangePatch, createProposalWorkspace, loadComparison, removeProposalWorkspace } from "../src/git.ts";
import { ProcessError, runProcess } from "../src/process.ts";
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

test("attached bridge long-polls survive beyond Bun's ten-second default", async () => {
  const { bridge, url } = await fixture();
  const startedAt = Date.now();
  const response = await jsonRequest(url, "/api/bridge/events?after=0&waitMs=11000", {
    headers: { "x-review-tour-token": bridge.token },
  });
  expect(response.status).toBe(200);
  expect(Date.now() - startedAt).toBeGreaterThanOrEqual(10_500);
  expect(await response.json()).toEqual({ events: [] });
}, 15_000);

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

test("GitHub review rejection reports the provider response instead of an agent failure", async () => {
  const { comparison, repository, session, url } = await fixture();
  const headers = browserHeaders(url, session.browserToken);
  const head = (await git(repository, "rev-parse", "HEAD")).stdout.trim();
  const base = comparison.mergeBase;
  const runner = async (command: string[], _cwd: string, _accepted: number[] = [0]) => {
    if (command.slice(0, 3).join(" ") === "gh repo view") return { stdout: JSON.stringify({ nameWithOwner: "acme/widgets" }), stderr: "", exitCode: 0 };
    if (command.slice(0, 3).join(" ") === "gh pr view") return { stdout: JSON.stringify({ number: 7, title: "PR", body: "", url: "https://github.com/acme/widgets/pull/7", author: { login: "author" }, baseRefName: "main", baseRefOid: base, headRefName: "feature", headRefOid: head, commits: [], statusCheckRollup: [], reviewDecision: "REVIEW_REQUIRED" }), stderr: "", exitCode: 0 };
    if (command.includes("graphql")) return { stdout: JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false }, nodes: [] } } } } }), stderr: "", exitCode: 0 };
    if (command.at(-1)?.includes("reviews?per_page")) return { stdout: "[]", stderr: "", exitCode: 0 };
    if (command.includes("--method")) throw new ProcessError(command, 1, "gh: Unprocessable Entity (HTTP 422)\n");
    throw new Error(`Unexpected command: ${command.join(" ")}`);
  };
  session.pullRequest = { repository: "acme/widgets", number: 7, url: "https://github.com/acme/widgets/pull/7", title: "PR", body: "", author: "author", baseRefName: "main", baseRefOid: base, headRefName: "feature", headRefOid: head, sourceRepositoryRoot: repository, workspaceRoot: repository, refNamespace: "refs/code-review-tour/test", commits: [], checks: [], threads: [], threadsTruncated: false, updatedAt: new Date().toISOString() };
  (session as unknown as { defaults: { githubRunner?: typeof runner } }).defaults.githubRunner = runner;

  const response = await jsonRequest(url, "/api/github/review", { method: "POST", headers, body: JSON.stringify({ outcome: "accepted", headOid: head, confirm: true }) });

  expect(response.status).toBe(422);
  await expect(response.json()).resolves.toEqual({ error: "GitHub rejected this review (HTTP 422). It was not published. GitHub can reject approvals on your own pull request." });
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

test("serves local Mermaid and bounds authenticated syntax highlighting", async () => {
  const { session, url } = await fixture();
  const headers = browserHeaders(url, session.browserToken);
  const mermaid = await jsonRequest(url, "/mermaid.min.js");
  expect(mermaid.status).toBe(200);
  expect(mermaid.headers.get("content-type")).toContain("text/javascript");
  expect((await mermaid.text()).length).toBeGreaterThan(1_000_000);
  expect((await jsonRequest(url, "/monaco-browser.js")).status).toBe(404);
  expect((await jsonRequest(url, "/")).headers.get("content-security-policy")).not.toContain("worker-src");

  expect((await jsonRequest(url, "/api/highlight", {
    method: "POST", headers: { "content-type": "application/json", origin: url },
    body: JSON.stringify({ groups: [] }),
  })).status).toBe(401);
  const response = await jsonRequest(url, "/api/highlight", {
    method: "POST", headers,
    body: JSON.stringify({ groups: [{ id: "app", path: "app.ts", lines: ["const changed = 2;"] }] }),
  });
  expect(response.status).toBe(200);
  const highlighted = await response.json() as { groups: Array<{ id: string; lines: Array<Array<{ content: string; light: string; dark: string }>> }> };
  expect(highlighted.groups[0]?.id).toBe("app");
  expect(highlighted.groups[0]?.lines[0]?.map((token) => token.content).join("")).toBe("const changed = 2;");
  expect(highlighted.groups[0]?.lines[0]?.every((token) => /^[0-9a-f]{6}$/.test(token.light) && /^[0-9a-f]{6}$/.test(token.dark))).toBe(true);

  const duplicate = await jsonRequest(url, "/api/highlight", {
    method: "POST", headers,
    body: JSON.stringify({ groups: [{ id: "same", path: "a.ts", lines: ["a"] }, { id: "same", path: "b.ts", lines: ["b"] }] }),
  });
  expect(duplicate.status).toBe(422);
});

test("flow edits are validated and exports are authenticated downloadable artifacts", async () => {
  const { repository, session, url } = await fixture();
  const headers = browserHeaders(url, session.browserToken);
  await writeFile(join(repository, "README.md"), "# Exported preview\n\nA **rendered** Markdown document.\n");
  await session.refreshComparison();
  session.outline = {
    title: "<script>Review</script>",
    summary: "Summary",
    phases: [{ id: "behavior", title: "Behavior", summary: "Inspect behavior", fileChanges: [{ path: "app.ts", summary: "Contains behavior" }], steps: [{ id: "step", title: "Step", objective: "Inspect", anchor: { path: "app.ts", side: "new", startLine: 2, endLine: 2 }, explanation: "The complete stop." }] }],
    findings: [],
    callFlows: [],
    flows: [{ id: "flow", title: "Old", summary: "Old", mermaid: "sequenceDiagram\n  A->>B: old", provenance: "partial", blastRadiusSize: 1, affectedFiles: ["app.ts"] }],
  };

  expect((await jsonRequest(url, "/api/export?format=html", { method: "POST" })).status).toBe(401);
  const exported = await jsonRequest(url, "/api/export?format=html", { method: "POST", headers, body: JSON.stringify({ prepareMissingSteps: false, includeFindings: true, includeCallFlows: true, includeDiagrams: false, diffWrap: "wrap" }) });
  expect(exported.status).toBe(200);
  expect(exported.headers.get("content-type")).toContain("text/html");
  expect(exported.headers.get("content-disposition")).toMatch(/attachment; filename="[A-Za-z0-9._-]+-review\.html"/);
  const exportedContent = await exported.text();
  expect(exportedContent).toContain("&lt;script&gt;Review&lt;/script&gt;");
  expect(exportedContent).toContain('class="syntax-token');
  expect(exportedContent).toContain('data-markdown-toggle>Preview</button>');
  expect(exportedContent).toContain("<h1>Exported preview</h1>");
  expect(exportedContent).toContain("A <strong>rendered</strong> Markdown document.");
  expect(exportedContent).not.toContain("mermaid.initialize");
  expect(exportedContent).toContain('<html lang="en" data-diff-wrap="wrap">');

  const invalidExport = await jsonRequest(url, "/api/export?format=html", { method: "POST", headers, body: JSON.stringify({ diffWrap: "fold" }) });
  expect(invalidExport.status).toBe(422);

  const invalid = await jsonRequest(url, "/api/flows/flow", {
    method: "PATCH", headers, body: JSON.stringify({ title: "Flow", summary: "Summary", mermaid: "graph TD\nA-->B", provenance: "verified", blastRadiusSize: 1, affectedFiles: ["app.ts"] }),
  });
  expect(invalid.status).toBe(409);
  const edited = await (await jsonRequest(url, "/api/flows/flow", {
    method: "PATCH", headers, body: JSON.stringify({ title: "Flow", summary: "Updated", mermaid: "sequenceDiagram\n  A->>B: call; safely\n  Note right of B: checked", provenance: "verified", blastRadiusSize: 3, affectedFiles: ["app.ts"] }),
  })).json() as { outline: { flows: Array<{ summary: string; blastRadiusSize: number }> } };
  expect(edited.outline.flows[0]).toMatchObject({ summary: "Updated", blastRadiusSize: 1, affectedFiles: ["app.ts"], mermaid: expect.stringContaining("call&#59; safely") });
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
  const full = await (await jsonRequest(url, "/api/diff?path=app.ts&full=true", { headers })).json() as { full: boolean; file: { path: string } };
  expect(full).toMatchObject({ full: true, file: { path: "app.ts" } });
  expect((await jsonRequest(url, "/api/diff?path=app.ts&full=maybe", { headers })).status).toBe(422);

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
  expect((await answer).message).toBe("Yes");
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

test.each([
  ["feedback", "request-changes"],
  ["accepted", "approve-with-comments"],
])("%s delivers the modal note to the attached agent without inline comments", async (outcome, decision) => {
  const { bridge, session, url } = await fixture();
  const note = "Please preserve the selected file.\nKeep its scroll position too.";
  const response = await jsonRequest(url, "/api/close", {
    method: "POST",
    headers: browserHeaders(url, session.browserToken),
    body: JSON.stringify({ outcome, decision, note }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ outcome, decision, note, comments: [] });
  const eventsResponse = await jsonRequest(url, "/api/bridge/events?after=0&waitMs=0", {
    headers: { "x-review-tour-token": bridge.token },
  });
  expect(eventsResponse.status).toBe(200);
  const { events } = await eventsResponse.json();
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ type: "review.closed", outcome, decision, note, comments: [] });
  if (outcome === "feedback") expect(events[0].reviewedTree).toMatch(/^[a-f0-9]{40}$/);
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
    schemaVersion: 2,
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

test("the default port avoids the ephemeral range local discovery tools skip", async () => {
  const { url } = await fixture();
  expect(Number(new URL(url).port)).toBeLessThan(49152);
});

test("concurrent default servers each take a distinct discoverable port", async () => {
  const first = await fixture();
  const second = await fixture();
  const firstPort = Number(new URL(first.url).port);
  const secondPort = Number(new URL(second.url).port);
  expect(firstPort).not.toBe(secondPort);
  expect(firstPort).toBeLessThan(49152);
  expect(secondPort).toBeLessThan(49152);
});
