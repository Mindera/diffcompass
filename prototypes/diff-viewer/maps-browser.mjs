// Browser-local checks against a disposable full fixture; no session writes.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const [playwrightPath,url]=process.argv.slice(2);
if(!playwrightPath||!url)throw Error('Supply an existing Playwright module and disposable fixture URL.');
const {chromium}=await import(pathToFileURL(playwrightPath).href);
const browser=await chromium.launch({channel:'chrome',headless:true}),errors=[];
const context=await browser.newContext({viewport:{width:1600,height:1050},colorScheme:'dark'});
const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.stack));
const nav=view=>page.locator(`[data-map-view="${view}"]`);
try {
 await page.goto(url);await page.waitForFunction(()=>window.diffCompassIntegration?.child);
 await page.locator('#archify-tab').click();
 assert.equal(await page.locator('#maps-understand-select').count(),0);
 assert.equal(await page.locator('#archify-tab').innerText(),'Diagrams');
 assert.deepEqual(await page.locator('#maps-navigation button:visible').allTextContents(),['Architecture & design','Blast radius','Call flows','Sequence diagrams','Data & lifecycle']);
 assert.equal(await nav('archify').getAttribute('aria-pressed'),'true');
 assert.ok((await page.locator('#archify-select option').evaluateAll(ns=>ns.map(n=>n.value))).every(id=>!id.startsWith('sequence-')&&!id.startsWith('lifecycle-')&&!id.startsWith('dataflow-')));
 await nav('call-flows').click();await page.locator('#call-flows-view').waitFor();
 assert.equal(await nav('call-flows').getAttribute('aria-pressed'),'true');
 await nav('structural-blast-radius').click();await page.locator('#structural-blast-radius-view').waitFor();
 assert.equal(await nav('structural-blast-radius').textContent(),'Blast radius');
 console.log('PASS flat peer navigation, per-view active state and architecture-only Understand picker');
 await nav('sequence').focus();await page.keyboard.press('Enter');
 await page.locator('#sequence-map-select').selectOption('sequence-checkout-flow');
 const iframe=page.locator('#sequence-map-artifacts iframe.archify-frame'),handle=await iframe.elementHandle(),map=await handle.contentFrame();
 await map.locator('.sequence-step-code').first().waitFor();
 await map.waitForFunction(()=>[...document.querySelectorAll('.sequence-code-step')].every(n=>n.querySelector('.sequence-step-code')));
 assert.equal(await map.locator('.sequence-code-step').count(),4);
 assert.equal(await page.locator('#flows .flow-card').count(),0,'Interactive sequence has no duplicate Mermaid card');
 const camera=()=>map.evaluate(()=>({camera:Archify.view.state(),selected:document.querySelector('.sequence-code-step.selected')?.dataset.sequenceMessageId}));
 await map.locator('.sequence-step-select').nth(1).click();const before=await camera();
 await nav('adaptive').click();await page.locator('#adaptive-view').waitFor();
 assert.ok((await page.locator('#adaptive-map-select option').evaluateAll(ns=>ns.map(n=>n.textContent))).every(label=>!label.startsWith('Sequence')));
 await nav('archify').click();await nav('sequence').click();
 assert.equal(await handle.evaluate(n=>n.isConnected),true);assert.deepEqual(await camera(),before);
 assert.equal(await page.locator('#sequence-map-select').inputValue(),'sequence-checkout-flow');
 console.log('PASS interactive sequences/data grouped correctly; keyboard navigation and exact iframe/camera/selection survive category switches');
 const mono=page.frames().find(f=>f.url().includes('embedded=1'));
 await map.locator('.sequence-code-step').nth(1).getByRole('button',{name:'View code',exact:true}).click();
 await page.locator('#monaco-integration-frame').waitFor();
 await mono.waitForFunction(()=>diffLab.file.path==='src/receipt.ts'&&diffLab.anchor?.side==='new'&&diffLab.anchor?.line===4);
 await page.locator('#sequence-source-return').click();await iframe.waitFor();
 assert.equal(await nav('sequence').getAttribute('aria-pressed'),'true');assert.deepEqual(await camera(),before);
 await page.locator('#diff-tab').click();await page.locator('#archify-tab').click();
 assert.equal(await nav('sequence').getAttribute('aria-pressed'),'true');
 console.log('PASS sequence code → captured Monaco source → exact return; Maps remembers the selected peer view');
 await page.screenshot({path:'/tmp/dc-map-navigation-desktop.png'});
 await page.setViewportSize({width:390,height:844});
 // A desktop-open file sidebar becomes a mobile overlay on resize. Close it
 // before asserting pointer reachability, rather than checking obscured boxes.
 if(await page.evaluate(()=>document.body.classList.contains('file-panel-open')))await page.locator('#file-panel-close').click();
 await page.waitForFunction(()=>document.querySelector('#file-panel').getBoundingClientRect().right<=0);
 await page.locator('#maps-navigation').scrollIntoViewIfNeeded();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 const boxes=await page.locator('#maps-navigation button:visible').evaluateAll(ns=>ns.map(n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right};}));
 assert.ok(boxes.every(b=>b.left>=0&&b.right<=391));
 for(const view of ['archify','structural-blast-radius','call-flows','adaptive','sequence']) {
  await nav(view).click();assert.equal(await nav(view).getAttribute('aria-pressed'),'true');
  await page.locator(`#${view}-view`).waitFor();
  if(['archify','sequence','adaptive'].includes(view)) {
   const toolbar=page.locator(`#${view}-view .flows-toolbar`).first();
   assert.ok(await toolbar.evaluate(node=>[...node.children].filter(n=>n.getClientRects().length).every(n=>{const r=n.getBoundingClientRect(),bounds=node.getBoundingClientRect();return r.left>=bounds.left-1&&r.right<=bounds.right+1;})),'Map picker and controls fit the narrow toolbar');
  }
 }
 await page.screenshot({path:'/tmp/dc-map-navigation-narrow.png'});
 console.log('PASS all map destinations remain reachable at 390px without horizontal overflow');
 await context.close();
 // Simulate an older/fallback-only session in this browser's GET response.
 // Saved fixture state, comparison trees and source endpoints remain intact.
 const fallbackContext=await browser.newContext({viewport:{width:1450,height:1000}}),fallback=await fallbackContext.newPage();
 fallback.setDefaultTimeout(15000);fallback.on('pageerror',e=>errors.push(e.stack));
 await fallbackContext.route('**/api/session',async route=>{
  const response=await route.fetch(),session=await response.json();
  session.outline.archifyArtifacts=[];
  session.outline.archifyFailures=[{id:'sequence-checkout-flow',type:'sequence',message:'Simulated renderer failure',preservedLastValid:false}];
  await route.fulfill({response,json:session});
 });
 await fallback.goto(url);await fallback.waitForFunction(()=>window.diffCompassIntegration?.child);
 await fallback.locator('#archify-tab').click();
 assert.equal(await fallback.locator('#archify-view .archify-failure').count(),0);
 await fallback.locator('[data-map-view=sequence]').click();
 await fallback.locator('#flows .mermaid-render svg').first().waitFor();
 assert.equal(await fallback.locator('#sequence-map-artifacts .archify-failure').count(),1);
 assert.equal(await fallback.locator('#sequence-map-select').isVisible(),false);
 await fallback.locator('[data-map-view=adaptive]').click();
 await fallback.locator('#adaptive-diagrams .mermaid-render svg').first().waitFor();
 assert.equal(await fallback.locator('#adaptive-map-artifacts .archify-failure').count(),0);
 console.log('PASS fallback-only sequence and data/lifecycle views stay reachable; failure diagnostics remain in their own category');
 await fallbackContext.close();assert.deepEqual(errors,[]);console.log('PAGE_ERRORS []');
}catch(e){console.error('FAIL',e.stack);console.error('PAGE_ERRORS',errors);process.exitCode=1;}
finally{await browser.close();}
