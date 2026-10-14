import { createHash } from "node:crypto";
import { runProcess } from "./process.ts";
import { HttpError } from "./validation.ts";
import type { GitComparison } from "./types.ts";

export const MAX_SOURCE_BYTES = 256_000;
const oid = /^[a-f0-9]{40,64}$/;
const languages: Record<string, string> = { ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", json: "json", css: "css", html: "html", md: "markdown", markdown: "markdown", py: "python", rb: "ruby", rs: "rust", go: "go", java: "java", kt: "kotlin", kts: "kotlin", sh: "shell", yaml: "yaml", yml: "yaml", sql: "sql", xml: "xml", c: "c", h: "c", cpp: "cpp", cs: "csharp" };

// Independent of mutable review state: comments and tour navigation never
// invalidate model identities. No current-workspace fallback is permitted.
export function diffSourceIdentity(comparison: GitComparison): string {
  return createHash("sha256").update(JSON.stringify([
    comparison.mergeBase, comparison.sourceTree ?? null,
    comparison.files.map(file => [file.path, file.oldPath, file.newPath, file.status]),
  ])).digest("hex");
}

export function diffSourceManifest(comparison: GitComparison) {
  return { comparisonId: diffSourceIdentity(comparison), files: comparison.files.map(file => ({
    path: file.path, status: file.status,
    language: languages[file.path.split(".").at(-1)?.toLowerCase() ?? ""] ?? "plaintext",
  })) };
}

class UnavailableSource extends Error {}
async function capturedSide(comparison: GitComparison, tree: string | undefined, path: string | null) {
  if (!tree || !oid.test(tree)) throw new UnavailableSource("This review has no captured source tree. Refresh it to capture one.");
  if (!path) return { text: "", blob: null };
  // Literal pathspec and NUL records also support names containing tabs, glob
  // characters or a leading colon. Symlinks/submodules are never followed.
  const entry = await runProcess(["git", "--literal-pathspecs", "ls-tree", "-z", tree, "--", path], comparison.repositoryRoot, [0], { timeoutMs: 10_000 });
  const records = entry.stdout.split("\0").filter(Boolean);
  const match = records.length === 1 ? /^(100644|100755) blob ([a-f0-9]{40,64})\t([\s\S]*)$/.exec(records[0]!) : null;
  if (!match || match[3] !== path) throw new UnavailableSource("Only captured regular text files can use Monaco (not symlinks or submodules).");
  const blob = match[2]!;
  const result = await runProcess(["git", "cat-file", "-s", blob], comparison.repositoryRoot, [0], { timeoutMs: 10_000 });
  const size = Number(result.stdout.trim());
  if (!Number.isSafeInteger(size) || size < 0) throw new UnavailableSource("Captured source is unavailable.");
  if (size > MAX_SOURCE_BYTES) throw new UnavailableSource("This file exceeds the Monaco limit of 256 KB per side. Use the current renderer.");
  const child = Bun.spawn(["git", "cat-file", "blob", blob], { cwd: comparison.repositoryRoot, stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  const timer = setTimeout(() => child.kill(), 10_000);
  try {
    const [bytes, code] = await Promise.all([new Response(child.stdout).arrayBuffer(), child.exited]);
    if (code !== 0 || bytes.byteLength !== size) throw new UnavailableSource("Captured source could not be read.");
    if (new Uint8Array(bytes).includes(0)) throw new UnavailableSource("Binary files use the current renderer.");
    try { return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), blob }; }
    catch { throw new UnavailableSource("This file is not UTF-8 text. Use the current renderer."); }
  } finally { clearTimeout(timer); }
}

export async function loadDiffSource(comparison: GitComparison, comparisonId: string, path: string) {
  if (diffSourceIdentity(comparison) !== comparisonId) throw new HttpError(409, "The comparison changed. Reload the diff before requesting source.");
  const file = comparison.files.find(file => file.path === path);
  if (!file) throw new HttpError(404, "This file is not part of the comparison.");
  try {
    if (file.metadata.some(line => /^(Binary files |GIT binary patch)/.test(line))) throw new UnavailableSource("Binary files use the current renderer.");
    const [before, after] = await Promise.all([
      capturedSide(comparison, comparison.mergeBase, file.oldPath),
      capturedSide(comparison, comparison.sourceTree, file.newPath),
    ]);
    return { comparisonId, path, available: true as const, old: before.text, new: after.text, blobs: { old: before.blob, new: after.blob } };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    return { comparisonId, path, available: false as const, reason: error instanceof UnavailableSource ? error.message : "Captured source is unavailable. Use the current renderer." };
  }
}

/** Read an exact regular file from the saved old/new Git tree, including context outside the patch. */
export async function loadCapturedSource(comparison: GitComparison, side: "old" | "new", path: string) {
  if (!path || path.startsWith("/") || path.split("/").some(part => !part || part === "." || part === "..") || /[\x00-\x1f]/.test(path)) throw new Error("Invalid captured source path.");
  return capturedSide(comparison, side === "old" ? comparison.mergeBase : comparison.sourceTree, path);
}
