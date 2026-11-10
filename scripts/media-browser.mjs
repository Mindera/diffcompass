import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const [playwrightPath, url] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({ channel: process.env.CI ? undefined : "chrome", headless: true });
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const changedCount = 60;
try {
  for (const [curatedCount, includeChanged] of [[2, false], [0, false], [2, true], [0, true]]) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 850 }, reducedMotion: "reduce" });
    const requested = new Set(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/update", route => route.fulfill({ json: { updateAvailable: false } }));
    await page.route("**/api/session", async route => {
      const response = await route.fetch();
      const session = await response.json();
      const image = session.comparison.files.find(file => file.path === "screens/receipt.png");
      assert.ok(image, "Fixture retains a real before/after PNG");
      session.comparison.files.push(...Array.from({ length: changedCount - 1 }, (_, index) => {
        const path = `screens/reference-${index}.png`;
        return { ...image, path, oldPath: path, newPath: path };
      }));
      session.screenshots = Array.from({ length: curatedCount }, (_, index) => ({ id: `qa-${index}`, name: `QA ${index}.png`, mimeType: "image/png", size: png.length, fileName: `qa-${index}.png` }));
      session.mediaIncludeChangedImages = includeChanged;
      await route.fulfill({ json: session });
    });
    await page.route("**/api/screenshots/*", route => route.fulfill({ body: png, contentType: "image/png" }));
    await page.route("**/api/diff/image?*", async route => {
      const request = new URL(route.request().url());
      if (!request.searchParams.get("path").startsWith("screens/reference-")) return route.continue();
      requested.add(`${request.searchParams.get("path")}:${request.searchParams.get("side")}`);
      await route.fulfill({ body: png, contentType: "image/png" });
    });
    try {
      await page.goto(url);
      const expected = curatedCount + (includeChanged ? 2 * changedCount : 0);
      await page.waitForFunction(expected => document.getElementById("screenshots-tab-count").textContent === String(expected), expected);
      await page.waitForTimeout(150);
      assert.equal(requested.size, 0, "A hidden Media tab must not fetch changed images");
      assert.equal(await page.locator("#screenshots-tab").isVisible(), expected > 0);
      if (!expected) {
        const tabs = await page.locator('.tab:not(.hidden)').evaluateAll(nodes => nodes.map(node => node.id));
        assert.ok(!tabs.includes("screenshots-tab"), "Changed PNGs alone must not expose Media by default");
      } else {
        await page.locator("#screenshots-tab").click();
        assert.equal(await page.locator("#screenshots .screenshot-card").count(), expected);
        assert.equal(await page.locator("#screenshots [data-screenshot-id] img").count(), curatedCount);
        if (!includeChanged) {
          assert.equal(requested.size, 0, "Default Media must not fetch screenshot-test references");
          assert.equal(await page.locator("#screenshots .changed-image-media").count(), 0);
        } else {
          const last = page.locator("#screenshots .changed-image-media").last();
          assert.equal(await last.locator("img").count(), 0, "Offscreen cards remain unloaded");
          // Explicit activation also works without observer visibility (e.g. assistive UI).
          await last.locator("button").evaluate(button => button.click());
          await last.locator("img").waitFor({ state: "attached" });
          assert.ok(requested.has("screens/reference-58.png:new"));
          const middle = page.locator("#screenshots .changed-image-media").nth(60);
          assert.equal(await middle.locator("img").count(), 0);
          await middle.scrollIntoViewIfNeeded();
          await middle.locator("img").waitFor({ state: "visible" });
          assert.ok(requested.size < changedCount, `Scrolling must not fetch the entire gallery (${requested.size} requests)`);
        }
      }
      // The original PNG still opens in Changes with both captured versions.
      await page.locator("#diff-tab").click();
      await page.evaluate(() => diffCompassProductionHost.reveal("screens/receipt.png", "new", 1));
      const comparison = page.locator('.diff-file[data-path="screens/receipt.png"] .image-diff');
      await comparison.locator(".old img").waitFor({ state: "visible" });
      await comparison.locator(".new img").waitFor({ state: "visible" });
      assert.deepEqual(errors, []);
      console.log(`PASS Media ${expected}: ${curatedCount} curated files, ${changedCount} changed PNGs, opt-in ${includeChanged}; lazy requests and Changes comparison`);
    } finally {
      await page.unrouteAll({ behavior: "wait" });
      await page.close();
    }
  }
} finally { await browser.close(); }
