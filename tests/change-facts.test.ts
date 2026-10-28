import { afterEach, expect, test } from "bun:test";
import { CHANGE_FACTS_ENGINE, loadChangeFacts, NO_CHANGE_FACTS_MESSAGE, type ChangeFacts, type FileChangeFacts, type SymbolFact } from "../src/change-facts.ts";
import { diffSourceIdentity } from "../src/diff-sources.ts";
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
