import assert from "node:assert/strict";
import { chromium } from "playwright";

const child = Bun.spawn([process.execPath, "prototypes/briefing/server.ts", "--port", "0"], { stdout: "pipe", stderr: "inherit" });
const startup = setTimeout(() => child.kill(), 30_000);
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  let output = "", url: string | undefined;
  for await (const chunk of child.stdout) {
    output += new TextDecoder().decode(chunk);
    url = /^Briefing experiments: (.+)$/m.exec(output)?.[1];
    if (url) break;
  }
  clearTimeout(startup);
  if (!url) throw new Error("Experiment server failed to start: " + output);
  browser = await chromium.launch({ channel: process.env.CI ? undefined : "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1050 }, reducedMotion: "reduce", acceptDownloads: true });
  page.setDefaultTimeout(20_000);
  const errors: string[] = [], external: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("request", request => { if (new URL(request.url()).origin !== new URL(url!).origin) external.push(request.url()); });
  await page.goto(url);
  const workspace = page.locator(".lab-workspace:not([hidden])");
  for (const item of ["publication", "checkpoints"]) {
    await page.locator("#case-picker").selectOption(item);
    for (const approach of ["linear", "outcome", "trace", "decisions"]) {
      await page.locator(`#approach-${approach}`).click();
      await workspace.locator(".briefing-canvas svg").waitFor();
      await workspace.locator(".briefing-excerpt code span[style]").first().waitFor();
      assert.ok(await workspace.locator(".briefing-excerpt").count() >= 3);
      assert.ok(!(await workspace.textContent())!.includes("Source unavailable"));
      assert.equal(await workspace.locator(".briefing-excerpt pre:not(.briefing-diff)").count(), 0);
      assert.ok(await workspace.locator('.briefing-excerpt [data-diff-kind="addition"]').count() > 0);
      if (item === "publication") assert.ok(await workspace.locator('.briefing-excerpt [data-diff-kind="deletion"]').count() > 0);
      for (const diagram of await workspace.locator(".briefing-diagram").all()) {
        await diagram.locator("svg").waitFor();
        for (const element of await diagram.locator("svg [data-briefing-element]").all()) {
          const id = await element.getAttribute("data-briefing-element");
          await element.click();
          await workspace.locator(`.lab-evidence [data-evidence-element="${id}"] code`).first().waitFor();
          assert.equal(await workspace.locator(".lab-evidence pre:not(.briefing-diff)").count(), 0);
        }
      }
      const sections = workspace.locator("[data-briefing-section]");
      const lastId = await sections.last().getAttribute("data-briefing-section");
      await sections.last().click();
      await page.waitForFunction(id => document.querySelector('.lab-workspace:not([hidden]) [aria-current="location"]')?.getAttribute("data-briefing-section") === id, lastId);
      await sections.first().click();
      if (approach === "trace") {
        for (const route of await workspace.locator("[data-scenario]").all()) {
          await route.click();
          for (const step of await workspace.locator("[data-stage-evidence]").all()) {
            const id = await step.getAttribute("data-stage-evidence");
            await step.click();
            await workspace.locator(`.lab-evidence [data-evidence-id="${id}"] code`).waitFor();
          }
        }
      }
      if (approach === "decisions") {
        const reasoning = workspace.locator(".lab-reasoning").first();
        assert.equal(await reasoning.getAttribute("open"), null);
        await reasoning.locator("summary").click();
        assert.notEqual(await reasoning.getAttribute("open"), null);
      }
      console.log(`PASS ${item} / ${approach}: diagram, highlighted source, outline, interactions`);
    }
  }
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
  await page.locator("#case-picker").selectOption("publication");
  await page.locator("#approach-outcome").click();
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
  await page.locator("#case-picker").selectOption("checkpoints");
  await page.locator("#approach-decisions").click();
  console.log("PASS draggable inner edges, reading point, keyboard sizing, shared saved widths, viewport limits, reset");

  // Per-approach reading position and notes survive switching and reloads.
  const before = await workspace.locator(".lab-scroll").evaluate(el => el.scrollTop);
  await page.locator("#approach-outcome").click();
  await page.locator("#approach-decisions").click();
  await page.waitForFunction(top => Math.abs(document.querySelector('.lab-workspace:not([hidden]) .lab-scroll')!.scrollTop - top) < 2, before);
  await page.locator("#notes-open").click();
  await page.locator("#notes-text").fill("The two baselines explain why a checked path can reopen.");
  await page.locator("#notes-close").click();
  await page.reload();
  await page.locator("#notes-open").click();
  assert.match(await page.locator("#notes-text").inputValue(), /two baselines/);
  const download = page.waitForEvent("download"); await page.locator("#notes-download").click();
  assert.equal((await download).suggestedFilename(), "briefing-experiment-notes.md");
  await page.locator("#notes-close").click();
  await page.locator("#approach-outcome").focus(); await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator("#approach-trace").getAttribute("aria-selected"), "true");
  await page.goBack();
  assert.equal(await page.locator("#approach-decisions").getAttribute("aria-selected"), "true");
  await page.goForward();
  assert.equal(await page.locator("#approach-trace").getAttribute("aria-selected"), "true");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await workspace.locator('[data-resize-pane]:visible').count(), 0);
  await workspace.locator(".lab-scroll").evaluate(el => { el.scrollTop = 0; });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.ok(await workspace.evaluate(el => el.getBoundingClientRect().right <= innerWidth));
  await page.locator("#approach-outcome").click();
  assert.ok(await workspace.locator(".briefing-view").evaluate(el => el.getBoundingClientRect().right <= innerWidth));
  await page.locator("#approach-trace").click();
  await workspace.locator("[data-stage-evidence]").first().click();
  await page.locator("#evidence-sheet[open] .briefing-source code").waitFor();
  await page.keyboard.press("Escape");
  await page.locator("#evidence-sheet[open]").waitFor({ state: "hidden" });
  await page.locator("#case-picker").selectOption("publication");
  await workspace.locator("[data-stage-evidence]").first().click();
  await page.locator("#evidence-sheet[open] .briefing-source code").waitFor();
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log("PASS reading restoration, local notes, export, keyboard navigation, mobile inspection, no external requests");
} finally { clearTimeout(startup); await browser?.close(); child.kill(); await child.exited; }
