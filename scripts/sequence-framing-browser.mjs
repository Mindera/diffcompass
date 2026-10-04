// Fresh first-use visual audit, isolated from the interaction test's camera.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const url = process.argv[2];
if (!url) throw new Error('Pass the authenticated fixture URL.');
const dir = process.env.SEQUENCE_SCREENSHOT_DIR || '/tmp';
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const results = [], errors = [];
try {
  for (const [name, width, height] of [['desktop', 1440, 1000], ['narrow', 600, 900]]) {
    for (const mode of ['workspace', 'present']) {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      page.setDefaultTimeout(15_000);
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(url);
      await page.locator('#archify-tab').click();
      await page.locator('#archify-select').selectOption('sequence-checkout-flow');
      const iframe = page.locator('iframe.archify-frame');
      const frame = await (await iframe.elementHandle()).contentFrame();
      await frame.locator('.sequence-step-code').first().waitFor();
      await frame.evaluate(() => document.fonts.ready);
      await iframe.scrollIntoViewIfNeeded();
      await frame.waitForFunction(() => window.Archify?.view?.state?.().mode === 'review');
      if (mode === 'present') {
        await frame.locator('#btn-present').click();
        await frame.waitForFunction(() => window.Archify.presentation.active());
        await page.waitForFunction(() => document.querySelector('iframe.archify-frame').clientWidth >= innerWidth - 2);
      }
      await page.waitForTimeout(250);
      const measure = () => frame.evaluate(() => {
        const diagram = document.querySelector('.diagram-container'), svg = diagram.querySelector('svg'), pane = document.querySelector('.sequence-code-pane');
        const style = getComputedStyle(diagram), camera = Archify.view.state();
        const available = { width: diagram.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight), height: diagram.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) };
        const captions = [...svg.querySelectorAll('text')].filter(t => ['receipt(items, discount)', 'total(items, discount)'].includes(t.textContent));
        return { camera, available, fitScale: Math.min(1, available.width / svg.clientWidth, available.height / svg.clientHeight), diagram: diagram.getBoundingClientRect().toJSON(), code: pane.getBoundingClientRect().toJSON(), codeScrollable: pane.scrollHeight > pane.clientHeight, codeOverflow: getComputedStyle(pane).overflowY, frameWidth: innerWidth, documentWidth: document.documentElement.scrollWidth, viewBox: svg.getAttribute('viewBox'), participants: svg.querySelectorAll('[data-node-id]').length, arrows: svg.querySelectorAll('[data-relationship-id]').length, captionPixels: captions.map(t => parseFloat(getComputedStyle(t).fontSize) * camera.scale) };
      });
      const initial = await measure();
      assert.ok(initial.captionPixels.every(size => size >= 12 - .01));
      assert.equal(initial.codeOverflow, 'auto'); assert.ok(initial.code.height >= 180);
      assert.equal(initial.documentWidth, initial.frameWidth);
      assert.equal(initial.participants, 3); assert.equal(initial.arrows, 4); assert.equal(initial.viewBox, '0 0 920 480');
      assert.ok(initial.diagram.height >= 350);
      if (initial.frameWidth < 1040) assert.ok(initial.code.y >= initial.diagram.bottom - 1);
      else assert.ok(initial.code.x >= initial.diagram.right - 1);
      await iframe.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${dir}/sequence-${name}-${mode}-initial.png` });

      if (mode === 'workspace') {
        await page.locator('#archify-tab').click(); await page.waitForTimeout(100);
        assert.deepEqual((await measure()).camera, initial.camera);
      }
      await frame.locator('[data-diffcompass-action="fit"]').click();
      await page.waitForTimeout(150);
      const overview = await measure();
      if (Math.abs(overview.camera.scale - overview.fitScale) >= .000001) console.log(JSON.stringify({ name, mode, overview, errors }));
      assert.ok(Math.abs(overview.camera.scale - overview.fitScale) < .000001);
      const allInside = await frame.evaluate(() => {
        const box = document.querySelector('.diagram-container').getBoundingClientRect();
        return [...document.querySelectorAll('.diagram-container svg [data-node-id], .diagram-container svg [data-relationship-id]')].every(n => { const r = n.getBoundingClientRect(); return r.left >= box.left && r.right <= box.right && r.top >= box.top && r.bottom <= box.bottom; });
      });
      assert.ok(allInside);
      await page.screenshot({ path: `${dir}/sequence-${name}-${mode}-fit.png` });
      // Keep fresh Fit activation separate from resize camera invariance. The
      // pointer diagnostic records a failed resized-Present case independently;
      // its cause remains unresolved and is not counted as a passing click.
      await page.setViewportSize({ width: width - 20, height });
      await page.waitForTimeout(150);
      assert.deepEqual((await measure()).camera, overview.camera);
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(150);
      assert.deepEqual((await measure()).camera, overview.camera);
      results.push({ name, mode, initial, overview, unchangedCameraAfterResizeAndHostRender: true });
      console.log(`${name} ${mode}: readable initial and explicit overview verified`);
      await context.close();
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(`${dir}/sequence-framing-results.json`, JSON.stringify({ results, errors }, null, 2));
  console.log(JSON.stringify(results.map(r => ({ name: r.name, mode: r.mode, initialScale: r.initial.camera.scale, captionPixels: r.initial.captionPixels, fitScale: r.overview.camera.scale, available: r.overview.available, stacked: r.initial.code.y >= r.initial.diagram.bottom - 1, invariant: r.unchangedCameraAfterResizeAndHostRender })), null, 2));
} finally { await browser.close(); }
