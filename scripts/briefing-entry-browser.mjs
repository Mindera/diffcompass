// Exercise startup and the handoff to the tour against the production UI.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const [playwrightPath, url] = process.argv.slice(2);
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(20000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const selectedTab = name => page.locator(`#${name}-tab[aria-selected="true"]`).waitFor();
// The app removes its token fragment. Reusing it without leaving the page is
// only a hash navigation, so each startup case needs a fresh document.
async function openReview(target = url) {
  await page.goto('about:blank');
  await page.goto(target);
  await page.locator('#repository-label').filter({ hasText: /\S/ }).waitFor();
}
try {
  const headers = { 'x-diffcompass-token': new URLSearchParams(new URL(url).hash.slice(1)).get('token') };
  const saved = await (await page.request.get(new URL('/api/session', url).href, { headers })).json();
  const ready = structuredClone(saved);
  ready.preferences.showBriefing = true;
  ready.currentStepIndex = 1;
  let session = ready;
  await page.route('**/api/session', route => route.fulfill({ json: session }));

  console.log('CHECK Saved Briefing opens without the legacy intro flag');
  await openReview();
  await selectedTab('briefing');
  assert.equal(await page.locator('#tour-intro-dialog').evaluate(el => el.open), false);
  const handoff = page.locator('[data-briefing-tour]');
  await handoff.waitFor();
  assert.ok(await handoff.evaluate(el => el.closest('footer').previousElementSibling.classList.contains('briefing-section')), 'The handoff follows the story');
  assert.match(await page.locator('.briefing-tour').textContent(), /Changes tab/);

  console.log('CHECK Handoff resumes the current tour stop without resetting progress');
  await handoff.click();
  await selectedTab('diff');
  const step = ready.outline.phases.flatMap(phase => phase.steps)[ready.currentStepIndex];
  await page.locator('.tour-code-note.active').filter({ hasText: step.title }).waitFor();
  await page.locator('#tour-mode-toggle').click();
  await page.getByRole('button', { name: 'Resume tour', exact: true }).waitFor();
  await page.locator('#briefing-tab').click();
  await handoff.click();
  await selectedTab('diff');
  await page.locator('.tour-code-note.active').filter({ hasText: step.title }).waitFor();
  assert.equal(session.currentStepIndex, 1);
  // A session update must not pull the reader back into Briefing.
  session = { ...ready, revision: ready.revision + 1 };
  await page.waitForResponse(response => response.url().endsWith('/api/session'));
  await selectedTab('diff');

  console.log('CHECK Disabled automatic Briefing opens Changes');
  session = structuredClone(ready);
  session.preferences.showBriefing = false;
  await openReview();
  await selectedTab('diff');
  console.log('CHECK Explicit intro overrides the automatic Briefing preference');
  await openReview(`${url}&intro=1`);
  await selectedTab('briefing');

  console.log('CHECK Preparing a new tour opens its Briefing');
  session = structuredClone(ready);
  delete session.outline;
  await page.route('**/api/tour/start', route => { session = ready; return route.fulfill({ json: session }); });
  await openReview();
  await selectedTab('diff');
  await page.locator('#briefing-tab').click();
  assert.equal(await handoff.count(), 0, 'A review without a prepared tour does not promise one');
  await page.locator('#diff-tab').click();
  await page.locator('#start-tour').click();
  await selectedTab('briefing');
  await handoff.waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS Briefing entry, tour handoff, progress preservation, opt-out, and empty states');
} catch (error) {
  console.error('Briefing entry failure', errors, await page.locator('#connection-banner').textContent());
  await page.screenshot({ path: '/tmp/dc-briefing-entry-failure.png' });
  throw error;
} finally {
  await page.unrouteAll({ behavior: 'wait' });
  await browser.close();
}
