// Exercise production UI/server paths with a transport that cannot contact GitHub.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Frame } from "playwright";

const fixture = Bun.spawn([process.execPath, "scripts/github-suggestions-fixture.ts"], {
  stdout: "pipe", stderr: "inherit", env: { ...process.env, DIFF_VIEWER_PORT: "0" },
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const startupTimeout = setTimeout(() => fixture.kill(), 30_000);
try {
  let output = "", url: string | undefined, repository: string | undefined, payloadFile: string | undefined;
  for await (const chunk of fixture.stdout) {
    output += new TextDecoder().decode(chunk);
    url = /^Production fixture: (.+)$/m.exec(output)?.[1];
    repository = /^Repository: (.+)$/m.exec(output)?.[1];
    payloadFile = /^Simulated reviews: (.+)$/m.exec(output)?.[1];
    if (url && repository && payloadFile) break;
  }
  clearTimeout(startupTimeout);
  assert.ok(url && repository && payloadFile, output);
  browser = await chromium.launch({ channel: process.env.CI ? undefined : "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1800, height: 1000 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(20_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const token = new URL(url).hash.slice(7);
  const path = "src/cart.ts", original = await readFile(join(repository, path), "utf8");
  const payloads = async () => JSON.parse(await readFile(payloadFile!, "utf8"));
  async function api(path: string, body?: unknown, method = body ? "POST" : "GET") {
    return page.evaluate(async ({ path, token, body, method }) => {
      const response = await fetch(path, { method, headers: { "x-diffcompass-token": token, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      const value = await response.json();
      if (!response.ok) throw Error(JSON.stringify(value));
      return value;
    }, { path, token, body, method });
  }
  let frame: Frame;
  async function ready() {
    await page.locator("#diff-renderer").selectOption("monaco");
    await page.waitForFunction(path => [...document.querySelectorAll<HTMLIFrameElement>(".monaco-review-frame")].some(node => {
      const view = (node.contentWindow as any)?.diffLab?.views.get(path);
      return node.dataset.monacoPath === path && !node.closest(".monaco-phase-staging") && view?.diff.getLineChanges();
    }), path);
    frame = page.frames().find(frame => new URL(frame.url(), url).searchParams.get("file") === path)!;
    assert.ok(frame);
  }
  async function clickMutation(button: ReturnType<Frame["getByRole"]>, endpoint: string) {
    const response = page.waitForResponse(response => new URL(response.url()).pathname === endpoint && response.request().method() !== "GET");
    await button.click();
    const result = await response;
    assert.equal(result.status(), 200, await result.text());
    return result.json();
  }
  await page.goto(url);
  for (let index = 0; index < 4; index++) await api("/api/tour/navigate", { direction: "previous" });
  await page.reload();
  await ready();
  const snapshot = await api("/api/session");
  const head = snapshot.pullRequest.headRefOid;
  const ordinaryComment = snapshot.comments.find((comment: any) => !comment.suggestion);
  assert.ok(ordinaryComment);
  const decisionDialog = page.locator("#review-decision-dialog");
  const reviewConfirmation = page.locator("#github-review-confirmation-dialog");
  for (const button of ["approve-comments-button", "feedback-button"]) {
    await page.locator(`#${button}`).click();
    await reviewConfirmation.waitFor();
    assert.equal(await decisionDialog.isVisible(), false, "Existing diff comments must bypass the extra note prompt");
    assert.match(await page.locator("#github-review-confirmation-comments").textContent() ?? "", /1 selected inline comment/);
    assert.deepEqual(await payloads(), [], "Skipping the note must still require publication confirmation");
    await page.locator("#cancel-github-review-confirmation").click();
  }
  await api(`/api/comments/${ordinaryComment.id}`, undefined, "DELETE");
  await page.reload(); await ready();
  for (const button of ["approve-comments-button", "feedback-button"]) {
    await page.locator(`#${button}`).click();
    await decisionDialog.waitFor();
    await page.locator("#submit-review-decision").click();
    assert.equal(await decisionDialog.isVisible(), true, "Without inline comments an overall note is required");
    assert.equal(await reviewConfirmation.isVisible(), false);
    await page.locator("#review-decision-note").fill("Preserve selection and scroll position.");
    await page.locator("#submit-review-decision").click();
    await reviewConfirmation.waitFor();
    assert.equal(await decisionDialog.isVisible(), false);
    await page.locator("#cancel-github-review-confirmation").click();
  }
  assert.deepEqual(await payloads(), []);
  await api("/api/comments", { path: ordinaryComment.path, side: ordinaryComment.side, line: ordinaryComment.line, body: ordinaryComment.body });
  await page.reload(); await ready();
  console.log("PASS review decisions: existing diff comments skip the note, empty reviews require a note, and GitHub publication always requires confirmation");
  // A computed diff can precede the initial tour's focus restoration. Reveal
  // through the host so navigation and layout finish before selecting code.
  await page.evaluate(path => (window as any).diffCompassProductionHost.reveal(path, "new", 16), path);
  await frame!.evaluate(() => {
    const { monaco, diffLab } = window as any;
    const editor = diffLab.views.get("src/cart.ts").editors.new;
    editor.setSelection(new monaco.Range(16, 1, 17, editor.getModel().getLineMaxColumn(17)));
    editor.focus();
  });
  await frame!.locator(".editor.modified textarea.inputarea").press("Shift+F10");
  await page.waitForTimeout(150); // Monaco suppresses menu mouse-up during its first 100ms.
  await frame!.getByRole("menuitem", { name: "Suggest edit", exact: true }).click();
  await frame!.locator("form.review-suggestion").waitFor();
  const typedReplacement = "  if (!discount) return amount;\n  // Preserve literal ``` fences and `code`.\n  return amount * (1 - discount.percentage);";
  await frame!.evaluate(() => (window as any).monaco.editor.getEditors().find((editor: any) => editor.getDomNode()?.closest(".review-suggestion-editor")).focus());
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText(typedReplacement);
  // Compare publication with the visible draft, including Monaco's automatic
  // indentation when Playwright inserts multiline text through the keyboard.
  const replacement = await frame!.evaluate(() => (window as any).monaco.editor.getModels().find((model: any) => model.uri.authority === "review-suggestion").getValue()) as string;
  const proposed = await clickMutation(frame!.getByRole("button", { name: "Propose edit", exact: true }), "/api/edits");
  const activityId = proposed.activityId;
  for (const layout of ["split", "unified"]) {
    await page.locator(`[data-diff-layout="${layout}"]`).click();
    await frame!.waitForFunction(layout => (document.getElementById("layout") as HTMLSelectElement).value === layout, layout);
    const queue = frame!.getByRole("button", { name: "Add to GitHub review", exact: true });
    await clickMutation(queue, `/api/activities/${activityId}/github`);
    await frame!.getByRole("button", { name: "Return to local", exact: true }).waitFor();
    assert.equal(await frame!.getByRole("button", { name: "Apply locally", exact: true }).count(), 0);
    assert.equal(await readFile(join(repository, path), "utf8"), original);
    assert.deepEqual(await payloads(), []);
    await clickMutation(frame!.getByRole("button", { name: "Return to local", exact: true }), `/api/activities/${activityId}/github`);
    await queue.waitFor();
    assert.equal((await api("/api/session")).activities.find((a: any) => a.id === activityId).inlineEdit.replacement, replacement);
    console.log(`PASS ${layout}: UI proposal queues and returns without source edits or publication`);
  }
  await clickMutation(frame!.getByRole("button", { name: "Add to GitHub review", exact: true }), `/api/activities/${activityId}/github`);
  const second = await api("/api/edits", { path, side: "new", line: 7, endLine: 7, expectedContent: "  percentage: number;", replacement: "" });
  await page.reload(); await ready();
  await clickMutation(frame!.getByRole("button", { name: "Add to GitHub review", exact: true }), `/api/activities/${second.activityId}/github`);
  const queued = await api("/api/session");
  const firstComment = queued.comments.find((comment: any) => comment.suggestion?.activityId === activityId);
  const secondComment = queued.comments.find((comment: any) => comment.suggestion?.activityId === second.activityId);
  const selection = page.locator(`#comment-list [data-comment-id="${secondComment.id}"]`).getByRole("checkbox", { name: "Include in GitHub review" });
  assert.equal(await selection.isChecked(), true);
  await clickMutation(selection, `/api/comments/${secondComment.id}/github`);
  await page.reload(); await ready();
  await frame!.getByRole("button", { name: "Submit suggestions", exact: true }).first().click();
  const confirmation = page.locator("#github-review-confirmation-dialog");
  await confirmation.waitFor();
  assert.equal(await page.locator("#github-review-confirmation-local-only-option").isVisible(), false, "Neutral submission must hide the local approval option");
  assert.match(await confirmation.textContent() ?? "", /neutral GitHub comment review/);
  assert.match(await page.locator("#github-review-confirmation-comments").textContent() ?? "", /1 selected inline comment, including 1 GitHub suggestion/);
  assert.equal(await page.locator("#github-review-confirmation-revision").textContent(), head.slice(0, 8));
  await page.screenshot({ path: "/tmp/diffcompass-suggestions-confirmation.png" });
  await page.evaluate(() => (window as any).reviewTourTheme.set("dark"));
  await page.screenshot({ path: "/tmp/diffcompass-suggestions-confirmation-dark.png" });
  await page.locator("#cancel-github-review-confirmation").click();
  assert.deepEqual(await payloads(), []);
  await frame!.getByRole("button", { name: "Submit suggestions", exact: true }).first().click();
  await clickMutation(page.getByRole("button", { name: "Publish suggestions", exact: true }), "/api/github/suggestions");
  const published = await api("/api/session");
  assert.equal(published.status, "open");
  assert.equal(published.comments.find((c: any) => !c.suggestion).publishToGitHub, true);
  assert.equal(published.comments.find((c: any) => c.id === firstComment.id).githubPublished, true);
  assert.equal(published.comments.find((c: any) => c.id === secondComment.id).githubPublished, false);
  assert.equal(await readFile(join(repository, path), "utf8"), original);
  const sent = await payloads();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].event, "COMMENT");
  assert.equal(sent[0].commit_id, head);
  assert.deepEqual(sent[0].comments, [{ path, line: 17, side: "RIGHT", start_line: 16, start_side: "RIGHT", body: `\`\`\`\`suggestion\n${replacement}\n\`\`\`\`` }]);
  await api("/api/github/suggestions", { headOid: head, commentIds: [firstComment.id], confirm: true });
  assert.equal((await payloads()).length, 1, "Retry must reuse the receipt");
  console.log("PASS neutral confirmation: selected multiline suggestion only, backtick fence, unchanged source, retained ordinary draft, open tour and idempotent retry");
  await page.reload(); await ready();
  await frame!.getByText("Published in the GitHub review.", { exact: true }).waitFor();
  assert.equal(await frame!.getByRole("button", { name: "Return to local", exact: true }).count(), 1);
  await page.locator("#diff-renderer").selectOption("current");
  await page.locator(".inline-comment").getByText("Published in the GitHub review.", { exact: true }).waitFor();
  assert.equal(await selection.isChecked(), false);
  await clickMutation(selection, `/api/comments/${secondComment.id}/github`);
  await page.reload();
  await page.locator('.inline-comment [data-inline-comment-action="submit-suggestions"]').click();
  await clickMutation(page.getByRole("button", { name: "Publish suggestions", exact: true }), "/api/github/suggestions");
  assert.equal((await payloads()).length, 2);
  assert.deepEqual((await payloads())[1].comments, [{ path, line: 7, side: "RIGHT", body: "```suggestion\n\n```" }]);
  assert.equal((await api("/api/session")).status, "open");
  assert.equal(await readFile(join(repository, path), "utf8"), original);
  assert.deepEqual(errors, []);
  console.log("PASS reload and legacy renderer: durable receipts, deletion in a second batch, unchanged source and no browser errors");
} finally {
  clearTimeout(startupTimeout);
  await browser?.close();
  fixture.kill();
  await fixture.exited;
}
