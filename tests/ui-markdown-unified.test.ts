import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { parseUnifiedDiff } from "../src/diff.ts";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const extract = (start: string, end: string) => app.slice(app.indexOf(start), app.indexOf(end));
const escapeHtml = (value: unknown) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const { renderUnifiedMarkdownDiff } = new Function("escapeHtml", [
  extract("function renderInlineChangeText", "function pullRequestDescription"),
  extract("function inlineChangedRanges", "function diffCodeHtml"),
  extract("function splitRows", "function renderSplitSide"),
  extract("function markdownSides", "async function hydrateMarkdownPreviews"),
  "return { renderUnifiedMarkdownDiff };",
].join("\n"))(escapeHtml);

function render(before: string, after: string, hunks: string) {
  const [file] = parseUnifiedDiff(`diff --git a/guide.md b/guide.md\n--- a/guide.md\n+++ b/guide.md\n${hunks}`);
  return renderUnifiedMarkdownDiff(file, before, after) as string;
}

const blocks = (html: string) => [...html.matchAll(/<(section|li) class="markdown-source-block([^"]*)"[^>]*data-markdown-side="([^"]+)"[^>]*data-source-start="(\d+)"[^>]*>(.*?)<\/\1>/gs)]
  .map((match) => ({ kind: match[2]!.trim(), side: match[3], line: Number(match[4]), html: match[5] }));

test("unified Markdown interleaves replacements and keeps context beyond sparse hunks once", () => {
  const html = render("# Guide\n\nUse old mode.\n\nSame paragraph.\n\nRemove me.\n\nEnd.\n",
    "# Guide\n\nUse new mode.\nAn extra paragraph.\n\nSame paragraph.\n\nEnd.\n",
    "@@ -3 +3,2 @@\n-Use old mode.\n+Use new mode.\n+An extra paragraph.\n@@ -7,2 +7,0 @@\n-Remove me.\n-\n");
  const result = blocks(html);
  expect(result.map(({ kind, side, line }) => [kind, side, line])).toEqual([
    ["", "new", 1], ["deletion", "old", 3], ["addition", "new", 3], ["addition", "new", 4],
    ["", "new", 6], ["deletion", "old", 7], ["", "new", 8],
  ]);
  expect(result[1]!.html).toContain('<span class="inline-change">old</span>');
  expect(result[2]!.html).toContain('<span class="inline-change">new</span>');
});

test("unified Markdown preserves tables and fences while merging changed list items", () => {
  const before = "# Guide\n\n| Key | Value |\n| --- | --- |\n| Mode | Old |\n\n## List\n\n- Keep\n- Old item\n\n## Code\n\n```js\nold();\n```\n\nEnd.\n";
  const after = before.replace("| Old |", "| New |").replace("- Old item", "- New item").replace("old();", "new();");
  const result = blocks(render(before, after,
    "@@ -5 +5 @@\n-| Mode | Old |\n+| Mode | New |\n@@ -10 +10 @@\n-- Old item\n+- New item\n@@ -15 +15 @@\n-old();\n+new();\n"));
  expect(result.map(block => block.kind)).toEqual(["", "", "", "", "", "deletion", "addition", "", "deletion", "addition", ""]);
  for (const [index, tag] of [[1, "table"], [8, "pre"]] as const) {
    expect(result[index]!.html).toContain(`<${tag}>`);
    expect(result[index + 1]!.html).toContain(`</${tag}>`);
  }
  expect(result.at(-1)!.html).toBe("<p>End.</p>");
  expect(result[1]!.html).toContain('<tr class="markdown-source-item deletion">');
  expect(result[2]!.html).toContain('<tr class="markdown-source-item addition">');
  expect(result.filter(block => block.html === "Keep")).toHaveLength(1);
  expect(result[5]!.html).toContain('Old');
  expect(result[6]!.html).toContain('New');
});

test("blank-line edits preserve list items without repeating or falsely highlighting them", () => {
  const result = blocks(render("# Guide\n\n- One\n\n- Two\n\nEnd.\n", "# Guide\n\n- One\n- Two\n\nEnd.\n",
    "@@ -4 +3,0 @@\n-\n"));
  expect(result.map(block => block.kind)).toEqual(["", "", "", ""]);
  expect(result.map(block => block.html)).toEqual(["<h1>Guide</h1>", "One", "Two", "<p>End.</p>"]);
});

test("empty versions, insertion at the start, and repeated unchanged text retain their source identity", () => {
  expect(blocks(render("", "# Added\n", "@@ -0,0 +1 @@\n+# Added\n")).map(block => [block.kind, block.side])).toEqual([["addition", "new"]]);
  expect(blocks(render("# Removed\n", "", "@@ -1 +0,0 @@\n-# Removed\n")).map(block => [block.kind, block.side])).toEqual([["deletion", "old"]]);
  const result = blocks(render("Same.\nOld.\nSame.\n", "Intro.\nSame.\nNew.\nSame.\n",
    "@@ -0,0 +1 @@\n+Intro.\n@@ -2 +3 @@\n-Old.\n+New.\n"));
  expect(result.map(({ kind, side, line }) => [kind, side, line])).toEqual([
    ["addition", "new", 1], ["", "new", 2], ["deletion", "old", 2], ["addition", "new", 3], ["", "new", 4],
  ]);
});
