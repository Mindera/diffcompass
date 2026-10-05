import { expect, test } from 'bun:test';
const host = await Bun.file(new URL('../public/sequence-walkthrough-host.js', import.meta.url)).text();
const choose = new Function(host.replaceAll('export function', 'function') + ';return sequenceSourceSelection;')();
const anchor = (startLine: number, endLine = startLine, extra: any = {}) => ({ path: 'a.ts', side: 'new', startLine, endLine, quote: 'validated upstream', ...extra });

test('grouped navigation selects only original validated members and starts at the earliest anchor', () => {
  const anchors = [anchor(17), anchor(16), anchor(25)];
  expect(choose(anchors, 1, [0, 1])).toEqual({ anchor: anchors[1], anchors: [anchors[0], anchors[1]] });
  expect(choose(anchors, 0)).toEqual({ anchor: anchors[0], anchors: [anchors[0]] });
  expect(choose(anchors, 0, [0, 1])).toBeNull();
  expect(choose([anchor(1, 3), anchor(2, 4)], 0, [0, 1]).anchors).toHaveLength(2);
  expect(choose([anchor(16, 16, { side: 'old' }), anchor(17, 17, { side: 'old' })], 0, [0, 1]).anchors).toHaveLength(2);
});

test('invalid, stale, mixed-side/file/candidate or noncontiguous grouped requests cannot navigate', () => {
  const anchors = [anchor(16), anchor(17)];
  for (const indices of [null, {}, '0,1', [], [0, 0], [1], [0, -1], [0, 1.5], [0, '1'], [0, 8], [0, 2], Array(9).fill(0)]) expect(choose(anchors, 0, indices)).toBeNull();
  for (const index of [-1, 8, '0', 0.5, null]) expect(choose(anchors, index)).toBeNull();
  expect(choose(undefined, 0)).toBeNull(); expect(choose([], 0)).toBeNull();
  for (const next of [anchor(18), anchor(17, 40), anchor(17, 17, { path: 'b.ts' }), anchor(17, 17, { side: 'old' }), anchor(17, 17, { definition: true }), anchor(17, 17, { definition: true, comparisonMatch: true }), anchor(0), anchor(17, NaN)]) expect(choose([anchors[0], next], 0, [0, 1])).toBeNull();
  expect(choose([anchor(16, 16, { definition: true }), anchors[1]], 0, [0, 1])).toBeNull();
  expect(choose([anchor(16, 16, { definition: true })], 0)).not.toBeNull(); // Existing one-candidate navigation.
});

test('host opens the first captured line and highlights all grouped ranges; failure or revision change does not leave the map', async () => {
  const app = await Bun.file(new URL('../public/app.js', import.meta.url)).text();
  const script = app.slice(app.indexOf('async function openSequenceSource('), app.indexOf('function returnToSequenceDiagram('));
  const frame: any = { isConnected: true, _sequenceEvidenceRevision: 'revision', dataset: { archifyArtifactId: 'sequence-test' }, getClientRects: () => [{}], contentWindow: { postMessage() {} } };
  const state: any = { activeTab: 'archify', session: { comparison: { files: [{ path: 'renamed.ts', oldPath: 'a.ts' }] } } };
  const calls: any[] = [], highlights: any[] = [], errors: string[] = [];
  let anchors: any[] = [anchor(16, 16, { side: 'old' }), anchor(17, 18, { side: 'old' })], changeRevision = false;
  const open = new Function('state', 'document', 'elements', 'window', 'api', 'renderActiveTab', 'showAnalysisFile', 'diffViewRow', 'updateSequenceSourceReturnVisibility', 'toast', 'sequenceSourceSelection', script + ';return openSequenceSource;')(
    state, { querySelectorAll: () => [frame] }, { 'diff-panel': { scrollTop: 100 } }, {}, async () => { if (changeRevision) frame._sequenceEvidenceRevision = 'changed'; return { edge: anchors }; }, () => {},
    (...args: any[]) => calls.push(args), (...args: any[]) => ({ classList: { add: () => highlights.push(args) } }), () => {}, (message: string) => errors.push(message), choose,
  );
  const data: any = { type: 'diffcompass-sequence-source', edgeId: 'edge', anchorIndex: 0, anchorIndices: [0, 1], path: 'forged.ts', startLine: 900, endLine: 999 };
  await open({ source: frame.contentWindow, data });
  expect(calls).toEqual([['renamed.ts', 16, 'old']]);
  expect(highlights).toEqual([['renamed.ts', 'old', 16], ['renamed.ts', 'old', 17], ['renamed.ts', 'old', 18]]);
  state.activeTab = 'archify'; anchors = [anchors[0]];
  await open({ source: frame.contentWindow, data });
  expect(calls).toHaveLength(1); expect(state.activeTab).toBe('archify'); expect(errors).toHaveLength(1);
  anchors = [anchor(16), anchor(17)]; changeRevision = true;
  await open({ source: frame.contentWindow, data });
  expect(calls).toHaveLength(1); expect(state.activeTab).toBe('archify');
});

test('moved Paths panel clamps to the actual diagram and navigation after resize without changing valid placement', async () => {
  const source = await Bun.file(new URL('../public/sequence-walkthrough.js', import.meta.url)).text();
  const window: any = {}; new Function('window', source)(window);
  const writes: any[] = [], properties: any = {};
  const panel: any = { hidden: false, offsetWidth: 400, offsetHeight: 200, offsetLeft: 600, offsetTop: 500, hasAttribute: () => true,
    style: { setProperty: (key: string, value: string) => { writes.push([key, value]); properties[key] = value; } } };
  const diagram = { clientWidth: 430, clientHeight: 600, querySelector: () => ({ offsetTop: 520 }) };
  window.DiffCompassSequenceWalkthrough.boundPathPanel(diagram, panel);
  expect(properties).toEqual({ '--review-panel-x': '18px', '--review-panel-y': '308px' });
  panel.offsetLeft = 12; panel.offsetTop = 12; writes.length = 0;
  window.DiffCompassSequenceWalkthrough.boundPathPanel(diagram, panel); expect(writes).toEqual([]);
  for (const change of [{ hidden: true }, { hidden: false, offsetWidth: 0 }, { offsetWidth: 400, hasAttribute: () => false }]) {
    Object.assign(panel, change, { offsetLeft: 600, offsetTop: 500 });
    window.DiffCompassSequenceWalkthrough.boundPathPanel(diagram, panel); expect(writes).toEqual([]);
  }
});
