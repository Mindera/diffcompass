// Manual scrolling after a phase handoff must take precedence over anchoring,
// and evicting editors above the reader must not briefly shorten the page.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const [playwrightPath, url] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1800, height: 1000 }, colorScheme: 'dark', reducedMotion: 'no-preference' });
page.setDefaultTimeout(20000);
const errors = []; page.on('pageerror', error => errors.push(error.message));
async function at(index) {
  await page.waitForFunction(index => document.getElementById('step-count').textContent.includes(`(Step ${index + 1})`) && !document.getElementById('next-step').disabled, index);
  await page.waitForTimeout(1500);
}
async function navigate(direction, index) { await page.locator('#' + direction + '-step').click(); await at(index); }
try {
  await page.goto(url);
  const token = new URL(url).hash.slice(7);
  await page.evaluate(async token => {
    for (let i = 0; i < 4; i++) await fetch('/api/tour/navigate', { method: 'POST', headers: { 'x-diffcompass-token': token, 'content-type': 'application/json' }, body: JSON.stringify({ direction: 'previous' }) });
  }, token);
  await page.reload();
  await page.locator('#step-count').filter({hasText:'Step '}).waitFor({state:'attached'});
  await page.locator('#diff-renderer').selectOption('monaco'); await at(0);
  for (const layout of ['split', 'unified']) {
    await page.setViewportSize({ width: 1800, height: 600 });
    await page.locator(`[data-diff-layout="${layout}"]`).click();
    await navigate('next', 1); await navigate('next', 2); await navigate('previous', 1);
    const handoff = await page.evaluate(async () => {
      const panel = document.getElementById('diff-panel');
      const card = document.querySelector('.monaco-file-slot[data-path="src/context-example.ts"]');
      const before = panel.scrollTop;
      // Compositor/scrollbar/accessibility scrolling need not emit a new
      // wheel event. Emulate delayed content sizing after that scroll.
      panel.scrollTop += 250; const requested = panel.scrollTop;
      await new Promise(requestAnimationFrame);
      card.style.paddingBottom = '24px';
      for (let i = 0; i < 12; i++) await new Promise(requestAnimationFrame);
      const after = panel.scrollTop; card.style.paddingBottom = '';
      return { before, requested, after };
    });
    assert.ok(handoff.requested > handoff.before + 100, 'The scroll moved away from the phase destination');
    assert.ok(Math.abs(handoff.after - handoff.requested) <= 2, `${layout}: late geometry must not snap a manually scrolled page to the stop: ${JSON.stringify(handoff)}`);
    console.log(`PASS ${layout}: scrolling without a fresh wheel event releases the phase anchor`);
    await page.setViewportSize({ width: 1800, height: 1000 });
    await navigate('next', 2); await navigate('next', 3);
    const bounds = await page.locator('#diff-panel').boundingBox();
    await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.6);
    await page.evaluate(() => {
      window.downSamples = []; window.sampleDown = true;
      const sample = () => {
        if (!window.sampleDown) return;
        const panel = document.getElementById('diff-panel');
        window.downSamples.push(panel.scrollTop);
        requestAnimationFrame(sample);
      }; sample();
    });
    for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 150); await page.waitForTimeout(180); }
    await page.waitForTimeout(250);
    const down = await page.evaluate(() => { window.sampleDown = false; return window.downSamples; });
    assert.ok(down.at(-1) > down[0] + 500, 'Wheel over code scrolls down through the mixed file list');
    assert.ok(down.every((top, i) => !i || top >= down[i - 1] - 2), `${layout}: downward wheel input must never reverse: ${JSON.stringify(down)}`);
    assert.equal(await page.locator('.monaco-review-frame[data-monaco-path="docs/checkout-guide.md"]').count(), 0, 'The pass exercises offscreen editor eviction');
    console.log(`PASS ${layout}: downward wheel scrolling through Markdown/image cards never reverses during eviction`);
    await navigate('previous', 2); await navigate('previous', 1); await navigate('previous', 0);
  }
  assert.deepEqual(errors, []);
} catch (error) {
  await page.screenshot({ path: '/tmp/dc-phase-scroll-failure.png' });
  console.error(error.stack); console.error('PAGE_ERRORS', errors); process.exitCode = 1;
} finally { await browser.close(); }
