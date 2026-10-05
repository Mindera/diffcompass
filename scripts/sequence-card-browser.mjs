// Isolated native-window checks for semantics-card / Code steps handoff.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const url = process.argv[2];
if (!url) throw Error('Pass the authenticated fixture URL');
const browser = await chromium.launch({ headless: false, channel: 'chrome' });
const context = await browser.newContext({ viewport: null });
const errors = [];
const settle = page => page.waitForTimeout(250);
async function newPage(width = 1440, height = 1000) {
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  const session = await context.newCDPSession(page);
  const { windowId } = await session.send('Browser.getWindowForTarget');
  const chrome = await page.evaluate(() => ({ width: outerWidth - innerWidth, height: outerHeight - innerHeight }));
  await session.send('Browser.setWindowBounds', { windowId, bounds: { width: width + chrome.width, height: height + chrome.height, windowState: 'normal' } });
  await settle(page); return page;
}
async function open(page) {
  await page.goto(url); await page.locator('#archify-tab').click();
  await page.locator('#archify-select').selectOption('sequence-checkout-flow');
  const frame = await (await page.locator('iframe.archify-frame').elementHandle()).contentFrame();
  await frame.locator('.sequence-step-code').first().waitFor();
  await frame.waitForFunction(() => Archify.view.state().mode === 'review');
  await settle(page); return frame;
}
const state = frame => frame.evaluate(() => ({ camera: Archify.view.state(), present: Archify.presentation.active(),
  selected: document.querySelector('.sequence-code-step.selected')?.dataset.sequenceMessageId, diagram: Archify.focus.relationship()?.id,
  focus: document.activeElement?.closest('.sequence-code-step')?.dataset.sequenceMessageId,
  size: document.querySelector('.sequence-code-resizer').getAttribute('aria-valuenow'), overflow: document.documentElement.scrollWidth > innerWidth }));
async function hiddenSource(frame) {
  await frame.locator('#focus-chip').waitFor();
  assert.equal(await frame.locator('.diffcompass-message-source').isVisible(), false);
  assert.equal(await frame.locator('.diffcompass-message-source').locator('*').count(), 0);
}
async function handoff(frame, index, key) {
  const page = frame.page(), pane = frame.locator('.sequence-code-pane');
  const step = frame.locator('.sequence-code-step').nth(index);
  const id = await step.getAttribute('data-sequence-message-id');
  await step.locator('.sequence-step-select').click(); await settle(page);
  await hiddenSource(frame);
  const before = await state(frame);
  await pane.evaluate(node => { node.scrollTop = 0; }); // Already-selected step can be away from the reader.
  await frame.getByRole('button', { name: 'Hide code', exact: true }).click(); await settle(page);
  const show = frame.getByRole('button', { name: 'Show code step', exact: true });
  await show.waitFor();
  assert.equal(await frame.locator('.diffcompass-message-source button').count(), 1);
  assert.equal(await frame.locator('.diffcompass-message-source').innerText(), 'Show code step');
  assert.equal(await show.getAttribute('aria-controls'), 'sequence-code-steps');
  assert.equal(await pane.isVisible(), false);
  assert.deepEqual((await state(frame)).camera, before.camera);
  if (process.env.SEQUENCE_SCREENSHOT_DIR) await frame.locator('#focus-chip').screenshot({ path: `${process.env.SEQUENCE_SCREENSHOT_DIR}/semantics-collapsed-${index}-${key || 'pointer'}.png` });
  if (key) await show.press(key); else await show.click();
  await settle(page);
  assert.equal(await pane.isVisible(), true);
  const after = await state(frame);
  assert.equal(after.selected, id); assert.equal(after.diagram, id); assert.equal(after.focus, id);
  assert.equal(after.size, before.size); assert.equal(after.present, before.present); assert.equal(after.overflow, false);
  assert.deepEqual(after.camera, before.camera);
  assert.equal(await step.evaluate(node => { const rect = node.getBoundingClientRect(), pane = node.closest('.sequence-code-pane').getBoundingClientRect(); return rect.top < pane.bottom && rect.bottom > pane.top; }), true);
  await hiddenSource(frame);
  if (process.env.SEQUENCE_SCREENSHOT_DIR) await frame.locator('#focus-chip').screenshot({ path: `${process.env.SEQUENCE_SCREENSHOT_DIR}/semantics-expanded-${index}-${key || 'pointer'}.png` });
}
try {
  console.log('Chrome', browser.version(), 'native-window; no forced or JS activation');
  const page = await newPage(), frame = await open(page);
  await frame.waitForFunction(() => document.querySelector('.sequence-step-source')?.textContent.includes('name match'));
  await handoff(frame, 0);
  assert.match(await frame.locator('.sequence-step-source').first().innerText(), /name match.*not a verified call target/);
  assert.equal(await frame.locator('.sequence-code-step').first().getByRole('button', { name: 'View code', exact: true }).count(), 1);
  console.log('workspace: source block absent while open; single reopen action while collapsed; candidate warning and source action retained in pane');
  await handoff(frame, 2, 'Enter');
  console.log('keyboard Enter: exact grouped return step revealed/focused, retained selection and camera/size preserved');
  await frame.locator('#btn-present').click(); await settle(page);
  await handoff(frame, 3, ' ');
  console.log('Present + Space: exact return step, focus and size retained; no overflow/camera change');
  const exported = await page.evaluate(async () => {
    const response = await fetch('/api/export?format=html', { method: 'POST', headers: { 'content-type': 'application/json', 'x-diffcompass-token': sessionStorage.getItem('diffcompass-token') }, body: JSON.stringify({ prepareMissingSteps: false }) });
    if (!response.ok) throw Error('Export ' + response.status); return response.text();
  });
  const offline = await newPage(); await offline.route('**/*', route => route.abort()); await offline.setContent(exported);
  await offline.locator('[data-view="maps"]').click();
  const iframe = offline.locator('iframe[title*="sequence:"]'); await iframe.scrollIntoViewIfNeeded();
  const saved = await (await iframe.elementHandle()).contentFrame();
  await saved.locator('.sequence-step-code').first().waitFor(); await settle(offline);
  await handoff(saved, 2);
  assert.equal(await saved.getByRole('button', { name: 'View code', exact: true }).count(), 0);
  console.log('offline: same conditional card and ordinary pointer handoff with saved excerpts; no live source actions/network');
  await offline.close();
  const narrow = await newPage(600, 900), small = await open(narrow);
  await handoff(small, 1);
  console.log('narrow: stacked pane reopens at exact step, with no overflow or camera change');
  assert.deepEqual(errors, []);
  console.log('5 groups pass; zero page errors');
} finally { await browser.close(); }
