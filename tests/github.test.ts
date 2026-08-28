import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPullRequestWorkspace, loadPullRequestContext, parsePullRequestIdentifier, publishPullRequestReview, removePullRequestWorkspace, updatePullRequestWorkspace, type GitHubRunner } from "../src/github.ts";
import { runProcess } from "../src/process.ts";
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

function githubRunner(options: { head?: string; base?: string; localRepository?: string; reviews?: unknown[]; post?: (body: string) => void } = {}): GitHubRunner {
  return (async (command, _cwd, _accepted, processOptions) => {
    let value: unknown;
    if (command.slice(0, 3).join(" ") === "gh repo view") value = { nameWithOwner: options.localRepository ?? "acme/widgets" };
    else if (command.slice(0, 3).join(" ") === "gh pr view") value = metadata(options.head, options.base);
    else if (command.includes("graphql")) value = { data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false }, nodes: [] } } } } };
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

async function git(cwd: string, ...args: string[]) { return runProcess(["git", ...args], cwd); }

async function repositoryFixture() {
  const root = await mkdtemp(join(tmpdir(), "review-tour-pr-"));
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
    refNamespace: `refs/code-review-tour/${crypto.randomUUID()}`, commits: [], checks: [], threads: [], threadsTruncated: false, updatedAt: new Date().toISOString(),
  };
  return { root, base, head, context };
}

test("workspace creation never changes the source checkout and cleanup refuses dirty work", async () => {
  const { root, context } = await repositoryFixture();
  const sourceHead = (await git(root, "rev-parse", "HEAD")).stdout.trim();
  const container = join(root, "..", `review-tour-worktree-${crypto.randomUUID()}`); roots.push(container);
  const workspace = await createPullRequestWorkspace(context, container);
  expect((await git(root, "rev-parse", "HEAD")).stdout.trim()).toBe(sourceHead);
  expect((await git(root, "status", "--porcelain")).stdout).toBe("");
  expect(await readFile(join(workspace, "file.txt"), "utf8")).toContain("head");
  await writeFile(join(workspace, "file.txt"), "dirty\n");
  await expect(removePullRequestWorkspace(context)).rejects.toThrow("local changes");
  expect(await readFile(join(workspace, "file.txt"), "utf8")).toBe("dirty\n");
});

test("PR refresh refuses to overwrite a dirty isolated workspace", async () => {
  const { root, context } = await repositoryFixture();
  const container = join(root, "..", `review-tour-worktree-${crypto.randomUUID()}`); roots.push(container);
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
  const container = join(root, "..", `review-tour-worktree-${crypto.randomUUID()}`); roots.push(container);
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
  const marker = `<!-- code-review-tour:${intent} -->`;
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
  expect(review.body).toStartWith("Useful cleanup. Ship it.\n\nSubmitted from Code Review Tour.");
});
