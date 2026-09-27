// Expand the existing iframe without reparenting/reloading its document.
(function () {
  let expanded = null;
  let restoreStyle = null;
  let inert = [];
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
    frame.contentWindow?.postMessage({ type: 'code-review-tour-map-present-state', active: false }, '*');
    frame.focus({ preventScroll: true });
  }
  window.addEventListener('message', (event) => {
    if (event.data?.type !== 'code-review-tour-map-present' || typeof event.data.active !== 'boolean') return;
    const frame = [...document.querySelectorAll('iframe.archify-frame,iframe[data-archify-export-frame]')]
      .find(node => node.contentWindow === event.source);
    if (!frame || !frame.getClientRects().length) return;
    if (!event.data.active) { if (expanded === frame) close(); return; }
    if (expanded === frame) return;
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
    frame.contentWindow.postMessage({ type: 'code-review-tour-map-present-state', active: true }, '*');
    frame.focus({ preventScroll: true });
  });
  document.addEventListener('keydown', (event) => {
    if (expanded && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); }
  }, true);
  new MutationObserver(() => { if (expanded && !expanded.isConnected) close(); }).observe(document.documentElement, { childList: true, subtree: true });
})();
