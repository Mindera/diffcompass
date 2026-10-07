// Uses only a DISPOSABLE full-product fixture: navigates its tour and edits a fixture comment.
import { pathToFileURL } from "node:url";
const [playwrightPath, url] = process.argv.slice(2);
if (!playwrightPath || !url) throw Error("Supply Playwright and a disposable full-fixture URL.");
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1800, height: 1100 }, colorScheme: process.env.MONACO_TEST_THEME || "dark", permissions: ["clipboard-read", "clipboard-write"] });
const page = await context.newPage(), errors = [];
page.setDefaultTimeout(12000);
page.on("pageerror", error => errors.push(error.stack || error.message));
const check = (ok, message) => { if (!ok) throw Error(message); };
const token = new URL(url).hash.slice(7);
const request = async (path, body) => {
  const response = await context.request.fetch(new URL(path, url).href, { method: body === undefined ? "GET" : "POST", headers: { "x-diffcompass-token": token, origin: new URL(url).origin }, ...(body === undefined ? {} : { data: body }) });
  check(response.ok(), `Fixture request ${path}: ${response.status()}`); return response.json();
};
try {
  for (let i = 0; i < 3; i++) await request("/api/tour/navigate", { direction: "previous" });
  await request("/api/files/reviewed", { path: "README.md", reviewed: true });
  const info = await request("/api/prototype"), saved = await request("/api/session");
  await page.goto(url); await page.waitForFunction(() => window.diffCompassIntegration?.child);
  const frame = page.frames().find(frame => frame.url().includes("embedded=1"));
  const waitTour = async id => {
    await frame.locator(`[data-tour-stop="${id}"][data-tour-state="current"]`).waitFor();
    await page.waitForFunction(id => {
      const frame = document.querySelector("#monaco-integration-frame"), win = frame.contentWindow;
      const banner = win.document.querySelector(`[data-tour-stop="${id}"][data-tour-state="current"]`);
      if (!banner || banner.hidden) return false;
      const card = banner.closest("[data-prototype-file]"), b = banner.getBoundingClientRect();
      const list = win.document.querySelector("#file-list").getBoundingClientRect();
      const header = card.querySelector(".prototype-file-heading").getBoundingClientRect();
      const host = frame.getBoundingClientRect(), panel = document.querySelector("#diff-panel").getBoundingClientRect();
      const toolbar = document.querySelector(".diff-toolbar").getBoundingClientRect();
      return b.top >= Math.max(list.top, header.bottom, toolbar.bottom - host.top, panel.top - host.top) - 1 && b.bottom <= Math.min(list.bottom, win.innerHeight, innerHeight - host.top) + 1;
    }, id);
  };
  const card = path => frame.locator(`[data-prototype-file="${path}"]`);
  const control = (path, name) => card(path).locator(`[data-control="${name}"]`);
  const textPaths = saved.comparison.files.filter(file => file.path !== "screens/receipt.png").map(file => file.path).sort();
  check(JSON.stringify(await frame.evaluate(() => [...diffLab.views.keys()].sort())) === JSON.stringify(textPaths), "Every captured text file has a stable Monaco view");
  console.log("PASS all fixture text files, including three Markdown files, have Monaco models");
  await waitTour("extract-subtotal");
  await page.locator("#next-step").click(); await waitTour("apply-discount");
  await page.locator("#next-step").click(); await waitTour("format-receipt");
  await frame.evaluate(() => {
    window.receiptView = diffLab.views.get("src/receipt.ts");
    window.receiptModel = receiptView.editors.new.getModel();
    window.phasePaths = [...document.querySelectorAll("[data-prototype-file]:not([hidden])")].map(node => node.dataset.prototypeFile);
  });
  await page.evaluate(() => {
    window.rendererSwitches = [];
    new MutationObserver(records => { for (const record of records) rendererSwitches.push(record.oldValue); }).observe(document.querySelector("#monaco-integration-frame"), { attributes: true, attributeOldValue: true, attributeFilter: ["hidden"] });
  });
  for (const layout of ["split", "unified"]) {
    await page.locator(`[data-diff-layout="${layout}"]`).click();
    await page.locator("#next-step").click(); await waitTour("document-fixture");
    check(await page.evaluate(() => diffCompassIntegration.usingMonaco && !document.querySelector("#monaco-integration-frame").hidden), "README target stays in Monaco");
    check(await card("README.md").locator("[data-file-toggle]").getAttribute("aria-expanded") === "true", "Reviewed README opens when its stop is targeted");
    check(await frame.evaluate(() => receiptView === diffLab.views.get("src/receipt.ts") && receiptModel === receiptView.editors.new.getModel() && !receiptModel.isDisposed() && JSON.stringify(phasePaths) === JSON.stringify([...document.querySelectorAll("[data-prototype-file]:not([hidden])")].map(node => node.dataset.prototypeFile))), "Same file set and same receipt editor/model across README navigation");
    check(await page.locator('#diff .diff-file[data-path="README.md"]').isHidden(), "No duplicate legacy Markdown diff");
    await page.screenshot({ path: `/tmp/dc-monaco-markdown-tour-${layout}.png` });
    await page.locator("#previous-step").click(); await waitTour("format-receipt");
    console.log("PASS", layout, "receipt ↔ reviewed README stays in the same Monaco configuration");
  }
  check(await page.evaluate(() => rendererSwitches.length === 0), "Tour never hides/remounts the iframe");
  await page.locator("#next-step").click(); await waitTour("document-fixture");
  await control("README.md", "preview").click();
  await control("README.md", "markdown-preview").waitFor({ state: "visible" });
  await page.locator("#previous-step").click(); await waitTour("format-receipt");
  await page.locator("#next-step").click(); await waitTour("document-fixture");
  check(await control("README.md", "markdown-preview").isHidden(), "Tour navigation back to a previewed file reveals its code");
  console.log("PASS tour targeting closes Markdown preview without losing the stop");

  await page.locator("#tour-mode-toggle").click();
  await page.locator("#review-filter").selectOption("");
  for (const file of info.files.filter(file => file.language === "markdown")) {
    const path = file.path;
    await page.locator(`#file-tree [data-file="${path}"]`).click();
    await card(path).waitFor();
    await frame.evaluate(path => diffLab.views.get(path).reveal("new", 3), path);
    const before = await frame.evaluate(path => {
      const view = diffLab.views.get(path); window.markdownModel = view.editors.new.getModel();
      return { selection: view.editors.new.getSelection(), anchor: view.anchor };
    }, path);
    await control(path, "copy").click();
    check(await frame.evaluate(() => navigator.clipboard.readText()) === file.new, "Markdown Copy contents uses the complete captured file");
    await control(path, "preview").click();
    const preview = control(path, "markdown-preview");
    await preview.waitFor({ state: "visible" });
    if (path === "README.md") {
      await page.waitForTimeout(100);
      check((await preview.boundingBox()).height < 300, "Short rendered README fits its content");
    }
    const added = saved.comparison.files.find(change => change.path === path).status === "added";
    check(await preview.locator(".review-markdown-columns>section").count() === (added ? 1 : 2), "Correct Before/After sides from Git status");
    check(await preview.locator(".markdown-source-block.addition").count() > 0, "Changed Markdown blocks are highlighted");
    if (!added) check(await preview.locator(".markdown-source-block.deletion").count() > 0, "Before changes highlighted");
    if (path === "docs/checkout-guide.md") check(await preview.locator("table").count() === 2, "Before and After tables render");
    if (path === "docs/preview.md") check(await preview.locator("pre code.language-kotlin").count() === 1 && await preview.locator("ul").count() === 1 && await preview.locator("ol").count() === 1, "Code fences and both list types render");
    check(await control(path, "editor").evaluate(node => node.inert), "Code and its actions are not keyboard reachable behind preview");
    await page.screenshot({ path: `/tmp/dc-monaco-markdown-${path.split("/").at(-1)}.png` });
    await preview.getByRole("button", { name: "← Back to diff", exact: true }).click();
    check(await frame.evaluate(({ path, before }) => {
      const view = diffLab.views.get(path);
      return markdownModel === view.editors.new.getModel() && JSON.stringify(view.editors.new.getSelection()) === JSON.stringify(before.selection) && JSON.stringify(view.anchor) === JSON.stringify(before.anchor);
    }, { path, before }), "Preview return retains the Monaco model, selection and review anchor");
    await control(path, "source").click();
    await control(path, "source-pane").waitFor({ state: "visible" });
    check(await frame.evaluate(({ path, expected }) => monaco.editor.getEditors().some(editor => editor.getDomNode()?.closest(`[data-prototype-file="${path}"] [data-control="source-editor"]`) && editor.getValue() === expected), { path, expected: file.new }), "Markdown View source shows captured content");
    await control(path, "return").click();
    await frame.evaluate(path => {
      const card = document.querySelector(`[data-prototype-file="${path}"]`);
      const editorCount = monaco.editor.getEditors().length, modelCount = monaco.editor.getModels().length;
      for (let i = 0; i < 5; i++) {
        card.querySelector('[data-control="source"]').click();
        card.querySelector('[data-control="return"]').click();
      }
      if (monaco.editor.getEditors().length !== editorCount || monaco.editor.getModels().length !== modelCount) throw Error("Transient source editor/model leaked");
    }, path);
    console.log("PASS", path, "captured copy/source, rendered preview, correct revision sides and state-preserving return");
  }
  // Exercise the exact production sanitizer used by the embedded preview.
  check(await page.evaluate(() => {
    const html = diffCompassMonacoHost.renderMarkdownPreview("README.md", "new", '<script>window.BAD=1</script>\n<img src="x" onerror="window.BAD=1">\n[bad](javascript:alert(1))');
    const div = document.createElement("div"); div.innerHTML = html;
    return !div.querySelector("script,[onerror],a[href^='javascript:']");
  }), "Preview uses the existing escaped Markdown renderer");
  console.log("PASS Markdown preview does not introduce raw HTML or unsafe-link rendering");

  await page.locator('#file-tree [data-file="README.md"]').click();
  const comment = card("README.md").locator("[data-comment-id]").filter({ hasText: /Keep this list current|Markdown fixture edited comment/ });
  await comment.getByRole("button", { name: "Edit", exact: true }).click();
  const draft = card("README.md").locator("[data-comment-id]").filter({ hasText: "Editing line comment" });
  await draft.getByRole("textbox").fill("Markdown fixture edited comment");
  await control("README.md", "preview").click();
  check(await control("README.md", "markdown-preview").isHidden() && await draft.getByRole("textbox").inputValue() === "Markdown fixture edited comment", "Preview cannot hide an unfinished comment draft");
  await draft.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.locator("#comment-list").getByText("Markdown fixture edited comment", { exact: true }).waitFor();
  const beforeReviewed = (await request("/api/session")).reviewedFiles.filter(path => path !== "README.md").sort();
  const review = card("README.md").locator("[data-review-path]");
  if (await review.getAttribute("aria-pressed") === "true") await review.click();
  await review.click();
  await card("README.md").locator('[data-file-toggle][aria-expanded="false"]').waitFor();
  const afterReviewed = (await request("/api/session")).reviewedFiles.filter(path => path !== "README.md").sort();
  check(JSON.stringify(beforeReviewed) === JSON.stringify(afterReviewed), "Reviewing Markdown affects only this file");
  console.log("PASS Markdown comments persist, preview protects drafts and reviewed state collapses only this file");
  await page.locator('#file-tree [data-file="screens/receipt.png"]').click();
  await page.waitForFunction(() => {
    const images = [...document.querySelectorAll('.image-diff img')];
    return images.length === 2 && images.every(image => image.complete && image.naturalWidth > 0);
  });
  check(await page.evaluate(() => diffCompassIntegration.usingMonaco), "A dedicated image preview does not change the preferred text renderer");
  check(await frame.evaluate(() => receiptModel === diffLab.views.get("src/receipt.ts").editors.new.getModel() && !receiptModel.isDisposed()), "Image navigation retains text models");
  console.log("PASS Before/After image preview remains dedicated and retains Monaco text state");

  await page.locator('#file-tree [data-file="docs/checkout-guide.md"]').click();
  await control("docs/checkout-guide.md", "preview").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Narrow parent has no horizontal overflow");
  check(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Narrow iframe has no horizontal overflow");
  const boxes = await control("docs/checkout-guide.md", "markdown-preview").locator(".review-markdown-columns>section").evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; }));
  check(boxes[1].top >= boxes[0].bottom, "Before/After Markdown preview stacks on narrow screens");
  await page.screenshot({ path: "/tmp/dc-monaco-markdown-narrow.png" });
  console.log("PASS narrow Markdown preview stacks without shell overflow");
  check(!errors.length, "No page errors: " + JSON.stringify(errors));
} catch (error) {
  console.error(error.stack); console.error(errors); await page.screenshot({ path: "/tmp/dc-monaco-markdown-failure.png" }); process.exitCode = 1;
} finally { await browser.close(); }
