import { sourceAnchor } from "./source-anchor.mjs";

const message = "Select code within one Before block or on the After side; mixed Before/After selections cannot share one source anchor.";
const zoneSelector = ".line-delete-selectable";
const elementOf = node => node?.nodeType === 3 ? node.parentElement : node;
const zoneOf = node => elementOf(node)?.closest?.(zoneSelector);
const compare = (a, b) => a.lineNumber - b.lineNumber || a.column - b.column;

// Check exact model identity/content and range bounds before any review action.
// Never search by quote: repeated text must retain its actual source location.
export function deletedSourceSelection(file, model, mapping, start, end) {
  if (!model || model.isDisposed() || mapping?.model !== model || model.getValue().replaceAll("\r\n", "\n") !== file.old.replaceAll("\r\n", "\n")) throw new Error("Removed source changed; select it again.");
  const points = [start, end].map(point => {
    if (!point || !Number.isSafeInteger(point.lineNumber) || !Number.isSafeInteger(point.column)
      || point.lineNumber < mapping.startLineNumber || point.lineNumber >= mapping.endLineNumberExclusive
      || point.lineNumber > model.getLineCount() || point.column < 1 || point.column > model.getLineMaxColumn(point.lineNumber)) throw new Error("Cannot map this removed-text selection safely. Select the code again.");
    return point;
  }).sort(compare);
  const range = { startLineNumber: points[0].lineNumber, startColumn: points[0].column, endLineNumber: points[1].lineNumber, endColumn: points[1].column };
  const quoted = compare(points[0], points[1]) !== 0;
  const anchor = sourceAnchor(file, "old", range, { preserveEol: true });
  if (quoted && !anchor.selectedText.trim()) throw new Error("Select non-whitespace code for a quote, or click the line for a line comment.");
  return { anchor, range, quoted };
}

// Native Range endpoints may be token-span/container boundaries. Normalize to
// a real text leaf before invoking Monaco's character mapping (tabs, Unicode,
// wrapped fragments and token spans are not one character per screen column).
function textPoint(node, offset, atEnd) {
  if (node?.nodeType === 3) return { node, offset };
  if (!node || !Number.isSafeInteger(offset) || offset < 0 || offset > node.childNodes.length) return null;
  const descend = (child, last) => {
    while (child && child.nodeType !== 3) child = last ? child.lastChild : child.firstChild;
    return child ? { node: child, offset: last ? child.textContent.length : 0 } : null;
  };
  return atEnd && offset > 0 ? descend(node.childNodes[offset - 1], true)
    : offset < node.childNodes.length ? descend(node.childNodes[offset], false)
    : descend(node.lastChild, true);
}

export function installDeletedSelection({ root, diff, enabled, file, onSelect, onInvalid, runAction }) {
  const doc = root.ownerDocument;
  let owned = false, saved = null, menu = null, origin = null, failureReason = "";
  const listeners = [];
  const listen = (target, name, callback, options) => { target.addEventListener(name, callback, options); listeners.push(() => target.removeEventListener(name, callback, options)); };
  const closeMenu = () => { menu?.remove(); menu = null; };
  const invalid = (reason = message) => { owned = true; saved = null; failureReason = reason; onInvalid(reason); return false; };
  const select = (zone, start, end) => {
    try {
      const model = diff.getOriginalEditor().getModel();
      const mapping = zone.diffCompassDeletedSource;
      if (!zone.isConnected || !root.contains(zone) || !mapping) return invalid("Removed-source mapping is unavailable; select the code again.");
      const result = deletedSourceSelection(file(), model, mapping, mapping.position(start.node, start.offset), mapping.position(end.node, end.offset));
      owned = true; failureReason = ""; saved = { zone, mapping, model, version: model.getVersionId(), result };
      onSelect(result); return true;
    } catch (error) { return invalid(error.message); }
  };
  const selection = () => {
    const s = doc.getSelection();
    if (!enabled() || !s?.rangeCount) return null;
    const range = s.getRangeAt(0), a = zoneOf(range.startContainer), b = zoneOf(range.endContainer);
    if (!a && !b) {
      if (!range.collapsed && root.contains(range.commonAncestorContainer) && [...root.querySelectorAll(zoneSelector)].some(zone => range.intersectsNode(zone))) return invalid();
      return null;
    }
    if (s.rangeCount !== 1 || !a || a !== b || !root.contains(a)) return invalid();
    const start = textPoint(range.startContainer, range.startOffset, false), end = textPoint(range.endContainer, range.endOffset, true);
    if (!start || !end) return invalid();
    return select(a, start, end);
  };
  const pointAt = event => {
    const p = doc.caretPositionFromPoint?.(event.clientX, event.clientY);
    if (p) return { node: p.offsetNode, offset: p.offset };
    const r = doc.caretRangeFromPoint?.(event.clientX, event.clientY);
    return r ? { node: r.startContainer, offset: r.startOffset } : null;
  };
  const selectAt = event => {
    const point = pointAt(event), zone = zoneOf(event.target);
    return point && zone && zoneOf(point.node) === zone ? select(zone, point, point) : invalid("Click directly on the removed code to select a Before line.");
  };
  const reset = () => { owned = false; saved = null; origin = null; failureReason = ""; closeMenu(); };
  const validate = () => {
    if (!owned) return true;
    if (!saved) return invalid(failureReason || "Select the removed code again.");
    if (!enabled() || saved.model !== diff.getOriginalEditor().getModel() || saved.model.isDisposed()
      || saved.version !== saved.model.getVersionId()) return invalid("Removed source changed; select it again.");
    onSelect(saved.result); return true;
  };
  const openMenu = event => {
    if (!enabled() || !zoneOf(event.target)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const selected = selection();
    if (selected === false) return;
    const target = zoneOf(event.target);
    const nativeRange = doc.getSelection()?.rangeCount ? doc.getSelection().getRangeAt(0) : null;
    const point = event.type === "keydown" ? null : pointAt(event);
    const outside = selected === true && (zoneOf(nativeRange.startContainer) !== target || (point && !nativeRange.isPointInRange(point.node, point.offset)));
    if (outside && event.type === "keydown") {
      const first = textPoint(target, 0, false); if (!first || !select(target, first, first)) return;
    } else if ((outside || selected === null) && !(event.type === "keydown" && saved) && !selectAt(event)) return;
    if (!validate()) return;
    closeMenu();
    menu = doc.createElement("div"); menu.className = "deleted-review-menu"; menu.setAttribute("role", "menu"); menu.setAttribute("aria-label", "Before code review actions");
    for (const [name, label] of [["comment", "Comment on selection"], ["ask", "Ask agent about selection"], ["source", "View source"], ["peek", "Find references"], ["copy", "Copy"]]) {
      const button = doc.createElement("button"); button.type = "button"; button.textContent = label; button.setAttribute("role", "menuitem");
      button.addEventListener("click", () => { closeMenu(); if (validate()) runAction(name); }); menu.append(button);
    }
    const rect = target.getBoundingClientRect();
    const x = event.clientX || rect.left + 15, y = event.clientY || rect.top + 15;
    doc.body.append(menu);
    menu.style.left = `${Math.max(0, Math.min(x, doc.defaultView.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(0, Math.min(y, doc.defaultView.innerHeight - menu.offsetHeight - 8))}px`;
    menu.addEventListener("keydown", e => {
      const buttons = [...menu.querySelectorAll("button")], i = buttons.indexOf(doc.activeElement);
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) { e.preventDefault(); buttons[e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length].focus(); }
      if (e.key === "Escape" || e.key === "Tab") { closeMenu(); target.focus({ preventScroll: true }); if (e.key === "Escape") e.preventDefault(); }
    });
    menu.firstChild.focus();
  };
  listen(root, "pointerdown", event => {
    if (!enabled() || event.target.closest(".review-zone,.context-collapse-zone")) return;
    const zone = zoneOf(event.target);
    if (zone) { owned = true; saved = null; origin = zone; onInvalid("Selecting Before code…"); }
    else if (event.target.closest(".monaco-editor")) { if (owned) doc.getSelection()?.removeAllRanges(); reset(); }
  }, true);
  listen(doc, "selectionchange", () => { if (enabled()) selection(); });
  listen(doc, "pointerup", event => {
    if (!enabled()) return;
    if (origin) { if (selection() === null) selectAt(event); origin = null; }
    else selection();
  });
  listen(root, "contextmenu", openMenu, true);
  listen(doc, "pointerdown", event => { if (menu && !menu.contains(event.target)) closeMenu(); }, true);
  const decorate = () => {
    for (const zone of root.querySelectorAll(zoneSelector)) {
      const mapping = zone.diffCompassDeletedSource;
      if (!mapping) continue;
      zone.tabIndex = 0; zone.setAttribute("role", "group");
      zone.setAttribute("aria-label", `Before removed lines ${mapping.startLineNumber}–${mapping.endLineNumberExclusive - 1}; select text or press Shift+F10 for review actions`);
      zone.parentElement?.removeAttribute("aria-hidden");
    }
  };
  listen(root, "keydown", event => {
    if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
    const zone = zoneOf(event.target); if (!zone || !enabled()) return;
    const selected = selection(); if (selected === false) return;
    if (selected === null) {
      const point = textPoint(zone, 0, false); if (!point || !select(zone, point, point)) return;
    }
    openMenu(event);
  }, true);
  const observer = new MutationObserver(decorate); observer.observe(root, { childList: true, subtree: true });
  return { get ownsSelection() { return owned; }, reset, validate,
    editorFocused() {
      // Tabbing from a removed block into the After editor transfers ownership.
      // Do not clear a native Before drag just because Monaco handles its mouse
      // event by focusing the modified editor underneath that view zone.
      if (owned && !origin) { reset(); doc.getSelection()?.removeAllRanges(); }
    },
    dispose() { reset(); observer.disconnect(); for (const remove of listeners) remove(); } };
}
