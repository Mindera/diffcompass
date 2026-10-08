// Start `bun scripts/semantic-diff-fixture.ts`, then run with an installed Playwright:
// PLAYWRIGHT_MODULE=file:///path/to/playwright/index.mjs node scripts/semantic-diff-browser.mjs
// Uses an isolated browser, never the shared MCP browser profile.
import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const fixtureUrl = process.env.SEMANTIC_FIXTURE_URL || "http://127.0.0.1:47633";
const screenshotPrefix = process.env.SEMANTIC_SCREENSHOT_PREFIX || "/tmp/diffcompass-semantic";
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const pass = (value, message) => { assert(value, message); console.log(`PASS ${message}`); };
try {
  await page.goto(fixtureUrl, { waitUntil: "networkidle" });
  pass(await page.getByRole("button", { name: "What changed", exact: true }).count() === 0, "guided tour has no duplicate file summary control");
  await page.getByRole("button", { name: "Exit tour", exact: true }).click();
  await page.locator('[data-file="src/cart.ts"]').click();
  await page.getByRole("button", { name: "Split", exact: true }).click();
  const control = page.locator('[data-semantic-file="src/cart.ts"]');
  await control.focus();
  await page.keyboard.press("Enter");
  const summary = page.locator('[data-semantic-panel="src/cart.ts"]');
  await summary.getByRole("heading", { name: "What changed", exact: true }).waitFor();
  pass((await summary.innerText()).includes("source version was not recorded"), "legacy fixture clearly identifies an unversioned explanation");
  pass(await summary.locator("[data-semantic-primary]").count() === 0, "declaration inventory stays in code details");
  pass(!(await summary.innerText()).includes("total.amount") && !(await summary.innerText()).includes("SHA-256"), "locals and parser bookkeeping are out of the overview");
  await page.getByRole("button", { name: "Resume tour", exact: true }).click();
  pass(await page.locator("[data-semantic-panel], [data-semantic-file]").count() === 0, "resuming a tour removes an already open summary");
  await page.getByRole("button", { name: "Exit tour", exact: true }).click();
  await page.locator('[data-file="src/cart.ts"]').click();
  await summary.getByRole("heading", { name: "What changed", exact: true }).waitFor();
  pass(true, "leaving the tour restores the previously requested summary");
  const details = summary.locator(".semantic-code-details > summary");
  await details.focus(); await page.keyboard.press("Enter");
  await summary.getByText("total.amount", { exact: true }).waitFor({ state: "visible" });
  pass(await summary.getByText("total.amount", { exact: true }).isVisible(), "keyboard reveals all code details");
  await page.keyboard.press("Enter");
  pass(await page.locator(".diff-row").count() > 0, "original diff stays present");
  for (const [label, side] of [["Before", "old"], ["After", "new"]]) {
    if (!(await summary.locator(".semantic-code-details").evaluate((element) => element.open))) await details.click();
    await summary.getByRole("button", { name: new RegExp(`${label}: src/cart.ts:`) }).first().click();
    await page.waitForFunction((side) => document.querySelector(`.diff-row[data-side="${side}"].selected`), side);
    pass(true, `${label} reveals the captured ${side} side`);
  }
  await page.getByRole("button", { name: "Unified", exact: true }).click();
  if (!(await summary.locator(".semantic-code-details").evaluate((element) => element.open))) await details.click();
  await summary.getByRole("button", { name: /Before: src\/cart.ts:/ }).first().click();
  await page.waitForFunction(() => document.querySelector('.diff-row[data-old-line="6"].selected'));
  pass(true, "unified navigation retains old line identity");
  await page.screenshot({ path: `${screenshotPrefix}-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  const narrowToggle = page.locator("#file-panel-toggle");
  if (await narrowToggle.getAttribute("aria-expanded") === "true") await narrowToggle.click();
  await page.waitForTimeout(600);
  await summary.scrollIntoViewIfNeeded();
  const overviewBox = await summary.boundingBox();
  pass(overviewBox && overviewBox.x >= 0 && overviewBox.x + overviewBox.width <= 391, "plain-language overview fits the narrow viewport");
  await page.screenshot({ path: `${screenshotPrefix}-mobile.png` });
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const [path, expected] of [["Sample.kt", "What changed"], ["broken.ts", "Couldn’t read all of this code"], ["unsupported.py", "This file type isn’t supported"]]) {
    await page.locator(`[data-file="${path}"]`).click();
    if (path === "broken.ts") await page.route("**/api/diff/semantic?path=broken.ts", (route) => route.abort());
    await page.locator(`[data-semantic-file="${path}"]`).click();
    const panel = page.locator(`[data-semantic-panel="${path}"]`);
    if (path === "broken.ts") {
      await panel.getByRole("alert").waitFor();
      await page.unroute("**/api/diff/semantic?path=broken.ts");
      await panel.getByRole("button", { name: "Try again", exact: true }).click();
      pass(true, "transport failure exposes an operable retry");
    }
    await panel.getByText(expected, { exact: true }).waitFor();
    pass(true, `${path} shows ${expected}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const fileToggle = page.locator("#file-panel-toggle");
  if (await fileToggle.getAttribute("aria-expanded") === "true") await fileToggle.click();
  await page.waitForTimeout(600); // Allow the existing drawer/resize transition to settle.
  const fallback = page.locator('[data-semantic-panel="unsupported.py"]');
  await fallback.scrollIntoViewIfNeeded();
  const box = await fallback.boundingBox();
  pass(box && box.x >= 0 && box.x + box.width <= 391, "fallback fits the narrow viewport");
  await page.screenshot({ path: `${screenshotPrefix}-fallback-mobile.png` });
  pass(errors.length === 0, `no browser page errors (${errors.join("; ")})`);
} finally {
  await browser.close();
}
