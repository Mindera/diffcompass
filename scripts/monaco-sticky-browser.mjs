// Run against a disposable PR fixture; never the user's saved review.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const [playwrightPath, url] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1800, height: 1000 }, colorScheme: 'dark', reducedMotion: 'reduce' });
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const cart = '.monaco-file-slot[data-path="src/cart.ts"]';
const returning = page.locator('#current-step-return');
async function file(path) {
  await page.waitForFunction(path => [...document.querySelectorAll('.monaco-review-frame')].some(frame => frame.dataset.monacoPath === path && frame.contentWindow?.diffLab?.views.get(path)?.diff.getLineChanges()?.length), path);
  return page.frames().find(frame => new URL(frame.url(), url).searchParams.get('file') === path);
}
async function place(path, selector, offset) {
  await page.evaluate(({path,selector,offset}) => {
    const panel = document.getElementById('diff-panel');
    const card = document.querySelector(`.monaco-file-slot[data-path="${path}"]`);
    const frame = card.querySelector('iframe');
    const rect = frame.contentDocument.querySelector(selector).getBoundingClientRect();
    const top = panel.getBoundingClientRect().top + parseFloat(getComputedStyle(panel).getPropertyValue('--diff-toolbar-height')) + card.querySelector('header').offsetHeight;
    panel.scrollTop += frame.getBoundingClientRect().top + rect.top - top - offset;
  }, {path,selector,offset});
}
async function assertReturn(hidden) {
  await page.waitForFunction(hidden => document.getElementById('current-step-return').classList.contains('hidden') === hidden, hidden);
}
async function sticky(path) {
  const geometry = await page.locator(`.monaco-file-slot[data-path="${path}"]`).evaluate(card => {
    const header = card.querySelector('header'), panel = document.getElementById('diff-panel');
    const rect = header.getBoundingClientRect();
    return {top:rect.top,bottom:rect.bottom,cardBottom:card.getBoundingClientRect().bottom,expected:panel.getBoundingClientRect().top+parseFloat(getComputedStyle(panel).getPropertyValue('--diff-toolbar-height')),hit:header.contains(document.elementFromPoint(rect.right-50,rect.top+rect.height/2))};
  });
  assert.ok(Math.abs(geometry.top-geometry.expected) < 2 && geometry.bottom <= geometry.cardBottom, 'Header sticks below toolbar within its own file: '+JSON.stringify(geometry));
  assert.ok(geometry.hit, 'Sticky header remains clickable above the editor');
}
try {
  await page.goto(url);
  await page.locator('#step-count').filter({hasText:'Step '}).waitFor({state:'attached'});
  await page.locator('#diff-renderer').selectOption('monaco');
  let frame = await file('src/cart.ts');
  await frame.locator('.review-tour-stop[data-tour-state="current"]').waitFor();
  await assertReturn(true);
  await page.locator('#next-step').click();
  await frame.waitForFunction(() => diffLab.session.currentStepIndex === 1);
  await assertReturn(true);
  // Expand a following file to give the outer panel room to scroll away.
  await page.evaluate(() => diffCompassProductionHost.reveal('src/context-example.ts','new',43));
  const context = await file('src/context-example.ts');
  await context.getByRole('button',{name:'Show all context',exact:true}).click();
  await page.waitForFunction(() => document.querySelector('.monaco-file-slot[data-path="src/context-example.ts"]').getBoundingClientRect().height > 3000);
  // Expanding this file changes the viewport around its top. Move fully past
  // the current stop: even its last visible source line correctly hides Return.
  await place('src/context-example.ts','.editor.modified .view-line',20);
  await assertReturn(false);
  await returning.click();
  frame = await file('src/cart.ts');
  await assertReturn(true);
  for (const layout of ['split','unified']) {
    await page.locator(`[data-diff-layout="${layout}"]`).click();
    await frame.locator('.review-tour-stop[data-tour-state="current"]').waitFor();
    await place('src/cart.ts','.review-tour-stop[data-tour-state="current"]',60);
    await sticky('src/cart.ts');
    await assertReturn(true);
    // Banner and first source line are above the sticky header, but later
    // highlighted lines remain visible. They should also hide the shortcut.
    await place('src/cart.ts','.editor.modified .review-tour-highlight',-22);
    await sticky('src/cart.ts');
    await assertReturn(true);
    const geometry = await frame.evaluate(() => diffCompassMonaco.tourGeometry(diffLab.session.outline.phases.flatMap(phase=>phase.steps)[1]));
    assert.ok(geometry.length > 1, 'Current banner and rendered code rectangles are exposed');
    console.log(`PASS ${layout}: sticky clickable header, visible banner/code hides Current step`);
  }
  await page.locator(cart).evaluate(card => {
    const panel=document.getElementById('diff-panel');
    const top=panel.getBoundingClientRect().top+parseFloat(getComputedStyle(panel).getPropertyValue('--diff-toolbar-height'));
    panel.scrollTop += card.getBoundingClientRect().bottom-top-12;
  });
  const boundary = await page.locator(cart).evaluate(card => ({bottom:card.getBoundingClientRect().bottom,headerBottom:card.querySelector('header').getBoundingClientRect().bottom}));
  assert.ok(boundary.headerBottom <= boundary.bottom, 'Header is pushed off at the file boundary, not over the next file');
  await page.locator('.monaco-file-slot[data-path="src/context-example.ts"]').evaluate(card => {
    const panel=document.getElementById('diff-panel'); panel.scrollTop += card.getBoundingClientRect().top-panel.getBoundingClientRect().top+600;
  });
  await sticky('src/context-example.ts');
  await assertReturn(false);
  await page.waitForFunction(() => !document.querySelector('.monaco-review-frame[data-monaco-path="src/cart.ts"]'));
  await returning.click();
  frame = await file('src/cart.ts');
  await assertReturn(true);
  await page.locator(`${cart} > header`).getByRole('button',{name:'Collapse src/cart.ts',exact:true}).click();
  await assertReturn(false);
  await returning.click();
  frame = await file('src/cart.ts');
  await assertReturn(true);
  console.log('PASS offscreen/evicted/collapsed stop shows shortcut; returning hides it after mount');
  await frame.getByRole('button',{name:'View source',exact:true}).click();
  await assertReturn(false);
  await returning.click();
  await assertReturn(true);
  await frame.locator('[data-control="source-pane"]').waitFor({state:'hidden'});
  console.log('PASS source overlay does not count as visible tour code; return restores diff');
  await place('src/cart.ts','.review-tour-stop[data-tour-state="current"]',70);
  const currentHeader = page.locator(`${cart} > header`);
  await currentHeader.getByRole('button',{name:'Mark as reviewed',exact:true}).click();
  await page.waitForFunction(() => document.querySelector('.monaco-file-slot[data-path="src/cart.ts"]').getBoundingClientRect().height < 80);
  await assertReturn(false);
  assert.equal(await currentHeader.getByRole('button',{name:'✓ Reviewed',exact:true}).getAttribute('aria-pressed'),'true');
  await currentHeader.getByRole('button',{name:'✓ Reviewed',exact:true}).click();
  frame = await file('src/cart.ts');
  await assertReturn(true);
  console.log('PASS floating reviewed button collapses and restores the file');
  for (const path of ['src/receipt.ts','README.md']) {
    await page.locator('#next-step').click();
    await file(path);
    await assertReturn(true);
  }
  console.log('PASS current-step visibility follows navigation across phases and reviewed files');
  await page.locator('#diff-renderer').selectOption('current');
  await page.locator('.tour-code-note.active').evaluate(node => node.scrollIntoView({block:'center',behavior:'instant'}));
  await assertReturn(true);
  await page.locator('#tour-mode-toggle').click();
  await assertReturn(true);
  assert.deepEqual(errors,[]);
  console.log('PASS native renderer/tour exit unaffected and clean browser console');
} catch (error) {
  await page.screenshot({path:'/tmp/dc-sticky-failure.png'});
  console.error(error.stack); console.error('PAGE_ERRORS',errors); process.exitCode=1;
} finally { await browser.close(); }
