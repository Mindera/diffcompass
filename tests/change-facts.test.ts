import { afterEach, expect, test } from "bun:test";
import { loadChangeFacts, NO_CHANGE_FACTS_MESSAGE, type ChangeFacts, type FileChangeFacts } from "../src/change-facts.ts";
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

async function addedFileFacts(path: string, text: string): Promise<FileChangeFacts> {
  const { comparison, cleanup } = await repositoryComparison({}, { [path]: text });
  cleanups.push(cleanup);
  return fileFacts(await loadChangeFacts(comparison), path);
}

test("every changed file of 8f84166..740bada has a completeness state", async () => {
  const { comparison, facts } = await revision;
  expect(facts.files.map((file) => file.path)).toEqual(comparison.files.map((file) => file.path));
  for (const file of facts.files) expect(["complete", "truncated", "skipped", "unsupported"]).toContain(file.completeness.state);
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
  expect(fileFacts(facts, "src/types.ts").completeness).toMatchObject({ state: "skipped", reason: "parse-error" });
  for (const path of [".github/workflows/ci.yml", "README.md", "package.json"]) expect(fileFacts(facts, path).completeness).toEqual({ state: "unsupported", message: NO_CHANGE_FACTS_MESSAGE });
}, 30_000);

test("a file over the syntax byte limit is skipped as oversized", async () => {
  const file = await addedFileFacts("big.ts", "//".padEnd(256_000, "x") + "\n");
  expect(file.completeness).toMatchObject({ state: "skipped", reason: "oversized" });
  expect(file.changedLines).toBe(1);
}, 30_000);

test("a generated file is skipped as generated", async () => {
  const file = await addedFileFacts("src/generated/api.ts", "export const api = 1;\n");
  expect(file.completeness).toMatchObject({ state: "skipped", reason: "generated" });
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
