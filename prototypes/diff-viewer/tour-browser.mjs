// Use only a disposable integration fixture: this changes its tour position.
import {pathToFileURL} from 'node:url';
const [playwrightPath,url]=process.argv.slice(2);
if(!playwrightPath||!url)throw Error('Supply an existing Playwright module and disposable integration fixture URL.');
const {chromium}=await import(pathToFileURL(playwrightPath).href);
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1800,height:1100},colorScheme:'dark'});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const check=(ok,msg)=>{if(!ok)throw Error(msg);};
async function checkTourGutter(frame,path) {
 await frame.evaluate(()=>new Promise(resolve=>{let frames=0;function tick(){if(++frames===8)resolve();else requestAnimationFrame(tick);}requestAnimationFrame(tick);}));
 const geometry=await frame.evaluate(path=>{
   const e=diffLab.views.get(path).editors.new,dom=e.getDomNode(),root=dom.closest('[data-control=editor]'),bounds=root.getBoundingClientRect();
   const unified=!root.classList.contains('review-split');
   const native=selector=>[...dom.querySelectorAll(selector)].filter(n=>n.closest('.monaco-editor')===dom).map(n=>({rect:n.getBoundingClientRect(),border:parseFloat(getComputedStyle(n).borderLeftWidth)})).filter(({rect:r})=>r.width&&r.height&&r.bottom>bounds.top&&r.top<bounds.bottom);
   const rows=native('.review-tour-margin'),starts=native('.review-tour-margin-start'),ends=native('.review-tour-margin-end');
   const prefix=[...root.querySelectorAll('.review-tour-gutter-row')].map(n=>({rect:n.getBoundingClientRect(),start:n.classList.contains('review-tour-gutter-start'),end:n.classList.contains('review-tour-gutter-end'),pointer:getComputedStyle(n).pointerEvents}));
   const cards=[...root.querySelectorAll('.review-zone,.review-before-card,.line-delete-selectable > .view-line')].map(n=>n.getBoundingClientRect()).filter(r=>r.height);
   const same=(a,b)=>Math.abs(a-b)<1;
   const viewport=dom.querySelector(':scope > .overflow-guard > .monaco-scrollable-element'),v=viewport.getBoundingClientRect(),edge=viewport.style.getPropertyValue('--review-tour-edge-fill');
   const limits=[...edge.matchAll(/var\(--accent\) ([\d.]+)px/g)].map(m=>+m[1]+v.top);
   const code=[...dom.querySelectorAll('.review-tour-highlight')].map(n=>n.getBoundingClientRect()).filter(r=>r.width&&r.height);
   const enclosed=cards.filter(r=>r.top>=Math.min(...code.map(c=>c.top))-1&&r.bottom<=Math.max(...code.map(c=>c.bottom))+1);
   // Monaco repeats whole-line decorations on every wrapped visual row.
   const edgeValid=limits.length===2&&(!starts.length||same(limits[0],Math.max(v.top,Math.min(...starts.map(n=>n.rect.top)))))&&(!ends.length||same(limits[1],Math.min(v.bottom,Math.max(...ends.map(n=>n.rect.bottom)))))&&enclosed.every(r=>limits[0]<=r.top+1&&limits[1]>=r.bottom-1);
   const pseudo=getComputedStyle(viewport,'::after');
   return {unified,rows:rows.length,prefix:prefix.length,aligned:prefix.every(p=>rows.some(n=>same(p.rect.top,n.rect.top)&&same(p.rect.bottom,n.rect.bottom)&&same(p.rect.right,n.rect.left))&&same(p.rect.left,bounds.left)),borders:prefix.every(p=>p.start===starts.some(n=>same(n.rect.top,p.rect.top))&&p.end===ends.some(n=>same(n.rect.bottom,p.rect.bottom))),nativeBorders:rows.every(n=>n.border===(unified?0:3)),inert:prefix.every(p=>p.pointer==='none'),noGaps:prefix.every(p=>cards.every(r=>Math.min(p.rect.bottom,r.bottom)-Math.max(p.rect.top,r.top)<1)),edgeValid,edge,edgeInert:pseudo.pointerEvents==='none',edgeWidth:pseudo.backgroundSize.split(',')[0],enclosed:enclosed.length,otherEdge:diffLab.views.get(path).editors.old.getDomNode()?.querySelector('.monaco-scrollable-element')?.style.getPropertyValue('--review-tour-edge-fill')};
 },path);
 check(geometry.rows>0&&geometry.prefix===(geometry.unified?geometry.rows:0),'Exactly the visible source rows have gutter extensions: '+JSON.stringify(geometry));
 check(geometry.aligned&&geometry.borders&&geometry.nativeBorders&&geometry.inert&&geometry.noGaps,'Full prefix and continuous borders; no second inner edge, card/deletion gap tint, or hit layer: '+JSON.stringify(geometry));
 check(geometry.edgeValid&&geometry.edgeInert&&geometry.edgeWidth==='2px 100%'&&geometry.otherEdge==='none','Continuous current-stop right border encloses interior cards, ends at source, and stays source-sided: '+JSON.stringify(geometry));
 console.log('PASS tour gutter geometry',path,JSON.stringify(geometry));
}
async function checkTourEdgeBoundaries(frame) {
 // A native zone after the final line must remain outside the stop. A tall
 // interior zone must retain the edge even with all source rows virtualized.
 await frame.evaluate(()=>{
   const e=diffLab.editors.new,node=document.createElement('div');
   const state={e,node,id:null,scroll:e.getScrollTop()};window.tourEdgeTest=state;
   e.changeViewZones(a=>{state.id=a.addZone({afterLineNumber:18,heightInPx:90,domNode:node});});
   e.setScrollTop(Math.max(0,e.getBottomForLineNumber(18)-250),monaco.editor.ScrollType.Immediate);
 });
 try {
   await checkTourGutter(frame,'src/cart.ts');
   const outside=await frame.evaluate(()=>{
     const {e,node}=tourEdgeTest,v=e.getDomNode().querySelector(':scope > .overflow-guard > .monaco-scrollable-element');
     const limits=[...v.style.getPropertyValue('--review-tour-edge-fill').matchAll(/var\(--accent\) ([\d.]+)px/g)].map(m=>+m[1]+v.getBoundingClientRect().top);
     const zone=node.getBoundingClientRect();
     return {valid:zone.height===90&&limits.length===2&&limits[1]<=zone.top+1,limits,zone:zone.toJSON()};
   });
   check(outside.valid,'A card zone after the last selected source line stays outside the stop border: '+JSON.stringify(outside));
   await frame.evaluate(()=>{
     const {e}=tourEdgeTest,node=document.createElement('div');tourEdgeTest.interior=null;
     e.changeViewZones(a=>{tourEdgeTest.interior=a.addZone({afterLineNumber:17,heightInPx:1800,domNode:node});});
     e.setScrollTop(e.getBottomForLineNumber(17)+300,monaco.editor.ScrollType.Immediate);
   });
   await frame.waitForFunction(()=>{
     const dom=tourEdgeTest.e.getDomNode(),v=dom.querySelector(':scope > .overflow-guard > .monaco-scrollable-element'),r=v.getBoundingClientRect();
     const limits=[...v.style.getPropertyValue('--review-tour-edge-fill').matchAll(/var\(--accent\) ([\d.]+)px/g)].map(m=>+m[1]);
     const visible=[...dom.querySelectorAll('.review-tour-highlight')].some(n=>{const b=n.getBoundingClientRect();return b.height&&b.bottom>r.top&&b.top<r.bottom;});
     return !visible&&limits.length===2&&limits[0]===0&&Math.abs(limits[1]-r.height)<1;
   });
   console.log('PASS stop edge clips across a tall interior zone with no visible source rows and excludes the after-range zone');
 } finally {
   await frame.evaluate(()=>{const {e,id,interior,scroll}=tourEdgeTest;e.changeViewZones(a=>{a.removeZone(id);if(interior)a.removeZone(interior);});e.setScrollTop(scroll,monaco.editor.ScrollType.Immediate);delete window.tourEdgeTest;});
 }
}
try {
 await page.goto(url);await page.waitForFunction(()=>window.diffCompassIntegration?.child);
 await page.evaluate(async token=>{for(let i=0;i<3;i++)await fetch('/api/tour/navigate',{method:'POST',headers:{'x-diffcompass-token':token,'content-type':'application/json'},body:JSON.stringify({direction:'previous'})});},new URL(url).hash.slice(7));
 await page.reload();await page.waitForFunction(()=>window.diffCompassIntegration?.child);
 const frame=page.frames().find(f=>f.url().includes('embedded=1'));
 await frame.waitForFunction(()=>document.querySelector('[data-tour-stop="extract-subtotal"]'));
 check(await frame.locator('[data-tour-stop="extract-subtotal"][data-tour-state="current"]').count()===1,'Exactly one inline current stop');
 check(await frame.locator('[data-tour-stop="apply-discount"][data-tour-state="next"]').count()===1,'Next stop inline at its code');
 check(await frame.evaluate(()=>diffLab.editors.new.getSelection().isEmpty()),'Tour navigation must not create a code quotation');
 await page.locator('#next-step').click();
 await frame.locator('[data-tour-stop="apply-discount"][data-tour-state="current"]').waitFor();
 check(await frame.locator('[data-tour-stop="extract-subtotal"][data-tour-state="other"]').count()===1,'Previous stop becomes inactive');
 for(const layout of ['split','unified']) {
   await page.locator('[data-diff-layout="'+layout+'"]').click();
   await frame.waitForFunction(value=>document.querySelector('#layout').value===value,layout);
   await frame.locator('[data-tour-stop="apply-discount"][data-tour-state="current"]').waitFor();
   await frame.waitForFunction(()=>{const dom=diffLab.editors.new.getDomNode(),card=document.querySelector('[data-tour-stop="apply-discount"]'),line=dom.querySelector('.review-tour-start'),previous=[...dom.querySelectorAll('.line-numbers')].find(n=>n.textContent.trim()==='13'&&n.getBoundingClientRect().height);return card&&line&&previous&&Math.abs(line.getBoundingClientRect().top-card.getBoundingClientRect().bottom-6)<2&&card.getBoundingClientRect().top-previous.getBoundingClientRect().bottom>=5.5;});
   const geometry=await frame.evaluate(()=>{
     const e=diffLab.editors.new,card=document.querySelector('[data-tour-stop="apply-discount"]'),r=card.getBoundingClientRect();
     // Compare rendered geometry on both sides, not a newer model scroll offset
     // with the preceding frame's banner during smooth native scrolling.
     const dom=e.getDomNode(),previous=[...dom.querySelectorAll('.line-numbers')].find(n=>n.textContent.trim()==='13'&&n.getBoundingClientRect().height);
     return {cardTop:r.top,cardBottom:r.bottom,cardHeight:r.height,previousBottom:previous.getBoundingClientRect().bottom,lineTop:dom.querySelector('.review-tour-start').getBoundingClientRect().top,selectionEmpty:e.getSelection().isEmpty(),duplicates:document.querySelectorAll('[data-tour-stop="apply-discount"]').length};
   });
   check(geometry.cardHeight>30&&Math.abs(geometry.lineTop-geometry.cardBottom-6)<2,'Inline stop precedes source with a small gap: '+JSON.stringify(geometry));
   check(geometry.selectionEmpty&&geometry.duplicates===1,'No selection or duplicated stop on layout toggle');
   const banner=frame.locator('[data-tour-stop="apply-discount"]');
   check((await banner.innerText()).includes('UPDATED CODE · LINES 14–18') || (await banner.textContent()).includes('Updated code · lines 14–18'),'Explicit revision/line label');
   const width=await banner.evaluate(node=>({banner:node.getBoundingClientRect().width,root:node.closest('[data-control=editor]').getBoundingClientRect().width}));
   check(Math.abs(width.root-width.banner-12)<2,'Stop spans both revision columns including gutters: '+JSON.stringify(width));
   const gutter=await frame.evaluate(()=>{
     const e=diffLab.editors.new,dom=e.getDomNode(),bounds=dom.getBoundingClientRect(),info=e.getLayoutInfo();
     const root=dom.closest('[data-control=editor]');
     const backgrounds=[...dom.querySelectorAll('.review-tour-margin'),...root.querySelectorAll('.review-tour-gutter-row')].filter(n=>n.getBoundingClientRect().height);
     const rects=backgrounds.map(n=>n.getBoundingClientRect());
     const icons=[...document.querySelectorAll('[data-prototype-file="src/cart.ts"] .review-badge[data-side=new][data-line="17"]')].map(n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('.review-badge')===n};});
     return {count:rects.length,left:Math.min(...rects.map(r=>r.left)),right:Math.max(...rects.map(r=>r.right)),marginLeft:root.classList.contains('review-split')?bounds.left:root.getBoundingClientRect().left,codeLeft:bounds.left+info.contentLeft,icons};
   });
   check(gutter.count>0&&Math.abs(gutter.left-gutter.marginLeft)<2&&Math.abs(gutter.right-gutter.codeLeft)<2,'Selection covers the full source gutter: '+JSON.stringify(gutter));
   check(gutter.icons.length>=3&&gutter.icons.every(icon=>icon.left>=gutter.left&&icon.right<=gutter.right&&icon.hit),'All colocated gutter controls remain inside the highlight and clickable');
   check(geometry.cardTop-geometry.previousBottom>=5.5,'Stop banner has breathing room above: '+JSON.stringify(geometry));
   await checkTourGutter(frame,'src/cart.ts');
   await checkTourEdgeBoundaries(frame);
 }
 // A real reviewer selection must survive periodic session/viewport updates.
 await frame.evaluate(()=>diffLab.editors.new.setSelection(new monaco.Range(15,3,15,9)));
 await page.evaluate(()=>{diffCompassIntegration.sync();diffCompassIntegration.sync();});
 check(await frame.evaluate(()=>{const s=diffLab.editors.new.getSelection();return s.startLineNumber===15&&s.startColumn===3&&s.endColumn===9;}),'Sync must preserve real selection');
 await page.locator('#next-step').click();
 await frame.locator('[data-tour-stop="format-receipt"][data-tour-state="current"]').waitFor();
 check((await frame.locator('[data-tour-stop="format-receipt"]').textContent()).includes('New file · lines 3–5'),'Added-file label uses Git status');
 check(await frame.locator('[data-prototype-file="src/receipt.ts"] [data-file-status=added]').count()===1,'Added badge in file header');
 check(await frame.locator('[data-prototype-file="src/cart.ts"] [data-file-status=modified]').count()===1,'Modified badge retained on existing file');
 check(await frame.locator('[data-tour-stop="apply-discount"]').count()===0,'No previous-phase stop remains');
 await checkTourGutter(frame,'src/receipt.ts');
 await page.screenshot({path:'/tmp/dc-tour-prefix-receipt-unified.png'});
 await page.setViewportSize({width:1100,height:850});
 await checkTourGutter(frame,'src/receipt.ts');
 await page.screenshot({path:'/tmp/dc-tour-prefix-receipt-narrow.png'});
 await page.locator('[data-diff-wrap="wrap"]').click();
 await frame.waitForFunction(()=>document.querySelector('#wrap').checked);
 await checkTourGutter(frame,'src/receipt.ts');
 await page.screenshot({path:'/tmp/dc-tour-prefix-receipt-wrapped.png'});
 const repaints=await frame.evaluate(()=>new Promise(resolve=>{
   const root=document.querySelector('[data-prototype-file="src/receipt.ts"]'),native=[],positions=new Set();
   let count=0;const observer=new MutationObserver(()=>{count++;positions.add([...root.querySelectorAll('.review-tour-gutter-row')].map(n=>n.style.cssText).join(';'));});
   observer.observe(root.querySelector('.review-tour-gutter-layer'),{childList:true});
   const upstream=new MutationObserver(records=>{for(const r of records)if(native.length<12)native.push({target:r.target.className,attribute:r.attributeName,value:r.target.getAttribute?.(r.attributeName)});});
   upstream.observe(root.querySelector('.monaco-diff-editor'),{subtree:true,attributes:true,childList:true});
   setTimeout(()=>{observer.disconnect();upstream.disconnect();resolve({count,positions:positions.size,native});},500);
 }));
 check(repaints.count<20,'Gutter overlay must not create a mutation feedback loop: '+JSON.stringify(repaints));
 console.log('PASS idle gutter repaint bound',JSON.stringify(repaints));
 await page.locator('[data-diff-wrap="scroll"]').click();
 await page.setViewportSize({width:1800,height:1100});
 await checkTourGutter(frame,'src/receipt.ts');
 await page.locator('#previous-step').click();
 await frame.locator('[data-tour-stop="apply-discount"][data-tour-state="current"]').waitFor();
 await page.screenshot({path:'/tmp/dc-tour-markers-unified.png'});
 // Scroll past the heading through the real comment/PR zones. Prefixes must
 // follow native virtualized source rows, not fill the card-sized gaps.
 await frame.evaluate(()=>diffLab.editors.new.setScrollTop(200));
 await checkTourGutter(frame,'src/cart.ts');
 await frame.evaluate(()=>diffLab.editors.new.setScrollTop(0));
 await page.locator('[data-diff-layout="split"]').click();
 await frame.waitForFunction(()=>{const e=diffLab.editors.new,card=document.querySelector('[data-tour-stop="apply-discount"]'),p=e.getScrolledVisiblePosition({lineNumber:14,column:1});return card&&p&&Math.abs(e.getDomNode().getBoundingClientRect().top+p.top-card.getBoundingClientRect().bottom-6)<2;});
 await page.screenshot({path:'/tmp/dc-tour-markers-split.png'});
 const commentId=await frame.locator('[data-comment-id]').filter({hasText:/Same-line fixture:|Integration browser edited comment/}).getAttribute('data-comment-id');
 const comment=frame.locator(`[data-comment-id="${commentId}"]`);
 await comment.getByRole('button',{name:'Edit',exact:true}).click();
 await comment.getByRole('textbox').fill('Unsaved draft across tour stops');
 await page.locator('#previous-step').click();
 await frame.locator('[data-tour-stop="extract-subtotal"][data-tour-state="current"]').waitFor();
 check(await comment.getByRole('textbox').inputValue()==='Unsaved draft across tour stops','Tour update preserves open comment draft');
 await comment.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.locator('#tour-mode-toggle').click();
 await frame.waitForFunction(()=>document.querySelectorAll('[data-tour-stop]').length===0);
 check(await frame.evaluate(()=>[...diffLab.views.values()].every(v=>!v.editors.new.getModel().getAllDecorations().some(d=>d.options.className?.startsWith('review-tour-')))),'Exit clears all tour highlighting');
 check(await frame.locator('.review-tour-gutter-row').count()===0,'Exit removes all gutter extensions');
 check(await frame.evaluate(()=>[...document.querySelectorAll('.review-card-edge-host')].every(n=>n.style.getPropertyValue('--review-tour-edge-fill')==='none')),'Exit clears the continuous right edge on all files/revisions');
 check(!errors.length,'No page errors: '+errors.join('; '));
 console.log('PASS inline current/next cards, exact placement, selection independence, layout/phase transitions, draft retention, exit cleanup');
} catch(error){console.log('FAIL',error.stack);console.log(errors);process.exitCode=1;}
finally{await browser.close();}
