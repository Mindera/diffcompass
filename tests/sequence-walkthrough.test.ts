import { expect, test } from "bun:test";
import { sequenceCandidate } from "../src/archify.ts";
import { sequenceWalkthroughScript, sequenceWalkthroughSteps } from "../src/sequence-walkthrough.ts";
import { withArchifyEmbedAdapter } from "../src/archify-embed.ts";
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

test('selection separates diagram reveal from scroll selection and absorbs delayed observer echoes', () => {
  const events: string[] = [];
  const controller = api.DiffCompassSequenceWalkthrough.selectionController(['first', 'same-caption', 'return'], {
    mark: (id: string) => events.push('mark:' + id),
    selectDiagram: (id: string) => events.push('diagram:' + id),
    reveal: (id: string) => events.push('reveal:' + id),
  });
  controller.select('first', 'diagram');
  expect(events).toEqual(['mark:first', 'reveal:first']);
  events.length = 0;
  controller.select('same-caption', 'scroll');
  controller.select('same-caption', 'diagram');
  controller.select('forged', 'diagram');
  expect(events).toEqual(['mark:same-caption', 'diagram:same-caption']);
  expect(controller.selected).toBe('same-caption');
  events.length = 0;
  controller.select('return', 'keyboard');
  expect(events).toEqual(['mark:return', 'diagram:return', 'reveal:return']);
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
  children: Element[] = []; parent: Element | null = null; className = ''; dataset: Record<string, string> = {}; attrs = new Map(); listeners: Record<string, Function> = {}; textContent = ''; tabIndex = -1; scrollTop = 0; top = 0; disabled = false;
  classList = { add: (name: string) => { this.className += ' ' + name; }, contains: (name: string) => this.className.split(' ').includes(name), toggle: (name: string, on: boolean) => { this.attrs.set(name, on); } };
  setAttribute(k: string, v: string) { this.attrs.set(k, v); }
  append(...nodes: Element[]) { nodes.forEach(node => { node.parent = this; this.children.push(node); }); }
  replaceChildren() { this.children = []; }
  addEventListener(name: string, fn: Function) { this.listeners[name] = fn; }
  removeEventListener(name: string) { delete this.listeners[name]; }
  getBoundingClientRect() { return { top: this.top }; }
  focus() {}
}

function harness(offline = false) {
  let intersect: Function = () => {}, resize: Function = () => {};
  const frames: Function[] = [], mounted: any[] = [], selected: string[] = [], opened: any[] = [], lookups: string[] = [];
  const window: any = {};
  const document = { createElement: () => new Element(), createTextNode: (text: string) => Object.assign(new Element(), { textContent: text }) };
  new Function('window', 'document', 'IntersectionObserver', 'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame', runtime)(window, document,
    class { constructor(fn: Function) { intersect = fn; } observe() {} disconnect() {} },
    class { constructor(fn: Function) { resize = fn; } observe() {} disconnect() {} },
    (fn: Function) => { frames.push(fn); return frames.length; }, () => {});
  const host = new Element();
  const steps = Array.from({ length: 40 }, (_, i) => ({ id: 'm' + i, label: 'same()', callShaped: true, from: 'a', to: 'b' }));
  const sources: Record<string, any[]> = { m0: [{ path: 'before.ts', side: 'old', startLine: 2, endLine: 2, quote: '<unsafe>' }, { path: 'after.ts', side: 'new', startLine: 4, endLine: 4, quote: 'after' }], m1: [{ path: 'current.ts', side: 'new', startLine: 1, endLine: 1, quote: 'candidate', definition: true }] };
  const controller = window.DiffCompassSequenceWalkthrough.mount(host, steps, { offline, anchors: (id: string) => sources[id] || [],
    selectDiagram: (id: string) => selected.push(id), open: (...args: any[]) => opened.push(args), lookup: (id: string) => lookups.push(id), mountPreview: (_host: Element, anchor: any) => mounted.push(anchor) });
  const entries = host.children.filter(node => node.dataset.sequenceMessageId);
  entries.forEach((entry, i) => { entry.top = i * 200; });
  return { host, controller, entries, mounted, selected, opened, lookups, sources, excerpt: window.DiffCompassSequenceWalkthrough.mountExcerpt, intersect: () => intersect([{ target: entries[0], isIntersecting: true }]), resize: () => resize(), flush: () => { frames.splice(0).forEach(fn => fn()); } };
}

test('read-only excerpt host treats markup literally and caps long current-source candidates', () => {
  const h = harness(), host = new Element();
  h.excerpt(host, { path: 'huge.ts', side: 'new', definition: true, startLine: 12, endLine: 12, quote: '</script><b>' + 'x'.repeat(9000) });
  expect(host.children[0]!.children[0]!.children[1]!.textContent).toStartWith('</script><b>');
  expect(host.children[0]!.children[0]!.children[1]!.textContent).toHaveLength(8001);
  expect(host.children[1]!.textContent).toContain('truncated');
  const lines = new Element();
  h.excerpt(lines, { path: 'lines.ts', side: 'old', startLine: 1, endLine: 30, quote: Array(30).fill('line').join('\n') });
  expect(lines.children[0]!.children).toHaveLength(20);
  h.controller.dispose();
});

test('previews are lazy, multi-anchor and bounded; missing evidence offers explicit lookup', () => {
  const h = harness();
  expect(h.mounted).toHaveLength(0);
  h.intersect();
  expect(h.mounted.map(a => a.side)).toEqual(['old', 'new']);
  h.controller.select('m1', 'diagram');
  expect(h.entries[1]!.children[1]!.children[0]!.children[0]!.textContent).toContain('Current workspace · name match');
  h.entries[1]!.children[1]!.children[0]!.children[1]!.listeners.click!();
  expect(h.opened).toEqual([['m1', 0]]);
  h.controller.select('m2', 'diagram');
  h.entries[2]!.children[1]!.children[1]!.listeners.click!();
  expect(h.lookups).toEqual(['m2']);
  h.sources.m2 = [{ path: 'found.ts', side: 'new', startLine: 1, endLine: 1, quote: 'found', definition: true }];
  h.controller.refresh('m2');
  expect(h.mounted.at(-1).path).toBe('found.ts');
  h.controller.dispose();
});

test('idle scroll, initial layout, preview refresh and resize never select; user scroll never reveals', () => {
  const h = harness();
  h.controller.select('m0', 'diagram');
  h.entries.forEach(entry => { entry.top -= 420; });
  h.host.listeners.scroll!(); h.flush();
  expect(h.selected).toEqual([]);
  h.host.listeners.wheel!(); h.host.scrollTop = 420; h.host.listeners.scroll!(); h.flush();
  expect(h.selected).toEqual(['m2']);
  expect(h.host.scrollTop).toBe(420);
  h.controller.select('m2', 'diagram'); // asynchronous iframe observer echo
  expect(h.host.scrollTop).toBe(420);
  h.host.listeners.wheel!(); h.resize(); h.host.listeners.scroll!(); h.flush();
  expect(h.selected).toEqual(['m2']);
  h.controller.refresh('m2'); h.host.listeners.scroll!(); h.flush();
  expect(h.selected).toEqual(['m2']);
  h.controller.dispose();
});

test('code-step keyboard navigation selects and reveals without intercepting source code keys', () => {
  const h = harness();
  const key = { key: 'End', target: h.host, preventDefault() {}, stopPropagation() {} };
  h.host.listeners.keydown!(key);
  expect(h.selected).toEqual(['m39']);
  expect(h.host.scrollTop).toBeGreaterThan(0);
  h.host.listeners.keydown!({ ...key, key: 'Home', target: new Element() });
  expect(h.selected).toEqual(['m39']);
  h.controller.dispose();
});

test('offline excerpts retain before/after labels and disable online-only actions', () => {
  const h = harness(true); h.intersect();
  const body = h.entries[0]!.children[1]!;
  expect(body.children[0]!.children[0]!.textContent).toContain('Before · captured comparison evidence');
  expect(body.children[1]!.children[0]!.textContent).toContain('After · captured comparison evidence');
  expect(body.children[0]!.children).toHaveLength(1);
  h.controller.select('m2', 'diagram');
  expect(h.entries[2]!.children[1]!.children).toHaveLength(1);
  expect(h.entries[2]!.children[1]!.children[0]!.textContent).toContain('live review');
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

test('source navigation keeps current candidates out of historical diffs and canonicalizes old rename paths', async () => {
  const app = await Bun.file(new URL('../public/app.js', import.meta.url)).text();
  const script = app.slice(app.indexOf('async function openSequenceSource('), app.indexOf('function returnToSequenceDiagram('));
  const calls: any[] = [];
  const frame: any = { isConnected: true, dataset: { archifyArtifactId: 'sequence-fixture' }, getClientRects: () => [{}], contentWindow: { postMessage() {} } };
  const state: any = { activeTab: 'archify', session: { comparison: { files: [{ path: 'renamed.ts', oldPath: 'original.ts' }] } } };
  let anchor: any = { path: 'original.ts', side: 'old', startLine: 2, endLine: 2 };
  const open = new Function('state', 'document', 'elements', 'window', 'api', 'renderActiveTab', 'showAnalysisFile', 'showRepositoryFile', 'diffViewRow', 'updateSequenceSourceReturnVisibility', 'toast', script + ';return openSequenceSource;')(
    state, { querySelectorAll: () => [frame] }, { 'diff-panel': { scrollTop: 100 } }, {}, async () => ({ edge: [anchor] }), () => {},
    (...args: any[]) => calls.push(['comparison', ...args]), (...args: any[]) => calls.push(['current', ...args]), () => null, () => {}, () => {},
  );
  const event = { source: frame.contentWindow, data: { type: 'diffcompass-sequence-source', edgeId: 'edge', anchorIndex: 0 } };
  await open(event);
  expect(calls).toEqual([['comparison', 'renamed.ts', 2, 'old']]);
  state.activeTab = 'archify'; anchor = { ...anchor, path: 'renamed.ts', side: 'new', definition: true };
  await open(event);
  expect(calls.at(-1)).toEqual(['current', 'renamed.ts', 2, 'Current workspace · name match']);
});
