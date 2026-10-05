import { expect, test } from 'bun:test';

const runtime = await Bun.file(new URL('../public/sequence-walkthrough-resize.js', import.meta.url)).text();
function setup(width = 1440, height = 1000) {
  const listeners: Record<string, Function> = {}, messages: any[] = [], attributes = new Map<string, string>(), classes = new Set<string>();
  let resize: Function = () => {}, receive: Function = () => {}, restore = 0, capture: number | null = null, disconnected = false;
  const parent = { postMessage: (data: any) => messages.push(data) };
  const root: any = { parent, addEventListener: (_n: string, fn: Function) => { receive = fn; }, removeEventListener: () => { receive = () => {}; } };
  const list = { add: (key: string) => classes.add(key), remove: (key: string) => classes.delete(key), toggle: (key: string, yes: boolean) => yes ? classes.add(key) : classes.delete(key) };
  const layout = { clientWidth: width, clientHeight: height, classList: list, style: { setProperty: (key: string, value: string) => attributes.set(key, value) } };
  const separator = { hidden: false, classList: list, setAttribute: (key: string, value: string) => attributes.set(key, value), focus() {},
    setPointerCapture: (id: number) => { capture = id; }, hasPointerCapture: (id: number) => capture === id, releasePointerCapture: () => { capture = null; },
    addEventListener: (name: string, handler: Function) => { listeners[name] = handler; }, removeEventListener: (name: string) => { delete listeners[name]; } };
  const pane = { hidden: false };
  new Function('window', 'ResizeObserver', runtime)(root, class { constructor(fn: Function) { resize = fn; } observe() {} disconnect() { disconnected = true; } });
  const controller = root.DiffCompassSequenceResize.mount(layout, separator, pane, () => restore++);
  const event = (name: string, values = {}) => listeners[name]?.({ button: 0, isPrimary: true, pointerId: 1, clientX: 1000, clientY: 600, preventDefault() {}, stopPropagation() {}, ...values });
  return { layout, separator, pane, controller, attributes, classes, messages, event, current: () => Number(attributes.get('aria-valuenow')),
    capture: () => capture, restore: () => restore, disconnected: () => disconnected, listeners, resize: () => resize(),
    receive: (preferences: any, source = parent) => receive({ source, data: { type: 'diffcompass-map-preferences', preferences } }) };
}

test('real sizing contract: primary pointer, bounded width, capture lifecycle and committed preference', () => {
  const h = setup();
  expect(h.current()).toBe(420); expect(h.attributes.get('aria-orientation')).toBe('vertical');
  h.event('pointerdown', { button: 2 }); h.event('pointermove', { clientX: 900 }); expect(h.current()).toBe(420);
  h.event('pointerdown'); h.event('pointermove', { pointerId: 2, clientX: 900 }); expect(h.current()).toBe(420);
  h.event('pointermove', { clientX: 880 }); expect(h.current()).toBe(540); expect(h.capture()).toBe(1);
  h.event('pointermove', { clientX: -2000 }); expect(h.current()).toBe(900);
  h.event('pointerup'); expect(h.capture()).toBeNull(); expect(h.classes.has('dragging')).toBe(false);
  expect(h.messages.at(-1).preferences).toEqual({ sequenceCodeWidth: 900 });
  h.event('pointermove', { clientX: 500 }); expect(h.current()).toBe(900);
  h.event('click'); expect(h.restore()).toBe(1); h.controller.dispose();
});

test('keyboard, reset, constrained viewport and independent stacked height retain requested width', () => {
  const h = setup();
  h.event('keydown', { key: 'ArrowLeft' }); expect(h.current()).toBe(440);
  h.event('keydown', { key: 'Home' }); expect(h.current()).toBe(280);
  h.event('keydown', { key: 'End' }); expect(h.current()).toBe(900);
  h.layout.clientWidth = 1100; h.resize(); expect(h.current()).toBe(670);
  h.layout.clientWidth = 600; h.resize(); expect(h.current()).toBe(350);
  expect(h.attributes.get('aria-orientation')).toBe('horizontal');
  h.event('keydown', { key: 'ArrowLeft' }); expect(h.current()).toBe(350);
  h.event('keydown', { key: 'ArrowUp' }); expect(h.current()).toBe(370);
  expect(h.messages.at(-1).preferences).toEqual({ sequenceCodeHeight: 370 });
  h.layout.clientWidth = 1440; h.resize(); expect(h.current()).toBe(900);
  h.event('keydown', { key: 'Enter' }); expect(h.current()).toBe(420);
  expect(h.messages.at(-1).preferences).toEqual({ sequenceCodeWidth: 0 });
  h.layout.clientWidth = 600; h.resize(); expect(h.current()).toBe(370);
  h.event('dblclick'); expect(h.current()).toBe(350); h.controller.dispose();
});

test('height drag preserves at least 350px of diagram when space allows; tiny layouts stay bounded', () => {
  const h = setup(600, 900);
  h.event('pointerdown'); h.event('pointermove', { clientY: 0 }); expect(h.current()).toBe(540);
  h.event('pointerup'); h.layout.clientHeight = 300; h.resize(); expect(h.current()).toBe(120);
  expect(h.attributes.get('aria-valuemin')).toBe('120'); expect(h.attributes.get('aria-valuemax')).toBe('120');
  h.controller.dispose();
});

test('cancel, capture loss, collapse, orientation change and disposal terminate the drag', () => {
  for (const end of ['pointercancel', 'lostpointercapture', 'collapse', 'orientation', 'dispose']) {
    const h = setup(); h.event('pointerdown'); h.event('pointermove', { clientX: 900 });
    if (end === 'collapse') { h.pane.hidden = true; h.controller.sync(); expect(h.separator.hidden).toBe(true); }
    else if (end === 'orientation') { h.layout.clientWidth = 600; h.resize(); }
    else if (end === 'dispose') h.controller.dispose();
    else h.event(end);
    expect(h.capture()).toBeNull(); expect(h.classes.has('dragging')).toBe(false);
    const size = h.current(); h.event('pointermove', { clientX: 300 }); expect(h.current()).toBe(size);
    h.pane.hidden = false; h.layout.clientWidth = 1440; h.controller.sync(); expect(h.current()).toBe(520);
    h.controller.dispose(); expect(Object.keys(h.listeners)).toHaveLength(0); expect(h.disconnected()).toBe(true);
  }
});

test('preferences use existing parent bridge, validate values, avoid echoes, and retain in-memory controls', () => {
  const h = setup();
  expect(h.messages).toEqual([{ type: 'diffcompass-map-preferences-ready' }]);
  h.receive({ sequenceCodeWidth: 600 }, {} as any); expect(h.current()).toBe(420);
  for (const invalid of [-1, 12, 9000, NaN, '600', 320.1]) { h.receive({ sequenceCodeWidth: invalid }); expect(h.current()).toBe(420); }
  h.receive({ sequenceCodeWidth: 600, sequenceCodeHeight: 400 }); expect(h.current()).toBe(600); expect(h.messages).toHaveLength(1);
  h.event('pointerdown'); h.receive({ sequenceCodeWidth: 700 }); expect(h.current()).toBe(600);
  h.event('pointerup'); h.pane.hidden = true; h.controller.sync(); h.pane.hidden = false; h.controller.sync(); expect(h.current()).toBe(600);
  h.receive({ sequenceCodeWidth: 0 }); expect(h.current()).toBe(420); h.controller.dispose();
});
