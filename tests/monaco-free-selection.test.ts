import { expect, test } from "bun:test";
// @ts-expect-error Shared browser source mapping.
import { freeTextRange, sourceAnchor } from "../public/monaco/source-anchor.mjs";
// @ts-expect-error Shared browser source mapping.
import { deletedSourceSelection, installDeletedSelection } from "../public/monaco/deleted-selection.mjs";

const source = "\tconst amount = subtotal(items);\r\nreturn amount - discount;\r\n// 😀 unicode";
const lines = source.split(/\r?\n/);
const model = {
  getLineCount: () => lines.length,
  getLineMaxColumn: (line: number) => lines[line - 1]!.length + 1,
  getValue: () => source, getVersionId: () => 1, isDisposed: () => false,
  getWordAtPosition: () => ({ word: "subtotal", startColumn: 17, endColumn: 25 }),
};
const file = { path: "a.ts", new: source, old: source };
const point = (lineNumber: number, column: number) => ({ lineNumber, column });

test("tap selects just the mapped word; drag selects an arbitrary substring", () => {
  const p = point(1, 20);
  const word = freeTextRange(model, p, p, { tap: true });
  expect(sourceAnchor(file, "new", word).selectedText).toBe("subtotal");
  const part = freeTextRange(model, point(1, 25), point(1, 20));
  expect(sourceAnchor(file, "new", part).selectedText).toBe("total");
});

test("forward and reverse multiline selections retain exact columns, tabs and CRLF", () => {
  const first = point(1, 17), last = point(2, 14);
  const forward = freeTextRange(model, first, last), reverse = freeTextRange(model, last, first);
  expect(reverse).toEqual(forward);
  expect(sourceAnchor(file, "new", forward, { preserveEol: true }).selectedText).toBe("subtotal(items);\r\nreturn amount");
  expect(sourceAnchor(file, "new", freeTextRange(model, point(3, 4), point(3, 6))).selectedText).toBe("😀");
});

test("end-column one excludes the following line and invalid source points are rejected", () => {
  expect(sourceAnchor(file, "old", freeTextRange(model, point(1, 17), point(2, 1))).endLine).toBe(1);
  for (const p of [null, point(0, 1), point(1, 0), point(4, 1), point(1, 999)]) {
    expect(() => freeTextRange(model, point(1, 1), p)).toThrow("source pane");
  }
  const large = { ...model, getLineCount: () => 102, getLineMaxColumn: () => 20 };
  expect(() => freeTextRange(large, point(1, 1), point(101, 2))).toThrow("100");
  expect(freeTextRange(large, point(1, 1), point(101, 1)).endLineNumber).toBe(101);
});

test("unified Before selections keep the exact quote and reject crossing deleted blocks", () => {
  const mapping = { model, startLineNumber: 1, endLineNumberExclusive: 2 };
  const result = deletedSourceSelection(file, model, mapping, point(1, 20), point(1, 25));
  expect(result.anchor.selectedText).toBe("total"); expect(result.anchor.side).toBe("old"); expect(result.quoted).toBe(true);
  expect(() => deletedSourceSelection(file, model, mapping, point(1, 20), point(2, 5))).toThrow("safely");
});

test("Before word highlighting reverses source columns across token spans and retains its exact anchor", () => {
  const previousObserver = Object.getOwnPropertyDescriptor(globalThis, "MutationObserver");
  Object.defineProperty(globalThis, "MutationObserver", { configurable: true, value: class { observe() {} disconnect() {} } });
  let nativeRange: any = null, selected: any = null;
  const invalid: string[] = [];
  const zone: any = { isConnected: true, closest: () => zone };
  const nodes = [
    { textContent: "\tconst amount = ", column: 1 },
    { textContent: "sub", column: 17 },
    { textContent: "total", column: 20 },
    { textContent: "(items);", column: 25 },
  ].map(node => ({ ...node, nodeType: 3, parentElement: zone }));
  const mapping = { model, startLineNumber: 1, endLineNumberExclusive: 2, position: (node: typeof nodes[number], offset: number) => point(1, node.column + offset) };
  zone.diffCompassDeletedSource = mapping;
  const selection = {
    get rangeCount() { return nativeRange ? 1 : 0; }, getRangeAt: () => nativeRange,
    removeAllRanges() { nativeRange = null; }, addRange(range: any) { nativeRange = range; },
  };
  const doc = Object.assign(new EventTarget(), {
    defaultView: new EventTarget(), getSelection: () => selection,
    createTreeWalker: () => { let index = 0; return { nextNode: () => nodes[index++] || null }; },
    createRange: () => ({
      setStart(node: any, offset: number) { Object.assign(this, { startContainer: node, startOffset: offset }); },
      setEnd(node: any, offset: number) { Object.assign(this, { endContainer: node, endOffset: offset }); },
    }),
  });
  const root = Object.assign(new EventTarget(), { ownerDocument: doc, contains: (node: any) => node === zone, querySelectorAll: () => [] });
  const api = installDeletedSelection({ root, diff: { getOriginalEditor: () => ({ getModel: () => model }) }, enabled: () => true, file: () => file,
    onSelect: (result: any) => { selected = result; }, onInvalid: (reason: string) => invalid.push(reason), runAction() {} });
  try {
    expect(api.selectRange({ zone }, freeTextRange(model, point(1, 20), point(1, 20), { tap: true }))).toBe(true);
    expect(nativeRange.startContainer).toBe(nodes[0]); expect(nativeRange.startOffset).toBe(16);
    expect(nativeRange.endContainer).toBe(nodes[2]); expect(nativeRange.endOffset).toBe(5);
    expect(selected.anchor.selectedText).toBe("subtotal");
    doc.dispatchEvent(new Event("selectionchange"));
    expect(api.validate()).toBe(true); expect(selected.anchor.selectedText).toBe("subtotal");
    expect(invalid).toEqual([]);
  } finally {
    api.dispose();
    if (previousObserver) Object.defineProperty(globalThis, "MutationObserver", previousObserver); else Reflect.deleteProperty(globalThis, "MutationObserver");
  }
});
