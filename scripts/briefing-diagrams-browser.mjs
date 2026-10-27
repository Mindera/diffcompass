// Exercise every saved diagram family in the production reader and offline export.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadPersistedSession, savePersistedSession } from '../src/store.ts';
import { ReviewSession } from '../src/session.ts';
import { exportReview } from '../src/export.ts';

const [playwrightPath, url, repository] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', headless: true });
const root = await mkdtemp(join(tmpdir(), 'briefing-diagrams-'));
let session;
try {
  let page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const headers = { 'x-diffcompass-token': new URLSearchParams(new URL(url).hash.slice(1)).get('token') };
  const snapshot = await (await page.request.get(new URL('/api/session', url).href, { headers })).json();
  const document = snapshot.outline.briefing;
  document.id = crypto.randomUUID();
  // Two parallel relationships and identically labelled nodes must retain their
  // distinct identities. These are synthetic bindings to the fixture's diffs.
  const parallel = {
    id: 'parallel', title: 'Repeated captions, distinct evidence', family: 'architecture',
    mermaid: 'flowchart LR\n left["Same"]\n right["Same"]\n left -->|same| right\n left -->|same| right',
    ir: { components: [{ id: 'left' }, { id: 'right' }], connections: [
      { id: 'first', from: 'left', to: 'right', label: 'same' },
      { id: 'second', from: 'left', to: 'right', label: 'same' },
    ] },
    elements: ['left', 'right', 'first', 'second'].map((id, i) => ({
      id, label: 'same', kind: i < 2 ? 'components' : 'connections', evidenceIds: [i % 2 ? 'receipt-body' : 'subtotal-body'],
    })),
  };
  document.diagrams.push(parallel);
  document.sections = document.diagrams.map((diagram, index) => ({
    id: `section-${index}`, title: diagram.title,
    blocks: [{ id: `map-${index}`, kind: 'diagram', diagramId: diagram.id }],
  }));
  document.sections.push({ id: 'repeat', title: 'Second embedding', blocks: [{ id: 'second-embedding', kind: 'diagram', diagramId: 'parallel' }] });
  await page.route('**/api/session', route => route.fulfill({ json: snapshot }));
  await page.goto(url);
  await page.locator('#briefing-tab').click();

  async function exercise(reader, inspector, nativeCallFlow) {
    for (const [index, diagram] of document.diagrams.entries()) {
      const map = reader.locator(`[data-briefing-block="map-${index}"] .briefing-canvas`);
      for (const element of diagram.elements) {
        const target = map.locator(`[data-briefing-element="${element.id}"]`).filter({ visible: true }).first();
        await target.waitFor();
        await target.focus();
        await page.keyboard.press('Enter');
        await inspector.locator(`[data-evidence-element="${element.id}"].briefing-selected`).waitFor();
        assert.equal(await target.getAttribute('aria-pressed'), 'true');
        const card = inspector.locator(`[data-evidence-element="${element.id}"]`);
        if (element.evidenceIds.length) {
          for (const id of element.evidenceIds) await card.locator(`[data-evidence-id="${id}"]`).waitFor();
        } else assert.match(await card.textContent(), /No verified source binding/);
        await card.locator('.briefing-card-title').click();
        assert.equal(await target.getAttribute('aria-pressed'), 'true');
      }
      console.log(`PASS ${nativeCallFlow ? 'production' : 'offline'} ${diagram.family}: exact nodes and relationships`);
    }
    const repeated = reader.locator('[data-briefing-block="second-embedding"] .briefing-canvas [data-briefing-element="second"]').filter({ visible: true }).first();
    await repeated.focus(); await page.keyboard.press('Enter');
    const original = reader.locator(`[data-briefing-block="map-${document.diagrams.length - 1}"] [data-briefing-element="second"]`);
    for (const item of await original.all()) assert.equal(await item.getAttribute('aria-pressed'), 'false');
    assert.match(await inspector.locator('[data-evidence-element="second"] code').textContent(), /export function receipt/);
    assert.equal(await reader.locator('.briefing-canvas [data-briefing-element="root_start"]').count(), 0, 'Uncaptured pseudostates do not acquire evidence');
  }
  await exercise(page.locator('#briefing-view'), page.locator('#briefing-inspector'), true);

  // Render the same captured document through the real offline HTML exporter.
  const saved = await loadPersistedSession(join(dirname(repository), 'session.json'));
  saved.outline.briefing = document;
  const stateFile = join(root, 'session.json');
  await savePersistedSession(stateFile, saved);
  session = await ReviewSession.create(repository, undefined, { resume: true, stateFile, agentAdapters: [] });
  const file = join(root, 'review.html');
  await writeFile(file, exportReview(session, 'html').content);
  // A fresh context excludes polling still in flight from the live review.
  await page.close();
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  const requests = [];
  await page.route(/^https?:/, route => { requests.push(route.request().url()); return route.abort(); });
  await page.goto(pathToFileURL(file).href);
  await page.locator('#export-briefing-tab').click();
  await exercise(page.locator('#export-briefing-reader'), page.locator('#export-briefing-pane'), false);
  assert.deepEqual(requests, [], 'The exported reader works without a server or network');
  assert.deepEqual(errors, []);
} finally {
  await session?.dispose();
  await browser.close();
  await rm(root, { recursive: true, force: true });
}
