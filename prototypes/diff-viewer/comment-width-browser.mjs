// Disposable full-product fixture only; changes tour position, cancels all drafts.
import {pathToFileURL} from 'node:url';
const [playwrightPath,url]=process.argv.slice(2);
const {chromium}=await import(pathToFileURL(playwrightPath).href);
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1800,height:1100},colorScheme:'dark'}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const check=(ok,message)=>{if(!ok)throw Error(message);};
async function inspect(frame,path,requireBoth=true) {
 await frame.evaluate(()=>new Promise(resolve=>{let n=0;function tick(){if(++n===10)resolve();else requestAnimationFrame(tick);}requestAnimationFrame(tick);}));
 const cards=await frame.evaluate(path=>{
  const view=diffLab.views.get(path),root=view.editors.new.getDomNode().closest('[data-control=editor]'),unified=!root.classList.contains('review-split');
  return [...root.querySelectorAll('[data-comment-id],.review-pr-thread')].filter(n=>!n.hidden).map(n=>{
   const side=n.dataset.side||diffLab.session.comments.find(c=>c.id===n.dataset.commentId)?.side;
   const e=view.editors[unified?'new':side],r=n.getBoundingClientRect(),b=e.getDomNode().getBoundingClientRect();
   const button=n.querySelector('button:not(:disabled)'),br=button?.getBoundingClientRect();
   const visible=br&&br.top>=root.getBoundingClientRect().top&&br.bottom<=root.getBoundingClientRect().bottom;
   const viewport=e.getDomNode().querySelector(':scope > .overflow-guard > .monaco-scrollable-element'),edge=getComputedStyle(viewport,'::after');
   const paint=viewport.style.getPropertyValue('--review-card-edge-fill'),color=getComputedStyle(n).backgroundColor;
   return {side,thread:n.classList.contains('review-pr-thread'),left:r.left,expectedLeft:unified?root.getBoundingClientRect().left:b.left,right:r.right,expectedRight:b.right-e.getLayoutInfo().verticalScrollbarWidth,width:r.width,scrollWidth:n.scrollWidth,clientWidth:n.clientWidth,hit:!visible||document.elementFromPoint(br.x+br.width/2,br.y+br.height/2)?.closest('button')===button,edgeMatches:paint.includes(color)&&edge.backgroundImage!=='none',edgeWidth:parseFloat(edge.width),expectedEdgeWidth:e.getLayoutInfo().verticalScrollbarWidth,edgeInert:edge.pointerEvents==='none'};
  });
 },path);
 check(requireBoth?cards.length>=2&&cards.some(c=>c.thread):cards.length>0,'Visible local comments / PR threads checked: '+JSON.stringify(cards));
 check(cards.every(c=>c.width&&Math.abs(c.left-c.expectedLeft)<1&&c.right>=c.expectedRight-1),'Cards span their own gutter and code viewport: '+JSON.stringify(cards));
 check(cards.every(c=>c.scrollWidth<=c.clientWidth+1&&c.hit),'No horizontal overflow or intercepted edit controls: '+JSON.stringify(cards));
 check(cards.every(c=>c.edgeMatches&&c.edgeWidth===c.expectedEdgeWidth&&c.edgeInert),'Card surface fills the scrollbar strip without a hit layer: '+JSON.stringify(cards));
 console.log('PASS full-width cards',JSON.stringify(cards));
}
async function dragScrollbar(frame) {
 await frame.evaluate(()=>diffLab.editors.new.updateOptions({scrollbar:{vertical:'visible'}}));
 await frame.waitForFunction(()=>{const e=diffLab.editors.new;return e.getDomNode().querySelector('.scrollbar.vertical.visible .slider')?.getBoundingClientRect().height>0;});
 const geometry=await frame.evaluate(()=>{
  const e=diffLab.editors.new,bar=e.getDomNode().querySelector('.scrollbar.vertical'),thumb=bar.querySelector('.slider'),r=thumb.getBoundingClientRect(),b=bar.getBoundingClientRect();
  const y=(r.top+r.bottom)/2,x=(r.left+r.right)/2;
  return {x,y,target:Math.max(b.top+3,Math.min(b.bottom-3,y+(e.getScrollTop()>0?-40:40))),before:e.getScrollTop(),hit:document.elementFromPoint(x,y)?.closest('.scrollbar.vertical')===bar};
 });
 check(geometry.hit,'Native scrollbar, not the painted card strip, owns the thumb hit target: '+JSON.stringify(geometry));
 const bounds=await page.locator('#monaco-integration-frame').boundingBox();
 await page.mouse.move(bounds.x+geometry.x,bounds.y+geometry.y);await page.mouse.down();
 await page.mouse.move(bounds.x+geometry.x,bounds.y+geometry.target,{steps:5});await page.mouse.up();
 await frame.waitForFunction(before=>Math.abs(diffLab.editors.new.getScrollTop()-before)>1,geometry.before);
 await frame.evaluate(()=>diffLab.reveal('new',17));
 console.log('PASS native scrollbar thumb drag over full-width card surfaces');
}
try {
 await page.goto(url);await page.waitForFunction(()=>window.diffCompassIntegration?.child);
 await page.evaluate(async token=>{for(let i=0;i<3;i++)await fetch('/api/tour/navigate',{method:'POST',headers:{'x-diffcompass-token':token,'content-type':'application/json'},body:JSON.stringify({direction:'previous'})});},new URL(url).hash.slice(7));
 await page.reload();await page.waitForFunction(()=>window.diffCompassIntegration?.child);
 const frame=page.frames().find(f=>f.url().includes('embedded=1'));
 await page.locator('#next-step').click();
 await frame.locator('[data-tour-stop="apply-discount"][data-tour-state="current"]').waitFor();
 for(const layout of ['split','unified']) {
  await page.locator('[data-diff-layout="'+layout+'"]').click();
  await frame.waitForFunction(layout=>document.querySelector('#layout').value===layout,layout);
  await frame.evaluate(()=>diffLab.reveal('new',17));
  await inspect(frame,'src/cart.ts');
  await dragScrollbar(frame);await inspect(frame,'src/cart.ts');
  await frame.evaluate(()=>diffLab.editors.new.updateOptions({scrollbar:{vertical:'auto'}}));
  await page.mouse.move(20,90);
  await frame.waitForFunction(()=>getComputedStyle(diffLab.editors.new.getDomNode().querySelector('.scrollbar.vertical')).opacity==='0');
  await page.screenshot({path:'/tmp/dc-comment-width-'+layout+'.png'});
 }
 const card=frame.locator('[data-prototype-file="src/cart.ts"] [data-comment-id]').first();
 await card.getByRole('button',{name:'Edit',exact:true}).click();
 const input=card.getByRole('textbox',{name:'Comment text',exact:true});
 await input.fill('Unsaved full-width draft');
 await page.setViewportSize({width:1100,height:850});
 await inspect(frame,'src/cart.ts',false);
 check(await input.inputValue()==='Unsaved full-width draft','Resize preserves draft');
 await frame.evaluate(()=>{const input=document.querySelector('form.review-zone textarea');input.focus();diffLab.diff.updateOptions({wordWrap:'on',diffWordWrap:'on'});});
 await inspect(frame,'src/cart.ts',false);
 check(await input.evaluate(n=>n===document.activeElement),'Wrapping preserves typing focus');
 // In a short viewport, form actions can be below the clipped editor. Tabbing
 // to them must reveal them through Monaco, not scroll the overlay separately.
 await page.keyboard.press('Tab');await page.keyboard.press('Tab');
 await frame.waitForFunction(()=>document.activeElement?.textContent==='Cancel');
 await frame.waitForFunction(()=>document.querySelector('[data-prototype-file="src/cart.ts"] .review-unified-overlay').scrollTop===0);
 await card.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.screenshot({path:'/tmp/dc-comment-width-narrow.png'});
 await page.locator('#monaco-comments-toggle').click();
 await frame.waitForFunction(()=>document.querySelectorAll('[data-comment-id],.review-pr-thread').length===0&&[...document.querySelectorAll('.review-card-edge-host')].every(n=>n.style.getPropertyValue('--review-card-edge-fill')==='none'));
 await page.locator('#monaco-comments-toggle').click();
 await frame.evaluate(()=>diffLab.reveal('new',17));await inspect(frame,'src/cart.ts',false);
 console.log('PASS hiding cards clears right-edge paint and showing them restores it');
 check(!errors.length,'No page errors: '+JSON.stringify(errors));
 console.log('PASS width, layout, PR/local distinction, editing, resize/wrap and focus');
}catch(error){console.error(error.stack);console.error(errors);process.exitCode=1;}finally{await browser.close();}
