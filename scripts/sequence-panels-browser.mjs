// Isolated actual-pointer regression checks for sequence pane/Paths bounds.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const url = process.argv[2];
if (!url) throw Error('Pass the authenticated fixture URL');
const browser = await chromium.launch({ headless: process.env.SEQUENCE_HEADED !== '1', channel: 'chrome' });
const errors = [], results = [], measurements = [];
const log = value => { results.push(value); console.log(value); };
const settle = page => page.waitForTimeout(300);
async function open(width, height = 1100) {
  const context = await browser.newContext({ viewport: { width, height } }), page = await context.newPage();
  page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(url); await page.locator('#archify-tab').click();
  await page.locator('#archify-select').selectOption('sequence-checkout-flow');
  const frame = await (await page.locator('iframe.archify-frame').elementHandle()).contentFrame();
  await frame.locator('.sequence-step-code').first().waitFor();
  await frame.waitForFunction(() => window.Archify?.view?.state?.().mode === 'review');
  await settle(page); return { context, page, frame };
}
const state = frame => frame.evaluate(() => ({ camera: Archify.view.state(), route: Archify.routeProbe.result(), selected: document.querySelector('.sequence-code-step.selected')?.dataset.sequenceMessageId }));
async function bounds(frame, name) {
  await settle(frame.page());
  const value = await frame.evaluate(() => {
    const panel = document.querySelector('#route-probe'), diagram = document.querySelector('.diagram-container'), nav = diagram.querySelector('.diagram-nav');
    const rect = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
    return { panel: rect(panel), diagram: rect(diagram), nav: rect(nav), hidden: panel.hidden, moved: panel.hasAttribute('data-review-panel-moved'),
      overflow: document.documentElement.scrollWidth > innerWidth, stacked: document.querySelector('.sequence-walkthrough').classList.contains('sequence-walkthrough-stacked'),
      pane: { scroll: document.querySelector('.sequence-code-pane').scrollHeight, height: document.querySelector('.sequence-code-pane').clientHeight, hidden: document.querySelector('.sequence-code-pane').hidden, overflowY: getComputedStyle(document.querySelector('.sequence-code-pane')).overflowY },
      viewport: { width: innerWidth, height: innerHeight } };
  });
  assert.equal(value.hidden, false); assert.equal(value.overflow, false);
  assert.ok(value.panel.width > Math.min(240, value.diagram.width - 26), JSON.stringify(value));
  assert.ok(value.panel.x >= value.diagram.x + 10 && value.panel.right <= value.diagram.right - 10, JSON.stringify(value));
  assert.ok(value.panel.y >= value.diagram.y + 10 && value.panel.bottom <= value.nav.y - 10, JSON.stringify(value));
  if (!value.pane.hidden) { assert.ok(value.pane.height > 0); assert.equal(value.pane.overflowY, 'auto'); } // Offline content may fit without scrolling.
  measurements.push({ name, ...value }); console.log(JSON.stringify({ name, ...value })); return value;
}
async function screenshot(page, name) {
  if (process.env.SEQUENCE_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SEQUENCE_SCREENSHOT_DIR}/${name}.png` });
}
async function choosePath(frame) {
  await frame.locator('#route-probe-find').click();
  await frame.getByRole('button', { name: 'Choose Checkout UI as route start', exact: true }).click();
  await frame.locator('#route-probe-find').click();
  await frame.getByRole('button', { name: /Choose Checkout UI as route destination/ }).click();
  const choices = frame.getByLabel('Choose route');
  const full = await choices.locator('option').evaluateAll(options => options.find(option => /messages 1, 2, 3, 4$/.test(option.textContent))?.value);
  assert.ok(full !== undefined); await choices.selectOption(full);
  await frame.locator('#route-journey-next').click(); await frame.locator('#route-journey-next').click();
  await frame.waitForFunction(() => Archify.routeProbe.result()?.journey === 1);
}
async function themed(frame, theme) {
  if (await frame.locator('html').getAttribute('data-theme') !== theme) await frame.locator('#btn-theme').click();
  await settle(frame.page());
  const value = await frame.evaluate(() => ['.sequence-code-pane', '.sequence-step-code', '#route-probe'].map(selector => {
    const node = document.querySelector(selector), style = getComputedStyle(node);
    return { selector, color: style.scrollbarColor, scheme: style.colorScheme, track: getComputedStyle(node, '::-webkit-scrollbar-track').backgroundColor };
  }));
  for (const scrollbar of value) { assert.equal(scrollbar.scheme, theme); assert.notEqual(scrollbar.color, 'auto'); assert.notEqual(scrollbar.track, 'rgba(0, 0, 0, 0)'); }
  assert.equal(new Set(value.map(v => v.color)).size, 1); return value;
}
try {
  const desktop = await open(2100), { page, frame } = desktop, separator = frame.locator('.sequence-code-resizer');
  await separator.press('End'); await frame.locator('#btn-route-probe').click();
  const initial = await bounds(frame, 'desktop-max-code-source-picker');
  assert.equal(initial.stacked, false); assert.ok(initial.diagram.width < 440); assert.ok(initial.panel.width > 390);
  await choosePath(frame); await bounds(frame, 'desktop-max-code-active-route');
  const camera = (await state(frame)).camera;
  await screenshot(page, 'sequence-paths-desktop-max-code');
  log('427px desktop diagram: Paths uses its available width; ordinary source/destination/route/Next controls work');
  // Drag in a wider diagram, then retain/clamp that saved placement on resize.
  await separator.press('Home'); await settle(page);
  const head = frame.locator('.route-probe-head'); await head.scrollIntoViewIfNeeded();
  const box = await head.boundingBox(); assert.ok(box);
  const x = box.x + 50, y = box.y + 10;
  assert.ok(x >= 0 && y >= 0 && y < page.viewportSize().height);
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 200, y + 130, { steps: 10 });
  assert.equal(await head.evaluate(node => node.hasPointerCapture(1)), true);
  await page.mouse.up(); await settle(page);
  const dragged = await bounds(frame, 'desktop-dragged-panel'); assert.equal(dragged.moved, true);
  assert.equal(await head.evaluate(node => node.hasPointerCapture(1)), false);
  const { route, selected } = await state(frame);
  await separator.press('End'); const clamped = await bounds(frame, 'desktop-dragged-panel-after-shrink');
  assert.ok(clamped.panel.x < dragged.panel.x); assert.deepEqual(await state(frame), { camera, route, selected });
  await frame.locator('#route-journey-next').click(); assert.equal((await state(frame)).route.journey, 2);
  await frame.getByRole('button', { name: 'Hide code', exact: true }).click(); await bounds(frame, 'collapsed-code-path');
  await frame.getByRole('button', { name: 'Show code', exact: true }).click(); await bounds(frame, 'reopened-code-path');
  assert.deepEqual((await state(frame)).camera, camera); assert.equal((await state(frame)).route.journey, 2);
  log('ordinary panel drag releases capture; shrinking, hiding and reopening code keep Paths reachable and preserve camera/route');
  // Theme and input remain native, including both vertical/horizontal scrolling.
  await separator.press('Home'); await settle(page); // Make the long source line overflow naturally.
  const dark = await themed(frame, 'dark');
  const pre = frame.locator('.sequence-step-code').first(); await pre.scrollIntoViewIfNeeded();
  const reading = await state(frame), beforeX = await pre.evaluate(node => node.scrollLeft);
  assert.ok(await pre.evaluate(node => node.scrollWidth > node.clientWidth));
  await pre.hover(); await page.mouse.wheel(450, 0); await settle(page);
  assert.ok(await pre.evaluate(node => node.scrollLeft) > beforeX);
  const pane = frame.locator('.sequence-code-pane'), beforeY = await pane.evaluate(node => node.scrollTop);
  await pane.hover(); await page.mouse.wheel(0, 450); await settle(page);
  assert.ok(await pane.evaluate(node => node.scrollTop) > beforeY); assert.deepEqual(await state(frame), reading);
  await pre.scrollIntoViewIfNeeded(); await screenshot(page, 'sequence-scrollbars-dark');
  const light = await themed(frame, 'light'); assert.notEqual(dark[0].color, light[0].color);
  await screenshot(page, 'sequence-scrollbars-light');
  await page.emulateMedia({ forcedColors: 'active' });
  assert.equal(await pane.evaluate(node => getComputedStyle(node).scrollbarColor), 'auto');
  await page.emulateMedia({ forcedColors: 'none' }); await themed(frame, 'dark');
  log('dark/light vertical, horizontal and Paths scrollbars inherit viewer colors; ordinary wheel scrolling keeps selection, with forced-colors native fallback');
  await separator.press('End'); await settle(page);
  const beforeResize = await state(frame);
  await page.setViewportSize({ width: 1050, height: 1100 }); await bounds(frame, 'resized-narrow-workspace');
  assert.deepEqual(await state(frame), beforeResize);
  await frame.locator('#route-journey-next').click(); assert.equal((await state(frame)).route.journey, 3);
  await frame.locator('#btn-present').click(); await bounds(frame, 'resized-narrow-present');
  assert.deepEqual((await state(frame)).camera, camera); assert.equal((await state(frame)).route.journey, 3);
  await screenshot(page, 'sequence-paths-resized-narrow-present');
  log('same context desktop-to-narrow resize and Present retain the dragged panel, active route and camera; ordinary Next still works');
  await desktop.context.close();
  for (const present of [false, true]) {
    const narrow = await open(600, 900);
    if (present) await narrow.frame.locator('#btn-present').click();
    await narrow.frame.locator('#btn-route-probe').click(); await bounds(narrow.frame, `fresh-narrow-${present ? 'present' : 'workspace'}-source-picker`);
    const initialCamera = (await state(narrow.frame)).camera;
    await choosePath(narrow.frame); await bounds(narrow.frame, `fresh-narrow-${present ? 'present' : 'workspace'}-active-route`);
    assert.deepEqual((await state(narrow.frame)).camera, initialCamera);
    await screenshot(narrow.page, `sequence-paths-fresh-narrow-${present ? 'present' : 'workspace'}`);
    await narrow.context.close();
  }
  log('fresh narrow workspace and Present both show a usable Paths picker and active route using ordinary pointer input');
  const exportPage = await open(1440, 1000);
  const html = await exportPage.page.evaluate(async () => {
    const response = await fetch('/api/export?format=html', { method: 'POST', headers: { 'content-type': 'application/json', 'x-diffcompass-token': sessionStorage.getItem('diffcompass-token') }, body: JSON.stringify({ prepareMissingSteps: false }) });
    if (!response.ok) throw Error(await response.text()); return response.text();
  });
  await exportPage.context.close();
  const offline = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); offline.on('pageerror', error => errors.push(error.message));
  await offline.route('**/*', route => route.abort()); await offline.setContent(html); await offline.locator('[data-view="maps"]').click();
  const element = offline.locator('iframe[title*="sequence:"]'); await element.scrollIntoViewIfNeeded();
  const saved = await (await element.elementHandle()).contentFrame(); await saved.locator('.sequence-step-code').first().waitFor();
  await saved.locator('#btn-present').click(); await saved.locator('.sequence-code-resizer').press('End');
  await saved.locator('#btn-route-probe').click(); await choosePath(saved); await bounds(saved, 'offline-max-code-path');
  await themed(saved, 'dark');
  assert.equal(await saved.getByRole('button', { name: 'View code', exact: true }).count(), 0);
  await screenshot(offline, 'sequence-paths-offline');
  log('offline export retains Paths bounds and themed saved code; ordinary pointer input works without network or live source buttons');
  assert.deepEqual(errors, []); console.log(JSON.stringify({ results, measurements, errors, browser: browser.version(), cwd: process.cwd() }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ completedGroups: results, measurements, errors, browser: browser.version(), cwd: process.cwd() }, null, 2)); throw error;
} finally { await browser.close(); }
