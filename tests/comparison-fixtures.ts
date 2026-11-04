import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadCapturedSource } from "../src/diff-sources.ts";
import { loadComparisonBetweenTrees } from "../src/git.ts";
import { runProcess } from "../src/process.ts";
import type { GitComparison } from "../src/types.ts";

const git = async (root: string, ...args: string[]) => (await runProcess(["git", ...args], root)).stdout.trim();

async function commitSha(root: string, ref: string): Promise<string> {
  try { return await git(root, "rev-parse", "--verify", `${ref}^{commit}`); }
  catch { throw new Error(`Historical commit ${ref} is unavailable; CI must check out full history (actions/checkout fetch-depth: 0).`); }
}

export async function historicalComparison(base: string, head: string): Promise<GitComparison> {
  const root = join(import.meta.dir, "..");
  const baseSha = await commitSha(root, base);
  const headSha = await commitSha(root, head);
  return loadComparisonBetweenTrees(root, { base: baseSha, mergeBase: baseSha, head: headSha, sourceTree: headSha });
}

export async function repositoryComparison(before: Record<string, string>, after: Record<string, string | null>): Promise<{ root: string; comparison: GitComparison; cleanup(): Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "diffcompass-facts-"));
  const cleanup = () => rm(root, { recursive: true, force: true });
  try {
    await git(root, "init", "-b", "main");
    await git(root, "config", "user.name", "Test");
    await git(root, "config", "user.email", "test@example.invalid");
    for (const [path, text] of Object.entries(before)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text);
    }
    await git(root, "add", "-A");
    await git(root, "commit", "--allow-empty", "-m", "base");
    const baseSha = await git(root, "rev-parse", "HEAD");
    for (const [path, text] of Object.entries(after)) {
      if (text === null) { await rm(join(root, path)); continue; }
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text);
    }
    await git(root, "add", "-A");
    await git(root, "commit", "--allow-empty", "-m", "head");
    const headSha = await git(root, "rev-parse", "HEAD");
    const comparison = await loadComparisonBetweenTrees(root, { base: baseSha, mergeBase: baseSha, head: headSha, sourceTree: headSha });
    return { root, comparison, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export async function capturedText(comparison: GitComparison, side: "old" | "new", path: string): Promise<string> {
  return (await loadCapturedSource(comparison, side, path)).text;
}
