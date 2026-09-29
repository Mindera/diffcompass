/* Adjust captions without changing Mermaid's node positions; only unresolved
 * collisions permit a checked detour of the offending arrow.
 * Geometry is measured in SVG coordinates so zoom does not affect placement. */
(function () {
  function intersects(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  }
  function segmentHits(a, b, box) {
    // Slab intersection includes a line crossing between samples, not just its ends.
    let low = 0, high = 1;
    for (const [key, extent] of [["x", "width"], ["y", "height"]]) {
      const delta = b[key] - a[key];
      if (Math.abs(delta) < 0.00001) {
        if (a[key] < box[key] || a[key] > box[key] + box[extent]) return false;
      } else {
        const first = (box[key] - a[key]) / delta;
        const last = (box[key] + box[extent] - a[key]) / delta;
        low = Math.max(low, Math.min(first, last));
        high = Math.min(high, Math.max(first, last));
        if (low > high) return false;
      }
    }
    return true;
  }
  function bounds(points) {
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  }
  function boxAt(label, point, padding = 5) {
    return { x: point.x - label.width / 2 - padding, y: point.y - label.height / 2 - padding,
      width: label.width + padding * 2, height: label.height + padding * 2 };
  }
  function fitMasks(svg) {
    const theme = getComputedStyle(svg);
    for (const label of svg.querySelectorAll("g.edgeLabel > g.label")) {
      const paragraph = label.querySelector("p");
      if (!paragraph) continue;
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      const inverse = label.getScreenCTM().inverse();
      const corners = [...range.getClientRects()].flatMap(rect => [
        new DOMPoint(rect.left, rect.top).matrixTransform(inverse),
        new DOMPoint(rect.right, rect.bottom).matrixTransform(inverse),
      ]);
      if (!corners.length) continue;
      const box = bounds(corners);
      // Mermaid reserves a wrap-width column, which can be much wider than the
      // actual text. Mask the real line bounds, with the same 4px horizontal gap
      // for one-line and wrapped captions; keep inter-line space opaque.
      const fill = theme.getPropertyValue("--sequence-background").trim() || theme.getPropertyValue("--code").trim() || "#0b1119";
      label.querySelector("[data-caption-mask]")?.remove();
      const mask = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      mask.setAttribute("data-caption-mask", "");
      mask.setAttribute("x", String(box.x - 4));
      mask.setAttribute("y", String(box.y - 2));
      mask.setAttribute("width", String(box.width + 8));
      mask.setAttribute("height", String(box.height + 4));
      mask.style.setProperty("fill", fill, "important");
      mask.style.setProperty("stroke", "none", "important");
      mask.style.pointerEvents = "none";
      label.prepend(mask);
      for (const element of label.querySelectorAll(".labelBkg, .edgeLabel, p")) {
        element.style.setProperty("background", "transparent", "important");
      }
    }
  }
  function layout(labels, paths, nodes) {
    const placed = [];
    const byId = new Map(paths.map(path => [path.id, path]));
    // Larger captions have fewer usable stretches of curve. Reserve those first.
    for (const label of [...labels].sort((a, b) => b.width * b.height - a.width * a.height)) {
      const own = byId.get(label.id);
      if (!own) continue;
      const candidates = own.points.filter((_, i) => i > 8 && i < own.points.length - 8)
        .flatMap(anchor => [0, -16, 16, -28, 28, -40, 40].map(offset => ({
          point: { x: anchor.x, y: anchor.y + offset }, anchor,
          distance: Math.hypot(anchor.x - label.x, anchor.y - label.y) + Math.abs(offset) * 3,
        })));
      candidates.sort((a, b) => a.distance - b.distance);
      let best;
      for (const { point, anchor, distance } of candidates) {
        const box = boxAt(label, point);
        // Leave room for the arrowhead and a visible stretch of connecting line.
        const nodeClearance = boxAt(label, point, 24);
        const nodeHits = nodes.filter(node => intersects(nodeClearance, node)).length;
        const labelHits = placed.filter(other => intersects(box, other.box)).length;
        let edgeHits = 0;
        for (const path of paths) {
          if (path === own || !intersects(box, path.bounds)) continue;
          if (path.points.some((p, i) => i > 0 && segmentHits(path.points[i - 1], p, box))) edgeHits++;
        }
        const collisions = nodeHits + labelHits + edgeHits;
        const score = nodeHits * 100000 + labelHits * 100000 + edgeHits * 10000 + distance;
        if (!best || score < best.score) best = { id: label.id, point, anchor, box, score, collisions };
        if (collisions === 0) break;
      }
      if (best) placed.push(best);
    }
    return placed;
  }

  function hits(points, box) {
    return points.some((p, i) => i > 0 && segmentHits(points[i - 1], p, box));
  }
  // Only a remaining caption collision permits changing an arrow. Try a smooth
  // detour through an open horizontal lane; never move nodes or unrelated edges.
  function resolve(labels, paths, nodes) {
    let positions = layout(labels, paths, nodes);
    let routed = paths;
    const failures = positions.filter(p => p.collisions > 0);
    for (const failure of failures) {
      for (const path of routed.filter(p => p.id !== failure.id && hits(p.points, failure.box))) {
        const a = path.points[0];
        let b = path.points.at(-1);
        const contains = (n,p) => p.x >= n.x-4 && p.x <= n.x+n.width+4 && p.y >= n.y-4 && p.y <= n.y+n.height+4;
        const target = nodes.find(n => contains(n,b));
        // A bottom-entry port would force an above-node detour through the node.
        // Reattach to a free left-side approach, retaining the same destination.
        const leftEntry = target && b.y > target.y + target.height - 4;
        if (leftEntry) b = { x:target.x-4, y:target.y+Math.min(12,target.height/3) };
        if (b.x - a.x < 120) continue;
        const tangent = (p, q) => {
          const size = Math.hypot(q.x - p.x, q.y - p.y) || 1;
          return { x: (q.x - p.x) / size * 30, y: (q.y - p.y) / size * 30 };
        };
        const start = tangent(a, path.points[1]), end = leftEntry ? {x:30,y:0} : tangent(path.points.at(-2), b);
        const lanes = [...new Set(nodes.flatMap(n => [n.y - 24, n.y + n.height + 24])
          .concat(positions.flatMap(p => [p.box.y - 16, p.box.y + p.box.height + 16])))];
        let best;
        for (const y of lanes) {
          const span = Math.min(100, (b.x - a.x) / 3);
          const left = { x: a.x + span, y }, right = { x: b.x - span, y };
          const c1 = { x: a.x + start.x, y: a.y + start.y };
          const c2 = { x: left.x - span / 2, y };
          const c3 = { x: right.x + span / 2, y };
          const c4 = { x: b.x - end.x, y: b.y - end.y };
          const points = [];
          const cubic = (p, q, r, s) => {
            const count = Math.ceil((Math.hypot(q.x-p.x,q.y-p.y) + Math.hypot(r.x-q.x,r.y-q.y) + Math.hypot(s.x-r.x,s.y-r.y)) / 2);
            for (let i = 0; i <= count; i++) {
              const t = i / count, u = 1-t;
              points.push({ x:u*u*u*p.x+3*u*u*t*q.x+3*u*t*t*r.x+t*t*t*s.x,
                y:u*u*u*p.y+3*u*u*t*q.y+3*u*t*t*r.y+t*t*t*s.y });
            }
          };
          cubic(a,c1,c2,left);
          points.push(right);
          cubic(right,c3,c4,b);
          if (nodes.some(n => hits(points,{x:n.x+0.5,y:n.y+0.5,width:n.width-1,height:n.height-1}))) continue;
          if (positions.some(p => p.id !== path.id && hits(points,p.box))) continue;
          const coord = p => p.x + ',' + p.y;
          const candidate = { ...path, points, bounds:bounds(points),
            d:'M'+coord(a)+' C'+coord(c1)+' '+coord(c2)+' '+coord(left)+' L'+coord(right)+' C'+coord(c3)+' '+coord(c4)+' '+coord(b) };
          const next = routed.map(p => p.id === path.id ? candidate : p);
          const nextPositions = layout(labels,next,nodes);
          if (nextPositions.some(p => p.collisions > 0)) continue;
          const length = points.reduce((sum,p,i) => sum + (i ? Math.hypot(p.x-points[i-1].x,p.y-points[i-1].y) : 0),0);
          if (!best || length < best.length) best = { paths:next, positions:nextPositions, length };
        }
        if (best) { routed = best.paths; positions = best.positions; break; }
      }
    }
    return { paths:routed, positions };
  }
  function place(svg) {
    if (!svg || svg.dataset.captionLayout) return [];
    // Sequence/ER/state diagrams have their own label geometry. Leave them alone.
    if (!svg.querySelector('path.flowchart-link[data-id]')) return [];
    // Collapsed briefing/diff sections have no measurable geometry. Measure a
    // temporary copy, then transfer captions and any checked edge detour.
    if (!svg.getBoundingClientRect().width) {
      const stage = document.createElement("div");
      stage.className = "architecture-diagram architecture-node-skin";
      stage.style.cssText = "position:fixed;left:-100000px;top:0;width:1200px;display:block;visibility:hidden;pointer-events:none";
      const copy = svg.cloneNode(true);
      stage.append(copy);
      document.body.append(stage);
      try {
        if (!copy.getBoundingClientRect().width) return [];
        const positions = place(copy);
        const copiedPaths = new Map([...copy.querySelectorAll('path.flowchart-link[data-id]')].map(p => [p.dataset.id, p]));
        for (const path of svg.querySelectorAll('path.flowchart-link[data-id]')) {
          const measured = copiedPaths.get(path.dataset.id);
          if (measured?.dataset.captionRerouted) {
            path.setAttribute('d', measured.getAttribute('d'));
            path.dataset.captionRerouted = 'true';
          }
        }
        const leaders = copy.querySelector('[data-caption-leaders]');
        svg.querySelector('[data-caption-leaders]')?.remove();
        if (leaders) svg.prepend(leaders.cloneNode(true));
        const groups = new Map([...copy.querySelectorAll("g.edgeLabel")].map(element => [element.querySelector("g.label[data-id]")?.dataset.id, element]));
        for (const element of svg.querySelectorAll("g.edgeLabel")) {
          const measured = groups.get(element.querySelector("g.label[data-id]")?.dataset.id);
          if (measured) {
            element.setAttribute("transform", measured.getAttribute("transform"));
            element.replaceChildren(...[...measured.childNodes].map(child => child.cloneNode(true)));
          }
        }
        svg.setAttribute("viewBox", copy.getAttribute("viewBox"));
        if (copy.dataset.captionLayout) svg.dataset.captionLayout = copy.dataset.captionLayout;
        return positions;
      } finally { stage.remove(); }
    }
    if (!svg.getScreenCTM()) return [];
    fitMasks(svg);
    const inverse = svg.getScreenCTM().inverse();
    const matrixFor = element => inverse.multiply(element.getScreenCTM());
    const pointAt = (point, matrix) => new DOMPoint(point.x, point.y).matrixTransform(matrix);
    const rectangle = element => {
      const b = element.getBBox(), matrix = matrixFor(element);
      return bounds([{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y },
        { x: b.x, y: b.y + b.height }, { x: b.x + b.width, y: b.y + b.height }].map(p => pointAt(p, matrix)));
    };
    const paths = [...svg.querySelectorAll("path.flowchart-link[data-id]")].map(element => {
      const matrix = matrixFor(element), length = element.getTotalLength();
      const count = Math.max(8, Math.min(2048, Math.ceil(length / 4)));
      const points = Array.from({ length: count + 1 }, (_, i) => pointAt(element.getPointAtLength(length * i / count), matrix));
      return { id: element.dataset.id, element, points, bounds: bounds(points), matrix };
    });
    const labels = [...svg.querySelectorAll("g.edgeLabel")].flatMap(element => {
      const id = element.querySelector("g.label[data-id]")?.dataset.id;
      if (!id || !element.textContent.trim()) return [];
      const b = rectangle(element);
      return [{ id, element, width: b.width, height: b.height, x: b.x + b.width / 2, y: b.y + b.height / 2 }];
    });
    const resolved = resolve(labels, paths, [...svg.querySelectorAll("g.node")].map(rectangle));
    const positions = resolved.positions;
    for (const path of resolved.paths) {
      if (!path.d) continue;
      // Route coordinates are in root SVG space; retain the path's own transform.
      const inversePath = path.matrix.inverse();
      const localD = path.d.replace(/(-?[\d.e+]+),(-?[\d.e+]+)/g, (_, x, y) => {
        const p = pointAt({x:Number(x),y:Number(y)}, inversePath);
        return p.x + ',' + p.y;
      });
      path.element.setAttribute('d', localD);
      path.element.dataset.captionRerouted = 'true';
    }
    const leaders = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    leaders.setAttribute('data-caption-leaders', '');
    leaders.style.pointerEvents = 'none';
    for (const position of positions) {
      if (Math.abs(position.point.y - position.anchor.y) < 1) continue;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(position.anchor.x)); line.setAttribute('y1', String(position.anchor.y));
      line.setAttribute('x2', String(position.point.x)); line.setAttribute('y2', String(position.point.y));
      line.setAttribute('stroke', 'var(--text-soft, #a6b0c0)'); line.setAttribute('stroke-width', '0.75');
      line.setAttribute('stroke-dasharray', '2 2');
      leaders.append(line);
    }
    svg.querySelector('[data-caption-leaders]')?.remove();
    svg.prepend(leaders);
    for (const position of positions) {
      const element = labels.find(label => label.id === position.id).element;
      const local = pointAt(position.point, matrixFor(element.parentNode).inverse());
      const b = element.getBBox();
      element.setAttribute("transform", `translate(${local.x - b.x - b.width / 2}, ${local.y - b.y - b.height / 2})`);
    }
    // A caption moved towards an outer curve must not be clipped by the old box.
    const view = svg.viewBox.baseVal;
    if (positions.length && view.width > 0 && view.height > 0) {
      const x = Math.min(view.x, ...positions.map(p => p.box.x - 4));
      const y = Math.min(view.y, ...positions.map(p => p.box.y - 4));
      const right = Math.max(view.x + view.width, ...positions.map(p => p.box.x + p.box.width + 4));
      const bottom = Math.max(view.y + view.height, ...positions.map(p => p.box.y + p.box.height + 4));
      svg.setAttribute("viewBox", `${x} ${y} ${right - x} ${bottom - y}`);
    }
    svg.dataset.captionLayout = 'true';
    return positions;
  }
  // All native Mermaid renderers (including exports) mount through this boundary.
  // A newly generated SVG always receives caption placement before pan/zoom.
  function mount(target, markup) {
    target.innerHTML = markup;
    const svg = target.querySelector('svg');
    place(svg);
    svg?.setAttribute('aria-hidden', 'true');
    return svg;
  }
  window.ReviewDiagramLabels = { mount, place, layout, resolve, segmentHits };
})();
