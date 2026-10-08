// A captured pen cannot use the browser's native scroll chaining. Consume the
// inner range, then pass the remainder to the stacked mobile document. Once the
// page is moving between panes, finish that movement before scrolling code.
export function panReviewScroll(panel, deltaY, page = null) {
  if (!Number.isFinite(deltaY) || !deltaY) return;
  const consume = (node, delta) => {
    const before = node.scrollTop;
    const top = Math.max(0, Math.min(node.scrollHeight - node.clientHeight, before + delta));
    node.scrollTo({ top, behavior: "instant" });
    return delta - (node.scrollTop - before);
  };
  if (!page || page === panel) { consume(panel, deltaY); return; }
  if (page.scrollTop > 0) {
    const remaining = consume(page, deltaY);
    // Do not start scrolling hidden code again at the bottom of the page.
    if (remaining < 0 && page.scrollTop <= 0) consume(panel, remaining);
  } else {
    const remaining = consume(panel, deltaY);
    if (remaining) consume(page, remaining);
  }
}

// Monaco treats a pen like a selecting mouse, even in read-only editors. Own
// primary-tip gestures on code: normally drag to pan, tap to choose a line.
// Explicit text mode instead maps pen/finger drags to exact source endpoints.
// Mouse selection, ordinary finger scrolling, widgets and forms stay native.
export function installPenScroll({ root, hitTest, onPan, onTap, onStart = () => {}, selectionEnabled = () => false, onSelect, allowPeek = false }) {
  const doc = root.ownerDocument;
  const listeners = [];
  let gesture = null, lastPenClick = null;
  const listen = (target, type, callback) => {
    target.addEventListener(type, callback, { capture: true, passive: false });
    listeners.push(() => target.removeEventListener(type, callback, true));
  };
  const stop = event => { event.preventDefault(); event.stopImmediatePropagation(); };
  const finish = () => {
    const previous = gesture;
    gesture = null;
    if (!previous) return;
    if (root.hasPointerCapture?.(previous.id)) root.releasePointerCapture(previous.id);
    previous.release?.();
    return previous;
  };
  const move = event => {
    // clientY is relative to the iframe, which itself moves as its parent
    // scrolls. Screen coordinates avoid feeding that movement back into pan.
    const dx = gesture.x - event.screenX, dy = gesture.y - event.screenY;
    if (!gesture.dragged && Math.hypot(dx, dy) < 6) return;
    gesture.dragged = true;
    gesture.x = event.screenX; gesture.y = event.screenY;
    if (gesture.selecting) onSelect(gesture.hit, hitTest(event, true), { tap: false, pointerType: event.pointerType });
    else if (dx || dy) onPan(gesture.hit, dx, dy);
  };
  listen(doc, "pointerdown", event => {
    if (gesture) { finish(); return; }
    lastPenClick = null;
    const selecting = Boolean(onSelect && selectionEnabled());
    if ((event.pointerType !== "pen" && !(selecting && event.pointerType === "touch")) || event.button !== 0 || !event.isPrimary
      || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || !root.contains(event.target)) return;
    if (event.target.closest?.("button, a, input, textarea, select, [contenteditable='true'], [role='button'], .review-zone, .context-collapse-zone, .monaco-menu, .find-widget, .suggest-widget, .scrollbar")) return;
    if (!allowPeek && event.target.closest?.(".peekview-widget")) return;
    const hit = hitTest(event);
    if (!hit) return;
    stop(event);
    gesture = { id: event.pointerId, x: event.screenX, y: event.screenY, hit, event, selecting, dragged: false, release: onStart(hit) };
    // Capture lets the pen continue across the iframe boundary. Synthetic
    // unit/browser events cannot acquire capture, hence the guarded fallback.
    try { root.setPointerCapture(event.pointerId); } catch { /* Document listeners still cover this frame. */ }
  });
  listen(doc, "pointermove", event => {
    if (event.pointerId !== gesture?.id) return;
    stop(event); move(event);
  });
  listen(doc, "pointerup", event => {
    if (event.pointerId !== gesture?.id) return;
    stop(event); move(event);
    const previous = finish();
    lastPenClick = previous.id;
    if (previous.selecting) onSelect(previous.hit, hitTest(event, true), { tap: !previous.dragged, pointerType: event.pointerType });
    else if (!previous.dragged) onTap(previous.hit, previous.event);
  });
  listen(doc, "pointercancel", event => { if (event.pointerId === gesture?.id) finish(); });
  listen(root, "lostpointercapture", event => { if (event.pointerId === gesture?.id) finish(); });
  listen(doc.defaultView, "blur", finish);
  listen(doc, "click", event => {
    // Cancelling pointerdown suppresses compatibility mouse events, but not
    // click itself. Do not let the end of a pan select a different source line.
    if (["pen", "touch"].includes(event.pointerType) && event.pointerId === lastPenClick) { stop(event); lastPenClick = null; }
  });
  for (const type of ["touchstart", "touchmove", "touchend"]) listen(doc, type, event => {
    // Some tablet browsers also emit TouchEvents for a pen. Do not let Monaco's
    // document-level Gesture handler translate the same drag into selection.
    if (gesture && root.contains(event.target)) stop(event);
  });
  return () => { for (const remove of listeners) remove(); finish(); };
}

// Peek Definition/References creates a separate editor lazily. Resolve the
// innermost instance through Monaco's public registry at gesture time, so
// closing/reopening a peek never leaves listeners attached to an old instance.
// Its viewport scrolls independently of the outer diff and its selection mode.
export function installPeekPenScroll({ root, monaco, onStart }) {
  return installPenScroll({
    root, allowPeek: true, onStart,
    hitTest(event) {
      const node = event.target.closest?.(".monaco-editor");
      if (!node?.closest(".peekview-widget")) return null;
      const editor = monaco.editor.getEditors().find(editor => editor.getDomNode() === node);
      if (!editor?.getOption(monaco.editor.EditorOption.readOnly)) return null;
      const hit = editor.getTargetAtClientPoint(event.clientX, event.clientY);
      if (!hit || ![monaco.editor.MouseTargetType.CONTENT_TEXT, monaco.editor.MouseTargetType.CONTENT_EMPTY].includes(hit.type)) return null;
      // No hidden editable browser input, even when the peek focuses itself.
      editor.updateOptions({ domReadOnly: true, editContext: false });
      return { editor, position: hit.position };
    },
    onPan({ editor }, dx, dy) {
      editor.setScrollPosition({ scrollLeft: editor.getScrollLeft() + dx, scrollTop: editor.getScrollTop() + dy });
    },
    onTap({ editor, position }) { if (position) editor.setPosition(position); },
  });
}
