import { expect, test } from "bun:test";

test("presentation expands the same iframe, validates the sender, and restores layout", async () => {
  const script = await Bun.file(new URL('../public/map-presentation.js', import.meta.url)).text();
  const listeners: Record<string, Function> = {};
  const attributes = new Map([['style', 'width:700px;height:450px']]);
  const messages: unknown[] = [];
  let open = false;
  class Element { inert = false; }
  const sibling = new Element();
  const frame = Object.assign(new Element(), {
    style: { cssText: '' }, isConnected: true,
    contentWindow: { postMessage: (value: unknown) => messages.push(value) },
    parentElement: { children: [] as unknown[], parentElement: null },
    getClientRects: () => [{}],
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
    matches: () => open,
    showPopover: () => { open = true; }, hidePopover: () => { open = false; }, focus() {},
  });
  frame.parentElement.children = [frame, sibling];
  const document = {
    documentElement: {}, querySelectorAll: () => [frame],
    addEventListener: (name: string, callback: Function) => { listeners[name] = callback; },
  };
  const window = { addEventListener: document.addEventListener };
  new Function('window', 'document', 'HTMLElement', 'MutationObserver', script)(window, document, Element, class { observe() {} });
  const data = { type: 'diffcompass-map-present', active: true };
  listeners.message!({ data, source: {} });
  expect(open).toBe(false);
  listeners.message!({ data, source: frame.contentWindow });
  expect(open).toBe(true);
  expect(frame.style.cssText).toContain('width:100vw!important;height:100dvh!important');
  expect(sibling.inert).toBe(true);
  listeners.keydown!({ key: 'Escape', preventDefault() {}, stopImmediatePropagation() {} });
  expect(open).toBe(false);
  expect(sibling.inert).toBe(false);
  expect(attributes.get('style')).toBe('width:700px;height:450px');
  expect(messages).toEqual([
    { type: 'diffcompass-map-present-state', active: true },
    { type: 'diffcompass-map-present-state', active: false },
  ]);
});
