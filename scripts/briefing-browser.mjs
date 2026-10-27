// Run with the isolated production fixture from check-monaco.ts.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const [playwrightPath, url] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(20000);
const errors = []; page.on('pageerror', error => errors.push(error.message));
const currentSection = id => page.waitForFunction(id => document.querySelector('#briefing-outline [aria-current="location"]')?.dataset.briefingSection === id, id);
const readerScroll = () => page.locator('#diff-panel').evaluate(el => el.scrollTop);
async function wheelToSection(id) {
  const delta = await page.locator(`#briefing-section-${id}`).evaluate(el => el.getBoundingClientRect().top - document.getElementById('diff-panel').getBoundingClientRect().top - 24);
  const bounds = await page.locator('#diff-panel').boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 100);
  await page.mouse.wheel(0, delta);
  await currentSection(id);
}
try {
  console.log('CHECK Briefing opening code and scrolling');
  await page.goto(url);
  await page.locator('#diff-tab').click();
  await page.locator('[data-diff-layout="unified"]').click();
  await page.locator('#briefing-tab').click();
  await page.locator('#briefing-view .briefing-canvas svg').waitFor();
  await page.locator('#briefing-view [data-evidence-id="subtotal-body"] code span[style]').first().waitFor();
  await currentSection('intent');
  assert.equal(await page.locator('#briefing-outline [aria-current]').count(), 1);
  assert.equal(await page.locator('#briefing-view h1').textContent(), 'Show the discounted total on the receipt');
  const openingStyle = await page.locator('#briefing-section-intent').evaluate(section => ({
    border: getComputedStyle(section).borderTopWidth,
    background: getComputedStyle(section).backgroundImage,
    leadSize: getComputedStyle(section.querySelector('.briefing-prose p')).fontSize,
    bodySize: getComputedStyle(section.querySelectorAll('.briefing-prose p')[1]).fontSize,
  }));
  assert.equal(openingStyle.border, '2px');
  assert.notEqual(openingStyle.background, 'none');
  assert.ok(parseFloat(openingStyle.leadSize) > parseFloat(openingStyle.bodySize));
  assert.equal(await page.locator('#briefing-view .briefing-excerpt').count(), 3);
  const source = page.locator('#briefing-view [data-evidence-id="subtotal-body"]');
  assert.match(await source.textContent(), /export function subtotal/);
  assert.ok(await source.locator('[data-diff-kind="addition"]').count() > 0);
  assert.ok(await source.locator('[data-diff-kind="deletion"]').count() > 0);
  assert.equal(await page.locator('#briefing-view .briefing-excerpt pre:not(.briefing-diff)').count(), 0);
  const box = await source.boundingBox();
  assert.ok(box.y + box.height < 1000, 'Implementation code appears in the opening viewport');

  // Real wheel input, in both directions, must update the outline independently
  // of clicks. The last short section is selected at the end of the document.
  await wheelToSection('calculation');
  await wheelToSection('boundaries');
  await page.mouse.wheel(0, 10000);
  await currentSection('limits');
  await wheelToSection('calculation');
  await page.locator('[data-briefing-section="intent"]').click();
  await currentSection('intent');

  // Quiet passage controls remain keyboard accessible, without changing layout.
  const askPassage = page.locator('[data-briefing-ask="intent-text"]');
  const beforeFocus = await page.locator('[data-briefing-block="intent-text"]').boundingBox();
  await askPassage.focus();
  assert.equal(await askPassage.evaluate(el => getComputedStyle(el.parentElement).opacity), '1');
  assert.equal((await page.locator('[data-briefing-block="intent-text"]').boundingBox()).height, beforeFocus.height);

  // Inline code is already visible in the story: passive card clicks and asking
  // about it must not replace the inspector with another copy of that code.
  console.log('CHECK Briefing inline code stays in the story and tab restoration');
  const beforeInspect = await readerScroll(), beforePane = await page.locator('#briefing-inspector').textContent();
  await source.locator('.briefing-source-label').click();
  await source.locator('.briefing-diff-summary').click();
  await source.click({ position: { x: 5, y: 5 } });
  assert.equal(await source.locator('[data-briefing-inspect]').count(), 0);
  assert.equal(await source.evaluate(el => el.classList.contains('briefing-selected')), false);
  assert.equal(await page.locator('#briefing-inspector').textContent(), beforePane);
  assert.ok(Math.abs(await readerScroll() - beforeInspect) < 2);
  await source.locator('[data-briefing-ask]').click();
  assert.equal(await page.locator('#briefing-inspector').textContent(), beforePane);
  assert.equal(await page.locator('#briefing-context .briefing-chip').count(), 1);
  await page.locator('#chat-input').fill('Explain this calculation boundary');
  const beforeTab = await readerScroll();
  await page.locator('#diff-tab').click();
  await page.locator('#briefing-tab').click();
  await currentSection('intent');
  try { await page.waitForFunction(top => Math.abs(document.getElementById('diff-panel').scrollTop - top) < 2, beforeTab); }
  catch (error) { console.error('Reading position', { beforeTab, afterTab: await readerScroll() }); throw error; }
  assert.equal(await page.locator('#chat-input').inputValue(), 'Explain this calculation boundary');

  console.log('CHECK Briefing diagram source selection');
  await page.locator('[data-briefing-section="boundaries"]').click();
  await currentSection('boundaries');
  await page.locator('#briefing-view .briefing-canvas [data-briefing-element="receipt"]').click();
  assert.match(await page.locator('#briefing-inspector [data-evidence-element="receipt"] code').textContent(), /export function receipt/);

  const cartCard = page.locator('#briefing-inspector [data-evidence-element="cart"]');
  const receiptCard = page.locator('#briefing-inspector [data-evidence-element="receipt"]');
  const evidenceScroll = page.locator('#briefing-inspector .briefing-evidence-scroll');
  async function selectInPlace(target, activate) {
    // Place the target away from the top before recording. Letting Playwright
    // scroll it into view during the click would conceal a selection jump.
    await target.evaluate(el => {
      const container = el.closest('.briefing-evidence-scroll');
      container.scrollTop += el.getBoundingClientRect().top - container.getBoundingClientRect().top - container.clientHeight / 2;
    });
    const before = await evidenceScroll.evaluate(el => el.scrollTop);
    await activate();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await evidenceScroll.evaluate(el => el.scrollTop), before, 'Selecting evidence in the pane preserves its scroll position');
  }
  const cartLabel = cartCard.locator('.briefing-source-label').first();
  await selectInPlace(cartLabel, () => cartLabel.click());
  assert.ok(await cartCard.evaluate(el => el.classList.contains('briefing-selected')), 'File labels select the whole evidence card');
  await selectInPlace(receiptCard, async () => {
    const bounds = await receiptCard.boundingBox();
    await page.mouse.click(bounds.x + 5, bounds.y + 5);
  });
  assert.ok(await receiptCard.evaluate(el => el.classList.contains('briefing-selected')), 'Card padding selects the evidence');
  await cartCard.locator('pre code').first().click();
  assert.ok(await receiptCard.evaluate(el => el.classList.contains('briefing-selected')), 'Clicking another card’s code does not change selection');
  const cartStats = cartCard.locator('.briefing-diff-summary').first();
  await selectInPlace(cartStats, () => cartStats.click());
  assert.ok(await cartCard.evaluate(el => el.classList.contains('briefing-selected')), 'Diff statistics select the evidence');
  const receiptTitle = receiptCard.locator('.briefing-card-title');
  await selectInPlace(receiptTitle, () => receiptTitle.click());
  await selectInPlace(receiptTitle, async () => { await receiptTitle.focus(); await page.keyboard.press('Enter'); });
  assert.equal(await receiptCard.locator('.briefing-card-title').getAttribute('aria-pressed'), 'true');

  console.log('CHECK Briefing width and closing/reopening evidence');
  const reader = page.locator('#briefing-view');
  assert.equal(await reader.getByRole('button', { name: 'Evidence', exact: true }).count(), 0);
  const wideButton = reader.locator('[data-briefing-wide]');
  const standardWidth = (await reader.boundingBox()).width;
  await wideButton.click();
  assert.equal(await wideButton.getAttribute('aria-pressed'), 'true');
  assert.ok((await reader.boundingBox()).width > standardWidth, 'Wide briefing uses the available center width');
  const withEvidenceWidth = (await reader.boundingBox()).width;
  const evidencePosition = await evidenceScroll.evaluate(el => el.scrollTop);
  await page.getByRole('button', { name: 'Collapse evidence pane', exact: true }).click();
  await page.getByRole('button', { name: 'Expand evidence pane', exact: true }).waitFor();
  assert.equal((await page.locator('#agent-panel').boundingBox()).width, 40);
  assert.equal(await evidenceScroll.isVisible(), false, 'The collapsed rail shows only its toggle');
  assert.ok((await reader.boundingBox()).width <= 1280, 'Wide reading retains a bounded column');
  const readerBounds = await reader.boundingBox(), panelBounds = await page.locator('#diff-panel').boundingBox();
  assert.ok(readerBounds.x > panelBounds.x, 'The wider column remains centered with a margin');
  assert.ok((await reader.boundingBox()).width > withEvidenceWidth, 'Closing evidence gives its space back to the story');
  await page.getByRole('button', { name: 'Expand evidence pane', exact: true }).press('Enter');
  await page.locator('#agent-panel').waitFor({ state: 'visible' });
  assert.equal(await evidenceScroll.evaluate(el => el.scrollTop), evidencePosition, 'Reopening preserves the evidence reading position');
  assert.equal(await receiptTitle.getAttribute('aria-pressed'), 'true', 'Reopening retains the selection');
  await page.getByRole('button', { name: 'Collapse evidence pane', exact: true }).click();
  await page.locator('#briefing-view .briefing-canvas [data-briefing-element="cart"]').click();
  await page.locator('#agent-panel').waitFor({ state: 'visible' });
  assert.equal(await cartCard.locator('.briefing-card-title').getAttribute('aria-pressed'), 'true', 'A diagram click reopens the matching evidence');
  await receiptTitle.click();

  console.log('CHECK Briefing pane resizing after collapsing the Changes file tree');
  await page.locator('#diff-tab').click();
  await page.locator('#file-panel-collapse').click();
  await page.locator('#briefing-tab').click();
  await page.locator('#file-resizer').waitFor({ state: 'visible' });
  for (const [handle, pane, delta] of [['file', 'file', 60], ['agent', 'agent', -80]]) {
    const panel = page.locator(`#${pane}-panel`);
    const before = (await panel.boundingBox()).width;
    const edge = await page.locator(`#${handle}-resizer`).boundingBox();
    await page.mouse.move(edge.x + edge.width / 2, edge.y + 100);
    await page.mouse.down();
    await page.mouse.move(edge.x + edge.width / 2 + delta, edge.y + 100, { steps: 12 });
    await page.mouse.up();
    assert.equal((await panel.boundingBox()).width, before + Math.abs(delta));
  }
  const savedWidths = await page.locator('#workspace').evaluate(el => [el.style.getPropertyValue('--file-panel-width'), el.style.getPropertyValue('--agent-panel-width')]);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const savedPosition = await page.locator('#diff-panel').evaluate(scroll => {
    const top = scroll.getBoundingClientRect().top;
    const block = [...scroll.querySelectorAll('[data-briefing-block]')].find(el => el.getBoundingClientRect().bottom > top + 12);
    return { id: block.dataset.briefingBlock, offset: block.getBoundingClientRect().top - top };
  });
  await page.locator('#diff-tab').click();
  assert.equal(await page.locator('#file-panel-collapse').getAttribute('aria-expanded'), 'false');
  await page.reload();
  await page.locator('#briefing-tab').click();
  await page.locator('#briefing-view .briefing-canvas svg').waitFor();
  assert.equal(await wideButton.getAttribute('aria-pressed'), 'true', 'The wider reading preference survives reload');
  assert.deepEqual(await page.locator('#workspace').evaluate(el => [el.style.getPropertyValue('--file-panel-width'), el.style.getPropertyValue('--agent-panel-width')]), savedWidths);
  try { await page.waitForFunction(({ id, offset }) => {
    const scroll = document.getElementById('diff-panel');
    const block = scroll.querySelector(`[data-briefing-block="${id}"]`);
    return Math.abs(block.getBoundingClientRect().top - scroll.getBoundingClientRect().top - offset) < 2;
  }, savedPosition); } catch (error) {
    console.error('Reload bookmark', savedPosition, await page.evaluate(id => ({
      top: document.getElementById('diff-panel').scrollTop,
      offset: document.querySelector(`[data-briefing-block="${id}"]`).getBoundingClientRect().top - document.getElementById('diff-panel').getBoundingClientRect().top,
      saved: localStorage.getItem('diffcompass-briefing-reading-v1'),
    }), savedPosition.id));
    throw error;
  }
  await page.locator('#briefing-view .briefing-canvas [data-briefing-element="receipt"][aria-pressed="true"]').waitFor();
  assert.match(await page.locator('#briefing-inspector [data-evidence-element="receipt"] code').textContent(), /export function receipt/);
  await wideButton.click();
  assert.equal(await wideButton.getAttribute('aria-pressed'), 'false');
  // A bookmark from another snapshot must never restore its selection or position.
  await page.evaluate(() => {
    const key = 'diffcompass-briefing-reading-v1';
    const values = JSON.parse(localStorage.getItem(key));
    values.forEach(value => { value.fingerprint = 'different-snapshot'; });
    localStorage.setItem(key, JSON.stringify(values));
    // A new tab reads storage without this page's pagehide saving it again.
  });
  const freshPage = await page.context().newPage();
  await freshPage.goto(url);
  await freshPage.locator('#briefing-tab').click();
  await freshPage.locator('#briefing-view .briefing-canvas svg g[data-briefing-element]').first().waitFor();
  await freshPage.waitForFunction(() => document.getElementById('diff-panel').scrollTop === 0);
  assert.equal(await freshPage.locator('#briefing-view [data-briefing-element][aria-pressed="true"]').count(), 0);
  await freshPage.close();
  await page.setViewportSize({ width: 1200, height: 1000 });
  await page.locator('#agent-resizer').focus(); await page.keyboard.press('End');
  assert.ok(await page.locator('#workspace').evaluate(el => el.scrollWidth <= el.clientWidth), 'Visible Briefing outline counts towards the evidence pane width limit');

  console.log('CHECK Briefing uses the saved renderer preference and captured diff models');
  const snippetRequests = [];
  page.on('request', request => {
    if (request.frame()?.url().includes('/monaco/briefing.html') && request.url().includes('/api/')) snippetRequests.push(request.url());
  });
  await page.locator('#diff-tab').click();
  await page.locator('#diff-renderer').selectOption('monaco');
  await page.locator('#briefing-tab').click();
  await page.locator('[data-briefing-section="intent"]').click();
  const iframe = source.locator('.briefing-code-frame:not([hidden])');
  await iframe.waitFor();
  const frame = await (await iframe.elementHandle()).contentFrame();
  const header = { 'x-diffcompass-token': new URLSearchParams(new URL(url).hash.slice(1)).get('token') };
  const snapshot = await (await page.request.get(new URL('/api/session', url).href, { headers: header })).json();
  const evidence = snapshot.outline.briefing.evidence.find(e => e.id === 'subtotal-body');
  const expected = { before: [], after: [] };
  for (const row of evidence.diff.rows.filter(row => row.kind !== 'meta')) {
    if (row.kind !== 'addition') expected.before.push(row.content);
    if (row.kind !== 'deletion') expected.after.push(row.content);
  }
  const actual = await frame.evaluate(() => Object.fromEntries(window.monaco.editor.getModels().map(model => [model.uri.path.split('/').at(-1), model.getValue().split('\n')])));
  assert.deepEqual(actual, expected, 'Monaco models contain the captured before/after excerpt, not the current file');
  assert.ok(await frame.evaluate(() => window.monaco.editor.getEditors().every(editor => editor.getOption(window.monaco.editor.EditorOption.readOnly))), 'Both sides remain read-only');
  const inspected = await page.locator('#briefing-inspector').textContent();
  await frame.locator('.modified .view-line').filter({ hasText: 'export function subtotal' }).first().click({ position: { x: 100, y: 10 } });
  await page.keyboard.press('Shift+ArrowRight');
  assert.equal(await page.locator('#briefing-inspector').textContent(), inspected, 'Selecting Monaco text does not select its card');
  assert.ok(await frame.evaluate(() => window.monaco.editor.getEditors().some(editor => editor.hasTextFocus() && !editor.getSelection().isEmpty())), 'Monaco code remains selectable');
  assert.deepEqual(snippetRequests, [], 'Saved snippet viewers never request repository source or session APIs');
  await page.reload(); await page.locator('#briefing-tab').click();
  await page.locator('[data-briefing-section="intent"]').click();
  await source.locator('.briefing-code-frame:not([hidden])').waitFor();
  assert.equal(await page.locator('#diff-renderer').inputValue(), 'monaco', 'The renderer choice survives reload');
  await page.locator('#diff-tab').click(); await page.locator('#diff-renderer').selectOption('current'); await page.locator('#briefing-tab').click();
  assert.equal(await page.locator('#briefing-view .briefing-code-frame').count(), 0);
  await source.locator('pre.briefing-diff').waitFor();

  console.log('CHECK Briefing mobile evidence sheet');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#diff-panel').evaluate(el => { el.scrollTop = 0; });
  assert.ok(await page.locator('#briefing-view').evaluate(el => el.getBoundingClientRect().right <= innerWidth && el.scrollWidth <= el.clientWidth), 'Wide code scrolls inside its excerpt without widening the mobile reader');
  assert.equal(await askPassage.evaluate(el => getComputedStyle(el.parentElement).opacity), '1');
  await page.locator('#briefing-view .briefing-diagram [data-briefing-inspect]').first().click();
  await page.locator('#briefing-sheet[open]').waitFor();
  assert.match(await page.locator('#briefing-inspector [data-evidence-element="receipt"] code').textContent(), /export function receipt/);
  await page.getByRole('button', { name: 'Collapse evidence pane', exact: true }).click();
  await page.locator('#briefing-sheet[open]').waitFor({ state: 'hidden' });
  await page.locator('#briefing-mobile-tools').click();
  await page.locator('#briefing-sheet[open]').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('#briefing-sheet[open]').waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
  console.log('PASS Briefing: inline code, scroll tracking, evidence, question draft, mobile');
} catch (error) {
  console.error(await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth, overflow: [...document.querySelectorAll('body *')].filter(el => { const r = el.getBoundingClientRect(); return r.width && r.right > innerWidth + 1 && getComputedStyle(el).position !== 'absolute'; }).slice(0, 15).map(el => ({ tag: el.tagName, id: el.id, class: el.className, width: el.getBoundingClientRect().width })) })));
  throw error;
} finally { await browser.close(); }
