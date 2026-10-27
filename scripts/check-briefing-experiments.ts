import assert from "node:assert/strict";
import { chromium } from "playwright";

const child = Bun.spawn([process.execPath, "prototypes/briefing/server.ts", "--port", "0", ...process.argv.slice(2)], { stdout: "pipe", stderr: "inherit" });
const startup = setTimeout(() => child.kill(), 30_000);
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  let output = "", url: string | undefined;
  for await (const chunk of child.stdout) {
    output += new TextDecoder().decode(chunk);
    url = /^Briefing preview: (.+)$/m.exec(output)?.[1];
    if (url) break;
  }
  clearTimeout(startup);
  if (!url) throw new Error("Briefing preview failed to start: " + output);
  browser = await chromium.launch({ channel: process.env.CI ? undefined : "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1050 }, reducedMotion: "reduce", acceptDownloads: true });
  page.setDefaultTimeout(20_000);
  const errors: string[] = [], external: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("request", request => { if (new URL(request.url()).origin !== new URL(url!).origin) external.push(request.url()); });
  // Legacy links must resolve to the chosen reading view, without variant controls.
  await page.goto(url + "&approach=decisions");
  const payload = await (await page.request.get(new URL("/cases.json", url).href)).json();
  const caseIds: string[] = payload.cases.map((item: { id: string }) => item.id);
  assert.equal(caseIds.length, 2);
  const [firstCase, secondCase] = caseIds as [string, string];
  const workspace = page.locator(".lab-workspace:not([hidden])");
  await workspace.waitFor();
  assert.equal(await page.getByRole("tablist", { name: "Reading approach" }).count(), 0);
  assert.equal(new URL(page.url()).hash, `#case=${firstCase}`);
  assert.equal(payload.approaches, undefined);
  let sawDeletion = false;
  for (const item of caseIds) {
    await page.locator("#case-picker").selectOption(item);
    const captured = payload.cases.find((entry: { id: string }) => entry.id === item).document;
    async function assertImplementationDiffs() {
      for (const source of captured.evidence.filter((entry: { kind: string }) => entry.kind === 'code')) {
        assert.equal(await workspace.locator(`[data-evidence-id="${source.id}"] pre:not(.briefing-diff)`).count(), 0);
      }
    }
    await workspace.locator(".briefing-canvas svg, .briefing-canvas iframe").first().waitFor();
    await workspace.locator(".briefing-excerpt code span[style]").first().waitFor();
    assert.ok(await workspace.locator(".briefing-excerpt").count() >= 3);
    assert.ok(!(await workspace.textContent())!.includes("Source unavailable"));
    await assertImplementationDiffs();
    assert.ok(await workspace.locator('.briefing-excerpt [data-diff-kind="addition"]').count() > 0);
    sawDeletion ||= await workspace.locator('.briefing-excerpt [data-diff-kind="deletion"]').count() > 0;
    for (const diagram of await workspace.locator(".briefing-diagram").all()) {
      if (await diagram.locator('iframe[data-briefing-diagram]').count()) {
        await diagram.scrollIntoViewIfNeeded();
        const frame = await (await diagram.locator('iframe').elementHandle())!.contentFrame();
        await frame!.waitForFunction(() => window.Archify?.view?.state?.().mode === 'review');
        await frame!.waitForFunction(() => {
          const container = document.querySelector('.diagram-container')!, svg = container.querySelector(':scope > svg')!;
          const content = svg.getBoundingClientRect(), viewport = container.getBoundingClientRect();
          return content.left >= viewport.left - 1 && content.right <= viewport.right + 1 && content.top >= viewport.top - 1 && content.bottom <= viewport.bottom + 1;
        });
        for (const target of await frame!.locator('[data-relationship-id]').all()) {
          const id = await target.getAttribute('data-relationship-id');
          await target.focus(); await target.press('Enter');
          await workspace.locator(`.lab-evidence [data-evidence-element="${id}"].briefing-selected`).waitFor();
          await assertImplementationDiffs();
        }
        continue;
      }
      await diagram.locator("svg").waitFor();
      for (const element of await diagram.locator("svg [data-briefing-element]").filter({ visible: true }).all()) {
        const id = await element.getAttribute("data-briefing-element");
        await element.focus(); await element.press('Enter');
        const card = workspace.locator(`.lab-evidence [data-evidence-element="${id}"].briefing-selected`);
        await card.waitFor();
        const blockId = await diagram.getAttribute('data-briefing-block');
        const block = captured.sections.flatMap((section: { blocks: any[] }) => section.blocks).find((block: { id: string }) => block.id === blockId);
        const saved = captured.diagrams.find((diagram: { id: string }) => diagram.id === block.diagramId).elements.find((element: { id: string }) => element.id === id);
        if (saved.evidenceIds.length) await card.locator('code').first().waitFor();
        else assert.match(await card.textContent() || '', /No verified source binding/);
        await assertImplementationDiffs();
      }
    }
    const sections = workspace.locator("[data-briefing-section]");
    const lastId = await sections.last().getAttribute("data-briefing-section");
    await sections.last().click();
    await page.waitForFunction(id => document.querySelector('.lab-workspace:not([hidden]) [aria-current="location"]')?.getAttribute("data-briefing-section") === id, lastId);
    await sections.first().click();
    console.log(`PASS ${item}: outcome-first story, diagrams, highlighted diffs, outline, interactions`);
  }
  assert.ok(sawDeletion, "The examples must show removed code as well as additions");
  const reader = workspace.locator('.briefing-view');
  assert.equal(await reader.getByRole('button', { name: 'Evidence', exact: true }).count(), 0);
  const standardWidth = (await reader.boundingBox())!.width;
  await reader.locator('[data-briefing-wide]').click();
  assert.ok((await reader.boundingBox())!.width > standardWidth);
  const evidenceWidth = (await workspace.locator('.lab-evidence').boundingBox())!.width;
  await workspace.getByRole('button', { name: 'Collapse evidence pane', exact: true }).click();
  await workspace.getByRole('button', { name: 'Expand evidence pane', exact: true }).waitFor();
  assert.equal((await workspace.locator('.lab-evidence').boundingBox())!.width, 40);
  assert.equal(await workspace.locator('.briefing-evidence-scroll').isVisible(), false);
  const column = (await reader.boundingBox())!, center = (await workspace.locator('.lab-scroll').boundingBox())!;
  assert.ok(column.width <= 1280 && column.x > center.x, 'The wide view keeps a centered column and margins');
  assert.equal(await workspace.locator('[data-resize-pane="evidence"]:visible').count(), 0);
  await page.reload();
  await workspace.waitFor();
  assert.equal(await reader.locator('[data-briefing-wide]').getAttribute('aria-pressed'), 'true');
  await workspace.getByRole('button', { name: 'Expand evidence pane', exact: true }).waitFor();
  assert.equal((await workspace.locator('.lab-evidence').boundingBox())!.width, 40);
  await page.getByRole('button', { name: 'Expand evidence pane', exact: true }).click();
  await workspace.locator('.lab-evidence').waitFor();
  assert.equal((await workspace.locator('.lab-evidence').boundingBox())!.width, evidenceWidth);
  await reader.locator('[data-briefing-wide]').click();
  assert.equal((await reader.boundingBox())!.width, standardWidth);
  console.log('PASS wider reading, close/reopen evidence, saved layout, retained pane width');
  // Both inner edges resize the actual panes, without losing the reading point.
  const paneWidth = (side: string) => workspace.locator(`.lab-${side}`).evaluate(el => el.getBoundingClientRect().width);
  const dragPane = async (side: string, delta: number) => {
    const edge = await workspace.locator(`[data-resize-pane="${side}"]`).boundingBox();
    assert.ok(edge);
    await page.mouse.move(edge.x + edge.width / 2, edge.y + 100);
    await page.mouse.down();
    await page.mouse.move(edge.x + edge.width / 2 + delta, edge.y + 100, { steps: 12 });
    await page.mouse.up();
  };
  await workspace.locator("[data-briefing-section]").nth(1).click();
  const readingPoint = await workspace.locator(".lab-scroll").evaluate(scroll => {
    const top = scroll.getBoundingClientRect().top;
    const block = [...scroll.querySelectorAll<HTMLElement>("[data-briefing-block]")].find(el => el.getBoundingClientRect().bottom > top + 12)!;
    return { id: block.dataset.briefingBlock, offset: block.getBoundingClientRect().top - top };
  });
  const initialOutline = await paneWidth("outline"), initialEvidence = await paneWidth("evidence");
  await dragPane("outline", 70);
  await dragPane("evidence", -100);
  assert.equal(await paneWidth("outline"), initialOutline + 70);
  assert.equal(await paneWidth("evidence"), initialEvidence + 100);
  await page.waitForFunction(({ id, offset }) => {
    const scroll = document.querySelector('.lab-workspace:not([hidden]) .lab-scroll')!;
    const block = scroll.querySelector(`[data-briefing-block="${id}"]`)!;
    return Math.abs(block.getBoundingClientRect().top - scroll.getBoundingClientRect().top - offset) < 2;
  }, readingPoint);
  const outlineHandle = workspace.locator('[data-resize-pane="outline"]');
  const evidenceHandle = workspace.locator('[data-resize-pane="evidence"]');
  await outlineHandle.focus(); await page.keyboard.press("ArrowLeft");
  await evidenceHandle.focus(); await page.keyboard.press("ArrowRight");
  assert.equal(await paneWidth("outline"), initialOutline + 50);
  assert.equal(await paneWidth("evidence"), initialEvidence + 80);
  await page.locator("#case-picker").selectOption(firstCase);
  assert.equal(await paneWidth("outline"), initialOutline + 50);
  assert.equal(await paneWidth("evidence"), initialEvidence + 80);
  await page.reload();
  await workspace.waitFor();
  assert.equal(await paneWidth("outline"), initialOutline + 50);
  assert.equal(await paneWidth("evidence"), initialEvidence + 80);
  await evidenceHandle.focus(); await page.keyboard.press("End");
  await outlineHandle.focus(); await page.keyboard.press("End");
  assert.ok(await workspace.locator(".lab-scroll").evaluate(el => el.clientWidth >= 360));
  await page.setViewportSize({ width: 950, height: 1050 });
  await page.waitForFunction(() => document.querySelector('.lab-workspace:not([hidden]) .lab-scroll')!.clientWidth >= 360);
  assert.ok(await workspace.evaluate(el => el.scrollWidth <= el.clientWidth));
  assert.equal(Number(await outlineHandle.getAttribute("aria-valuenow")), await paneWidth("outline"));
  await page.setViewportSize({ width: 1600, height: 1050 });
  await page.waitForFunction(() => document.querySelector('.lab-workspace:not([hidden]) [data-resize-pane="evidence"]')?.getAttribute("aria-valuenow") === "720");
  await outlineHandle.dblclick(); await evidenceHandle.dblclick();
  assert.equal(await paneWidth("outline"), initialOutline);
  assert.equal(await paneWidth("evidence"), initialEvidence);
  await page.locator("#case-picker").selectOption(secondCase);
  console.log("PASS draggable inner edges, reading point, keyboard sizing, shared saved widths, viewport limits, reset");

  // Per-change reading position and notes survive switching and reloads.
  await workspace.locator("[data-briefing-section]").nth(1).click();
  const before = await workspace.locator(".lab-scroll").evaluate(el => el.scrollTop);
  await page.locator("#case-picker").selectOption(firstCase);
  await page.locator("#case-picker").selectOption(secondCase);
  await page.waitForFunction(top => Math.abs(document.querySelector('.lab-workspace:not([hidden]) .lab-scroll')!.scrollTop - top) < 2, before);
  await page.locator("#notes-open").click();
  await page.locator("#notes-text").fill("The ownership diagram makes the intent clearer.");
  await page.locator("#notes-close").click();
  await page.reload();
  await page.locator("#notes-open").click();
  assert.match(await page.locator("#notes-text").inputValue(), /ownership diagram/);
  const download = page.waitForEvent("download"); await page.locator("#notes-download").click();
  assert.equal((await download).suggestedFilename(), "briefing-reading-notes.md");
  await page.locator("#notes-close").click();
  await page.locator("#case-picker").selectOption(firstCase);
  await page.goBack();
  assert.equal(await page.locator("#case-picker").inputValue(), secondCase);
  await page.goForward();
  assert.equal(await page.locator("#case-picker").inputValue(), firstCase);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await workspace.locator('[data-resize-pane]:visible').count(), 0);
  await workspace.locator(".lab-scroll").evaluate(el => { el.scrollTop = 0; });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.ok(await workspace.evaluate(el => el.getBoundingClientRect().right <= innerWidth));
  assert.ok(await workspace.locator(".briefing-view").evaluate(el => el.getBoundingClientRect().right <= innerWidth));
  await workspace.locator(".briefing-diagram [data-briefing-inspect]").first().click();
  await page.locator("#evidence-sheet[open] .briefing-source code").first().waitFor();
  await page.getByRole('button', { name: 'Collapse evidence pane', exact: true }).click();
  await page.locator("#evidence-sheet[open]").waitFor({ state: "hidden" });
  await page.locator("#case-picker").selectOption(secondCase);
  await workspace.locator(".briefing-diagram [data-briefing-inspect]").first().click();
  await page.locator("#evidence-sheet[open] .briefing-source code").first().waitFor();
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log("PASS reading restoration, local notes, export, case history, mobile inspection, no external requests");
} finally { clearTimeout(startup); await browser?.close(); child.kill(); await child.exited; }
