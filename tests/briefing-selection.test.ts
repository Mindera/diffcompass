import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

/** Exercise messages crossing in flight, with native focus observed asynchronously. */
function harness(sequence: boolean) {
  let node: string | null = null, edge: string | null = null;
  let observe = () => {};
  const listeners = new Map<string, (event: any) => void>();
  const messages: string[] = [];
  const parent = { postMessage(message: any) { if (message.type.endsWith("-select")) messages.push(message.elementId); } };
  const svg = {
    addEventListener() {}, removeEventListener() {}, hasAttribute: () => false,
    querySelectorAll: () => [], querySelector: () => null,
  };
  const focus = {
    set(id: string) { node = id; edge = null; return true; },
    inspectRelationshipById(id: string) { edge = id; node = null; return true; },
    active: () => node, relationship: () => edge ? { id: edge } : null,
    clear() { node = edge = null; },
  };
  const window: any = {
    parent, Archify: { focus },
    addEventListener: (type: string, listener: (event: any) => void) => listeners.set(type, listener),
    removeEventListener() {},
  };
  const document = {
    readyState: "complete", documentElement: { setAttribute() {} },
    querySelector: (selector: string) => selector === ".diagram-container" ? { querySelector: () => svg } : svg,
  };
  const runtime = readFileSync(new URL(sequence ? "../public/sequence-walkthrough.js" : "../public/briefing-diagram.js", import.meta.url), "utf8");
  runInNewContext(runtime, { window, document, MutationObserver: class {
    constructor(callback: () => void) { observe = callback; }
    observe() {} disconnect() {}
  } });
  if (sequence) window.DiffCompassSequenceWalkthrough.installArchify([
    { id: "a", label: "Same", from: "caller", to: "service" },
    { id: "b", label: "Same", from: "service", to: "caller" },
  ], false, true);
  else window.installBriefingDiagram([{ id: "a", kind: "components" }, { id: "b", kind: "connections" }]);
  return {
    messages,
    selected: () => edge ?? node,
    native(id: string) { if (!sequence && id === "a") focus.set(id); else focus.inspectRelationshipById(id); observe(); },
    command(id: string | null, source: unknown = parent) {
      listeners.get("message")!({ source, data: { type: "diffcompass-briefing-diagram-select", elementId: id } });
      observe();
    },
  };
}

for (const sequence of [false, true]) {
  test(`${sequence ? "sequence" : "map"} host acknowledgements never replay older user selections`, () => {
    const viewer = harness(sequence);
    viewer.native("a");
    viewer.native("b");
    // The parent has already received both selections, but its earlier reply is
    // still in flight. Re-emitting either reply starts an endless feedback loop.
    viewer.command("a");
    viewer.command("b");
    expect(viewer.messages).toEqual(["a", "b"]);
    expect(viewer.selected()).toBe("b");
    viewer.command(null);
    expect(viewer.selected()).toBeNull();
    expect(viewer.messages).toEqual(["a", "b"]);
    viewer.command("a", {});
    expect(viewer.selected()).toBeNull();
  });
}
