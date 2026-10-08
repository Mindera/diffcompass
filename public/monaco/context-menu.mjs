// Monaco places its menu once. A source card can subsequently shrink when a
// composer closes; the old menu coordinates must not escape the resized iframe.
export function menuOffset(rect, bounds) {
  const left = Math.max(bounds.left, Math.min(rect.left, bounds.right - rect.width));
  const top = Math.max(bounds.top, Math.min(rect.top, bounds.bottom - rect.height));
  return { x: left - rect.left, y: top - rect.top };
}

export function installContextMenuViewport(win) {
  const doc = win.document;
  let pending = null;
  const menus = new Map();
  function bounds() {
    const box = { left: 4, top: 4, right: win.innerWidth - 4, bottom: win.innerHeight - 4 };
    const frame = win.frameElement;
    if (frame) {
      const rect = frame.getBoundingClientRect(), parent = win.parent;
      const panel = frame.closest('#diff-panel')?.getBoundingClientRect();
      const header = frame.closest('.monaco-file-slot')?.querySelector('.monaco-file-header')?.getBoundingClientRect();
      box.left = Math.max(box.left, (panel?.left ?? 0) - rect.left + 4);
      box.top = Math.max(box.top, Math.max(0, panel?.top ?? 0, header?.bottom ?? 0) - rect.top + 4);
      box.right = Math.min(box.right, Math.min(parent.innerWidth, panel?.right ?? parent.innerWidth) - rect.left - 4);
      box.bottom = Math.min(box.bottom, Math.min(parent.innerHeight, panel?.bottom ?? parent.innerHeight) - rect.top - 4);
    }
    return box;
  }
  function layout() {
    pending = null;
    const box = bounds();
    if (box.bottom <= box.top || box.right <= box.left) return;
    for (const menu of menus.keys()) {
      if (!menu.querySelector('.monaco-menu') || !menu.getClientRects().length) continue;
      const maxHeight = `${box.bottom - box.top}px`;
      if (menu.style.maxHeight !== maxHeight) menu.style.maxHeight = maxHeight;
      if (menu.style.overflowY !== 'auto') menu.style.overflowY = 'auto';
      const { x, y } = menuOffset(menu.getBoundingClientRect(), box);
      if (Math.abs(x) > 0.5) menu.style.left = `${(parseFloat(menu.style.left) || 0) + x}px`;
      if (Math.abs(y) > 0.5) menu.style.top = `${(parseFloat(menu.style.top) || 0) + y}px`;
    }
  }
  function schedule() { if (pending === null) pending = win.requestAnimationFrame(layout); }
  function discover() {
    for (const [menu, observer] of menus) if (!menu.isConnected) { observer.disconnect(); menus.delete(menu); }
    for (const menu of doc.querySelectorAll('body > .context-view')) {
      if (menus.has(menu)) continue;
      const observer = new win.MutationObserver(schedule);
      observer.observe(menu, { attributes: true, attributeFilter: ['style'], childList: true, subtree: true });
      menus.set(menu, observer);
    }
    schedule();
  }
  // Watch only the body and menu subtrees, never Monaco's changing source DOM.
  const observer = new win.MutationObserver(discover);
  observer.observe(doc.body, { childList: true });
  discover();
  win.addEventListener('resize', schedule);
  if (win.frameElement) win.parent.addEventListener('scroll', schedule, true);
  return () => {
    observer.disconnect();
    for (const observer of menus.values()) observer.disconnect();
    menus.clear();
    win.removeEventListener('resize', schedule);
    if (win.frameElement) win.parent.removeEventListener('scroll', schedule, true);
    if (pending !== null) win.cancelAnimationFrame(pending);
  };
}
