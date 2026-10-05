import { expect, test } from 'bun:test';
const source = await Bun.file(new URL('../public/app.js', import.meta.url)).text();
function declaration(name: string) {
  const start = source.indexOf(`function ${name}(`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
test('early Maps requests do not read an unloaded session; loaded requests use the existing available-view routing', () => {
  const state: any = { session: null, mapsLastView: 'archify' }, calls: any[] = [];
  const render = () => {};
  const open = new Function('state', 'understandMapViews', 'activateReviewTab', 'renderArchify', 'renderCallFlows', 'renderSequenceDiagrams', 'renderAdaptiveDiagrams', 'renderStructuralBlastRadii', declaration('openMaps') + ';return openMaps;')(
    state, () => { if (!state.session) throw Error('Session not loaded'); return [{ id: 'archify' }]; }, (...args: any[]) => calls.push(args), render, render, render, render, render,
  );
  expect(() => { open(); open('sequence'); }).not.toThrow(); expect(calls).toEqual([]);
  state.session = { outline: {} }; open(); open('missing'); open('structural-blast-radius');
  expect(calls).toEqual([['archify', render], ['archify', render], ['structural-blast-radius', render]]);
});
test('keyboard tab activation waits for session readiness, then preserves existing render and scroll behavior', () => {
  const state: any = { session: null, activeTab: 'diff', tabScrollPositions: new Map([['archify', 150]]) };
  const panel = { scrollTop: 90 }, rendered: string[] = [];
  const activate = new Function('state', 'elements', 'renderActiveTab', 'window', declaration('activateReviewTab') + ';return activateReviewTab;')(
    state, { 'diff-panel': panel }, () => rendered.push('tab'), { requestAnimationFrame: (callback: Function) => callback() },
  );
  activate('archify', () => rendered.push('map'));
  expect(state.activeTab).toBe('diff'); expect(panel.scrollTop).toBe(90); expect(rendered).toEqual([]);
  state.session = { outline: {} }; activate('archify', () => rendered.push('map'));
  expect(state.activeTab).toBe('archify'); expect(panel.scrollTop).toBe(150); expect(state.tabScrollPositions.get('diff')).toBe(90);
  expect(rendered).toEqual(['map', 'tab']); activate('archify'); expect(rendered).toEqual(['map', 'tab']);
});
