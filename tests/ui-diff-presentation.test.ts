import { expect, test } from "bun:test";

const app = await Bun.file(new URL("../public/app.js", import.meta.url)).text();
const styles = await Bun.file(new URL("../public/styles.css", import.meta.url)).text();
const html = await Bun.file(new URL("../public/index.html", import.meta.url)).text();

test("added files render only the new side while modified files keep split layout", () => {
  const source = app.slice(app.indexOf("function renderDiff(files,"), app.indexOf("function syncDiffViewControls()"));
  const state = { collapsedFiles: new Set(), diffLayout: "split", session: {}, splitOldWidth: 50, proposalPreview: false, proposalActivityId: null as string | null, renderedDiffFiles: [] as unknown[] };
  const diff = { innerHTML: "", querySelectorAll: () => [] };
  const elements = { diff, "empty-diff": { classList: { toggle() {} } } };
  const render = new Function("state", "elements", "CSS", "syncDiffViewControls", "escapeHtml", "renderDiffFileHeader", "isPngDiff", "whitespaceChangedRows", "inlineChangesForRows", "fileContext", "splitRows", "renderSplitSide", "renderUnifiedRow", "highlightRenderedCode", "hydrateDiffImages", "renderConversationBadges", "SPLIT_PANE_MIN", "SPLIT_PANE_MAX", `${source}; return renderDiff;`)(
    state, elements, { escape: (s: string) => s }, () => {}, (s: string) => s, () => "", () => false,
    () => new Set(), () => new Map(), () => 3, () => [[null, {}]],
    (_file: unknown, _row: unknown, side: string) => `<div data-side="${side}"></div>`,
    () => '<div data-side="new">new code</div>', () => {}, () => {}, () => {}, 20, 80,
  );
  const file = { path: "new.ts", status: "added", hunks: [{ header: "@@ -0,0 +1 @@", rows: [{}] }] };
  render([file]);
  expect(diff.innerHTML).toContain('hunk unified-layout');
  expect(diff.innerHTML).toContain('data-side="new"');
  expect(diff.innerHTML).not.toContain('data-side="old"');
  expect(diff.innerHTML).not.toContain('split-resizer');
  render([{ ...file, status: "modified" }]);
  expect(diff.innerHTML).toContain('hunk split-layout');
  expect(diff.innerHTML).toContain('data-side="old"');
  expect(state.diffLayout).toBe("split");
  render([file], { proposalActivityId: "proposal-1" });
  expect(state.proposalPreview).toBe(true);
  expect(state.proposalActivityId).toBe("proposal-1");
  expect(state.renderedDiffFiles).toEqual([file]);
  render([{ ...file, path: "ordinary.ts" }]);
  expect(state.proposalPreview).toBe(false);
  expect(state.proposalActivityId).toBeNull();
  expect(app).toContain('const segments = hunk.classList.contains("split-layout")');
});

test("pending suggestion mode is explicit and rerenders retain only its exact diff", () => {
  expect(app).toContain("function renderDiff(files, { proposalActivityId = null } = {})");
  expect(app).toContain("state.proposalPreview = Boolean(proposalActivityId)");
  expect(app).toContain("renderDiff([result.file], { proposalActivityId: activityId })");
  expect(app).toContain("const files = state.proposalPreview ? state.renderedDiffFiles : visibleDiffFiles()");
  expect(app).toContain("renderDiff(files, currentDiffRenderOptions())");
  expect(app).toContain("generation !== state.reviewDiffLoadGeneration || state.proposalPreview");
});

test("line markers opt in without removing line actions or comment indicators", () => {
  expect(app).toContain('showDiffMarkers: false');
  expect(app).toContain('state.showDiffMarkers = window.localStorage.getItem(preferenceKey("show-diff-markers")) === "true"');
  expect(html).toContain('<input id="show-diff-markers" type="checkbox" />');
  expect(styles).toContain('#diff:not(.show-diff-markers) .row-prefix { visibility: hidden; }');
  const source = app.slice(app.indexOf('document.getElementById("show-diff-markers").addEventListener'), app.indexOf('elements["diff-layout"].addEventListener'));
  let change!: (event: { target: { checked: boolean } }) => void;
  let syncs = 0;
  const state = { showDiffMarkers: false };
  const storage = new Map();
  new Function("document", "state", "window", "preferenceKey", "syncDiffViewControls", source)(
    { getElementById: () => ({ addEventListener: (_: string, fn: typeof change) => { change = fn; } }) },
    state, { localStorage: { setItem: (key: string, value: string) => storage.set(key, value) } },
    (key: string) => key, () => { syncs++; },
  );
  change({ target: { checked: true } });
  expect(state.showDiffMarkers).toBe(true);
  expect(storage.get("show-diff-markers")).toBe("true");
  change({ target: { checked: false } });
  expect(state.showDiffMarkers).toBe(false);
  expect(storage.get("show-diff-markers")).toBe("false");
  expect(syncs).toBe(2);
});

test("tablet tabs have a separate row and the title cannot wrap into them", () => {
  expect(styles).toContain('.brand strong { flex-shrink: 0; white-space: nowrap; }');
  expect(styles).toContain('@media (min-width: 901px) and (max-width: 1500px)');
  expect(styles).toContain('.topbar > .tabs { grid-column: 1 / -1; grid-row: 2;');
  expect(styles).toContain('.workspace { height: calc(100vh - 98px); }');
});
