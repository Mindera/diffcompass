// Dedicated, isolated fixture checks; no install and no existing browser profile.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const url = process.argv[2];
if (!url) throw Error('Pass the authenticated fixture URL');
const browser = await chromium.launch({ headless: process.env.SEQUENCE_HEADED !== '1', channel: 'chrome' });
const nativeWindow = process.env.SEQUENCE_NATIVE_WINDOW === '1';
const context = await browser.newContext({ viewport: nativeWindow ? null : { width: 1440, height: 1000 } });
const errors = [], results = [];
const log = text => { results.push(text); console.log(text); };
const settle = page => page.waitForTimeout(220);
async function newPage(owner = context, width = 1440, height = 1000) {
  const page = await owner.newPage();
  if (nativeWindow) {
    const session = await owner.newCDPSession(page);
    const { windowId } = await session.send('Browser.getWindowForTarget');
    const chrome = await page.evaluate(() => ({ width: outerWidth - innerWidth, height: outerHeight - innerHeight }));
    await session.send('Browser.setWindowBounds', { windowId, bounds: { width: width + chrome.width, height: height + chrome.height, windowState: 'normal' } });
    await settle(page);
  }
  return page;
}
async function open(page) {
  page.setDefaultTimeout(15000); page.on('pageerror', e => errors.push(e.message));
  await page.goto(url); await page.locator('#archify-tab').click();
  await page.locator('[data-map-view="sequence"]').click(); await page.locator('#sequence-map-select').selectOption('sequence-checkout-flow');
  const frame = await (await page.locator('#sequence-map-artifacts iframe.archify-frame').elementHandle()).contentFrame();
  await frame.locator('.sequence-step-code').first().waitFor();
  await frame.waitForFunction(() => window.Archify?.view?.state?.().mode === 'review');
  await settle(page); return frame;
}
const measure = frame => frame.evaluate(() => ({ camera: Archify.view.state(), code: document.querySelector('.sequence-code-step.selected')?.dataset.sequenceMessageId, diagram: Archify.focus.relationship()?.id,
  size: Number(document.querySelector('.sequence-code-resizer').getAttribute('aria-valuenow')), orientation: document.querySelector('.sequence-code-resizer').getAttribute('aria-orientation'),
  overflow: document.documentElement.scrollWidth > innerWidth, dragging: document.querySelector('.sequence-code-resizer').classList.contains('dragging'), route: Archify.routeProbe.result(), top: document.querySelector('.sequence-code-pane').scrollTop }));
async function drag(frame, change) {
  const page = frame.page(), handle = frame.locator('.sequence-code-resizer');
  await handle.scrollIntoViewIfNeeded(); await settle(page);
  const before = await measure(frame), box = await handle.boundingBox(); assert.ok(box);
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const viewport = page.viewportSize() || await page.evaluate(() => ({ width: innerWidth, height: innerHeight })); assert.ok(x >= 0 && y >= 0 && x < viewport.width && y < viewport.height, 'Drag target must be visible in the outer viewport');
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x - (before.orientation === 'vertical' ? change : 0), y - (before.orientation === 'horizontal' ? change : 0), { steps: 10 });
  assert.equal(await handle.evaluate(n => n.hasPointerCapture(1)), true);
  await page.mouse.up(); await settle(page);
  const after = await measure(frame);
  const min = Number(await handle.getAttribute('aria-valuemin')), max = Number(await handle.getAttribute('aria-valuemax'));
  assert.equal(after.size, Math.max(min, Math.min(max, before.size + change)));
  assert.deepEqual(after.camera, before.camera); assert.equal(after.code, before.code); assert.equal(after.dragging, false); assert.equal(after.overflow, false);
  return after;
}
async function path(frame) {
  await frame.locator('#btn-route-probe').click();
  await frame.locator('#route-probe-find').click();
  await frame.getByRole('button', { name: 'Choose Checkout UI as route start', exact: true }).click();
  await frame.locator('#route-probe-find').click();
  await frame.getByRole('button', { name: /Choose Checkout UI as route destination/ }).click();
  // The fixture also has a shorter route using messages 1 and 4. Explicitly
  // choose the existing four-message route before asserting all four steps.
  const choices = frame.getByLabel('Choose route');
  const full = await choices.locator('option').evaluateAll(options => options.find(option => /messages 1, 2, 3, 4$/.test(option.textContent))?.value);
  assert.ok(full !== undefined); await choices.selectOption(full);
  await frame.locator('#route-journey-next').waitFor();
}
async function checkSelected(frame, id) {
  await frame.waitForFunction(id => document.querySelector('.sequence-code-step.selected')?.dataset.sequenceMessageId === id, id);
  const selected = frame.locator('.sequence-code-step.selected');
  const visible = await selected.evaluate(node => { const b = node.getBoundingClientRect(), pane = node.closest('.sequence-code-pane').getBoundingClientRect(); return b.top < pane.bottom && b.bottom > pane.top; });
  assert.equal(visible, true);
  if (await selected.locator('.sequence-step-code').count()) assert.equal(await selected.locator('.sequence-step-code').first().evaluate(n => getComputedStyle(n).outlineWidth), '2px');
}
async function screenshot(page, name) { if (process.env.SEQUENCE_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SEQUENCE_SCREENSHOT_DIR}/${name}.png` }); }
try {
  console.log('viewport mode:', nativeWindow ? 'native window' : 'emulated');
  let page = await newPage(), frame = await open(page);
  const initial = await measure(frame);
  await drag(frame, 30); const workspace = await measure(frame);
  assert.equal(workspace.orientation, 'horizontal');
  let sep = frame.locator('.sequence-code-resizer'); await sep.press('ArrowDown'); await settle(page);
  assert.ok((await measure(frame)).size <= workspace.size);
  const savedHeight = (await measure(frame)).size;
  await frame.getByRole('button', { name: 'Hide code', exact: true }).click(); assert.equal(await sep.isVisible(), false);
  await frame.getByRole('button', { name: 'Show code', exact: true }).click(); await settle(page);
  assert.equal((await measure(frame)).size, savedHeight); assert.deepEqual((await measure(frame)).camera, initial.camera);
  log('workspace: real height drag, keyboard resize and collapse restore; no overflow/camera changes');
  await frame.locator('#btn-present').click(); await settle(page);
  assert.equal((await measure(frame)).orientation, 'vertical');
  await sep.press('Home'); const resized = await drag(frame, 180); assert.equal(resized.size, 460);
  await screenshot(page, 'sequence-resized-present');
  await frame.locator('.sequence-step-select').last().click();
  const beforeSource = await measure(frame);
  await frame.locator('.sequence-code-step').last().getByRole('button', { name: 'View code', exact: true }).click();
  await page.locator('#sequence-source-return').click(); await settle(page);
  const afterSource = await measure(frame);
  assert.equal(afterSource.size, 460); assert.deepEqual(afterSource.camera, beforeSource.camera); assert.equal(afterSource.code, beforeSource.code);
  log('Present: real width drag and View code/return preserve width, camera and selected step');
  const another = await newPage(), otherFrame = await open(another);
  assert.equal((await measure(otherFrame)).size, savedHeight);
  await otherFrame.locator('#btn-present').click(); await settle(another); assert.equal((await measure(otherFrame)).size, 460);
  await another.close(); await page.bringToFront();
  log('existing browser preference bridge restores separate width/height in a fresh page');
  // Keep Paths' own interactions independent of the resized-Present/source-
  // return history. The original timeout is retained as separate evidence.
  await page.close(); page = await newPage(); frame = await open(page);
  await frame.locator('#btn-present').click(); await settle(page);
  sep = frame.locator('.sequence-code-resizer');
  const ids = await frame.locator('[data-relationship-id]').evaluateAll(nodes => nodes.map(n => n.dataset.relationshipId));
  await path(frame); await settle(page); assert.equal((await measure(frame)).code, undefined);
  const pathCamera = (await measure(frame)).camera;
  await frame.locator('#route-journey-next').click(); await settle(page); assert.equal((await measure(frame)).code, undefined);
  for (const id of ids) { await frame.locator('#route-journey-next').click(); await checkSelected(frame, id); assert.deepEqual((await measure(frame)).camera, pathCamera); }
  await frame.locator('#route-journey-prev').press('Enter'); await checkSelected(frame, ids[2]);
  assert.equal((await measure(frame)).route.journey, 3);
  const returnCard = frame.locator('.sequence-code-step.selected');
  assert.equal(await returnCard.locator('.sequence-step-code').count(), 1);
  assert.deepEqual(await returnCard.locator('.sequence-step-line').allTextContents(), ['16', '17']);
  assert.equal((await returnCard.locator('.sequence-code-counts').innerText()).replace(/\s/g, ''), '+2−0');
  assert.match(await returnCard.locator('.sequence-step-source').innerText(), /src\/cart\.ts:16–17$/);
  assert.equal(await returnCard.getByRole('button', { name: 'View code', exact: true }).count(), 1);
  await screenshot(page, 'sequence-path-return-highlight');
  log('Paths Next/Previous: exact calls/returns highlight their code; adjacent return anchors form one listing with lines 16–17, +2 and one source action; no camera movement');
  async function contrast(expectedId) {
    // Preserve native opacity transitions; inspect their settled contrast.
    await frame.waitForFunction(id => [...document.querySelectorAll('[data-edge-id][data-route-step]')].every(edge => Number(getComputedStyle(edge).opacity) === (edge.getAttribute('data-edge-id') === id ? 1 : .22)), expectedId);
    const state = await frame.evaluate(() => ({
      edges: [...document.querySelectorAll('[data-edge-id][data-route-step]')].map(edge => ({ id: edge.getAttribute('data-edge-id'), current: edge.hasAttribute('data-sequence-route-current'), opacity: Number(getComputedStyle(edge).opacity), filter: getComputedStyle(edge).filter, weight: getComputedStyle(edge.querySelector('text')).fontWeight })),
      overlay: getComputedStyle(document.querySelector('.route-probe-overlay')).display,
    }));
    assert.equal(state.overlay, 'none');
    assert.equal(state.edges.filter(edge => edge.current).length, 1);
    for (const edge of state.edges) {
      assert.equal(edge.current, edge.id === expectedId);
      assert.equal(edge.opacity, edge.current ? 1 : .22); assert.equal(edge.filter, 'none');
      if (edge.current) assert.equal(edge.weight, '700');
    }
  }
  await contrast(ids[2]);
  await screenshot(page, 'sequence-current-return-contrast');
  await frame.locator('#btn-theme').click(); await settle(page); await contrast(ids[2]);
  await page.waitForTimeout(850); // Capture persistent emphasis after the native current pulse ends.
  await screenshot(page, 'sequence-current-return-dark');
  if (process.env.SEQUENCE_SCREENSHOT_DIR) await returnCard.screenshot({ path: `${process.env.SEQUENCE_SCREENSHOT_DIR}/sequence-grouped-return-card.png` });
  await frame.locator('#btn-theme').click(); await settle(page);
  log('current return stays full contrast with a bold caption in light/dark themes, including after its pulse; past/future arrows dim to 22%, and overview glow is absent during the journey');
  for (const [index, region] of [[0, 'background'], [3, 'label'], [1, 'code'], [2, 'heading'], [2, 'background']]) {
    const card = frame.locator('.sequence-code-step').nth(index);
    await frame.evaluate(() => document.addEventListener('click', () => { window.cardScrollReceipt = document.querySelector('.sequence-code-pane').scrollTop; }, { capture: true, once: true }));
    if (region === 'background') await card.click({ position: { x: 6, y: 6 } });
    else if (region === 'label') await card.locator('.sequence-step-source').first().click();
    else if (region === 'code') await card.locator('.sequence-step-source-text').first().click();
    else await card.locator('.sequence-step-select').click();
    await checkSelected(frame, ids[index]);
    const state = await measure(frame);
    assert.equal(state.route.journey, index + 1); assert.equal(state.route.playing, false); assert.deepEqual(state.camera, pathCamera);
    assert.equal(await frame.getByLabel('Choose route').inputValue(), '1');
    if (region !== 'heading') assert.equal(state.top, await frame.evaluate(() => window.cardScrollReceipt));
    await contrast(ids[index]);
  }
  await frame.locator('.sequence-step-select').nth(2).press('Home'); await checkSelected(frame, ids[0]);
  await frame.locator('.sequence-step-select').first().press('End'); await checkSelected(frame, ids[3]);
  assert.equal((await measure(frame)).route.journey, 4); assert.deepEqual((await measure(frame)).camera, pathCamera);
  log('ordinary card background, source label, code and heading clicks navigate exact path positions both ways; repeated click and keyboard Home/End retain the chosen route/camera');
  // The long one-line signature must stay selectable while its horizontal
  // scrollbar is active, including the lower part of the glyphs.
  const text = frame.locator('.sequence-code-step').first().locator('.sequence-step-source-text').first();
  await text.scrollIntoViewIfNeeded(); const textBox = await text.boundingBox(); assert.ok(textBox);
  const dragGeometry = await text.evaluate(node => {
    const box = node.getBoundingClientRect();
    const hits = document.elementsFromPoint(box.x + 4, box.y + box.height / 2);
    return { box: box.toJSON(), hits: hits.map(n => n.tagName + '.' + n.className), textHit: node.contains(hits[0]), lowerTextHit: node.contains(document.elementFromPoint(box.x + 4, box.bottom - 1)), pane: node.closest('.sequence-code-pane').getBoundingClientRect().toJSON(), selection: getComputedStyle(node).userSelect };
  });
  assert.equal(dragGeometry.textHit, true, 'Text drag must start on visible code, not a scrollbar or overlay');
  assert.equal(dragGeometry.lowerTextHit, true, 'Horizontal scrollbar must not cover the bottom of the code line');
  await frame.evaluate(() => {
    window.textDragTrace = [];
    for (const type of ['pointerdown', 'pointerup', 'click']) document.addEventListener(type, event => window.textDragTrace.push({ type, target: event.target.tagName + '.' + event.target.className, x: event.clientX, y: event.clientY, selection: getSelection().toString() }), { once: true, capture: true });
  });
  const beforeText = await measure(frame);
  await page.mouse.move(textBox.x + 4, textBox.y + textBox.height / 2); await page.mouse.down();
  await page.mouse.move(textBox.x + 72, textBox.y + textBox.height / 2, { steps: 8 }); await page.mouse.up(); await settle(page);
  const copiedText = await frame.evaluate(() => getSelection().toString());
  if (!copiedText) {
    console.error('text drag failed', JSON.stringify({ textBox, dragGeometry, trace: await frame.evaluate(() => window.textDragTrace) }));
    await screenshot(page, 'sequence-text-drag-failure');
  }
  assert.ok(copiedText);
  assert.equal((await measure(frame)).code, beforeText.code); assert.deepEqual((await measure(frame)).route, beforeText.route);
  await frame.locator('.sequence-code-pane h2').click();
  log('ordinary text drag still selects copyable code without changing the path or selected message');
  await frame.getByLabel('Choose route').selectOption('0'); await settle(page);
  await frame.locator('.sequence-code-step').last().click({ position: { x: 6, y: 6 } }); await checkSelected(frame, ids[3]);
  const shortRoute = await measure(frame); assert.equal(shortRoute.route.journey, 2);
  await frame.locator('.sequence-code-step').nth(1).locator('.sequence-step-source').click(); await settle(page);
  assert.deepEqual((await measure(frame)).route, shortRoute.route); assert.equal((await measure(frame)).code, ids[3]);
  await frame.locator('.sequence-code-step').nth(1).locator('.sequence-step-selection-notice').waitFor({ state: 'visible' });
  await frame.locator('.sequence-code-step').nth(1).getByRole('button', { name: 'View code', exact: true }).click();
  await page.locator('#sequence-source-return').click(); await settle(page);
  assert.deepEqual((await measure(frame)).route, shortRoute.route); assert.equal((await measure(frame)).code, ids[3]);
  assert.equal(await frame.getByLabel('Choose route').inputValue(), '0');
  await frame.locator('#route-journey-overview').click(); await settle(page);
  assert.equal((await measure(frame)).code, undefined);
  const rejectedCard = frame.locator('.sequence-code-step').nth(1);
  await rejectedCard.locator('.sequence-step-source').click();
  await rejectedCard.locator('.sequence-step-selection-notice').waitFor({ state: 'visible' });
  const beforePathExit = await measure(frame);
  await frame.locator('#btn-route-probe').click(); await settle(page);
  assert.equal(await frame.evaluate(() => Boolean(Archify.routeProbe.active())), false);
  assert.equal(await frame.locator('.sequence-step-selection-notice:visible').count(), 0);
  assert.equal((await measure(frame)).code, undefined); assert.equal((await measure(frame)).top, beforePathExit.top);
  assert.deepEqual((await measure(frame)).camera, beforePathExit.camera);
  // An unfinished picker has no selected message either; repeated toggles
  // must dismiss its rejection without waiting for another code selection.
  await frame.locator('#btn-route-probe').click();
  await rejectedCard.locator('.sequence-step-source').click();
  await rejectedCard.locator('.sequence-step-selection-notice').waitFor({ state: 'visible' });
  await frame.locator('#btn-route-probe').click(); await settle(page);
  assert.equal(await frame.locator('.sequence-step-selection-notice:visible').count(), 0);
  log('disabling Paths clears off-route and unfinished-picker notices with no selected message, preserving code scroll and camera');
  await path(frame);
  await frame.locator('.sequence-step-select').nth(2).click(); await checkSelected(frame, ids[2]);
  log('off-route card click shows a notice and retains the shorter chosen route; its View code/return still works without inventing a route position');
  const beforeReading = await measure(frame);
  await frame.locator('.sequence-code-pane').hover(); await page.mouse.wheel(0, -500); await settle(page);
  const afterReading = await measure(frame);
  assert.notEqual(afterReading.top, beforeReading.top); assert.equal(afterReading.code, beforeReading.code);
  assert.deepEqual(afterReading.route, beforeReading.route); assert.deepEqual(afterReading.camera, beforeReading.camera);
  log('scrolling code while Paths is paused changes only the reading position, preserving the route and selected message');
  async function sourceDetour(button, waitWhileAway = false) {
    await frame.evaluate(() => {
      window.pathSourceReceipt = null;
      function receipt(event) {
        if (event.target.closest('.sequence-code-step button')?.textContent !== 'View code') return;
        window.pathSourceReceipt = { route: Archify.routeProbe.result(), camera: Archify.view.state(), code: event.target.closest('.sequence-code-step').dataset.sequenceMessageId };
        document.removeEventListener('click', receipt, true);
      }
      document.addEventListener('click', receipt, true);
    });
    await button.click(); await page.locator('#sequence-source-return').waitFor({ state: 'visible' });
    const receipt = await frame.evaluate(() => window.pathSourceReceipt); assert.ok(receipt?.route);
    if (receipt.code === ids[2]) {
      // Navigate to the original lowest-line anchor and highlight every
      // validated member of the grouped listing, including the second line.
      await page.locator('.diff-file[data-path="src/cart.ts"] .sequence-source-highlight[data-side="new"][data-line="16"]').waitFor({ state: 'visible' });
      assert.equal(await page.locator('.diff-file[data-path="src/cart.ts"] .sequence-source-highlight[data-side="new"][data-line="17"]').count(), 1);
      await page.waitForFunction(() => {
        const row = document.querySelector('.diff-file[data-path="src/cart.ts"] .sequence-source-highlight[data-side="new"][data-line="16"]');
        const panel = document.getElementById('diff-panel').getBoundingClientRect(), box = row?.getBoundingClientRect();
        return box && box.top >= panel.top + 60 && box.bottom <= Math.min(panel.bottom, innerHeight);
      });
      await screenshot(page, 'sequence-grouped-diff-highlight');
    }
    const expected = { ...receipt.route, journey: ids.indexOf(receipt.code) + 1, playing: false };
    if (waitWhileAway) await page.waitForTimeout(1350);
    assert.deepEqual((await measure(frame)).route, expected);
    await page.locator('#sequence-source-return').click(); await settle(page);
    const returned = await measure(frame);
    assert.deepEqual(returned.route, expected); assert.deepEqual(returned.camera, receipt.camera); assert.equal(returned.code, receipt.code);
    assert.equal(await frame.evaluate(() => Archify.presentation.active()), true);
    return receipt;
  }
  await sourceDetour(frame.locator('.sequence-code-step.selected').getByRole('button', { name: 'View code', exact: true }));
  // View code selects that card's exact hop before taking the source detour.
  await sourceDetour(frame.locator('.sequence-code-step').nth(1).getByRole('button', { name: 'View code', exact: true }));
  log('Paths View code: current/multiple anchors and another step retain the chosen route at the clicked message, with its highlight, Present and camera on return');
  const beforeFailure = await measure(frame);
  await page.route('**/api/sequence-sources/*?edge=*', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture source temporarily unavailable' }) }));
  await Promise.all([
    page.waitForResponse(response => response.url().includes('/api/sequence-sources/') && response.status() === 503),
    frame.locator('.sequence-code-step.selected').getByRole('button', { name: 'View code', exact: true }).first().click(),
  ]);
  await settle(page); await page.unroute('**/api/sequence-sources/*?edge=*');
  assert.deepEqual((await measure(frame)).route, beforeFailure.route); assert.deepEqual((await measure(frame)).camera, beforeFailure.camera);
  assert.equal(await page.locator('#sequence-source-return').isVisible(), false);
  await sourceDetour(frame.locator('.sequence-code-step.selected').getByRole('button', { name: 'View code', exact: true }).first());
  log('Paths source failure retains the map/path; retry and return succeed without rebuilding the route');
  const pathBefore = await measure(frame); await drag(frame, 40);
  await frame.getByRole('button', { name: 'Hide code', exact: true }).click();
  await frame.getByRole('button', { name: 'Show code', exact: true }).click(); await settle(page);
  assert.deepEqual((await measure(frame)).route, pathBefore.route); assert.equal((await measure(frame)).code, pathBefore.code);
  await frame.locator('#route-journey-overview').click(); await settle(page); assert.equal((await measure(frame)).code, undefined);
  await frame.locator('#route-journey-play').click(); await checkSelected(frame, ids[0]); await checkSelected(frame, ids[1]);
  assert.equal((await measure(frame)).route.playing, true);
  await contrast(ids[1]);
  await frame.locator('.sequence-code-step').last().click({ position: { x: 6, y: 6 } }); await checkSelected(frame, ids[3]);
  assert.equal((await measure(frame)).route.playing, false); assert.equal((await measure(frame)).route.journey, 4);
  await frame.locator('#route-journey-overview').click();
  await frame.locator('#route-journey-play').click(); await checkSelected(frame, ids[0]); await checkSelected(frame, ids[1]);
  log('card selection during live playback pauses at the clicked message, while passive playback keeps code and arrow emphasis synchronized');
  const playingSource = await sourceDetour(frame.locator('.sequence-code-step.selected').getByRole('button', { name: 'View code', exact: true }).first(), true);
  assert.equal(playingSource.route.playing, true);
  const paused = await measure(frame); await page.waitForTimeout(1350);
  assert.equal((await measure(frame)).code, paused.code); assert.deepEqual((await measure(frame)).camera, pathCamera);
  await frame.locator('#route-journey-play').click(); await frame.waitForFunction(index => Archify.routeProbe.result()?.journey !== index, paused.route.journey);
  await frame.locator('#route-journey-play').click();
  log('View code pauses active playback before source navigation; it stays at that position while away/after return, and Journey resumes normally');
  await frame.locator('#route-probe-clear').click(); await settle(page); assert.equal((await measure(frame)).code, undefined);
  log('Paths playback updates code without stopping playback; pause is stable, overview/clear remove stale highlights; resize/collapse preserve Paths');
  await path(frame); await frame.locator('.sequence-step-select').nth(2).click(); await checkSelected(frame, ids[2]);
  await frame.locator('#btn-motion').click(); await settle(page); await contrast(ids[2]);
  await page.emulateMedia({ reducedMotion: 'reduce' }); await settle(page);
  await frame.locator('.sequence-step-select').nth(1).click(); await checkSelected(frame, ids[1]); await contrast(ids[1]);
  await screenshot(page, 'sequence-current-call-reduced-motion');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await frame.locator('#route-journey-overview').click(); await settle(page);
  assert.notEqual(await frame.locator('.route-probe-overlay').evaluate(node => getComputedStyle(node).display), 'none');
  assert.equal(await frame.locator('[data-sequence-route-current]').count(), 0);
  await frame.locator('#route-probe-clear').click();
  log('Motion off/reduced-motion keep persistent current-arrow emphasis; Overview restores the full-route overlay and clears per-message emphasis');
  await sep.press('End'); assert.equal((await measure(frame)).size, 900);
  await sep.press('Enter'); assert.equal((await measure(frame)).size, 420);
  const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem('diffcompass-map-preferences'))); assert.equal(prefs.sequenceCodeWidth, 0);
  log('keyboard limits and Enter reset persist using existing preference storage');
  const narrowContext = await browser.newContext({ viewport: nativeWindow ? null : { width: 600, height: 900 } }), narrow = await newPage(narrowContext, 600, 900), narrowFrame = await open(narrow);
  await drag(narrowFrame, 30); await narrowFrame.locator('#btn-present').click(); await settle(narrow);
  await drag(narrowFrame, 40); assert.equal((await measure(narrowFrame)).orientation, 'horizontal');
  await screenshot(narrow, 'sequence-resized-narrow-present');
  await path(narrowFrame); const narrowCamera = (await measure(narrowFrame)).camera;
  await narrowFrame.locator('.sequence-code-step').nth(2).locator('.sequence-step-source').first().click(); await checkSelected(narrowFrame, ids[2]);
  assert.equal((await measure(narrowFrame)).route.journey, 3); assert.deepEqual((await measure(narrowFrame)).camera, narrowCamera);
  await screenshot(narrow, 'sequence-card-path-narrow-present'); await narrowContext.close();
  log('fresh narrow workspace and Present: real height dragging remains bounded and scrollable; a source-label click selects the exact path step without changing camera');
  const exported = await page.evaluate(async () => {
    const response = await fetch('/api/export?format=html', { method: 'POST', headers: { 'content-type': 'application/json', 'x-diffcompass-token': sessionStorage.getItem('diffcompass-token') }, body: JSON.stringify({ prepareMissingSteps: false }) });
    if (!response.ok) throw Error(await response.text()); return response.text();
  });
  const offline = await newPage(await browser.newContext({ viewport: nativeWindow ? null : { width: 1440, height: 1000 } })); offline.on('pageerror', e => errors.push(e.message));
  await offline.route('**/*', route => route.abort()); await offline.setContent(exported); await offline.locator('[data-view="maps"]').click();
  const offlineElement = offline.locator('iframe[title*="sequence:"]'); await offlineElement.scrollIntoViewIfNeeded();
  const offlineFrame = await (await offlineElement.elementHandle()).contentFrame(); await offlineFrame.locator('.sequence-step-code').first().waitFor();
  await offlineFrame.locator('#btn-present').click(); await settle(offline);
  await path(offlineFrame); await offlineFrame.locator('#route-journey-next').click(); await offlineFrame.locator('#route-journey-next').click();
  await checkSelected(offlineFrame, ids[0]); await offlineFrame.locator('#route-journey-next').click(); await checkSelected(offlineFrame, ids[1]);
  assert.ok(await offlineFrame.locator('.sequence-code-step.selected .syntax-token').count());
  const offlineReturn = offlineFrame.locator('.sequence-code-step').nth(2);
  assert.equal(await offlineReturn.locator('.sequence-step-code').count(), 1);
  assert.deepEqual(await offlineReturn.locator('.sequence-step-line').allTextContents(), ['16', '17']);
  assert.equal((await offlineReturn.locator('.sequence-code-counts').innerText()).replace(/\s/g, ''), '+2−0');
  await offlineFrame.locator('.sequence-code-step').last().locator('.sequence-step-source').click(); await checkSelected(offlineFrame, ids[3]);
  assert.equal((await measure(offlineFrame)).route.journey, 4);
  assert.equal(await offlineFrame.locator('[data-sequence-route-current]').getAttribute('data-edge-id'), ids[3]);
  assert.equal(await offlineFrame.locator('.route-probe-overlay').evaluate(node => getComputedStyle(node).display), 'none');
  const offlineRoute = (await measure(offlineFrame)).route;
  await drag(offlineFrame, 80); assert.deepEqual((await measure(offlineFrame)).route, offlineRoute);
  await offlineFrame.getByLabel('Choose route').selectOption('0');
  await settle(offline); assert.equal((await measure(offlineFrame)).code, undefined); // Choosing a route already returns to Overview.
  await offlineFrame.locator('.sequence-code-step').nth(1).locator('.sequence-step-source').click();
  await offlineFrame.locator('.sequence-step-selection-notice:visible').waitFor();
  await offlineFrame.locator('#btn-route-probe').click(); await settle(offline);
  assert.equal(await offlineFrame.locator('.sequence-step-selection-notice:visible').count(), 0);
  log('offline HTML: ordinary pointer resizing and whole-card path navigation retain saved syntax and current-arrow emphasis without network');
  assert.deepEqual(errors, []); console.log(JSON.stringify({ results, errors, browser: browser.version(), cwd: process.cwd() }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ completedGroups: results, errors, browser: browser.version(), cwd: process.cwd() }, null, 2));
  throw error;
} finally { await browser.close(); }
