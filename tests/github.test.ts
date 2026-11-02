import { afterEach, expect, test } from "bun:test";
import { access, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPullRequestWorkspace, extractAcceptanceCriteria, loadPullRequestContext, parsePullRequestIdentifier, publishPullRequestReview, removePullRequestWorkspace, updatePullRequestWorkspace, type GitHubRunner } from "../src/github.ts";
import { runProcess } from "../src/process.ts";
import { ReviewSession } from "../src/session.ts";
import { loadPersistedSession } from "../src/store.ts";
import { pruneReviewSessions } from "../src/session-library.ts";
import type { PullRequestContext, ReviewComment } from "../src/types.ts";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

test("pull request identifiers reject ambiguous and hostile inputs", () => {
  expect(parsePullRequestIdentifier("106")).toEqual({ number: 106 });
  expect(parsePullRequestIdentifier("https://github.com/Mindera/FPR/pull/106")).toEqual({ repository: "Mindera/FPR", number: 106 });
  for (const value of ["0", "-1", "106 --repo evil/x", "http://github.com/a/b/pull/1", "https://evil.test/a/b/pull/1", "https://user@github.com/a/b/pull/1", "https://github.com/a/b/pull/1?q=x", "https://github.com/a/b/issues/1"]) {
    expect(() => parsePullRequestIdentifier(value)).toThrow();
  }
});

function metadata(head = "b".repeat(40), base = "a".repeat(40)) {
  return {
    number: 7, title: "Safe PR", body: "Description", url: "https://github.com/acme/widgets/pull/7", author: { login: "author" },
    baseRefName: "main", baseRefOid: base, headRefName: "feature", headRefOid: head,
    commits: [{ oid: head, messageHeadline: "change", authors: [{ login: "author" }] }],
    statusCheckRollup: [{ name: "test", conclusion: "SUCCESS", detailsUrl: "https://github.com/acme/widgets/actions" }], reviewDecision: "REVIEW_REQUIRED",
  };
}

function githubRunner(options: { head?: string; base?: string; localRepository?: string; reviews?: unknown[]; threads?: unknown[]; post?: (body: string) => void } = {}): GitHubRunner {
  return (async (command, _cwd, _accepted, processOptions) => {
    let value: unknown;
    if (command.slice(0, 3).join(" ") === "gh repo view") value = { nameWithOwner: options.localRepository ?? "acme/widgets" };
    else if (command.slice(0, 3).join(" ") === "gh pr view") value = metadata(options.head, options.base);
    else if (command.includes("graphql")) value = { data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false }, nodes: options.threads ?? [] } } } } };
    else if (command.at(-1)?.includes("reviews?per_page")) value = options.reviews ?? [];
    else if (command.includes("--method")) { options.post?.(processOptions?.input ?? ""); value = { id: 42, html_url: "https://github.com/acme/widgets/pull/7#pullrequestreview-42" }; }
    else throw new Error(`Unexpected command: ${command.join(" ")}`);
    return { stdout: JSON.stringify(value), stderr: "", exitCode: 0 };
  }) as GitHubRunner;
}

test("metadata loading fails closed on repository mismatch and invalid JSON", async () => {
  await expect(loadPullRequestContext("/tmp", "https://github.com/acme/widgets/pull/7", undefined, githubRunner({ localRepository: "other/repo" }))).rejects.toThrow("belongs to acme/widgets");
  const invalid = (async () => ({ stdout: "{", stderr: "", exitCode: 0 })) as GitHubRunner;
  await expect(loadPullRequestContext("/tmp", "7", undefined, invalid)).rejects.toThrow("invalid JSON");
  const malformedThreads = (async (command, cwd, accepted, options) => command.includes("graphql")
    ? { stdout: JSON.stringify({ data: {} }), stderr: "", exitCode: 0 }
    : githubRunner()(command, cwd, accepted, options)) as GitHubRunner;
  await expect(loadPullRequestContext("/tmp", "7", undefined, malformedThreads)).rejects.toThrow("review threads");
  const missingCommits = (async (command, cwd, accepted, options) => command.slice(0, 3).join(" ") === "gh pr view"
    ? { stdout: JSON.stringify({ ...metadata(), commits: null }), stderr: "", exitCode: 0 }
    : githubRunner()(command, cwd, accepted, options)) as GitHubRunner;
  await expect(loadPullRequestContext("/tmp", "7", undefined, missingCommits)).rejects.toThrow("commits or checks");
});

test("metadata loading preserves mergeability for review briefings", async () => {
  const context = await loadPullRequestContext("/tmp", "7", undefined, githubRunner());
  expect(context.state).toBeUndefined();
  expect(context.mergeable).toBeUndefined();
  expect(context.mergeStateStatus).toBeUndefined();
  const runner = githubRunner();
  const withMergeability = (async (command, cwd, accepted, options) => {
    const result = await runner(command, cwd, accepted, options);
    if (command.slice(0, 3).join(" ") === "gh pr view") result.stdout = JSON.stringify({ ...metadata(), mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" });
    return result;
  }) as GitHubRunner;
  const loaded = await loadPullRequestContext("/tmp", "7", undefined, withMergeability);
  expect(loaded).toMatchObject({ mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" });

  const merged = (async (command, cwd, accepted, options) => {
    const result = await runner(command, cwd, accepted, options);
    if (command.slice(0, 3).join(" ") === "gh pr view") result.stdout = JSON.stringify({ ...metadata(), state: "MERGED", mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" });
    return result;
  }) as GitHubRunner;
  expect((await loadPullRequestContext("/tmp", "7", undefined, merged)).state).toBe("MERGED");

  const inProgress = (async (command, cwd, accepted, options) => {
    const result = await runner(command, cwd, accepted, options);
    if (command.slice(0, 3).join(" ") === "gh pr view") result.stdout = JSON.stringify({ ...metadata(), statusCheckRollup: [{ name: "CI", conclusion: "", status: "IN_PROGRESS" }] });
    return result;
  }) as GitHubRunner;
  expect((await loadPullRequestContext("/tmp", "7", undefined, inProgress)).checks).toEqual([{ name: "CI", state: "IN_PROGRESS", url: undefined }]);
});

test("metadata loading keeps the original review-thread location after its diff anchor is outdated", async () => {
  const context = await loadPullRequestContext("/tmp", "7", undefined, githubRunner({
    threads: [{
      id: "thread-1", isResolved: true, path: "feature/legal/LegalDataMapper.kt",
      line: null, startLine: null, diffSide: "RIGHT",
      originalLine: 42, originalStartLine: null,
      comments: { nodes: [{ id: "comment-1", author: { login: "reviewer" }, body: "Please simplify this.", url: "https://github.com/acme/widgets/pull/7#discussion_r1" }] },
    }],
  }));

  expect(context.threads).toEqual([expect.objectContaining({
    id: "thread-1", path: "feature/legal/LegalDataMapper.kt", line: 42, side: "new", resolved: true, outdated: true,
  })]);
});

test("metadata loading keeps usable commit author labels when GitHub leaves logins blank", async () => {
  const runner = githubRunner();
  const blankLogin = (async (command, cwd, accepted, options) => {
    const result = await runner(command, cwd, accepted, options);
    if (command.slice(0, 3).join(" ") === "gh pr view") {
      result.stdout = JSON.stringify({
        ...metadata(),
        commits: [{ oid: "b".repeat(40), messageHeadline: "change", authors: [{ login: "", name: "Pedro Seruca" }, { login: "", name: "" }, null] }],
      });
    }
    return result;
  }) as GitHubRunner;

  expect((await loadPullRequestContext("/tmp", "7", undefined, blankLogin)).commits).toEqual([
    { oid: "b".repeat(40), headline: "change", authors: ["Pedro Seruca"] },
  ]);
});

test("extracts only bounded explicit acceptance criteria", () => {
  expect(extractAcceptanceCriteria(`# Acceptance Criteria\n\n- [ ] Users can retry a failed request\n- [x] Errors include a request id\n\nImplementation notes\n- This is not a criterion`)).toEqual([
    { id: "criterion-1", text: "Users can retry a failed request" },
    { id: "criterion-2", text: "Errors include a request id" },
  ]);
  expect(extractAcceptanceCriteria("AC1: Return a stable error\nAC2 - Preserve the original status")).toEqual([
    { id: "criterion-1", text: "Return a stable error" },
    { id: "criterion-2", text: "Preserve the original status" },
  ]);
  expect(extractAcceptanceCriteria("Goal: Render legal documents\n\nAC:\n- A profile CTA opens each document\n- Content comes from the CMS")).toEqual([
    { id: "criterion-1", text: "A profile CTA opens each document" },
    { id: "criterion-2", text: "Content comes from the CMS" },
  ]);
  expect(extractAcceptanceCriteria("# Implementation checklist\n- [ ] Ship the feature\n\n## Notes\n- [ ] This is not an acceptance criterion")).toEqual([]);
  expect(extractAcceptanceCriteria("## Acceptance Criteria\n- [ ] A request can be retried\n  - [ ] Add a retry metric\n- [ ] Errors include a request id")).toEqual([
    { id: "criterion-1", text: "A request can be retried" },
    { id: "criterion-2", text: "Errors include a request id" },
  ]);
  expect(extractAcceptanceCriteria("No explicit acceptance criteria here")).toEqual([]);
  expect(extractAcceptanceCriteria(`\u0000${"x".repeat(100_000)}`)).toEqual([]);
});

test("loads one same-repository linked issue and degrades when issue access is unavailable", async () => {
  const commands: string[][] = [];
  const runner = (async (command, cwd, accepted, options) => {
    commands.push(command);
    if (command.slice(0, 3).join(" ") === "gh repo view") return { stdout: JSON.stringify({ nameWithOwner: "acme/widgets" }), stderr: "", exitCode: 0 };
    if (command.slice(0, 3).join(" ") === "gh pr view") return { stdout: JSON.stringify({ ...metadata(), closingIssuesReferences: [{ number: 12, title: "Retry requests", url: "https://github.com/acme/widgets/issues/12" }] }), stderr: "", exitCode: 0 };
    if (command[0] === "gh" && command[1] === "issue") return { stdout: JSON.stringify({ number: 12, title: "Retry requests", body: "## Acceptance Criteria\n- [ ] A request can be retried", url: "https://github.com/acme/widgets/issues/12", state: "OPEN", author: { login: "issue-author" } }), stderr: "", exitCode: 0 };
    if (command.includes("graphql")) return { stdout: JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false }, nodes: [] } } } } }), stderr: "", exitCode: 0 };
    throw new Error(`Unexpected command: ${command.join(" ")}`);
  }) as GitHubRunner;
  const context = await loadPullRequestContext("/tmp", "7", undefined, runner);
  expect(context.linkedIssue).toMatchObject({ number: 12, access: "available", criteriaStatus: "found", acceptanceCriteria: [{ text: "A request can be retried" }] });
  expect(context.providerScope).toEqual({ linkedIssue: "same-repository-closing-issue", relatedResources: "not-requested" });
  expect(commands.filter((command) => command[1] === "issue")).toHaveLength(1);

  const inaccessible = (async (command, cwd, accepted, options) => {
    if (command[0] === "gh" && command[1] === "issue") throw new Error("HTTP 404: not found");
    return runner(command, cwd, accepted, options);
  }) as GitHubRunner;
  const degraded = await loadPullRequestContext("/tmp", "7", undefined, inaccessible);
  expect(degraded.linkedIssue).toMatchObject({ number: 12, access: "inaccessible", criteriaStatus: "unavailable" });
  expect(degraded.providerScope?.relatedResources).toBe("not-requested");

  const malformed = (async (command, cwd, accepted, options) => {
    if (command[0] === "gh" && command[1] === "issue") return { stdout: JSON.stringify({ number: 12, title: "Retry requests", body: null, url: "https://github.com/acme/widgets/issues/12" }), stderr: "", exitCode: 0 };
    return runner(command, cwd, accepted, options);
  }) as GitHubRunner;
  const malformedContext = await loadPullRequestContext("/tmp", "7", undefined, malformed);
  expect(malformedContext.linkedIssue).toMatchObject({ access: "available", criteriaStatus: "malformed", acceptanceCriteria: [] });

  const foreignReferenceCommands: string[][] = [];
  const foreignReference = (async (command, cwd, accepted, options) => {
    foreignReferenceCommands.push(command);
    if (command.slice(0, 3).join(" ") === "gh pr view") return { stdout: JSON.stringify({ ...metadata(), closingIssuesReferences: [{ number: 12, title: "Foreign issue", url: "https://github.com/other/repository/issues/12" }] }), stderr: "", exitCode: 0 };
    if (command[0] === "gh" && command[1] === "issue") throw new Error("An unbound issue reference must not be fetched.");
    return runner(command, cwd, accepted, options);
  }) as GitHubRunner;
  const noLinkedIssue = await loadPullRequestContext("/tmp", "7", undefined, foreignReference);
  expect(noLinkedIssue.linkedIssue).toBeUndefined();
  expect(noLinkedIssue.providerScope).toEqual({ linkedIssue: "none", relatedResources: "not-requested" });
  expect(foreignReferenceCommands.filter((command) => command[1] === "issue")).toHaveLength(0);

  const mismatchedIssueUrl = (async (command, cwd, accepted, options) => {
    if (command[0] === "gh" && command[1] === "issue") return { stdout: JSON.stringify({ number: 12, title: "Retry requests", body: "## Acceptance Criteria\n- [ ] A request can be retried", url: "https://github.com/other/repository/issues/12" }), stderr: "", exitCode: 0 };
    return runner(command, cwd, accepted, options);
  }) as GitHubRunner;
  const rejectedIssue = await loadPullRequestContext("/tmp", "7", undefined, mismatchedIssueUrl);
  expect(rejectedIssue.linkedIssue).toMatchObject({ number: 12, access: "unavailable", criteriaStatus: "unavailable", acceptanceCriteria: [] });
});

async function git(cwd: string, ...args: string[]) { return runProcess(["git", ...args], cwd); }

async function repositoryFixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "diffcompass-pr-")));
  roots.push(root);
  await git(root, "init", "-b", "main");
  await git(root, "config", "user.name", "Test");
  await git(root, "config", "user.email", "test@example.test");
  await writeFile(join(root, "file.txt"), "base\n");
  await git(root, "add", "file.txt"); await git(root, "commit", "-m", "base");
  const base = (await git(root, "rev-parse", "HEAD")).stdout.trim();
  await git(root, "switch", "-c", "feature");
  await writeFile(join(root, "file.txt"), "base\nhead\n");
  await git(root, "add", "file.txt"); await git(root, "commit", "-m", "head");
  const head = (await git(root, "rev-parse", "HEAD")).stdout.trim();
  await git(root, "switch", "main");
  const context: PullRequestContext = {
    repository: "acme/widgets", number: 7, url: "https://github.com/acme/widgets/pull/7", title: "PR", body: "", author: "author",
    baseRefName: "main", baseRefOid: base, headRefName: "feature", headRefOid: head, sourceRepositoryRoot: root, workspaceRoot: "",
    refNamespace: `refs/diffcompass/${crypto.randomUUID()}`, commits: [], checks: [], threads: [], threadsTruncated: false, updatedAt: new Date().toISOString(),
  };
  return { root, base, head, context };
}

test("workspace creation never changes the source checkout and cleanup refuses dirty work", async () => {
  const { root, context } = await repositoryFixture();
  const sourceHead = (await git(root, "rev-parse", "HEAD")).stdout.trim();
  const container = join(root, "..", `diffcompass-worktree-${crypto.randomUUID()}`); roots.push(container);
  const workspace = await createPullRequestWorkspace(context, container);
  expect((await git(root, "rev-parse", "HEAD")).stdout.trim()).toBe(sourceHead);
  expect((await git(root, "status", "--porcelain")).stdout).toBe("");
  expect(await readFile(join(workspace, "file.txt"), "utf8")).toContain("head");
  await writeFile(join(workspace, "file.txt"), "dirty\n");
  await expect(removePullRequestWorkspace(context)).rejects.toThrow("local changes");
  expect(await readFile(join(workspace, "file.txt"), "utf8")).toBe("dirty\n");
});

async function cliFixture(attached = false) {
  const fixture = await repositoryFixture();
  const directory = await realpath(await mkdtemp(join(tmpdir(), "diffcompass-pr-cleanup-")));
  roots.push(directory);
  const stateFile = join(directory, "sessions", "review.json");
  const container = join(directory, "worktrees", "review");
  const workspace = await createPullRequestWorkspace(fixture.context, container);
  const session = await ReviewSession.create(workspace, fixture.base, {
    stateFile, pullRequest: fixture.context, attached, agentAdapters: [], includeFindings: false,
  });
  await session.dispose();
  return { ...fixture, directory, stateFile, container, workspace, attached };
}

async function launchReview(fixture: Awaited<ReturnType<typeof cliFixture>>) {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "../src/cli.ts"), "--resume", fixture.stateFile, "--port", "0", "--no-findings"], {
    cwd: fixture.root, stdout: "pipe", stderr: "pipe",
    env: { ...process.env, XDG_STATE_HOME: join(fixture.directory, "user-state") },
  });
  let output = "";
  const stdout = (async () => { for await (const chunk of child.stdout) output += new TextDecoder().decode(chunk); })();
  const stderr = new Response(child.stderr).text();
  const exited = child.exited;
  const stop = async () => {
    if (child.exitCode === null) child.kill();
    const timer = setTimeout(() => child.kill("SIGKILL"), 2_000);
    try { await exited; await stdout; } finally { clearTimeout(timer); }
  };
  try {
    const deadline = Date.now() + 10_000;
    while (!output.includes(fixture.attached ? "Attached bridge token file:" : "Resume: ")) {
      if (child.exitCode !== null || Date.now() >= deadline) throw new Error(`CLI failed to start: ${output}\n${await (child.exitCode === null ? Promise.resolve("") : stderr)}`);
      await Bun.sleep(10);
    }
    const url = /^DiffCompass: (.+)$/m.exec(output)![1]!;
    return {
      child, url, stop,
      async finish() {
        const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
        try { const code = await exited; await stdout; return { code, output, stderr: await stderr }; }
        finally { clearTimeout(timer); }
      },
    };
  } catch (error) { await stop(); throw error; }
}

async function acceptReview(url: string) {
  const response = await fetch(new URL("/api/close", url), {
    method: "POST",
    headers: { "content-type": "application/json", origin: new URL(url).origin, "x-diffcompass-token": new URL(url).hash.slice("#token=".length) },
    body: JSON.stringify({ outcome: "accepted", decision: "approve", localOnly: true }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: "accepted" });
}

async function acknowledgeReview(url: string, stateFile: string) {
  const state = await loadPersistedSession(stateFile);
  const headers = { "x-diffcompass-token": state.bridgeToken! };
  const response = await fetch(new URL("/api/bridge/events", url), { headers });
  const { events } = await response.json() as { events: { id: string; type: string; leaseId: string; outcome: string }[] };
  const terminal = events.find(event => event.type === "review.closed")!;
  expect(terminal.outcome).toBe("accepted");
  const ack = await fetch(new URL("/api/bridge/ack", url), {
    method: "POST", headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ eventId: terminal.id, leaseId: terminal.leaseId }),
  });
  expect(ack.status).toBe(200); await ack.text();
}

for (const attached of [false, true]) {
  test(`accepted ${attached ? "attached" : "standalone"} PR tours remove their worktree and can resume and prune`, async () => {
    const fixture = await cliFixture(attached);
    await writeFile(join(fixture.root, "my-notes.txt"), "Keep my source checkout untouched.\n");
    const before = (await git(fixture.root, "status", "--porcelain")).stdout;
    const cli = await launchReview(fixture);
    try {
      await acceptReview(cli.url);
      if (attached) {
        // Keep the review readable until the launching agent receives the decision.
        await expect(access(fixture.workspace)).resolves.toBeNull();
        await acknowledgeReview(cli.url, fixture.stateFile);
      }
      expect(await cli.finish()).toMatchObject({ code: 0, stderr: "" });
      await expect(access(fixture.container)).rejects.toThrow();
      await expect(access(`${fixture.stateFile}.lock`)).rejects.toThrow();
      expect((await git(fixture.root, "worktree", "list", "--porcelain")).stdout).not.toContain(fixture.workspace);
      expect((await git(fixture.root, "status", "--porcelain")).stdout).toBe(before);
      expect((await loadPersistedSession(fixture.stateFile)).status).toBe("accepted");
    } finally { await cli.stop(); }

    await git(fixture.root, "branch", "-D", "feature");
    await git(fixture.root, "reflog", "expire", "--expire=now", "--all");
    await git(fixture.root, "gc", "--prune=now");
    const resumed = await launchReview(fixture);
    try { expect(await resumed.finish()).toMatchObject({ code: 0, stderr: "" }); }
    finally { await resumed.stop(); }
    await expect(access(fixture.container)).rejects.toThrow();
    const pruned = await pruneReviewSessions({ maxSessions: 0, includeArchived: true }, { directory: join(fixture.directory, "sessions"), apply: true });
    expect(pruned.sessions.map(session => session.id)).toEqual(["review"]);
    await expect(access(fixture.stateFile)).rejects.toThrow();
  }, 30_000);
}

test("stopping an accepted attached review clears its timer and resume delivers the saved result", async () => {
  const fixture = await cliFixture(true);
  const cli = await launchReview(fixture);
  try {
    await acceptReview(cli.url);
    cli.child.kill("SIGTERM");
    expect(await cli.finish()).toMatchObject({ code: 0, stderr: "" });
    await expect(access(fixture.container)).rejects.toThrow();
    expect((await loadPersistedSession(fixture.stateFile)).bridgeTerminalEvent?.acknowledged).not.toBe(true);
  } finally { await cli.stop(); }
  const resumed = await launchReview(fixture);
  try {
    await expect(access(fixture.workspace)).resolves.toBeNull();
    await acknowledgeReview(resumed.url, fixture.stateFile);
    expect(await resumed.finish()).toMatchObject({ code: 0, stderr: "" });
    await expect(access(fixture.container)).rejects.toThrow();
  } finally { await resumed.stop(); }
}, 30_000);

test("shutdown retains unfinished PR worktrees and releases their active markers and lock", async () => {
  const fixture = await cliFixture();
  const cli = await launchReview(fixture);
  try {
    cli.child.kill("SIGTERM");
    expect(await cli.finish()).toMatchObject({ code: 0, stderr: "" });
    await expect(access(fixture.workspace)).resolves.toBeNull();
    await expect(access(join(fixture.container, ".active.json"))).rejects.toThrow();
    await expect(access(`${fixture.stateFile}.lock`)).rejects.toThrow();
    expect((await loadPersistedSession(fixture.stateFile)).status).toBe("open");
  } finally { await cli.stop(); }
}, 15_000);

test("accepted dirty PR worktrees are retained without blocking shutdown or lock release", async () => {
  const fixture = await cliFixture();
  const cli = await launchReview(fixture);
  try {
    await writeFile(join(fixture.workspace, "file.txt"), "Keep this edit.\n");
    await acceptReview(cli.url);
    const result = await cli.finish();
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("local changes and was retained");
    expect(await readFile(join(fixture.workspace, "file.txt"), "utf8")).toBe("Keep this edit.\n");
    await expect(access(`${fixture.stateFile}.lock`)).rejects.toThrow();
    await expect(access(join(fixture.container, ".active.json"))).rejects.toThrow();
  } finally { await cli.stop(); }
}, 15_000);

test("PR refresh refuses to overwrite a dirty isolated workspace", async () => {
  const { root, context } = await repositoryFixture();
  const container = join(root, "..", `diffcompass-worktree-${crypto.randomUUID()}`); roots.push(container);
  await createPullRequestWorkspace(context, container);
  await writeFile(join(context.workspaceRoot, "file.txt"), "dirty\n");
  const tree = (await git(root, "rev-parse", `${context.headRefOid}^{tree}`)).stdout.trim();
  const next = (await runProcess(["git", "commit-tree", tree, "-p", context.headRefOid, "-m", "next"], root, [0], {
    env: { GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.test", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.test" },
  })).stdout.trim();
  const runner = (async (command, cwd, accepted, options) => command[0] === "git"
    ? runProcess(command, cwd, accepted, options)
    : githubRunner({ head: next, base: context.baseRefOid })(command, cwd, accepted, options)) as GitHubRunner;
  await expect(updatePullRequestWorkspace(context, runner)).rejects.toThrow("local changes");
  expect(await readFile(join(context.workspaceRoot, "file.txt"), "utf8")).toBe("dirty\n");
});

test("PR refresh advances only a clean isolated workspace", async () => {
  const { root, context } = await repositoryFixture();
  const container = join(root, "..", `diffcompass-worktree-${crypto.randomUUID()}`); roots.push(container);
  await createPullRequestWorkspace(context, container);
  const sourceHead = (await git(root, "rev-parse", "HEAD")).stdout.trim();
  const tree = (await git(root, "rev-parse", `${context.headRefOid}^{tree}`)).stdout.trim();
  const next = (await runProcess(["git", "commit-tree", tree, "-p", context.headRefOid, "-m", "next"], root, [0], {
    env: { GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.test", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.test" },
  })).stdout.trim();
  const runner = (async (command, cwd, accepted, options) => command[0] === "git"
    ? runProcess(command, cwd, accepted, options)
    : githubRunner({ head: next, base: context.baseRefOid })(command, cwd, accepted, options)) as GitHubRunner;
  const latest = await updatePullRequestWorkspace(context, runner);
  expect(latest.headRefOid).toBe(next);
  expect((await git(context.workspaceRoot, "rev-parse", "HEAD")).stdout.trim()).toBe(next);
  expect((await git(root, "rev-parse", "HEAD")).stdout.trim()).toBe(sourceHead);
});

test("publication detects head races and retries by durable marker without duplicating", async () => {
  const { context, head } = await repositoryFixture();
  context.headRefOid = head;
  context.baseRefOid = "a".repeat(40);
  const comment: ReviewComment = { id: "comment", path: "file.txt", side: "new", line: 2, body: "Fix this", lineContent: "head", status: "active", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await expect(publishPullRequestReview(context, [comment], "feedback", crypto.randomUUID(), githubRunner({ head: "c".repeat(40) }))).rejects.toThrow("changed on GitHub");
  let posts = 0;
  const intent = crypto.randomUUID();
  const marker = `<!-- diffcompass:${intent} -->`;
  const result = await publishPullRequestReview(context, [comment], "feedback", intent, githubRunner({ head, reviews: [{ id: 99, body: marker, html_url: "https://github.com/review/99" }], post: () => { posts += 1; } }));
  expect(result).toEqual({ id: "99", url: "https://github.com/review/99" });
  expect(posts).toBe(0);
  await expect(publishPullRequestReview(context, [comment], "feedback", intent, githubRunner({ head, reviews: [{ body: marker }] }))).rejects.toThrow("matching review");
});

test("publication sends arguments without a shell and binds comments to the confirmed commit", async () => {
  const { context, head } = await repositoryFixture();
  context.headRefOid = head; context.baseRefOid = "a".repeat(40);
  const comment: ReviewComment = { id: "comment", path: "file.txt", side: "new", line: 2, body: "Fix this", lineContent: "head", status: "active", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  let payload = "";
  await publishPullRequestReview(context, [comment], "feedback", crypto.randomUUID(), githubRunner({ head, post: (body) => { payload = body; } }));
  expect(JSON.parse(payload)).toMatchObject({ commit_id: head, event: "REQUEST_CHANGES", comments: [{ path: "file.txt", line: 2, side: "RIGHT", body: "Fix this" }] });
});

test("publication includes the reviewer's overall note without changing the GitHub decision", async () => {
  const { context, head } = await repositoryFixture();
  context.headRefOid = head; context.baseRefOid = "a".repeat(40);
  let payload = "";
  await publishPullRequestReview(context, [], "accepted", crypto.randomUUID(), githubRunner({ head, post: (body) => { payload = body; } }), "Useful cleanup. Ship it.");
  const review = JSON.parse(payload);
  expect(review.event).toBe("APPROVE");
  expect(review.body).toStartWith("Useful cleanup. Ship it.\n\nSubmitted from DiffCompass.");
});
