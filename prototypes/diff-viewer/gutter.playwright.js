async (page) => {
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  // Separate tab: no draft or view-state changes in the user's comparison.
  const lab = await page.context().newPage();
  try {
    await lab.goto(page.url());
    await lab.waitForFunction(() => !!window.diffLab, undefined, { timeout: 7000 });
    for (const layout of ['unified', 'split']) {
      await lab.locator('#layout').selectOption(layout);
      await lab.evaluate(() => diffLab.reveal('new', 18));
      await lab.waitForFunction(() => {
        const signs = [...document.querySelectorAll('.review-diff-sign')].map(e => e.textContent);
        return signs.includes('+') && signs.includes('−');
      }, undefined, { timeout: 5000 });
      await lab.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const geometry = await lab.evaluate(() => {
        const signs = [...document.querySelectorAll('.review-diff-sign')];
        const root = document.querySelector('#editor').getBoundingClientRect();
        return signs.map(sign => {
          const side = document.querySelector('#layout').value === 'unified' ? 'old' : sign.dataset.side;
          const editor = diffLab.editors[side];
          const info = editor.getLayoutInfo();
          const bounds = editor.getDomNode().getBoundingClientRect();
          const rect = sign.getBoundingClientRect();
          const font = editor.getOption(monaco.editor.EditorOption.fontInfo);
          const digits = String(editor.getModel().getLineCount()).length;
          const numberLeft = bounds.left + info.lineNumbersLeft + info.lineNumbersWidth - digits * font.typicalHalfwidthCharacterWidth;
          const overlap = [...document.querySelectorAll('.review-badge:not([hidden])')].some(badge => {
            const b = badge.getBoundingClientRect();
            return rect.left < b.right && rect.right > b.left && rect.top < b.bottom && rect.bottom > b.top;
          });
          return { text: sign.textContent, side: sign.dataset.side, right: rect.right, numberLeft, overlap, inPane: rect.left >= root.left && rect.right <= root.right };
        });
      });
      check(geometry.some(g => g.text === '+') && geometry.some(g => g.text === '−'), `${layout}: both signs must render: ${JSON.stringify(geometry)}`);
      check(geometry.every(g => g.right + 3 <= g.numberLeft && !g.overlap && g.inPane), `${layout}: signs need their own space before numbers, separate from badges: ${JSON.stringify(geometry)}`);
    }
    await lab.locator('#theme').click();
    await lab.locator('#layout').selectOption('unified');
    await lab.locator('#wrap').uncheck();
    await lab.locator('#finding').click();
    await lab.getByRole('button', { name: 'P2 finding: Check rounding at the display boundary', exact: true }).click();
    await lab.getByRole('heading', { name: 'Findings', exact: true }).waitFor();
    await lab.locator('#close-activity').click();
    for (const [path, expected] of [['large.ts', null], ['added.ts', '+'], ['removed.ts', '−'], ['notes.txt', null]]) {
      await lab.locator('#file').selectOption(path);
      await lab.waitForFunction(path => diffLab.file.path === path && diffLab.editors.new.getModel()?.uri.path.endsWith('/' + path), path);
      if (path === 'large.ts') {
        await lab.waitForFunction(() => diffLab.diff.getLineChanges()?.some(change => change.modifiedEndLineNumber > 1000));
        await lab.evaluate(() => diffLab.reveal('new', diffLab.editors.new.getModel().getLineCount() - 6));
      }
      await lab.waitForFunction(expected => {
        const signs = [...document.querySelectorAll('.review-diff-sign')];
        // Monaco can also mark the opposite empty model's single blank line.
        return signs.length > 0 && (!expected || signs.some(e => e.textContent === expected));
      }, expected, { timeout: 5000 });
      await lab.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const gap = await lab.evaluate(() => {
        const editor = diffLab.editors.old;
        const { lineNumbersLeft, lineNumbersWidth } = editor.getLayoutInfo();
        const digits = String(editor.getModel().getLineCount()).length;
        const start = editor.getDomNode().getBoundingClientRect().left + lineNumbersLeft + lineNumbersWidth - digits * editor.getOption(monaco.editor.EditorOption.fontInfo).typicalHalfwidthCharacterWidth;
        return Math.min(...[...document.querySelectorAll('.review-diff-sign')].map(e => start - e.getBoundingClientRect().right));
      });
      check(Number.isFinite(gap) && gap >= 3, `${path}: sign must stay separate from line numbers`);
    }
    return { passed: true, unified: true, split: true, signsSeparatedFromNumbersAndBadges: true, priorityBadgeClickable: true, fourDigitNumbers: true, addedDeletedPlainText: true };
  } finally { await lab.close(); }
}
