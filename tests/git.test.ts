import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureWorkingTreeSnapshot, loadComparison, loadDiffFileWithContext, loadDiffText } from "../src/git.ts";
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
    await git(repository, "remote", "add", "origin", "git@github.com:acme/code-review-tour.git");
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
    expect(comparison.repositoryName).toBe("code-review-tour");
    expect(comparison.mergeBase).toBe(base);
    expect(comparison.files.map((file) => file.path)).toEqual(["app.txt", "new.txt"]);
    expect(comparison.files[0].additions).toBe(2);
    expect(comparison.files[1].status).toBe("added");
    expect(comparison.repositoryFiles).toEqual(["app.txt", "new.txt"]);
  });

  test("regenerates a file diff with expanded bounded context", async () => {
    const repository = await mkdtemp(join(tmpdir(), "review-tour-context-"));
    repositories.push(repository);
    await git(repository, "init", "-b", "main");
    await git(repository, "config", "user.name", "Review Tour Test");
    await git(repository, "config", "user.email", "review-tour@example.test");
    const original = Array.from({ length: 80 }, (_, index) => `line ${index + 1}`).join("\n") + "\n";
    await writeFile(join(repository, "app.txt"), original);
    await git(repository, "add", "app.txt");
    await git(repository, "commit", "-m", "base");
    const base = (await git(repository, "rev-parse", "HEAD")).stdout.trim();
    await git(repository, "update-ref", "refs/remotes/origin/main", base);
    await git(repository, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    await git(repository, "switch", "-c", "feature");
    await writeFile(join(repository, "app.txt"), original.replace("line 40", "changed 40"));

    const comparison = await loadComparison(repository);
    const compactRows = comparison.files[0]!.hunks.flatMap((hunk) => hunk.rows).length;
    const expanded = await loadDiffFileWithContext(comparison, "app.txt", 25);

    expect(expanded.hunks.flatMap((hunk) => hunk.rows).length).toBeGreaterThan(compactRows);
    expect(expanded.hunks.flatMap((hunk) => hunk.rows)).toContainEqual(expect.objectContaining({ content: "line 20" }));

    const full = await loadDiffFileWithContext(comparison, "app.txt", 3, true);
    expect(full.hunks.flatMap((hunk) => hunk.rows)).toContainEqual(expect.objectContaining({ content: "line 1" }));
    expect(full.hunks.flatMap((hunk) => hunk.rows)).toContainEqual(expect.objectContaining({ content: "line 80" }));
  });

  test("uses a captured working tree as the baseline for a feedback-only comparison", async () => {
    const repository = await mkdtemp(join(tmpdir(), "review-tour-feedback-base-"));
    repositories.push(repository);
    await git(repository, "init", "-b", "main");
    await git(repository, "config", "user.name", "Review Tour Test");
    await git(repository, "config", "user.email", "review-tour@example.test");
    await writeFile(join(repository, "app.txt"), "base\n");
    await git(repository, "add", "app.txt");
    await git(repository, "commit", "-m", "base");
    await writeFile(join(repository, "app.txt"), "base\noriginal review change\n");
    const reviewedTree = (await captureWorkingTreeSnapshot(repository)).tree;

    await writeFile(join(repository, "app.txt"), "base\noriginal review change\nfeedback fix\n");
    const comparison = await loadComparison(repository, reviewedTree);

    expect(comparison.base).toBe(reviewedTree);
    expect(comparison.mergeBase).toBe(reviewedTree);
    expect(comparison.patch).toContain("+feedback fix");
    expect(comparison.patch).not.toContain("+original review change");
  });

  test("loads both sides of a changed Markdown file for preview", async () => {
    const repository = await mkdtemp(join(tmpdir(), "review-tour-markdown-"));
    repositories.push(repository);
    await git(repository, "init", "-b", "main");
    await git(repository, "config", "user.name", "Review Tour Test");
    await git(repository, "config", "user.email", "review-tour@example.test");
    await writeFile(join(repository, "README.md"), "# Before\n");
    await git(repository, "add", "README.md");
    await git(repository, "commit", "-m", "base");
    await writeFile(join(repository, "README.md"), "# After\n\nUpdated docs.\n");

    const comparison = await loadComparison(repository);

    expect(await loadDiffText(comparison, "README.md", "old")).toBe("# Before\n");
    expect(await loadDiffText(comparison, "README.md", "new")).toBe("# After\n\nUpdated docs.\n");
    await expect(loadDiffText(comparison, "README.txt", "new")).rejects.toThrow("Markdown");
  });
});
