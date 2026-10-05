// Hold initial session delivery to exercise real input during startup/recovery.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: process.env.SEQUENCE_HEADED !== '1' });
const results = [];
try {
  for (const recover of [false, false, true]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(), errors = [];
    page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.stack));
    let release, entered, requests = 0;
    const gate = new Promise(resolve => { release = resolve; }), held = new Promise(resolve => { entered = resolve; });
    await context.route('**/api/session', async route => {
      requests++;
      if (recover && requests === 1) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Simulated startup outage' }) });
      if (requests === (recover ? 2 : 1)) { entered(); await gate; }
      await route.continue();
    });
    try {
      await page.goto(process.argv[2], { waitUntil: 'commit' }); await held;
      const maps = page.locator('#archify-tab'); assert.equal(await maps.isDisabled(), true);
      const box = await maps.boundingBox(); assert.ok(box);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.locator('#diff-tab').focus(); await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(100); assert.deepEqual(errors, []); assert.equal(await maps.isDisabled(), true);
      release(); await page.waitForFunction(() => !document.getElementById('archify-tab').disabled);
      await maps.click(); await page.locator('#archify-select').selectOption('sequence-checkout-flow');
      await page.frameLocator('iframe.archify-frame').locator('.sequence-step-code').first().waitFor();
      assert.equal(await page.locator('#archify-select').isVisible(), true); assert.deepEqual(errors, []);
      results.push({ recover, requests, errors }); console.log(JSON.stringify(results.at(-1)));
    } finally { release(); await context.close(); }
  }
  console.log(JSON.stringify({ results, browser: browser.version(), cwd: process.cwd() }, null, 2));
} finally { await browser.close(); }
