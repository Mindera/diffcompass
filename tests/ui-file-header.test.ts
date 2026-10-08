import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const source = app.slice(app.indexOf("function renderDiffFileHeader("), app.indexOf("async function revealCodeLocation("));
const escapeHtml = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
function header(path: string, { reviewed = false, collapsed = false, open = true, proposal = false } = {}) {
  const state = { session: { reviewedFiles: reviewed ? [path] : [] }, markdownPreviewPaths: new Set(), proposalPreview: proposal, proposalActivityId: proposal ? "suggestion-1" : null };
  const render = new Function("state", "escapeHtml", "isMarkdownFile", "isPngDiff", "reviewIsOpen", `${source}; return renderDiffFileHeader;`)(
    state, escapeHtml, (file: { path: string }) => file.path.endsWith(".md"), (file: { path: string }) => file.path.endsWith(".png"), () => open,
  );
  return render({ path, status: "modified", additions: 3, deletions: 1 }, collapsed) as string;
}

for (const path of ["src/cart.ts", "README.md", "screens/receipt.png"]) {
  test(`default ${path} header has the Monaco-style review button and disclosure arrow`, () => {
    const html = header(path);
    expect(html).toContain('class="review-file-button"');
    expect(html).not.toContain('class="text-button review-file-button"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('>Mark as reviewed</button>');
    expect(html).toContain('class="collapse-caret" aria-hidden="true">▾</span>');
    expect(html.indexOf('class="review-file-button"')).toBeGreaterThan(html.indexOf(path.endsWith(".png") ? "PNG image" : 'class="minus"'));
    const reviewed = header(path, { reviewed: true, collapsed: true });
    expect(reviewed).toContain('aria-pressed="true"');
    expect(reviewed).toContain('>✓ Reviewed</button>');
    expect(reviewed).toContain('class="collapse-caret" aria-hidden="true">▸</span>');
    expect(reviewed).toContain('aria-expanded="false"');
    expect(reviewed).toContain(`title="Mark as not reviewed: ${path}"`);
  });
}

test("review button respects closed reviews, proposal previews and escaped paths", () => {
  expect(header("src/cart.ts", { open: false })).toMatch(/class="review-file-button"[^>]* disabled/);
  const proposal = header("src/cart.ts", { proposal: true });
  expect(proposal).not.toContain('data-reviewed-file=');
  expect(proposal).toContain('data-preview-activity-action="apply"');
  expect(proposal).toContain('data-preview-activity-action="reject"');
  expect(header('src/a"<.ts')).toContain('data-reviewed-file="src/a&quot;&lt;.ts"');
});
