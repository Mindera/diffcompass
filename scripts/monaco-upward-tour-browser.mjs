// A late measurement above the viewport must not cancel upward navigation.
// Use the disposable PR fixture; the real review is never changed here.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const [playwrightPath, url] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 800 }, reducedMotion: 'no-preference' });
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const earlier = 'src/cart.ts', later = 'src/context-example.ts';

// Put the first stop well below the second, within the same phase. Keep the
// server's step identities so its ordinary Next/Previous endpoints still run.
await page.route(/\/api\/(session|tour\/navigate)$/, async route => {
  const response = await route.fetch(), session = await response.json();
  session.outline.phases[0].steps[0].anchor = { path: later, side: 'new', startLine: 80, endLine: 82 };
  await route.fulfill({ response, json: session });
});

async function at(index) {
  await page.waitForFunction(index => document.querySelector('#step-count').textContent.includes(`(Step ${index + 1})`)
    && !document.querySelector('#next-step').disabled && document.querySelector('#current-step-return').classList.contains('hidden'), index);
}

async function belowTarget() {
  await page.evaluate(path => window.diffCompassProductionHost.reveal(path, 'new', 80), later);
  await page.waitForFunction(path => {
    const slot = [...document.querySelectorAll('.monaco-file-slot')].find(node => node.dataset.path === path);
    return slot.getBoundingClientRect().bottom < document.querySelector('.diff-toolbar').getBoundingClientRect().bottom;
  }, earlier);
}

async function delayMeasurement() {
  await page.evaluate(path => {
    const panel = document.querySelector('#diff-panel'), scrollTo = panel.scrollTo.bind(panel);
    window.lateMeasurement = null;
    panel.scrollTo = options => {
      scrollTo(options);
      if (options.behavior !== 'smooth' || options.top >= panel.scrollTop) return;
      panel.scrollTo = scrollTo;
      // Deliver a child height report just after native smooth scrolling
      // starts, as happens when an evicted editor finishes its banner layout.
      requestAnimationFrame(() => {
        const frame = [...document.querySelectorAll('.monaco-review-frame')].find(node => node.dataset.monacoPath === path);
        const host = window.diffCompassProductionHost.forFile(path, frame.contentWindow);
        const before = panel.scrollTop, height = frame.getBoundingClientRect().height;
        const above = frame.closest('.monaco-file-slot').getBoundingClientRect().bottom < document.querySelector('.diff-toolbar').getBoundingClientRect().bottom;
        host.contentSizeChanged(height + 59); // The parent adds its 2px frame inset.
        window.lateMeasurement = { before, after: panel.scrollTop, above };
      });
    };
  }, earlier);
}

async function revealed(label) {
  await at(1);
  // Current step can hide as soon as any highlighted code enters the viewport;
  // the heading reaches its destination later in the smooth animation.
  await page.waitForFunction(path => {
    const frame = [...document.querySelectorAll('.monaco-review-frame')].find(node => node.dataset.monacoPath === path);
    const banner = frame?.contentDocument.querySelector('[data-tour-state="current"]');
    if (!banner) return false;
    const top = frame.getBoundingClientRect().top + banner.getBoundingClientRect().top;
    return top >= document.querySelector('.diff-toolbar').getBoundingClientRect().bottom
      && top < document.querySelector('#diff-panel').getBoundingClientRect().bottom;
  }, earlier);
  const result = await page.evaluate(path => {
    const frame = [...document.querySelectorAll('.monaco-review-frame')].find(node => node.dataset.monacoPath === path);
    const banner = frame?.contentDocument.querySelector('[data-tour-state="current"]');
    const top = frame && banner ? frame.getBoundingClientRect().top + banner.getBoundingClientRect().top : null;
    return { measurement: window.lateMeasurement, top, toolbar: document.querySelector('.diff-toolbar').getBoundingClientRect().bottom, bottom: document.querySelector('#diff-panel').getBoundingClientRect().bottom };
  }, earlier);
  assert.ok(result.measurement?.above, label + ': exercise a late measurement above the viewport');
  assert.equal(result.measurement.after, result.measurement.before, label + ': layout must not overwrite the active scroll');
  assert.ok(result.top >= result.toolbar && result.top < result.bottom, label + ': current banner is visible');
}

try {
  await page.goto(url);
  await page.locator('#step-count').filter({ hasText: 'Step 1)' }).waitFor();
  await page.locator('#diff-renderer').selectOption('monaco');
  for (const layout of ['split', 'unified']) {
    await page.locator(`[data-diff-layout="${layout}"]`).click();
    await belowTarget();
    await delayMeasurement();
    await page.locator('#next-step').click();
    await revealed(layout + ' Next');

    await belowTarget();
    await delayMeasurement();
    await page.locator('#current-step-return').click();
    await revealed(layout + ' Current step');

    await belowTarget();
    await delayMeasurement();
    await page.evaluate(path => window.diffCompassProductionHost.reveal(path), earlier);
    await page.waitForFunction(path => {
      const slot = [...document.querySelectorAll('.monaco-file-slot')].find(node => node.dataset.path === path);
      const top = slot.getBoundingClientRect().top;
      return top >= document.querySelector('.diff-toolbar').getBoundingClientRect().bottom
        && top < document.querySelector('#diff-panel').getBoundingClientRect().bottom;
    }, earlier);
    const fileReveal = await page.evaluate(() => window.lateMeasurement);
    assert.ok(fileReveal?.above);
    assert.equal(fileReveal.after, fileReveal.before, layout + ': late sizing does not cancel file navigation');
    await page.locator('#previous-step').click();
    await at(0);
    console.log(`PASS ${layout}: upward Next, Current step and file navigation survive late editor sizing`);
  }
  assert.deepEqual(errors, []);
} catch (error) {
  await page.screenshot({ path: '/tmp/dc-upward-tour-failure.png' });
  console.error(error.stack); console.error('PAGE_ERRORS', errors); process.exitCode = 1;
} finally { await browser.close(); }
