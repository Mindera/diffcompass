import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");

test("Markdown files expose rendered previews without replacing the diff permanently", () => {
  expect(app).toContain('data-markdown-preview="${escapeHtml(file.path)}"');
  expect(app).toContain('${markdownPreview ? "Changes" : "Preview"}');
  expect(app).toContain("/api/diff/markdown?");
  expect(app).toContain('data-source-view="${preview ? "source" : "preview"}"');
  expect(app).toContain("function markdownChangedLines(file, side)");
  expect(app).toContain("for (const [side] of markdownSides(file))");
  expect(app).toContain("changedRanges: markdownChangedRanges(file, side)");
  expect(app).toContain('class="markdown-source-block${changed ? ` ${source.side === "old" ? "deletion" : "addition"}` : ""}"');
  expect(app).toContain('.markdown-source-block[data-markdown-path="${CSS.escape(path)}"]');
  expect(app).toContain("function markdownTableAlignments(line, columns)");
  expect(app).toContain("function markdownFenceStart(line)");
  expect(app).toContain("markdownFenceEnd(line, fence)");
  expect(app).toContain('class="language-${escapeHtml(fence.language)}"');
  expect(app).toContain('${escapeHtml(fence.lines.join("\\n"))}</code></pre>');
  expect(app).toContain('class="markdown-table-wrap"');
  expect(styles).toContain(".markdown-preview { box-sizing: border-box;");
  expect(styles).toContain(".rendered-markdown th, .rendered-markdown td {");
  expect(styles).toContain(".markdown-preview pre {");
  expect(styles).toContain(".markdown-preview pre code {");
  expect(styles).toContain(".markdown-diff { display: grid;");
  expect(styles).toContain(".markdown-source-block.addition {");
  expect(styles).toContain(".markdown-source-block.tour-anchor {");
  expect(styles).not.toContain(".markdown-diff-side > header { position: sticky;");
});

test("rendered Markdown emphasizes the exact changed words", () => {
  const source = app.slice(app.indexOf("function renderInlineChangeText"), app.indexOf("function pullRequestDescription"));
  const { renderMarkdown } = new Function("escapeHtml", `${source}; return { renderMarkdown };`)((value: unknown) => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;"));
  const html = renderMarkdown("The checkout calculates a discount-aware total.", 0, {
    path: "guide.md",
    side: "new",
    changedLines: new Set([1]),
    changedRanges: new Map([[1, [[26, 40]]]]),
  });

  expect(html).toContain('calculates a <span class="inline-change">discount-aware</span> total');
});

test("the tour/questions separator persists accessible pointer and keyboard resizing", () => {
  expect(app).toContain('preferenceKey("question-pane-percent")');
  expect(app).toContain('setAttribute("aria-valuetext"');
  expect(app).toContain('addEventListener("dblclick", () => resizeQuestions(45, true))');
  expect(app).toContain('resizeQuestions(state.questionPanePercent, true)');
  expect(styles).toContain(".questions-resizer::after");
});
