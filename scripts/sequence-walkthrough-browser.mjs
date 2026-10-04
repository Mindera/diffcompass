// Run against an isolated prepared fixture (47631), never a user's live review.
// PLAYWRIGHT_MODULE can point to an existing installation; no install is needed.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const url = process.argv[2];
if (!url) throw new Error('Pass the authenticated fixture URL.');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [], results = [];
page.setDefaultTimeout(15_000);
const record = (...items) => { results.push(...items); console.log(items.join('\n')); };
page.on('pageerror', error => errors.push(error.message));
const settle = () => page.waitForTimeout(180);
try {
  await page.goto(url);
  await page.locator('#archify-tab').click();
  await page.locator('#archify-select').selectOption('sequence-checkout-flow');
  const frame = await (await page.locator('iframe.archify-frame').elementHandle()).contentFrame();
  await frame.locator('.sequence-step-code').first().waitFor();
  await frame.waitForFunction(() => window.Archify?.view?.state?.().mode === 'review');
  await settle();
  if (process.env.SEQUENCE_SCREENSHOT_DIR) await page.screenshot({ path: process.env.SEQUENCE_SCREENSHOT_DIR + '/sequence-desktop.png' });
  const ids = await frame.locator('[data-relationship-id]').evaluateAll(nodes => nodes.map(node => node.dataset.relationshipId));
  const camera = () => frame.evaluate(() => window.Archify.view.state());
  const selected = () => frame.evaluate(() => ({ diagram: window.Archify.focus.relationship()?.id, code: document.querySelector('.sequence-code-step.selected')?.dataset.sequenceMessageId, top: document.querySelector('.sequence-code-pane').scrollTop }));
  const initialCamera = await camera();
  // SVG horizontal hit paths have a zero-height geometry box even though their
  // wide transparent stroke is clickable. Click the real stroke coordinates.
  const hit = await frame.locator('[data-relationship-id]').first().boundingBox();
  assert.ok(hit); await page.mouse.click(hit.x + hit.width / 2, hit.y + hit.height / 2);
  await settle();
  let state = await selected();
  assert.equal(state.diagram, ids[0]); assert.equal(state.code, ids[0]); assert.ok(state.top > 0);
  assert.deepEqual(await camera(), initialCamera);
  record('arrow click selects/reveals code without camera movement');

  const pane = frame.locator('.sequence-code-pane');
  await pane.hover(); await page.mouse.wheel(0, 500); await settle();
  state = await selected();
  assert.equal(state.diagram, state.code); assert.notEqual(state.code, ids[0]);
  const scrolled = state.top; await page.waitForTimeout(500);
  assert.equal((await selected()).top, scrolled);
  assert.deepEqual(await camera(), initialCamera);
  record('real wheel selects another arrow without scroll feedback or camera movement');

  await frame.locator('.sequence-step-select').last().focus();
  await page.keyboard.press('Home'); await settle();
  assert.equal((await selected()).diagram, ids[0]);
  await page.keyboard.press('End'); await settle();
  assert.equal((await selected()).diagram, ids[3]);
  record('Home/End keyboard selection');

  await frame.locator('#btn-present').click(); await settle();
  assert.equal(await frame.evaluate(() => window.Archify.presentation.active()), true);
  const presentCamera = await camera();
  const sourceStep = ids[3];
  await frame.evaluate(() => { window.sequenceFixtureIdentity = 'same-frame'; });
  await frame.locator('.sequence-code-step').last().getByRole('button', { name: 'View code', exact: true }).click();
  await page.locator('#sequence-source-return').waitFor({ state: 'visible' });
  await page.locator('#sequence-source-return').click(); await settle();
  assert.equal(await frame.evaluate(() => window.sequenceFixtureIdentity), 'same-frame');
  assert.equal(await frame.evaluate(() => window.Archify.presentation.active()), true);
  assert.deepEqual(await camera(), presentCamera);
  assert.equal((await selected()).diagram, sourceStep);
  assert.equal((await selected()).code, sourceStep);
  record('View code/return preserves iframe, selection, presentation and camera');
  await frame.locator('#btn-present').click(); await settle();

  await frame.locator('.sequence-step-select').first().click();
  await page.route('**/api/sequence-sources/*?edge=*', route => route.abort());
  await frame.locator('.sequence-code-step').first().getByRole('button', { name: 'Find definition' }).click();
  await frame.locator('.sequence-code-step').first().getByText('Definition lookup failed. You can retry.').waitFor();
  await page.unroute('**/api/sequence-sources/*?edge=*');
  await frame.locator('.sequence-code-step').first().getByRole('button', { name: 'Find definition' }).click();
  await frame.locator('.sequence-code-step').first().getByText(/Current workspace · name match/).waitFor();
  await frame.locator('.sequence-code-step').first().getByRole('button', { name: 'View definition' }).first().click();
  await page.locator('.source-code').waitFor({ state: 'visible' });
  assert.match(await page.locator('.source-file .file-stats').innerText(), /Current workspace · name match/);
  await page.locator('#sequence-source-return').click(); await settle();
  record('lookup error/retry recovers; current candidates open repository source');

  await frame.locator('#btn-motion').click(); await settle();
  assert.equal(await frame.locator('#btn-motion').getAttribute('aria-pressed'), 'false');
  await frame.locator('#btn-motion').click();
  await page.emulateMedia({ reducedMotion: 'reduce' }); await settle();
  assert.equal(await frame.locator('#btn-motion').isDisabled(), true);
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await settle();
  assert.equal(await frame.locator('#btn-motion').isDisabled(), false);
  // Exercise the browser document's actual background/foreground transition.
  const background = await page.context().newPage(); await background.goto('about:blank'); await background.bringToFront(); await settle();
  const hidden = await frame.evaluate(() => document.hidden);
  await page.bringToFront(); await background.close(); await settle();
  if (!hidden) {
    // Headless Chrome keeps tabs visible. Drive the same visibilitychange branch
    // explicitly and report that limitation instead of claiming a real hide.
    await frame.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      delete document.hidden; delete document.visibilityState;
      document.dispatchEvent(new Event('visibilitychange'));
    });
  }
  record(`motion off/on and reduced-motion transitions; hidden/return ${hidden ? 'real' : 'simulated visibilitychange (headless keeps tabs visible)'}`);

  await page.setViewportSize({ width: 600, height: 850 }); await settle();
  const sizes = await frame.evaluate(() => ({ pane: document.querySelector('.sequence-code-pane').getBoundingClientRect().toJSON(), diagram: document.querySelector('.diagram-container').getBoundingClientRect().toJSON(), width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert.ok(sizes.pane.y >= sizes.diagram.bottom - 1); assert.ok(sizes.pane.height >= 160); assert.equal(sizes.scrollWidth, sizes.width);
  if (process.env.SEQUENCE_SCREENSHOT_DIR) await page.screenshot({ path: process.env.SEQUENCE_SCREENSHOT_DIR + '/sequence-narrow.png' });
  record('narrow frame stacks diagram above independently scrollable code without overflow');
  await page.setViewportSize({ width: 1440, height: 1000 }); await settle();

  const exported = await page.evaluate(async () => {
    const response = await fetch('/api/export?format=html', { method: 'POST', headers: { 'content-type': 'application/json', 'x-diffcompass-token': sessionStorage.getItem('diffcompass-token') }, body: JSON.stringify({ prepareMissingSteps: false }) });
    if (!response.ok) throw new Error(await response.text());
    return response.text();
  });
  const offline = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  offline.on('pageerror', error => errors.push(error.message));
  await offline.route('**/*', route => route.abort());
  await offline.setContent(exported);
  await offline.locator('[data-view="maps"]').click();
  const offlineFrame = await (await offline.locator('iframe[title*="sequence:"]').elementHandle()).contentFrame();
  await offline.locator('iframe[title*="sequence:"]').scrollIntoViewIfNeeded();
  await offlineFrame.locator('.sequence-step-code').first().waitFor();
  await offlineFrame.waitForFunction(() => window.Archify?.view?.state?.().mode === 'review');
  assert.equal(await offlineFrame.getByRole('button', { name: 'Find definition', exact: true }).count(), 0);
  assert.equal(await offlineFrame.getByRole('button', { name: 'View code', exact: true }).count(), 0);
  assert.match(await offlineFrame.locator('.sequence-code-pane').innerText(), /After · captured comparison evidence/);
  // Center within the pane and parent viewport before a real pointer click;
  // locator auto-scroll may leave this button clipped by the outer workspace.
  const offlineLast = offlineFrame.locator('.sequence-step-select').last();
  await offlineLast.evaluate(button => button.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await offline.waitForTimeout(250);
  const offlineBox = await offlineLast.boundingBox();
  assert.ok(offlineBox.x >= 0 && offlineBox.y >= 0 && offlineBox.x + offlineBox.width <= 1440 && offlineBox.y + offlineBox.height <= 1000);
  const traceClicks = () => {
    window.offlinePointerTrace = [];
    for (const type of ['pointerdown', 'pointerup', 'click']) document.addEventListener(type, e => window.offlinePointerTrace.push({ type, tag: e.target.tagName, className: String(e.target.className), x: e.clientX, y: e.clientY }), true);
  };
  await offline.evaluate(traceClicks); await offlineFrame.evaluate(traceClicks);
  const offlinePointer = { targetBox: offlineBox, frameBox: await offline.locator('iframe[title*="sequence:"]').boundingBox(), parent: await offline.evaluate(({x,y}) => ({ hits: document.elementsFromPoint(x,y).map(e=>e.tagName+'.'+e.className), scroll:[scrollX,scrollY], viewport:{width:visualViewport.width,height:visualViewport.height,offsetTop:visualViewport.offsetTop,offsetLeft:visualViewport.offsetLeft,scale:visualViewport.scale} }), { x:offlineBox.x+offlineBox.width/2, y:offlineBox.y+offlineBox.height/2 }) };
  await offlineLast.click(); await settle();
  if (!await offlineFrame.evaluate(() => window.Archify.focus.relationship()?.id)) console.log('Offline selection diagnostic', await offlineFrame.evaluate(() => ({ selected: document.querySelector('.sequence-code-step.selected')?.dataset.sequenceMessageId, relationship: Archify.focus.relationship(), camera: Archify.view.state(), pin: document.querySelector('.diagram-container svg').getAttribute('data-relationship-pin-active') })), errors);
  assert.equal(await offlineFrame.evaluate(() => window.Archify.focus.relationship()?.id), ids[3]);
  await offlineLast.click(); await settle();
  assert.equal(await offlineFrame.evaluate(() => window.Archify.focus.relationship()?.id), ids[3]);
  offlinePointer.parentEvents = await offline.evaluate(() => offlinePointerTrace);
  offlinePointer.childEvents = await offlineFrame.evaluate(() => offlinePointerTrace);
  assert.ok(offlinePointer.childEvents.filter(e => e.type === 'click' && e.className === 'sequence-step-select').length >= 2);
  record('HTML export works offline with escaped captured evidence and no live-only actions');
  await offline.close();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ results, errors, offlinePointer }, null, 2));
} finally { await browser.close(); }
