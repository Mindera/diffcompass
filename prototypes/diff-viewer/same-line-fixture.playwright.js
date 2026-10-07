async (page) => {
  const check=(ok,message)=>{if(!ok)throw Error(message);};
  await page.waitForFunction(()=>window.diffLab);
  const seed=await page.evaluate(()=>diffLab.session.comments.find(c=>c.path==='checkout.ts'&&c.side==='new'&&c.line===18&&c.body.startsWith('Same-line fixture:')));
  check(seed,'The saved fixture must include the requested same-line comment');
  const checks=[];
  for(const width of [1920,1100]) {
    await page.setViewportSize({width,height:1000});
    for(const layout of ['unified','split']) {
      await page.locator('#file').selectOption('checkout.ts');
      await page.locator('#layout').selectOption(layout);
      await page.waitForFunction(layout=>Array.from(document.querySelector('#current').contentDocument.querySelectorAll('[data-path="checkout.ts"] .hunk')).every(h=>h.classList.contains(layout+'-layout')),layout);
      await page.evaluate(()=>diffLab.reveal('new',18));
      const dot=page.locator('#editor .review-comment-badge[data-side="new"][data-line="18"]');
      const bubble=page.locator('#editor .conversation-badge[data-side="new"][data-line="18"]');
      await dot.waitFor({state:'visible'});await bubble.waitFor({state:'visible'});
      await page.waitForFunction(()=>{
        const a=document.querySelector('#editor .review-comment-badge[data-side="new"][data-line="18"]').getBoundingClientRect();
        const b=document.querySelector('#editor .conversation-badge[data-side="new"][data-line="18"]').getBoundingClientRect();
        return a.width>0&&b.width>0&&a.right<=b.left-1&&Math.abs(a.top-b.top)<2;
      });
      const geometry=await page.evaluate(()=>{
        const badges=[...document.querySelectorAll('#editor .review-badge[data-side="new"][data-line="18"]')].map(n=>n.getBoundingClientRect());
        const editor=diffLab.editors.new,dom=editor.getDomNode(),layout=editor.getLayoutInfo(),bounds=dom.getBoundingClientRect();
        const numbers=[...document.querySelectorAll('#editor .line-numbers')].filter(n=>n.textContent.trim()==='18'&&n.getBoundingClientRect().width).map(n=>n.getBoundingClientRect());
        return {badges:badges.map(r=>({left:r.left,right:r.right,top:r.top})),numberRight:Math.max(...numbers.map(r=>r.right)),codeLeft:bounds.left+layout.contentLeft};
      });
      check(geometry.badges.every(r=>r.left>=geometry.numberRight+7),'Both markers clear the line-number columns: '+JSON.stringify(geometry));
      check(geometry.badges.every(r=>r.right<=geometry.codeLeft),'Both markers stay before the code');
      await dot.click();await page.locator('[data-comment-id="'+seed.id+'"]').waitFor({state:'visible'});
      await bubble.click();check((await page.locator('#activity-list').textContent()).includes('Why clamp the percentage?'),'Bubble opens its own questions');
      await page.locator('#close-activity').click();
      checks.push(width+'/'+layout+': separate comment/question targets without overlap');
    }
  }
  await page.setViewportSize({width:1920,height:1080});
  await page.locator('#layout').selectOption('unified');await page.evaluate(()=>diffLab.reveal('new',18));
  await page.waitForFunction(()=>Array.from(document.querySelector('#current').contentDocument.querySelectorAll('[data-path="checkout.ts"] .hunk')).every(h=>h.classList.contains('unified-layout')));
  await page.screenshot({path:'/tmp/dc-same-line-fixture.png'});
  return {passed:true,checks};
}
