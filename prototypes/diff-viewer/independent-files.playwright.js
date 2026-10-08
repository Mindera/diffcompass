async (page) => {
  const check=(ok,message)=>{if(!ok)throw Error(message);};
  await page.waitForFunction(()=>window.diffLab);
  const initial=await page.evaluate(()=>diffLab.session.reviewedFiles||[]);
  const set=async(path,reviewed)=>page.evaluate(async ({path,reviewed})=>{
    const r=await fetch('/api/files/reviewed',{method:'POST',headers:{'content-type':'application/json','x-diffcompass-token':new URLSearchParams(location.hash.slice(1)).get('token')},body:JSON.stringify({path,reviewed})});
    if(!r.ok)throw Error(await r.text());await diffLab.refresh();
  },{path,reviewed});
  const section=path=>page.locator('[data-prototype-file="'+path+'"]');
  const toggle=path=>section(path).locator('[data-file-toggle]');
  const expanded=async path=>await toggle(path).getAttribute('aria-expanded')==='true';
  try {
    for(const path of ['checkout.ts','large.ts','added.ts','removed.ts','notes.txt'])await set(path,path==='checkout.ts');
    await page.reload();await page.waitForFunction(()=>window.diffLab);
    check(!await expanded('checkout.ts'),'Reviewed checkout starts collapsed');
    for(const path of ['large.ts','added.ts','removed.ts','notes.txt'])check(await expanded(path),'Unreviewed '+path+' must start expanded');
    await toggle('large.ts').click();check(!await expanded('large.ts'),'Large file can collapse independently');
    await toggle('large.ts').click();check(await expanded('large.ts'),'Large file reopens');
    await page.evaluate(()=>{
      const view=diffLab.views.get('large.ts');
      window.largeBefore={view,model:view.editors.new.getModel()};
      view.reveal('new',1000);
    });
    // A loaded file must never be remounted, emptied, or resized by another file's toggle.
    await page.waitForTimeout(300);
    await page.evaluate(()=>{
      const view=diffLab.views.get('large.ts');
      largeBefore.scroll=view.editors.new.getScrollTop();
      largeBefore.height=view.root.getBoundingClientRect().height;
    });
    for(let i=0;i<3;i++){
      await toggle('checkout.ts').click();check(await expanded('large.ts'),'Opening checkout must not close large');
      await toggle('checkout.ts').click();check(await expanded('large.ts'),'Closing checkout must not close large');
    }
    check(await page.evaluate(()=>{
      const view=diffLab.views.get('large.ts');
      return view===largeBefore.view&&view.editors.new.getModel()===largeBefore.model&&
        view.editors.new.getScrollTop()===largeBefore.scroll&&view.root.getBoundingClientRect().height===largeBefore.height;
    }),'Other file toggles preserve the same editor, model, scroll and height');
    // Sample frames while reopening the large file: retained editor, no empty flash.
    await toggle('large.ts').click();
    await page.evaluate(()=>{
      window.frames=[];window.sampling=true;
      const sample=()=>{
        const v=diffLab.views.get('large.ts');
        if(!v.root.closest('.prototype-file-body').hidden)frames.push({height:v.root.getBoundingClientRect().height,text:v.root.querySelector('.view-lines')?.textContent||'',same:v.editors.new.getModel()===largeBefore.model});
        if(sampling)requestAnimationFrame(sample);
      };requestAnimationFrame(sample);
    });
    await toggle('large.ts').click();await page.waitForTimeout(400);
    const frames=await page.evaluate(()=>{sampling=false;return window.frames;});
    check(frames.length>5&&frames.every(f=>f.height>100&&f.text.length>0&&f.same),'Reopening large retains rendered code throughout sampled frames');
    check(Math.max(...frames.map(f=>f.height))-Math.min(...frames.map(f=>f.height))<2,'No reopening height oscillation');
    await toggle('checkout.ts').click();
    await page.evaluate(()=>diffLab.views.get('checkout.ts').reveal('new',18));
    const card=section('checkout.ts').locator('[data-comment-id]').first();
    await card.getByRole('button',{name:'Edit',exact:true}).click();
    await card.getByRole('textbox').fill('Draft survives another file');
    await page.locator('#file').selectOption('added.ts');
    await toggle('checkout.ts').click();await toggle('checkout.ts').click();
    check(await card.getByRole('textbox').inputValue()==='Draft survives another file','Per-file draft survives navigation and collapse');
    await card.getByRole('button',{name:'Cancel',exact:true}).click();
    await page.screenshot({path:'/tmp/dc-independent-files.png'});
    return {passed:true,checks:['unreviewed files initially expanded','independent toggles','stable editor/model/scroll/height','no blank or oscillating reopen frames','per-file draft retained']};
  }finally{
    for(const path of ['checkout.ts','large.ts','added.ts','removed.ts','notes.txt'])await set(path,initial.includes(path));
  }
}
