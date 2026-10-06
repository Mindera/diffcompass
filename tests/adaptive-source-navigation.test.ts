import {expect, test} from "bun:test";
const app = await Bun.file(new URL("../public/app.js", import.meta.url)).text();
function declaration(name: string) {
  const start = app.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Missing ${name}`);
  return app.slice(start, app.indexOf("\n}", start) + 2);
}
function navigation(native = false) {
  const calls: any[] = [], pending: Array<() => void> = [];
  const frame = {dataset: {archifyArtifactId:"lifecycle-state-machine"}, isConnected: true, focus: (options: unknown) => calls.push(["frame-focus", options])};
  const replacement = {focus: (options: unknown) => calls.push(["replacement-focus", options])};
  const source: any = {
    isConnected: true, dataset: {flowFile: "src/receipt-job.ts"},
    closest: (selector: string) => selector === `#${native ? "adaptive" : "archify"}-view` ? {}
      : selector === (native ? ".adaptive-card" : ".archify-artifact") ? {querySelector: (query: string) => query === "iframe.archify-frame" ? native ? null : frame : {dataset:{adaptiveDiagram:"state"}}} : null,
    focus: (options: unknown) => calls.push(["source-focus", options]),
  };
  const id = "lifecycle-state-machine", view = native ? "adaptive" : "archify";
  const state: any = {
    activeTab: view, archifyArtifactId: id, structuralGraphReturn: {}, sequenceSourceReturn: null,
    tabScrollPositions: new Map([[view, 0]]),
    architectureDiagramViews: new Map([["state", {x: 20, y: 40, scale: 1.5}]]),
  };
  const elements: any = {"diff-panel": {scrollTop: 235}, [`${view}-view`]: {querySelector: () => replacement}};
  let choices = [{id, key:"state"}];
  const activate = (view: string) => {
    calls.push(["activate", view]); state.activeTab = view;
    const saved = state.tabScrollPositions.get(view) ?? 0;
    pending.push(() => {elements["diff-panel"].scrollTop = saved;});
  };
  const methods = new Function("state", "elements", "archifyArtifacts", "adaptiveEntries", "activateReviewTab", "openMaps", "toast", "updateSequenceSourceReturnVisibility", "showAnalysisFile", "finishArchitectureDiagramDrag", [
    "rememberAdaptiveDiagramReturn", "returnToAdaptiveDiagram", "returnToSequenceDiagram", "registerArchitectureDiagramInteractions",
  ].map(declaration).join("\n") + ";return {remember:rememberAdaptiveDiagramReturn,back:returnToSequenceDiagram,register:registerArchitectureDiagramInteractions};")(
    state, elements, () => choices, () => choices, activate, (view: string) => {calls.push(["render", view]); activate(view);},
    (message: string) => calls.push(["toast", message]), () => calls.push(["visible", Boolean(state.sequenceSourceReturn) && state.activeTab === "diff"]),
    (path: string) => {calls.push(["source", path, Boolean(state.sequenceSourceReturn)]); state.activeTab = "diff";}, () => {},
  );
  const handlers: Record<string, Function> = {};
  methods.register({addEventListener: (event: string, handler: Function) => {handlers[event] = handler;}});
  return {state, view, frame, source, calls, elements, ...methods,
    click: () => handlers.click!({target: {closest: (selector: string) => selector === "[data-flow-file]" ? source : null}}),
    replaceChoices: (value: typeof choices) => {choices = value;}, paint: () => pending.splice(0).forEach(callback => callback()),
  };
}

for (const native of [false, true]) test(`adaptive source return preserves the ${native ? "Mermaid" : "interactive"} destination and scroll position`, () => {
  const n = navigation(native);
  const camera = n.state.architectureDiagramViews.get("state");
  n.click();
  expect(n.calls).toEqual([["source", "src/receipt-job.ts", true]]);
  expect(n.state.structuralGraphReturn).toBeNull();
  expect(n.state.sequenceSourceReturn).toMatchObject({view:n.view, diagram:true, ...(native ? {nativeKey:"state"} : {artifactId:"lifecycle-state-machine"}), scrollTop:235});
  n.elements["diff-panel"].scrollTop = 900;
  n.back(); n.paint();
  expect(n.state.activeTab).toBe(n.view);
  expect(n.state.sequenceSourceReturn).toBeNull();
  expect(n.elements["diff-panel"].scrollTop).toBe(235);
  expect(n.calls).toContainEqual([native ? "source-focus" : "frame-focus", {preventScroll: true}]);
  expect(n.calls.some((call: any[]) => call[0] === "render")).toBe(false);
  expect(n.calls.at(-1)).toEqual(["visible", false]);
  expect(n.state.architectureDiagramViews.get("state")).toBe(camera);
});

test("a replaced adaptive artifact returns to its current rendering without focusing a detached iframe", () => {
  const n = navigation(); n.click(); n.frame.isConnected = false; n.source.isConnected = false;
  n.state.archifyArtifactId = "dataflow-data-model";
  n.back(); n.paint();
  expect(n.state.archifyArtifactId).toBe("lifecycle-state-machine");
  expect(n.calls).toContainEqual(["render", n.view]);
  expect(n.calls).toContainEqual(["replacement-focus", {preventScroll: true}]);
  expect(n.calls.some((call: any[]) => call[0] === "frame-focus")).toBe(false);
  expect(n.elements["diff-panel"].scrollTop).toBe(235);
});

test("a removed diagram retires its return target and reports the change", () => {
  const n = navigation(); n.click(); n.replaceChoices([{id: "dataflow-data-model", key:"data-model"}]);
  n.state.archifyArtifactId = "dataflow-data-model";
  n.back();
  expect(n.state.sequenceSourceReturn).toBeNull();
  expect(n.state.archifyArtifactId).toBe("dataflow-data-model");
  expect(n.calls).toContainEqual(["render", n.view]);
  expect(n.calls).toContainEqual(["toast", "This diagram is no longer available; showing the available maps."]);
  expect(n.calls.at(-1)).toEqual(["visible", false]);
});

test("unrelated source links do not overwrite an existing return destination", () => {
  const n = navigation(); const previous = {artifactId: "sequence-checkout-flow"};
  n.state.sequenceSourceReturn = previous;
  n.state.activeTab = "sequence"; n.remember(n.source);
  expect(n.state.sequenceSourceReturn).toBe(previous);
  n.state.activeTab = "archify"; n.source.closest = () => null; n.remember(n.source);
  expect(n.state.sequenceSourceReturn).toBe(previous);
});
