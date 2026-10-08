// Run only against a disposable integration fixture: it changes tour/review state.
import {pathToFileURL} from 'node:url';
const [playwrightPath,url]=process.argv.slice(2);
if(!playwrightPath||!url)throw Error('Supply an existing Playwright module and disposable fixture URL.');
const {chromium}=await import(pathToFileURL(playwrightPath).href);
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1800,height:1100},colorScheme:'dark'}),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
const token=new URL(url).hash.slice(7);
const check=(ok,message)=>{if(!ok)throw Error(message);};
const request=(path,body)=>page.evaluate(async({path,body,token})=>{const r=await fetch(path,{method:body===undefined?'GET':'POST',headers:{'x-diffcompass-token':token,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});if(!r.ok)throw Error(await r.text());return r.json();},{path,body,token});
let initial;
try {
 await page.goto(url);await page.waitForFunction(()=>window.diffCompassIntegration?.child);
 initial=await request('/api/session');
 for(let i=0;i<3;i++)await request('/api/tour/navigate',{direction:'previous'});
 await request('/api/files/reviewed',{path:'src/receipt.ts',reviewed:false});
 await page.reload();await page.waitForFunction(()=>window.diffCompassIntegration?.child);
 const frame=page.frames().find(f=>f.url().includes('embedded=1'));
 await frame.locator('[data-tour-stop=extract-subtotal][data-tour-state=current]').waitFor();
 await page.locator('#next-step').click();await frame.locator('[data-tour-stop=apply-discount][data-tour-state=current]').waitFor();
 await page.locator('#next-step').click();await frame.locator('[data-tour-stop=format-receipt][data-tour-state=current]').waitFor();
 const dimensions=()=>page.evaluate(()=>{
   const frame=document.querySelector('#monaco-integration-frame'),doc=frame.contentDocument;
   const sections=[...doc.querySelectorAll('.prototype-file')].filter(n=>!n.hidden);
   return {frame:frame.clientHeight,content:sections.reduce((sum,n)=>sum+n.getBoundingClientRect().height,0)+doc.querySelector('#status').offsetHeight,headers:sections.reduce((sum,n)=>sum+n.querySelector('.prototype-file-heading').getBoundingClientRect().height,0),visible:sections.map(n=>n.dataset.prototypeFile)};
 });
 await page.waitForTimeout(500);
 let d=await dimensions();console.log('Small diff',d);
 check(d.frame<=d.content+2&&d.frame<450,'Short diff must not reserve a whole viewport');
 const review=frame.locator('[data-review-path="src/receipt.ts"]');
 await review.click();await frame.locator('[data-file-toggle="src/receipt.ts"][aria-expanded=false]').waitFor();
 await page.waitForTimeout(400);d=await dimensions();console.log('Reviewed',d);
 check(d.frame<=d.headers+3,'All-collapsed frame shrinks to its headers');
 const saved=await request('/api/session');
 check(saved.reviewedFiles.includes('src/receipt.ts')&&saved.reviewedFiles.includes('src/cart.ts')===initial.reviewedFiles.includes('src/cart.ts'),'Reviewed state scoped to receipt');
 await page.screenshot({path:'/tmp/dc-frame-height-collapsed.png'});
 await frame.locator('[data-file-toggle="src/receipt.ts"]').click();
 await frame.locator('[data-tour-stop=format-receipt][data-tour-state=current]').waitFor();
 await page.waitForTimeout(400);d=await dimensions();
 check(d.frame>d.headers+100&&d.frame<=d.content+2,'Manual reopen restores natural height while still reviewed');
 check(await review.getAttribute('aria-pressed')==='true','Expanding does not unreview');
 for(const layout of ['unified','split']){
  await page.locator('[data-diff-layout='+layout+']').click();await page.waitForTimeout(250);
  d=await dimensions();check(d.frame<=d.content+2,'Layout keeps short frame compact');
 }
 const beforeDraft=d.frame;
 await frame.evaluate(async()=>{diffLab.reveal('new',3);await diffLab.editors.new.getAction('diff-lab.new.comment').run();});
 await frame.locator('form.review-zone').waitFor();await page.waitForTimeout(400);
 check((await dimensions()).frame>beforeDraft+60,'Frame grows to fit inline composer');
 await frame.locator('form.review-zone').getByRole('button',{name:'Cancel',exact:true}).click();await page.waitForTimeout(400);
 check(Math.abs((await dimensions()).frame-beforeDraft)<3,'Frame shrinks after cancel');
 const samples=await page.evaluate(async()=>{const values=[];for(let i=0;i<25;i++){await new Promise(requestAnimationFrame);values.push(document.querySelector('#monaco-integration-frame').clientHeight);}return values;});
 check(Math.max(...samples)-Math.min(...samples)<2,'No frame-height feedback loop');
 await page.screenshot({path:'/tmp/dc-frame-height-small.png'});
 await page.setViewportSize({width:600,height:850});await page.waitForTimeout(400);
 d=await dimensions();check(d.frame<=d.content+2,'Narrow frame follows wrapped content');
 await page.setViewportSize({width:1800,height:1100});
 await page.locator('#previous-step').click();await frame.locator('[data-tour-stop=apply-discount][data-tour-state=current]').waitFor();
 await page.waitForTimeout(400);d=await dimensions();check(d.frame<=790,'Longer content remains capped');
 // Exercise an oversized annotation region without changing captured source
 // or persisted review data. Real annotation zones use the same height path.
 await frame.evaluate(()=>{
   const editor=diffLab.views.get('src/cart.ts').editors.new,node=document.createElement('div');
   node.textContent='Temporary sizing test zone';
   editor.changeViewZones(accessor=>{window.sizingTestZone={editor,id:accessor.addZone({afterLineNumber:17,heightInPx:1800,domNode:node})};});
 });
 await page.waitForTimeout(400);
 d=await dimensions();console.log('Oversized annotation',d);
 // A single editor leaves room for its file header/tools/footer. Multiple
 // files can reach the outer cap; one need not fill every pixel of it.
 check(d.frame<=790&&d.frame>=690,'Oversized content stays within the viewport budget');
 check(await frame.evaluate(()=>{const e=sizingTestZone.editor;return e.getContentHeight()>e.getLayoutInfo().height+1000;}),'Oversized content remains internally scrollable');
 await page.setViewportSize({width:1800,height:850});await page.waitForTimeout(400);
 d=await dimensions();console.log('Resized oversized annotation',d);
 check(d.frame<=540&&d.frame>=440,'Window resize updates cap independently of current iframe height');
 await frame.evaluate(()=>{sizingTestZone.editor.changeViewZones(a=>a.removeZone(sizingTestZone.id));delete window.sizingTestZone;});
 await page.waitForTimeout(400);
 check(!errors.length,'No page errors: '+errors.join(';'));
 console.log('PASS compact short diff, header-only collapse, independent review state, reopen, layouts, composer resize, stable/narrow sizing, oversized zone cap and viewport resize');
} catch(e){console.log('FAIL',e.stack);console.log(errors);process.exitCode=1;}
finally{
 if(initial)await request('/api/files/reviewed',{path:'src/receipt.ts',reviewed:initial.reviewedFiles.includes('src/receipt.ts')}).catch(console.error);
 await browser.close();
}
