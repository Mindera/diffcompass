import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadComparison } from "../src/git.ts";
import { runProcess } from "../src/process.ts";

const repositories: string[] = [];

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function git(cwd: string, ...args: string[]) {
  return runProcess(["git", ...args], cwd);
}

describe("loadComparison", () => {
  test("combines branch commits, working-tree edits, and untracked files", async () => {
    const repository = await mkdtemp(join(tmpdir(), "review-tour-git-"));
    repositories.push(repository);
    await git(repository, "init", "-b", "main");
    await git(repository, "config", "user.name", "Review Tour Test");
    await git(repository, "config", "user.email", "review-tour@example.test");
    await writeFile(join(repository, "app.txt"), "base\n");
    await git(repository, "add", "app.txt");
    await git(repository, "commit", "-m", "base");
    const base = (await git(repository, "rev-parse", "HEAD")).stdout.trim();
    await git(repository, "update-ref", "refs/remotes/origin/main", base);
    await git(repository, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    await git(repository, "switch", "-c", "feature");
    await writeFile(join(repository, "app.txt"), "base\ncommitted\n");
    await git(repository, "add", "app.txt");
    await git(repository, "commit", "-m", "feature");
    await writeFile(join(repository, "app.txt"), "base\ncommitted\nworking tree\n");
    await writeFile(join(repository, "new.txt"), "untracked\n");

    const comparison = await loadComparison(repository);

    expect(comparison.base).toBe("origin/main");
    expect(comparison.mergeBase).toBe(base);
    expect(comparison.files.map((file) => file.path)).toEqual(["app.txt", "new.txt"]);
    expect(comparison.files[0].additions).toBe(2);
    expect(comparison.files[1].status).toBe("added");
    expect(comparison.repositoryFiles).toEqual(["app.txt", "new.txt"]);
  });
});
