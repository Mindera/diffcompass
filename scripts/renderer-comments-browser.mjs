// Shared comment visibility in both renderers, against a disposable PR fixture.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const [playwrightPath, url, repository] = process.argv.slice(2);
assert.match(repository, /diffcompass-monaco-production-[^/]+\/fixture\/repository$/);
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1800, height: 1000 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(20000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const path = 'src/cart.ts';
const local = () => page.locator(`#diff .diff-file[data-path="${path}"] .inline-comment`);
const thread = () => page.locator(`#diff .diff-file[data-path="${path}"] .github-thread-inline`);
const hide = () => page.getByRole('button', { name: 'Hide comments', exact: true });
const show = () => page.getByRole('button', { name: 'Show comments', exact: true });
const reveal = () => page.evaluate(path => diffCompassProductionHost.reveal(path, 'new', 17), path);
try {
  await page.goto(url);
  assert.deepEqual(await page.locator('#diff-renderer option').allTextContents(), ['Shiki', 'Monaco']);
  assert.equal(await page.locator('#diff-renderer').inputValue(), 'current');
  await reveal();
  for (const layout of ['split', 'unified']) {
    await page.locator(`[data-diff-layout="${layout}"]`).click();
    await local().first().waitFor(); await thread().first().waitFor();
    const height = await page.locator(`#diff .diff-file[data-path="${path}"]`).evaluate(node => node.offsetHeight);
    await local().first().evaluate(node => { window.retainedComment = node; });
    await hide().click();
    assert.equal(await show().getAttribute('aria-pressed'), 'false');
    assert.equal(await local().first().isVisible(), false);
    assert.equal(await thread().first().isVisible(), false);
    assert.ok(await page.locator(`#diff .diff-file[data-path="${path}"]`).evaluate(node => node.offsetHeight) < height);
    assert.ok(await page.locator('#diff .diff-row.has-comment .review-dot:not(.hidden)').count() > 0);
    // Re-rendering a diff must not reveal comments behind the user's back.
    await page.locator(`[data-diff-layout="${layout === 'split' ? 'unified' : 'split'}"]`).click();
    assert.equal(await local().first().isVisible(), false);
    assert.equal(await thread().first().isVisible(), false);
    await page.locator(`[data-diff-layout="${layout}"]`).click();
    await local().first().evaluate(node => { window.retainedComment = node; });
    await show().focus(); await page.keyboard.press('Enter');
    await local().first().waitFor(); await thread().first().waitFor();
    assert.equal(await local().first().evaluate(node => node === window.retainedComment), true, 'Toggling does not recreate comment DOM');
    console.log(`PASS Shiki ${layout}: hides local and PR comments without blank lanes; markers retained; keyboard toggle and re-render`);
  }
  // Keep an open Shiki draft intact, including when visibility is toggled.
  await hide().click();
  await page.locator('#diff .line-action[data-inline-comment-id]').first().click();
  const draft = page.locator('#diff .inline-comment-form textarea');
  await draft.fill('Retained Shiki comment draft');
  await hide().click();
  assert.equal(await draft.inputValue(), 'Retained Shiki comment draft');
  assert.equal(await draft.isVisible(), true);
  await page.locator('[data-inline-comment-cancel]').click();
  // Shared preference survives both renderer switches and fresh editor mounts.
  await page.locator('#diff-renderer').selectOption('monaco');
  await reveal();
  const frameFor = async () => {
    await page.waitForFunction(path => [...document.querySelectorAll('.monaco-review-frame')].some(node => node.dataset.monacoPath === path && node.contentWindow?.diffLab?.views.get(path)), path);
    return page.frames().find(frame => new URL(frame.url(), url).searchParams.get('file') === path);
  };
  let frame = await frameFor();
  await show().waitFor();
  assert.equal(await frame.locator('.review-pr-thread').count(), 0);
  await show().click();
  await frame.locator('.review-pr-thread').waitFor();
  await page.locator('#diff-renderer').selectOption('current');
  await local().first().waitFor(); await thread().first().waitFor();
  await hide().click();
  await page.reload();
  await reveal();
  await show().waitFor();
  assert.equal(await local().first().isVisible(), false);
  assert.equal(await thread().first().isVisible(), false);
  // Editing via the gutter makes existing comments visible again.
  await page.locator('#diff .line-action[data-inline-comment-id]').first().click();
  await hide().waitFor();
  await page.locator('[data-inline-comment-cancel]').click();
  await page.locator('#diff-renderer').selectOption('monaco');
  await reveal(); frame = await frameFor();
  await frame.locator('.review-pr-thread').waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS shared visibility across Shiki/Monaco, reload, and opening a comment; native draft retained');
} finally { await browser.close(); }
