// Run against a disposable fixture: exercises native headers, including PNG
// cards interleaved with Monaco, without changing any source files.
import { pathToFileURL } from 'node:url';
const [playwrightPath, url] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', headless: true });
const check = (ok, message) => { if (!ok) throw Error(message); };
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1000 }, colorScheme: 'dark', reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/update', route => route.fulfill({ json: { updateAvailable: false } }));
  await page.goto(url);
  await page.locator('#diff-renderer').waitFor();
  await page.evaluate(() => diffCompassProductionHost.reveal('screens/receipt.png', 'new', 1));
  await page.locator('#review-filter').selectOption('');
  const card = page.locator('#diff > .diff-file[data-path="screens/receipt.png"]');
  const toggle = card.locator('[data-collapse-file]');
  const review = card.locator('[data-reviewed-file]');
  for (const theme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: theme });
    for (const width of [1800, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await card.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await page.waitForTimeout(150);
      const geometry = await review.evaluate(button => {
        const bounds = button.getBoundingClientRect(), header = button.closest('header').getBoundingClientRect(), style = getComputedStyle(button);
        return { left: bounds.left, right: bounds.right, headerLeft: header.left, headerRight: header.right, viewport: innerWidth, border: style.borderTopWidth, radius: style.borderRadius };
      });
      check(geometry.border === '1px' && geometry.radius === '6px', 'Review action uses a bordered button: ' + JSON.stringify(geometry));
      check(geometry.left >= geometry.headerLeft && geometry.right <= Math.min(geometry.headerRight, geometry.viewport) + 1, `Review button fits ${theme}/${width}: ${JSON.stringify(geometry)}`);
      check(await card.locator('.collapse-caret').textContent() === '▾', 'Expanded header uses the Monaco disclosure arrow');
      await card.locator('header').screenshot({ path: `/tmp/dc-file-header-${theme}-${width}.png` });
    }
  }
  await page.setViewportSize({ width: 1800, height: 1000 });
  await review.click();
  await page.waitForFunction(() => document.querySelector('[data-reviewed-file="screens/receipt.png"]')?.getAttribute('aria-pressed') === 'true');
  check(await review.textContent() === '✓ Reviewed', 'Reviewed button shows its selected label');
  check((await card.getAttribute('class')).includes('collapsed'), 'Reviewing the PNG collapses only its diff');
  check(await card.locator('.collapse-caret').textContent() === '▸', 'Collapsed header uses the Monaco right arrow');
  await card.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForTimeout(100);
  await card.locator('header').screenshot({ path: '/tmp/dc-file-header-reviewed.png' });
  await toggle.click();
  check(await review.getAttribute('aria-pressed') === 'true', 'Expanding a reviewed file does not change review state');
  await review.click();
  await page.waitForFunction(() => document.querySelector('[data-reviewed-file="screens/receipt.png"]')?.getAttribute('aria-pressed') === 'false');
  check(await review.textContent() === 'Mark as reviewed', 'Unreview restores the action label');
  check(!(await card.getAttribute('class')).includes('collapsed'), 'Unreviewed file is expanded');
  await page.locator('#diff-renderer').selectOption('monaco');
  check(await card.count() === 1 && await review.count() === 1, 'Native PNG keeps the same header when Monaco is selected');
  check(!errors.length, 'Clean browser console: ' + JSON.stringify(errors));
  console.log('PASS native review buttons and disclosure arrows: PNG, light/dark, wide/narrow, review/collapse/unreview, mixed Monaco list');
} catch (error) { console.error(error.stack); process.exitCode = 1; }
finally { await browser.close(); }
