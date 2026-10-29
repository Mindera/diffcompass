// Run against the disposable local scripts/monaco-fixture.ts review.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const [playwrightPath, url] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1800, height: 1100 }, reducedMotion: 'reduce', colorScheme: 'dark' });
page.setDefaultTimeout(20000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const path = 'docs/preview-layout.md';
async function preview(renderer, path) {
  await page.locator(`#file-tree .file-button[data-file="${path}"]`).click();
  if (renderer === 'current') {
    const card = page.locator(`#diff > [data-path="${path}"]`);
    const toggle = card.locator('[data-markdown-preview]');
    if (await toggle.textContent() === 'Preview') await toggle.click();
    await card.locator('.markdown-source-block').first().waitFor();
    return card.locator('.markdown-diff');
  }
  await page.evaluate(path => diffCompassProductionHost.reveal(path, 'new', 1), path);
  await page.waitForFunction(path => [...document.querySelectorAll('.monaco-review-frame')].some(node => node.dataset.monacoPath === path && node.contentWindow?.diffLab?.views.has(path)), path);
  const frame = page.frames().find(frame => new URL(frame.url(), url).searchParams.get('file') === path);
  await frame.locator('[data-control="preview"]').click();
  await frame.locator('[data-control="markdown-preview"]').waitFor();
  return frame.locator('.review-markdown-columns');
}
try {
  await page.route('**/api/update', route => route.fulfill({ json: { updateAvailable: false } }));
  await page.goto(url);
  await page.locator('#step-count').filter({ hasText: 'Step ' }).waitFor({ state: 'attached' });
  if (await page.locator('#tour-mode-toggle').textContent() === 'Exit tour') await page.locator('#tour-mode-toggle').click();
  await page.locator('#review-filter').selectOption('');
  const range = page.locator('#comparison-view');
  assert.equal(await range.isEnabled(), true, 'Comparison menu opens without a checkpoint');
  assert.equal(await range.locator('[value="since-last-review"]').evaluate(option => option.disabled), true);
  assert.match(await range.locator('[value="since-last-review"]').textContent(), /create checkpoint first/);
  await range.focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Escape');
  assert.equal(await range.inputValue(), 'full');
  for (const renderer of ['current', 'monaco']) {
    await page.locator('#diff-renderer').selectOption(renderer);
    await page.locator('[data-diff-layout="split"]').click();
    const content = await preview(renderer, path);
    for (const layout of ['split', 'unified', 'split', 'unified']) {
      await page.locator(`[data-diff-layout="${layout}"]`).click();
      await content.locator('.markdown-source-block').first().waitFor();
      const expected = layout === 'split' ? 2 : 1;
      await page.waitForFunction(({ renderer, path, expected }) => {
        const root = renderer === 'current' ? document.querySelector(`#diff > [data-path="${path}"] .markdown-diff`)
          : [...document.querySelectorAll('.monaco-review-frame')].find(node => node.dataset.monacoPath === path)?.contentDocument.querySelector('.review-markdown-columns');
        return root?.children.length === expected && root.querySelectorAll('h1').length === expected;
      }, { renderer, path, expected });
      assert.equal(await content.locator('h1').count(), expected, 'Unchanged heading appears once per column');
      assert.equal(await content.locator('li.deletion').count(), 1, 'Only the removed item is red');
      assert.equal(await content.locator('li.deletion').textContent(), 'Which workflow it follows. A team that already uses one can keep its practices.');
      assert.equal(await content.locator('li').filter({ hasText: 'Which harness to use.' }).count(), expected, 'Unified keeps unchanged list items once');
      assert.equal(await content.locator('.markdown-source-block.deletion ul').count(), 0, 'Shared list items never inherit a removal background');
      assert.equal(await content.locator('li.addition').count(), 0, 'Retained list items are not additions');
      assert.equal(await content.locator('.markdown-source-block.addition').count(), 1);
      const columns = await content.locator(':scope > section').evaluateAll(nodes => nodes.map(node => ({ x: node.getBoundingClientRect().x, width: node.getBoundingClientRect().width })));
      if (layout === 'split') assert.ok(columns[1].x > columns[0].x + columns[0].width - 2, 'Split is side by side');
      else assert.ok(columns[0].width > 700, 'Unified uses the full content width');
    }
    await page.screenshot({ path: `/tmp/dc-markdown-${renderer}-unified.png` });
    for (const otherPath of ['docs/preview.md', 'docs/emptied.md']) {
      const other = await preview(renderer, otherPath);
      assert.equal(await other.locator(':scope > section').count(), 1, 'Added or empty-sided preview opens directly in Unified');
      if (otherPath === 'docs/preview.md') assert.equal(await other.locator('[data-markdown-side="old"]').count(), 0, 'Added file never invents Before content');
      else assert.equal(await other.locator('.deletion').count(), 1, 'Empty After retains removed Before content');
    }
    console.log(`PASS ${renderer}: live Split/Unified, precise list highlighting, added and emptied Markdown`);
  }
  // The range selector becomes useful once a real checkpoint exists.
  await page.locator('#checkpoint-button').click();
  await page.locator('#checkpoint-label').fill('Markdown preview regression');
  await page.locator('#checkpoint-form button[type="submit"]').click();
  await page.waitForFunction(() => !document.querySelector('#comparison-view [value="since-last-review"]').disabled && !document.querySelector('#comparison-view').disabled);
  await range.selectOption('since-last-review');
  await page.waitForFunction(() => document.getElementById('comparison-label').textContent.includes('since last review') && !document.getElementById('comparison-view').disabled);
  assert.equal(await page.locator('#diff > [data-path]').count(), 0, 'Fresh checkpoint has no subsequent changes');
  await range.selectOption('full');
  await page.locator(`#diff > [data-path="${path}"]`).waitFor({ state: 'attached' });
  assert.deepEqual(errors, []);
  console.log('PASS comparison range explains unavailable checkpoint and switches both ways after saving one');
} catch (error) {
  await page.screenshot({ path: '/tmp/dc-markdown-preview-failure.png' });
  throw error;
} finally { await browser.close(); }
