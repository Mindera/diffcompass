async (page) => {
  const check=(ok,message)=>{if(!ok)throw Error(message);};
  await page.waitForFunction(()=>window.diffLab);
  const token=new URL(page.url()).hash.slice(7),body=`Before visibility ${Date.now()}`;
  const request=(path,data,method='POST')=>page.evaluate(async({path,data,method,token})=>{
    const response=await fetch(path,{method,headers:{'x-diffcompass-token':token,'content-type':'application/json'},body:JSON.stringify(data)});
    if(!response.ok)throw Error(await response.text());return response.json();
  },{path,data,method,token});
  const result=await request('/api/comments',{path:'checkout.ts',side:'old',line:18,body});
  const id=result.comments.find(comment=>comment.body===body).id;
  try {
    await page.evaluate(()=>diffLab.refresh());
    await page.locator('#file').selectOption('checkout.ts');
    for(const layout of ['unified','split']) {
      await page.locator('#layout').selectOption(layout);
      await page.evaluate(()=>diffLab.reveal('old',18));
      const selector=`[data-prototype-file="checkout.ts"] [data-comment-id="${id}"]`;
      await page.locator(selector).waitFor();
      await page.locator('#prototype-comments-toggle').click();
      check(await page.locator('[data-comment-id],[data-pr-thread-id]').count()===0,'All cards removed');
      await page.evaluate(()=>diffLab.reveal('old',18));
      await page.locator('[data-prototype-file="checkout.ts"] .review-comment-badge[data-side="old"][data-line="18"]').click();
      await page.locator(selector).waitFor();
      check((await page.locator(selector).innerText()).includes('Before · L18'),'Before identity retained after reveal');
      await page.waitForFunction(({selector,layout})=>{
        const card=document.querySelector(selector)?.getBoundingClientRect(),editor=diffLab.editors.old,column=editor.getDomNode().getBoundingClientRect();
        const row=[...document.querySelectorAll('#editor [data-review-old-line="18"]')].map(n=>n.getBoundingClientRect()).find(r=>r.width&&r.height);
        const p=editor.getScrolledVisiblePosition({lineNumber:18,column:1});
        return card?.height&&(layout==='unified'?row&&Math.abs(card.top-row.bottom)<3:Math.abs(card.left-column.left)<1&&card.top>=column.top+p.top+p.height);
      },{selector,layout});
      const geometry=await page.locator(selector).evaluate(node=>{
        const editor=diffLab.editors.old,unified=document.querySelector('#layout').value==='unified';
        const row=unified?[...document.querySelectorAll('#editor [data-review-old-line="18"]')].map(n=>n.getBoundingClientRect()).find(r=>r.width&&r.height):null;
        const p=editor.getScrolledVisiblePosition({lineNumber:18,column:1});
        const card=node.getBoundingClientRect(),column=editor.getDomNode().getBoundingClientRect();
        return {card:card.top,bottom:row?.bottom??column.top+p.top+p.height,inOriginalColumn:Math.abs(card.left-column.left)<1&&card.right<=column.right+1};
      });
      // Split may insert a native alignment spacer for the two replacement
      // lines. Unified must place the card directly after its deleted row.
      check(layout==='unified'?Math.abs(geometry.card-geometry.bottom)<3:geometry.inOriginalColumn&&geometry.card>=geometry.bottom,'Restored card belongs to the removed line: '+JSON.stringify(geometry));
    }
    // Another file's draft must protect the global toggle, too.
    await page.locator(`[data-comment-id="${id}"]`).getByRole('button',{name:'Edit',exact:true}).click();
    await page.locator(`[data-comment-id="${id}"] textarea`).fill('Unsubmitted removed-line draft');
    await page.locator('#file').selectOption('large.ts');
    check(await page.locator('#prototype-comments-toggle').isDisabled(),'Offscreen draft blocks global hiding');
    check(await page.evaluate(()=>diffLab.setCommentsVisible(false))===false,'Programmatic guard covers other files');
    await page.locator('#file').selectOption('checkout.ts');
    check(await page.locator(`[data-comment-id="${id}"] textarea`).inputValue()==='Unsubmitted removed-line draft','Draft unchanged');
    await page.locator(`[data-comment-id="${id}"]`).getByRole('button',{name:'Cancel',exact:true}).click();
    return ['removed-line hide/reveal in Unified and Split','exact Before placement','offscreen draft protection'];
  } finally {
    await request('/api/comments/'+id,{},'DELETE');
  }
}
