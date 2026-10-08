async (page) => {
  const check = (ok, message) => { if (!ok) throw Error(message); };
  const created = [], checks = [];
  await page.waitForFunction(() => window.diffLab);
  const request = async (path, body) => page.evaluate(async ({path,body}) => {
    const response = await fetch(path, {method:'POST',headers:{'content-type':'application/json','x-diffcompass-token':new URLSearchParams(location.hash.slice(1)).get('token')},body:JSON.stringify(body)});
    const result = await response.json(); if(!response.ok)throw Error(JSON.stringify(result)); await diffLab.refresh();return result;
  },{path,body});
  const comment = async (path,line,endLine,body,side='old') => {
    await request('/api/comments',{path,side,line,endLine,scope:endLine>line?'range':'line',body});
    const id=await page.evaluate(body=>diffLab.session.comments.find(c=>c.body===body).id,body);created.push(id);return id;
  };
  const settle = async () => page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  // Native zones are replaced asynchronously after wrapping/layout changes.
  // Wait for stable *measured* source/card geometry; never assert a transient
  // hidden old render or use our placement metadata as the expected position.
  const aligned = async (id,line,fragments) => {
    const deadline=Date.now()+12000;let stable=0,g;
    while(Date.now()<deadline) {
      g=await geometry(id,line);
      stable=g.source&&g.card.height>0&&Math.abs(g.card.top-g.source.bottom)<2&&(!fragments||fragments(g.fragments))?stable+1:0;
      if(stable>=3)return g;
      await settle();
    }
    throw Error(`Before card did not settle on its source: ${JSON.stringify(g)}`);
  };
  // Assert against actual rendered source rectangles, not the placement plan.
  const geometry = async (id,endLine) => page.evaluate(({id,endLine})=>{
    const rect=e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height};};
    const card=document.querySelector(`[data-comment-id="${id}"]`);
    const rows=[];
    for(const zone of document.querySelectorAll('#editor .line-delete-selectable'))for(const row of zone.querySelectorAll(':scope>.view-line')) {
      const walker=document.createTreeWalker(row,NodeFilter.SHOW_TEXT),node=walker.nextNode();
      if(node&&row.getBoundingClientRect().height&&zone.diffCompassDeletedSource?.position(node,0)?.lineNumber===endLine)rows.push(rect(row));
    }
    const badge=document.querySelector(`.review-comment-badge[data-side="old"][data-line="${card.textContent.includes('L1–3')?1:endLine}"]`);
    const root=rect(document.querySelector('#editor'));
    return {card:rect(card),source:rows.at(-1),fragments:rows.length,badge:badge?rect(badge):null,root};
  },{id,endLine});
  const prefix=`Before placement ${Date.now()}`;
  try {
    await page.locator('#file').selectOption('checkout.ts');await page.locator('#layout').selectOption('unified');
    const id=await comment('checkout.ts',18,18,`${prefix} line`);
    await page.evaluate(()=>diffLab.reveal('new',18));await page.locator(`[data-comment-id="${id}"].review-before-card`).waitFor();await settle();
    let g=await aligned(id,18);
    check(Math.abs(g.card.top-g.source.bottom)<2,'Before card must be immediately below its red row');
    check(Math.abs(g.card.right-g.root.right)<1,'Before card must reach the right edge without a red scrollbar-width strip');
    check(Math.abs(g.card.left-g.root.left)<1,'Before card includes the full Unified gutter');
    check(g.badge && Math.abs((g.badge.top+g.badge.bottom)/2-(g.source.top+g.source.bottom)/2)<2,'Before comment marker must align with the red row');
    const after=await page.evaluate(()=>diffLab.editors.new.getDomNode().getBoundingClientRect().top+diffLab.editors.new.getScrolledVisiblePosition({lineNumber:18,column:1}).top);
    check(after>=g.card.bottom,'Replacement After line must follow the Before comment');checks.push('Before card between deleted row and replacement; comment marker on exact row');
    const surfaces = async () => page.evaluate(id => {
      const background = node => getComputedStyle(node).backgroundColor;
      const afterId = diffLab.session.comments.find(c=>c.path==='checkout.ts'&&c.side==='new').id;
      return {
        before:background(document.querySelector(`[data-comment-id="${id}"]`)),
        after:background(document.querySelector(`[data-comment-id="${afterId}"]`)),
        code:background(diffLab.editors.new.getDomNode().querySelector('.monaco-editor-background')),
      };
    },id);
    for(const layout of ['unified','split']) {
      await page.locator('#layout').selectOption(layout);await settle();
      for(const theme of ['dark','light']) {
        if(theme==='light')await page.locator('#theme').click();
        const colours=await surfaces();
        check(colours.before===colours.after,`${layout}/${theme}: Before and After comments must share a surface`);
        check(colours.before!==colours.code&&colours.before!=='rgba(0, 0, 0, 0)',`${layout}/${theme}: comments must have a distinct opaque background from code`);
      }
      await page.locator('#theme').click();
    }
    await page.locator('#layout').selectOption('unified');await aligned(id,18);
    checks.push('distinct comment surface in both themes and both layouts');
    const old=await page.evaluate(()=>diffLab.file.old.split('\n')[17]);
    await request('/api/agent/message',{body:`${prefix} question`,stepId:null,selectedContext:'amount',anchor:{path:'checkout.ts',side:'old',line:18,endLine:18,content:old,context:old,selectedText:'amount'}});
    const oldBubble=page.locator('.conversation-badge[data-side="old"][data-line="18"]');await oldBubble.waitFor();await settle();
    const badges=await page.evaluate(()=>[...document.querySelectorAll('.review-unified-badge:not([hidden])')].map(e=>{const r=e.getBoundingClientRect();return {side:e.dataset.side,line:e.dataset.line,left:r.left,right:r.right,top:r.top,bottom:r.bottom};}));
    const gutter=await page.evaluate(()=>{const e=diffLab.editors.new,i=e.getLayoutInfo(),left=e.getDomNode().getBoundingClientRect().left;return {numbersEnd:left+i.lineNumbersLeft+i.lineNumbersWidth,codeStart:left+i.contentLeft};});
    check(badges.every(b=>b.left>=gutter.numbersEnd+1&&b.right+2<=gutter.codeStart),'Every badge must sit after both number columns without overlapping code');
    const oldRect=await oldBubble.boundingBox(),newRect=await page.locator('.conversation-badge[data-side="new"][data-line="18"]').boundingBox();
    check(oldRect.y<newRect.y,'Before 18 and After 18 must have distinct badges on distinct source rows');
    await oldBubble.focus();await page.keyboard.press('Enter');await page.getByRole('heading',{name:'Selected-code conversations',exact:true}).waitFor();
    check((await page.locator('#activity-list').textContent()).includes(`${prefix} question`),'Before badge opens its own question');
    await page.locator('#close-activity').click();checks.push('question badge, keyboard activation and no line-number overlap');
    const second=await comment('checkout.ts',18,18,`${prefix} second`);await settle();
    const boxes=await page.locator('.review-before-card').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {top:r.top,bottom:r.bottom};}).sort((a,b)=>a.top-b.top));
    check(boxes.every((r,i)=>i===0||r.top>=boxes[i-1].bottom),'Multiple Before cards must stack, never overlap');
    check(await page.locator('.review-comment-badge[data-side="old"][data-line="18"]').count()===1,'Multiple comments share one marker rather than overlapping buttons');
    await page.locator(`[data-comment-id="${second}"]`).getByRole('button',{name:'Edit',exact:true}).click();
    await page.getByRole('textbox',{name:'Comment text',exact:true}).fill(`${prefix} second edited\n${'More detail '.repeat(80)}`);
    await page.getByRole('button',{name:'Save changes',exact:true}).click();await settle();
    await page.locator('#layout').selectOption('split');await settle();check(await page.locator('.review-before-card').count()===0,'Split uses native original-editor cards');
    await page.locator('#layout').selectOption('unified');
    g=await aligned(id,18);check(Math.abs(g.card.top-g.source.bottom)<2,`Returning to Unified restores exact placement: ${JSON.stringify(g)}`);
    checks.push('multiple cards, edit/resize and Split/Unified return');
    await page.reload();await page.waitForFunction(()=>window.diffLab);await page.locator(`[data-comment-id="${id}"].review-before-card`).waitFor();await settle();
    g=await aligned(id,18);check(Math.abs(g.card.top-g.source.bottom)<2,'Persisted Before cards mount correctly after fresh diff computation');checks.push('persisted card placement on reload');
    await page.locator(`[data-comment-id="${id}"]`).getByRole('button',{name:'Edit',exact:true}).click();
    await page.getByRole('textbox',{name:'Comment text',exact:true}).fill('Draft');
    const focusStayed=await page.evaluate(async()=>{
      const input=document.querySelector('form.review-zone textarea');input.focus();
      for(let i=0;i<12;i++) {
        const wrap=i%2?'on':'off';diffLab.diff.updateOptions({wordWrap:wrap,diffWordWrap:wrap});
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        if(document.activeElement!==input)return false;
      }
      return true;
    });
    check(focusStayed,'Native deleted-zone replacement must not steal draft focus');
    await page.keyboard.insertText(' survives redraw');
    check(await page.getByRole('textbox',{name:'Comment text',exact:true}).inputValue()==='Draft survives redraw','Typing continues after native row replacement');
    await page.getByRole('button',{name:'Cancel',exact:true}).click();await aligned(id,18);
    const scrollBefore=await page.evaluate(()=>diffLab.editors.new.getScrollTop());
    await page.locator(`[data-comment-id="${id}"]`).hover();await page.mouse.wheel(0,40);
    await page.waitForFunction(before=>diffLab.editors.new.getScrollTop()>before,scrollBefore);
    g=await aligned(id,18);check(Math.abs(g.card.top-g.source.bottom)<2,'Scrolling over a Before card keeps it attached to its source');
    checks.push('draft focus/typing survives native redraw; wheel scrolling stays aligned');
    await page.locator('#file').selectOption('removed.ts');await page.waitForFunction(()=>diffLab.file.path==='removed.ts'&&diffLab.diff.getLineChanges()?.[0]?.originalEndLineNumber===8);
    const range=await comment('removed.ts',1,3,`${prefix} range`),wrapped=await comment('removed.ts',7,7,`${prefix} wrap`);
    await page.setViewportSize({width:1100,height:950});await page.locator('#focus-prototype').click();await page.locator('#wrap').check();await settle();
    await page.locator('.review-comment-badge[data-side="old"][data-line="1"]').click();await settle();
    g=await aligned(range,3);check(Math.abs(g.card.top-g.source.bottom)<2,'Range card follows its final Before row, before remaining deleted rows');
    await page.evaluate(()=>diffLab.reveal('old',7));
    g=await aligned(wrapped,7,n=>n>1);check(g.fragments>1,'Long deleted line must actually wrap');check(Math.abs(g.card.top-g.source.bottom)<2,'Wrapped card follows the last fragment, not the first');
    check(Math.abs(g.card.right-g.root.right)<1,'Before card must remain full width after viewport resize and wrapping');
    check(Math.abs(g.card.left-g.root.left)<1,'Wrapped Before card retains full gutter width');
    await page.locator('#wrap').uncheck();g=await aligned(wrapped,7,n=>n===1);check(g.fragments===1 && Math.abs(g.card.top-g.source.bottom)<2,'Unwrapping keeps card below its source');
    checks.push('entirely deleted file, multiline endpoint, wrapped fragments and wrap toggle');
    await page.screenshot({path:'/tmp/dc-before-placement-wrapped.png'});
    await page.locator('#file').selectOption('checkout.ts');await page.setViewportSize({width:1920,height:1080});await settle();
    await page.evaluate(()=>diffLab.reveal('new',18));
    await aligned(id,18);await page.screenshot({path:'/tmp/dc-before-placement-final.png'});
    // Three marker kinds must fit next to the same code, in either layout.
    await comment('checkout.ts',104,104,`${prefix} finding-line comment`,'new');
    const findingSource=await page.evaluate(()=>diffLab.file.new.split('\n')[103]);
    await request('/api/agent/message',{body:`${prefix} finding-line question`,stepId:null,selectedContext:'toFixed',anchor:{path:'checkout.ts',side:'new',line:104,endLine:104,content:findingSource,context:findingSource,selectedText:'toFixed'}});
    for(const layout of ['split','unified']) {
      await page.locator('#layout').selectOption(layout);await page.evaluate(()=>diffLab.reveal('new',104));
      await page.waitForFunction(()=>{
        const nodes=[...document.querySelectorAll('.review-badge[data-side="new"][data-line="104"]')];
        const rects=nodes.map(n=>n.getBoundingClientRect()).sort((a,b)=>a.left-b.left);
        const e=diffLab.editors.new,i=e.getLayoutInfo(),b=e.getDomNode().getBoundingClientRect();
        return rects.length===3&&rects.every((r,index)=>r.width&&(!index||r.left>=rects[index-1].right+1))&&rects[0].left>=b.left+i.lineNumbersLeft+i.lineNumbersWidth+1&&Math.abs(b.left+i.contentLeft-rects[2].right-4)<1;
      });
    }
    // An unchanged row has two source identities, not two overlapping dots.
    await comment('checkout.ts',104,104,`${prefix} unchanged Before`);
    await comment('checkout.ts',105,105,`${prefix} unchanged After`,'new');
    await page.evaluate(()=>diffLab.reveal('new',105));
    await page.waitForFunction(()=>{
      const a=document.querySelector('.review-comment-badge[data-side="old"][data-line="104"]')?.getBoundingClientRect();
      const b=document.querySelector('.review-comment-badge[data-side="new"][data-line="105"]')?.getBoundingClientRect();
      return a?.width&&b?.width&&Math.abs(a.top-b.top)<2&&(a.right+1<=b.left||b.right+1<=a.left);
    });
    checks.push('three marker kinds beside code in both layouts; distinct Before/After markers on shared unchanged row');
    await page.evaluate(()=>diffLab.reveal('new',18));await aligned(id,18);
    for(const removeId of [second,id]) {
      page.once('dialog',dialog=>dialog.accept());
      await page.locator(`[data-comment-id="${removeId}"]`).getByRole('button',{name:'Delete',exact:true}).click();
      await page.waitForFunction(id=>!diffLab.session.comments.some(c=>c.id===id),removeId);
      created.splice(created.indexOf(removeId),1);
    }
    await page.waitForFunction(()=>{
      const row=[...document.querySelectorAll('#editor .line-delete-selectable>[data-review-old-line="18"]')].find(row=>row.getBoundingClientRect().height);
      const editor=diffLab.editors.new,position=editor.getScrolledVisiblePosition({lineNumber:18,column:1});
      return !document.querySelector('#editor .review-before-card')&&row&&position&&Math.abs(row.getBoundingClientRect().bottom-editor.getDomNode().getBoundingClientRect().top-position.top)<2;
    });
    checks.push('deleting Before cards removes reserved spacing and leaves native replacement alignment');
    return {passed:true,checks};
  } finally {
    await page.evaluate(async ids=>{const token=new URLSearchParams(location.hash.slice(1)).get('token');for(const id of ids)await fetch(`/api/comments/${id}`,{method:'DELETE',headers:{'x-diffcompass-token':token}});},created);
  }
}
