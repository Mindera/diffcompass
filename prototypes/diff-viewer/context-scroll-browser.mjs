// Run against a NEW disposable full integration fixture (changes tour position).
import {pathToFileURL} from 'node:url';
const [playwrightPath,url]=process.argv.slice(2);
if(!playwrightPath||!url)throw Error('Supply an existing Playwright module and disposable fixture URL.');
const {chromium}=await import(pathToFileURL(playwrightPath).href);
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1500,height:900}}),errors=[];
page.on('pageerror',e=>errors.push(e.stack));page.setDefaultTimeout(12000);
const check=(ok,msg)=>{if(!ok)throw Error(msg);};
const path='src/context-example.ts',token=new URL(url).hash.slice(7);
try {
 await page.goto(url);await page.waitForFunction(()=>window.diffCompassIntegration?.child);
 await page.evaluate(async token=>{for(let i=0;i<3;i++)await fetch('/api/tour/navigate',{method:'POST',headers:{'x-diffcompass-token':token,'content-type':'application/json'},body:JSON.stringify({direction:'previous'})});},token);
 await page.reload();await page.waitForFunction(()=>window.diffCompassIntegration?.child);
 const frame=page.frames().find(f=>f.url().includes('embedded=1'));
 const file=frame.locator(`[data-prototype-file="${path}"]`),expand=file.locator('[data-control=expand]'),collapse=file.locator('[data-control=collapse]');
 await file.waitFor();
 const ranges=()=>frame.evaluate(path=>diffLab.views.get(path).diff.saveViewState().modelState.collapsedRegions.map(r=>r.range),path);
 for(const layout of ['unified','split']) {
  await page.locator(`[data-diff-layout=${layout}]`).click();
  if(await collapse.isEnabled())await collapse.click();
  await frame.waitForFunction(path=>{const n=document.querySelector(`[data-prototype-file="${path}"]`);return !n.querySelector('[data-control=expand]').disabled&&n.querySelector('[data-control=collapse]').disabled;},path);
 const before=await ranges();check(before.length>=2,'Fixture exposes independent unchanged gaps');
  check(await expand.isVisible()&&await collapse.isHidden(),'Collapsed state shows only Show all context');
  const toolbarHeight=await file.locator('.context-tools').evaluate(n=>n.getBoundingClientRect().height);
  const total=values=>values.reduce((sum,[a,b])=>sum+b-a,0);
  await file.locator('[title="Show Unchanged Region"]').first().click();
  await frame.waitForFunction(path=>!document.querySelector(`[data-prototype-file="${path}"] [data-control=collapse]`).disabled,path);
 check(total(await ranges())<total(before),'Native expansion icon reveals actual source');
  check(await expand.isVisible()&&await collapse.isVisible(),'Partially expanded state shows both actions');
  check(await file.locator('.context-tools').evaluate(n=>n.getBoundingClientRect().height)===toolbarHeight,'Partial expansion preserves toolbar height');
  await file.locator('.context-collapse-zone button').first().click();
  await frame.waitForFunction(({path,before})=>JSON.stringify(diffLab.views.get(path).diff.saveViewState().modelState.collapsedRegions.map(r=>r.range))===JSON.stringify(before),{path,before});
  await expand.focus();await page.keyboard.press('Enter');
  await frame.waitForFunction(path=>document.querySelector(`[data-prototype-file="${path}"] [data-control=expand]`).disabled,path);
 check(total(await ranges())===0&&await collapse.isEnabled(),'Show all really expands every region');
  check(await expand.isHidden()&&await collapse.isVisible(),'Fully expanded state shows only Collapse unchanged');
  check(await frame.evaluate(path=>diffLab.views.get(path).editors.new.hasTextFocus(),path),'Keyboard activation leaves focus in the editor, not a newly hidden button');
  check(await file.locator('.context-tools').evaluate(n=>n.getBoundingClientRect().height)===toolbarHeight,'Full expansion preserves toolbar height');
  await collapse.click();
  await frame.waitForFunction(({path,before})=>JSON.stringify(diffLab.views.get(path).diff.saveViewState().modelState.collapsedRegions.map(r=>r.range))===JSON.stringify(before),{path,before});
  console.log('PASS',layout,'gap expansion, local recollapse, conditional toolbar actions, stable height and keyboard focus');
 }
 for(const layout of ['unified','split']) {
 await page.locator(`[data-diff-layout=${layout}]`).click();
 await file.locator('[data-file-toggle]').scrollIntoViewIfNeeded();
 if(layout==='unified')await page.screenshot({path:'/tmp/dc-context-gap-example.png'});
 if(await expand.isEnabled())await expand.click();
 const positions=()=>page.evaluate(path=>{const f=document.querySelector('#monaco-integration-frame'),e=f.contentWindow.diffLab.views.get(path).editors.new;return {outer:document.querySelector('#diff-panel').scrollTop,files:f.contentDocument.querySelector('#file-list').scrollTop,editor:e.getScrollTop()};},path);
 const hoverCode=async()=>{
  // Point in the actual clipped Monaco viewport, not its full virtual height.
  const point=await page.evaluate(path=>{
   const f=document.querySelector('#monaco-integration-frame'),e=f.contentWindow.diffLab.views.get(path).editors.new,root=e.getDomNode().getBoundingClientRect(),fr=f.getBoundingClientRect(),list=f.contentDocument.querySelector('#file-list').getBoundingClientRect();
   const top=Math.max(root.top,list.top,0),bottom=Math.min(root.bottom,list.bottom,f.clientHeight,innerHeight-fr.top);
   if(bottom-top<20)throw Error('Code viewport is not visible');
   return {x:fr.left+root.left+e.getLayoutInfo().contentLeft+40,y:fr.top+(top+bottom)/2};
  },path);await page.mouse.move(point.x,point.y);
 };
 await frame.evaluate(path=>diffLab.views.get(path).editors.new.setScrollTop(0),path);
 await hoverCode();await page.waitForTimeout(100);
 let before=await positions();await page.mouse.wheel(0,200);await page.waitForTimeout(250);let after=await positions();
 check(after.editor>before.editor&&after.files===before.files&&after.outer===before.outer,'Wheel scrolls long code without double-scrolling ancestors: '+JSON.stringify({before,after}));
 // At the editor edge the same native wheel gesture should continue outward.
 await frame.evaluate(path=>diffLab.views.get(path).editors.new.setScrollTop(1e6),path);await hoverCode();await page.waitForTimeout(100);
 before=await positions();await page.mouse.wheel(0,220);await page.waitForTimeout(250);after=await positions();
 check(after.editor===before.editor&&(after.files>before.files||after.outer>before.outer),'Wheel escapes the bottom edge: '+JSON.stringify({before,after}));
 await file.locator('.context-tools').scrollIntoViewIfNeeded();
 await frame.evaluate(path=>diffLab.views.get(path).editors.new.setScrollTop(0),path);await hoverCode();await page.waitForTimeout(100);
 before=await positions();await page.mouse.wheel(0,-220);await page.waitForTimeout(250);after=await positions();
 check(after.editor===0&&(after.files<before.files||after.outer<before.outer),'Wheel escapes the top edge: '+JSON.stringify({before,after}));
 console.log('PASS',layout,'real wheel scrolls long code and hands off at both edges without double scrolling');
 }
 await page.locator('#next-step').click();await frame.locator('[data-tour-stop=apply-discount][data-tour-state=current]').waitFor();
 await page.locator('#next-step').click();await frame.locator('[data-tour-stop=format-receipt][data-tour-state=current]').waitFor();
 const short=frame.locator('[data-prototype-file="src/receipt.ts"]');
 check(await short.locator('[data-control=collapse]').isHidden()&&await short.locator('[data-control=expand]').isHidden(),'Small added file has no visible context actions');
 const shortHeight=await short.locator('.context-tools').evaluate(n=>n.getBoundingClientRect().height);
 check(shortHeight>=31,'Empty toolbar retains its normal control height');
 await page.setViewportSize({width:600,height:900});
 check(await short.locator('[data-control=collapse]').isHidden()&&await short.locator('[data-control=expand]').isHidden(),'Small-file actions also stay hidden at narrow widths');
 check(await short.locator('.context-tools').evaluate(n=>n.getBoundingClientRect().height)===shortHeight,'Empty narrow toolbar keeps its height even when help text is hidden');
 await page.setViewportSize({width:1500,height:900});
 await short.locator('.modified-in-monaco-diff-editor .view-lines[role=presentation]').hover();
 let outer=await page.locator('#diff-panel').evaluate(n=>n.scrollTop);await page.mouse.wheel(0,250);await page.waitForTimeout(250);
 check(await page.locator('#diff-panel').evaluate(n=>n.scrollTop)>outer,'Short diff passes wheel to the page');
 await short.locator('[data-control=source]').click();
 await short.locator('[data-control=source-pane]').waitFor();
 await short.locator('[data-control=source-editor] .view-lines').hover();
 outer=await page.locator('#diff-panel').evaluate(n=>n.scrollTop);await page.mouse.wheel(0,-180);await page.waitForTimeout(250);
 check(await page.locator('#diff-panel').evaluate(n=>n.scrollTop)<outer,'View source passes wheel at its edge too');
 await short.locator('[data-control=return]').click();
 console.log('PASS short diff and source view hand off real wheel; unavailable context buttons hidden with stable desktop/narrow toolbar');
 check(!errors.length,'No page errors: '+errors.join('; '));
 console.log('PASS zero page errors');
}catch(e){console.log('FAIL',e.stack);console.log('PAGE ERRORS',errors);await page.screenshot({path:'/tmp/dc-context-scroll-failure.png'});process.exitCode=1;}
finally{await browser.close();}
