import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBriefing, resolveBriefingQuestion, validBriefingDocument } from "../src/briefing.ts";
import { briefingEvidenceText, captureBriefingDiffs, validBriefingDiff } from "../src/briefing-diff.ts";
import { briefingMarkdown, withBriefingExport } from "../src/briefing-export.ts";
import { loadCapturedSource } from "../src/diff-sources.ts";
import { loadComparison } from "../src/git.ts";
import { runProcess } from "../src/process.ts";
import type { GitComparison, TourOutline } from "../src/types.ts";

let root: string, comparison: GitComparison;
const outline: TourOutline = { title: "Change the calculation", summary: "Keep the surrounding behavior.", phases: [], flows: [], callFlows: [], findings: [] };
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "briefing-diffs-"));
  const git = (...args: string[]) => runProcess(["git", ...args], root);
  await git("init", "-b", "main"); await git("config", "user.name", "Test"); await git("config", "user.email", "test@example.invalid");
  await writeFile(join(root, "calc.ts"), ["// calculation", "const value = 10;", ...Array.from({ length: 40 }, (_, i) => `// context ${i}`)].join("\n") + "\n");
  await writeFile(join(root, "name.ts"), "// stable renamed source\n".repeat(10));
  await writeFile(join(root, "deleted.ts"), "const removed = true;\n");
  await writeFile(join(root, "unchanged.ts"), "export const shared = true;\n");
  await writeFile(join(root, "large.ts"), Array.from({ length: 200 }, (_, i) => `oldCall(${i});`).join("\n") + "\n");
  await writeFile(join(root, "signs.ts"), "--count;\n");
  await writeFile(join(root, "newline.ts"), "const eof = true;");
  await git("add", "."); await git("commit", "-m", "base");
  await writeFile(join(root, "calc.ts"), ["// calculation", "const subtotal = 20;", "const value = subtotal * 0.9;", ...Array.from({ length: 40 }, (_, i) => `// context ${i}`)].join("\n") + "\n");
  await rename(join(root, "name.ts"), join(root, "renamed.ts")); await rm(join(root, "deleted.ts"));
  await writeFile(join(root, "added.ts"), "export const added = true;\r\n");
  await writeFile(join(root, "large.ts"), Array.from({ length: 200 }, (_, i) => `newCall(${i});`).join("\n") + "\n");
  await writeFile(join(root, "signs.ts"), "++count;\n");
  await writeFile(join(root, "newline.ts"), "const eof = true;\n");
  await git("add", "."); comparison = await loadComparison(root, "HEAD", 0);
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

async function documentFor(path: string, side: "old" | "new", startLine: number, endLine = startLine) {
  const source = await loadCapturedSource(comparison, side, path);
  return buildBriefing(comparison, outline, "", {
    title: outline.title, sections: [{ id: "change", title: "Calculate", blocks: [{ id: "snippet", kind: "source", evidenceId: "code" }] }],
    evidence: [{ id: "code", path, side, startLine, endLine, quote: source.text.split(/\r?\n/).slice(startLine - 1, endLine).join("\n") }],
  });
}

test("a citation on either side includes the actual replacement with old/new line numbers", async () => {
  for (const side of ["old", "new"] as const) {
    const doc = await documentFor("calc.ts", side, 2);
    expect(validBriefingDocument(doc)).toBe(true);
    const diff = doc.evidence[0]!.diff!;
    expect(diff.available).toBe(true);
    if (!diff.available) throw Error(diff.reason);
    expect(diff.rows).toContainEqual({ kind: "deletion", content: "const value = 10;", oldLine: 2, newLine: null });
    expect(diff.rows).toContainEqual({ kind: "addition", content: "const value = subtotal * 0.9;", oldLine: null, newLine: 3 });
    expect(diff.rows).toContainEqual({ kind: "context", content: "// context 0", oldLine: 3, newLine: 4 });
    const selected = resolveBriefingQuestion(doc, { documentId: doc.id, items: [{ blockId: "snippet" }] });
    expect(selected.items[0]!.text).toContain("-const value = 10;");
    expect(selected.items[0]!.text).toContain("+const subtotal = 20;");
  }
});

test("added/deleted files, CRLF, repeated signs and missing final newlines retain honest diff semantics", async () => {
  for (const [path, side, kind] of [["added.ts", "new", "addition"], ["deleted.ts", "old", "deletion"]] as const) {
    const diff = (await documentFor(path, side, 1)).evidence[0]!.diff!;
    expect(diff.available).toBe(true);
    if (!diff.available) throw Error(diff.reason);
    expect(diff.rows[0]!.kind).toBe(kind);
    expect(diff.blobs[side === "new" ? "old" : "new"]).toBeNull();
    expect(diff.rows[0]!.content).not.toContain("\r");
  }
  expect(briefingEvidenceText((await documentFor("signs.ts", "new", 1)).evidence[0]!)).toContain("+++count;");
  expect(briefingEvidenceText((await documentFor("newline.ts", "new", 1)).evidence[0]!)).toContain("\\ No newline at end of file");
});

test("unchanged context maps shifted lines outside patch hunks and preserves rename paths", async () => {
  const moved = (await documentFor("calc.ts", "new", 30)).evidence[0]!.diff!;
  expect(moved.available).toBe(true);
  if (!moved.available) throw Error(moved.reason);
  expect(moved.rows.every(r => r.kind === "context")).toBe(true);
  expect(moved.rows.some(r => r.oldLine === 29 && r.newLine === 30)).toBe(true);
  const renamed = (await documentFor("renamed.ts", "new", 4)).evidence[0]!.diff!;
  expect(renamed.available && [renamed.oldPath, renamed.newPath]).toEqual(["name.ts", "renamed.ts"]);
  const unchanged = (await documentFor("unchanged.ts", "new", 1)).evidence[0]!.diff!;
  expect(unchanged.available && unchanged.rows.every(r => r.kind === "context")).toBe(true);
});

test("large replacements retain cited lines and mark omissions without inventing pairings", async () => {
  const doc = await documentFor("large.ts", "new", 90, 93), diff = doc.evidence[0]!.diff!;
  expect(validBriefingDocument(doc)).toBe(true);
  if (!diff.available) throw Error(diff.reason);
  expect(diff.rows.length).toBeLessThanOrEqual(160);
  expect(diff.rows.some(r => r.kind === "meta" && r.content.includes("lines omitted"))).toBe(true);
  expect(diff.rows).toContainEqual({ kind: "addition", content: "newCall(89);", oldLine: null, newLine: 90 });
  expect(diff.rows.some(r => r.kind === "deletion")).toBe(true);
});

test("resume fills missing diffs only for the same saved comparison and ignores workspace drift", async () => {
  const doc = await documentFor("calc.ts", "new", 2, 3), expected = structuredClone(doc.evidence[0]!.diff);
  Reflect.deleteProperty(doc.evidence[0]!, "diff");
  await writeFile(join(root, "calc.ts"), "workspace changed after capture\n");
  await captureBriefingDiffs(comparison, doc);
  expect(doc.evidence[0]!.diff).toEqual(expected);
  Reflect.deleteProperty(doc.evidence[0]!, "diff");
  await captureBriefingDiffs({ ...comparison, sourceTree: "a".repeat(40) }, doc);
  expect(doc.evidence[0]!.diff).toBeUndefined();
  expect(briefingMarkdown(doc)).toContain("Diff unavailable");
  expect(briefingMarkdown(doc)).not.toContain("const subtotal");
  const tampered = structuredClone(comparison);
  tampered.files.find(f => f.path === "calc.ts")!.hunks[0]!.rows[0]!.content = "invented counterpart";
  await captureBriefingDiffs(tampered, doc);
  expect(doc.evidence[0]!.diff?.available).toBe(false);
});

test("diffs persist in both export formats and malformed saved rows are rejected", async () => {
  const doc = await documentFor("calc.ts", "new", 2, 3);
  const md = briefingMarkdown(doc), html = withBriefingExport('<body><nav class="tabs"></nav></body>', doc, comparison);
  expect(md).toContain("```diff\n"); expect(md).toContain("-const value = 10;"); expect(md).toContain("+const subtotal = 20;");
  expect(html).toContain('"kind":"deletion"'); expect(html).toContain("briefing-diff");
  const corrupt = structuredClone(doc), diff = corrupt.evidence[0]!.diff!;
  if (!diff.available) throw Error(diff.reason);
  diff.rows[0]!.oldLine = -1;
  expect(validBriefingDiff(diff)).toBe(false); expect(validBriefingDocument(corrupt)).toBe(false);
});
