// Exercise rendered long lines through the production layout/wrap controls.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const [playwrightPath, url] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1700, height: 1100 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(20000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const path = 'docs/wrapping.md';
let frame;
async function reveal() {
  await page.evaluate(path => diffCompassProductionHost.reveal(path, 'new', 6), path);
  await page.waitForFunction(path => [...document.querySelectorAll('.monaco-review-frame')].some(node =>
    node.dataset.monacoPath === path && node.contentWindow?.diffLab?.views.get(path)?.diff.getLineChanges()?.length), path);
  frame = page.frames().find(frame => new URL(frame.url(), url).searchParams.get('file') === path);
}
async function checkWrapping(layout, wrap) {
  await frame.waitForFunction(({ layout, wrap }) => document.getElementById('layout').value === layout
    && document.getElementById('wrap').checked === (wrap === 'wrap'), { layout, wrap });
  const rows = await frame.evaluate(path => {
    const view = diffLab.views.get(path);
    return Object.entries(view.editors).flatMap(([side, editor]) => [5, 6].map(line => ({
      side, line,
      start: editor.getTopForPosition(line, 1),
      end: editor.getTopForPosition(line, editor.getModel().getLineMaxColumn(line)),
      lineHeight: editor.getOption(monaco.editor.EditorOption.lineHeight),
    })));
  }, path);
  for (const row of rows) {
    const wrapped = wrap === 'wrap' && (layout === 'split' || row.side === 'new');
    assert.ok(wrapped ? row.end >= row.start + row.lineHeight : row.end === row.start,
      `${layout}/${wrap}: ${row.side} line ${row.line} ${wrapped ? 'wraps across visual rows' : 'stays on one visual row'}: ${JSON.stringify(row)}`);
  }
}
try {
  await page.route('**/api/update', route => route.fulfill({ json: { updateAvailable: false } }));
  await page.goto(url);
  await page.locator('#diff-renderer').selectOption('monaco');
  await page.waitForFunction(() => !!window.diffCompassProductionHost);
  await reveal();
  for (const wrap of ['wrap', 'scroll', 'wrap']) {
    await page.locator(`[data-diff-wrap="${wrap}"]`).click();
    for (const layout of ['unified', 'split', 'unified', 'split']) {
      await page.locator(`[data-diff-layout="${layout}"]`).click();
      await checkWrapping(layout, wrap);
    }
  }
  for (const width of [1100, 1900]) {
    await page.setViewportSize({ width, height: 1100 });
    await frame.waitForFunction(() => Math.abs(diffLab.views.get('docs/wrapping.md').diff.getContainerDomNode().clientWidth - innerWidth) < 30);
    await checkWrapping('split', 'wrap');
  }
  // A newly mounted editor starts internally in Unified even if the reviewer
  // has already chosen Split; it must clear the same hidden-editor override.
  await page.locator('#diff-renderer').selectOption('current');
  await page.locator('#diff-renderer').selectOption('monaco');
  await reveal();
  await checkWrapping('split', 'wrap');
  await page.screenshot({ path: '/tmp/dc-monaco-wrapping.png' });
  assert.deepEqual(errors, []);
  console.log('PASS Before/After wrapping for unchanged and changed Markdown rows, layout/wrap toggles, resizing, and remounting in Split');
} catch (error) {
  await page.screenshot({ path: '/tmp/dc-monaco-wrapping-failure.png' });
  throw error;
} finally { await browser.close(); }
