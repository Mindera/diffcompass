// Guided reading uses a disposable repository, never the review open on the user's desktop.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
const [playwrightPath, url, repository] = process.argv.slice(2);
assert.match(repository, /diffcompass-monaco-production-[^/]+\/fixture\/repository$/);
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({ channel: process.env.CI ? undefined : "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, reducedMotion: "reduce", colorScheme: "dark" });
page.setDefaultTimeout(25000);
const errors = []; page.on("pageerror", error => errors.push(error.message));
const headers = { "x-diffcompass-token": new URL(url).hash.slice(7) };
const snapshot = async () => (await page.request.get(new URL("/api/session", url).href, { headers })).json();
let stage = "opening the tour";
try {
  await page.goto(url);
  await page.locator("#tour-step-code:enabled").waitFor({ state: "visible" });
  const initial = await snapshot();
  assert.equal(initial.outline.phases[0].steps[0].freshness, "current");
  assert.equal(await page.locator("#step-importance").textContent(), "Key stop");
  assert.equal(await page.locator("#step-detail").getAttribute("open"), null);
  await page.locator("#step-detail summary").click();
  assert.match(await page.locator("#step-detail-body").textContent(), /receipt calls total/);
  assert.match(await page.locator("#step-notes").textContent(), /Source evidence/);
  await page.locator("#tour-coverage summary").click();
  assert.match(await page.locator("#tour-coverage-list").textContent(), /screens\/receipt.png/);
  const firstStepId = initial.outline.phases[0].steps[0].id;
  const tabs = page.getByRole("tablist", { name: "Review sections" });
  await tabs.getByRole("tab", { name: /^Comments/ }).click();
  await page.locator("#comment-stop").click();
  await page.locator("#step-comment-input").fill("Keep this draft while exploring related code");
  await tabs.getByRole("tab", { name: /^Tour/ }).click();
  for (const renderer of ["current", "monaco"]) {
    stage = `${renderer} grouped source`;
    await page.locator("#diff-renderer").selectOption(renderer);
    await page.locator("#tour-step-code").click();
    await page.waitForFunction(() => document.querySelectorAll("#tour-code-groups .tour-code-group").length === 2);
    assert.equal(await page.locator("#diff").isVisible(), false);
    for (const layout of ["split", "unified"]) {
      await page.locator(`[data-diff-layout="${layout}"]`).first().click();
      await page.locator('[data-diff-wrap="wrap"]').first().click();
      await page.waitForFunction(layout => document.querySelector("#tour-code-view").dataset.codeLayout === layout, layout);
      if (renderer === "current") {
        assert.equal(await page.locator("#tour-code-groups .briefing-split-columns").count(), layout === "split" ? 2 : 0);
        assert.match(await page.locator("#tour-code-groups").textContent(), /subtotal/);
      } else {
        await page.waitForFunction(() => [...document.querySelectorAll("#tour-code-groups iframe")].some(frame => frame.contentDocument?.querySelector(".monaco-editor")));
      }
    }
    if (renderer === "monaco" && process.env.TOUR_READING_SCREENSHOT) {
      await page.setViewportSize({ width: 1600, height: 1200 });
      await page.locator("#tour-coverage").evaluate(node => { node.open = false; });
      await page.locator("#step-detail").evaluate(node => { node.open = false; });
      await page.locator("#tour-scroll").evaluate(node => { node.scrollTop = 0; });
      await page.waitForFunction(() => [...document.querySelectorAll("#tour-code-groups iframe")].length === 2 && [...document.querySelectorAll("#tour-code-groups iframe")].every(frame => frame.contentDocument?.querySelector(".monaco-editor")));
      await page.locator("#toast").waitFor({ state: "hidden" });
      await page.screenshot({ path: process.env.TOUR_READING_SCREENSHOT });
      await page.setViewportSize({ width: 1600, height: 1000 });
    }
    stage = `${renderer} full-file inspection`;
    await page.locator('[data-tour-code-file="1"]').last().click();
    await page.locator("#tour-reading-return").waitFor({ state: "visible" });
    assert.equal(await page.locator("#tour-code-view").isVisible(), false);
    assert.equal((await snapshot()).outline.phases[0].steps[0].id, firstStepId);
    assert.equal((await snapshot()).currentStepIndex, initial.currentStepIndex);
    await page.locator("#tour-reading-return").click();
    await page.locator("#tour-code-view").waitFor({ state: "visible" });
    await page.locator("#tour-code-close").click();
  }
  await tabs.getByRole("tab", { name: /^Comments/ }).click();
  assert.equal(await page.locator("#step-comment-input").inputValue(), "Keep this draft while exploring related code");
  await page.locator("#step-comment-form").getByRole("button", { name: "Cancel", exact: true }).click();
  await tabs.getByRole("tab", { name: /^Tour/ }).click();
  stage = "uncovered binary source";
  // Opening uncovered binary changes uses the existing before/after file renderer.
  await page.locator("#tour-coverage").evaluate(node => { node.open = true; });
  await page.locator('#tour-coverage [data-tour-uncovered]').filter({ hasText: "screens/receipt.png" }).click();
  await page.locator("#tour-reading-return").waitFor({ state: "visible" });
  assert.equal((await snapshot()).currentStepIndex, initial.currentStepIndex);
  await page.locator("#tour-reading-return").click();
  stage = "same-phase navigation";
  // Navigation keeps focused groups in sync with the current stop.
  await page.locator("#next-step").click();
  await page.waitForFunction(() => document.querySelector("#step-count").textContent.includes("(Step 2)") && !document.querySelector("#next-step").disabled);
  await page.waitForFunction(() => document.querySelector("#tour-code-title").textContent === document.querySelector("#step-title").textContent);
  stage = "next phase navigation";
  await page.locator("#next-step").click();
  await page.waitForFunction(() => document.querySelector("#step-count").textContent.includes("(Step 3)") && !document.querySelector("#next-step").disabled);
  await page.waitForFunction(() => document.querySelector("#tour-code-title").textContent === document.querySelector("#step-title").textContent);
  assert.equal(await page.locator("#tour-code-groups .tour-code-group").count(), 1);
  assert.equal(await page.locator("#tour-coverage").getAttribute("open"), null);
  await page.locator("#previous-step").click();
  await page.waitForFunction(() => document.querySelector("#step-count").textContent.includes("(Step 2)") && !document.querySelector("#next-step").disabled);
  await page.locator("#previous-step").click();
  await page.waitForFunction(() => document.querySelector("#step-count").textContent.includes("(Step 1)") && !document.querySelector("#next-step").disabled);
  stage = "stale source after refresh";
  // Content replacement at the same line must be visibly stale after refresh.
  const path = join(repository, "src/cart.ts"), original = await readFile(path, "utf8");
  await writeFile(path, original.replace("const amount = subtotal(items);", "const amount = subtotal(items) + 1;"));
  const response = await page.request.post(new URL("/api/refresh", url).href, { headers: { ...headers, origin: new URL(url).origin, "content-type": "application/json" }, data: {} });
  assert.equal(response.status(), 200);
  await page.reload();
  await page.locator("#step-freshness").waitFor({ state: "visible" });
  assert.match(await page.locator("#step-freshness").textContent(), /Out of date/);
  await page.locator("#tour-step-code").click();
  await page.waitForFunction(() => document.querySelector("#tour-code-status").textContent.includes("out of date"));
  assert.equal(await page.locator("#tour-code-groups .tour-code-group").count(), 0);
  await writeFile(path, original);
  assert.deepEqual(errors, []);
  console.log("PASS guided reading: grouped code, both renderers/layouts, evidence, coverage, return navigation and stale source");
} catch (error) {
  console.error(`Guided reading failed during ${stage}`);
  console.error(await page.evaluate(() => ({ step: document.querySelector("#step-count")?.textContent, title: document.querySelector("#tour-code-title")?.textContent, groups: document.querySelectorAll("#tour-code-groups .tour-code-group").length, busy: document.querySelector("#next-step")?.disabled, notice: document.querySelector("#toast")?.textContent })));
  if (process.env.TOUR_READING_FAILURE_SCREENSHOT) await page.screenshot({ path: process.env.TOUR_READING_FAILURE_SCREENSHOT });
  throw error;
} finally { await browser.close(); }
