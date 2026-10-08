// Disposable fixture only: reviewing the last file must not move the content
// above it just because collapsing it reduces the page's maximum scroll.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { beginManualScroll } from './browser-scroll-support.mjs';
const [playwrightPath, url] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1800, height: 1000 }, colorScheme: 'dark', reducedMotion: 'reduce' });
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const selector = '.monaco-file-slot[data-path="src/context-example.ts"]';
const position = () => page.locator(selector).evaluate(card => ({
  top: card.getBoundingClientRect().top,
  previous: card.previousElementSibling.getBoundingClientRect().top,
  height: card.getBoundingClientRect().height,
  scroll: document.getElementById('diff-panel').scrollTop,
}));
try {
  await page.goto(url);
  await page.locator('#step-count').filter({hasText:'Step '}).waitFor({state:'attached'});
  await page.locator('#diff-renderer').selectOption('monaco');
  for (const layout of ['split','unified']) {
    await page.locator(`[data-diff-layout="${layout}"]`).click();
    const card = page.locator(selector);
    // Reuse navigation's mount/paint readiness for both files in this phase.
    // Waiting only for this editor's diff lets a slower preceding file resize
    // during the collapse measurement, which is unrelated to reviewing it.
    await page.evaluate(() => diffCompassProductionHost.reveal('src/cart.ts'));
    await page.evaluate(() => diffCompassProductionHost.reveal('src/context-example.ts'));
    await card.evaluate(node => node.scrollIntoView({block:'center',behavior:'instant'}));
    await page.waitForFunction(() => [...document.querySelectorAll('.monaco-review-frame')].some(frame => frame.dataset.monacoPath === 'src/context-example.ts' && frame.contentWindow?.diffLab?.views.get('src/context-example.ts')?.diff.getLineChanges()?.length));
    await beginManualScroll(page);
    await card.evaluate(node => {
      const panel=document.getElementById('diff-panel');
      panel.scrollTop += node.getBoundingClientRect().top-panel.getBoundingClientRect().top-panel.clientHeight*0.3;
    });
    // A baseline recorded during the initial automatic tour reveal attributes
    // that reveal's movement to the subsequent review click. Require the
    // intended manual position before measuring collapse, not a fixed delay.
    await page.waitForFunction(selector => {
      const card = document.querySelector(selector), panel = document.getElementById('diff-panel');
      return Math.abs(card.getBoundingClientRect().top - panel.getBoundingClientRect().top - panel.clientHeight * 0.3) < 1;
    }, selector);
    const before = await position();
    assert.ok(before.scroll > 100, 'Exercise a scrolled viewport');
    const samples = page.locator(selector).evaluate(async card => {
      const result=[];
      for(let i=0;i<60;i++) {
        await new Promise(requestAnimationFrame);
        result.push({top:card.getBoundingClientRect().top,scroll:document.getElementById('diff-panel').scrollTop});
      }
      return result;
    });
    await card.getByRole('button',{name:'Mark as reviewed',exact:true}).click();
    await page.waitForFunction(selector => document.querySelector(selector).getBoundingClientRect().height < 80, selector);
    const after = await position();
    const recorded = await samples;
    assert.ok(Math.abs(after.scroll-before.scroll)<=1 && Math.abs(after.top-before.top)<=1 && Math.abs(after.previous-before.previous)<=1,
      'Review collapse preserves the header and preceding content positions: '+JSON.stringify({before,after}));
    assert.ok(recorded.every(sample=>Math.abs(sample.top-before.top)<=1), 'No transient jump during collapse');
    // Reopening must not add another reserve or jump; repeated cycles stay put.
    await card.getByRole('button',{name:'✓ Reviewed',exact:true}).click();
    await page.waitForFunction(selector => document.querySelector(selector).getBoundingClientRect().height > 150, selector);
    await page.waitForTimeout(200);
    assert.ok(Math.abs((await position()).scroll-before.scroll)<=1, 'Unreview does not move the viewport');
    await card.getByRole('button',{name:'Mark as reviewed',exact:true}).click();
    await page.waitForFunction(selector => document.querySelector(selector).getBoundingClientRect().height < 80, selector);
    assert.ok(Math.abs((await position()).top-before.top)<=1, 'Repeated collapse does not accumulate scroll compensation');
    await page.locator('#diff-panel').evaluate(panel => {panel.scrollTop=0;});
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#diff').evaluate(node=>node.style.minHeight),'', 'Temporary space is released after scrolling up');
    await card.getByRole('button',{name:'✓ Reviewed',exact:true}).click();
    console.log(`PASS ${layout}: last-file review/unreview keeps position, no transient jumps, temporary space released`);
  }
  assert.deepEqual(errors,[]);
} catch(error) {
  await page.screenshot({path:'/tmp/dc-reviewed-scroll-failure.png'});
  console.error(error.stack); console.error('PAGE_ERRORS',errors); process.exitCode=1;
} finally { await browser.close(); }
