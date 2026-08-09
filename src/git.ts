import { basename } from "node:path";
import { lstat, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { parseUnifiedDiff } from "./diff.ts";
import { ReviewError } from "./errors.ts";
import { runProcess } from "./process.ts";
import type { DiffFile, GitComparison } from "./types.ts";

const MAX_CHANGE_PATCH_BYTES = 12 * 1024 * 1024;

export interface WorkingTreeSnapshot {
  tree: string;
  indexTree: string;
}

export interface ProposalWorkspace extends WorkingTreeSnapshot {
  path: string;
  temporaryRoot: string;
}

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

export async function captureWorkingTreeSnapshot(repositoryRoot: string): Promise<WorkingTreeSnapshot> {
  const temporary = await mkdtemp(join(tmpdir(), "code-review-tour-index-"));
  const indexFile = join(temporary, "index");
  const options = { env: { GIT_INDEX_FILE: indexFile } };
  try {
    await runProcess(["git", "read-tree", "HEAD"], repositoryRoot, [0], options);
    await runProcess(["git", "add", "-A", "--", "."], repositoryRoot, [0], options);
    const tree = (await runProcess(["git", "write-tree"], repositoryRoot, [0], options)).stdout.trim();
    const indexTree = await git(repositoryRoot, ["write-tree"]);
    return { tree, indexTree };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function createProposalWorkspace(repositoryRoot: string): Promise<ProposalWorkspace> {
  const baseline = await captureWorkingTreeSnapshot(repositoryRoot);
  const temporaryRoot = await mkdtemp(join(tmpdir(), "code-review-tour-proposal-"));
  const path = join(temporaryRoot, "workspace");
  try {
    await runProcess(["git", "worktree", "add", "--detach", "--no-checkout", path, "HEAD"], repositoryRoot);
    await runProcess(["git", "read-tree", "--reset", "-u", baseline.tree], path);
    return { ...baseline, path, temporaryRoot };
  } catch (error) {
    await runProcess(["git", "worktree", "remove", "--force", path], repositoryRoot, [0, 128]).catch(() => undefined);
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

export async function removeProposalWorkspace(repositoryRoot: string, workspace: ProposalWorkspace): Promise<void> {
  await runProcess(["git", "worktree", "remove", "--force", workspace.path], repositoryRoot, [0, 128]).catch(() => undefined);
  await rm(workspace.temporaryRoot, { recursive: true, force: true });
}

export async function createChangePatch(repositoryRoot: string, beforeTree: string, afterTree: string): Promise<string> {
  const patch = (await runProcess([
    "git", "diff", "--binary", "--full-index", "--find-renames", "--no-ext-diff", "--no-color", beforeTree, afterTree, "--",
  ], repositoryRoot)).stdout;
  if (new TextEncoder().encode(patch).byteLength > MAX_CHANGE_PATCH_BYTES) {
    throw new ReviewError("The proposed agent change exceeds the 12 MiB approval limit. Split it into smaller requests.");
  }
  return patch;
}

export async function applyChangePatch(repositoryRoot: string, patch: string, reverse = false): Promise<void> {
  if (!patch.trim()) return;
  const direction = reverse ? ["-R"] : [];
  try {
    await runProcess(["git", "apply", "--check", "--binary", ...direction], repositoryRoot, [0], { input: patch });
    await runProcess(["git", "apply", "--binary", ...direction], repositoryRoot, [0], { input: patch });
  } catch (error) {
    throw new ReviewError(`The ${reverse ? "undo" : "apply"} cannot proceed because the working tree no longer matches the captured change. Resolve the overlapping edits and retry.`, { cause: error });
  }
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

export async function loadDiffFileWithContext(comparison: GitComparison, path: string, context: number): Promise<DiffFile> {
  const existing = comparison.files.find((candidate) => candidate.path === path);
  if (!existing) throw new ReviewError("Changed file does not exist in this comparison.");
  const boundedContext = Math.max(3, Math.min(200, Math.trunc(context)));
  const paths = [...new Set([existing.oldPath, existing.newPath].filter((candidate): candidate is string => Boolean(candidate)))];
  let patch = await git(comparison.repositoryRoot, [
    "diff", "--no-ext-diff", "--no-color", "--find-renames", `--unified=${boundedContext}`,
    comparison.mergeBase, "--", ...paths,
  ]);
  if (!patch && existing.status === "added" && comparison.repositoryFiles.includes(path)) {
    patch = (await runProcess(
      ["git", "diff", "--no-index", "--no-color", `--unified=${boundedContext}`, "--", "/dev/null", path],
      comparison.repositoryRoot,
      [0, 1],
    )).stdout.trimEnd();
  }
  return parseUnifiedDiff(patch).find((candidate) => candidate.path === path) ?? structuredClone(existing);
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
