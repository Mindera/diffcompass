// Real pointer selections/actions in the disposable lab, plus precise DOM
// range construction for boundary cases. Never mutates the user's repository.
async (page) => {
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  const passed = [], created = [], prefix = `Unified Before ${Date.now()}`;
  await page.waitForFunction(() => !!window.diffLab);
  check(await page.locator('form.review-zone').count() === 0, 'Do not discard an existing draft');
  await page.locator('#layout').selectOption('unified');
  const anchor = () => page.evaluate(() => diffLab.anchor);
  // Pick DOM points by the real native model mapping, not the rendered quote.
  const positions = async (start, end = start, reverse = false) => page.evaluate(({start,end,reverse}) => {
    const find = p => {
      for (const zone of document.querySelectorAll('#editor .line-delete-selectable')) {
        const map = zone.diffCompassDeletedSource;
        const walker = document.createTreeWalker(zone, NodeFilter.SHOW_TEXT);
        for (let node; node = walker.nextNode();) for(let offset=0; offset<=node.length; offset++) {
          const value=map?.position(node,offset);
          if (value?.lineNumber===p[0] && value.column===p[1]) return {node,offset};
        }
      }
      throw new Error(`No rendered Before point ${p}`);
    };
    const a=find(start),b=find(end),s=document.getSelection();
    s.removeAllRanges(); s.setBaseAndExtent(reverse?b.node:a.node,reverse?b.offset:a.offset,reverse?a.node:b.node,reverse?a.offset:b.offset);
    document.dispatchEvent(new Event('selectionchange'));
  }, {start,end,reverse});
  const save = async (name, menu = false) => {
    if (menu) await page.getByRole('menuitem',{name:'Comment on selection',exact:true}).click();
    else await page.locator('#comment').click();
    await page.getByRole('textbox',{name:'Comment text',exact:true}).fill(`${prefix} ${name}`);
    await page.getByRole('button',{name:'Add comment',exact:true}).click();
    await page.waitForFunction(body=>diffLab.session.comments.some(c=>c.body===body),`${prefix} ${name}`);
    const c=await page.evaluate(body=>diffLab.session.comments.find(c=>c.body===body),`${prefix} ${name}`); created.push(c.id);return c;
  };
  const selectDomText = async (text, occurrence = 0, reverse = false) => page.evaluate(({text,occurrence,reverse}) => {
    const matches=[];
    for(const zone of document.querySelectorAll('#editor .line-delete-selectable')) {
      const walker=document.createTreeWalker(zone,NodeFilter.SHOW_TEXT);
      for(let node; node=walker.nextNode();) { const offset=node.data.indexOf(text);if(offset>=0)matches.push({node,offset}); }
    }
    const p=matches[occurrence]; if(!p)throw Error(`Missing DOM text ${text}`);
    document.getSelection().setBaseAndExtent(p.node,p.offset+(reverse?text.length:0),p.node,p.offset+(reverse?0:text.length));
    document.dispatchEvent(new Event('selectionchange'));
  },{text,occurrence,reverse});
  try {
    await page.evaluate(()=>diffLab.reveal('new',18));
    const deleted=page.locator('.modified-in-monaco-diff-editor .line-delete-selectable .view-line .char-delete').first();
    await deleted.click();
    const lineComment=await save('pointer line');
    check(lineComment.side==='old' && lineComment.line===18 && !lineComment.selectedText,'A real caret click creates a Before line comment, not a quote');
    await page.evaluate(()=>diffLab.editors.new.setScrollTop(0));
    await deleted.dblclick();
    check((await anchor())?.side==='old' && (await anchor()).line===18,'Real double click must select Before line 18');
    const quote=(await anchor()).selectedText;
    check(quote===await page.evaluate(()=>document.getSelection().toString()),'Pointer quote must equal the actual selected DOM word');
    await deleted.click({button:'right'});
    const c=await save('pointer quote',true);
    check(c.side==='old' && c.line===18 && c.selectedText===quote,'Menu comment must persist exact Before quotation');
    await page.locator(`[data-comment-id="${c.id}"] .review-quote pre`).waitFor();
    const beforeEdit=await anchor();
    await page.locator('#editor [data-comment-id]').filter({hasText:'Fixture comment: should we clamp'}).getByRole('button',{name:'Edit',exact:true}).click();
    await page.getByRole('textbox',{name:'Comment text',exact:true}).waitFor();
    check(JSON.stringify(await anchor())===JSON.stringify(beforeEdit),'Editing another comment must not overwrite the selected Before source');
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    passed.push('real pointer + right-click quote comment on removed line');
    // Focus transfer, including keyboard users, must not retain a Before anchor
    // after the visible After caret has moved.
    await page.evaluate(()=>diffLab.editors.new.focus());
    await page.keyboard.press('ArrowLeft');
    check((await anchor()).side==='new','After editor focus releases a saved Before selection');
    passed.push('keyboard focus transfers ownership back to After');

    await page.evaluate(()=>diffLab.reveal('new',18));
    await positions([18,10],[18,16]);
    await page.locator('#ask').click();
    await page.getByRole('textbox',{name:'Agent question'}).fill(`${prefix} question`);
    await page.getByRole('button',{name:'Send question',exact:true}).click();
    await page.waitForFunction(body=>diffLab.session.messages.some(m=>m.body===body),`${prefix} question`);
    const q=await page.evaluate(body=>diffLab.session.messages.find(m=>m.body===body),`${prefix} question`);
    check(q.anchor.side==='old' && q.anchor.line===18 && q.anchor.selectedText==='amount','Question must carry Before partial text');
    await page.locator('#close-activity').click(); passed.push('agent question preserves Before anchor and partial quote');

    await page.evaluate(()=>diffLab.reveal('new',18)); await positions([18,10],[18,16]);
    const scroll=await page.evaluate(()=>diffLab.editors.new.getScrollTop());
    await page.locator('#source').click();
    check((await page.locator('#source-title').textContent()).includes('Before'),'Source action must open Before');
    await page.waitForFunction(()=>document.querySelector('#source-editor').textContent.replaceAll('\u00a0',' ').includes('amount - discount'));
    await page.locator('#return').click();
    check((await anchor()).side==='old' && (await anchor()).selectedText==='amount','Return must preserve removed selection');
    check(await page.evaluate(()=>diffLab.editors.new.getScrollTop())===scroll,'Return must preserve scroll');
    await page.context().grantPermissions(['clipboard-read','clipboard-write']);
    await page.locator('#copy').click();
    check(await page.evaluate(async()=>await navigator.clipboard.readText()===diffLab.file.old),'Copy contents must use the full Before file, not the hidden original editor caret');
    const request=page.waitForRequest(r=>r.url().includes('/api/symbol-peek') && !r.url().includes('highlight'));
    await page.locator('#peek').click();
    const peek=await request;
    check(peek.postDataJSON().symbol === 'amount' && peek.postDataJSON().side === 'old', 'Find references retains the Before symbol and origin');
    passed.push('Before View source/return, full-file copy and Find references request');

    await page.evaluate(()=>diffLab.reveal('new',18));
    // Construct a genuinely mixed native selection, not two unrelated carets.
    await page.evaluate(()=>{
      const a=document.querySelector('#editor .line-delete-selectable .view-line span span').firstChild;
      const line=[...diffLab.editors.new.getDomNode().querySelectorAll('.view-lines>.view-line')].find(n=>n.textContent.includes('const'));
      const w=document.createTreeWalker(line,NodeFilter.SHOW_TEXT),b=w.nextNode();
      document.getSelection().setBaseAndExtent(a,0,b,Math.min(3,b.length));
      document.dispatchEvent(new Event('selectionchange'));
    });
    check(await anchor()===null,'Mixed Before/After selection must fail closed');
    await page.locator('#comment').click();
    check(await page.locator('form.review-zone').count()===0,'Mixed range must never open a composer with stale selection');
    passed.push('mixed Before/After selection rejected');
    await positions([18,1],[18,3]);
    check(await anchor()===null,'Whitespace-only quotes must not silently become full-line quotes');
    await page.locator('#comment').click();
    check(await page.locator('form.review-zone').count()===0,'Whitespace quote must fail clearly');
    check((await page.locator('#status').textContent()).includes('non-whitespace'),'Explain how to create a line comment instead');
    passed.push('whitespace-only quote rejected without changing source evidence');

    await page.locator('#file').selectOption('removed.ts');
    await page.waitForFunction(()=>diffLab.file.path==='removed.ts' && document.querySelector('#editor .line-delete-selectable')?.diffCompassDeletedSource);
    await selectDomText('café😀',1,true);
    check((await anchor()).line===6 && (await anchor()).selectedText==='café😀','Repeated Unicode text maps to second occurrence, with reverse selection');
    const repeated=await save('unicode repeated'); check(repeated.line===6 && repeated.side==='old','Deleted-file comment must use the actual repeated line');
    await positions([1,1],[3,2]);
    const multi=await save('multiline CRLF');
    check(multi.endLine===3 && multi.selectedText==='export function legacyDiscount(value: number): number {\r\n\treturn value - 10;\r\n}','Multiline quote keeps original tabs and CRLF');
    passed.push('deleted file, repeated Unicode, reverse drag range and CRLF multiline quote');

    await page.setViewportSize({width:1100,height:900});
    await page.locator('#focus-prototype').click();
    await page.locator('#wrap').check();
    await positions([7,1],[7,1]);
    const wrapped=await page.evaluate(()=>{
      const z=document.querySelector('#editor .line-delete-selectable');
      return [...z.querySelectorAll('.view-line')].filter(l=>{const w=document.createTreeWalker(l,NodeFilter.SHOW_TEXT),n=w.nextNode();return n&&z.diffCompassDeletedSource.position(n,0)?.lineNumber===7;}).length;
    });
    check(wrapped>1,'Test must actually wrap the removed source');
    await selectDomText('WRAPPED_TARGET');
    check((await anchor()).selectedText==='WRAPPED_TARGET','Wrapped display fragments map to original columns');
    await page.locator('#wrap').uncheck();
    const wrappedComment=await save('wrapped'); check(wrappedComment.line===7 && wrappedComment.selectedText==='WRAPPED_TARGET','Wrapping changes must preserve the saved original range');
    passed.push('wrapped fragment mapping and wrap-toggle range preservation');

    await positions([8,1],[8,35]);
    check((await anchor()).selectedText==='// last line without final newline','EOF without newline');
    await page.evaluate(()=>document.getSelection().removeAllRanges());
    const zone=page.locator('#editor .line-delete-selectable').first();
    await page.evaluate(()=>diffLab.editors.new.setScrollTop(0));
    await zone.waitFor({state:'visible'}); await zone.focus();
    await page.keyboard.press('Shift+F10');
    await page.getByRole('menu',{name:'Before code review actions'}).waitFor();
    await page.keyboard.press('Enter');
    await page.getByRole('textbox',{name:'Comment text',exact:true}).waitFor();
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    passed.push('EOF and keyboard-accessible removed-block menu');
    await page.locator('#layout').selectOption('split');
    await page.evaluate(()=>diffLab.reveal('old',2));
    const splitCRLF=await save('Split CRLF');
    check(splitCRLF.side==='old' && splitCRLF.line===2 && splitCRLF.context==='\treturn value - 10;\r','Split must preserve the same exact CRLF evidence as Unified');
    passed.push('Split CRLF review uses the same unchanged server validation');
    await page.locator('#file').selectOption('notes.txt');
    check((await anchor())?.path!=='removed.ts','File switch clears cached removed anchors');
    await page.locator('#layout').selectOption('split');
    await page.evaluate(()=>diffLab.reveal('old',2)); check((await anchor()).side==='old','Split selection still works');
    passed.push('file/layout reset and Split regression');
    return {passed:true,checks:passed};
  } finally {
    await page.evaluate(async ids=>{
      const token=new URLSearchParams(location.hash.slice(1)).get('token');
      for(const id of ids)await fetch(`/api/comments/${id}`,{method:'DELETE',headers:{'x-diffcompass-token':token}});
    },created);
  }
}
