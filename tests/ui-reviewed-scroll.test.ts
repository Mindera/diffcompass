import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const helpers = app.slice(app.indexOf("function nextRenderedPath("), app.indexOf("async function setReviewed("));

function harness() {
  let fileBounds = { top: 400, bottom: 700 };
  const frames: Array<() => void> = [];
  const panel = {
    scrollTop: 1_000,
    getBoundingClientRect: () => ({ top: 100, bottom: 600 }),
  };
  const header = { getBoundingClientRect: () => ({ top: Math.max(fileBounds.top, 140), bottom: Math.max(fileBounds.top, 140) + 30, height: 30 }) };
  const file = {
    getBoundingClientRect: () => fileBounds,
    querySelector: (selector: string) => selector === ":scope > .diff-file-header" ? header : null,
  };
  const state = {
    renderedDiffFiles: [
      { path: "long.ts" },
      { path: "already-reviewed.ts" },
      { path: "next.ts" },
    ],
    session: { reviewedFiles: ["already-reviewed.ts"] },
  };
  const elements = {
    "diff-panel": panel,
    diff: { querySelector: (selector: string) => selector.includes("next.ts") ? file : null },
  };
  const actions = new Function("state", "elements", "document", "window", "CSS", `${helpers}\nreturn { nextRenderedPath, captureNextFileAnchor, recoverVisibleFileHeader, recoverVisibleFileHeaderAfterLayout };`)(
    state,
    elements,
    { querySelector: () => ({ getBoundingClientRect: () => ({ bottom: 140 }) }) },
    { innerHeight: 800, requestAnimationFrame: (callback: () => void) => { frames.push(callback); } },
    { escape: (value: string) => value },
  ) as {
    nextRenderedPath: (path: string) => string | null;
    captureNextFileAnchor: (path: string | null) => { path: string; visibleTop: number; wasVisible: boolean } | null;
    recoverVisibleFileHeader: (anchor: { path: string; visibleTop: number; wasVisible: boolean } | null, expectedScrollTop?: number) => void;
    recoverVisibleFileHeaderAfterLayout: (anchor: { path: string; visibleTop: number; wasVisible: boolean } | null) => void;
  };
  return {
    ...actions,
    panel,
    setFileBounds(top: number, bottom: number) { fileBounds = { top, bottom }; },
    runFrame() { frames.shift()?.(); },
  };
}

test("review collapse anchors the actual next rendered file regardless of review state", () => {
  const h = harness();
  const nextPath = h.nextRenderedPath("long.ts");
  expect(nextPath).toBe("already-reviewed.ts");
});

test("review collapse leaves the viewport alone when the next file stays visible", () => {
  const h = harness();
  const nextPath = h.nextRenderedPath("already-reviewed.ts");
  const anchor = h.captureNextFileAnchor(nextPath);
  expect(anchor).toEqual({ path: "next.ts", visibleTop: 140, wasVisible: true });

  h.setFileBounds(220, 520);
  h.recoverVisibleFileHeader(anchor);

  expect(h.panel.scrollTop).toBe(1_000);
});

test("review collapse recovers after two layout frames when a formerly visible file moved above", () => {
  const h = harness();
  const anchor = h.captureNextFileAnchor(h.nextRenderedPath("already-reviewed.ts"));

  h.setFileBounds(70, 370);
  h.recoverVisibleFileHeaderAfterLayout(anchor);
  expect(h.panel.scrollTop).toBe(1_000);
  h.runFrame();
  expect(h.panel.scrollTop).toBe(1_000);
  h.runFrame();

  expect(h.panel.scrollTop).toBe(930);
});

test("delayed recovery does not override a user scroll made while layout settles", () => {
  const h = harness();
  const anchor = h.captureNextFileAnchor(h.nextRenderedPath("already-reviewed.ts"));
  h.setFileBounds(70, 370);
  h.recoverVisibleFileHeaderAfterLayout(anchor);
  h.panel.scrollTop = 1_030;
  h.runFrame();
  h.runFrame();
  expect(h.panel.scrollTop).toBe(1_030);
});

test("review collapse shows an initially off-screen next file from its beginning", () => {
  const h = harness();
  h.setFileBounds(650, 950);
  const anchor = h.captureNextFileAnchor(h.nextRenderedPath("already-reviewed.ts"));
  expect(anchor).toEqual({ path: "next.ts", visibleTop: 140, wasVisible: false });

  h.setFileBounds(-180, 120);
  h.recoverVisibleFileHeader(anchor);

  expect(h.panel.scrollTop).toBe(680);
});

test("review collapse uses the file's natural top even when its header is sticky", () => {
  const h = harness();
  const anchor = h.captureNextFileAnchor(h.nextRenderedPath("already-reviewed.ts"));
  h.setFileBounds(60, 360);

  h.recoverVisibleFileHeader(anchor);

  expect(h.panel.scrollTop).toBe(920);
});
