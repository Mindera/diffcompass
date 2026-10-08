// One parent-document toolbar: iframe eviction, scrolling and menu focus must
// never change which captured source an action refers to.
export function usesMobileActions(pointerType, width, coarse = false) {
  return pointerType === "pen" || pointerType === "touch" || width <= 900 || coarse;
}

export function actionBarBounds(panel, viewport, bottomClearance = 0) {
  const left = Math.max(panel.left, viewport.left), right = Math.min(panel.right, viewport.left + viewport.width);
  const inset = Number.isFinite(bottomClearance) ? Math.max(0, bottomClearance) : 0;
  const top = Math.max(panel.top, viewport.top), bottom = Math.min(panel.bottom, viewport.top + viewport.height - inset);
  return right - left >= 220 && bottom - top >= 160 ? { left: left + 8, top, bottom: bottom - 8, width: right - left - 16 } : null;
}

export function createMobileActions({ panel, enabled, notify, onClear }) {
  const bar = document.createElement("section");
  bar.className = "monaco-mobile-actions"; bar.hidden = true;
  bar.setAttribute("aria-label", "Selected code actions");
  const heading = document.createElement("div"), location = document.createElement("span");
  heading.className = "mobile-action-heading"; location.className = "mobile-action-location";
  location.setAttribute("aria-live", "polite");
  const row = document.createElement("div"); row.className = "mobile-action-buttons mobile-action-primary";
  const dialog = document.createElement("dialog"); dialog.className = "mobile-action-sheet";
  dialog.setAttribute("aria-label", "Selected code");
  document.body.append(bar, dialog);
  let selected = null, selectingText = false, release = null, sheet = null, pending = false, raf = null, disposed = false;
  let reservedScrollSpace = 0;
  const makeButton = (text, run, parent = row) => {
    const button = document.createElement("button"); button.type = "button"; button.className = "button"; button.textContent = text;
    button.addEventListener("click", run); parent.append(button); return button;
  };
  const selectText = makeButton("Select text", () => {
    try { valid(selected); selectingText = !selectingText; selected.setSelectionMode(selectingText); render(); }
    catch (error) { notify(error.message); }
  }, heading);
  selectText.classList.add("mobile-action-selection");
  selectText.title = "Enable free text selection: drag over characters, or tap a word. Turn off to scroll.";
  const closeSelection = makeButton("×", () => clear(), heading);
  closeSelection.classList.add("mobile-action-clear");
  closeSelection.setAttribute("aria-label", "Clear code selection");
  heading.prepend(location); bar.append(heading, row);
  const comment = makeButton("Comment", () => compose("comment"));
  const ask = makeButton("Ask agent", () => compose("ask"));
  const suggest = makeButton("Suggest edit", () => runAction(selected, "suggest"));
  const more = makeButton("More", menu);
  more.setAttribute("aria-haspopup", "dialog");
  function title(item = selected) {
    const a = item.anchor;
    return `${a.path} · ${a.side === "old" ? "Before" : "After"} · L${a.line}${a.endLine > a.line ? `–${a.endLine}` : ""}`;
  }
  function valid(item) {
    if (!item?.valid()) throw Error("This source is no longer current. Close this panel and select the code again.");
  }
  function closeSheet() {
    if (pending) return false;
    sheet?.item.setDraft(false); sheet = null;
    if (dialog.open) dialog.close();
    dialog.replaceChildren(); schedule(); return true;
  }
  function clear() {
    if (!closeSheet()) return;
    selected?.setSelectionMode(false); selected?.highlight?.(null); selected = null; selectingText = false;
    release?.(); release = null; bar.hidden = true;
    panel.style.removeProperty("--mobile-actions-height"); onClear?.();
  }
  function update() {
    raf = null;
    if (disposed) return;
    const vv = window.visualViewport;
    const panelBounds = panel.getBoundingClientRect();
    const viewport = {
      left: vv?.offsetLeft || 0, top: vv?.offsetTop || 0, width: vv?.width || innerWidth, height: vv?.height || innerHeight,
    };
    const clearance = parseFloat(getComputedStyle(bar).getPropertyValue("--review-host-bottom-clearance")) || 0;
    const bounds = actionBarBounds(panelBounds, viewport, clearance);
    if (selected && !selected.valid() && !sheet) { clear(); return; }
    bar.hidden = !selected || !enabled() || !bounds || dialog.open;
    if (bounds && selected) {
      for (const node of [bar, dialog]) {
        node.style.left = bounds.left + "px"; node.style.width = bounds.width + "px";
        node.style.bottom = Math.max(0, innerHeight - bounds.bottom) + "px";
      }
      dialog.style.maxHeight = Math.max(120, bounds.bottom - bounds.top - 16) + "px";
    }
    // Include the reserved host area in the scroll/reveal clearance as well.
    const bottomGap = bounds ? Math.max(0, Math.min(panelBounds.bottom, viewport.top + viewport.height) - bounds.bottom) : 0;
    const occupiedHeight = !bar.hidden ? bar.offsetHeight + bottomGap + 16 : 0;
    panel.style.setProperty("--mobile-actions-height", `${occupiedHeight}px`);
    // Opening a sheet hides the dock, but must not shrink the file list and
    // clamp scrollTop when the selection is near the bottom of the last file.
    reservedScrollSpace = Math.max(reservedScrollSpace, occupiedHeight);
    panel.style.setProperty("--mobile-actions-scroll-space", `${reservedScrollSpace}px`);
  }
  function schedule() { if (!disposed && raf === null) raf = requestAnimationFrame(update); }
  function render() {
    location.textContent = title(); location.title = location.textContent;
    selectText.hidden = !selected.capabilities.textSelection;
    selectText.textContent = selectingText ? "✓ Select text" : "Select text";
    selectText.setAttribute("aria-pressed", String(selectingText));
    comment.hidden = !selected.capabilities.comment; ask.hidden = !selected.capabilities.ask;
    suggest.hidden = !selected.capabilities.suggest;
    const count = [comment, ask, suggest, more].filter(button => !button.hidden).length;
    row.dataset.actionCount = String(count); row.style.setProperty("--action-count", String(count));
    schedule();
  }
  function openSheet(label, item) {
    if (!closeSheet()) return false;
    const header = document.createElement("header"), heading = document.createElement("h2"), scope = document.createElement("p");
    heading.textContent = label; scope.textContent = title(item); scope.className = "mobile-action-scope";
    header.append(heading); makeButton("Close", closeSheet, header);
    dialog.append(header, scope); dialog.setAttribute("aria-label", label);
    sheet = { item, draft: false }; dialog.showModal(); update(); return true;
  }
  function errorOutput() {
    const error = document.createElement("p"); error.className = "mobile-action-error"; error.setAttribute("role", "alert"); dialog.append(error); return error;
  }
  function compose(kind) {
    const item = selected;
    try { valid(item); } catch (error) { notify(error.message); return; }
    if (!openSheet(kind === "comment" ? "Comment on code" : "Ask agent about code", item)) return;
    item.setDraft(true); sheet.draft = true;
    const quote = document.createElement("pre"); quote.textContent = item.anchor.selectedText; quote.className = "mobile-action-quote"; quote.tabIndex = 0;
    const form = document.createElement("form"), input = document.createElement("textarea"), label = document.createElement("label");
    input.required = true; input.rows = 4; input.id = "mobile-review-message";
    label.htmlFor = input.id; label.textContent = kind === "comment" ? "Comment text" : "Agent question";
    const footer = document.createElement("div"); footer.className = "mobile-action-buttons";
    const submit = makeButton(kind === "comment" ? "Add comment" : "Send question", () => {}, footer); submit.type = "submit";
    makeButton("Cancel", closeSheet, footer);
    form.append(label, input, footer); dialog.append(quote, form);
    const error = errorOutput();
    // The sheet opens with Close focused, not the textarea. Only an explicit
    // tap in the composer should summon a tablet's software keyboard.
    input.addEventListener("keydown", event => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); form.requestSubmit(); }
    });
    form.addEventListener("submit", async event => {
      event.preventDefault(); if (pending || !input.value.trim()) return;
      pending = true; submit.disabled = true; error.textContent = "";
      try {
        valid(item); await item.submit(kind, input.value.trim());
        pending = false; closeSheet();
        notify(kind === "comment" ? "Comment saved beside the code." : "Question sent. Follow the answer in Questions.");
      } catch (reason) { error.textContent = reason.message; }
      finally { pending = false; submit.disabled = false; }
    });
  }
  async function runAction(item, id) {
    try { valid(item); if (closeSheet()) await item.run(id); }
    catch (error) { notify(error.message); }
  }
  function menu() {
    const item = selected;
    try { valid(item); } catch (error) { notify(error.message); return; }
    if (!openSheet("Code actions", item)) return;
    const list = document.createElement("div"); list.className = "mobile-action-menu"; dialog.append(list);
    for (const [id, label] of [["definition", "Go to definition"], ["peekDefinition", "Peek definition"], ["references", "Find references"], ["source", "View source"], ["copy", "Copy selection"]]) {
      if (!item.capabilities[id]) continue;
      makeButton(label, async () => {
        try {
          valid(item);
          // Keep clipboard writes in this trusted click's call stack.
          if (id === "copy") { await navigator.clipboard.writeText(item.anchor.selectedText); closeSheet(); notify("Copied selection"); return; }
          await runAction(item, id);
        } catch (error) { notify(error.message); }
      }, list);
    }
  }
  dialog.addEventListener("cancel", event => { event.preventDefault(); closeSheet(); });
  // No backdrop dismissal: a stray pen tap must not discard a draft.
  const observer = new ResizeObserver(schedule); observer.observe(panel); observer.observe(bar);
  window.addEventListener("resize", schedule); window.addEventListener("scroll", schedule, true);
  window.visualViewport?.addEventListener("resize", schedule); window.visualViewport?.addEventListener("scroll", schedule);
  return {
    select(item, pointerType) {
      if (sheet || !enabled() || !usesMobileActions(pointerType, innerWidth, matchMedia("(pointer: coarse)").matches)) return;
      selected?.setSelectionMode(false); selected?.highlight?.(null); release?.();
      selected = item; release = item.retain(); item.setSelectionMode(selectingText); item.highlight?.(item.anchor); render();
    },
    clear, update: schedule,
    clearPath(path) { if (selected?.anchor.path === path && !sheet?.draft) clear(); },
    get hasDraft() { return Boolean(sheet?.draft); },
    dispose() {
      pending = false; clear(); disposed = true; if (raf !== null) cancelAnimationFrame(raf);
      observer.disconnect(); window.removeEventListener("resize", schedule); window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule); window.visualViewport?.removeEventListener("scroll", schedule);
      panel.style.removeProperty("--mobile-actions-scroll-space");
      bar.remove(); dialog.remove();
    },
  };
}
