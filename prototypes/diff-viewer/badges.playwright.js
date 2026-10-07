async (page) => {
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  await page.reload();
  await page.waitForFunction(() => !!window.diffLab);
  await page.locator('#layout').selectOption('unified');
  const bubble = page.locator('.review-badge.conversation-badge[data-line="18"][data-side="new"]');
  await bubble.waitFor({ state: 'visible' });
  await bubble.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Selected-code conversations', exact: true }).waitFor();
  check((await page.locator('#activity-list').innerText()).includes('Why clamp the percentage?'), 'Bubble must open the anchored conversations');
  check((await page.locator('#activity-list').innerText()).includes('Fixture response'), 'Conversation replies must be shown');
  await page.locator('#close-activity').click();
  await page.getByRole('button', { name: 'P2 finding: Check rounding at the display boundary', exact: true }).click();
  await page.getByRole('heading', { name: 'Findings', exact: true }).waitFor();
  check((await page.locator('#activity-list').innerText()).includes('Check rounding at the display boundary'), 'Priority badge opens the correct finding');
  await page.locator('#close-activity').click();

  // Expanded intervals have an explicit, accessible per-interval collapse action.
  await page.locator('#expand').click();
  await page.getByRole('button', { name: '▴ Collapse unchanged lines 1–14', exact: true }).waitFor();
  await page.getByRole('button', { name: '▴ Collapse unchanged lines 23–100', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('[title="Double click to unfold"]')].some(e => e.textContent === '78 hidden lines'));
  check(!await page.locator('#editor').getByText('14 hidden lines', { exact: true }).count(), 'Collapsing the middle gap must not collapse the leading gap');
  // Monaco virtualizes its view zones; scrolling the outer file list cannot
  // reveal a control above the inner editor's current viewport.
  // Wait for re-collapse/zone anchoring before scrolling; its pending layout
  // otherwise moves the viewport again after a premature scroll-to-top.
  await page.evaluate(() => new Promise((resolve,reject) => {
    let previous="",stable=0;const deadline=performance.now()+4000;
    const sample=()=>{
      const next=JSON.stringify([diffLab.editors.new.getScrollTop(),diffLab.editors.new.getContentHeight(),...Array.from(document.querySelectorAll('#editor .context-collapse-zone'),n=>n.getBoundingClientRect().top)]);
      stable=next===previous?stable+1:0;previous=next;
      if(stable>=8)return resolve();if(performance.now()>deadline)return reject(Error('Context layout did not settle'));
      requestAnimationFrame(sample);
    };requestAnimationFrame(sample);
  }));
  await page.evaluate(() => diffLab.editors.new.setScrollTop(0));
  await page.getByRole('button', { name: '▴ Collapse unchanged lines 1–14', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('[title="Double click to unfold"]')].some(e => e.textContent === '14 hidden lines'));

  // A conversation and a finding can coexist on one source line.
  await page.locator('#finding').click();
  await page.locator('#ask').click();
  await page.getByRole('textbox', { name: 'Agent question' }).fill('Badge smoke test: why format to two places?');
  await page.getByRole('button', { name: 'Send question', exact: true }).click();
  await page.locator('#activity-panel').waitFor();
  await page.locator('#close-activity').click();
  for (const layout of ['unified', 'split']) {
    await page.locator('#layout').selectOption(layout);
    await page.evaluate(() => diffLab.reveal('new', 104));
    const badges = page.locator('.review-badge[data-line="104"][data-side="new"]');
    await page.waitForFunction(() => [...document.querySelectorAll('.review-badge[data-line="104"][data-side="new"]')].filter(e => !e.hidden).length === 2);
    const rects = await badges.evaluateAll(es => es.map(e => e.getBoundingClientRect().toJSON()));
    check(rects[0].right <= rects[1].left || rects[1].right <= rects[0].left, `Conversation/finding badges overlap in ${layout}`);
  }
  await page.locator('#file').selectOption('notes.txt');
  await page.waitForFunction(() => diffLab.file.path === 'notes.txt');
  check(await page.locator('#editor .review-badge').count() === 0, 'Badges must stay in their own file');
  await page.locator('#file').selectOption('checkout.ts');
  await page.locator('#layout').selectOption('unified');
  if (await page.locator('#collapse').isEnabled()) await page.locator('#collapse').click();
  await page.evaluate(() => diffLab.editors.new.setScrollTop(0));
  return { passed: true, keyboardBubble: true, priorityDetails: true, independentCollapse: true, coLocatedBadges: true, fileIsolation: true };
}
