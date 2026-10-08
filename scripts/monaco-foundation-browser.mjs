// Run only against scripts/monaco-fixture.ts: changes disposable review state.
import { pathToFileURL } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
const [playwrightPath, url, repository] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({ channel: process.env.CI ? undefined : "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1800, height: 1000 }, colorScheme: "dark", reducedMotion: "reduce" });
page.setDefaultTimeout(15000);
await page.addInitScript(() => {
  Error.stackTraceLimit = 40;
  const describe = error => ({ message: error?.message, stack: error?.stack, errors: error?.errors?.map(describe) });
  window.addEventListener("error", event => { if (event.error?.errors) console.error("Disposal detail: " + JSON.stringify(describe(event.error))); });
});
const errors = [], violations = [], sources = [], workers = [];
page.on("worker", worker => workers.push(worker.url()));
page.on("pageerror", error => errors.push(error.stack || error.message));
page.on("console", message => { if (message.text().startsWith("Disposal detail:")) console.log(message.text()); if (message.type() === "error" && /Content Security Policy/.test(message.text())) violations.push(message.text().slice(0, 160)); });
page.on("request", request => { if (request.url().includes("/api/diff/sources?")) sources.push(request.url()); });
const check = (ok, description) => { if (!ok) throw Error(description); };
const token = new URL(url).hash.slice(7);
let frame;
async function fileFrame(path, expectModel = true) {
  await page.waitForFunction(({ path, expectModel }) => [...document.querySelectorAll('.monaco-review-frame')].some(node => !node.closest('.monaco-phase-staging') && node.dataset.monacoPath === path && node.contentWindow?.diffLab && (!expectModel || node.contentWindow.diffLab.views.has(path))), { path, expectModel });
  return page.frames().find(frame => new URL(frame.url(), url).searchParams.get("file") === path);
}
const step = () => frame.evaluate(() => diffLab.session.currentStepIndex);
const focusCode = () => frame.evaluate(() => diffLab.views.get("src/cart.ts").editors.new.focus());
async function reset() {
  await page.evaluate(async token => {
    for (let i = 0; i < 4; i++) await fetch("/api/tour/navigate", { method: "POST", headers: { "x-diffcompass-token": token, "content-type": "application/json" }, body: JSON.stringify({ direction: "previous" }) });
  }, token);
}
try {
  await page.route("**/api/update", route => route.fulfill({ json: { updateAvailable: false } }));
  await page.goto(url); await reset(); await page.reload();
  await page.locator('#step-count').filter({hasText:'Step '}).waitFor({state:'attached'});
  check(await page.locator("#diff-renderer").inputValue() === "current", "Current renderer remains the default");
  check(!sources.length && await page.locator(".monaco-review-frame").count() === 0, "No Monaco sources/editors are loaded before opt-in");
  await page.locator("#diff-renderer").selectOption("monaco");
  await page.waitForSelector(".monaco-review-frame");
  frame = page.frames().find(frame => frame.url().includes("production=1"));
  await frame.waitForFunction(() => window.diffLab?.views.get("src/cart.ts")?.diff.getLineChanges()?.length > 0);
  check(await page.locator('#diff .diff-file[data-path="src/cart.ts"]').count() === 0, "No duplicate native text DOM behind Monaco");
  check(sources.length === 1, "Only the visible file is fetched, not the entire manifest: " + sources.length);
  check(await frame.evaluate(() => monaco.editor.getModels().length === 2), "Only the visible Before/After model pair is resident");
  check(await frame.evaluate(() => monaco.editor.getModels().every(model => /inmemory:\/\/review\/[a-f0-9]{64}\//.test(model.uri.toString()))), "Models are revision scoped");
  console.log("PASS production opt-in, immutable model identities, lazy source/model loading, no hidden native DOM");
  check(await frame.locator('.monaco-diff-editor textarea.inputarea[readonly]').count() === 2, "Both diff inputs are DOM-readonly to suppress tablet keyboards");
  check(await frame.locator('.monaco-diff-editor .native-edit-context').count() === 0, "Read-only diff does not attach an editable native EditContext");
  for (const layout of ["split", "unified"]) {
    await page.locator(`[data-diff-layout="${layout}"]`).click();
    await frame.waitForFunction(layout => document.getElementById("layout").value === layout, layout);
    await focusCode(); await page.keyboard.press("j");
    await frame.waitForFunction(() => diffLab.session.currentStepIndex === 1);
    await focusCode(); await page.keyboard.press("k");
    await frame.waitForFunction(() => diffLab.session.currentStepIndex === 0);
    await focusCode(); await page.keyboard.press("Shift+j");
    await frame.evaluate(() => document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "j", repeat: true, bubbles: true })));
    await frame.evaluate(() => document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "j", isComposing: true, bubbles: true })));
    await page.waitForTimeout(150); check(await step() === 0, "Modified/repeated/composing shortcuts must not navigate");
    console.log("PASS J/K with focused read-only code, plus modifier/repeat/IME guards:", layout);
  }
  await focusCode(); await page.keyboard.press("j");
  await frame.waitForFunction(() => diffLab.session.currentStepIndex === 1);
  await focusCode(); await page.keyboard.press("j");
  frame = await fileFrame("src/receipt.ts");
  await frame.waitForFunction(() => diffLab.session.currentStepIndex === 2);
  await frame.evaluate(() => diffLab.views.get("src/receipt.ts").editors.new.focus());
  await page.keyboard.press("k");
  frame = await fileFrame("src/cart.ts");
  await frame.waitForFunction(() => diffLab.session.currentStepIndex === 1);
  await focusCode(); await page.keyboard.press("k");
  await frame.waitForFunction(() => diffLab.session.currentStepIndex === 0);
  console.log("PASS tour navigation across file slots and phases");
  await frame.evaluate(() => {
    const editor = diffLab.views.get("src/cart.ts").editors.new; editor.setPosition({ lineNumber: 17, column: 3 });
    editor.getAction("diff-lab.new.comment").run();
  });
  const input = frame.getByRole("textbox", { name: "Comment text" });
  await input.fill("jk retained draft"); await input.press("j"); await input.press("k");
  check(await step() === 0, "Typing J/K in a comment never navigates");
  await page.locator("#diff-renderer").selectOption("current");
  check(await page.locator("#diff-renderer").inputValue() === "monaco", "Renderer switching cannot discard a draft");
  check((await input.inputValue()).includes("retained draft"), "Draft text is retained");
  console.log("PASS editable-context shortcut guard and draft retention");
  if (repository) {
    check(/diffcompass-monaco-production-[^/]+\/fixture\/repository$/.test(repository), "Refuse to change anything except our disposable fixture repository");
    const sourceFile = join(repository, "src/cart.ts");
    const original = await readFile(sourceFile, "utf8");
    await writeFile(sourceFile, original + "\n// Captured refresh regression\n");
    await page.locator("#refresh-button").click();
    await page.waitForFunction(() => document.querySelector(".monaco-review-notice")?.textContent.includes("Your draft is retained"));
    check((await input.inputValue()).includes("retained draft"), "External comparison refresh preserves draft text");
    await frame.getByRole("button", { name: "Add comment", exact: true }).click();
    await frame.waitForFunction(() => document.getElementById("status").textContent.includes("previous comparison"));
    check(await input.isVisible(), "Stale save fails without closing the draft");
    await frame.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.waitForTimeout(500);
    frame = page.frames().find(frame => frame.url().includes("production=1"));
    await frame.waitForFunction(() => window.diffLab?.views.get("src/cart.ts")?.editors.new.getValue().includes("Captured refresh regression"));
    console.log("PASS source refresh, stale-save rejection, draft recovery and fresh model replacement");
  } else await frame.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.evaluate(() => diffCompassProductionHost.reveal("src/whitespace.py", "new", 2));
  frame = await fileFrame("src/whitespace.py");
  await frame.waitForFunction(() => diffLab.views.get("src/whitespace.py")?.diff.getLineChanges()?.length > 0);
  check(await frame.evaluate(() => diffLab.views.get("src/whitespace.py").diff.getLineChanges().length === 1), "Whitespace-only changes remain visible");
  const ordering = await page.evaluate(async token => {
    const session = await (await fetch('/api/session', { headers: { 'x-diffcompass-token': token } })).json();
    return { expected: session.comparison.files.map(file => file.path), actual: [...document.querySelectorAll('#diff > [data-path]')].map(node => node.dataset.path) };
  }, token);
  check(JSON.stringify(ordering.actual) === JSON.stringify(ordering.expected), "Text, image and unsupported files retain comparison order: " + JSON.stringify(ordering));
  check(ordering.actual.indexOf('screens/receipt.png') > ordering.actual.indexOf('docs/preview.md') && ordering.actual.indexOf('screens/receipt.png') < ordering.actual.indexOf('src/cart.ts'), "PNG stays between its Markdown and TypeScript neighbours");
  check(await frame.evaluate(() => {
    const list = document.getElementById('file-list');
    return list.scrollHeight <= list.clientHeight + 1 && getComputedStyle(list).overflowY === 'visible' && document.documentElement.scrollHeight <= innerHeight + 2;
  }), "Per-file document has no scrolling file list or document scrollbar");
  await page.evaluate(() => diffCompassProductionHost.reveal("src/cart.ts", "new", 17));
  frame = await fileFrame("src/cart.ts");
  await frame.evaluate(() => { const editor = diffLab.views.get('src/cart.ts').editors.new; editor.setScrollTop(editor.getScrollHeight()); });
  const surface = await frame.locator('.editor.modified .monaco-scrollable-element').first().boundingBox();
  const beforeWheel = await page.locator('#diff-panel').evaluate(node => node.scrollTop);
  await page.mouse.move(surface.x + surface.width / 2, Math.min(surface.y + 80, 800));
  await page.mouse.wheel(0, 350);
  await page.waitForFunction(top => document.getElementById('diff-panel').scrollTop > top + 80, beforeWheel);
  console.log("PASS ordered mixed files, no inner file-list scrollbar, wheel over code scrolls the page");
  await page.evaluate(() => diffCompassProductionHost.reveal("src/lazy-11.ts", "new", 81));
  frame = await fileFrame("src/lazy-11.ts");
  await frame.waitForFunction(() => diffLab.views.has("src/lazy-11.ts"));
  await page.waitForTimeout(200);
  const resident = await page.evaluate(() => {
    const frames = [...document.querySelectorAll('.monaco-review-frame')];
    return { models: frames.reduce((sum, frame) => sum + (frame.contentWindow?.monaco?.editor.getModels().length || 0), 0), paths: frames.flatMap(frame => [...(frame.contentWindow?.diffLab?.views.keys() || [])]) };
  });
  check(resident.models <= 12 && !resident.paths.includes("src/cart.ts") && !resident.paths.includes("src/lazy-9.ts"), "Offscreen editors/models are evicted: " + JSON.stringify(resident));
  await page.evaluate(() => diffCompassProductionHost.reveal("large.txt", "new", 1));
  frame = await fileFrame("large.txt", false);
  await frame.getByRole("button", { name: "Use Shiki for this file" }).waitFor();
  check(await frame.evaluate(() => !diffLab.views.has("large.txt")), "Oversized source never creates a model");
  await frame.getByRole("button", { name: "Use Shiki for this file" }).click();
  check(await page.locator('#diff .diff-file[data-path="large.txt"]').count() === 1, "Per-file fallback renders a visible native card");
  await page.locator('#review-filter').selectOption('');
  await page.evaluate(() => diffCompassProductionHost.reveal("src/cart.ts", "new", 17));
  frame = await fileFrame("src/cart.ts");
  await frame.waitForFunction(() => diffLab.views.has("src/cart.ts"));
  await page.locator('.monaco-file-slot[data-path="src/cart.ts"] > header').getByRole('button', {name:'Mark as reviewed',exact:true}).click();
  await page.waitForFunction(() => document.querySelector('.monaco-file-slot[data-path="src/cart.ts"]')?.getBoundingClientRect().height < 80);
  check(await page.locator('#diff > .diff-file[data-path="screens/receipt.png"]').count() === 1, "Reviewing a text file retains the native image card");
  // Collapsed cards release their frame; the parent header remains usable.
  check(await page.locator('.monaco-review-frame[data-monaco-path="src/cart.ts"]').count() === 0, "Collapsed file releases its editor frame");
  await page.locator('.monaco-file-slot[data-path="src/cart.ts"]').evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.locator('.monaco-file-slot[data-path="src/cart.ts"] button').first().click();
  frame = await fileFrame("src/cart.ts");
  await page.locator('.monaco-file-slot[data-path="src/cart.ts"] > header').getByRole('button', {name:'✓ Reviewed',exact:true}).click();
  console.log("PASS reviewed card shrinks to its header and re-expands independently");
  console.log("PASS whitespace correctness, offscreen eviction, lazy navigation and per-file oversize fallback");
  await page.evaluate(() => {
    window.disposedFrames = [...document.querySelectorAll(".monaco-review-frame")].map(node => ({ monaco: node.contentWindow.monaco, views: node.contentWindow.diffLab?.views }));
  });
  await page.locator("#diff-renderer").selectOption("current");
  const remaining = await page.evaluate(() => ({ models: disposedFrames.flatMap(frame => frame.monaco?.editor.getModels().map(model => model.uri.toString()) || []), editors: disposedFrames.reduce((sum, frame) => sum + (frame.monaco?.editor.getEditors().length || 0), 0), paths: disposedFrames.flatMap(frame => [...(frame.views?.keys() || [])]) }));
  check(remaining.models.length === 0 && remaining.paths.length === 0 && remaining.editors === 0, "All editors/models are disposed on renderer unmount: " + JSON.stringify({ remaining, errors }));
  check(await page.locator('#diff .diff-file[data-path="src/cart.ts"]').count() === 1, "Current renderer is restored");
  check(!violations.length, "No CSP violations: " + JSON.stringify(violations));
  check(workers.length > 0, "The production diff uses local web workers");
  check(!errors.length, "No unhandled browser errors: " + JSON.stringify(errors));
  console.log("PASS disposal, current-renderer rollback, local workers/font CSP and clean browser console");
  await page.route("**/api/diff/sources", route => route.fulfill({ status: 503, json: { error: "Source service unavailable (test)" } }));
  await page.locator("#diff-renderer").selectOption("monaco");
  await page.waitForFunction(() => document.querySelector(".monaco-review-notice")?.textContent.includes("Source service unavailable"));
  check(await page.locator(".monaco-review-frame").count() === 0, "Failed startup removes the incomplete frame");
  check(await page.locator('#diff .diff-file[data-path="src/cart.ts"]').count() === 1, "Failed startup restores the native file immediately");
  await page.unroute("**/api/diff/sources");
  await page.locator("#diff-renderer").selectOption("current");
  await page.locator("#diff-renderer").selectOption("monaco");
  await page.waitForFunction(() => document.querySelector(".monaco-review-frame")?.contentWindow?.diffCompassMonaco);
  await page.evaluate(() => diffCompassProductionHost.reveal("src/cart.ts", "new", 17));
  frame = await fileFrame("src/cart.ts");
  await frame.waitForFunction(() => diffLab.views.get("src/cart.ts")?.diff.getLineChanges()?.length > 0);
  check(!errors.length && !violations.length, "Clean recovery after a handled startup failure");
  console.log("PASS startup failure rollback and successful renderer remount");
  await page.screenshot({ path: "/tmp/dc-monaco-foundation.png" });
} catch (error) { await page.screenshot({ path: "/tmp/dc-monaco-foundation-failure.png" }); console.error(error.stack); process.exitCode = 1; }
finally { await browser.close(); }
