import { sourceAnchor, freeTextRange, suggestedEditTarget, suggestedEditLanguage, suggestionMatchesSource } from "./source-anchor.mjs";
import { installSyntaxThemes } from "/monaco/themes.mjs";
import { installContextMenuViewport } from "./context-menu.mjs";
import { syntaxThemes } from "/monaco/theme-data.mjs";
import { installDeletedSelection } from "./deleted-selection.mjs";
import { installPenScroll, installPeekPenScroll } from "./pen-scroll.mjs";
import { installDeletedAnnotations, sourceLineHidden, hiddenCommentCounts, hiddenQuestions, badgeDisplayRow } from "./deleted-annotations.mjs";
import { installTourAnnotations, fileStatusLabel, fileChangeCounts, gutterRowGradient, configureReferenceActions } from "./annotations.mjs";
import { reviewMarkers, highestPriority, collapsedRegionState, unchangedContextState, expandedRegionState, commentDescription, commentSubmission } from "./annotations.mjs";

const $ = id => document.getElementById(id);
const token = new URLSearchParams(location.hash.slice(1)).get("token");
let sourceComparisonId;
let disposed = false;
async function api(path, body, method = "POST") {
  const response = await fetch(path, { method: body === undefined ? "GET" : method, headers: { "x-diffcompass-token": token, ...(body === undefined ? {} : { "content-type": "application/json", ...(sourceComparisonId ? { "x-diffcompass-comparison": sourceComparisonId } : {}) }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
const embedded = new URLSearchParams(location.search).get("embedded") === "1";
const production = new URLSearchParams(location.search).get("production") === "1";
const filePath = production ? new URLSearchParams(location.search).get("file") : null;
const host = embedded && window.parent !== window && window.parent.location.origin === location.origin ? (production ? window.parent.diffCompassProductionHost.forFile(filePath, window) : window.parent.diffCompassMonacoHost) : null;
if (embedded && !host) throw new Error("The integration host is unavailable.");
if (host) document.documentElement.dataset.embedded = "true";
if (host?.singleFile) document.documentElement.dataset.singleFile = "true";
for (const type of ["wheel", "pointerdown", "keydown"]) document.addEventListener(type, () => host?.userInteraction?.(), { capture: true, passive: true });
// Capture before Monaco treats an unmodified letter as an edit in its read-only
// textarea. Real composers, find inputs, menus and IME keep their own keys.
document.addEventListener("keydown", event => {
  if (!host?.tourShortcut || event.defaultPrevented || event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
  if (!["j", "k"].includes(event.key)) return;
  const target = event.target;
  if (target.closest?.("input, select, [contenteditable='true'], [role='menu'], .monaco-menu, .find-widget")) return;
  if (target.closest?.("textarea, [role='textbox']") && !target.matches?.("textarea.inputarea, .native-edit-context")) return;
  if (document.querySelector(".context-view .monaco-menu, form.review-zone, dialog[open]")) return;
  if (host.tourShortcut(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); }
}, true);
const info = await api(production ? "/api/diff/sources" : "/api/prototype");
if (filePath) info.files = info.files.filter(file => file.path === filePath);
sourceComparisonId = info.comparisonId;
if (info.pullRequestFixture) document.querySelector(".notice").textContent = "Synthetic pull request · Read-only sample GitHub threads · Replies, resolving and publication are disabled · No GitHub connection";
let session = await api("/api/session");
if (production && !host.acceptComparison(session)) throw Error("The comparison changed while mounting Monaco.");
// Reuse Git's authoritative status from the existing session. Empty source is
// not proof of addition/deletion (an existing empty file can be modified).
for (const file of info.files) file.status = session.comparison.files.find(change => change.path === file.path)?.status;
let selectedFile = info.files[0], activeLayout = "unified", light = false;
let reviewPending = null, activityFilter = null;
const fileViews = new Map();
const commentPreference = "diffcompass-monaco-inline-comments";
let commentsVisible = true;
try { commentsVisible = localStorage.getItem(commentPreference) !== "hidden"; } catch { /* Session-only if storage is unavailable. */ }
const commentsToggle = button("Hide comments", () => setCommentsVisible(!commentsVisible));
commentsToggle.id = "prototype-comments-toggle";
$("focus-prototype").before(commentsToggle);
function commentVisibilityState() { return { visible: commentsVisible, hasDraft: [...fileViews.values()].some(view => view.hasDraft) }; }
function updateCommentControls() {
  const state = commentVisibilityState();
  commentsToggle.textContent = state.visible ? "Hide comments" : "Show comments";
  commentsToggle.setAttribute("aria-pressed", String(state.visible));
  commentsToggle.disabled = state.hasDraft;
  commentsToggle.title = state.hasDraft ? "Save or cancel the draft before hiding comments" : "Show or hide local comments and pull request threads; gutter markers remain available";
  host?.commentsChanged?.(state);
}
function setCommentsVisible(visible) {
  if (!visible && commentVisibilityState().hasDraft) return false;
  if (commentsVisible !== visible) {
    commentsVisible = visible;
    try { localStorage.setItem(commentPreference, visible ? "shown" : "hidden"); } catch { /* Session-only. */ }
    for (const view of fileViews.values()) view.render();
  }
  updateCommentControls();
  return true;
}
let activeView = null, navigationGeneration = 0;
let statusRevision = 0;
const status = text => { if (!disposed && $("status")) $("status").textContent = text; return ++statusRevision; };
const guard = task => Promise.resolve().then(task).catch(error => status(error.message));
const frameReady = host ? Promise.resolve() : new Promise(resolve => window.addEventListener("message", function listener(event) {
  if (event.origin === location.origin && event.source === $("current").contentWindow && event.data?.type === "diff-lab-ready") {
    window.removeEventListener("message", listener); resolve();
  }
}));
if (!host) $("current").src = `/current#token=${encodeURIComponent(token)}`;
const current = () => host || $("current").contentWindow.diffLabCurrent;
for (const file of info.files) $("file").add(new Option(file.path, file.path));
const collapsedFiles = new Set(session.reviewedFiles || []);
let previousReviewed = new Set(session.reviewedFiles || []);
const fileEntries = new Map(), detailTemplate = $("file-detail");
let embeddedHeightFrame = null;
let embeddedHeightCandidate = null, embeddedHeightStableFrames = 0;
function scheduleEmbeddedHeight() {
  if (disposed || !host || embeddedHeightFrame !== null) return;
  embeddedHeightFrame = requestAnimationFrame(() => {
    embeddedHeightFrame = null;
    const visible = [...fileEntries.values()].filter(entry => !entry.section.hidden);
    // A new iframe first contains an empty, viewport-relative template, then
    // uncomputed full-file models. Neither is a valid card height. Keep the
    // host's measured placeholder until the diff and restored folds are ready.
    if (host.singleFile && visible.some(entry => !entry.body.hidden && !entry.layoutReady)) return;
    document.documentElement.toggleAttribute("data-files-collapsed", visible.every(entry => entry.body.hidden));
    const height = visible.reduce((sum, entry) => sum + entry.section.getBoundingClientRect().height, 0) + $("status").offsetHeight;
    if (host.singleFile) {
      if (height !== embeddedHeightCandidate) { embeddedHeightCandidate = height; embeddedHeightStableFrames = 0; }
      if (embeddedHeightStableFrames++ < 2) { scheduleEmbeddedHeight(); return; }
    }
    host.contentSizeChanged(height);
  });
}
detailTemplate.remove();
for (const [index, file] of info.files.entries()) {
  const section = document.createElement("section"); section.className = "prototype-file"; section.dataset.prototypeFile = file.path;
  const heading = document.createElement("header"); heading.className = "prototype-file-heading";
  const toggle = button(file.path, async () => {
    activateFile(file.path);
    setFileCollapsed(file.path, !collapsedFiles.has(file.path));
    await frameReady; current().setCollapsed(file.path, collapsedFiles.has(file.path));
  });
  toggle.dataset.fileToggle = file.path;
  const review = button("Mark as reviewed", () => setFileReviewed(file.path));
  review.dataset.reviewPath = file.path;
  const body = document.createElement("div"); body.className = "prototype-file-body"; body.id = `prototype-file-${index}`; body.hidden = true;
  toggle.setAttribute("aria-controls", body.id);
  heading.append(toggle, review); section.append(heading, body);
  const detail = detailTemplate.cloneNode(true);
  for (const node of [detail, ...detail.querySelectorAll("[id]")]) {
    node.dataset.control = node.id; node.removeAttribute("id");
  }
  body.append(detail);
  fileEntries.set(file.path, { file, section, toggle, review, body, detail, visibilityGeneration: 0 }); $("file-list").append(section);
}
function renderFileVisibility() {
  for (const [path, {file, toggle, body}] of fileEntries) {
    const expanded = !collapsedFiles.has(path);
    const badge = document.createElement("span"); badge.className = "prototype-file-status";
    badge.dataset.fileStatus = file.status || "unknown"; badge.textContent = fileStatusLabel(file.status);
    const counts = fileChangeCounts(session.comparison.files.find(change => change.path === path));
    const totals = document.createElement("span"); totals.className = "prototype-file-counts"; totals.id = `${body.id}-counts`;
    if (counts) {
      const added = document.createElement("span"), removed = document.createElement("span");
      added.className = "added"; added.textContent = counts.added;
      removed.className = "removed"; removed.textContent = counts.removed;
      totals.append(added, document.createTextNode(" "), removed);
      totals.setAttribute("aria-label", counts.label);
      toggle.setAttribute("aria-describedby", totals.id);
    } else toggle.removeAttribute("aria-describedby");
    toggle.replaceChildren(document.createTextNode(expanded ? "▾ " : "▸ "), ...(counts ? [totals] : []), badge, document.createTextNode(path));
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute("aria-label", `${expanded ? "Collapse" : "Expand"} ${path}`);
    body.hidden = !expanded;
  }
  scheduleEmbeddedHeight();
}
function activateFile(path) {
  const entry = fileEntries.get(path);
  if (!entry || !fileViews.has(path)) return;
  if (activeView === fileViews.get(path)) return;
  selectedFile = info.files.find(file => file.path === path);
  activeView = fileViews.get(path);
  $("file").value = path;
  // Stable, scoped controls per file; the active IDs are only a diagnostics /
  // keyboard shortcut facade. No editor or model moves when selection changes.
  for (const [otherPath, other] of fileEntries) {
    for (const node of [other.detail, ...other.detail.querySelectorAll("[data-control]")]) {
      if (otherPath === path) node.id = node.dataset.control; else node.removeAttribute("id");
    }
    other.review.id = otherPath === path ? "reviewed" : "";
  }
}
function setFileCollapsed(path, collapsed, restoreView = true) {
  const entry = fileEntries.get(path), view = fileViews.get(path);
  const ticket = ++entry.visibilityGeneration;
  if (!collapsedFiles.has(path) && view) entry.savedView = view.diff.saveViewState();
  if (collapsed) collapsedFiles.add(path); else collapsedFiles.delete(path);
  renderFileVisibility();
  if (!collapsed && view) {
    // Layout synchronously on reveal so the first painted frame has code.
    view.diff.layout();
    if (restoreView && entry.savedView) view.diff.restoreViewState(entry.savedView);
    requestAnimationFrame(() => {
      if (ticket !== entry.visibilityGeneration || collapsedFiles.has(path)) return;
      view.resize();
    });
  }
}
function renderReviewedState() {
  if (disposed) return;
  const reviewedFiles = new Set(session.reviewedFiles || []);
  for (const [path, {review: control}] of fileEntries) {
    const reviewed = reviewedFiles.has(path);
    if (reviewed !== previousReviewed.has(path)) setFileCollapsed(path, reviewed);
    control.id = path === selectedFile?.path ? "reviewed" : "";
    control.textContent = reviewPending === path ? "Saving…" : reviewed ? "✓ Reviewed" : "Mark as reviewed";
    control.setAttribute("aria-pressed", String(reviewed));
    control.disabled = reviewPending !== null || session.status !== "open";
    control.title = session.status !== "open" ? "This review is closed" : `${reviewed ? "Mark as not reviewed" : "Mark as reviewed"}: ${path}`;
    control.setAttribute("aria-label", control.title);
  }
  previousReviewed = reviewedFiles;
  $("file-summary").textContent = `${info.files.length} changed files · ${info.files.filter(f => reviewedFiles.has(f.path)).length} reviewed`;
  for (const option of $("file").options) option.textContent = `${(session.reviewedFiles || []).includes(option.value) ? "✓ " : ""}${option.value}`;
  renderFileVisibility();
}
async function setFileReviewed(path) {
  if (reviewPending !== null || session.status !== "open") return;
  const reviewed = !(session.reviewedFiles || []).includes(path);
  reviewPending = path; renderReviewedState();
  try {
    const next = await api("/api/files/reviewed", { path, reviewed });
    // A poll or another mutation can already have supplied a newer snapshot.
    if (next.revision >= session.revision) session = next;
    renderReviewedState();
    status(`${path} · ${reviewed ? "Marked as reviewed" : "Marked as not reviewed"}`);
    await frameReady;
    await current().refresh();
    // The full host refreshes the same snapshot before its independent view
    // state changes. Do not let that old expansion state undo this action.
    if (host) setFileCollapsed(path, reviewed);
    current().setCollapsed(path, host ? reviewed : collapsedFiles.has(path));
  } finally {
    reviewPending = null; renderReviewedState();
  }
}
// Monaco's pinned distribution resolves its hashed workers beside the local
// bundle. Do not point it at the removed legacy workerMain.js entry point.
window.require.config({ paths: { vs: "/vendor/vs" } });
await new Promise((resolve, reject) => window.require(["vs/editor/editor.main"], resolve, reject));
const monaco = window.monaco;
const disposeContextMenuViewport = installContextMenuViewport(window);
configureReferenceActions(monaco);
const applySyntaxTheme = installSyntaxThemes(monaco, syntaxThemes, document.documentElement);
const appearance = host ? window.parent.document.documentElement : document.documentElement;
light = host ? appearance.dataset.theme === "light" : light;
document.documentElement.toggleAttribute("data-light", light);
applySyntaxTheme(appearance.dataset.syntaxTheme, light);

function button(text, callback) {
  const node = document.createElement("button"); node.type = "button"; node.textContent = text;
  node.addEventListener("click", () => guard(callback)); return node;
}

function createWithOverflowLayer(createEditor) {
  // Review decorations stay isolated inside each file. Menus and hover widgets
  // must escape that stacking context to clear the next file's sticky header.
  // Use Monaco's public overflow host rather than moving its internal menu DOM.
  const layer = document.createElement("div");
  layer.className = "monaco-editor review-editor-overflow";
  document.body.append(layer);
  try {
    const editor = createEditor({ overflowWidgetsDomNode: layer, fixedOverflowWidgets: true });
    editor.onDidDispose(() => layer.remove());
    return editor;
  } catch (error) { layer.remove(); throw error; }
}

function addOwnedAction(editor, descriptor) {
  // addAction registers global commands, menu items and keybindings. Monaco
  // returns their ownership separately from the editor itself.
  const action = editor.addAction(descriptor);
  editor.onDidDispose(() => action.dispose());
}

function quotedCode(description) {
  const quote = document.createElement("figure"); quote.className = "review-quote";
  const caption = document.createElement("figcaption");
  caption.textContent = `Quoted code · ${description.quoteLines} ${description.quoteLines === 1 ? "line" : "lines"}`;
  const code = document.createElement("pre"); code.textContent = description.quote;
  code.tabIndex = 0; code.setAttribute("aria-label", "Quoted code");
  quote.append(caption, code); return quote;
}

async function refresh() {
  const next = await api("/api/session");
  if (disposed) return;
  if (next.revision >= session.revision) session = next;
  for (const view of fileViews.values()) view.render();
  renderActivity(); renderReviewedState();
  await frameReady; await current().refresh();
}
function renderActivity() {
  if (disposed) return;
  $("count").textContent = String(session.comments.length + session.messages.filter(m => m.role === "user").length);
  $("activity-list").replaceChildren();
  $("activity-title").textContent = activityFilter?.threads ? "Selected-code conversations" : activityFilter?.findings ? "Findings" : "Review activity";
  $("all-activity").hidden = !activityFilter;
  const messages = activityFilter?.threads ? activityFilter.threads.flatMap(t => t.messages) : session.messages;
  const items = activityFilter?.findings
    ? activityFilter.findings.map(f => ({ ...f, body: f.message, kind: `${f.priority} finding` }))
    : [...(activityFilter ? [] : session.comments.map(c => ({ ...c, kind: "Comment" }))), ...messages.map(m => ({ ...m, ...m.anchor, kind: m.role === "user" ? "Question" : production ? "Agent response" : "Fixture response" }))];
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
    if (item.path) card.append(button(production ? "Reveal in diff" : "Reveal in both panes", async () => {
      if (production) { await current().reveal(item.path, item.side, item.line); $("activity-panel").hidden = true; return; }
      if (selectedFile.path !== item.path) { $("file").value = item.path; if (!(await loadFile())) return; }
      activeView.reveal(item.side, item.line, item.endLine || item.line);
      await current().reveal(item.path, item.side, item.line);
      $("activity-panel").hidden = true;
    }));
    $("activity-list").append(card);
  }
}

async function loadFile({ expand = true } = {}) {
  const ticket = ++navigationGeneration;
  const path = $("file").value;
  activateFile(path);
  if (expand) setFileCollapsed(path, false);
  await frameReady;
  if (ticket !== navigationGeneration || selectedFile.path !== path) return false;
  await current().show(path, activeLayout, $("wrap").checked);
  if (ticket !== navigationGeneration || selectedFile.path !== path) return false;
  current().setCollapsed(path, collapsedFiles.has(path));
  fileEntries.get(path).section.scrollIntoView({ block: "start" });
  status(`${path} · Both panes use the same committed revisions · Read-only`);
  return true;
}
function createFileView(fileDetail, selectedFile) {
const $ = id => (fileDetail.dataset.control === id ? fileDetail : fileDetail.querySelector(`[data-control="${id}"]`)) || document.getElementById(id);
let currentAnchor = null, activeSide = "new", currentSelectionIsQuote = false;
let currentSourceRange = null, deletedSelection = null, selectionError = "";
let diff, sourceEditor, viewState, sourceModel, editorModels = [], zones = [], composer = null;
let mobileDraft = false, mobilePointer = null, mobileTextSelection = false;
const mobileDecorations = {};
let annotationSignature = null;
let sourceHadAnchor = false, copyPending = false;
let markdownPane = null, markdownPreviewButton = null;
const markdownPreviewOpen = () => Boolean(markdownPane && !markdownPane.hidden);
function closeMarkdownPreview(restoreFocus = false) {
  if (!markdownPreviewOpen()) return;
  markdownPane.hidden = true;
  for (const node of [fileDetail.querySelector(".tools"), fileDetail.querySelector(".context-tools"), $("editor")]) node.inert = false;
  scheduleDetailHeight();
  if (restoreFocus) markdownPreviewButton.focus({ preventScroll: true });
}
let toolFeedbackTimer = null, transientStatusRevision = null, fileToolsDisposed = false;
const toolFeedback = document.createElement("output");
toolFeedback.dataset.control = "tool-feedback"; toolFeedback.className = "file-tools-feedback";
toolFeedback.setAttribute("role", "status"); toolFeedback.hidden = true;
fileDetail.querySelector(".tools").append(toolFeedback);
const fileSourceSide = () => selectedFile.status === "deleted" ? "old" : "new";
function clearFileToolStatus() {
  clearTimeout(toolFeedbackTimer); toolFeedbackTimer = null;
  toolFeedback.hidden = true; toolFeedback.textContent = "";
  // Never clear a newer announcement from another file or action.
  if (statusRevision === transientStatusRevision) status("");
  transientStatusRevision = null;
}
function updateFileTools() {
  clearFileToolStatus();
  const side = currentAnchor?.side || fileSourceSide();
  const revision = side === "old" ? "Before" : "After";
  $("copy").textContent = "Copy contents";
  $("copy").title = `Copy the full captured ${revision} file contents; use Cmd/Ctrl+C for selected text`;
  $("source").title = `View captured ${revision} source${currentAnchor ? ` at line ${currentAnchor.line}` : ""}`;
}
function fileToolStatus(text, temporary = false) {
  if (fileToolsDisposed) return;
  clearFileToolStatus();
  toolFeedback.textContent = text; toolFeedback.hidden = false;
  const revision = status(text);
  if (temporary) {
    transientStatusRevision = revision;
    toolFeedbackTimer = setTimeout(clearFileToolStatus, 2000);
  }
}
function validateFileToolSelection() {
  // An invalid/mixed selection must not silently become a whole-file action.
  if (!deletedSelection.validate() || selectionError) {
    fileToolStatus(selectionError || "Select the source again."); return false;
  }
  return true;
}
const commentCards = new Map(), prCards = new Map(), contextDefaults = new Map();
let markerWidgets = [], contextZones = [], contextSignature = "", contextFrame = null;
fileDetail.addEventListener("pointerdown", () => activateFile(selectedFile.path), { capture: true });
fileDetail.addEventListener("focusin", () => activateFile(selectedFile.path));
const editorSurface = document.createElement("div"); editorSurface.className = "review-editor-surface"; $("editor").append(editorSurface);
diff = createWithOverflowLayer(overflow => monaco.editor.createDiffEditor(editorSurface, {
  ...overflow,
  readOnly: true, originalEditable: false, automaticLayout: true,
  // readOnly alone only rejects edits in Monaco; its hidden input can still
  // summon a tablet keyboard. Use a genuinely readonly DOM textarea, including
  // on browsers with EditContext (which does not honor domReadOnly).
  domReadOnly: true, editContext: false,
  ignoreTrimWhitespace: false,
  renderSideBySide: false, useInlineViewWhenSpaceIsLimited: false,
  minimap: { enabled: false }, fontSize: 12, lineHeight: 20, scrollBeyondLastLine: false,
  // Unified's clipped Before editor still has horizontal overflow. Monaco's
  // automatic scrollbar allowance otherwise gives it a longer scroll range
  // than After, so wheel input over its numbers desynchronizes the bottom.
  // Reserve identical space explicitly, including when only one side scrolls
  // horizontally, and keep the last source line clear of either scrollbar.
  // Let the surrounding file list/page scroll when this editor reaches an edge
  // (or has no scroll range). Monaco must receive this at construction time.
  scrollbar: { horizontalScrollbarSize: 12, ignoreHorizontalScrollbarInContentHeight: true, alwaysConsumeMouseWheel: false },
  padding: { bottom: 12 },
  wordWrap: "on", diffWordWrap: "on", glyphMargin: true,
  // Monaco explicitly disables function folding in diff editors. Do not force
  // it on the inner editors: their hidden ranges can break diff alignment.
  renderOverviewRuler: false, overviewRulerLanes: 0,
  originalAriaLabel: "Before source", modifiedAriaLabel: "After source",
  lineNumbersMinChars: 3, renderValidationDecorations: "off", stickyScroll: { enabled: false },
  hideUnchangedRegions: { enabled: true, contextLineCount: 3, minimumLineCount: 6, revealLineCount: 10 },
  enableSplitViewResizing: true, accessibilityVerbose: false, renderIndicators: true,
}));
const editors = { old: diff.getOriginalEditor(), new: diff.getModifiedEditor() };
if (production) editors.new.updateOptions({ readOnlyMessage: { value: "Use Suggest edit to propose a change without modifying the reviewed source." } });
diff.onDidDispose(() => { fileToolsDisposed = true; clearFileToolStatus(); });
// Short files should not push the following headers below an empty editor.
// Per-file production cards grow with revealed context; the page owns vertical
// scrolling. Only the old multi-file comparison lab uses a bounded editor.
let detailHeightFrame = null;
function scheduleDetailHeight() {
  if (fileToolsDisposed) return;
  if (detailHeightFrame !== null) return;
  detailHeightFrame = requestAnimationFrame(() => {
    detailHeightFrame = null;
    if (fileToolsDisposed) return;
    if (collapsedFiles.has(selectedFile.path)) return;
    const chromeHeight = fileDetail.querySelector(".tools").offsetHeight + fileDetail.querySelector(".context-tools").offsetHeight;
    const contentHeight = Math.max(...Object.values(editors).map(editor => editor.getContentHeight()));
    const limit = host ? host.editorHeightLimit() : Math.max(280, $("file-list").clientHeight - 126);
    let desiredHeight = contentHeight + chromeHeight;
    if (markdownPreviewOpen()) {
      const columns = markdownPane.querySelector(".review-markdown-columns");
      // Measure natural rendered content, not the stretched columns themselves,
      // so a short README does not acquire an otherwise empty full-height card.
      const heights = [...columns.children].map(column => column.querySelector("h2").offsetHeight + column.querySelector(".review-rendered-markdown").scrollHeight + 34);
      desiredHeight = markdownPane.querySelector(".source-heading").offsetHeight + (getComputedStyle(columns).display === "block" ? heights.reduce((sum, height) => sum + height, 0) : Math.max(...heights));
    }
    const height = host?.singleFile ? Math.max(140, desiredHeight) : Math.min(limit, Math.max(140, desiredHeight));
    if (fileDetail.style.height !== `${height}px`) fileDetail.style.height = `${height}px`;
    scheduleEmbeddedHeight();
  });
}
for (const editor of Object.values(editors)) editor.onDidContentSizeChange(scheduleDetailHeight);
const fileListResize = new ResizeObserver(scheduleDetailHeight); fileListResize.observe($("file-list"));
diff.onDidDispose(() => { fileListResize.disconnect(); if (detailHeightFrame !== null) cancelAnimationFrame(detailHeightFrame); });
const beforeAnnotations = installDeletedAnnotations({ root: $("editor"), diff, monaco, unified: () => activeLayout === "unified" });
diff.onDidDispose(() => beforeAnnotations.dispose());
const decorations = Object.fromEntries(Object.entries(editors).map(([side, editor]) => [side, editor.createDecorationsCollection()]));
const tourAnnotations = installTourAnnotations({ file: selectedFile, editors, diff, beforeAnnotations, monaco, root: $("editor"), unified: () => activeLayout === "unified", onLayout: () => host?.viewportChanged?.(), restoreViewState: state => restoreReviewViewState({ diff }, state) });
const tourDisposal = diff.onDidDispose(() => tourAnnotations.dispose());

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
  if (fileToolsDisposed) return;
  const bounds = $("editor").getBoundingClientRect();
  const fragment = document.createDocumentFragment();
  for (const editor of Object.values(editors)) {
    const dom = editor.getDomNode();
    if (dom && !dom.classList.contains("review-number-gutter-editor")) dom.classList.add("review-number-gutter-editor");
  }
  function sourceRows(editor, selector) {
    const dom = editor.getDomNode();
    return [...dom.querySelectorAll(selector)].filter(node => node.closest(".monaco-editor") === dom).flatMap(node => {
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height) return [];
      const background = node.matches(".view-line") ? node.parentElement : node;
      return [{ top: rect.top, bottom: rect.bottom, color: getComputedStyle(background).backgroundColor }];
    });
  }
  const rows = activeLayout === "unified"
    ? sourceRows(editors.new, ".cdr.line-insert, .line-delete-selectable > .view-line")
    : null;
  for (const editor of Object.values(editors)) {
    // Monaco also gives its hidden textarea cover the `margin` class. Paint
    // only the visible number gutter, and clear unified colours in Split.
    const margin = editor.getDomNode().querySelector(":scope > .overflow-guard > .margin:not(.textAreaCover)");
    if (!margin) continue;
    const rect = margin.getBoundingClientRect();
    const paint = rows ? gutterRowGradient(rows, rect.top, rect.height) : "none";
    // Change only when geometry changes; this subtree is mutation-observed.
    if (margin.style.backgroundImage !== paint) margin.style.backgroundImage = paint;
  }
  const paint = rows ? gutterRowGradient(rows, bounds.top, bounds.height) : "none";
  if (changeGutter.style.getPropertyValue("--review-row-colors") !== paint) changeGutter.style.setProperty("--review-row-colors", paint);
  for (const side of activeLayout === "split" ? ["old", "new"] : ["new"]) {
    const editor = editors[side];
    const dom = editor.getDomNode();
    const numberEditor = activeLayout === "split" ? editor : editors.old;
    const numberDom = numberEditor.getDomNode();
    if (!dom || !numberDom) continue;
    const numberBounds = numberDom.getBoundingClientRect();
    const layout = numberEditor.getLayoutInfo();
    const left = activeLayout === "unified" ? "0px" : `${numberBounds.left - bounds.left + layout.lineNumbersLeft + 2}px`;
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
      sign.style.cssText = `left:${left};top:${rect.top - bounds.top}px;height:${rect.height}px`;
      fragment.append(sign);
    }
  }
  changeGutter.replaceChildren(fragment);
}
function scheduleChangeGutter() {
  if (fileToolsDisposed) return;
  if (changeGutterFrame === null) changeGutterFrame = requestAnimationFrame(renderChangeGutter);
}
// The overlay is outside the observed Monaco subtree: no observer feedback loop.
const changeGutterObserver = new MutationObserver(scheduleChangeGutter);
// Before-action accessibility attributes are unrelated to row geometry;
// observing them feeds sign child-list changes back into this projection.
changeGutterObserver.observe($("editor").querySelector(".monaco-diff-editor"), { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "hidden"] });
const changeGutterResize = new ResizeObserver(scheduleChangeGutter);
changeGutterResize.observe($("editor"));
diff.onDidDispose(() => {
  changeGutterObserver.disconnect(); changeGutterResize.disconnect();
  if (changeGutterFrame !== null) cancelAnimationFrame(changeGutterFrame);
  changeGutter.remove();
});

function clearMarkers() {
  for (const { remove } of markerWidgets) remove();
  markerWidgets = [];
}
function addMarker(group, kind) {
  const isConversation = kind === "conversation";
  const entries = isConversation ? group.conversations : group.findings;
  const priority = highestPriority(group.findings);
  const label = isConversation
    ? `${entries.length === 1 ? "Open conversation" : `Open ${entries.length} conversations`} at ${selectedFile.path}:${group.line} (${group.side})`
    : `${priority} finding${entries.length > 1 ? `s (${entries.length})` : ""}: ${entries.map(f => f.message).join("; ")}`;
  const badge = button(isConversation ? "" : priority, () => {
    activityFilter = isConversation ? { threads: entries } : { findings: entries };
    if (host) { isConversation ? host.conversation(entries[0].id) : host.finding(entries[0].id); return; }
    renderActivity(); $("activity-panel").hidden = false; $("close-activity").focus();
  });
  badge.className = `review-badge ${isConversation ? "conversation-badge" : `finding-badge ${priority.toLowerCase()}`}`;
  badge.setAttribute("aria-label", label); badge.title = label;
  badge.dataset.side = group.side; badge.dataset.line = String(group.line);
  if (isConversation) {
    badge.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 3h14v10H8l-5 4V3Z" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
    if (entries.length > 1) { const count = document.createElement("span"); count.className = "badge-count"; count.textContent = String(entries.length); badge.append(count); }
  }
  // Do not move the editor caret or open the comment composer when using a badge.
  badge.addEventListener("mousedown", event => event.stopPropagation());
  badge.addEventListener("mouseup", event => event.stopPropagation());
  const remove = beforeAnnotations.addBadge(badge, group.side, group.line, isConversation ? 1 : 2);
  markerWidgets.push({ remove, badge });
}
function clearContextControls() {
  for (const id of contextZones) editors.new.changeViewZones(accessor => accessor.removeZone(id));
  contextZones = []; contextSignature = "";
}
function renderGapActions(state) {
  const hidden = state?.modelState?.collapsedRegions?.flatMap((region, index) => region.range[1] > region.range[0] ? [{ index, range: region.range }] : []) ?? [];
  for (const [side, editor] of Object.entries(editors)) {
    const gaps = [...editor.getDomNode().querySelectorAll(".diff-hidden-lines")];
    // Monaco 0.55.1 creates one overlay per non-empty hidden region, in source
    // order. Fail closed during a native re-render instead of unfolding a
    // different region. Native controls remain until the overlays settle.
    if (gaps.length !== hidden.length) continue;
    gaps.forEach((gap, index) => {
      const target = hidden[index], [start, end] = target.range;
      const signature = `${start}:${end}`;
      const counts = hiddenCommentCounts(selectedFile, session, activeLayout === "unified" ? "both" : side, target.range, diff.getLineChanges());
      const questions = hiddenQuestions(selectedFile, session, activeLayout === "unified" ? "both" : side, target.range, diff.getLineChanges());
      const contents = `${target.index}:${signature}:${counts.comments}:${counts.threads}:${JSON.stringify(questions.map(thread => thread.id))}`;
      if (gap.dataset.reviewGapContents === contents) return;
      const center = gap.querySelector(".center");
      let actions = center.querySelector(".review-gap-actions");
      if (!actions) { actions = document.createElement("div"); actions.className = "review-gap-actions"; center.append(actions); }
      const expand = () => {
        const current = diff.saveViewState();
        if (current?.modelState?.collapsedRegions?.[target.index]?.range.join(":") !== signature) return false;
        const next = expandedRegionState(current, target.index);
        if (!next) return false;
        diff.restoreViewState(next); scheduleContextControls(); scheduleDetailHeight();
        return true;
      };
      const control = button(`Expand all (${end - start})`, expand);
      control.dataset.gapAction = "all";
      control.title = control.ariaLabel = `Expand all ${end - start} hidden lines · lines ${start}–${end - 1}`;
      control.addEventListener("mousedown", event => event.stopPropagation());
      actions.replaceChildren(control);
      if (counts.comments || counts.threads) {
        const description = [counts.comments && `${counts.comments} comment${counts.comments === 1 ? "" : "s"}`, counts.threads && `${counts.threads} thread${counts.threads === 1 ? "" : "s"}`].filter(Boolean).join(" · ");
        const comments = button(description, () => { if (expand()) setCommentsVisible(true); });
        comments.className = "review-gap-comments"; comments.dataset.gapAction = "comments";
        comments.title = comments.ariaLabel = `Show ${description} in hidden lines ${start}–${end - 1}`;
        comments.addEventListener("mousedown", event => event.stopPropagation());
        actions.append(comments);
      }
      if (questions.length) {
        const description = `${questions.length} question${questions.length === 1 ? "" : "s"}`;
        const questionsButton = button(description, () => {
          if (!expand()) return;
          if (host) host.conversation(questions[0].id);
          else { activityFilter = { threads: questions }; renderActivity(); $("activity-panel").hidden = false; $("close-activity").focus(); }
        });
        questionsButton.className = "review-gap-questions"; questionsButton.dataset.gapAction = "questions";
        questionsButton.title = questionsButton.ariaLabel = `Show ${description} in hidden lines ${start}–${end - 1}`;
        questionsButton.addEventListener("mousedown", event => event.stopPropagation());
        actions.append(questionsButton);
      }
      gap.dataset.reviewGap = signature;
      gap.dataset.reviewGapContents = contents;
    });
  }
}
const gapObserver = new MutationObserver(records => {
  if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1 && (node.matches(".diff-hidden-lines-widget") || node.querySelector(".diff-hidden-lines-widget"))))) scheduleContextControls();
});
gapObserver.observe($("editor"), { childList: true, subtree: true });
diff.onDidDispose(() => gapObserver.disconnect());
function renderContextControls() {
  if (fileToolsDisposed) return;
  contextFrame = null;
  const state = diff.saveViewState();
  renderGapActions(state);
  const ranges = state?.modelState?.collapsedRegions?.map(r => r.range);
  if (ranges?.length && !contextDefaults.has(selectedFile.path)) contextDefaults.set(selectedFile.path, structuredClone(ranges));
  const defaults = contextDefaults.get(selectedFile.path) || [];
  const {canExpand, canCollapse, expanded} = unchangedContextState(state, defaults);
  $("expand").disabled = !canExpand;
  $("collapse").disabled = !canCollapse;
  $("expand").hidden = !canExpand;
  $("collapse").hidden = !canCollapse;
  $("expand").title = canExpand ? "Reveal all unchanged lines in this file" : "All context is already visible";
  $("collapse").title = canCollapse ? "Collapse unchanged sections in this file" : defaults.length ? "Unchanged sections are already collapsed" : "No unchanged sections large enough to collapse";
  if (!ranges?.length) { clearContextControls(); return; }
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
  if (fileToolsDisposed) return;
  if (contextFrame === null) contextFrame = requestAnimationFrame(renderContextControls);
}
diff.onDidUpdateDiff(() => { scheduleContextControls(); drawAnnotations(); });
for (const editor of Object.values(editors)) {
  editor.onDidChangeHiddenAreas(scheduleContextControls);
  editor.onDidScrollChange(scheduleContextControls);
}

function capture(side) {
  if (fileToolsDisposed) return;
  if (deletedSelection?.ownsSelection && activeLayout === "unified") return;
  const selection = editors[side].getSelection();
  if (!selection || !selectedFile[side]) { currentAnchor = null; currentSourceRange = null; selectionError = ""; $("selection").textContent = "Click a line or select code"; updateFileTools(); return; }
  activeSide = side;
  try {
    currentAnchor = sourceAnchor(selectedFile, side, selection, { preserveEol: true });
    currentSourceRange = selection; selectionError = "";
    currentSelectionIsQuote = !selection.isEmpty();
    if (host && editors[side].hasTextFocus()) host.select(currentAnchor);
    $("selection").textContent = `${side === "old" ? "Before" : "After"} · ${currentAnchor.line}${currentAnchor.endLine > currentAnchor.line ? `–${currentAnchor.endLine}` : ""}`;
  } catch (error) { currentAnchor = null; currentSourceRange = null; selectionError = error.message; status(error.message); }
  updateFileTools();
}
function mobileSelection(anchor = currentAnchor, range = currentSourceRange, quoted = currentSelectionIsQuote) {
  if (!host?.mobileSelect || !anchor || !range || composer || fileToolsDisposed) return null;
  anchor = structuredClone(anchor);
  range = { startLineNumber: range.startLineNumber, startColumn: range.startColumn, endLineNumber: range.endLineNumber, endColumn: range.endColumn };
  const side = anchor.side, editor = editors[side], model = editor.getModel(), version = model.getVersionId();
  const position = { lineNumber: range.startLineNumber, column: range.startColumn };
  const symbol = model.getWordAtPosition(position)?.word;
  const definition = editor.getAction("editor.action.revealDefinition"), peekDefinition = editor.getAction("editor.action.peekDefinition");
  // Monaco 0.55 registers these as Action2 commands rather than IEditorAction
  // objects. getAction() can be null even when its native context menu offers
  // them. The bundled TS/JS provider is configured through this public API.
  const languageDefaults = selectedFile.language === "typescript" ? monaco.languages.typescript.typescriptDefaults
    : selectedFile.language === "javascript" ? monaco.languages.typescript.javascriptDefaults : null;
  const bundledDefinitions = Boolean(languageDefaults?.modeConfiguration.definitions);
  const valid = () => !fileToolsDisposed && editor.getModel() === model && model.getVersionId() === version && host.acceptComparison(session);
  const restore = () => {
    if (!valid()) throw Error("The source changed. Select the code again.");
    deletedSelection.reset();
    currentAnchor = structuredClone(anchor); currentSourceRange = { ...range }; activeSide = side; currentSelectionIsQuote = quoted;
    selectionError = ""; updateFileTools(); host.select(anchor);
  };
  let suggest = false;
  try { suggestedEditTarget(selectedFile, anchor); suggest = session.status === "open"; } catch {}
  return {
    anchor, valid,
    capabilities: {
      comment: session.status === "open", ask: session.status === "open", suggest,
      definition: Boolean(symbol && (definition?.isSupported() || bundledDefinitions)), peekDefinition: Boolean(symbol && (peekDefinition?.isSupported() || bundledDefinitions)),
      references: Boolean(symbol), source: true, copy: Boolean(anchor.selectedText), textSelection: true,
    },
    setSelectionMode(value) {
      mobileTextSelection = Boolean(value);
      editorSurface.classList.toggle("mobile-text-selection", mobileTextSelection);
    },
    setDraft(value) { mobileDraft = value; updateCommentControls(); },
    highlight(value) {
      if (fileToolsDisposed) return;
      for (const collection of Object.values(mobileDecorations)) collection.clear();
      if (value) {
        const collection = mobileDecorations[side] ||= editor.createDecorationsCollection();
        collection.set([{ range: quoted ? new monaco.Range(range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn)
          : new monaco.Range(value.line, 1, value.endLine, model.getLineMaxColumn(value.endLine)),
          options: { isWholeLine: !quoted, className: quoted ? "mobile-review-selected-text" : "mobile-review-selected-line" } }]);
      }
    },
    async submit(kind, body) {
      if (!valid() || session.status !== "open") throw Error("This source is no longer available for review.");
      if (kind === "ask") { await host.askFromMobile(anchor, body); return; }
      session = await api("/api/comments", commentSubmission(anchor, body, quoted));
      setCommentsVisible(true); drawAnnotations();
      // The write already succeeded. A failed follow-up refresh must not
      // leave an enabled submit button that would create a duplicate comment.
      await refresh().catch(error => status(`Comment saved. Refresh could not finish: ${error.message}`));
    },
    async run(action) {
      if (!valid()) throw Error("The source changed. Select the code again.");
      if (action === "references") { await host.peek(symbol, selectedFile.path, anchor.line, side); host.clearMobileSelection(); return; }
      await host.revealMobile(side, anchor.line, anchor.endLine);
      restore();
      if (action === "suggest") { openSuggestedEdit(); host.clearMobileSelection(); return; }
      if (action === "source") { $("source").click(); host.clearMobileSelection(); return; }
      editor.setSelection(new monaco.Range(range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn));
      editor.focus();
      if (action === "definition") {
        // Native navigation scrolls inside Monaco, but the review scroll owner
        // is the parent page. Follow the resulting source cursor there too.
        let timer;
        const listener = editor.onDidChangeCursorPosition(event => {
          listener.dispose(); clearTimeout(timer);
          if (valid()) void host.revealMobile(side, event.position.lineNumber, event.position.lineNumber);
        });
        timer = setTimeout(() => listener.dispose(), 5000);
      }
      editor.trigger("mobile-review", action === "definition" ? "editor.action.revealDefinition" : "editor.action.peekDefinition", {});
      if (action === "definition") host.clearMobileSelection();
    },
  };
}
function publishMobileSelection(pointerType) {
  const item = mobileSelection();
  if (item) host.mobileSelect(item, pointerType);
}
// Only completed user gestures publish the bar. Cursor changes produced by
// tours, reveal(), layout or restoring a lazy iframe must not open it.
editorSurface.addEventListener("pointerdown", event => {
  if (event.button !== 0 || !event.isPrimary || event.pointerType === "pen") return;
  const deleted = activeLayout === "unified" && event.target.closest?.(".line-delete-selectable");
  const side = deleted ? "old" : Object.keys(editors).find(side => codePenTarget(editors[side], event));
  mobilePointer = side ? { id: event.pointerId, side, deleted, type: event.pointerType, x: event.screenX, y: event.screenY } : null;
}, true);
editorSurface.addEventListener("pointercancel", () => { mobilePointer = null; }, true);
editorSurface.addEventListener("pointerup", event => {
  const gesture = mobilePointer; mobilePointer = null;
  if (!gesture || event.pointerId !== gesture.id || (gesture.type === "touch" && Math.hypot(event.screenX - gesture.x, event.screenY - gesture.y) > 6)) return;
  // Monaco and the unified Before selector finish their own selection first.
  // A microtask may run between DOM listeners, before the document-level
  // Before selector handles pointerup. Wait until the complete event ends.
  setTimeout(() => { if (fileToolsDisposed) return; if (!gesture.deleted) capture(gesture.side); publishMobileSelection(gesture.type); }, 0);
}, true);
for (const [side, editor] of Object.entries(editors)) {
  editor.onDidChangeCursorSelection(() => capture(side));
  editor.onDidFocusEditorText(() => { deletedSelection?.editorFocused(); capture(side); });
  editor.onMouseDown(event => {
    if (event.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && event.target.position && event.target.element?.closest(".comment-glyph")) {
      editor.setPosition(event.target.position); capture(side); openComposer("comment");
    }
  });
  for (const [name, label] of [["comment", "Comment on selection"], ["ask", "Ask agent about selection"], ["source", "View source"], ["peek", "Find references"]]) {
    addOwnedAction(editor, { id: `diff-lab.${side}.${name}`, label, keybindings: name === "peek" ? [monaco.KeyMod.Shift | monaco.KeyCode.F12] : undefined, contextMenuGroupId: "review", contextMenuOrder: 1, run: () => { capture(side); $(name).click(); } });
  }
  if (production && side === "new" && selectedFile.status !== "deleted") addOwnedAction(editor, {
    id: "diff-lab.new.suggest-edit", label: "Suggest edit", contextMenuGroupId: "review", contextMenuOrder: 2,
    run: () => { capture(side); openSuggestedEdit(); },
  });
}
function clearZones() {
  for (const [editor, id, dispose] of zones) { dispose?.(); editor?.changeViewZones(accessor => accessor.removeZone(id)); }
  zones = []; composer = null; commentCards.clear(); prCards.clear();
}
function zone(side, line, domNode, heightInPx, sizeToContent = null) {
  const unifiedOld = side === "old" && activeLayout === "unified";
  const deleted = unifiedOld && diff.getLineChanges()?.some(change => change.originalEndLineNumber >= line && change.originalStartLineNumber <= line);
  if (deleted) {
    const remove = beforeAnnotations.addCard(line, domNode, heightInPx, sizeToContent);
    zones.push([null, null, remove]); return remove;
  }
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
  const spacer = document.createElement("div"); spacer.setAttribute("aria-hidden", "true");
  let contentHeight = heightInPx;
  const hidden = () => sourceLineHidden(editor === editors.old ? "old" : "new", line, diff.saveViewState(), diff.getLineChanges());
  // Native zones test the *following* line for folding. Our cards belong to
  // their source line, including the last hidden / last visible boundary row.
  // Keep the zone alive but reserve no space while its own anchor is folded.
  const descriptor = { afterLineNumber: line, heightInPx: hidden() ? 0 : contentHeight, domNode: spacer, showInHiddenAreas: true, suppressMouseDown: false, ordinal: 100001 };
  editor.changeViewZones(accessor => { id = accessor.addZone(descriptor); });
  const updateHeight = () => {
    const height = hidden() ? 0 : contentHeight;
    if (descriptor.heightInPx === height) return;
    descriptor.heightInPx = height;
    editor.changeViewZones(accessor => accessor.layoutZone(id));
  };
  const folding = editor.onDidChangeHiddenAreas(updateHeight);
  const unmount = beforeAnnotations.addSourceCard(editor, domNode, spacer, () => descriptor.heightInPx, () => descriptor.heightInPx > 0);
  if (sizeToContent) {
    // Measure the inner content, not Monaco's explicitly-sized outer zone.
    // This also tracks narrower Split panes, wrapping and font/viewport changes.
    observer = new ResizeObserver(() => {
      if (!sizeToContent.isConnected || sizeToContent.getBoundingClientRect().width === 0) return;
      contentHeight = Math.ceil(sizeToContent.getBoundingClientRect().height) + 18;
      updateHeight();
    });
    observer.observe(sizeToContent);
  }
  // Only the inert spacer lives in Monaco's aria-hidden view-zone container;
  // the actual review form stays accessible in the full-column overlay.
  zones.push([editor, id, () => { folding.dispose(); observer?.disconnect(); unmount(); }]);
  const remove = () => {
    folding.dispose(); observer?.disconnect(); unmount();
    editor.changeViewZones(accessor => accessor.removeZone(id));
    zones = zones.filter(entry => entry[1] !== id || entry[0] !== editor);
  };
  remove.reveal = () => {
    editor.revealLineInCenter(line, monaco.editor.ScrollType.Immediate);
    // Reveal the review form itself, not only its preceding source line. In a
    // wholly deleted file that line is the empty After model's EOF, and the
    // form may sit below all deleted rows and existing review zones.
    const bottom = line < editor.getModel().getLineCount() ? editor.getTopForLineNumber(line + 1, true) : editor.getScrollHeight();
    editor.setScrollTop(Math.max(0, bottom - descriptor.heightInPx - 12), monaco.editor.ScrollType.Immediate);
  };
  return remove;
}
function drawAnnotations() {
  if (fileToolsDisposed) return;
  // Don't destroy a draft when the shared review receives an update.
  if (composer) return;
  const markers = reviewMarkers(selectedFile, session);
  const key = JSON.stringify([activeLayout, commentsVisible, session.status,
    session.comments.filter(entry => entry.path === selectedFile.path),
    (session.outline?.findings || []).filter(entry => entry.path === selectedFile.path),
    (session.pullRequest?.threads || []).filter(entry => entry.path === selectedFile.path),
    (session.activities || []).filter(activity => activity.inlineSuggestions?.some(edit => edit.path === selectedFile.path)),
    markers, diff.getLineChanges(),
  ]);
  // A tour position/revision update does not change review annotations. Keep
  // their measured zones and DOM instead of briefly collapsing the editor.
  if (key === annotationSignature) { renderActivity(); return; }
  annotationSignature = key;
  clearZones();
  clearMarkers();
  const commentBadgeLines = { old: new Set(), new: new Set() };
  for (const side of ["old", "new"]) {
    const entries = session.comments.filter(c => c.path === selectedFile.path && c.side === side);
    const findings = (session.outline?.findings || []).filter(f => f.path === selectedFile.path && f.side === side);
    decorations[side].set([
      ...entries.map(c => ({ range: new monaco.Range(c.line, 1, c.endLine || c.line, 1), options: { isWholeLine: true, className: "review-highlight" } })),
      ...findings.map(f => ({ range: new monaco.Range(f.line, 1, f.line, 1), options: { isWholeLine: true, className: "finding-highlight" } })),
    ]);
    for (const entry of entries) {
      if (commentsVisible) {
      const node = document.createElement("div"); node.className = "review-zone";
      node.dataset.commentId = entry.id;
      const content = document.createElement("div"); content.className = "review-card-content";
      const description = commentDescription(entry);
      const label = document.createElement("small"); label.textContent = `${description.kind} · ${description.location}${entry.githubUnavailableReason ? " · Local only" : ""}`;
      const text = document.createElement(entry.suggestion ? "pre" : "p"); text.className = entry.suggestion ? "review-suggestion-code" : "review-comment-body";
      text.textContent = entry.suggestion ? entry.suggestion.replacement || "Delete the selected lines." : entry.body;
      const actions = document.createElement("div"); actions.className = "review-comment-actions";
      if (entry.suggestion) {
        const note = document.createElement("p"); note.textContent = entry.githubPublished ? "Published in the GitHub review." : entry.githubUnavailableReason || "Queued locally. Publishes only when you confirm the GitHub review.";
        content.append(note);
        if (!entry.githubPublished) {
          const restore = button("Return to local", () => host.suggestionAction(entry.suggestion.activityId, "return-local"));
          const submit = button("Submit suggestions", () => host.suggestionAction(entry.suggestion.activityId, "submit-suggestions"));
          restore.disabled = submit.disabled = session.status !== "open"; actions.append(restore, submit);
        }
      } else actions.append(button("Edit", () => openComposer("comment", entry)), button("Delete", async () => {
        if (!confirm(production ? "Delete this comment?" : "Delete this fixture comment?")) return;
        session = await api(`/api/comments/${entry.id}`, {}, "DELETE"); await refresh();
      }));
      content.append(label);
      if (description.quote) content.append(quotedCode(description));
      content.append(text, actions); node.append(content);
      const card = zone(side, entry.endLine || entry.line, node, 100, content);
      commentCards.set(entry.id, { node, content, reveal: card.reveal });
      }
      if (!commentBadgeLines[side].has(entry.line) && entry.status !== "outdated" && entry.lineContent === selectedFile[side].split("\n")[entry.line - 1]) {
        commentBadgeLines[side].add(entry.line);
        const badge = button("●", () => revealCommentCard(commentCards, entry.id));
        badge.className = "review-badge review-comment-badge"; badge.dataset.side = side; badge.dataset.line = String(entry.line);
        badge.setAttribute("aria-label", `Open comment at ${selectedFile.path}:${entry.line} (${side})`);
        const remove = beforeAnnotations.addBadge(badge, side, entry.line, 0); markerWidgets.push({ remove, badge });
      }
    }
  }
  for (const group of markers) {
    if (group.conversations.length) addMarker(group, "conversation");
    if (group.findings.length) addMarker(group, "finding");
  }
  drawPullRequestThreads(commentBadgeLines);
  drawSuggestions(commentBadgeLines);
  scheduleContextControls();
  renderActivity();
}
function revealCommentCard(cards, id) {
  setCommentsVisible(true);
  const card = cards.get(id);
  if (!card) return;
  card.reveal(); card.node.tabIndex = -1; card.node.focus({ preventScroll: true });
}
function drawPullRequestThreads(commentBadgeLines) {
  for (const thread of session.pullRequest?.threads || []) {
    if (thread.path !== selectedFile.path) continue;
    const side = thread.side === "old" ? "old" : "new";
    const source = selectedFile[side], lines = source.split("\n");
    if (source.endsWith("\n")) lines.pop();
    const anchored = !thread.outdated && Number.isSafeInteger(thread.line) && thread.line > 0 && source && thread.line <= lines.length;
    const location = anchored ? commentDescription({ ...thread, side }).location : thread.outdated ? "Outdated location" : "File-level thread";
    // A colocated local comment already provides a reveal affordance. PR-only
    // rows still need one when their cards are hidden, without a fourth lane.
    if (anchored && !commentBadgeLines[side].has(thread.line)) {
      commentBadgeLines[side].add(thread.line);
      const badge = button("●", () => revealCommentCard(prCards, thread.id));
      badge.className = "review-badge review-comment-badge review-pr-badge";
      badge.dataset.side = side; badge.dataset.line = String(thread.line);
      badge.setAttribute("aria-label", `Open GitHub thread at ${selectedFile.path}:${thread.line} (${side})`);
      markerWidgets.push({ remove: beforeAnnotations.addBadge(badge, side, thread.line, 0), badge });
    }
    if (!commentsVisible) continue;
    const node = document.createElement("article"); node.className = "review-zone review-pr-thread";
    node.dataset.prThreadId = thread.id; node.dataset.side = side;
    if (anchored) node.dataset.line = String(thread.line);
    node.dataset.anchorState = anchored ? "current" : "file";
    node.setAttribute("aria-label", `${info.pullRequestFixture ? "Sample " : ""}GitHub thread · ${thread.resolved ? "Resolved" : "Open"} · ${location}`);
    const content = document.createElement("div"); content.className = "review-card-content";
    const label = document.createElement("strong");
    label.textContent = `GitHub thread · ${thread.resolved ? "Resolved" : "Open"} · ${location}`;
    label.setAttribute("role", "heading"); label.setAttribute("aria-level", "3");
    content.append(label);
    for (const comment of thread.comments) {
      const message = document.createElement("section"); message.className = "review-pr-message";
      const author = document.createElement("strong"); author.textContent = comment.author;
      const body = document.createElement("div");
      if (host?.renderReviewMarkdown) body.innerHTML = host.renderReviewMarkdown(comment.body);
      else body.textContent = comment.body;
      message.append(author, body); content.append(message);
    }
    if (!anchored) {
      const note = document.createElement("p"); note.textContent = "This thread has no verified line in the current diff. It remains here at file level; open it in GitHub for its original context."; content.append(note);
    }
    const note = document.createElement("small");
    note.textContent = info.pullRequestFixture ? "Read-only sample · no GitHub connection" : "Replies and resolution happen on GitHub. Refresh the pull request to see updates.";
    content.append(note);
    if (info.pullRequestFixture) {
      const reply = document.createElement("button"); reply.type = "button"; reply.textContent = "Reply in GitHub";
      reply.disabled = true; reply.title = "Unavailable for a synthetic fixture thread"; content.append(reply);
    } else {
      const url = host?.githubThreadReplyUrl?.(thread);
      if (url) {
        const reply = document.createElement("a"); reply.className = "review-pr-reply"; reply.textContent = "Reply in GitHub";
        reply.href = url; reply.target = "_blank"; reply.rel = "noopener noreferrer"; content.append(reply);
      }
    }
    node.append(content);
    const card = zone(side, anchored ? thread.line : 0, node, 180, content);
    prCards.set(thread.id, { node, reveal: card.reveal });
  }
}
function drawSuggestions(commentBadgeLines) {
  if (!production) return;
  for (const activity of session.activities || []) {
    const edits = (activity.inlineSuggestions || []).filter(edit => edit.path === selectedFile.path);
    const current = edits.every(edit => suggestionMatchesSource(selectedFile, edit));
    for (const [index, edit] of edits.entries()) {
      if (!current && index > 0) continue;
      const id = `suggestion-${activity.id}-${index}`;
      if (commentsVisible) {
        const node = document.createElement("article"); node.className = "review-zone review-pending-suggestion";
        node.dataset.suggestionId = activity.id;
        const content = document.createElement("div"); content.className = "review-card-content";
        const label = document.createElement("strong");
        const location = edit.kind === "insert" ? (edit.afterLine ? `Insert after L${edit.afterLine}` : "Insert before L1") : `After · L${edit.line}${edit.endLine === edit.line ? "" : `–${edit.endLine}`}`;
        label.textContent = `Suggested edit · ${current ? "Pending" : "Source changed"} · ${location}`;
        content.append(label);
        if (!current) {
          const note = document.createElement("p"); note.textContent = "This suggestion no longer matches the captured code. Inspect it in Activity before applying."; content.append(note);
          content.append(button("View in Activity", () => host.showSuggestionActivity(activity.id)));
        } else if (edit.kind === "delete") {
          const note = document.createElement("p"); note.textContent = `Delete ${edit.endLine - edit.line + 1} source line${edit.endLine === edit.line ? "" : "s"}.`; content.append(note);
        }
        if (current) {
          const code = document.createElement("pre"); code.className = "review-suggestion-code";
          code.setAttribute("aria-label", edit.kind === "delete" ? "Code to remove" : "Suggested code");
          code.textContent = edit.kind === "delete" ? edit.before : edit.replacement; content.append(code);
          const language = suggestedEditLanguage(selectedFile, edit, monaco.languages.getLanguages());
          void monaco.editor.colorize(code.textContent, language, { tabSize: 4 }).then(html => {
            if (code.isConnected) code.innerHTML = html;
          }).catch(() => { /* Plain source remains readable if tokenization fails. */ });
        }
        const actions = document.createElement("div"); actions.className = "review-comment-actions";
        const apply = button(session.pullRequest ? "Apply locally" : "Apply", () => act("apply")), reject = button("Reject", () => act("reject"));
        const queue = button("Add to GitHub review", () => act("queue-github"));
        const queueDisabled = !current || !activity.canQueueGitHubSuggestion || session.status !== "open" || Boolean(session.pullRequestFixture);
        queue.disabled = queueDisabled;
        const fixtureReadOnly = session.pullRequestFixture && !session.fixtureCanApplySuggestions;
        const applyDisabled = !current || session.status !== "open" || Boolean(fixtureReadOnly);
        apply.disabled = applyDisabled; reject.disabled = session.status !== "open";
        if (fixtureReadOnly) apply.title = "Applying changes is disabled in this synthetic PR fixture";
        async function act(action) {
          const focused = document.activeElement;
          apply.disabled = reject.disabled = queue.disabled = true; host.retainViewport?.();
          try { await host.suggestionAction(activity.id, action); }
          finally { if (node.isConnected) { apply.disabled = applyDisabled; reject.disabled = session.status !== "open"; queue.disabled = queueDisabled; focused?.focus({ preventScroll: true }); } }
        }
        if (session.pullRequest) {
          actions.append(queue);
          const note = document.createElement("small"); note.textContent = activity.githubSuggestionUnavailableReason || "Queues a suggestion locally; publishes only after review confirmation."; content.append(note);
        }
        actions.append(apply, reject); content.append(actions); node.append(content);
        const card = zone("new", current ? edit.afterLine : 0, node, 130, content);
        commentCards.set(id, { node, content, reveal: card.reveal });
      }
      if (current && !commentBadgeLines.new.has(edit.line)) {
        commentBadgeLines.new.add(edit.line);
        const badge = button("✎", () => revealCommentCard(commentCards, id));
        badge.className = "review-badge review-comment-badge"; badge.dataset.side = "new"; badge.dataset.line = String(edit.line);
        badge.setAttribute("aria-label", `Open suggested edit at ${selectedFile.path}:${edit.line}`);
        markerWidgets.push({ remove: beforeAnnotations.addBadge(badge, "new", edit.line, 0), badge });
      }
    }
  }
}
function openSuggestedEdit() {
  if (!production || !validateFileToolSelection()) return;
  if (session.status !== "open") return fileToolStatus("This review is closed.");
  if (composer) return fileToolStatus("Finish or cancel the open draft first.");
  let target;
  try { target = suggestedEditTarget(selectedFile, currentAnchor); }
  catch (error) { return fileToolStatus(error.message); }
  closeMarkdownPreview();
  const node = document.createElement("form"); node.className = "review-zone review-suggestion";
  const content = document.createElement("div");
  const label = document.createElement("strong");
  label.textContent = `Suggest edit · ${target.path}:${target.line}${target.endLine === target.line ? "" : `–${target.endLine}`}`;
  node.setAttribute("aria-label", label.textContent);
  const note = document.createElement("small"); note.textContent = "Replace the full lines below. The repository stays untouched until you apply this suggestion.";
  const surface = document.createElement("div"); surface.className = "review-suggestion-editor";
  const error = document.createElement("p"); error.setAttribute("role", "alert"); error.hidden = true;
  const submit = document.createElement("button"); submit.type = "submit"; submit.textContent = "Propose edit";
  let pending = false, draftEditor, draftModel, remove;
  const disposeDraft = () => { draftEditor?.dispose(); draftModel?.dispose(); };
  const close = () => {
    if (pending) return;
    disposeDraft(); remove(); composer = null; annotationSignature = null;
    drawAnnotations(); updateCommentControls(); updateFileTools();
  };
  close.kind = "suggest-edit"; close.dispose = disposeDraft; composer = close;
  const cancel = button("Cancel", close);
  content.append(label, note, surface, error, submit, cancel); node.append(content);
  remove = zone("new", target.endLine, node, 260, content);
  const draftLanguage = suggestedEditLanguage(selectedFile, target, monaco.languages.getLanguages());
  draftModel = monaco.editor.createModel(target.expectedContent, draftLanguage, monaco.Uri.parse(`inmemory://review-suggestion/${crypto.randomUUID()}/${encodeURIComponent(target.path)}`));
  draftEditor = createWithOverflowLayer(overflow => monaco.editor.create(surface, {
    ...overflow, model: draftModel, ariaLabel: "Replacement code", readOnly: false, automaticLayout: true,
    minimap: { enabled: false }, fontSize: 12, lineHeight: 20, wordWrap: "on", scrollBeyondLastLine: false,
    // A selected fragment lacks the surrounding declarations/function scope.
    renderValidationDecorations: "off", overviewRulerLanes: 0,
    occurrencesHighlight: "off", scrollbar: { alwaysConsumeMouseWheel: false },
  }));
  draftEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => node.requestSubmit());
  node.addEventListener("submit", async event => {
    event.preventDefault(); if (pending) return;
    const replacement = draftModel.getValue(monaco.editor.EndOfLinePreference.LF);
    if (replacement === target.expectedContent) { error.textContent = "Change the replacement code before proposing an edit."; error.hidden = false; return; }
    // Clearing a previous save error shrinks the form before the request
    // finishes. Reserve the viewport now, before the browser can clamp it.
    host.retainViewport?.();
    pending = true; submit.disabled = cancel.disabled = true; error.hidden = true;
    draftEditor.updateOptions({ readOnly: true });
    try {
      const result = await api("/api/edits", { ...target, replacement });
      session = result.session; pending = false; host.retainViewport?.(); close();
      await host.suggestionCreated(result, target.path);
    } catch (failure) {
      if (!fileToolsDisposed) { error.textContent = failure.message; error.hidden = false; }
    } finally {
      pending = false;
      if (composer === close) { submit.disabled = cancel.disabled = false; draftEditor.updateOptions({ readOnly: false }); }
    }
  });
  updateCommentControls(); updateFileTools();
  void (async () => {
    remove.reveal();
    // The initial overlay position can fit the old iframe, then move as the
    // diff and view zone grow. Wait for settled geometry, not just a fit, and
    // reveal once so later typing or manual scrolling keeps its position.
    let previous = "", stable = 0;
    for (let i = 0; i < 24; i++) {
      await new Promise(requestAnimationFrame);
      if (fileToolsDisposed || composer !== close) return;
      const rect = node.getBoundingClientRect();
      const geometry = [rect.top, rect.bottom, innerHeight].join(",");
      stable = geometry === previous ? stable + 1 : 0; previous = geometry;
      if (stable < 3 || (host.singleFile && innerHeight < rect.bottom)) continue;
      draftEditor.focus(); node.scrollIntoView({ block: "nearest", behavior: "instant" }); return;
    }
  })();
}
function openComposer(kind, existing = null) {
  if (composer?.kind === "suggest-edit") return fileToolStatus("Finish or cancel the suggested edit first.");
  if (!existing && !deletedSelection.validate()) return;
  if (!existing && !currentAnchor) { status(selectionError || "Select a source line or range first."); return; }
  if (session.status !== "open") return status("This review is closed.");
  if (host && kind === "ask") { host.ask(structuredClone(currentAnchor)); return; }
  if (composer) composer();
  setCommentsVisible(true);
  // Closing the composer must restore the saved card even without new data.
  annotationSignature = null;
  const editingCard = existing ? commentCards.get(existing.id) : null;
  // Editing a saved comment must not replace the user's selected source range.
  const anchor = existing ? { ...existing, endLine: existing.endLine || existing.line, selectedText: existing.selectedText || "" } : structuredClone(currentAnchor);
  const isQuote = existing ? Boolean(commentDescription(existing).quote) : currentSelectionIsQuote;
  const node = document.createElement("form"); node.className = "review-zone";
  const label = document.createElement("strong");
  const title = kind === "ask" ? (info.pullRequestFixture || !production ? "Ask agent (fixture responder)" : "Ask agent") : existing ? `Editing ${isQuote ? "quote" : "line"} comment` : isQuote ? "Quote comment" : "Line comment";
  label.textContent = `${title} · ${commentDescription(anchor).location}`;
  label.setAttribute("role", "heading"); label.setAttribute("aria-level", "3");
  node.setAttribute("aria-label", label.textContent);
  const input = document.createElement("textarea"); input.required = true; input.value = existing?.body || ""; input.setAttribute("aria-label", kind === "ask" ? "Agent question" : "Comment text");
  const quote = document.createElement("small"); quote.textContent = anchor.selectedText.slice(0, 120);
  const submit = document.createElement("button"); submit.type = "submit"; submit.textContent = kind === "ask" ? "Send question" : existing ? "Save changes" : "Add comment";
  let remove;
  const close = () => { remove(); composer = null; drawAnnotations(); updateCommentControls(); };
  composer = close;
  updateCommentControls();
  node.append(label);
  if (existing) {
    const note = document.createElement("small");
    note.id = `comment-edit-status-${info.files.indexOf(selectedFile)}`; note.textContent = "Changes are not saved until you select Save changes.";
    input.setAttribute("aria-describedby", note.id); node.append(note);
  }
  node.append(quote, input, submit, button("Cancel", close));
  if (editingCard) {
    // Reuse the saved card's source position and content observer. A second
    // zone would look like a new comment and move the editor below its target.
    editingCard.node.classList.add("review-editing");
    node.classList.add("review-inline-editor");
    editingCard.content.replaceChildren(node);
    remove = () => {};
    remove.reveal = editingCard.reveal;
  } else {
    if (existing) node.classList.add("review-editing");
    remove = zone(anchor.side, anchor.endLine, node, 158);
  }
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
        status(kind === "ask" ? (info.pullRequestFixture || !production ? "Question answered by the fixture responder." : "Question answered.") : production ? "Comment saved." : "Saved through the real review API; visible in both panes.");
      } finally { submit.disabled = false; }
    });
  });
  // Off-screen Monaco zones have display:none; DOM scrollIntoView cannot reveal
  // them. Scroll the editor to the anchor before focusing its inline form.
  requestAnimationFrame(() => { remove.reveal(); requestAnimationFrame(() => input.focus({ preventScroll: true })); });
}
function reveal(side, line, endLine = line) {
  closeMarkdownPreview();
  activateFile(selectedFile.path);
  if (collapsedFiles.has(selectedFile.path)) { setFileCollapsed(selectedFile.path, false, false); diff.layout(); }
  fileDetail.scrollIntoView({ block: "nearest" });
  deletedSelection.reset();
  // Built-in reveal expands hidden regions. No private Monaco APIs.
  const editor = editors[side];
  editor.setSelection(new monaco.Range(line, 1, endLine, editor.getModel().getLineMaxColumn(endLine)));
  editor.revealLinesInCenter(line, endLine); editor.focus(); capture(side);
}
function updateNumberGutter() {
  const digits = Math.max(3, ...editorModels.map(model => String(model.getLineCount()).length));
  // Unified has one external sign lane; Split retains one in each editor.
  diff.updateOptions({ lineNumbersMinChars: digits + (activeLayout === "split" ? 3 : 0) });
}
for (const name of ["comment", "ask"]) $(name).onclick = () => openComposer(name);
$("copy").onclick = async () => {
  if (copyPending) return;
  clearFileToolStatus();
  const text = selectedFile[currentAnchor?.side || fileSourceSide()];
  copyPending = true; $("copy").disabled = true;
  try {
    await navigator.clipboard.writeText(text);
    fileToolStatus("Copied contents", true);
  } catch {
    fileToolStatus("Copy failed — clipboard access was blocked or unavailable.");
  } finally { copyPending = false; $("copy").disabled = false; }
};
$("peek").onclick = () => guard(async () => {
  if (!deletedSelection.validate()) return;
  if (!currentAnchor) throw new Error("Select a symbol first");
  const editor = editors[activeSide];
  const symbol = editor.getModel().getWordAtPosition({ lineNumber: currentSourceRange.startLineNumber, column: currentSourceRange.startColumn })?.word;
  if (!symbol) throw new Error("Place the cursor on a symbol");
  await current().peek(symbol, selectedFile.path, currentAnchor.line, activeSide);
  status("Find references opened · current workspace, not a historical revision.");
});
$("source").onclick = () => {
  if (!validateFileToolSelection()) return;
  closeMarkdownPreview();
  const sourceSide = currentAnchor?.side || fileSourceSide();
  const firstLine = currentAnchor?.line || 1, lastLine = currentAnchor?.endLine || firstLine;
  sourceHadAnchor = Boolean(currentAnchor);
  viewState = diff.saveViewState();
  $("source-pane").hidden = false;
  $("source-title").textContent = `${selectedFile.path} · ${sourceSide === "old" ? "Before" : "After"} source`;
  sourceEditor?.dispose(); sourceModel?.dispose();
  sourceModel = monaco.editor.createModel(selectedFile[sourceSide], selectedFile.language);
  // Monaco 0.55.1's word highlighter leaves its 50ms Delayer rejection
  // unhandled when a transient editor is disposed immediately after selecting
  // a line. This read-only inspector needs folding/navigation, not background
  // occurrence searches. Disable only those here, without suppressing errors
  // or changing the persistent diff editors' highlighting/reference actions.
  sourceEditor = createWithOverflowLayer(overflow => monaco.editor.create($("source-editor"), { ...overflow, model: sourceModel, readOnly: true, domReadOnly: true, editContext: false, automaticLayout: true, occurrencesHighlight: "off", ariaLabel: `${sourceSide === "old" ? "Before" : "After"} full source`, minimap: { enabled: false }, fontSize: 12, lineHeight: 20, folding: true, showFoldingControls: "always", scrollBeyondLastLine: false, scrollbar: { alwaysConsumeMouseWheel: false } }));
  const viewer = sourceEditor;
  viewer.onDidDispose(installPenScroll({
    root: $("source-editor"), hitTest: event => codePenTarget(viewer, event),
    onPan: (_hit, dx, dy) => viewer.setScrollPosition({ scrollLeft: viewer.getScrollLeft() + dx, scrollTop: viewer.getScrollTop() + dy }),
    onTap: hit => { if (hit.position) viewer.setPosition(hit.position); },
  }));
  if (currentAnchor) sourceEditor.setSelection(new monaco.Range(firstLine, 1, lastLine, sourceModel.getLineMaxColumn(lastLine)));
  addOwnedAction(sourceEditor, {
    id: "diff-lab.source.references", label: "Find references", keybindings: [monaco.KeyMod.Shift | monaco.KeyCode.F12], contextMenuGroupId: "review", contextMenuOrder: 1,
    run: () => guard(async () => {
      const position = sourceEditor.getPosition(), symbol = sourceModel.getWordAtPosition(position)?.word;
      if (!symbol) throw new Error("Place the cursor on a symbol");
      await current().peek(symbol, selectedFile.path, position.lineNumber, sourceSide);
    }),
  });
  sourceEditor.revealLinesInCenter(firstLine, lastLine);
  host?.viewportChanged?.();
};
$("return").onclick = () => { $("source-pane").hidden = true; sourceEditor?.dispose(); sourceModel?.dispose(); sourceEditor = null; sourceModel = null; diff.restoreViewState(viewState); if (!sourceHadAnchor) $("source").focus(); else if (!deletedSelection.ownsSelection) editors[activeSide].focus(); host?.viewportChanged?.(); };
if (host && selectedFile.language === "markdown") {
  markdownPane = document.createElement("section");
  markdownPane.className = "review-markdown-preview"; markdownPane.dataset.control = "markdown-preview";
  markdownPane.setAttribute("aria-label", `${selectedFile.path} rendered Markdown`); markdownPane.hidden = true;
  const heading = document.createElement("header"); heading.className = "source-heading";
  const title = document.createElement("strong"); title.textContent = `${selectedFile.path} · Rendered Markdown`;
  const back = button("← Back to diff", () => closeMarkdownPreview(true));
  heading.append(title, back);
  const columns = document.createElement("div"); columns.className = "review-markdown-columns";
  // Status is Git's, not guessed from empty content. Existing empty files
  // must retain their Before side, and added files must not invent one.
  const sides = selectedFile.status === "added" ? ["new"] : selectedFile.status === "deleted" ? ["old"] : ["old", "new"];
  for (const side of sides) {
    const column = document.createElement("section"); column.dataset.markdownSide = side;
    const label = document.createElement("h2"); label.textContent = side === "old" ? "Before" : "After";
    const content = document.createElement("div"); content.className = "review-rendered-markdown";
    content.innerHTML = host.renderMarkdownPreview(selectedFile.path, side, selectedFile[side]);
    if (!selectedFile[side]) content.textContent = "Empty file";
    column.append(label, content); columns.append(column);
  }
  markdownPane.append(heading, columns); fileDetail.append(markdownPane);
  markdownPreviewButton = button("Preview", () => {
    if (composer) { fileToolStatus("Save or cancel the draft before opening Markdown preview."); return; }
    markdownPane.hidden = false;
    for (const node of [fileDetail.querySelector(".tools"), fileDetail.querySelector(".context-tools"), $("editor")]) node.inert = true;
    scheduleDetailHeight(); back.focus({ preventScroll: true });
  });
  markdownPreviewButton.dataset.control = "preview";
  markdownPreviewButton.title = "Preview the captured Markdown, with changed blocks highlighted";
  $("source").before(markdownPreviewButton);
  markdownPane.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); closeMarkdownPreview(true); }
  });
}
$("collapse").onclick = () => guard(() => { editors.new.focus(); editors.new.trigger("diff-lab", "diffEditor.collapseAllUnchangedRegions", {}); scheduleContextControls(); });
$("expand").onclick = () => guard(() => { editors.new.focus(); editors.new.trigger("diff-lab", "diffEditor.showAllUnchangedRegions", {}); scheduleContextControls(); });
deletedSelection = installDeletedSelection({
  root: $("editor"), diff, enabled: () => activeView?.root === fileDetail && activeLayout === "unified" && $("source-pane").hidden && !markdownPreviewOpen(), file: () => selectedFile,
  onSelect({ anchor, range, quoted }) {
    if (selectionError) status("Before source selected · right-click for review actions");
    currentAnchor = anchor; currentSourceRange = range; activeSide = "old"; currentSelectionIsQuote = quoted; selectionError = "";
    host?.select(anchor);
    $("selection").textContent = `Before · ${anchor.line}${anchor.endLine > anchor.line ? `–${anchor.endLine}` : ""}`;
    updateFileTools();
  },
  onInvalid(reason) { currentAnchor = null; currentSourceRange = null; selectionError = reason; $("selection").textContent = "No unambiguous source selection"; updateFileTools(); status(reason); },
  runAction(name) { $(name).click(); },
});
diff.onDidDispose(() => deletedSelection.dispose());

function codePenTarget(editor, event, captured = false) {
  // Exclude nested suggestion/peek editors and all non-code controls.
  const target = captured ? document.elementFromPoint(event.clientX, event.clientY) : event.target;
  if (target?.closest?.(".monaco-editor") !== editor.getDomNode()) return null;
  const hit = editor.getTargetAtClientPoint(event.clientX, event.clientY);
  return hit && [monaco.editor.MouseTargetType.CONTENT_TEXT, monaco.editor.MouseTargetType.CONTENT_EMPTY].includes(hit.type) ? hit : null;
}
diff.onDidDispose(installPeekPenScroll({
  root: fileDetail, monaco,
  onStart() { activateFile(selectedFile.path); return host?.holdPenScroll?.(); },
}));
diff.onDidDispose(installPenScroll({
  root: editorSurface,
  selectionEnabled: () => mobileTextSelection,
  hitTest(event, captured = false) {
    const target = captured ? document.elementFromPoint(event.clientX, event.clientY) : event.target;
    if (activeLayout === "unified" && target?.closest?.(".line-delete-selectable")) {
      const hit = deletedSelection.hitTest(event);
      return hit ? { ...hit, side: "old", editor: editors.new, deleted: true } : null;
    }
    for (const [side, editor] of Object.entries(editors)) {
      const hit = codePenTarget(editor, event, captured);
      if (hit) return { side, editor, position: hit.position };
    }
    return null;
  },
  onStart() { activateFile(selectedFile.path); return host?.holdPenScroll?.(); },
  onSelect(first, last, options) {
    // Never cross source sides or a unified Before block's mapping boundary.
    // While outside the code, retain the last unambiguous selection.
    if (!last || first.side !== last.side || first.zone !== last.zone || !first.position || !last.position) return;
    try {
      const editor = editors[first.side], model = editor.getModel();
      const range = freeTextRange(model, first.position, last.position, options);
      if (first.deleted) {
        if (!deletedSelection.selectRange(first, range)) return;
      } else {
        deletedSelection.reset(); document.getSelection()?.removeAllRanges();
        editor.setSelection(range); capture(first.side);
      }
      publishMobileSelection(options.pointerType);
    } catch (error) { status(error.message); }
  },
  onPan({ editor }, dx, dy) {
    editor.setScrollLeft(editor.getScrollLeft() + dx);
    if (host?.panBy) host.panBy(dy);
    else editor.setScrollTop(editor.getScrollTop() + dy);
  },
  onTap(hit, event) {
    if (hit.deleted) { deletedSelection.tap(event); publishMobileSelection("pen"); return; }
    if (!hit.position) return;
    deletedSelection.reset(); document.getSelection()?.removeAllRanges();
    hit.editor.setPosition(hit.position); capture(hit.side);
    if (currentAnchor) host?.select(currentAnchor);
    publishMobileSelection("pen");
  },
}));

editorModels = ["old", "new"].map(side => monaco.editor.createModel(selectedFile[side], selectedFile.language, monaco.Uri.parse(`inmemory://review/${sourceComparisonId || "fixture"}/${side}/${encodeURIComponent(selectedFile.path)}`)));
// Own the public diff view model so pending worker calculations are cancelled
// synchronously before their source models are released during lazy eviction.
const diffModel = diff.createViewModel({ original: editorModels[0], modified: editorModels[1] });
diff.setModel(diffModel);
updateNumberGutter();
drawAnnotations();
scheduleDetailHeight();
updateFileTools();
return {
  diff, editors, reveal, root: fileDetail, render: drawAnnotations, resize: scheduleDetailHeight,
  async waitForDiff() {
    await diffModel.waitForDiff();
    // Capture pristine folds before restoring an evicted view. Otherwise a
    // previously expanded region becomes its own default and loses the local
    // re-collapse row (28px), shifting the next file when it remounts.
    const ranges = diff.saveViewState()?.modelState?.collapsedRegions?.map(region => region.range);
    if (ranges?.length && !contextDefaults.has(selectedFile.path)) contextDefaults.set(selectedFile.path, structuredClone(ranges));
  },
  dispose() {
    if (fileToolsDisposed) return;
    fileToolsDisposed = true;
    composer?.dispose?.();
    sourceEditor?.dispose(); sourceModel?.dispose();
    clearZones(); clearMarkers(); clearContextControls();
    // Tour zones must be removed while the underlying editors are still alive.
    // Monaco's onDidDispose runs after their instantiation services are gone.
    tourDisposal.dispose(); tourAnnotations.dispose();
    if (contextFrame !== null) cancelAnimationFrame(contextFrame);
    // Detach models while editor services and their lazy contributions are
    // still alive, before disposing either the widget or its source models.
    diff.setModel(null);
    diffModel.dispose();
    diff.dispose();
    for (const model of editorModels) model.dispose();
  },
  editComment(comment) { reveal(comment.side, comment.line, comment.endLine || comment.line); openComposer("comment", comment); },
  get anchor() { return currentAnchor; }, get hasDraft() { return Boolean(composer) || mobileDraft; },
  setTour(step, steps = []) { tourAnnotations.update(steps, step?.id); },
  focusTour(id) { closeMarkdownPreview(); if (!$("source-pane").hidden) $("return").click(); return tourAnnotations.focus(id); },
  layout() {
    host?.clearMobileSelection?.();
    $("editor").classList.toggle("review-split", activeLayout === "split");
    deletedSelection.reset(); currentAnchor = null; currentSourceRange = null;
    selectionError = ""; updateFileTools();
    // Monaco 0.55.1 forces the hidden Before editor's second wrap override off
    // in Unified, but does not reset it on return to Split. Let diffWordWrap
    // control both panes again; Monaco still disables the hidden Unified pane.
    diff.updateOptions({ renderSideBySide: activeLayout === "split", wordWrapOverride2: "inherit" });
    updateNumberGutter(); drawAnnotations();
  },
  wrap(value) { diff.updateOptions({ wordWrap: value, diffWordWrap: value }); },
};
}
renderFileVisibility();
// The production host loads only visible/targeted files. Hidden files retain
// small serializable view states, not Monaco editors, workers or source text.
let latestSnapshot = null;
const visibleEntries = new Set();
function disposeView(path) {
  const view = fileViews.get(path), entry = fileEntries.get(path);
  if (!view || view.hasDraft) return;
  entry.savedView = view.diff.saveViewState();
  view.dispose(); fileViews.delete(path);
  if (activeView === view) activeView = null;
  const detail = detailTemplate.cloneNode(true);
  for (const node of [detail, ...detail.querySelectorAll("[id]")]) { node.dataset.control = node.id; node.removeAttribute("id"); }
  detail.style.height = entry.detail.style.height;
  entry.detail = detail; entry.body.replaceChildren(detail);
}
let sourceLoads = 0;
const sourceWaiters = [];
function restoreReviewViewState(view, state) {
  if (!state) return;
  const passive = { ...state };
  for (const side of ["original", "modified"]) {
    if (!state[side]) continue;
    // Occurrence highlights are transient focus feedback, not review state.
    // Restoring them into an unfocused lazy editor cancels Monaco's pending
    // highlighter task with an unhandled rejection. Cursor, scroll, selection
    // and diff-region state are retained; highlights recalculate on focus.
    passive[side] = { ...state[side], contributionsState: { ...state[side].contributionsState, "editor.contrib.wordHighlighter": false } };
  }
  view.diff.restoreViewState(passive);
}
async function ensureView(path) {
  const entry = fileEntries.get(path);
  if (!entry || disposed || entry.unavailable) return null;
  if (fileViews.has(path)) return fileViews.get(path);
  if (entry.loading) return entry.loading;
  entry.loading = (async () => {
    if (sourceLoads >= 3) await new Promise(resolve => sourceWaiters.push(resolve));
    sourceLoads++;
    try {
      if (disposed || entry.section.hidden || collapsedFiles.has(path)) return null;
      const source = await api(`/api/diff/sources?comparisonId=${encodeURIComponent(sourceComparisonId)}&path=${encodeURIComponent(path)}`);
      if (disposed || entry.section.hidden || collapsedFiles.has(path)) return null;
      if (!visibleEntries.has(path) && !entry.targeted) return null;
      if (!source.available) {
        entry.unavailable = true;
        const note = document.createElement("p"); note.textContent = source.reason;
        entry.body.replaceChildren(note, button("Use Shiki for this file", () => host.fallback(path)));
        return null;
      }
      const view = createFileView(entry.detail, { ...entry.file, ...source });
      fileViews.set(path, view);
      if (latestSnapshot) { view.layout(); view.wrap(latestSnapshot.wrap ? "on" : "off"); view.setTour(latestSnapshot.step, latestSnapshot.steps); }
      await view.waitForDiff();
      if (disposed || !fileViews.has(path)) return null;
      restoreReviewViewState(view, entry.savedView);
      view.resize(); activateFile(path);
      return view;
    } catch (error) {
      if (!disposed) {
        entry.unavailable = true;
        const note = document.createElement("p"); note.textContent = error.message;
        entry.body.replaceChildren(note, button("Use Shiki for this file", () => host.fallback(path)));
      }
      return null;
    } finally {
      sourceLoads--; sourceWaiters.shift()?.(); entry.loading = null;
      if (!disposed && (entry.unavailable || fileViews.has(path))) {
        entry.layoutReady = true; scheduleEmbeddedHeight();
      }
    }
  })();
  return entry.loading;
}
const lazyObserver = production && !host.singleFile ? new IntersectionObserver(entries => {
  if (disposed) return;
  for (const event of entries) {
    const path = event.target.dataset.prototypeFile;
    if (event.isIntersecting) { visibleEntries.add(path); void ensureView(path); }
    else { visibleEntries.delete(path); disposeView(path); }
  }
}, { root: $("file-list"), rootMargin: "180px" }) : null;
if (production) {
  for (const entry of fileEntries.values()) { entry.section.hidden = true; lazyObserver?.observe(entry.section); }
} else {
  for (const file of info.files) fileViews.set(file.path, createFileView(fileEntries.get(file.path).detail, file));
  if (selectedFile) activateFile(selectedFile.path);
}
renderReviewedState();
updateCommentControls();
$("file").addEventListener("change", () => guard(() => loadFile()));
$("layout").addEventListener("change", () => guard(async () => {
  if ([...fileViews.values()].some(view => view.hasDraft)) {
    status("Finish or cancel open drafts before switching layout."); $("layout").value = activeLayout; return;
  }
  activeLayout = $("layout").value;
  for (const view of fileViews.values()) view.layout();
  await frameReady; await current().options(activeLayout, $("wrap").checked);
}));
$("wrap").addEventListener("change", () => guard(async () => {
  const value = $("wrap").checked ? "on" : "off";
  for (const view of fileViews.values()) view.wrap(value);
  await frameReady; await current().options(activeLayout, $("wrap").checked);
}));
$("theme").onclick = () => { light = !light; document.documentElement.toggleAttribute("data-light", light); applySyntaxTheme(document.documentElement.dataset.syntaxTheme, light); current().theme(light); $("theme").textContent = light ? "Dark theme" : "Light theme"; };
$("finding").onclick = () => guard(async () => {
  $("file").value = "checkout.ts"; if (selectedFile.path !== "checkout.ts" && !(await loadFile())) return;
  activeView.reveal("new", info.receiptLine + 1);
  await current().reveal("checkout.ts", "new", info.receiptLine + 1);
  status("P2 fixture finding: check rounding at the display boundary.");
});
$("hidden").onclick = () => guard(async () => {
  $("file").value = "checkout.ts"; if (selectedFile.path !== "checkout.ts" && !(await loadFile())) return;
  activeView.reveal("new", 55); await current().reveal("checkout.ts", "new", 55);
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

await frameReady;
if (!host) {
  await current().show(selectedFile.path, activeLayout, $("wrap").checked);
  for (const file of info.files) current().setCollapsed(file.path, collapsedFiles.has(file.path));
}
status(host ? "Monaco preview · Right-click code to comment, ask or find references · Shared review state" : "Ready · Each file expands independently · Both panes share the same review");
const pollTimer = production ? null : setInterval(() => guard(async () => {
  const next = await api("/api/session");
  if (next.revision > session.revision) {
    session = next;
    for (const view of fileViews.values()) view.render();
    renderActivity(); renderReviewedState();
  }
}), 1800);
// Active-file diagnostics preserve the existing test/navigation contract while
// views exposes stable per-file instances for independence regressions.
window.diffLab = {
  get diff() { return activeView.diff; }, get editors() { return activeView.editors; },
  reveal(...args) { return activeView.reveal(...args); },
  get anchor() { return activeView.anchor; }, get file() { return selectedFile; },
  get session() { return session; }, refresh, views: fileViews,
  setCommentsVisible, commentVisibilityState,
};

if (host) {
  let focusGeneration = 0;
  let snapshotStepId = null;
  // New navigation or manual interaction cancels a pending layout/reveal.
  for (const type of ["wheel", "pointerdown", "keydown"]) $("file-list").addEventListener(type, () => { focusGeneration++; }, { passive: true });
  const sizeObserver = new ResizeObserver(scheduleEmbeddedHeight);
  for (const entry of fileEntries.values()) sizeObserver.observe(entry.section);
  sizeObserver.observe($("status"));
  window.diffCompassMonaco = {
    dispose() {
      if (disposed) return;
      disposed = true; focusGeneration++;
      lazyObserver?.disconnect(); sizeObserver.disconnect();
      disposeContextMenuViewport();
      clearInterval(pollTimer);
      if (embeddedHeightFrame !== null) cancelAnimationFrame(embeddedHeightFrame);
      for (const view of fileViews.values()) view.dispose();
      fileViews.clear();
    },
    captureViewState() { return [...fileEntries].map(([path, entry]) => [path, (entry.layoutReady && fileViews.get(path)?.diff.saveViewState()) || entry.savedView]); },
    restoreViewState(states = []) { for (const [path, state] of states) { const entry = fileEntries.get(path); if (entry) { entry.savedView = state; const view = fileViews.get(path); if (view && entry.layoutReady) restoreReviewViewState(view, state); } } },
    resize() { for (const view of fileViews.values()) view.resize(); scheduleEmbeddedHeight(); },
    setCommentsVisible, commentVisibilityState,
    hasDraft: () => [...fileViews.values()].some(view => view.hasDraft),
    paths: new Set(fileEntries.keys()),
    async editComment(comment) {
      await this.reveal(comment.path, comment.side, comment.line, comment.endLine || comment.line);
      fileViews.get(comment.path)?.editComment(comment);
    },
    sync(snapshot) {
      latestSnapshot = snapshot;
      if (production) document.documentElement.toggleAttribute("data-hide-markers", !snapshot.markers);
      if (snapshotStepId !== (snapshot.step?.id ?? null)) {
        snapshotStepId = snapshot.step?.id ?? null; focusGeneration++;
      }
      if (snapshot.session.revision >= session.revision) {
        const changed = snapshot.session.revision !== session.revision;
        session = snapshot.session;
        if (changed) for (const view of fileViews.values()) view.render();
        renderReviewedState();
      }
      for (const [path, entry] of fileEntries) {
        const wasHidden = entry.section.hidden;
        entry.section.hidden = !snapshot.paths.includes(path);
        const collapsed = snapshot.collapsed.includes(path);
        if (collapsedFiles.has(path) !== collapsed) setFileCollapsed(path, collapsed);
        if (wasHidden && !entry.section.hidden && !collapsed) {
          fileViews.get(path)?.diff.layout(); fileViews.get(path)?.resize();
        }
        if (production && (entry.section.hidden || collapsed)) disposeView(path);
        else if (production && (host.singleFile || visibleEntries.has(path))) {
          if (host.singleFile) entry.targeted = true;
          void ensureView(path);
        }
      }
      if (snapshot.layout !== activeLayout && !this.hasDraft()) {
        activeLayout = snapshot.layout; $("layout").value = activeLayout;
        for (const view of fileViews.values()) view.layout();
      }
      if ($("wrap").checked !== snapshot.wrap) {
        $("wrap").checked = snapshot.wrap;
        for (const view of fileViews.values()) view.wrap(snapshot.wrap ? "on" : "off");
      }
      light = snapshot.light;
      document.documentElement.toggleAttribute("data-light", light);
      applySyntaxTheme(snapshot.syntaxTheme, light);
      for (const view of fileViews.values()) view.setTour(snapshot.step, snapshot.steps);
      scheduleEmbeddedHeight();
    },
    async reveal(path, side, line, endLine = line) {
      focusGeneration++;
      if (!fileEntries.has(path)) return false;
      setFileCollapsed(path, false, false);
      fileEntries.get(path).section.scrollIntoView({ block: "start" });
      fileEntries.get(path).targeted = true;
      const view = fileViews.get(path) || (production && await ensureView(path));
      fileEntries.get(path).targeted = false;
      if (!view) return production;
      activateFile(path); setFileCollapsed(path, false, false);
      fileEntries.get(path).section.scrollIntoView({ block: "start" });
      if (line && side) view.reveal(side, line, endLine);
      return true;
    },
    async focusTour(step) {
      if (this.hasDraft()) return false;
      const generation = ++focusGeneration;
      if (fileEntries.has(step.anchor.path)) setFileCollapsed(step.anchor.path, false, false);
      if (fileEntries.has(step.anchor.path)) fileEntries.get(step.anchor.path).targeted = true;
      const view = fileViews.get(step.anchor.path) || (production && await ensureView(step.anchor.path));
      if (fileEntries.has(step.anchor.path)) fileEntries.get(step.anchor.path).targeted = false;
      if (generation !== focusGeneration || this.hasDraft()) return false;
      if (!view) return false;
      activateFile(step.anchor.path);
      if (collapsedFiles.has(step.anchor.path)) setFileCollapsed(step.anchor.path, false, false);
      const focused = await view.focusTour(step.id);
      // Revealing a phase lays out editors which previously had no width.
      // Their measured heights can change the target's position. Wait for two
      // stable animation frames before starting the one outer smooth scroll;
      // never scroll to a stale offset and then correct it with a visible jump.
      if (focused) {
        let previous = "", stable = 0;
        for (let frame = 0; frame < 12 && stable < 2; frame++) {
          await new Promise(requestAnimationFrame);
          if (generation !== focusGeneration || this.hasDraft() || fileEntries.get(step.anchor.path).section.hidden) return false;
          const geometry = [$("file-list").clientHeight, ...[...fileEntries.values()].filter(entry => !entry.section.hidden).map(entry => entry.section.offsetHeight)].join(",");
          stable = geometry === previous ? stable + 1 : 0; previous = geometry;
        }
      }
      // Monaco reveals inside its own viewport. The containing file list can
      // still be elsewhere. Scroll only this container; scrollIntoView would
      // also move the host and compete with its own smooth navigation.
      if (focused && !host.singleFile) {
        const list = $("file-list"), section = fileEntries.get(step.anchor.path).section;
        const top = list.scrollTop + section.getBoundingClientRect().top - list.getBoundingClientRect().top;
        list.scrollTo({ top, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
      }
      return focused;
    },
    tourTarget(step) {
      const view = fileViews.get(step.anchor.path);
      const banner = view?.root.querySelector(`.review-tour-stop[data-tour-stop="${CSS.escape(step.id)}"]:not([hidden])`);
      return banner?.getClientRects().length ? { top: banner.getBoundingClientRect().top } : null;
    },
    tourGeometry(step) {
      const { path, side } = step.anchor, entry = fileEntries.get(path), view = fileViews.get(path);
      if (!view || entry.section.hidden || collapsedFiles.has(path)) return [];
      if (view.root.querySelector('[data-control="source-pane"]:not([hidden]), [data-control="markdown-preview"]:not([hidden])')) return [];
      const banner = view.root.querySelector(`.review-tour-stop[data-tour-stop="${CSS.escape(step.id)}"][data-tour-state="current"]:not([hidden])`);
      if (!banner) return [];
      const root = view.root.getBoundingClientRect();
      // Use rendered source rows, not one bounding range spanning comments or
      // hidden context. The stop is visible if its banner OR some code is visible.
      const rows = view.root.querySelectorAll(".review-tour-highlight, .review-tour-deleted-highlight");
      return [banner, ...rows].filter(node => node.getClientRects().length).map(node => {
        const rect = node.getBoundingClientRect();
        return { top: Math.max(0, root.top, rect.top), bottom: Math.min(innerHeight, root.bottom, rect.bottom), width: rect.width };
      }).filter(rect => rect.width > 0 && rect.bottom > rect.top);
    },
    geometry(path, side, line) {
      const view = fileViews.get(path);
      if (!view || fileEntries.get(path).section.hidden || collapsedFiles.has(path)) return null;
      if (side === "old" && activeLayout === "unified") {
        const row = badgeDisplayRow({ side, line }, true, view.diff.getLineChanges());
        if (row.startsWith("new:")) { side = "new"; line = Number(row.slice(4)); }
        else {
          const rect = view.root.querySelector(`[data-review-old-line="${line}"]`)?.getBoundingClientRect();
          return rect?.height ? { top: rect.top, bottom: rect.bottom } : null;
        }
      }
      const editor = view.editors[side], position = editor.getScrolledVisiblePosition({ lineNumber: line, column: 1 });
      if (!position) return null;
      const rect = editor.getDomNode().getBoundingClientRect();
      const top = rect.top + position.top;
      return top >= rect.top && top < rect.bottom && top >= 0 && top < innerHeight ? { top, bottom: top + position.height } : null;
    },
  };
  host.ready(window.diffCompassMonaco);
  window.addEventListener("pagehide", () => window.diffCompassMonaco.dispose(), { once: true });
}
