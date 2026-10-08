// Disposable full-product fixture only. No persisted review mutations.
import { pathToFileURL } from 'node:url';
const [playwrightPath, url] = process.argv.slice(2);
if (!playwrightPath || !url) throw Error('Supply an installed Playwright module and disposable full-fixture URL.');
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1800, height: 1100 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage(), errors = [];
page.setDefaultTimeout(12000);
page.on('pageerror', error => errors.push(error.stack || error.message));
const check = (ok, message) => { if (!ok) throw Error(message); };
try {
  await page.goto(url);
  await page.waitForFunction(() => window.diffCompassIntegration?.child);
  const frame = page.frames().find(f => f.url().includes('embedded=1'));
  await frame.waitForFunction(() => window.diffLab?.views.get('src/cart.ts'));
  const card = frame.locator('[data-prototype-file="src/cart.ts"]');
  const control = name => card.locator(`[data-control="${name}"]`);
  const sourceEditor = () => frame.evaluate(() => {
    const e = monaco.editor.getEditors().find(e => e.getDomNode()?.closest('[data-prototype-file="src/cart.ts"] [data-control="source-editor"]'));
    return e && { value: e.getValue(), selection: e.getSelection(), readOnly: e.getOption(monaco.editor.EditorOption.readOnly), height: e.getLayoutInfo().height };
  });
  check(await frame.evaluate(() => diffLab.views.get('src/cart.ts').anchor === null), 'Test starts without a code selection');
  const expected = await frame.evaluate(() => diffLab.editors.new.getValue());
  await control('source').click();
  await control('source-pane').waitFor({ state: 'visible' });
  const initial = await sourceEditor();
  check(initial.value === expected && initial.readOnly && initial.height > 0, 'View source opens this file’s captured After contents without selecting code');
  check((await control('source-title').innerText()).includes('After'), 'Source revision is explicit');
  await control('return').click();
  check(await frame.evaluate(() => diffLab.anchor === null), 'Returning from whole-file source does not manufacture a line selection');
  check(await control('copy').innerText() === 'Copy contents', 'Whole-file source copy is labelled Copy contents');
  await control('copy').click();
  await control('tool-feedback').getByText('Copied contents', { exact: true }).waitFor();
  check(await frame.evaluate(() => navigator.clipboard.readText()) === expected, 'Real clipboard receives the captured file');
  console.log('PASS no-selection View source, exact full-file Copy and adjacent feedback');

  for (const layout of ['split', 'unified']) {
    await page.locator(`[data-diff-layout="${layout}"]`).click();
    await frame.waitForFunction(layout => document.querySelector('#layout').value === layout, layout);
    await frame.evaluate(() => { const e=diffLab.editors.new; e.setSelection(new monaco.Range(17,3,17,16)); e.focus(); });
    const before = await frame.evaluate(() => ({ selection: diffLab.editors.new.getSelection(), text: diffLab.editors.new.getModel().getValueInRange(diffLab.editors.new.getSelection()), anchor: diffLab.anchor }));
    await frame.evaluate(() => diffLab.editors.new.focus());
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+c' : 'Control+c');
    check(await frame.evaluate(() => navigator.clipboard.readText()) === before.text, 'Native keyboard copy still copies only the selected text');
    check(await control('copy').innerText() === 'Copy contents', 'Button remains file-scoped with a selection');
    await control('copy').click();
    await control('tool-feedback').getByText('Copied contents', { exact: true }).waitFor();
    check(await frame.evaluate(() => navigator.clipboard.readText()) === expected, 'Button copies full contents even with a selection');
    await control('source').click();
    const selected = await sourceEditor();
    check(selected.value === expected && selected.selection.startLineNumber === 17, 'Source opens selected line of the correct captured revision');
    await control('return').click();
    check(await frame.evaluate(before => JSON.stringify(diffLab.editors.new.getSelection()) === JSON.stringify(before.selection) && JSON.stringify(diffLab.anchor) === JSON.stringify(before.anchor), before), 'Source return preserves selection and anchor');
    await frame.evaluate(() => { diffLab.editors.new.setPosition({ lineNumber: 16, column: 5 }); diffLab.editors.new.focus(); });
    check(await control('copy').innerText() === 'Copy contents', 'Caret-only copy is labelled explicitly');
    await control('copy').click();
    await control('tool-feedback').getByText('Copied contents', { exact: true }).waitFor();
    check(await frame.evaluate(async () => await navigator.clipboard.readText() === diffLab.file.new), 'Caret still copies the full file');
    console.log('PASS '+layout+' full-file copy with a selection/caret, captured source and exact selection return');
  }

  // Deterministic denial without changing system/browser permissions or a
  // persistent preference; errors must be visible beside this file’s button.
  await frame.evaluate(() => { Object.defineProperty(navigator.clipboard,'writeText',{ configurable: true, value: async () => { throw new DOMException('Blocked for test', 'NotAllowedError'); } }); });
  await control('copy').click();
  await control('tool-feedback').getByText(/Copy failed/).waitFor();
  check(!await control('copy').isDisabled(), 'Clipboard denial leaves copy retryable');
  await page.screenshot({ path: '/tmp/dc-file-tools-clipboard-error.png' });
  await frame.evaluate(() => { delete navigator.clipboard.writeText; });
  await control('copy').click();
  await control('tool-feedback').getByText('Copied contents', { exact: true }).waitFor();
  console.log('PASS visible clipboard denial and retry');
  check(!errors.length, 'No page errors: '+JSON.stringify(errors));
} catch (error) { console.error(error.stack); console.error(errors); process.exitCode=1; }
finally { await browser.close(); }
