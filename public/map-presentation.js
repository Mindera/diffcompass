// Expand the existing iframe without reparenting/reloading its document.
(function () {
  let expanded = null;
  let restoreStyle = null;
  let inert = [];
  let companion = null;
  const paneSizeKey = 'diffcompass-present-evidence-size';
  const paneSizes = {};
  try {
    const saved = JSON.parse(window.localStorage.getItem(paneSizeKey));
    for (const axis of ['width', 'height']) {
      if (Number.isInteger(saved?.[axis]) && saved[axis] > 0 && saved[axis] <= 10000) paneSizes[axis] = saved[axis];
    }
  } catch (_) {}
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
    // Keep the diagram, evidence and divider interactive without moving iframes. Reparenting
    // would reload the diagram or the evidence pane's mounted Monaco editors.
    const branches = new Set();
    for (const target of [expanded, companion?.node, companion?.resizer]) {
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
    companion.disposeResize?.();
    companion = null;
    if (typeof node.hidePopover === 'function' && node.matches(':popover-open')) node.hidePopover();
    if (popover === null) node.removeAttribute('popover');
    else node.setAttribute('popover', popover);
    node.removeAttribute('data-map-present-pane');
    node.dispatchEvent(new Event('diffcompass-map-pane-change'));
  }
  function paneSize(axis) {
    const desktop = axis === 'width';
    const viewport = desktop ? window.innerWidth : window.innerHeight;
    const min = Math.min(desktop ? 280 : 160, Math.floor(viewport / 2));
    const max = Math.max(min, viewport - (desktop ? 320 : 180));
    const fallback = desktop ? Math.min(640, Math.max(320, viewport * .4)) : viewport * .45;
    return { min, max, value: Math.round(Math.max(min, Math.min(max, paneSizes[axis] ?? fallback))) };
  }
  function installPaneResize(frame, node) {
    // A separate popover survives inspector re-renders without moving its editors.
    const resizer = document.createElement('div');
    resizer.className = 'map-present-resizer';
    resizer.setAttribute('data-map-present-resizer', '');
    resizer.setAttribute('role', 'separator');
    resizer.setAttribute('aria-label', 'Resize presentation evidence pane');
    if (node.id) resizer.setAttribute('aria-controls', node.id);
    resizer.tabIndex = 0;
    document.body.appendChild(resizer);
    companion.resizer = resizer;
    if (typeof resizer.showPopover === 'function') {
      resizer.setAttribute('popover', 'manual');
      resizer.showPopover();
    }
    const axis = () => window.innerWidth > 900 ? 'width' : 'height';
    const save = () => { try { window.localStorage.setItem(paneSizeKey, JSON.stringify(paneSizes)); } catch (_) {} };
    function sync() {
      for (const dimension of ['width', 'height']) {
        const value = `${paneSize(dimension).value}px`;
        for (const target of [frame, node, resizer]) target.style.setProperty(`--present-evidence-${dimension}`, value);
      }
      const size = paneSize(axis());
      resizer.hidden = companion.collapsed;
      resizer.setAttribute('aria-orientation', axis() === 'width' ? 'vertical' : 'horizontal');
      for (const [name, value] of [['min', size.min], ['max', size.max], ['now', size.value]]) resizer.setAttribute(`aria-value${name}`, String(value));
      resizer.setAttribute('aria-valuetext', `Evidence ${axis()} ${size.value} pixels`);
    }
    function resize(value) {
      const { min, max } = paneSize(axis());
      paneSizes[axis()] = Math.round(Math.max(min, Math.min(max, value)));
      sync();
    }
    let drag = null;
    function stop() {
      if (!drag) return;
      const id = drag.id;
      drag = null;
      document.documentElement.classList.remove('map-pane-resizing');
      if (resizer.hasPointerCapture(id)) resizer.releasePointerCapture(id);
      save();
    }
    resizer.addEventListener('pointerdown', event => {
      if (event.button !== 0 || companion.collapsed) return;
      event.preventDefault();
      resizer.focus({ preventScroll: true });
      drag = { id: event.pointerId, axis: axis(), start: axis() === 'width' ? event.clientX : event.clientY, size: paneSize(axis()).value };
      resizer.setPointerCapture(event.pointerId);
      document.documentElement.classList.add('map-pane-resizing');
    });
    resizer.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.id) return;
      resize(drag.size + drag.start - (drag.axis === 'width' ? event.clientX : event.clientY));
    });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) resizer.addEventListener(name, stop);
    resizer.addEventListener('keydown', event => {
      const { min, max, value } = paneSize(axis());
      const increase = axis() === 'width' ? 'ArrowLeft' : 'ArrowUp';
      const decrease = axis() === 'width' ? 'ArrowRight' : 'ArrowDown';
      if (!['Home', 'End', increase, decrease].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      resize(event.key === 'Home' ? min : event.key === 'End' ? max : value + (event.key === increase ? 1 : -1) * (event.shiftKey ? 50 : 20));
      save();
    });
    const viewportChanged = () => { stop(); sync(); };
    window.addEventListener('resize', viewportChanged);
    companion.syncResize = () => { stop(); sync(); };
    companion.disposeResize = () => {
      stop();
      window.removeEventListener('resize', viewportChanged);
      resizer.remove();
      for (const target of [frame, node]) for (const dimension of ['width', 'height']) target.style.removeProperty(`--present-evidence-${dimension}`);
    };
    sync();
  }
  function setPaneCollapsed(node, collapsed) {
    if (companion?.node !== node) return;
    companion.collapsed = collapsed;
    const value = collapsed ? 'collapsed' : 'expanded';
    node.setAttribute('data-map-present-pane', value);
    expanded.setAttribute('data-map-present-split', value);
    companion.syncResize?.();
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
      installPaneResize(frame, node);
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
