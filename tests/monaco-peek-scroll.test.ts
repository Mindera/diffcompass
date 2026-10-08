import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
// @ts-expect-error Browser module shared with tests.
import { installPeekPenScroll } from "../public/monaco/pen-scroll.mjs";

function setup() {
  let inPeek = true, readOnly = true, excluded = false, registered = true, captured = false, starts = 0, releases = 0;
  const peek = {}, editorNode = { closest: () => inPeek ? peek : null };
  const code = { closest: (selector: string) => selector === ".monaco-editor" ? editorNode : selector === ".peekview-widget" ? (inPeek ? peek : null) : excluded ? {} : null };
  const doc = Object.assign(new EventTarget(), { defaultView: new EventTarget() });
  const root = Object.assign(new EventTarget(), { ownerDocument: doc, contains: (node: unknown) => node === code,
    setPointerCapture() { captured = true; }, hasPointerCapture: () => captured, releasePointerCapture() { captured = false; } });
  const makeEditor = () => ({
    left: 10, top: 100, position: null as unknown, options: {} as Record<string, unknown>,
    getDomNode: () => editorNode, getOption: () => readOnly,
    getTargetAtClientPoint: () => ({ type: 6, position: { lineNumber: 5, column: 3 } }),
    updateOptions(options: Record<string, unknown>) { this.options = options; },
    getScrollLeft() { return this.left; }, getScrollTop() { return this.top; },
    setScrollPosition({ scrollLeft, scrollTop }: { scrollLeft: number; scrollTop: number }) { this.left = scrollLeft; this.top = scrollTop; },
    setPosition(position: unknown) { this.position = position; },
  });
  let editor = makeEditor();
  const monaco = { editor: { getEditors: () => registered ? [editor] : [], EditorOption: { readOnly: 1 }, MouseTargetType: { CONTENT_TEXT: 6, CONTENT_EMPTY: 7 } } };
  const dispose = installPeekPenScroll({ root, monaco, onStart() { starts++; return () => { releases++; }; } });
  function emit(type: string, values: Record<string, unknown> = {}) {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { pointerType: "pen", pointerId: 7, button: 0, isPrimary: true, screenX: 100, screenY: 300, clientX: 100, clientY: 100 }, values);
    Object.defineProperty(event, "target", { value: code }); doc.dispatchEvent(event); return event.defaultPrevented;
  }
  return { emit, dispose, get editor() { return editor; }, get captured() { return captured; }, get starts() { return starts; }, get releases() { return releases; },
    reopen() { editor = makeEditor(); }, outer() { inPeek = false; }, writable() { readOnly = false; }, control() { excluded = true; }, unregistered() { registered = false; } };
}

test("pen drag scrolls the nested peek editor on both axes without selecting code", () => {
  const s = setup(); expect(s.emit("pointerdown")).toBe(true);
  s.emit("pointermove", { screenX: 90, screenY: 260 }); s.emit("pointerup", { screenX: 90, screenY: 260 });
  expect(s.editor.left).toBe(20); expect(s.editor.top).toBe(140); expect(s.editor.position).toBeNull();
  expect(s.editor.options).toEqual({ domReadOnly: true, editContext: false });
  expect(s.releases).toBe(1); expect(s.captured).toBe(false); expect(s.emit("click")).toBe(true); s.dispose();
});

test("peek taps place a readonly cursor without focusing an input", () => {
  const s = setup(); s.emit("pointerdown"); s.emit("pointerup");
  expect(s.editor.position).toEqual({ lineNumber: 5, column: 3 }); expect(s.editor.top).toBe(100); s.dispose();
});

test("peek reopen uses the new public editor instance and disposal releases a captured pen", () => {
  const s = setup(), previous = s.editor;
  s.reopen(); s.emit("pointerdown"); s.emit("pointermove", { screenY: 250 });
  expect(previous.top).toBe(100); expect(s.editor.top).toBe(150);
  s.dispose(); expect(s.releases).toBe(1); expect(s.captured).toBe(false);
  expect(s.emit("pointerdown")).toBe(false);
});

test("peek handler leaves the outer editor, editable drafts and widget controls untouched", () => {
  for (const change of ["outer", "writable", "control", "unregistered"] as const) {
    const s = setup(); s[change](); expect(s.emit("pointerdown")).toBe(false);
    expect(s.starts).toBe(0); expect(s.editor.options).toEqual({}); s.dispose();
  }
});

test("desktop selection, native touch scrolling and modified pen gestures stay native in peek", () => {
  for (const values of [{ pointerType: "mouse" }, { pointerType: "touch" }, { button: 2 }, { ctrlKey: true }, { shiftKey: true }]) {
    const s = setup(); expect(s.emit("pointerdown", values)).toBe(false); expect(s.starts).toBe(0); s.dispose();
  }
});

test("peek scrolling is scoped to each file and cannot inherit outer free-selection mode", async () => {
  const app = await readFile(new URL("../public/monaco/app.mjs", import.meta.url), "utf8");
  const start = app.indexOf("diff.onDidDispose(installPeekPenScroll({");
  expect(start).toBeGreaterThan(0);
  const hookup = app.slice(start, app.indexOf("diff.onDidDispose(installPenScroll({", start));
  expect(hookup).toContain("root: fileDetail, monaco"); expect(hookup).toContain("host?.holdPenScroll?.()");
  expect(hookup).not.toContain("mobileTextSelection");
});
