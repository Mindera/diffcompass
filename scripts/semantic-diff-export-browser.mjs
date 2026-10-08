// Run against a fixture from this checkout; leaves all fixture servers running.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const fixture = process.env.SEMANTIC_FIXTURE_URL || "http://127.0.0.1:48765";
const prefix = process.env.SEMANTIC_EXPORT_PREFIX || "/tmp/diffcompass-what-changed-export";
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
const pass = (value, label) => { assert(value, label); console.log(`PASS ${label}`); };
try {
  const redirect = await context.request.get(fixture, { maxRedirects: 0 });
  const token = new URLSearchParams(new URL(redirect.headers().location, fixture).hash.slice(1)).get("token");
  assert(token, "fixture auth redirect");
  const headers = { "x-diffcompass-token": token, origin: fixture };
  for (const path of ["src/cart.ts", "Sample.kt", "broken.ts", "unsupported.py"]) {
    const response = await context.request.get(`${fixture}/api/diff/semantic?${new URLSearchParams({ path })}`, { headers });
    assert(response.ok(), await response.text());
  }
  for (const format of ["markdown", "html"]) {
    const response = await context.request.post(`${fixture}/api/export?format=${format}`, { headers, data: { prepareMissingSteps: false } });
    assert(response.ok(), await response.text());
    const output = await response.text();
    await writeFile(`${prefix}.${format === "markdown" ? "md" : "html"}`, output);
    pass(output.includes("source version was not recorded") && output.includes("All code details (5 items)"), `${format} download contains the legacy explanation notice and complete inventory`);
    pass(output.includes("Requested change summaries: 4 of") && output.includes("not review-wide analysis"), `${format} download discloses requested-only coverage`);
  }
  const requests = [], errors = [];
  await context.route(/^https?:/, (route) => { requests.push(route.request().url()); return route.abort(); });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(pathToFileURL(`${prefix}.html`).href, { waitUntil: "networkidle" });
  const tab = page.getByRole("button", { name: "What changed", exact: true });
  await tab.focus(); await page.keyboard.press("Enter");
  const panel = page.locator('[data-view-panel="changes"]');
  await panel.waitFor({ state: "visible" });
  const cart = panel.getByRole("article", { name: "src/cart.ts", exact: true });
  pass((await cart.innerText()).includes("source version was not recorded"), "offline keyboard navigation reaches the legacy explanation notice");
  pass(!(await cart.innerText()).includes("total.amount") && !(await cart.innerText()).includes("SHA-256"), "offline overview hides local variables and parser bookkeeping");
  pass(await panel.locator("button, a").count() === 0, "offline summary contains no live-app buttons or broken source/licence links");
  const details = cart.locator(".semantic-code-details > summary");
  await details.focus(); await page.keyboard.press("Enter");
  await cart.getByText("total.amount", { exact: true }).waitFor({ state: "visible" });
  pass((await cart.innerText()).includes("Before src/cart.ts:6") && (await cart.innerText()).includes("After src/cart.ts:14"), "offline details retain exact before/after paths and line identities");
  await page.keyboard.press("Enter");
  await cart.locator(".semantic-evidence > summary").focus(); await page.keyboard.press("Enter");
  await cart.getByText(/SHA-256 before:/).waitFor({ state: "visible" });
  pass(true, "offline evidence remains keyboard accessible");
  await page.keyboard.press("Enter");
  pass((await panel.innerText()).includes("Couldn’t read all of this code") && (await panel.innerText()).includes("This file type isn’t supported"), "offline fallback states remain distinct");
  await cart.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${prefix}-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await tab.scrollIntoViewIfNeeded(); await tab.click();
  await cart.scrollIntoViewIfNeeded();
  const box = await cart.boundingBox();
  pass(box && box.x >= 0 && box.x + box.width <= 391, "offline overview fits a narrow viewport");
  await page.screenshot({ path: `${prefix}-mobile.png` });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('[data-view="diff"]').click();
  pass(await page.locator('[data-view-panel="diff"]').isVisible() && !(await panel.isVisible()), "existing exported diff remains reachable");
  pass(requests.length === 0 && errors.length === 0, "offline export needs no network and has no browser errors");
} finally { await browser.close(); }
