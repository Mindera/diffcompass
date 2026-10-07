async (page) => {
  const check = (ok, message) => { if (!ok) throw Error(message); };
  await page.waitForFunction(() => window.diffLab);
  check(await page.locator('form.review-zone').count()===0,'Never discard an existing draft');
  const created=[],checks=[],prefix=`Editing ${Date.now()}`;
  const request=(path,body,method='POST')=>page.evaluate(async({path,body,method})=>{
    const r=await fetch(path,{method,headers:{'content-type':'application/json','x-diffcompass-token':new URLSearchParams(location.hash.slice(1)).get('token')},body:JSON.stringify(body)});
    if(!r.ok)throw Error(await r.text());await diffLab.refresh();
  },{path,body,method});
  try {
    await page.locator('#file').selectOption('checkout.ts');
    for(const side of ['old','new']){
      await request('/api/comments',{path:'checkout.ts',side,line:side==='old'?18:19,body:`${prefix} ${side}`});
      created.push(await page.evaluate(body=>diffLab.session.comments.find(c=>c.body===body).id,`${prefix} ${side}`));
    }
    for(const layout of ['unified','split']){
      await page.locator('#layout').selectOption(layout);
      for(const [i,side] of ['old','new'].entries()){
        const id=created[i],text=`${prefix} ${side}`,card=page.locator(`#editor [data-comment-id="${id}"]`);
        await page.evaluate(()=>diffLab.reveal('new',18));
        await card.getByRole('button',{name:'Edit',exact:true}).click();
        const form=card.locator('form');
        check(await form.count()===1,'Editing must replace the saved card, not append another zone');
        check(await card.locator('.review-comment-body').count()===0,'Hide the saved body while editing it');
        check(await form.getByRole('heading',{name:new RegExp('^Editing line comment')}).count()===1,'Explicit editing heading');
        check(await form.getByText('Changes are not saved until you select Save changes.',{exact:true}).count()===1,'Explain unsaved state');
        await form.getByRole('textbox',{name:'Comment text',exact:true}).fill(text+' unsaved');
        await page.evaluate(()=>diffLab.refresh());
        check(await form.getByRole('textbox').inputValue()===text+' unsaved','Refresh preserves edit draft');
        check(await page.evaluate(id=>diffLab.session.comments.find(c=>c.id===id).body,id)===text,'Typing never updates the saved body');
        await form.getByRole('button',{name:'Cancel',exact:true}).click();
        check(await card.locator('.review-comment-body').textContent()===text,'Cancel restores the original comment');
        check(await card.locator('form').count()===0,'Cancel removes edit state');
        await card.getByRole('button',{name:'Edit',exact:true}).click();
        await form.getByRole('textbox').fill(text+' saved');
        await form.getByRole('button',{name:'Save changes',exact:true}).click();
        await page.waitForFunction(({id,body})=>diffLab.session.comments.find(c=>c.id===id)?.body===body,{id,body:text+' saved'});
        await page.waitForFunction(()=>!document.querySelector('form.review-zone'));
        check(await card.locator('.review-comment-body').textContent()===text+' saved','Save updates the same card');
        await request('/api/comments/'+id,{body:text},'PATCH');
        checks.push(`${layout}/${side}: in-place edit, explicit state, refresh, cancel and save`);
      }
    }
    const id=created[1],card=page.locator(`#editor [data-comment-id="${id}"]`);
    await card.getByRole('button',{name:'Edit',exact:true}).click();
    await card.getByRole('textbox').fill(prefix+' retry');
    const route='**/api/comments/'+id;
    await page.route(route,r=>r.request().method()==='PATCH'?r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Fixture save failure'})}):r.continue());
    await card.getByRole('button',{name:'Save changes',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Fixture save failure'));
    check(await card.getByRole('textbox').inputValue()===prefix+' retry','Failed save keeps edit draft');
    check(await card.getByRole('button',{name:'Save changes',exact:true}).isEnabled(),'Failed save allows retry');
    await page.unroute(route);
    await card.getByRole('button',{name:'Save changes',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('form.review-zone'));
    checks.push('failed save retains draft and supports retry');
    return {passed:true,checks};
  } finally {
    await page.unrouteAll({behavior:'wait'});
    const cancel=page.locator('form.review-zone').getByRole('button',{name:'Cancel',exact:true,includeHidden:true});
    if(await cancel.count())await cancel.evaluate(b=>b.click());
    for(const id of created)await request('/api/comments/'+id,{},'DELETE');
  }
}
