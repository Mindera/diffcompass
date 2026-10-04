import { sourceAnchor } from "./fixtures.mjs";
import { reviewMarkers, highestPriority, collapsedRegionState, commentDescription, commentSubmission } from "./annotations.mjs";

const $ = id => document.getElementById(id);
const token = new URLSearchParams(location.hash.slice(1)).get("token");
async function api(path, body, method = "POST") {
  const response = await fetch(path, { method: body === undefined ? "GET" : method, headers: { "x-diffcompass-token": token, ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
const info = await api("/api/prototype");
let session = await api("/api/session");
let selectedFile = info.files[0], currentAnchor = null, activeSide = "new", activeLayout = "unified", light = false;
let currentSelectionIsQuote = false;
let diff, sourceEditor, viewState, sourceModel, editorModels = [], zones = [], composer = null, generation = 0;
const sideViews = new Map();
let markerWidgets = [], activityFilter = null, contextZones = [], contextSignature = "", contextFrame = null;
const contextDefaults = new Map();
const status = text => { $("status").textContent = text; };
const guard = task => Promise.resolve().then(task).catch(error => status(error.message));
const frameReady = new Promise(resolve => window.addEventListener("message", function listener(event) {
  if (event.origin === location.origin && event.source === $("current").contentWindow && event.data?.type === "diff-lab-ready") {
    window.removeEventListener("message", listener); resolve();
  }
}));
$("current").src = `/current#token=${encodeURIComponent(token)}`;
const current = () => $("current").contentWindow.diffLabCurrent;
for (const file of info.files) $("file").add(new Option(file.path, file.path));
window.MonacoEnvironment = { getWorkerUrl: () => "/vendor/vs/base/worker/workerMain.js" };
window.require.config({ paths: { vs: "/vendor/vs" } });
await new Promise((resolve, reject) => window.require(["vs/editor/editor.main"], resolve, reject));
const monaco = window.monaco;
monaco.editor.defineTheme("diff-lab", { base: "vs-dark", inherit: true, rules: [], colors: { "editor.background": "#101824", "editorGutter.background": "#101824", "diffEditor.unchangedRegionBackground": "#182435", "diffEditor.unchangedRegionForeground": "#a9b9d1" } });
diff = monaco.editor.createDiffEditor($("editor"), {
  theme: "diff-lab", readOnly: true, originalEditable: false, automaticLayout: true,
  renderSideBySide: false, useInlineViewWhenSpaceIsLimited: false,
  minimap: { enabled: false }, fontSize: 12, lineHeight: 20, scrollBeyondLastLine: false,
  wordWrap: "on", diffWordWrap: "on", glyphMargin: true,
  // Monaco explicitly disables function folding in diff editors. Do not force
  // it on the inner editors: their hidden ranges can break diff alignment.
  renderOverviewRuler: false, overviewRulerLanes: 0,
  originalAriaLabel: "Before source", modifiedAriaLabel: "After source",
  lineNumbersMinChars: 6, renderValidationDecorations: "off", stickyScroll: { enabled: false },
  hideUnchangedRegions: { enabled: true, contextLineCount: 3, minimumLineCount: 6, revealLineCount: 10 },
  enableSplitViewResizing: true, accessibilityVerbose: false, renderIndicators: true,
});
const editors = { old: diff.getOriginalEditor(), new: diff.getModifiedEditor() };
const decorations = Object.fromEntries(Object.entries(editors).map(([side, editor]) => [side, editor.createDecorationsCollection()]));

// Monaco 0.55.1 puts native +/- immediately after the numbers. Mirror only
// their rendered positions into reserved space before the numbers. Reading the
// native rows preserves wrapped/deleted view zones and diff/context alignment;
// these decorative signs never become source anchors or intercept clicks.
const changeGutter = document.createElement("div");
changeGutter.className = "review-change-gutter";
changeGutter.setAttribute("aria-hidden", "true");
$("editor").append(changeGutter);
let changeGutterFrame = null;
function renderChangeGutter() {
  changeGutterFrame = null;
  const bounds = $("editor").getBoundingClientRect();
  const fragment = document.createDocumentFragment();
  for (const editor of Object.values(editors)) {
    const dom = editor.getDomNode();
    if (dom && !dom.classList.contains("review-number-gutter-editor")) dom.classList.add("review-number-gutter-editor");
  }
  for (const side of activeLayout === "split" ? ["old", "new"] : ["new"]) {
    const editor = editors[side];
    const dom = editor.getDomNode();
    const numberEditor = activeLayout === "split" ? editor : editors.old;
    const numberDom = numberEditor.getDomNode();
    if (!dom || !numberDom) continue;
    const numberBounds = numberDom.getBoundingClientRect();
    const layout = numberEditor.getLayoutInfo();
    const left = numberBounds.left - bounds.left + layout.lineNumbersLeft + 2;
    for (const native of dom.querySelectorAll(".insert-sign, .delete-sign")) {
      // Do not modify the signs of a nested native Peek editor.
      if (native.closest(".monaco-editor") !== dom) continue;
      const rect = native.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.bottom <= bounds.top || rect.top >= bounds.bottom) continue;
      const sign = document.createElement("span");
      const added = native.classList.contains("insert-sign");
      sign.className = `review-diff-sign ${added ? "added" : "removed"}`;
      sign.dataset.side = added ? "new" : "old";
      sign.textContent = added ? "+" : "−";
      sign.style.cssText = `left:${left}px;top:${rect.top - bounds.top}px;height:${rect.height}px`;
      fragment.append(sign);
    }
  }
  changeGutter.replaceChildren(fragment);
}
function scheduleChangeGutter() {
  if (changeGutterFrame === null) changeGutterFrame = requestAnimationFrame(renderChangeGutter);
}
// The overlay is outside the observed Monaco subtree: no observer feedback loop.
const changeGutterObserver = new MutationObserver(scheduleChangeGutter);
changeGutterObserver.observe($("editor").querySelector(".monaco-diff-editor"), { childList: true, subtree: true, attributes: true });
const changeGutterResize = new ResizeObserver(scheduleChangeGutter);
changeGutterResize.observe($("editor"));
diff.onDidDispose(() => {
  changeGutterObserver.disconnect(); changeGutterResize.disconnect();
  if (changeGutterFrame !== null) cancelAnimationFrame(changeGutterFrame);
  changeGutter.remove();
});

function clearMarkers() {
  for (const { editor, widget } of markerWidgets) editor.removeGlyphMarginWidget(widget);
  markerWidgets = [];
}
function addMarker(group, kind) {
  const editor = editors[group.side];
  const isConversation = kind === "conversation";
  const entries = isConversation ? group.conversations : group.findings;
  const priority = highestPriority(group.findings);
  const label = isConversation
    ? `${entries.length === 1 ? "Open conversation" : `Open ${entries.length} conversations`} at ${selectedFile.path}:${group.line} (${group.side})`
    : `${priority} finding${entries.length > 1 ? `s (${entries.length})` : ""}: ${entries.map(f => f.message).join("; ")}`;
  const node = document.createElement("div");
  const badge = button(isConversation ? "" : priority, () => {
    activityFilter = isConversation ? { threads: entries } : { findings: entries };
    renderActivity(); $("activity-panel").hidden = false; $("close-activity").focus();
  });
  badge.className = `review-badge ${isConversation ? "conversation-badge" : `finding-badge ${priority.toLowerCase()}`}`;
  badge.setAttribute("aria-label", label); badge.title = label;
  badge.dataset.side = group.side; badge.dataset.line = String(group.line);
  if (isConversation) {
    badge.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 3h14v10H8l-5 4V3Z" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
    if (entries.length > 1) { const count = document.createElement("span"); count.className = "badge-count"; count.textContent = String(entries.length); badge.append(count); }
  }
  node.append(badge);
  // Do not move the editor caret or open the comment composer when using a badge.
  badge.addEventListener("mousedown", event => event.stopPropagation());
  badge.addEventListener("mouseup", event => event.stopPropagation());
  const widget = {
    getId: () => `review-${group.side}-${group.line}-${kind}`,
    getDomNode: () => node,
    getPosition: () => ({ range: new monaco.Range(group.line, 1, group.line, 1), lane: isConversation ? monaco.editor.GlyphMarginLane.Center : monaco.editor.GlyphMarginLane.Right, zIndex: 20 }),
  };
  editor.addGlyphMarginWidget(widget);
  // Monaco's gutter is decorative by default; these widgets are real buttons.
  // Line-number overlays retain their own aria-hidden attribute.
  node.closest(".margin")?.removeAttribute("aria-hidden");
  markerWidgets.push({ editor, widget, badge, side: group.side, line: group.line });
}
function syncMarkers() {
  for (const { editor, badge, side, line } of markerWidgets) {
    // Monaco maps hidden source positions to a neighbouring screen row. Never
    // let that make a badge look like it belongs to the neighbouring source.
    badge.hidden = (side === "old" && activeLayout === "unified") || !editor.getVisibleRanges().some(range => range.startLineNumber <= line && range.endLineNumber >= line);
  }
}
function clearContextControls() {
  for (const id of contextZones) editors.new.changeViewZones(accessor => accessor.removeZone(id));
  contextZones = []; contextSignature = "";
}
function renderContextControls() {
  contextFrame = null;
  syncMarkers();
  const state = diff.saveViewState();
  const ranges = state?.modelState?.collapsedRegions?.map(r => r.range);
  if (!ranges?.length) return;
  if (!contextDefaults.has(selectedFile.path)) contextDefaults.set(selectedFile.path, structuredClone(ranges));
  const defaults = contextDefaults.get(selectedFile.path);
  if (defaults.length !== ranges.length) return;
  const expanded = ranges.flatMap((range, i) => range[1] - range[0] < defaults[i][1] - defaults[i][0] ? [i] : []);
  const signature = `${selectedFile.path}:${expanded.join(",")}`;
  if (signature === contextSignature) return;
  clearContextControls(); contextSignature = signature;
  for (const index of expanded) {
    const [start, end] = defaults[index];
    const node = document.createElement("div"); node.className = "context-collapse-zone";
    node.append(button(`▴ Collapse unchanged lines ${start}–${end - 1}`, () => {
      const next = collapsedRegionState(diff.saveViewState(), defaults, index);
      if (!next) return status("This Monaco version's folding state is unsupported; use Collapse unchanged.");
      diff.restoreViewState(next); scheduleContextControls();
    }));
    editors.new.changeViewZones(accessor => contextZones.push(accessor.addZone({ afterLineNumber: start - 1, heightInPx: 28, domNode: node, showInHiddenAreas: true, suppressMouseDown: false })));
    node.parentElement?.removeAttribute("aria-hidden");
  }
}
function scheduleContextControls() {
  if (contextFrame === null) contextFrame = requestAnimationFrame(renderContextControls);
}
diff.onDidUpdateDiff(scheduleContextControls);
for (const editor of Object.values(editors)) {
  editor.onDidChangeHiddenAreas(scheduleContextControls);
  editor.onDidScrollChange(scheduleContextControls);
}

// In unified mode Monaco renders deleted lines as DOM view zones, not as an
// original-editor selection. Never reuse a previous after-side selection for
// a comment/question on that text. A production adapter must map these zones;
// this prototype explicitly requires Split for selecting before-side code.
$("editor").addEventListener("pointerdown", event => {
  if (activeLayout !== "unified" || !event.target.closest(".line-delete-selectable")) return;
  currentAnchor = null;
  $("selection").textContent = "Before code · use Split to select";
  status("Switch Layout to Split to comment, ask, or open source for deleted code. Unified before-side selection is not adapted yet.");
}, true);

function capture(side) {
  const selection = editors[side].getSelection();
  if (!selection || !selectedFile[side]) { currentAnchor = null; $("selection").textContent = "Click a line or select code"; return; }
  activeSide = side;
  try {
    currentAnchor = sourceAnchor(selectedFile, side, selection);
    currentSelectionIsQuote = !selection.isEmpty();
    $("selection").textContent = `${side === "old" ? "Before" : "After"} · ${currentAnchor.line}${currentAnchor.endLine > currentAnchor.line ? `–${currentAnchor.endLine}` : ""}`;
  } catch (error) { currentAnchor = null; status(error.message); }
}
for (const [side, editor] of Object.entries(editors)) {
  editor.onDidChangeCursorSelection(() => capture(side));
  editor.onDidFocusEditorText(() => capture(side));
  editor.onMouseDown(event => {
    if (event.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && event.target.position && event.target.element?.closest(".comment-glyph")) {
      editor.setPosition(event.target.position); capture(side); openComposer("comment");
    }
  });
  for (const [name, label] of [["comment", "Comment on selection"], ["ask", "Ask agent about selection"], ["source", "View source"], ["peek", "Peek symbol"]]) {
    editor.addAction({ id: `diff-lab.${side}.${name}`, label, contextMenuGroupId: "review", contextMenuOrder: 1, run: () => { capture(side); $(name).click(); } });
  }
}
function clearZones() {
  for (const [editor, id, dispose] of zones) { dispose?.(); editor.changeViewZones(accessor => accessor.removeZone(id)); }
  zones = []; composer = null;
}
function zone(side, line, domNode, heightInPx, sizeToContent = null) {
  const unifiedOld = side === "old" && activeLayout === "unified";
  const editor = editors[unifiedOld ? "new" : side];
  if (unifiedOld) {
    let delta = 0;
    for (const change of diff.getLineChanges() || []) {
      if (line < change.originalStartLineNumber) break;
      if (line <= change.originalEndLineNumber) { line = Math.max(1, change.modifiedEndLineNumber || change.modifiedStartLineNumber); delta = 0; break; }
      delta = (change.modifiedEndLineNumber || change.modifiedStartLineNumber) - (change.originalEndLineNumber || change.originalStartLineNumber);
    }
    line += delta;
  }
  let id, observer;
  const descriptor = { afterLineNumber: line, heightInPx, domNode, suppressMouseDown: false };
  editor.changeViewZones(accessor => { id = accessor.addZone(descriptor); });
  if (sizeToContent) {
    // Measure the inner content, not Monaco's explicitly-sized outer zone.
    // This also tracks narrower Split panes, wrapping and font/viewport changes.
    observer = new ResizeObserver(() => {
      if (!sizeToContent.isConnected || sizeToContent.getBoundingClientRect().width === 0) return;
      const height = Math.ceil(sizeToContent.getBoundingClientRect().height) + 18;
      if (descriptor.heightInPx === height) return;
      descriptor.heightInPx = height;
      editor.changeViewZones(accessor => accessor.layoutZone(id));
    });
    observer.observe(sizeToContent);
  }
  // Monaco hides its view-zone container from assistive tech by default. Our
  // zones contain real review forms, not decorative spacers.
  domNode.parentElement?.removeAttribute("aria-hidden");
  zones.push([editor, id, () => observer?.disconnect()]);
  const remove = () => {
    observer?.disconnect();
    editor.changeViewZones(accessor => accessor.removeZone(id));
    zones = zones.filter(entry => entry[1] !== id || entry[0] !== editor);
  };
  remove.reveal = () => editor.revealLineInCenter(line, monaco.editor.ScrollType.Immediate);
  return remove;
}
function button(text, callback) {
  const node = document.createElement("button"); node.type = "button"; node.textContent = text;
  node.addEventListener("click", () => guard(callback)); return node;
}
function quotedCode(description) {
  const quote = document.createElement("figure"); quote.className = "review-quote";
  const caption = document.createElement("figcaption");
  caption.textContent = `Quoted code · ${description.quoteLines} ${description.quoteLines === 1 ? "line" : "lines"}`;
  const code = document.createElement("pre"); code.textContent = description.quote;
  code.tabIndex = 0; code.setAttribute("aria-label", "Quoted code");
  quote.append(caption, code); return quote;
}
function drawAnnotations() {
  // Don't destroy a draft when the shared review receives an update.
  if (composer) return;
  clearZones();
  clearMarkers();
  const markers = reviewMarkers(selectedFile, session);
  for (const side of ["old", "new"]) {
    const entries = session.comments.filter(c => c.path === selectedFile.path && c.side === side);
    const findings = (session.outline?.findings || []).filter(f => f.path === selectedFile.path && f.side === side);
    decorations[side].set([
      ...entries.map(c => ({ range: new monaco.Range(c.line, 1, c.endLine || c.line, 1), options: { isWholeLine: true, className: "review-highlight", glyphMarginClassName: "comment-glyph", glyphMargin: { position: monaco.editor.GlyphMarginLane.Left }, glyphMarginHoverMessage: { value: "Review comment. Click to discuss this line." } } })),
      ...findings.map(f => ({ range: new monaco.Range(f.line, 1, f.line, 1), options: { isWholeLine: true, className: "finding-highlight" } })),
    ]);
    for (const entry of entries) {
      const node = document.createElement("div"); node.className = "review-zone";
      node.dataset.commentId = entry.id;
      const content = document.createElement("div"); content.className = "review-card-content";
      const description = commentDescription(entry);
      const label = document.createElement("small"); label.textContent = `${description.kind} · ${description.location}`;
      const text = document.createElement("p"); text.className = "review-comment-body"; text.textContent = entry.body;
      const actions = document.createElement("div"); actions.className = "review-comment-actions";
      actions.append(button("Edit", () => { currentAnchor = { path: entry.path, side: entry.side, line: entry.line, endLine: entry.endLine || entry.line, selectedText: entry.selectedText || "", context: entry.context || "" }; openComposer("comment", entry); }), button("Delete", async () => {
        if (!confirm("Delete this fixture comment?")) return;
        session = await api(`/api/comments/${entry.id}`, {}, "DELETE"); await refresh();
      }));
      content.append(label);
      if (description.quote) content.append(quotedCode(description));
      content.append(text, actions); node.append(content);
      zone(side, entry.endLine || entry.line, node, 100, content);
    }
  }
  for (const group of markers) {
    if (group.conversations.length) addMarker(group, "conversation");
    if (group.findings.length) addMarker(group, "finding");
  }
  scheduleContextControls();
  renderActivity();
}
function openComposer(kind, existing = null) {
  if (!currentAnchor) { status("Select a source line or range first."); return; }
  if (composer) composer();
  const anchor = structuredClone(currentAnchor);
  const isQuote = existing ? Boolean(commentDescription(existing).quote) : currentSelectionIsQuote;
  const node = document.createElement("form"); node.className = "review-zone";
  const label = document.createElement("strong"); label.textContent = `${kind === "ask" ? "Ask agent (fixture responder)" : isQuote ? "Quote comment" : "Line comment"} · ${commentDescription(anchor).location}`;
  const input = document.createElement("textarea"); input.required = true; input.value = existing?.body || ""; input.setAttribute("aria-label", kind === "ask" ? "Agent question" : "Comment text");
  const quote = document.createElement("small"); quote.textContent = anchor.selectedText.slice(0, 120);
  const submit = document.createElement("button"); submit.type = "submit"; submit.textContent = kind === "ask" ? "Send question" : existing ? "Save comment" : "Add comment";
  const remove = zone(anchor.side, anchor.endLine, node, 158);
  const close = () => { remove(); composer = null; drawAnnotations(); };
  composer = close;
  node.append(label, quote, input, submit, button("Cancel", close));
  input.addEventListener("keydown", event => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); node.requestSubmit(); } });
  node.addEventListener("submit", event => {
    event.preventDefault(); submit.disabled = true;
    guard(async () => {
      try {
        const body = input.value.trim();
        if (!body) return;
        if (kind === "ask") {
          session = await api("/api/agent/message", { body, selectedContext: anchor.selectedText, stepId: null, anchor });
          activityFilter = null;
        } else {
          session = existing ? await api(`/api/comments/${existing.id}`, { body }, "PATCH") : await api("/api/comments", commentSubmission(anchor, body, isQuote));
        }
        close(); await refresh();
        if (kind === "ask") $("activity-panel").hidden = false;
        status(kind === "ask" ? "Question travelled through the production review pipeline. Reply is fixture-generated." : "Saved through the real review API; visible in both panes.");
      } finally { submit.disabled = false; }
    });
  });
  // Off-screen Monaco zones have display:none; DOM scrollIntoView cannot reveal
  // them. Scroll the editor to the anchor before focusing its inline form.
  requestAnimationFrame(() => { remove.reveal(); requestAnimationFrame(() => input.focus({ preventScroll: true })); });
}
function reveal(side, line, endLine = line) {
  // Built-in reveal expands hidden regions. No private Monaco APIs.
  const editor = editors[side];
  editor.setSelection(new monaco.Range(line, 1, endLine, editor.getModel().getLineMaxColumn(endLine)));
  editor.revealLinesInCenter(line, endLine); editor.focus(); capture(side);
}
async function refresh() {
  session = await api("/api/session"); drawAnnotations(); renderActivity();
  await frameReady; await current().refresh();
}
function renderActivity() {
  $("count").textContent = String(session.comments.length + session.messages.filter(m => m.role === "user").length);
  $("activity-list").replaceChildren();
  $("activity-title").textContent = activityFilter?.threads ? "Selected-code conversations" : activityFilter?.findings ? "Findings" : "Review activity";
  $("all-activity").hidden = !activityFilter;
  const messages = activityFilter?.threads ? activityFilter.threads.flatMap(t => t.messages) : session.messages;
  const items = activityFilter?.findings
    ? activityFilter.findings.map(f => ({ ...f, body: f.message, kind: `${f.priority} finding` }))
    : [...(activityFilter ? [] : session.comments.map(c => ({ ...c, kind: "Comment" }))), ...messages.map(m => ({ ...m, ...m.anchor, kind: m.role === "user" ? "Question" : "Fixture response" }))];
  for (const item of items) {
    const card = document.createElement("article"); card.className = "activity-entry";
    const label = document.createElement("small"); label.textContent = `${item.kind}${item.path ? ` · ${item.path}:${item.line} (${item.side})` : ""}`;
    const body = document.createElement("div"); body.textContent = item.body;
    card.append(label);
    if (item.kind === "Comment") {
      const description = commentDescription(item);
      label.textContent = `${description.kind} · ${item.path} · ${description.location}`;
      if (description.quote) card.append(quotedCode(description));
    }
    card.append(body);
    if (item.path) card.append(button("Reveal in both panes", async () => {
      if (selectedFile.path !== item.path) { $("file").value = item.path; await loadFile(); }
      reveal(item.side, item.line, item.endLine || item.line);
      await current().reveal(item.path, item.side, item.line);
      $("activity-panel").hidden = true;
    }));
    $("activity-list").append(card);
  }
}
async function loadFile() {
  if (composer && !confirm("Discard the open prototype draft?")) { $("file").value = selectedFile.path; return; }
  const ticket = ++generation;
  sideViews.set(selectedFile.path, diff.saveViewState());
  clearZones();
  clearMarkers(); clearContextControls();
  selectedFile = info.files.find(f => f.path === $("file").value);
  currentAnchor = null;
  $("selection").textContent = "Click a line or select code";
  $("source-pane").hidden = true;
  sourceEditor?.dispose(); sourceModel?.dispose(); sourceEditor = null; sourceModel = null;
  diff.setModel(null); editorModels.forEach(model => model.dispose());
  editorModels = ["old", "new"].map(side => monaco.editor.createModel(selectedFile[side], selectedFile.language, monaco.Uri.parse(`inmemory://fixture/${ticket}/${side}/${selectedFile.path}`)));
  diff.setModel({ original: editorModels[0], modified: editorModels[1] });
  // Reserve the sign lane even when line numbers grow to four or more digits.
  diff.updateOptions({ lineNumbersMinChars: Math.max(3, ...editorModels.map(model => String(model.getLineCount()).length)) + 3 });
  if (sideViews.get(selectedFile.path)) diff.restoreViewState(sideViews.get(selectedFile.path));
  drawAnnotations();
  await frameReady;
  if (ticket !== generation) return;
  await current().show(selectedFile.path, $("layout").value, $("wrap").checked);
  status(`${selectedFile.path} · Both panes use the same committed revisions · Read-only`);
}
$("file").addEventListener("change", () => guard(loadFile));
$("layout").addEventListener("change", () => guard(async () => {
  if (composer) { status("Finish or cancel the draft before switching layout."); $("layout").value = activeLayout; return; }
  activeLayout = $("layout").value;
  diff.updateOptions({ renderSideBySide: activeLayout === "split" });
  drawAnnotations();
  await current().show(selectedFile.path, $("layout").value, $("wrap").checked);
}));
$("wrap").addEventListener("change", () => guard(async () => {
  const value = $("wrap").checked ? "on" : "off";
  diff.updateOptions({ wordWrap: value, diffWordWrap: value });
  await current().show(selectedFile.path, $("layout").value, $("wrap").checked);
}));
$("theme").onclick = () => { light = !light; document.documentElement.toggleAttribute("data-light", light); monaco.editor.setTheme(light ? "vs" : "diff-lab"); current().theme(light); $("theme").textContent = light ? "Dark theme" : "Light theme"; };
for (const name of ["comment", "ask"]) $(name).onclick = () => openComposer(name);
$("copy").onclick = () => guard(async () => { if (!currentAnchor) throw new Error("Select code first"); await navigator.clipboard.writeText(editors[activeSide].getModel().getValueInRange(editors[activeSide].getSelection()) || currentAnchor.content); status("Copied selected code"); });
$("peek").onclick = () => guard(async () => {
  if (!currentAnchor) throw new Error("Select a symbol first");
  const editor = editors[activeSide];
  const symbol = editor.getModel().getWordAtPosition(editor.getPosition())?.word;
  if (!symbol) throw new Error("Place the cursor on a symbol");
  await current().peek(symbol, selectedFile.path, currentAnchor.line, activeSide);
  status("Symbol Peek opened in the current pane using the existing resolver. This adapter is not migrated yet.");
});
$("source").onclick = () => {
  if (!currentAnchor) return status("Select a line first");
  viewState = diff.saveViewState();
  $("source-pane").hidden = false;
  $("source-title").textContent = `${selectedFile.path} · ${activeSide === "old" ? "Before" : "After"} source`;
  sourceEditor?.dispose(); sourceModel?.dispose();
  sourceModel = monaco.editor.createModel(selectedFile[activeSide], selectedFile.language);
  sourceEditor = monaco.editor.create($("source-editor"), { model: sourceModel, readOnly: true, automaticLayout: true, ariaLabel: `${activeSide === "old" ? "Before" : "After"} full source`, minimap: { enabled: false }, fontSize: 12, lineHeight: 20, folding: true, showFoldingControls: "always", scrollBeyondLastLine: false });
  sourceEditor.setSelection(new monaco.Range(currentAnchor.line, 1, currentAnchor.endLine, sourceModel.getLineMaxColumn(currentAnchor.endLine)));
  sourceEditor.revealLinesInCenter(currentAnchor.line, currentAnchor.endLine);
};
$("return").onclick = () => { $("source-pane").hidden = true; sourceEditor?.dispose(); sourceModel?.dispose(); sourceEditor = null; sourceModel = null; diff.restoreViewState(viewState); editors[activeSide].focus(); };
$("collapse").onclick = () => guard(() => { editors.new.focus(); editors.new.trigger("diff-lab", "diffEditor.collapseAllUnchangedRegions", {}); });
$("expand").onclick = () => guard(() => { editors.new.focus(); editors.new.trigger("diff-lab", "diffEditor.showAllUnchangedRegions", {}); });
$("finding").onclick = () => guard(async () => {
  $("file").value = "checkout.ts"; if (selectedFile.path !== "checkout.ts") await loadFile();
  reveal("new", info.receiptLine + 1);
  await current().reveal("checkout.ts", "new", info.receiptLine + 1);
  status("P2 fixture finding: check rounding at the display boundary.");
});
$("hidden").onclick = () => guard(async () => {
  $("file").value = "checkout.ts"; if (selectedFile.path !== "checkout.ts") await loadFile();
  reveal("new", 55); await current().reveal("checkout.ts", "new", 55);
  status("Revealed line 55 inside unchanged context; other gaps remain collapsed in Monaco.");
});
for (const name of ["current", "prototype"]) $("focus-" + name).onclick = () => {
  const focused = $("comparison").dataset.focus === name;
  $("comparison").dataset.focus = focused ? "" : name;
  $("focus-" + name).textContent = focused ? "Expand" : "Side by side";
  $("focus-" + name).setAttribute("aria-pressed", String(!focused));
};
$("activity").onclick = () => { activityFilter = null; $("activity-panel").hidden = !$("activity-panel").hidden; guard(refresh); };
$("all-activity").onclick = () => { activityFilter = null; renderActivity(); };
$("close-activity").onclick = () => { $("activity-panel").hidden = true; };
await loadFile();
setInterval(() => guard(async () => { const next = await api("/api/session"); if (next.revision !== session.revision) { session = next; drawAnnotations(); renderActivity(); } }), 1800);
// Prototype diagnostics only; enables repeatable browser regression checks.
window.diffLab = { diff, editors, reveal, get anchor() { return currentAnchor; }, get file() { return selectedFile; }, get session() { return session; }, refresh };
