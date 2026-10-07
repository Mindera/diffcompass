// Disposable full-product fixture only: this moves its saved tour position.
import { pathToFileURL } from "node:url";
const [playwrightPath, url] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
page.setDefaultTimeout(12000);
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const check = (ok, message) => { if (!ok) throw Error(message); };
function visibleStop(id) {
  const frame = document.querySelector("#monaco-integration-frame"), win = frame.contentWindow;
  const banner = win.document.querySelector(`[data-tour-stop="${id}"][data-tour-state="current"]`);
  if (!banner || banner.hidden) return false;
  const card = banner.closest("[data-prototype-file]"), view = win.diffLab.views.get(card.dataset.prototypeFile);
  const e = view.editors[banner.dataset.side], pos = e.getScrolledVisiblePosition({ lineNumber: Number(banner.dataset.line), column: 1 });
  if (!pos) return false;
  const b = banner.getBoundingClientRect(), ed = e.getDomNode().getBoundingClientRect();
  const list = win.document.querySelector("#file-list").getBoundingClientRect();
  const header = card.querySelector(".prototype-file-heading").getBoundingClientRect();
  const f = frame.getBoundingClientRect(), panel = document.querySelector("#diff-panel").getBoundingClientRect();
  const toolbar = document.querySelector(".diff-toolbar")?.getBoundingClientRect();
  const top = Math.max(list.top, ed.top, header.bottom, 0, panel.top - f.top, (toolbar?.bottom ?? panel.top) - f.top);
  const bottom = Math.min(list.bottom, ed.bottom, win.innerHeight, panel.bottom - f.top, innerHeight - f.top);
  return b.top >= top - 1 && b.bottom <= bottom + 1 && ed.top + pos.top >= b.bottom && ed.top + pos.top + pos.height <= bottom + 1;
}
try {
  await page.goto(url);
  await page.waitForFunction(() => window.diffCompassIntegration?.child);
  await page.evaluate(async token => {
    for (let i = 0; i < 3; i++) await fetch("/api/tour/navigate", { method: "POST", headers: { "x-diffcompass-token": token, "content-type": "application/json" }, body: JSON.stringify({ direction: "previous" }) });
  }, new URL(url).hash.slice(7));
  await page.reload();
  await page.waitForFunction(() => window.diffCompassIntegration?.child);
  const frame = page.frames().find(frame => frame.url().includes("embedded=1"));
  const scrollAway = async () => {
    await frame.evaluate(() => {
      const view = diffLab.views.get("src/cart.ts");
      view.editors.new.setScrollTop(10000, monaco.editor.ScrollType.Immediate);
      const list = document.querySelector("#file-list"); list.scrollTop = list.scrollHeight;
    });
    await page.evaluate(() => { const panel = document.querySelector("#diff-panel"); panel.scrollTop = panel.scrollHeight; });
  };
  for (const layout of ["unified", "split"]) {
    await page.locator(`[data-diff-layout="${layout}"]`).click();
    await frame.waitForFunction(layout => document.querySelector("#layout").value === layout, layout);
    await scrollAway();
    await page.locator("#next-step").click();
    await page.waitForFunction(visibleStop, "apply-discount", { timeout: 4000 });
    check(await frame.evaluate(() => diffLab.views.get("src/cart.ts").editors.new.getSelection().isEmpty()), "Tour navigation does not manufacture a code selection");
    await scrollAway();
    await page.locator("#previous-step").click();
    await page.waitForFunction(visibleStop, "extract-subtotal", { timeout: 4000 });
    console.log("PASS", layout, "Previous/Next reveal banner and target code across all scroll containers");
  }
  // A previously collapsed file should reopen when it becomes the target.
  await page.locator("#next-step").click();
  await page.waitForFunction(visibleStop, "apply-discount");
  await frame.locator('[data-file-toggle="src/cart.ts"]').click();
  await page.locator("#next-step").click();
  await page.waitForFunction(visibleStop, "format-receipt");
  await page.locator("#previous-step").click();
  await page.waitForFunction(visibleStop, "apply-discount");
  check(await frame.locator('[data-file-toggle="src/cart.ts"]').getAttribute("aria-expanded") === "true", "Tour target reopens independently");
  console.log("PASS phase/file navigation reopens and reveals the target");
  // A visible banner can arrive before the native smooth scroll has settled.
  // Test background sync separately from that intentional navigation motion.
  await page.waitForTimeout(700);
  await scrollAway();
  const before = await frame.locator("#file-list").evaluate(node => node.scrollTop);
  await page.evaluate(() => { diffCompassIntegration.sync(); diffCompassIntegration.sync(); });
  await page.waitForTimeout(300);
  check(Math.abs(await frame.locator("#file-list").evaluate(node => node.scrollTop) - before) < 1, "Background sync does not force scrolling back to the stop");
  await page.locator("#current-step-return").click();
  await page.waitForFunction(visibleStop, "apply-discount");
  console.log("PASS background sync preserves scroll and Return to current stop reveals it");
  await page.screenshot({ path: "/tmp/dc-tour-scroll.png" });
  check(!errors.length, "No page errors: " + JSON.stringify(errors));
} catch (error) { console.error(error.stack); console.error(errors); process.exitCode = 1; }
finally { await browser.close(); }
