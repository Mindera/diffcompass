// Exercise real explorer clicks (no direct reveal calls) in a disposable fixture.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const [playwrightPath, url] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({ channel:process.env.CI ? undefined : 'chrome', headless:true });
const page = await browser.newPage({viewport:{width:1800,height:1000},colorScheme:'dark'});
page.setDefaultTimeout(15000);
const errors=[]; page.on('pageerror',error=>errors.push(error.message));
const card = path => page.locator(`#diff > [data-path="${path}"]`);
const explorer = path => page.locator(`#file-tree .file-button[data-file="${path}"]`);
async function atFile(path) {
  await page.waitForFunction(path => {
    const card=document.querySelector(`#diff > [data-path="${path}"]`), panel=document.getElementById('diff-panel');
    if (!card) return false;
    const rect=(card.classList.contains('monaco-file-slot') ? card : card.querySelector('header')).getBoundingClientRect(), toolbar=panel.querySelector('.diff-toolbar').getBoundingClientRect();
    return rect.top >= toolbar.bottom-2 && rect.top < toolbar.bottom+100;
  },path);
  await page.waitForTimeout(500); // Allow lazy mount/sizing to settle after smooth scrolling.
  const geometry=await card(path).evaluate(node=>({top:(node.classList.contains('monaco-file-slot') ? node : node.querySelector('header')).getBoundingClientRect().top,toolbar:document.querySelector('.diff-toolbar').getBoundingClientRect().bottom}));
  assert.ok(geometry.top>=geometry.toolbar-2 && geometry.top<geometry.toolbar+100,'File stays at its header below the toolbar: '+JSON.stringify({path,...geometry}));
}
async function click(path,keyboard=false) {
  if(keyboard) { await explorer(path).focus(); await page.keyboard.press('Enter'); }
  else await explorer(path).click();
  await atFile(path);
}
async function smoothClick(path) {
  await page.evaluate(()=>{
    window.fileMotion=[]; window.recordFileMotion=true;
    const sample=()=>{if(!window.recordFileMotion)return;window.fileMotion.push(document.getElementById('diff-panel').scrollTop);requestAnimationFrame(sample);};sample();
  });
  await click(path);
  const samples=await page.evaluate(()=>{window.recordFileMotion=false;return window.fileMotion;});
  const start=samples[0],end=samples.at(-1),distance=Math.abs(end-start),direction=Math.sign(end-start);
  assert.ok(distance>200,'Exercise a meaningful file-to-file distance');
  assert.ok(new Set(samples.filter(top=>Math.abs(top-start)>2&&Math.abs(top-end)>2).map(Math.round)).size>=4,'Explorer scroll has intermediate animation frames, not an instant jump');
  const deltas=samples.slice(1).map((top,index)=>(top-samples[index])*direction);
  assert.ok(Math.min(...deltas)>=-2,'Smooth file navigation never reverses: '+JSON.stringify(samples));
  assert.ok(Math.max(...deltas)<distance*.45,'No large snap before or after the smooth movement: '+JSON.stringify(samples));
}
async function editor(path) {
  await page.waitForFunction(path=>[...document.querySelectorAll('.monaco-review-frame')].some(frame=>frame.dataset.monacoPath===path && frame.contentWindow?.diffLab?.views.get(path)?.diff.getLineChanges()?.length),path);
  return page.frames().find(frame=>new URL(frame.url(),url).searchParams.get('file')===path);
}
try {
  await page.goto(url);
  await page.locator('#step-count').filter({hasText:'Step '}).waitFor({state:'attached'});
  if(await page.locator('#tour-mode-toggle').textContent()==='Exit tour') await page.locator('#tour-mode-toggle').click();
  await page.locator('#review-filter').selectOption('');
  await page.locator('#diff-renderer').selectOption('monaco');
  await card('src/context-example.ts').waitFor({state:'attached'});
  for(const layout of ['split','unified']) {
    await page.locator(`[data-diff-layout="${layout}"]`).click();
    await page.locator('#diff-panel').evaluate(panel=>panel.scrollTo({top:0,behavior:'instant'}));
    await page.waitForTimeout(200);
    await smoothClick('src/context-example.ts');
    let frame=await editor('src/context-example.ts');
    // Opening a file must not reveal line 1 or unfold unchanged context.
    assert.ok(await frame.locator('.editor.modified [data-gap-action="all"]').count()>0);
    await smoothClick('docs/preview.md'); await editor('docs/preview.md');
    await click('src/context-example.ts',true);
    await click('src/context-example.ts'); frame=await editor('src/context-example.ts');
    await card('src/context-example.ts').getByRole('button',{name:'Collapse src/context-example.ts',exact:true}).click();
    assert.equal(await card('src/context-example.ts').getByRole('button',{name:'Expand src/context-example.ts',exact:true}).count(),1);
    await click('docs/preview.md');
    await click('src/context-example.ts'); await editor('src/context-example.ts');
    assert.equal(await card('src/context-example.ts').getByRole('button',{name:'Collapse src/context-example.ts',exact:true}).getAttribute('aria-expanded'),'true');
    await click('screens/receipt.png');
    assert.equal(await card('screens/receipt.png').getAttribute('class'),'diff-file');
    console.log(`PASS ${layout}: real explorer mouse/keyboard, cold/remounted/collapsed Monaco files, hidden context retained, native PNG`);
  }
  await page.locator('#diff-renderer').selectOption('current');
  await click('docs/preview.md'); await click('src/context-example.ts');
  console.log('PASS Current renderer file navigation remains intact');
  let releaseSource;
  const sourceGate=new Promise(resolve=>{releaseSource=resolve;});
  const sourceStarted=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/diff/sources' && new URL(request.url()).searchParams.get('path')==='src/lazy-11.ts');
  await page.route('**/api/diff/sources?*',async route=>{
    if(new URL(route.request().url()).searchParams.get('path')==='src/lazy-11.ts') await sourceGate;
    await route.continue();
  });
  await page.locator('#diff-renderer').selectOption('monaco');
  await explorer('src/lazy-11.ts').click(); await sourceStarted;
  await click('docs/preview.md');
  releaseSource();
  await page.waitForTimeout(1000);
  await atFile('docs/preview.md');
  console.log('PASS a late-loading previous click cannot steal the latest file destination');
  await page.unroute('**/api/diff/sources?*');
  await smoothClick('src/lazy-11.ts');
  await smoothClick('docs/preview.md');
  console.log('PASS distant explorer destinations animate without intermediate lazy editors shifting the journey');
  await page.emulateMedia({reducedMotion:'reduce'});
  await click('src/lazy-11.ts'); await click('docs/preview.md');
  await page.emulateMedia({reducedMotion:'no-preference'});
  console.log('PASS reduced-motion file navigation still reaches the correct header');
  const origin=await page.locator('#diff-panel').evaluate(node=>node.scrollTop);
  await explorer('src/lazy-11.ts').click();
  await page.waitForFunction(origin=>document.getElementById('diff-panel').scrollTop>origin+60,origin);
  const panel=await page.locator('#diff-panel').boundingBox();
  await page.mouse.move(panel.x+panel.width-60,panel.y+panel.height-60);
  await page.mouse.wheel(0,-300);
  await page.waitForTimeout(300);
  const interrupted=await page.locator('#diff-panel').evaluate(node=>node.scrollTop);
  await page.waitForTimeout(1000);
  assert.ok(Math.abs(await page.locator('#diff-panel').evaluate(node=>node.scrollTop)-interrupted)<3,'Wheel input cancels file navigation; it must not resume or jump to the old target');
  console.log('PASS user scrolling interrupts the explorer animation without a later snap');
  await page.screenshot({path:'/tmp/dc-file-explorer.png'});
  assert.deepEqual(errors,[]);
} catch(error) {
  await page.screenshot({path:'/tmp/dc-file-explorer-failure.png'});
  console.error(error.stack); console.error('PAGE_ERRORS',errors); process.exitCode=1;
} finally { await browser.close(); }
