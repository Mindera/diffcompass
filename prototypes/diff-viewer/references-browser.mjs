// Read-only data checks on a DISPOSABLE full-product fixture; changes view state only.
// node references-browser.mjs /absolute/playwright/index.mjs 'http://127.0.0.1:PORT/#token=TOKEN'
import { pathToFileURL } from "node:url";
const [playwrightPath, url] = process.argv.slice(2);
if (!playwrightPath || !url) throw Error("Supply installed Playwright and a disposable full-fixture URL.");
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1800, height: 1100 }, colorScheme: "dark" });
const errors = []; page.on("pageerror", error => errors.push(error.stack)); page.setDefaultTimeout(15000);
const check = (value, message) => { if (!value) throw Error(message); };
const pass = message => console.log("PASS", message);
try {
  await page.goto(url); await page.waitForFunction(() => window.diffCompassIntegration?.child);
  const frame = page.frames().find(frame => frame.url().includes("embedded=1"));
  const panel = page.locator("#symbol-peek-panel"), status = page.locator("#symbol-peek-status");
  const search = (symbol, side = "new") => page.evaluate(({ symbol, side }) => diffCompassMonacoHost.peek(symbol, "src/cart.ts", side === "old" ? 6 : 14, side), { symbol, side });
  await page.evaluate(() => diffCompassMonacoHost.show("src/cart.ts"));
  await frame.evaluate(async () => {
    diffLab.reveal("new", 15); diffLab.editors.new.setPosition({ lineNumber: 15, column: 20 });
    diffLab.editors.new.focus(); await monaco.languages.typescript.getTypeScriptWorker();
  });
  check(await frame.evaluate(() => !monaco.languages.typescript.typescriptDefaults.modeConfiguration.references && monaco.languages.typescript.typescriptDefaults.modeConfiguration.definitions), "Native definitions kept; references provider disabled");
  await frame.evaluate(() => diffLab.editors.new.trigger("test", "editor.action.showContextMenu", {}));
  await frame.getByRole("menuitem", { name: /Find references/ }).waitFor();
  check(await frame.getByRole("menuitem", { name: /Find references/ }).count() === 1, "One reference menu action");
  check(!await frame.getByRole("menuitem", { name: /Peek symbol|Go to References|Peek References/ }).count(), "No misleading/duplicate reference actions");
  await page.keyboard.press("Escape");
  await frame.evaluate(() => diffLab.editors.new.trigger("test", "editor.action.peekDefinition", {}));
  await frame.locator(".peekview-widget .view-lines .view-line").first().waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  await frame.locator(".peekview-widget").waitFor({ state: "hidden" });
  await frame.evaluate(() => diffLab.editors.new.trigger("test", "editor.action.revealDefinition", {}));
  await frame.waitForFunction(() => diffLab.editors.new.getPosition().lineNumber === 10);
  pass("One Find references context action; native Go to/Peek Definition still work");
  await frame.evaluate(() => { diffLab.editors.new.setPosition({ lineNumber: 14, column: 18 }); diffLab.editors.new.focus(); });
  await page.keyboard.press("Shift+F12");
  await page.locator('[data-reference-section="usages"]').waitFor();
  check((await status.innerText()).includes("Current workspace"), "Workspace scope");
  check((await status.innerText()).includes("unrelated symbols"), "Real fallback uncertainty");
  check(await page.locator('#symbol-peek-result > :first-child').getAttribute("data-reference-section") === "usages", "Usages first");
  const definitions = page.locator('details[data-reference-section="definitions"]');
  check(!await definitions.evaluate(node => node.open), "Definitions secondary and collapsed");
  await definitions.locator("summary").click();
  check(await definitions.locator(".symbol-peek-location").first().isVisible(), "Definition context still reachable");
  await definitions.locator("summary").click();
  pass("Shift+F12 → real existing resolver, usages first and secondary definitions");
  const location = page.locator('[data-reference-section="usages"] [data-symbol-location="src/receipt.ts"]').first();
  const path = await location.getAttribute("data-symbol-location"), line = await location.getAttribute("data-symbol-line");
  await location.click();
  await page.locator('.source-file .source-code[data-selected-line="' + line + '"]').waitFor();
  check(await page.locator(".source-file").getAttribute("data-path") === path, "Workspace target path");
  check(await page.locator(".source-file .file-stats .muted").innerText() === "Current workspace", "Changed file not falsely labelled unchanged");
  await page.locator("#symbol-peek-panel.symbol-peek-compact").waitFor();
  await panel.click(); await page.waitForFunction(() => !document.querySelector("#symbol-peek-panel").classList.contains("symbol-peek-compact"));
  pass("Result opens exact current workspace source line; compact/expand reused");
  await search("amount"); await search("total");
  await page.locator('[data-symbol-trail-index]').filter({ hasText: "amount" }).last().click();
  await page.waitForFunction(() => document.querySelector("#symbol-peek-title").textContent === "amount" && !document.querySelector("#symbol-peek-status").textContent.startsWith("Searching"));
  check((await page.locator("#symbol-peek-trail").textContent()).includes("Search history"), "History reused");
  pass("Existing search history and re-resolution preserved");

  let mode = "names", delayedRelease, delayedStarted;
  const started = new Promise(resolve => { delayedStarted = resolve; });
  const delayed = new Promise(resolve => { delayedRelease = resolve; });
  await page.route("**/api/symbol-peek", async route => {
    const { symbol } = route.request().postDataJSON();
    if (symbol === "slow") { delayedStarted(); await delayed; }
    if (mode === "error") return route.fulfill({ status: 503, json: { error: "Fixture search failure" } });
    const source = mode === "indexed" ? "codegraph" : mode === "language" ? "language-server" : "repository-search";
    const data = { symbol, source, sourceLabel: source, notice: "Test provider boundary.", truncated: mode === "names",
      definitions: mode === "empty" ? [] : [{ kind: "definition", path: "src/cart.ts", line: 14, excerpt: ["export function total() {}"] }],
      usages: mode === "empty" ? [] : [{ kind: "usage", path: mode === "markdown" ? "docs/checkout-guide.md" : "src/receipt.ts", line: mode === "markdown" ? 14 : 4, excerpt: ["<img src=x onerror=alert(1)>", "total(items)"] }],
      suggestions: mode === "empty" ? [{ symbol: "total", path: "src/cart.ts", line: 14 }] : [] };
    await route.fulfill({ json: data });
  });
  await search("names", "old");
  check((await status.innerText()).includes("not the original revision"), "Before search scope explicit");
  check((await status.innerText()).includes("truncated"), "Truncation visible");
  check((await page.locator('[data-reference-section="usages"]').innerText()).includes("Possible references — name matches"), "Fallback label");
  check(!await panel.locator("img").count(), "Hostile excerpts escaped");
  await page.screenshot({ path: "/tmp/dc-references-panel.png" });
  pass("Before revision warning, truncation and hostile text escaped");
  mode = "indexed"; await search("index");
  check((await page.locator('[data-reference-section="usages"]').innerText()).includes("Indexed reference candidates"), "Index not claimed precise");
  mode = "language"; await search("language");
  check((await page.locator('[data-reference-section="usages"] h3').innerText()) === "References (1)", "Language provider labelled references");
  pass("Indexed candidates versus language-server references");
  mode = "empty"; await search("nothing");
  check((await panel.innerText()).includes("No reference locations returned"), "Empty search not proof of no references");
  mode = "names";
  await page.locator("[data-symbol-suggestion]").click();
  await page.waitForFunction(() => document.querySelector("#symbol-peek-title").textContent === "total");
  mode = "error"; await search("failed");
  check((await status.innerText()).includes("Reference search failed"), "Failed search replaces loading state");
  mode = "names";
  await page.locator("#symbol-peek-form button[type=submit]").click();
  await page.locator('[data-reference-section="usages"]').waitFor();
  pass("Empty/suggestions, failure and retry");
  const slow = search("slow"); await started;
  check((await status.innerText()).startsWith("Searching current workspace"), "Loading status");
  await search("latest"); delayedRelease(); await slow;
  check(await page.locator("#symbol-peek-title").innerText() === "latest", "Late result cannot replace latest search");
  pass("Existing stale-request protection retained");
  mode = "markdown"; await search("total");
  await page.locator('[data-reference-section="usages"] [data-symbol-location]').click();
  await page.locator('.source-file[data-path="docs/checkout-guide.md"] .source-code[data-selected-line="14"]').waitFor();
  check(!await page.locator(".source-file .markdown-preview").count(), "Markdown result opens code, not preview");
  pass("Markdown references open the requested source line");
  await page.locator("#symbol-peek-close").click();
  await panel.waitFor({ state: "hidden" });
  await page.evaluate(() => diffCompassMonacoHost.show("src/cart.ts"));
  await frame.evaluate(async () => { diffLab.reveal("new", 15); await diffLab.editors.new.getAction("diff-lab.new.source").run(); });
  await frame.locator('[data-prototype-file="src/cart.ts"] [data-control="source-pane"]').waitFor({ state: "visible" });
  await frame.evaluate(() => {
    const source = monaco.editor.getEditors().find(editor => editor.getDomNode()?.closest('[data-prototype-file="src/cart.ts"] [data-control="source-editor"]'));
    source.setPosition({ lineNumber: 15, column: 20 }); source.focus();
  });
  await page.keyboard.press("Shift+F12");
  await panel.waitFor({ state: "visible" });
  pass("View source has the same references shortcut");
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.locator("#file-panel-toggle").getAttribute("aria-expanded") === "true") await page.locator("#file-panel-close").click();
  // The existing mobile drawer has its own stacking; close it for panel checks.
  await page.locator("#file-panel-backdrop").waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.querySelector("#file-panel").getBoundingClientRect().right <= 1);
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Narrow panel no horizontal overflow");
  await page.screenshot({ path: "/tmp/dc-references-narrow.png" });
  check(!errors.length, "No page errors: " + errors.join("\n"));
  pass("390px overflow and zero page errors");
} catch (error) {
  console.error(error.stack, errors); await page.screenshot({ path: "/tmp/dc-references-failure.png" }); process.exitCode = 1;
} finally { await browser.close(); }
