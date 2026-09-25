import { expect, test } from "bun:test";
import { withArchifyEmbedAdapter } from "../src/archify-embed.ts";

test("lifecycle bands disappear only when no state occupies them", () => {
  const html = withArchifyEmbedAdapter('<html><body></body></html>', 'lifecycle');
  const code = html.split('\n').find(line => line.includes('if(true){var nodes='))!;
  expect(code).toBeTruthy();
  for (const positions of [[126], [126, 278], [126, 278, 450]]) {
    const children = [100, 252, 424].map(y => ({tagName:'text', style:{display:''}, getAttribute:(name:string) => name === 'y' ? String(y) : null}));
    const svg = {children, querySelectorAll: () => positions.map(y => ({querySelector: () => ({getAttribute: () => String(y)})}))};
    new Function('svg', code)(svg);
    expect(children.map(child => child.style.display)).toEqual([0,1,2].map(index => index < positions.length ? '' : 'none'));
  }
  const children = [{tagName:'text', style:{display:''}, getAttribute:()=>'100'}];
  new Function('svg', code)({children,querySelectorAll:()=>[]});
  expect(children[0]!.style.display).toBe(''); // Unknown/empty artifacts remain untouched.
});

test("only lifecycle decoration is hidden, not authored edges or other diagram types", () => {
  const selector = '.diagram-container>svg>path.a-emphasis:not([data-edge-from]){display:none!important}';
  expect(withArchifyEmbedAdapter("<html><body></body></html>", "lifecycle")).toContain(selector);
  expect(withArchifyEmbedAdapter("<html><body></body></html>", "architecture")).not.toContain(selector);
});

test("embedded and exported maps include the shared node skin without replacing category colours", () => {
  const html = withArchifyEmbedAdapter('<html><body><g data-node-id="test" data-node-kind="backend"></g></body></html>');
  expect(html).toContain('data-code-review-tour-map-nodes');
  expect(html).toContain('--map-node-radius: 8px');
  expect(html).toContain('var(--map-node-title-size)');
  expect(html).toContain('data-node-kind="backend"');
});

test("neutral component label is shared by the lens and passport without changing kinds or authored text", () => {
  const data = { locale: "en", messages: { "viewer.kind.backend": "Backend", "viewer.kind.external": "External", note: "<example>" } };
  const html = `<html><body><script type="application/json" id="archify-i18n-data">${JSON.stringify(data)}</script><g data-node-kind="backend">Backend service</g></body></html>`;
  const result = withArchifyEmbedAdapter(html);
  const json = /id="archify-i18n-data">([\s\S]*?)<\/script>/.exec(result)![1]!;
  expect(JSON.parse(json)).toEqual({ ...data, messages: { ...data.messages, "viewer.kind.backend": "Code component" } });
  expect(json).not.toContain("<example>");
  expect(result).toContain('<g data-node-kind="backend">Backend service</g>');
});

test("missing or malformed translation payloads remain intact", () => {
  for (const json of ["invalid", "null", "[]", '{}', '{"messages":[]}']) {
    const script = `<script id='archify-i18n-data'>${json}</script>`;
    expect(withArchifyEmbedAdapter(script)).toContain(script);
  }
});

function cameraRuntime() {
  const embedded = withArchifyEmbedAdapter("<!doctype html><html><body><div class=\"diagram-container\"><svg></svg></div></body></html>");
  return /<script data-code-review-tour-camera>([\s\S]+)<\/script>/.exec(embedded)?.[1] ?? "";
}

function interactiveHarness(dimensions: Partial<{ containerWidth: number; containerHeight: number; svgWidth: number; svgHeight: number }> = {}) {
  const size = {
    containerWidth: dimensions.containerWidth ?? 1_000,
    containerHeight: dimensions.containerHeight ?? 600,
    svgWidth: dimensions.svgWidth ?? 952,
    svgHeight: dimensions.svgHeight ?? 1_400,
  };
  type FakeButton = {
    selector: string;
    disabled: boolean;
    title: string;
    attributes: Map<string, string>;
    setAttribute(name: string, content: string): void;
    querySelector(query: string): { hidden?: boolean; textContent: string } | null;
    addEventListener(type: string, listener: () => void): void;
    cloneNode(): FakeButton;
    replaceWith(next: FakeButton): void;
  };
  const listeners = new Map<string, Array<(event: Record<string, unknown>) => void>>();
  const buttonListeners = new Map<string, Array<() => void>>();
  let inspected = 0;
  listeners.set("click", [() => { inspected += 1; }]);
  const buttonParts = () => ({
    detail: { hidden: true, textContent: "" },
    percent: { textContent: "100%" },
  });
  const buttons = new Map<string, FakeButton>();
  function button(selector: string): FakeButton {
    const parts = buttonParts();
    const value = {
      selector,
      disabled: false,
      title: "",
      attributes: new Map<string, string>(),
      setAttribute(name: string, content: string) { this.attributes.set(name, content); },
      querySelector(query: string) { return query === "[data-view-detail]" ? parts.detail : query === "[data-view-percent]" ? parts.percent : null; },
      addEventListener(type: string, listener: () => void) { buttonListeners.set(`${selector}:${type}`, [...(buttonListeners.get(`${selector}:${type}`) ?? []), listener]); },
      cloneNode() { return button(selector); },
      replaceWith(next: FakeButton) { buttons.set(selector, next); },
    };
    return value;
  }
  ["[data-view=\"out\"]", "[data-view=\"reset\"]", "[data-view=\"in\"]"].forEach((selector) => buttons.set(selector, button(selector)));
  const semanticNode = {
    closest: (selector: string) => selector.includes("data-node-id") ? semanticNode : null,
    getAttribute: (name: string) => name === "data-node-id" ? "receipt" : null,
    getBBox: () => ({ x: size.svgWidth / 2 - 90, y: size.svgHeight / 2 - 40, width: 180, height: 80 }),
  };
  const svg = {
    clientWidth: size.svgWidth,
    clientHeight: size.svgHeight,
    offsetLeft: 24,
    offsetTop: 16,
    style: {} as Record<string, string>,
    viewBox: { baseVal: { x: 0, y: 0, width: size.svgWidth, height: size.svgHeight } },
    setAttribute() {},
    getBoundingClientRect() { return { width: size.svgWidth, height: size.svgHeight }; },
    querySelectorAll(selector: string) { return selector === "[data-node-id]" ? [semanticNode] : []; },
  };
  const container = {
    contains(target: unknown) { return Boolean(target); },
    clientWidth: size.containerWidth,
    clientHeight: size.containerHeight,
    attributes: new Map<string, string>(),
    classList: { toggle() {}, add() {}, remove() {} },
    setAttribute(name: string, value: string) { this.attributes.set(name, value); },
    hasAttribute(name: string) { return this.attributes.has(name); },
    removeAttribute(name: string) { this.attributes.delete(name); },
    querySelector(selector: string) { return selector === ":scope > svg" ? svg : buttons.get(selector) ?? null; },
    addEventListener(type: string, listener: (event: Record<string, unknown>) => void) { listeners.set(type, [...(listeners.get(type) ?? []), listener]); },
    getBoundingClientRect() { return { left: 0, top: 0 }; },
    setPointerCapture() {},
    releasePointerCapture() {},
  };
  const passportListeners = new Map<string, Array<(event: Record<string, unknown>) => void>>();
  const passportHandle = {
    title: "",
    attributes: new Map<string, string>(),
    setAttribute(name: string, value: string) { this.attributes.set(name, value); },
    addEventListener(type: string, listener: (event: Record<string, unknown>) => void) { passportListeners.set(type, [...(passportListeners.get(type) ?? []), listener]); },
    setPointerCapture() {},
    releasePointerCapture() {},
  };
  const passport = {
    offsetLeft: 16,
    offsetTop: 16,
    offsetWidth: 280,
    offsetHeight: 180,
    style: {} as Record<string, string>,
    attributes: new Map<string, string>(),
    classList: { add() {}, remove() {} },
    setAttribute(name: string, value: string) { this.attributes.set(name, value); },
    hasAttribute(name: string) { return this.attributes.has(name); },
    querySelector(selector: string) { return selector === ".relationship-lens-head" ? passportHandle : null; },
    getBoundingClientRect() { return { width: 280, height: 180 }; },
  };
  const posted: unknown[] = [];
  const documentListeners = new Map<string, Array<(event: Record<string, unknown>) => void>>();
  const windowValue = { Archify: {} as { view?: unknown }, parent: { postMessage(message: unknown) { posted.push(message); } }, addEventListener() {} };
  const documentValue = { readyState: "complete", querySelector: () => container, getElementById: (id: string) => id === "focus-chip" ? passport : null, addEventListener(type: string, listener: (event: Record<string, unknown>) => void) { documentListeners.set(type, [...(documentListeners.get(type) ?? []), listener]); } };
  const ResizeObserverValue = class { constructor(_callback: () => void) {} observe() {} };
  const runtime = new Function("window", "document", "ResizeObserver", "requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle", "Archify", cameraRuntime());
  runtime(windowValue, documentValue, ResizeObserverValue, (callback: () => void) => callback(), () => {}, (node: { testOverflowY?: string }) => ({ paddingLeft: "24px", paddingRight: "24px", paddingTop: "16px", paddingBottom: "72px", overflowY: node?.testOverflowY }), windowValue.Archify);
  const fire = (type: string, event: Record<string, unknown>) => (listeners.get(type) ?? []).forEach((listener) => listener(event));
  const firePassport = (type: string, event: Record<string, unknown>) => (passportListeners.get(type) ?? []).forEach((listener) => listener(event));
  const click = (selector: string) => (buttonListeners.get(`${selector}:click`) ?? []).forEach((listener) => listener());
  const fireDocument = (type: string, event: Record<string, unknown>) => (documentListeners.get(type) ?? []).forEach((listener) => listener(event));
  return { svg, container, passport, fire, fireDocument, posted, firePassport, click, inspected: () => inspected, view: windowValue.Archify.view as { state(): { scale: number }; reveal(ids: string[], options?: Record<string, unknown>): { state: string; finished: Promise<{ state: string }> } } };
}

test("adapts a validated viewer to a fixed review viewport while preserving supported inspection controls", () => {
  const embedded = withArchifyEmbedAdapter("<!doctype html><html><head><style>html[data-embed=\"true\"]{color:red}</style></head><body><div class=\"diagram-container\"><svg></svg></div></body></html>");

  expect(embedded).toContain('data-code-review-tour-embed="true"');
  expect(embedded).not.toContain('<html data-embed="true">');
  expect(embedded).toContain("Fit entire map");
  expect(embedded).toContain("Archify.view={zoomIn");
  expect(embedded).toContain("touch-action:none");
  expect(embedded).toContain('.diagram-container{box-sizing:border-box!important;height:100%!important');
  expect(embedded).toContain('.relationship-lens-head{cursor:grab;touch-action:none}');
  expect(embedded).toContain("new ResizeObserver(refit)");
  expect(embedded).toContain("svg.style.width=natural.width+'px'");
  expect(embedded).toContain("flex:1 1 0;min-height:0!important;height:auto!important");
  expect(embedded).toContain("event.target.closest('[data-node-id],[data-edge-from]')");
  expect(embedded).not.toContain("container.style.height");
  expect(embedded).not.toContain("pointer-events:none!important");
  expect(embedded).not.toContain("code-review-tour-archify-height");
  const script = /<script data-code-review-tour-camera>([\s\S]+)<\/script>/.exec(embedded)?.[1];
  expect(script).toBeTruthy();
  expect(() => new Function(script!)).not.toThrow();
});

test("keeps an export embed self-contained without a parent resize protocol", () => {
  const embedded = withArchifyEmbedAdapter("<!doctype html><html><body></body></html>");

  expect(embedded).toContain("data-code-review-tour-camera");
  expect(embedded).toContain("code-review-tour-map-scroll");
  expect(embedded).not.toContain("code-review-tour-archify-height");
});

test("the generated camera script fits tall and wide maps without magnifying a small one", () => {
  const tall = interactiveHarness({ svgWidth: 600, svgHeight: 2_400 });
  const wide = interactiveHarness({ svgWidth: 2_400, svgHeight: 600 });
  const small = interactiveHarness({ svgWidth: 300, svgHeight: 200 });

  expect(tall.view.state().scale).toBeCloseTo(512 / 2_400);
  expect(wide.view.state().scale).toBeCloseTo(952 / 2_400);
  expect(small.view.state().scale).toBe(1);
});

test("the generated camera script keeps its fixed viewport stable, pans a sub-100% overflowing map, and passes node clicks through", () => {
  const harness = interactiveHarness();
  const fixedViewport = { width: harness.container.clientWidth, height: harness.container.clientHeight };
  const initial = harness.svg.style.transform;
  harness.click('[data-view="in"]');
  const zoomed = harness.svg.style.transform;
  expect(zoomed).not.toBe(initial);
  expect(harness.view.state().scale).toBeLessThan(1);
  expect({ width: harness.container.clientWidth, height: harness.container.clientHeight }).toEqual(fixedViewport);

  let prevented = false;
  const background = { closest: () => null };
  harness.fire("pointerdown", { button: 0, pointerId: 9, clientX: 400, clientY: 300, target: background });
  harness.fire("pointermove", { pointerId: 9, clientX: 400, clientY: 220, target: background, preventDefault: () => { prevented = true; } });
  harness.fire("pointerup", { pointerId: 9, target: background });
  expect(prevented).toBe(true);
  expect(harness.svg.style.transform).not.toBe(zoomed);
  expect({ width: harness.container.clientWidth, height: harness.container.clientHeight }).toEqual(fixedViewport);

  const node = { closest: (selector: string) => selector.includes("data-node-id") ? node : null };
  prevented = false;
  harness.fire("pointerdown", { button: 0, pointerId: 10, clientX: 400, clientY: 300, target: node, preventDefault: () => { prevented = true; } });
  expect(prevented).toBe(false);
  harness.fire("click", { target: node });
  expect(harness.inspected()).toBe(1);
});

test("a fitted small map can be freely dragged and Fit restores its position", () => {
  const harness = interactiveHarness({ svgWidth: 300, svgHeight: 200 });
  const initial = harness.svg.style.transform;
  const background = { closest: () => null };
  harness.fire("pointerdown", { button: 0, pointerId: 9, clientX: 400, clientY: 300, target: background });
  harness.fire("pointermove", { pointerId: 9, clientX: 480, clientY: 360, target: background, preventDefault() {} });
  harness.fire("pointerup", { pointerId: 9, target: background });
  expect(harness.svg.style.transform).not.toBe(initial);
  expect(harness.view.state().scale).toBe(1);
  harness.click('[data-view="reset"]');
  expect(harness.svg.style.transform).toBe(initial);
});

test("the generated camera keeps the existing reveal API usable for finder and route controls", async () => {
  const harness = interactiveHarness();
  const before = harness.svg.style.transform;
  const receipt = harness.view.reveal(["receipt"], { includeNeighbors: true, maxScale: 2 });

  expect(receipt.state).toBe("complete");
  await expect(receipt.finished).resolves.toEqual({ state: "complete" });
  expect(harness.svg.style.transform).not.toBe(before);
});

test("inspecting a node or relationship preserves both camera position and zoom", async () => {
  const harness = interactiveHarness();
  harness.click('[data-view="in"]');
  const before = harness.svg.style.transform;
  for (const reason of ["focus", "relationship-direct"]) {
    await harness.view.reveal(["receipt"], { reason, includeNeighbors: true }).finished;
    expect(harness.svg.style.transform).toBe(before);
  }
});

test("automatic camera reset on dismiss preserves the view, but Fit still works", () => {
  const harness = interactiveHarness();
  harness.click('[data-view="in"]');
  const before = harness.svg.style.transform;
  const view = harness.view as typeof harness.view & { reset(options?: { automatic: boolean }): void };
  view.reset({ automatic: true });
  expect(harness.svg.style.transform).toBe(before);
  view.reset();
  expect(harness.svg.style.transform).not.toBe(before);
  const html = withArchifyEmbedAdapter("<html><body></body></html>");
  expect(html).toContain('.intent-trace-overlay{display:none!important}');
  expect(html).toContain('[data-edge-from][data-intent-trace-match]');
  expect(html).toContain(':is(.semantic-lens,.route-probe){top:12px!important;bottom:auto!important');
  expect(html).toContain('max-height:calc(100% - 96px)!important;overflow-y:auto!important');
  expect(html).toContain(':is(#semantic-lens,#route-probe){position:absolute!important;inset:12px 12px auto auto!important;margin:0!important}');
});

test("ordinary wheel scrolling is forwarded in pixels without zooming; pinch is not forwarded", () => {
  const harness = interactiveHarness();
  const before = harness.svg.style.transform;
  let prevented = false;
  const event = { target: null, deltaY: 3, deltaMode: 1, preventDefault() { prevented = true; }, stopImmediatePropagation() {} };
  harness.fireDocument("wheel", event);
  expect(prevented).toBe(true);
  expect(harness.posted).toEqual([{ type: "code-review-tour-map-scroll", deltaY: 48 }]);
  expect(harness.svg.style.transform).toBe(before);
  harness.fireDocument("wheel", { ...event, ctrlKey: true });
  expect(harness.posted).toHaveLength(1);
});

test("the generated camera scales trackpad pinch gradually instead of applying a button-sized zoom step", () => {
  const harness = interactiveHarness();
  const before = harness.view.state().scale;
  let prevented = false;
  harness.fire("wheel", { ctrlKey: true, metaKey: false, deltaY: -12, clientX: 500, clientY: 300, preventDefault: () => { prevented = true; } });

  expect(prevented).toBe(true);
  expect(harness.view.state().scale).toBeGreaterThan(before);
  expect(harness.view.state().scale - before).toBeLessThan(0.02);
});

test("scrollable popup content keeps its wheel events until its scroll boundary", () => {
  const harness = interactiveHarness();
  const target = { testOverflowY: "auto", scrollHeight: 500, clientHeight: 200, scrollTop: 0, parentElement: null };
  let prevented = false;
  const event = { target, deltaY: 80, deltaMode: 0, preventDefault() { prevented = true; }, stopImmediatePropagation() {} };
  harness.fireDocument("wheel", event);
  expect(prevented).toBe(false);
  expect(harness.posted).toHaveLength(0);
  target.scrollTop = 300;
  harness.fireDocument("wheel", event);
  expect(harness.posted).toEqual([{ type: "code-review-tour-map-scroll", deltaY: 80 }]);
});

test("pen and touch swipes scroll the review without moving the camera or activating a node", () => {
  for (const pointerType of ["pen", "touch"]) {
    const harness = interactiveHarness();
    const before = harness.svg.style.transform;
    const target = { closest: () => null };
    harness.fireDocument("pointerdown", { pointerType, pointerId: 12, clientX: 200, clientY: 300, target });
    harness.fireDocument("pointermove", { pointerId: 12, clientX: 200, clientY: 240, preventDefault() {}, stopImmediatePropagation() {} });
    harness.fireDocument("pointerup", { pointerId: 12 });
    expect(harness.posted).toEqual([{ type: "code-review-tour-map-scroll", deltaY: 60 }]);
    expect(harness.svg.style.transform).toBe(before);
    let prevented = false;
    harness.fireDocument("click", { pointerType, preventDefault() { prevented = true; }, stopImmediatePropagation() {} });
    expect(prevented).toBe(true);
  }
});

test("the generated adapter lets a reviewer drag the semantic passport by its header without hijacking actions", () => {
  const harness = interactiveHarness();
  const handleTarget = { closest: () => null };
  let prevented = false;
  harness.firePassport("pointerdown", { button: 0, pointerId: 22, clientX: 30, clientY: 30, target: handleTarget });
  harness.firePassport("pointermove", { pointerId: 22, clientX: 130, clientY: 90, target: handleTarget, preventDefault: () => { prevented = true; } });
  harness.firePassport("pointerup", { pointerId: 22, target: handleTarget });

  expect(prevented).toBe(true);
  expect(harness.passport.style.left).toBe("116px");
  expect(harness.passport.style.top).toBe("76px");

  const actionHarness = interactiveHarness();
  const actionTarget = { closest: () => ({}) };
  actionHarness.firePassport("pointerdown", { button: 0, pointerId: 23, clientX: 30, clientY: 30, target: actionTarget });
  actionHarness.firePassport("pointermove", { pointerId: 23, clientX: 130, clientY: 90, target: actionTarget, preventDefault: () => { throw new Error("an action inside the passport must not start a drag"); } });
  expect(actionHarness.passport.style.left).toBeUndefined();
  expect(actionHarness.passport.style.top).toBeUndefined();
});
