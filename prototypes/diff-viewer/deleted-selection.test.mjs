import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { deletedSourceSelection } from "./deleted-selection.mjs";
import { deletedSourceAsset, withDeletedSourceBridge } from "./deleted-source-bridge.mjs";

function setup(old = "same\n\treturn café😀;\nsame\n") {
  const file = { path: "before.ts", old, new: "same\nreplacement\nsame\n" };
  const lines = old.split(/\r?\n/);
  const model = { isDisposed: () => false, getValue: () => old, getLineCount: () => lines.length, getLineMaxColumn: line => lines[line - 1].length + 1 };
  return { file, model, mapping: { model, startLineNumber: 1, endLineNumberExclusive: lines.length + 1 } };
}
const point = (lineNumber, column) => ({ lineNumber, column });
test("removed source maps a partial Unicode quotation to Before, not the same After row", () => {
  const { file, model, mapping } = setup();
  const result = deletedSourceSelection(file, model, mapping, point(2, 9), point(2, 15));
  expect(result.anchor).toMatchObject({ path: "before.ts", side: "old", line: 2, endLine: 2, selectedText: "café😀", context: "\treturn café😀;" });
  expect(result.quoted).toBe(true);
});
test("a removed-line caret is a line comment and repeated text retains its true location", () => {
  const { file, model, mapping } = setup();
  expect(deletedSourceSelection(file, model, mapping, point(3, 2), point(3, 2))).toMatchObject({ quoted: false, anchor: { line: 3, side: "old", content: "same" } });
});
test("reverse multiline selections and end-column-one retain the server's exact CRLF evidence", () => {
  const { file, model, mapping } = setup("one\r\ntwo\r\nthree");
  const result = deletedSourceSelection(file, model, mapping, point(3, 1), point(1, 2));
  expect(result.anchor).toMatchObject({ line: 1, endLine: 2, selectedText: "ne\r\ntwo", context: "one\r\ntwo\r", content: "one\r" });
});
test("entirely deleted file and missing final newline are supported", () => {
  const { file, model, mapping } = setup("deleted"); file.new = "";
  expect(deletedSourceSelection(file, model, mapping, point(1, 1), point(1, 8)).anchor.selectedText).toBe("deleted");
});
test("whitespace-only quotations fail clearly instead of quoting a different range", () => {
  const { file, model, mapping } = setup("  return x;");
  expect(() => deletedSourceSelection(file, model, mapping, point(1, 1), point(1, 3))).toThrow("non-whitespace");
  expect(deletedSourceSelection(file, model, mapping, point(1, 2), point(1, 2)).quoted).toBe(false);
});
test("same text in a different model cannot reuse the old mapping", () => {
  const { file, model, mapping } = setup();
  expect(() => deletedSourceSelection(file, { ...model }, mapping, point(1, 1), point(1, 2))).toThrow("changed");
});
test("live contents, disposed models and stale mappings fail closed", () => {
  for (const mutate of [s => { s.file.old += "changed"; }, s => { s.model.isDisposed = () => true; }, s => { s.mapping = null; }]) {
    const s = setup(); mutate(s);
    expect(() => deletedSourceSelection(s.file, s.model, s.mapping, point(1, 1), point(1, 2))).toThrow();
  }
});
test("invalid or out-of-block positions must never be clamped to another line", () => {
  const { file, model, mapping } = setup(); mapping.startLineNumber = 2; mapping.endLineNumberExclusive = 3;
  for (const p of [null, point(1, 1), point(3, 1), point(2, 0), point(2, 1000), point(2.5, 1), point(2, NaN)]) {
    expect(() => deletedSourceSelection(file, model, mapping, p, point(2, 1))).toThrow();
  }
});
test("a range cannot silently exceed the API's 100-line limit", () => {
  const { file, model, mapping } = setup(Array(102).fill("x").join("\n"));
  expect(() => deletedSourceSelection(file, model, mapping, point(1, 1), point(102, 2))).toThrow("100");
});
test("the bridge patches only the exact pinned asset and leaves its copy implementation intact", () => {
  const source = readFileSync(new URL(`../../node_modules/monaco-editor/min/${deletedSourceAsset}`, import.meta.url), "utf8");
  const result = withDeletedSourceBridge(source);
  expect(result).toContain("e.diffCompassDeletedSource = reviewMapping");
  expect(result).toContain('r.add(W(e,"copy",');
  expect(result).toContain("delete e.diffCompassDeletedSource");
  expect(result).toContain('k_e((_,b)=>Ee.initialize({}).createInstance(ob,_,{instantHover:b},{}))');
  expect(result).toContain('g.setDefaultCodeBlockRenderer(Ee.initialize({}).createInstance(bB))');
  expect(result).not.toContain('k_e((_,b)=>i.createInstance(ob,_,{instantHover:b},{}))');
  expect(() => withDeletedSourceBridge(source + "\n")).toThrow("exact pinned");
});
