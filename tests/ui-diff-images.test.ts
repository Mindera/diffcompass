import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const helpers = app.slice(app.indexOf("function isPngDiff("), app.indexOf("function syntaxTokenHtml("));
const header = app.slice(app.indexOf("function renderDiffFileHeader("), app.indexOf("async function revealCodeLocation("));
const file = { path: "screens/home.png", oldPath: "screens/home.png", newPath: "screens/home.png", status: "modified" };

function harness(figures: object[] = [], apiBlob = async (_path: string) => new Blob()) {
  const state = { session: { revision: 1 }, diffImageUrls: new Map(), diffImageRequestId: 0, proposalPreview: false };
  const revoked: string[] = [];
  let created = 0;
  const urls = { createObjectURL: () => `blob:test-${++created}`, revokeObjectURL: (url: string) => revoked.push(url) };
  const elements = { diff: { querySelectorAll: () => figures } };
  const escapeHtml = (text: string) => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
  const funcs = new Function("state", "elements", "apiBlob", "URL", "escapeHtml", "reviewIsOpen", `${helpers}\n${header}\nreturn { renderPngDiff, renderDiffFileHeader, hydrateDiffImages };`)(state, elements, apiBlob, urls, escapeHtml, () => true);
  return { ...funcs, state, revoked, figures, get created() { return created; } };
}

test("PNG diff markup labels both sides, supports missing sides, and omits text expansion controls", () => {
  const h = harness();
  expect(h.renderPngDiff(file)).toContain('data-diff-image-side="old"');
  expect(h.renderPngDiff(file)).toContain('<figcaption>After</figcaption>');
  const added = h.renderPngDiff({ ...file, oldPath: null, status: "added" });
  expect(added).not.toContain('data-diff-image-side="old"');
  expect(added).toContain("<figcaption>Added</figcaption>");
  const deleted = h.renderPngDiff({ ...file, newPath: null, status: "deleted" });
  expect(deleted).not.toContain('data-diff-image-side="new"');
  expect(deleted).toContain("<figcaption>Removed</figcaption>");
  expect(added).toContain('data-image-tool="comment"');
  expect(added).toContain('data-image-tool="ask"');
  expect(added).toContain('data-content="[PNG image · new]"');
  const html = h.renderDiffFileHeader(file, false);
  expect(html).toContain("PNG image");
  expect(html).toContain("Mark as reviewed");
  expect(html).not.toContain("Expand file");
  expect(html).not.toContain('class="plus"');
  h.state.proposalPreview = true;
  expect(h.renderPngDiff(file)).toContain("unavailable for this pending suggestion");
  expect(h.renderPngDiff(file)).not.toContain("data-diff-image-path");
});

test("late PNG fetches cannot attach bytes to a different revision or leak object URLs", async () => {
  let resolve!: (blob: Blob) => void;
  const loading = { outerHTML: "", textContent: "" };
  const figure = { dataset: { diffImagePath: file.path, diffImageSide: "new" }, isConnected: true, querySelector: (selector: string) => selector === "img" ? null : loading };
  const h = harness([figure], () => new Promise<Blob>((done) => { resolve = done; }));
  const pending = h.hydrateDiffImages([file]);
  h.figures.length = 0;
  h.state.session.revision++;
  await h.hydrateDiffImages([]);
  resolve(new Blob());
  await pending;
  expect(h.created).toBe(0);
  expect(loading.outerHTML).toBe("");
  h.state.diffImageUrls.set("old-key", "blob:old");
  await h.hydrateDiffImages([]);
  expect(h.revoked).toEqual(["blob:old"]);
});

test("PNG fetches use the authenticated blob API, reuse URLs and show failures in-place", async () => {
  const loading = { outerHTML: "", textContent: "" };
  const figure = { dataset: { diffImagePath: file.path, diffImageSide: "new" }, isConnected: true, querySelector: (selector: string) => selector === "img" ? null : loading };
  const paths: string[] = [];
  const h = harness([figure], async (path) => { paths.push(path); return new Blob(); });
  await h.hydrateDiffImages([file]);
  await h.hydrateDiffImages([file]);
  expect(paths).toEqual(["/api/diff/image?path=screens%2Fhome.png&side=new"]);
  expect(h.created).toBe(1);
  expect(loading.outerHTML).toContain('target="_blank" rel="noopener"');
  const failing = harness([figure], async () => { throw new Error("PNG unavailable"); });
  await failing.hydrateDiffImages([file]);
  expect(loading.textContent).toBe("PNG unavailable");
});
