import type { ArchifyJson } from "./types.ts";

type Document = { [key: string]: ArchifyJson };
type State = Document & { id: string; label: string; initial: boolean; terminal: boolean; boundary?: "initial" | "final" };
type Transition = Document & { from: string; to: string; label?: string };
type Point = [number, number];
type Side = "left" | "right" | "top" | "bottom";
type Box = { x: number; y: number; width: number; height: number };
type Placement = Box & { cx: number; cy: number };
const units = (value: string) => Array.from(value).reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 2 : 1), 0);
const intersects = (a: Box, b: Box, gap = 0) => a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
const segmentBox = (a: Point, b: Point): Box => ({ x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(a[0] - b[0]), height: Math.abs(a[1] - b[1]) });
const distance = (a: Point, b: Point) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
const sides: Side[] = ["right", "bottom", "left", "top"];
class LifecycleLabelPlacementError extends Error {}
function port(box: Placement, side: Side, stub = 0): Point {
  if (side === "left") return [box.x - stub, box.cy];
  if (side === "right") return [box.x + box.width + stub, box.cy];
  if (side === "top") return [box.cx, box.y - stub];
  return [box.cx, box.y + box.height + stub];
}
function simplify(points: Point[]): Point[] {
  const result: Point[] = [];
  for (const p of points) {
    if (result.length && distance(result.at(-1)!, p) === 0) continue;
    while (result.length > 1) {
      const a = result.at(-2)!, b = result.at(-1)!;
      if (distance(a, b) + distance(b, p) !== distance(a, p) || (a[0] !== p[0] && a[1] !== p[1])) break;
      result.pop();
    }
    result.push(p);
  }
  return result;
}

/** The lifecycle renderer has fixed column centers, not an arbitrary XY layout.
 * Use its real bands, wrap additional states vertically, then route on an
 * obstacle grid. No state/event is dropped and the renderer still validates
 * every generated document and delivered artifact. */
export function layoutLifecycle(states: State[], transitions: Transition[]): Document {
  try {
    return layoutLifecycleAttempt(states, transitions, false);
  } catch (error) {
    if (!(error instanceof LifecycleLabelPlacementError)) throw error;
    // Dense fan-in and parallel events may leave no room beside a compact
    // route. A single column gives their verbatim labels wider corridors.
    return layoutLifecycleAttempt(states, transitions, true);
  }
}

function layoutLifecycleAttempt(states: State[], transitions: Transition[], spacious: boolean): Document {
  const boxes = new Map<string, Placement>();
  const active = states.filter(state => !state.terminal);
  // Align exits with their furthest predecessor so fan-in outcomes follow
  // the states that can reach them instead of Mermaid declaration order.
  const predecessor = (id: string) => Math.max(-1, ...transitions.filter(edge => edge.to === id).map(edge => active.findIndex(state => state.id === edge.from)));
  const terminal = states.filter(state => state.terminal).sort((a, b) => predecessor(a.id) - predecessor(b.id));
  // Wider names need fewer columns; labels remain verbatim.
  const width = Math.max(118, ...states.map(state => units(state.label) * 7 + 30));
  if (width > 600) throw new Error("Lifecycle state labels are wider than the supported layout.");
  const mainCols = spacious ? [4] : width <= 124 ? [0, 2, 4] : width <= 400 ? [1, 4] : [4];
  const otherCols = spacious ? [2] : width <= 260 ? [0, 2] : [2];
  const rowGap = spacious ? 240 : 180;
  const lowerRows = Math.ceil(Math.max(0, active.length - mainCols.length) / otherCols.length);
  const terminalY = Math.max(450, 278 + lowerRows * rowGap);
  // Archify's band headings stay fixed even when rows wrap below them.
  const laneLabels = ["States", "Further states", lowerRows > 1 ? "Further states and exits" : "Terminal exits"];
  const placed = states.map(state => {
    const index = (state.terminal ? terminal : active).indexOf(state);
    const main = !state.terminal && index < mainCols.length;
    const cols = main ? mainCols : otherCols;
    const offset = main || state.terminal ? index : index - mainCols.length;
    const col = cols[offset % cols.length]!;
    const y = (main ? 126 : state.terminal ? terminalY : 278) + Math.floor(offset / cols.length) * rowGap;
    const lane = main ? "main" : state.terminal ? "terminal" : "events";
    const cx = (main ? 94 : 402) + col * 154;
    const height = 62;
    boxes.set(state.id, { x: cx - width / 2, y, width, height, cx, cy: y + height / 2 });
    const { initial, terminal: ends, boundary, ...rest } = state;
    const sublabel = boundary ? (boundary === "initial" ? "Initial boundary" : "Final boundary") : [initial && "Initial state", ends && "Terminal exit"].filter(Boolean).join(" · ");
    return { ...rest, type: initial ? "start" : "neutral", lane, col, width, height, yOffset: y - (main ? 126 : ends ? 450 : 278), ...(sublabel ? { sublabel } : {}) };
  });
  const obstacles = [...boxes.values()];
  const routes: Point[][] = [];
  // The fixed bands are presentation guides. Reserve their headings for text.
  const labels: Box[] = [100, 252, 424].map((y, index) => ({ x: 68, y: y - 14, width: Math.max(150, (laneLabels[index]!.length + 5) * 6 + 8), height: 20 }));
  const barriers = [...obstacles, ...labels];
  const xs = [...new Set(barriers.flatMap(b => [b.x + b.width / 2, b.x - 28, b.x + b.width + 28]))].sort((a, b) => a - b);
  const ys = [...new Set(barriers.flatMap(b => [b.y + b.height / 2, b.y - 28, b.y + b.height + 28]))].sort((a, b) => a - b);
  const points: Point[] = ys.flatMap(y => xs.map(x => [x, y] as Point));
  const indexOf = (p: Point) => ys.indexOf(p[1]) * xs.length + xs.indexOf(p[0]);
  const allowed = points.map(p => !barriers.some(b => intersects(segmentBox(p, p), b, 12)));
  const neighbors = points.map((p, index) => [index % xs.length > 0 ? index - 1 : -1, index % xs.length < xs.length - 1 ? index + 1 : -1, index - xs.length, index + xs.length]
    .filter(next => next >= 0 && next < points.length && allowed[next] && !barriers.some(b => intersects(segmentBox(p, points[next]!), b, 12))));

  function route(from: Placement, to: Placement): { points: Point[]; fromSide: Side; toSide: Side } {
    type Search = { key: number; cost: number; score: number; fromSide: Side; previous?: Search };
    const targets = sides.map(side => ({ side, index: indexOf(port(to, side, 28)) }));
    const queue: Search[] = [];
    const best = new Map<number, number>();
    const heuristic = (index: number) => Math.min(...targets.map(target => distance(points[index]!, points[target.index]!)));
    function push(item: Search) {
      if ((best.get(item.key) ?? Infinity) <= item.cost) return;
      best.set(item.key, item.cost);
      queue.push(item);
      let i = queue.length - 1;
      while (i > 0) { const parent = (i - 1) >> 1; if (queue[parent]!.score <= item.score) break; queue[i] = queue[parent]!; i = parent; }
      queue[i] = item;
    }
    function pop(): Search {
      const first = queue[0]!, last = queue.pop()!;
      if (queue.length) {
        let i = 0;
        while (i * 2 + 1 < queue.length) {
          let child = i * 2 + 1;
          if (child + 1 < queue.length && queue[child + 1]!.score < queue[child]!.score) child++;
          if (last.score <= queue[child]!.score) break;
          queue[i] = queue[child]!; i = child;
        }
        queue[i] = last;
      }
      return first;
    }
    for (const [sideIndex, side] of sides.entries()) {
      const index = indexOf(port(from, side, 28));
      if (!allowed[index]) continue;
      const key = index * 16 + sideIndex * 4 + sideIndex;
      // Prefer the visible forward direction; return edges use the upper
      // corridor instead of competing with exits below the phase row.
      const preferred: Side = from === to ? "right" : from.cy === to.cy ? (to.cx > from.cx ? "right" : "top") : to.cy > from.cy ? "bottom" : "top";
      const cost = side === preferred ? 0 : 16;
      push({ key, cost, score: cost + heuristic(index), fromSide: side });
    }
    while (queue.length) {
      const current = pop(), index = Math.floor(current.key / 16), direction = current.key % 4;
      if (best.get(current.key)! < current.cost) continue;
      const target = targets.find(target => target.index === index && direction !== sides.indexOf(target.side) && (from !== to || target.side !== current.fromSide));
      if (target) {
        const path: Point[] = [port(to, target.side)];
        for (let step: Search | undefined = current; step; step = step.previous) path.push(points[Math.floor(step.key / 16)]!);
        path.push(port(from, current.fromSide));
        return { points: simplify(path.reverse()), fromSide: current.fromSide, toSide: target.side };
      }
      for (const next of neighbors[index]!) {
        const a = points[index]!, b = points[next]!;
        const nextDirection = b[0] > a[0] ? 0 : b[1] > a[1] ? 1 : b[0] < a[0] ? 2 : 3;
        if (nextDirection === (direction + 2) % 4) continue;
        const segment = segmentBox(a, b);
        let congestion = 0;
        for (const path of routes) for (let i = 1; i < path.length; i++) {
          if (intersects(segment, segmentBox(path[i - 1]!, path[i]!), 4)) congestion += 600;
        }
        const cost = current.cost + distance(a, b) + (direction === nextDirection ? 0 : 24) + congestion;
        push({ key: next * 16 + sides.indexOf(current.fromSide) * 4 + nextDirection, cost, score: cost + heuristic(next), fromSide: current.fromSide, previous: current });
      }
    }
    throw new Error("Lifecycle connections could not be routed without overlaps.");
  }
  // Establish short direct edges before routing long fan-out around them.
  // Restore source order afterwards: geometry does not reorder the evidence.
  const routingOrder = transitions.map((transition, index) => ({ transition, index })).sort((a, b) => {
    const length = (edge: Transition) => distance([boxes.get(edge.from)!.cx, boxes.get(edge.from)!.cy], [boxes.get(edge.to)!.cx, boxes.get(edge.to)!.cy]);
    return length(a.transition) - length(b.transition);
  });
  const routed: Transition[] = [];
  const sourceRoutes: Point[][] = [];
  for (const { transition, index } of routingOrder) {
    const path = route(boxes.get(transition.from)!, boxes.get(transition.to)!);
    routes.push(path.points);
    sourceRoutes[index] = path.points;
    routed[index] = { ...transition, fromSide: path.fromSide, toSide: path.toSide, via: path.points.slice(1, -1) };
  }
  // Reserve room for long event labels before smaller ones consume it.
  const labelOrder = [...routed.entries()].sort((a, b) => units(b[1].label ?? "") - units(a[1].label ?? ""));
  for (const [index, transition] of labelOrder) {
    if (!transition.label) continue;
    const labelWidth = Math.max(32, units(transition.label) * 4.9 + 12);
    const path = sourceRoutes[index]!;
    const candidates: Point[] = [];
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!, b = path[i]!;
      for (const fraction of [0.5, 0.25, 0.75]) {
        const x = a[0] + (b[0] - a[0]) * fraction, y = a[1] + (b[1] - a[1]) * fraction;
        if (a[1] === b[1] && distance(a, b) >= labelWidth + 16) candidates.push([x, y - 10], [x, y + 22]);
        if (a[0] === b[0] && distance(a, b) >= 40) candidates.push([x + labelWidth / 2 + 10, y + 4], [x - labelWidth / 2 - 10, y + 4]);
      }
    }
    const point = candidates.find(p => {
      const rect = { x: p[0] - labelWidth / 2, y: p[1] - 11, width: labelWidth, height: 16 };
      return rect.x >= 16 && rect.y >= 64 && ![...obstacles, ...labels].some(b => intersects(rect, b, 6)) && !routes.some(route => route.some((b, i) => i > 0 && intersects(rect, segmentBox(route[i - 1]!, b), 4)));
    });
    if (!point) throw new LifecycleLabelPlacementError(`Lifecycle transition label "${transition.label}" could not be placed without overlaps.`);
    transition.labelAt = point;
    labels.push({ x: point[0] - labelWidth / 2, y: point[1] - 11, width: labelWidth, height: 16 });
  }
  return {
    lanes: ["main", "events", "terminal"].map((id, index) => ({ id, label: laneLabels[index]! })),
    states: placed,
    transitions: routed,
    viewBox: [Math.max(860, ...obstacles.map(b => b.x + b.width + 60), ...labels.map(b => b.x + b.width + 40)), Math.max(660, ...obstacles.map(b => b.y + b.height + 150), ...labels.map(b => b.y + b.height + 60))],
  };
}
