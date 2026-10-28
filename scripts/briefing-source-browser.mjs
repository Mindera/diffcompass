// A source detour must escape the tour's phase and retain the reader's place.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const [playwrightPath, url] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', headless: true });
try {
  for (const renderer of ['current', 'monaco']) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const headers = { 'x-diffcompass-token': new URLSearchParams(new URL(url).hash.slice(1)).get('token') };
    const snapshot = async () => (await page.request.get(new URL('/api/session', url).href, { headers })).json();
    const initial = await snapshot();
    const step = initial.outline.phases.flatMap(phase => phase.steps)[initial.currentStepIndex];
    assert.equal(step.anchor.path, 'src/cart.ts');
    await page.goto(url);
    await page.locator('#diff-tab').click();
    await page.locator('#diff-renderer').selectOption(renderer);
    await page.locator('#briefing-tab').click();
    await page.locator('[data-briefing-section="boundaries"]').click();
    await page.frameLocator('#briefing-view .briefing-canvas iframe').first().locator('g[data-node-id="receipt"]').click();
    const selected = page.locator('#briefing-inspector [data-evidence-element="receipt"] .briefing-card-title');
    await page.locator('#briefing-inspector [data-evidence-element="receipt"] .briefing-card-title[aria-pressed="true"]').waitFor();
    const readerPosition = await page.locator('#diff-panel').evaluate(el => el.scrollTop);

    async function openSource(id, path, line, returnToBriefing = true) {
      await page.locator(`#briefing-inspector [data-briefing-source="${id}"]`).click();
      await page.locator('#diff-tab[aria-selected="true"]').waitFor();
      await page.getByRole('button', { name: 'Resume tour', exact: true }).waitFor();
      if (renderer === 'monaco') {
        await page.waitForFunction(({ path, line }) => {
          const frame = [...document.querySelectorAll('.monaco-review-frame')].find(frame => frame.dataset.monacoPath === path);
          const child = frame?.contentWindow?.diffCompassMonaco;
          const geometry = child?.geometry(path, 'new', line);
          if (!geometry) return false;
          const panel = document.getElementById('diff-panel').getBoundingClientRect();
          const top = frame.getBoundingClientRect().top + geometry.top;
          return top > panel.top + 60 && top < panel.bottom - 30;
        }, { path, line });
      } else {
        await page.waitForFunction(({ path, line }) => {
          const row = document.querySelector(`#diff .diff-row[data-path="${path}"][data-side="new"][data-line="${line}"].selected`);
          if (!row) return false;
          const bounds = row.getBoundingClientRect(), panel = document.getElementById('diff-panel').getBoundingClientRect();
          return bounds.top > panel.top + 60 && bounds.bottom < panel.bottom - 30;
        }, { path, line });
      }
      await page.locator('#briefing-source-return').waitFor();
      if (!returnToBriefing) return;
      await page.getByRole('button', { name: '↩ Back to Briefing', exact: true }).click();
      await page.locator('#briefing-tab[aria-selected="true"]').waitFor();
      await page.waitForFunction(top => Math.abs(document.getElementById('diff-panel').scrollTop - top) < 2, readerPosition);
      assert.equal(await selected.getAttribute('aria-pressed'), 'true', 'Returning preserves the selected diagram card');
      assert.equal(await page.locator('#briefing-source-return').isVisible(), false);
    }

    // Receipt lives in the next phase. Cart is in the paused phase.
    await openSource('receipt-body', 'src/receipt.ts', 3);
    await openSource('total-body', 'src/cart.ts', 14);
    await page.locator('[data-briefing-tour]').click();
    await page.locator('#diff-tab[aria-selected="true"]').waitFor();
    await page.getByRole('button', { name: 'Exit tour', exact: true }).waitFor();
    if (renderer === 'monaco') {
      await page.waitForFunction(title => [...document.querySelectorAll('.monaco-review-frame')].some(frame =>
        [...(frame.contentDocument?.querySelectorAll('.review-tour-stop[data-tour-state="current"]') ?? [])].some(note => note.textContent.includes(title))), step.title);
    } else await page.locator('.tour-code-note.active').filter({ hasText: step.title }).waitFor();
    assert.equal(await page.locator('#briefing-source-return').isVisible(), false, 'Resuming the tour is a separate handoff');
    await page.locator('#briefing-tab').click();
    await openSource('receipt-body', 'src/receipt.ts', 3, false);
    await page.getByRole('button', { name: 'Resume tour', exact: true }).click();
    await page.getByRole('button', { name: 'Exit tour', exact: true }).waitFor();
    assert.equal(await page.locator('#briefing-source-return').isVisible(), false, 'Resuming directly in Changes ends the Briefing detour');
    const after = await snapshot();
    assert.equal(after.currentStepIndex, initial.currentStepIndex);
    assert.deepEqual(after.reviewedFiles, initial.reviewedFiles);
    assert.deepEqual(errors, []);
    console.log(`PASS ${renderer}: cross-phase source, paused source, return position and selection, resume without changing progress`);
    await page.close();
  }
} finally { await browser.close(); }
