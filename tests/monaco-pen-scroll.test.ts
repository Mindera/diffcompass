import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
// @ts-expect-error Shared browser module.
import { installPenScroll } from "../public/monaco/pen-scroll.mjs";
import { monacoAsset } from "../src/monaco-assets";

function setup() {
  const doc = Object.assign(new EventTarget(), { defaultView: new EventTarget() });
  const node = { excluded: false, closest() { return this.excluded; } };
  let captured: number | null = null;
  const root = Object.assign(new EventTarget(), {
    ownerDocument: doc,
    contains: (target: unknown) => target === node,
    setPointerCapture: (id: number) => { captured = id; },
    hasPointerCapture: (id: number) => captured === id,
    releasePointerCapture: () => { captured = null; },
  });
  const pans: number[][] = [], taps: unknown[] = [], selections: any[] = [];
  let starts = 0, releases = 0, code = true, selecting = false;
  const dispose = installPenScroll({
    root, hitTest: (event: PointerEvent) => code ? { line: 50, column: event.clientX } : null,
    onPan: (_hit: unknown, dx: number, dy: number) => pans.push([dx, dy]),
    onTap: (hit: unknown) => taps.push(hit),
    onStart: () => { starts++; return () => { releases++; }; },
    selectionEnabled: () => selecting,
    onSelect: (first: unknown, last: unknown, options: unknown) => selections.push({ first, last, options }),
  });
  function emit(type: string, values: Record<string, unknown> = {}) {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { pointerType: "pen", pointerId: 7, button: 0, isPrimary: true, screenX: 100, screenY: 300, clientX: 100, clientY: 100 }, values);
    Object.defineProperty(event, "target", { value: node });
    (type === "lostpointercapture" ? root : doc).dispatchEvent(event);
    return event.defaultPrevented;
  }
  return { root, doc, node, emit, pans, taps, selections, dispose, select: () => { selecting = true; }, scroll: () => { selecting = false; }, notCode: () => { code = false; }, get starts() { return starts; }, get releases() { return releases; }, get captured() { return captured; } };
}

test("pen drag pans without selecting and keeps its iframe alive until release", () => {
  const s = setup();
  expect(s.emit("pointerdown")).toBe(true);
  expect(s.captured).toBe(7);
  expect(s.starts).toBe(1);
  expect(s.emit("pointermove", { screenY: 280 })).toBe(true);
  expect(s.emit("pointermove", { screenY: 240, screenX: 90 })).toBe(true);
  expect(s.emit("pointerup", { screenY: 240, screenX: 90 })).toBe(true);
  expect(s.pans).toEqual([[0, 20], [10, 40]]);
  expect(s.taps).toEqual([]);
  expect(s.captured).toBeNull();
  expect(s.releases).toBe(1);
  expect(s.emit("click")).toBe(true);
  s.dispose();
});

test("tap tolerates pen jitter and still chooses the tapped source line", () => {
  const s = setup();
  s.emit("pointerdown"); s.emit("pointermove", { screenY: 298 }); s.emit("pointerup", { screenY: 299 });
  expect(s.pans).toEqual([]);
  expect(s.taps).toEqual([{ line: 50, column: 100 }]);
  expect(s.releases).toBe(1);
  s.dispose();
});

test("moving iframe coordinates cannot feed back into the pen scroll distance", () => {
  const s = setup();
  s.emit("pointerdown");
  s.emit("pointermove", { screenY: 280, clientY: 80 });
  s.emit("pointermove", { screenY: 280, clientY: 100 }); // Parent scrolled the iframe, pen did not move.
  s.emit("pointermove", { screenY: 260, clientY: 100 });
  expect(s.pans).toEqual([[0, 20], [0, 20]]);
  s.dispose();
});

test("final pen movement without pointermove is still a pan, never a tap", () => {
  const s = setup(); s.emit("pointerdown"); s.emit("pointerup", { screenY: 260 });
  expect(s.pans).toEqual([[0, 40]]); expect(s.taps).toEqual([]); s.dispose();
});

test("mouse, finger, barrel button, eraser and modified gestures stay native", () => {
  for (const values of [{ pointerType: "mouse" }, { pointerType: "touch" }, { button: 2 }, { button: 5 }, { isPrimary: false }, { shiftKey: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
    const s = setup();
    expect(s.emit("pointerdown", values)).toBe(false);
    expect(s.starts).toBe(0); s.dispose();
  }
});

test("forms and non-code controls are never captured", () => {
  const s = setup(); s.node.excluded = true;
  expect(s.emit("pointerdown")).toBe(false);
  s.node.excluded = false; s.notCode();
  expect(s.emit("pointerdown")).toBe(false);
  expect(s.starts).toBe(0); s.dispose();
});

test("cancel, lost capture, blur and disposal release the gesture without selecting", () => {
  for (const reason of ["pointercancel", "lostpointercapture", "blur", "dispose"]) {
    const s = setup(); s.emit("pointerdown");
    if (reason === "blur") s.doc.defaultView.dispatchEvent(new Event("blur"));
    else if (reason === "dispose") s.dispose();
    else s.emit(reason);
    expect(s.captured).toBeNull(); expect(s.releases).toBe(1); expect(s.taps).toEqual([]);
    expect(s.emit("pointermove", { screenY: 250 })).toBe(false);
    s.dispose(); expect(s.releases).toBe(1);
  }
});

test("a second pointer cancels the pen gesture without swallowing the new input", () => {
  const s = setup(); s.emit("pointerdown");
  expect(s.emit("pointermove", { pointerId: 8 })).toBe(false);
  expect(s.emit("pointerdown", { pointerId: 8, pointerType: "touch" })).toBe(false);
  expect(s.releases).toBe(1); expect(s.taps).toEqual([]); s.dispose();
});

test("duplicate tablet touch events cannot also drive Monaco's selection gesture", () => {
  const s = setup();
  expect(s.emit("touchstart")).toBe(false);
  s.emit("pointerdown");
  expect(s.emit("touchstart")).toBe(true); expect(s.emit("touchmove")).toBe(true);
  s.emit("pointerup"); expect(s.emit("touchmove")).toBe(false); s.dispose();
});

test("disposal removes listeners, including while a pen is down", () => {
  const s = setup(); s.emit("pointerdown"); s.dispose();
  expect(s.emit("pointerdown")).toBe(false); expect(s.starts).toBe(1);
});

test.each(["pen", "touch"])("%s free drag reports exact endpoints instead of scrolling or choosing lines", pointerType => {
  const s = setup(); s.select();
  s.emit("pointerdown", { pointerType, clientX: 5 });
  s.emit("pointermove", { pointerType, screenX: 140, clientX: 12 });
  s.emit("pointerup", { pointerType, screenX: 145, clientX: 14 });
  expect(s.selections.at(-1)).toEqual({ first: { line: 50, column: 5 }, last: { line: 50, column: 14 }, options: { tap: false, pointerType } });
  expect(s.pans).toEqual([]); expect(s.taps).toEqual([]);
  expect(s.releases).toBe(1); expect(s.emit("click", { pointerType })).toBe(true); s.dispose();
});

test.each(["pen", "touch"])("%s tap in selection mode requests a word, not a whole line", pointerType => {
  const s = setup(); s.select(); s.emit("pointerdown", { pointerType }); s.emit("pointerup", { pointerType });
  expect(s.selections.at(-1).options).toEqual({ tap: true, pointerType });
  expect(s.pans).toEqual([]); expect(s.taps).toEqual([]); s.dispose();
});

test("leaving selection mode restores pen scrolling and native finger gestures", () => {
  const s = setup(); s.select(); s.scroll();
  expect(s.emit("pointerdown", { pointerType: "touch" })).toBe(false);
  s.emit("pointerdown"); s.emit("pointerup", { screenY: 250 });
  expect(s.pans).toEqual([[0, 50]]); expect(s.selections).toEqual([]); s.dispose();
});

test("pen scroll is shipped and wired only to read-only diff/source viewers", async () => {
  const asset = await monacoAsset("/monaco/pen-scroll.mjs");
  expect(asset?.body).toContain("export function installPenScroll");
  const app = await readFile(new URL("../public/monaco/app.mjs", import.meta.url), "utf8");
  expect(app).toContain('root: $("source-editor"), hitTest: event => codePenTarget(viewer, event)');
  expect(app).toContain("root: editorSurface,");
  expect(app).toContain("if (host?.panBy) host.panBy(dy)");
  expect(app).toContain('if (hit.deleted) { deletedSelection.tap(event); publishMobileSelection("pen"); return; }');
  const draft = app.slice(app.indexOf("draftEditor = createWithOverflowLayer("), app.indexOf("draftEditor.addCommand"));
  expect(draft).not.toContain("installPenScroll");
});
