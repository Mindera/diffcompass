// Run with the isolated production fixture from check-monaco.ts.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const [playwrightPath, url] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(20000);
const errors = []; page.on('pageerror', error => errors.push(error.message));
const currentSection = id => page.waitForFunction(id => document.querySelector('#briefing-outline [aria-current="location"]')?.dataset.briefingSection === id, id);
const readerScroll = () => page.locator('#diff-panel').evaluate(el => el.scrollTop);
async function wheelToSection(id) {
  const delta = await page.locator(`#briefing-section-${id}`).evaluate(el => el.getBoundingClientRect().top - document.getElementById('diff-panel').getBoundingClientRect().top - 24);
  const bounds = await page.locator('#diff-panel').boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 100);
  await page.mouse.wheel(0, delta);
  await currentSection(id);
}
try {
  console.log('CHECK Briefing opening code and scrolling');
  await page.goto(url);
  await page.locator('#briefing-tab').click();
  await page.locator('#briefing-view .briefing-canvas svg').waitFor();
  await page.locator('#briefing-view [data-evidence-id="subtotal-body"] code span[style]').first().waitFor();
  await currentSection('intent');
  assert.equal(await page.locator('#briefing-outline [aria-current]').count(), 1);
  assert.equal(await page.locator('#briefing-view .briefing-excerpt').count(), 3);
  const source = page.locator('#briefing-view [data-evidence-id="subtotal-body"]');
  assert.match(await source.textContent(), /export function subtotal/);
  assert.ok(await source.locator('[data-diff-kind="addition"]').count() > 0);
  assert.ok(await source.locator('[data-diff-kind="deletion"]').count() > 0);
  assert.equal(await page.locator('#briefing-view .briefing-excerpt pre:not(.briefing-diff)').count(), 0);
  const box = await source.boundingBox();
  assert.ok(box.y + box.height < 1000, 'Implementation code appears in the opening viewport');

  // Real wheel input, in both directions, must update the outline independently
  // of clicks. The last short section is selected at the end of the document.
  await wheelToSection('calculation');
  await wheelToSection('boundaries');
  await page.mouse.wheel(0, 10000);
  await currentSection('limits');
  await wheelToSection('calculation');
  await page.locator('[data-briefing-section="intent"]').click();
  await currentSection('intent');

  // Quiet passage controls remain keyboard accessible, without changing layout.
  const askPassage = page.locator('[data-briefing-ask="intent-text"]');
  const beforeFocus = await page.locator('[data-briefing-block="intent-text"]').boundingBox();
  await askPassage.focus();
  assert.equal(await askPassage.evaluate(el => getComputedStyle(el.parentElement).opacity), '1');
  assert.equal((await page.locator('[data-briefing-block="intent-text"]').boundingBox()).height, beforeFocus.height);

  // Inline code uses the same verified evidence and question attachment as the
  // inspector; source inspection and tab round trips retain the reading point.
  console.log('CHECK Briefing source inspection and tab restoration');
  const beforeInspect = await readerScroll();
  await source.locator('[data-briefing-inspect]').click();
  assert.match(await page.locator('#briefing-inspector code').textContent(), /export function subtotal/);
  assert.equal(await page.locator('#briefing-inspector pre:not(.briefing-diff)').count(), 0);
  assert.ok(Math.abs(await readerScroll() - beforeInspect) < 2);
  await source.locator('[data-briefing-ask]').click();
  assert.equal(await page.locator('#briefing-context .briefing-chip').count(), 1);
  await page.locator('#chat-input').fill('Explain this calculation boundary');
  const beforeTab = await readerScroll();
  await page.locator('#diff-tab').click();
  await page.locator('#briefing-tab').click();
  await currentSection('intent');
  try { await page.waitForFunction(top => Math.abs(document.getElementById('diff-panel').scrollTop - top) < 2, beforeTab); }
  catch (error) { console.error('Reading position', { beforeTab, afterTab: await readerScroll() }); throw error; }
  assert.equal(await page.locator('#chat-input').inputValue(), 'Explain this calculation boundary');

  console.log('CHECK Briefing diagram source selection');
  await page.locator('[data-briefing-section="boundaries"]').click();
  await currentSection('boundaries');
  await page.locator('#briefing-view .briefing-canvas [data-briefing-element="receipt"]').click();
  assert.match(await page.locator('#briefing-inspector [data-evidence-element="receipt"] code').textContent(), /export function receipt/);

  console.log('CHECK Briefing mobile evidence sheet');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#diff-panel').evaluate(el => { el.scrollTop = 0; });
  assert.ok(await page.locator('#briefing-view').evaluate(el => el.getBoundingClientRect().right <= innerWidth && el.scrollWidth <= el.clientWidth), 'Wide code scrolls inside its excerpt without widening the mobile reader');
  assert.equal(await askPassage.evaluate(el => getComputedStyle(el.parentElement).opacity), '1');
  await source.locator('[data-briefing-inspect]').click();
  await page.locator('#briefing-sheet[open]').waitFor();
  assert.match(await page.locator('#briefing-inspector code').textContent(), /export function subtotal/);
  await page.keyboard.press('Escape');
  await page.locator('#briefing-sheet[open]').waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
  console.log('PASS Briefing: inline code, scroll tracking, evidence, question draft, mobile');
} catch (error) {
  console.error(await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth, overflow: [...document.querySelectorAll('body *')].filter(el => { const r = el.getBoundingClientRect(); return r.width && r.right > innerWidth + 1 && getComputedStyle(el).position !== 'absolute'; }).slice(0, 15).map(el => ({ tag: el.tagName, id: el.id, class: el.className, width: el.getBoundingClientRect().width })) })));
  throw error;
} finally { await browser.close(); }
