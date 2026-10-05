import { expect, test } from "bun:test";
import { sequenceCandidate } from "../src/archify.ts";
import { sequenceWalkthroughScript, sequenceWalkthroughSteps } from "../src/sequence-walkthrough.ts";
import { withArchifyEmbedAdapter } from "../src/archify-embed.ts";
import { sequenceSourceScript } from "../src/sequence-source-embed.ts";
import type { ReviewFlow } from "../src/types.ts";

const runtime = await Bun.file(new URL('../public/sequence-walkthrough.js', import.meta.url)).text();
const api: any = {};
new Function('window', runtime)(api);
const flow: ReviewFlow = { id: 'repeat', title: 'Repeated calls', summary: 'Authored order', provenance: 'partial', blastRadiusSize: 1,
  mermaid: 'sequenceDiagram\n participant A\n participant B\n A->>B: run()\n B->>B: run()\n B-->>A: run()' };

test('walkthrough projects existing IDs for duplicate captions, self calls and returns', () => {
  const ir = sequenceCandidate(flow)!.ir;
  const steps = sequenceWalkthroughSteps(ir);
  expect(steps.map(s => s.id)).toEqual((ir.messages as any[]).map(m => m.id));
  expect(new Set(steps.map(s => s.id)).size).toBe(3);
  expect(steps[1]!.from).toBe(steps[1]!.to);
  expect(steps[2]!.variant).toBe('return');
  expect(steps.every(s => s.callShaped)).toBe(true);
  expect(sequenceWalkthroughSteps({ messages: [] })).toEqual([]);
  expect(sequenceWalkthroughSteps({ messages: Array(41).fill({ id: 'x', label: 'x' }) })).toEqual([]);
  expect(sequenceWalkthroughSteps({ messages: [{ id: 'x', label: 'x', from: 'a', to: 'b' }, { id: 'x', label: 'x', from: 'a', to: 'b' }] })).toHaveLength(0);
  expect(sequenceWalkthroughSteps({ messages: [{ id: 'x', label: 'x' }] })).toHaveLength(0);
});

test('branches and loops retain native Mermaid semantics rather than becoming linear walkthroughs', () => {
  for (const fragment of ['alt success', 'loop each item', 'par parallel']) {
    expect(sequenceCandidate({ ...flow, mermaid: flow.mermaid + '\n' + fragment + '\n A->>B: run()\n end' })).toBeUndefined();
  }
});

test('Paths uses exact current edge IDs for repeated captions, self calls, returns and fragments', () => {
  const steps = sequenceWalkthroughSteps(sequenceCandidate(flow)!.ir);
  const edge = (step: any) => ({ getAttribute: (name: string) => ({ 'data-edge-id': step.id, 'data-edge-from': step.from, 'data-edge-to': step.to } as any)[name] });
  const identify = (items: any[]) => api.DiffCompassSequenceWalkthrough.routeMessage({ querySelectorAll: () => items.map(edge) }, steps);
  for (const step of steps) { expect(identify([step])).toBe(step.id); expect(identify([step, step])).toBe(step.id); }
  expect(identify([])).toBeNull(); expect(identify([steps[0], steps[1]])).toBeNull();
  expect(identify([{ ...steps[0], id: 'unknown' }])).toBeNull();
  expect(identify([{ ...steps[0], to: 'wrong' }])).toBeNull();
});

test('Paths highlights and reveals code without selecting a relationship, camera changes, or playback feedback', () => {
  const events: any[] = [];
  const controller = api.DiffCompassSequenceWalkthrough.selectionController(['call', 'return'], {
    mark: (id: string) => events.push(['mark', id]), reveal: (id: string) => events.push(['reveal', id]), selectDiagram: () => { throw Error('Must not leave Paths'); },
  });
  controller.select('call', 'route'); controller.select('call', 'route');
  controller.select('return', 'route'); controller.select('missing', 'route');
  controller.clear(); controller.clear();
  expect(events).toEqual([['mark', 'call'], ['reveal', 'call'], ['mark', 'return'], ['reveal', 'return'], ['mark', null]]);
  expect(controller.selected).toBeNull();
});

test('explicit selection separates source actions from reveal and absorbs delayed observer echoes', () => {
  const events: string[] = [];
  const controller = api.DiffCompassSequenceWalkthrough.selectionController(['first', 'same-caption', 'return'], {
    mark: (id: string) => events.push('mark:' + id),
    selectDiagram: (id: string) => events.push('diagram:' + id),
    reveal: (id: string) => events.push('reveal:' + id),
  });
  controller.select('first', 'diagram');
  expect(events).toEqual(['mark:first', 'reveal:first']);
  events.length = 0;
  controller.select('same-caption', 'action');
  controller.select('same-caption', 'diagram');
  controller.select('forged', 'diagram');
  expect(events).toEqual(['diagram:same-caption', 'mark:same-caption']);
  expect(controller.selected).toBe('same-caption');
  events.length = 0;
  controller.select('return', 'keyboard');
  expect(events).toEqual(['diagram:return', 'mark:return', 'reveal:return']);
  events.length = 0;
  controller.select('return', 'diagram-click');
  expect(events).toEqual(['diagram:return', 'reveal:return']);
  events.length = 0;
  // An outside-click capture listener can clear the renderer before a code
  // heading receives its click. The retained local selection must re-pin it.
  controller.select('return', 'keyboard');
  controller.select('return', 'diagram');
  expect(events).toEqual(['diagram:return', 'reveal:return']);
  events.length = 0;
  controller.select('return', 'action');
  controller.select('return', 'diagram');
  expect(events).toEqual(['diagram:return']);
});

class Element {
  hidden = false;
  children: Element[] = []; parent: Element | null = null; className = ''; dataset: Record<string, string> = {}; attrs = new Map(); listeners: Record<string, Function> = {}; textContent = ''; tabIndex = -1; scrollTop = 0; top = 0; disabled = false;
  classList = { add: (name: string) => { this.className += ' ' + name; }, contains: (name: string) => this.className.split(' ').includes(name), toggle: (name: string, on: boolean) => { this.attrs.set(name, on); } };
  setAttribute(k: string, v: string) { this.attrs.set(k, v); }
  append(...nodes: Element[]) { nodes.forEach(node => { node.parent = this; this.children.push(node); }); }
  appendChild(node: Element) { this.append(node); }
  replaceChildren() { this.children = []; }
  addEventListener(name: string, fn: Function) { this.listeners[name] = fn; }
  removeEventListener(name: string) { delete this.listeners[name]; }
  getBoundingClientRect() { return { top: this.top }; }
  focused: unknown;
  focus(options: unknown) { this.focused = options; }
  contains(node: Element | null): boolean { return node === this || this.children.some(child => child.contains(node)); }
}

function harness(offline = false, pathActive = false, acceptsSelection = true) {
  const mounted: any[] = [], selected: string[] = [], opened: any[] = [], lookups: string[] = [];
  const window: any = {};
  const document = { createElement: () => new Element(), createTextNode: (text: string) => Object.assign(new Element(), { textContent: text }) };
  new Function('window', 'document', runtime)(window, document);
  const host = new Element();
  const steps = Array.from({ length: 40 }, (_, i) => ({ id: 'm' + i, label: 'same()', callShaped: true, from: 'a', to: 'b' }));
  const sources: Record<string, any[]> = { m0: [{ path: 'before.ts', side: 'old', startLine: 2, endLine: 2, quote: '<unsafe>' }, { path: 'after.ts', side: 'new', startLine: 4, endLine: 4, quote: 'after' }], m1: [{ path: 'current.ts', side: 'new', startLine: 1, endLine: 1, quote: 'candidate', definition: true }] };
  sources.m39 = Array.from({ length: 9 }, (_, i) => ({ path: 'last.ts', side: 'new', startLine: i + 1, endLine: i + 1, quote: 'last step' }));
  const controller = window.DiffCompassSequenceWalkthrough.mount(host, steps, { offline, pathActive: () => pathActive, anchors: (id: string) => sources[id] || [],
    selectDiagram: (id: string) => { selected.push(id); return acceptsSelection; }, open: (...args: any[]) => opened.push(args), lookup: (id: string) => lookups.push(id), mountPreview: (_host: Element, anchor: any) => mounted.push(anchor) });
  const entries = host.children.filter(node => node.dataset.sequenceMessageId);
  entries.forEach((entry, i) => { entry.top = i * 200; });
  return { host, controller, entries, mounted, selected, opened, lookups, sources, window, excerpt: window.DiffCompassSequenceWalkthrough.mountExcerpt };
}

test('showing a code step reveals even the retained selection and focuses its heading without scrolling ancestors', () => {
  for (const offline of [false, true]) {
    const h = harness(offline);
    h.controller.select('m3', 'diagram');
    h.host.scrollTop = 0;
    h.controller.show('m3');
    expect(h.host.scrollTop).toBe(588);
    expect(h.controller.selected).toBe('m3');
    expect(h.entries[3]!.children[0]!.focused).toEqual({ preventScroll: true });
    expect(h.selected).toEqual(['m3']);
    h.controller.show('unknown');
    expect(h.host.scrollTop).toBe(588); expect(h.selected).toEqual(['m3']);
    expect(h.opened).toEqual([]); expect(h.lookups).toEqual([]);
    h.controller.dispose();
  }
  const rejected = harness(false, true, false);
  rejected.controller.show('m3');
  expect(rejected.controller.selected).toBeNull(); expect(rejected.host.scrollTop).toBe(0);
  expect(rejected.entries[3]!.children[0]!.focused).toBeUndefined();
  expect(rejected.entries[3]!.children[2]!.hidden).toBe(false);
  rejected.controller.dispose();
});

test('read-only excerpt host treats markup literally and caps long current-source candidates', () => {
  const h = harness(), host = new Element();
  h.excerpt(host, { path: 'huge.ts', side: 'new', definition: true, startLine: 12, endLine: 12, quote: '</script><b>' + 'x'.repeat(9000) });
  const pre = host.children.find(node => node.className === 'sequence-step-code')!;
  expect(pre.children[0]!.children[2]!.textContent).toStartWith('</script><b>');
  expect(pre.children[0]!.children[2]!.textContent).toHaveLength(8000);
  expect(host.children.at(-1)!.textContent).toContain('truncated');
  const lines = new Element();
  h.excerpt(lines, { path: 'lines.ts', side: 'old', startLine: 1, endLine: 30, quote: Array(30).fill('line').join('\n') });
  expect(lines.children.find(node => node.className === 'sequence-step-code')!.children).toHaveLength(20);
  h.controller.dispose();
});

test('all saved previews preload without visibility or selection; missing evidence offers explicit lookup', () => {
  const h = harness();
  expect(h.mounted).toHaveLength(4);
  expect(h.mounted.slice(0, 2).map(a => a.side)).toEqual(['old', 'new']);
  expect(h.entries[39]!.children[1]!.children).toHaveLength(1);
  expect(h.mounted[3].quote.split('\n')).toHaveLength(8);
  expect(h.mounted[3].endLine).toBe(8);
  expect(h.selected).toEqual([]);
  expect(h.opened).toEqual([]);
  expect(h.lookups).toEqual([]);
  expect(h.host.scrollTop).toBe(0);
  expect(h.entries[0]!.children[0]!.children[0]!.textContent).toBe('Step 1 of 40');
  expect(h.entries[39]!.children[0]!.children[0]!.textContent).toBe('Step 40 of 40');
  h.controller.select('m1', 'diagram');
  expect(h.entries[1]!.children[1]!.children[0]!.children[0]!.textContent).toContain('Current workspace · name match');
  expect(h.entries[1]!.children[1]!.children[0]!.children[1]!.textContent).toBe('View code');
  h.entries[1]!.children[1]!.children[0]!.children[1]!.listeners.click!();
  expect(h.opened).toEqual([['m1', 0]]);
  h.controller.select('m2', 'diagram');
  h.entries[2]!.children[1]!.children[1]!.listeners.click!();
  expect(h.lookups).toEqual(['m2']);
  h.sources.m2 = [{ path: 'found.ts', side: 'new', startLine: 1, endLine: 1, quote: 'found', definition: true }];
  h.controller.refresh('m2');
  expect(h.mounted.at(-1).path).toBe('found.ts');
  h.sources.m2[0].comparisonMatch = true;
  h.controller.refresh('m2');
  expect(h.entries[2]!.children[1]!.children[0]!.children[0]!.textContent).toContain('After · name match in captured source');
  expect(h.entries[2]!.children[1]!.children[0]!.children[1]!.textContent).toBe('View code');
  h.controller.dispose();
});

test('scroll position and refreshed previews do not change explicit selection or reveal it again', () => {
  const h = harness();
  h.controller.select('m0', 'diagram');
  h.entries.forEach(entry => { entry.top -= 420; });
  h.host.scrollTop = 420;
  h.controller.select('m0', 'diagram'); // asynchronous iframe observer echo
  expect(h.host.scrollTop).toBe(420);
  h.controller.refresh('m2'); h.controller.reset();
  expect(h.controller.selected).toBe('m0'); expect(h.selected).toEqual([]);
  expect(h.host.scrollTop).toBe(420);
  h.host.listeners.click!(); // pane/scrollbar click restores native pin only
  expect(h.selected).toEqual(['m0']); expect(h.host.scrollTop).toBe(420);
  h.controller.dispose();
});

test('grouped listing uses its earliest original anchor for View code, and offline keeps the same range without actions', () => {
  for (const offline of [false, true]) {
    const h = harness(offline, true);
    h.sources.m0 = [
      { path: 'other.ts', side: 'old', startLine: 3, endLine: 3, quote: 'before' },
      { path: 'cart.ts', side: 'new', startLine: 17, endLine: 17, quote: 'return amount;' },
      { path: 'cart.ts', side: 'new', startLine: 16, endLine: 16, quote: 'if (!discount) return amount;' },
    ];
    h.controller.refresh('m0');
    const sections = h.entries[0]!.children[1]!.children;
    expect(sections).toHaveLength(2);
    expect(sections[1]!.children[0]!.textContent).toContain('After · captured comparison evidence · cart.ts:16–17');
    expect(h.mounted.at(-1).quote).toBe('if (!discount) return amount;\nreturn amount;');
    expect(sections[1]!.children).toHaveLength(offline ? 1 : 2);
    if (!offline) { sections[1]!.children[1]!.listeners.click!(); expect(h.opened).toEqual([['m0', 2, [1, 2]]]); }
    // Revalidation replaces the presentation instead of retaining stale groups.
    h.sources.m0 = []; h.controller.reset();
    expect(h.entries[0]!.children[1]!.children[0]!.textContent).toContain(offline ? 'No saved source evidence' : 'No validated source anchor');
    h.controller.dispose();
  }
});

test('collapsed pane keeps its scroll position while arrow selection still updates', () => {
  const h = harness();
  h.host.scrollTop = 345; h.host.hidden = true;
  h.controller.select('m39', 'diagram-click');
  expect(h.controller.selected).toBe('m39');
  expect(h.selected).toEqual(['m39']);
  expect(h.host.scrollTop).toBe(345);
  h.host.hidden = false;
  h.controller.select('m39', 'action');
  expect(h.host.scrollTop).toBe(345);
  h.controller.dispose();
});

test('View code and definition lookup select their own step before opening, including during Paths', () => {
  const h = harness(false, true);
  h.controller.select('m0', 'route');
  // The bridge routes these selections through the native path controller.
  // Source actions still use their exact message and anchor index.
  h.entries[0]!.children[1]!.children[1]!.children[1]!.listeners.click!();
  h.entries[1]!.children[1]!.children[0]!.children[1]!.listeners.click!();
  h.entries[2]!.children[1]!.children[1]!.listeners.click!();
  expect(h.opened).toEqual([['m0', 1], ['m1', 0]]);
  expect(h.lookups).toEqual(['m2']); expect(h.selected).toEqual(['m0', 'm1', 'm2']);
  expect(h.controller.selected).toBe('m2'); h.controller.dispose();
});

test('card background, labels and code select without reveal; text selection and handled actions are left alone', () => {
  const h = harness(); h.controller.select('m0', 'diagram'); h.host.scrollTop = 420;
  const card = h.entries[1]!, label = card.children[1]!.children[0]!.children[0]!;
  for (const target of [card, label, card.children[1]]) {
    h.controller.select('m0', 'diagram'); h.host.scrollTop = 420;
    card.listeners.click!({ target });
    expect(h.controller.selected).toBe('m1'); expect(h.host.scrollTop).toBe(420);
    h.controller.select('m1', 'route'); expect(h.host.scrollTop).toBe(420);
  }
  h.controller.select('m0', 'diagram'); const count = h.selected.length;
  h.window.getSelection = () => ({ isCollapsed: false, anchorNode: label, focusNode: label });
  card.listeners.click!({ target: label });
  card.listeners.click!({ target: { closest: () => ({}) } });
  card.listeners.click!({ target: card, defaultPrevented: true });
  expect(h.selected).toHaveLength(count); expect(h.controller.selected).toBe('m0');
  h.window.getSelection = () => ({ isCollapsed: true });
  card.listeners.click!({ target: label }); expect(h.controller.selected).toBe('m1');
  h.controller.dispose();
});

test('unavailable path selections keep the old step and scroll, show a notice, and leave exact source actions usable', () => {
  const h = harness(false, true, false); h.controller.select('m0', 'route'); h.host.scrollTop = 420;
  const card = h.entries[1]!;
  card.listeners.click!({ target: card });
  expect(h.controller.selected).toBe('m0'); expect(h.host.scrollTop).toBe(420);
  expect(card.children[2]!.hidden).toBe(false); expect(card.children[2]!.textContent).toContain('current path');
  card.children[1]!.children[0]!.children[1]!.listeners.click!();
  expect(h.opened).toEqual([['m1', 0]]); expect(h.controller.selected).toBe('m0');
  h.controller.select('m2', 'route'); expect(card.children[2]!.hidden).toBe(true);
  h.controller.dispose();
});

test('path card selection uses exact route edge position for repeated captions, returns and self calls', () => {
  const steps = sequenceWalkthroughSteps(sequenceCandidate(flow)!.ir);
  const result = { nodes: [steps[0]!.from, steps[0]!.to, steps[1]!.to, steps[2]!.to], hops: 3 };
  const edge = (step: any, index: any) => ({ getAttribute: (name: string) => ({ 'data-edge-id': step.id, 'data-edge-from': step.from, 'data-edge-to': step.to, 'data-route-step': index } as any)[name] ?? null });
  let items = steps.map((step, index) => edge(step, String(index)));
  const svg = { querySelectorAll: () => items };
  const events: any[] = [];
  const archify: any = { routeProbe: { active: () => 'result', result: () => result, selectJourneyIndex: (index: number) => { events.push(index); return true; } }, focus: { relationship: () => null, inspectRelationshipById: () => { throw Error('Must not replace active path'); } } };
  for (let index = 0; index < steps.length; index++) {
    expect(api.DiffCompassSequenceWalkthrough.selectMessage(svg, steps, archify, steps[index]!.id)).toBe(true);
    expect(events.at(-1)).toBe(index + 1);
  }
  items = [edge(steps[0], '0'), edge(steps[0], '0')];
  expect(api.DiffCompassSequenceWalkthrough.routeStep(svg, steps, result, steps[0]!.id)).toBe(1);
  // Off-route, unknown, malformed/stale/ambiguous IDs and missing optional API
  // never fall back to a relationship pin or a participant/caption guess.
  for (const id of [steps[1]!.id, 'unknown']) expect(api.DiffCompassSequenceWalkthrough.selectMessage(svg, steps, archify, id)).toBe(false);
  for (const index of ['-1', '', null, '1.5', '3', '1']) {
    items = [edge(steps[0], index)]; expect(api.DiffCompassSequenceWalkthrough.routeStep(svg, steps, result, steps[0]!.id)).toBeNull();
  }
  items = [edge(steps[0], '0'), edge({ ...steps[0], from: 'stale' }, '0')];
  expect(api.DiffCompassSequenceWalkthrough.routeStep(svg, steps, result, steps[0]!.id)).toBeNull();
  const repeated = { nodes: [steps[0]!.from, steps[0]!.to, steps[0]!.from, steps[0]!.to], hops: 3 };
  items = [edge(steps[0], '0'), edge(steps[0], '2')];
  expect(api.DiffCompassSequenceWalkthrough.routeStep(svg, steps, repeated, steps[0]!.id)).toBeNull();
  items = [edge(steps[0], '0')];
  for (const missing of [null, { nodes: [], hops: 3 }, { nodes: result.nodes, hops: '3' }]) expect(api.DiffCompassSequenceWalkthrough.routeStep(svg, steps, missing, steps[0]!.id)).toBeNull();
  delete archify.routeProbe.selectJourneyIndex;
  expect(api.DiffCompassSequenceWalkthrough.selectMessage(svg, steps, archify, steps[0]!.id)).toBe(false);
  archify.routeProbe.result = () => null; archify.routeProbe.active = () => 'target';
  expect(api.DiffCompassSequenceWalkthrough.selectMessage(svg, steps, archify, steps[0]!.id)).toBe(false);
  archify.routeProbe.active = () => null; archify.focus.inspectRelationshipById = (id: string, options: any) => events.push([id, options]);
  expect(api.DiffCompassSequenceWalkthrough.selectMessage(svg, steps, archify, steps[0]!.id)).toBe(true);
  expect(events.at(-1)).toEqual([steps[0]!.id, { toggle: false, updateUrl: false }]);
});

test('ending Paths clears only path notices even without a selected step, live or offline', () => {
  for (const offline of [false, true]) for (const selected of [null, 'm0']) {
    const h = harness(offline, true, false);
    if (selected) h.controller.select(selected, 'route');
    h.host.scrollTop = 420;
    const card = h.entries[2]!, evidence = card.children[1]!.children[0]!;
    card.listeners.click!({ target: card });
    expect(card.children[2]!.hidden).toBe(false);
    const evidenceText = evidence.textContent;
    h.controller.clearSelectionNotices(); h.controller.clearSelectionNotices();
    expect(h.entries.every(entry => entry.children[2]!.hidden)).toBe(true);
    expect(h.controller.selected).toBe(selected); expect(h.host.scrollTop).toBe(420);
    expect(evidence.textContent).toBe(evidenceText); expect(evidence.hidden).toBe(false);
    expect(h.selected).toEqual(['m2']); expect(h.opened).toEqual([]); expect(h.lookups).toEqual([]);
    h.controller.dispose();
  }
});

test('journey emphasis follows validated identity across fragments and clears in overview or ambiguous state', () => {
  const steps = sequenceWalkthroughSteps(sequenceCandidate(flow)!.ir);
  const edges = [steps[0], steps[0], steps[1], { ...steps[0], to: 'stale' }].map(step => {
    const attrs: any = { 'data-edge-id': step!.id, 'data-edge-from': step!.from, 'data-edge-to': step!.to };
    return { getAttribute: (name: string) => attrs[name], setAttribute: (key: string, value: string) => { attrs[key] = value; }, removeAttribute: (key: string) => { delete attrs[key]; }, attrs };
  });
  let journey = true, current = [edges[0]];
  const svg = { hasAttribute: () => journey, querySelectorAll: (selector: string) => selector.includes('data-route-journey-current') ? current : edges };
  api.DiffCompassSequenceWalkthrough.routeEmphasis(svg, steps);
  expect(edges.map(edge => edge!.attrs['data-sequence-route-current'] !== undefined)).toEqual([true, true, false, false]);
  current = [edges[0], edges[2]]; api.DiffCompassSequenceWalkthrough.routeEmphasis(svg, steps);
  expect(edges.every(edge => edge.attrs['data-sequence-route-current'] === undefined)).toBe(true);
  current = [edges[2]]; api.DiffCompassSequenceWalkthrough.routeEmphasis(svg, steps);
  expect(edges[2]!.attrs['data-sequence-route-current']).toBe('');
  journey = false; api.DiffCompassSequenceWalkthrough.routeEmphasis(svg, steps);
  expect(edges.every(edge => edge.attrs['data-sequence-route-current'] === undefined)).toBe(true);
});

test('source action and later pane scroll retain the same explicit selection', () => {
    const h = harness(); h.controller.select('m1', 'diagram');
    const source = h.entries[1]!.children[1]!.children[0]!.children[1]!;
    source.listeners.click!();
    h.entries.forEach(entry => { entry.top -= 420; });
    h.host.scrollTop = 420;
    expect(h.controller.selected).toBe('m1'); expect(h.opened).toEqual([['m1', 0]]);
    expect(h.selected).toEqual(['m1']); expect(h.host.scrollTop).toBe(420);
    h.controller.dispose();
});

test('automatic lookup is sequential, skips saved/non-call steps and retries only explicitly or after revalidation', async () => {
  const calls: string[] = [], sources: Record<string, any[]> = { saved: [{}] };
  let busy = false, ready = true;
  const steps = [{ id: 'saved', callShaped: true }, { id: 'first', callShaped: true }, { id: 'prose', callShaped: false }, { id: 'second', callShaped: true }];
  const preload = api.DiffCompassSequenceWalkthrough.preloadDefinitions(steps, {
    anchors: (id: string) => sources[id] || [], busy: () => busy, ready: () => ready,
    lookup: (id: string) => { busy = true; calls.push(id); preload.pump(); },
  });
  preload.pump(); preload.pump(); await Bun.sleep(0);
  expect(calls).toEqual(['first']);
  preload.pump(); await Bun.sleep(0); expect(calls).toHaveLength(1);
  busy = false; preload.pump(); await Bun.sleep(0);
  expect(calls).toEqual(['first', 'second']);
  busy = false; preload.pump(); await Bun.sleep(0); expect(calls).toHaveLength(2);
  ready = false; preload.reset(); await Bun.sleep(0); expect(calls).toHaveLength(2);
  ready = true; preload.reset(); await Bun.sleep(0); expect(calls.at(-1)).toBe('first');
  busy = false; preload.pump(); preload.stop(); await Bun.sleep(0); expect(calls).toHaveLength(3);
});

test('automatic lookup caps work at forty steps and never runs offline', async () => {
  const calls: string[] = [];
  const steps = Array.from({ length: 41 }, (_, i) => ({ id: 'm' + i, callShaped: true }));
  const bridge = { anchors: () => [], busy: () => false, ready: () => true, lookup: (id: string) => calls.push(id) };
  const preload = api.DiffCompassSequenceWalkthrough.preloadDefinitions(steps, bridge);
  for (let i = 0; i < 43; i++) { preload.pump(); await Promise.resolve(); }
  expect(calls).toHaveLength(40); expect(calls.at(-1)).toBe('m39');
  const offline = api.DiffCompassSequenceWalkthrough.preloadDefinitions(steps, { ...bridge, offline: true });
  offline.pump(); offline.reset(); await Promise.resolve(); expect(calls).toHaveLength(40);
});

test('lookup bridge rejects stale same-step replies and clears pending work on reset, timeout and disposal', () => {
  const events: Record<string, Function> = {}, messages: any[] = [], changes: any[] = [], timers = new Map<number, Function>();
  let serial = 0;
  const window: any = { addEventListener: (name: string, fn: Function) => { events[name] = fn; } };
  const parent = { postMessage: (message: any) => messages.push(message) };
  const script = sequenceSourceScript({}).match(/<script[^>]*>([\s\S]*?)<\/script>/)![1]!;
  new Function('window', 'document', 'parent', 'MutationObserver', 'setTimeout', 'clearTimeout', script)(window,
    { readyState: 'complete', querySelector: () => new Element(), getElementById: () => new Element(), createElement: () => new Element() },
    parent, class { observe() {} }, (fn: Function) => { timers.set(++serial, fn); return serial; }, (id: number) => timers.delete(id));
  const actions = window.diffcompassSequenceSourceActions;
  actions.onChange = (...args: any[]) => changes.push(args);
  const reply = (request: any, anchors: any[] = []) => events.message!({ source: parent, data: { ...request, type: 'diffcompass-sequence-lookup-result', anchors } });
  actions.lookup('same'); const first = messages.at(-1);
  expect(actions.busy()).toBe(true); expect(timers.size).toBe(1);
  actions.lookup('other'); expect(messages).toHaveLength(1);
  events.message!({ source: parent, data: { type: 'diffcompass-sequence-evidence', sources: {}, notice: 'Revalidating' } });
  expect(actions.ready()).toBe(false); expect(actions.busy()).toBe(false); expect(timers.size).toBe(0);
  events.message!({ source: parent, data: { type: 'diffcompass-sequence-evidence', sources: {} } });
  expect(actions.ready()).toBe(true);
  actions.lookup('same'); const second = messages.at(-1);
  expect(second.requestId).not.toBe(first.requestId);
  reply(first, [{ quote: 'stale' }]); expect(actions.busy()).toBe(true); expect(actions.anchors('same')).toEqual([]);
  const candidates = [{ definition: true, quote: 'first candidate' }, { definition: true, quote: 'second candidate' }];
  reply(second, candidates); expect(actions.anchors('same')).toEqual(candidates); expect(timers.size).toBe(0);
  actions.lookup('missing'); reply(messages.at(-1));
  expect(actions.notice('missing')).toContain('No matching definition'); expect(actions.busy()).toBe(false);
  actions.lookup('slow'); const slow = messages.at(-1); timers.values().next().value!();
  expect(actions.notice('slow')).toContain('timed out'); expect(changes.at(-1)).toEqual(['slow', true]);
  actions.lookup('slow'); const retry = messages.at(-1);
  reply(slow, candidates); expect(actions.busy()).toBe(true); reply(retry, candidates); expect(actions.busy()).toBe(false);
  actions.lookup('dispose'); events.pagehide!(); expect(actions.busy()).toBe(false);
  reply(messages.at(-1), candidates); expect(actions.anchors('dispose')).toEqual([]);
});

test('pane keys remain native scrolling; heading keys explicitly select and reveal steps', () => {
  const h = harness();
  let prevented = 0;
  const key = { key: 'End', target: h.host, preventDefault() { prevented++; }, stopPropagation() {} };
  h.host.listeners.keydown!(key);
  expect(h.selected).toEqual([]); expect(prevented).toBe(0);
  h.host.listeners.keydown!({ ...key, target: h.entries[0]!.children[0] });
  expect(h.selected).toEqual(['m39']);
  expect(prevented).toBe(1);
  expect(h.host.scrollTop).toBeGreaterThan(0);
  h.host.listeners.keydown!({ ...key, key: 'Home', target: new Element() });
  expect(h.selected).toEqual(['m39']);
  h.controller.dispose();
});

test('offline excerpts retain before/after labels and disable online-only actions', () => {
  const h = harness(true);
  const body = h.entries[0]!.children[1]!;
  expect(h.entries[39]!.children[1]!.children).toHaveLength(1);
  expect(h.mounted.at(-1).endLine).toBe(8);
  expect(body.children[0]!.children[0]!.textContent).toContain('Before · captured comparison evidence');
  expect(body.children[1]!.children[0]!.textContent).toContain('After · captured comparison evidence');
  expect(body.children[0]!.children).toHaveLength(1);
  h.controller.select('m2', 'diagram');
  expect(h.entries[2]!.children[1]!.children).toHaveLength(1);
  expect(h.entries[2]!.children[1]!.children[0]!.textContent).toContain('live review');
  h.controller.dispose();
});

test('excerpt rows show captured additions/removals, safe theme tokens and scoped counts', () => {
  const h = harness(), host = new Element();
  const tokens = [{ content: '<script>', light: '112233', dark: 'aabbcc', fontStyle: 3 }];
  h.excerpt(host, { path: 'safe.ts', side: 'old', startLine: 9, endLine: 11, quote: '<script>\nremoved\nadded', preview: { language: 'typescript', kinds: ['context', 'deletion', 'addition'], tokens: [tokens, [], []] } });
  expect(host.children[0]!.children[0]!.textContent).toBe('typescript');
  expect(host.children[0]!.children[1]!.attrs.get('aria-label')).toBe('1 added and 1 removed lines in this excerpt');
  const rows = host.children[1]!.children;
  expect(rows[0]!.children[0]!.textContent).toBe(' ');
  expect(rows[1]!.children[0]!.textContent).toBe('−'); expect(rows[2]!.children[0]!.textContent).toBe('+');
  expect(rows[1]!.children[1]!.textContent).toBe('10');
  const token = rows[0]!.children[2]!.children[0]!;
  expect(token.textContent).toBe('<script>'); expect(token.attrs.get('style')).toBe('--syntax-light:#112233;--syntax-dark:#aabbcc');
  expect(token.className).toContain('syntax-bold'); expect(rows[1]!.children[2]!.textContent).toBe('removed');
  const unknown = new Element();
  h.excerpt(unknown, { path: 'current.ts', side: 'new', startLine: 1, endLine: 1, quote: 'current', definition: true });
  expect(unknown.children[0]!.children[1]!.textContent).toBe('Changes unavailable');
  expect(unknown.children[1]!.children[0]!.className).toContain('unknown');
  h.controller.dispose();
});

test('live and offline adapter use one runtime and safely serialize hostile evidence/captions', () => {
  const ir = { messages: [{ id: 'id', label: '</script><script>bad()</script>', from: 'a', to: 'b' }] };
  const sources = { id: [{ path: 'x.ts', side: 'old' as const, startLine: 1, endLine: 1, quote: '</script><script>bad()</script>' }] };
  for (const offline of [true, false]) {
    const html = withArchifyEmbedAdapter('<html><body></body></html>', 'sequence', undefined, false, undefined, sources, { ir, offline });
    expect(html).toContain('data-diffcompass-sequence-walkthrough');
    expect(html).not.toContain('</script><script>bad()');
    expect(html).toContain(`offline=${offline}`);
    for (const match of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) expect(() => new Function(match[1]!)).not.toThrow();
  }
  expect(sequenceWalkthroughScript(ir)).not.toContain('</script><script>bad()');
});

test('same-frame evidence refresh rejects stale responses, clears candidates, survives errors and preserves iframe', async () => {
  const source = await Bun.file(new URL('../public/sequence-walkthrough-host.js', import.meta.url)).text();
  const { refresh, revision } = new Function(source.replaceAll('export function', 'function') + ';return {refresh:refreshSequenceEvidence,revision:sequenceEvidenceRevision};')();
  const session = { comparison: { mergeBase: 'before', head: 'head', sourceTree: 'after' }, revision: 1, outline: { flows: [{ id: 'flow', outdated: false }] } };
  const artifact = { id: 'sequence-flow', renderedAt: 'now' };
  const key = revision(session, artifact);
  session.revision++;
  expect(revision(session, artifact)).toBe(key);
  session.outline.flows[0]!.outdated = true;
  expect(revision(session, artifact)).not.toBe(key);
  const messages: any[] = [];
  const frame: any = { isConnected: true, contentWindow: { postMessage: (v: any) => messages.push(v) } };
  let resolveFirst: Function = () => {}, calls = 0;
  refresh(frame, 1, () => { calls++; return new Promise(resolve => { resolveFirst = resolve; }); });
  await Promise.resolve();
  refresh(frame, 2, () => { calls++; return { current: [] }; });
  await Bun.sleep(0);
  resolveFirst({ stale: [] }); await Bun.sleep(0);
  expect(messages).toEqual([
    { type: 'diffcompass-sequence-evidence', sources: {}, notice: 'Review changed. Revalidating source evidence…' },
    { type: 'diffcompass-sequence-evidence', sources: { current: [] } },
  ]);
  refresh(frame, 2, () => { calls++; }); await Bun.sleep(0);
  expect(calls).toBe(2);
  refresh(frame, 3, () => Promise.reject(new Error('offline'))); await Bun.sleep(0);
  expect(messages.at(-1).notice).toContain('could not be refreshed');
  expect(frame._sequenceEvidenceRevision).toBeUndefined();
  refresh(frame, 3, () => ({ retry: [] })); await Bun.sleep(0);
  expect(messages.at(-1).sources).toEqual({ retry: [] });
  frame.isConnected = false;
  const previous = messages.length;
  refresh(frame, 4, () => ({ removed: [] })); await Bun.sleep(0);
  expect(messages.slice(previous).some(m => m.sources.removed)).toBe(false);
});

test('bundled motion compatibility guards optional guided-view methods and preserves real pauses', () => {
  const original = `<html><body><script data-motion-fixture>if (paused && lastEffectivePaused !== true && Archify.guidedViews && Archify.guidedViews.isPlaying()) { Archify.guidedViews.pause(); }</script></body></html>`;
  const once = withArchifyEmbedAdapter(original);
  const twice = withArchifyEmbedAdapter(once);
  const extract = (html: string) => html.match(/<script data-motion-fixture>([\s\S]*?)<\/script>/)![1]!;
  expect(extract(twice)).toBe(extract(once));
  const execute = new Function('Archify', 'paused', 'lastEffectivePaused', extract(once));
  for (const guidedViews of [undefined, { count: 0, active: () => null }, { isPlaying: true }, { isPlaying: () => true }]) {
    expect(() => execute({ guidedViews }, true, false)).not.toThrow();
  }
  let pauses = 0;
  const guidedViews = { isPlaying: () => true, pause: () => pauses++ };
  execute({ guidedViews }, false, false);
  execute({ guidedViews }, true, true);
  expect(pauses).toBe(0);
  execute({ guidedViews }, true, false);
  expect(pauses).toBe(1);
  execute({ guidedViews: { ...guidedViews, isPlaying: () => false } }, true, false);
  expect(pauses).toBe(1);
});

test('sequence starts readable at its first participant; non-sequence maps retain overview Fit', () => {
  for (const type of ['sequence', 'architecture']) {
    const html = withArchifyEmbedAdapter('<html><body></body></html>', type);
    const script = html.match(/<script data-diffcompass-camera>([\s\S]*?)<\/script>/)![1]!;
    const initial = script.slice(script.indexOf('function initialFrame()'), script.indexOf('function zoom(next'));
    const state = { scale: 0, x: 0, y: 0 };
    let fitted = false, applied = false;
    new Function('metrics', 'svg', 'state', 'apply', 'fitAll', initial + ';initialFrame();')(
      () => ({ viewport: { left: 0, top: 0, width: 300, height: 300 } }),
      { viewBox: { baseVal: { x: 0, y: 0 } }, querySelector: () => ({ getBBox: () => ({ x: 62, y: 72, width: 240, height: 54 }) }) },
      state, () => { applied = true; }, () => { fitted = true; },
    );
    if (type === 'sequence') {
      expect(state.scale * 9).toBeGreaterThanOrEqual(12);
      expect(state.x + 62 * state.scale).toBeGreaterThanOrEqual(0);
      expect(state.y + 72 * state.scale).toBeGreaterThanOrEqual(0);
      expect(applied).toBe(true); expect(fitted).toBe(false);
    } else expect(fitted).toBe(true);
  }
});

test('source navigation shares exact captured candidate destinations, retains current fallback and canonicalizes old rename paths', async () => {
  const host = await Bun.file(new URL('../public/sequence-walkthrough-host.js', import.meta.url)).text();
  const sourceSelection = new Function(host.replaceAll('export function', 'function') + ';return sequenceSourceSelection;')();
  const app = await Bun.file(new URL('../public/app.js', import.meta.url)).text();
  const script = app.slice(app.indexOf('async function openSequenceSource('), app.indexOf('function returnToSequenceDiagram('));
  const calls: any[] = [];
  const frame: any = { isConnected: true, dataset: { archifyArtifactId: 'sequence-fixture' }, getClientRects: () => [{}], contentWindow: { postMessage() {} } };
  const state: any = { activeTab: 'archify', session: { comparison: { files: [{ path: 'renamed.ts', oldPath: 'original.ts' }] } } };
  let anchor: any = { path: 'original.ts', side: 'old', startLine: 2, endLine: 2 };
  const open = new Function('state', 'document', 'elements', 'window', 'api', 'renderActiveTab', 'showAnalysisFile', 'showRepositoryFile', 'diffViewRow', 'updateSequenceSourceReturnVisibility', 'toast', 'sequenceSourceSelection', script + ';return openSequenceSource;')(
    state, { querySelectorAll: () => [frame] }, { 'diff-panel': { scrollTop: 100 } }, {}, async () => ({ edge: [anchor] }), () => {},
    (...args: any[]) => calls.push(['comparison', ...args]), (...args: any[]) => calls.push(['current', ...args]), () => null, () => {}, () => {}, sourceSelection,
  );
  const event = { source: frame.contentWindow, data: { type: 'diffcompass-sequence-source', edgeId: 'edge', anchorIndex: 0 } };
  await open(event);
  expect(calls).toEqual([['comparison', 'renamed.ts', 2, 'old']]);
  state.activeTab = 'archify'; anchor = { ...anchor, path: 'renamed.ts', side: 'new', definition: true };
  await open(event);
  expect(calls.at(-1)).toEqual(['current', 'renamed.ts', 2, 'Current workspace · name match']);
  state.activeTab = 'archify'; anchor = { ...anchor, comparisonMatch: true };
  await open(event);
  expect(calls.at(-1)).toEqual(['comparison', 'renamed.ts', 2, 'new']);
});
