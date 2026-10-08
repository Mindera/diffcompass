// Disposable PR fixture: captured-context discussions and real-shaped PR threads.
// Thread responses are intercepted locally; this test never writes to GitHub.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const [playwrightPath, url, repository] = process.argv.slice(2);
assert.match(repository, /diffcompass-monaco-production-[^/]+\/fixture\/repository$/);
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', headless: true });
let page;
const errors = [], token = new URL(url).hash.slice(7), contextPath = 'src/context-example.ts', runId = Date.now();
async function newPage() {
  page = await browser.newPage({ viewport: { width:1800,height:1000 }, colorScheme:'dark', reducedMotion:'reduce' });
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
}
async function start() {
  await page.goto(url);
  await page.locator('#step-count').filter({hasText:'Step '}).waitFor({state:'attached'});
  if (await page.locator('#tour-mode-toggle').textContent() === 'Exit tour') await page.locator('#tour-mode-toggle').click();
  await page.locator('#diff-renderer').selectOption('monaco');
}
async function file(path, side = 'new', line = 1) {
  await page.waitForFunction(() => window.diffCompassProductionHost && document.querySelector('.monaco-file-slot'));
  await page.evaluate(({path,side,line}) => diffCompassProductionHost.reveal(path,side,line), {path,side,line});
  await page.waitForFunction(path => [...document.querySelectorAll('.monaco-review-frame')].some(frame => frame.dataset.monacoPath === path && frame.contentWindow?.diffLab?.views.get(path)?.diff.getLineChanges()?.length), path);
  return page.frames().find(frame => new URL(frame.url(),url).searchParams.get('file') === path);
}
async function select(frame, path, side, line, endLine = line, column = 1) {
  return frame.evaluate(({path,side,line,endLine,column}) => {
    const editor = diffLab.views.get(path).editors[side], model = editor.getModel();
    if (line === endLine) editor.setPosition({lineNumber:line,column});
    else editor.setSelection(new monaco.Range(line,column,endLine,model.getLineMaxColumn(endLine)));
    editor.focus();
    return {content:model.getLineContent(line),selectedText:model.getValueInRange(editor.getSelection())};
  }, {path,side,line,endLine,column});
}
const action = (frame,path,side,kind) => frame.evaluate(({path,side,kind}) => diffLab.views.get(path).editors[side].getAction(`diff-lab.${side}.${kind}`).run(), {path,side,kind});
const snapshot = () => page.evaluate(async token => (await fetch('/api/session',{headers:{'x-diffcompass-token':token}})).json(),token);
try {
  await newPage(); await start();
  await page.locator('[data-diff-layout="split"]').click();
  let frame = await file(contextPath,'new',43);
  await frame.getByRole('button',{name:'Show all context',exact:true}).click();
  const ids = [];
  for (const [side,line,endLine] of [['new',50,52],['old',50,50],['new',50,50],['new',46,46],['new',47,47],['new',174,174],['new',175,175]]) {
    const selected = await select(frame,contextPath,side,line,endLine);
    await action(frame,contextPath,side,'comment');
    const body = `Expanded ${side} ${line}-${endLine} context regression ${runId}`;
    await frame.getByRole('textbox',{name:'Comment text'}).fill(body);
    const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/comments' && response.request().method() === 'POST' && response.status() === 200);
    await frame.getByRole('button',{name:'Add comment',exact:true}).click(); await saved;
    const entry = (await snapshot()).comments.find(comment => comment.body === body);
    assert.ok(entry); ids.push(entry.id);
    assert.equal(entry.lineContent,selected.content);
    if ([50,47,174].includes(line)) {
      assert.equal(entry.publishToGitHub,false);
      assert.match(entry.githubUnavailableReason,/Local only/);
    }
    if (endLine > line) { assert.equal(entry.endLine,endLine); assert.equal(entry.context,selected.selectedText); }
    await frame.locator(`[data-comment-id="${entry.id}"]`).waitFor({state:'attached'});
    if (line === 50) assert.match(await frame.locator(`[data-comment-id="${entry.id}"]`).textContent(),/Local only/);
  }
  await frame.locator(`[data-comment-id="${ids[0]}"]`).getByRole('button',{name:'Edit',exact:true}).click();
  await frame.getByRole('textbox',{name:'Comment text'}).fill('Expanded After context edited');
  await frame.getByRole('button',{name:'Save changes',exact:true}).click();
  await frame.locator(`[data-comment-id="${ids[0]}"] .review-comment-body`).getByText('Expanded After context edited',{exact:true}).waitFor();
  console.log('PASS expanded Before/After comments, multiline quote, editing and local-only publication');
  for (const layout of ['split','unified']) {
    await page.locator(`[data-diff-layout="${layout}"]`).click();
    await frame.getByRole('button',{name:'▴ Collapse unchanged lines 47–174',exact:true}).click();
    await frame.waitForFunction(ids => ids.every((id,index) => {
      const card=document.querySelector(`[data-comment-id="${id}"]`);
      return card && card.hidden === ![3,6].includes(index);
    }),ids);
    await page.waitForTimeout(250); // Outer auto-height follows native folding on the next layout.
    // Hidden cards must reserve zero space, and visible boundary cards must
    // remain attached to their own line rather than follow the next region.
    const collapsedHeight=await frame.locator('#editor').evaluate(node=>node.getBoundingClientRect().height);
    const hiddenComments=frame.locator('.editor.modified [data-review-gap="47:175"] [data-gap-action="comments"]');
    const expected=layout==='split'?'4 comments':'5 comments';
    await hiddenComments.getByText(expected,{exact:true}).waitFor();
    assert.equal(await hiddenComments.getAttribute('aria-label'),`Show ${expected} in hidden lines 47–174`);
    if(layout==='split') assert.equal(await frame.locator('.editor.original [data-review-gap="47:175"] [data-gap-action="comments"]').textContent(),'1 comment');
    assert.equal(await frame.locator('.editor.modified [data-review-gap="1:40"] [data-gap-action="comments"]').count(),0,'No comment badge for empty gaps');
    await page.screenshot({path:`/tmp/dc-comments-collapsed-${layout}.png`});
    await page.getByRole('button',{name:'Hide comments',exact:true}).click();
    assert.equal(await hiddenComments.textContent(),expected,'Hidden comments remain discoverable when comments are globally hidden');
    if(layout==='split') await hiddenComments.click();
    else { await hiddenComments.focus(); await page.keyboard.press('Enter'); }
    await page.getByRole('button',{name:'Hide comments',exact:true}).waitFor();
    await frame.waitForFunction(ids => ids.every(id => !document.querySelector(`[data-comment-id="${id}"]`)?.hidden),ids);
    await frame.waitForFunction(height=>document.querySelector('#editor').getBoundingClientRect().height>height+128*20,collapsedHeight);
    const expandedHeight=await frame.locator('#editor').evaluate(node=>node.getBoundingClientRect().height);
    assert.ok(expandedHeight-collapsedHeight>128*20,'Collapsed comments remove their reserved space with the hidden source');
    assert.deepEqual((await snapshot()).comments.filter(comment=>ids.includes(comment.id)).map(comment=>comment.id),ids,'Folding never deletes a comment');
    console.log(`PASS ${layout}: quote/line Before/After comments fold with their source; counted gap badges reveal them with mouse/keyboard`);
  }
  await frame.getByRole('button',{name:'▴ Collapse unchanged lines 47–174',exact:true}).click();
  const deleted=ids.splice(2,1)[0];
  await page.evaluate(async ({token,id})=>{
    const response=await fetch(`/api/comments/${id}`,{method:'DELETE',headers:{'x-diffcompass-token':token}});
    if(!response.ok) throw Error(await response.text());
    await diffCompassProductionHost.refresh();
  },{token,id:deleted});
  const updatedBadge=frame.locator('.editor.modified [data-review-gap="47:175"] [data-gap-action="comments"]');
  await updatedBadge.getByText('4 comments',{exact:true}).waitFor();
  await updatedBadge.click();
  console.log('PASS hidden comment counts refresh after deletion without unfolding the gap');
  // Partial first line plus multiple rows must preserve the full first-line anchor.
  const selected = await select(frame,contextPath,'new',50,52,3);
  await action(frame,contextPath,'new','ask');
  await page.locator('#chat-input').fill('Explain these expanded context lines.');
  const asked = page.waitForRequest(request => new URL(request.url()).pathname === '/api/agent/message' && request.method() === 'POST');
  await page.locator('#chat-form button[type="submit"]').click();
  const request = await asked;
  assert.equal(request.postDataJSON().anchor.content,selected.content);
  assert.equal(request.postDataJSON().anchor.selectedText,selected.selectedText);
  const answered = await request.response(); assert.equal(answered.status(),200,await answered.text());
  console.log('PASS question on expanded partial/multiline selection retains its captured source anchor');
  const questionIds={after:(await snapshot()).messages.find(message=>message.role==='user'&&message.body==='Explain these expanded context lines.').id};
  async function askAt(path,side,line,endLine,body) {
    frame=await file(path,side,line);
    await select(frame,path,side,line,endLine);
    await action(frame,path,side,'ask');
    await page.locator('#chat-input').fill(body);
    const saved=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/agent/message'&&response.request().method()==='POST'&&response.status()===200);
    await page.locator('#chat-form button[type="submit"]').click(); await saved;
    return (await snapshot()).messages.find(message=>message.role==='user'&&message.body===body).id;
  }
  questionIds.before=await askAt(contextPath,'old',65,67,`Before context question ${runId}`);
  // A follow-up is still one anchored conversation, not another gap question.
  await page.locator('#chat-input').fill('A follow-up on the same Before code.');
  const followup=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/agent/message'&&response.request().method()==='POST'&&response.status()===200);
  await page.locator('#chat-form button[type="submit"]').click(); await followup;
  questionIds.receipt=await askAt('src/receipt.ts','new',3,3,`Receipt question ${runId}`);
  for(const layout of ['split','unified']) {
    await page.locator(`[data-diff-layout="${layout}"]`).click();
    frame=await file(contextPath,'new',43);
    const collapse=frame.getByRole('button',{name:'Collapse unchanged',exact:true});
    if(await collapse.isVisible()) await collapse.click();
    const questions=frame.locator('.editor.modified [data-review-gap="47:175"] [data-gap-action="questions"]');
    await questions.getByText(layout==='split'?'1 question':'2 questions',{exact:true}).waitFor();
    if(layout==='split') assert.equal(await frame.locator('.editor.original [data-review-gap="47:175"] [data-gap-action="questions"]').textContent(),'1 question');
    await questions.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await page.screenshot({path:`/tmp/dc-hidden-questions-${layout}.png`});
    if(layout==='split') await questions.click();
    else {await questions.focus();await page.keyboard.press('Enter');}
    await page.waitForFunction(id=>document.getElementById('conversation-select').value===id,questionIds.after);
    for(const [key,path,side,line] of [['before',contextPath,'old',65],['after',contextPath,'new',50],['receipt','src/receipt.ts','new',3]]) {
      await page.locator('#conversation-select').selectOption(questionIds[key]);
      // Move away so the link must restore the selected question, not the
      // most recent editor selection or a different conversation's anchor.
      await file(path===contextPath?'src/receipt.ts':contextPath,'new',path===contextPath?3:43);
      const link=page.locator('#question-scope [data-question-code]');
      assert.equal(await link.textContent(),path,'Only the filename is clickable');
      assert.match(await page.locator('#question-scope').textContent(),new RegExp(`\\(${side}\\)`));
      if(layout==='split') await link.click();
      else {await link.focus();await page.keyboard.press('Enter');}
      await page.waitForFunction(({path,side,line})=>{
        const frame=[...document.querySelectorAll('.monaco-review-frame')].find(frame=>frame.dataset.monacoPath===path);
        const view=frame?.contentWindow?.diffLab?.views.get(path), geometry=frame?.contentWindow?.diffCompassMonaco?.geometry(path,side,line);
        if(!view||!geometry||view.editors[side].getSelection().startLineNumber!==line)return false;
        const top=frame.getBoundingClientRect().top+geometry.top;
        const header=frame.closest('.monaco-file-slot').querySelector('header').getBoundingClientRect();
        const panel=document.getElementById('diff-panel').getBoundingClientRect();
        return top>=header.bottom&&top<Math.min(innerHeight,panel.bottom)-20;
      },{path,side,line});
      assert.equal(await page.locator('#conversation-select').inputValue(),questionIds[key]);
    }
    console.log(`PASS ${layout}: hidden questions count roots, badge opens the conversation, filename links reveal the saved Before/After source after switching questions`);
  }
  await page.reload();
  frame = await file(contextPath,'new',50);
  for (const id of ids) await frame.locator(`[data-comment-id="${id}"]`).waitFor({state:'attached'});
  for (const layout of ['unified','split']) {
    await page.locator(`[data-diff-layout="${layout}"]`).click();
    await page.getByRole('button',{name:'Hide comments',exact:true}).click();
    assert.equal(await frame.locator('[data-comment-id]').count(),0);
    await page.getByRole('button',{name:'Show comments',exact:true}).click();
    for (const id of ids) await frame.locator(`[data-comment-id="${id}"]`).waitFor({state:'attached'});
  }
  console.log('PASS expanded discussions survive reload, layout changes and hide/show');
  await page.close(); await newPage();
  let version = 0;
  const message = (id, body, link = `https://github.com/example/checkout/pull/42#discussion_r${id}`) => ({id,author:'Reviewer',body,url:link});
  const threads = () => [
    {id:'live-after',path:'src/cart.ts',side:'new',line:17,resolved:version > 0,comments:[message('1','Please explain **fractional percentages** and `total`.'),...(version ? [message('2',`Reply received after refresh ${version}.`)] : [])]},
    {id:'live-before',path:'src/cart.ts',side:'old',line:7,resolved:true,comments:[message('3','Before-side thread')]},
    {id:'live-outdated',path:'src/cart.ts',side:'new',line:17,outdated:true,resolved:false,comments:[message('4','Historical line only')]},
    {id:'live-file',path:'src/cart.ts',side:'new',resolved:false,comments:[message('5','File-level discussion')]},
    {id:'live-invalid',path:'src/cart.ts',side:'new',line:999,resolved:false,comments:[message('6','[unsafe](javascript:alert(1)) <img src=x onerror=alert(1)>','javascript:alert(1)')]},
  ];
  await page.route('**/api/session',async route => {
    const response = await route.fetch(), data = await response.json();
    data.pullRequest.threads = threads(); data.revision += version;
    delete data.pullRequestFixture;
    await route.fulfill({response,json:data});
  });
  await page.route('**/api/diff/sources',async route => {
    const response = await route.fetch(), data = await response.json(); delete data.pullRequestFixture;
    await route.fulfill({response,json:data});
  });
  await start();
  frame = await file('src/cart.ts','new',17);
  const thread = id => frame.locator(`[data-pr-thread-id="${id}"]`);
  for (const layout of ['split','unified']) {
    await page.locator(`[data-diff-layout="${layout}"]`).click();
    // A virtualized file may remount when its layout/viewport changes. Resolve
    // the captured source target again instead of using a detached Frame handle.
    frame = await file('src/cart.ts','new',17);
    await thread('live-after').waitFor({state:'attached'});
    assert.equal(await thread('live-after').getAttribute('data-anchor-state'),'current');
    assert.equal(await thread('live-after').getAttribute('data-line'),'17');
    assert.equal(await thread('live-before').getAttribute('data-side'),'old');
    assert.equal(await thread('live-before').getAttribute('data-anchor-state'),'current');
    assert.equal(await thread('live-after').locator('.review-pr-message strong').last().textContent(),'fractional percentages');
    const reply = thread('live-after').getByRole('link',{name:'Reply in GitHub'});
    assert.equal(await reply.getAttribute('href'),'https://github.com/example/checkout/pull/42/changes#r1');
    assert.equal(await reply.getAttribute('rel'),'noopener noreferrer');
    for (const id of ['live-outdated','live-file','live-invalid']) {
      assert.equal(await thread(id).getAttribute('data-anchor-state'),'file');
      assert.equal(await thread(id).getAttribute('data-line'),null);
    }
    assert.equal(await thread('live-invalid').getByRole('link',{name:'Reply in GitHub'}).count(),0);
    assert.equal(await thread('live-invalid').locator('[onerror], a[href^="javascript:"]').count(),0);
    await page.getByRole('button',{name:'Hide comments',exact:true}).click();
    assert.equal(await frame.locator('.review-pr-thread').count(),0);
    await page.getByRole('button',{name:'Show comments',exact:true}).click();
    await thread('live-after').waitFor({state:'attached'});
    console.log(`PASS ${layout}: current, Before, resolved, historical and file-level PR threads; safe Markdown and links`);
  }
  await select(frame,'src/cart.ts','new',17);
  await action(frame,'src/cart.ts','new','comment');
  const draft = frame.getByRole('textbox',{name:'Comment text'}); await draft.fill('Keep this draft during PR updates');
  await frame.evaluate(() => { window.retainedEditor = diffLab.views.get('src/cart.ts').diff; });
  const scroll = await page.locator('#diff-panel').evaluate(node => node.scrollTop);
  version++;
  await page.evaluate(() => diffCompassProductionHost.refresh());
  assert.equal(await draft.inputValue(),'Keep this draft during PR updates');
  assert.equal(await frame.evaluate(() => window.retainedEditor === diffLab.views.get('src/cart.ts').diff),true);
  assert.ok(Math.abs(await page.locator('#diff-panel').evaluate(node=>node.scrollTop)-scroll)<3,'Metadata refresh keeps scroll and the live editor');
  await frame.getByRole('button',{name:'Cancel',exact:true}).click();
  await thread('live-after').getByText('Reply received after refresh 1.',{exact:true}).waitFor();
  assert.equal(await thread('live-after').getByRole('link',{name:'Reply in GitHub'}).getAttribute('href'),'https://github.com/example/checkout/pull/42/changes#r1');
  assert.match(await thread('live-after').textContent(),/Resolved/);
  assert.equal(await frame.evaluate(() => window.retainedEditor === diffLab.views.get('src/cart.ts').diff),true);
  await thread('live-after').scrollIntoViewIfNeeded();
  await page.screenshot({path:'/tmp/dc-live-pr-threads.png'});
  console.log('PASS incoming reply/resolution preserves draft, editor identity and scroll');
  // Exercise the actual Refresh button as well as metadata polling. Intercept
  // the provider operation, not the UI refresh flow, so no GitHub writes occur.
  await page.route('**/api/github/refresh',async route => {
    const response = await page.request.get(new URL('/api/session',url).href,{headers:{'x-diffcompass-token':token}});
    const data = await response.json(); data.pullRequest.threads = threads(); data.revision += version;
    delete data.pullRequestFixture; await route.fulfill({json:data});
  });
  const refreshScroll = await page.locator('#diff-panel').evaluate(node=>node.scrollTop);
  version++;
  await page.locator('#refresh-button').click();
  await thread('live-after').getByText('Reply received after refresh 2.',{exact:true}).waitFor();
  await page.waitForFunction(() => !document.getElementById('refresh-button').disabled);
  assert.equal(await frame.evaluate(() => window.retainedEditor === diffLab.views.get('src/cart.ts').diff),true);
  assert.ok(Math.abs(await page.locator('#diff-panel').evaluate(node=>node.scrollTop)-refreshScroll)<3,'Explicit PR refresh keeps the reading position when source is unchanged');
  console.log('PASS explicit PR refresh retains the existing editor and reading position');
  assert.deepEqual(errors,[]);
} catch(error) {
  await page?.screenshot({path:'/tmp/dc-discussions-failure.png'});
  console.error(error.stack); console.error('PAGE_ERRORS',errors); process.exitCode=1;
} finally { await browser.close(); }
