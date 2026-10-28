// Expand the existing iframe without reparenting/reloading its document.
(function () {
  let expanded = null;
  let restoreStyle = null;
  let inert = [];
  let companion = null;
  const preferencesKey = 'diffcompass-map-preferences';
  let preferences = { motion: true };
  function validated(value) {
    const result = {};
    if (!value || typeof value !== 'object') return result;
    if (['dark', 'light'].includes(value.theme)) result.theme = value.theme;
    if (['classic', 'blueprint', 'signal-flow', 'editorial'].includes(value.preset)) result.preset = value.preset;
    if (typeof value.motion === 'boolean') result.motion = value.motion;
    for (const [key, minimum] of [['sequenceCodeWidth', 280], ['sequenceCodeHeight', 46]]) {
      if (Number.isInteger(value[key]) && (value[key] === 0 || value[key] >= minimum && value[key] <= 900)) result[key] = value[key];
    }
    return result;
  }
  try { Object.assign(preferences, validated(JSON.parse(window.localStorage.getItem(preferencesKey)))); } catch (_) {}
  function restoreInert() {
    inert.forEach(([node, previous]) => { node.inert = previous; });
    inert = [];
  }
  function isolate() {
    restoreInert();
    // Keep both branches interactive without moving either iframe. Reparenting
    // would reload the diagram or the evidence pane's mounted Monaco editors.
    const branches = new Set();
    for (const target of [expanded, companion?.node]) {
      for (let branch = target; branch; branch = branch.parentElement) branches.add(branch);
    }
    const hidden = new Set();
    for (const branch of branches) {
      for (const sibling of branch.parentElement?.children ?? []) {
        if (branches.has(sibling) || hidden.has(sibling) || !(sibling instanceof HTMLElement)) continue;
        hidden.add(sibling);
        inert.push([sibling, sibling.inert]); sibling.inert = true;
      }
    }
  }
  function closePane() {
    if (!companion) return;
    const { node, popover } = companion;
    companion = null;
    if (typeof node.hidePopover === 'function' && node.matches(':popover-open')) node.hidePopover();
    if (popover === null) node.removeAttribute('popover');
    else node.setAttribute('popover', popover);
    node.removeAttribute('data-map-present-pane');
    node.dispatchEvent(new Event('diffcompass-map-pane-change'));
  }
  function setPaneCollapsed(node, collapsed) {
    if (companion?.node !== node) return;
    companion.collapsed = collapsed;
    const value = collapsed ? 'collapsed' : 'expanded';
    node.setAttribute('data-map-present-pane', value);
    expanded.setAttribute('data-map-present-split', value);
    node.dispatchEvent(new Event('diffcompass-map-pane-change'));
  }
  function showPane(frame, node) {
    if (expanded !== frame || !node?.isConnected) return false;
    if (companion?.node !== node) {
      closePane();
      companion = { node, popover: node.getAttribute('popover'), collapsed: false };
      setPaneCollapsed(node, false);
      if (typeof node.showPopover === 'function') {
        node.setAttribute('popover', 'manual');
        node.showPopover();
      }
      isolate();
    }
    return true;
  }
  function close() {
    const frame = expanded;
    if (!frame) return;
    expanded = null;
    closePane();
    frame.removeAttribute('data-map-present-split');
    if (typeof frame.hidePopover === 'function' && frame.matches(':popover-open')) frame.hidePopover();
    frame.removeAttribute('popover');
    if (restoreStyle === null) frame.removeAttribute('style');
    else frame.setAttribute('style', restoreStyle);
    restoreInert();
    frame.contentWindow?.postMessage({ type: 'diffcompass-map-present-state', active: false }, '*');
    frame.focus({ preventScroll: true });
  }
  window.addEventListener('message', (event) => {
    if (['diffcompass-map-preferences-ready', 'diffcompass-map-preferences-change'].includes(event.data?.type)) {
      const frames = [...document.querySelectorAll('iframe.archify-frame,iframe[data-archify-export-frame],iframe[data-briefing-diagram]')];
      const source = frames.find(frame => frame.contentWindow === event.source);
      if (!source) return;
      if (event.data.type === 'diffcompass-map-preferences-change') {
        Object.assign(preferences, validated(event.data.preferences));
        try { window.localStorage.setItem(preferencesKey, JSON.stringify(preferences)); } catch (_) {}
      }
      const recipients = event.data.type === 'diffcompass-map-preferences-ready' ? [source] : frames;
      recipients.forEach(frame => frame.contentWindow?.postMessage({ type: 'diffcompass-map-preferences', preferences }, '*'));
      return;
    }
    if (event.data?.type !== 'diffcompass-map-present' || typeof event.data.active !== 'boolean') return;
    const frame = [...document.querySelectorAll('iframe.archify-frame,iframe[data-archify-export-frame],iframe[data-briefing-diagram]')]
      .find(node => node.contentWindow === event.source);
    if (!frame || !frame.getClientRects().length) return;
    if (!event.data.active) { if (expanded === frame) close(); return; }
    open(frame);
  });
  function open(frame) {
    if (!frame?.isConnected || expanded === frame) return;
    close();
    expanded = frame;
    restoreStyle = frame.getAttribute('style');
    frame.style.cssText = 'position:fixed!important;inset:0!important;margin:0!important;padding:0!important;width:var(--map-present-width,100vw)!important;height:var(--map-present-height,100dvh)!important;max-width:none!important;max-height:none!important;border:0!important;border-radius:0!important;z-index:2147483647!important;background:#101418';
    if (typeof frame.showPopover === 'function') {
      frame.setAttribute('popover', 'manual');
      frame.showPopover();
    }
    isolate();
    frame.contentWindow.postMessage({ type: 'diffcompass-map-present-state', active: true }, '*');
    frame.focus({ preventScroll: true });
  }
  window.diffcompassMapPresentation = {
    suspend(frame) { if (expanded === frame) close(); }, resume: open,
    showPane, setPaneCollapsed,
    paneCollapsed(node) { return companion?.node === node ? companion.collapsed : undefined; },
    closePane(node) { if (companion?.node === node) close(); },
  };
  document.addEventListener('keydown', (event) => {
    if (expanded && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); }
  }, true);
  new MutationObserver(() => { if (expanded && (!expanded.isConnected || companion && !companion.node.isConnected)) close(); }).observe(document.documentElement, { childList: true, subtree: true });
})();
