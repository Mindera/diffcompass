async (page) => {
  const check=(ok,message)=>{if(!ok)throw Error(message);};
  const settle=()=>page.evaluate(()=>new Promise((resolve,reject)=>{
    let previous='',stable=0;const deadline=performance.now()+4000;
    const sample=()=>{
      const value=JSON.stringify([diffLab.editors.new.getScrollTop(),...[...document.querySelectorAll('.review-pr-thread,.line-delete-selectable')].map(n=>{const r=n.getBoundingClientRect();return [r.top,r.bottom,r.width];})]);
      stable=value===previous?stable+1:0;previous=value;
      if(stable>=10)return resolve();if(performance.now()>deadline)return reject(Error('PR layout did not settle'));
      requestAnimationFrame(sample);
    };requestAnimationFrame(sample);
  }));
  await page.waitForFunction(()=>window.diffLab && document.querySelectorAll('.review-pr-thread').length===3);
  const threads=await page.evaluate(()=>diffLab.session.pullRequest.threads);
  check(threads.length===3,'Three synthetic PR examples');
  check(await page.locator('.notice').textContent().then(s=>s.includes('Synthetic pull request')),'Clearly label synthetic data');
  const current=page.frameLocator('#current');
  await current.locator('.github-thread-inline').first().waitFor({state:'attached'});
  const checks=[];
  for(const layout of ['unified','split']){
    await page.locator('#layout').selectOption(layout);
    await page.waitForFunction(()=>document.querySelectorAll('.review-pr-thread').length===3);
    for(const thread of threads){
      const sample=page.locator(`[data-pr-thread-id="${thread.id}"]`),original=current.locator(`[data-github-thread-inline="${thread.id}"]`);
      await original.waitFor({state:'attached'});
      await page.evaluate(thread=>diffLab.reveal(thread.side,thread.line),thread);
      await sample.waitFor({state:'visible'});
      const expected=thread.resolved?'Resolved':'Open';
      check((await sample.getAttribute('aria-label')).includes(expected),'Thread state is textual');
      check(await sample.getByRole('button',{name:'Reply in GitHub',exact:true}).isDisabled(),'Synthetic reply action is disabled');
      check(await sample.getByRole('button',{name:/Edit|Delete|Resolve/}).count()===0,'Imported threads are never editable local comments');
      for(const message of thread.comments){
        check((await sample.textContent()).includes(message.author)&&(await sample.textContent()).includes(message.body),'Prototype shows author and reply body');
        check((await original.textContent()).includes(message.author)&&(await original.textContent()).includes(message.body),'Current renderer shows the same thread');
      }
    }
    check(await page.locator('#editor [data-comment-id]').count()===await page.evaluate(()=>diffLab.session.comments.filter(c=>c.path==='checkout.ts').length),'Local comments remain separate');
    checks.push(layout+': matching authors/replies/states in both renderers; read-only threads and editable local comment');
  }
  await page.locator('#layout').selectOption('unified');
  await page.evaluate(()=>diffLab.reveal('new',18));
  await page.waitForFunction(()=>{
    const row=document.querySelector('.line-delete-selectable>[data-review-old-line="18"]');
    const card=document.querySelector('[data-pr-thread-id="fixture-pr-before"]');
    return row&&card&&Math.abs(card.getBoundingClientRect().top-row.getBoundingClientRect().bottom)<2;
  });
  checks.push('Before thread sits immediately below the removed row');
  await settle();await page.screenshot({path:'/tmp/dc-pr-example-dark.png'});
  await page.evaluate(()=>diffLab.reveal('new',104));
  await page.locator('[data-pr-thread-id="fixture-pr-resolved"]').waitFor({state:'visible'});
  await settle();await page.screenshot({path:'/tmp/dc-pr-example-resolved.png'});
  const placement=await page.evaluate(()=>{
    const before=document.querySelector('[data-pr-thread-id="fixture-pr-before"]'),after=document.querySelector('[data-pr-thread-id="fixture-pr-after"]');
    const row=document.querySelector('.line-delete-selectable>[data-review-old-line="18"]'),zone=row?.parentElement;
    return {hidden:before.hidden,before:before.getBoundingClientRect().toJSON(),after:after.getBoundingClientRect().toJSON(),row:row?.getBoundingClientRect().toJSON(),zone:zone?.getAttribute('style'),scroll:diffLab.editors.new.getScrollTop()};
  });
  check(placement.hidden||placement.before.bottom<=placement.after.top,`Before thread must not cover the later After thread when scrolling: ${JSON.stringify(placement)}`);
  await page.locator('#theme').click();
  await page.evaluate(()=>diffLab.reveal('new',18));
  await settle();await page.screenshot({path:'/tmp/dc-pr-example-light.png'});
  await page.locator('#theme').click();
  await page.setViewportSize({width:1000,height:900});
  await page.locator('#focus-prototype').click();
  await page.waitForFunction(()=>{
    const nodes=[...document.querySelectorAll('.review-pr-thread')].filter(n=>n.getBoundingClientRect().width);
    return nodes.length>0&&nodes.every(n=>n.scrollWidth<=n.clientWidth+1);
  });
  await settle();await page.screenshot({path:'/tmp/dc-pr-example-narrow.png'});
  checks.push('light/dark and narrow readable thread surfaces');
  const safety=await page.evaluate(async()=>{
    const headers={'x-diffcompass-token':new URLSearchParams(location.hash.slice(1)).get('token'),'content-type':'application/json'};
    return await Promise.all(['/api/github/review','/api/github/refresh'].map(async path=>(await fetch(path,{method:'POST',headers,body:'{}'})).status));
  });
  check(safety.every(status=>status===403),'External refresh/publication remains blocked by fixture server');
  await page.reload();await page.waitForFunction(()=>window.diffLab&&document.querySelectorAll('.review-pr-thread').length===3);
  check(await page.evaluate(()=>diffLab.session.pullRequest.threads.every(t=>t.comments.every(c=>!diffLab.session.comments.some(local=>local.id===c.id)))),'Remote and local identities are separate');
  await page.locator('#file').selectOption('notes.txt');await page.waitForFunction(()=>diffLab.file.path==='notes.txt'&&!document.querySelector('#editor .review-pr-thread'));
  await page.locator('#file').selectOption('checkout.ts');await page.waitForFunction(()=>document.querySelectorAll('.review-pr-thread').length===3);
  checks.push('reload, file switching, separate identities and blocked external operations');
  return {passed:true,checks};
}
