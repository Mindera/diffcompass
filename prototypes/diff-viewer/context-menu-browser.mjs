// Changes view state only. Use a disposable full-product fixture.
// node context-menu-browser.mjs /absolute/playwright/index.mjs 'http://127.0.0.1:PORT/#token=TOKEN'
import { pathToFileURL } from "node:url";
const [playwrightPath, url] = process.argv.slice(2);
if (!playwrightPath || !url) throw Error("Supply installed Playwright and a disposable full-fixture URL.");
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const theme = process.env.MONACO_TEST_THEME || "dark";
const page = await browser.newPage({ viewport: { width: 1800, height: 1100 }, colorScheme: theme });
page.setDefaultTimeout(15000);
const errors = []; page.on("pageerror", error => errors.push(error.stack));
const check = (value, message) => { if (!value) throw Error(message); };
try {
  await page.goto(url); await page.waitForFunction(() => window.diffCompassIntegration?.child);
  // A fresh fixture starts in phase 1; the Markdown files live in phase 2.
  // Explicitly enter file browsing before testing adjacent Markdown headers.
  await page.evaluate(() => diffCompassMonacoHost.show("docs/checkout-guide.md"));
  const frame = page.frames().find(frame => frame.url().includes("embedded=1"));
  const menu = frame.locator(".monaco-menu");
  const checkHitTargets = async () => {
    await menu.waitFor();
    const covered = await menu.evaluate(node => {
      const box = node.getBoundingClientRect(), root = node.getRootNode();
      const misses = [];
      for (let y = box.top + 8; y < box.bottom - 8; y += 8) {
        const hit = document.elementFromPoint(box.left + box.width / 2, y);
        if (!node.contains(hit) && hit !== root.host) misses.push({ y, element: hit?.className });
      }
      return misses;
    });
    check(!covered.length, "Menu must paint and receive clicks above adjacent files: " + JSON.stringify(covered));
  };
  for (const layout of ["unified", "split"]) {
    await page.locator(`[data-diff-layout="${layout}"]`).click();
    await frame.waitForFunction(layout => document.querySelector("#layout").value === layout, layout);
    await page.locator('#file-tree [data-file="docs/checkout-guide.md"]').click();
    // File visibility/layout propagates across the host/child animation frames.
    await frame.waitForFunction(() => diffLab.file.path === "docs/checkout-guide.md");
    await page.waitForTimeout(250);
    await frame.evaluate(() => {
      const view = diffLab.views.get("docs/checkout-guide.md");
      diffCompassMonaco.reveal("docs/checkout-guide.md", "new", 14);
      const list = document.querySelector("#file-list");
      list.scrollTop += view.root.getBoundingClientRect().top - list.getBoundingClientRect().top - 90;
      view.editors.new.setPosition({ lineNumber: 14, column: 10 }); view.editors.new.focus();
      view.editors.new.trigger("test", "editor.action.showContextMenu", {});
    });
    await menu.waitFor();
    check(await menu.evaluate(node => {
      const menu = node.getBoundingClientRect();
      const heading = document.querySelector('[data-prototype-file="docs/preview.md"] .prototype-file-heading').getBoundingClientRect();
      return menu.top < heading.bottom && menu.bottom > heading.top;
    }), "Regression setup must overlap the following file header");
    await checkHitTargets();
    await page.screenshot({ path: `/tmp/dc-context-menu-${layout}-${theme}.png` });
    await page.keyboard.press("Escape"); await menu.waitFor({ state: "hidden" });
    check(await frame.evaluate(() => diffLab.editors.new.hasTextFocus()), "Escape returns focus to the originating editor");
    // Exercise a real pointer-opened menu and its formerly covered action.
    const layersBeforeSource = await frame.locator(".review-editor-overflow").count();
    await frame.locator('[data-prototype-file="docs/checkout-guide.md"] .editor.modified .view-line')
      .filter({ hasText: "The receipt presents" }).click({ position: { x: 80, y: 8 }, button: "right" });
    await checkHitTargets();
    // Monaco enables menu mouse-up actions after 100ms to ignore the opening
    // right-click. Wait for that native guard, not a production UI delay.
    await page.waitForTimeout(150);
    await frame.getByRole("menuitem", { name: "View source", exact: true }).click();
    const file = frame.locator('[data-prototype-file="docs/checkout-guide.md"]');
    await file.locator('[data-control="source-pane"]').waitFor({ state: "visible" });
    check(await frame.evaluate(() => diffLab.file.path === "docs/checkout-guide.md"), "Menu action belongs to its originating file");
    check(await frame.locator(".review-editor-overflow").count() === layersBeforeSource + 1, "Source inspector owns a separate overflow layer");
    await frame.evaluate(() => {
      const source = monaco.editor.getEditors().find(editor => editor.getDomNode()?.closest('[data-prototype-file="docs/checkout-guide.md"] [data-control="source-editor"]'));
      source.setPosition({ lineNumber: 14, column: 10 }); source.focus();
      source.trigger("test", "editor.action.showContextMenu", {});
    });
    await checkHitTargets();
    await page.keyboard.press("Escape"); await menu.waitFor({ state: "hidden" });
    await file.locator('[data-control="return"]').click();
    await file.locator('[data-control="source-pane"]').waitFor({ state: "hidden" });
    check(await frame.locator(".review-editor-overflow").count() === layersBeforeSource, "Closing source removes its overflow layer");
    console.log("PASS", layout, theme, "menu overlays the next header/tools/code, supports Escape/pointer actions and source-menu cleanup");
    if (layout === "split") {
      await frame.evaluate(() => {
        const editor = diffLab.editors.old;
        editor.setPosition({ lineNumber: 9, column: 3 }); editor.revealLineInCenter(9); editor.focus();
        editor.trigger("test", "editor.action.showContextMenu", {});
      });
      await checkHitTargets(); await page.waitForTimeout(150);
      await frame.getByRole("menuitem", { name: "View source", exact: true }).click();
      await file.locator('[data-control="source-pane"]').waitFor({ state: "visible" });
      check((await file.locator('[data-control="source-title"]').textContent()).includes("Before"), "Original-side menu keeps its Before source identity");
      await file.locator('[data-control="return"]').click();
      check(await frame.locator(".review-editor-overflow").count() === layersBeforeSource, "Before inspector cleans up its overflow layer");
      console.log("PASS", theme, "Before-side menu retains its source identity");
    }
  }
  check(!errors.length, "No page errors: " + errors.join("\n"));
} finally { await browser.close(); }
