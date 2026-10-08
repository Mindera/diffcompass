// Disposable fixture: all palettes, live Unified deletion recoloring, editor
// identity, source/draft inheritance and persisted renderer/theme preferences.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const [playwrightPath, url] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 }, colorScheme: 'dark', reducedMotion: 'reduce' });
page.setDefaultTimeout(20000);
const errors = []; page.on('pageerror', error => errors.push(error.message));
const palettes = {
  github: ['rgb(36, 41, 46)', 'rgb(249, 117, 131)'],
  vitesse: ['rgb(18, 18, 18)', 'rgb(77, 147, 117)'],
  diffcompass: ['rgb(9, 17, 27)', 'rgb(255, 122, 178)'],
  'catppuccin-frappe': ['rgb(48, 52, 70)', 'rgb(202, 158, 230)'],
  'catppuccin-macchiato': ['rgb(36, 39, 58)', 'rgb(198, 160, 246)'],
  'catppuccin-mocha': ['rgb(30, 30, 46)', 'rgb(203, 166, 247)'],
};
let frame;
async function ready() {
  await page.waitForFunction(() => [...document.querySelectorAll('.monaco-review-frame')].some(frame => frame.dataset.monacoPath === 'src/cart.ts' && frame.contentWindow?.diffLab?.diff.getLineChanges()));
  frame = page.frames().find(frame => new URL(frame.url()).searchParams.get('file') === 'src/cart.ts');
}
async function settings() { if (await page.locator('#settings-menu').getAttribute('open') === null) await page.locator('#settings-menu summary').click(); }
async function palette(name, expected = palettes[name]) {
  await settings(); await page.locator('#syntax-theme-select').selectOption(name);
  await frame.waitForFunction(({name, expected}) => {
    const root = document.documentElement;
    const token = selector => [...document.querySelectorAll(selector)].find(node => node.textContent === 'export');
    const before = token('[data-review-old-line="6"] span span'), after = token('.editor.modified .view-line span span');
    return root.dataset.syntaxTheme === name && before && after
      && getComputedStyle(before).color === expected[1] && getComputedStyle(after).color === expected[1]
      && getComputedStyle(document.querySelector('.monaco-editor-background')).backgroundColor === expected[0];
  }, {name, expected});
}
try {
  await page.goto(url); await page.locator('#step-count').filter({hasText:'Step '}).waitFor({state:'attached'});
  await page.locator('#diff-renderer').selectOption('monaco');
  await page.locator('[data-diff-layout="unified"]').click(); await ready();
  await frame.evaluate(() => { window.themeTestDiff = diffLab.diff; window.themeTestModel = diffLab.editors.new.getModel(); });
  for (const name of Object.keys(palettes)) await palette(name);
  await page.locator('#theme-select').selectOption('light');
  await palette('catppuccin-mocha'); // Dark code surface in light application chrome.
  for (const [name, keyword] of [['github','rgb(215, 58, 73)'], ['vitesse','rgb(30, 117, 79)'], ['diffcompass','rgb(207, 34, 46)']]) await palette(name, ['rgb(255, 255, 255)', keyword]);
  await page.locator('#theme-select').selectOption('dark'); await palette('catppuccin-mocha');
  assert.equal(await frame.evaluate(() => diffLab.diff === themeTestDiff && diffLab.editors.new.getModel() === themeTestModel), true, 'Theme changes preserve editors/models');
  await page.locator('#settings-menu summary').click();
  await frame.getByRole('button',{name:'View source',exact:true}).click();
  await frame.locator('[data-control="source-pane"]:not([hidden])').waitFor();
  await frame.waitForFunction(() => getComputedStyle(document.querySelector('[data-control="source-editor"] .monaco-editor-background')).backgroundColor === 'rgb(30, 30, 46)');
  await palette('github');
  await frame.waitForFunction(() => getComputedStyle(document.querySelector('[data-control="source-editor"] .monaco-editor-background')).backgroundColor === 'rgb(36, 41, 46)');
  await page.locator('#settings-menu summary').click(); await frame.getByRole('button',{name:'← Back to diff',exact:true}).click();
  await frame.evaluate(() => { diffLab.editors.new.setPosition({lineNumber:7,column:3}); diffLab.editors.new.focus(); });
  await page.keyboard.press('Shift+F10');
  await frame.getByRole('menuitem',{name:'Suggest edit',exact:true}).click();
  await frame.getByRole('textbox',{name:'Replacement code',exact:true}).press('ControlOrMeta+A');
  await page.keyboard.insertText('  percentage: number; // retained theme draft');
  const before = await frame.evaluate(() => {
    const model = monaco.editor.getModels().find(model => model.uri.authority === 'review-suggestion');
    return {id:model.id,value:model.getValue(),version:model.getAlternativeVersionId()};
  });
  await palette('vitesse'); await palette('catppuccin-mocha');
  const after = await frame.evaluate(() => {
    const model = monaco.editor.getModels().find(model => model.uri.authority === 'review-suggestion');
    return {id:model.id,value:model.getValue(),version:model.getAlternativeVersionId()};
  });
  assert.deepEqual(after, before, 'Draft text and undo history survive theme changes');
  await frame.waitForFunction(() => getComputedStyle(document.querySelector('.review-suggestion-editor .monaco-editor-background')).backgroundColor === 'rgb(30, 30, 46)');
  await page.locator('#settings-menu summary').click(); await frame.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.locator('#diff-renderer').selectOption('current'); await page.locator('#diff-renderer').selectOption('monaco'); await ready();
  await page.reload(); await ready();
  assert.equal(await page.locator('#syntax-theme-select').inputValue(), 'catppuccin-mocha', 'Syntax preference survives reload');
  assert.equal(await frame.locator('html').getAttribute('data-syntax-theme'), 'catppuccin-mocha', 'Remounted Monaco inherits the persisted palette');
  await palette('catppuccin-mocha');
  assert.deepEqual(errors, []);
  console.log('PASS six syntax palettes, light/dark variants, live removed-line colors, source/draft inheritance, model preservation and reload');
} finally { await browser.close(); }
