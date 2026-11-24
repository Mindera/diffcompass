import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { prepareTestFixture } from "../src/test-fixture.ts";
import { ReviewSession } from "../src/session.ts";
import { startServer } from "../src/server.ts";
import { diffSourceIdentity } from "../src/diff-sources.ts";
import { loadPersistedSession, savePersistedSession } from "../src/store.ts";

const root = await mkdtemp(join(tmpdir(), "briefing-startup-browser-"));
let session: ReviewSession | undefined, server: ReturnType<typeof startServer> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  const fixture = await prepareTestFixture({ root: join(root, "fixture"), reset: true });
  const saved = await loadPersistedSession(fixture.stateFile);
  saved.selection = { ...saved.selection!, adapterId: "attached", modelId: "current-session", reasoningEffort: undefined };
  saved.bridgeToken = crypto.randomUUID();
  saved.bridgeSequence = 0;
  await savePersistedSession(fixture.stateFile, saved);
  session = await ReviewSession.create(fixture.repository, undefined, { resume: true, attached: true, stateFile: fixture.stateFile, agentAdapters: [] });
  const prepared = structuredClone(session.outline!);
  session.outline!.phases = [];
  session.outline!.findings = [];
  session.currentStepIndex = -1;
  session.outline!.preparation = { id: crypto.randomUUID(), comparisonId: diffSourceIdentity(session.comparison), briefing: "ready", steps: "pending", findings: "pending" };
  server = startServer(session, 0);
  browser = await chromium.launch({ channel: process.env.CI ? undefined : "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.port}/#token=${session.browserToken}&intro=1`);
  await page.locator('.briefing-preparation').getByText('Preparing tour steps in the background.', { exact: false }).waitFor();
  assert.equal(await page.locator('[data-briefing-tour]').count(), 0);
  await page.locator('.briefing-heading h1').waitFor();
  const title = await page.locator('.briefing-heading h1').textContent();
  const scroll = page.locator('#diff-panel');
  await scroll.evaluate(el => { el.scrollTop = 300; });
  const before = await scroll.evaluate(el => el.scrollTop);
  session.outline!.phases = prepared.phases;
  session.currentStepIndex = 0;
  session.outline!.preparation!.steps = "ready";
  session.revision++;
  await page.locator('[data-briefing-tour]').waitFor();
  assert.equal(await page.locator('.briefing-heading h1').textContent(), title);
  assert.ok(Math.abs(await scroll.evaluate(el => el.scrollTop) - before) < 40, "background readiness preserves reading position");
  session.outline!.preparation!.findings = "failed";
  session.outline!.preparation!.findingsError = "Provider unavailable";
  session.revision++;
  await page.locator('[data-briefing-retry]').waitFor();
  await page.getByText('findings preparation failed: Provider unavailable', { exact: true }).waitFor();
  await page.locator('[data-briefing-tour]').click();
  await page.locator('#step-title').waitFor();

  // Resuming existing content in changes mode opens the full diff with its tour paused.
  await page.route('**/api/session', route => route.fulfill({ json: { ...session!.snapshot(), launchMode: 'changes' } }));
  await page.goto('about:blank');
  await page.goto(`http://127.0.0.1:${server.port}/#token=${session.browserToken}`);
  await page.locator('#diff-renderer:enabled').waitFor();
  assert.equal(await page.locator('#diff-tab').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#briefing-view').isVisible(), false);
  await page.getByRole('button', { name: 'Resume tour', exact: true }).waitFor();
  await page.unroute('**/api/session');

  // A briefing-only session must look complete, not permanently preparing.
  session.outline!.phases = [];
  session.outline!.findings = [];
  session.currentStepIndex = -1;
  session.outline!.preparation = { id: crypto.randomUUID(), comparisonId: diffSourceIdentity(session.comparison), briefing: "ready", steps: "disabled", findings: "disabled" };
  session.revision++;
  await page.goto('about:blank');
  await page.goto(`http://127.0.0.1:${server.port}/#token=${session.browserToken}&intro=1`);
  await page.locator('.briefing-heading h1').waitFor();
  assert.equal(await page.locator('.briefing-preparation').count(), 0);
  assert.equal(await page.locator('[data-briefing-tour]').count(), 0);
  await page.locator('#diff-tab').click();
  await page.getByText('No tour prepared', { exact: true }).waitFor();
  assert.equal(await page.locator('#start-tour').isEnabled(), true);
  assert.equal(await page.locator('#planning-activity').isVisible(), false);

  // Check UI dispatch with bounded responses. Worker generation and reuse are
  // exercised through real sessions in briefing-startup.test.ts and CLI tests.
  const starts: string[] = [];
  await page.route('**/api/tour/start', async route => {
    starts.push('tour');
    await route.fulfill({ json: session!.snapshot() });
  });
  await page.locator('#start-tour').click();
  await page.waitForFunction(() => !document.querySelector('#start-tour')?.disabled);
  assert.deepEqual(starts, ['tour']);
  session.outline!.preparation.briefing = "failed";
  session.outline!.preparation.briefingError = "Briefing provider unavailable";
  session.revision++;
  await page.locator('#briefing-tab').click();
  await page.locator('[data-briefing-retry]').waitFor();
  await page.route('**/api/briefing/start', async route => {
    starts.push('briefing');
    session!.outline!.preparation!.briefing = "ready";
    delete session!.outline!.preparation!.briefingError;
    session!.revision++;
    await route.fulfill({ json: session!.snapshot() });
  });
  await page.locator('[data-briefing-retry]').click();
  await page.locator('[data-briefing-retry]').waitFor({ state: 'hidden' });
  assert.deepEqual(starts, ['tour', 'briefing']);
  assert.equal(session.outline!.preparation.steps, 'disabled');
  assert.equal(await page.locator('.briefing-preparation').count(), 0);
  assert.deepEqual(errors, [], "no browser exceptions while steps arrive");
  console.log("Briefing browser checks passed: pending steps, live readiness, reading position, tour entry, briefing-only completion and retry dispatch.");
} finally {
  await browser?.close();
  server?.stop(true);
  await session?.dispose();
  await rm(root, { recursive: true, force: true });
}
