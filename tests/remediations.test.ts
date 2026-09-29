import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AttachedAgentBridge } from "../src/bridge.ts";
import { loadComparison } from "../src/git.ts";
import { runProcess } from "../src/process.ts";
import { createRequestHandler, startServer } from "../src/server.ts";
import { ReviewSession } from "../src/session.ts";
import type { ReviewFinding, ReviewPreferences, TourOutline } from "../src/types.ts";

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
  defaults: { preferences?: ReviewPreferences },
  bridge?: AttachedAgentBridge,
) => ReviewSession;

async function reviewFixture(options: { extraFiles?: boolean; lineCount?: number } = {}) {
  const repository = await mkdtemp(join(tmpdir(), "diffcompass-remediation-"));
  repositories.push(repository);
  await git(repository, "init", "-b", "main");
  await git(repository, "config", "user.name", "Review Tour Test");
  await git(repository, "config", "user.email", "diffcompass@example.test");
  await writeFile(join(repository, "app.ts"), "const base = 1;\n");

  if (options.extraFiles) {
    await writeFile(join(repository, "plain.txt"), "plain text\n");
    await writeFile(join(repository, "binary.bin"), Buffer.from([0, 1, 2, 3]));
    await writeFile(join(repository, "large.txt"), "x".repeat(1_000_001));
    await symlink("plain.txt", join(repository, "linked.txt"));
  }

  await git(repository, "add", ".");
  await git(repository, "commit", "-m", "base");
  const base = (await git(repository, "rev-parse", "HEAD")).stdout.trim();
  await git(repository, "update-ref", "refs/remotes/origin/main", base);
  await git(repository, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  await git(repository, "switch", "-c", "feature");

  const changedLines = options.lineCount
    ? Array.from({ length: options.lineCount }, (_, index) => `const changed${index} = ${index};`).join("\n")
    : "const changed = 2;";
  await writeFile(join(repository, "app.ts"), `const base = 1;\n${changedLines}\n`);

  const comparison = await loadComparison(repository);
  const bridge = new AttachedAgentBridge("bridge-token-0123456789");
  const session = new (ReviewSession as unknown as ReviewSessionConstructor)(comparison, [], {}, bridge);
  return { repository, comparison, bridge, session };
}

function finding(lineContent = "const changed = 2;"): ReviewFinding {
  return {
    id: "finding-1",
    phaseId: "behavior",
    stepId: "changed-line",
    path: "app.ts",
    side: "new",
    line: 2,
    lineContent,
    message: "Validate the changed value.",
    category: "correctness",
    severity: "medium",
    confidence: "high",
    evidence: "The new branch has no guard.",
    priority: "P2",
    introduced: true,
    recallGuard: false,
    blastRadiusSize: 1,
    tested: false,
    pinScope: "line",
    status: "open",
  };
}

function outline(reviewFinding: ReviewFinding): TourOutline {
  return {
    title: "Review",
    summary: "Review the changed behavior.",
    phases: [{
      id: "behavior",
      title: "Changed behavior",
      summary: "Inspect the changed line.",
      fileChanges: [{ path: "app.ts", summary: "Contains the changed value." }],
      steps: [{ id: "changed-line", title: "Changed line", objective: "Inspect the value.", anchor: { path: "app.ts", side: "new", startLine: 2, endLine: 2 } }],
    }],
    callFlows: [],
    flows: [],
    findings: [reviewFinding],
  };
}

function browserHeaders(url: string, token: string): Headers {
  return new Headers({
    "content-type": "application/json",
    origin: url,
    "x-diffcompass-token": token,
  });
}

test("refresh marks a finding outdated without assuming its issue is obsolete", async () => {
  const { repository, session } = await reviewFixture();
  session.outline = outline(finding());
  const initialRevision = session.revision;

  await writeFile(join(repository, "app.ts"), "const base = 1;\nconst changed = 3;\n");
  const snapshot = await session.refreshComparison();

  expect(snapshot.revision).toBe(initialRevision + 1);
  expect(snapshot.outline?.findings[0]).toMatchObject({
    lineContent: "const changed = 2;",
    outdated: true,
    status: "open",
  });
  expect(snapshot.outline?.findings[0]?.disposition).toBeUndefined();

  const reassessed = await session.updateFinding("finding-1", "accepted", "The same issue remains in the refreshed line.");
  expect(reassessed.outline?.findings[0]).toMatchObject({
    status: "accepted",
    disposition: "accepted",
    reviewerNote: "The same issue remains in the refreshed line.",
    outdated: true,
  });
});

test("explicit finding dispositions and reviewer notes survive refreshes", async () => {
  const dispositions = ["accepted", "false-positive", "intentional", "deferred", "fixed"] as const;
  for (const disposition of dispositions) {
    const { repository, session } = await reviewFixture();
    session.outline = outline(finding());

    const saved = await session.updateFinding("finding-1", disposition, `Reviewed as ${disposition}.`);
    expect(saved.outline?.findings[0]).toMatchObject({
      status: disposition,
      disposition,
      reviewerNote: `Reviewed as ${disposition}.`,
    });

    await writeFile(join(repository, "app.ts"), "const base = 1;\nconst changed = 3;\n");
    const refreshed = await session.refreshComparison();
    expect(refreshed.outline?.findings[0]).toMatchObject({
      status: disposition,
      disposition,
      reviewerNote: `Reviewed as ${disposition}.`,
      outdated: true,
    });
  }
});

test("reopening clears a finding disposition and its note, while legacy dismiss remains deferred", async () => {
  const { session } = await reviewFixture();
  session.outline = outline(finding());

  const deferred = await session.updateFinding("finding-1", "dismiss", "Revisit after the next pass.");
  expect(deferred.outline?.findings[0]).toMatchObject({ status: "deferred", disposition: "deferred", reviewerNote: "Revisit after the next pass." });

  const reopened = await session.updateFinding("finding-1", "reopen");
  expect(reopened.outline?.findings[0]).toMatchObject({ status: "open", disposition: undefined, reviewerNote: undefined });
});

test("an explicit obsolete-after-refresh disposition can retain context on an already refreshed finding", async () => {
  const { repository, session } = await reviewFixture();
  session.outline = outline(finding());
  await writeFile(join(repository, "app.ts"), "const base = 1;\nconst changed = 3;\n");
  await session.refreshComparison();

  const saved = await session.updateFinding("finding-1", "obsolete-after-refresh", "The issue disappeared in the refreshed source.");
  expect(saved.outline?.findings[0]).toMatchObject({
    status: "obsolete-after-refresh",
    disposition: "obsolete-after-refresh",
    reviewerNote: "The issue disappeared in the refreshed source.",
    outdated: true,
  });
});

test("finding lifecycle API accepts explicit dispositions and notes", async () => {
  const { session } = await reviewFixture();
  session.outline = outline(finding());
  const url = "http://review.test";
  const handler = createRequestHandler(session);

  const response = await handler(new Request(`${url}/api/findings/finding-1`, {
    method: "PATCH",
    headers: browserHeaders(url, session.browserToken),
    body: JSON.stringify({ action: "set-disposition", disposition: "intentional", note: "This branch is required by the contract." }),
  }));
  const body = await response.json() as { outline?: TourOutline };
  expect(response.status).toBe(200);
  expect(body.outline?.findings[0]).toMatchObject({
    status: "intentional",
    disposition: "intentional",
    reviewerNote: "This branch is required by the contract.",
  });
});

test("an outdated finding can be revalidated as feedback with a reassessment prompt", async () => {
  const { repository, session } = await reviewFixture();
  session.outline = outline(finding());
  await writeFile(join(repository, "app.ts"), "const base = 1;\nconst changed = 3;\n");
  await session.refreshComparison();

  const converted = await session.updateFinding("finding-1", "convert");
  expect(converted.outline?.findings[0]?.status).toBe("converted-to-feedback");
  expect(converted.comments[0]?.body).toBe("[P2] Validate the changed value.\n\nAssess if this is still valid after refresh.");
});

test("converting a finding creates feedback once and makes that finding terminal", async () => {
  const { session } = await reviewFixture();
  session.outline = outline(finding());

  const converted = await session.updateFinding("finding-1", "convert");
  const convertedAgain = await session.updateFinding("finding-1", "convert");

  expect(converted.outline?.findings[0]?.status).toBe("converted-to-feedback");
  expect(convertedAgain.comments).toHaveLength(1);
  expect(convertedAgain.comments[0]).toMatchObject({
    path: "app.ts",
    side: "new",
    line: 2,
    lineContent: "const changed = 2;",
    body: "[P2] Validate the changed value.",
  });
  await expect(session.updateFinding("finding-1", "dismiss")).rejects.toThrow("already converted to feedback");
  await expect(session.updateFinding("finding-1", "reopen")).rejects.toThrow("already converted to feedback");
});

test("a finding can be queued directly as an inline pull request review comment", async () => {
  const { repository, comparison, session } = await reviewFixture();
  session.outline = outline(finding());
  session.pullRequest = {
    repository: "acme/widgets",
    number: 7,
    url: "https://github.com/acme/widgets/pull/7",
    title: "PR",
    body: "",
    author: "reviewer",
    baseRefName: "main",
    baseRefOid: comparison.base,
    headRefName: "feature",
    headRefOid: comparison.head,
    sourceRepositoryRoot: repository,
    workspaceRoot: repository,
    refNamespace: "refs/diffcompass/test",
    commits: [],
    checks: [],
    threads: [],
    threadsTruncated: false,
    updatedAt: new Date().toISOString(),
  };

  const converted = await session.updateFinding("finding-1", "convert", undefined, true);

  expect(converted.outline?.findings[0]).toMatchObject({ status: "converted-to-feedback", commentId: converted.comments[0]?.id });
  expect(converted.comments[0]).toMatchObject({ body: "[P2] Validate the changed value.", publishToGitHub: true });
});

test("deleting feedback converted from a finding reopens the finding", async () => {
  const { session } = await reviewFixture();
  session.outline = outline(finding());
  const converted = await session.updateFinding("finding-1", "convert");
  const commentId = converted.comments[0]!.id;

  const reopened = await session.removeComment(commentId);
  expect(reopened.comments).toHaveLength(0);
  expect(reopened.outline?.findings[0]).toMatchObject({ status: "open", commentId: undefined });
});

test("large snapshots return metadata only while the authenticated diff endpoint pages an individual file", async () => {
  const { session } = await reviewFixture({ lineCount: 2_600 });
  const server = startServer(session, 0);
  servers.push(server);
  const url = `http://${server.hostname}:${server.port}`;

  const snapshot = session.snapshot();
  expect(snapshot.comparison.diffMode).toBe("file");
  expect(snapshot.comparison.diffRowCount).toBeGreaterThan(2_500);
  expect(snapshot.comparison.files).toEqual([
    expect.objectContaining({ path: "app.ts", hunks: [] }),
  ]);

  const response = await fetch(`${url}/api/diff?path=app.ts`, {
    headers: { "x-diffcompass-token": session.browserToken },
  });
  const body = await response.json() as { file: { path: string; hunks: Array<{ rows: unknown[] }> }; revision: number; offset: number; limit: number; totalRows: number };
  expect(response.status).toBe(200);
  expect(body.revision).toBe(snapshot.revision);
  expect(body.file.path).toBe("app.ts");
  expect(body.file.hunks.length).toBeGreaterThan(0);
  expect(body.file.hunks.flatMap((hunk) => hunk.rows).length).toBeLessThanOrEqual(1_000);
  expect(body.totalRows).toBeGreaterThan(2_500);

  const anchored = await fetch(`${url}/api/diff?path=app.ts&line=2501&side=new`, {
    headers: { "x-diffcompass-token": session.browserToken },
  });
  const anchoredBody = await anchored.json() as typeof body;
  expect(anchoredBody.offset).toBeGreaterThan(0);
  expect(anchoredBody.file.hunks.flatMap((hunk) => hunk.rows)).toContainEqual(expect.objectContaining({ newLine: 2501 }));
});

test("repository file endpoint rejects traversal, symlink, binary, and oversized file requests", async () => {
  const { session } = await reviewFixture({ extraFiles: true });
  const server = startServer(session, 0);
  servers.push(server);
  const url = `http://${server.hostname}:${server.port}`;

  for (const path of ["../app.ts", "linked.txt", "binary.bin", "large.txt"]) {
    const response = await fetch(`${url}/api/files?path=${encodeURIComponent(path)}`, {
      headers: { "x-diffcompass-token": session.browserToken },
    });
    expect(response.status, path).toBe(409);
  }

  const plain = await fetch(`${url}/api/files?path=plain.txt`, {
    headers: { "x-diffcompass-token": session.browserToken },
  });
  expect(plain.status).toBe(200);
  await expect(plain.json()).resolves.toEqual({ path: "plain.txt", content: "plain text\n" });

});

test("required reviewed-file policy blocks successful closure but never blocks cancellation", async () => {
  const { comparison } = await reviewFixture();
  const preferences: ReviewPreferences = {
    diffLayout: "split",
    changedFilesOnly: true,
    contextLines: 25,
    prefetchSteps: 2,
    requireAllFilesReviewed: true,
    closeOutcome: "accepted",
    showBriefing: true,
    briefingArchitecture: true,
    briefingSequenceDiagrams: false,
    briefingCallFlows: false,
    briefingNeedsAttention: true,
    briefingReviewEffort: true,
    briefingOrder: ["architecture", "sequence-diagrams", "call-flows", "needs-attention", "review-effort"],
  };
  const session = new (ReviewSession as unknown as ReviewSessionConstructor)(comparison, [], { preferences });

  expect(session.snapshot().preferences).toEqual(preferences);
  await expect(session.close("accepted")).rejects.toThrow("Mark every changed file as reviewed");
  await session.setFileReviewed("app.ts", true);
  await expect(session.close("accepted")).resolves.toMatchObject({ status: "accepted" });

  const cancelled = new (ReviewSession as unknown as ReviewSessionConstructor)(comparison, [], { preferences });
  await expect(cancelled.close("cancelled")).resolves.toMatchObject({ status: "cancelled" });
});

test("process execution rejects deterministically for cancellation and timeout", async () => {
  const command = [process.execPath, "-e", "setTimeout(() => {}, 5000)"];
  const controller = new AbortController();
  const cancellation = runProcess(command, process.cwd(), [0], { signal: controller.signal });
  setTimeout(() => controller.abort(), 25);
  await expect(cancellation).rejects.toThrow("cancelled");

  await expect(runProcess(command, process.cwd(), [0], { timeoutMs: 25 })).rejects.toThrow("timed out after 25ms");
});
