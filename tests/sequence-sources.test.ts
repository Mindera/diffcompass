import { expect, test } from "bun:test";
import { validateReviewFlow } from "../src/flows.ts";
import { sequenceCandidate } from "../src/archify.ts";
import { groundedSequenceSources, sequenceArtifactSources, validateSequenceSources, lookupSequenceDefinition } from "../src/sequence-sources.ts";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sequenceSourceScript } from "../src/sequence-source-embed.ts";
import { TourAgent } from "../src/agent.ts";
import { DEFAULT_REVIEW_POLICY } from "../src/config.ts";
import type { ArchifyArtifact, GitComparison, ReviewFlow } from "../src/types.ts";

const anchor = { path: "app.ts", side: "new" as const, startLine: 2, endLine: 2, quote: "service.run();" };
const flow: ReviewFlow = {
  id: "run", title: "Run", summary: "Call the service.", provenance: "partial", blastRadiusSize: 1, affectedFiles: ["app.ts"],
  mermaid: "sequenceDiagram\n participant A as Caller\n participant B as Service\n A->>B: run\n B->>B: work\n B-->>A: done",
  messageSources: [{ message: 1, label: "run", anchors: [anchor] }, { message: 3, label: "done", anchors: [{ ...anchor, side: "old", quote: "return result;" }] }],
};
const comparison = { files: [{ path: "app.ts", oldPath: "app.ts", hunks: [{ rows: [
  { kind: "deletion", oldLine: 2, newLine: null, content: "return result;" },
  { kind: "addition", oldLine: null, newLine: 2, content: "service.run();" },
] }] }] } as GitComparison;

test("sequence evidence preserves message order including self calls and returns, and checks both sides", () => {
  expect(validateReviewFlow(flow).messageSources).toEqual(flow.messageSources);
  expect(groundedSequenceSources(flow, comparison)).toEqual(flow.messageSources!);
  const diagnostics: string[] = [];
  const wrong = { ...flow, messageSources: [{ message: 1, label: "run", anchors: [anchor, { ...anchor, quote: "invented" }, { ...anchor, startLine: 900, endLine: 900 }] }] };
  expect(groundedSequenceSources(wrong, comparison, diagnostics)).toEqual([{ message: 1, label: "run", anchors: [anchor] }]);
  expect(diagnostics).toHaveLength(2);
});

test("sequence evidence rejects unsafe paths, bounds, duplicate ordinals and mismatched captions", () => {
  for (const patch of [{ path: "../app.ts" }, { path: "/app.ts" }, { path: "C:\\app.ts" }, { path: "app\u0000.ts" }, { startLine: 0 }, { endLine: 30 }, { quote: "" }]) {
    expect(() => validateSequenceSources([{ message: 1, label: "run", anchors: [{ ...anchor, ...patch }] }], flow.mermaid)).toThrow();
  }
  for (const value of [[{ message: 8, anchors: [anchor] }], [{ message: 1, label: "wrong", anchors: [anchor] }], [flow.messageSources![0], flow.messageSources![0]]]) {
    expect(() => validateSequenceSources(value, flow.mermaid)).toThrow();
  }
  expect(validateSequenceSources(undefined, flow.mermaid)).toBeUndefined();
});

test("only the matching current rendered sequence receives source links", () => {
  const candidate = sequenceCandidate(flow)!;
  const artifact = { ...candidate, html: "html", view: "single", validationReceipt: "valid", renderedAt: "now" } as ArchifyArtifact;
  const links = sequenceArtifactSources(artifact, [flow], comparison);
  expect(Object.values(links)).toEqual(flow.messageSources!.map((entry) => entry.anchors));
  expect(sequenceArtifactSources(artifact, [{ ...flow, outdated: true }], comparison)).toEqual({});
  expect(sequenceArtifactSources(artifact, [{ ...flow, mermaid: flow.mermaid.replace("A->>B: run", "B->>A: run") }], comparison)).toEqual({});
  expect(sequenceArtifactSources(artifact, [{ ...flow, mermaid: flow.mermaid.replace("Caller", "Other caller") }], comparison)).toEqual({});
});

test("outline generation repairs bad arrow evidence without losing the diagram", async () => {
  const prompts: string[] = [];
  const generated = (flowValue: ReviewFlow) => ({
    title: "Review", summary: "Review calls", callFlows: [], flows: [flowValue], findings: [],
    structuralBlastRadii: [], structuralAnalysisOmissionReason: "No declarations identified in this fixture.",
    phases: [{ id: "phase", title: "Run", summary: "Run service", fileChanges: [{ path: "app.ts", summary: "Runs the service" }],
      steps: [{ id: "step", title: "Run", objective: "Run service", anchor: { path: "app.ts", side: "new", startLine: 2, endLine: 2 } }] }],
  });
  const agent = new TourAgent("/tmp/repository", { adapterId: "attached", modelId: "current-session", includeArchitecture: false, includeFindings: false, includeFlows: true }, {
    async send(prompt) {
      prompts.push(prompt);
      return JSON.stringify(generated(prompts.length === 1 ? { ...flow, messageSources: [{ message: 1, label: "run", anchors: [{ ...anchor, quote: "wrong" }] }] } : flow));
    },
  });
  const result = await agent.createOutline({ ...comparison, repositoryRoot: "/tmp/repository", repositoryName: "test", patch: "", base: "main", mergeBase: "base", head: "head", repositoryFiles: ["app.ts"] }, DEFAULT_REVIEW_POLICY);
  expect(prompts).toHaveLength(2);
  expect(prompts[0]).toContain("For sequence diagrams include messageSources");
  expect(prompts[1]).toContain("source quote does not match app.ts:2");
  expect(result.value.flows[0]?.messageSources).toEqual(flow.messageSources);
});

test("arrow navigation resolves only trusted identities and returns to the same iframe", async () => {
  const host = await Bun.file(new URL('../public/sequence-walkthrough-host.js', import.meta.url)).text();
  const sourceSelection = new Function(host.replaceAll('export function', 'function') + ';return sequenceSourceSelection;')();
  const app = await Bun.file(new URL("../public/app.js", import.meta.url)).text();
  const script = app.slice(app.indexOf("async function openSequenceSource("), app.indexOf("function renderArchify()"));
  const messages: unknown[] = [], calls: unknown[] = [];
  const frame = { isConnected: true, dataset: { archifyArtifactId: "sequence-run" }, getClientRects: () => [{}], contentWindow: { postMessage: (v: unknown) => messages.push(v) }, focus() {} };
  const state: any = { activeTab: "sequence", mapArtifactSelections: new Map(), structuralGraphReturn: {}, sequenceSourceReturn: null, session: { comparison: { files: [] } } };
  const button = { style: {}, classList: { toggle() {} }, addEventListener() {} };
  const elements = { "diff-panel": { scrollTop: 125, getBoundingClientRect: () => ({ right: 900, bottom: 700 }) }, diff: { querySelectorAll: () => [] } };
  const presentation = { suspend: (v: unknown) => calls.push(["suspend", v]), resume: (v: unknown) => calls.push(["resume", v]) };
  let requests = 0, sourceAvailable = true;
  const api = async () => { requests++; return sourceAvailable ? { edge: [anchor] } : {}; };
  const { open, back } = new Function("state", "elements", "window", "document", "api", "renderActiveTab", "showAnalysisFile", "diffViewRow", "toast", "openMaps", "sequenceSourceSelection", `${script}; return {open:openSequenceSource,back:returnToSequenceDiagram};`)(
    state, elements, { innerWidth: 1000, innerHeight: 800, addEventListener() {}, diffcompassMapPresentation: presentation },
    { querySelectorAll: () => [frame], getElementById: () => button }, api, () => {}, (...args: unknown[]) => calls.push(args), () => ({ classList: { add() {} } }), () => {}, () => { state.activeTab = "sequence"; }, sourceSelection,
  );
  const data = { type: "diffcompass-sequence-source", edgeId: "edge", anchorIndex: 0, present: true, path: "evil.ts", startLine: 900 };
  await open({ data, source: {} });
  expect(requests).toBe(0);
  await open({ data, source: frame.contentWindow });
  expect(calls).toContainEqual(["app.ts", 2, "new"]);
  expect(state.activeTab).toBe("diff");
  expect(state.structuralGraphReturn).toBeNull();
  expect(state.sequenceSourceReturn.frame).toBe(frame);
  elements["diff-panel"].scrollTop = 400;
  back();
  expect(state.activeTab).toBe("sequence");
  expect(state.mapArtifactSelections.get("sequence")).toBe("sequence-run");
  expect(elements["diff-panel"].scrollTop).toBe(125);
  expect(calls).toContainEqual(["resume", frame]);
  expect(messages.at(-1)).toEqual({ type: "diffcompass-sequence-return" });
  sourceAvailable = false;
  await open({ data, source: frame.contentWindow });
  expect(state.activeTab).toBe("sequence");
});

test("semantics card offers code and definition lookup without intercepting arrow clicks", () => {
  const events: Record<string, Function> = {}, observers: Function[] = [], messages: any[] = [];
  class Element {
    children: Element[] = []; style = {}; hidden = false; textContent = ""; attrs = new Map<string, string>(); listeners: Record<string, Function> = {};
    appendChild(node: Element) { this.children.push(node); }
    replaceChildren() { this.children = []; }
    setAttribute(k: string, v: string) { this.attrs.set(k, v); }
    getAttribute(k: string) { return this.attrs.get(k); }
    removeAttribute(k: string) { this.attrs.delete(k); }
    addEventListener(k: string, fn: Function) { this.listeners[k] = fn; }
    querySelector(selector: string): Element | null { return selector === "path" ? null : this.children[1] ?? this.children[0] ?? null; }
    focus() {}
    closest() { return this; }
  }
  const edge = new Element(); edge.setAttribute("data-edge-id", "one");
  const svg = {};
  const card = new Element();
  let selected = "one";
  const camera = { scale: .6, x: 123, y: 45 }; let restored: unknown, suspended = false;
  const parent = { postMessage: (message: unknown) => messages.push(message) };
  const window = { addEventListener: (name: string, fn: Function) => { events[name] = fn; }, Archify: { focus: { relationship: () => ({ id: selected }) }, view: { state: () => camera, suspend: () => { suspended = true; }, restore: (v: unknown) => { restored = v; } }, presentation: { active: () => true } } };
  const script = sequenceSourceScript({ one: [anchor], multi: [anchor, { ...anchor, startLine: 3, endLine: 3 } ] }).match(/<script[^>]*>([\s\S]*?)<\/script>/)![1]!;
  new Function("window", "document", "parent", "MutationObserver", script)(window, { readyState: "complete", querySelector: () => svg, getElementById: () => card, createElement: () => new Element() }, parent, class { constructor(fn: Function) { observers.push(fn); } observe() {} });
  const panel = card.children[0]!;
  expect(messages).toHaveLength(0);
  expect(panel.children[1]!.textContent).toContain("View code");
  panel.children[1]!.listeners.click!();
  expect(suspended).toBe(true);
  expect(messages[0]).toEqual({ type: "diffcompass-sequence-source", edgeId: "one", anchorIndex: 0, present: true });
  events.message!({ source: {}, data: { type: "diffcompass-sequence-return" } });
  expect(restored).toBeUndefined();
  events.message!({ source: parent, data: { type: "diffcompass-sequence-return" } });
  expect(restored).toBe(camera);
  selected = "multi"; observers[0]!();
  expect(panel.hidden).toBe(false);
  expect(panel.children[0]!.textContent).toBe("Source code");
  panel.children[2]!.listeners.click!();
  expect(messages.at(-1).anchorIndex).toBe(1);
  selected = "unknown"; observers[0]!();
  expect(panel.children[2]!.textContent).toBe("Find definition");
  expect(messages).toHaveLength(2);
  panel.children[2]!.listeners.click!();
  expect(messages.at(-1)).toEqual({ type: "diffcompass-sequence-lookup", edgeId: "unknown", requestId: 1 });
  events.message!({ source: {}, data: { type: "diffcompass-sequence-lookup-result", edgeId: "unknown", requestId: 1, anchors: [anchor] } });
  expect(panel.children[2]!.textContent).toBe("Looking up definition…");
  events.message!({ source: parent, data: { type: "diffcompass-sequence-lookup-result", edgeId: "unknown", requestId: 1, anchors: [{ ...anchor, definition: true }] } });
  expect(panel.children[0]!.textContent).toBe("Matching definitions");
  expect(panel.children[2]!.textContent).toContain("Current workspace · View code");
  card.hidden = true; observers[1]!(); expect(panel.hidden).toBe(true);
  expect(sequenceSourceScript({ one: [{ ...anchor, quote: "</script><script>bad()" }] })).not.toContain("</script><script>bad()");
});

test('semantics source actions defer only to a mounted pane containing the exact message, live and offline', () => {
  for (const offline of [false, true]) {
    class Element {
      children: Element[] = []; hidden = false; textContent = ''; attrs = new Map(); listeners: Record<string, Function> = {};
      appendChild(node: Element) { this.children.push(node); }
      replaceChildren() { this.children = []; }
      setAttribute(key: string, value: string) { this.attrs.set(key, value); }
      addEventListener(key: string, fn: Function) { this.listeners[key] = fn; }
    }
    const events: Record<string, Function> = {}, observers: Function[] = [], shown: string[] = [], messages: any[] = [];
    const card = new Element(), parent = { postMessage: (data: any) => messages.push(data) };
    let selected = 'call', collapsed = false;
    const window: any = { addEventListener: (name: string, fn: Function) => { events[name] = fn; }, Archify: { focus: { relationship: () => ({ id: selected }) } } };
    const script = sequenceSourceScript({ call: [{ ...anchor, definition: true }], unsupported: [anchor] }, offline).match(/<script[^>]*>([\s\S]*?)<\/script>/)![1]!;
    new Function('window', 'document', 'parent', 'MutationObserver', script)(window,
      { readyState: 'complete', querySelector: () => ({}), getElementById: () => card, createElement: () => new Element() }, parent,
      class { constructor(fn: Function) { observers.push(fn); } observe() {} });
    const section = card.children[0]!, actions = window.diffcompassSequenceSourceActions;
    expect(section.children[0]!.textContent).toBe('Matching definitions'); // No pane: existing fallback.
    const capability = { has: (id: string) => ['call', 'self', 'return', 'missing'].includes(id), collapsed: () => collapsed,
      show(id: string) { shown.push(id); collapsed = false; registration.refresh(); } };
    const registration = actions.registerCodePane(capability);
    expect(section.hidden).toBe(true); expect(section.children).toHaveLength(0);
    for (const id of ['call', 'self', 'return', 'missing']) {
      selected = id; observers[0]!();
      expect(section.hidden).toBe(true);
      collapsed = true; registration.refresh();
      expect(section.hidden).toBe(false); expect(section.children).toHaveLength(1);
      const button = section.children[0]!;
      expect(button.textContent).toBe('Show code step'); expect(button.attrs.get('aria-controls')).toBe('sequence-code-steps');
      button.listeners.click!();
      expect(shown.at(-1)).toBe(id); expect(section.hidden).toBe(true); expect(section.children).toHaveLength(0);
    }
    expect(messages).toEqual([]); // Pane navigation works offline without requesting source.
    selected = 'unsupported'; observers[0]!();
    expect(section.hidden).toBe(false); expect(section.children[0]!.textContent).toBe('Source code');
    expect(section.children[1]!.textContent).toContain('View code');
    selected = 'call'; observers[0]!();
    events.message!({ source: parent, data: { type: 'diffcompass-sequence-evidence', sources: {}, notice: 'Source changed; evidence must be refreshed.' } });
    expect(section.hidden).toBe(true); expect(section.children).toHaveLength(0);
    collapsed = true; registration.refresh();
    expect(section.children[0]!.textContent).toBe('Show code step');
    card.hidden = true; observers[1]!(); registration.refresh(); expect(section.hidden).toBe(true);
    card.hidden = false; observers[1]!();
    const oldButton = section.children[0]!;
    const replacement = actions.registerCodePane({ ...capability, collapsed: () => false });
    registration.dispose(); registration.refresh(); oldButton.listeners.click!();
    expect(section.hidden).toBe(true); expect(shown).toHaveLength(4); // Stale owner cannot reset/call the newer pane.
    replacement.dispose();
    expect(section.hidden).toBe(false);
    expect(section.children[0]!.textContent).toBe(offline ? 'Matching definitions' : 'Source code');
    if (!offline) expect(section.children[1]!.textContent).toContain('Source changed');
  }
});

test("source bridge pauses existing Paths before navigation and never recreates or resumes it on return", () => {
  for (const offline of [false, true]) for (const mode of [null, 'source', 'result']) {
    const events: Record<string, Function> = {}, messages: any[] = [], order: string[] = [];
    const state = { source: 'a', target: 'a', nodes: ['a', 'b', 'a'], journey: 2, playing: true };
    const camera = { scale: 1.3, x: 12, y: -30 };
    class Node {
      hidden = true; appendChild() {} replaceChildren() {} querySelector() { return null; }
    }
    const parent = { postMessage: (message: any) => { order.push('navigate'); messages.push(message); } };
    const route = { active: () => mode, result: () => state,
      pauseJourney: (options: any) => { expect(options.preserveElapsed).toBe(true); order.push('pause'); state.playing = false; },
      playJourney: () => { throw Error('Return must not autoplay'); }, clear: () => { throw Error('Keep existing path'); } };
    const window: any = { addEventListener: (name: string, fn: Function) => { events[name] = fn; }, Archify: {
      routeProbe: route, view: { state: () => camera, suspend: () => order.push('suspend'), restore: (saved: unknown) => { expect(saved).toBe(camera); order.push('restore'); } },
      presentation: { active: () => true },
    } };
    const script = sequenceSourceScript({}, offline).match(/<script[^>]*>([\s\S]*?)<\/script>/)![1]!;
    new Function('window', 'document', 'parent', 'MutationObserver', script)(window,
      { readyState: 'complete', querySelector: () => new Node(), getElementById: () => new Node(), createElement: () => new Node() }, parent, class { observe() {} });
    const actions = window.diffcompassSequenceSourceActions;
    expect(actions.pathActive()).toBe(Boolean(mode)); actions.open('other-step', 1);
    expect(order).toEqual(offline ? [] : mode ? ['pause', 'suspend', 'navigate'] : ['suspend', 'navigate']);
    expect(state.journey).toBe(2); expect(state.nodes).toEqual(['a', 'b', 'a']);
    if (!offline) {
      expect(messages[0]).toEqual({ type: 'diffcompass-sequence-source', edgeId: 'other-step', anchorIndex: 1, present: true });
      actions.open('grouped-step', 2, [1, 2]);
      expect(messages.at(-1)).toEqual({ type: 'diffcompass-sequence-source', edgeId: 'grouped-step', anchorIndex: 2, anchorIndices: [1, 2], present: true });
      events.message!({ source: parent, data: { type: 'diffcompass-sequence-return' } });
      expect(state.playing).toBe(!mode); expect(order.at(-1)).toBe('restore');
      // Optional renderer capabilities stay optional; normal source still opens.
      delete window.Archify.routeProbe; expect(actions.pathActive()).toBe(false);
      expect(() => actions.open('one', 0)).not.toThrow();
      window.Archify.routeProbe = { active: () => 'result' };
      expect(() => actions.open('one', 0)).not.toThrow();
    }
  }
});

test("unlinked calls find actual definitions outside the diff, retaining ambiguous candidates", async () => {
  const root = await mkdtemp(join(tmpdir(), "sequence-lookup-"));
  try {
    await writeFile(join(root, "receipt.ts"), "export function receipt(items, discount) { return items; }\n");
    await writeFile(join(root, "other.ts"), "export function receipt(items) { return items; }\n");
    const call = { ...flow, mermaid: flow.mermaid.replace("A->>B: run", "A->>B: receipt(items, discount)"), messageSources: undefined };
    const artifact = { ...sequenceCandidate(call)!, html: "", view: "single", validationReceipt: "valid", renderedAt: "now" } as ArchifyArtifact;
    const repo = { ...comparison, repositoryRoot: root, repositoryFiles: ["receipt.ts", "other.ts"], files: [] };
    const id = (artifact.ir.messages as { id: string }[])[0]!.id;
    const found = await lookupSequenceDefinition(artifact, [call], repo, id);
    expect(found.map((a) => a.path).sort()).toEqual(["other.ts", "receipt.ts"]);
    expect(found.every((a) => a.definition && a.startLine === 1 && a.quote.startsWith("export function receipt"))).toBe(true);
    expect(found.every((a) => !a.comparisonMatch)).toBe(true);
    const quote = found.find((a) => a.path === "receipt.ts")!.quote;
    const captured = (path = 'receipt.ts', newLine: number | null = 1, content = quote) => ({ ...repo, files: [
      { path, oldPath: 'receipt.ts', hunks: [{ rows: [{ oldLine: 1, newLine, content }] }] },
    ] }) as GitComparison;
    const matched = await lookupSequenceDefinition(artifact, [call], captured(), id);
    expect(matched.find((a) => a.path === 'receipt.ts')?.comparisonMatch).toBe(true);
    expect(matched.every((a) => a.definition)).toBe(true); // Still a candidate, not recorded call evidence.
    expect(matched.find((a) => a.path === 'other.ts')?.comparisonMatch).toBeUndefined();
    for (const changed of [captured('receipt.ts', 1, quote + ' // changed'), captured('receipt.ts', 2), captured('receipt.ts', null), captured('renamed.ts')]) {
      const stale = await lookupSequenceDefinition(artifact, [call], changed, id);
      expect(stale.every((a) => !a.comparisonMatch)).toBe(true);
    }
    expect(await lookupSequenceDefinition(artifact, [{ ...call, outdated: true }], repo, id)).toEqual([]);
    expect(await lookupSequenceDefinition(artifact, [call], repo, "forged")).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('runtime candidate and comparison-match flags cannot become persisted authored evidence', () => {
  const entry = { message: 1, label: 'run', anchors: [{ ...anchor, definition: true, comparisonMatch: true }] };
  expect(validateSequenceSources([entry], flow.mermaid)).toEqual([{ message: 1, label: 'run', anchors: [anchor] }]);
});
