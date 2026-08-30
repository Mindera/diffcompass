import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const source = app.slice(app.indexOf("function treeFromFiles("), app.indexOf("function filteredChangedFiles("));
const escapeHtml = (text: string) => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const { renderChangedPathList, renderTreeNode, treeFromFiles } = new Function("state", "escapeHtml", "reviewIsOpen", `${source}; return {renderChangedPathList, renderTreeNode, treeFromFiles};`)({session: {reviewedFiles: ["src/a.ts"]}}, escapeHtml, () => true);
const files = (...paths: string[]) => paths.map(path => ({path, additions: 2, deletions: 1}));

test("compacts directory chains, displays basenames and opens every changed section", () => {
  const html = renderChangedPathList(files(".github/workflows/ci.yml", "shared/app/src/commonMain/kotlin/App.kt", "README.md"));
  expect(html).toContain('class="tree-directory-path">.github/workflows</span>');
  expect(html).toContain('class="tree-directory-path">shared/app/src/commonMain/kotlin</span>');
  expect(html.match(/<details/g)).toHaveLength(2);
  expect(html.match(/class="tree-directory" open/g)).toHaveLength(2);
  expect(html).toContain('title=".github/workflows/ci.yml">ci.yml</span>');
  expect(html).toContain('data-file="README.md"');
});

test("retains branch points and directories containing both files and folders", () => {
  const html = renderChangedPathList(files("docs/architecture/playbook.md", "docs/lab/run.md", "docs/roadmap.md"));
  expect(html).toContain('class="tree-directory-path">docs</span>');
  expect(html).toContain('summary title="docs/architecture"');
  expect(html).toContain('class="tree-directory-path">architecture</span>');
  expect(html).toContain('class="tree-directory-path">lab</span>');
  expect(html).not.toContain('class="tree-directory-path">docs/architecture</span>');
  expect(html.match(/class="tree-directory" open/g)).toHaveLength(3);
});

test("keeps selection paths, review controls, duplicate basenames and deterministic ordering", () => {
  const changed = files("src/b/a.ts", "src/a.ts", "docs/a.ts");
  const html = renderChangedPathList(changed);
  expect(html).toBe(renderChangedPathList([...changed].reverse()));
  for (const file of changed) {
    expect(html).toContain(`data-file="${file.path}"`);
    expect(html).toContain(`data-review-file="${file.path}"`);
  }
  expect(html).toContain('file-entry reviewed');
  expect(html).toContain('class="plus">+2');
  expect(renderChangedPathList([])).toBe("");
});

test("full repository compacts chains without dropping unchanged files", () => {
  const tree = treeFromFiles(["src/main/app.ts", "src/main/helper.ts"], files("src/main/app.ts", "deleted.txt"));
  const html = renderTreeNode(tree);
  expect(html).toContain('class="tree-directory-path">src/main</span>');
  expect(html).toContain('data-source="src/main/helper.ts"');
  expect(html).toContain('data-file="deleted.txt"');
});

test("escapes folder and file labels and full-path tooltips", () => {
  const html = renderChangedPathList(files('folder"/<tag>/a.ts'));
  expect(html).toContain('summary title="folder&quot;/&lt;tag&gt;"');
  expect(html).not.toContain("<tag>");
});
