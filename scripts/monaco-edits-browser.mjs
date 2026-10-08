// Disposable fixtures only: proposals must be inert until an explicit Apply.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [playwrightPath, url, repository] = process.argv.slice(2);
assert.match(repository, /diffcompass-monaco-production-[^/]+\/fixture\/repository$/);
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1800, height: 1000 }, colorScheme: 'dark', reducedMotion: 'reduce' });
page.setDefaultTimeout(20000);
const errors = []; page.on('pageerror', error => errors.push(error.message));
page.on('dialog', dialog => { errors.push(`Unexpected native dialog: ${dialog.message()}`); void dialog.dismiss(); });
const path = 'src/cart.ts', original = await readFile(join(repository, path), 'utf8');
let frame;
async function file(expectedContent) {
  // Applying a proposal changes comparison identity and replaces the iframe.
  // A successful API response can arrive before that remount. Wait in the
  // surviving parent document, then acquire the refreshed frame, never poll a
  // handle that is about to detach.
  await page.waitForFunction(({ path, expectedContent }) => [...document.querySelectorAll('.monaco-review-frame')].some(frame => {
    if (frame.dataset.monacoPath !== path || frame.closest('.monaco-phase-staging')) return false;
    const view = frame.contentWindow?.diffLab?.views.get(path);
    return view?.diff.getLineChanges() && (expectedContent === undefined || view.editors.new.getValue().includes(expectedContent));
  }), { path, expectedContent });
  frame = page.frames().find(frame => new URL(frame.url(), url).searchParams.get('file') === path);
}
const draftValue = () => frame.evaluate(() => monaco.editor.getModels().find(model => model.uri.scheme === 'inmemory' && model.uri.authority === 'review-suggestion')?.getValue());
async function open(line = 17, endLine = line) {
  await frame.evaluate(({line,endLine}) => {
    const editor = diffLab.views.get('src/cart.ts').editors.new;
    editor.setSelection(new monaco.Range(line, 4, endLine, editor.getModel().getLineMaxColumn(endLine)));
    editor.focus();
  }, {line,endLine});
  // Put the selected source in the outer viewport too (a per-file iframe
  // can be taller than the page, especially with existing suggestion cards).
  await frame.locator('.editor.modified .view-line').filter({hasText:'return amount'}).first().evaluate(node=>node.scrollIntoView({block:'center',behavior:'instant'}));
  await page.keyboard.press('Shift+F10');
  // Monaco ignores menu mouse-up during its first 100ms, including menus
  // opened from the keyboard. Match the existing pointer-menu regression.
  await page.waitForTimeout(150);
  await frame.getByRole('menuitem', { name: 'Suggest edit', exact: true }).click();
  await frame.locator('form.review-suggestion').waitFor();
}
async function typeReplacement(value) {
  await frame.evaluate(() => monaco.editor.getEditors().find(editor => editor.getDomNode()?.closest('.review-suggestion-editor')).focus());
  await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.insertText(value);
}
try {
  await page.goto(url);
  const token = new URL(url).hash.slice(7);
  const snapshot = await page.evaluate(async token => {
    let session;
    for(let i=0;i<4;i++) session=await (await fetch('/api/tour/navigate',{method:'POST',headers:{'x-diffcompass-token':token,'content-type':'application/json'},body:JSON.stringify({direction:'previous'})})).json();
    return session;
  }, token);
  const samplePr = Boolean(snapshot.pullRequestFixture);
  const applyLabel = samplePr ? 'Apply locally' : 'Apply';
  if (samplePr) assert.equal(snapshot.fixtureCanApplySuggestions, true);
  await page.reload();
  await page.locator('#step-count').filter({hasText:'Step '}).waitFor({state:'attached'});
  await page.locator('#diff-renderer').selectOption('monaco'); await file();
  for(const layout of ['split','unified']) {
    await page.locator(`[data-diff-layout="${layout}"]`).click();
    await frame.waitForFunction(layout=>document.getElementById('layout').value===layout,layout);
    // Menu positioning uses the iframe viewport: let the requested layout
    // and the outer card finish resizing before opening a native menu.
    await page.waitForTimeout(250);
    await open(16,17);
    await page.waitForTimeout(400);
    await page.screenshot({path:`/tmp/dc-edits-composer-${layout}.png`});
    const submitBounds=await frame.getByRole('button',{name:'Propose edit',exact:true}).boundingBox();
    assert.ok(submitBounds.y+submitBounds.height<=1000,'Opening a suggestion reveals the complete form');
    assert.equal(await draftValue(), original.replaceAll('\r\n','\n').split('\n').slice(15,17).join('\n'));
    await typeReplacement('jk draft retained'); await page.keyboard.press('j'); await page.keyboard.press('k');
    assert.match(await page.locator('#step-count').textContent(), /Step 1\)/, 'J/K in the editable draft never navigates');
    await page.locator('#diff-renderer').selectOption('current');
    assert.equal(await page.locator('#diff-renderer').inputValue(), 'monaco');
    assert.equal(await draftValue(), 'jk draft retainedjk');
    await page.locator('#next-step').click();
    await page.locator('.monaco-file-slot[data-path="src/cart.ts"] > header').getByRole('button',{name:/^(Mark as reviewed|✓ Reviewed)$/}).click();
    assert.match(await page.locator('#step-count').textContent(),/Step 1\)/);
    assert.equal(await draftValue(),'jk draft retainedjk','Navigation/review cannot discard the open draft');
    await frame.getByRole('button',{name:'Cancel',exact:true}).click();
    assert.equal(await frame.evaluate(()=>monaco.editor.getModels().length),2,'Cancelling disposes the draft model');
    assert.equal(await readFile(join(repository,path),'utf8'),original);
    console.log(`PASS ${layout}: full-line draft from selected code, editable J/K, renderer guard and cancel without source changes`);
  }
  await page.locator('[data-diff-layout="split"]').click();
  await frame.evaluate(()=>{
    const editor=diffLab.views.get('src/cart.ts').editors.old;editor.setPosition({lineNumber:6,column:1});editor.focus();
  });
  assert.equal(await frame.evaluate(()=>diffLab.views.get('src/cart.ts').editors.old.getAction('diff-lab.new.suggest-edit')),null,'Before source has no Suggest edit action');
  assert.equal(await frame.getByRole('button',{name:'Suggest edit',exact:true}).count(),0,'Suggest edit is not duplicated in the file toolbar');
  await open();
  const replacement='  return amount - amount * (discount.percentage / 100);';
  await typeReplacement(replacement);
  await page.route('**/api/edits', route=>route.fulfill({status:409,json:{error:'This draft belongs to a previous comparison.'}}));
  await frame.getByRole('button',{name:'Propose edit',exact:true}).click();
  await frame.getByRole('alert').filter({hasText:'previous comparison'}).waitFor();
  assert.equal(await draftValue(),replacement,'Failed saves retain the full editable draft');
  await page.unroute('**/api/edits');
  await page.route('**/api/edits', async route => {
    // Let clearing the previous error resize the form before the save returns.
    // Even a slow retry must retain the original reading position.
    await new Promise(resolve=>setTimeout(resolve,300)); await route.continue();
  });
  await frame.evaluate(()=>{
    window.__suggestionOrigin = true;
    document.querySelector('form.review-suggestion').addEventListener('submit',()=>{
      window.__submitScroll = parent.document.querySelector('#diff-panel').scrollTop;
    },{once:true,capture:true});
  });
  const response = page.waitForResponse(response=>new URL(response.url()).pathname==='/api/edits'&&response.status()===200);
  await frame.getByRole('button',{name:'Propose edit',exact:true}).click();
  const result=await (await response).json();
  await page.unroute('**/api/edits');
  let card = frame.locator(`[data-suggestion-id="${result.activityId}"]`);
  await card.waitFor(); await page.waitForTimeout(400);
  assert.equal(await frame.evaluate(()=>window.__suggestionOrigin),true,'Submitting keeps the same diff editor');
  const beforeSubmit = await frame.evaluate(()=>window.__submitScroll), afterSubmit=await page.evaluate(()=>document.querySelector('#diff-panel').scrollTop);
  assert.ok(Math.abs(afterSubmit-beforeSubmit)<=1,`Submitting preserves the page scroll position: ${beforeSubmit} → ${afterSubmit}`);
  assert.match(await page.locator('#step-count').textContent(),/Step 1\)/,'Submitting does not move the tour');
  assert.equal(await page.locator('[data-preview-activity-action]').count(),0,'Submitting does not open a separate proposal preview');
  assert.equal(await readFile(join(repository,path),'utf8'),original,'Proposing leaves the source untouched');
  assert.equal(result.session.activities.find(activity=>activity.id===result.activityId).changeStatus,'pending');
  assert.ok((await card.textContent()).replaceAll('\u00a0',' ').includes('discount.percentage / 100'));
  for(const layout of ['unified','split']) {
    await page.locator(`[data-diff-layout="${layout}"]`).click();
    await card.waitFor(); assert.ok((await card.textContent()).replaceAll('\u00a0',' ').includes(replacement));
  }
  await page.getByRole('button',{name:'Hide comments',exact:true}).click();
  await card.waitFor({state:'detached'});
  await page.getByRole('button',{name:'Show comments',exact:true}).click(); await card.waitFor();
  // Both same-phase and cross-phase travel must restore the persisted card.
  for(const id of ['next-step','next-step','previous-step','previous-step']) {
    const nav=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/tour/navigate'&&r.status()===200);
    await page.locator('#'+id).click(); await nav; await page.waitForTimeout(300);
  }
  await file(); card=frame.locator(`[data-suggestion-id="${result.activityId}"]`); await card.waitFor();
  await page.reload(); await file(); card=frame.locator(`[data-suggestion-id="${result.activityId}"]`); await card.waitFor();
  assert.ok((await card.textContent()).replaceAll('\u00a0',' ').includes(replacement),'Saved suggestions return after reloading');
  // The optional full patch inspection in Activity still has a working tour return.
  await page.locator('#activity-tab').click();
  await page.locator(`[data-activity-id="${result.activityId}"] [data-activity-file="${path}"]`).click();
  await page.locator('[data-preview-activity-action="apply"]').waitFor();
  await page.locator('[data-preview-activity-action="apply"]').click();
  const confirmation = page.getByRole('dialog', {name:'Apply this suggested change?'});
  await confirmation.waitFor();
  assert.equal(await readFile(join(repository,path),'utf8'),original,'Apply waits for explicit confirmation');
  await confirmation.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.locator('#current-step-return').click(); await file();
  card=frame.locator(`[data-suggestion-id="${result.activityId}"]`); await card.waitFor();
  console.log('PASS inline pending card, stable editor/scroll/tour, split/unified, comment visibility, phase travel, reload and Current step return');
  await card.getByRole('button',{name:'Reject',exact:true}).click();
  const rejectDialog=page.getByRole('dialog',{name:'Reject this suggested change?'});
  await rejectDialog.waitFor();
  assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Cancel','Safe action gets initial focus');
  await page.keyboard.press('Tab'); assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Reject change');
  await page.keyboard.press('Tab'); assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Cancel','Focus stays inside the modal');
  await page.screenshot({path:`/tmp/dc-themed-reject-${samplePr?'pr':'local'}.png`});
  await page.keyboard.press('Escape'); await rejectDialog.waitFor({state:'hidden'});
  await frame.waitForFunction(()=>document.activeElement?.textContent==='Reject'&&!document.activeElement.disabled);
  assert.equal(await readFile(join(repository,path),'utf8'),original,'Escape does not reject or modify the source');
  for(const theme of ['dark','light']) {
    await page.evaluate(theme=>reviewTourTheme.set(theme),theme);
    await card.getByRole('button',{name:applyLabel,exact:true}).click();await confirmation.waitFor();
    assert.match(await confirmation.textContent(),samplePr?/disposable test repository/:/Local only/);
    assert.match(await confirmation.textContent(),/src\/cart.ts/);
    await page.screenshot({path:`/tmp/dc-themed-apply-${theme}-${samplePr?'pr':'local'}.png`});
    await confirmation.getByRole('button',{name:'Cancel',exact:true}).click();
    await frame.waitForFunction(label=>document.activeElement?.textContent===label&&!document.activeElement.disabled,applyLabel);
  }
  await page.evaluate(()=>reviewTourTheme.set('dark'));
  {
    const applied=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/activities/${result.activityId}`&&r.status()===200);
    await card.getByRole('button',{name:applyLabel,exact:true}).click();
    await confirmation.getByRole('button',{name:'Apply change',exact:true}).click(); await applied;
    assert.ok((await readFile(join(repository,path),'utf8')).includes(replacement));
    await file(replacement);
    assert.match(await page.locator('#step-count').textContent(),/Step 1\)/,'Apply refreshes the code without leaving the tour');
    await page.locator('#activity-tab').click();
    await page.locator(`[data-activity-id="${result.activityId}"] [data-activity-action="undo"]`).click();
    const undoDialog=page.getByRole('dialog',{name:'Undo this applied change?'});await undoDialog.waitFor();
    await page.keyboard.press('Escape');await undoDialog.waitFor({state:'hidden'});
    assert.ok((await readFile(join(repository,path),'utf8')).includes(replacement),'Escape does not undo the applied edit');
    await page.locator(`[data-activity-id="${result.activityId}"] [data-activity-action="undo"]`).click();
    await undoDialog.getByRole('button',{name:'Undo change',exact:true}).click();
    await page.waitForFunction(id=>document.querySelector(`[data-activity-id="${id}"]`)?.textContent.includes('Applied change undone'),result.activityId);
    assert.equal(await readFile(join(repository,path),'utf8'),original,'Undo restores the original source');
    console.log(`PASS ${samplePr?'sample PR':'normal fixture'}: themed Apply/Reject/Undo, safe cancel/Escape, focus restoration, light/dark themes, real local Apply/Undo`);
  }
  assert.deepEqual(errors,[]);
} catch(error) {
  await page.screenshot({path:'/tmp/dc-edits-failure.png'});
  console.error(error.message, error.stack);console.error('PAGE_ERRORS',errors);process.exitCode=1;
} finally {await browser.close();}
