async (page) => {
  const check=(ok,message)=>{if(!ok)throw Error(message);};
  await page.waitForFunction(()=>window.diffLab);
  const initial=await page.evaluate(()=>diffLab.session.reviewedFiles||[]);
  const set=async(path,reviewed)=>page.evaluate(async ({path,reviewed})=>{
    const r=await fetch('/api/files/reviewed',{method:'POST',headers:{'content-type':'application/json','x-diffcompass-token':new URLSearchParams(location.hash.slice(1)).get('token')},body:JSON.stringify({path,reviewed})});
    if(!r.ok)throw Error(await r.text());await diffLab.refresh();
  },{path,reviewed});
  const file=path=>page.locator('[data-prototype-file="'+path+'"]');
  const toggle=path=>file(path).locator('[data-file-toggle]');
  try {
    check(await page.locator('[data-prototype-file]').count()===5,'All fixture file headers must be present, not hidden behind the picker');
    await set('checkout.ts',false);await set('added.ts',false);
    await page.locator('#file').selectOption('checkout.ts');
    await page.locator('#reviewed').click();
    await page.waitForFunction(()=>document.querySelector('[data-prototype-file="checkout.ts"] [data-file-toggle]').getAttribute('aria-expanded')==='false');
    check(await page.locator('#editor').isVisible()===false,'Mark reviewed folds code');
    check(await file('added.ts').isVisible(),'Another file remains visible after collapse');
    check(await file('added.ts').locator('[data-review-path]').getAttribute('aria-pressed')==='false','Only the chosen file is reviewed');
    await page.locator('#file').selectOption('added.ts');
    await page.waitForFunction(()=>diffLab.file.path==='added.ts');
    check(await page.locator('#editor').isVisible(),'Second file opens directly from its visible header');
    check(await toggle('checkout.ts').getAttribute('aria-expanded')==='false','Reviewed file stays collapsed');
    await toggle('checkout.ts').click();
    await page.waitForFunction(()=>diffLab.file.path==='checkout.ts');
    check(await page.locator('#reviewed').getAttribute('aria-pressed')==='true','Reopening is not unreviewing');
    await page.locator('#reviewed').click();
    await page.waitForFunction(()=>document.querySelector('#reviewed').getAttribute('aria-pressed')==='false');
    check(await page.locator('#editor').isVisible(),'Unmark reopens the file');
    const card=page.locator('#editor [data-comment-id]').first();
    await card.getByRole('button',{name:'Edit',exact:true}).click();await card.getByRole('textbox').fill('Preserve this collapsed draft');
    await page.locator('#reviewed').click();await page.waitForFunction(()=>document.querySelector('#reviewed').getAttribute('aria-pressed')==='true');
    check(await page.locator('#editor').isVisible()===false,'Draft also folds');
    await toggle('checkout.ts').click();
    check(await card.getByRole('textbox').inputValue()==='Preserve this collapsed draft','Reopen retains the draft');
    await toggle('added.ts').click();
    check(await page.evaluate(()=>diffLab.file.path)==='added.ts','Switching files preserves the independent draft');
    await page.locator('#file').selectOption('checkout.ts');
    await card.getByRole('button',{name:'Cancel',exact:true}).click();
    await page.reload();await page.waitForFunction(()=>window.diffLab);
    check(await toggle('checkout.ts').getAttribute('aria-expanded')==='false','Reviewed files start collapsed after reload');
    await page.screenshot({path:'/tmp/dc-file-list-collapsed.png'});
    await toggle('added.ts').click();await page.waitForFunction(()=>diffLab.file.path==='added.ts');
    await page.waitForFunction(()=>[...document.querySelectorAll('#editor .view-lines')].some(node=>node.textContent.includes('formatCurrency'))&&document.querySelector('#file-detail').getBoundingClientRect().height<300);
    await page.evaluate(()=>new Promise(resolve=>{let remaining=12;const tick=()=>--remaining?requestAnimationFrame(tick):resolve();requestAnimationFrame(tick);}));
    check(await file('notes.txt').isVisible(),'Short files leave the other headers available');
    await page.screenshot({path:'/tmp/dc-file-list-second-file.png'});
    return {passed:true,checks:['five visible file headers','per-file reviewed state and collapse','second file opening','reopen without unreviewing; unmark expands','draft retained across fold and other-file navigation','reviewed files collapsed after reload']};
  }finally{
    for(const path of ['checkout.ts','added.ts'])await set(path,initial.includes(path));
  }
}
