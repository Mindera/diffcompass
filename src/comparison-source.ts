import { runProcess } from "./process.ts";
import { parseUnifiedDiff } from "./diff.ts";
import type { GitComparison } from "./types.ts";

/** Read only immutable comparison objects, including captured working-tree reviews. */
export async function capturedComparisonSource(comparison: GitComparison, path: string, side: "old" | "new", maxBytes = 256_000): Promise<string> {
  const file = comparison.files.find((file) => file.path === path);
  if (!file) throw new Error("Changed file is absent from this comparison.");
  const sourcePath = side === "old" ? file.oldPath : file.newPath;
  if (sourcePath === null) return "";
  const tree = side === "old" ? comparison.mergeBase : comparison.sourceTree;
  if (!tree || !/^[a-f0-9]{40,64}$/.test(tree)) throw new Error(`Captured ${side === "old" ? "before" : "after"} source is unavailable. Refresh the review to capture both versions.`);
  if (!sourcePath || sourcePath.startsWith("/") || sourcePath.includes(":") || sourcePath.split("/").some((part) => part === "..") || /[\x00-\x1f]/.test(sourcePath)) throw new Error("Invalid comparison source path.");
  const object = `${tree}:${sourcePath}`;
  const git = async (args: string[]) => (await runProcess(["git", ...args], comparison.repositoryRoot, [0], { timeoutMs: 5_000 })).stdout;
  const entry = (await git(["ls-tree", "-z", tree, "--", sourcePath])).split("\0").find((record) => record.slice(record.indexOf("\t") + 1) === sourcePath);
  if (!entry || !/^100(?:644|755) blob /.test(entry)) throw new Error("Captured source is not a regular text-file blob (symlinks and submodules are unsupported).");
  const size = Number((await git(["cat-file", "-s", object])).trim());
  if (!Number.isSafeInteger(size) || size < 0) throw new Error("Captured source is unavailable.");
  if (size > maxBytes) throw new Error(`Captured source exceeds the ${maxBytes.toLocaleString("en-US")} byte syntax-analysis limit.`);
  const source = await git(["cat-file", "blob", object]);
  if (source.includes("\0") || source.includes("\uFFFD")) throw new Error("Captured source is binary or is not supported UTF-8 text.");
  // Reject raced/legacy patches instead of describing a different source snapshot.
  const lines = source.split("\n");
  for (const hunk of file.hunks) for (const row of hunk.rows) {
    const line = side === "old" ? row.oldLine : row.newLine;
    if (row.kind !== "meta" && line !== null && lines[line - 1]?.replace(/\r$/, "") !== row.content.replace(/\r$/, "")) throw new Error("The saved diff does not match its captured source. Refresh the review before analysing syntax.");
  }
  return source;
}

/** Checking only visible rows misses captured edits omitted by a raced live patch. */
export async function validateCapturedFileDiff(comparison: GitComparison, path: string): Promise<void> {
  const file = comparison.files.find((entry) => entry.path === path);
  if (!file || !comparison.sourceTree || !/^[a-f0-9]{40,64}$/.test(comparison.mergeBase) || !/^[a-f0-9]{40,64}$/.test(comparison.sourceTree)) throw new Error("Captured comparison identity is unavailable.");
  const paths = [...new Set([file.oldPath, file.newPath].filter((value): value is string => Boolean(value)))];
  const result = await runProcess(["git", "diff", "--no-ext-diff", "--no-textconv", "--no-color", "--find-renames", "--unified=0", comparison.mergeBase, comparison.sourceTree, "--", ...paths], comparison.repositoryRoot, [0], { timeoutMs: 5_000 });
  const captured = parseUnifiedDiff(result.stdout).find((entry) => entry.path === path);
  const changes = (entry: typeof file) => entry.hunks.flatMap((hunk) => hunk.rows.filter((row, index, rows) => row.kind === "addition" || row.kind === "deletion" || (row.kind === "meta" && ["addition", "deletion"].includes(rows[index - 1]?.kind ?? ""))).map((row) => [row.kind, row.oldLine, row.newLine, row.content]));
  if (!captured || captured.oldPath !== file.oldPath || captured.newPath !== file.newPath || captured.status !== file.status || JSON.stringify(changes(captured)) !== JSON.stringify(changes(file))) throw new Error("The saved diff does not contain the exact captured file changes. Refresh the review before analysing syntax.");
}
