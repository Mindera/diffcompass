import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
// @ts-expect-error Browser module shared with tests.
import { actionBarBounds, createMobileActions, usesMobileActions } from "../public/monaco/mobile-actions.mjs";
import { monacoAsset } from "../src/monaco-assets";

test("pen/finger actions work on wide tablets without changing desktop mouse behavior", () => {
  expect(usesMobileActions("pen", 1600)).toBe(true);
  expect(usesMobileActions("touch", 1600)).toBe(true);
  expect(usesMobileActions("mouse", 820)).toBe(true);
  expect(usesMobileActions("mouse", 1600, true)).toBe(true);
  expect(usesMobileActions("mouse", 1600)).toBe(false);
});

test("dock uses visible diff bounds, including keyboard, sidebars and pinch viewport", () => {
  const panel = { left: 200, right: 1000, top: 100, bottom: 1000 };
  expect(actionBarBounds(panel, { left: 0, top: 0, width: 1300, height: 700 })).toEqual({ left: 208, top: 100, bottom: 692, width: 784 });
  expect(actionBarBounds(panel, { left: 300, top: 150, width: 600, height: 500 })).toEqual({ left: 308, top: 150, bottom: 642, width: 584 });
  expect(actionBarBounds(panel, { left: 0, top: 1000, width: 1300, height: 700 })).toBeNull();
});

test("preview clearance protects the toolbar and sheets without double-offsetting shorter panels", () => {
  const viewport = { left: 0, top: 0, width: 820, height: 1180 };
  const panel = { left: 0, right: 820, top: 100, bottom: 1180 };
  expect(actionBarBounds(panel, viewport, 72).bottom).toBe(1100);
  expect(actionBarBounds(panel, { ...viewport, height: 650 }, 72).bottom).toBe(570);
  expect(actionBarBounds({ ...panel, bottom: 800 }, viewport, 72).bottom).toBe(792);
  expect(actionBarBounds(panel, viewport).bottom).toBe(1172);
  expect(actionBarBounds(panel, viewport, Number.NaN).bottom).toBe(1172);
});

// Minimal DOM double exercises the real toolbar's lifecycle/async handlers,
// without a browser or a second UI implementation.
class Node extends EventTarget {
  children: Node[] = []; textContent = ""; className = ""; hidden = false; open = false; disabled = false; value = ""; offsetHeight = 130;
  dataset: Record<string, string> = {};
  classList = { add: (name: string) => { this.className += ` ${name}`; } };
  properties = new Map<string, string>();
  style: Record<string, any> = { setProperty: (key: string, value: string) => this.properties.set(key, value), removeProperty: (key: string) => this.properties.delete(key) };
  constructor(public tagName = "DIV") { super(); }
  append(...nodes: Node[]) { this.children.push(...nodes); }
  prepend(...nodes: Node[]) { this.children.unshift(...nodes); }
  replaceChildren(...nodes: Node[]) { this.children = nodes; }
  setAttribute() {} remove() {} showModal() { this.open = true; } close() { this.open = false; }
  getBoundingClientRect() { return { left: 0, right: 820, top: 100, bottom: 1100 }; }
  all(): Node[] { return [this, ...this.children.flatMap(node => node.all())]; }
  button(text: string) { const node = this.all().find(node => node.tagName === "BUTTON" && node.textContent === text); if (!node) throw Error(`Missing button: ${text}`); return node; }
  click() { this.dispatchEvent(new Event("click")); }
}
let original: Map<string, PropertyDescriptor | undefined>, body: Node, frames: Map<number, () => void>;
beforeEach(() => {
  body = new Node("BODY"); frames = new Map(); let id = 0;
  const replacements = {
    document: { body, createElement: (tag: string) => new Node(tag.toUpperCase()) },
    window: new EventTarget(), innerWidth: 820, innerHeight: 1180,
    matchMedia: () => ({ matches: false }), ResizeObserver: class { observe() {} disconnect() {} },
    getComputedStyle: () => ({ getPropertyValue: () => "72px" }),
    requestAnimationFrame: (fn: () => void) => { frames.set(++id, fn); return id; }, cancelAnimationFrame: (key: number) => frames.delete(key),
  };
  original = new Map(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
});
afterEach(() => { for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
function setup() {
  let enabled = true, releases = 0, holds = 0, valid = true, draft = false, fail = false;
  const messages: string[] = [], submitted: unknown[] = [], actions: unknown[] = [], modes: unknown[] = [];
  const panel = new Node(), ui = createMobileActions({ panel, enabled: () => enabled, notify: (message: string) => messages.push(message) });
  const item = (path = "a.ts", side = "new", line = 50): any => ({
    anchor: { path, side, line, endLine: line, selectedText: `code ${line}` },
    valid: () => valid, retain: () => { holds++; return () => releases++; }, setDraft: (value: boolean) => { draft = value; }, highlight() {},
    capabilities: { comment: true, ask: true, suggest: side === "new", source: true, textSelection: true },
    setSelectionMode(value: boolean) { modes.push([path, value]); },
    async submit(kind: string, text: string) { if (fail) throw Error("Offline: try again"); submitted.push([kind, text, this.anchor]); }, run(id: string) { actions.push([id, this.anchor]); },
  });
  const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn()); };
  return { ui, item, messages, submitted, actions, modes, panel, flush, bar: body.children[0], dialog: body.children[1], disable() { enabled = false; }, invalidate() { valid = false; }, fail() { fail = true; }, get holds() { return holds; }, get releases() { return releases; }, get draft() { return draft; } };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test("one bar retains the selected file while scrolling and releases it on clear", () => {
  const s = setup(); s.ui.select(s.item(), "pen"); s.flush();
  expect(s.bar.hidden).toBe(false); expect(s.holds).toBe(1);
  s.ui.update(); s.flush(); expect(s.releases).toBe(0);
  s.ui.select(s.item("b.ts"), "pen"); expect(s.releases).toBe(1); expect(s.holds).toBe(2);
  s.bar.button("×").click(); expect(s.releases).toBe(2); expect(s.bar.hidden).toBe(true); s.ui.dispose();
});

test("Suggest edit is a primary action for After code, not duplicated in More", async () => {
  const s = setup(); s.ui.select(s.item(), "pen");
  expect(s.bar.button("Suggest edit").hidden).toBe(false);
  s.bar.button("Suggest edit").click(); await tick();
  expect(s.actions).toEqual([["suggest", s.item().anchor]]);
  s.bar.button("More").click();
  expect(s.dialog.all().some(node => node.textContent === "Suggest edit")).toBe(false);
  s.dialog.button("Close").click(); s.ui.select(s.item("a.ts", "old"), "pen");
  expect(s.bar.button("Suggest edit").hidden).toBe(true); s.ui.dispose();
});

test("toolbar, menu and composer share the reserved preview bottom edge", () => {
  const s = setup(); s.ui.select(s.item(), "pen"); s.flush();
  // The panel ends at 1100, already above the preview controls' 1108 boundary.
  expect(s.bar.style.bottom).toBe("88px");
  expect(s.panel.properties.get("--mobile-actions-height")).toBe("154px");
  s.bar.button("More").click(); expect(s.dialog.style.bottom).toBe(s.bar.style.bottom);
  expect(s.panel.properties.get("--mobile-actions-height")).toBe("0px");
  expect(s.panel.properties.get("--mobile-actions-scroll-space")).toBe("154px");
  s.dialog.button("Close").click(); s.bar.button("Comment").click();
  expect(s.dialog.style.bottom).toBe(s.bar.style.bottom); s.ui.dispose();
});

test("an open draft locks its source and saves the captured Before anchor", async () => {
  const s = setup(); s.ui.select(s.item("a.ts", "old", 6), "touch"); s.bar.button("Comment").click();
  expect(s.ui.hasDraft).toBe(true); expect(s.draft).toBe(true);
  s.ui.select(s.item("other.ts"), "touch"); expect(s.holds).toBe(1);
  s.ui.clearPath("a.ts"); expect(s.ui.hasDraft).toBe(true);
  s.dialog.all().find(node => node.tagName === "TEXTAREA")!.value = "Before-side comment";
  s.dialog.all().find(node => node.tagName === "FORM")!.dispatchEvent(new Event("submit", { cancelable: true })); await tick();
  expect(s.submitted).toEqual([["comment", "Before-side comment", { path: "a.ts", side: "old", line: 6, endLine: 6, selectedText: "code 6" }]]);
  expect(s.ui.hasDraft).toBe(false); expect(s.draft).toBe(false); s.ui.dispose();
});

test("save failures retain text and stale source is blocked, not retargeted", async () => {
  const s = setup(); s.ui.select(s.item(), "pen"); s.bar.button("Ask agent").click(); s.fail();
  const input = s.dialog.all().find(node => node.tagName === "TEXTAREA")!; input.value = "Why?";
  const form = s.dialog.all().find(node => node.tagName === "FORM")!;
  form.dispatchEvent(new Event("submit", { cancelable: true })); await tick();
  expect(s.dialog.open).toBe(true); expect(input.value).toBe("Why?"); expect(s.ui.hasDraft).toBe(true);
  expect(s.dialog.all().some(node => node.textContent.includes("Offline"))).toBe(true);
  s.invalidate(); form.dispatchEvent(new Event("submit", { cancelable: true })); await tick();
  expect(s.submitted).toEqual([]); expect(s.dialog.all().some(node => node.textContent.includes("no longer current"))).toBe(true); s.ui.dispose();
});

test("Select text toggles free selection without the old line-range picker or hint", () => {
  const s = setup(); s.ui.select(s.item(), "pen");
  expect(s.bar.all().some(node => /Select lines|drag to scroll|last line/.test(node.textContent))).toBe(false);
  s.bar.button("Select text").click(); expect(s.modes.at(-1)).toEqual(["a.ts", true]);
  s.bar.button("✓ Select text").click(); expect(s.modes.at(-1)).toEqual(["a.ts", false]);
  expect(s.bar.button("Comment").disabled).toBe(false);
  expect(s.releases).toBe(0);
  s.bar.button("More").click();
  expect(s.dialog.all().some(node => node.textContent === "Select lines")).toBe(false); s.ui.dispose();
});

test("selection mode follows the chosen file and clears when the bar closes", () => {
  const s = setup(); s.ui.select(s.item(), "touch"); s.bar.button("Select text").click();
  s.ui.select(s.item("b.ts", "new", 52), "touch");
  expect(s.modes.slice(-2)).toEqual([["a.ts", false], ["b.ts", true]]);
  expect(s.bar.button("Comment").disabled).toBe(false);
  expect(s.bar.button("Suggest edit").disabled).toBe(false);
  s.bar.button("×").click(); expect(s.modes.at(-1)).toEqual(["b.ts", false]); s.ui.dispose();
});

test.each(["pen", "touch"])("%s word selection is kept exactly in comment, question and suggested-edit actions", async pointer => {
  const s = setup(); s.ui.select(s.item(), pointer); s.bar.button("Select text").click();
  const selected = s.item(); selected.anchor.selectedText = "subtotal";
  s.ui.select(selected, pointer); const anchor = selected.anchor;
  expect(s.bar.button("✓ Select text").disabled).toBe(false);
  for (const [label, kind] of [["Comment", "comment"], ["Ask agent", "ask"]]) {
    s.bar.button(label!).click();
    expect(s.dialog.all().some(node => node.tagName === "PRE" && node.textContent === "subtotal")).toBe(true);
    s.dialog.all().find(node => node.tagName === "TEXTAREA")!.value = "About these lines";
    s.dialog.all().find(node => node.tagName === "FORM")!.dispatchEvent(new Event("submit", { cancelable: true })); await tick();
    expect(s.submitted.at(-1)).toEqual([kind, "About these lines", anchor]);
  }
  s.bar.button("Suggest edit").click(); await tick();
  expect(s.actions).toEqual([["suggest", anchor]]); s.ui.dispose();
});

test("leaving selection mode keeps tap actions and rejects stale source", () => {
  const s = setup(); s.ui.select(s.item(), "pen"); s.bar.button("Select text").click();
  s.bar.button("✓ Select text").click(); s.ui.select(s.item("a.ts", "new", 52), "pen");
  expect(s.bar.all().some(node => node.textContent === "a.ts · After · L52")).toBe(true);
  s.invalidate(); s.bar.button("Select text").click();
  expect(s.messages.at(-1)).toContain("no longer current"); s.ui.dispose();
});

test("unsupported menu actions are absent; inactive and stale selections hide the bar", () => {
  const s = setup(); s.ui.select(s.item("a.ts", "old"), "pen"); s.bar.button("More").click();
  expect(s.dialog.all().some(node => node.textContent === "Suggest edit")).toBe(false);
  expect(s.dialog.all().some(node => node.textContent === "Go to definition")).toBe(false);
  s.dialog.button("Close").click(); s.disable(); s.ui.update(); s.flush(); expect(s.bar.hidden).toBe(true);
  s.invalidate(); s.ui.update(); s.flush(); expect(s.releases).toBe(1); s.ui.dispose();
});

test("mobile assets and real selection/composer integration are shipped", async () => {
  expect((await monacoAsset("/monaco/mobile-actions.mjs"))?.body).toContain("export function createMobileActions");
  const app = await readFile(new URL("../public/monaco/app.mjs", import.meta.url), "utf8");
  expect(app).toContain('publishMobileSelection("pen")');
  expect(app).toContain("setTimeout(() => { if (fileToolsDisposed) return; if (!gesture.deleted) capture(gesture.side)");
  expect(app).toContain('commentSubmission(anchor, body, quoted)');
  expect(app).toContain("host.askFromMobile(anchor, body)");
  expect(app).toContain('get hasDraft() { return Boolean(composer) || mobileDraft; }');
  expect(app).not.toContain('suggestEditButton');
  expect(app).toContain('id: "diff-lab.new.suggest-edit", label: "Suggest edit"');
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  expect(css).toContain(':root[data-preview-host="true"]');
  expect(css).toContain("--review-host-bottom-clearance: 72px");
  expect(css).toContain('.mobile-action-primary[data-action-count="4"] { grid-template-columns: repeat(2, minmax(0, 1fr)); }');
});
