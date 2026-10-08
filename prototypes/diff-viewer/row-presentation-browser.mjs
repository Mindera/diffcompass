// View-only checks on disposable fixtures; no review/API mutations.
// node row-presentation-browser.mjs PLAYWRIGHT FULL_FIXTURE_URL STANDALONE_URL
import {pathToFileURL} from "node:url";
const [playwrightPath,fullUrl,labUrl]=process.argv.slice(2);
if(!labUrl)throw Error("Supply installed Playwright and disposable full/standalone fixture URLs.");
const {chromium}=await import(pathToFileURL(playwrightPath).href);
const browser=await chromium.launch({channel:"chrome",headless:true});
const errors=[],check=(value,message)=>{if(!value)throw Error(message);},pass=message=>console.log("PASS",message);
const settle=page=>page.evaluate(()=>new Promise(resolve=>{let n=0;const frame=()=>++n===10?resolve():requestAnimationFrame(frame);requestAnimationFrame(frame);}));
async function inspect(page,requireBoth=true){
 await settle(page);
 const result=await page.evaluate(()=>{
  const root=document.querySelector("#editor"),bounds=root.getBoundingClientRect(),unified=document.querySelector("#layout").value==="unified";
  const norm=c=>c.replaceAll(" ","").replace("rgba(0,0,0,0)","transparent");
  function at(gradient,y){let color="transparent";for(const m of gradient.matchAll(/(rgba?\([^)]*\)|transparent)\s+(-?[\d.]+)px/g)){if(+m[2]>y)break;color=m[1];}return norm(color);}
  const paint=[];
  for(const [side,selector]of unified?[["new",".cdr.line-insert"],["old",".line-delete-selectable > .view-line"]]:[["new",".cdr.line-insert"],["old",".cdr.line-delete"]]){
   const editor=unified?diffLab.editors.new:diffLab.editors[side],dom=editor.getDomNode();
   for(const node of dom.querySelectorAll(selector)){
    const rect=node.getBoundingClientRect();
    if(node.closest(".monaco-editor")!==dom||!rect.width||rect.height<1||rect.top<bounds.top||rect.bottom>bounds.bottom)continue;
    const y=(rect.top+rect.bottom)/2,color=norm(getComputedStyle(node.matches(".view-line")?node.parentElement:node).backgroundColor);
    for(const target of unified?["old","new"]:[side]){
     const margin=diffLab.editors[target].getDomNode().querySelector(":scope > .overflow-guard > .margin");
     paint.push({side,target,color,actual:at(margin.style.backgroundImage,y-margin.getBoundingClientRect().top)});
    }
   }
  }
  const cards=[...root.querySelectorAll(".review-zone")].filter(node=>{const r=node.getBoundingClientRect();return r.height&&r.top>=bounds.top&&r.bottom<=bounds.bottom;}).map(node=>{
   const y=node.getBoundingClientRect().top+node.getBoundingClientRect().height/2;
   return Object.values(diffLab.editors).map(editor=>{const margin=editor.getDomNode().querySelector(":scope > .overflow-guard > .margin");return at(margin.style.backgroundImage,y-margin.getBoundingClientRect().top);});
  });
  const markers=[...root.querySelectorAll(".review-badge:not([hidden])")].map(node=>{const r=node.getBoundingClientRect();return !r.width||!r.height||r.top<bounds.top||r.bottom>bounds.bottom||document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest(".review-badge")===node;});
  const headers=[...document.querySelectorAll("[data-file-toggle]")].map(toggle=>{
   const file=diffLab.session.comparison.files.find(f=>f.path===toggle.dataset.fileToggle),counts=toggle.querySelector(".prototype-file-counts"),status=toggle.querySelector(".prototype-file-status");
   return file&&counts?.querySelector(".added").textContent==="+"+file.additions&&counts.querySelector(".removed").textContent==="−"+file.deletions&&Boolean(counts.compareDocumentPosition(status)&Node.DOCUMENT_POSITION_FOLLOWING)&&toggle.lastChild.textContent===file.path;
  });
  const list=document.querySelector("#file-list"),section=root.closest(".prototype-file");
  return {paint,cards,markers,headers,clearance:list.getBoundingClientRect().right-section.getBoundingClientRect().right};
 });
 check(result.headers.length&&result.headers.every(Boolean),"Git totals before status/path");
 check(result.paint.length&&result.paint.every(p=>p.color===p.actual&&p.color!=="transparent"),"Source-row gutter colors: "+JSON.stringify(result.paint));
 if(requireBoth)check(new Set(result.paint.map(p=>p.side)).size===2,"Both added and removed source painted");
 check(result.cards.flat().every(c=>c==="transparent"),"Comment/card gap not painted as changed code: "+JSON.stringify(result.cards));
 check(result.markers.every(Boolean),"Gutter markers not intercepted");
 check(result.clearance>=13.5,"Inner scrolling list keeps header/editor outside scrollbar lane: "+result.clearance);
}
try{
 const lab=await browser.newPage({viewport:{width:1800,height:1100},colorScheme:"dark"});lab.setDefaultTimeout(15000);lab.on("pageerror",e=>errors.push(e.stack));
 await lab.goto(labUrl);await lab.waitForFunction(()=>window.diffLab);await lab.locator("#file").selectOption("checkout.ts");await lab.locator("#focus-prototype").click();
 for(const theme of ["dark","light"]){
  if(theme==="light")await lab.locator("#theme").click();
  for(const layout of ["unified","split"]){
   await lab.locator("#layout").selectOption(layout);
   for(const wrap of [true,false]){
    await lab.locator("#wrap").setChecked(wrap);await lab.evaluate(()=>diffLab.reveal("new",18));await inspect(lab);
    pass(theme+" / "+layout+" / "+(wrap?"wrap":"scroll")+": totals, tints, card gaps, marker hits, scrollbar lane");
   }
   await lab.screenshot({path:"/tmp/dc-row-"+theme+"-"+layout+".png"});
  }
 }
 const mutations=await lab.evaluate(()=>new Promise(resolve=>{
  let count=0;const observers=Object.values(diffLab.editors).map(e=>{const observer=new MutationObserver(records=>count+=records.length);observer.observe(e.getDomNode().querySelector(":scope > .overflow-guard > .margin"),{attributes:true,attributeFilter:["style"]});return observer;});
  setTimeout(()=>{observers.forEach(o=>o.disconnect());resolve(count);},350);
 }));
 check(mutations<5,"No gutter-paint mutation feedback loop: "+mutations);pass("Gutter painting settles without observer feedback");
 await lab.locator("#layout").selectOption("unified");await lab.locator("#wrap").check();await lab.setViewportSize({width:1000,height:850});
 for(const [file,side,line]of [["removed.ts","old",7],["added.ts","new",2]]){
  await lab.locator("#file").selectOption(file);
  await lab.waitForFunction(file=>diffLab.file.path===file,file);
  if(side==="new")await lab.evaluate(()=>diffLab.reveal("new",2));
  await inspect(lab,false);pass(file+": whole-file change including wrapped source");
 }
 await lab.close();
 const page=await browser.newPage({viewport:{width:1600,height:1050},colorScheme:"dark"});page.on("pageerror",e=>errors.push(e.stack));page.setDefaultTimeout(15000);
 await page.goto(fullUrl);await page.waitForFunction(()=>window.diffCompassIntegration?.child);
 await page.evaluate(()=>diffCompassMonacoHost.show("src/cart.ts"));
 const frame=page.frames().find(f=>f.url().includes("embedded=1"));
 // Anchor this two-sided color check at the actual removal. Revealing the
 // comment-heavy new line 17 can legitimately scroll that removal offscreen.
 await page.locator('[data-diff-layout="unified"]').click();await frame.evaluate(()=>diffLab.reveal("old",6));await inspect(frame);
 const outer=()=>page.evaluate(()=>{const panel=document.querySelector("#diff-panel"),frame=document.querySelector("#monaco-integration-frame");return panel.getBoundingClientRect().right-frame.getBoundingClientRect().right;});
 check(await outer()>=13.5,"Outer frame inset from overlay scrollbar");
 await page.screenshot({path:"/tmp/dc-row-full-desktop.png"});pass("Full fixture: matching native outer inset and inner scrollbar clearance");
 // Force classic native scrollbars in this test context as well as default macOS overlays.
 await page.addStyleTag({content:"#diff-panel{overflow-y:scroll;scrollbar-gutter:stable}#diff-panel::-webkit-scrollbar{width:18px;height:18px}"});
 await frame.addStyleTag({content:"#file-list{overflow-y:scroll;scrollbar-gutter:stable}#file-list::-webkit-scrollbar{width:18px;height:18px}"});await settle(frame);await inspect(frame);
 const nativeWidth=await page.evaluate(()=>{const e=document.querySelector("#diff-panel");return e.offsetWidth-e.clientWidth;});
 console.log("SCROLLBAR_GEOMETRY",{nativeWidth,clearance:await outer()});
 check(await outer()>=nativeWidth+13.5,"Reserved/native scrollbar also has clearance");pass("Explicit scrollbar width and stable gutter");
 await page.setViewportSize({width:390,height:844});
 await page.waitForFunction(()=>document.querySelector("#file-panel").getBoundingClientRect().right<=1);
 await settle(frame);check(await outer()>=13.5,"Narrow outer inset");check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),"No narrow horizontal overflow");
 await page.screenshot({path:"/tmp/dc-row-full-narrow.png"});pass("390px scrollbar clearance and no horizontal overflow");
 check(!errors.length,"Page errors: "+JSON.stringify(errors));pass("Zero page errors");
} catch(error){console.error(error.stack);console.error("PAGE_ERRORS",errors);process.exitCode=1;} finally{await browser.close();}
