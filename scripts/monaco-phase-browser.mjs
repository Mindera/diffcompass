// Cold/slow phase changes must never expose half-built editors or scroll
// through a list whose heights are still changing. Disposable fixture only.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const [playwrightPath, url] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', headless: true });
const page = await browser.newPage({ viewport:{width:1800,height:1000},colorScheme:'dark',reducedMotion:'no-preference' });
page.setDefaultTimeout(20000);
const errors=[]; page.on('pageerror',error=>errors.push(error.message));
let heldSource=null, sourceArrived=null;
await page.route('**/api/diff/sources?*',async route=>{
  if(new URL(route.request().url()).searchParams.get('path')==='src/receipt.ts' && heldSource){
    sourceArrived?.(); await heldSource;
  } else await new Promise(resolve=>setTimeout(resolve,180));
  await route.continue().catch(()=>{}); // Cancelling a navigation aborts its frame.
});
async function at(index,path){
  await page.waitForFunction(({index,path})=>{
    const frame=[...document.querySelectorAll('.monaco-review-frame')].find(frame=>frame.dataset.monacoPath===path&&!frame.closest('.monaco-phase-staging'));
    return document.getElementById('step-count').textContent.includes(`(Step ${index+1})`) && !document.getElementById('next-step').disabled && frame?.contentWindow?.diffLab?.views.get(path)?.diff.getLineChanges();
  },{index,path});
}
async function transition(direction,index,path,crossPhase){
  // Measure navigation from a painted starting viewport, not from the initial
  // lazy mount of a neighbouring editor before the user presses a tour button.
  await page.waitForFunction(() => {
    const panel = document.getElementById('diff-panel').getBoundingClientRect();
    const top = document.querySelector('.diff-toolbar').getBoundingClientRect().bottom;
    return [...document.querySelectorAll('.monaco-review-frame')].filter(frame => !frame.closest('.monaco-phase-staging')).every(frame => {
      const rect = frame.getBoundingClientRect();
      if (rect.bottom <= top || rect.top >= panel.bottom) return true;
      return !!frame.contentWindow?.diffLab?.views.get(frame.dataset.monacoPath)?.diff.getLineChanges()
        && !!frame.contentDocument.querySelector('.view-line');
    });
  });
  await page.evaluate(()=>{
    window.phaseSamples=[];window.samplingPhase=true;
    const sample=()=>{
      if(!window.samplingPhase)return;
      const panel=document.getElementById('diff-panel').getBoundingClientRect();
      const top=document.querySelector('.diff-toolbar').getBoundingClientRect().bottom;
      const current=Number(/\(Step (\d+)\)/.exec(document.getElementById('step-count').textContent)?.[1])-1;
      const files=[...document.querySelectorAll('.monaco-review-frame')].filter(frame=>!frame.closest('.monaco-phase-staging')).flatMap(frame=>{
        const rect=frame.getBoundingClientRect();
        if(rect.bottom<=top||rect.top>=panel.bottom)return [];
        const view=frame.contentWindow?.diffLab?.views.get(frame.dataset.monacoPath);
        return [{path:frame.dataset.monacoPath,top:rect.top,ready:!!view?.diff.getLineChanges()&&!!frame.contentDocument.querySelector('.view-line')}];
      });
      window.phaseSamples.push({current,files});
      requestAnimationFrame(()=>setTimeout(sample,0)); // Sample after layout/ResizeObserver corrections.
    };sample();
  });
  await page.locator('#'+direction+'-step').click();
  await at(index,path);
  await page.waitForTimeout(1400);
  const samples=await page.evaluate(()=>{window.samplingPhase=false;return window.phaseSamples;});
  const unready=samples.flatMap(sample=>sample.files.filter(file=>!file.ready));
  assert.deepEqual(unready,[],'No visible blank editors during '+direction+' to '+path);
  if(crossPhase){
    const shown=samples.filter(sample=>sample.current===index);
    assert.ok(shown.length>0);
    assert.ok(shown.every(sample=>sample.files.some(file=>file.path===path&&file.ready)), 'Destination is ready on the first displayed frame');
    const tops=shown.map(sample=>sample.files.find(file=>file.path===path).top);
    assert.ok(Math.max(...tops)-Math.min(...tops)<=2,'Destination stays anchored while other files settle: '+JSON.stringify(tops));
  }
}
try{
  await page.goto(url);
  const token=new URL(url).hash.slice(7);
  await page.evaluate(async token=>{
    for(let i=0;i<4;i++)await fetch('/api/tour/navigate',{method:'POST',headers:{'x-diffcompass-token':token,'content-type':'application/json'},body:JSON.stringify({direction:'previous'})});
  },token);
  await page.reload();
  await page.locator('#step-count').filter({hasText:'Step '}).waitFor({state:'attached'});
  await page.locator('#diff-renderer').selectOption('monaco');
  await at(0,'src/cart.ts');await page.waitForTimeout(300);
  for(const layout of ['split','unified']){
    await page.locator(`[data-diff-layout="${layout}"]`).click();
    await transition('next',1,'src/cart.ts',false);
    await transition('next',2,'src/receipt.ts',true);
    await transition('next',3,'README.md',false);
    await transition('previous',2,'src/receipt.ts',false);
    await transition('previous',1,'src/cart.ts',true);
    await transition('previous',0,'src/cart.ts',false);
    console.log(`PASS ${layout}: cold phase handoff, stable destination, ready code throughout smooth same-phase travel`);
  }
  await transition('next',1,'src/cart.ts',false);
  let unblock;
  heldSource=new Promise(resolve=>{unblock=resolve;});
  const arrived=new Promise(resolve=>{sourceArrived=resolve;});
  await page.locator('#next-step').click();await arrived;
  await page.waitForTimeout(2200); // Cross a poll tick while loading is held.
  assert.match(await page.locator('#step-count').textContent(),/Step 2\)/,'Poll must not publish the loading phase');
  assert.equal(await page.locator('.monaco-file-slot[data-path="src/cart.ts"]:not(.monaco-phase-staging) iframe').count(),1);
  await page.locator('#previous-step').click();
  await at(1,'src/cart.ts');unblock();heldSource=null;
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.monaco-phase-staging').count(),0,'Cancelled staging is removed');
  assert.match(await page.locator('#step-count').textContent(),/Step 2\)/,'Late completion cannot restore a cancelled phase');
  await transition('previous',0,'src/cart.ts',false);
  // Exercise the production paged-diff client path with the same captured
  // sources: metadata arrives first, per-file hunks use the real /api/diff API.
  const diffReads=[];
  page.on('request',request=>{const target=new URL(request.url());if(target.pathname==='/api/diff')diffReads.push(target.searchParams.get('path'));});
  await page.route(/\/api\/(session|tour\/navigate)$/,async route=>{
    const response=await route.fetch(), session=await response.json();
    session.comparison.diffMode='file';
    for(const file of session.comparison.files)file.hunks=[];
    await route.fulfill({response,json:session});
  });
  await page.reload();await at(0,'src/cart.ts');await page.waitForTimeout(300);
  await transition('next',1,'src/cart.ts',false);
  await transition('next',2,'src/receipt.ts',true);
  await transition('previous',1,'src/cart.ts',true);
  await transition('previous',0,'src/cart.ts',false);
  assert.equal(diffReads.filter(path=>path==='src/cart.ts').length,1,'Returning to a phase reuses its diff cache');
  assert.equal(diffReads.filter(path=>path==='src/receipt.ts').length,1,'New phase metadata is loaded only once');
  assert.deepEqual(errors,[]);
  console.log('PASS slow loading/poll race, rapid Next→Previous cancellation, paged diff loading/cache and clean console');
}catch(error){
  await page.screenshot({path:'/tmp/dc-phase-failure.png'});
  console.error(error.stack);console.error('PAGE_ERRORS',errors);process.exitCode=1;
}finally{await browser.close();}
