import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import geometry from "./fixtures/dense-caption-geometry.json";
import briefingGeometry from "./fixtures/briefing-caption-geometry.json";

type Point = { x: number; y: number };
type Box = Point & { width: number; height: number };
type Label = Box & { id: string };
type Path = { id: string; points: Point[]; bounds: Box };
type Position = { id: string; point: Point; anchor: Point; box: Box; collisions: number };
const window = {} as { ReviewDiagramLabels: {
  mount(target: unknown, markup: string): unknown;
  layout(labels: Label[], paths: Path[], nodes: Box[]): Position[];
  resolve(labels: Label[], paths: Path[], nodes: Box[]): {positions: Position[]; paths: (Path & {d?: string})[]};
  segmentHits(a: Point, b: Point, box: Box): boolean;
} };
runInNewContext(readFileSync(new URL("../public/diagram-labels.js", import.meta.url), "utf8"), { window });
const { layout, segmentHits } = window.ReviewDiagramLabels;
const bounds = (points: Point[]): Box => {
  const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y));
  return { x, y, width: Math.max(...points.map(p => p.x)) - x, height: Math.max(...points.map(p => p.y)) - y };
};
const intersects = (a: Box, b: Box) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const paths: Path[] = geometry.paths.map(path => {
  const points: Point[] = [];
  for (let i = 1; i < path.vertices.length; i++) {
    const a = path.vertices[i - 1]!, b = path.vertices[i]!;
    const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4));
    for (let n = 0; n <= count; n++) points.push({ x: a.x + (b.x - a.x) * n / count, y: a.y + (b.y - a.y) * n / count });
  }
  return { id: path.id, points, bounds: bounds(points) };
});

test("dense screenshot topology: all 13 captions clear other arrows, captions and component boxes", () => {
  const positions = layout(geometry.labels, paths, geometry.nodes);
  expect(positions).toHaveLength(13);
  expect(positions.every(p => p.collisions === 0)).toBe(true);
  for (const p of positions) {
    const label = geometry.labels.find(label => label.id === p.id)!;
    const clearance = { x: p.point.x - label.width / 2 - 24, y: p.point.y - label.height / 2 - 24,
      width: label.width + 48, height: label.height + 48 };
    expect(geometry.nodes.some(node => intersects(clearance, node))).toBe(false);
    expect(positions.some(other => other !== p && intersects(p.box, other.box))).toBe(false);
    for (const path of paths.filter(path => path.id !== p.id)) {
      expect(path.points.some((point, i) => i > 0 && segmentHits(path.points[i - 1]!, point, p.box))).toBe(false);
    }
    const own = paths.find(path => path.id === p.id)!;
    expect(own.points.some(point => point.x === p.anchor.x && point.y === p.anchor.y)).toBe(true);
    expect(Math.abs(p.point.y - p.anchor.y)).toBeLessThanOrEqual(40);
  }
});

test("crossing segments are detected even if both sampled endpoints are outside a caption", () => {
  const box = { x: 10, y: 10, width: 40, height: 20 };
  expect(segmentHits({ x: 0, y: 0 }, { x: 100, y: 100 }, box)).toBe(true);
  expect(segmentHits({ x: 0, y: 20 }, { x: 100, y: 20 }, box)).toBe(true);
  expect(segmentHits({ x: 0, y: 0 }, { x: 100, y: 0 }, box)).toBe(false);
});

test("every native Mermaid render mounts through the shared caption boundary", () => {
  const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const exporter = readFileSync(new URL("../src/export.ts", import.meta.url), "utf8");
  const server = readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");
  // Every render result, including regenerated/adaptive/briefing diagrams, must
  // use mount. Catch a future renderer that bypasses caption placement.
  const renders = [...app.matchAll(/const (\w+) = await window\.mermaid\.render\(/g)];
  expect(renders).toHaveLength(5);
  for (const render of renders) {
    const tail = app.slice(render.index!);
    const block = tail.slice(0, tail.indexOf('} catch'));
    expect(block).toMatch(new RegExp('ReviewDiagramLabels\\.mount\\(\\w+, ' + render[1] + '\\.svg\\)'));
    expect(block).not.toMatch(/innerHTML = \w+\.svg/);
  }
  expect(server).toContain('String(diagramLabelsScript) + "\\n" + String(appScript)');
  expect(exporter).toContain('String(diagramLabelsScript)');
  expect(exporter).toContain('window.ReviewDiagramLabels.mount(node,result.svg)');
  expect(app).not.toContain('curve: "step"');
  expect(exporter).not.toContain('curve:"step"');
  const helper = readFileSync(new URL("../public/diagram-labels.js", import.meta.url), "utf8");
  expect(helper).toContain('if (!path.d) continue;');
  expect(helper).not.toContain("flowingLayout");
});

test("unresolved briefing caption crossing reroutes only the offending reads arrow", () => {
  const paths = briefingGeometry.paths.map(p => ({...p, bounds: bounds(p.points)}));
  const before = JSON.stringify({paths, nodes:briefingGeometry.nodes});
  expect(layout(briefingGeometry.labels,paths,briefingGeometry.nodes).some(p => p.collisions > 0)).toBe(true);
  const result = window.ReviewDiagramLabels.resolve(briefingGeometry.labels,paths,briefingGeometry.nodes);
  expect(result.positions.every(p => p.collisions === 0)).toBe(true);
  expect(result.paths.filter(p => p.d).map(p => p.id)).toEqual(['L_component4_component3_0']);
  for (const path of result.paths) {
    for (const label of result.positions.filter(p => p.id !== path.id)) {
      expect(path.points.some((p,i) => i > 0 && segmentHits(path.points[i-1]!,p,label.box))).toBe(false);
    }
    if (!path.d) expect(path).toBe(paths.find(p => p.id === path.id)!);
    else for (const n of briefingGeometry.nodes) {
      const interior = {x:n.x+0.5,y:n.y+0.5,width:n.width-1,height:n.height-1};
      expect(path.points.some((p,i) => i > 0 && segmentHits(path.points[i-1]!,p,interior))).toBe(false);
    }
  }
  expect(JSON.stringify({paths,nodes:briefingGeometry.nodes})).toBe(before);
});

test("a diagram with successful caption placement keeps all original curves", () => {
  const result = window.ReviewDiagramLabels.resolve(geometry.labels,paths,geometry.nodes);
  expect(result.paths).toBe(paths);
  expect(result.positions.every(p => p.collisions === 0)).toBe(true);
});

test("caption placement does not mutate source geometry and is deterministic", () => {
  const before = JSON.stringify({ labels: geometry.labels, paths, nodes: geometry.nodes });
  const first = layout(geometry.labels, paths, geometry.nodes);
  expect(layout(geometry.labels, paths, geometry.nodes)).toEqual(first);
  expect(JSON.stringify({ labels: geometry.labels, paths, nodes: geometry.nodes })).toBe(before);
});

test("placement is geometry-based, independent of diagram IDs and canvas origin", () => {
  const dx = -900, dy = 350;
  const move = <T extends Point>(p: T): T => ({ ...p, x: p.x + dx, y: p.y + dy });
  const rename = (id: string) => `future-diagram-${id}`;
  const shifted = layout(geometry.labels.map(l => ({ ...move(l), id: rename(l.id) })),
    paths.map(p => ({ id: rename(p.id), points: p.points.map(move), bounds: move(p.bounds) })), geometry.nodes.map(move));
  const original = layout(geometry.labels, paths, geometry.nodes);
  expect(shifted).toHaveLength(original.length);
  for (const p of shifted) {
    const source = original.find(o => rename(o.id) === p.id)!;
    expect(p.collisions).toBe(0);
    expect(p.point.x).toBeCloseTo(source.point.x + dx);
    expect(p.point.y).toBeCloseTo(source.point.y + dy);
  }
});

test("shared mounting leaves non-flowchart SVG geometry untouched", () => {
  const attributes: Record<string, string> = {};
  const svg = { dataset: {}, querySelector: () => null,
    setAttribute: (key: string, value: string) => { attributes[key] = value; } };
  const target = { innerHTML: '', querySelector: () => svg };
  expect(window.ReviewDiagramLabels.mount(target, '<svg>sequence diagram</svg>')).toBe(svg);
  expect(target.innerHTML).toBe('<svg>sequence diagram</svg>');
  expect(attributes).toEqual({ 'aria-hidden': 'true' });
  expect(svg.dataset).toEqual({});
});
