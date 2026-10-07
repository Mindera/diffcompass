// Run against the disposable lab. Removes only comments created by this check.
async (page) => {
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  await page.waitForFunction(() => !!window.diffLab);
  check(await page.locator('form.review-zone').count() === 0, 'Do not discard a user draft');
  const prefix = `Quote smoke ${Date.now()}`;
  const created = [];
  let stage = 'start';
  const save = async (suffix) => {
    stage = `compose ${suffix}`;
    await page.locator('#comment').click();
    await page.getByRole('textbox', { name: 'Comment text', exact: true }).fill(`${prefix} ${suffix}`);
    await page.getByRole('button', { name: 'Add comment', exact: true }).click();
    stage = `save ${suffix}`;
    await page.waitForFunction(body => diffLab.session.comments.some(c => c.body === body), `${prefix} ${suffix}`);
    const entry = await page.evaluate(body => diffLab.session.comments.find(c => c.body === body), `${prefix} ${suffix}`);
    created.push(entry.id); return entry;
  };
  try {
    await page.locator('#layout').selectOption('unified');
    await page.evaluate(() => { diffLab.reveal('new', 103); diffLab.editors.new.setSelection(new monaco.Range(103, 9, 103, 23)); });
    const partial = await save('partial');
    check(partial.selectedText === 'amount = total', 'Persist exact partial quote, not the whole line');
    const card = page.locator(`[data-comment-id="${partial.id}"]`);
    await card.getByText('Quote comment · After · L103', { exact: true }).waitFor();
    check(await card.locator('.review-quote pre').textContent() === partial.selectedText, 'Show the saved quote verbatim');
    await card.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('textbox', { name: 'Comment text', exact: true }).fill(`${prefix} edited`);
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.waitForFunction(id => diffLab.session.comments.find(c => c.id === id)?.body.endsWith('edited'), partial.id);
    check(await card.locator('.review-quote pre').textContent() === partial.selectedText, 'Editing body must retain the quote');
    await page.locator('#activity').click();
    check(await page.locator('.activity-entry').filter({ hasText: `${prefix} edited` }).locator('.review-quote pre').textContent() === partial.selectedText, 'Activity also shows the quote');
    await page.locator('#close-activity').click();
    await page.evaluate(() => { const e = diffLab.editors.new; e.setPosition({ lineNumber: 104, column: 5 }); e.focus(); });
    const line = await save('line');
    check(!line.selectedText && (line.scope || 'line') === 'line', 'A caret comment is not an explicit quotation');
    check(await page.locator(`[data-comment-id="${line.id}"] .review-quote`).count() === 0, 'No quote block on an ordinary line comment');
    await page.locator('#layout').selectOption('split');
    await page.locator('#expand').click();
    await page.evaluate(() => diffLab.reveal('old', 15, 21));
    const multi = await save('multiline');
    stage = 'multiline card';
    const multiCard = page.locator(`[data-comment-id="${multi.id}"]`);
    check(await multiCard.locator('.review-quote pre').textContent() === multi.selectedText, 'No truncation of multiline quotes');
    await multiCard.getByText('Quoted code · 7 lines', { exact: true }).waitFor();
    await page.waitForFunction(id => { const n = document.querySelector(`[data-comment-id="${id}"]`); return n && n.clientHeight >= n.scrollHeight - 1; }, multi.id);
    check(await multiCard.locator('.review-quote pre').evaluate(n => n.clientHeight <= 145 && getComputedStyle(n).overflowY === 'auto'), 'Multiline quotations are bounded and scrollable when necessary');
    await page.locator('#theme').click();
    check(await multiCard.locator('.review-quote pre').textContent() === multi.selectedText, 'Theme changes preserve quote text');
    await page.locator('#theme').click();
    return { passed: true, exactPartialQuote: true, editPreservesQuote: true, activityQuote: true, lineVsQuote: true, multilineBeforeSide: true, boundedScrollableQuote: true };
  } catch (error) {
    throw new Error(`${stage}: ${error.message}; status: ${await page.locator('#status').innerText()}; cards: ${JSON.stringify(await page.locator('[data-comment-id]').evaluateAll(nodes => nodes.map(n => ({ id: n.dataset.commentId, client: n.clientHeight, scroll: n.scrollHeight }))))}`);
  } finally {
    // A failed visibility check may leave our empty test composer inside a gap.
    const cancel = page.locator('form.review-zone').getByRole('button', { name: 'Cancel', exact: true, includeHidden: true });
    if (await cancel.count()) {
      const value = await page.locator('form.review-zone textarea').inputValue();
      if (value === '' || value.startsWith(prefix)) await cancel.evaluate(n => n.click());
    }
    await page.evaluate(async ids => {
      const token = new URLSearchParams(location.hash.slice(1)).get('token');
      for (const id of ids) {
        const response = await fetch(`/api/comments/${id}`, { method: 'DELETE', headers: { 'x-diffcompass-token': token } });
        if (!response.ok) throw new Error(`Could not clean up test comment ${id}`);
      }
      await diffLab.refresh();
    }, created);
    await page.locator('#layout').selectOption('unified');
    await page.evaluate(() => diffLab.reveal('new', 103));
  }
}
