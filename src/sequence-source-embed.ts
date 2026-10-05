import type { SequenceSourceAnchor } from "./types.ts";

export function sequenceSourceScript(sources: Record<string, SequenceSourceAnchor[]>, offline = false): string {
  const data = JSON.stringify(sources).replace(/</g, "\\u003c");
  return `<script data-diffcompass-sequence-sources>(function(){
function install(){
  var sources=${data}, saved=null, selected=null, rendered=null, pending=null, notices={}, refreshNotice='', offline=${offline};
  var requestSerial=0, pendingRequest=null, lookupTimer=null, codePane=null;
  var svg=document.querySelector('.diagram-container svg'), card=document.getElementById('focus-chip');if(!svg||!card)return;
  var section=document.createElement('section');section.className='diffcompass-message-source';section.hidden=true;card.appendChild(section);
  function pathActive(){return !!window.Archify?.routeProbe?.active?.();}
  function open(id,index,indices){
    if(offline)return;
    // Keep the existing path in this retained iframe. Pause before the async
    // host navigation, so reading source cannot advance its current message.
    var route=window.Archify?.routeProbe;
    if(pathActive()&&typeof route.pauseJourney==='function')route.pauseJourney({preserveElapsed:true,reason:'source'});
    selected=id;saved=window.Archify?.view?.state?.();window.Archify?.view?.suspend?.();
    parent.postMessage({type:'diffcompass-sequence-source',edgeId:id,anchorIndex:index,...(indices===undefined?{}:{anchorIndices:indices}),present:window.Archify?.presentation?.active?.()===true},'*');
  }
  function lookup(id){
    if(offline||pending)return;pending=id;notices[id]='';if(rendered===id)render(id);
    pendingRequest=++requestSerial;
    lookupTimer=setTimeout(function(){
      pending=null;pendingRequest=null;lookupTimer=null;
      notices[id]='Definition lookup timed out. You can retry.';
      if(rendered===id)render(id,notices[id]);window.diffcompassSequenceSourceActions?.onChange?.(id,true);
    },30000);
    window.diffcompassSequenceSourceActions?.onChange?.(id);
    parent.postMessage({type:'diffcompass-sequence-lookup',edgeId:id,requestId:pendingRequest},'*');
  }
  // A successfully mounted pane owns source presentation for its exact IDs.
  // Keep the original source actions when that capability is absent.
  function registerCodePane(pane){
    codePane=pane;
    function refresh(){if(codePane===pane&&rendered)render(rendered,notices[rendered]||refreshNotice);}
    refresh();
    return {refresh:refresh,dispose:function(){if(codePane===pane){codePane=null;if(rendered)render(rendered,notices[rendered]||refreshNotice);}}};
  }
  window.diffcompassSequenceSourceActions={open:open,lookup:lookup,pathActive:pathActive,registerCodePane:registerCodePane,anchors:function(id){return sources[id]||[];},pending:function(id){return pending===id;},busy:function(){return pending!==null;},ready:function(){return !refreshNotice;},notice:function(id){return notices[id]||refreshNotice;}};
  function render(id,notice){
    rendered=id;section.replaceChildren();section.hidden=!id;if(!id)return;
    if(codePane&&codePane.has(id)){
      section.hidden=!codePane.collapsed();if(section.hidden)return;
      var pane=codePane, show=document.createElement('button');show.type='button';show.textContent='Show code step';show.setAttribute('aria-controls','sequence-code-steps');
      show.addEventListener('click',function(){if(codePane===pane)pane.show(id);});section.appendChild(show);return;
    }
    var anchors=sources[id]||[], heading=document.createElement('strong');heading.textContent=anchors.some(function(a){return a.definition;})?'Matching definitions':'Source code';section.appendChild(heading);
    if(anchors.some(function(a){return a.definition;})){var hint=document.createElement('p');hint.textContent='Name matches, not verified call targets. Choose the relevant definition.';section.appendChild(hint);}
    anchors.forEach(function(anchor,index){var button=document.createElement(offline?'p':'button');if(!offline)button.type='button';button.textContent=(anchor.definition&&!anchor.comparisonMatch?'Current workspace':anchor.side==='old'?'Before':'After')+' · View code · '+anchor.path+':'+anchor.startLine;if(!offline)button.addEventListener('click',function(){open(id,index);});section.appendChild(button);});
    if(!anchors.length){
      var text=document.createElement('p');text.textContent=notice||(offline?'No saved source evidence. Definition lookup needs a live review.':'No saved source link. Look up the method named in this message.');section.appendChild(text);
      if(offline)return;
      var find=document.createElement('button');find.type='button';find.textContent=pending===id?'Looking up definition…':'Find definition';find.disabled=pending===id;
      find.addEventListener('click',function(){lookup(id);});section.appendChild(find);
    }
  }
  function sync(){var id=card.hidden?null:window.Archify?.focus?.relationship?.()?.id;if(id!==rendered)render(id);}
  // Reuse Archify's arrow hit targets, keyboard handling and relationship rows.
  new MutationObserver(sync).observe(svg,{attributes:true,attributeFilter:['data-relationship-pin-active']});
  new MutationObserver(sync).observe(card,{attributes:true,attributeFilter:['hidden']});
  sync();
  window.addEventListener('message',function(event){
    if(event.source!==parent)return;
    if(!offline&&event.data?.type==='diffcompass-sequence-evidence'){
      clearTimeout(lookupTimer);lookupTimer=null;pendingRequest=null;
      sources=event.data.sources||{};pending=null;notices={};refreshNotice=event.data.notice||'';
      if(rendered)render(rendered,refreshNotice);window.diffcompassSequenceSourceActions?.onReset?.();
    }
    if(event.data?.type==='diffcompass-sequence-lookup-result'){
      var id=event.data.edgeId;if(offline||pending!==id||event.data.requestId!==pendingRequest)return;
      clearTimeout(lookupTimer);lookupTimer=null;pendingRequest=null;pending=null;sources[id]=event.data.anchors||[];
      notices[id]=event.data.error||'No matching definition found in the available repository search. Try source search for a different name.';
      if(rendered===id)render(id,notices[id]);window.diffcompassSequenceSourceActions?.onChange?.(id);
    }
    if(event.data?.type==='diffcompass-sequence-return'){
      if(saved)window.Archify?.view?.restore?.(saved);
      if(selected===rendered)section.querySelector('button')?.focus({preventScroll:true});
    }
  });
  window.addEventListener('pagehide',function(){clearTimeout(lookupTimer);pending=null;pendingRequest=null;},{once:true});
}
if(document.readyState==='loading')window.addEventListener('load',install,{once:true});else install();
}())</script><style>.diffcompass-message-source{padding:12px 16px;border-top:1px solid var(--border-color,#334155);font:inherit}.diffcompass-message-source[hidden]{display:none}.diffcompass-message-source p{font-size:12px;line-height:1.5;opacity:.8;margin:6px 0}.diffcompass-message-source button{display:block;text-align:left;margin-top:8px!important;padding:7px 10px!important;border:1px solid #64748b!important;border-radius:6px!important;color:var(--frontend-stroke,#67e8f9)!important;overflow-wrap:anywhere;max-width:100%}.diffcompass-message-source button:disabled{opacity:.6}</style>`;
}
