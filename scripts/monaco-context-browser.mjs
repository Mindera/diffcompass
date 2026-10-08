// Run against a disposable DIFF_VIEWER_PR_EXAMPLE=1 production fixture.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { setDiagramViewport } from './archify-browser-viewport.mjs';
const [playwrightPath, url] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1800, height: 1000 }, colorScheme: 'dark', reducedMotion: 'reduce' });
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
async function file(path, line) {
  await page.evaluate(({path, line}) => diffCompassProductionHost.reveal(path, 'new', line), {path, line});
  await page.waitForFunction(path => [...document.querySelectorAll('.monaco-review-frame')].some(frame => frame.dataset.monacoPath === path && frame.contentWindow?.diffLab?.views.get(path)?.diff.getLineChanges()?.length), path);
  return page.frames().find(frame => new URL(frame.url(), url).searchParams.get('file') === path);
}
const contextPath = 'src/context-example.ts';
const card = () => page.locator(`.monaco-file-slot[data-path="${contextPath}"]`);
const height = () => card().evaluate(node => node.getBoundingClientRect().height);
try {
  await setDiagramViewport(page, {width:1800,height:1000});
  await page.goto(url);
  await page.locator('#step-count').filter({hasText:'Step '}).waitFor({state:'attached'});
  await page.locator('#diff-renderer').selectOption('monaco');
  assert.equal(await page.locator('#monaco-integration-frame').count(), 0, 'No legacy multi-file iframe');
  let frame = await file('src/cart.ts', 17);
  await frame.locator('.review-pr-thread').waitFor({state:'attached'});
  assert.equal(await frame.getByRole('button', {name:'Reply in GitHub'}).isDisabled(), true);
  assert.match(await frame.locator('.review-pr-thread').textContent(), /Read-only sample/);
  await page.getByRole('button', {name:'Hide comments',exact:true}).click();
  assert.equal(await frame.locator('.review-pr-thread').count(), 0);
  await page.getByRole('button', {name:'Show comments',exact:true}).click();
  await frame.locator('.review-pr-thread').waitFor({state:'attached'});
  console.log('PASS synthetic PR thread uses the current per-file renderer');
  for (const layout of ['split', 'unified']) {
    await page.locator(`[data-diff-layout="${layout}"]`).click();
    frame = await file(contextPath, 43);
    const collapse = frame.getByRole('button', {name:'Collapse unchanged', exact:true});
    if (await collapse.isVisible()) await collapse.click();
    const region = signature => frame.locator(`.editor.modified [data-review-gap="${signature}"]`);
    const ranges = () => frame.evaluate(path => diffLab.views.get(path).diff.saveViewState().modelState.collapsedRegions.map(r => r.range), contextPath);
    await region('47:175').locator('[data-gap-action="all"]').waitFor();
    await page.waitForTimeout(200);
    const baseline = await ranges(), before = await height();
    assert.equal(await region('47:175').locator('.review-gap-actions button').count(), 1, 'One Expand all button per gap');
    assert.equal(await frame.locator('[data-gap-action="above"], [data-gap-action="below"]').count(), 0, 'No partial-expansion controls');
    const expand = region('47:175').locator('[data-gap-action="all"]');
    if (layout === 'split') await expand.click();
    else { await expand.focus(); await page.keyboard.press('Enter'); }
    await frame.waitForFunction(path => { const range = diffLab.views.get(path).diff.saveViewState().modelState.collapsedRegions[1].range; return range[0] === range[1]; }, contextPath);
    assert.deepEqual(await ranges(), [baseline[0], [175,175], baseline[2]], 'Expand all changes only the selected gap');
    await page.waitForFunction(({path, height}) => document.querySelector(`.monaco-file-slot[data-path="${path}"]`).getBoundingClientRect().height > height + 2000, {path:contextPath,height:before});
    const geometry = await frame.evaluate(path => {
      const list = document.getElementById('file-list');
      const editors = Object.values(diffLab.views.get(path).editors).map(editor => ({height:editor.getLayoutInfo().height,scroll:editor.getScrollHeight()}));
      return {editors,listHeight:list.clientHeight,listScroll:list.scrollHeight,docHeight:innerHeight,docScroll:document.documentElement.scrollHeight};
    }, contextPath);
    assert.ok(geometry.editors.every(editor => editor.scroll <= editor.height + 2), 'No inner vertical editor scrollbar: '+JSON.stringify(geometry));
    assert.ok(geometry.listScroll <= geometry.listHeight + 2 && geometry.docScroll <= geometry.docHeight + 2, 'No nested list or frame scrollbar');
    await frame.getByRole('button', {name:'▴ Collapse unchanged lines 47–174',exact:true}).click();
    await region('47:175').locator('[data-gap-action="all"]').waitFor();
    await page.waitForFunction(({path,height}) => Math.abs(document.querySelector(`.monaco-file-slot[data-path="${path}"]`).getBoundingClientRect().height-height)<3, {path:contextPath,height:before});
    console.log(`PASS ${layout}: single Expand all button, mouse/keyboard, growing/shrinking card and no inner scrollbars`);
    if (layout === 'unified') assert.equal(await frame.locator('.editor.original .review-gap-actions').first().isVisible(), false, 'No clipped Before-side gap actions in the unified gutter');
  }
  await setDiagramViewport(page, {width:390,height:844});
  frame = await file(contextPath, 43);
  await frame.locator('.editor.modified [data-gap-action="all"]').first().waitFor();
  assert.ok(await frame.locator('.editor.modified .review-gap-actions').evaluateAll(nodes => nodes.every(node => node.scrollWidth <= node.parentElement.clientWidth + 1)), 'Narrow gap actions fit');
  await page.screenshot({path:'/tmp/dc-context-narrow.png'});
  await setDiagramViewport(page, {width:1800,height:1000});
  await page.screenshot({path:'/tmp/dc-context-desktop.png'});
  assert.deepEqual(errors, []);
  console.log('PASS narrow controls and clean browser console');
} catch(error) {
  await page.screenshot({path:'/tmp/dc-context-failure.png'});
  console.error(error.stack); console.error('PAGE_ERRORS',errors); process.exitCode=1;
} finally { await browser.close(); }
