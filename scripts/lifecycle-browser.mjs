// Interactive and browser-local fallback checks; use a disposable scripts/lifecycle-fixture.ts review on the current main UI.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {setDiagramViewport} from './archify-browser-viewport.mjs';
const [playwrightPath,url]=process.argv.slice(2);
if(!playwrightPath||!url)throw Error('Supply an installed Playwright module and fixture URL.');
const {chromium}=await import(pathToFileURL(playwrightPath).href);
const browser=await chromium.launch({channel:'chrome',headless:true}),errors=[];
let page=await browser.newPage({viewport:{width:1500,height:1050},colorScheme:'dark'});
page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.stack));
const activate=async locator=>{
 await locator.scrollIntoViewIfNeeded();
 // Let the child frame paint at its new parent scroll position before input.
 await locator.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await locator.click();
};
try {
 await setDiagramViewport(page,{width:1500,height:1050});
 await page.goto(url);await page.locator('#archify-tab').waitFor();
 await page.locator('#archify-tab').click();await page.locator('[data-map-view=adaptive]').click();
 assert.ok((await page.locator('#adaptive-map-select option').evaluateAll(nodes=>nodes.map(node=>node.value))).includes('lifecycle-state-machine'));
 await page.locator('#adaptive-map-select').selectOption('lifecycle-state-machine');
 const interactive=page.locator('#adaptive-map-artifacts .archify-artifact');
 const headerAlignment=()=>interactive.locator('.architecture-card-heading > div').evaluate(heading=>{
  const label=heading.querySelector('.architecture-label').getBoundingClientRect(),title=heading.querySelector('h2').getBoundingClientRect();
  return Math.abs(label.top+label.height/2-title.top-title.height/2);
 });
 assert.ok(await headerAlignment()<1,'Validated map label is vertically centered beside its title');
 const iframe=interactive.locator('iframe.archify-frame');
 const map=await (await iframe.elementHandle()).contentFrame();
 await map.waitForFunction(()=>window.Archify?.view?.state().mode==='review');
 const mapSvg=map.locator('.diagram-container > svg');
 assert.deepEqual(await mapSvg.locator(':scope > text').evaluateAll(nodes=>nodes.filter(node=>getComputedStyle(node).display!=='none'&&/^[0-9]+ \/ /.test(node.textContent)).map(node=>node.textContent)),['01 / States','02 / Terminal exits']);
 assert.equal(await mapSvg.locator('g[data-node-id]').count(),5);
 assert.equal(await mapSvg.locator('path[data-edge-from]').count(),7);
 assert.deepEqual(await mapSvg.locator('path[data-edge-from]').evaluateAll(nodes=>nodes.map(n=>[n.dataset.edgeFrom,n.dataset.edgeTo]).sort()),[
  ['Pending','Formatting'],['Pending','Cancelled'],['Formatting','Ready'],['Formatting','Failed'],['Formatting','Cancelled'],['Failed','Formatting'],['Failed','Cancelled'],
 ].sort());
 for(const label of ['Pending','Formatting','Failed','Ready','Cancelled','start','succeed','fail','retry','cancel','Initial state','Terminal exit'])assert.ok((await mapSvg.textContent()).includes(label),label);
 assert.deepEqual(await mapSvg.evaluate(svg=>{
  const issues=[],boxes=new Map([...svg.querySelectorAll('g[data-node-id]')].map(n=>[n.dataset.nodeId,n.querySelector('rect').getBBox()]));
  const overlap=(a,b,pad=0)=>a.x<b.x+b.width+pad&&a.x+a.width+pad>b.x&&a.y<b.y+b.height+pad&&a.y+a.height+pad>b.y;
  const segment=(a,b)=>({x:Math.min(a[0],b[0]),y:Math.min(a[1],b[1]),width:Math.abs(a[0]-b[0]),height:Math.abs(a[1]-b[1])});
  const exits=(p,q,b)=>(p[0]===b.x&&q[0]<p[0]&&q[1]===p[1])||(p[0]===b.x+b.width&&q[0]>p[0]&&q[1]===p[1])||(p[1]===b.y&&q[1]<p[1]&&q[0]===p[0])||(p[1]===b.y+b.height&&q[1]>p[1]&&q[0]===p[0]);
  for(const edge of svg.querySelectorAll('path[data-edge-from]')){
   const points=edge.dataset.compositionPoints.split(';').map(p=>p.split(',').map(Number)),from=edge.dataset.edgeFrom,to=edge.dataset.edgeTo;
   if(!exits(points[0],points[1],boxes.get(from))||!exits(points.at(-1),points.at(-2),boxes.get(to)))issues.push('endpoint direction '+from+' -> '+to);
   for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i];if(a[0]!==b[0]&&a[1]!==b[1])issues.push('diagonal route');
    for(const [id,box] of boxes)if(id!==from&&id!==to&&overlap(segment(a,b),box,2))issues.push('route through '+id);
   }
  }
  const labels=[...svg.querySelectorAll('g[data-edge-from] > text')].map(n=>n.getBBox());
  for(let i=0;i<labels.length;i++){
   for(const [id,box] of boxes)if(overlap(labels[i],box))issues.push('label overlaps '+id);
   for(let j=0;j<i;j++)if(overlap(labels[i],labels[j]))issues.push('labels overlap');
  }
  return issues;
 }),[],'Rendered SVG preserves perpendicular endpoints and clears states and actual text bounds');
 assert.equal(await page.locator('#adaptive-diagrams .adaptive-card').count(),0,'Validated lifecycle has no duplicate fallback card');
 assert.equal(await page.locator('#adaptive-map-artifacts .archify-failure').count(),0);
 // Retain explicit keyboard coverage alongside the pointer interactions.
 await map.locator('g[data-node-id="Pending"]').focus();
 await map.locator('g[data-node-id="Pending"]').press('Enter');
 await map.waitForFunction(()=>document.querySelector('#focus-id')?.textContent==='Pending');
 await activate(map.locator('#btn-focus-clear'));
 await activate(map.locator('g[data-node-id="Failed"]'));
 await map.waitForFunction(()=>document.querySelector('#focus-id')?.textContent==='Failed');
 const scale=await map.evaluate(()=>Archify.view.state().scale);
 await activate(map.locator('[data-diffcompass-action="in"]'));
 assert.ok(await map.evaluate(previous=>Archify.view.state().scale>previous,scale));
 await activate(map.getByRole('button',{name:'Fit entire map',exact:true}));
 await activate(map.locator('#btn-present'));
 await page.waitForFunction(()=>document.querySelector('iframe[data-archify-artifact-id="lifecycle-state-machine"]').hasAttribute('popover'));
 await activate(map.getByRole('button',{name:'Fit entire map',exact:true}));
 await page.screenshot({path:'/tmp/dc-lifecycle-interactive-expanded.png'});
 await activate(map.locator('#btn-present'));
 await page.waitForFunction(()=>!document.querySelector('iframe[data-archify-artifact-id="lifecycle-state-machine"]').hasAttribute('popover'));
 await interactive.locator('summary').filter({hasText:'Sources and technical validation'}).click();
 assert.ok((await interactive.locator('.archify-evidence').textContent()).includes('src/receipt-job.ts:6-12'));
 await interactive.screenshot({path:'/tmp/dc-lifecycle-interactive-desktop.png'});
 const sourceLink=interactive.getByRole('button',{name:'src/receipt-job.ts',exact:true});
 await sourceLink.scrollIntoViewIfNeeded();
 await activate(map.locator('[data-diffcompass-action="in"]'));
 await sourceLink.scrollIntoViewIfNeeded();
 const beforeSource=await map.evaluate(()=>({camera:Archify.view.state(),selected:document.querySelector('#focus-id')?.textContent}));
 const sourceScroll=await page.locator('#diff-panel').evaluate(panel=>panel.scrollTop);
 const frameHandle=await iframe.elementHandle();
 await sourceLink.click();
 await page.locator('#diff-view:not(.hidden) .diff-row[data-path="src/receipt-job.ts"][data-side="new"]').first().waitFor();
 assert.ok((await page.locator('#diff').textContent()).includes('Failed: { retry: "Formatting", cancel: "Cancelled" }'));
 await page.getByRole('button',{name:'Back to diagram'}).click();
 await iframe.waitFor();
 assert.equal(await page.locator('#adaptive-map-select').inputValue(),'lifecycle-state-machine');
 assert.equal(await frameHandle.evaluate(frame=>frame.isConnected),true,'Return retains the mounted lifecycle iframe');
 assert.deepEqual(await map.evaluate(()=>({camera:Archify.view.state(),selected:document.querySelector('#focus-id')?.textContent})),beforeSource);
 await page.waitForFunction(expected=>Math.abs(document.querySelector('#diff-panel').scrollTop-expected)<2,sourceScroll);
 assert.equal(await page.getByRole('button',{name:'Back to diagram'}).isVisible(),false);
 console.log('PASS validated lifecycle, source → Back to diagram preserves its selection, iframe, camera, inspection and scroll; heading is vertically centered');
 await setDiagramViewport(page,{width:390,height:844});
 if(await page.evaluate(()=>document.body.classList.contains('file-panel-open')))await page.locator('#file-panel-close').click();
 await page.waitForFunction(()=>document.querySelector('#file-panel').getBoundingClientRect().right<=0);
 await interactive.scrollIntoViewIfNeeded();
 assert.ok(await headerAlignment()<1,'Heading stays vertically centered when the title wraps');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await activate(map.locator('#btn-present'));
 await page.waitForFunction(()=>document.querySelector('iframe[data-archify-artifact-id="lifecycle-state-machine"]').hasAttribute('popover'));
 await activate(map.getByRole('button',{name:'Fit entire map',exact:true}));
 await page.screenshot({path:'/tmp/dc-lifecycle-interactive-narrow.png'});
 await activate(map.locator('#btn-present'));
 console.log('PASS interactive lifecycle and pointer-expanded viewer remain reachable at 390px without page overflow');
 await page.close();
 // Simulate a genuine unavailable artifact only in this browser's response.
 // The saved fixture and its validated interactive artifact remain untouched.
 const fallbackContext=await browser.newContext({viewport:{width:1500,height:1050},colorScheme:'dark'});
 await fallbackContext.route('**/api/session',async route=>{
  const response=await route.fetch(),session=await response.json();
  session.outline.archifyArtifacts=session.outline.archifyArtifacts.filter(a=>a.id!=='lifecycle-state-machine');
  session.outline.archifyFailures=[{id:'lifecycle-state-machine',type:'lifecycle',message:'Simulated local renderer failure',preservedLastValid:false}];
  await route.fulfill({response,json:session});
 });
 page=await fallbackContext.newPage();await setDiagramViewport(page,{width:1500,height:1050});page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.stack));
 await page.goto(url);await page.locator('#archify-tab').waitFor();
 await page.locator('#archify-tab').click();await page.locator('[data-map-view=adaptive]').click();
 await page.locator('#adaptive-map-artifacts iframe.archify-frame').waitFor();
 assert.equal(await page.locator('#adaptive-view').isVisible(),true,'Interactive maps and native fallbacks share the Data & lifecycle view');
 assert.equal(await page.locator('#adaptive-map-select option[value="lifecycle-state-machine"]').count(),0);
 await page.locator('#adaptive-map-select').selectOption('native-state');
 const card=page.locator('#adaptive-diagrams .adaptive-card').filter({has:page.getByRole('heading',{name:'Receipt job: retry or cancel',exact:true})});
 const diagram=card.locator('[data-adaptive-diagram=state]'),svg=diagram.locator('svg');
 await svg.waitFor();assert.equal(await card.count(),1);
 for(const label of ['Pending','Formatting','Failed','Ready','Cancelled','start','succeed','fail','retry','cancel'])assert.ok((await svg.textContent()).includes(label),label);
 assert.equal(await page.locator('#adaptive-map-select option[value="lifecycle-state-machine"]').count(),0,'No stale linear lifecycle conversion');
 assert.equal(await page.locator('#adaptive-map-artifacts iframe.archify-frame').isVisible(),false,'Interactive maps are hidden while viewing the native fallback');
 assert.equal(await page.locator('#adaptive-map-select').inputValue(),'native-state');
 await card.scrollIntoViewIfNeeded();
 await page.screenshot({path:'/tmp/dc-lifecycle-native-picker.png'});
 await card.getByText('Repository evidence',{exact:true}).click();
 assert.ok((await card.locator('.adaptive-evidence').textContent()).includes('src/receipt-job.ts:6-12'));
 console.log('PASS native state machine retains labels and evidence while interactive data remains available');
 await card.getByRole('button',{name:'Zoom diagram in',exact:true}).click();
 assert.notEqual(await card.locator('[data-diagram-zoom-label]').textContent(),'100%');
 await card.getByRole('button',{name:'Move diagram right',exact:true}).click();
 await card.getByRole('button',{name:'Reset diagram view',exact:true}).click();
 assert.equal(await card.locator('[data-diagram-zoom-label]').textContent(),'100%');
 await card.getByRole('button',{name:'Expand State machine diagram',exact:true}).click();
 await page.locator('#architecture-viewer-dialog[open] svg').waitFor();
 assert.equal(await page.locator('#architecture-viewer-title').textContent(),'Receipt job: retry or cancel');
 await setDiagramViewport(page,{width:1500,height:1800});
 await page.locator('#architecture-viewer-dialog').screenshot({path:'/tmp/dc-lifecycle-native-expanded.png'});
 await setDiagramViewport(page,{width:1500,height:1050});
 await page.locator('#close-architecture-viewer').click();
 await card.screenshot({path:'/tmp/dc-lifecycle-native-desktop.png'});
 console.log('PASS state-machine move/zoom/reset and expanded viewer');
 await card.locator('.flow-impact summary').click();
 await card.getByRole('button',{name:'src/receipt-job.ts',exact:true}).click();
 await page.locator('#diff-view:not(.hidden) .diff-row[data-path="src/receipt-job.ts"][data-side="new"]').first().waitFor();
 assert.ok((await page.locator('#diff').textContent()).includes('Failed: { retry: "Formatting", cancel: "Cancelled" }'));
 await page.getByRole('button',{name:'Back to diagram'}).click();
 await svg.waitFor();
 assert.equal(await page.locator('#adaptive-map-select').inputValue(),'native-state');
 assert.equal(await page.getByRole('button',{name:'Back to diagram'}).isVisible(),false);
 console.log('PASS native lifecycle source navigation returns to the selected Mermaid fallback');
 await setDiagramViewport(page,{width:390,height:844});
 if(await page.evaluate(()=>document.body.classList.contains('file-panel-open')))await page.locator('#file-panel-close').click();
 await page.waitForFunction(()=>document.querySelector('#file-panel').getBoundingClientRect().right<=0);
 await card.scrollIntoViewIfNeeded();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await card.getByRole('button',{name:'Expand State machine diagram',exact:true}).click();
 await page.locator('#architecture-viewer-dialog[open] svg').waitFor();
 await page.locator('#close-architecture-viewer').click();
 await card.screenshot({path:'/tmp/dc-lifecycle-native-narrow.png'});
 console.log('PASS narrow state-machine card and expanded viewer are reachable without page overflow');
 assert.deepEqual(errors,[]);console.log('PAGE_ERRORS []');
}catch(error){await page.screenshot({path:'/tmp/dc-lifecycle-browser-failure.png'});console.error('FRAME_STATE',await page.locator('iframe.archify-frame').evaluateAll(nodes=>nodes.map(n=>({id:n.dataset.archifyArtifactId,popover:n.getAttribute('popover'),rect:n.getBoundingClientRect().toJSON()}))));console.error('FAIL',error.stack);console.error('PAGE_ERRORS',errors);process.exitCode=1;}
finally{await browser.close();}
