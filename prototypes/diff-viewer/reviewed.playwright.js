async (page) => {
  const check=(ok,message)=>{if(!ok)throw Error(message);};
  await page.waitForFunction(()=>window.diffLab);
  const original=await page.evaluate(()=>[...(diffLab.session.reviewedFiles||[])]);
  const reviewed=page.locator('#reviewed'),checks=[];
  let release;
  const request=(path,value)=>page.evaluate(async({path,value})=>{
    const r=await fetch('/api/files/reviewed',{method:'POST',headers:{'content-type':'application/json','x-diffcompass-token':new URLSearchParams(location.hash.slice(1)).get('token')},body:JSON.stringify({path,reviewed:value})});
    if(!r.ok)throw Error(await r.text());await diffLab.refresh();
  },{path,value});
  try {
    check(await reviewed.count()===1,'Prototype needs a Mark as reviewed button');
    await request('checkout.ts',false);await request('added.ts',false);
    await page.locator('#file').selectOption('checkout.ts');
    await reviewed.focus();await page.keyboard.press('Enter');
    await page.waitForFunction(()=>document.querySelector('#reviewed').getAttribute('aria-pressed')==='true');
    check(await reviewed.textContent()==='✓ Reviewed','Reviewed state is visible');
    const left=page.frameLocator('#current').locator('[data-reviewed-file="checkout.ts"]');
    await page.waitForFunction(()=>document.querySelector('#current').contentDocument.querySelector('[data-reviewed-file="checkout.ts"]')?.textContent.includes('Reviewed'));
    await page.locator('#layout').selectOption('split');
    check(await reviewed.getAttribute('aria-pressed')==='true','Layout switching preserves review state');
    await page.locator('#file').selectOption('added.ts');
    check(await reviewed.getAttribute('aria-pressed')==='false','Review status is per file');
    await page.locator('#file').selectOption('checkout.ts');
    await page.reload();await page.waitForFunction(()=>window.diffLab);
    check(await reviewed.getAttribute('aria-pressed')==='true','Review state survives reload');
    const root=await page.evaluate(async()=>{const r=await fetch('/api/prototype',{headers:{'x-diffcompass-token':new URLSearchParams(location.hash.slice(1)).get('token')}});return (await r.json()).root;});
    const saved=JSON.parse(await (await import('node:fs/promises')).readFile(root+'/session.json','utf8'));
    check(saved.reviewedFiles.includes('checkout.ts'),'Real session persistence contains reviewed status');
    checks.push('keyboard mark; shared state; per-file and Split/Unified; reload and disk persistence');
    await left.click();
    await page.waitForFunction(()=>document.querySelector('#reviewed').getAttribute('aria-pressed')==='false');
    checks.push('changes from current renderer update prototype through polling');

    const card=page.locator('#editor [data-comment-id]').first();
    await card.getByRole('button',{name:'Edit',exact:true}).click();
    await card.getByRole('textbox').fill('Unsaved review-status draft');
    await reviewed.click();await page.waitForFunction(()=>document.querySelector('#reviewed').getAttribute('aria-pressed')==='true');
    await page.locator('[data-file-toggle="checkout.ts"]').click();
    check(await card.getByRole('textbox').inputValue()==='Unsaved review-status draft','Marking reviewed preserves an open comment draft');
    await card.getByRole('button',{name:'Cancel',exact:true}).click();
    await reviewed.click();await page.waitForFunction(()=>document.querySelector('#reviewed').getAttribute('aria-pressed')==='false');
    await page.route('**/api/files/reviewed',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Fixture reviewed save failed'})}));
    await reviewed.click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Fixture reviewed save failed'));
    check(await reviewed.getAttribute('aria-pressed')==='false'&&await reviewed.isEnabled(),'Failed save must not show success or prevent retry');
    await page.unroute('**/api/files/reviewed');
    checks.push('mark folds file; reopening preserves draft; failed save retains actual state');

    let intercepted;
    const entered=new Promise(resolve=>intercepted=resolve),pending=new Promise(resolve=>release=resolve);
    await page.route('**/api/files/reviewed',async r=>{intercepted();await pending;await r.continue();});
    await reviewed.click();await entered;
    check(await reviewed.isDisabled(),'Pending save blocks duplicate clicks');
    await page.locator('#file').selectOption('added.ts');
    release();
    await page.waitForFunction(()=>diffLab.session.reviewedFiles.includes('checkout.ts')&&!document.querySelector('#reviewed').disabled);
    check(await reviewed.getAttribute('aria-pressed')==='false','Late response must not mark the newly selected file');
    await page.unroute('**/api/files/reviewed');
    checks.push('in-flight file switch keeps the captured path');
    return {passed:true,checks};
  } finally {
    release?.();
    await page.unrouteAll({behavior:'wait'});
    for(const path of ['checkout.ts','added.ts'])await request(path,original.includes(path));
  }
}
