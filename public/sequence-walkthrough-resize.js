// Pane sizing only; the existing renderer retains ownership of its camera.
(function (root) {
  function bounds(width, height) {
    const stacked = width < 1040;
    const min = stacked ? Math.min(226, Math.max(46, Math.floor(height * .4))) : 280;
    const max = Math.max(min, Math.min(900, (stacked ? height - 360 : width - 430)));
    return { stacked, min, max, initial: Math.max(min, Math.min(max, stacked ? height * .35 : Math.min(420, width * .34))) };
  }
  function valid(value, minimum) { return Number.isInteger(value) && (value === 0 || value >= minimum && value <= 900); }
  function mount(layout, separator, pane, restoreSelection) {
    let width = 0, height = 0, drag = null, disposed = false;
    const current = () => bounds(layout.clientWidth, layout.clientHeight);
    const key = b => b.stacked ? 'sequenceCodeHeight' : 'sequenceCodeWidth';
    const value = b => Math.round(Math.max(b.min, Math.min(b.max, (b.stacked ? height : width) || b.initial)));
    function publish(b) {
      root.parent.postMessage({ type: 'diffcompass-map-preferences-change', preferences: { [key(b)]: b.stacked ? height : width } }, '*');
    }
    function finish(event) {
      if (!drag || event && event.pointerId !== drag.id) return;
      const previous = drag; drag = null;
      separator.classList.remove('dragging');
      if (separator.hasPointerCapture(previous.id)) separator.releasePointerCapture(previous.id);
      if (!disposed) publish(previous.bounds);
    }
    function sync() {
      const b = current();
      if (drag && (b.stacked !== drag.bounds.stacked || pane.hidden)) finish();
      layout.classList.toggle('sequence-walkthrough-stacked', b.stacked);
      layout.style.setProperty('--sequence-code-size', value(b) + 'px');
      separator.hidden = pane.hidden;
      separator.setAttribute('aria-orientation', b.stacked ? 'horizontal' : 'vertical');
      separator.setAttribute('aria-label', b.stacked ? 'Resize code pane height' : 'Resize code pane width');
      separator.setAttribute('aria-valuemin', String(b.min));
      separator.setAttribute('aria-valuemax', String(b.max));
      separator.setAttribute('aria-valuenow', String(value(b)));
      separator.setAttribute('aria-valuetext', value(b) + (b.stacked ? ' pixels high' : ' pixels wide'));
      separator.title = b.stacked ? 'Drag to resize code height. Up/Down: resize; Home/End: limits; Enter or double-click: reset.' : 'Drag to resize code width. Left/Right: resize; Home/End: limits; Enter or double-click: reset.';
    }
    function set(next, b) {
      next = next === 0 ? 0 : Math.round(Math.max(b.min, Math.min(b.max, next)));
      if (b.stacked) height = next; else width = next;
      sync();
    }
    function down(event) {
      if (event.button !== 0 || event.isPrimary === false || pane.hidden || drag) return;
      event.preventDefault(); event.stopPropagation();
      try { separator.setPointerCapture(event.pointerId); } catch (_) { return; }
      const b = current();
      drag = { id: event.pointerId, bounds: b, start: b.stacked ? event.clientY : event.clientX, size: value(b) };
      separator.classList.add('dragging');
      separator.focus({ preventScroll: true });
    }
    function move(event) {
      if (!drag || drag.id !== event.pointerId) return;
      set(drag.size + drag.start - (drag.bounds.stacked ? event.clientY : event.clientX), drag.bounds);
    }
    function keyboard(event) {
      const b = current(), arrows = b.stacked ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
      if (![...arrows, 'Home', 'End', 'Enter'].includes(event.key) || pane.hidden) return;
      event.preventDefault(); event.stopPropagation();
      set(event.key === 'Home' ? b.min : event.key === 'End' ? b.max : event.key === 'Enter' ? 0 : value(b) + (event.key === arrows[0] ? 20 : -20), b);
      publish(b); restoreSelection();
    }
    function reset(event) { event.preventDefault(); const b = current(); set(0, b); publish(b); restoreSelection(); }
    function preferences(event) {
      if (event.source !== root.parent || event.data?.type !== 'diffcompass-map-preferences' || drag) return;
      const p = event.data.preferences || {};
      if (valid(p.sequenceCodeWidth, 280)) width = p.sequenceCodeWidth;
      if (valid(p.sequenceCodeHeight, 46)) height = p.sequenceCodeHeight;
      sync();
    }
    const listeners = { pointerdown: down, pointermove: move, pointerup: finish, pointercancel: finish, lostpointercapture: finish, keydown: keyboard, dblclick: reset, click: restoreSelection };
    for (const [name, handler] of Object.entries(listeners)) separator.addEventListener(name, handler);
    root.addEventListener('message', preferences);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(sync) : null;
    observer?.observe(layout); sync();
    root.parent.postMessage({ type: 'diffcompass-map-preferences-ready' }, '*');
    return { sync, dispose() {
      disposed = true; finish(); observer?.disconnect(); root.removeEventListener('message', preferences);
      for (const [name, handler] of Object.entries(listeners)) separator.removeEventListener(name, handler);
    } };
  }
  root.DiffCompassSequenceResize = { bounds, mount };
})(typeof window === 'undefined' ? globalThis : window);
