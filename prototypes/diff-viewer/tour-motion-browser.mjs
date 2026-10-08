// Disposable full fixture only: changes the saved tour stop, not source code.
import { pathToFileURL } from "node:url";
const [playwrightPath, url] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1800, height: 850 }, reducedMotion: "no-preference", colorScheme: "dark" });
page.setDefaultTimeout(12000);
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const check = (ok, message) => { if (!ok) throw Error(message); };
try {
  await page.goto(url);
  await page.waitForFunction(() => window.diffCompassIntegration?.child);
  await page.evaluate(async token => {
    for (let i = 0; i < 3; i++) await fetch("/api/tour/navigate", { method: "POST", headers: { "x-diffcompass-token": token, "content-type": "application/json" }, body: JSON.stringify({ direction: "previous" }) });
  }, new URL(url).hash.slice(7));
  await page.reload();
  await page.waitForFunction(() => window.diffCompassIntegration?.child);
  const frame = page.frames().find(frame => frame.url().includes("embedded=1"));
  for (const layout of ["unified", "split"]) {
    await page.locator(`[data-diff-layout="${layout}"]`).click();
    await frame.waitForFunction(layout => document.querySelector("#layout").value === layout, layout);
    await page.waitForTimeout(600);
    for (const [button, id] of [["next-step", "apply-discount"], ["previous-step", "extract-subtotal"]]) {
      await frame.evaluate(button => {
        const view = diffLab.views.get("src/cart.ts"), root = view.root;
        view.editors.new.setScrollTop(button === "next-step" ? 0 : 10000, monaco.editor.ScrollType.Immediate);
        const list = document.querySelector("#file-list"); list.scrollTop = list.scrollHeight;
        const nodes = [...root.querySelectorAll(".review-tour-stop,[data-comment-id],.review-pr-thread")];
        window.motionTest = { nodes, model: view.editors.new.getModel(), samples: [], running: true };
        const m = motionTest;
        const sample = () => {
          m.samples.push({ list: list.scrollTop, editor: view.editors.new.getScrollTop(), height: view.editors.new.getContentHeight(), retained: nodes.every(node => node.isConnected), banners: nodes.filter(n => n.matches('.review-tour-stop')).map(n => n.getBoundingClientRect().height) });
          if (m.running) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }, button);
      await page.locator(`#${button}`).click();
      await frame.locator(`[data-tour-stop="${id}"][data-tour-state="current"]`).waitFor();
      await page.waitForTimeout(900);
      const result = await frame.evaluate(() => {
        motionTest.running = false;
        return { samples: motionTest.samples, sameModel: diffLab.views.get("src/cart.ts").editors.new.getModel() === motionTest.model, nodes: motionTest.nodes.length };
      });
      check(result.nodes >= 4 && result.samples.every(sample => sample.retained), "Navigation must retain existing stop banners and comment/PR cards: " + JSON.stringify(result));
      check(result.sameModel, "Navigation retains the editor model");
      check(Math.max(...result.samples.map(s => s.height)) - Math.min(...result.samples.map(s => s.height)) <= 2, "Navigation must not collapse/reinflate unchanged comment and stop zones: " + JSON.stringify(result.samples));
      const intermediate = field => {
        const values = result.samples.map(s => s[field]), first = values[0], last = values.at(-1);
        return new Set(values.filter(value => Math.abs(value - first) > 1 && Math.abs(value - last) > 1).map(value => Math.round(value))).size;
      };
      check(intermediate("list") >= 3, "File-list navigation scrolls through intermediate frames: " + JSON.stringify(result.samples));
      check(intermediate("editor") >= 3, "Monaco navigation scrolls through intermediate frames: " + JSON.stringify(result.samples));
      console.log("PASS", layout, button, "stable annotations/height/model and smooth nested scroll");
    }
  }
  // Reverse direction before the first animation finishes. The later action
  // owns the destination; no delayed reveal may pull us back to the old stop.
  await page.locator("#next-step").click();
  await frame.locator('[data-tour-stop="apply-discount"][data-tour-state="current"]').waitFor();
  await page.locator("#previous-step").click();
  await frame.locator('[data-tour-stop="extract-subtotal"][data-tour-state="current"]').waitFor();
  await page.waitForTimeout(900);
  check(await frame.evaluate(() => {
    const node = document.querySelector('[data-tour-stop="extract-subtotal"][data-tour-state="current"]');
    const bounds = node.getBoundingClientRect(), list = document.querySelector("#file-list").getBoundingClientRect();
    return !node.hidden && bounds.top >= list.top && bounds.bottom <= list.bottom;
  }), "Rapid direction reversal ends at the latest stop");
  console.log("PASS rapid navigation keeps the latest destination");
  await page.screenshot({ path: "/tmp/dc-tour-motion.png" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator("#next-step").click();
  await frame.locator('[data-tour-stop="apply-discount"][data-tour-state="current"]').waitFor();
  check(await frame.evaluate(() => !diffLab.editors.new.getOption(monaco.editor.EditorOption.smoothScrolling)), "Reduced motion disables animated Monaco navigation");
  console.log("PASS reduced-motion preference");
  check(!errors.length, "No page errors: " + JSON.stringify(errors));
} catch (error) { console.error(error.stack); process.exitCode = 1; }
finally { await browser.close(); }
