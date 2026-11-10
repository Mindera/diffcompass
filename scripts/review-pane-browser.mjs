// Review-sidebar tabs and comment confirmation against a disposable PR fixture.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const [playwrightPath, url, repository] = process.argv.slice(2);
assert.match(repository, /diffcompass-monaco-production-[^/]+\/fixture\/repository$/);
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce', colorScheme: 'dark' });
page.setDefaultTimeout(20000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('dialog', dialog => { errors.push(`Unexpected native dialog: ${dialog.message()}`); void dialog.dismiss(); });
const headers = { 'x-diffcompass-token': new URL(url).hash.slice(7) };
const snapshot = async () => (await page.request.get(new URL('/api/session', url).href, { headers })).json();
const tabs = page.getByRole('tablist', { name: 'Review sections' });
const tab = name => tabs.getByRole('tab', { name: new RegExp(`^${name}`) });
async function active(name) {
  assert.equal(await tab(name).getAttribute('aria-selected'), 'true');
  for (const [label, id] of [['Tour', 'agent-tour-pane'], ['Questions', 'questions-pane'], ['Comments', 'comment-drawer']]) {
    assert.equal(await page.locator(`#${id}`).isVisible(), label === name, `Only ${name} occupies the sidebar`);
  }
}
try {
  await page.goto(url);
  await page.locator('#diff-renderer:enabled').waitFor({ state: 'attached' });
  const initial = await snapshot();
  await active('Tour');
  await page.locator('#tour-scroll').evaluate(node => { node.scrollTop = 90; });
  const scroll = await page.locator('#tour-scroll').evaluate(node => node.scrollTop);
  await tab('Questions').click(); await active('Questions');
  await page.locator('#chat-input').fill('Keep this question draft');
  await tab('Comments').click(); await active('Comments');
  assert.equal(await page.locator('#comments-tab-count').textContent(), String(initial.comments.length));
  await page.locator('#comment-stop').click();
  await page.locator('#step-comment-input').fill('Keep this stop comment draft');
  await tab('Tour').click(); await active('Tour');
  assert.equal(await page.locator('#tour-scroll').evaluate(node => node.scrollTop), scroll);
  await tab('Tour').press('ArrowRight'); await active('Questions');
  assert.equal(await page.locator('#chat-input').inputValue(), 'Keep this question draft');
  await tab('Questions').press('End'); await active('Comments');
  assert.equal(await page.locator('#step-comment-input').inputValue(), 'Keep this stop comment draft');
  assert.equal((await snapshot()).currentStepIndex, initial.currentStepIndex);
  await tab('Tour').click(); await page.locator('#next-step').click();
  await page.waitForFunction(() => document.querySelector('#step-count').textContent.includes('(Step 2)') && !document.querySelector('#next-step').disabled);
  await tab('Comments').click();
  const originalStep = initial.outline.phases.flatMap(phase => phase.steps)[initial.currentStepIndex];
  assert.match(await page.locator('#step-comment-draft-scope').textContent(), new RegExp(originalStep.title));
  await page.locator('#step-comment-form').getByRole('button', { name: 'Add stop comment', exact: true }).click();
  await page.locator('#step-comment-form').waitFor({ state: 'hidden' });
  const saved = (await snapshot()).comments.find(comment => comment.body === 'Keep this stop comment draft');
  assert.equal(saved?.stepId, originalStep.id, 'A draft remains attached to its original stop after navigation');
  initial.comments.push(saved);
  await tab('Tour').click(); await page.locator('#previous-step').click();
  await page.waitForFunction(() => document.querySelector('#step-count').textContent.includes('(Step 1)') && !document.querySelector('#next-step').disabled);
  console.log('PASS sidebar: separate panels, keyboard tabs, counts, drafts, scroll and tour progress retained');

  const path = 'src/cart.ts';
  await page.locator('#diff-renderer').selectOption('monaco');
  await page.evaluate(path => diffCompassProductionHost.reveal(path, 'new', 17), path);
  await page.waitForFunction(path => [...document.querySelectorAll('.monaco-review-frame')].some(node => node.dataset.monacoPath === path && node.contentWindow?.diffLab?.views.has(path)), path);
  const frame = page.frames().find(frame => new URL(frame.url(), url).searchParams.get('file') === path);
  let referenceRequest;
  await page.route('**/api/symbol-peek', async route => {
    referenceRequest = route.request().postDataJSON();
    await route.fulfill({ json: { symbol: referenceRequest.symbol, source: 'language-server', sourceLabel: 'Language server', definitions: [], usages: [], notice: 'Fixture reference response', truncated: false } });
  });
  await frame.evaluate(path => {
    const editor = diffLab.views.get(path).editors.new;
    editor.setPosition({ lineNumber: 10, column: 18 });
    editor.getAction('diff-lab.new.peek').run();
  }, path);
  await page.locator('#symbol-peek-status').filter({ hasText: 'Fixture reference response' }).waitFor();
  assert.deepEqual(referenceRequest, { symbol: 'subtotal', path, line: 10, column: 18, side: 'new' });
  await page.locator('#symbol-peek-close').click();
  await frame.evaluate(path => {
    const editor = diffLab.views.get(path).editors.new;
    editor.setPosition({ lineNumber: 17, column: 3 });
    editor.getAction('diff-lab.new.ask').run();
  }, path);
  await active('Questions');
  assert.equal(await page.locator('#chat-input').inputValue(), 'Keep this question draft');
  const entry = initial.comments.find(comment => comment.path === path && !comment.suggestion);
  assert.ok(entry);
  const card = frame.locator(`[data-comment-id="${entry.id}"]`);
  const requestDelete = () => card.getByRole('button', { name: 'Delete', exact: true }).click();
  let deletes = 0;
  page.on('request', request => { if (request.method() === 'DELETE' && new URL(request.url()).pathname === `/api/comments/${entry.id}`) deletes++; });
  await requestDelete();
  await card.locator('[data-comment-delete-confirmation]').waitFor();
  await card.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(deletes, 0);
  await requestDelete();
  await card.getByRole('button', { name: 'Cancel', exact: true }).press('Escape');
  assert.equal(deletes, 0);
  await requestDelete();
  await page.route(`**/api/comments/${entry.id}`, route => route.request().method() === 'DELETE'
    ? route.fulfill({ status: 500, json: { error: 'Test deletion failure' } }) : route.continue(), { times: 1 });
  await requestDelete();
  await frame.locator('#status').filter({ hasText: 'Test deletion failure' }).waitFor();
  assert.equal((await snapshot()).comments.some(comment => comment.id === entry.id), true);
  assert.equal(await card.getByRole('button', { name: 'Delete', exact: true }).isEnabled(), true);
  await requestDelete();
  await card.waitFor({ state: 'detached' });
  assert.equal(deletes, 2, 'Only confirmed deletion and its explicit retry reach the API');
  await page.waitForFunction(count => document.querySelector('#comments-tab-count').textContent === String(count), initial.comments.length - 1);
  console.log('PASS Monaco: exact reference position; styled inline deletion, Cancel/Escape, failure recovery and confirmed deletion');

  for (const width of [1600, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const name of ['Tour', 'Questions', 'Comments']) {
      await tab(name).click(); await active(name);
      const pane = page.locator(`#${await tab(name).getAttribute('aria-controls')}`);
      assert.ok((await pane.boundingBox()).height > 350, `${name} has room at ${width}px`);
      await page.locator('#agent-panel').screenshot({ path: `/tmp/diffcompass-review-${name.toLowerCase()}-${width}.png` });
    }
  }
  assert.deepEqual(errors, []);
  console.log('PASS desktop/mobile sidebar layout and clean browser console');
} finally {
  try { await page.unrouteAll({ behavior: 'wait' }); } finally { await browser.close(); }
}
