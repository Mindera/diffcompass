// Run against a disposable full-product fixture. Clipboard is mocked locally;
// no review state, preferences or system clipboard are changed.
import { pathToFileURL } from "node:url";
const [playwrightPath, url] = process.argv.slice(2);
if (!playwrightPath || !url) throw Error("Supply Playwright and a disposable full-fixture URL.");
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const check = (ok, message) => { if (!ok) throw Error(message); };
try {
  await page.goto(url);
  await page.waitForFunction(() => window.diffCompassIntegration?.child);
  const frame = page.frames().find(frame => frame.url().includes("embedded=1"));
  await frame.waitForFunction(() => window.diffLab?.views.get("src/cart.ts"));
  await frame.evaluate(() => {
    window.copyFeedbackTest = { fail: false, copies: [] };
    Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, value: async text => {
      if (copyFeedbackTest.fail) throw new DOMException("Test denial", "NotAllowedError");
      copyFeedbackTest.copies.push(text);
    } });
  });
  const controls = path => {
    const card = frame.locator(`[data-prototype-file="${path}"]`);
    return { copy: card.locator('[data-control="copy"]'), feedback: card.locator('[data-control="tool-feedback"]') };
  };
  const first = controls("src/cart.ts"), second = controls("src/context-example.ts");
  const copy = async controls => {
    await controls.copy.click();
    await controls.feedback.getByText("Copied contents", { exact: true }).waitFor();
  };
  await copy(first);
  check(await frame.evaluate(() => copyFeedbackTest.copies.at(-1) === diffLab.file.new), "Still copies the full captured contents");
  await first.feedback.waitFor({ state: "hidden", timeout: 3000 });
  check(await first.feedback.textContent() === "", "Expired feedback is cleared, not just visually hidden");
  check(await frame.locator("#status").textContent() !== "Copied contents", "Success does not linger in the shared footer either");
  console.log("PASS success expires without another interaction");

  await copy(first);
  await page.waitForTimeout(1200);
  await copy(first);
  await page.waitForTimeout(1100);
  check(await first.feedback.isVisible(), "Repeated copy restarts the success timeout");
  await first.feedback.waitFor({ state: "hidden", timeout: 1800 });
  console.log("PASS repeated copy gets a fresh timeout");

  await copy(first);
  await page.waitForTimeout(1000);
  await copy(second);
  await first.feedback.waitFor({ state: "hidden", timeout: 1800 });
  check(await second.feedback.isVisible(), "One file's timeout does not dismiss another file's confirmation");
  check(await frame.locator("#status").textContent() === "Copied contents", "Older success cannot clear a newer shared status");
  await second.feedback.waitFor({ state: "hidden", timeout: 1800 });
  console.log("PASS file-scoped and shared-status ownership");

  await copy(first);
  await frame.evaluate(() => { copyFeedbackTest.fail = true; });
  await first.copy.click();
  await first.feedback.getByText(/Copy failed/).waitFor();
  await page.waitForTimeout(2300);
  check(await first.feedback.isVisible() && /Copy failed/.test(await first.feedback.textContent()), "Failure survives an earlier success timer");
  check(!await first.copy.isDisabled(), "Failure remains retryable");
  await frame.evaluate(() => { copyFeedbackTest.fail = false; });
  await copy(first);
  await first.feedback.waitFor({ state: "hidden", timeout: 3000 });
  console.log("PASS persistent denial and transient successful retry");
  check(!errors.length, "No page errors: " + JSON.stringify(errors));
} catch (error) { console.error(error.stack); process.exitCode = 1; }
finally { await browser.close(); }
