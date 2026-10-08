// Run only with the fresh DIFF_VIEWER_BEFORE_TOUR fixture. Navigates through
// original/modified stops without changing source files or posting to GitHub.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const [playwrightPath, url] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(20000);
const errors = []; page.on('pageerror', error => errors.push(error.message));
const stops = [
  ['before-removed', 'src/cart.ts', 'old', 6, 6],
  ['before-mixed', 'src/cart.ts', 'old', 6, 8],
  ['before-unchanged', 'src/cart.ts', 'old', 7, 7],
  ['before-context', 'src/context-example.ts', 'old', 50, 52],
  ['before-context-removed', 'src/context-example.ts', 'old', 43, 43],
  ['extract-subtotal', 'src/cart.ts', 'new', 10, 12],
  ['apply-discount', 'src/cart.ts', 'new', 14, 18],
];
async function checkStop(stop, layout) {
  const [id, path, side, start, end] = stop;
  console.log('CHECK',layout,id);
  await page.waitForFunction(({ id, path }) => {
    const frame = [...document.querySelectorAll('.monaco-review-frame')].find(node => node.dataset.monacoPath === path);
    return frame?.contentDocument.querySelector(`.review-tour-stop[data-tour-stop="${id}"][data-tour-state="current"]:not([hidden])`) && !document.querySelector('#next-step').disabled;
  }, { id, path });
  if (layout === 'unified' && side === 'old' && [6, 43].includes(start)) {
    // Annotation overlays follow Monaco's source layout on an animation frame.
    // A fixed sleep races that layout on a busy CI worker.
    await page.waitForFunction(({path,start}) => {
      const doc = [...document.querySelectorAll('.monaco-review-frame')].find(node => node.dataset.monacoPath === path)?.contentDocument;
      const source = doc?.querySelector(`[data-review-old-line="${start}"]`)?.getBoundingClientRect();
      const number = doc?.querySelector(`.review-unified-source-number[data-source-line="${start}"]`)?.getBoundingClientRect();
      return source && number && Math.abs(source.top - number.top) < 1;
    }, {path,start});
  }
  await page.waitForTimeout(250);
  const result = await page.evaluate(({ id, path, side, start, end, layout }) => {
    const frame = [...document.querySelectorAll('.monaco-review-frame')].find(node => node.dataset.monacoPath === path);
    const doc = frame.contentDocument, view = frame.contentWindow.diffLab.views.get(path);
    const banner = doc.querySelector(`.review-tour-stop[data-tour-stop="${id}"]`), b = banner.getBoundingClientRect();
    const bounds = frame.getBoundingClientRect(), toolbar = document.querySelector('.diff-toolbar').getBoundingClientRect();
    const deleted = layout === 'unified' && side === 'old' && [6, 43].includes(start);
    const source = deleted ? doc.querySelector(`[data-review-old-line="${start}"]`)?.getBoundingClientRect() : null;
    const overlaps = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
    const banners = [...doc.querySelectorAll('.review-tour-stop:not([hidden])')];
    const visibleEditors = layout === 'split' ? ['.editor.original', '.editor.modified'] : ['.editor.modified'];
    const sourceRows = visibleEditors.flatMap(selector => [...doc.querySelectorAll(`${selector} .view-line`)].map(row => {
      const rect = row.getBoundingClientRect(), pane = row.closest('.monaco-editor').getBoundingClientRect();
      // Monaco's unwrapped lines can extend beyond their pane's clipping edge.
      return { left: Math.max(rect.left, pane.left), right: Math.min(rect.right, pane.right), top: rect.top, bottom: rect.bottom };
    }));
    return {
      side: banner.dataset.side, line: Number(banner.dataset.line),
      label: banner.textContent, inViewport: bounds.top + b.bottom > toolbar.bottom && bounds.top + b.top < innerHeight,
      aboveSource: !source || b.bottom <= source.top + 1,
      numberAligned: !source || Math.abs(doc.querySelector(`.review-unified-source-number[data-source-line="${start}"]`)?.getBoundingClientRect().top - source.top) < 1,
      deletedLines: [...doc.querySelectorAll('.review-tour-deleted-highlight')].map(node => Number(node.dataset.tourSourceLine)),
      innerScroll: Math.max(...['old', 'new'].map(side => view.editors[side].getScrollHeight() - view.editors[side].getLayoutInfo().height)),
      selection: ['old', 'new'].map(side => view.editors[side].getSelection().isEmpty()),
      legacyFallback: !!document.querySelector(`#diff > .diff-file[data-path="${CSS.escape(path)}"]`),
      currentBanners: banners.filter(node => node.dataset.tourState === 'current').map(node => node.dataset.tourStop),
      overlappingBanners: banners.flatMap((node, index) => banners.slice(index + 1).filter(other => overlaps(node.getBoundingClientRect(), other.getBoundingClientRect())).map(other => [node.dataset.tourStop, other.dataset.tourStop])),
      bannersOverSource: banners.filter(node => sourceRows.some(row => overlaps(node.getBoundingClientRect(), row))).map(node => node.dataset.tourStop),
      sourceColumn: layout !== 'split' || (() => {
        const pane = view.editors[side].getDomNode().getBoundingClientRect();
        return b.left >= pane.left + 5 && b.right <= pane.right - 5;
      })(),
    };
  }, { id, path, side, start, end, layout });
  assert.equal(result.side, side, id + ': source identity'); assert.equal(result.line, start);
  assert.equal(result.legacyFallback, false, id + ': no Shiki fallback');
  assert.equal(result.inViewport, true, id + ': banner scrolled into view');
  assert.equal(result.aboveSource, true, id + ': banner does not cover removed source');
  assert.equal(result.numberAligned, true, id + ': Before number stays beside its rendered source');
  assert.deepEqual(result.currentBanners, [id], id + ': the selected stop has a visible current banner');
  assert.deepEqual(result.overlappingBanners, [], id + ': all stop banners remain independently visible');
  assert.deepEqual(result.bannersOverSource, [], id + ': banners never obscure either revision');
  assert.equal(result.sourceColumn, true, id + ': Split banner stays with its source column');
  assert.ok(result.innerScroll <= 2, id + ': file expands rather than scrolling internally: ' + result.innerScroll);
  assert.deepEqual(result.selection, [true, true], id + ': tour navigation is not a quotation');
  if (layout === 'unified' && id === 'before-mixed') assert.deepEqual([...new Set(result.deletedLines)], [6], 'Only the removed declaration is painted as deleted source');
  if (layout === 'unified' && id === 'before-unchanged') assert.deepEqual(result.deletedLines, [], 'Unchanged Before does not highlight unrelated deleted code');
}
try {
  await page.goto(url);
  await page.locator('#step-count').filter({ hasText: 'Step 1)' }).waitFor();
  await page.locator('#diff-renderer').selectOption('monaco');
  // Renderer opt-in preserves the reading position, not an implicit tour
  // navigation. Explicitly request the current stop before the first check.
  await page.waitForFunction(() => document.querySelector('.monaco-review-frame')?.contentWindow?.diffCompassMonaco);
  await page.evaluate(() => focusCurrentStep());
  for (const layout of ['unified', 'split', 'unified']) {
    await page.locator(`[data-diff-layout="${layout}"]`).click();
    await page.waitForFunction(() => document.getElementById('current-step-return').classList.contains('hidden'));
    for (let index = 0; index < stops.length; index++) {
      if (index) await page.locator('#next-step').click();
      await checkStop(stops[index], layout);
    }
    // Cross a phase boundary in both directions; the destination must retain
    // the correct Monaco render path after the previous editors are disposed.
    await page.locator('#next-step').click();
    await page.locator('#step-count').filter({ hasText: 'Phase 2' }).waitFor();
    await page.locator('#previous-step').click(); await checkStop(stops.at(-1), layout);
    for (let index = stops.length - 2; index >= 0; index--) {
      await page.locator('#previous-step').click(); await checkStop(stops[index], layout);
    }
  }
  await page.setViewportSize({ width: 600, height: 900 });
  await page.locator('[data-diff-wrap="wrap"]').click();
  await checkStop(stops[0], 'unified');
  await page.screenshot({ path: '/tmp/dc-before-tour-unified.png' });
  assert.deepEqual(errors, []);
  console.log('PASS Before/After tour anchors, Unified/Split, wrapped banner placement, context reveal, phase navigation, full-height scrolling, and no renderer fallback');
} catch (error) {
  await page.screenshot({path:'/tmp/dc-before-tour-failure.png'});
  console.error(error.stack); console.error('PAGE_ERRORS',errors); process.exitCode=1;
} finally { await browser.close(); }
