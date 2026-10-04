// Expand the existing iframe without reparenting/reloading its document.
(function () {
  let expanded = null;
  let restoreStyle = null;
  let inert = [];
  const preferencesKey = 'diffcompass-map-preferences';
  let preferences = { motion: true };
  function validated(value) {
    const result = {};
    if (!value || typeof value !== 'object') return result;
    if (['dark', 'light'].includes(value.theme)) result.theme = value.theme;
    if (['classic', 'blueprint', 'signal-flow', 'editorial'].includes(value.preset)) result.preset = value.preset;
    if (typeof value.motion === 'boolean') result.motion = value.motion;
    return result;
  }
  try { Object.assign(preferences, validated(JSON.parse(window.localStorage.getItem(preferencesKey)))); } catch (_) {}
  function close() {
    const frame = expanded;
    if (!frame) return;
    expanded = null;
    if (typeof frame.hidePopover === 'function' && frame.matches(':popover-open')) frame.hidePopover();
    frame.removeAttribute('popover');
    if (restoreStyle === null) frame.removeAttribute('style');
    else frame.setAttribute('style', restoreStyle);
    inert.forEach(([node, previous]) => { node.inert = previous; });
    inert = [];
    frame.contentWindow?.postMessage({ type: 'diffcompass-map-present-state', active: false }, '*');
    frame.focus({ preventScroll: true });
  }
  window.addEventListener('message', (event) => {
    if (['diffcompass-map-preferences-ready', 'diffcompass-map-preferences-change'].includes(event.data?.type)) {
      const frames = [...document.querySelectorAll('iframe.archify-frame,iframe[data-archify-export-frame]')];
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
    const frame = [...document.querySelectorAll('iframe.archify-frame,iframe[data-archify-export-frame]')]
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
    frame.style.cssText = 'position:fixed!important;inset:0!important;margin:0!important;padding:0!important;width:100vw!important;height:100dvh!important;max-width:none!important;max-height:none!important;border:0!important;border-radius:0!important;z-index:2147483647!important;background:#101418';
    if (typeof frame.showPopover === 'function') {
      frame.setAttribute('popover', 'manual');
      frame.showPopover();
    }
    for (let branch = frame; branch.parentElement; branch = branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (sibling === branch || !(sibling instanceof HTMLElement)) continue;
        inert.push([sibling, sibling.inert]); sibling.inert = true;
      }
    }
    frame.contentWindow.postMessage({ type: 'diffcompass-map-present-state', active: true }, '*');
    frame.focus({ preventScroll: true });
  }
  window.diffcompassMapPresentation = { suspend(frame) { if (expanded === frame) close(); }, resume: open };
  document.addEventListener('keydown', (event) => {
    if (expanded && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); }
  }, true);
  new MutationObserver(() => { if (expanded && !expanded.isConnected) close(); }).observe(document.documentElement, { childList: true, subtree: true });
})();
