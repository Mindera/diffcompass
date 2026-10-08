// Appended to app.js only by the prototype server, never shipped in production.
document.querySelector('.topbar').style.display = 'none';
document.documentElement.dataset.theme = 'dark';
  const referencesReady = import("/prototype/annotations.mjs").then(({ installReferencesPanel }) => {
    const references = installReferencesPanel({
      elements, state, render: renderSymbolPeek, updateToolbar: updateCodeSelectionToolbar,
      showRepositoryFile, renderRepositoryFile, compact: compactSymbolPeek,
    });
    renderSymbolPeek = references.render;
    updateCodeSelectionToolbar = references.updateToolbar;
    openSymbolPeekLocation = references.openLocation;
    renderRepositoryFile = references.renderSource;
    renderSymbolPeek();
  });
window.diffLabCurrent = {
  async show(path, layout = "unified", wrap = true) {
    state.tourMode = false;
    // This lab's file picker owns visibility; the hidden production filter
    // must not remove a selected file when either pane marks it reviewed.
    state.reviewFilter = "";
    state.diffLayout = layout;
    state.diffWrap = wrap ? "wrap" : "scroll";
    state.visibleFile = path;
    await showChangedFile(path, undefined, undefined, 0, 3, false);
    elements['diff-panel'].scrollTop = 0;
  },
  options(layout, wrap) {
    changeDiffView(layout, wrap ? "wrap" : "scroll", false);
  },
  setCollapsed(path, collapsed) {
    if (state.collapsedFiles.has(path) === collapsed) return;
    if (collapsed) state.collapsedFiles.add(path); else state.collapsedFiles.delete(path);
    renderSession();
  },
  async reveal(path, side, line) {
    state.tourMode = false;
    await showChangedFile(path, line, side, 0, undefined, true);
  },
  async refresh() {
    const previous = state.session;
    state.session = await api("/api/session");
    renderSessionUpdate(previous);
  },
  async peek(symbol, path, line, side) { await referencesReady; return resolvePeekSymbol(symbol, { path, line, side }); },
  theme(light) { document.documentElement.dataset.theme = light ? "light" : "dark"; void highlightRenderedCode(); },
};
window.parent.postMessage({ type: "diff-lab-ready" }, window.location.origin);
