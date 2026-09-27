export interface RouteEdge { from: string; to: string }

/** Breadth-first, bounded path enumeration. Sequence edges must be in message order. */
export function enumerateMapRoutes(edges: RouteEdge[], source: string, target: string, sequence = false, limit = 20) {
  const routes: { nodes: string[]; edges: number[] }[] = [];
  const queue = [{ nodes: [source], edges: [] as number[], last: -1 }];
  let cursor = 0;
  const budget = 10000;
  while (cursor < queue.length && cursor < budget && routes.length <= limit) {
    const path = queue[cursor++]!;
    for (let index = 0; index < edges.length; index++) {
      const edge = edges[index]!;
      if (edge.from !== path.nodes[path.nodes.length - 1]) continue;
      if (sequence ? index <= path.last : path.nodes.includes(edge.to)) continue;
      const next = { nodes: [...path.nodes, edge.to], edges: [...path.edges, index], last: index };
      if (edge.to === target) routes.push(next);
      else if (queue.length < budget) queue.push(next);
      // Limit both results and queued work, even for highly connected maps.
      if (routes.length > limit) break;
    }
  }
  return { routes: routes.slice(0, limit), limited: routes.length > limit || queue.length >= budget };
}

/** Patch only the Route Probe closure; preserve upstream playback and export. */
export function withRouteChoices(html: string, sequence: boolean): string {
  const start = html.indexOf("Archify.routeProbe = (function () {");
  const end = html.indexOf("      function traceGeometry", start);
  if (start < 0 || end < 0) return html;
  const oldStart = html.indexOf("      function shortestDirectedPath(source, target)", start);
  if (oldStart < 0 || oldStart > end) return html;
  const helper = `
      var reviewRoutes = [], reviewRouteIndex = 0, reviewRoutesLimited = false, reviewRoutePicker;
      var reviewSequence = ${sequence};
      var enumerateReviewRoutes = ${enumerateMapRoutes.toString()};
      function reviewEdges() {
        var seen = new Set();
        var all = edges().filter(function(edge){
          if(edge.matches('[data-detail]'))return false;
          var key=edge.getAttribute('data-edge-id')||edge.getAttribute('data-edge-key');
          if(key!==null){if(seen.has(key))return false;seen.add(key);}return true;
        });
        if(reviewSequence)all.sort(function(a,b){
          function y(edge){var shape=edge.matches('[data-composition-points]')?edge:edge.querySelector('[data-composition-points]');return shape?Number(shape.getAttribute('data-composition-points').split(';')[0].split(',')[1]):edges().indexOf(edge);}
          return y(a)-y(b);
        });
        return all;
      }
      function reviewFindRoutes(source, target) {
        var all = reviewEdges();
        var result = enumerateReviewRoutes(all.map(function(edge){return {from:edge.getAttribute('data-edge-from'),to:edge.getAttribute('data-edge-to')};}), source, target, reviewSequence);
        return {limited:result.limited, routes:result.routes.map(function(route){return {nodes:route.nodes,edges:route.edges.map(function(index){return all[index];})};})};
      }
      function reviewRenderChoices() {
        if (!reviewRoutePicker) {
          reviewRoutePicker = document.createElement('label');
          reviewRoutePicker.style.cssText = 'display:block;padding:8px 12px;font:12px/1.6 system-ui';
          var caption = document.createElement('span'); caption.textContent = 'Route '; reviewRoutePicker.appendChild(caption);
          var select = document.createElement('select'); select.setAttribute('aria-label','Choose route');
          select.style.cssText = 'max-width:100%;padding:6px;background:#101827;color:#e2e8f0;border:1px solid #64748b;border-radius:6px';
          select.addEventListener('change',function(){reviewRouteIndex=Number(select.value);showResult(reviewRoutes[reviewRouteIndex]);});
          reviewRoutePicker.appendChild(select); path.before(reviewRoutePicker);
        }
        var select = reviewRoutePicker.querySelector('select'); select.replaceChildren();
        var byId = nodesById();
        reviewRoutes.forEach(function(route,index){var option=document.createElement('option');option.value=String(index);option.textContent=(index+1)+' / '+reviewRoutes.length+' · '+route.nodes.map(function(id){return nodeLabel(byId[id],id);}).join(' → ')+' · '+(reviewSequence?'messages '+route.edges.map(function(edge){return reviewEdges().indexOf(edge)+1;}).join(', '):route.edges.map(function(edge){return edge.getAttribute('data-edge-label')||'connection';}).join(' / '));select.appendChild(option);});
        select.value=String(reviewRouteIndex); select.disabled=reviewRoutes.length<2;
      }
      function shortestDirectedPath(source,target) {
        var found=reviewFindRoutes(source,target);reviewRoutes=found.routes;reviewRoutesLimited=found.limited;reviewRouteIndex=0;
        return reviewRoutes[0] || null;
      }
`;
  html = html.slice(0, oldStart) + helper + html.slice(end);
  // Restrict replacements to this closure, not other graph/focus controllers.
  const close = html.indexOf("    })();", start);
  let probe = html.slice(start, close);
  probe = probe.replace("if (id === startId) {", "if (id === startId && !reviewSequence) {");
  probe = probe.replace("        return showResult(result, options);", "        var choice=Number(options.routeChoice)||0;if(Number.isInteger(choice)&&choice>=0&&choice<reviewRoutes.length){reviewRouteIndex=choice;result=reviewRoutes[choice];}\n        return showResult(result, options);");
  probe = probe.replace("choose(parts[1], { updateUrl: false });", "choose(parts[1], { updateUrl: false, routeChoice: params.get('route-choice') });");
  probe = probe.replace("replaceRouteHash(encodeURIComponent(startId) + '~' + encodeURIComponent(endId));", "replaceRouteHash(encodeURIComponent(startId) + '~' + encodeURIComponent(endId) + '&route-choice=' + reviewRouteIndex);");
  probe = probe.replace("+ encodeURIComponent(endId);", "+ encodeURIComponent(endId) + '&route-choice=' + reviewRouteIndex;");
  probe = probe.replace("        showJourneyOverview({ reveal: false });", "        showJourneyOverview({ reveal: false });\n        reviewRenderChoices();");
  // Repeated sequence participants share one SVG node. The active occurrence
  // wins instead of a later occurrence overwriting its playback highlight.
  probe = probe.replace("        activeEdges.forEach(function (edge, step) {", "        if(byId[activeNodeIds[journeyIndex]]){byId[activeNodeIds[journeyIndex]].setAttribute('data-route-journey-state','current');byId[activeNodeIds[journeyIndex]].setAttribute('data-route-journey-current','');}\n        activeEdges.forEach(function (edge, step) {");
  probe = probe.replace("        renderOverlay(result.edges);", "        result.edges.forEach(function(selected){edges().forEach(function(edge){if(edge.getAttribute('data-edge-id') && edge.getAttribute('data-edge-id')===selected.getAttribute('data-edge-id'))edge.setAttribute('data-route-match','');});});\n        renderOverlay(result.edges);");
  probe = probe.replace(/return viewerText\('viewer.route.overview.status', \{[\s\S]*?\}\);/, "return activeEdges.length + ' connections · route ' + (reviewRouteIndex+1) + ' of ' + reviewRoutes.length + (reviewRoutesLimited ? ' (search limit reached)' : '') + (reviewSequence ? ' · messages in diagram order' : ' · directed paths without repeated components');");
  probe = probe.replace("        var reached = reachableFrom(id);", "        if(reviewRoutePicker)reviewRoutePicker.remove();reviewRoutePicker=null;\n        var reached = reachableFrom(id);\n        if(reviewSequence){Object.keys(reached).forEach(function(candidate){if(!reviewFindRoutes(id,candidate).routes.length)delete reached[candidate];});}");
  probe = probe.replace("candidateId !== id && byId[candidateId]", "(candidateId !== id || reviewSequence) && byId[candidateId]");
  probe = probe.replace("Object.keys(reached).length - 1", "Object.keys(reached).length - (reviewSequence ? 0 : 1)");
  probe = probe.replace("return id !== startId && byId[id];", "return byId[id] && (reviewSequence ? reviewFindRoutes(startId,id).routes.length > 0 : id !== startId);");
  probe = probe.replace("from === to) return;", "(from === to && !reviewSequence)) return;");
  probe = probe.replace("function clear(options) {", "function clear(options) {\n        if(reviewRoutePicker)reviewRoutePicker.remove();reviewRoutePicker=null;");
  return html.slice(0, start) + probe + html.slice(close);
}
