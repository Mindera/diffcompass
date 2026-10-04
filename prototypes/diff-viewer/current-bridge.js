// Appended to app.js only by the prototype server, never shipped in production.
let labPath = "checkout.ts";
const filterLabFile = () => { for (const file of elements.diff.querySelectorAll('.diff-file')) file.style.display = file.dataset.path === labPath ? "" : "none"; };
new MutationObserver(filterLabFile).observe(elements.diff, { childList: true });
document.querySelector('.topbar').style.display = 'none';
document.documentElement.dataset.theme = 'dark';
window.diffLabCurrent = {
  async show(path, layout = "unified", wrap = true) {
    state.tourMode = false;
    state.diffLayout = layout;
    state.diffWrap = wrap ? "wrap" : "scroll";
    labPath = path;
    state.visibleFile = path;
    await showChangedFile(path, undefined, undefined, 0, 3, false);
    filterLabFile();
    elements['diff-panel'].scrollTop = 0;
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
  peek(symbol, path, line, side) { return resolvePeekSymbol(symbol, { path, line, side }); },
  theme(light) { document.documentElement.dataset.theme = light ? "light" : "dark"; void highlightRenderedCode(); },
};
window.parent.postMessage({ type: "diff-lab-ready" }, window.location.origin);
