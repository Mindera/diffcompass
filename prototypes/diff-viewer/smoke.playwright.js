// Function expression accepted by Playwright's browser_run_code_unsafe filename.
// Run against the URL printed by server.ts. It only changes disposable fixtures.
async (page) => {
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  await page.reload();
  await page.waitForFunction(() => !!window.diffLab);
  await page.locator('#layout').selectOption('unified');
  await page.locator('#collapse').click();
  const gapCounts = () => page.locator('[title="Double click to unfold"]').evaluateAll(es => es.map(e => parseInt(e.textContent, 10)));
  await page.waitForFunction(() => document.querySelectorAll('[title="Double click to unfold"]').length === 2);
  const beforeGaps = await gapCounts();
  await page.getByRole('button', { name: 'Click or drag to show more below', exact: true }).last().click();
  await page.waitForFunction(n => parseInt([...document.querySelectorAll('[title="Double click to unfold"]')].at(-1).textContent, 10) === n, beforeGaps.at(-1) - 10);
  const partialGaps = await gapCounts();
  check(partialGaps[0] === beforeGaps[0], 'Expanding one gap must leave the other gap alone');
  await page.locator('[title="Double click to unfold"]').last().dblclick();
  await page.locator('.fold-unchanged').waitFor();
  await page.locator('.fold-unchanged').click();
  await page.waitForFunction(() => document.querySelectorAll('[title="Double click to unfold"]').length === 2);
  check(JSON.stringify(await gapCounts()) === JSON.stringify(beforeGaps), 'Local re-collapse restores the gap');
  check(await page.getByRole('textbox', { name: 'Comment text' }).count() === 0, 'Native fold control must not open a review composer');

  await page.locator('#hidden').click();
  const viewBefore = await page.evaluate(() => ({ scroll: diffLab.editors.new.getScrollTop(), selection: diffLab.editors.new.getSelection() }));
  await page.locator('#source').click();
  await page.locator('#source-editor .codicon-folding-expanded[title]').first().waitFor();
  await page.locator('#source-editor .codicon-folding-expanded[title]').first().click();
  await page.locator('#source-editor .codicon-folding-collapsed').first().waitFor();
  await page.locator('#return').click();
  const viewAfter = await page.evaluate(() => ({ scroll: diffLab.editors.new.getScrollTop(), selection: diffLab.editors.new.getSelection() }));
  check(JSON.stringify(viewBefore) === JSON.stringify(viewAfter), 'View source must restore selection and scroll exactly');
  check(await page.evaluate(() => monaco.editor.getModels().length) === 2, 'Returning disposes the source model');

  // A deleted-row click must not reuse a stale after-side anchor.
  await page.locator('#collapse').click();
  await page.evaluate(() => diffLab.reveal('new', 18));
  await page.locator('.modified-in-monaco-diff-editor .line-delete-selectable .view-line .char-delete').first().dblclick();
  check(await page.evaluate(() => diffLab.anchor === null), 'Unified deleted selection must fail closed');

  const body = `Smoke comment ${Date.now()}`;
  await page.locator('#layout').selectOption('split');
  await page.waitForFunction(() => diffLab.editors.old.getLayoutInfo().width > 100);
  await page.evaluate(() => diffLab.reveal('old', 18));
  await page.locator('#comment').click();
  await page.getByRole('textbox', { name: 'Comment text', exact: true }).fill(body);
  await page.locator('#layout').selectOption('unified');
  check(await page.locator('#layout').inputValue() === 'split', 'Layout switching must preserve an open draft');
  check(await page.getByRole('textbox', { name: 'Comment text', exact: true }).inputValue() === body, 'Draft contents must remain intact');
  await page.getByRole('button', { name: 'Add comment', exact: true }).click();
  await page.waitForFunction(b => diffLab.session.comments.some(c => c.body === b && c.side === 'old' && c.line === 18), body);
  await page.frames()[1].locator('.diff-file:visible').getByText(body, { exact: true }).waitFor();
  const note = page.locator('.review-zone').filter({ has: page.getByText(body, { exact: true }) });
  await note.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('textbox', { name: 'Comment text', exact: true }).fill(`${body} edited`);
  await page.getByRole('button', { name: 'Save comment', exact: true }).click();
  await page.waitForFunction(b => diffLab.session.comments.some(c => c.body === `${b} edited`), body);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('.review-zone').filter({ has: page.getByText(`${body} edited`, { exact: true }) }).getByRole('button', { name: 'Delete', exact: true }).click();
  await page.waitForFunction(b => !diffLab.session.comments.some(c => c.body.startsWith(b)), body);

  await page.locator('#layout').selectOption('unified');
  await page.evaluate(() => diffLab.reveal('new', 18, 19));
  await page.locator('#ask').click();
  await page.getByRole('textbox', { name: 'Agent question', exact: true }).fill('Why clamp the percentage? (comparison smoke test)');
  const previousMessages = await page.evaluate(() => diffLab.session.messages.length);
  await page.getByRole('button', { name: 'Send question', exact: true }).click();
  await page.waitForFunction(n => diffLab.session.messages.length >= n + 2, previousMessages);
  const messages = await page.evaluate(() => diffLab.session.messages.slice(-2));
  check(messages[0].anchor.side === 'new' && messages[0].anchor.line === 18 && messages[0].anchor.endLine === 19, 'Question must preserve its source range');
  check(messages[1].role === 'agent' && messages[1].body.startsWith('Fixture responder'), 'Reply must be explicitly synthetic');
  await page.locator('#close-activity').click();

  const cases = [];
  for (const path of ['added.ts', 'removed.ts', 'notes.txt', 'large.ts', 'checkout.ts']) {
    await page.locator('#file').selectOption(path);
    await page.waitForFunction(p => diffLab.file.path === p && diffLab.diff.getLineChanges() !== null, path);
    await page.frames()[1].locator(`.diff-file[data-path="${path}"]:visible`).waitFor();
    cases.push(await page.evaluate(() => ({ path: diffLab.file.path, models: monaco.editor.getModels().length, before: diffLab.editors.old.getModel().getLineCount(), after: diffLab.editors.new.getModel().getLineCount() })));
    check(cases.at(-1).models === 2, `Model leak after ${path}`);
  }
  await page.locator('#theme').click();
  check(await page.evaluate(() => document.documentElement.hasAttribute('data-light') && document.querySelector('#current').contentDocument.documentElement.dataset.theme === 'light'), 'Themes should change together');
  await page.locator('#theme').click();
  await page.locator('#wrap').uncheck();
  await page.locator('#wrap').check();
  await page.locator('#finding').click();
  check(await page.evaluate(() => diffLab.anchor.line === 104), 'Finding reveals the actual changed line');
  const immutable = await page.evaluate(() => {
    const before = diffLab.editors.new.getValue();
    diffLab.editors.new.trigger('smoke', 'type', { text: 'MUST NOT EDIT' });
    return diffLab.editors.new.getValue() === before;
  });
  check(immutable, 'The prototype must be read-only');
  await page.locator('#collapse').click();
  await page.evaluate(() => { diffLab.editors.new.setScrollTop(0); document.querySelector('#current').contentWindow.diffLabCurrent.show('checkout.ts'); });
  const result = { passed: true, gapExpansion: { before: beforeGaps, after: partialGaps }, exactSourceReturn: true, commentCreateEditDelete: true, questionRange: messages[0].anchor, cases, readOnly: true };
  // A browser tool may yield at the auto-accepted delete confirmation. Retain
  // the result so the caller can retrieve it when the function finishes.
  await page.evaluate(result => { window.diffLabSmokeResult = result; }, result);
  return result;
}
