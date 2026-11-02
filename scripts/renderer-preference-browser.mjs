// Renderer choice must survive a new server/port, where localStorage is empty.
import assert from 'node:assert/strict';
import { copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ReviewSession } from '../src/session.ts';
import { startServer } from '../src/server.ts';

const [playwrightPath, url, repository] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(20000);
const errors = []; page.on('pageerror', error => errors.push(error.message));
let session, server;
const key = 'diffcompass-diff-renderer';
const saved = value => page.waitForResponse(response => response.url().endsWith('/api/preferences')
  && response.request().postDataJSON()?.diffRenderer === value && response.ok());
const monacoReady = () => page.waitForFunction(() => [...document.querySelectorAll('.monaco-review-frame')].some(frame =>
  frame.dataset.monacoPath === 'src/cart.ts' && frame.contentWindow?.diffLab?.views.get('src/cart.ts')?.diff.getLineChanges()));
try {
  // Upgrade an existing browser-only preference without another manual switch.
  await context.addInitScript(({ key, origin }) => {
    if (location.origin === origin) localStorage.setItem(key, 'monaco');
    window.initialRendererPreference = localStorage.getItem(key);
  }, { key, origin: new URL(url).origin });
  const migrated = saved('monaco');
  await page.goto(url);
  await migrated; await monacoReady();

  // Resume a separate review using the shared settings but a different port.
  const directory = dirname(repository);
  const stateFile = join(directory, 'renderer-session.json');
  await copyFile(join(directory, 'session.json'), stateFile);
  session = await ReviewSession.create(repository, undefined, {
    stateFile, resume: true, agentAdapters: [],
    diffPreferenceDirectory: join(dirname(directory), 'preferences'),
  });
  server = startServer(session, 0, directory);
  const nextUrl = `http://127.0.0.1:${server.port}/#token=${session.browserToken}`;
  assert.notEqual(new URL(nextUrl).origin, new URL(url).origin);
  await page.goto(nextUrl); await monacoReady();
  assert.equal(await page.evaluate(() => window.initialRendererPreference), null, 'New port starts without a browser preference');
  assert.equal(await page.locator('#diff-renderer').inputValue(), 'monaco');
  await page.locator('#briefing-tab').click();
  const source = page.locator('#briefing-view [data-evidence-id="subtotal-body"]');
  await source.scrollIntoViewIfNeeded();
  await source.locator('.briefing-code-frame:not([hidden])').waitFor();

  // Server settings win over stale storage, and also work with storage blocked.
  await page.evaluate(key => localStorage.setItem(key, 'current'), key);
  await page.reload(); await monacoReady();
  assert.equal(await page.locator('#diff-renderer').inputValue(), 'monaco');
  await page.close();
  // Use a fresh context so an explicit Shiki selection cannot rely on any cache.
  const clean = await browser.newPage({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
  clean.setDefaultTimeout(20000);
  clean.on('pageerror', error => errors.push(error.message));
  await clean.addInitScript(key => {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    Storage.prototype.getItem = function(name) { if (name === key) throw new Error('Storage unavailable'); return get.call(this, name); };
    Storage.prototype.setItem = function(name, value) { if (name === key) throw new Error('Storage unavailable'); return set.call(this, name, value); };
  }, key);
  await clean.route('**/api/session', route => route.fulfill({ status: 503, json: { error: 'Temporary startup failure' } }), { times: 1 });
  await clean.goto(nextUrl);
  await clean.waitForFunction(() => !document.getElementById('diff-renderer')?.disabled);
  assert.equal(await clean.locator('#diff-renderer').inputValue(), 'monaco');
  const shikiSaved = clean.waitForResponse(response => response.url().endsWith('/api/preferences')
    && response.request().postDataJSON()?.diffRenderer === 'current' && response.ok());
  await clean.locator('#diff-renderer').selectOption('current'); await shikiSaved;
  await clean.reload();
  await clean.waitForFunction(() => !document.getElementById('diff-renderer')?.disabled);
  assert.equal(await clean.locator('#diff-renderer').inputValue(), 'current');
  assert.equal(await clean.locator('.monaco-review-frame').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS renderer migration, new review/port, Briefing inheritance, stale storage precedence, startup retry, and Shiki persistence without browser storage');
} finally {
  await browser.close();
  await server?.stop(true);
  await session?.dispose();
}
