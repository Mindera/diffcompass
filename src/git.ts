import { basename } from "node:path";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { parseUnifiedDiff } from "./diff.ts";
import { ReviewError } from "./errors.ts";
import { runProcess } from "./process.ts";
import type { GitComparison } from "./types.ts";

async function git(cwd: string, args: string[], acceptedExitCodes?: number[]): Promise<string> {
  return (await runProcess(["git", ...args], cwd, acceptedExitCodes)).stdout.trimEnd();
}

async function refExists(cwd: string, ref: string): Promise<boolean> {
  try {
    await git(cwd, ["rev-parse", "--verify", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

export async function resolveRepositoryRoot(cwd: string): Promise<string> {
  return git(cwd, ["rev-parse", "--show-toplevel"]);
}

export async function resolveBase(repositoryRoot: string, explicitBase?: string): Promise<string> {
  if (explicitBase) {
    if (!(await refExists(repositoryRoot, explicitBase))) {
      throw new Error(`Base ref does not exist: ${explicitBase}`);
    }
    return explicitBase;
  }

  const branch = await git(repositoryRoot, ["branch", "--show-current"]);
  if (branch) {
    const configured = await git(
      repositoryRoot,
      ["config", "--get", `branch.${branch}.reviewTourBase`],
      [0, 1],
    );
    if (configured && (await refExists(repositoryRoot, configured))) return configured;
  }

  const remoteHead = await git(
    repositoryRoot,
    ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
    [0, 1],
  );
  if (remoteHead && (await refExists(repositoryRoot, remoteHead))) return remoteHead;

  for (const candidate of ["origin/main", "origin/master", "main", "master"]) {
    if (await refExists(repositoryRoot, candidate)) return candidate;
  }

  throw new Error("Could not infer a base branch. Pass --base <ref>.");
}

async function untrackedPatch(repositoryRoot: string): Promise<string> {
  const output = await git(repositoryRoot, ["ls-files", "--others", "--exclude-standard", "-z"]);
  const paths = output.split("\0").filter(Boolean);
  const patches: string[] = [];

  for (const path of paths) {
    const result = await runProcess(
      ["git", "diff", "--no-index", "--no-color", "--unified=3", "--", "/dev/null", path],
      repositoryRoot,
      [0, 1],
    );
    patches.push(result.stdout.trimEnd());
  }

  return patches.filter(Boolean).join("\n");
}

export async function loadComparison(cwd: string, explicitBase?: string): Promise<GitComparison> {
  const repositoryRoot = await resolveRepositoryRoot(cwd);
  const base = await resolveBase(repositoryRoot, explicitBase);
  const mergeBase = await git(repositoryRoot, ["merge-base", base, "HEAD"]);
  const head = await git(repositoryRoot, ["rev-parse", "HEAD"]);
  const trackedPatch = await git(repositoryRoot, [
    "diff",
    "--no-ext-diff",
    "--no-color",
    "--find-renames",
    "--unified=3",
    mergeBase,
    "--",
  ]);
  const extraPatch = await untrackedPatch(repositoryRoot);
  const patch = [trackedPatch, extraPatch].filter(Boolean).join("\n");
  const repositoryFiles = (await git(repositoryRoot, ["ls-files", "-co", "--exclude-standard", "-z"]))
    .split("\0")
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));

  return {
    repositoryRoot,
    repositoryName: basename(repositoryRoot),
    base,
    mergeBase,
    head,
    patch,
    files: parseUnifiedDiff(patch),
    repositoryFiles,
  };
}

export async function loadRepositoryFile(comparison: GitComparison, path: string, maxBytes = 1_000_000): Promise<string> {
  if (!path || !comparison.repositoryFiles.includes(path)) throw new ReviewError("Repository file does not exist.");
  const root = await realpath(comparison.repositoryRoot);
  const candidate = resolve(root, path);
  const relativePath = relative(root, candidate);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new ReviewError("Repository file path is invalid.");
  }
  try {
    const metadata = await lstat(candidate);
    if (!metadata.isFile()) throw new ReviewError("Only regular repository files can be opened.");
    if (metadata.size > maxBytes) throw new ReviewError("Repository file is too large to display.");
    const content = await readFile(candidate);
    if (content.includes(0)) throw new ReviewError("Binary repository files cannot be displayed.");
    return content.toString("utf8");
  } catch (error) {
    if (error instanceof ReviewError) throw error;
    throw new ReviewError("Repository file could not be read.");
  }
}
