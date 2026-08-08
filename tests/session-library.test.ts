import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listReviewSessions, resolveReviewSession, runSessionCommand } from "../src/session-library.ts";
import { loadPersistedSession, savePersistedSession } from "../src/store.ts";
import type { PersistedReviewSession } from "../src/types.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function session(overrides: Partial<PersistedReviewSession> = {}): PersistedReviewSession {
  return {
    schemaVersion: 1,
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
