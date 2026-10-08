import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capturedComparisonSource } from "../src/comparison-source.ts";
import { cachedSemanticSummaries, semanticDiffForFile } from "../src/semantic-diff.ts";
import { semanticExport } from "../src/semantic-diff-export.ts";
import { exportReview } from "../src/export.ts";
import { loadComparison, loadDiffFileWithContext } from "../src/git.ts";
import { runProcess } from "../src/process.ts";
import { ReviewSession } from "../src/session.ts";
import { createRequestHandler } from "../src/server.ts";
import type { GitComparison } from "../src/types.ts";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const git = async (root: string, ...args: string[]) => (await runProcess(["git", ...args], root)).stdout.trim();
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "semantic-source-")); roots.push(root);
  await git(root, "init", "-b", "main");
  await git(root, "config", "user.name", "Fixture"); await git(root, "config", "user.email", "fixture@example.test");
  const before = Array.from({ length: 1_250 }, (_, i) => `// context ${i + 1}`).join("\n") + "\nexport function run() { return 1; }\n";
  await writeFile(join(root, "app.ts"), before); await writeFile(join(root, "deleted.ts"), "const removed = 1;\n");
  await git(root, "add", "."); await git(root, "commit", "-m", "fixture");
  await writeFile(join(root, "app.ts"), before.replace("return 1", "return 2")); await rm(join(root, "deleted.ts"));
  await writeFile(join(root, "added.ts"), "export const added = 7;\n");
  return { root, before, comparison: await loadComparison(root, "HEAD") };
}
function sessionFor(comparison: GitComparison) {
  const Constructor = ReviewSession as unknown as new (comparison: GitComparison, adapters: [], defaults: Record<string, never>) => ReviewSession;
  return new Constructor(comparison, [], {});
}

test("captured sources, full expansion and line identities survive live edit/delete/rename", async () => {
  const { root, before, comparison } = await fixture();
  for (const mutation of [async () => writeFile(join(root, "app.ts"), "const live = 999;\n"), async () => rename(join(root, "app.ts"), join(root, "moved.ts")), async () => rm(join(root, "moved.ts"))]) {
    await mutation();
    expect(await capturedComparisonSource(comparison, "app.ts", "old")).toBe(before);
    expect(await capturedComparisonSource(comparison, "app.ts", "new")).toBe(before.replace("return 1", "return 2"));
    for (const full of [false, true]) {
      const rows = (await loadDiffFileWithContext(comparison, "app.ts", 25, full)).hunks.flatMap((hunk) => hunk.rows);
      expect(rows).toContainEqual({ kind: "deletion", oldLine: 1251, newLine: null, content: "export function run() { return 1; }" });
      expect(rows).toContainEqual({ kind: "addition", oldLine: null, newLine: 1251, content: "export function run() { return 2; }" });
      if (full) expect(rows.some((row) => row.content === "// context 999")).toBe(true);
      expect(rows.some((row) => row.content.includes("const live"))).toBe(false);
    }
  }
});
test("captured untracked additions and deletions never substitute later live files", async () => {
  const { root, comparison } = await fixture();
  await rm(join(root, "added.ts")); await writeFile(join(root, "deleted.ts"), "const recreated = true;\n");
  expect(await capturedComparisonSource(comparison, "added.ts", "new")).toBe("export const added = 7;\n");
  expect(await capturedComparisonSource(comparison, "deleted.ts", "new")).toBe("");
  expect((await loadDiffFileWithContext(comparison, "added.ts", 200, true)).hunks[0]?.rows[0]?.content).toBe("export const added = 7;");
  expect((await loadDiffFileWithContext(comparison, "deleted.ts", 200, true)).hunks[0]?.rows[0]?.content).toBe("const removed = 1;");
  expect((await semanticDiffForFile(comparison, "added.ts")).changes[0]?.categories).toEqual(["added"]);
  expect((await semanticDiffForFile(comparison, "deleted.ts")).changes[0]?.categories).toEqual(["removed"]);
});

test("identical in-flight requests share work and refreshed identities cannot reuse cached output", async () => {
  const { comparison } = await fixture();
  const first = semanticDiffForFile(comparison, "app.ts");
  const second = semanticDiffForFile(comparison, "app.ts");
  expect(first).toBe(second); expect((await first).status).toBe("analysed");
  comparison.files.find((entry) => entry.path === "app.ts")!.oldPath = "different.ts";
  expect(cachedSemanticSummaries(comparison)).toEqual([]);
  expect((await semanticDiffForFile(comparison, "app.ts")).status).toBe("unavailable");
});

test("symlink text is not passed off as a parsed source file", async () => {
  const { root } = await fixture();
  await symlink("target", join(root, "link.ts"));
  const summary = await semanticDiffForFile(await loadComparison(root, "HEAD"), "link.ts");
  expect(summary.status).toBe("unavailable"); expect(summary.message).toContain("symlinks"); expect(summary.changes).toEqual([]);
});
test("missing snapshots, legacy reviews and captured-patch mismatch fail closed and recover", async () => {
  const { comparison } = await fixture();
  const missing = { ...comparison, sourceTree: "f".repeat(40) };
  await expect(loadDiffFileWithContext(missing, "added.ts", 200, true)).rejects.toThrow();
  expect((await semanticDiffForFile(missing, "added.ts")).status).toBe("unavailable");
  expect(cachedSemanticSummaries(missing)).toEqual([]);
  missing.sourceTree = comparison.sourceTree!;
  expect((await semanticDiffForFile(missing, "added.ts")).status).toBe("analysed");
  expect((await semanticDiffForFile({ ...comparison, sourceTree: undefined }, "deleted.ts")).status).toBe("unavailable");
  const raced = structuredClone(comparison);
  raced.files.find((file) => file.path === "added.ts")!.hunks[0]!.rows[0]!.content = "export const added = 99;";
  const mismatch = await semanticDiffForFile(raced, "added.ts");
  expect(mismatch.status).toBe("unavailable"); expect(mismatch.message).toContain("does not match its captured source"); expect(mismatch.changes).toEqual([]);
});
test("authenticated route, full expansion anchor paging, comparison invalidation and exports", async () => {
  const { comparison } = await fixture(); const session = sessionFor(comparison); const handle = createRequestHandler(session);
  const request = (path: string, authorized = true) => new Request(`http://127.0.0.1${path}`, { headers: authorized ? { "x-diffcompass-token": session.browserToken } : {} });
  expect((await handle(request("/api/diff/semantic?path=app.ts", false))).status).toBe(401);
  expect((await handle(request("/api/diff/semantic?path=missing.ts"))).status).toBe(404);
  const response = await handle(request("/api/diff/semantic?path=app.ts")); expect(response.status).toBe(200);
  const summary = await response.json(); expect(summary.status).toBe("analysed"); expect(summary.changes[0].after.startLine).toBe(1251);
  const expanded = await (await handle(request("/api/diff?path=app.ts&full=true&line=1251&side=new"))).json();
  expect(expanded.offset).toBeGreaterThan(0); expect(expanded.file.hunks.flatMap((hunk: any) => hunk.rows).some((row: any) => row.newLine === 1251)).toBe(true);
  for (const format of ["markdown", "html"] as const) {
    const exported = semanticExport(comparison, format); expect(exported).toContain("1 of 3 changed files"); expect(exported).toContain("not review-wide analysis"); expect(exported).toContain("Before app.ts:1251"); expect(exported).toContain(comparison.sourceTree!);
    expect(exported).toContain(format === "html" ? "<h2>What changed</h2>" : "## What changed");
    const document = exportReview(session, format).content;
    expect(document).toContain("Requested change summaries: 1 of 3");
    if (format === "html") {
      expect(document).toContain('data-view="changes">What changed</button>');
      expect(document).toContain('<section class="diff-panel"><section class="view" data-view-panel="changes" hidden>');
      expect(document.indexOf('class="semantic-export"')).toBeLessThan(document.indexOf('</main>'));
    }
  }
  comparison.sourceTree = "f".repeat(40);
  expect(cachedSemanticSummaries(comparison)).toEqual([]); expect(semanticExport(comparison, "html")).toBe("");
});

test("cache stays bounded and escapes unsupported file identities in offline HTML", async () => {
  const comparison: GitComparison = { repositoryRoot: "/unused", repositoryName: "fixture", base: "main", mergeBase: "a".repeat(40), sourceTree: "b".repeat(40), head: "b".repeat(40), patch: "", repositoryFiles: [], files: Array.from({ length: 40 }, (_, i) => ({ path: `${i}<script>.py`, oldPath: null, newPath: `${i}<script>.py`, status: "added", additions: 1, deletions: 0, metadata: [], hunks: [] })) };
  const burst = await Promise.all(comparison.files.slice(0, 5).map((file) => semanticDiffForFile(comparison, file.path)));
  expect(burst[4]?.status).toBe("unavailable"); expect(burst[4]?.message).toContain("already running");
  for (const file of comparison.files) expect((await semanticDiffForFile(comparison, file.path)).status).toBe("unsupported");
  expect(cachedSemanticSummaries(comparison)).toHaveLength(32);
  expect(cachedSemanticSummaries(comparison).some((summary) => summary.path === comparison.files[0]!.path)).toBe(false);
  expect(semanticExport(comparison, "html")).toContain("&lt;script&gt;");
  expect(semanticExport(comparison, "html")).not.toContain("<script>");
});

test("a captured edit omitted from the saved patch is rejected even when every remaining row matches", async () => {
  const { root, before } = await fixture();
  await writeFile(join(root, "app.ts"), before.replace("// context 10\n", "const snapshotOnly = 10;\n").replace("return 1", "return 2"));
  const captured = await loadComparison(root, "HEAD");
  await writeFile(join(root, "app.ts"), before.replace("return 1", "return 2"));
  const saved = await loadComparison(root, "HEAD");
  saved.sourceTree = captured.sourceTree;
  expect(await capturedComparisonSource(saved, "app.ts", "new")).toContain("snapshotOnly");
  const summary = await semanticDiffForFile(saved, "app.ts");
  expect(summary.status).toBe("unavailable"); expect(summary.message).toContain("exact captured file changes"); expect(summary.changes).toEqual([]);
});

test("whole-file validation retains CRLF, EOF markers and renamed old/new paths", async () => {
  const { root } = await fixture();
  const crlf = "export const original = 1;\r\nexport const kept = 1;\r\nexport const more = 2;\r\n// final context";
  await writeFile(join(root, "crlf.ts"), crlf);
  await git(root, "add", "crlf.ts"); await git(root, "commit", "-m", "CRLF fixture");
  await rename(join(root, "crlf.ts"), join(root, "renamed.ts"));
  await writeFile(join(root, "renamed.ts"), crlf.replace("original = 1", "original = 2"));
  await git(root, "add", "crlf.ts", "renamed.ts");
  const comparison = await loadComparison(root, "HEAD");
  const summary = await semanticDiffForFile(comparison, "renamed.ts");
  expect(summary.status).toBe("analysed"); expect(summary.renamed).toBe(true);
  expect(summary.changes[0]?.before?.path).toBe("crlf.ts"); expect(summary.changes[0]?.after?.path).toBe("renamed.ts");
});
