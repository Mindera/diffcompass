// Raw mouse coverage. Use a NEW disposable integration fixture, never a user review.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { setDiagramViewport } from './archify-browser-viewport.mjs';

const [playwrightPath, url] = process.argv.slice(2);
if (!playwrightPath || !url) throw Error('Supply an installed Playwright module and fixture URL.');
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
// Optional negative control retains a failing assertion; it is never a retry.
const resize = process.env.DIAGRAM_RAW_VIEWPORT === '1'
  ? (page, size) => page.setViewportSize(size)
  : setDiagramViewport;
let page;
const settle = frame => frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function pointerClick(frame, selector) {
  const target = frame.locator(selector);
  await target.scrollIntoViewIfNeeded();
  await settle(frame);
  const box = await target.boundingBox();
  assert.ok(box, `Visible target: ${selector}`);
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1,
    `${selector} is inside the actual viewport`);
  const count = await frame.evaluate(() => window.diagramPointerClicks.length);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await frame.waitForFunction(previous => window.diagramPointerClicks.length > previous, count);
  assert.equal(await frame.evaluate(() => window.diagramPointerClicks.at(-1).trusted), true);
}

async function exerciseCamera(frame) {
  await pointerClick(frame, '[data-diffcompass-action="fit"]');
  const fitted = await frame.evaluate(() => Archify.view.state());
  await pointerClick(frame, '[data-diffcompass-action="in"]');
  await frame.waitForFunction(scale => Archify.view.state().scale > scale, fitted.scale);
  await pointerClick(frame, '[data-diffcompass-action="out"]');
  await frame.waitForFunction(scale => Math.abs(Archify.view.state().scale - scale) < .0001, fitted.scale);
  await pointerClick(frame, '[data-diffcompass-action="fit"]');
  await pointerClick(frame, 'g[data-node-id="Failed"]');
  await frame.waitForFunction(() => document.querySelector('#focus-id')?.textContent === 'Failed');
  await pointerClick(frame, '#btn-focus-clear');

  // Use an empty point in the canvas padding, clear of nodes and controls.
  const container = frame.locator('.diagram-container');
  await container.scrollIntoViewIfNeeded();
  const box = await container.boundingBox();
  const start = { x: box.x + 8, y: box.y + box.height / 2 };
  assert.ok(await container.evaluate(el => {
    const r = el.getBoundingClientRect();
    return document.elementFromPoint(r.x + 8, r.y + r.height / 2) === el;
  }), 'Pan starts on unobstructed canvas');
  const before = await frame.evaluate(() => Archify.view.state());
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 40, start.y + 24, { steps: 6 });
  await page.mouse.up();
  await frame.waitForFunction(previous => {
    const current = Archify.view.state();
    return Math.abs(current.x - previous.x - 40) < 2 && Math.abs(current.y - previous.y - 24) < 2;
  }, before);
  assert.equal(await frame.locator('.diagram-container').evaluate(el => el.classList.contains('is-panning')), false);
  await pointerClick(frame, '[data-diffcompass-action="fit"]');
}

try {
  console.log(`Chrome ${browser.version()}; real mouse input; raw viewport control: ${process.env.DIAGRAM_RAW_VIEWPORT === '1'}`);
  for (const size of [{ width: 1500, height: 1050 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport: size, colorScheme: 'dark' });
    await context.addInitScript(() => {
      window.diagramPointerClicks = [];
      document.addEventListener('click', event => window.diagramPointerClicks.push({
        trusted: event.isTrusted, target: event.target.tagName, id: event.target.id,
      }), true);
    });
    page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.stack));
    await resize(page, size);
    const smaller = { width: size.width - 20, height: size.height - 50 };

    // Independent control: no DiffCompass, Archify, camera or presentation code.
    // This also catches a broken pointer environment before testing the product.
    await page.setContent(`<style>html,body{margin:0}iframe{position:fixed;inset:0;width:100vw;height:100dvh;border:0}</style>
      <iframe sandbox="allow-scripts" srcdoc="<style>button{position:fixed;right:20px;bottom:20px;width:70px;height:40px}</style><button onclick='this.dataset.clicks=String(Number(this.dataset.clicks||0)+1)'>Click</button>"></iframe>`);
    const plain = await (await page.locator('iframe').elementHandle()).contentFrame();
    await plain.locator('button').waitFor();
    // srcdoc is created after setContent; the context's init script runs there.
    await pointerClick(plain, 'button');
    assert.equal(await plain.locator('button').getAttribute('data-clicks'), '1');
    await resize(page, smaller);
    await resize(page, size);
    await pointerClick(plain, 'button');
    assert.equal(await plain.locator('button').getAttribute('data-clicks'), '2');
    console.log(`PASS ${size.width}px plain sandboxed iframe receives bottom-edge clicks before and after resize`);

    await page.goto(url);
    await page.waitForFunction(() => window.diffCompassIntegration?.child);
    await page.locator('#archify-tab').click();
    await page.locator('[data-map-view=adaptive]').click();
    await page.locator('#adaptive-map-select').selectOption('lifecycle-state-machine');
    if (await page.evaluate(() => document.body.classList.contains('file-panel-open'))) await page.locator('#file-panel-close').click();
    const iframe = page.locator('#adaptive-map-artifacts iframe.archify-frame');
    const handle = await iframe.elementHandle();
    const frame = await handle.contentFrame();
    await frame.waitForFunction(() => window.Archify?.view?.state().mode === 'review');
    await iframe.scrollIntoViewIfNeeded();
    await settle(frame);
    assert.equal(await frame.locator('g[data-node-id]').count(), 5);
    assert.equal(await frame.locator('path[data-edge-from]').count(), 7);
    assert.equal(await iframe.getAttribute('sandbox'), 'allow-scripts allow-downloads');

    for (let cycle = 0; cycle < 2; cycle++) {
      await resize(page, smaller);
      await resize(page, size);
      await exerciseCamera(frame);
      await pointerClick(frame, '#btn-present');
      await frame.waitForFunction(() => Archify.presentation.active());
      await resize(page, smaller);
      await resize(page, size);
      await exerciseCamera(frame);
      await pointerClick(frame, '#btn-present');
      await frame.waitForFunction(() => !Archify.presentation.active());
      await exerciseCamera(frame);
      assert.equal(await handle.evaluate(el => el.isConnected), true, 'The same iframe survives resize and presentation');
      assert.equal(await iframe.getAttribute('popover'), null);
      assert.equal(await page.locator('#archify-tab').evaluate(el => el.closest('[inert]') === null), true, 'Presentation restores access to the parent UI');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      console.log(`PASS ${size.width}px cycle ${cycle + 1}: mouse zoom/Fit, node inspection, canvas drag, inline/expanded resize and close`);
    }
    await page.screenshot({ path: `/tmp/dc-lifecycle-pointer-${size.width}.png` });
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log('PAGE_ERRORS []');
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: '/tmp/dc-lifecycle-pointer-failure.png' });
    for (const frame of page.frames()) console.error('POINTER_TRACE', frame.url(), await frame.evaluate(() => window.diagramPointerClicks));
  }
  console.error('FAIL', error.stack);
  console.error('PAGE_ERRORS', errors);
  process.exitCode = 1;
} finally {
  await browser.close();
}
