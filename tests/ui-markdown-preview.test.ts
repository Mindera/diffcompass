import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");

test("Markdown files expose rendered previews without replacing the diff permanently", () => {
  expect(app).toContain('data-markdown-preview="${escapeHtml(file.path)}"');
  expect(app).toContain('${markdownPreview ? "Changes" : "Preview"}');
  expect(app).toContain("/api/diff/markdown?");
  expect(app).toContain('data-source-view="${preview ? "source" : "preview"}"');
  expect(app).toContain("renderMarkdown(content, 0)");
  expect(app).toContain("function markdownTableAlignments(line, columns)");
  expect(app).toContain('class="markdown-table-wrap"');
  expect(styles).toContain(".markdown-preview { box-sizing: border-box;");
  expect(styles).toContain(".rendered-markdown th, .rendered-markdown td {");
});

test("the tour/questions separator persists accessible pointer and keyboard resizing", () => {
  expect(app).toContain('preferenceKey("question-pane-percent")');
  expect(app).toContain('setAttribute("aria-valuetext"');
  expect(app).toContain('addEventListener("dblclick", () => resizeQuestions(45, true))');
  expect(app).toContain('resizeQuestions(state.questionPanePercent, true)');
  expect(styles).toContain(".questions-resizer::after");
});
