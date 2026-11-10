// The first click in an unfocused, page-sized Monaco iframe must select the
// clicked source, without scrolling the parent page to the previous cursor.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const [playwrightPath, url] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({ channel: process.env.CI ? undefined : "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1800, height: 1000 }, reducedMotion: "reduce" });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
try {
  await page.route("**/api/update", route => route.fulfill({ json: { updateAvailable: false } }));
  await page.goto(url);
  await page.locator("#diff-renderer").selectOption("monaco");
  await page.evaluate(() => diffCompassProductionHost.reveal("src/lazy-0.ts", "new", 81));
  await page.waitForFunction(() => document.querySelector('.monaco-review-frame[data-monaco-path="src/lazy-0.ts"]')?.contentWindow?.diffLab?.views.get("src/lazy-0.ts")?.diff.getLineChanges());
  const frame = page.frames().find(frame => new URL(frame.url(), url).searchParams.get("file") === "src/lazy-0.ts");
  await frame.getByRole("button", { name: "Show all context", exact: true }).click();
  await frame.waitForFunction(() => diffLab.views.get("src/lazy-0.ts").diff.saveViewState().modelState?.collapsedRegions?.every(region => region.range[0] === region.range[1]));
  await page.waitForFunction(() => document.querySelector('.monaco-file-slot[data-path="src/lazy-0.ts"]').getBoundingClientRect().height > 1600);

  async function point(side, line, gutter = false) {
    return page.evaluate(async ({ side, line, gutter }) => {
      const frame = document.querySelector('.monaco-review-frame[data-monaco-path="src/lazy-0.ts"]');
      const editor = frame.contentWindow.diffLab.views.get("src/lazy-0.ts").editors[side];
      const panel = document.getElementById("diff-panel");
      for (let index = 0; index < 4; index++) await new Promise(requestAnimationFrame);
      const position = editor.getScrolledVisiblePosition({ lineNumber: line, column: 5 });
      panel.scrollTop += frame.getBoundingClientRect().top + editor.getDomNode().getBoundingClientRect().top + position.top - 500;
      const layout = editor.getLayoutInfo();
      return {
        x: frame.getBoundingClientRect().left + editor.getDomNode().getBoundingClientRect().left + (gutter ? layout.lineNumbersLeft + layout.lineNumbersWidth / 2 : position.left),
        y: frame.getBoundingClientRect().top + editor.getDomNode().getBoundingClientRect().top + position.top + 5,
        scroll: panel.scrollTop,
      };
    }, { side, line, gutter });
  }
  async function checkClick(side, target, line, rangeStart = line) {
    await page.mouse.click(target.x, target.y);
    const after = await page.evaluate(async side => {
      for (let index = 0; index < 4; index++) await new Promise(requestAnimationFrame);
      const editor = document.querySelector('.monaco-review-frame[data-monaco-path="src/lazy-0.ts"]').contentWindow.diffLab.views.get("src/lazy-0.ts").editors[side];
      const selection = editor.getSelection();
      return { scroll: document.getElementById("diff-panel").scrollTop, line: editor.getPosition().lineNumber, start: selection.startLineNumber, end: selection.endLineNumber };
    }, side);
    assert.ok(Math.abs(target.scroll - after.scroll) < 2, `First click must not move the page: ${target.scroll} → ${after.scroll}`);
    assert.equal(after.line, line);
    assert.equal(after.start, rangeStart);
    assert.equal(after.end, line);
  }
  for (const [layout, side] of [["split", "new"], ["split", "old"], ["unified", "new"]]) {
    await page.locator(`[data-diff-layout="${layout}"]`).click();
    await frame.waitForFunction(layout => document.getElementById("layout").value === layout, layout);
    await frame.evaluate(side => diffLab.views.get("src/lazy-0.ts").editors[side].setPosition({ lineNumber: 1, column: 1 }), side);
    await page.locator("#diff-renderer").evaluate(node => node.focus({ preventScroll: true }));
    await checkClick(side, await point(side, 65), 65);
    // Refocusing for Shift-click must preserve the original selection anchor.
    await page.locator("#diff-renderer").evaluate(node => node.focus({ preventScroll: true }));
    await page.keyboard.down("Shift");
    await checkClick(side, await point(side, 67), 67, 65);
    await page.keyboard.up("Shift");
    // A fresh drag still selects through Monaco's native mouse handling.
    await page.locator("#diff-renderer").evaluate(node => node.focus({ preventScroll: true }));
    const start = await point(side, 60);
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(start.x + 30, start.y + 40, { steps: 4 }); await page.mouse.up();
    const selection = await frame.evaluate(side => diffLab.views.get("src/lazy-0.ts").editors[side].getSelection(), side);
    assert.equal(selection.startLineNumber, 60); assert.equal(selection.endLineNumber, 62);
    assert.ok(Math.abs(start.scroll - await page.locator("#diff-panel").evaluate(node => node.scrollTop)) < 2);
    console.log(`PASS ${layout}/${side}: first click, Shift-click and drag preserve the review viewport and source selection`);
  }
  assert.deepEqual(errors, []);
} finally {
  await page.unrouteAll({ behavior: "wait" });
  await browser.close();
}
