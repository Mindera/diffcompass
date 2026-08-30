import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const extract = (start: string, end: string) => app.slice(app.indexOf(`function ${start}`), app.indexOf(`function ${end}`));
const escapeHtml = (s: string) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const { whitespaceChangedRows, diffCodeHtml } = new Function("escapeHtml", [
  extract("whitespaceChangedRows(", "renderUnifiedRow("),
  extract("splitRows(", "renderSplitSide("),
  app.slice(app.indexOf("function syntaxTokenHtml("), app.indexOf("async function highlightRenderedCode(")),
  "return { whitespaceChangedRows, diffCodeHtml };",
].join("\n"))(escapeHtml);
const row = (kind: string, content: string) => ({ kind, content });

test("marks indentation, tabs, trailing whitespace and blank-line changes", () => {
  for (const [oldText, newText] of [["    return x", "  return x"], ["\treturn x", "  return x"], ["return x  ", "return x"], ["  ", ""]]) {
    const rows = [row("deletion", oldText), row("addition", newText)];
    expect([...whitespaceChangedRows(rows)]).toEqual(rows);
  }
});

test("does not label code, string, identical or unmatched lines as whitespace-only", () => {
  for (const [before, after] of [['  "a b"', ' "ab"'], [" x + y", " x+y"], [" x", " y"], [" x", " x"]]) {
    expect(whitespaceChangedRows([row("deletion", before), row("addition", after)]).size).toBe(0);
  }
  expect(whitespaceChangedRows([row("addition", "  x")]).size).toBe(0);
  expect(whitespaceChangedRows([row("deletion", "  x"), row("context", "middle"), row("addition", " x")]).size).toBe(0);
});

test("visible markers retain source whitespace, escape code and skip internal spaces", () => {
  const content = '\t  return "<a b>"  ';
  const html = diffCodeHtml(content, true);
  expect(html.match(/class="diff-whitespace"/g)).toHaveLength(5);
  expect(html).toContain('data-symbol="→">\t</span>');
  expect(html).toContain('return &quot;&lt;a b&gt;&quot;');
  expect(diffCodeHtml(content, false)).toBe(escapeHtml(content));
});

test("markers survive token boundaries and syntax highlighting", () => {
  const token = (content: string) => ({content, light: "112233", dark: "ddeeff", fontStyle: 0});
  const html = diffCodeHtml("  val x  ", true, [token(" "), token(" val"), token(" x "), token(" ")]);
  expect(html.match(/class="diff-whitespace"/g)).toHaveLength(4);
  expect(html).toContain("syntax-token");
  expect(app).toContain('nodes[index].dataset.whitespaceOnly === "true"');
});
