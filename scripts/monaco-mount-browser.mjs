import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
const [playwrightPath, url, repository] = process.argv.slice(2);
assert(/diffcompass-monaco-production-[^/]+\/fixture\/repository$/.test(repository));
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({ headless: true, channel: process.env.CI ? undefined : 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(15000);
let releaseFrame, releaseRefresh, captured = false, refreshed = false;
const frameGate = new Promise(resolve => { releaseFrame = resolve; });
const refreshGate = new Promise(resolve => { releaseRefresh = resolve; });
try {
  await page.route('**/api/update', route => route.fulfill({ json: { updateAvailable: false } }));
  await page.goto(url);
  await page.locator('#step-count').filter({ hasText: 'Step ' }).waitFor();
  const headers = { 'x-diffcompass-token': new URL(url).hash.slice(7) };
  const initialManifest = await page.request.get(new URL('/api/diff/sources', url).href, { headers });
  assert(initialManifest.ok());
  const originalId = (await initialManifest.json()).comparisonId;
  await page.route('**/api/session', async route => {
    if (route.request().frame() === page.mainFrame()) await refreshGate;
    else if (!captured) {
      captured = true;
      await frameGate;
    }
    await route.continue().catch(() => {});
  });
  await page.route('**/api/refresh', async route => {
    const response = await route.fetch(); refreshed = true;
    await refreshGate;
    await route.fulfill({ response }).catch(() => {});
  });
  await page.locator('#diff-renderer').selectOption('monaco');
  for (let i = 0; !captured && i < 500; i++) await page.waitForTimeout(10);
  assert(captured, 'Hold an initial frame session request before refresh');
  await page.evaluate(() => {
    window.mountEvents = [];
    const host = diffCompassProductionHost.forFile('src/cart.ts');
    window.originalMount = host;
    window.originalFrame = document.querySelector('.monaco-review-frame[data-monaco-path="src/cart.ts"]').contentWindow;
    const accept = host.acceptComparison, failed = host.failed;
    host.acceptComparison = session => { const result = accept(session); mountEvents.push({ accept: result, source: session.comparison.sourceTree }); return result; };
    host.failed = message => { mountEvents.push({ failure: message }); return failed(message); };
  });
  await writeFile(join(repository, 'large.ts'), '// forced refresh race\n'.repeat(3000));
  await page.locator('#refresh-button').click();
  for (let i = 0; !refreshed && i < 500; i++) await page.waitForTimeout(10);
  assert(refreshed, 'Server captured the new comparison while the parent response is held');
  releaseFrame();
  await page.waitForFunction(() => mountEvents.some(event => event.accept === false));
  releaseRefresh();
  await page.waitForFunction(() => !document.getElementById('refresh-button').disabled);
  assert.equal(await page.locator('.monaco-review-notice').textContent().then(s => s.includes('could not load')), false, 'An in-flight comparison change must not permanently fail the renderer');
  await page.waitForFunction(() => [...document.querySelectorAll('.monaco-review-frame')].some(frame => frame.dataset.monacoPath === 'src/cart.ts' && frame.contentWindow?.diffLab?.views.has('src/cart.ts')));
  const manifest = await page.request.get(new URL('/api/diff/sources', url).href, { headers });
  assert(manifest.ok());
  const { comparisonId } = await manifest.json();
  assert(await page.evaluate(id => {
    const frame = [...document.querySelectorAll('.monaco-review-frame')].find(frame => frame.dataset.monacoPath === 'src/cart.ts');
    const view = frame.contentWindow.diffLab.views.get('src/cart.ts');
    return ['old', 'new'].every(side => view.editors[side].getModel().uri.toString().includes('/' + id + '/'));
  }, comparisonId), 'Recovered models must belong to the current captured comparison');
  assert(await page.evaluate(() => {
    if (diffCompassProductionHost.forFile('src/cart.ts', originalFrame)) return false;
    originalMount.failed('Late error from the retired mount');
    return !!document.querySelector('.monaco-review-frame[data-monaco-path="src/cart.ts"]')?.contentWindow?.diffLab?.views.has('src/cart.ts');
  }), 'A retired frame cannot bind to or fail its replacement');
  console.log('PASS forced refresh during initial mount recovers the current Monaco model');
  // Returning to the original source later is legitimate, even though an
  // unfinished mount for that same identity was canceled during the race.
  await unlink(join(repository, 'large.ts'));
  const response = page.waitForResponse(response => response.url().endsWith('/api/refresh'));
  await page.locator('#refresh-button').click();
  assert((await response).ok());
  await page.waitForFunction(id => {
    const frame = document.querySelector('.monaco-review-frame[data-monaco-path="src/cart.ts"]');
    const view = frame?.contentWindow?.diffLab?.views.get('src/cart.ts');
    return view && ['old', 'new'].every(side => view.editors[side].getModel().uri.toString().includes('/' + id + '/'));
  }, originalId);
  console.log('PASS a later refresh can return to the previously rejected source identity');
} catch (error) {
  console.error(await page.evaluate(() => ({ events: window.mountEvents, notice: document.querySelector('.monaco-review-notice')?.textContent })));
  await page.screenshot({ path: '/tmp/dc-monaco-mount-failure.png' });
  throw error;
} finally {
  releaseFrame(); releaseRefresh(); await browser.close();
}
