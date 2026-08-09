import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

test("review navigation exposes expanded changed paths and a full repository mode", async () => {
  const [html, app] = await Promise.all([
    readFile(join(root, "public/index.html"), "utf8"),
    readFile(join(root, "public/app.js"), "utf8"),
  ]);
  expect(html).toContain('<select id="tree-mode"');
  expect(html).toContain('<option value="changes">Changed paths</option>');
  expect(html).toContain('<option value="repository">Full repository</option>');
  expect(app).toContain("renderChangedPathList(changedFiles)");
  expect(app).toContain("renderTreeNode(treeFromFiles(repositoryFiles, changedFiles))");
  expect(app).not.toContain('id="changed-only"');
});

test("tour rendering annotates code without continuously stealing navigation", async () => {
  const app = await readFile(join(root, "public/app.js"), "utf8");
  const renderTour = app.slice(app.indexOf("function renderTour()"), app.indexOf("function renderFilteredDiff()"));
  expect(app).toContain('note.className = "tour-code-note"');
  expect(app).toContain("compactText(step.objective, 220)");
  expect(app).toContain("async function focusCurrentStep()");
  expect(renderTour).not.toContain("scrollIntoView");
  expect(renderTour).not.toContain("showChangedFile");
  expect(app).not.toContain("Planning tour · 0s");
});

test("diff rows stay dense and the explanation owns a bounded scroll area", async () => {
  const [html, styles] = await Promise.all([
    readFile(join(root, "public/index.html"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  expect(html).toContain('id="tour-scroll" class="tour-scroll"');
  expect(styles).toContain("grid-template-rows: auto minmax(0, 1fr) auto");
  expect(styles).toContain("white-space: pre;");
  expect(styles).toContain("max-height: min(180px, 26vh)");
  expect(styles).toContain(".diff-row.split-side.split-empty");
  expect(styles).not.toContain(".diff-row.split-side.empty");
});
