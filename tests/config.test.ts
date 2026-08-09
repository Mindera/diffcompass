import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_REVIEW_PREFERENCES, loadRepositoryConfig } from "../src/config.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function repository(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "review-tour-config-"));
  directories.push(directory);
  return directory;
}

test("missing repository configuration uses conservative defaults", async () => {
  const directory = await repository();
  expect(await loadRepositoryConfig(directory)).toEqual({
    preferences: DEFAULT_REVIEW_PREFERENCES,
    retention: { includeArchived: false },
  });
});

test("loads every supported repository default", async () => {
  const directory = await repository();
  await writeFile(join(directory, ".code-review-tour.json"), JSON.stringify({
    base: "parent-feature",
    agent: "claude",
    model: "opus",
    reasoning: "high",
    diff: { layout: "split", changedFilesOnly: true, contextLines: 25 },
    review: { requireAllFilesReviewed: true, closeOutcome: "cancelled" },
    retention: { maxAgeDays: 30, maxSessions: 50, includeArchived: true },
  }));

  expect(await loadRepositoryConfig(directory)).toEqual({
    base: "parent-feature",
    agent: "claude",
    model: "opus",
    reasoning: "high",
    preferences: {
      diffLayout: "split",
      changedFilesOnly: true,
      contextLines: 25,
      requireAllFilesReviewed: true,
      closeOutcome: "cancelled",
    },
    retention: { maxAgeDays: 30, maxSessions: 50, includeArchived: true },
  });
});

test("accepts the v0.7 standalone adapters", async () => {
  for (const agent of ["gemini", "copilot"] as const) {
    const directory = await repository();
    await writeFile(join(directory, ".code-review-tour.json"), JSON.stringify({ agent }));
    expect((await loadRepositoryConfig(directory)).agent).toBe(agent);
  }
});

test("fails closed for unknown, mistyped, oversized, and linked configuration", async () => {
  const directory = await repository();
  const path = join(directory, ".code-review-tour.json");
  for (const value of [
    { unexpected: true },
    { diff: { contextLines: 2 } },
    { diff: { contextLines: 201 } },
    { diff: { changedFilesOnly: "yes" } },
    { review: { closeOutcome: "feedback" } },
    { agent: "unknown" },
    { retention: { maxSessions: 0 } },
  ]) {
    await writeFile(path, JSON.stringify(value));
    await expect(loadRepositoryConfig(directory)).rejects.toThrow();
  }
  await writeFile(path, " ".repeat(64 * 1024 + 1));
  await expect(loadRepositoryConfig(directory)).rejects.toThrow("64 KiB");
  await rm(path);
  const target = join(directory, "outside.json");
  await writeFile(target, "{}");
  await symlink(target, path);
  await expect(loadRepositoryConfig(directory)).rejects.toThrow("regular file");
});
