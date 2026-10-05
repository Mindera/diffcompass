// Bounded diagnostic, not a passing regression suite. Keeps genuine pointer
// failures in its JSON report; never substitutes a DOM activation for a click.
import { writeFile, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const modulePath = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(modulePath);
const packagePath = modulePath.startsWith('/') ? new URL('./package.json', `file://${modulePath}`) : createRequire(import.meta.url).resolve('playwright/package.json');
const playwrightVersion = JSON.parse(await readFile(packagePath, 'utf8')).version;
const url = process.argv[2];
const dir = process.env.SEQUENCE_SCREENSHOT_DIR || '/tmp';
const modes = process.env.SEQUENCE_HEADLESS_ONLY ? [true] : [true, false];
const plain = process.env.SEQUENCE_POINTER_PLAIN === '1';
const nativeWindow = process.env.SEQUENCE_NATIVE_WINDOW === '1';
const report = { playwrightVersion, plain, nativeWindow, runs: [] };

function traceInput() {
  window.pointerTrace = [];
  window.captureOwners = new Map();
  const label = node => node?.nodeType === 1 ? node.tagName + (node.id ? '#' + node.id : '') + (typeof node.className === 'string' ? '.' + node.className.split(' ').join('.') : '') : String(node);
  for (const type of ['pointerdown', 'pointerup', 'click', 'gotpointercapture', 'lostpointercapture']) {
    document.addEventListener(type, e => {
      if (type === 'gotpointercapture') captureOwners.set(e.pointerId, label(e.target));
      if (type === 'lostpointercapture') captureOwners.delete(e.pointerId);
      pointerTrace.push({ type, target: label(e.target), x: e.clientX, y: e.clientY, pointerId: e.pointerId, buttons: e.buttons, path: e.composedPath().slice(0, 6).map(label) });
    }, true);
  }
}

async function geometry(page, frame, iframe, target) {
  const box = await target.boundingBox();
  const point = box && { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const parent = await page.evaluate(({point}) => {
    const label = el => el.tagName + '#' + el.id + '.' + String(el.className);
    const view = () => ({ inner: [innerWidth, innerHeight], scroll: [scrollX, scrollY], viewport: visualViewport && { width: visualViewport.width, height: visualViewport.height, offsetLeft: visualViewport.offsetLeft, offsetTop: visualViewport.offsetTop, pageTop: visualViewport.pageTop, scale: visualViewport.scale } });
    return { ...view(), hits: point ? document.elementsFromPoint(point.x, point.y).map(label) : [], captures: [...captureOwners], trace: pointerTrace.slice() };
  }, { point });
  const ancestry = await iframe.evaluate(el => {
    const result = [];
    for (let node = el; node; node = node.parentElement) {
      const s = getComputedStyle(node);
      result.push({ tag: node.tagName, id: node.id, className: node.className, rect: node.getBoundingClientRect().toJSON(), scroll: [node.scrollLeft, node.scrollTop], scrollSize: [node.scrollWidth, node.scrollHeight], client: [node.clientWidth, node.clientHeight], styles: Object.fromEntries(['overflow','overflowX','overflowY','position','transform','clipPath','contain','pointerEvents','zIndex','display'].map(k => [k,s[k]])), inert:node.inert, popover:node.matches(':popover-open') });
    }
    return result;
  });
  const child = await frame.evaluate(() => ({ inner: [innerWidth,innerHeight], scroll: [scrollX,scrollY], viewport: visualViewport && { width:visualViewport.width,height:visualViewport.height,offsetLeft:visualViewport.offsetLeft,offsetTop:visualViewport.offsetTop,pageTop:visualViewport.pageTop,scale:visualViewport.scale }, captures:[...captureOwners], trace:pointerTrace.slice(), panning:document.querySelector('.diagram-container')?.classList.contains('is-panning'), justPanned:document.querySelector('.diagram-container')?.getAttribute('data-just-panned') }));
  return { box, point, parent, ancestry, child };
}

for (const headless of modes) {
  let browser;
  try { browser = await chromium.launch({ headless, channel: 'chrome' }); }
  catch (error) { report.runs.push({headless, unavailable:String(error)}); continue; }
  console.log('browser',headless ? 'headless' : 'headed',browser.version());
  try {
    for (const [name,width,height] of [['desktop',1440,1000],['narrow',600,900]]) {
      for (const present of [false,true]) for (const resized of [false,true]) {
        const context=await browser.newContext({viewport:nativeWindow?null:{width,height}});
        await context.addInitScript(traceInput);
        const page=await context.newPage(); page.setDefaultTimeout(15000);
        const result={headless,browser:browser.version(),name,present,resized,errors:[],errorStacks:[]};
        page.on('pageerror',e=>{result.errors.push(e.message);result.errorStacks.push(e.stack);});
        try {
          let windowSession,windowId,windowBounds;
          if(nativeWindow){
            windowSession=await context.newCDPSession(page);
            const native=await windowSession.send('Browser.getWindowForTarget');windowId=native.windowId;
            const chrome=await page.evaluate(()=>({width:outerWidth-innerWidth,height:outerHeight-innerHeight}));
            windowBounds={width:width+chrome.width,height:height+chrome.height};
            await windowSession.send('Browser.setWindowBounds',{windowId,bounds:{...windowBounds,windowState:'normal'}});
            await page.waitForTimeout(200);
          }
          await page.goto(url);await page.locator('#archify-tab').click();await page.locator('#archify-select').selectOption('sequence-checkout-flow');
          await page.frameLocator('iframe.archify-frame').locator('.sequence-code-pane').waitFor();
          let iframe=page.locator('iframe.archify-frame'); let frame=await(await iframe.elementHandle()).contentFrame();
          await frame.waitForFunction(()=>window.Archify?.view?.state?.().mode==='review');
          await iframe.scrollIntoViewIfNeeded();await page.waitForTimeout(200);
          if(plain){
            // Preserve exact app nesting/stylesheet, but remove every script
            // and replace the renderer with one ordinary button. No camera,
            // selection, drag, walkthrough or presentation controller remains.
            const html=await page.evaluate(()=>{
              const clone=document.documentElement.cloneNode(true);
              clone.querySelectorAll('script').forEach(n=>n.remove());
              clone.querySelectorAll('iframe:not(.archify-frame)').forEach(n=>n.remove());
              const base=document.createElement('base');base.href=location.origin+'/';clone.querySelector('head').prepend(base);
              const f=clone.querySelector('iframe.archify-frame');f.removeAttribute('src');
              f.srcdoc='<style>html,body{margin:0;height:100%;overflow:hidden;background:#eef}button{position:fixed;left:65vw;bottom:20px;width:50px;height:32px}</style><button id="plain-button" onclick="this.dataset.clicked=String(Number(this.dataset.clicked||0)+1)">Click</button>';
              return '<!doctype html>'+clone.outerHTML;
            });
            await writeFile(`${dir}/sequence-pointer-plain-${name}.html`,html);
            await page.goto('about:blank');await page.setContent(html);
            iframe=page.locator('iframe.archify-frame');frame=await(await iframe.elementHandle()).contentFrame();await frame.locator('#plain-button').waitFor();
            await page.evaluate(traceInput);await frame.evaluate(traceInput);
            await iframe.evaluate(f=>f.scrollIntoView({block:'center',behavior:'instant'}));await page.waitForTimeout(200);
          }
          if(present){
            if(plain)await iframe.evaluate(f=>{f.style.cssText='position:fixed!important;inset:0!important;margin:0!important;padding:0!important;width:100vw!important;height:100dvh!important;max-width:none!important;max-height:none!important;border:0!important;border-radius:0!important;z-index:2147483647!important;background:#101418';f.setAttribute('popover','manual');f.showPopover();});
            else {await frame.locator('#btn-present').click();await frame.waitForFunction(()=>Archify.presentation.active());}
            await page.waitForTimeout(200);
          }
          const initial=plain?null:await frame.evaluate(()=>Archify.view.state());
          if(resized){
            if(nativeWindow){await windowSession.send('Browser.setWindowBounds',{windowId,bounds:{...windowBounds,width:windowBounds.width-20}});await page.waitForTimeout(150);await windowSession.send('Browser.setWindowBounds',{windowId,bounds:windowBounds});}
            else{await page.setViewportSize({width:width-20,height});await page.waitForTimeout(150);await page.setViewportSize({width,height});}
            await page.waitForTimeout(150);
          }
          result.cameraPreserved=plain?null:JSON.stringify(initial)===JSON.stringify(await frame.evaluate(()=>Archify.view.state()));
          const target=frame.locator(plain?'#plain-button':'[data-diffcompass-action="fit"]');
          if(!plain)await target.scrollIntoViewIfNeeded();await page.waitForTimeout(200);
          await page.evaluate(()=>pointerTrace.length=0);await frame.evaluate(()=>pointerTrace.length=0);
          result.before=await geometry(page,frame,iframe,target);
          const [visibleWidth,visibleHeight]=result.before.parent.inner;
          if(result.before.box.y<0 || result.before.box.y+result.before.box.height>visibleHeight || result.before.box.x<0 || result.before.box.x+result.before.box.width>visibleWidth)throw new Error('Diagnostic target is not fully within the top-level viewport');
          await page.mouse.click(result.before.point.x,result.before.point.y);await page.waitForTimeout(200);
          result.after=await geometry(page,frame,iframe,target);
          result.childClick=result.after.child.trace.some(e=>e.type==='click');
          result.cameraAfter=plain?null:await frame.evaluate(()=>Archify.view.state());
          result.fitActivated=plain?null:result.cameraAfter.scale!==initial.scale;
          if(plain)result.plainActivated=await target.getAttribute('data-clicked');
          // Ordinary pointer click only, plus screenshots when routing fails.
          if(!result.childClick)await page.screenshot({path:`${dir}/sequence-pointer-${plain?'plain-':''}${headless?'headless':'headed'}-${name}-${present?'present':'normal'}-${resized?'resized':'fresh'}.png`});
        }catch(error){result.failure=String(error);}
        report.runs.push(result);console.log(JSON.stringify({headless,name,present,resized,childClick:result.childClick,fitActivated:result.fitActivated,cameraPreserved:result.cameraPreserved,failure:result.failure}));
        await writeFile(`${dir}/sequence-pointer-${plain?'plain-':''}results.json`,JSON.stringify(report,null,2));
        await context.close();
      }
    }
  }finally{await browser.close();}
}
await writeFile(`${dir}/sequence-pointer-${plain?'plain-':''}results.json`,JSON.stringify(report,null,2));
