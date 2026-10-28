import { runProcess } from "./process.ts";
import type { GitComparison } from "./types.ts";

export const CAPTURED_BLOBS_TIMEOUT = "Reading captured blobs timed out.";

export interface CapturedTreeEntry { path: string; mode: string; oid: string; size: number }

export async function listCapturedTree(comparison: GitComparison, side: "old" | "new"): Promise<CapturedTreeEntry[]> {
  const treeish = side === "old" ? comparison.mergeBase : comparison.sourceTree;
  if (!treeish || !/^[a-f0-9]{40,64}$/.test(treeish)) throw new Error("Captured tree is unavailable.");
  const output = (await runProcess(["git", "ls-tree", "-r", "-z", "-l", treeish], comparison.repositoryRoot, [0], { timeoutMs: 30_000 })).stdout;
  const entries: CapturedTreeEntry[] = [];
  for (const record of output.split("\0")) {
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    const [mode, type, oid, size] = record.slice(0, tab).split(/\s+/);
    if (type !== "blob" || (mode !== "100644" && mode !== "100755")) continue;
    entries.push({ path: record.slice(tab + 1), mode, oid, size: Number(size) });
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

export async function readCapturedBlobs(comparison: GitComparison, oids: readonly string[], timeoutMs = 30_000): Promise<Map<string, string | null>> {
  const unique = [...new Set(oids)];
  const result = new Map<string, string | null>();
  if (!unique.length) return result;
  const process = Bun.spawn(["git", "cat-file", "--batch"], { cwd: comparison.repositoryRoot, stdin: "pipe", stdout: "pipe", stderr: "ignore" });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; process.kill(); }, timeoutMs);
  let bytes: Uint8Array;
  let exitCode: number;
  try {
    const collected = new Response(process.stdout).arrayBuffer();
    collected.catch(() => {});
    process.stdin.write(`${unique.join("\n")}\n`);
    await process.stdin.end();
    bytes = new Uint8Array(await collected);
    exitCode = await process.exited;
  } catch (error) {
    if (timedOut) throw new Error(CAPTURED_BLOBS_TIMEOUT);
    throw error;
  } finally {
    clearTimeout(timer);
    if (process.exitCode === null) process.kill();
  }
  if (timedOut) throw new Error(CAPTURED_BLOBS_TIMEOUT);
  if (exitCode !== 0) throw new Error(`git cat-file exited with ${exitCode}.`);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let position = 0;
  while (position < bytes.length) {
    const lineEnd = bytes.indexOf(10, position);
    if (lineEnd < 0) throw new Error("Captured blob output is malformed.");
    const [oid, kind, size] = new TextDecoder().decode(bytes.subarray(position, lineEnd)).split(" ");
    position = lineEnd + 1;
    if (kind === "missing") { result.set(oid, null); continue; }
    if (kind !== "blob") throw new Error("Captured blob output is malformed.");
    const end = position + Number(size);
    const content = bytes.subarray(position, end);
    position = end + 1;
    if (content.includes(0)) { result.set(oid, null); continue; }
    try { result.set(oid, decoder.decode(content)); }
    catch { result.set(oid, null); }
  }
  return result;
}
