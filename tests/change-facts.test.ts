import { afterEach, expect, test } from "bun:test";
import { CHANGE_FACTS_ENGINE, isTestPath, lineRanges, loadChangeFacts, NO_CHANGE_FACTS_MESSAGE, type ChangeFacts, type FileChangeFacts, type LineRange, type LineSide, type SymbolFact, type TestFact } from "../src/change-facts.ts";
import { diffSourceIdentity } from "../src/diff-sources.ts";
import { languageParser } from "../src/semantic-diff.ts";
import { parseWithin } from "../src/syntax-nodes.ts";
import type { GitComparison } from "../src/types.ts";
import { capturedText, historicalComparison, repositoryComparison } from "./comparison-fixtures.ts";

async function historicalFacts(base: string, head: string): Promise<{ comparison: GitComparison; facts: ChangeFacts }> {
  const comparison = await historicalComparison(base, head);
  return { comparison, facts: await loadChangeFacts(comparison) };
}
const revision = historicalFacts("8f84166", "740bada");
const suggestions = historicalFacts("57bf907", "27b7e44");

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

function fileFacts(facts: ChangeFacts, path: string): FileChangeFacts {
  const file = facts.files.find((entry) => entry.path === path);
  if (!file) throw new Error(`${path} has no change facts.`);
  return file;
}

function symbolFact(file: FileChangeFacts, name: string): SymbolFact {
  const symbol = file.symbols.find((entry) => entry.name === name);
  if (!symbol) throw new Error(`${file.path} has no ${name} symbol fact.`);
  return symbol;
}

async function addedFileFacts(path: string, text: string): Promise<FileChangeFacts> {
  const { comparison, cleanup } = await repositoryComparison({}, { [path]: text });
  cleanups.push(cleanup);
  return fileFacts(await loadChangeFacts(comparison), path);
}

function expectChangedLinesPerFile({ comparison, facts }: { comparison: GitComparison; facts: ChangeFacts }): void {
  expect(facts.files.map((file) => file.path)).toEqual(comparison.files.map((file) => file.path));
  for (const [i, file] of facts.files.entries()) expect(file.changedLines).toBe(comparison.files[i]!.additions + comparison.files[i]!.deletions);
}

function factRangesOf(file: FileChangeFacts): LineRange[] {
  return [
    ...file.symbols.flatMap((symbol) => [
      ...(symbol.before ? [{ side: "old" as const, startLine: symbol.before.startLine, endLine: symbol.before.endLine }] : []),
      ...(symbol.after ? [{ side: "new" as const, startLine: symbol.after.startLine, endLine: symbol.after.endLine }] : []),
    ]),
    ...file.calls.map((call) => ({ side: call.side, startLine: call.line, endLine: call.line })),
    ...file.tests.map((fact) => ({ side: fact.side, startLine: fact.startLine, endLine: fact.endLine })),
  ];
}

async function repositoryFacts(before: Record<string, string>, after: Record<string, string>, path: string): Promise<FileChangeFacts> {
  const { comparison, cleanup } = await repositoryComparison(before, after);
  cleanups.push(cleanup);
  return fileFacts(await loadChangeFacts(comparison), path);
}

async function expectCallsOnChangedLines({ comparison, facts }: { comparison: GitComparison; facts: ChangeFacts }): Promise<void> {
  for (const file of facts.files) {
    if (file.calls.length === 0) continue;
    const changed = changedLinesOf(comparison, file.path);
    const head = (await capturedText(comparison, "new", file.path)).split("\n");
    for (const call of file.calls) {
      expect(call.change).toBe(call.side === "old" ? "removed" : "added");
      expect(changed.some((entry) => entry.side === call.side && entry.line === call.line)).toBe(true);
      if (call.change === "added") expect(head[call.line - 1]).toContain(call.name);
    }
  }
}

function inRanges(ranges: LineRange[], side: LineSide, line: number): boolean {
  return ranges.some((range) => range.side === side && range.startLine <= line && line <= range.endLine);
}

function changedLinesOf(comparison: GitComparison, path: string): Array<{ side: LineSide; line: number }> {
  const file = comparison.files.find((entry) => entry.path === path)!;
  return file.hunks.flatMap((hunk) => hunk.rows.flatMap((row): Array<{ side: LineSide; line: number }> => row.kind === "deletion" && row.oldLine !== null ? [{ side: "old" as const, line: row.oldLine }] : row.kind === "addition" && row.newLine !== null ? [{ side: "new" as const, line: row.newLine }] : []));
}

function expectFilePartition(comparison: GitComparison, file: FileChangeFacts): void {
  const changed = changedLinesOf(comparison, file.path);
  if (file.completeness.state === "unsupported") { expect(file.unattributed).toEqual([]); return; }
  const facts = factRangesOf(file);
  for (const { side, line } of changed) expect([inRanges(facts, side, line), inRanges(file.unattributed, side, line)].filter(Boolean)).toHaveLength(1);
  for (const range of file.unattributed) for (let line = range.startLine; line <= range.endLine; line++) expect(changed.some((entry) => entry.side === range.side && entry.line === line)).toBe(true);
}

function expectPartition({ comparison, facts }: { comparison: GitComparison; facts: ChangeFacts }): void {
  for (const file of facts.files) expectFilePartition(comparison, file);
}

test("every changed file of 8f84166..740bada has facts in comparison order with its changed-line count", async () => {
  const result = await revision;
  expect(result.facts.engine).toBe(CHANGE_FACTS_ENGINE);
  expect(result.facts.comparisonId).toBe(diffSourceIdentity(result.comparison));
  expectChangedLinesPerFile(result);
}, 30_000);

test("every changed file of 57bf907..27b7e44 has facts in comparison order with its changed-line count", async () => {
  expectChangedLinesPerFile(await suggestions);
}, 30_000);

test("browser assets in 8f84166..740bada are unsupported", async () => {
  const { facts } = await revision;
  for (const path of ["public/app.js", "public/index.html", "public/styles.css"]) {
    const file = fileFacts(facts, path);
    expect(file.language).toBeNull();
    expect(file.completeness).toEqual({ state: "unsupported", message: NO_CHANGE_FACTS_MESSAGE });
    expect(file.symbols).toEqual([]);
  }
}, 30_000);

test("the added src/revision.ts declares symbols that exist at head", async () => {
  const { comparison, facts } = await revision;
  const file = fileFacts(facts, "src/revision.ts");
  expect(file.language).toBe("typescript");
  expect(file.completeness).toEqual({ state: "complete" });
  expect(file.symbols.length).toBeGreaterThan(0);
  const head = (await capturedText(comparison, "new", "src/revision.ts")).split("\n");
  for (const symbol of file.symbols) {
    expect(symbol.change).toEqual(["added"]);
    expect(symbol.after).toBeDefined();
    const lines = head.slice(symbol.after!.startLine - 1, symbol.after!.endLine).join("\n");
    expect(lines).toContain(symbol.name.split(".").at(-1)!);
  }
}, 30_000);

test("57bf907..27b7e44 skips src/types.ts the grammar cannot parse and leaves non-code files unsupported", async () => {
  const { facts } = await suggestions;
  const types = fileFacts(facts, "src/types.ts");
  expect(types.language).toBe("typescript");
  expect(types.completeness).toMatchObject({ state: "skipped", reason: "parse-error" });
  for (const path of [".github/workflows/ci.yml", "README.md", "package.json"]) expect(fileFacts(facts, path).completeness).toEqual({ state: "unsupported", message: NO_CHANGE_FACTS_MESSAGE });
}, 30_000);

test("a file over the syntax byte limit is skipped as oversized", async () => {
  const file = await addedFileFacts("big.ts", "//".padEnd(256_000, "x") + "\n");
  expect(file.completeness).toEqual({ state: "skipped", reason: "oversized", message: "Captured source exceeds the 256,000 byte syntax-analysis limit." });
  expect(file.changedLines).toBe(1);
}, 30_000);

test("a file over the syntax line limit is skipped as oversized by the analyser", async () => {
  const file = await addedFileFacts("long.ts", "x\n".repeat(10_000));
  expect(file.language).toBe("typescript");
  expect(file.completeness).toEqual({ state: "skipped", reason: "oversized", message: "Syntax analysis is limited to 256,000 bytes and 10,000 lines per version. Use the text diff." });
}, 30_000);

test("a file over the declaration limit is skipped as an analysis limit", async () => {
  const file = await addedFileFacts("declarations.ts", Array.from({ length: 1_001 }, (_, i) => `function f${i}() {}`).join("\n") + "\n");
  expect(file.language).toBe("typescript");
  expect(file.completeness).toMatchObject({ state: "skipped", reason: "analysis-limit" });
}, 30_000);

test("a file with a NUL byte is skipped as unreadable", async () => {
  const file = await addedFileFacts("nul.ts", "export const a = 1;\0\n");
  expect(file.completeness).toEqual({ state: "skipped", reason: "unreadable", message: "Captured source is binary or is not supported UTF-8 text." });
  expect(file.changedLines).toBe(0);
}, 30_000);

test("a generated file is skipped as generated", async () => {
  const file = await addedFileFacts("src/generated/api.ts", "export const api = 1;\n");
  expect(file.language).toBe("typescript");
  expect(file.completeness).toEqual({ state: "skipped", reason: "generated", message: "Generated-file marker detected; syntax summary skipped. Inspect the text diff or generator source." });
}, 30_000);

test("a modified file reports changed and removed symbols anchored in the base text", async () => {
  const { comparison, cleanup } = await repositoryComparison({ "calc.ts": "export function keep() { return 1; }\nexport function drop() {}\n" }, { "calc.ts": "export function keep() { return 2; }\n" });
  cleanups.push(cleanup);
  const file = fileFacts(await loadChangeFacts(comparison), "calc.ts");
  const keep = symbolFact(file, "keep"), drop = symbolFact(file, "drop");
  expect(keep.change).toEqual(["body"]);
  expect(keep.before).toBeDefined();
  expect(keep.after).toBeDefined();
  expect(drop.change).toEqual(["removed"]);
  expect(drop.before).toBeDefined();
  expect(drop.after).toBeUndefined();
  const base = (await capturedText(comparison, "old", "calc.ts")).split("\n");
  for (const symbol of file.symbols) if (symbol.before) expect(base.slice(symbol.before.startLine - 1, symbol.before.endLine).join("\n")).toContain(symbol.name);
}, 30_000);

test("symbol facts beyond the analysis limit mark the file truncated", async () => {
  const text = Array.from({ length: 205 }, (_, i) => `export function f${i}() { return ${i}; }`).join("\n") + "\n";
  const file = await addedFileFacts("many.ts", text);
  expect(file.completeness).toEqual({ state: "truncated", lists: [{ list: "symbols", shown: 200, total: 205 }] });
  expect(file.symbols).toHaveLength(200);
  expect(file.changedLines).toBe(205);
}, 30_000);

test("a file the grammar cannot parse is skipped as a parse error", async () => {
  const file = await addedFileFacts("broken.ts", "export function (\n");
  expect(file.completeness).toMatchObject({ state: "skipped", reason: "parse-error" });
}, 30_000);

test("every changed line of 8f84166..740bada is inside a fact range or unattributed", async () => {
  expectPartition(await revision);
}, 30_000);

test("every changed line of 57bf907..27b7e44 is inside a fact range or unattributed", async () => {
  expectPartition(await suggestions);
}, 30_000);

test("a skipped file lists every changed line as unattributed", async () => {
  const { comparison, facts } = await suggestions;
  const types = fileFacts(facts, "src/types.ts");
  expect(types.completeness.state).toBe("skipped");
  const changed = changedLinesOf(comparison, "src/types.ts");
  expect(changed.length).toBeGreaterThan(0);
  for (const { side, line } of changed) expect(inRanges(types.unattributed, side, line)).toBe(true);
}, 30_000);

test("a destructured binding and an anonymous default export are unattributed", async () => {
  const { comparison, cleanup } = await repositoryComparison(
    { "settings.ts": "export const settings = { alpha: 1, beta: 2 };\n" },
    { "settings.ts": "export const settings = { alpha: 1, beta: 2 };\nexport const { alpha, beta } = settings;\nexport default function () {\n  return alpha + beta;\n}\n" },
  );
  cleanups.push(cleanup);
  const facts = await loadChangeFacts(comparison);
  const file = fileFacts(facts, "settings.ts");
  expect(file.unattributed).toEqual([{ side: "new", startLine: 2, endLine: 5 }]);
  expectPartition({ comparison, facts });
}, 30_000);

test("lineRanges sorts, dedupes and merges consecutive lines", () => {
  expect(lineRanges("new", [5, 3, 4, 9, 9])).toEqual([{ side: "new", startLine: 3, endLine: 5 }, { side: "new", startLine: 9, endLine: 9 }]);
  expect(lineRanges("old", [])).toEqual([]);
});

test("an edited call line is reported once as removed and once as added", async () => {
  const file = await repositoryFacts({ "run.ts": "export function run() {\n  save(1);\n}\n" }, { "run.ts": "export function run() {\n  save(2);\n}\n" }, "run.ts");
  expect(file.calls).toEqual([
    { analysis: "tree-sitter call sites", name: "save", change: "removed", side: "old", line: 2, enclosing: "run" },
    { analysis: "tree-sitter call sites", name: "save", change: "added", side: "new", line: 2, enclosing: "run" },
  ]);
}, 30_000);

test("inserting a callback above an unchanged one reports no call change for the unchanged one", async () => {
  const file = await repositoryFacts({ "list.ts": 'items.forEach(() => {\n  log("a");\n});\n' }, { "list.ts": 'items.map(() => {\n  track("b");\n});\nitems.forEach(() => {\n  log("a");\n});\n' }, "list.ts");
  expect(file.calls.every((call) => call.change === "added")).toBe(true);
  expect(file.calls.map((call) => call.name).sort()).toEqual(["map", "track"]);
}, 30_000);

test("a Kotlin constructor call and its chained call are added calls in their enclosing function", async () => {
  const path = "src/main/kotlin/demo/Main.kt";
  const file = await repositoryFacts({ [path]: "package demo\n\nfun main() {\n    greet()\n}\n" }, { [path]: "package demo\n\nfun main() {\n    greet()\n    Receipt().total()\n}\n" }, path);
  expect(file.calls.map(({ name, change, side, line, enclosing }) => ({ name, change, side, line, enclosing }))).toEqual([
    { name: "Receipt", change: "added", side: "new", line: 5, enclosing: "main" },
    { name: "total", change: "added", side: "new", line: 5, enclosing: "main" },
  ]);
}, 30_000);

test("removed and added calls of 8f84166..740bada sit on changed lines", async () => {
  await expectCallsOnChangedLines(await revision);
}, 30_000);

test("removed and added calls of 57bf907..27b7e44 sit on changed lines", async () => {
  await expectCallsOnChangedLines(await suggestions);
}, 30_000);

test("calls beyond the limit mark the file truncated", async () => {
  const text = Array.from({ length: 1_005 }, (_, i) => `call${i}();`).join("\n") + "\n";
  const file = await addedFileFacts("calls.ts", text);
  expect(file.calls).toHaveLength(1_000);
  expect(file.completeness).toEqual({ state: "truncated", lists: [{ list: "calls", shown: 1_000, total: 1_005 }] });
}, 30_000);

test("the added tests/revision-aware.test.ts lists test names that exist at head", async () => {
  const { comparison, facts } = await revision;
  const file = fileFacts(facts, "tests/revision-aware.test.ts");
  expect(file.tests.length).toBeGreaterThan(0);
  const head = (await capturedText(comparison, "new", "tests/revision-aware.test.ts")).split("\n");
  for (const fact of file.tests) {
    expect(fact.analysis).toBe("tree-sitter test names");
    expect(fact.side).toBe("new");
    expect(fact.changed).toBe(true);
    expect(head[fact.startLine - 1]).toContain(fact.name.split(" > ").at(-1)!);
  }
}, 30_000);

test("a modified test file marks each test by whether a changed row lies in its range", async () => {
  const { comparison, facts } = await suggestions;
  const file = fileFacts(facts, "tests/ui.test.ts");
  const changed = changedLinesOf(comparison, "tests/ui.test.ts");
  expect(file.tests.length).toBeGreaterThan(0);
  for (const fact of file.tests) expect(fact.changed).toBe(changed.some((entry) => entry.side === fact.side && fact.startLine <= entry.line && entry.line <= fact.endLine));
}, 30_000);

test("a Kotlin test function lists as a test fact and its production sibling does not", async () => {
  const testPath = "app/src/test/kotlin/demo/CartTest.kt", mainPath = "app/src/main/kotlin/demo/Cart.kt";
  const { comparison, cleanup } = await repositoryComparison({}, {
    [testPath]: "package demo\n\nimport kotlin.test.Test\n\nclass CartTest {\n    @Test\n    fun `adds totals`() {\n        check(1 == 1)\n    }\n}\n",
    [mainPath]: "package demo\n\nclass Cart\n",
  });
  cleanups.push(cleanup);
  const facts = await loadChangeFacts(comparison);
  const test = fileFacts(facts, testPath);
  expect(test.tests).toEqual([{ analysis: "tree-sitter test names", name: "CartTest > adds totals", side: "new", startLine: 6, endLine: 9, changed: true }]);
  expect(fileFacts(facts, mainPath).tests).toEqual([]);
  expectPartition({ comparison, facts });
}, 30_000);

test("a Kotlin test annotated with arguments, empty parentheses or a qualified name lists as a test fact", async () => {
  const file = await addedFileFacts("app/src/test/kotlin/demo/CartTest.kt", "package demo\n\nimport org.junit.Test\n\nclass CartTest {\n    @Test()\n    fun empty() {}\n\n    @Test(expected = IllegalArgumentException::class)\n    fun rejects() {}\n\n    @org.junit.Test\n    fun qualified() {}\n\n    @Test\n    fun bare() {}\n}\n");
  const fact = (name: string, startLine: number): TestFact => ({ analysis: "tree-sitter test names", name: `CartTest > ${name}`, side: "new", startLine, endLine: startLine + 1, changed: true });
  expect(file.tests).toEqual([fact("empty", 6), fact("rejects", 9), fact("qualified", 12), fact("bare", 15)]);
}, 30_000);

test("a path is a test path only by its own language's rule", () => {
  const expected = {
    "src/foo.test.ts": true,
    "src/cart.spec.tsx": true,
    "src/cart.test.mts": true,
    "a/__tests__/x.ts": true,
    "web/src/test/helpers.ts": false,
    "src/app.ts": false,
    "app/src/test/kotlin/demo/CartTest.kt": true,
    "app/src/androidTest/kotlin/A.kt": true,
    "src/FooTests.kt": true,
    "app/src/test/kotlin/build.kts": true,
    "app/__tests__/FooBar.kt": false,
    "app/src/main/kotlin/demo/Cart.kt": false,
    "src/test/readme.md": false,
    "__tests__/a.js": false,
  };
  expect(Object.fromEntries(Object.keys(expected).map((path) => [path, isTestPath(path)]))).toEqual(expected);
});

test("nested describe names prefix a test name and describe itself gives no fact", async () => {
  const file = await addedFileFacts("src/cart.test.ts", 'describe("cart", () => {\n  describe("totals", () => {\n    it("adds", () => {});\n    test.skip("skipped", () => {});\n  });\n  test(`plain`, () => {});\n  it(`with ${x}`, () => {});\n});\n');
  expect(file.tests.map((fact) => fact.name)).toEqual(["cart > totals > adds", "cart > totals > skipped", "cart > plain"]);
}, 30_000);

test("escaped describe and test titles keep their whole raw text", async () => {
  const file = await addedFileFacts("src/cart.test.ts", "describe(\"it\\'s a group\", () => {\n  it('doesn\\'t crash', () => {});\n  test('a', () => {});\n  test(\"say \\\"hi\\\"\", () => {});\n  test(\"\", () => {});\n});\n");
  expect(file.tests.map((fact) => fact.name)).toEqual(["it\\'s a group > doesn\\'t crash", "it\\'s a group > a", "it\\'s a group > say \\\"hi\\\"", "it\\'s a group > "]);
}, 30_000);

test("test facts beyond the limit mark the file truncated", async () => {
  const text = Array.from({ length: 505 }, (_, i) => `test("t${i}", () => {});`).join("\n") + "\n";
  const file = await addedFileFacts("many.test.ts", text);
  expect(file.tests).toHaveLength(500);
  expect(file.completeness).toEqual({ state: "truncated", lists: [{ list: "tests", shown: 500, total: 505 }] });
}, 30_000);

test("a cancelled parse leaves a reused parser parsing the next source from scratch", async () => {
  const parser = await languageParser("typescript");
  try {
    expect(parseWithin(parser, "call();\n".repeat(25_000), 0)).toBeNull();
    const tree = parseWithin(parser, "save();", 150_000);
    expect(tree).not.toBeNull();
    try {
      expect(tree!.rootNode.endIndex).toBe(7);
      expect(tree!.rootNode.namedChildCount).toBe(1);
    } finally { tree!.delete(); }
  } finally { parser.delete(); }
});
