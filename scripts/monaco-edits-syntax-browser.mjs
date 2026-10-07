// Disposable fixture regression: draft/card syntax without applying file edits.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const [playwrightPath, url, repository] = process.argv.slice(2);
assert.match(repository, /diffcompass-monaco-production-[^/]+\/fixture\/repository$/);
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1800, height: 1000 }, colorScheme: 'dark', reducedMotion: 'reduce' });
page.setDefaultTimeout(20000);
const errors = []; page.on('pageerror', error => errors.push(error.message));
page.on('dialog', dialog => { errors.push(`Unexpected native dialog: ${dialog.message()}`); void dialog.dismiss(); });
async function open(path, line, endLine = line) {
  await page.evaluate(path => diffCompassProductionHost.reveal(path, 'new', 1), path);
  await page.waitForFunction(path => [...document.querySelectorAll('.monaco-review-frame')].some(frame => frame.dataset.monacoPath === path && frame.contentWindow?.diffLab?.views.get(path)?.diff.getLineChanges()), path);
  const frame = page.frames().find(frame => new URL(frame.url(), url).searchParams.get('file') === path);
  await frame.evaluate(({path,line,endLine}) => {
    const editor = diffLab.views.get(path).editors.new;
    editor.setSelection(new monaco.Range(line, 1, endLine, editor.getModel().getLineMaxColumn(endLine))); editor.focus();
  }, {path,line,endLine});
  await frame.getByRole('button', {name: 'Suggest edit', exact: true}).click();
  await frame.locator('form.review-suggestion').waitFor();
  return frame;
}
const language = frame => frame.evaluate(() => monaco.editor.getModels().find(model => model.uri.authority === 'review-suggestion').getLanguageId());
async function colours(frame, minimum) {
  await frame.waitForFunction(minimum => new Set([...document.querySelectorAll('.review-suggestion-editor .view-line span')].filter(span => /mtk\d/.test(span.className) && span.textContent.trim()).map(span => getComputedStyle(span).color)).size >= minimum, minimum);
}
const cancel = frame => frame.getByRole('button', {name:'Cancel', exact:true}).click();
try {
  await page.goto(url);
  if (await page.locator('#tour-mode-toggle').textContent() === 'Exit tour') await page.locator('#tour-mode-toggle').click();
  await page.locator('#diff-renderer').selectOption('monaco');
  for (const layout of ['split', 'unified']) {
    await page.locator(`[data-diff-layout="${layout}"]`).click();
    let frame = await open('src/cart.ts', 17);
    assert.equal(await language(frame), 'typescript'); await colours(frame, 2); await cancel(frame);
    frame = await open('docs/preview.md', 20);
    assert.equal(await language(frame), 'kotlin'); await colours(frame, 2);
    await frame.evaluate(() => monaco.editor.getEditors().find(editor => editor.getDomNode()?.closest('.review-suggestion-editor')).focus());
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.insertText('data class Restored(val label: String = "Ready", val count: Int = 2)');
    await colours(frame, 3);
    await page.waitForTimeout(400); // Include the settled outer card in the visual evidence.
    await page.screenshot({path:`/tmp/dc-edit-syntax-${layout}.png`}); await cancel(frame);
    frame = await open('docs/preview.md', 1); assert.equal(await language(frame), 'markdown'); await cancel(frame);
    frame = await open('docs/preview.md', 17, 20); assert.equal(await language(frame), 'markdown'); await cancel(frame);
    console.log(`PASS ${layout}: TypeScript and fenced Kotlin draft colours, live typing, Markdown prose and cross-fence fallback`);
  }
  const frame = await open('docs/preview.md',20);
  await frame.evaluate(()=>{
    const editor=monaco.editor.getEditors().find(editor=>editor.getDomNode()?.closest('.review-suggestion-editor'));
    editor.setValue(editor.getValue()+'\ndata object Restoring : SessionRestoration');
  });
  const submitted=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/edits'&&r.status()===200);
  await frame.getByRole('button',{name:'Propose edit',exact:true}).click();
  const {activityId}=await (await submitted).json();
  const card=frame.locator(`[data-suggestion-id="${activityId}"]`);await card.waitFor();
  assert.match(await card.textContent(),/Insert after L20/);
  assert.match(await card.textContent(),/Restoring/);
  await frame.waitForFunction(id=>new Set([...document.querySelectorAll(`[data-suggestion-id="${id}"] .review-suggestion-code span`)].map(span=>getComputedStyle(span).color)).size>=2,activityId);
  assert.equal(await frame.evaluate(()=>diffLab.views.get('docs/preview.md').editors.new.getValue().includes('data object Restoring')),false,'Inline suggestion does not change the captured source');
  await card.scrollIntoViewIfNeeded(); await page.waitForTimeout(400);
  await page.screenshot({path:'/tmp/dc-inline-suggestion-kotlin.png'});
  await card.getByRole('button',{name:'Reject',exact:true}).click();
  await page.getByRole('dialog',{name:'Reject this suggested change?'}).getByRole('button',{name:'Reject change',exact:true}).click();
  await card.waitFor({state:'detached'});
  console.log('PASS Markdown insertion appears as a syntax-highlighted inline card beside the original Kotlin code');
  assert.deepEqual(errors, []);
} catch (error) {
  await page.screenshot({path:'/tmp/dc-edit-syntax-failure.png'}); console.error(error.stack); console.error('PAGE_ERRORS',errors); process.exitCode=1;
} finally { await browser.close(); }
