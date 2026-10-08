import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSemanticPresentation } from "../public/semantic-diff-presentation.js";
import { loadComparison } from "../src/git.ts";
import { runProcess } from "../src/process.ts";
import { analyseSemanticSources, semanticDiffForFile, type SemanticChange } from "../src/semantic-diff.ts";
import { semanticExport } from "../src/semantic-diff-export.ts";
import { syntaxContextForTourStep } from "../src/semantic-diff-tour.ts";
import type { DiffFile } from "../src/types.ts";

const analyse = async (path: string, before: string, after: string, extra: Partial<DiffFile> = {}) => {
  const result = await analyseSemanticSources({ path, oldPath: path, newPath: path, status: "modified", metadata: [], hunks: [], additions: 1, deletions: 1, ...extra }, before, after, { beforeTree: "a".repeat(40), afterTree: "b".repeat(40) });
  expect(result.status).toBe("analysed");
  return result;
};
const categories = (changes: SemanticChange[]) => changes.map(({ name, categories }) => [name, categories]);

test("Kotlin local variables are distinguished from member and top-level properties by parser scope", async () => {
  const result = await analyse("Scope.kt", "", "val top = 1\nclass Box {\n val member = 2\n fun work() {\n  val local = 3\n  val lambda = { val inside = 4; inside }\n }\n}\n");
  expect(Object.fromEntries(result.changes.filter((change) => change.kind === "property declaration").map((change) => [change.name, change.scope]))).toEqual({ top: "top-level", "Box.member": "member", "Box.work.local": "local", "Box.work.lambda": "local", "Box.work.lambda.inside": "local" });
  for (const change of result.changes.filter((entry) => entry.kind === "property declaration")) expect(createSemanticPresentation().kindLabel(change)).toBe(change.scope === "local" ? "variable" : "property");
});

test("a parent signature edit preserves unchanged locals in Kotlin, TypeScript and TSX", async () => {
  for (const [path, before, after] of [
    ["Task.kt", "fun task(id: String) {\n val guard = 1\n fun close() { println(guard) }\n}\n", "fun task(id: String, hide: Boolean) {\n val guard = 1\n fun close() { println(guard) }\n}\n"],
    ["task.ts", "function task(id: string) { const guard = 1; function close() { return guard; } }", "function task(id: string, hide: boolean) { const guard = 1; function close() { return guard; } }"],
    ["Task.tsx", "function Task(id: string) { const content = <p>Task</p>; return content; }", "function Task(id: string, hide: boolean) { const content = <p>Task</p>; return content; }"],
  ]) {
    const result = await analyse(path!, before!, after!);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]?.categories).toEqual(["signature"]);
  }
});

test("changed methods and arrow inputs preserve locals under their matched class or binding", async () => {
  const method = await analyse("Task.ts", "class Task { close(id: string) { const guard = 1; return guard; } }", "class Task { close(id: number) { const guard = 1; return guard; } }");
  expect(categories(method.changes)).toEqual([["Task", ["body"]], ["Task.close", ["signature"]]]);
  const arrow = await analyse("task.ts", "const task = (id: string) => { function close() { const guard = 1; return guard; } };", "const task = (id: number) => { function close() { const guard = 1; return guard; } };");
  expect(categories(arrow.changes)).toEqual([["task", ["signature"]]]);
});

test("nested edits survive multiple parent signature edits with exact renamed old/new anchors", async () => {
  const before = "fun task(id: String) {\n val guard = 1\n val removed = 0\n fun close() {\n  val count = 1\n  println(count)\n }\n}\n";
  const after = "// new header\nfun task(id: String, hide: Boolean) {\n val guard = 1\n val added = 0\n fun close(force: Boolean) {\n  val count = 2\n  println(count)\n }\n}\n";
  const result = await analyse("New.kt", before, after, { oldPath: "Old.kt", status: "renamed" });
  expect(result.renamed).toBe(true);
  expect(result.changes.some((change) => change.name === "task.guard")).toBe(false);
  expect(result.changes.find((change) => change.name === "task.close")?.categories).toEqual(["signature", "body"]);
  const count = result.changes.filter((change) => change.name === "task.close.count");
  expect(count).toHaveLength(1);
  expect(count[0]).toMatchObject({ categories: ["body"], before: { path: "Old.kt", side: "old", startLine: 5 }, after: { path: "New.kt", side: "new", startLine: 6 } });
  expect(result.changes.find((change) => change.name === "task.removed")?.categories).toEqual(["removed"]);
  expect(result.changes.find((change) => change.name === "task.added")?.categories).toEqual(["added"]);
});

test("reordered overloads keep same-named locals attached to the matched parent", async () => {
  const before = "fun task(id: Int) {\n val guard = 1\n}\nfun task(id: String) {\n val guard = 100\n}\n";
  const after = "fun task(id: String) {\n val guard = 100\n}\nfun task(id: Int, hide: Boolean) {\n val guard = 2\n}\n";
  const result = await analyse("Task.kt", before, after);
  expect(categories(result.changes)).toEqual([["task", ["signature", "body"]], ["task.guard", ["body"]]]);
  expect(result.changes[1]).toMatchObject({ before: { startLine: 2 }, after: { startLine: 5 } });
  expect((await analyse("Task.kt", before, "fun task(id: String) {\n val guard = 100\n}\nfun task(id: Int) {\n val guard = 1\n}\n")).changes).toEqual([]);
});

test("unresolved overloaded parents never pair their otherwise identical children", async () => {
  const overload = (type: string) => `fun task(id: ${type}) {\n val guard = 1\n fun close() { val inner = 2 }\n}\n`;
  const result = await analyse("Task.kt", overload("Int") + overload("String"), overload("Boolean") + overload("Long"));
  expect(result.changes).toHaveLength(16);
  expect(result.changes.every((change) => change.ambiguous && Boolean(change.before) !== Boolean(change.after))).toBe(true);
  expect(result.changes.filter((change) => change.name === "task.close.inner")).toHaveLength(4);
});

test("children of added, deleted and renamed parents do not match across owners", async () => {
  const result = await analyse("Task.kt", "fun oldTask() {\n val guard = 1\n}\n", "fun newTask() {\n val guard = 1\n}\n");
  expect(categories(result.changes)).toEqual([["oldTask", ["removed"]], ["oldTask.guard", ["removed"]], ["newTask", ["added"]], ["newTask.guard", ["added"]]]);
  for (const [before, after, extra, category] of [
    ["", "fun task() {\n val guard = 1\n}\n", { oldPath: null, status: "added" }, "added"],
    ["fun task() {\n val guard = 1\n}\n", "", { newPath: null, status: "deleted" }, "removed"],
  ] as const) {
    expect(categories((await analyse("Task.kt", before, after, extra)).changes)).toEqual([["task", [category]], ["task.guard", [category]]]);
  }
});

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

test("captured summary, UI, tour evidence and exports reuse corrected nested matches", async () => {
  const root = await mkdtemp(join(tmpdir(), "semantic-nested-")); roots.push(root);
  const git = async (...args: string[]) => runProcess(["git", ...args], root);
  await git("init", "-b", "main");
  const before = "fun task(id: String) {\n val guard = 1\n fun close() { println(1) }\n}\n";
  const after = "fun task(id: String, hide: Boolean) {\n val guard = 1\n fun close() { println(2) }\n}\n";
  await writeFile(join(root, "Task.kt"), before);
  await git("add", ".");
  await git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "-c", "commit.gpgsign=false", "commit", "-m", "base");
  await writeFile(join(root, "Task.kt"), after);
  const comparison = await loadComparison(root, "HEAD");
  await writeFile(join(root, "Task.kt"), "fun unrelatedLiveSource() {}\n");
  const summary = await semanticDiffForFile(comparison, "Task.kt");
  expect(categories(summary.changes)).toEqual([["task", ["signature", "body"]], ["task.close", ["body"]]]);
  const context = await syntaxContextForTourStep(comparison, { id: "nested", title: "Review close", objective: "Review the changed body", anchor: { path: "Task.kt", side: "new", startLine: 3, endLine: 3 } });
  const evidence = JSON.parse(context.split("<tour-syntax-evidence>\n")[1]!.split("\n</tour-syntax-evidence>")[0]!);
  expect(categories(evidence.changes)).toEqual([["task.close", ["body"]], ["task", ["signature", "body"]]]);
  for (const content of [createSemanticPresentation().summaryHtml(summary), semanticExport(comparison, "markdown"), semanticExport(comparison, "html")]) {
    expect(content).not.toContain("task.guard");
    expect(content).not.toContain("unrelatedLiveSource");
    expect(content).toContain("task.close");
    expect(content).toContain("All code details (2 items)");
  }
});
