import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const helpers = app.slice(app.indexOf("function isPngDiff("), app.indexOf("function syntaxTokenHtml("));
const header = app.slice(app.indexOf("function renderDiffFileHeader("), app.indexOf("async function revealCodeLocation("));
const file = { path: "screens/home.png", oldPath: "screens/home.png", newPath: "screens/home.png", status: "modified" };

function harness(figures: object[] = [], apiBlob = async (_path: string) => new Blob(), decode = async () => {}) {
  let positionCorrections = 0;
  const state = { session: { revision: 1 }, diffImageUrls: new Map(), diffImageRequestId: 0, proposalPreview: false, monacoRenderer: { preservePhasePosition() { positionCorrections++; } } };
  const revoked: string[] = [];
  let created = 0;
  const urls = { createObjectURL: () => `blob:test-${++created}`, revokeObjectURL: (url: string) => revoked.push(url) };
  const elements = { diff: { querySelectorAll: () => figures } };
  const escapeHtml = (text: string) => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
  class Image { src = ""; alt = ""; decoded = false; async decode() { await decode(); this.decoded = true; } }
  const document = { createElement: () => ({ children: [] as Image[], append(image: Image) { this.children.push(image); } }) };
  const funcs = new Function("state", "elements", "apiBlob", "URL", "escapeHtml", "reviewIsOpen", "Image", "document", `${helpers}\n${header}\nreturn { renderPngDiff, renderDiffFileHeader, hydrateDiffImages };`)(state, elements, apiBlob, urls, escapeHtml, () => true, Image, document);
  return { ...funcs, state, revoked, figures, get created() { return created; }, get positionCorrections() { return positionCorrections; } };
}

function imageFigure() {
  const loading = { replacement: null as any, textContent: "", replaceWith(node: object) { this.replacement = node; } };
  const figure = { dataset: { diffImagePath: file.path, diffImageSide: "new" }, isConnected: true, querySelector: (selector: string) => selector === ".image-diff-loading" ? loading : null };
  return { loading, figure };
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
  const { loading, figure } = imageFigure();
  const paths: string[] = [];
  const h = harness([figure], async (path) => { paths.push(path); return new Blob(); });
  await h.hydrateDiffImages([file]);
  await h.hydrateDiffImages([file]);
  expect(paths).toEqual(["/api/diff/image?path=screens%2Fhome.png&side=new"]);
  expect(h.created).toBe(1);
  expect(loading.replacement).toMatchObject({ target: "_blank", rel: "noopener", href: "blob:test-1" });
  const failing = harness([figure], async () => { throw new Error("PNG unavailable"); });
  await failing.hydrateDiffImages([file]);
  expect(loading.textContent).toBe("PNG unavailable");
});

test("PNG decoding finishes offscreen before insertion and position correction", async () => {
  const { loading, figure } = imageFigure();
  let complete!: () => void;
  const decoding = new Promise<void>(resolve => { complete = resolve; });
  const h = harness([figure], async () => new Blob(), () => decoding);
  const pending = h.hydrateDiffImages([file]);
  await Promise.resolve();
  expect(loading.replacement).toBeNull();
  expect(h.positionCorrections).toBe(0);
  complete(); await pending;
  expect(loading.replacement.children[0]).toMatchObject({ decoded: true, alt: "After: screens/home.png" });
  expect(h.positionCorrections).toBe(1);
});

test("a late PNG decode cannot attach to a refreshed comparison", async () => {
  const { loading, figure } = imageFigure();
  let complete!: () => void;
  const decoding = new Promise<void>(resolve => { complete = resolve; });
  const h = harness([figure], async () => new Blob(), () => decoding);
  const pending = h.hydrateDiffImages([file]); await Promise.resolve();
  h.figures.length = 0; h.state.session.revision++;
  await h.hydrateDiffImages([]);
  complete(); await pending;
  expect(loading.replacement).toBeNull();
  expect(h.revoked).toEqual(["blob:test-1"]);
  expect(h.positionCorrections).toBe(0);
});

test("PNG decode failure keeps the original image link and permits a later retry", async () => {
  const { loading, figure } = imageFigure();
  let failed = true;
  const h = harness([figure], async () => new Blob(), async () => { if (failed) throw Error("Invalid PNG"); });
  await h.hydrateDiffImages([file]);
  expect(loading.replacement).toMatchObject({ href: "blob:test-1", className: "image-diff-loading", textContent: "Unable to display this PNG. Open the original image." });
  expect(loading.replacement.children).toEqual([]);
  failed = false; await h.hydrateDiffImages([file]);
  expect(loading.replacement.children[0].decoded).toBe(true);
  expect(h.created).toBe(1);
});
