import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
// @ts-expect-error Shared browser module.
import { panReviewScroll } from "../public/monaco/pen-scroll.mjs";
// @ts-expect-error Shared browser module.
import { actionBarBounds } from "../public/monaco/mobile-actions.mjs";

function scroller(top: number, max: number) {
  return { scrollTop: top, scrollHeight: max + 500, clientHeight: 500,
    scrollTo({ top }: { top: number }) { this.scrollTop = Math.max(0, Math.min(max, top)); } };
}

test("pen scroll consumes the diff range then hands the remaining movement to the mobile page", () => {
  const panel = scroller(980, 1000), page = scroller(0, 750);
  panReviewScroll(panel, 80, page);
  expect(panel.scrollTop).toBe(1000); expect(page.scrollTop).toBe(60);
  panReviewScroll(panel, 100, page);
  expect(panel.scrollTop).toBe(1000); expect(page.scrollTop).toBe(160);
});

test("reverse pen movement reveals the diff before moving its source", () => {
  const panel = scroller(1000, 1000), page = scroller(60, 750);
  panReviewScroll(panel, -100, page);
  expect(page.scrollTop).toBe(0); expect(panel.scrollTop).toBe(960);
});

test("once the page moves toward the tour, code remeasurement does not steal the next drag", () => {
  const panel = scroller(800, 1200), page = scroller(60, 750);
  panReviewScroll(panel, 50, page);
  expect(page.scrollTop).toBe(110); expect(panel.scrollTop).toBe(800);
});

test("short diffs still hand off and page limits never wrap", () => {
  const panel = scroller(0, 0), page = scroller(0, 750);
  panReviewScroll(panel, 900, page);
  expect(page.scrollTop).toBe(750);
  panReviewScroll(panel, -900, page);
  expect(page.scrollTop).toBe(0); expect(panel.scrollTop).toBe(0);
});

test("desktop scroll stays inside the diff and invalid deltas are ignored", () => {
  const panel = scroller(980, 1000);
  panReviewScroll(panel, 80); expect(panel.scrollTop).toBe(1000);
  panReviewScroll(panel, NaN); panReviewScroll(panel, Infinity);
  expect(panel.scrollTop).toBe(1000);
});

test("the code toolbar docks above the tour peek without adding a second host lane", () => {
  const panel = { left: 0, right: 820, top: 111, bottom: 924 };
  const viewport = { left: 0, top: 0, width: 820, height: 1000 };
  expect(actionBarBounds(panel, viewport, 72)?.bottom).toBe(916);
  expect(actionBarBounds(panel, viewport, 0)?.bottom).toBe(916);
});

test("mobile has one document scroll owner and a peeking tour header with a shortcut", async () => {
  const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");
  const [styles, controller, app, html] = await Promise.all([
    read("../public/styles.css"), read("../public/monaco-controller.mjs"), read("../public/app.js"), read("../public/index.html"),
  ]);
  expect(styles).toContain("body { height: auto; min-height: 100dvh; overflow: visible; }");
  expect(styles).toContain("html:has(body.file-panel-open) { overflow: hidden; }");
  expect(controller).toContain('panReviewScroll(scrollRoot, deltaY, matchMedia("(max-width: 900px)").matches ? document.scrollingElement : null)');
  expect(html).toContain('id="mobile-tour-jump"');
  expect(styles).toContain("--mobile-tour-peek: 76px;");
  expect(styles).toContain("- var(--mobile-tour-peek)");
  expect(app).toContain('revealMobilePanel("agent-panel")');
  expect(app).toContain('revealMobilePanel("diff-panel")');
});
