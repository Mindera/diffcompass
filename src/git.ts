import { basename } from "node:path";
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { parseUnifiedDiff } from "./diff.ts";
import { ReviewError } from "./errors.ts";
import { runProcess } from "./process.ts";
import type { DiffFile, GitComparison } from "./types.ts";

const MAX_CHANGE_PATCH_BYTES = 12 * 1024 * 1024;
const MAX_DIFF_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_DIFF_TEXT_BYTES = 1 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

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

async function treeExists(cwd: string, ref: string): Promise<boolean> {
  try {
    await git(cwd, ["rev-parse", "--verify", `${ref}^{tree}`]);
    return true;
  } catch {
    return false;
  }
}

async function treeId(cwd: string, ref: string): Promise<string> {
  return git(cwd, ["rev-parse", "--verify", `${ref}^{tree}`]);
}

function checkpointRefIsSafe(ref: string): boolean {
  return /^refs\/diffcompass\/checkpoints\/[A-Za-z0-9._-]{1,128}\/[0-9a-f-]{36}$/.test(ref);
}

/** Keep the tree reachable from a private ref so repository maintenance cannot prune it. */
export async function writeCheckpointRef(repositoryRoot: string, ref: string, tree: string): Promise<void> {
  if (!checkpointRefIsSafe(ref)) throw new ReviewError("The checkpoint ref is invalid.");
  const resolvedTree = await treeId(repositoryRoot, tree).catch(() => "");
  if (!/^[0-9a-f]{40,64}$/.test(resolvedTree)) throw new ReviewError("The checkpoint source tree is unavailable.");
  await git(repositoryRoot, ["update-ref", ref, resolvedTree]);
}

export async function removeCheckpointRef(repositoryRoot: string, ref: string): Promise<void> {
  if (!checkpointRefIsSafe(ref)) throw new ReviewError("The checkpoint ref is invalid.");
  await git(repositoryRoot, ["update-ref", "-d", ref]);
}

export async function resolveRepositoryRoot(cwd: string): Promise<string> {
  return git(cwd, ["rev-parse", "--show-toplevel"]);
}

async function resolveRepositoryName(repositoryRoot: string): Promise<string> {
  const origin = await git(repositoryRoot, ["config", "--get", "remote.origin.url"], [0, 1]);
  if (!origin) return basename(repositoryRoot);
  const remoteName = origin.replace(/[\\/]+$/, "").split(/[\\/:]/).filter(Boolean).at(-1)?.replace(/\.git$/i, "");
  return remoteName || basename(repositoryRoot);
}

export async function captureWorkingTreeSnapshot(repositoryRoot: string): Promise<WorkingTreeSnapshot> {
  const temporary = await mkdtemp(join(tmpdir(), "diffcompass-index-"));
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
  const temporaryRoot = await mkdtemp(join(tmpdir(), "diffcompass-proposal-"));
  await writeFile(join(temporaryRoot, ".active.json"), `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`, { mode: 0o600 });
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
    if (!(await refExists(repositoryRoot, explicitBase)) && !(await treeExists(repositoryRoot, explicitBase))) {
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

async function untrackedPatch(repositoryRoot: string, contextLines = 3): Promise<string> {
  const output = await git(repositoryRoot, ["ls-files", "--others", "--exclude-standard", "-z"]);
  const paths = output.split("\0").filter(Boolean);
  const patches: string[] = [];

  for (const path of paths) {
    const result = await runProcess(
      ["git", "diff", "--no-index", "--no-color", `--unified=${contextLines}`, "--", "/dev/null", path],
      repositoryRoot,
      [0, 1],
    );
    patches.push(result.stdout.trimEnd());
  }

  return patches.filter(Boolean).join("\n");
}

export async function loadComparison(cwd: string, explicitBase?: string, contextLines = 3): Promise<GitComparison> {
  const repositoryRoot = await resolveRepositoryRoot(cwd);
  const repositoryName = await resolveRepositoryName(repositoryRoot);
  const base = await resolveBase(repositoryRoot, explicitBase);
  const mergeBase = await refExists(repositoryRoot, base)
    ? await git(repositoryRoot, ["merge-base", base, "HEAD"])
    : await git(repositoryRoot, ["rev-parse", "--verify", `${base}^{tree}`]);
  const head = await git(repositoryRoot, ["rev-parse", "HEAD"]);
  const branch = await git(repositoryRoot, ["branch", "--show-current"]);
  const source = await captureWorkingTreeSnapshot(repositoryRoot);
  const comparison = await loadComparisonBetweenTrees(repositoryRoot, {
    repositoryName,
    branch: branch || undefined,
    base,
    mergeBase,
    head,
    sourceTree: source.tree,
    contextLines,
  });
  const trackedPatch = await git(repositoryRoot, [
    "diff", "--no-ext-diff", "--no-color", "--find-renames",
    `--unified=${Math.max(3, Math.min(200, Math.trunc(contextLines)))}`, mergeBase, "--",
  ]);
  const patch = [trackedPatch, await untrackedPatch(repositoryRoot, contextLines)].filter(Boolean).join("\n");
  return { ...comparison, sourceKind: "working-tree", patch, files: parseUnifiedDiff(patch) };
}

export async function loadComparisonBetweenTrees(
  cwd: string,
  input: { base: string; mergeBase: string; head?: string; sourceTree: string; repositoryName?: string; branch?: string; contextLines?: number },
): Promise<GitComparison> {
  const repositoryRoot = await resolveRepositoryRoot(cwd);
  const repositoryName = input.repositoryName ?? await resolveRepositoryName(repositoryRoot);
  const branch = input.branch ?? await git(repositoryRoot, ["branch", "--show-current"]);
  const head = input.head ?? await git(repositoryRoot, ["rev-parse", "HEAD"]);
  const mergeBase = input.mergeBase;
  const mergeBaseTree = await treeId(repositoryRoot, input.mergeBase);
  const sourceTree = await treeId(repositoryRoot, input.sourceTree);
  const contextLines = input.contextLines ?? 3;
  const patch = await git(repositoryRoot, [
    "diff",
    "--no-ext-diff",
    "--no-color",
    "--find-renames",
    `--unified=${Math.max(3, Math.min(200, Math.trunc(contextLines)))}`,
    mergeBaseTree,
    sourceTree,
    "--",
  ]);
  const repositoryFiles = (await git(repositoryRoot, ["ls-tree", "-r", "--name-only", "-z", sourceTree]))
    .split("\0")
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));

  return {
    repositoryRoot,
    repositoryName,
    branch: branch || undefined,
    base: input.base,
    mergeBase,
    head,
    patch,
    sourceTree,
    sourceKind: "tree",
    files: parseUnifiedDiff(patch),
    repositoryFiles,
  };
}

export async function loadDiffFileWithContext(comparison: GitComparison, path: string, context: number, fullFile = false): Promise<DiffFile> {
  const existing = comparison.files.find((candidate) => candidate.path === path);
  if (!existing) throw new ReviewError("Changed file does not exist in this comparison.");
  const boundedContext = fullFile ? 1_000_000 : Math.max(3, Math.min(200, Math.trunc(context)));
  const paths = [...new Set([existing.oldPath, existing.newPath].filter((candidate): candidate is string => Boolean(candidate)))];
  let patch = await git(comparison.repositoryRoot, [
    "diff", "--no-ext-diff", "--no-color", "--find-renames", `--unified=${boundedContext}`,
    ...(comparison.sourceKind === "tree" ? [comparison.mergeBase, comparison.sourceTree ?? "HEAD"] : [comparison.mergeBase]), "--", ...paths,
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
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new ReviewError("Only regular repository files can be opened.");
    if (metadata.size > maxBytes) throw new ReviewError("Repository file is too large to display.");
    const content = await readFile(candidate);
    if (content.includes(0)) throw new ReviewError("Binary repository files cannot be displayed.");
    return content.toString("utf8");
  } catch (error) {
    if (error instanceof ReviewError) throw error;
    throw new ReviewError("Repository file could not be read.");
  }
}

function pngBytes(data: ArrayBuffer): ArrayBuffer {
  const bytes = new Uint8Array(data);
  if (bytes.byteLength > MAX_DIFF_IMAGE_BYTES) throw new ReviewError("The changed PNG is too large to display.");
  if (PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) throw new ReviewError("The changed file is not a valid PNG image.");
  return data;
}

export async function loadDiffImage(comparison: GitComparison, path: string, side: "old" | "new"): Promise<{ data: ArrayBuffer; mimeType: "image/png" }> {
  const file = comparison.files.find((candidate) => candidate.path === path);
  if (!file || !/\.png$/i.test(file.path)) throw new ReviewError("Changed PNG does not exist in this comparison.");
  const sourcePath = side === "old" ? file.oldPath : file.newPath;
  if (!sourcePath) throw new ReviewError(`The changed PNG has no ${side} version.`);

  if (side === "old") {
    const object = `${comparison.mergeBase}:${sourcePath}`;
    const size = Number(await git(comparison.repositoryRoot, ["cat-file", "-s", object]).catch(() => "NaN"));
    if (!Number.isSafeInteger(size) || size < 0) throw new ReviewError("The previous PNG is unavailable.");
    if (size > MAX_DIFF_IMAGE_BYTES) throw new ReviewError("The changed PNG is too large to display.");
    const process = Bun.spawn(["git", "cat-file", "blob", object], {
      cwd: comparison.repositoryRoot,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
    });
    const [data, exitCode] = await Promise.all([
      new Response(process.stdout).arrayBuffer(),
      process.exited,
    ]);
    if (exitCode !== 0) throw new ReviewError("The previous PNG is unavailable.");
    return { data: pngBytes(data), mimeType: "image/png" };
  }

  if (comparison.sourceKind === "tree" && comparison.sourceTree) {
    const object = `${comparison.sourceTree}:${sourcePath}`;
    const size = Number(await git(comparison.repositoryRoot, ["cat-file", "-s", object]).catch(() => "NaN"));
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_DIFF_IMAGE_BYTES) throw new ReviewError("The changed PNG is unavailable.");
    const process = Bun.spawn(["git", "cat-file", "blob", object], { cwd: comparison.repositoryRoot, stdin: "ignore", stdout: "pipe", stderr: "ignore" });
    const [data, exitCode] = await Promise.all([new Response(process.stdout).arrayBuffer(), process.exited]);
    if (exitCode !== 0) throw new ReviewError("The changed PNG is unavailable.");
    return { data: pngBytes(data), mimeType: "image/png" };
  }

  const root = await realpath(comparison.repositoryRoot);
  const candidate = resolve(root, sourcePath);
  const relativePath = relative(root, candidate);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) throw new ReviewError("Changed PNG path is invalid.");
  const metadata = await lstat(candidate).catch(() => undefined);
  if (!metadata?.isFile() || metadata.isSymbolicLink()) throw new ReviewError("The changed PNG is unavailable.");
  const realCandidate = await realpath(candidate);
  const realRelativePath = relative(root, realCandidate);
  if (!realRelativePath || realRelativePath.startsWith("..") || isAbsolute(realRelativePath)) throw new ReviewError("Changed PNG path is invalid.");
  if (metadata.size > MAX_DIFF_IMAGE_BYTES) throw new ReviewError("The changed PNG is too large to display.");
  const content = await readFile(candidate);
  const data = content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer;
  return { data: pngBytes(data), mimeType: "image/png" };
}

export async function loadDiffText(comparison: GitComparison, path: string, side: "old" | "new"): Promise<string> {
  const file = comparison.files.find((candidate) => candidate.path === path);
  if (!file || !/\.md$/i.test(file.path)) throw new ReviewError("Changed Markdown file does not exist in this comparison.");
  const sourcePath = side === "old" ? file.oldPath : file.newPath;
  if (!sourcePath) throw new ReviewError(`The changed Markdown file has no ${side} version.`);

  if (side === "old") {
    const object = `${comparison.mergeBase}:${sourcePath}`;
    const size = Number(await git(comparison.repositoryRoot, ["cat-file", "-s", object]).catch(() => "NaN"));
    if (!Number.isSafeInteger(size) || size < 0) throw new ReviewError("The previous Markdown file is unavailable.");
    if (size > MAX_DIFF_TEXT_BYTES) throw new ReviewError("The changed Markdown file is too large to display.");
    const process = Bun.spawn(["git", "cat-file", "blob", object], {
      cwd: comparison.repositoryRoot,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
    });
    const [content, exitCode] = await Promise.all([new Response(process.stdout).arrayBuffer(), process.exited]);
    if (exitCode !== 0) throw new ReviewError("The previous Markdown file is unavailable.");
    const bytes = new Uint8Array(content);
    if (bytes.includes(0)) throw new ReviewError("Binary files cannot be previewed as Markdown.");
    return new TextDecoder().decode(bytes);
  }

  if (comparison.sourceKind === "tree" && comparison.sourceTree) {
    const object = `${comparison.sourceTree}:${sourcePath}`;
    const size = Number(await git(comparison.repositoryRoot, ["cat-file", "-s", object]).catch(() => "NaN"));
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_DIFF_TEXT_BYTES) throw new ReviewError("The changed Markdown file is unavailable.");
    const process = Bun.spawn(["git", "cat-file", "blob", object], { cwd: comparison.repositoryRoot, stdin: "ignore", stdout: "pipe", stderr: "ignore" });
    const [content, exitCode] = await Promise.all([new Response(process.stdout).arrayBuffer(), process.exited]);
    if (exitCode !== 0) throw new ReviewError("The changed Markdown file is unavailable.");
    const bytes = new Uint8Array(content);
    if (bytes.includes(0)) throw new ReviewError("Binary files cannot be previewed as Markdown.");
    return new TextDecoder().decode(bytes);
  }
  return loadRepositoryFile(comparison, sourcePath, MAX_DIFF_TEXT_BYTES);
}

export async function writeProposalFile(workspace: ProposalWorkspace, path: string, content: string, maxBytes = 1_000_000): Promise<void> {
  const encoded = new TextEncoder().encode(content);
  if (encoded.byteLength > maxBytes) throw new ReviewError("The edited repository file is too large.");
  const root = await realpath(workspace.path);
  const candidate = resolve(root, path);
  const relativePath = relative(root, candidate);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new ReviewError("Repository file path is invalid.");
  }
  try {
    const metadata = await lstat(candidate);
    if (!metadata.isFile()) throw new ReviewError("Only regular repository files can be edited.");
    const realCandidate = await realpath(candidate);
    const realRelativePath = relative(root, realCandidate);
    if (!realRelativePath || realRelativePath.startsWith("..") || isAbsolute(realRelativePath)) {
      throw new ReviewError("Repository file path is invalid.");
    }
    await writeFile(candidate, content, "utf8");
  } catch (error) {
    if (error instanceof ReviewError) throw error;
    throw new ReviewError("Repository file could not be edited.");
  }
}
