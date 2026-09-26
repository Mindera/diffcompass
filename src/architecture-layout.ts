import dagre from "@dagrejs/dagre";
import type { ArchifyJson } from "./types.ts";

type Document = { [key: string]: ArchifyJson };
type Node = Document & { id: string; label: string };
type Edge = Document & { id: string; from: string; to: string; label: string };

/** Lay out the union once so existing nodes never jump between comparison views. */
export async function layoutArchitecture(documents: Document[]): Promise<void> {
  const nodes = new Map<string, Node>();
  const edges = new Map<string, Edge>();
  for (const document of documents) {
    for (const node of document.components as Node[]) nodes.set(node.id, node);
    for (const edge of document.connections as Edge[]) edges.set(edge.id, edge);
  }
  const units = (text: string) => Array.from(text).reduce((sum, c) => sum + (c.charCodeAt(0) > 255 ? 2 : 1), 0);
  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setGraph({ rankdir: "LR", nodesep: 90, edgesep: 40, ranksep: 160, marginx: 50, marginy: 50 });
  for (const node of nodes.values()) graph.setNode(node.id, { width: Math.max(160, Math.ceil(units(node.label) * 7 + 36)), height: 72 });
  for (const edge of edges.values()) graph.setEdge(edge.from, edge.to, { width: units(edge.label) * 5.5 + 24, height: 24, labelpos: "c" }, edge.id);
  dagre.layout(graph);
  for (const document of documents) {
    delete document.layout;
    for (const node of document.components as Node[]) {
      const position = graph.node(node.id);
      delete node.row; delete node.col;
      node.pos = [position.x - position.width / 2, position.y - position.height / 2];
      node.size = [position.width, position.height];
    }
    for (const edge of document.connections as Edge[]) {
      const route = graph.edge({ v: edge.from, w: edge.to, name: edge.id });
      const from = graph.node(edge.from), to = graph.node(edge.to);
      const forward = to.x > from.x;
      const direction = forward ? 1 : -1;
      edge.fromSide = forward ? "right" : "left"; edge.toSide = forward ? "left" : "right";
      const waypoints = [
        [from.x + direction * (from.width / 2 + 32), from.y],
        ...route.points.slice(1, -1).map((point: { x: number; y: number }) => [point.x, point.y]),
        [to.x - direction * (to.width / 2 + 32), to.y],
      ];
      const orthogonal: number[][] = [];
      for (const point of waypoints) {
        const previous = orthogonal.at(-1);
        if (previous && previous[0] !== point[0] && previous[1] !== point[1]) {
          const middle = (previous[0]! + point[0]!) / 2;
          orthogonal.push([middle, previous[1]!], [middle, point[1]!]);
        }
        orthogonal.push(point);
      }
      edge.via = orthogonal;
      edge.labelAt = [route.x, route.y + 4];
      delete edge.labelDy;
    }
    (document.meta as Document).viewBox = [Math.max(480, graph.graph().width!), Math.max(480, graph.graph().height!)];
  }
}
