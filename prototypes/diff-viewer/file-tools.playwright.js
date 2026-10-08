// Standalone disposable fixture. Does not mutate review state or system clipboard.
async (page) => {
  const check=(ok,message)=>{if(!ok)throw Error(message);};
  await page.reload();await page.waitForFunction(()=>window.diffLab);
  await page.locator('#layout').selectOption('unified');
  await page.evaluate(()=>{window.fileToolCopies=[];Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async text=>fileToolCopies.push(text)});});
  for(const [path,side] of [['added.ts','new'],['removed.ts','old'],['checkout.ts','new']]) {
    await page.locator('#file').selectOption(path);
    await page.waitForFunction(path=>diffLab.file.path===path,path);
    const card=page.locator(`[data-prototype-file="${path}"]`),control=name=>card.locator(`[data-control="${name}"]`);
    const expected=await page.evaluate(side=>diffLab.file[side],side);
    check(await control('copy').innerText()==='Copy contents','No-selection action stays file-scoped for '+path);
    await control('copy').click();
    await control('tool-feedback').getByText('Copied contents',{exact:true}).waitFor();
    check(await page.evaluate(expected=>fileToolCopies.at(-1)===expected,expected),'Copy uses exactly this file’s captured '+side+' source, including EOLs: '+path);
    await control('source').click();
    const source=await page.evaluate(path=>{
      const e=monaco.editor.getEditors().find(e=>e.getDomNode()?.closest(`[data-prototype-file="${path}"] [data-control="source-editor"]`));
      return {value:e.getValue(),readOnly:e.getOption(monaco.editor.EditorOption.readOnly)};
    },path);
    check(source.value===expected&&source.readOnly,'Source opens correct read-only revision for '+path);
    check((await control('source-title').innerText()).includes(side==='old'?'Before':'After'),'Revision label matches captured file');
    await control('return').click();
    check(await page.evaluate(()=>diffLab.anchor===null),'Whole-file source return preserves absence of selection');
  }
  // A previously selected different file must not leak into the clicked file.
  await page.evaluate(()=>diffLab.reveal('new',18));
  const added=page.locator('[data-prototype-file="added.ts"]');
  await added.locator('[data-control=copy]').click();
  check(await page.evaluate(()=>diffLab.file.path==='added.ts'&&fileToolCopies.at(-1)===diffLab.file.new),'Clicking another file toolbar copies that file, not the previous active selection');
  await page.locator('#file').selectOption('checkout.ts');
  await page.evaluate(()=>diffLab.reveal('old',18));
  await page.locator('#copy').click();
  check(await page.evaluate(()=>fileToolCopies.at(-1)===diffLab.file.old),'A Before-side anchor copies the entire Before file, not just the removed line');
  await page.evaluate(()=>{diffLab.editors.new.setSelection(new monaco.Range(1,1,105,2));diffLab.editors.new.focus();});
  const count=await page.evaluate(()=>fileToolCopies.length);
  check(await page.locator('#copy').innerText()==='Copy contents','Oversized selections do not change the file-scoped action');
  await page.locator('#copy').click();
  check(await page.evaluate(count=>fileToolCopies.length===count+1&&fileToolCopies.at(-1)===diffLab.file.new,count),'An oversized selection does not block full-file copy');
  check((await page.locator('#tool-feedback').innerText())==='Copied contents','Whole-file success is visible next to the action');
  check(await page.evaluate(()=>monaco.editor.getModels().length===2*diffLab.views.size),'Source models are disposed after returning');
  return {passed:true,addedDeletedModified:true,fileOwnership:true,exactCapturedEols:true,oversizedSelectionStillCopiesFile:true,sourceModelCleanup:true};
}
