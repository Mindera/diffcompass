// Regression for losing an iframe's draft while paged diffs reload.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
const [playwrightPath, url, repository] = process.argv.slice(2);
assert(/diffcompass-monaco-production-[^/]+\/fixture\/repository$/.test(repository), "Only mutate our disposable fixture");
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({ headless: true, channel: process.env.CI ? undefined : "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
page.setDefaultTimeout(20000);
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const source = join(repository, "src/cart.ts");
const pass = message => console.log(`PASS ${message}`);
async function refresh() {
  const response = page.waitForResponse(response => response.url().endsWith("/api/refresh"));
  await page.locator("#refresh-button").click();
  assert((await response).ok());
}
async function frameForCart() {
  await page.locator('[data-file="src/cart.ts"]').click();
  await page.evaluate(() => diffCompassProductionHost.reveal("src/cart.ts", "new", 17));
  await page.waitForFunction(() => [...document.querySelectorAll(".monaco-review-frame")].some(frame => frame.dataset.monacoPath === "src/cart.ts" && frame.contentWindow?.diffLab?.views.has("src/cart.ts")));
  return page.frames().find(frame => new URL(frame.url(), url).searchParams.get("file") === "src/cart.ts");
}
async function draft(frame, body) {
  await frame.evaluate(() => {
    const view = diffLab.views.get("src/cart.ts");
    window.retainedEditor = view.editors.new; window.retainedModel = view.editors.new.getModel();
    view.editors.new.setPosition({ lineNumber: 17, column: 1 });
    view.editors.new.getAction("diff-lab.new.comment").run();
  });
  const input = frame.getByRole("textbox", { name: "Comment text" });
  await input.fill(body);
  assert(await frame.evaluate(() => diffCompassMonaco.hasDraft()));
  return input;
}
async function retained(frame, input, body) {
  assert(!frame.isDetached(), "refresh must not detach the iframe containing the draft");
  assert.equal(await input.inputValue(), body);
  assert(await frame.evaluate(() => retainedEditor === diffLab.views.get("src/cart.ts").editors.new && retainedModel === retainedEditor.getModel()), "retain the original editor and captured source model");
}
try {
  await page.route("**/api/update", route => route.fulfill({ json: { updateAvailable: false } }));
  await page.goto(url); await page.locator("#step-count").filter({ hasText: "Step " }).waitFor();
  await page.locator("#diff-renderer").selectOption("monaco");
  await writeFile(join(repository, "large.ts"), "// paged review context\n".repeat(3000));
  await refresh();
  for (const mode of ["tour", "browse"]) {
    if (mode === "browse") await page.getByRole("button", { name: "Exit tour", exact: true }).click();
    const frame = await frameForCart(), body = `${mode} draft survives delayed and failed diff pages`;
    const input = await draft(frame, body);
    await writeFile(source, await readFile(source, "utf8") + `\n// ${mode} refreshed source\n`);
    let release, blocked = 0;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route("**/api/diff?*", async route => { blocked++; await gate; return new URL(route.request().url()).searchParams.get("path") === "src/cart.ts" ? route.fulfill({ status: 503, json: { error: "Fixture page failure" } }) : route.continue(); });
    try {
      await refresh();
      for (let attempt = 0; !blocked && attempt < 100; attempt++) await page.waitForTimeout(20);
      assert(blocked, "refresh must exercise paged loading");
      await retained(frame, input, body);
    } finally { release(); }
    await page.getByText(/Could not load .*diff/).first().waitFor();
    await retained(frame, input, body);
    await page.locator('[data-file="src/cart.ts"]').click();
    await page.getByText("Fixture page failure", { exact: true }).waitFor();
    await retained(frame, input, body);
    await frame.getByRole("button", { name: "Add comment", exact: true }).click();
    await frame.waitForFunction(() => document.getElementById("status").textContent.includes("previous comparison"));
    await retained(frame, input, body);
    pass(`${mode}: delayed/failed pages preserve draft, editor and old source; stale save is rejected`);
    await page.unroute("**/api/diff?*");
    await frame.getByRole("button", { name: "Cancel", exact: true }).click();
    const fresh = await frameForCart();
    await fresh.waitForFunction(mode => diffLab.views.get("src/cart.ts").editors.new.getValue().includes(`${mode} refreshed source`), mode);
    pass(`${mode}: cancelling releases the retained editor and source retry loads the new comparison`);
  }
  const frame = await frameForCart(), body = "Unchanged source can still save after refresh";
  const input = await draft(frame, body);
  await refresh(); await page.waitForLoadState("networkidle");
  await retained(frame, input, body);
  await frame.getByRole("button", { name: "Add comment", exact: true }).click();
  await input.waitFor({ state: "detached" });
  pass("unchanged-source refresh keeps the draft saveable");
  const removedFrame = await frameForCart(), removedBody = "Draft on a file removed from the comparison";
  const removedInput = await draft(removedFrame, removedBody);
  await writeFile(source, execFileSync("git", ["show", "origin/main:src/cart.ts"], { cwd: repository, encoding: "utf8" }));
  await refresh(); await page.waitForLoadState("networkidle");
  await retained(removedFrame, removedInput, removedBody);
  await removedFrame.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.locator('#diff > [data-path="src/cart.ts"]').waitFor({ state: "detached" });
  pass("a file absent from the refreshed comparison retains its draft until cancellation, then disappears");
  assert.deepEqual(errors, []);
  pass("clean browser console");
} catch (error) {
  await page.screenshot({ path: "/tmp/dc-monaco-paged-draft-failure.png" });
  throw error;
} finally { await browser.close(); }
