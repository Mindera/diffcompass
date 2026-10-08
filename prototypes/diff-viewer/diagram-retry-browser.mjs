// Browser-local failure injection. Never invokes agent generation or edits saved fixture data.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const [playwrightPath,url]=process.argv.slice(2);
const {chromium}=await import(pathToFileURL(playwrightPath).href);
const browser=await chromium.launch({channel:'chrome',headless:true}),errors=[],generationRequests=[];
async function pageFor(context) {
 const page=await context.newPage();page.setDefaultTimeout(15000);
 page.on('pageerror',error=>errors.push(error.stack));
 page.on('request',request=>{if(request.url().includes('/flows/regenerate'))generationRequests.push(request.url());});
 await page.goto(url);await page.waitForFunction(()=>window.diffCompassIntegration?.child);
 return page;
}
const openSequence=async page=>{await page.locator('#archify-tab').click();await page.locator('[data-map-view=sequence]').click();};
try {
 const healthyContext=await browser.newContext({viewport:{width:1500,height:1000}});
 const healthy=await pageFor(healthyContext);await openSequence(healthy);
 assert.equal(await healthy.locator('#regenerate-flows').isVisible(),false);
 assert.equal(await healthy.locator('[data-flow-action=regenerate]').count(),0);
 await healthyContext.close();console.log('PASS healthy sequence view has no Retry or Regenerate controls');

 const context=await browser.newContext({viewport:{width:1500,height:1000}});
 let base,successful=false,attempts=0,release;
 await context.route('**/api/session',async route=>{
  const response=await route.fetch(),session=await response.json();base=structuredClone(session);
  if(!successful)session.outline.archifyFailures=[{id:'sequence-checkout-flow',type:'sequence',message:'Simulated renderer failure',preservedLastValid:true}];
  await route.fulfill({response,json:session});
 });
 await context.route('**/api/diagrams/retry',async route=>{
  assert.deepEqual(route.request().postDataJSON(),{type:'sequence'});attempts++;
  await new Promise(resolve=>{release=resolve;});
  if(attempts===1)await route.fulfill({status:503,json:{error:'Simulated renderer still unavailable'}});
  else {successful=true;await route.fulfill({json:base});}
 });
 const page=await pageFor(context);await openSequence(page);
 const retry=page.locator('#regenerate-flows');await retry.waitFor();assert.equal(attempts,0);
 const lastValid=await page.locator('#sequence-map-artifacts iframe').elementHandle();
 await retry.click();await page.waitForFunction(()=>document.querySelector('#regenerate-flows').disabled&&document.querySelector('#regenerate-flows').textContent==='Retrying…');
 while(!release)await new Promise(resolve=>setTimeout(resolve,10));release();
 await page.waitForFunction(()=>!document.querySelector('#regenerate-flows').disabled);
 assert.equal(await retry.isVisible(),true);assert.equal(await lastValid.evaluate(node=>node.isConnected),true);
 assert.equal(attempts,1);
 release=null;await retry.click();await page.waitForFunction(()=>document.querySelector('#regenerate-flows').disabled);
 while(!release)await new Promise(resolve=>setTimeout(resolve,10));release();
 await retry.waitFor({state:'hidden'});assert.equal(attempts,2);
 assert.equal(await page.locator('#sequence-map-artifacts .archify-failure').count(),0);
 console.log('PASS Retry is failure-only, disabled while pending, retained after failure and hidden after success; last valid map survives failure');
 await context.close();

 const nativeContext=await browser.newContext({viewport:{width:1500,height:1000}});
 await nativeContext.route('**/api/session',async route=>{
  const response=await route.fetch(),session=await response.json();
  session.outline.archifyArtifacts=session.outline.archifyArtifacts.filter(artifact=>artifact.type!=='sequence');
  session.outline.archifyFailures=[];await route.fulfill({response,json:session});
 });
 const native=await pageFor(nativeContext);let nativeRequests=0;
 native.on('request',request=>{if(request.url().includes('/api/diagrams/retry'))nativeRequests++;});
 await native.evaluate(()=>{
  window.failSequenceRender=true;
  const render=window.mermaid.render.bind(window.mermaid);
  window.mermaid.render=(id,...args)=>window.failSequenceRender&&id.startsWith('diffcompass-flow-')?Promise.reject(Error('Simulated native-render failure')):render(id,...args);
 });
 await openSequence(native);const nativeRetry=native.locator('#regenerate-flows');await nativeRetry.waitFor();
 await nativeRetry.click();await native.waitForFunction(()=>!document.querySelector('#regenerate-flows').disabled);
 assert.equal(await nativeRetry.isVisible(),true);
 await native.evaluate(()=>{window.failSequenceRender=false;});await nativeRetry.click();
 await native.locator('#flows .mermaid-render svg').waitFor();await nativeRetry.waitFor({state:'hidden'});
 assert.equal(nativeRequests,0);
 console.log('PASS native-render failure retries saved source locally and clears on success');
 await nativeContext.close();assert.deepEqual(generationRequests,[]);assert.deepEqual(errors,[]);console.log('PAGE_ERRORS [] · AGENT_GENERATION_REQUESTS []');
}catch(error){console.error('FAIL',error.stack);console.error('PAGE_ERRORS',errors);process.exitCode=1;}
finally{await browser.close();}
