import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const helpers = app.slice(app.indexOf("function nextRenderedPath("), app.indexOf("async function setReviewed("));

function harness() {
  let headerBounds = { top: 400, bottom: 430 };
  const frames: Array<() => void> = [];
  const panel = {
    scrollTop: 1_000,
    getBoundingClientRect: () => ({ top: 100, bottom: 600 }),
  };
  const header = { getBoundingClientRect: () => headerBounds };
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
    diff: { querySelector: (selector: string) => selector.includes("next.ts") ? header : null },
  };
  const actions = new Function("state", "elements", "document", "window", "CSS", `${helpers}\nreturn { nextRenderedPath, captureVisibleFileHeader, recoverVisibleFileHeader, recoverVisibleFileHeaderAfterLayout };`)(
    state,
    elements,
    { querySelector: () => ({ getBoundingClientRect: () => ({ bottom: 140 }) }) },
    { innerHeight: 800, requestAnimationFrame: (callback: () => void) => { frames.push(callback); } },
    { escape: (value: string) => value },
  ) as {
    nextRenderedPath: (path: string) => string | null;
    captureVisibleFileHeader: (path: string | null) => { path: string; visibleTop: number } | null;
    recoverVisibleFileHeader: (anchor: { path: string; visibleTop: number } | null, expectedScrollTop?: number) => void;
    recoverVisibleFileHeaderAfterLayout: (anchor: { path: string; visibleTop: number } | null) => void;
  };
  return {
    ...actions,
    panel,
    setHeaderBounds(top: number, bottom: number) { headerBounds = { top, bottom }; },
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
  const anchor = h.captureVisibleFileHeader(nextPath);
  expect(anchor).toEqual({ path: "next.ts", visibleTop: 140 });

  h.setHeaderBounds(220, 250);
  h.recoverVisibleFileHeader(anchor);

  expect(h.panel.scrollTop).toBe(1_000);
});

test("review collapse recovers after two layout frames when a formerly visible file moved above", () => {
  const h = harness();
  const anchor = h.captureVisibleFileHeader(h.nextRenderedPath("already-reviewed.ts"));

  h.setHeaderBounds(70, 100);
  h.recoverVisibleFileHeaderAfterLayout(anchor);
  expect(h.panel.scrollTop).toBe(1_000);
  h.runFrame();
  expect(h.panel.scrollTop).toBe(1_000);
  h.runFrame();

  expect(h.panel.scrollTop).toBe(930);
});

test("delayed recovery does not override a user scroll made while layout settles", () => {
  const h = harness();
  const anchor = h.captureVisibleFileHeader(h.nextRenderedPath("already-reviewed.ts"));
  h.setHeaderBounds(70, 100);
  h.recoverVisibleFileHeaderAfterLayout(anchor);
  h.panel.scrollTop = 1_030;
  h.runFrame();
  h.runFrame();
  expect(h.panel.scrollTop).toBe(1_030);
});

test("review collapse does not navigate to a next file that was not visible beforehand", () => {
  const h = harness();
  h.setHeaderBounds(650, 680);
  const anchor = h.captureVisibleFileHeader(h.nextRenderedPath("already-reviewed.ts"));
  expect(anchor).toBeNull();

  h.setHeaderBounds(70, 100);
  h.recoverVisibleFileHeader(anchor);

  expect(h.panel.scrollTop).toBe(1_000);
});
