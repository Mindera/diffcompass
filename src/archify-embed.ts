/**
 * Adapts a self-contained Archify artifact for the review workspace without
 * changing the optional Archify checkout. It deliberately does not use
 * Archify's `data-embed` mode: that mode removes the semantic passport,
 * finder, presentation, and export controls that remain useful in review.
 */
// @ts-expect-error Bun embeds this shared skin in live and exported viewers.
import mapNodeStyles from "../public/map-nodes.css" with { type: "text" };
import type { DomainNodeDetail } from "./domain-context.ts";
import { withRouteChoices } from "./map-routes.ts";
import { sequenceSourceScript } from "./sequence-source-embed.ts";
import type { SequenceSourceAnchor } from "./types.ts";
import { applyMapNodeRoles, MAP_NODE_ROLES, type MapNodeRoles } from "./map-node-roles.ts";

function roleEvidenceScript(roles?: MapNodeRoles): string {
  if (!roles || !Object.keys(roles).length) return "";
  const data = JSON.stringify(roles).replace(/</g, "\\u003c");
  return `<script>(function(){function install(){var roles=${data},id=document.getElementById('focus-id'),panel=document.getElementById('focus-chip');if(!id||!panel)return;var details=document.createElement('details'),summary=document.createElement('summary'),body=document.createElement('p');summary.textContent='Why this type';details.style.cssText='padding:12px 18px;font:12px/1.6 system-ui';details.append(summary,body);panel.appendChild(details);function update(){var role=roles[id.textContent];details.hidden=!role;body.textContent=role?role.evidence:'';}new MutationObserver(update).observe(id,{childList:true,characterData:true,subtree:true});update();}if(document.readyState==='loading')window.addEventListener('load',install,{once:true});else install();}())</script>`;
}

function domainDetailsScript(details?: Record<string, DomainNodeDetail>, domainModel = false): string {
  if (!details || !Object.keys(details).length) return "";
  const data = JSON.stringify(details).replace(/</g, "\\u003c");
  return `<script data-diffcompass-domain>(function(){var data=${data};function install(){var id=document.getElementById('focus-id'),panel=document.getElementById('focus-chip');if(!id||!panel)return;var section=document.createElement('section');section.style.cssText='padding:14px 18px;border-top:1px solid #334155;white-space:normal;font:12px/1.6 system-ui';var head=panel.querySelector('.relationship-lens-head');if(head)head.insertAdjacentElement('afterend',section);else panel.appendChild(section);function update(){section.replaceChildren();var value=data[id.textContent];section.hidden=!value;if(!value)return;var heading=document.createElement('strong');heading.textContent=value.term+' · '+value.context;var definition=document.createElement('p');definition.textContent=value.definition;var source=document.createElement('details'),summary=document.createElement('summary'),quote=document.createElement('blockquote');summary.textContent='Glossary: '+value.source.path+':'+value.source.line;quote.textContent=value.source.quote;source.append(summary,quote);section.append(heading,definition,source);var context=document.getElementById('focus-context');if(context){context.textContent=value.context;context.hidden=false;}id.hidden=true;if(${domainModel}){var kind=document.getElementById('focus-kind');if(kind)kind.textContent='Domain concept';}}new MutationObserver(update).observe(id,{childList:true,characterData:true,subtree:true});update();}if(document.readyState==='loading')window.addEventListener('load',install,{once:true});else install();}())</script>`;
}

function appendToBody(html: string, additions: string): string {
  return /<\/body\s*>/i.test(html) ? html.replace(/<\/body\s*>/i, `${additions}</body>`) : `${html}\n${additions}`;
}

function reviewEmbedRoot(html: string): string {
  if (!/<html\b/i.test(html)) return html;
  return html.replace(/<html\b([^>]*)>/i, (_match, attributes: string) => {
    // A saved artifact can carry a gallery-mode root attribute. Keep the full
    // viewer active in review, removing only that root attribute.
    const withoutEmbed = attributes.replace(/\sdata-embed(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/i, "");
    return `<html${withoutEmbed} data-diffcompass-embed="true">`;
  });
}

/**
 * Dependency-free because exported review HTML is self-contained. The matching
 * camera maths are exercised directly in archify-camera.test.ts; this runtime
 * supplies DOM measurements and pointer interactions.
 */
function cameraScript(diagramType?: string): string {
  return `<script data-diffcompass-camera>(function(){
function install(){
  var container=document.querySelector('.diagram-container'),svg=container&&container.querySelector(':scope > svg');
  if(!container||!svg||container.hasAttribute('data-diffcompass-camera'))return;
  container.setAttribute('data-diffcompass-camera','true');svg.style.clipPath='none';
  // Rename viewer chrome, never authored node labels.
  [['#btn-route-probe','Paths','Find a path between two components'],['#btn-semantic-lens','Types','Highlight components by type'],['.relationship-lens-eyebrow','Component details',''],['#semantic-lens-title','Component types','']].forEach(function(entry){var el=document.querySelector(entry[0]);if(el){el.textContent=entry[1];if(entry[2]){el.title=entry[2];el.setAttribute('aria-label',entry[2]);}}});
  // Hide only unoccupied renderer bands. All real states and edges stay intact.
  if(${diagramType === 'lifecycle'}){var nodes=Array.from(svg.querySelectorAll('g[data-node-id]'));if(nodes.length){[{start:112,end:264,label:100},{start:264,end:436,label:252},{start:436,end:Infinity,label:424}].forEach(function(band){var occupied=nodes.some(function(node){var rect=node.querySelector('rect'),y=rect&&Number(rect.getAttribute('y'));return rect&&y>=band.start&&y<band.end;});if(!occupied){Array.from(svg.children).forEach(function(child){if((child.tagName.toLowerCase()==='text'&&Number(child.getAttribute('y'))===band.label)||(child.tagName.toLowerCase()==='path'&&child.getAttribute('d')&&child.getAttribute('d').startsWith('M 72 '+band.start+' L ')))child.style.display='none';});}});}}
  var natural=svg.viewBox&&svg.viewBox.baseVal;
  if(natural&&natural.width>0&&natural.height>0){svg.style.width=natural.width+'px';svg.style.height=natural.height+'px';}
  var out=replaceCameraButton('[data-view="out"]','out'),fit=replaceCameraButton('[data-view="reset"]','fit'),inButton=replaceCameraButton('[data-view="in"]','in');
  var state={scale:1,x:0,y:0},drag=null,resizeFrame=0,sourcePaused=false;
  function replaceCameraButton(selector,action){var old=container.querySelector(selector);if(!old)return null;var button=old.cloneNode(true);button.setAttribute('data-diffcompass-action',action);old.replaceWith(button);return button;}
  function numberStyle(name){var value=parseFloat(getComputedStyle(container)[name]);return Number.isFinite(value)?value:0;}
  function metrics(){var left=numberStyle('paddingLeft'),right=numberStyle('paddingRight'),top=numberStyle('paddingTop'),bottom=numberStyle('paddingBottom'),baseLeft=svg.offsetLeft||left,baseTop=svg.offsetTop||top;return {contentWidth:Math.max(1,svg.clientWidth||svg.getBoundingClientRect().width),contentHeight:Math.max(1,svg.clientHeight||svg.getBoundingClientRect().height),baseLeft:baseLeft,baseTop:baseTop,viewport:{left:left-baseLeft,top:top-baseTop,width:Math.max(1,container.clientWidth-left-right),height:Math.max(1,container.clientHeight-top-bottom)}};}
  function updateControls(m){var percent=Math.round(state.scale*100)+'%';if(out)out.disabled=state.scale<=.05;if(inButton)inButton.disabled=state.scale>=3;if(fit){fit.setAttribute('aria-label','Fit entire map');fit.title='Fit entire map';var detail=fit.querySelector('[data-view-detail]'),label=fit.querySelector('[data-view-percent]');if(detail){detail.hidden=false;detail.textContent='Fit';}if(label)label.textContent=percent;}container.classList.add('is-pannable');}
  function apply(){var m=metrics();svg.style.transform='translate('+Math.round(state.x*100)/100+'px,'+Math.round(state.y*100)/100+'px) scale('+state.scale+')';svg.setAttribute('data-view-scale',String(state.scale));updateControls(m);if(window.Archify&&Archify.radar&&typeof Archify.radar.sync==='function')Archify.radar.sync();}
  function fitAll(){var m=metrics(),view=m.viewport;state.scale=Math.min(1,view.width/m.contentWidth,view.height/m.contentHeight);state.x=view.left+(view.width-m.contentWidth*state.scale)/2;state.y=view.top+(view.height-m.contentHeight*state.scale)/2;apply();}
  function zoom(next,anchor){var m=metrics(),view=m.viewport,previous=state.scale;next=Math.max(.05,Math.min(3,next));if(Math.abs(next-previous)<.0001)return;anchor=anchor||{x:view.left+view.width/2,y:view.top+view.height/2};var logicalX=(anchor.x-state.x)/previous,logicalY=(anchor.y-state.y)/previous;state.scale=next;state.x=anchor.x-logicalX*next;state.y=anchor.y-logicalY*next;apply();}
  function zoomStep(direction,anchor){var next=state.scale+direction*.25;if(direction<0&&state.scale<=.25)next=state.scale*.75;zoom(next,anchor);}
  function receipt(){var resolve;var result={state:'complete',finished:new Promise(function(done){resolve=done;}),cancel:function(){return false;}};resolve({state:'complete'});return result;}
  function logicalViewport(){var m=metrics(),view=m.viewport,box=svg.viewBox&&svg.viewBox.baseVal;if(!box||!box.width||!box.height)return null;var x=(view.left-state.x)/state.scale,y=(view.top-state.y)/state.scale,width=view.width/state.scale,height=view.height/state.scale,sx=box.width/m.contentWidth,sy=box.height/m.contentHeight;return {x:Math.max(box.x,Math.min(box.x+box.width-width*sx,box.x+x*sx)),y:Math.max(box.y,Math.min(box.y+box.height-height*sy,box.y+y*sy)),width:Math.min(box.width,width*sx),height:Math.min(box.height,height*sy),scale:state.scale};}
  // Inspection and route playback highlight content without taking camera control.
  function reveal(ids,options){options=options||{};if(['focus','relationship-direct','route-pick','route','route-journey'].includes(options.reason))return receipt();var m=metrics(),box=svg.viewBox&&svg.viewBox.baseVal,seen={},nodes=[];(ids||[]).forEach(function(id){seen[id]=true;});if(options.includeNeighbors)Array.prototype.forEach.call(svg.querySelectorAll('[data-edge-from][data-edge-to]'),function(edge){if(seen[edge.getAttribute('data-edge-from')]||seen[edge.getAttribute('data-edge-to')]){seen[edge.getAttribute('data-edge-from')]=true;seen[edge.getAttribute('data-edge-to')]=true;}});Array.prototype.forEach.call(svg.querySelectorAll('[data-node-id]'),function(node){if(seen[node.getAttribute('data-node-id')]){try{var rect=node.getBBox();if(rect&&rect.width&&rect.height)nodes.push(rect);}catch(_){}}});if(!nodes.length||!box||!box.width||!box.height)return receipt();var minX=Math.min.apply(Math,nodes.map(function(node){return node.x;})),minY=Math.min.apply(Math,nodes.map(function(node){return node.y;})),maxX=Math.max.apply(Math,nodes.map(function(node){return node.x+node.width;})),maxY=Math.max.apply(Math,nodes.map(function(node){return node.y+node.height;})),padding=Math.max(24,Number(options.padding)||40),width=(maxX-minX)*m.contentWidth/box.width,height=(maxY-minY)*m.contentHeight/box.height,target=Math.min((m.viewport.width-padding*2)/Math.max(1,width),(m.viewport.height-padding*2)/Math.max(1,height),Number(options.maxScale)||2);state.scale=Math.max(.05,target);state.x=m.viewport.left+m.viewport.width/2-((minX+maxX)/2-box.x)*m.contentWidth/box.width*state.scale;state.y=m.viewport.top+m.viewport.height/2-((minY+maxY)/2-box.y)*m.contentHeight/box.height*state.scale;apply();return receipt();}
  function centerAt(x,y){var m=metrics(),box=svg.viewBox&&svg.viewBox.baseVal;if(!box||!box.width||!box.height)return false;state.x=m.viewport.left+m.viewport.width/2-(x-box.x)*m.contentWidth/box.width*state.scale;state.y=m.viewport.top+m.viewport.height/2-(y-box.y)*m.contentHeight/box.height*state.scale;apply();return true;}
  function reset(options){if(options&&options.automatic)return;fitAll();}
  if(window.Archify)Archify.view={zoomIn:function(){zoomStep(1);},zoomOut:function(){zoomStep(-1);},reset:reset,reveal:reveal,centerAt:centerAt,logicalViewport:logicalViewport,sync:function(){return false;},suspend:function(){sourcePaused=true;if(resizeFrame)cancelAnimationFrame(resizeFrame);},restore:function(saved){if(!saved||![saved.scale,saved.x,saved.y].every(Number.isFinite))return;sourcePaused=true;requestAnimationFrame(function(){requestAnimationFrame(function(){state.scale=saved.scale;state.x=saved.x;state.y=saved.y;apply();sourcePaused=false;});});},state:function(){return {scale:state.scale,x:state.x,y:state.y,mode:'review'};}};
  if(window.parent!==window&&window.Archify){var present=document.getElementById('btn-present'),presentActive=false;function requestPresent(active){window.parent.postMessage({type:'diffcompass-map-present',active:active},'*');}if(present){document.documentElement.removeAttribute('data-present');present.addEventListener('click',function(event){event.preventDefault();event.stopImmediatePropagation();requestPresent(!presentActive);},true);Archify.presentation={active:function(){return presentActive;},enter:function(){requestPresent(true);},exit:function(){requestPresent(false);},toggle:function(){requestPresent(!presentActive);}};window.addEventListener('message',function(event){if(event.source!==window.parent||event.data?.type!=='diffcompass-map-present-state')return;presentActive=event.data.active===true;var label=document.getElementById('present-label');if(label)label.textContent=presentActive?'Exit':'Present';present.setAttribute('aria-pressed',String(presentActive));present.title=presentActive?'Exit expanded map (Escape)':'Expand map to fill the window';});document.addEventListener('keydown',function(event){if(presentActive&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();requestPresent(false);}},true);}}
  if(out)out.addEventListener('click',function(){zoomStep(-1);});if(inButton)inButton.addEventListener('click',function(){zoomStep(1);});if(fit)fit.addEventListener('click',fitAll);
  function scrollableAt(target,delta){for(var node=target;node&&node!==document.body;node=node.parentElement){var style=getComputedStyle(node);if(/auto|scroll/.test(style.overflowY)&&node.scrollHeight>node.clientHeight+1&&((delta>0&&node.scrollTop+node.clientHeight<node.scrollHeight-1)||(delta<0&&node.scrollTop>0)))return node;}return null;}
  function forwardScroll(delta){if(!Number.isFinite(delta)||!delta||window.parent===window)return;window.parent.postMessage({type:'diffcompass-map-scroll',deltaY:Math.max(-2000,Math.min(2000,delta))},'*');}
  document.addEventListener('wheel',function(event){if(event.ctrlKey||event.metaKey||scrollableAt(event.target,event.deltaY))return;var unit=event.deltaMode===1?16:event.deltaMode===2?container.clientHeight:1;event.preventDefault();event.stopImmediatePropagation();forwardScroll(event.deltaY*unit);},{capture:true,passive:false});
  // A pen/finger swipe scrolls the review; a mouse drag still pans the map.
  // Keep two-finger pinch as an explicit map zoom gesture.
  var touches=new Map(),pinchDistance=0,suppressTap=false;
  document.addEventListener('pointerdown',function(event){if(event.pointerType!=='touch'&&event.pointerType!=='pen')return;if(!container.contains(event.target)||event.target.closest('.diagram-nav,.toolbar,.focus-chip,.node-finder,.diagram-guide,.overview-map,.route-probe,.semantic-lens'))return;touches.set(event.pointerId,{x:event.clientX,y:event.clientY,startY:event.clientY,moved:false});if(touches.size===1)suppressTap=false;if(touches.size===2){var points=Array.from(touches.values());pinchDistance=Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y);}},{capture:true});
  document.addEventListener('pointermove',function(event){var point=touches.get(event.pointerId);if(!point)return;var delta=point.y-event.clientY;point.x=event.clientX;point.y=event.clientY;if(touches.size===2){var points=Array.from(touches.values()),distance=Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y);if(pinchDistance>0)zoom(state.scale*distance/pinchDistance);pinchDistance=distance;suppressTap=true;}else{if(!point.moved&&Math.abs(point.startY-point.y)<5)return;point.moved=true;forwardScroll(delta);suppressTap=true;}event.preventDefault();event.stopImmediatePropagation();},{capture:true,passive:false});
  function endTouch(event){touches.delete(event.pointerId);if(touches.size<2)pinchDistance=0;}
  document.addEventListener('pointerup',endTouch,true);document.addEventListener('pointercancel',endTouch,true);
  document.addEventListener('click',function(event){if(suppressTap&&(event.pointerType==='touch'||event.pointerType==='pen')){suppressTap=false;event.preventDefault();event.stopImmediatePropagation();}},true);
  // Trackpad pinch emits many ctrl-wheel events. Scale continuously from the
  // event magnitude instead of applying a 25-point button step per event.
  container.addEventListener('wheel',function(event){if(!event.ctrlKey&&!event.metaKey)return;event.preventDefault();var rect=container.getBoundingClientRect(),delta=Math.max(-120,Math.min(120,Number(event.deltaY)||0)),next=state.scale*Math.exp(-delta*.0012);zoom(next,{x:event.clientX-rect.left-(svg.offsetLeft||0),y:event.clientY-rect.top-(svg.offsetTop||0)});},{passive:false});
  container.addEventListener('pointerdown',function(event){if(event.pointerType==='touch'||event.pointerType==='pen'||event.button!==0||event.target.closest('.diagram-nav,.toolbar,.focus-chip,.node-finder,.diagram-guide,.overview-map,.route-probe,.semantic-lens')||event.target.closest('[data-node-id],[data-edge-from]'))return;drag={id:event.pointerId,x:event.clientX,y:event.clientY,startX:state.x,startY:state.y,moved:false};});
  container.addEventListener('pointermove',function(event){if(!drag||event.pointerId!==drag.id)return;var dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(!drag.moved&&Math.hypot(dx,dy)<5)return;drag.moved=true;event.preventDefault();state.x=drag.startX+dx;state.y=drag.startY+dy;container.classList.add('is-panning');try{container.setPointerCapture(event.pointerId);}catch(_){}apply();});
  function endDrag(event){if(!drag||event.pointerId!==drag.id)return;var moved=drag.moved;drag=null;container.classList.remove('is-panning');try{container.releasePointerCapture(event.pointerId);}catch(_){}if(moved){container.setAttribute('data-just-panned','true');setTimeout(function(){container.removeAttribute('data-just-panned');},80);}}
  container.addEventListener('pointerup',endDrag);container.addEventListener('pointercancel',endDrag);
  function installPassportDrag(panelId,handleSelector){var passport=document.getElementById&&document.getElementById(panelId),handle=passport&&passport.querySelector(handleSelector),passportDrag=null;if(!passport||!handle||passport.hasAttribute('data-diffcompass-passport-drag'))return;passport.setAttribute('data-diffcompass-passport-drag','true');handle.setAttribute('data-diffcompass-passport-handle','true');handle.title='Drag to move this panel';function endPassportDrag(event){if(!passportDrag||event.pointerId!==passportDrag.id)return;passport.classList.remove('is-dragging');try{handle.releasePointerCapture(event.pointerId);}catch(_){}passportDrag=null;}handle.addEventListener('pointerdown',function(event){if(event.button!==0||event.target.closest('button,a,input,select,textarea,[contenteditable="true"]'))return;passportDrag={id:event.pointerId,startX:event.clientX,startY:event.clientY,left:passport.offsetLeft||0,top:passport.offsetTop||0,moved:false};try{handle.setPointerCapture(event.pointerId);}catch(_){} });handle.addEventListener('pointermove',function(event){if(!passportDrag||event.pointerId!==passportDrag.id)return;var dx=event.clientX-passportDrag.startX,dy=event.clientY-passportDrag.startY;if(!passportDrag.moved&&Math.hypot(dx,dy)<5)return;passportDrag.moved=true;event.preventDefault();var width=passport.offsetWidth||(passport.getBoundingClientRect&&passport.getBoundingClientRect().width)||0,height=passport.offsetHeight||(passport.getBoundingClientRect&&passport.getBoundingClientRect().height)||0,left=Math.max(0,Math.min(container.clientWidth-width,passportDrag.left+dx)),top=Math.max(0,Math.min(container.clientHeight-height,passportDrag.top+dy));passport.style.left=Math.round(left)+'px';passport.style.top=Math.round(top)+'px';passport.style.right='auto';passport.setAttribute('data-review-panel-moved','true');if(passport.style.setProperty){passport.style.setProperty('--review-panel-x',Math.round(left)+'px');passport.style.setProperty('--review-panel-y',Math.round(top)+'px');}passport.classList.add('is-dragging');try{handle.setPointerCapture(event.pointerId);}catch(_){}});handle.addEventListener('pointerup',endPassportDrag);handle.addEventListener('pointercancel',endPassportDrag);}
  [['focus-chip','.relationship-lens-head'],['route-probe','.route-probe-head'],['semantic-lens','.semantic-lens-head'],['node-finder','.node-finder-head'],['diagram-guide','.diagram-guide-head']].forEach(function(entry){installPassportDrag(entry[0],entry[1]);});
  function refit(){if(sourcePaused)return;if(resizeFrame)cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(function(){resizeFrame=0;if(!sourcePaused)fitAll();});}
  if(typeof ResizeObserver==='function')new ResizeObserver(refit).observe(container);window.addEventListener('resize',refit,{passive:true});fitAll();
}
if(document.readyState==='loading')window.addEventListener('load',function(){requestAnimationFrame(install);},{once:true});else requestAnimationFrame(install);
}())</script>`;
}

function reviewKindLabels(html: string, domainModel = false): string {
  // Our generator uses backend only to satisfy Archify's required category.
  // Override its shared display label before the viewer initializes, keeping
  // node identities, styling, and semantic filtering unchanged.
  return html.replace(/(<script\b[^>]*\bid\s*=\s*["']archify-i18n-data["'][^>]*>)([\s\S]*?)(<\/script\s*>)/gi, (original, open: string, json: string, close: string) => {
    try {
      const data = JSON.parse(json);
      if (!data || typeof data !== "object" || Array.isArray(data)
        || !data.messages || typeof data.messages !== "object" || Array.isArray(data.messages)) return original;
      data.messages["viewer.kind.backend"] = domainModel ? "Domain concept" : "Type unspecified";
      data.messages["viewer.kind.review-unspecified"] = "Type unspecified";
      for (const role of MAP_NODE_ROLES) data.messages[`viewer.kind.review-${role.toLowerCase().replaceAll(" ", "-")}`] = role;
      data.messages["viewer.motion.live"] = "Motion on";
      data.messages["viewer.motion.still"] = "Motion off";
      data.messages["viewer.motion.resume"] = "Enable motion for path playback";
      data.messages["viewer.route.motionRequired"] = "Enable Motion in the toolbar to play this path (unavailable with system reduced motion).";
      return `${open}${JSON.stringify(data).replace(/</g, "\\u003c")}${close}`;
    } catch {
      return original;
    }
  });
}

export function withArchifyEmbedAdapter(html: string, diagramType?: string, domainDetails?: Record<string, DomainNodeDetail>, domainModel = false, nodeRoles?: MapNodeRoles, sequenceSources?: Record<string, SequenceSourceAnchor[]>): string {
  html = applyMapNodeRoles(html, nodeRoles, domainModel).replace("setPassportValue(kind, viewerKindLabel(node.getAttribute('data-node-kind') || 'node'));", "setPassportValue(kind, viewerKindLabel(node.getAttribute('data-node-kind') || 'node')); if(kind)kind.hidden=node.getAttribute('data-node-kind')==='review-unspecified';");
  html = withRouteChoices(html, diagramType === "sequence");
  // Route playback is useful even in artifacts without decorative trace
  // animation. Keep the upstream governor (including reduced-motion checks),
  // but make playback available and opt-in for embedded review maps.
  html = html.replace("var capable = !!(svg && svg.getAttribute('data-animation') === 'trace');", "var capable = !!svg;")
    .replace("readerPaused = readStored() === 'still';", "readerPaused = readStored() !== 'live';");
  const style = `<style data-diffcompass-embed>
html[data-diffcompass-embed="true"],html[data-diffcompass-embed="true"] body{width:100%;height:100%;min-height:0!important;overflow:hidden!important}
html[data-diffcompass-embed="true"] body{padding:0!important;background-image:none!important;display:flex!important;flex-direction:column!important}
html[data-diffcompass-embed="true"] .toolbar{position:static!important;flex:0 0 auto;display:flex;justify-content:flex-end;flex-wrap:wrap;padding:8px;gap:6px}
html[data-diffcompass-embed="true"] .container{width:100%!important;max-width:none!important;flex:1 1 0;min-height:0!important;height:auto!important;margin:0!important}
html[data-diffcompass-embed="true"] .header,html[data-diffcompass-embed="true"] .cards,html[data-diffcompass-embed="true"] .guided-views{display:none!important}
html[data-diffcompass-embed="true"] .diagram-container{box-sizing:border-box!important;height:100%!important;min-height:280px!important;margin:0!important;padding:1rem 1.5rem 4.5rem!important;overflow:hidden!important;touch-action:none}
html[data-diffcompass-embed="true"] .diagram-container>svg{display:block!important;box-sizing:border-box!important;max-width:none!important;min-width:0!important;transform-origin:0 0!important;transition:none!important;will-change:transform}
/* Upstream docking reserves space based on the full diagram dimensions.
   In a fixed review viewport that can put panels above the clipped canvas. */
html[data-diffcompass-embed="true"] :is(.semantic-lens,.route-probe){top:12px!important;bottom:auto!important;max-height:calc(100% - 96px)!important;overflow-y:auto!important;min-width:0!important;max-width:calc(100% - 24px)!important;transform:none!important;animation:none!important}
/* Ignore per-map and responsive docking choices: both tools always open in
   the same corner, independent of diagram geometry, preset, and zoom. */
html[data-diffcompass-embed="true"] :is(#semantic-lens,#route-probe){position:absolute!important;inset:12px 12px auto auto!important;margin:0!important}
html[data-diffcompass-embed="true"] :is(#focus-chip,#semantic-lens,#route-probe,#node-finder,#diagram-guide)[data-review-panel-moved="true"]{position:absolute!important;left:var(--review-panel-x)!important;top:var(--review-panel-y)!important;right:auto!important;bottom:auto!important;transform:none!important}
html[data-diffcompass-embed="true"] [data-diffcompass-passport-handle]{cursor:grab;touch-action:none;user-select:none}
html[data-diffcompass-embed="true"] .is-dragging [data-diffcompass-passport-handle]{cursor:grabbing}
html[data-diffcompass-embed="true"] g[data-node-sublabel="+ Added"]>rect:not(.c-mask){stroke:#2e9d63!important;stroke-width:2.5!important}
html[data-diffcompass-embed="true"] g[data-node-sublabel="~ Changed"]>rect:not(.c-mask){stroke:#c58b19!important;stroke-width:2.5!important}
html[data-diffcompass-embed="true"] g[data-node-sublabel="− Removed"]>rect:not(.c-mask){stroke:#d65b65!important;stroke-width:2.5!important;stroke-dasharray:5 3}
/* Hover highlights the authored edge in place; no travelling overlay that
   can suggest a different destination or inherit renderer arrow markers. */
html[data-diffcompass-embed="true"] .intent-trace-overlay{display:none!important}
html[data-diffcompass-embed="true"] svg[data-intent-trace-active] :is(path,line,polyline)[data-edge-from][data-intent-trace-match]{stroke:var(--frontend-stroke)!important}
html[data-diffcompass-embed="true"] .focus-chip[data-diffcompass-passport-drag="true"] .relationship-lens-head{cursor:grab;touch-action:none}
html[data-diffcompass-embed="true"] .focus-chip[data-diffcompass-passport-drag="true"] .relationship-lens-head:active,html[data-diffcompass-embed="true"] .focus-chip.is-dragging .relationship-lens-head{cursor:grabbing}
${diagramType === "lifecycle" ? 'html[data-diffcompass-embed="true"] .diagram-container>svg>path.a-emphasis:not([data-edge-from]){display:none!important}' : ""}
</style>`;
  return appendToBody(reviewEmbedRoot(reviewKindLabels(html, domainModel)), `${style}<style data-diffcompass-map-nodes>${mapNodeStyles}</style>${domainDetailsScript(domainDetails, domainModel)}${roleEvidenceScript(nodeRoles)}${diagramType === "sequence" && sequenceSources ? sequenceSourceScript(sequenceSources) : ""}${cameraScript(diagramType)}`);
}
