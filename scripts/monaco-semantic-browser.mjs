// Uses the existing disposable production fixture and shared summary endpoint.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
const [playwrightPath, url, repository] = process.argv.slice(2);
assert(/diffcompass-monaco-production-[^/]+\/fixture\/repository$/.test(repository), "Only mutate our disposable fixture");
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({ headless: true, channel: process.env.CI ? undefined : "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
page.setDefaultTimeout(20000);
const errors = [], requests = [];
page.on("pageerror", error => errors.push(error.message));
page.on("request", request => { if (request.url().includes("/api/diff/semantic?")) requests.push(request.url()); });
const pass = (value, message) => { assert(value, message); console.log(`PASS ${message}`); };
const card = path => page.locator(`#diff > [data-path="${path}"]`);
const panel = path => card(path).locator("[data-semantic-panel]");
const control = path => card(path).locator("[data-semantic-file]");
async function open(path) {
  await page.locator(`[data-file="${path}"]`).click();
  if (await control(path).getAttribute("aria-expanded") !== "true") await control(path).click();
  await panel(path).locator("h3").first().waitFor();
}
async function details(path) {
  const node = panel(path).locator(".semantic-code-details");
  if (!await node.evaluate(node => node.open)) await node.locator(":scope > summary").click();
}
async function anchor(path, side) {
  await details(path);
  const button = panel(path).locator(`[data-semantic-side="${side}"]`).first();
  const text = await button.getAttribute("aria-label");
  const line = Number(text.match(/:(\d+)$/)[1]);
  await button.click();
  await page.waitForFunction(({ path, side, line }) => {
    const frame = [...document.querySelectorAll(".monaco-review-frame")].find(frame => frame.dataset.monacoPath === path);
    const view = frame?.contentWindow?.diffLab?.views.get(path);
    return view?.editors[side].getSelection().startLineNumber === line && view.editors[side].hasTextFocus();
  }, { path, side, line });
  return text;
}
try {
  await page.route("**/api/update", route => route.fulfill({ json: { updateAvailable: false } }));
  await page.goto(url);
  await page.locator("#step-count").filter({ hasText: "Step " }).waitFor();
  await page.locator("#diff-renderer").selectOption("monaco");
  pass(await page.locator("[data-semantic-file]").count() === 0, "Monaco tour has no duplicate What changed control");
  await page.getByRole("button", { name: "Exit tour", exact: true }).click();
  await page.locator('[data-file="src/cart.ts"]').click();
  await control("src/cart.ts").focus(); await page.keyboard.press("Enter");
  await panel("src/cart.ts").getByRole("heading", { name: "What changed", exact: true }).waitFor();
  pass(await card("src/cart.ts").getAttribute("class") === "monaco-file-slot", "keyboard opens the shared summary in the Monaco file card");
  pass((await panel("src/cart.ts").innerText()).includes("source version was not recorded"), "Monaco retains the explanation provenance notice");
  const initial = requests.length;
  for (const renderer of ["current", "monaco"]) {
    await page.locator("#diff-renderer").selectOption(renderer);
    await panel("src/cart.ts").waitFor();
    pass(await panel("src/cart.ts").count() === 1 && requests.length === initial, `${renderer} reuses the open summary without another request`);
  }
  for (const layout of ["split", "unified"]) {
    await page.locator(`[data-diff-layout="${layout}"]`).click();
    await page.waitForLoadState("networkidle");
    for (const side of ["old", "new"]) await anchor("src/cart.ts", side);
    pass(true, `${layout} Before/After links focus the matching captured Monaco side`);
  }
  await card("src/cart.ts").getByRole("button", { name: "Collapse src/cart.ts", exact: true }).click();
  pass(!await panel("src/cart.ts").isVisible(), "collapsing a Monaco file also hides its summary");
  await card("src/cart.ts").getByRole("button", { name: "Expand src/cart.ts", exact: true }).click();
  await panel("src/cart.ts").waitFor();
  await page.getByRole("button", { name: "Resume tour", exact: true }).click();
  pass(await page.locator("[data-semantic-panel], [data-semantic-file]").count() === 0, "resuming the Monaco tour removes panels and controls");
  await page.getByRole("button", { name: "Exit tour", exact: true }).click();
  await open("src/cart.ts");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const drawer = page.locator("#file-panel-toggle");
    if (width === 390 && await drawer.getAttribute("aria-expanded") === "true") await drawer.click();
    await panel("src/cart.ts").scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    for (const node of [panel("src/cart.ts"), control("src/cart.ts")]) {
      const box = await node.boundingBox();
      pass(box && box.x >= 0 && box.x + box.width <= width + 1, `Monaco summary and control fit ${width}px`);
    }
    await page.screenshot({ path: `/tmp/dc-monaco-what-changed-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await writeFile(join(repository, "Sample.kt"), "class Sample {\n val count = 1\n fun total(x: Int): Int = x + count\n}\n");
  await writeFile(join(repository, "broken.ts"), "function invalid( {\n");
  await writeFile(join(repository, "large.ts"), "//" + "x".repeat(256001) + "\n");
  await writeFile(join(repository, "sample.generated.ts"), "export const generatedValue = 1;\n");
  await rename(join(repository, "src/lazy-0.ts"), join(repository, "src/renamed.ts"));
  // Working-tree reviews intentionally keep untracked additions separate.
  // Stage this fixture rename so Git can include both paths in rename detection.
  execFileSync("git", ["add", "-A", "--", "src/lazy-0.ts", "src/renamed.ts"], { cwd: repository });
  await unlink(join(repository, "src/lazy-1.ts"));
  await page.locator("#refresh-button").click();
  await page.locator('[data-file="Sample.kt"]').waitFor();
  pass(await page.locator("[data-semantic-panel]").count() === 0, "comparison refresh invalidates open summaries");
  for (const [path, text] of [["Sample.kt", "What changed"], ["broken.ts", "Couldn’t read all of this code"], ["src/whitespace.py", "This file type isn’t supported"], ["large.txt", "This file type isn’t supported"], ["large.ts", "This file exceeds the summary limits"], ["sample.generated.ts", "Generated code — summary skipped"]]) {
    if (path === "broken.ts") await page.route("**/api/diff/semantic?path=broken.ts", route => route.abort());
    await page.locator(`[data-file="${path}"]`).click();
    await control(path).click();
    if (path === "broken.ts") {
      await panel(path).getByRole("alert").waitFor();
      await page.unroute("**/api/diff/semantic?path=broken.ts");
      await panel(path).getByRole("button", { name: "Try again", exact: true }).click();
      pass(true, "Monaco transport error can recover through Try again");
    }
    await panel(path).getByText(text, { exact: false }).first().waitFor();
    pass(true, `${path}: shared summary fallback remains reachable`);
  }
  for (const [path, side] of [["src/receipt.ts", "new"], ["src/lazy-1.ts", "old"], ["src/renamed.ts", "old"], ["src/renamed.ts", "new"]]) {
    await open(path);
    const sourceLabel = await anchor(path, side);
    if (path === "src/renamed.ts" && side === "old") assert(sourceLabel.includes("src/lazy-0.ts"));
    pass(true, `${path}: ${side} link preserves added/deleted/renamed source identity`);
  }
  // Requesting a summary must populate the existing export cache, independent
  // of the chosen renderer. It must not claim review-wide parser coverage.
  const token = new URL(url).hash.slice(7);
  const exported = await page.request.post(new URL("/api/export?format=markdown", url).href, { headers: { "x-diffcompass-token": token, origin: new URL(url).origin }, data: { prepareMissingSteps: false } });
  assert(exported.ok(), await exported.text());
  const markdown = await exported.text();
  pass(markdown.includes("Requested change summaries:") && markdown.includes("not review-wide analysis") && markdown.includes("Sample.kt"), "Monaco requests feed the existing coverage-labelled exports");
  await open("src/cart.ts"); await anchor("src/cart.ts", "new");
  const frame = page.frames().find(frame => new URL(frame.url(), url).searchParams.get("file") === "src/cart.ts");
  await frame.evaluate(() => diffLab.views.get("src/cart.ts").editors.new.getAction("diff-lab.new.comment").run());
  const draft = frame.getByRole("textbox", { name: "Comment text" });
  await draft.fill("Keep this draft with the captured version");
  const cartSource = join(repository, "src/cart.ts");
  await writeFile(cartSource, "// newly captured context\n".repeat(20) + await readFile(cartSource, "utf8"));
  await page.locator("#refresh-button").click();
  await page.waitForFunction(() => document.querySelector(".monaco-review-notice")?.textContent.includes("Your draft is retained"));
  await control("src/cart.ts").click();
  await panel("src/cart.ts").locator("h3").first().waitFor();
  await details("src/cart.ts");
  await panel("src/cart.ts").locator('[data-semantic-side="new"]').first().click();
  await page.getByText("This captured source line could not be opened. Finish any retained draft and try again.", { exact: true }).waitFor();
  pass(await draft.inputValue() === "Keep this draft with the captured version", "new summary coordinates cannot navigate a retained stale editor or discard its draft");
  pass(errors.length === 0, `no browser errors (${errors.join("; ")})`);
} catch (error) {
  console.error(await page.evaluate(() => ({ notice: document.querySelector(".monaco-review-notice")?.textContent, renderer: document.querySelector("#diff-renderer")?.value, toasts: [...document.querySelectorAll(".toast")].map(node => node.textContent) })));
  await page.screenshot({ path: "/tmp/dc-monaco-what-changed-failure.png" });
  throw error;
} finally { await browser.close(); }
