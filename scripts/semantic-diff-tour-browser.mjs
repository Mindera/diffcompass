// Checks the real attached prompt -> saved explanation -> browser/export path using scripted fixture replies.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const url = process.env.TOUR_SYNTAX_URL || "http://127.0.0.1:48768";
const root = process.env.TOUR_SYNTAX_ROOT || "/tmp/diffcompass-tour-syntax-fixture-48768";
const prefix = process.env.TOUR_SYNTAX_ARTIFACTS || "/tmp/diffcompass-tour-syntax";
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const pass = (value, label) => { assert(value, label); console.log(`PASS ${label}`); };
try {
  const redirect = await page.request.get(url, { maxRedirects: 0 });
  const token = new URLSearchParams(new URL(redirect.headers().location, url).hash.slice(1)).get("token");
  const headers = { "x-diffcompass-token": token, origin: url };
  const saved = await (await page.request.get(`${url}/api/session`, { headers })).json();
  for (let index = saved.currentStepIndex; index > 0; index--) {
    const previous = await page.request.post(`${url}/api/tour/navigate`, { headers, data: { direction: "previous" } });
    assert(previous.ok(), await previous.text());
  }
  await page.goto(url, { waitUntil: "networkidle" });
  await page.locator("#step-explanation").getByText(/subtotal.*is a new function/).waitFor();
  pass(await page.locator("[data-semantic-file], [data-semantic-panel]").count() === 0, "tour keeps one explanation surface");
  await page.locator("#next-step").focus(); await page.keyboard.press("Enter");
  await page.locator("#step-explanation").getByText(/total.*now accepts an optional/).waitFor();
  pass((await page.locator("#step-explanation").innerText()).includes("omitting the discount"), "next stop presents the concrete input change and review question");
  pass(await page.locator('.diff-file[data-path="src/cart.ts"] .tour-anchor').count() > 0, "existing captured code highlight remains attached to the stop");
  await page.screenshot({ path: `${prefix}-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  const fileToggle = page.locator("#file-panel-toggle");
  if (await fileToggle.getAttribute("aria-expanded") === "true") await fileToggle.click();
  await page.waitForTimeout(600); // Let the existing responsive drawer transition finish.
  await page.locator("#step-explanation").scrollIntoViewIfNeeded();
  const box = await page.locator("#step-explanation").boundingBox();
  pass(box && box.x >= 0 && box.x + box.width <= 391, "existing explanation layout fits the narrow viewport");
  await page.screenshot({ path: `${prefix}-mobile.png` });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator("#next-step").click();
  await page.locator("#step-explanation").getByText(/new.*receipt.*function/).waitFor();
  await page.locator("#next-step").click();
  await page.locator("#step-explanation").getByText(/README now describes/).waitFor();
  pass(true, "unsupported Markdown retains the normal tour flow");
  const records = (await readFile(`${root}/tour-evidence.jsonl`, "utf8")).trim().split("\n").map(JSON.parse);
  const evidence = records.find((record) => record.step === "apply-discount").evidence;
  pass(evidence.beforeTree && evidence.afterTree && evidence.beforeHash && evidence.afterHash, "attached explanation prompt carries captured source identities");
  pass(evidence.changes.some((change) => change.name === "total" && change.inputs?.added.some((input) => input.name === "discount" && input.optional)), "attached explanation prompt carries parser-derived optional input");
  pass(!evidence.changes.some((change) => ["subtotal", "Discount", "Discount.percentage"].includes(change.name)), "stop prompt excludes unrelated declarations elsewhere in the file");
  pass(records.find((record) => record.step === "document-fixture").evidence.status === "unsupported", "unsupported analysis is explicit in the prompt");
  for (const format of ["markdown", "html"]) {
    const response = await page.request.post(`${url}/api/export?format=${format}`, { headers, data: { prepareMissingSteps: true } });
    assert(response.ok(), await response.text());
    const content = await response.text();
    await writeFile(`${prefix}.${format === "html" ? "html" : "md"}`, content);
    pass(content.includes("omitting the discount") && content.includes("Requests can come from the reviewer or tour preparation"), `${format} exports the prepared explanation and honest cache coverage`);
  }
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#step-explanation").getByText(/README now describes/).waitFor();
  await page.locator("#previous-step").click(); await page.locator("#previous-step").click();
  await page.locator("#step-explanation").getByText(/total.*now accepts an optional/).waitFor();
  pass(true, "reload and previous navigation retain the prepared explanations");
  await page.getByRole("button", { name: "Exit tour", exact: true }).click();
  await page.locator('[data-file="src/cart.ts"]').click();
  await page.locator('[data-semantic-file="src/cart.ts"]').click();
  await page.locator('[data-semantic-panel="src/cart.ts"]').getByText(/now accepts an optional input/).waitFor();
  pass(true, "the optional file summary reuses tour-populated parser results outside the tour");
  pass(errors.length === 0, `no browser page errors (${errors.join(", ")})`);
} finally { await browser.close(); }
