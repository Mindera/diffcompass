// Start `bun scripts/semantic-diff-fixture.ts`, then run with an installed Playwright:
// PLAYWRIGHT_MODULE=file:///path/to/playwright/index.mjs node scripts/semantic-diff-browser.mjs
// Uses an isolated browser, never the shared MCP browser profile.
import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const pass = (value, message) => { assert(value, message); console.log(`PASS ${message}`); };
try {
  await page.goto("http://127.0.0.1:47633", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Split", exact: true }).click();
  const control = page.getByRole("button", { name: "Syntax changes", exact: true }).first();
  await control.focus();
  await page.keyboard.press("Enter");
  const summary = page.locator('[data-semantic-panel="src/cart.ts"]');
  await summary.getByText("Parser-backed syntax summary", { exact: true }).waitFor();
  pass((await summary.innerText()).includes("signature changed"), "keyboard opens a TypeScript summary");
  pass(await page.locator(".diff-row").count() > 0, "original diff stays present");
  for (const [label, side] of [["Before", "old"], ["After", "new"]]) {
    await summary.getByRole("button", { name: new RegExp(`${label}: src/cart.ts:`) }).first().click();
    await page.waitForFunction((side) => document.querySelector(`.diff-row[data-side="${side}"].selected`), side);
    pass(true, `${label} reveals the captured ${side} side`);
  }
  await page.getByRole("button", { name: "Unified", exact: true }).click();
  await summary.getByRole("button", { name: /Before: src\/cart.ts:/ }).first().click();
  await page.waitForFunction(() => document.querySelector('.diff-row[data-old-line="6"].selected'));
  pass(true, "unified navigation retains old line identity");
  await page.screenshot({ path: "/tmp/diffcompass-semantic-desktop.png" });
  await page.getByRole("button", { name: "Exit tour", exact: true }).click();
  for (const [path, expected] of [["Sample.kt", "Parser-backed syntax summary"], ["broken.ts", "parse-error"], ["unsupported.py", "unsupported"]]) {
    await page.locator(`[data-file="${path}"]`).click();
    if (path === "broken.ts") await page.route("**/api/diff/semantic?path=broken.ts", (route) => route.abort());
    await page.locator(`[data-semantic-file="${path}"]`).click();
    const panel = page.locator(`[data-semantic-panel="${path}"]`);
    if (path === "broken.ts") {
      await panel.getByRole("alert").waitFor();
      await page.unroute("**/api/diff/semantic?path=broken.ts");
      await panel.getByRole("button", { name: "Retry syntax analysis" }).click();
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
  await page.screenshot({ path: "/tmp/diffcompass-semantic-mobile.png" });
  pass(errors.length === 0, `no browser page errors (${errors.join("; ")})`);
} finally {
  await browser.close();
}
