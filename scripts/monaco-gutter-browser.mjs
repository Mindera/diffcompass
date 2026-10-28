// Switching layouts must not leave Unified diff colours in Split gutters.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const [playwrightPath, url] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1700, height: 1100 }, colorScheme: 'dark', reducedMotion: 'reduce' });
page.setDefaultTimeout(20000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(url);
  await page.locator('#diff-renderer').selectOption('monaco');
  await page.waitForFunction(() => [...document.querySelectorAll('.monaco-review-frame')].some(node =>
    node.dataset.monacoPath === 'src/cart.ts' && node.contentWindow?.diffLab?.views.get('src/cart.ts')?.diff.getLineChanges()));
  const frame = page.frames().find(frame => new URL(frame.url()).searchParams.get('file') === 'src/cart.ts');
  async function neutralGutters(expectVisibleMarkers = true) {
    await frame.waitForFunction(() => {
      const view = diffLab.views.get('src/cart.ts');
      const margins = Object.values(view.editors).flatMap(editor => [...editor.getDomNode().querySelectorAll(':scope > .overflow-guard > .margin')])
        .filter(node => node.getBoundingClientRect().width && node.getBoundingClientRect().height);
      return margins.length === 2 && margins.every(margin => getComputedStyle(margin).backgroundImage === 'none'
        && [...margin.querySelectorAll('.gutter-insert,.gutter-delete,.inline-deleted-margin-view-zone,.inline-added-margin-view-zone')]
          .every(node => getComputedStyle(node).backgroundColor === 'rgba(0, 0, 0, 0)'));
    });
    // Split gutters settle on the layout click; badges re-measure only after
    // Monaco's next render, which a busy runner can delay past this read.
    if (expectVisibleMarkers) await frame.waitForFunction(() => diffLab.views.get('src/cart.ts').root.querySelector('.review-badge:not([hidden])'))
      .catch(error => { if (error.name !== 'TimeoutError') throw error; });
    const decoration = await frame.evaluate(() => {
      const root = diffLab.views.get('src/cart.ts').root;
      return {
        changedCode: [...root.querySelectorAll('.cdr.line-insert,.cdr.line-delete')].some(node => getComputedStyle(node).backgroundColor !== 'rgba(0, 0, 0, 0)'),
        signs: root.querySelectorAll('.review-diff-sign').length,
        currentStop: root.querySelectorAll('.review-tour-stop[data-tour-state="current"]:not([hidden])').length,
        markers: root.querySelectorAll('.review-badge').length,
        visibleMarkers: root.querySelectorAll('.review-badge:not([hidden])').length,
      };
    });
    assert.ok(decoration.changedCode, 'Changed code retains its diff colours');
    assert.ok(decoration.signs > 0, 'Addition/deletion signs remain available');
    assert.equal(decoration.currentStop, 1, 'The current tour highlight remains available');
    assert.ok(decoration.markers > 0, 'Review markers remain available');
    if (expectVisibleMarkers) assert.ok(decoration.visibleMarkers > 0, 'Onscreen review markers remain visible');
  }
  for (const wrap of ['scroll', 'wrap']) {
    await page.locator(`[data-diff-wrap="${wrap}"]`).click();
    for (const layout of ['split', 'unified', 'split']) {
      await page.locator(`[data-diff-layout="${layout}"]`).click();
      await frame.waitForFunction(layout => document.getElementById('layout').value === layout, layout);
      if (layout === 'split') await neutralGutters();
      else await frame.waitForFunction(() => [...document.querySelectorAll('.editor.original > .monaco-editor > .overflow-guard > .margin')]
        .some(node => node.getBoundingClientRect().height > 0 && getComputedStyle(node).backgroundImage.includes('gradient')));
    }
  }
  await page.setViewportSize({ width: 1250, height: 900 });
  // Wrapping in the narrower pane can put the marked line below the viewport.
  // Offscreen badges are intentionally hidden; their source bindings persist.
  await neutralGutters(false);
  await page.locator('#settings-menu summary').click();
  await page.locator('#theme-select').selectOption('light');
  await frame.locator('html[data-light]').waitFor();
  await neutralGutters(false);
  assert.deepEqual(errors, []);
  console.log('PASS neutral Split gutters after layout changes, wrapping, resizing, and theme changes; code colours and review markers retained');
} catch (error) {
  await page.screenshot({ path: '/tmp/dc-gutter-failure.png' });
  throw error;
} finally { await browser.close(); }
