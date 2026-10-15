/* Pane sizes belong to the reading workspace, not to an individual story. */
function createReadingPaneResizers(stage) {
  const storageKey = "diffcompass-reading-pane-widths-v1";
  const minimum = { outline: 160, evidence: 240 };
  const maximum = { outline: 480, evidence: 720 };
  const readingMinimum = 360;
  let preferred = {};
  let widths;
  let drag = null;

  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    for (const side of Object.keys(minimum)) {
      if (Number.isFinite(saved?.[side]) && saved[side] >= minimum[side]) {
        preferred[side] = Math.min(maximum[side], saved[side]);
      }
    }
  } catch { /* Resizing also works without local storage. */ }

  function defaults() {
    return stage.clientWidth <= 1200
      ? { outline: 175, evidence: 285 }
      : { outline: 210, evidence: 340 };
  }

  function limit(side) {
    const other = side === "outline" ? "evidence" : "outline";
    return Math.max(minimum[side], Math.min(maximum[side], stage.clientWidth - widths[other] - readingMinimum));
  }

  function render() {
    for (const side of Object.keys(minimum)) {
      stage.style.setProperty(`--lab-${side}-width`, `${widths[side]}px`);
      for (const handle of stage.querySelectorAll(`[data-resize-pane="${side}"]`)) {
        handle.setAttribute("aria-valuenow", String(widths[side]));
        handle.setAttribute("aria-valuemax", String(limit(side)));
        handle.setAttribute("aria-valuetext", `${widths[side]} pixels`);
      }
    }
  }

  function fit() {
    // A smaller window temporarily clamps widths without overwriting the saved sizes.
    widths = { ...defaults(), ...preferred };
    widths.evidence = Math.min(widths.evidence, limit("evidence"));
    widths.outline = Math.min(widths.outline, limit("outline"));
    render();
  }

  function resize(side, value) {
    widths[side] = Math.round(Math.max(minimum[side], Math.min(limit(side), value)));
    render();
  }

  function save(side) {
    preferred[side] = widths[side];
    try { localStorage.setItem(storageKey, JSON.stringify(preferred)); }
    catch { /* Keep the chosen width for this tab. */ }
  }

  function finish(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { side, handle, pointerId } = drag;
    drag = null;
    save(side);
    handle.classList.remove("dragging");
    stage.classList.remove("lab-resizing");
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
  }

  stage.addEventListener("pointerdown", event => {
    const handle = event.target.closest("[data-resize-pane]");
    if (!handle || event.button !== 0 || drag) return;
    event.preventDefault();
    const side = handle.dataset.resizePane;
    drag = { side, handle, pointerId: event.pointerId, x: event.clientX, width: widths[side] };
    handle.focus({ preventScroll: true });
    handle.classList.add("dragging");
    stage.classList.add("lab-resizing");
    handle.setPointerCapture(event.pointerId);
  });
  stage.addEventListener("pointermove", event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const direction = drag.side === "outline" ? 1 : -1;
    resize(drag.side, drag.width + direction * (event.clientX - drag.x));
  });
  for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) {
    stage.addEventListener(event, finish);
  }
  stage.addEventListener("keydown", event => {
    const handle = event.target.closest("[data-resize-pane]");
    if (!handle || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const side = handle.dataset.resizePane;
    const direction = (event.key === "ArrowRight" ? 1 : -1) * (side === "outline" ? 1 : -1);
    const value = event.key === "Home" ? minimum[side]
      : event.key === "End" ? maximum[side] : widths[side] + direction * 20;
    resize(side, value);
    save(side);
  });
  stage.addEventListener("dblclick", event => {
    const handle = event.target.closest("[data-resize-pane]");
    if (!handle) return;
    const side = handle.dataset.resizePane;
    resize(side, defaults()[side]);
    save(side);
  });

  new ResizeObserver(fit).observe(stage);
  fit();
  return {
    mount(workspace) {
      for (const side of Object.keys(minimum)) {
        const pane = workspace.querySelector(`.lab-${side}`);
        pane.id = `${workspace.id}-${side}`;
        const handle = document.createElement("div");
        handle.className = `lab-resizer ${side === "outline" ? "file" : "agent"}-resizer`;
        handle.dataset.resizePane = side;
        handle.tabIndex = 0;
        handle.setAttribute("role", "separator");
        handle.setAttribute("aria-label", `Resize ${side} pane`);
        handle.setAttribute("aria-orientation", "vertical");
        handle.setAttribute("aria-controls", pane.id);
        handle.setAttribute("aria-valuemin", String(minimum[side]));
        handle.title = "Drag to resize · Double-click to reset";
        workspace.appendChild(handle);
      }
      render();
    },
  };
}
