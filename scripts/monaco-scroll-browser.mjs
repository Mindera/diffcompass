// Isolated fixture regression: returning to an evicted editor must not resize
// already measured cards or make upward wheel movement appear to reverse.
import { pathToFileURL } from 'node:url';
const [playwrightPath, url] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', headless: true });
const check = (value, message) => { if (!value) throw Error(message); };
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1000 }, colorScheme: 'dark', reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/update', route => route.fulfill({ json: { updateAvailable: false } }));
  await page.goto(url);
  await page.locator('#step-count').filter({hasText:'Step '}).waitFor({state:'attached'});
  await page.locator('#diff-renderer').selectOption('monaco');
  for (const [layout, expanded] of [['split', false], ['unified', false], ['split', true]]) {
    const label = `${layout}${expanded ? ', expanded context' : ''}`;
    await page.locator(`[data-diff-layout="${layout}"]`).click();
    await page.evaluate(() => diffCompassProductionHost.reveal('src/lazy-0.ts', 'new', 81));
    await page.waitForFunction(() => [...document.querySelectorAll('.monaco-review-frame')].some(frame => frame.dataset.monacoPath === 'src/lazy-0.ts' && frame.contentWindow?.diffLab?.views.get('src/lazy-0.ts')?.diff.getLineChanges()?.length));
    if (expanded) {
      const frame = page.frames().find(frame => new URL(frame.url(), url).searchParams.get('file') === 'src/lazy-0.ts');
      await frame.getByRole('button', { name: 'Show all context', exact: true }).click();
    }
    await page.waitForTimeout(800);
    const height = await page.locator('.monaco-file-slot[data-path="src/lazy-0.ts"]').evaluate(node => node.getBoundingClientRect().height);
    await page.evaluate(() => diffCompassProductionHost.reveal('src/lazy-7.ts', 'new', 81));
    await page.waitForFunction(() => !document.querySelector('.monaco-review-frame[data-monaco-path="src/lazy-0.ts"]'));
    await page.waitForTimeout(600);
    const samples = await page.evaluate(async () => {
      const panel = document.getElementById('diff-panel');
      const target = document.querySelector('.monaco-file-slot[data-path="src/lazy-0.ts"]');
      // Bring a previously measured card back through the preload boundary,
      // with the following file as a stationary visual reference.
      const anchor = target.nextElementSibling;
      panel.scrollTop += anchor.getBoundingClientRect().top - panel.getBoundingClientRect().top - 190;
      const samples = [];
      for (let index = 0; index < 100; index++) {
        await new Promise(requestAnimationFrame);
        samples.push({ height: target.getBoundingClientRect().height, anchor: anchor.getBoundingClientRect().top, scroll: panel.scrollTop });
      }
      return samples;
    });
    const range = values => Math.max(...values) - Math.min(...values);
    const variation = range(samples.map(sample => sample.height));
    check(variation <= 2 && Math.abs(samples.at(-1).height - height) <= 2, `${label}: cached card height must stay stable during remount, was ${height}px, varied ${variation}px: ${JSON.stringify(samples.filter((sample, index) => !index || sample.height !== samples[index - 1].height))}`);
    check(range(samples.map(sample => sample.anchor)) <= 2, `${label}: remount must not move the visible file below it: ${JSON.stringify(samples.filter((sample, index) => !index || sample.anchor !== samples[index - 1].anchor))}`);
    console.log(`PASS ${label}: stable card height and reading position through editor eviction/remount`);
    const panel = await page.locator('#diff-panel').boundingBox();
    await page.mouse.move(panel.x + 6, panel.y + panel.height / 2);
    const motion = page.evaluate(async () => {
      const anchor = document.querySelector('.monaco-file-slot[data-path="src/lazy-0.ts"]').nextElementSibling;
      const positions = [];
      for (let index = 0; index < 75; index++) {
        await new Promise(requestAnimationFrame);
        positions.push(anchor.getBoundingClientRect().top);
      }
      return positions;
    });
    for (let index = 0; index < 4; index++) { await page.mouse.wheel(0, -90); await page.waitForTimeout(160); }
    const positions = await motion;
    check(positions.at(-1) > positions[0] + 100, `${label}: upward wheel input moves the page`);
    check(positions.every((top, index) => !index || top >= positions[index - 1] - 2), `${label}: upward scrolling must never reverse visually: ${JSON.stringify(positions)}`);
    console.log(`PASS ${label}: upward wheel scrolling does not reverse while neighbouring cards load`);
  }
  check(!errors.length, 'No browser errors: ' + JSON.stringify(errors));
} catch (error) { console.error(error.stack); process.exitCode = 1; }
finally { await browser.close(); }
