import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const helpers = app.slice(app.indexOf("function nextUnreviewedRenderedPath("), app.indexOf("async function setReviewed("));

function harness() {
  let headerBounds = { top: 400, bottom: 430 };
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
  const actions = new Function("state", "elements", "document", "window", "CSS", `${helpers}\nreturn { nextUnreviewedRenderedPath, captureVisibleFileHeader, recoverVisibleFileHeader };`)(
    state,
    elements,
    { querySelector: () => ({ getBoundingClientRect: () => ({ bottom: 140 }) }) },
    { innerHeight: 800 },
    { escape: (value: string) => value },
  ) as {
    nextUnreviewedRenderedPath: (path: string) => string | null;
    captureVisibleFileHeader: (path: string | null) => { path: string; visibleTop: number } | null;
    recoverVisibleFileHeader: (anchor: { path: string; visibleTop: number } | null) => void;
  };
  return {
    ...actions,
    panel,
    setHeaderBounds(top: number, bottom: number) { headerBounds = { top, bottom }; },
  };
}

test("review collapse leaves the viewport alone when the next unreviewed file stays visible", () => {
  const h = harness();
  const nextPath = h.nextUnreviewedRenderedPath("long.ts");
  expect(nextPath).toBe("next.ts");
  const anchor = h.captureVisibleFileHeader(nextPath);
  expect(anchor).toEqual({ path: "next.ts", visibleTop: 140 });

  h.setHeaderBounds(220, 250);
  h.recoverVisibleFileHeader(anchor);

  expect(h.panel.scrollTop).toBe(1_000);
});

test("review collapse recovers a formerly visible next file that moved above the viewport", () => {
  const h = harness();
  const anchor = h.captureVisibleFileHeader(h.nextUnreviewedRenderedPath("long.ts"));

  h.setHeaderBounds(70, 100);
  h.recoverVisibleFileHeader(anchor);

  expect(h.panel.scrollTop).toBe(930);
});

test("review collapse does not navigate to a next file that was not visible beforehand", () => {
  const h = harness();
  h.setHeaderBounds(650, 680);
  const anchor = h.captureVisibleFileHeader(h.nextUnreviewedRenderedPath("long.ts"));
  expect(anchor).toBeNull();

  h.setHeaderBounds(70, 100);
  h.recoverVisibleFileHeader(anchor);

  expect(h.panel.scrollTop).toBe(1_000);
});
