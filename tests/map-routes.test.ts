import { expect, test } from "bun:test";
import { enumerateMapRoutes, withRouteChoices } from "../src/map-routes.ts";

test("routes include direct and longer alternatives, preserving parallel edges", () => {
  const result = enumerateMapRoutes([{ from: "A", to: "B" }, { from: "A", to: "C" }, { from: "C", to: "B" }, { from: "A", to: "B" }, { from: "C", to: "A" }], "A", "B");
  expect(result.routes.map(r => r.edges)).toEqual([[0], [3], [1, 2]]);
  expect(result.limited).toBe(false);
});

test("sequence return routes are nonempty and follow message order", () => {
  const edges = [{ from: "B", to: "A" }, { from: "A", to: "B" }, { from: "B", to: "C" }, { from: "C", to: "A" }];
  expect(enumerateMapRoutes(edges, "A", "A", true).routes.map(r => r.edges)).toEqual([[1, 2, 3]]);
  expect(enumerateMapRoutes(edges, "A", "A").routes).toEqual([]);
  expect(enumerateMapRoutes(edges.slice(0, 2), "A", "A", true).routes).toEqual([]);
  expect(enumerateMapRoutes([{ from: "A", to: "A" }], "A", "A", true).routes[0]?.edges).toEqual([0]);
});

test("sequence paths can revisit an intermediate participant without reusing messages", () => {
  const edges = [{ from: "A", to: "B" }, { from: "B", to: "C" }, { from: "C", to: "B" }, { from: "B", to: "D" }];
  expect(enumerateMapRoutes(edges, "A", "D", true).routes.map(r => r.nodes)).toEqual([["A", "B", "D"], ["A", "B", "C", "B", "D"]]);
});

test("route search reports truncation rather than claiming completeness", () => {
  const result = enumerateMapRoutes(Array.from({ length: 25 }, () => ({ from: "A", to: "B" })), "A", "B");
  expect(result.routes).toHaveLength(20);
  expect(result.limited).toBe(true);
});

test("old or non-interactive artifacts are preserved", () => {
  expect(withRouteChoices("<html>No route controller</html>", false)).toBe("<html>No route controller</html>");
});

test("injected controller deduplicates caption fragments and sorts sequence messages by time", () => {
  const template = `Archify.routeProbe = (function () {
      function edges(){ return supplied; }
      function shortestDirectedPath(source, target) { return null; }
      function traceGeometry() {}
      return { find: shortestDirectedPath };
    })();`;
  const edge = (from: string, to: string, key: string, y: number, caption = false) => ({
    getAttribute(name: string) { return ({ 'data-edge-from': from, 'data-edge-to': to, 'data-edge-id': key, 'data-composition-points': `0,${y};10,${y}` } as Record<string, string>)[name] ?? null; },
    matches(selector: string) { return selector === '[data-detail]' ? caption : true; },
  });
  const first = edge('A', 'B', 'out', 10), reply = edge('B', 'A', 'return', 20);
  const supplied = [reply, edge('A', 'B', 'out', 10, true), first];
  const Archify: any = {};
  new Function('Archify', 'supplied', withRouteChoices(template, true))(Archify, supplied);
  expect(Archify.routeProbe.find('A', 'A')).toEqual({ nodes: ['A', 'B', 'A'], edges: [first, reply] });
});
