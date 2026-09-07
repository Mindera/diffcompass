import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyRevisionFiles, revisionSummary } from "../src/revision.ts";
import { captureWorkingTreeSnapshot, loadComparison, writeCheckpointRef } from "../src/git.ts";
import { ReviewSession } from "../src/session.ts";
import { loadPersistedSession } from "../src/store.ts";
import { runProcess } from "../src/process.ts";
import type { DiffFile } from "../src/types.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function file(path: string, status: DiffFile["status"] = "modified"): DiffFile {
  return { path, oldPath: path, newPath: path, status, metadata: [], hunks: [], additions: 1, deletions: 0 };
}

async function git(cwd: string, ...args: string[]) {
  return (await runProcess(["git", ...args], cwd)).stdout.trim();
}

test("classifies new, changed-again, resolved, and unchanged paths with a concise summary", () => {
  const result = classifyRevisionFiles([file("old.ts"), file("same.ts"), file("gone.ts")], [file("same.ts"), file("new.ts")], [file("old.ts"), file("new.ts")]);
  expect(Object.fromEntries(result)).toEqual({ "gone.ts": "resolved", "new.ts": "new", "old.ts": "resolved", "same.ts": "unchanged" });
  const summary = revisionSummary("checkpoint", "2026-09-08T00:00:00.000Z", [file("same.ts")], [file("same.ts"), file("new.ts")], [file("new.ts")]);
  expect(summary.text).toContain("1 file changed since last review");
  expect(summary.newFiles).toEqual(["new.ts"]);
  expect(summary.unchangedFiles).toEqual(["same.ts"]);
});

test("checkpoint refs keep a captured source tree reachable", async () => {
  const repository = await mkdtemp(join(tmpdir(), "review-tour-checkpoint-git-"));
  directories.push(repository);
  await git(repository, "init", "-b", "main");
  await git(repository, "config", "user.name", "Review Tour Test");
  await git(repository, "config", "user.email", "review-tour@example.test");
  await writeFile(join(repository, "app.ts"), "base\n");
  await git(repository, "add", "app.ts");
  await git(repository, "commit", "-m", "base");
  const base = await git(repository, "rev-parse", "HEAD");
  await git(repository, "update-ref", "refs/remotes/origin/main", base);
  await writeFile(join(repository, "app.ts"), "reviewed\n");
  const snapshot = await captureWorkingTreeSnapshot(repository);
  const ref = "refs/code-review-tour/checkpoints/test/00000000-0000-4000-8000-000000000000";
  await writeCheckpointRef(repository, ref, snapshot.tree);
  expect(await git(repository, "cat-file", "-t", ref)).toBe("tree");
  expect(await git(repository, "rev-parse", `${ref}^{tree}`)).toBe(snapshot.tree);
});

test("manual checkpoints preserve unchanged reviewed files and reset changed files after refresh", async () => {
  const repository = await mkdtemp(join(tmpdir(), "review-tour-revision-"));
  directories.push(repository);
  await git(repository, "init", "-b", "main");
  await git(repository, "config", "user.name", "Review Tour Test");
  await git(repository, "config", "user.email", "review-tour@example.test");
  await writeFile(join(repository, "base.ts"), "base\n");
  await git(repository, "add", "base.ts");
  await git(repository, "commit", "-m", "base");
  const base = await git(repository, "rev-parse", "HEAD");
  await git(repository, "update-ref", "refs/remotes/origin/main", base);
  await git(repository, "switch", "-c", "feature");
  await writeFile(join(repository, "a.ts"), "one\n");
  await writeFile(join(repository, "b.ts"), "one\n");
  const stateDirectory = await mkdtemp(join(tmpdir(), "review-tour-revision-state-"));
  directories.push(stateDirectory);
  const stateFile = join(stateDirectory, "session.json");
  const session = await ReviewSession.create(repository, undefined, { agentAdapters: [], stateFile });
  await session.setFileReviewed("a.ts", true);
  await session.setFileReviewed("b.ts", true);
  const checkpoint = await session.createManualCheckpoint("first pass");
  expect(checkpoint.checkpoints).toHaveLength(1);
  expect((await loadPersistedSession(stateFile)).schemaVersion).toBe(3);

  await writeFile(join(repository, "a.ts"), "two\n");
  await writeFile(join(repository, "c.ts"), "new\n");
  const refreshed = await session.refreshComparison();
  expect(refreshed.reviewedFiles).toEqual(["b.ts"]);
  expect(refreshed.revisionSummary).toMatchObject({ newFiles: ["c.ts"], changedAgainFiles: ["a.ts"], unchangedFiles: ["b.ts"] });
  await session.setComparisonView("since-last-review");
  expect(session.snapshot().comparison.files.map((candidate) => candidate.path)).toEqual(["a.ts", "c.ts"]);
  expect((await readFile(stateFile, "utf8"))).toContain('"comparisonView": "since-last-review"');
  const persisted = await loadPersistedSession(stateFile);
  await writeFile(stateFile, JSON.stringify({ ...persisted, schemaVersion: 2 }));
  expect((await loadPersistedSession(stateFile)).schemaVersion).toBe(3);
  const closed = await session.close("accepted", { decision: "approve" });
  expect(closed.status).toBe("accepted");
  expect(session.snapshot().checkpoints.at(-1)).toMatchObject({ kind: "decision", outcome: "accepted", decision: "approve" });
});
