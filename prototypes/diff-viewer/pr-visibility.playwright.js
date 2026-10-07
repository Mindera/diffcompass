async (page) => {
  const check=(ok,message)=>{if(!ok)throw Error(message);};
  await page.waitForFunction(()=>window.diffLab);
  await page.locator('#file').selectOption('checkout.ts');
  const thread=await page.evaluate(()=>diffLab.session.pullRequest.threads.find(thread=>thread.path==='checkout.ts'&&!diffLab.session.comments.some(c=>c.path===thread.path&&c.side===thread.side&&c.line===thread.line)));
  check(Boolean(thread),'Fixture has a PR-only row');
  const revision=await page.evaluate(()=>diffLab.session.revision);
  await page.locator('#prototype-comments-toggle').click();
  check(await page.locator('[data-pr-thread-id]').count()===0,'PR cards hidden');
  await page.evaluate(thread=>diffLab.reveal(thread.side,thread.line),thread);
  await page.locator(`[data-prototype-file="checkout.ts"] .review-pr-badge[data-side="${thread.side}"][data-line="${thread.line}"]`).click();
  await page.locator(`[data-pr-thread-id="${thread.id}"]`).waitFor();
  check(await page.evaluate(()=>diffLab.session.revision)===revision,'View-only interactions never change review state');
  return ['PR-only gutter marker restores thread','no review mutations'];
}
