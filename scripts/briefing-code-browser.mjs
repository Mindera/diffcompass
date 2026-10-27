// Exercise saved snippets through the production reader and both renderers.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const [playwrightPath, url] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(25000);
const errors = []; page.on('pageerror', error => errors.push(error.message));
const reader = page.locator('#briefing-view');
const source = reader.locator('[data-evidence-id="subtotal-body"]');
const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function renderer(value) {
  await page.locator('#diff-tab').click();
  await page.locator('#diff-renderer').selectOption(value);
  await page.locator('#briefing-tab').click();
}
try {
  const headers = { 'x-diffcompass-token': new URLSearchParams(new URL(url).hash.slice(1)).get('token') };
  const snapshot = await (await page.request.get(new URL('/api/session', url).href, { headers })).json();
  const evidence = snapshot.outline.briefing.evidence.find(item => item.id === 'subtotal-body');
  // A long captured line checks actual wrapping and aligned split rows.
  evidence.diff.rows.find(row => row.kind === 'context').content += ' // ' + 'long captured context '.repeat(20);
  await page.route('**/api/session', async route => {
    const current = await (await route.fetch()).json();
    current.outline.briefing = snapshot.outline.briefing;
    await route.fulfill({ json: current });
  });
  await page.goto(url);
  await page.locator('#diff-tab').click();
  await page.locator('[data-diff-layout="unified"]').click();
  await page.locator('#briefing-tab').click();
  await source.locator('code span[style]').first().waitFor();
  assert.equal(await reader.locator('[data-briefing-layout="unified"]').getAttribute('aria-pressed'), 'true');
  assert.equal((await source.textContent()).includes('Before → After'), false);
  await reader.locator('[data-briefing-layout="split"]').click();
  await reader.locator('[data-briefing-wrap="wrap"]').click();
  for (const [side, excluded] of [['old', 'addition'], ['new', 'deletion']]) {
    assert.deepEqual(await source.locator(`[data-diff-side="${side}"] .briefing-line-content`).allTextContents(), evidence.diff.rows.filter(row => row.kind !== 'meta' && row.kind !== excluded).map(row => row.content));
  }
  const columns = await source.locator('.briefing-diff-column').evaluateAll(columns => columns.map(column => ({
    width: column.clientWidth, scroll: column.scrollWidth,
    heights: [...column.children].map(row => row.getBoundingClientRect().height),
  })));
  assert.deepEqual(columns[0].heights, columns[1].heights, 'Wrapped split rows stay aligned');
  assert.ok(columns.every(column => column.scroll <= column.width + 1));
  assert.ok(columns[0].heights.some(height => height > 40), 'The long captured line wraps');
  await page.locator('#diff-tab').click();
  assert.equal(await page.locator('[data-diff-layout="split"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('[data-diff-wrap="wrap"]').getAttribute('aria-pressed'), 'true');
  await page.locator('[data-diff-wrap="scroll"]').click();
  await page.locator('#briefing-tab').click();
  assert.equal(await reader.locator('[data-briefing-wrap="scroll"]').getAttribute('aria-pressed'), 'true');
  assert.ok(await source.locator('.briefing-diff-column').first().evaluate(el => el.scrollWidth > el.clientWidth));
  await page.reload(); await page.locator('#briefing-tab').click();
  assert.equal(await reader.locator('[data-briefing-layout="split"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await reader.locator('[data-briefing-wrap="scroll"]').getAttribute('aria-pressed'), 'true');
  console.log('PASS Shiki: shared layout/wrap preferences, exact sides, aligned wrapped rows, horizontal scrolling');

  let release;
  const loading = new Promise(resolve => { release = resolve; });
  await page.route('**/monaco/briefing.html?*', async route => { await loading; await route.continue(); });
  await renderer('monaco');
  await source.scrollIntoViewIfNeeded();
  await source.locator('.briefing-code-loading').waitFor();
  assert.equal(await source.locator('pre.briefing-diff').isVisible(), false, 'A cold Monaco load never shows Shiki');
  await page.evaluate(() => {
    window.shikiFlashes = [];
    window.watchBriefingCode = true;
    function check() {
      if (!window.watchBriefingCode) return;
      for (const pre of document.querySelectorAll('.briefing-code-slot > pre')) {
        if (!pre.hidden && pre.getClientRects().length) window.shikiFlashes.push(pre.closest('[data-evidence-id]').dataset.evidenceId);
      }
      requestAnimationFrame(check);
    }
    requestAnimationFrame(check);
  });
  await frames(); release();
  const iframe = source.locator('.briefing-code-frame:not([hidden])');
  await iframe.waitFor();
  const originalFrame = await iframe.elementHandle();
  const frame = await originalFrame.contentFrame();
  await frame.locator('.monaco-diff-editor.side-by-side').waitFor();
  await reader.locator('[data-briefing-wrap="wrap"]').click();
  await frame.waitForFunction(() => monaco.editor.getEditors().every(editor => editor.getOption(monaco.editor.EditorOption.wordWrap) === 'on'));
  await reader.locator('[data-briefing-layout="unified"]').click();
  await frame.locator('.monaco-diff-editor:not(.side-by-side)').waitFor();
  assert.ok(await originalFrame.evaluate(el => el.isConnected), 'Changing layout and wrapping reuses the Monaco frame');

  for (let i = 0; i < 3; i++) {
    await page.locator('#diff-panel').evaluate(el => { el.scrollTop = el.scrollHeight; }); await frames();
    await source.scrollIntoViewIfNeeded(); await frames();
  }
  assert.ok(await originalFrame.evaluate(el => el.isConnected), 'Fast reader scroll reversals retain the Monaco frame');
  await page.locator('[data-briefing-section="boundaries"]').click();
  await reader.locator('.briefing-canvas [data-briefing-element="receipt"]').click();
  const paneSource = page.locator('#briefing-inspector [data-evidence-element="receipt"] .briefing-source').first();
  const paneIframe = paneSource.locator('.briefing-code-frame:not([hidden])');
  await paneIframe.waitFor();
  const paneFrame = await paneIframe.elementHandle();
  const paneEditor = await paneFrame.contentFrame();
  await reader.locator('[data-briefing-layout="split"]').click();
  await reader.locator('[data-briefing-wrap="scroll"]').click();
  for (const snippet of [frame, paneEditor]) {
    await snippet.locator('.monaco-diff-editor.side-by-side').first().waitFor();
    await snippet.waitForFunction(() => monaco.editor.getEditors().every(editor => editor.getOption(monaco.editor.EditorOption.wordWrap) === 'off'));
  }
  for (let i = 0; i < 3; i++) {
    await page.locator('#briefing-inspector .briefing-evidence-scroll').evaluate(el => { el.scrollTop = 0; }); await frames();
    await page.locator('#briefing-inspector .briefing-evidence-scroll').evaluate(el => { el.scrollTop = el.scrollHeight; }); await frames();
  }
  assert.ok(await paneFrame.evaluate(el => el.isConnected), 'Fast evidence-pane scroll reversals retain the Monaco frame');
  assert.deepEqual(await page.evaluate(() => window.shikiFlashes), []);
  await page.evaluate(() => { window.watchBriefingCode = false; });
  console.log('PASS Monaco: no Shiki during delayed loading or rapid scrolling in either pane');

  await renderer('current');
  await source.scrollIntoViewIfNeeded();
  await source.locator('pre.briefing-diff').waitFor();
  assert.equal(await reader.locator('.briefing-code-frame').count(), 0);
  // A real loader failure still exposes the saved diff and explains the fallback.
  await page.route('**/vendor/vs/editor/editor.main.js', route => route.request().frame().url().includes('/monaco/briefing.html') ? route.abort() : route.continue());
  await renderer('monaco');
  await source.scrollIntoViewIfNeeded();
  await source.locator('.briefing-code-notice').waitFor();
  await source.locator('pre.briefing-diff').waitFor();
  assert.match(await source.locator('.briefing-code-notice').textContent(), /Monaco is unavailable/);
  assert.deepEqual(errors, []);
  console.log('PASS explicit Shiki selection and reported load-failure fallback');
} finally { await browser.close(); }
