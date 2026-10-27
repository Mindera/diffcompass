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
  const sequence = document.diagrams.find(diagram => diagram.family === 'sequence');
  document.sections.push({ id: 'repeat-sequence', title: 'Sequence revisited', blocks: [{ id: 'sequence-revisited', kind: 'diagram', diagramId: sequence.id }] });
  await page.route('**/api/session', route => route.fulfill({ json: snapshot }));
  await page.goto(url);
  await page.locator('#diff-tab').click();
  await page.locator('[data-diff-layout="unified"]').click();
  await page.locator('#briefing-tab').click();

  async function exerciseSequence(map, inspector, diagram) {
    await map.scrollIntoViewIfNeeded();
    const element = await map.locator('iframe[data-briefing-sequence]').elementHandle();
    const frame = await element.contentFrame();
    await frame.waitForFunction(() => window.Archify?.view?.state?.().mode === 'review');
    assert.equal(await frame.locator('.sequence-code-pane').count(), 0, 'The Briefing supplies its existing diff pane');
    await frame.waitForFunction(() => {
      const container = document.querySelector('.diagram-container'), svg = container.querySelector(':scope > svg');
      const content = svg.getBoundingClientRect(), viewport = container.getBoundingClientRect();
      return content.left >= viewport.left - 1 && content.right <= viewport.right + 1 && content.top >= viewport.top - 1 && content.bottom <= viewport.bottom + 1;
    });
    // Restored/shared relationship focus must not start a second camera animation.
    // Checking view.state() alone misses a renderer that overwrites the SVG while
    // leaving the review controller and its percentage label unchanged.
    await frame.evaluate(id => { location.hash = `relation=${encodeURIComponent(id)}`; }, diagram.elements[0].id);
    await frame.waitForFunction(id => window.Archify.focus.relationship()?.id === id, diagram.elements[0].id);
    await frame.waitForTimeout(650); // The native camera animation lasts up to 520ms.
    const renderedCamera = await frame.evaluate(() => {
      const svg = document.querySelector('.diagram-container > svg');
      const matrix = new DOMMatrix(getComputedStyle(svg).transform);
      return { scale: matrix.a, x: matrix.e, y: matrix.f };
    });
    const fittedCamera = await frame.evaluate(() => window.Archify.view.state());
    assert.ok(Math.abs(renderedCamera.scale - fittedCamera.scale) < 0.001, 'The visible SVG must match the fitted camera after focus settles');
    // Explicit zoom is retained through source inspection and layout changes.
    await frame.locator('[data-diffcompass-action="in"]').click();
    const camera = await frame.evaluate(() => window.Archify.view.state());
    for (const message of diagram.elements) {
      const target = frame.locator(`[data-relationship-id="${message.id}"]`).first();
      await target.focus(); await target.press('Enter');
      const card = inspector.locator(`[data-evidence-element="${message.id}"].briefing-selected`);
      await card.waitFor();
      if (message.evidenceIds.length) {
        for (const id of message.evidenceIds) {
          const evidence = document.evidence.find(item => item.id === id);
          const source = card.locator(`[data-evidence-id="${id}"]`);
          await source.waitFor();
          if (evidence.diff?.available) {
            assert.deepEqual(await source.locator('[data-diff-kind]').evaluateAll(rows => rows.map(row => ({
              kind: row.dataset.diffKind, content: row.querySelector('.briefing-line-content').textContent,
            }))), evidence.diff.rows.filter(row => row.kind !== 'meta').map(({ kind, content }) => ({ kind, content })));
          }
        }
      } else assert.match(await card.textContent(), /No verified source binding/);
      await card.locator('.briefing-card-title').click();
      await frame.waitForFunction(id => window.Archify.focus.relationship()?.id === id, message.id);
      assert.deepEqual(await frame.evaluate(() => window.Archify.view.state()), camera, 'Evidence inspection preserves the camera');
    }
    // Selecting a different message from the pane syncs the arrow without the
    // iframe's focus message scrolling the clicked card back to the top.
    const message = diagram.elements[0];
    const card = inspector.locator(`[data-evidence-element="${message.id}"]`);
    await card.evaluate(el => {
      const scroll = el.closest('.briefing-evidence-scroll');
      scroll.scrollTop += el.getBoundingClientRect().top - scroll.getBoundingClientRect().top - scroll.clientHeight / 2;
    });
    const scroll = inspector.locator('.briefing-evidence-scroll');
    const before = await scroll.evaluate(el => el.scrollTop);
    await card.locator('.briefing-card-title').click();
    await frame.waitForFunction(id => window.Archify.focus.relationship()?.id === id, message.id);
    await frame.waitForTimeout(650);
    assert.equal(await scroll.evaluate(el => el.scrollTop), before, 'Pane selection stays in place after Archify focus settles');
    assert.deepEqual(await frame.evaluate(() => window.Archify.view.state()), camera);
    console.log('PASS Archify sequence: fitted initial overview, native arrow selection, captured before/after diffs, camera retained');
  }
  async function exercise(reader, inspector, nativeCallFlow) {
    for (const [index, diagram] of document.diagrams.entries()) {
      const map = reader.locator(`[data-briefing-block="map-${index}"] .briefing-canvas`);
      if (diagram.family === 'sequence') {
        await exerciseSequence(map, inspector, diagram);
        continue;
      }
      if (diagram.family !== 'call-flow' || !nativeCallFlow) {
        await map.locator('svg').waitFor();
        assert.ok(await map.locator('svg').evaluate(svg => svg.getBoundingClientRect().width >= svg.viewBox.baseVal.width - 1), 'Diagram labels retain their native size');
      }
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
    const repeatedSequence = reader.locator('[data-briefing-block="sequence-revisited"] .briefing-canvas');
    await exerciseSequence(repeatedSequence, inspector, sequence);
    const originalSequence = await (await reader.locator(`[data-briefing-block="map-${document.diagrams.indexOf(sequence)}"] iframe`).elementHandle()).contentFrame();
    await originalSequence.waitForFunction(() => window.Archify.focus.relationship() === null);
    // Window messages and messages from another frame cannot select this saved evidence.
    const before = await inspector.locator('.briefing-evidence-card.briefing-selected').getAttribute('data-evidence-element');
    await page.evaluate(() => window.postMessage({ type: 'diffcompass-briefing-sequence-select', elementId: 'invented' }, '*'));
    assert.equal(await inspector.locator('.briefing-evidence-card.briefing-selected').getAttribute('data-evidence-element'), before);
    const repeated = reader.locator('[data-briefing-block="second-embedding"] .briefing-canvas [data-briefing-element="second"]').filter({ visible: true }).first();
    await repeated.focus(); await page.keyboard.press('Enter');
    const original = reader.locator(`[data-briefing-block="map-${document.diagrams.length - 1}"] [data-briefing-element="second"]`);
    for (const item of await original.all()) assert.equal(await item.getAttribute('aria-pressed'), 'false');
    assert.match(await inspector.locator('[data-evidence-element="second"] code').textContent(), /export function receipt/);
    assert.equal(await reader.locator('.briefing-canvas [data-briefing-element="root_start"]').count(), 0, 'Uncaptured pseudostates do not acquire evidence');
  }
  await exercise(page.locator('#briefing-view'), page.locator('#briefing-inspector'), true);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.locator('#briefing-view').evaluate(el => el.scrollWidth <= el.clientWidth), 'Wide diagrams scroll inside the mobile reader');
  await page.setViewportSize({ width: 1600, height: 1000 });

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
  const reader = page.locator('#export-briefing-reader');
  await reader.locator('[data-briefing-layout="split"]').click();
  await reader.locator('[data-briefing-wrap="wrap"]').click();
  assert.ok(await page.locator('#export-briefing-pane .briefing-diff-column').count() > 0, 'Offline evidence supports split diffs');
  assert.equal(await page.locator('#export-briefing-pane .briefing-line-content').first().evaluate(el => getComputedStyle(el).whiteSpace), 'pre-wrap');
  const beforeWidth = (await reader.boundingBox()).width;
  await reader.locator('[data-briefing-wide]').click();
  await page.getByRole('button', { name: 'Collapse evidence pane', exact: true }).click();
  await page.getByRole('button', { name: 'Expand evidence pane', exact: true }).waitFor();
  assert.equal((await page.locator('#export-briefing-pane').boundingBox()).width, 40);
  assert.ok((await reader.boundingBox()).width > beforeWidth);
  await page.getByRole('button', { name: 'Expand evidence pane', exact: true }).click();
  await page.locator('#export-briefing-pane').waitFor({ state: 'visible' });
  assert.deepEqual(requests, [], 'The exported reader works without a server or network');
  assert.deepEqual(errors, []);
} finally {
  await session?.dispose();
  await browser.close();
  await rm(root, { recursive: true, force: true });
}
