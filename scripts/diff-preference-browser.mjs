// Reviewer view preferences survive different repositories, ports and stale sessions.
import assert from 'node:assert/strict';
import { cp } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ReviewSession } from '../src/session.ts';
import { startServer } from '../src/server.ts';
import { loadPersistedSession, savePersistedSession } from '../src/store.ts';

const [playwrightPath, url, repository] = process.argv.slice(2);
assert.match(repository, /diffcompass-monaco-production-[^/]+\/fixture\/repository$/);
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(20000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let session, server;
const ready = () => page.locator('#diff-renderer:enabled').waitFor({ state: 'attached' });
const selected = async (layout, wrap) => {
  await page.locator(`[data-diff-layout="${layout}"][aria-pressed="true"]`).waitFor({ state: 'attached' });
  await page.locator(`[data-diff-wrap="${wrap}"][aria-pressed="true"]`).waitFor({ state: 'attached' });
};
async function choose(kind, value, mobile = false) {
  const field = kind === 'layout' ? 'diffLayout' : 'diffWrap';
  const [response] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/api/preferences')
      && response.request().postDataJSON()?.[field] === value
      && response.request().postDataJSON()?.mobile === mobile),
    page.locator(`[data-diff-${kind}="${value}"]`).click(),
  ]);
  assert.equal(response.status(), 200);
}
try {
  await page.goto(url); await ready();
  await choose('layout', 'unified');
  await choose('wrap', 'wrap');
  await selected('unified', 'wrap');

  await page.setViewportSize({ width: 390, height: 1000 });
  await choose('layout', 'split', true);
  await choose('wrap', 'wrap', true);
  await selected('split', 'wrap');

  const directory = dirname(repository);
  const otherRepository = join(directory, 'other-repository');
  await cp(repository, otherRepository, { recursive: true });
  const stateFile = join(directory, 'diff-preference-session.json');
  const saved = await loadPersistedSession(join(directory, 'session.json'));
  saved.repositoryRoot = otherRepository;
  saved.diffPreferences = {
    desktop: { layout: 'split', wrap: 'scroll' },
    mobile: { layout: 'unified', wrap: 'scroll' },
  };
  await savePersistedSession(stateFile, saved);
  session = await ReviewSession.create(otherRepository, undefined, {
    stateFile, resume: true, agentAdapters: [],
    diffPreferenceDirectory: join(dirname(directory), 'preferences'),
  });
  server = startServer(session, 0, directory);
  const nextUrl = `http://127.0.0.1:${server.port}/#token=${session.browserToken}`;
  assert.notEqual(new URL(nextUrl).origin, new URL(url).origin);
  await page.addInitScript(() => { window.initialStorageCount = localStorage.length; });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(nextUrl); await ready();
  assert.equal(await page.evaluate(() => window.initialStorageCount), 0, 'New port has no browser settings');
  await selected('unified', 'wrap');
  await page.setViewportSize({ width: 390, height: 1000 });
  await selected('split', 'wrap');
  console.log('PASS global layout/wrap across repositories and ports; stale sessions cannot override desktop/mobile choices');

  // Saving must still reach the server if the optional browser cache rejects it.
  await page.addInitScript(() => {
    for (const method of ['getItem', 'setItem']) {
      const original = Storage.prototype[method];
      Storage.prototype[method] = function(key, ...args) {
        if (/:(mobile-)?diff-(layout|wrap)$/.test(key)) throw Error('View preference storage unavailable');
        return original.call(this, key, ...args);
      };
    }
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.reload(); await ready();
  await choose('layout', 'split');
  await choose('wrap', 'scroll');
  await page.reload(); await ready();
  await selected('split', 'scroll');
  await page.setViewportSize({ width: 390, height: 1000 });
  await selected('split', 'wrap');
  assert.deepEqual(errors, []);
  console.log('PASS layout/wrap saves and reloads with browser preference storage unavailable');
} catch (error) {
  await page.screenshot({ path: '/tmp/dc-diff-preferences-failure.png', timeout: 5000 }).catch(() => {});
  throw error;
} finally {
  await browser.close();
  await server?.stop(true);
  await session?.dispose();
}
