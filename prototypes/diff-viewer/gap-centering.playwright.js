async (page) => {
  const check=(ok,message)=>{if(!ok)throw Error(message);};
  await page.waitForFunction(()=>window.diffLab);
  const geometry=()=>page.evaluate(()=>[...document.querySelectorAll('#editor .diff-hidden-lines .center')].filter(n=>n.querySelector('[title="Show Unchanged Region"]')&&n.getBoundingClientRect().width).map(n=>{
    const r=n.getBoundingClientRect(),a=n.children[0].getBoundingClientRect(),b=n.children[1].getBoundingClientRect();
    return {rowCenter:(r.left+r.right)/2,groupCenter:(a.left+b.right)/2,arrowWidth:a.width,overflow:n.scrollWidth-n.clientWidth};
  }));
  const checks=[];
  for(const width of [1920,1100]){
    await page.setViewportSize({width,height:1080});
    for(const layout of ['unified','split']){
      await page.locator('#layout').selectOption(layout);if(await page.locator('#collapse').isEnabled())await page.locator('#collapse').click();
      await page.waitForFunction(()=>document.querySelector('[title="Show Unchanged Region"]'));
      const deadline=Date.now()+5000;let positions;
      do{positions=await geometry();if(positions.length&&positions.every(p=>Math.abs(p.rowCenter-p.groupCenter)<2&&p.arrowWidth<30&&p.overflow<2))break;await page.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));}while(Date.now()<deadline);
      check(positions.length&&positions.every(p=>Math.abs(p.rowCenter-p.groupCenter)<2&&p.arrowWidth<30&&p.overflow<2),'Expansion controls must be centred across the gap row: '+JSON.stringify(positions));
      checks.push(width+'/'+layout+': horizontal centering');
    }
  }
  await page.setViewportSize({width:1920,height:1080});await page.locator('#layout').selectOption('unified');if(await page.locator('#collapse').isEnabled())await page.locator('#collapse').click();
  const before=await page.locator('[title="Double click to unfold"]').count();
  await page.locator('#editor [title="Show Unchanged Region"]').first().click();
  await page.waitForFunction(n=>document.querySelectorAll('[title="Double click to unfold"]').length<n,before);
  await page.locator('.context-collapse-zone button').first().click();
  await page.waitForFunction(n=>document.querySelectorAll('[title="Double click to unfold"]').length===n,before);
  await page.locator('#theme').click();
  check((await geometry()).every(p=>Math.abs(p.rowCenter-p.groupCenter)<2),'Light mode remains centred');
  await page.locator('#theme').click();
  await page.screenshot({path:'/tmp/dc-reviewed-centered-controls.png'});
  checks.push('native arrow expansion and local recollapse; light theme');
  return {passed:true,checks};
}
