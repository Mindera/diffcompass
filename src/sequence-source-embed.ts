import type { SequenceSourceAnchor } from "./types.ts";

export function sequenceSourceScript(sources: Record<string, SequenceSourceAnchor[]>): string {
  const data = JSON.stringify(sources).replace(/</g, "\\u003c");
  return `<script data-diffcompass-sequence-sources>(function(){
function install(){
  var sources=${data}, saved=null, selected=null, rendered=null, pending=null;
  var svg=document.querySelector('.diagram-container svg'), card=document.getElementById('focus-chip');if(!svg||!card)return;
  var section=document.createElement('section');section.className='diffcompass-message-source';section.hidden=true;card.appendChild(section);
  function open(id,index){
    selected=id;saved=window.Archify?.view?.state?.();window.Archify?.view?.suspend?.();
    parent.postMessage({type:'diffcompass-sequence-source',edgeId:id,anchorIndex:index,present:window.Archify?.presentation?.active?.()===true},'*');
  }
  function render(id,notice){
    rendered=id;section.replaceChildren();section.hidden=!id;if(!id)return;
    var anchors=sources[id]||[], heading=document.createElement('strong');heading.textContent=anchors.some(function(a){return a.definition;})?'Matching definitions':'Source code';section.appendChild(heading);
    if(anchors.some(function(a){return a.definition;})){var hint=document.createElement('p');hint.textContent='Name matches, not verified call targets. Choose the relevant definition.';section.appendChild(hint);}
    anchors.forEach(function(anchor,index){var button=document.createElement('button');button.type='button';button.textContent=(anchor.definition?'View definition':'View code')+' · '+anchor.path+':'+anchor.startLine;button.addEventListener('click',function(){open(id,index);});section.appendChild(button);});
    if(!anchors.length){
      var text=document.createElement('p');text.textContent=notice||'No saved source link. Look up the method named in this message.';section.appendChild(text);
      var find=document.createElement('button');find.type='button';find.textContent=pending===id?'Looking up definition…':'Find definition';find.disabled=pending===id;
      find.addEventListener('click',function(){pending=id;render(id);parent.postMessage({type:'diffcompass-sequence-lookup',edgeId:id},'*');});section.appendChild(find);
    }
  }
  function sync(){var id=card.hidden?null:window.Archify?.focus?.relationship?.()?.id;if(id!==rendered)render(id);}
  // Reuse Archify's arrow hit targets, keyboard handling and relationship rows.
  new MutationObserver(sync).observe(svg,{attributes:true,attributeFilter:['data-relationship-pin-active']});
  new MutationObserver(sync).observe(card,{attributes:true,attributeFilter:['hidden']});
  sync();
  window.addEventListener('message',function(event){
    if(event.source!==parent)return;
    if(event.data?.type==='diffcompass-sequence-lookup-result'){
      var id=event.data.edgeId;if(pending!==id)return;pending=null;sources[id]=event.data.anchors||[];
      if(rendered===id)render(id,event.data.error||'No matching definition found in the available repository search. Try source search for a different name.');
    }
    if(event.data?.type==='diffcompass-sequence-return'){
      if(saved)window.Archify?.view?.restore?.(saved);
      if(selected===rendered)section.querySelector('button')?.focus({preventScroll:true});
    }
  });
}
if(document.readyState==='loading')window.addEventListener('load',install,{once:true});else install();
}())</script><style>.diffcompass-message-source{padding:12px 16px;border-top:1px solid var(--border-color,#334155);font:inherit}.diffcompass-message-source[hidden]{display:none}.diffcompass-message-source p{font-size:12px;line-height:1.5;opacity:.8;margin:6px 0}.diffcompass-message-source button{display:block;text-align:left;margin-top:8px!important;padding:7px 10px!important;border:1px solid #64748b!important;border-radius:6px!important;color:var(--frontend-stroke,#67e8f9)!important;overflow-wrap:anywhere;max-width:100%}.diffcompass-message-source button:disabled{opacity:.6}</style>`;
}
