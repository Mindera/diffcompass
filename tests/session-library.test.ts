import { afterEach, expect, test } from "bun:test";
import { access, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireSessionLock, listReviewSessions, pruneReviewSessions, resolveReviewSession, runSessionCommand } from "../src/session-library.ts";
import { loadPersistedSession, savePersistedSession } from "../src/store.ts";
import type { PersistedReviewSession } from "../src/types.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function session(overrides: Partial<PersistedReviewSession> = {}): PersistedReviewSession {
  return {
    schemaVersion: 2,
    repositoryRoot: "/private/tmp/example-repository",
    base: "origin/main",
    browserToken: "browser-token",
    currentStepIndex: -1,
    comments: [],
    messages: [],
    revision: 1,
    status: "open",
    updatedAt: "2026-08-09T10:00:00.000Z",
    ...overrides,
  };
}

async function libraryFixture() {
  const directory = await mkdtemp(join(tmpdir(), "review-tour-library-"));
  directories.push(directory);
  await savePersistedSession(join(directory, "aaaaaaaa-1111.json"), session({ name: "Primary review" }));
  await savePersistedSession(join(directory, "bbbbbbbb-2222.json"), session({
    name: "Older review",
    archived: true,
    status: "accepted",
    updatedAt: "2026-08-08T10:00:00.000Z",
  }));
  return directory;
}

test("session library lists active sessions and includes archived sessions on request", async () => {
  const directory = await libraryFixture();
  expect((await listReviewSessions(directory)).sessions.map((item) => item.name)).toEqual(["Primary review"]);
  expect((await listReviewSessions(directory, true)).sessions.map((item) => item.name)).toEqual(["Primary review", "Older review"]);

  const listing = await runSessionCommand(["list", "--all"], directory);
  expect(listing.output).toContain("Primary review");
  expect(listing.output).toContain("archived");
});

test("session IDs resolve by an unambiguous prefix and reject ambiguous prefixes", async () => {
  const directory = await libraryFixture();
  await savePersistedSession(join(directory, "aaaaaaaa-3333.json"), session({ name: "Another A" }));

  await expect(resolveReviewSession("bbbb", directory)).resolves.toMatchObject({ id: "bbbbbbbb-2222" });
  await expect(resolveReviewSession("aaaa", directory)).rejects.toThrow("ambiguous");
  await expect(resolveReviewSession("../outside", directory)).rejects.toThrow("letters, numbers, and hyphens");
});

test("session commands rename, archive, resume, restore, and explicitly delete", async () => {
  const directory = await libraryFixture();
  expect((await runSessionCommand(["rename", "aaaa", "Release", "review"], directory)).output).toContain("Release review");
  expect((await loadPersistedSession(join(directory, "aaaaaaaa-1111.json"))).name).toBe("Primary review");
  expect((await listReviewSessions(directory, true)).sessions.find((item) => item.id.startsWith("aaaa"))?.name).toBe("Release review");

  await runSessionCommand(["archive", "aaaa"], directory);
  expect((await listReviewSessions(directory)).sessions).toHaveLength(0);
  await runSessionCommand(["unarchive", "aaaa"], directory);

  const resumed = await runSessionCommand(["resume", "aaaa", "--open"], directory);
  expect(resumed).toEqual({ resumePath: join(directory, "aaaaaaaa-1111.json"), open: true });

  await expect(runSessionCommand(["delete", "aaaa"], directory)).rejects.toThrow("destructive");
  expect((await runSessionCommand(["delete", "aaaa", "--yes"], directory)).output).toContain("Deleted");
  await expect(resolveReviewSession("aaaa", directory)).rejects.toThrow("No review session");
});

test("retention previews before deletion, excludes archived sessions by default, and protects active sessions", async () => {
  const directory = await libraryFixture();
  const now = new Date("2026-08-20T10:00:00.000Z");
  const primaryPath = join(directory, "aaaaaaaa-1111.json");
  const release = await acquireSessionLock(primaryPath);

  const protectedResult = await pruneReviewSessions(
    { maxAgeDays: 1, includeArchived: false },
    { directory, apply: true, now },
  );
  expect(protectedResult.sessions).toEqual([]);
  expect(protectedResult.protectedSessions.map((item) => item.id)).toEqual(["aaaaaaaa-1111"]);
  await expect(access(primaryPath)).resolves.toBeNull();

  await expect(acquireSessionLock(primaryPath)).rejects.toThrow("already open");
  await release();
  const preview = await pruneReviewSessions({ maxAgeDays: 1, includeArchived: false }, { directory, now });
  expect(preview.sessions.map((item) => item.id)).toEqual(["aaaaaaaa-1111"]);
  await expect(access(primaryPath)).resolves.toBeNull();
  const applied = await pruneReviewSessions({ maxAgeDays: 1, includeArchived: false }, { directory, apply: true, now });
  expect(applied.sessions.map((item) => item.id)).toEqual(["aaaaaaaa-1111"]);
  expect((await listReviewSessions(directory, true)).sessions.map((item) => item.id)).toEqual(["bbbbbbbb-2222"]);
});

test("retention max count is deterministic and CLI requires explicit apply", async () => {
  const directory = await libraryFixture();
  const preview = await runSessionCommand(["prune", "--max", "1", "--include-archived"], directory);
  expect(preview.output).toContain("Would delete 1 session");
  expect(preview.output).toContain("Repeat with --yes");
  expect((await listReviewSessions(directory, true)).sessions).toHaveLength(2);

  const applied = await runSessionCommand(["prune", "--max", "1", "--include-archived", "--yes"], directory);
  expect(applied.output).toContain("Deleted 1 session");
  expect((await listReviewSessions(directory, true)).sessions.map((item) => item.id)).toEqual(["aaaaaaaa-1111"]);
  await expect(runSessionCommand(["prune", "--days", "0"], directory)).rejects.toThrow("positive integer");
  await expect(runSessionCommand(["prune", "--unknown"], directory)).rejects.toThrow("Unknown");
});

test("temporary retention removes only stale owned directories", async () => {
  const directory = await mkdtemp(join(tmpdir(), "review-tour-retention-"));
  const sessions = join(directory, "sessions");
  const temporaryRoot = join(directory, "tmp");
  directories.push(directory);
  await mkdir(sessions);
  await mkdir(temporaryRoot);
  const stale = join(temporaryRoot, "code-review-tour-proposal-ABC123");
  const recent = join(temporaryRoot, "code-review-tour-index-XYZ789");
  const active = join(temporaryRoot, "code-review-tour-LIVE123");
  const unrelated = join(temporaryRoot, "some-other-tool-ABC123");
  await Promise.all([mkdir(stale), mkdir(recent), mkdir(active), mkdir(unrelated)]);
  await writeFile(join(active, ".active.json"), JSON.stringify({ pid: process.pid }));
  const old = new Date("2026-08-01T00:00:00.000Z");
  const fresh = new Date("2026-08-09T12:00:00.000Z");
  await utimes(stale, old, old);
  await utimes(active, old, old);
  await utimes(recent, fresh, fresh);

  const preview = await pruneReviewSessions(
    { temporaryMaxAgeHours: 24, includeArchived: false },
    { directory: sessions, temporaryRoot, now: new Date("2026-08-10T00:00:00.000Z") },
  );
  expect(preview.temporaryDirectories).toEqual([stale]);
  await expect(access(stale)).resolves.toBeNull();
  await pruneReviewSessions(
    { temporaryMaxAgeHours: 24, includeArchived: false },
    { directory: sessions, temporaryRoot, apply: true, now: new Date("2026-08-10T00:00:00.000Z") },
  );
  await expect(access(stale)).rejects.toThrow();
  await expect(access(recent)).resolves.toBeNull();
  await expect(access(active)).resolves.toBeNull();
  await expect(access(unrelated)).resolves.toBeNull();

  const staleLock = join(sessions, "stale.json");
  await writeFile(`${staleLock}.lock`, JSON.stringify({ pid: 999_999_999, token: "old" }));
  const release = await acquireSessionLock(staleLock);
  await release();
});

test("retention refuses a persisted PR workspace outside its owned session directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "review-tour-retention-pr-"));
  directories.push(root);
  const directory = join(root, "sessions");
  const id = "aaaaaaaa-1111";
  const maliciousWorkspace = join(root, "unowned", "workspace");
  const path = join(directory, `${id}.json`);
  await savePersistedSession(path, session({
    repositoryRoot: maliciousWorkspace,
    base: "a".repeat(40),
    pullRequest: {
      repository: "acme/widgets", number: 7, url: "https://github.com/acme/widgets/pull/7", title: "PR", body: "", author: "author",
      baseRefName: "main", baseRefOid: "a".repeat(40), headRefName: "feature", headRefOid: "b".repeat(40), sourceRepositoryRoot: join(root, "source"),
      workspaceRoot: maliciousWorkspace, refNamespace: "refs/code-review-tour/session", commits: [], checks: [], threads: [], threadsTruncated: false,
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
    updatedAt: "2026-08-01T00:00:00.000Z",
  }));
  const result = await pruneReviewSessions({ maxAgeDays: 1, includeArchived: true }, { directory, apply: true, now: new Date("2026-08-09T00:00:00.000Z") });
  expect(result.sessions).toEqual([]);
  expect(result.changedSessions.map((item) => item.id)).toEqual([id]);
  await expect(access(path)).resolves.toBeNull();
});
