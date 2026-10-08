async (page) => {
  const check = (ok, message) => { if (!ok) throw Error(message); };
  await page.waitForFunction(() => window.diffLab && document.querySelectorAll('.review-pr-thread').length === 3);
  // The fixture may retain a user's reviewed flag: explicitly reopen the
  // target in this browser only, without changing persisted review status.
  await page.locator('#file').selectOption('checkout.ts');
  const settle = () => page.evaluate(() => new Promise((resolve, reject) => {
    let previous = '', stable = 0;
    const deadline = performance.now() + 5000;
    const sample = () => {
      const value = JSON.stringify(Object.values(diffLab.editors).map(e => [e.getScrollTop(), e.getScrollHeight(), e.getLayoutInfo().height, e.getTopForLineNumber(e.getModel().getLineCount())]));
      stable = value === previous ? stable + 1 : 0; previous = value;
      if (stable >= 12) return resolve();
      if (performance.now() > deadline) return reject(Error('Scroll layout did not settle'));
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));
  const geometry = () => page.evaluate(() => {
    const {old, new: current} = diffLab.editors;
    const number = (e, n) => [...e.getDomNode().querySelectorAll('.line-numbers')].find(el => el.textContent.trim() === String(n))?.getBoundingClientRect().top;
    return {
      scroll: [old.getScrollTop(), current.getScrollTop()],
      max: [old, current].map(e => e.getScrollHeight() - e.getLayoutInfo().height),
      pairs: [[104,105],[105,106],[106,107],[107,108],[108,109],[109,110]].map(([before, after]) => ({before, after, oldY: number(old,before), newY: number(current,after)})),
    };
  });
  const checks = [];
  for (const layout of ['unified', 'split']) {
    await page.locator('#layout').selectOption(layout);
    for (const wrap of [true, false]) {
      await page.locator('#wrap').setChecked(wrap);
      await settle();
      // Reach the common bottom first, then overscroll each side. The bug only
      // persists when the other editor is already clamped at its own limit.
      await page.evaluate(() => diffLab.editors.new.setScrollTop(1e6));
      await settle();
      for (const side of ['old', 'new']) {
        const point = await page.evaluate(side => {
          const e = diffLab.editors[side], r = e.getDomNode().getBoundingClientRect(), l = e.getLayoutInfo();
          return {x: r.left + l.lineNumbersLeft + Math.max(2, l.lineNumbersWidth / 2), y: r.top + l.height - 100};
        }, side);
        await page.mouse.move(point.x, point.y);
        await page.mouse.wheel(0, 5000);
        await settle();
        const g = await geometry();
        check(Math.abs(g.scroll[0] - g.scroll[1]) < 1, 'Bottom scroll limits drift after wheel over ' + side + ': ' + JSON.stringify(g));
        check(g.pairs.filter(p => p.oldY !== undefined && p.newY !== undefined).length >= 4, 'Bottom line numbers are visible');
        check(g.pairs.every(p => p.oldY === undefined || p.newY === undefined || Math.abs(p.oldY - p.newY) < 1), 'Before/After number rows align: ' + JSON.stringify(g));
      }
      checks.push(layout + '/' + (wrap ? 'wrap' : 'scroll') + ': wheel at bottom over both gutters');
    }
  }
  await page.locator('#layout').selectOption('unified');
  await page.locator('#wrap').setChecked(true);
  await page.locator('#focus-prototype').click();
  await page.setViewportSize({width:1100, height:800});
  await settle();
  await page.evaluate(() => {diffLab.editors.new.setScrollTop(1e6);});
  await settle();
  // Repeated bottom requests also exercise clamping after resizing/card reflow.
  for (let i=0; i<2; i++) {await page.evaluate(()=>diffLab.editors.old.setScrollTop(1e6));await settle();}
  const g = await geometry();
  check(Math.abs(g.scroll[0]-g.scroll[1])<1 && g.pairs.every(p=>p.oldY===undefined||p.newY===undefined||Math.abs(p.oldY-p.newY)<1), 'Expanded/narrow end rows align: '+JSON.stringify(g));
  await page.screenshot({path:'/tmp/dc-bottom-scroll-fixed.png'});
  checks.push('expanded/narrow: card reflow and repeated bottom clamping');
  return {passed:true,checks};
}
