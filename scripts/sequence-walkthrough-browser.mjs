// Run against an isolated prepared fixture (47631), never a user's live review.
// PLAYWRIGHT_MODULE can point to an existing installation; no install is needed.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const url = process.argv[2];
if (!url) throw new Error('Pass the authenticated fixture URL.');
const browser = await chromium.launch({ headless: process.env.SEQUENCE_HEADED !== '1', channel: 'chrome' });
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
  await page.locator('[data-map-view="sequence"]').click(); await page.locator('#sequence-map-select').selectOption('sequence-checkout-flow');
  const frame = await (await page.locator('#sequence-map-artifacts iframe.archify-frame').elementHandle()).contentFrame();
  await frame.locator('.sequence-step-code').first().waitFor();
  await frame.locator('.sequence-code-step').first().getByText(/After · name match in captured source/).waitFor();
  await frame.waitForFunction(() => window.Archify?.view?.state?.().mode === 'review');
  await settle();
  if (process.env.SEQUENCE_SCREENSHOT_DIR) await page.screenshot({ path: process.env.SEQUENCE_SCREENSHOT_DIR + '/sequence-desktop.png' });
  const ids = await frame.locator('[data-relationship-id]').evaluateAll(nodes => nodes.map(node => node.dataset.relationshipId));
  const camera = () => frame.evaluate(() => window.Archify.view.state());
  const selected = () => frame.evaluate(() => ({ diagram: window.Archify.focus.relationship()?.id, code: document.querySelector('.sequence-code-step.selected')?.dataset.sequenceMessageId, top: document.querySelector('.sequence-code-pane').scrollTop }));
  const initialCamera = await camera();
  const previewCounts = () => [...document.querySelectorAll('.sequence-code-step')].map(step => step.querySelectorAll('.sequence-step-code').length);
  assert.deepEqual(await frame.evaluate(previewCounts), [1, 1, 1, 1]);
  assert.equal(await frame.locator('.sequence-code-pane').getByRole('button', { name: 'Find definition', exact: true }).count(), 0);
  assert.equal((await selected()).diagram, undefined);
  assert.equal((await selected()).code, undefined);
  assert.equal((await selected()).top, 0);
  record('saved excerpts and unlinked current candidates load before any diagram or code interaction');
  assert.deepEqual(await frame.locator('.sequence-step-progress').allTextContents(), ['Step 1 of 4', 'Step 2 of 4', 'Step 3 of 4', 'Step 4 of 4']);
  assert.equal(await frame.locator('.sequence-code-row.addition').count(), 5);
  assert.equal(await frame.locator('.sequence-code-counts').first().getAttribute('aria-label'), '1 added and 0 removed lines in this excerpt');
  assert.equal(await frame.locator('.sequence-code-language').first().innerText(), 'TYPESCRIPT');
  const gutters = await frame.locator('.sequence-code-row').first().evaluate(row => {
    const marker = row.querySelector('.sequence-step-marker').getBoundingClientRect(), number = row.querySelector('.sequence-step-line').getBoundingClientRect(), code = row.querySelector('.sequence-step-source-text').getBoundingClientRect();
    return { marker: marker.width, number: number.width, separate: marker.right <= number.left && number.right <= code.left };
  });
  assert.deepEqual(gutters, { marker: 24, number: 38, separate: true });
  const token = frame.locator('.sequence-step-code .syntax-token').first();
  const tokenColor = () => token.evaluate(node => getComputedStyle(node).color);
  const originalColor = await tokenColor();
  assert.ok((await frame.locator('.sequence-step-code .syntax-token').count()) > 5);
  await frame.locator('#btn-theme').click(); await settle();
  assert.notEqual(await tokenColor(), originalColor);
  assert.deepEqual(await camera(), initialCamera);
  await frame.locator('#btn-theme').click(); await settle();
  assert.equal(await tokenColor(), originalColor);
  record('Step X of Y, captured addition counts/markers and theme-responsive shared syntax colors');
  async function collapseCycle(targetFrame, name) {
    const before = await targetFrame.evaluate(() => ({ camera: Archify.view.state(), top: document.querySelector('.sequence-code-pane').scrollTop, selected: document.querySelector('.sequence-code-step.selected')?.dataset.sequenceMessageId, diagram: document.querySelector('.diagram-container').getBoundingClientRect().toJSON() }));
    await targetFrame.getByRole('button', { name: 'Hide code', exact: true }).click(); await settle();
    assert.equal(await targetFrame.locator('.sequence-code-pane').isVisible(), false);
    const show = targetFrame.getByRole('button', { name: 'Show code', exact: true });
    assert.equal(await show.getAttribute('aria-expanded'), 'false');
    const hidden = await targetFrame.evaluate(() => ({ camera: Archify.view.state(), diagram: document.querySelector('.diagram-container').getBoundingClientRect().toJSON(), overflow: document.documentElement.scrollWidth > innerWidth }));
    assert.deepEqual(hidden.camera, before.camera); assert.equal(hidden.overflow, false);
    assert.ok(hidden.diagram.width > before.diagram.width || hidden.diagram.height > before.diagram.height);
    if (process.env.SEQUENCE_SCREENSHOT_DIR) await targetFrame.page().screenshot({ path: `${process.env.SEQUENCE_SCREENSHOT_DIR}/sequence-collapsed-${name.replaceAll(' ', '-')}.png` });
    await show.press('Enter'); await settle();
    assert.equal(await targetFrame.locator('.sequence-code-pane').isVisible(), true);
    assert.equal(await targetFrame.getByRole('button', { name: 'Hide code', exact: true }).getAttribute('aria-expanded'), 'true');
    const after = await targetFrame.evaluate(() => ({ camera: Archify.view.state(), top: document.querySelector('.sequence-code-pane').scrollTop, selected: document.querySelector('.sequence-code-step.selected')?.dataset.sequenceMessageId, diagramSelection: Archify.focus.relationship()?.id }));
    assert.deepEqual(after.camera, before.camera); assert.equal(after.top, before.top); assert.equal(after.selected, before.selected);
    if (before.selected) assert.equal(after.diagramSelection, before.selected);
    if (process.env.SEQUENCE_SCREENSHOT_DIR) await targetFrame.page().screenshot({ path: `${process.env.SEQUENCE_SCREENSHOT_DIR}/sequence-expanded-${name.replaceAll(' ', '-')}.png` });
    record(`${name}: pointer collapse and keyboard expansion preserve scroll, selection and camera`);
  }
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
  const beforeScroll = await selected();
  await pane.hover(); await page.mouse.wheel(0, 500); await settle();
  state = await selected();
  assert.equal(state.diagram, ids[0]); assert.equal(state.code, ids[0]); assert.ok(state.top > beforeScroll.top);
  const scrolled = state.top; await page.waitForTimeout(500);
  assert.equal((await selected()).top, scrolled);
  await pane.click({ position: { x: 3, y: 30 } }); await settle();
  assert.equal((await selected()).diagram, ids[0]);
  await pane.focus(); await page.keyboard.press('Home'); await settle();
  const scrollHome = (await selected()).top;
  await page.keyboard.press('End'); await settle();
  assert.ok((await selected()).top > scrollHome);
  assert.equal((await selected()).code, ids[0]); assert.equal((await selected()).diagram, ids[0]);
  assert.deepEqual(await camera(), initialCamera);
  record('real wheel, pane click and native Home/End scrolling preserve step/arrow selection and camera');

  await frame.locator('.sequence-step-select').last().focus();
  await page.keyboard.press('Home'); await settle();
  assert.equal((await selected()).diagram, ids[0]);
  await page.keyboard.press('End'); await settle();
  assert.equal((await selected()).diagram, ids[3]);
  record('Home/End keyboard selection');
  await collapseCycle(frame, 'workspace');

  await frame.locator('#btn-present').click(); await settle();
  assert.equal(await frame.evaluate(() => window.Archify.presentation.active()), true);
  const presentCamera = await camera();
  if (process.env.SEQUENCE_SCREENSHOT_DIR) {
    await frame.locator('.sequence-step-select').first().focus(); await page.keyboard.press('Home'); await settle();
    await page.screenshot({ path: process.env.SEQUENCE_SCREENSHOT_DIR + '/sequence-rich-present-light.png' });
    await frame.locator('#btn-theme').click(); await settle();
    await page.screenshot({ path: process.env.SEQUENCE_SCREENSHOT_DIR + '/sequence-rich-present-dark.png' });
    await frame.locator('#btn-theme').click(); await settle();
    await frame.locator('.sequence-step-select').last().focus(); await page.keyboard.press('End'); await settle();
  }
  const sourceStep = ids[3];
  await frame.evaluate(() => {
    window.sequenceFixtureIdentity = 'same-frame'; window.sequenceSourceTrace = [];
    for (const type of ['pointerdown', 'click']) document.addEventListener(type, event => {
      if (window.sequenceSourceTrace.length >= 20) return;
      window.sequenceSourceTrace.push({ type, step: event.target.closest('[data-sequence-message-id]')?.dataset.sequenceMessageId, button: event.target.closest('button')?.textContent, x: event.clientX, y: event.clientY });
    }, true);
  });
  await frame.locator('.sequence-code-step').last().getByRole('button', { name: 'View code', exact: true }).click();
  console.log('Source click receipt', JSON.stringify({ expected: sourceStep, trace: await frame.evaluate(() => window.sequenceSourceTrace), selection: await selected() }));
  await page.locator('#sequence-source-return').waitFor({ state: 'visible' });
  await page.locator('#sequence-source-return').click(); await settle();
  console.log('Source return receipt', JSON.stringify(await selected()));
  assert.equal(await frame.evaluate(() => window.sequenceFixtureIdentity), 'same-frame');
  assert.equal(await frame.evaluate(() => window.Archify.presentation.active()), true);
  assert.deepEqual(await camera(), presentCamera);
  assert.equal((await selected()).diagram, sourceStep);
  assert.equal((await selected()).code, sourceStep);
  record('View code/return preserves iframe, selection, presentation and camera');
  await collapseCycle(frame, 'Present');
  await frame.locator('#btn-present').click(); await settle();

  await frame.locator('.sequence-step-select').first().click();
  assert.equal(await frame.getByRole('button', { name: /View definition/ }).count(), 0);
  await frame.locator('.sequence-code-step').first().getByRole('button', { name: 'View code', exact: true }).first().click();
  const receiptDiff = page.locator('.diff-file[data-path="src/receipt.ts"]');
  const waitForSourceLine = line => page.waitForFunction(line => {
    const row = document.querySelector(`.diff-file[data-path="src/receipt.ts"] .sequence-source-highlight[data-new-line="${line}"]`);
    if (!row) return false;
    const box = row.getBoundingClientRect(), panel = document.getElementById('diff-panel').getBoundingClientRect();
    return box.top >= panel.top + 80 && box.bottom <= Math.min(panel.bottom, innerHeight);
  }, line);
  await receiptDiff.waitFor({ state: 'visible' });
  assert.equal(await receiptDiff.locator('.sequence-source-highlight[data-new-line="3"]').count(), 1);
  await waitForSourceLine(3);
  assert.equal(await page.locator('.source-file').count(), 0);
  await page.locator('#sequence-source-return').click(); await settle();
  await frame.locator('.sequence-code-step').nth(1).getByRole('button', { name: 'View code', exact: true }).click();
  await receiptDiff.waitFor({ state: 'visible' });
  assert.equal(await receiptDiff.locator('.sequence-source-highlight[data-new-line="4"]').count(), 1);
  await waitForSourceLine(4); await settle();
  if (process.env.SEQUENCE_SCREENSHOT_DIR) await page.screenshot({ path: process.env.SEQUENCE_SCREENSHOT_DIR + '/sequence-shared-code-destination.png' });
  await page.locator('#sequence-source-return').click(); await settle();
  record('both View code buttons open the same captured receipt diff at lines 3 and 4, with return navigation');
  const retryPage = await context.newPage();
  retryPage.on('pageerror', error => errors.push(error.message));
  await retryPage.route('**/api/sequence-sources/*?edge=*', route => route.abort());
  await retryPage.goto(url);
  await retryPage.locator('#archify-tab').click();
  await retryPage.locator('[data-map-view="sequence"]').click(); await retryPage.locator('#sequence-map-select').selectOption('sequence-checkout-flow');
  const retryFrame = await (await retryPage.locator('#sequence-map-artifacts iframe.archify-frame').elementHandle()).contentFrame();
  await retryFrame.locator('.sequence-code-step').first().getByText('Definition lookup failed. You can retry.').waitFor();
  await retryPage.unroute('**/api/sequence-sources/*?edge=*');
  const retryButton = retryFrame.locator('.sequence-code-step').first().getByRole('button', { name: 'Find definition' });
  await retryButton.evaluate(button => button.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await retryPage.waitForTimeout(250);
  const retryBox = await retryButton.boundingBox();
  assert.ok(retryBox.x >= 0 && retryBox.y >= 0 && retryBox.x + retryBox.width <= 1440 && retryBox.y + retryBox.height <= 1000);
  await retryButton.click();
  await retryFrame.locator('.sequence-code-step').first().getByText(/After · name match in captured source/).waitFor();
  await retryPage.close();
  record('automatic lookup failure retains an explicit working retry');

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
    // If the browser keeps this frame visible, drive the visibilitychange branch
    // explicitly and report that limitation instead of claiming a real hide.
    await frame.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      delete document.hidden; delete document.visibilityState;
      document.dispatchEvent(new Event('visibilitychange'));
    });
  }
  record(`motion off/on and reduced-motion transitions; hidden/return ${hidden ? 'real' : 'simulated visibilitychange (document stayed visible)'}`);

  await page.setViewportSize({ width: 600, height: 850 }); await settle();
  const sizes = await frame.evaluate(() => ({ pane: document.querySelector('.sequence-code-pane').getBoundingClientRect().toJSON(), diagram: document.querySelector('.diagram-container').getBoundingClientRect().toJSON(), width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert.ok(sizes.pane.y >= sizes.diagram.bottom - 1); assert.ok(sizes.pane.height >= 160); assert.equal(sizes.scrollWidth, sizes.width);
  if (process.env.SEQUENCE_SCREENSHOT_DIR) await page.screenshot({ path: process.env.SEQUENCE_SCREENSHOT_DIR + '/sequence-narrow.png' });
  record('narrow frame stacks diagram above independently scrollable code without overflow');
  await collapseCycle(frame, 'narrow workspace');
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
  assert.deepEqual(await offlineFrame.evaluate(previewCounts), [0, 1, 1, 1]);
  assert.equal(await offlineFrame.locator('.sequence-step-progress').last().textContent(), 'Step 4 of 4');
  assert.equal(await offlineFrame.locator('.sequence-code-row.addition').count(), 4);
  assert.ok((await offlineFrame.locator('.sequence-step-code .syntax-token').count()) > 5);
  assert.equal(await offlineFrame.getByRole('button', { name: 'Find definition', exact: true }).count(), 0);
  assert.equal(await offlineFrame.getByRole('button', { name: 'View code', exact: true }).count(), 0);
  assert.match(await offlineFrame.locator('.sequence-code-pane').innerText(), /After · captured comparison evidence/);
  await collapseCycle(offlineFrame, 'offline export');
  // Center within the pane and parent viewport before a real pointer click;
  // locator auto-scroll may leave this button clipped by the outer workspace.
  const offlineLast = offlineFrame.locator('.sequence-step-select').last();
  await offlineLast.evaluate(button => button.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await offline.waitForTimeout(250);
  const offlineBox = await offlineLast.boundingBox();
  assert.ok(offlineBox.x >= 0 && offlineBox.y >= 0 && offlineBox.x + offlineBox.width <= 1440 && offlineBox.y + offlineBox.height <= 1000);
  const traceClicks = () => {
    window.offlinePointerTrace = [];
    for (const type of ['pointerdown', 'pointerup', 'click']) document.addEventListener(type, e => window.offlinePointerTrace.push({ type, tag: e.target.tagName, className: String(e.target.className), control: e.target.closest('.sequence-step-select')?.className, x: e.clientX, y: e.clientY }), true);
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
  assert.ok(offlinePointer.childEvents.filter(e => e.type === 'click' && e.control === 'sequence-step-select').length >= 2);
  record('HTML export works offline with escaped captured evidence and no live-only actions');
  await offline.close();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ results, errors, offlinePointer }, null, 2));
} finally { await browser.close(); }
