const fragment = new URLSearchParams(window.location.hash.slice(1));
const fragmentToken = fragment.get("token");
if (fragmentToken) {
  window.sessionStorage.setItem("review-tour-token", fragmentToken);
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
}

const state = {
  session: null,
  apiToken: fragmentToken ?? window.sessionStorage.getItem("review-tour-token"),
  selectedLine: null,
  commentTarget: null,
  editingCommentId: null,
  busy: false,
  navigationDirection: null,
  navigationGeneration: 0,
  activeTab: "diff",
  tabScrollPositions: new Map(),
  visibleFile: null,
  collapsedFiles: new Set(),
  diffCache: new Map(),
  diffCacheRevision: null,
  fileRequestId: 0,
  phaseDiffLoadKey: null,
  phaseDiffLoadPromise: null,
  highlightRequestId: 0,
  flowRenderGeneration: 0,
  architectureDiagramViews: new Map(),
  architectureDiagramDrag: null,
  callFlowModes: new Map(),
  proposalPreview: false,
  searchQuery: "",
  searchMatches: null,
  searchRequestId: 0,
  searchTimer: null,
  statusFilter: "",
  reviewFilter: "",
  testFilesOnly: false,
  preferenceRepository: null,
  treeMode: null,
  diffLayout: null,
  filePanelWidth: 240,
  agentPanelWidth: 420,
  splitOldWidth: 50,
  renderedPhaseId: null,
  tourMode: null,
  focusedStepId: null,
  focusedFindingId: null,
  findingReturn: null,
  pollInFlight: false,
  pollGeneration: 0,
  expectedAgentActivity: null,
  updateInProgress: false,
  toastTimer: null,
  prDescriptionMode: "rendered",
};

const elements = Object.fromEntries(
  [
    "workspace", "repository-label", "comparison-label", "file-count", "file-tree", "file-resizer", "agent-resizer", "diff-panel", "diff", "empty-diff", "diff-view", "review-overview", "tour-overview", "tour-mode-toggle", "review-overview-title", "review-overview-summary", "pull-request-description", "pull-request-description-body", "call-flows-view", "call-flows", "call-flows-empty", "call-flows-tab", "regenerate-call-flows", "sequence-view", "architecture", "architecture-content", "flows", "flows-empty", "diff-tab", "sequence-tab", "findings-tab", "findings-tab-count", "findings-view", "findings-back", "all-findings-empty", "all-findings-list", "activity-tab", "activity-tab-count", "activity-view", "activity-empty", "activity-list", "pull-request-tab", "pull-request-view", "pull-request-content", "large-diff-notice", "connection-banner", "diff-search", "status-filter", "review-filter", "test-files-filter", "tree-mode", "diff-layout", "filter-summary",
    "settings-menu", "prefetch-steps", "theme-select", "update-button", "update-label", "sessions-button", "sessions-dialog", "close-sessions", "show-archived-sessions", "sessions-list", "export-menu", "refresh-button", "close-button", "feedback-button", "closed-banner", "tour-empty", "tour-empty-title", "tour-empty-description", "agent-config", "tour-active", "start-tour", "include-architecture", "include-call-flows", "include-flows", "include-findings",
    "step-count", "progress-value", "phase-count", "phase-title", "phase-summary", "phase-files-details", "phase-files-count", "phase-files", "phase-finding-drawer", "phase-finding-count", "phase-finding-list", "step-anchor", "step-title", "step-objective", "tour-scroll", "planning-activity", "planning-activity-body", "planning-notes", "planning-note-list",
    "step-explanation", "agent-activity", "agent-activity-title", "agent-activity-body", "previous-step", "next-step", "chat-messages", "chat-form", "chat-input",
    "selection-pill", "comment-dialog", "comment-form", "comment-location", "comment-body", "cancel-comment", "finding-tooltip", "toast",
    "agent-name", "agent-mode", "agent-select", "model-select", "reasoning-select", "agent-note", "comment-drawer", "comment-list", "comment-count", "save-comment", "finding-drawer", "finding-list", "finding-count", "regenerate-flows", "flow-dialog", "flow-form", "flow-id", "flow-title", "flow-summary", "flow-provenance", "flow-blast-radius", "flow-affected-files", "flow-mermaid", "cancel-flow",
  ].map((id) => [id, document.getElementById(id)]),
);

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function compactText(value, limit) {
  const text = String(value).replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

function findingSummary(finding) {
  return compactText(finding.message, 220);
}

function renderInlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function renderMarkdown(value) {
  const output = [];
  let listType = null;
  const closeList = () => {
    if (listType) output.push(`</${listType}>`);
    listType = null;
  };
  for (const line of String(value).split("\n")) {
    const heading = /^\s*(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      closeList();
      const level = Math.min(6, heading[1].length + 1);
      output.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    const item = /^\s*([-*]|\d+[.)])\s+(.+)$/.exec(line);
    if (item) {
      const nextListType = /^\d/.test(item[1]) ? "ol" : "ul";
      if (listType !== nextListType) {
        closeList();
        output.push(`<${nextListType}>`);
        listType = nextListType;
      }
      output.push(`<li>${renderInlineMarkdown(item[2])}</li>`);
      continue;
    }
    closeList();
    if (line.trim()) output.push(`<p>${renderInlineMarkdown(line)}</p>`);
  }
  closeList();
  return output.join("");
}

function pullRequestDescription(body) {
  const value = body || "No description provided.";
  const rendered = state.prDescriptionMode === "rendered";
  return `<div class="description-mode" role="group" aria-label="Pull request description display">
    <button class="text-button${rendered ? " active" : ""}" type="button" data-pr-description-mode="rendered" aria-pressed="${rendered}">Rendered</button>
    <button class="text-button${rendered ? "" : " active"}" type="button" data-pr-description-mode="source" aria-pressed="${!rendered}">Source</button>
  </div>${rendered ? `<div class="rendered-markdown">${renderMarkdown(value)}</div>` : `<pre class="markdown-source">${escapeHtml(value)}</pre>`}`;
}

function setPullRequestDescriptionMode(event) {
  const button = event.target.closest("[data-pr-description-mode]");
  if (!button) return;
  state.prDescriptionMode = button.dataset.prDescriptionMode;
  renderPullRequest();
  renderReviewOverview();
}

async function api(path, options = {}) {
  if (!state.apiToken) throw new Error("This review URL is missing its session token. Reopen the URL printed by the server.");
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", "X-Review-Tour-Token": state.apiToken },
    ...options,
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || `Request failed: ${response.status}`);
  return value;
}

function toast(message, { duration = 3_500, tone = "default" } = {}) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("warning", tone === "warning");
  elements.toast.classList.remove("hidden");
  state.toastTimer = window.setTimeout(() => {
    elements.toast.classList.add("hidden");
    state.toastTimer = null;
  }, duration);
}

async function checkForUpdate() {
  if (state.updateInProgress) return;
  try {
    const status = await api("/api/update");
    if (!status.updateAvailable) return;
    elements["update-label"].textContent = `Update ${status.latestVersion}`;
    elements["update-button"].title = `Install Code Review Tour ${status.latestVersion}`;
    elements["update-button"].classList.remove("hidden", "updated");
    elements["update-button"].classList.add("available");
  } catch {
    // Update discovery must never interrupt a review.
  }
}

async function installUpdate() {
  if (state.updateInProgress) return;
  state.updateInProgress = true;
  const button = elements["update-button"];
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.classList.remove("available", "updated");
  button.classList.add("updating");
  elements["update-label"].textContent = "Updating…";
  try {
    const status = await api("/api/update", { method: "POST", body: "{}" });
    button.classList.remove("updating");
    button.classList.add("updated");
    elements["update-label"].textContent = `Updated ${status.latestVersion}`;
    button.title = "Restart Code Review Tour to use the new version";
    toast(`Code Review Tour ${status.latestVersion} is installed. Restart this review when convenient.`);
  } catch (error) {
    button.classList.remove("updating");
    button.classList.add("available");
    elements["update-label"].textContent = "Retry update";
    button.disabled = false;
    toast(error.message);
  } finally {
    state.updateInProgress = false;
    button.removeAttribute("aria-busy");
  }
}

function setBusy(busy, label = "Working…") {
  state.busy = busy;
  elements["start-tour"].disabled = busy;
  elements["previous-step"].disabled = busy && state.navigationDirection !== "next";
  elements["next-step"].disabled = busy;
  elements["agent-select"].disabled = busy;
  elements["model-select"].disabled = busy;
  elements["reasoning-select"].disabled = busy;
  elements["include-flows"].disabled = busy;
  elements["include-architecture"].disabled = busy;
  elements["include-call-flows"].disabled = busy;
  elements["include-findings"].disabled = busy || state.session?.findingGenerationEnabled === false;
  elements["tour-mode-toggle"].disabled = busy;
  elements["update-button"].disabled = busy || state.updateInProgress || elements["update-button"].classList.contains("updated");
  elements["refresh-button"].disabled = busy;
  elements["close-button"].disabled = busy;
  elements["feedback-button"].disabled = busy;
  elements["export-menu"].querySelectorAll("button").forEach((button) => { button.disabled = busy; });
  elements["regenerate-flows"].disabled = busy || !reviewIsOpen() || !state.session?.outline;
  elements["chat-form"].querySelector("button").disabled = busy || !reviewIsOpen();
  if (busy && !elements["tour-active"].classList.contains("hidden")) {
    elements["step-explanation"].innerHTML = `<span class="loading">${escapeHtml(label)}</span>`;
  }
  renderAgentActivity();
}

function renderAgentActivity() {
  const activity = state.session?.agentActivity;
  const visible = Boolean(activity && (state.busy || activity.status === "waiting" || activity.status === "running" || activity.status === "failed"));
  elements["agent-activity"].classList.toggle("hidden", !visible);
  if (!visible) return;
  const renderedActivityId = elements["agent-activity"].dataset.activityId;
  const promptWasOpen = renderedActivityId === activity.id && Boolean(elements["agent-activity-body"].querySelector(".agent-prompt")?.open);
  elements["agent-activity"].dataset.activityId = activity.id;
  const status = activity.localQueued ? "Question queued" : activity.status === "waiting" ? "Waiting for agent" : activity.status === "running" ? "Agent working" : activity.status === "failed" ? "Agent failed" : "Agent finished";
  const prefetchSteps = state.session.preferences?.prefetchSteps ?? 2;
  elements["agent-activity-title"].textContent = activity.kind === "tour.explanation" && activity.stepNumber && activity.totalSteps
    ? `${activity.status === "failed" ? "Agent failed. " : ""}${prefetchSteps === 0 ? "Preparing on demand." : `We prepare ${prefetchSteps} ${prefetchSteps === 1 ? "step" : "steps"} in advance.`} Preparing step ${activity.stepNumber} of ${activity.totalSteps}`
    : `${status} · ${activity.label}`;
  const elapsed = Math.max(0, Math.round((Date.now() - Date.parse(activity.startedAt)) / 1000));
  const appearsDisconnected = !activity.localQueued && activity.status === "waiting" && elapsed >= 60;
  const updates = activity.updates.map((update) => `<li><time>${escapeHtml(new Date(update.createdAt).toLocaleTimeString())}</time>${escapeHtml(update.message)}</li>`).join("");
  const contentKey = JSON.stringify({ id: activity.id, kind: activity.kind, status: activity.status, updates: activity.updates, error: activity.error, prompt: activity.prompt, promptTruncated: activity.promptTruncated, localQueued: activity.localQueued });
  if (elements["agent-activity-body"].dataset.contentKey !== contentKey) {
    elements["agent-activity-body"].innerHTML = `<div class="agent-activity-meta"><span class="agent-activity-elapsed"></span><span>${escapeHtml(activity.kind)}</span></div>
      ${updates ? `<ol class="agent-progress-list">${updates}</ol>` : '<p class="planning-live">The prompt is queued; no progress update has arrived yet.</p>'}
      <p class="agent-activity-warning hidden">No attached-agent heartbeat has arrived yet. If this continues, the tour will switch to a local fallback agent automatically.</p>
      ${activity.error ? `<p class="agent-activity-error">${escapeHtml(activity.error)}</p>` : ""}
      <details class="agent-prompt"${promptWasOpen ? " open" : ""}><summary>Current prompt</summary><pre>${escapeHtml(activity.prompt)}${activity.promptTruncated ? "\n\n[Prompt truncated in this view]" : ""}</pre></details>`;
    elements["agent-activity-body"].dataset.contentKey = contentKey;
  }
  elements["agent-activity-body"].querySelector(".agent-activity-elapsed").textContent = `${elapsed}s elapsed`;
  elements["agent-activity-body"].querySelector(".agent-activity-warning").classList.toggle("hidden", !appearsDisconnected);
}

async function loadSessions() {
  elements["sessions-list"].innerHTML = '<div class="empty compact">Loading sessions…</div>';
  try {
    const result = await api(`/api/sessions${elements["show-archived-sessions"].checked ? "?all=true" : ""}`);
    elements["sessions-list"].innerHTML = result.sessions.length === 0
      ? '<div class="empty compact">No matching sessions.</div>'
      : result.sessions.map((session) => `<article class="session-item" data-session-id="${escapeHtml(session.id)}">
        <div class="session-summary">
          <div><strong>${escapeHtml(session.name)}</strong><span>${escapeHtml(session.repositoryName)} · ${escapeHtml(session.base)}</span></div>
          <span class="session-status">${escapeHtml(session.archived ? "archived" : session.status)}</span>
        </div>
        <div class="session-detail"><span>${escapeHtml(session.id.slice(0, 8))}</span><span>${session.comments} feedback</span><span>${session.activities} changes</span><time datetime="${escapeHtml(session.updatedAt)}">${escapeHtml(new Date(session.updatedAt).toLocaleString())}</time></div>
        <div class="session-actions">
          <button type="button" class="text-button" data-session-action="copy">Copy reopen command</button>
          <button type="button" class="text-button" data-session-action="rename">Rename</button>
          <button type="button" class="text-button" data-session-action="${session.archived ? "unarchive" : "archive"}">${session.archived ? "Restore" : "Archive"}</button>
          <button type="button" class="text-button danger" data-session-action="delete">Delete</button>
        </div>
      </article>`).join("");
    if (result.invalid.length > 0) toast(`${result.invalid.length} unreadable session file(s) were ignored.`);
  } catch (error) {
    elements["sessions-list"].innerHTML = `<div class="empty compact">${escapeHtml(error.message)}</div>`;
  }
}

async function updateLibrarySession(id, action, name) {
  await api(`/api/sessions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ action, name }),
  });
  await loadSessions();
}

function reviewIsOpen() {
  return state.session?.status === "open";
}

function preferenceKey(name) {
  const repository = state.session.pullRequest?.sourceRepositoryRoot ?? state.session.comparison.repositoryRoot;
  return `review-tour:${repository}:${name}`;
}

const FILE_PANEL_MIN = 180;
const FILE_PANEL_MAX = 480;
const AGENT_PANEL_MIN = 320;
const AGENT_PANEL_MAX = 720;
const SPLIT_PANE_MIN = 20;
const SPLIT_PANE_MAX = 80;

function diffPanelMinimum() {
  return window.innerWidth <= 1050 ? 360 : 420;
}

function setFilePanelWidth(value, persist = false) {
  const viewportLimit = Math.max(FILE_PANEL_MIN, Math.min(FILE_PANEL_MAX, window.innerWidth - state.agentPanelWidth - diffPanelMinimum()));
  const width = Math.round(Math.max(FILE_PANEL_MIN, Math.min(viewportLimit, value)));
  state.filePanelWidth = width;
  elements.workspace.style.setProperty("--file-panel-width", `${width}px`);
  elements["file-resizer"].setAttribute("aria-valuenow", String(width));
  if (persist) window.localStorage.setItem(preferenceKey("file-panel-width"), String(width));
}

function setAgentPanelWidth(value, persist = false) {
  const viewportLimit = Math.max(AGENT_PANEL_MIN, Math.min(AGENT_PANEL_MAX, window.innerWidth - state.filePanelWidth - diffPanelMinimum()));
  const width = Math.round(Math.max(AGENT_PANEL_MIN, Math.min(viewportLimit, value)));
  state.agentPanelWidth = width;
  elements.workspace.style.setProperty("--agent-panel-width", `${width}px`);
  elements["agent-resizer"].setAttribute("aria-valuenow", String(width));
  if (persist) window.localStorage.setItem(preferenceKey("agent-panel-width"), String(width));
}

function setSplitOldWidth(value, persist = false) {
  const width = Math.round(Math.max(SPLIT_PANE_MIN, Math.min(SPLIT_PANE_MAX, value)));
  state.splitOldWidth = width;
  elements.diff.style.setProperty("--split-old-width", `${width}%`);
  elements.diff.querySelectorAll("[data-split-resizer]").forEach((resizer) => {
    resizer.setAttribute("aria-valuenow", String(width));
    resizer.setAttribute("aria-valuetext", `Old side ${width}%, new side ${100 - width}%`);
  });
  if (persist) window.localStorage.setItem(preferenceKey("split-old-width"), String(width));
}

function initializeUiPreferences() {
  const repository = state.session.pullRequest?.sourceRepositoryRoot ?? state.session.comparison.repositoryRoot;
  if (state.preferenceRepository === repository) return;
  state.preferenceRepository = repository;
  const savedLayout = window.localStorage.getItem(preferenceKey("diff-layout"));
  const savedTreeMode = window.localStorage.getItem(preferenceKey("tree-mode"));
  const savedFilePanelWidth = Number(window.localStorage.getItem(preferenceKey("file-panel-width")));
  const savedAgentPanelWidth = Number(window.localStorage.getItem(preferenceKey("agent-panel-width")));
  const savedSplitOldWidth = Number(window.localStorage.getItem(preferenceKey("split-old-width")));
  const legacyChangedOnly = window.localStorage.getItem(preferenceKey("changed-only"));
  state.diffLayout = ["unified", "split"].includes(savedLayout) ? savedLayout : state.session.preferences?.diffLayout ?? "split";
  state.treeMode = ["changes", "repository"].includes(savedTreeMode)
    ? savedTreeMode
    : legacyChangedOnly !== null
      ? (legacyChangedOnly === "true" ? "changes" : "repository")
      : state.session.preferences?.changedFilesOnly ? "changes" : "repository";
  setFilePanelWidth(Number.isFinite(savedFilePanelWidth) && savedFilePanelWidth > 0 ? savedFilePanelWidth : 240);
  setAgentPanelWidth(Number.isFinite(savedAgentPanelWidth) && savedAgentPanelWidth > 0 ? savedAgentPanelWidth : 420);
  setSplitOldWidth(Number.isFinite(savedSplitOldWidth) && savedSplitOldWidth > 0 ? savedSplitOldWidth : 50);
  setFilePanelWidth(state.filePanelWidth);
}

function fileContext(file) {
  return file._context ?? state.session.preferences?.contextLines ?? 3;
}

function treeFromFiles(repositoryFiles, changedFiles) {
  const root = {};
  const changedByPath = new Map(changedFiles.map((file) => [file.path, file]));
  for (const path of repositoryFiles) {
    const parts = path.split("/");
    let node = root;
    parts.forEach((part, index) => {
      node[part] ??= index === parts.length - 1 ? { __file: { path, changed: changedByPath.get(path) } } : {};
      node = node[part];
    });
  }
  for (const file of changedFiles) {
    if (changedByPath.has(file.path) && repositoryFiles.includes(file.path)) continue;
    const parts = file.path.split("/");
    let node = root;
    parts.forEach((part, index) => {
      node[part] ??= index === parts.length - 1 ? { __file: { path: file.path, changed: file } } : {};
      node = node[part];
    });
  }
  return root;
}

function renderChangedFileEntry(file, label, flat = false) {
  const reviewed = state.session.reviewedFiles?.includes(file.path);
  const parts = file.path.split("/");
  const basename = parts.pop() ?? file.path;
  const display = flat && parts.length > 0
    ? `<span class="path-prefix">${escapeHtml(`${parts.join("/")}/`)}</span><span class="path-basename">${escapeHtml(basename)}</span>`
    : escapeHtml(label);
  return `<div class="file-entry${flat ? " flat-path" : ""}${reviewed ? " reviewed" : ""}"><button class="file-button" data-file="${escapeHtml(file.path)}">
    <span class="file-name" title="${escapeHtml(file.path)}">${display}</span>
    <span class="file-stats"><span class="plus">+${file.additions}</span> <span class="minus">-${file.deletions}</span></span>
  </button><button class="review-toggle" type="button" data-review-file="${escapeHtml(file.path)}" aria-label="${escapeHtml(`${reviewed ? "Mark unreviewed" : "Mark reviewed"}: ${file.path}`)}" title="${reviewed ? "Mark unreviewed" : "Mark reviewed"}"${reviewIsOpen() ? "" : " disabled"}>${reviewed ? "✓" : "○"}</button></div>`;
}

function renderChangedPathList(files) {
  return [...files].sort((left, right) => left.path.localeCompare(right.path))
    .map((file) => renderChangedFileEntry(file, file.path, true))
    .join("");
}

function isTestFile(path) {
  const normalized = String(path).replaceAll("\\", "/");
  const parts = normalized.split("/");
  const filename = parts.at(-1) ?? "";
  const testDirectory = parts.slice(0, -1).some((part) => /^(?:__tests__|tests?|specs?|testfixtures|commontest|androidtest|jvmtest|iostest|jstest|wasmtest|wasmjstest|desktoptest)$/i.test(part));
  const testFilename = /(?:^|[._-])(?:test|tests|spec|specs)(?:[._-]|$)/i.test(filename)
    || /(?:Test|Tests|Spec)\.[^.]+$/.test(filename)
    || /^Test[A-Z0-9_].*\.[^.]+$/.test(filename);
  return testDirectory || testFilename;
}

function renderTreeNode(node, depth = 0, expandAll = false) {
  return Object.entries(node)
    .sort(([a, av], [b, bv]) => Number(Boolean(av.__file)) - Number(Boolean(bv.__file)) || a.localeCompare(b))
    .map(([name, value]) => {
      if (value.__file) {
        const file = value.__file;
        if (!file.changed) return `<button class="file-button unchanged" data-source="${escapeHtml(file.path)}" title="${escapeHtml(file.path)}"><span class="file-name">${escapeHtml(name)}</span></button>`;
        return renderChangedFileEntry(file.changed, name);
      }
      return `<details class="tree-directory" ${expandAll || depth === 0 ? "open" : ""}><summary>${escapeHtml(name)}</summary><div class="tree-children">${renderTreeNode(value, depth + 1, expandAll)}</div></details>`;
    })
    .join("");
}

function filteredChangedFiles() {
  const reviewed = new Set(state.session.reviewedFiles ?? []);
  const searchMatches = state.searchQuery && state.searchMatches ? new Set(state.searchMatches) : null;
  const phasePaths = state.tourMode ? new Set(currentPhase()?.fileChanges.map((change) => change.path) ?? []) : null;
  if (phasePaths) return state.session.comparison.files.filter((file) => phasePaths.has(file.path));
  return state.session.comparison.files.filter((file) =>
    (!state.statusFilter || file.status === state.statusFilter) &&
    (!state.reviewFilter || (state.reviewFilter === "reviewed") === reviewed.has(file.path)) &&
    (!state.testFilesOnly || isTestFile(file.path)) &&
    (!searchMatches || searchMatches.has(file.path))
  );
}

function renderFileTree() {
  const comparison = state.session.comparison;
  const changedFiles = filteredChangedFiles();
  const filtering = !state.tourMode && Boolean(state.searchQuery || state.statusFilter || state.reviewFilter || state.testFilesOnly);
  const changedPathsOnly = state.tourMode || state.treeMode === "changes" || filtering;
  const repositoryFiles = changedPathsOnly
    ? changedFiles.map((file) => file.path)
    : comparison.repositoryFiles ?? comparison.files.map((file) => file.path);
  elements["file-tree"].innerHTML = changedPathsOnly
    ? renderChangedPathList(changedFiles)
    : renderTreeNode(treeFromFiles(repositoryFiles, changedFiles));
  const reviewedCount = (state.session.reviewedFiles ?? []).length;
  const scopeTotal = state.tourMode ? currentPhase()?.fileChanges.length ?? changedFiles.length : comparison.files.length;
  elements["file-count"].textContent = filtering
    ? `${changedFiles.length}/${scopeTotal} match`
    : state.tourMode ? `${scopeTotal} in phase` : `${comparison.files.length} changed · ${reviewedCount} reviewed`;
  elements["filter-summary"].textContent = state.tourMode
    ? `${changedFiles.length} file${changedFiles.length === 1 ? "" : "s"} in this phase · ${reviewedCount} reviewed overall`
    : `${changedFiles.length} of ${comparison.files.length} changed files · ${reviewedCount} reviewed`;
}

function rowLine(row) {
  return row.kind === "addition" ? row.newLine : row.kind === "deletion" ? row.oldLine : row.newLine;
}

function rowSide(row) {
  return row.kind === "deletion" ? "old" : "new";
}

function findingPins(file, row, side, findings) {
  const line = side === "old" ? row?.oldLine : row?.newLine;
  return findings
    .filter((finding) => finding.path === file.path && finding.side === side && finding.line === line && finding.status !== "dismissed")
    .map((finding) => {
      const summary = findingSummary(finding);
      return `<button class="finding-pin ${finding.priority.toLowerCase()}" data-finding-id="${escapeHtml(finding.id)}" data-tooltip="${escapeHtml(summary)}" aria-label="${escapeHtml(`${finding.priority} finding: ${summary}`)}" aria-describedby="finding-tooltip">${finding.priority}</button>`;
    }).join("");
}

function lineTools(file, side, line) {
  if (!line || state.proposalPreview) return "";
  const askDisabled = !state.session.outline || !reviewIsOpen();
  return `<span class="line-tools" role="group" aria-label="Actions for ${escapeHtml(`${file.path}, ${side} line ${line}`)}">
    <button type="button" data-line-tool="comment" tabindex="-1">Comment</button>
    <button type="button" data-line-tool="ask" tabindex="-1"${askDisabled ? ' disabled title="Start a tour to ask the agent about this line."' : ""}>Ask agent</button>
  </span>`;
}

function renderUnifiedRow(file, row, findings) {
  const line = rowLine(row);
  const side = rowSide(row);
  const prefix = row.kind === "addition" ? "+" : row.kind === "deletion" ? "−" : " ";
  return `<div class="diff-row ${row.kind}" data-path="${escapeHtml(file.path)}" data-side="${side}" data-line="${line ?? ""}" data-content="${escapeHtml(row.content)}">
    <span class="line-number">${row.oldLine ?? ""}</span><span class="line-number">${row.newLine ?? ""}</span>
    <button class="line-prefix line-action" type="button" tabindex="-1"${line && !state.proposalPreview ? ` aria-describedby="diff-instructions" aria-label="${escapeHtml(`Review ${file.path}, ${side} line ${line}`)}"` : " disabled"}><span class="row-prefix">${prefix}</span><span class="review-dot hidden">●</span></button>
    <span class="finding-markers">${findingPins(file, row, side, findings)}</span><pre class="line-code">${escapeHtml(row.content || " ")}</pre>${lineTools(file, side, line)}
  </div>`;
}

function splitRows(rows) {
  const pairs = [];
  for (let index = 0; index < rows.length;) {
    const row = rows[index];
    if (row.kind === "context") { pairs.push([row, row]); index += 1; continue; }
    if (row.kind === "meta") { pairs.push([row, row]); index += 1; continue; }
    const removed = [];
    const added = [];
    while (index < rows.length && rows[index].kind !== "context" && rows[index].kind !== "meta") {
      if (rows[index].kind === "deletion") removed.push(rows[index]); else added.push(rows[index]);
      index += 1;
    }
    for (let pair = 0; pair < Math.max(removed.length, added.length); pair += 1) pairs.push([removed[pair] ?? null, added[pair] ?? null]);
  }
  return pairs;
}

function renderSplitSide(file, row, side, findings) {
  const line = side === "old" ? row?.oldLine : row?.newLine;
  const content = row?.content ?? "";
  const kind = row?.kind ?? "split-empty";
  const prefix = kind === "addition" ? "+" : kind === "deletion" ? "−" : " ";
  return `<div class="diff-row split-side ${kind}" data-path="${escapeHtml(file.path)}" data-side="${side}" data-line="${line ?? ""}" data-content="${escapeHtml(content)}">
    <span class="line-number">${line ?? ""}</span>
    <button class="line-prefix line-action" type="button" tabindex="-1"${line && !state.proposalPreview ? ` aria-describedby="diff-instructions" aria-label="${escapeHtml(`Review ${file.path}, ${side} line ${line}`)}"` : " disabled"}><span class="row-prefix">${prefix}</span><span class="review-dot hidden">●</span></button>
    <span class="finding-markers">${row ? findingPins(file, row, side, findings) : ""}</span><pre class="line-code">${escapeHtml(content || " ")}</pre>${lineTools(file, side, line)}
  </div>`;
}

function renderDiff(files) {
  const findings = state.proposalPreview ? [] : state.session.outline?.findings ?? [];
  elements.diff.innerHTML = files
    .map((file) => {
      const collapsed = !state.proposalPreview && state.collapsedFiles.has(file.path);
      return `<section class="diff-file${collapsed ? " collapsed" : ""}" id="file-${CSS.escape(file.path)}" data-path="${escapeHtml(file.path)}">
      <header class="diff-file-header">
        <button class="diff-file-toggle" type="button" data-collapse-file="${escapeHtml(file.path)}" aria-expanded="${!collapsed}" aria-label="${escapeHtml(`${collapsed ? "Expand" : "Collapse"} ${file.path}`)}"><span class="collapse-caret" aria-hidden="true">⌄</span><span class="diff-file-title"><span class="status">${escapeHtml(file.status)}</span>${escapeHtml(file.path)}</span></button>
        <span class="file-stats">${state.proposalPreview ? '<span class="proposal-label">pending proposal</span> · ' : `<button class="text-button" type="button" data-file-expansion="${file._full ? "compact" : "full"}" data-expand-file="${escapeHtml(file.path)}">${file._full ? "Collapse file" : "Expand file"}</button> · <button class="text-button review-file-button" type="button" data-reviewed-file="${escapeHtml(file.path)}"${reviewIsOpen() ? "" : " disabled"}>${state.session.reviewedFiles?.includes(file.path) ? "✓ Reviewed" : "Mark reviewed"}</button> · `}${file._page && file._page.totalRows > file._page.limit ? `<button class="text-button" type="button" data-diff-page="${Math.max(0, file._page.offset - file._page.limit)}" data-page-file="${escapeHtml(file.path)}" data-context="${fileContext(file)}" data-page-full="${Boolean(file._full)}"${file._page.offset === 0 ? " disabled" : ""}>Previous chunk</button> <span>${file._page.offset + 1}–${Math.min(file._page.totalRows, file._page.offset + file._page.limit)} of ${file._page.totalRows}</span> <button class="text-button" type="button" data-diff-page="${file._page.offset + file._page.limit}" data-page-file="${escapeHtml(file.path)}" data-context="${fileContext(file)}" data-page-full="${Boolean(file._full)}"${file._page.offset + file._page.limit >= file._page.totalRows ? " disabled" : ""}>Next chunk</button> · ` : ""}<span class="plus">+${file.additions}</span> <span class="minus">-${file.deletions}</span></span>
      </header>
      <div class="diff-file-scroll">
      ${file.hunks.map((hunk) => `<div class="hunk ${state.diffLayout}-layout">
        <div class="hunk-header"><span>${escapeHtml(hunk.header)}</span>${!state.proposalPreview && !file._full && fileContext(file) < 200 ? `<button class="text-button" type="button" data-expand-context="${escapeHtml(file.path)}" data-context="${fileContext(file)}">Expand context</button>` : ""}</div>
        ${state.diffLayout === "split"
          ? `<div class="split-resizer" data-split-resizer role="separator" aria-label="Resize old and new diff panes" aria-orientation="vertical" aria-valuemin="${SPLIT_PANE_MIN}" aria-valuemax="${SPLIT_PANE_MAX}" aria-valuenow="${state.splitOldWidth}" aria-valuetext="Old side ${state.splitOldWidth}%, new side ${100 - state.splitOldWidth}%" tabindex="0"></div>${splitRows(hunk.rows).map(([oldRow, newRow]) => `<div class="split-row">${renderSplitSide(file, oldRow, "old", findings)}${renderSplitSide(file, newRow, "new", findings)}</div>`).join("")}`
          : hunk.rows.map((row) => renderUnifiedRow(file, row, findings)).join("")}
      </div>`).join("")}
      </div>
    </section>`;
    })
    .join("");
  const actions = [...elements.diff.querySelectorAll(".line-action:not(:disabled)")];
  const selected = actions.find((action) => action.closest(".diff-row")?.classList.contains("selected")) ?? actions[0];
  if (selected) selected.tabIndex = 0;
  elements["empty-diff"].classList.toggle("hidden", files.length > 0);
  void highlightRenderedCode();
}

function syntaxTokenHtml(token) {
  const styles = [token.fontStyle & 1 ? "syntax-italic" : "", token.fontStyle & 2 ? "syntax-bold" : "", token.fontStyle & 4 ? "syntax-underline" : ""].filter(Boolean).join(" ");
  return `<span class="syntax-token sl-${escapeHtml(token.light)} sd-${escapeHtml(token.dark)} ${styles}">${escapeHtml(token.content)}</span>`;
}

async function highlightRenderedCode() {
  const requestId = ++state.highlightRequestId;
  const groups = [...elements.diff.querySelectorAll(".diff-file")].flatMap((section, index) => {
    const nodes = [...section.querySelectorAll(".line-code")];
    if (nodes.length === 0) return [];
    const id = `diff-${index}`;
    nodes.forEach((node) => { node.dataset.highlightGroup = id; });
    return [{ id, path: section.dataset.path, lines: nodes.map((node) => node.textContent ?? "") }];
  });
  const source = elements.diff.querySelector(".source-file .source-code");
  if (source) {
    const lines = (source.textContent ?? "").split("\n");
    source.dataset.highlightGroup = "source";
    groups.push({ id: "source", path: source.closest(".source-file")?.dataset.path ?? "source.txt", lines });
  }
  if (groups.length === 0 || groups.reduce((sum, group) => sum + group.lines.length, 0) > 12_000) return;
  try {
    const result = await api("/api/highlight", { method: "POST", body: JSON.stringify({ groups }) });
    if (requestId !== state.highlightRequestId) return;
    for (const group of result.groups) {
      if (group.id === "source") {
        const target = elements.diff.querySelector('.source-code[data-highlight-group="source"]');
        if (target) target.innerHTML = group.lines.map((line) => line.map(syntaxTokenHtml).join("")).join("\n");
        continue;
      }
      const nodes = [...elements.diff.querySelectorAll(`.line-code[data-highlight-group="${CSS.escape(group.id)}"]`)];
      group.lines.forEach((line, index) => { if (nodes[index]) nodes[index].innerHTML = line.map(syntaxTokenHtml).join("") || " "; });
    }
  } catch {
    // Raw escaped source remains readable if highlighting is unavailable.
  }
}

function visibleDiffFiles() {
  const comparison = state.session.comparison;
  const files = filteredChangedFiles();
  if (comparison.diffMode !== "file") return files.map((file) => state.diffCache.get(file.path) ?? file);
  if (state.tourMode) return files.map((file) => state.diffCache.get(file.path)).filter(Boolean);
  const candidates = [state.visibleFile, currentStep()?.anchor.path];
  const path = candidates.find((candidate) => files.some((file) => file.path === candidate)) ?? files[0]?.path;
  state.visibleFile = path;
  const cached = state.diffCache.get(path);
  return cached ? [cached] : [];
}

async function ensureTourPhaseDiffs() {
  if (!state.tourMode || state.session.comparison.diffMode !== "file") return;
  const phase = currentPhase();
  if (!phase) return;
  const key = `${state.session.revision}:${phase.id}`;
  if (state.phaseDiffLoadKey === key && state.phaseDiffLoadPromise) return state.phaseDiffLoadPromise;
  const missing = phase.fileChanges.map((change) => change.path).filter((path) => !state.diffCache.has(path));
  if (missing.length === 0) return;
  const requestId = ++state.fileRequestId;
  const load = (async () => {
    elements.diff.innerHTML = '<div class="empty">Loading this phase’s diffs…</div>';
    const results = await Promise.allSettled(missing.map(async (path) => {
      const result = await api(`/api/diff?${new URLSearchParams({ path })}`);
      return [path, { ...result.file, _context: result.context, _full: result.full, _page: { offset: result.offset, limit: result.limit, totalRows: result.totalRows } }];
    }));
    if (requestId !== state.fileRequestId || !state.tourMode || currentPhase()?.id !== phase.id) return;
    let failures = 0;
    for (const result of results) {
      if (result.status === "fulfilled") state.diffCache.set(result.value[0], result.value[1]);
      else failures += 1;
    }
    renderDiff(visibleDiffFiles());
    renderComments();
    renderFindings();
    renderTourAnnotation();
    if (failures > 0) toast(`Could not load ${failures} phase diff${failures === 1 ? "" : "s"}.`);
  })();
  state.phaseDiffLoadKey = key;
  state.phaseDiffLoadPromise = load;
  try { await load; } finally {
    if (state.phaseDiffLoadPromise === load) {
      state.phaseDiffLoadKey = null;
      state.phaseDiffLoadPromise = null;
    }
  }
}

function captureFileViewport(path) {
  const panel = elements["diff-panel"];
  const header = elements.diff.querySelector(`.diff-file[data-path="${CSS.escape(path)}"] > .diff-file-header`);
  if (!header) return null;
  return {
    path,
    scrollTop: panel.scrollTop,
    headerOffset: header.getBoundingClientRect().top - panel.getBoundingClientRect().top,
  };
}

function restoreFileViewport(anchor) {
  if (!anchor) return;
  const panel = elements["diff-panel"];
  panel.scrollTop = anchor.scrollTop;
  const header = elements.diff.querySelector(`.diff-file[data-path="${CSS.escape(anchor.path)}"] > .diff-file-header`);
  if (!header) return;
  const currentOffset = header.getBoundingClientRect().top - panel.getBoundingClientRect().top;
  panel.scrollTop += currentOffset - anchor.headerOffset;
}

async function showChangedFile(path, line, side, requestedOffset, requestedContext, requestedFull) {
  if (state.tourMode && !filteredChangedFiles().some((file) => file.path === path)) {
    toast("That file belongs to another phase. Exit the tour to browse every changed file.", { duration: 9_000, tone: "warning" });
    return;
  }
  const requestId = ++state.fileRequestId;
  const viewportAnchor = requestedFull !== undefined ? captureFileViewport(path) : null;
  const expansionButton = viewportAnchor
    ? elements.diff.querySelector(`[data-expand-file="${CSS.escape(path)}"]`)
    : null;
  const expansionLabel = expansionButton?.textContent;
  if (expansionButton) {
    expansionButton.disabled = true;
    expansionButton.setAttribute("aria-busy", "true");
    expansionButton.textContent = requestedFull ? "Expanding…" : "Collapsing…";
  }
  state.collapsedFiles.delete(path);
  state.activeTab = "diff";
  state.proposalPreview = false;
  state.visibleFile = path;
  renderActiveTab();
  let files = filteredChangedFiles();
  if (state.session.comparison.diffMode === "file" || requestedContext !== undefined || requestedFull !== undefined) {
    let file = state.diffCache.get(path);
    const containsAnchor = !line || !side || file?.hunks.some((hunk) => hunk.rows.some((row) => (side === "old" ? row.oldLine : row.newLine) === line));
    if (!file || requestedOffset !== undefined || requestedContext !== undefined || requestedFull !== undefined || !containsAnchor) {
      if (!viewportAnchor) {
        elements.diff.innerHTML = '<div class="empty">Loading file diff…</div>';
        elements["empty-diff"].classList.add("hidden");
      }
      try {
        const query = new URLSearchParams({ path });
        if (requestedOffset !== undefined) query.set("offset", String(requestedOffset));
        if (requestedContext !== undefined) query.set("context", String(requestedContext));
        if (requestedFull !== undefined) query.set("full", String(requestedFull));
        if (line && side) { query.set("line", String(line)); query.set("side", side); }
        const result = await api(`/api/diff?${query}`);
        if (requestId !== state.fileRequestId || state.visibleFile !== path) return;
        file = { ...result.file, _context: result.context, _full: result.full, _page: { offset: result.offset, limit: result.limit, totalRows: result.totalRows } };
        state.diffCache.set(path, file);
      } catch (error) {
        if (expansionButton?.isConnected) {
          expansionButton.disabled = false;
          expansionButton.removeAttribute("aria-busy");
          expansionButton.textContent = expansionLabel;
        }
        if (requestId === state.fileRequestId) toast(error.message);
        return;
      }
    }
    files = state.tourMode || state.session.comparison.diffMode !== "file" ? visibleDiffFiles() : [file];
  } else if (!files.some((file) => file.path === path)) {
    const requested = state.session.comparison.files.find((file) => file.path === path);
    files = requested ? [requested] : files;
  }
  renderDiff(files);
  renderComments();
  renderFindings();
  if (!viewportAnchor) document.querySelector(`.diff-file[data-path="${CSS.escape(path)}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  if (line && side) {
    const row = document.querySelector(`.diff-row[data-path="${CSS.escape(path)}"][data-side="${side}"][data-line="${line}"]`);
    row?.scrollIntoView({ behavior: "smooth", block: "center" });
    row?.classList.add("selected");
  }
  renderTourAnnotation();
  if (viewportAnchor) restoreFileViewport(viewportAnchor);
}

async function showRepositoryFile(path) {
  state.activeTab = "diff";
  state.proposalPreview = false;
  renderActiveTab();
  const requestId = ++state.fileRequestId;
  elements.diff.innerHTML = '<div class="empty">Loading source…</div>';
  try {
    const file = await api(`/api/files?path=${encodeURIComponent(path)}`);
    if (requestId !== state.fileRequestId) return;
    elements.diff.innerHTML = `<section class="source-file" data-path="${escapeHtml(path)}"><header class="diff-file-header"><span class="diff-file-title">${escapeHtml(path)}</span><span class="muted">unchanged</span></header><pre class="source-code">${escapeHtml(file.content)}</pre></section>`;
    elements["empty-diff"].classList.add("hidden");
    void highlightRenderedCode();
  } catch (error) {
    if (requestId === state.fileRequestId) toast(error.message);
  }
}

async function showActivityFile(activityId, path) {
  const requestId = ++state.fileRequestId;
  state.activeTab = "diff";
  state.proposalPreview = true;
  renderActiveTab();
  elements.diff.innerHTML = '<div class="empty">Loading proposed diff…</div>';
  elements["empty-diff"].classList.add("hidden");
  try {
    const result = await api(`/api/activities/${encodeURIComponent(activityId)}/diff?path=${encodeURIComponent(path)}`);
    if (requestId !== state.fileRequestId || !state.proposalPreview) return;
    renderDiff([result.file]);
    document.querySelector(`.diff-file[data-path="${CSS.escape(path)}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    if (requestId === state.fileRequestId) toast(error.message);
  }
}

function currentStep() {
  const { outline, currentStepIndex } = state.session;
  return outline?.phases.flatMap((phase) => phase.steps)[currentStepIndex];
}

function currentPhase() {
  const step = currentStep();
  return state.session.outline?.phases.find((phase) => phase.steps.some((candidate) => candidate.id === step?.id));
}

function selectedAdapter() {
  return state.session.agentAdapters.find((adapter) => adapter.id === elements["agent-select"].value)
    ?? state.session.agentAdapters[0];
}

function renderReasoningOptions() {
  const adapter = selectedAdapter();
  const model = adapter?.models.find((candidate) => candidate.id === elements["model-select"].value)
    ?? adapter?.models[0];
  const selected = state.session.agentSelection && state.session.agentSelection.adapterId === adapter?.id && state.session.agentSelection.modelId === model?.id
    ? state.session.agentSelection.reasoningEffort ?? ""
    : model?.defaultReasoningEffort ?? "";
  elements["reasoning-select"].innerHTML = [
    '<option value="">CLI default</option>',
    ...(model?.reasoningEfforts ?? []).map((effort) => `<option value="${escapeHtml(effort)}">${escapeHtml(effort)}</option>`),
  ].join("");
  elements["reasoning-select"].value = model?.reasoningEfforts.includes(selected) ? selected : "";
  elements["reasoning-select"].disabled = state.busy || !reviewIsOpen() || (model?.reasoningEfforts.length ?? 0) === 0;
}

function renderModelOptions() {
  const adapter = selectedAdapter();
  const selected = state.session.agentSelection && state.session.agentSelection.adapterId === adapter?.id
    ? state.session.agentSelection.modelId
    : adapter?.models.find((model) => model.isDefault)?.id;
  elements["model-select"].innerHTML = (adapter?.models ?? [])
    .map((model) => `<option value="${escapeHtml(model.id)}">${escapeHtml(model.label)}${model.isDefault ? " · default" : ""}</option>`)
    .join("");
  if (selected) elements["model-select"].value = selected;
  const policy = state.session.reviewPolicy;
  const policyNote = policy
    ? `Policy: ${policy.instructions.length} instruction${policy.instructions.length === 1 ? "" : "s"}; findings ${policy.findings.enabled ? `${policy.findings.minimumSeverity}+ in ${policy.findings.categories.join(", ") || "no categories"}` : "disabled"}.`
    : "";
  elements["agent-note"].textContent = [adapter ? adapter.note ?? "" : "Install Codex, Claude Code, Gemini, or Copilot, then restart the server.", policyNote].filter(Boolean).join(" ");
  elements["agent-name"].textContent = adapter?.label ?? "No agent detected";
  renderReasoningOptions();
}

function renderAgentOptions() {
  const adapters = state.session.agentAdapters ?? [];
  const findingGenerationEnabled = state.session.findingGenerationEnabled !== false;
  const selected = state.session.agentSelection?.adapterId ?? adapters[0]?.id;
  elements["agent-select"].innerHTML = adapters
    .map((adapter) => `<option value="${escapeHtml(adapter.id)}">${escapeHtml(adapter.label)}</option>`)
    .join("");
  if (selected) elements["agent-select"].value = selected;
  elements["agent-select"].disabled = state.busy || !reviewIsOpen();
  elements["model-select"].disabled = state.busy || !reviewIsOpen();
  if (!findingGenerationEnabled) elements["include-findings"].checked = false;
  elements["include-findings"].disabled = state.busy || !reviewIsOpen() || !findingGenerationEnabled;
  elements["start-tour"].disabled = state.busy || !reviewIsOpen() || adapters.length === 0;
  if (adapters.length === 0) elements["agent-note"].textContent = "Install Codex, Claude Code, Gemini, or Copilot, then restart the server.";
  renderModelOptions();
}

function renderComments() {
  document.querySelectorAll(".split-inline-comment").forEach((comment) => comment.remove());
  document.querySelectorAll(".inline-comment").forEach((comment) => comment.remove());
  document.querySelectorAll(".diff-row.has-comment").forEach((row) => {
    row.classList.remove("has-comment");
    row.querySelector(".review-dot")?.classList.add("hidden");
    row.querySelector(".line-action")?.removeAttribute("data-inline-comment-id");
    row.removeAttribute("title");
  });
  for (const comment of state.session.comments) {
    const selector = `.diff-row[data-path="${CSS.escape(comment.path)}"][data-side="${comment.side}"][data-line="${comment.line}"]`;
    const row = document.querySelector(selector);
    if (!row) continue;
    row.classList.add("has-comment");
    row.title = comment.body;
    row.querySelector(".review-dot")?.classList.remove("hidden");
    const action = row.querySelector(".line-action");
    if (action) {
      action.dataset.inlineCommentId = comment.id;
      action.setAttribute("aria-label", `Edit comment at ${comment.path}, ${comment.side} line ${comment.line}`);
    }
    const inline = document.createElement("article");
    inline.className = `inline-comment ${comment.status}`;
    inline.innerHTML = `<button class="inline-comment-button" type="button" data-inline-comment-id="${escapeHtml(comment.id)}" aria-label="${escapeHtml(`Edit comment at ${comment.path}:${comment.line}`)}"><span class="inline-comment-label">Review comment</span><p>${renderInlineMarkdown(comment.body)}</p><span class="inline-comment-edit">Edit</span></button>`;
    const splitRow = row.closest(".split-row");
    if (splitRow) {
      const lane = document.createElement("div");
      lane.className = `split-inline-comment ${comment.side}-side`;
      lane.append(inline);
      splitRow.insertAdjacentElement("afterend", lane);
    } else {
      row.insertAdjacentElement("afterend", inline);
    }
  }
  elements["comment-count"].textContent = String(state.session.comments.length);
  elements["comment-drawer"].classList.toggle("hidden", state.session.comments.length === 0);
  const closed = !reviewIsOpen();
  const disabled = closed ? " disabled" : "";
  elements["comment-list"].innerHTML = state.session.comments.length === 0
    ? '<p class="comment-empty">Select a changed line, then select it again to add feedback.</p>'
    : state.session.comments.map((comment) => `<article class="comment-item ${escapeHtml(comment.status)}" data-comment-id="${escapeHtml(comment.id)}">
      <div class="comment-meta"><button class="comment-jump" data-action="jump" type="button">${escapeHtml(comment.path)}:${comment.line}</button><span class="comment-status">${escapeHtml(comment.status)}</span></div>
      <p>${renderInlineMarkdown(comment.body)}</p>
      ${state.session.pullRequest ? `<label class="toggle-control"><input data-action="github" type="checkbox"${comment.publishToGitHub ? " checked" : ""}${disabled} /> Include in GitHub review</label>` : ""}
      <div class="comment-actions">
        <button class="text-button" data-action="edit" type="button"${disabled}>Edit</button>
        <button class="text-button danger" data-action="delete" type="button"${disabled}>Delete</button>
      </div>
    </article>`).join("");
}

function renderPullRequest() {
  const pullRequest = state.session.pullRequest;
  elements["pull-request-tab"].classList.toggle("hidden", !pullRequest);
  if (!pullRequest) {
    if (state.activeTab === "pull-request") state.activeTab = "diff";
    elements["pull-request-content"].innerHTML = "";
    return;
  }
  const checks = pullRequest.checks.length === 0 ? "<li>No checks reported.</li>" : pullRequest.checks.map((check) => `<li><strong>${escapeHtml(check.name)}</strong> — ${escapeHtml(check.state)}</li>`).join("");
  const commits = pullRequest.commits.length === 0 ? "<li>No commits reported.</li>" : pullRequest.commits.map((commit) => `<li><code>${escapeHtml(commit.oid.slice(0, 8))}</code> ${escapeHtml(commit.headline)} <span class="muted">${escapeHtml(commit.authors.join(", "))}</span></li>`).join("");
  const threads = pullRequest.threads.length === 0 ? "<p class=\"muted\">No existing review threads.</p>" : pullRequest.threads.map((thread) => `<article class="comment-item"><div class="comment-meta"><span>${escapeHtml(thread.path)}${thread.line ? `:${thread.line}` : ""}</span><span>${thread.resolved ? "resolved" : "open"}</span></div>${thread.comments.map((comment) => `<p><strong>${escapeHtml(comment.author)}</strong>: ${renderInlineMarkdown(comment.body)}</p>`).join("")}</article>`).join("");
  elements["pull-request-content"].innerHTML = `
    <div class="panel-heading"><div><div class="eyebrow">GitHub pull request</div><h2>#${pullRequest.number} ${escapeHtml(pullRequest.title)}</h2></div><span class="mode">${escapeHtml(pullRequest.reviewDecision ?? "REVIEW REQUIRED")}</span></div>
    <p class="muted">${escapeHtml(pullRequest.repository)} · ${escapeHtml(pullRequest.author)} · ${escapeHtml(pullRequest.baseRefName)} ← ${escapeHtml(pullRequest.headRefName)} · ${escapeHtml(pullRequest.headRefOid.slice(0, 8))}</p>
    <div class="pull-request-body">${pullRequestDescription(pullRequest.body)}</div>
    <h3>Checks</h3><ul>${checks}</ul>
    <h3>Commits</h3><ul>${commits}</ul>
    <h3>Existing review threads${pullRequest.threadsTruncated ? " (first 100)" : ""}</h3>${threads}`;
}

function renderReviewOverview() {
  const outline = state.session.outline;
  const pullRequest = state.session.pullRequest;
  elements["review-overview"].classList.toggle("hidden", !outline && !pullRequest);
  elements["tour-overview"].classList.toggle("hidden", !outline);
  if (outline) {
    elements["review-overview-title"].textContent = outline.title;
    elements["review-overview-summary"].textContent = outline.summary;
    elements["tour-mode-toggle"].textContent = state.tourMode ? "Exit tour" : "Resume tour";
    elements["tour-mode-toggle"].setAttribute("aria-pressed", String(Boolean(state.tourMode)));
  }
  elements["pull-request-description"].classList.toggle("hidden", !pullRequest);
  if (pullRequest) {
    elements["pull-request-description-body"].innerHTML = pullRequestDescription(pullRequest.body);
  }
}

function findingCards(findings, compact = false) {
  const disabled = reviewIsOpen() ? "" : " disabled";
  const ordered = [...findings].sort((left, right) => left.priority.localeCompare(right.priority) || left.path.localeCompare(right.path) || left.line - right.line);
  return ordered.length === 0
    ? '<p class="comment-empty">No findings in this scope.</p>'
    : ordered.map((finding) => {
      const focused = finding.id === state.focusedFindingId;
      const classes = `finding-item ${finding.priority.toLowerCase()} ${escapeHtml(finding.status)}${finding.outdated ? " outdated" : ""}${focused ? " focused" : ""}`;
      const body = `<div class="finding-heading"><button class="comment-jump" data-action="jump" type="button">${escapeHtml(finding.path)}:${finding.line}</button><span class="finding-priority">${finding.priority}</span></div>
      <strong>${escapeHtml(finding.category)} · ${escapeHtml(finding.severity)}</strong>
      <p>${renderInlineMarkdown(finding.message)}</p>
      <details><summary>Evidence · ${escapeHtml(finding.confidence)} confidence</summary><p>${renderInlineMarkdown(finding.evidence)}</p></details>
      <div class="finding-badges"><span>${finding.introduced === true ? "introduced" : finding.introduced === false ? "pre-existing" : "attribution unknown"}</span><span>${finding.tested ? "tested" : "untested"}</span><span>blast ${finding.blastRadiusSize}</span><span>${escapeHtml(finding.pinScope)} pin</span>${finding.recallGuard ? "<span>recall-protected</span>" : ""}${finding.outdated ? "<span>outdated</span>" : ""}</div>
      <div class="comment-actions">
        ${finding.status === "open" ? `<button class="text-button" data-action="convert" type="button"${disabled}${finding.outdated ? " disabled" : ""}>Add as feedback</button><button class="text-button" data-action="dismiss" type="button"${disabled}>Dismiss</button>` : finding.status === "dismissed" ? `<button class="text-button" data-action="reopen" type="button"${disabled}>Reopen</button>` : '<span class="muted">Added to feedback</span>'}
      </div>`;
      if (compact) {
        const fileName = finding.path.split("/").at(-1) || finding.path;
        return `<details class="${classes} compact-finding" data-finding-id="${escapeHtml(finding.id)}"><summary><span class="finding-priority">${finding.priority}</span><button class="compact-finding-file" data-action="jump" type="button" title="Go to ${escapeHtml(finding.path)}:${finding.line}">${escapeHtml(fileName)}</button></summary><div class="compact-finding-summary"><p>${escapeHtml(findingSummary(finding))}</p><div class="compact-finding-actions"><button class="text-button" data-action="open-finding" type="button">View finding</button></div></div></details>`;
      }
      return `<article class="${classes}" data-finding-id="${escapeHtml(finding.id)}"${focused ? ' aria-current="true" tabindex="-1"' : ""}>
      ${body}
    </article>`;
    }).join("");
}

function renderFindings() {
  document.querySelectorAll(".diff-row.has-finding").forEach((row) => row.classList.remove("has-finding"));
  const findings = state.session.outline?.findings ?? [];
  for (const finding of findings.filter((candidate) => candidate.status === "open")) {
    const row = document.querySelector(`.diff-row[data-path="${CSS.escape(finding.path)}"][data-side="${finding.side}"][data-line="${finding.line}"]`);
    row?.classList.add("has-finding");
  }
  const step = currentStep();
  const phase = currentPhase();
  const stepFindings = findings.filter((finding) => finding.stepId === step?.id);
  const phaseFindings = findings.filter((finding) => finding.phaseId === phase?.id && !finding.stepId);
  elements["finding-count"].textContent = String(stepFindings.filter((finding) => finding.status === "open").length);
  elements["finding-list"].innerHTML = findingCards(stepFindings);
  elements["finding-drawer"].classList.toggle("hidden", stepFindings.length === 0);
  elements["phase-finding-count"].textContent = String(phaseFindings.filter((finding) => finding.status === "open").length);
  elements["phase-finding-list"].innerHTML = findingCards(phaseFindings, true);
  elements["phase-finding-drawer"].classList.toggle("hidden", phaseFindings.length === 0);
  elements["findings-tab-count"].textContent = String(findings.filter((finding) => finding.status === "open").length);
  elements["findings-tab-count"].classList.toggle("hidden", findings.length === 0);
  elements["all-findings-empty"].classList.toggle("hidden", findings.length > 0);
  elements["all-findings-list"].innerHTML = findingCards(findings);
  elements["findings-back"].classList.toggle("hidden", !state.findingReturn);
}

function openFindingFromCode(findingId) {
  state.findingReturn = {
    tab: state.activeTab,
    visibleFile: state.visibleFile,
    scrollTop: elements["diff-panel"].scrollTop,
    findingId,
  };
  state.focusedFindingId = findingId;
  state.activeTab = "findings";
  renderFindings();
  renderActiveTab();
  window.requestAnimationFrame(() => {
    const item = elements["all-findings-list"].querySelector(`.finding-item[data-finding-id="${CSS.escape(findingId)}"]`);
    const evidence = item?.querySelector("details");
    if (evidence) evidence.open = true;
    item?.scrollIntoView({ behavior: "smooth", block: "center" });
    item?.focus({ preventScroll: true });
  });
}

function returnToFindingCode() {
  const target = state.findingReturn;
  if (!target) return;
  state.findingReturn = null;
  state.focusedFindingId = null;
  state.activeTab = target.tab;
  renderFindings();
  renderActiveTab();
  window.requestAnimationFrame(() => {
    elements["diff-panel"].scrollTop = target.scrollTop;
    elements.diff.querySelector(`[data-finding-id="${CSS.escape(target.findingId)}"]`)?.focus({ preventScroll: true });
  });
}

function showFindingTooltip(pin) {
  const summary = pin?.dataset.tooltip;
  if (!summary) return;
  elements["finding-tooltip"].textContent = summary;
  elements["finding-tooltip"].classList.remove("hidden");
  const rect = pin.getBoundingClientRect();
  const tooltipRect = elements["finding-tooltip"].getBoundingClientRect();
  const left = Math.max(12, Math.min(window.innerWidth - tooltipRect.width - 12, rect.left));
  const top = rect.bottom + tooltipRect.height + 12 > window.innerHeight ? rect.top - tooltipRect.height - 7 : rect.bottom + 7;
  elements["finding-tooltip"].style.left = `${left}px`;
  elements["finding-tooltip"].style.top = `${Math.max(8, top)}px`;
}

function hideFindingTooltip() {
  elements["finding-tooltip"].classList.add("hidden");
}

function flowProvenanceCopy(provenance) {
  if (provenance === "verified") return { label: "Verified", detail: "Every link was traced in the changed code." };
  if (provenance === "partial") return { label: "Partly verified", detail: "Some links were traced; the remaining links are informed inferences." };
  return { label: "Unverified", detail: "The flow is plausible, but it was not traced end-to-end in the changed code." };
}

function renderCallTree(flow, mode) {
  const nodes = new Map(flow.nodes.map((node) => [node.id, node]));
  const visibleNode = (node) => Boolean(node) && (mode === "before" ? node.change !== "added" : mode === "after" ? node.change !== "removed" : true);
  const edges = flow.edges.filter((edge) => (mode === "before" ? edge.change !== "added" : mode === "after" ? edge.change !== "removed" : true) && visibleNode(nodes.get(edge.from)) && visibleNode(nodes.get(edge.to)));
  const children = new Map();
  for (const edge of edges) children.set(edge.from, [...(children.get(edge.from) ?? []), edge]);
  let renderBudget = 240;
  const renderBranch = (nodeId, ancestry = new Set(), depth = 0) => {
    if (renderBudget <= 0) return '<span class="call-tree-limit">More branches omitted</span>';
    renderBudget -= 1;
    const node = nodes.get(nodeId);
    if (!node || !visibleNode(node)) return "";
    const location = mode === "before" ? node.oldLocation : mode === "after" ? node.newLocation : node.newLocation ?? node.oldLocation;
    const recursive = ancestry.has(nodeId);
    const nextAncestry = new Set(ancestry).add(nodeId);
    const branches = recursive || depth >= 12 ? "" : (children.get(nodeId) ?? []).map((edge) => {
      const child = nodes.get(edge.to);
      const evidence = mode === "before" ? edge.oldCallSite : mode === "after" ? edge.newCallSite : edge.change === "removed" ? edge.oldCallSite : edge.newCallSite ?? edge.oldCallSite;
      return `<li class="call-edge ${edge.change}"><div class="call-edge-row"><span class="call-edge-mark" aria-label="${escapeHtml(edge.change)}">${edge.change === "added" ? "+" : edge.change === "removed" ? "−" : "→"}</span>${evidence ? `<button class="call-edge-link" type="button" data-call-path="${escapeHtml(evidence.path)}" data-call-side="${evidence.side}" data-call-line="${evidence.line}" title="Open call site ${escapeHtml(`${evidence.path}:${evidence.line}`)}">${escapeHtml(edge.label || "calls")}</button>` : `<span>${escapeHtml(edge.label || "calls")}</span>`}<span class="call-arrow">→</span><span class="call-child-label">${escapeHtml(child?.label ?? edge.to)}</span></div>${renderBranch(edge.to, nextAncestry, depth + 1)}</li>`;
    }).join("");
    return `<div class="call-node ${node.change}${nodeId === flow.entrypointNodeId ? " entrypoint" : ""}"><div class="call-node-row"><span class="call-kind">${escapeHtml(node.kind)}</span>${location ? `<button type="button" class="call-node-link" data-call-path="${escapeHtml(location.path)}" data-call-side="${location.side}" data-call-line="${location.line}">${escapeHtml(node.label)}</button>` : `<strong>${escapeHtml(node.label)}</strong>`}${recursive ? '<span class="call-cycle">recursive</span>' : ""}</div>${branches ? `<ul>${branches}</ul>` : ""}</div>`;
  };
  const tree = renderBranch(flow.entrypointNodeId);
  if (tree) return tree;
  const entrypoint = nodes.get(flow.entrypointNodeId);
  if (mode === "before" && entrypoint?.change === "added") return '<p class="call-tree-empty">This entrypoint did not exist before the change.</p>';
  if (mode === "after" && entrypoint?.change === "removed") return '<p class="call-tree-empty">This entrypoint no longer exists after the change.</p>';
  return '<p class="call-tree-empty">No calls are available in this view.</p>';
}

const ARCHITECTURE_ZOOM_MIN = 0.5;
const ARCHITECTURE_ZOOM_MAX = 3;
const ARCHITECTURE_ZOOM_STEP = 0.25;
const ARCHITECTURE_PAN_STEP = 40;

function architectureDiagramView(key) {
  if (!state.architectureDiagramViews.has(key)) state.architectureDiagramViews.set(key, { scale: 1, x: 0, y: 0 });
  return state.architectureDiagramViews.get(key);
}

function applyArchitectureDiagramView(key) {
  const shell = elements.architecture.querySelector(`[data-architecture-key="${CSS.escape(key)}"]`);
  const svg = shell?.querySelector(".architecture-diagram svg");
  const label = shell?.querySelector("[data-diagram-zoom-label]");
  const view = architectureDiagramView(key);
  if (svg) svg.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  if (label) label.textContent = `${Math.round(view.scale * 100)}%`;
}

function changeArchitectureDiagramView(key, action) {
  const view = architectureDiagramView(key);
  if (action === "zoom-in") view.scale = Math.min(ARCHITECTURE_ZOOM_MAX, view.scale + ARCHITECTURE_ZOOM_STEP);
  if (action === "zoom-out") view.scale = Math.max(ARCHITECTURE_ZOOM_MIN, view.scale - ARCHITECTURE_ZOOM_STEP);
  if (action === "move-left") view.x -= ARCHITECTURE_PAN_STEP;
  if (action === "move-right") view.x += ARCHITECTURE_PAN_STEP;
  if (action === "move-up") view.y -= ARCHITECTURE_PAN_STEP;
  if (action === "move-down") view.y += ARCHITECTURE_PAN_STEP;
  if (action === "reset") Object.assign(view, { scale: 1, x: 0, y: 0 });
  applyArchitectureDiagramView(key);
}

function architectureCard(architecture, label, key) {
  return `<article class="flow-card architecture-card">
    <header><div><span class="architecture-label">${escapeHtml(label)}</span><h2>${escapeHtml(architecture.title)}</h2></div></header>
    <p>${escapeHtml(architecture.summary)}</p>
    <div class="architecture-diagram-shell" data-architecture-key="${key}">
      <div class="diagram-controls" role="group" aria-label="${escapeHtml(`${label} diagram controls`)}">
        <span class="diagram-control-label">Move</span>
        <button type="button" data-diagram-action="move-left" aria-label="Move diagram left" title="Move left">←</button>
        <button type="button" data-diagram-action="move-up" aria-label="Move diagram up" title="Move up">↑</button>
        <button type="button" data-diagram-action="move-down" aria-label="Move diagram down" title="Move down">↓</button>
        <button type="button" data-diagram-action="move-right" aria-label="Move diagram right" title="Move right">→</button>
        <span class="diagram-control-label">Zoom</span>
        <button type="button" data-diagram-action="zoom-out" aria-label="Zoom diagram out" title="Zoom out">−</button>
        <button class="diagram-zoom-label" type="button" data-diagram-action="reset" data-diagram-zoom-label aria-label="Reset diagram view" title="Reset view">100%</button>
        <button type="button" data-diagram-action="zoom-in" aria-label="Zoom diagram in" title="Zoom in">+</button>
      </div>
      <div class="sequence-diagram architecture-diagram mermaid-render" data-architecture-diagram="${key}" role="img" tabindex="0" aria-label="${escapeHtml(`${label}: ${architecture.title}. Drag to move; use arrow keys to move and plus or minus to zoom.`)}"><span class="loading">Rendering diagram…</span></div>
      <p class="diagram-help">Drag to move · Arrow keys move · +/− zoom · 0 resets</p>
    </div>
    <div class="flow-warning hidden" data-architecture-error="${key}">The architecture diagram source is invalid or unsupported.</div>
    <div class="dependency-changes"><strong>Relationship changes</strong><ul>${architecture.dependencyChanges.map((change) => `<li>${escapeHtml(change)}</li>`).join("")}</ul></div>
    <details class="flow-impact architecture-impact"><summary class="blast">affects ${architecture.affectedFiles.length}</summary><div class="flow-impact-list"><strong>Affected changed files</strong>${architecture.affectedFiles.map((path) => `<button class="flow-affected-file" type="button" data-flow-file="${escapeHtml(path)}">${escapeHtml(path)}</button>`).join("")}</div></details>
    <details class="mermaid-source"><summary>Mermaid source</summary><pre>${escapeHtml(architecture.mermaid)}</pre></details>
  </article>`;
}

function architectureEntries() {
  const outline = state.session.outline;
  return [
    outline?.behaviorArchitecture ? { key: "behavior", label: `${outline.behaviorArchitectureStatus === "proposed" ? "Proposed" : "Implemented"} behaviour`, value: outline.behaviorArchitecture } : null,
    outline?.architecture ? { key: "journey", label: "Implementation journey", value: outline.architecture } : null,
  ].filter(Boolean);
}

function renderArchitecture() {
  const architectures = architectureEntries();
  elements.architecture.classList.toggle("hidden", architectures.length === 0);
  elements["architecture-content"].innerHTML = architectures.map(({ key, label, value }) => architectureCard(value, label, key)).join("");
  const generation = ++state.flowRenderGeneration;
  void renderFlowDiagrams(architectures, [], generation);
}

function renderCallFlows() {
  const callFlows = state.session.outline?.callFlows ?? [];
  elements["regenerate-call-flows"].disabled = state.busy || !reviewIsOpen() || !state.session.outline;
  elements["call-flows-empty"].classList.toggle("hidden", callFlows.length > 0);
  elements["call-flows-empty"].textContent = state.session.outline ? "No changed call graph was identified for this comparison." : "Start the tour to trace changed calls from their entrypoints.";
  elements["call-flows"].innerHTML = callFlows.map((flow) => {
    const provenance = flowProvenanceCopy(flow.provenance);
    const mode = state.callFlowModes.get(flow.id) ?? "changes";
    const counts = flow.edges.reduce((result, edge) => ({ ...result, [edge.change]: result[edge.change] + 1 }), { added: 0, removed: 0, unchanged: 0 });
    return `<article class="flow-card call-flow-card" data-call-flow-id="${escapeHtml(flow.id)}"><header><div><span class="provenance ${flow.provenance}" title="${escapeHtml(provenance.detail)}">${escapeHtml(provenance.label)}</span><h2>${escapeHtml(flow.title)}</h2></div><button class="text-button" data-call-flow-regenerate type="button"${!reviewIsOpen() ? " disabled" : ""}>Regenerate</button></header><p>${escapeHtml(flow.summary)}</p><div class="call-flow-summary"><span class="plus">+${counts.added} calls</span><span class="minus">−${counts.removed} calls</span></div><details class="flow-impact call-flow-impact"><summary>affects ${flow.affectedFiles.length}</summary><div class="flow-impact-list"><strong>Affected changed files</strong>${flow.affectedFiles.map((path) => `<button class="flow-affected-file" type="button" data-flow-file="${escapeHtml(path)}">${escapeHtml(path)}</button>`).join("")}</div></details><div class="call-flow-modes" role="group" aria-label="Call-flow version">${["changes", "before", "after"].map((candidate) => `<button type="button" data-call-flow-mode="${candidate}" class="${mode === candidate ? "active" : ""}">${candidate[0].toUpperCase()}${candidate.slice(1)}</button>`).join("")}</div><div class="call-tree-legend" role="list" aria-label="Call-flow legend"><span role="listitem"><i class="entrypoint" aria-hidden="true"></i>Entry point</span><span role="listitem"><i class="added" aria-hidden="true"></i>Added</span><span role="listitem"><i class="modified" aria-hidden="true"></i>Changed callable</span><span role="listitem"><i class="removed" aria-hidden="true"></i>Removed</span><span role="listitem"><i class="unchanged" aria-hidden="true"></i>Unchanged</span></div><p class="call-tree-caption">A changed callable exists before and after this change, but its implementation or outgoing calls changed.</p><div class="call-tree">${renderCallTree(flow, mode)}</div></article>`;
  }).join("");
}

function renderSequenceDiagrams() {
  const flows = state.session.outline?.flows ?? [];
  const generation = ++state.flowRenderGeneration;
  elements["regenerate-flows"].disabled = state.busy || !reviewIsOpen() || !state.session.outline;
  elements["flows-empty"].classList.toggle("hidden", flows.length > 0);
  elements["flows-empty"].textContent = state.session.outline
    ? "No goal-critical, high-blast runtime flow was identified for this change."
    : "Start the tour to generate grounded sequence diagrams.";
  elements.flows.innerHTML = flows.map((flow, index) => {
    const provenance = flowProvenanceCopy(flow.provenance);
    const affectedFiles = flow.affectedFiles ?? [];
    const affectedCount = affectedFiles.length || flow.blastRadiusSize;
    const affectedDetails = affectedFiles.length > 0
      ? affectedFiles.map((path) => `<button class="flow-affected-file" type="button" data-flow-file="${escapeHtml(path)}">${escapeHtml(path)}</button>`).join("")
      : '<p class="muted">Exact files were not captured for this saved tour. Regenerate this diagram to add them.</p>';
    return `<article class="flow-card" data-flow-id="${escapeHtml(flow.id)}">
      <header><div><span class="provenance ${flow.provenance}" title="${escapeHtml(provenance.detail)}" aria-label="${escapeHtml(`${provenance.label}: ${provenance.detail}`)}">${escapeHtml(provenance.label)}</span><h2>${escapeHtml(flow.title)}</h2></div><div class="flow-actions"><details class="flow-impact"><summary class="blast">affects ${affectedCount}</summary><div class="flow-impact-list"><strong>Affected changed files</strong>${affectedDetails}</div></details><button class="text-button" data-flow-action="edit" type="button"${!reviewIsOpen() ? " disabled" : ""}>Edit</button><button class="text-button" data-flow-action="regenerate" type="button"${!reviewIsOpen() ? " disabled" : ""}>Regenerate</button></div></header>
      <p>${escapeHtml(flow.summary)}</p>
      <div class="sequence-diagram mermaid-render" data-flow-index="${index}" role="img" aria-label="Sequence diagram: ${escapeHtml(flow.title)}"><span class="loading">Rendering diagram…</span></div>
      <div class="flow-warning hidden" data-flow-error>The diagram source is invalid or unsupported. Inspect or edit it below.</div>
      <details class="mermaid-source"><summary>Mermaid source</summary><pre>${escapeHtml(flow.mermaid)}</pre></details>
    </article>`;
  }).join("");
  void renderFlowDiagrams(architectureEntries(), flows, generation);
}

async function renderFlowDiagrams(architectures, flows, generation) {
  if (!window.mermaid || (architectures.length === 0 && flows.length === 0)) return;
  const theme = document.documentElement.dataset.theme === "light" ? "default" : "dark";
  window.mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    theme,
    maxTextSize: 12_000,
    maxEdges: 500,
    deterministicIds: true,
    deterministicIDSeed: `review-tour-${state.session.revision}-${theme}`,
    sequence: { useMaxWidth: true, wrap: true },
  });
  for (const architecture of architectures) {
    const target = elements.architecture.querySelector(`[data-architecture-diagram="${architecture.key}"]`);
    try {
      const result = await window.mermaid.render(`review-tour-architecture-${architecture.key}-${generation}`, architecture.value.mermaid);
      if (generation !== state.flowRenderGeneration || !target?.isConnected) return;
      target.innerHTML = result.svg;
      target.querySelector("svg")?.setAttribute("aria-hidden", "true");
      applyArchitectureDiagramView(architecture.key);
    } catch {
      if (target) target.innerHTML = '<span class="muted">Diagram unavailable</span>';
      elements.architecture.querySelector(`[data-architecture-error="${architecture.key}"]`)?.classList.remove("hidden");
    }
  }
  for (let index = 0; index < flows.length; index += 1) {
    if (generation !== state.flowRenderGeneration) return;
    const card = elements.flows.querySelector(`[data-flow-id="${CSS.escape(flows[index].id)}"]`);
    const target = card?.querySelector(`[data-flow-index="${index}"]`);
    if (!target) continue;
    try {
      const result = await window.mermaid.render(`review-tour-flow-${generation}-${index}`, flows[index].mermaid);
      if (generation !== state.flowRenderGeneration || !target.isConnected) return;
      target.innerHTML = result.svg;
      target.querySelector("svg")?.setAttribute("aria-hidden", "true");
    } catch {
      target.innerHTML = '<span class="muted">Diagram unavailable</span>';
      card.querySelector("[data-flow-error]")?.classList.remove("hidden");
      const source = card.querySelector(".mermaid-source");
      if (source) source.open = true;
    }
  }
}

function renderActivities() {
  const activities = [...(state.session.activities ?? [])].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  elements["activity-empty"].classList.toggle("hidden", activities.length > 0);
  elements["activity-tab-count"].textContent = String(activities.length);
  elements["activity-tab-count"].classList.toggle("hidden", activities.length === 0);
  elements["activity-list"].innerHTML = activities.map((activity) => `<article class="activity-card" data-activity-id="${escapeHtml(activity.id)}">
    <header>
      <div><span class="activity-status ${escapeHtml(activity.status)}">${activity.status === "verified" ? "verified" : "observed"}</span>${activity.changeStatus ? `<span class="change-status ${escapeHtml(activity.changeStatus)}">${escapeHtml(activity.changeStatus)}</span>` : ""}<h2>${escapeHtml(activity.request)}</h2></div>
      <time datetime="${escapeHtml(activity.updatedAt)}">${escapeHtml(new Date(activity.updatedAt).toLocaleString())}</time>
    </header>
    <div class="activity-agent">${escapeHtml(activity.adapterId)} · ${escapeHtml(activity.modelId)}${activity.stepId ? ` · tour step ${escapeHtml(activity.stepId)}` : ""}</div>
    <div class="activity-files">${activity.files.map((file) => `<button type="button" class="activity-file"${activity.hasProposal ? ` data-activity-id="${escapeHtml(activity.id)}" data-activity-file="${escapeHtml(file.path)}"` : activity.changeStatus ? " disabled" : ` data-current-file="${escapeHtml(file.path)}"`}>
      <span><strong>${escapeHtml(file.path)}</strong><small>${escapeHtml(file.change)}</small></span>
      <span class="file-stats">${file.after ? `<span class="plus">+${file.after.additions}</span> <span class="minus">-${file.after.deletions}</span>` : "removed from diff"}</span>
    </button>`).join("")}</div>
    <section class="activity-verification"><div class="eyebrow">Verification</div>${activity.verification ? renderMarkdown(activity.verification) : `<p class="muted">${activity.status === "verified" ? "No verification summary was supplied." : "Waiting for the agent's explicit refresh."}</p>`}</section>
    ${activity.changeStatus ? `<div class="activity-actions">
      ${activity.changeStatus === "pending" ? '<button type="button" class="button primary" data-activity-action="apply">Apply</button><button type="button" class="button secondary" data-activity-action="reject">Reject</button>' : ""}
      ${activity.changeStatus === "applied" ? '<button type="button" class="button secondary" data-activity-action="undo">Undo</button>' : ""}
      ${["rejected", "undone"].includes(activity.changeStatus) ? `<span class="muted">${activity.changeStatus === "rejected" ? "Proposal discarded" : "Applied change undone"}</span>` : ""}
    </div>` : ""}
  </article>`).join("");
}

function availableTabs() {
  return ["diff", "call-flows", "sequence", "findings", "activity", ...(state.session?.pullRequest ? ["pull-request"] : [])];
}

function renderActiveTab() {
  for (const tabName of ["diff", "call-flows", "sequence", "findings", "activity", "pull-request"]) {
    const active = state.activeTab === tabName;
    elements[`${tabName}-view`].classList.toggle("hidden", !active);
    elements[`${tabName}-tab`].classList.toggle("active", active);
    elements[`${tabName}-tab`].setAttribute("aria-selected", String(active));
    elements[`${tabName}-tab`].tabIndex = active ? 0 : -1;
  }
}

function activateReviewTab(tabName, render = null) {
  if (tabName === state.activeTab) return;
  state.tabScrollPositions.set(state.activeTab, elements["diff-panel"].scrollTop);
  state.activeTab = tabName;
  render?.();
  renderActiveTab();
  const scrollTop = state.tabScrollPositions.get(tabName) ?? 0;
  window.requestAnimationFrame(() => {
    if (state.activeTab === tabName) elements["diff-panel"].scrollTop = scrollTop;
  });
}

function renderTourAnnotation() {
  document.querySelectorAll(".tour-anchor, .tour-anchor-start, .tour-anchor-end").forEach((row) => row.classList.remove("tour-anchor", "tour-anchor-start", "tour-anchor-end"));
  document.querySelectorAll(".tour-code-note").forEach((note) => note.remove());
  if (!state.tourMode) return;
  const activeStep = currentStep();
  const phase = currentPhase();
  if (!activeStep || !phase) return;
  for (let index = phase.steps.length - 1; index >= 0; index -= 1) {
    const step = phase.steps[index];
    const { path, side, startLine, endLine } = step.anchor;
    const rows = [...document.querySelectorAll(`.diff-row[data-path="${CSS.escape(path)}"][data-side="${side}"]`)]
      .filter((row) => Number(row.dataset.line) >= startLine && Number(row.dataset.line) <= endLine);
    if (step.id === activeStep.id && rows.length > 0) {
      rows.forEach((row) => row.classList.add("tour-anchor"));
      rows[0].classList.add("tour-anchor-start");
      rows.at(-1).classList.add("tour-anchor-end");
    }
    const firstRow = rows[0];
    if (!firstRow) continue;
    const note = document.createElement("aside");
    note.className = `tour-code-note${step.id === activeStep.id ? " active" : ""}`;
    note.setAttribute("aria-label", `${step.id === activeStep.id ? "Current" : "Upcoming"} tour stop: ${step.title}`);
    note.innerHTML = `<span>${step.id === activeStep.id ? "Current stop" : `Stop ${index + 1}`}</span><strong>${escapeHtml(compactText(step.title, 100))}</strong><p>${escapeHtml(compactText(step.objective, 180))}</p>`;
    (firstRow.closest(".split-row") ?? firstRow).insertAdjacentElement("beforebegin", note);
  }
}

async function focusCurrentStep() {
  const step = currentStep();
  if (!step || !state.tourMode) return;
  state.focusedStepId = step.id;
  if (state.session.comparison.diffMode === "file") await ensureTourPhaseDiffs();
  state.activeTab = "diff";
  renderActiveTab();
  renderTourAnnotation();
  const target = document.querySelector(".tour-code-note.active")
    ?? document.querySelector(`.diff-row[data-path="${CSS.escape(step.anchor.path)}"][data-side="${step.anchor.side}"][data-line="${step.anchor.startLine}"]`)
    ?? document.querySelector(`.diff-file[data-path="${CSS.escape(step.anchor.path)}"]`);
  target?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function renderMessages() {
  const step = currentStep();
  const messages = state.session.messages.filter((message) => !message.stepId || message.stepId === step?.id);
  elements["chat-messages"].innerHTML = messages
    .map((message) => `<div class="chat-message ${message.role}">${renderMarkdown(message.body)}</div>`)
    .join("");
}

function renderTour() {
  const { outline, currentStepIndex } = state.session;
  renderReviewOverview();
  const active = Boolean(outline);
  const planning = state.session.tourState === "planning";
  elements["tour-empty"].classList.toggle("hidden", active);
  elements["tour-active"].classList.toggle("hidden", !active);
  if (!outline) {
    elements["tour-empty-title"].textContent = planning ? "Planning your tour" : "Walk through this change";
    elements["tour-empty-description"].textContent = planning
      ? "The triggering agent is inspecting the change and preparing the first stop."
      : "The agent will plan a logical route through the diff and explain each stop as you progress.";
    elements["agent-config"].classList.toggle("hidden", planning);
    elements["start-tour"].classList.toggle("hidden", planning);
    elements["planning-activity"].classList.toggle("hidden", !planning);
    if (planning) {
      elements["planning-activity-body"].innerHTML = `<p>Inspecting ${state.session.comparison.files.length.toLocaleString()} changed files and ${state.session.comparison.diffRowCount.toLocaleString()} diff rows.</p><p class="planning-live">Waiting for the agent to return a grounded route…</p>`;
    }
    return;
  }

  const steps = outline.phases.flatMap((phase) => phase.steps);
  const step = steps[currentStepIndex];
  const phase = outline.phases.find((candidate) => candidate.steps.some((item) => item.id === step.id));
  const phaseIndex = outline.phases.indexOf(phase);
  const stopInPhase = phase.steps.findIndex((candidate) => candidate.id === step.id);
  elements["step-count"].textContent = `Phase ${phaseIndex + 1} of ${outline.phases.length} · Stop ${stopInPhase + 1} of ${phase.steps.length}`;
  elements["progress-value"].value = ((currentStepIndex + 1) / steps.length) * 100;
  elements["phase-count"].textContent = `Phase ${phaseIndex + 1}`;
  elements["phase-title"].textContent = phase.title;
  elements["phase-summary"].textContent = phase.summary;
  if (state.renderedPhaseId !== phase.id) {
    elements["phase-files-details"].open = false;
    elements["phase-finding-drawer"].open = false;
    state.renderedPhaseId = phase.id;
  }
  elements["phase-files-count"].textContent = String(phase.fileChanges.length);
  elements["phase-files"].innerHTML = phase.fileChanges.map((change) => {
    const file = state.session.comparison.files.find((candidate) => candidate.path === change.path);
    return `<button type="button" class="phase-file" data-phase-file="${escapeHtml(change.path)}"><span><strong>${escapeHtml(change.path)}</strong><small>${escapeHtml(change.summary)}</small></span>${file ? `<span class="file-stats"><span class="plus">+${file.additions}</span> <span class="minus">-${file.deletions}</span></span>` : ""}</button>`;
  }).join("");
  elements["step-anchor"].textContent = `${step.anchor.path}:${step.anchor.startLine}-${step.anchor.endLine}`;
  elements["step-title"].textContent = step.title;
  elements["step-objective"].textContent = step.objective;
  elements["step-explanation"].innerHTML = renderMarkdown(step.explanation || "Waiting for the agent…");
  renderAgentActivity();
  const planningNotes = outline.planningNotes ?? [];
  elements["planning-notes"].classList.toggle("hidden", planningNotes.length === 0);
  elements["planning-note-list"].innerHTML = planningNotes.map((note) => `<li>${escapeHtml(note)}</li>`).join("");
  elements["previous-step"].disabled = (state.busy && state.navigationDirection !== "next") || !reviewIsOpen() || !state.tourMode || currentStepIndex === 0;
  elements["next-step"].disabled = state.busy || !reviewIsOpen() || !state.tourMode || currentStepIndex === steps.length - 1;
  renderMessages();
  renderTourAnnotation();
}

function renderFilteredDiff() {
  renderFileTree();
  const files = visibleDiffFiles();
  renderDiff(files);
  elements["empty-diff"].textContent = filteredChangedFiles().length === 0
    ? "No changed files match these filters."
    : "No changes found for this comparison.";
  const large = state.session.comparison.diffMode === "file";
  if (state.tourMode && large) {
    void ensureTourPhaseDiffs();
    renderComments();
    renderFindings();
    renderTourAnnotation();
    return;
  }
  if (large && files.length === 0 && filteredChangedFiles().length > 0) {
    const target = filteredChangedFiles()[0].path;
    state.visibleFile = target;
    void showChangedFile(target);
  }
  renderComments();
  renderFindings();
  renderTourAnnotation();
}

async function refreshDiffSearch() {
  const requestId = ++state.searchRequestId;
  if (!state.searchQuery.trim()) {
    state.searchMatches = null;
    renderFilteredDiff();
    return;
  }
  try {
    const query = new URLSearchParams({ q: state.searchQuery.trim() });
    if (state.statusFilter) query.append("status", state.statusFilter);
    const result = await api(`/api/diff/search?${query}`);
    if (requestId !== state.searchRequestId) return;
    state.searchMatches = result.paths;
    renderFilteredDiff();
  } catch (error) {
    if (requestId === state.searchRequestId) toast(error.message);
  }
}

async function setReviewed(path, reviewed) {
  if (!reviewIsOpen() || state.busy) return;
  try {
    state.session = await api("/api/files/reviewed", {
      method: "POST",
      body: JSON.stringify({ path, reviewed }),
    });
    if (reviewed) state.collapsedFiles.add(path);
    else state.collapsedFiles.delete(path);
    renderSession();
    toast(reviewed ? "File marked reviewed" : "File marked unreviewed");
  } catch (error) {
    toast(error.message);
  }
}

function renderSession() {
  const { comparison, comments } = state.session;
  if (state.tourMode === null && state.session.outline) state.tourMode = true;
  initializeUiPreferences();
  state.proposalPreview = false;
  const repositoryName = state.session.pullRequest?.repository ?? comparison.repositoryName;
  const branchName = state.session.pullRequest?.headRefName ?? comparison.branch ?? `detached@${comparison.head.slice(0, 8)}`;
  const repositoryIdentity = `${repositoryName} · ${branchName}`;
  elements["repository-label"].textContent = repositoryIdentity;
  elements["repository-label"].title = repositoryIdentity;
  elements["comparison-label"].textContent = `${comparison.base} → working tree`;
  elements["diff-search"].value = state.searchQuery;
  elements["status-filter"].value = state.statusFilter;
  elements["review-filter"].value = state.reviewFilter;
  elements["test-files-filter"].setAttribute("aria-pressed", String(state.testFilesOnly));
  elements["test-files-filter"].classList.toggle("active", state.testFilesOnly);
  elements["tree-mode"].value = state.treeMode;
  elements["diff-layout"].value = state.diffLayout;
  elements["prefetch-steps"].value = String(state.session.preferences?.prefetchSteps ?? 2);
  elements["diff-search"].disabled = Boolean(state.tourMode);
  elements["status-filter"].disabled = Boolean(state.tourMode);
  elements["review-filter"].disabled = Boolean(state.tourMode);
  elements["test-files-filter"].disabled = Boolean(state.tourMode);
  elements["tree-mode"].disabled = Boolean(state.tourMode);
  elements["diff-search"].title = state.tourMode ? "Exit the tour to filter all changed files." : "";
  elements["test-files-filter"].title = state.tourMode ? "Exit the tour to filter test files." : "Show only changed test files";
  renderFileTree();
  const large = comparison.diffMode === "file";
  if (state.diffCacheRevision !== state.session.revision) {
    state.diffCache.clear();
    state.diffCacheRevision = state.session.revision;
    if (state.searchQuery) void refreshDiffSearch();
  }
  elements["large-diff-notice"].classList.toggle("hidden", !large);
  elements["large-diff-notice"].textContent = large
    ? state.tourMode
      ? `Large diff (${comparison.diffRowCount.toLocaleString()} rows): loading all ${filteredChangedFiles().length} files in this phase.`
      : `Large diff (${comparison.diffRowCount.toLocaleString()} rows): loading one file at a time.`
    : "";
  renderDiff(visibleDiffFiles());
  if (state.tourMode && large) void ensureTourPhaseDiffs();
  if (!state.tourMode && large && visibleDiffFiles().length === 0 && filteredChangedFiles().length > 0) {
    const step = currentStep();
    const target = state.visibleFile && filteredChangedFiles().some((file) => file.path === state.visibleFile)
      ? state.visibleFile
      : filteredChangedFiles().some((file) => file.path === step?.anchor.path) ? step?.anchor.path : filteredChangedFiles()[0].path;
    const targetsStep = target === step?.anchor.path;
    void showChangedFile(target, targetsStep ? step.anchor.startLine : undefined, targetsStep ? step.anchor.side : undefined);
  }
  renderComments();
  renderFindings();
  renderReviewOverview();
  renderArchitecture();
  if (state.activeTab === "call-flows") renderCallFlows();
  if (state.activeTab === "sequence") renderSequenceDiagrams();
  renderActivities();
  renderPullRequest();
  renderActiveTab();
  elements["feedback-button"].classList.toggle("hidden", comments.length === 0);
  const closed = !reviewIsOpen();
  elements["closed-banner"].classList.toggle("hidden", !closed);
  elements["closed-banner"].textContent = closed ? `This review is closed as ${state.session.status}. It is now read-only.` : "";
  elements["refresh-button"].disabled = state.busy || closed;
  elements["close-button"].disabled = state.busy || closed;
  elements["close-button"].textContent = state.session.preferences?.closeOutcome === "cancelled" ? "Cancel review" : "Close";
  elements["feedback-button"].disabled = state.busy || closed;
  elements["prefetch-steps"].disabled = closed;
  elements["start-tour"].disabled = state.busy || closed || (state.session.agentAdapters ?? []).length === 0;
  elements["chat-input"].disabled = closed;
  elements["chat-form"].querySelector("button").disabled = state.busy || closed;
  elements["comment-drawer"].classList.toggle("closed", closed);
  if (closed && elements["comment-dialog"].open) elements["comment-dialog"].close();
  elements["agent-mode"].textContent = state.session.agentSelection?.adapterId === "attached" ? "edits on request" : "read-only";
  renderAgentOptions();
  renderTour();
  if (state.session.outline && state.focusedStepId === null) void focusCurrentStep();
}

async function startTour() {
  if (!reviewIsOpen()) return;
  setBusy(true);
  elements["planning-activity"].classList.remove("hidden");
  elements["planning-activity-body"].innerHTML = `<p>Inspecting ${state.session.comparison.files.length.toLocaleString()} changed files and ${state.session.comparison.diffRowCount.toLocaleString()} diff rows.</p><p class="planning-live">Waiting for the agent to return a grounded route…</p>`;
  elements["start-tour"].innerHTML = '<span class="button-spinner" aria-hidden="true"></span>Planning tour';
  try {
    state.session = await api("/api/tour/start", {
      method: "POST",
      body: JSON.stringify({
        adapterId: elements["agent-select"].value,
        modelId: elements["model-select"].value,
        reasoningEffort: elements["reasoning-select"].value || undefined,
        includeArchitecture: elements["include-architecture"].checked,
        includeCallFlows: elements["include-call-flows"].checked,
        includeFlows: elements["include-flows"].checked,
        includeFindings: elements["include-findings"].checked,
      }),
    });
    state.tourMode = true;
    state.focusedStepId = currentStep()?.id ?? null;
    renderSession();
    elements["tour-scroll"].scrollTop = 0;
    await focusCurrentStep();
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
    elements["start-tour"].textContent = "Start tour";
    elements["planning-activity"].classList.add("hidden");
    renderTour();
  }
}

async function navigate(direction) {
  if (!reviewIsOpen() || !state.tourMode) return;
  if (state.busy && !(direction === "previous" && state.navigationDirection === "next")) return;
  const generation = ++state.navigationGeneration;
  state.navigationDirection = direction;
  setBusy(true, direction === "next" ? "Preparing the next stop…" : "Returning to the previous stop…");
  try {
    const session = await api("/api/tour/navigate", { method: "POST", body: JSON.stringify({ direction }) });
    if (generation !== state.navigationGeneration) return;
    state.session = session;
    renderSession();
    elements["tour-scroll"].scrollTop = 0;
    await ensureTourPhaseDiffs();
    await focusCurrentStep();
  } catch (error) {
    if (generation === state.navigationGeneration) toast(error.message);
  } finally {
    if (generation !== state.navigationGeneration) return;
    state.navigationDirection = null;
    setBusy(false);
    renderTour();
  }
}

async function toggleTourMode() {
  if (!state.session.outline || state.busy) return;
  state.tourMode = !state.tourMode;
  state.fileRequestId += 1;
  state.phaseDiffLoadKey = null;
  state.phaseDiffLoadPromise = null;
  state.visibleFile = null;
  state.activeTab = "diff";
  renderSession();
  elements["diff-panel"].scrollTop = 0;
  if (state.tourMode) {
    await ensureTourPhaseDiffs();
    await focusCurrentStep();
    toast("Tour resumed. Diffs are scoped to this phase.");
  } else {
    toast("Tour exited. All changed files are visible.");
  }
}

async function showAnalysisFile(path, line, side) {
  const outsidePhase = state.tourMode && !filteredChangedFiles().some((file) => file.path === path);
  if (outsidePhase) {
    state.tourMode = false;
    state.fileRequestId += 1;
    state.phaseDiffLoadKey = null;
    state.phaseDiffLoadPromise = null;
    state.visibleFile = null;
    renderSession();
  }
  await showChangedFile(path, line, side);
  if (outsidePhase) toast("Tour paused so this evidence can be shown. Resume the tour when you are ready.", { duration: 7_000 });
}

function openFlowEditor(flow) {
  if (!reviewIsOpen()) return;
  elements["flow-id"].value = flow.id;
  elements["flow-title"].value = flow.title;
  elements["flow-summary"].value = flow.summary;
  elements["flow-provenance"].value = flow.provenance;
  elements["flow-blast-radius"].value = String(flow.blastRadiusSize);
  elements["flow-affected-files"].value = (flow.affectedFiles ?? []).join("\n");
  elements["flow-mermaid"].value = flow.mermaid;
  elements["flow-dialog"].showModal();
}

async function saveFlow(event) {
  event.preventDefault();
  if (!reviewIsOpen() || state.busy) return;
  const id = elements["flow-id"].value;
  setBusy(true, "Saving flow…");
  try {
    state.session = await api(`/api/flows/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        title: elements["flow-title"].value,
        summary: elements["flow-summary"].value,
        provenance: elements["flow-provenance"].value,
        blastRadiusSize: Number(elements["flow-blast-radius"].value),
        affectedFiles: elements["flow-affected-files"].value.split("\n").map((path) => path.trim()).filter(Boolean),
        mermaid: elements["flow-mermaid"].value,
      }),
    });
    elements["flow-dialog"].close();
    renderSession();
    toast("Flow saved");
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
    renderSession();
  }
}

async function regenerateFlows(id) {
  if (!reviewIsOpen() || state.busy || !state.session.outline) return;
  setBusy(true, id ? "Regenerating flow…" : "Regenerating flows…");
  try {
    state.session = await api("/api/flows/regenerate", { method: "POST", body: JSON.stringify(id ? { id } : {}) });
    renderSession();
    toast(id ? "Flow regenerated" : "Flows regenerated");
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
    renderSession();
  }
}

async function regenerateCallFlows(id) {
  if (!reviewIsOpen() || state.busy || !state.session.outline) return;
  setBusy(true, id ? "Regenerating call flow…" : "Regenerating call flows…");
  try {
    state.session = await api("/api/call-flows/regenerate", { method: "POST", body: JSON.stringify(id ? { id } : {}) });
    renderSession();
    toast(id ? "Call flow regenerated" : "Call flows regenerated");
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
    renderSession();
  }
}

async function downloadExport(format) {
  if (!state.apiToken || state.busy) return;
  const buttons = elements["export-menu"].querySelectorAll("button");
  buttons.forEach((button) => { button.disabled = true; });
  try {
    const response = await fetch(`/api/export?format=${encodeURIComponent(format)}`, {
      headers: { "X-Review-Tour-Token": state.apiToken },
    });
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      throw new Error(failure.error || `Export failed: ${response.status}`);
    }
    const disposition = response.headers.get("content-disposition") ?? "";
    const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `code-review.${format === "html" ? "html" : "md"}`;
    const href = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = href;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(href), 0);
    toast(`${format === "html" ? "HTML" : "Markdown"} export downloaded`);
  } catch (error) {
    toast(error.message);
  } finally {
    buttons.forEach((button) => { button.disabled = state.busy; });
    elements["export-menu"].open = false;
  }
}

function selectLine(row) {
  document.querySelectorAll(".diff-row.selected").forEach((item) => item.classList.remove("selected"));
  document.querySelectorAll(".line-tools button").forEach((button) => { button.tabIndex = -1; });
  row.classList.add("selected");
  row.querySelectorAll(".line-tools button:not(:disabled)").forEach((button) => { button.tabIndex = 0; });
  state.selectedLine = {
    path: row.dataset.path,
    side: row.dataset.side,
    line: Number(row.dataset.line),
    content: row.dataset.content,
  };
  elements["selection-pill"].textContent = `${state.selectedLine.path}:${state.selectedLine.line} selected · comment or ask the agent`;
  elements["selection-pill"].classList.remove("hidden");
}

function lineTarget(row) {
  return {
    path: row.dataset.path,
    side: row.dataset.side,
    line: Number(row.dataset.line),
    content: row.dataset.content,
  };
}

function commentAt(target) {
  return state.session.comments.find((comment) => comment.status === "active" && comment.path === target.path && comment.side === target.side && comment.line === target.line);
}

function openLineComment(row) {
  const target = lineTarget(row);
  const existing = commentAt(target);
  if (existing) openCommentEditor(existing);
  else openComment(target);
}

function askAboutLine(row) {
  selectLine(row);
  elements["chat-input"].placeholder = `Ask about ${row.dataset.path}:${row.dataset.line}…`;
  elements["chat-input"].focus({ preventScroll: true });
  elements["chat-input"].scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function openComment(target) {
  if (!reviewIsOpen()) return;
  state.commentTarget = target;
  state.editingCommentId = null;
  elements["comment-location"].textContent = `${target.path}:${target.line} (${target.side})`;
  elements["comment-body"].value = "";
  elements["save-comment"].textContent = "Add comment";
  elements["comment-dialog"].showModal();
}

function openCommentEditor(comment) {
  state.commentTarget = null;
  state.editingCommentId = comment.id;
  elements["comment-location"].textContent = `Edit ${comment.path}:${comment.line} (${comment.side})`;
  elements["comment-body"].value = comment.body;
  elements["save-comment"].textContent = "Save comment";
  elements["comment-dialog"].showModal();
}

async function saveComment(event) {
  event.preventDefault();
  if (!reviewIsOpen()) return;
  const body = elements["comment-body"].value.trim();
  if (!body) return;
  try {
    const target = state.commentTarget;
    state.session = state.editingCommentId
      ? await api(`/api/comments/${encodeURIComponent(state.editingCommentId)}`, { method: "PATCH", body: JSON.stringify({ body }) })
      : await api("/api/comments", { method: "POST", body: JSON.stringify({ path: target.path, side: target.side, line: target.line, body }) });
    elements["comment-dialog"].close();
    renderSession();
    toast(state.editingCommentId ? "Review comment updated" : "Review comment added");
  } catch (error) {
    toast(error.message);
  }
}

async function askAgent(event) {
  event.preventDefault();
  const body = elements["chat-input"].value.trim();
  if (!body || state.busy || !reviewIsOpen()) return;
  elements["chat-input"].value = "";
  const selectedContext = state.selectedLine
    ? `${state.selectedLine.path}:${state.selectedLine.line} (${state.selectedLine.side})\n${state.selectedLine.content}`
    : undefined;
  const previousActivityId = state.session.agentActivity?.id;
  const queuedAt = new Date().toISOString();
  state.expectedAgentActivity = { kind: "review.question", previousActivityId };
  state.session.agentActivity = {
    id: `local-question-${crypto.randomUUID()}`,
    kind: "review.question",
    label: "Answering the reviewer",
    status: "waiting",
    prompt: body,
    updates: [{
      message: state.session.agentActivity?.kind === "tour.explanation" && ["waiting", "running"].includes(state.session.agentActivity.status)
        ? "Your question is being sent now while tour preparation continues."
        : "Sending your question to the agent.",
      createdAt: queuedAt,
    }],
    startedAt: queuedAt,
    updatedAt: queuedAt,
    localQueued: true,
  };
  setBusy(true, "The agent is responding…");
  try {
    state.session = await api("/api/agent/message", {
      method: "POST",
      body: JSON.stringify({ body, selectedContext }),
    });
    state.expectedAgentActivity = null;
    renderSession();
  } catch (error) {
    state.expectedAgentActivity = null;
    toast(error.message);
  } finally {
    setBusy(false);
    renderTour();
  }
}

async function close(outcome) {
  if (!reviewIsOpen()) return;
  if (outcome === "accepted" && state.session.comments.length > 0) {
    toast("Send feedback & close, or remove all comments before accepting.");
    return;
  }
  try {
    let result;
    if (state.session.pullRequest && outcome !== "cancelled") {
      const selected = state.session.comments.filter((comment) => comment.publishToGitHub).length;
      const action = outcome === "accepted" ? "approve" : "request changes on";
      if (!window.confirm(`Publish a GitHub review to ${action} ${state.session.pullRequest.repository}#${state.session.pullRequest.number} at ${state.session.pullRequest.headRefOid.slice(0, 8)} with ${selected} selected inline comment(s)?`)) return;
      result = await api("/api/github/review", { method: "POST", body: JSON.stringify({ outcome, headOid: state.session.pullRequest.headRefOid, confirm: true }) });
    } else {
      result = await api("/api/close", { method: "POST", body: JSON.stringify({ outcome }) });
    }
    state.session = { ...state.session, status: result.status };
    renderSession();
    toast(outcome === "feedback" ? `${result.comments.length} feedback item(s) delivered` : "Review closed");
  } catch (error) {
    toast(error.message);
  }
}

async function refresh() {
  if (!reviewIsOpen() || state.busy) return;
  setBusy(true, "Refreshing the comparison…");
  try {
    state.session = await api(state.session.pullRequest ? "/api/github/refresh" : "/api/refresh", { method: "POST", body: "{}" });
    state.selectedLine = null;
    elements["selection-pill"].classList.add("hidden");
    renderSession();
    toast("Diff refreshed. Outdated feedback is marked in the comment list.");
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
    renderSession();
  }
}

elements["start-tour"].addEventListener("click", startTour);
elements["tour-mode-toggle"].addEventListener("click", toggleTourMode);
elements["previous-step"].addEventListener("click", () => navigate("previous"));
elements["next-step"].addEventListener("click", () => navigate("next"));
elements["chat-form"].addEventListener("submit", askAgent);
elements["comment-form"].addEventListener("submit", saveComment);
elements["cancel-comment"].addEventListener("click", () => elements["comment-dialog"].close());
elements["close-button"].addEventListener("click", () => close(state.session.preferences?.closeOutcome ?? "accepted"));
elements["feedback-button"].addEventListener("click", () => close("feedback"));
elements["refresh-button"].addEventListener("click", refresh);
elements["export-menu"].addEventListener("click", (event) => {
  const button = event.target.closest("[data-export-format]");
  if (button) { elements["settings-menu"].open = false; void downloadExport(button.dataset.exportFormat); }
});
elements["pull-request-content"].addEventListener("click", setPullRequestDescriptionMode);
elements["pull-request-description"].addEventListener("click", setPullRequestDescriptionMode);
elements["regenerate-flows"].addEventListener("click", () => regenerateFlows());
elements["regenerate-call-flows"].addEventListener("click", () => regenerateCallFlows());
elements["flow-form"].addEventListener("submit", saveFlow);
elements["cancel-flow"].addEventListener("click", () => elements["flow-dialog"].close());
elements["theme-select"].value = window.reviewTourTheme.preference();
elements["theme-select"].addEventListener("change", () => window.reviewTourTheme.set(elements["theme-select"].value));
elements["prefetch-steps"].addEventListener("change", async () => {
  const previous = state.session.preferences?.prefetchSteps ?? 2;
  const prefetchSteps = Number(elements["prefetch-steps"].value);
  elements["prefetch-steps"].disabled = true;
  try {
    state.session = await api("/api/preferences", { method: "POST", body: JSON.stringify({ prefetchSteps }) });
    renderSession();
  } catch (error) {
    elements["prefetch-steps"].value = String(previous);
    toast(error.message);
  } finally {
    elements["prefetch-steps"].disabled = false;
  }
});
let fileResizeStart = null;
elements["file-resizer"].addEventListener("pointerdown", (event) => {
  fileResizeStart = { pointerId: event.pointerId, x: event.clientX, width: state.filePanelWidth };
  elements["file-resizer"].classList.add("dragging");
  elements["file-resizer"].setPointerCapture(event.pointerId);
});
elements["file-resizer"].addEventListener("pointermove", (event) => {
  if (!fileResizeStart || event.pointerId !== fileResizeStart.pointerId) return;
  setFilePanelWidth(fileResizeStart.width + event.clientX - fileResizeStart.x);
});
elements["file-resizer"].addEventListener("pointerup", (event) => {
  if (!fileResizeStart || event.pointerId !== fileResizeStart.pointerId) return;
  fileResizeStart = null;
  elements["file-resizer"].classList.remove("dragging");
  setFilePanelWidth(state.filePanelWidth, true);
});
elements["file-resizer"].addEventListener("pointercancel", () => {
  fileResizeStart = null;
  elements["file-resizer"].classList.remove("dragging");
});
elements["file-resizer"].addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const width = event.key === "Home" ? FILE_PANEL_MIN : event.key === "End" ? FILE_PANEL_MAX : state.filePanelWidth + (event.key === "ArrowRight" ? 20 : -20);
  setFilePanelWidth(width, true);
});
let agentResizeStart = null;
elements["agent-resizer"].addEventListener("pointerdown", (event) => {
  agentResizeStart = { pointerId: event.pointerId, x: event.clientX, width: state.agentPanelWidth };
  elements["agent-resizer"].classList.add("dragging");
  elements["agent-resizer"].setPointerCapture(event.pointerId);
});
elements["agent-resizer"].addEventListener("pointermove", (event) => {
  if (!agentResizeStart || event.pointerId !== agentResizeStart.pointerId) return;
  setAgentPanelWidth(agentResizeStart.width + agentResizeStart.x - event.clientX);
});
elements["agent-resizer"].addEventListener("pointerup", (event) => {
  if (!agentResizeStart || event.pointerId !== agentResizeStart.pointerId) return;
  agentResizeStart = null;
  elements["agent-resizer"].classList.remove("dragging");
  setAgentPanelWidth(state.agentPanelWidth, true);
});
elements["agent-resizer"].addEventListener("pointercancel", () => {
  agentResizeStart = null;
  elements["agent-resizer"].classList.remove("dragging");
});
elements["agent-resizer"].addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const width = event.key === "Home" ? AGENT_PANEL_MIN : event.key === "End" ? AGENT_PANEL_MAX : state.agentPanelWidth + (event.key === "ArrowLeft" ? 20 : -20);
  setAgentPanelWidth(width, true);
});
window.addEventListener("resize", () => {
  if (!state.session) return;
  setAgentPanelWidth(state.agentPanelWidth);
  setFilePanelWidth(state.filePanelWidth);
});
let splitResizeStart = null;
elements.diff.addEventListener("pointerdown", (event) => {
  const resizer = event.target.closest?.("[data-split-resizer]");
  if (!resizer) return;
  splitResizeStart = { pointerId: event.pointerId, resizer, hunk: resizer.closest(".hunk.split-layout") };
  resizer.classList.add("dragging");
  resizer.setPointerCapture(event.pointerId);
  event.preventDefault();
});
elements.diff.addEventListener("pointermove", (event) => {
  if (!splitResizeStart || event.pointerId !== splitResizeStart.pointerId || !splitResizeStart.hunk) return;
  const bounds = splitResizeStart.hunk.getBoundingClientRect();
  if (bounds.width > 0) setSplitOldWidth(((event.clientX - bounds.left) / bounds.width) * 100);
});
elements.diff.addEventListener("pointerup", (event) => {
  if (!splitResizeStart || event.pointerId !== splitResizeStart.pointerId) return;
  splitResizeStart.resizer.classList.remove("dragging");
  splitResizeStart = null;
  setSplitOldWidth(state.splitOldWidth, true);
});
elements.diff.addEventListener("pointercancel", () => {
  splitResizeStart?.resizer.classList.remove("dragging");
  splitResizeStart = null;
});
elements.diff.addEventListener("dblclick", (event) => {
  if (!event.target.closest?.("[data-split-resizer]")) return;
  setSplitOldWidth(50, true);
});
elements.diff.addEventListener("keydown", (event) => {
  if (!event.target.closest?.("[data-split-resizer]") || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const amount = event.shiftKey ? 5 : 2;
  const width = event.key === "Home" ? SPLIT_PANE_MIN : event.key === "End" ? SPLIT_PANE_MAX : state.splitOldWidth + (event.key === "ArrowRight" ? amount : -amount);
  setSplitOldWidth(width, true);
});
window.addEventListener("review-tour-theme-change", () => {
  if (state.session) renderArchitecture();
  if (state.session && state.activeTab === "call-flows") renderCallFlows();
  if (state.session && state.activeTab === "sequence") renderSequenceDiagrams();
});
elements["sessions-button"].addEventListener("click", () => { elements["settings-menu"].open = false; elements["sessions-dialog"].showModal(); void loadSessions(); });
elements["close-sessions"].addEventListener("click", () => elements["sessions-dialog"].close());
elements["show-archived-sessions"].addEventListener("change", loadSessions);
elements["sessions-list"].addEventListener("click", async (event) => {
  const button = event.target.closest("[data-session-action]");
  const item = event.target.closest("[data-session-id]");
  if (!button || !item) return;
  const id = item.dataset.sessionId;
  const action = button.dataset.sessionAction;
  try {
    if (action === "copy") {
      await navigator.clipboard.writeText(`code-review-tour sessions resume ${id.slice(0, 8)} --open`);
      toast("Reopen command copied");
      return;
    }
    if (action === "rename") {
      const name = window.prompt("Session name", item.querySelector("strong")?.textContent ?? "");
      if (name?.trim()) await updateLibrarySession(id, "rename", name.trim());
      return;
    }
    if (action === "delete") {
      if (!window.confirm("Delete this persisted review session? This cannot be undone.")) return;
      await api(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE", body: JSON.stringify({ confirm: true }) });
      await loadSessions();
      toast("Session deleted");
      return;
    }
    await updateLibrarySession(id, action);
  } catch (error) {
    toast(error.message);
  }
});
elements["agent-select"].addEventListener("change", renderModelOptions);
elements["model-select"].addEventListener("change", renderReasoningOptions);
elements["diff-search"].addEventListener("input", () => {
  state.searchQuery = elements["diff-search"].value;
  state.searchMatches = null;
  window.clearTimeout(state.searchTimer);
  state.searchTimer = window.setTimeout(refreshDiffSearch, 180);
});
elements["status-filter"].addEventListener("change", () => {
  state.statusFilter = elements["status-filter"].value;
  if (state.searchQuery) void refreshDiffSearch(); else renderFilteredDiff();
});
elements["review-filter"].addEventListener("change", () => {
  state.reviewFilter = elements["review-filter"].value;
  renderFilteredDiff();
});
elements["test-files-filter"].addEventListener("click", () => {
  state.testFilesOnly = !state.testFilesOnly;
  state.visibleFile = null;
  renderFilteredDiff();
  elements["test-files-filter"].setAttribute("aria-pressed", String(state.testFilesOnly));
  elements["test-files-filter"].classList.toggle("active", state.testFilesOnly);
});
elements["tree-mode"].addEventListener("change", () => {
  state.treeMode = elements["tree-mode"].value;
  window.localStorage.setItem(preferenceKey("tree-mode"), state.treeMode);
  renderFileTree();
});
elements["diff-layout"].addEventListener("change", () => {
  state.diffLayout = elements["diff-layout"].value;
  window.localStorage.setItem(preferenceKey("diff-layout"), state.diffLayout);
  renderFilteredDiff();
});
elements["diff-tab"].addEventListener("click", () => activateReviewTab("diff"));
elements["call-flows-tab"].addEventListener("click", () => activateReviewTab("call-flows", renderCallFlows));
elements["sequence-tab"].addEventListener("click", () => activateReviewTab("sequence", renderSequenceDiagrams));
elements["findings-tab"].addEventListener("click", () => activateReviewTab("findings", renderFindings));
elements["findings-back"].addEventListener("click", returnToFindingCode);
elements["activity-tab"].addEventListener("click", () => activateReviewTab("activity", renderActivities));
elements["pull-request-tab"].addEventListener("click", () => activateReviewTab("pull-request", renderPullRequest));
elements.flows.addEventListener("click", (event) => {
  const fileButton = event.target.closest("[data-flow-file]");
  if (fileButton) {
    void showAnalysisFile(fileButton.dataset.flowFile);
    return;
  }
  const button = event.target.closest("[data-flow-action]");
  const card = event.target.closest("[data-flow-id]");
  if (!button || !card || state.busy || !reviewIsOpen()) return;
  const flow = state.session.outline?.flows.find((candidate) => candidate.id === card.dataset.flowId);
  if (!flow) return;
  if (button.dataset.flowAction === "edit") openFlowEditor(flow);
  if (button.dataset.flowAction === "regenerate") void regenerateFlows(flow.id);
});
elements["call-flows"].addEventListener("click", (event) => {
  const location = event.target.closest("[data-call-path]");
  if (location) {
    state.activeTab = "diff";
    renderActiveTab();
    void showAnalysisFile(location.dataset.callPath, Number(location.dataset.callLine), location.dataset.callSide);
    return;
  }
  const affected = event.target.closest("[data-flow-file]");
  if (affected) {
    state.activeTab = "diff";
    renderActiveTab();
    void showAnalysisFile(affected.dataset.flowFile);
    return;
  }
  const card = event.target.closest("[data-call-flow-id]");
  const mode = event.target.closest("[data-call-flow-mode]");
  if (card && mode) {
    state.callFlowModes.set(card.dataset.callFlowId, mode.dataset.callFlowMode);
    renderCallFlows();
    return;
  }
  if (card && event.target.closest("[data-call-flow-regenerate]")) void regenerateCallFlows(card.dataset.callFlowId);
});
elements.architecture.addEventListener("click", (event) => {
  const diagramAction = event.target.closest("[data-diagram-action]");
  if (diagramAction) {
    const shell = diagramAction.closest("[data-architecture-key]");
    if (shell) changeArchitectureDiagramView(shell.dataset.architectureKey, diagramAction.dataset.diagramAction);
    return;
  }
  const fileButton = event.target.closest("[data-flow-file]");
  if (fileButton) void showAnalysisFile(fileButton.dataset.flowFile);
});
elements.architecture.addEventListener("pointerdown", (event) => {
  const diagram = event.target.closest(".architecture-diagram[data-architecture-diagram]");
  if (!diagram || event.button !== 0) return;
  const view = architectureDiagramView(diagram.dataset.architectureDiagram);
  state.architectureDiagramDrag = {
    key: diagram.dataset.architectureDiagram,
    pointerId: event.pointerId,
    diagram,
    startX: event.clientX,
    startY: event.clientY,
    originX: view.x,
    originY: view.y,
  };
  diagram.classList.add("dragging");
  diagram.setPointerCapture(event.pointerId);
  event.preventDefault();
});
elements.architecture.addEventListener("pointermove", (event) => {
  const drag = state.architectureDiagramDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  const view = architectureDiagramView(drag.key);
  view.x = drag.originX + event.clientX - drag.startX;
  view.y = drag.originY + event.clientY - drag.startY;
  applyArchitectureDiagramView(drag.key);
});
function finishArchitectureDiagramDrag(event) {
  const drag = state.architectureDiagramDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  drag.diagram.classList.remove("dragging");
  if (drag.diagram.hasPointerCapture(event.pointerId)) drag.diagram.releasePointerCapture(event.pointerId);
  state.architectureDiagramDrag = null;
}
elements.architecture.addEventListener("pointerup", finishArchitectureDiagramDrag);
elements.architecture.addEventListener("pointercancel", finishArchitectureDiagramDrag);
elements.architecture.addEventListener("keydown", (event) => {
  const diagram = event.target.closest(".architecture-diagram[data-architecture-diagram]");
  if (!diagram) return;
  const action = ({ ArrowLeft: "move-left", ArrowRight: "move-right", ArrowUp: "move-up", ArrowDown: "move-down", "+": "zoom-in", "=": "zoom-in", "-": "zoom-out", "0": "reset" })[event.key];
  if (!action) return;
  event.preventDefault();
  changeArchitectureDiagramView(diagram.dataset.architectureDiagram, action);
});
document.querySelector(".tabs").addEventListener("keydown", (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const tabs = availableTabs();
  const currentIndex = tabs.indexOf(state.activeTab);
  const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 :
    (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  const nextTab = tabs[nextIndex];
  const render = nextTab === "call-flows" ? renderCallFlows
    : nextTab === "sequence" ? renderSequenceDiagrams
      : nextTab === "findings" ? renderFindings
        : nextTab === "activity" ? renderActivities
          : nextTab === "pull-request" ? renderPullRequest
            : null;
  activateReviewTab(nextTab, render);
  elements[`${nextTab}-tab`].focus();
});

elements["activity-list"].addEventListener("click", (event) => {
  const fileButton = event.target.closest("[data-activity-file]");
  if (fileButton) {
    void showActivityFile(fileButton.dataset.activityId, fileButton.dataset.activityFile);
    return;
  }
  const currentFileButton = event.target.closest("[data-current-file]");
  if (currentFileButton) {
    void showChangedFile(currentFileButton.dataset.currentFile);
    return;
  }
  const actionButton = event.target.closest("[data-activity-action]");
  const card = event.target.closest("[data-activity-id]");
  if (!actionButton || !card || state.busy || !reviewIsOpen()) return;
  const action = actionButton.dataset.activityAction;
  if ((action === "reject" || action === "undo") && !window.confirm(action === "reject"
    ? "Reject this proposed change? The proposal will remain in the audit trail."
    : "Undo this applied change? This stops if overlapping edits were made afterwards.")) return;
  void (async () => {
    setBusy(true, `${action === "apply" ? "Applying" : action === "reject" ? "Rejecting" : "Undoing"} agent change…`);
    try {
      state.session = await api(`/api/activities/${encodeURIComponent(card.dataset.activityId)}`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      renderSession();
      toast(action === "apply" ? "Agent change applied" : action === "reject" ? "Agent change rejected" : "Agent change undone");
    } catch (error) {
      toast(error.message);
    } finally {
      setBusy(false);
      renderSession();
    }
  })();
});

elements.diff.addEventListener("click", (event) => {
  const inlineComment = event.target.closest("[data-inline-comment-id]");
  if (inlineComment) {
    const comment = state.session.comments.find((candidate) => candidate.id === inlineComment.dataset.inlineCommentId);
    if (comment && reviewIsOpen()) openCommentEditor(comment);
    return;
  }
  const collapseButton = event.target.closest("[data-collapse-file]");
  if (collapseButton) {
    const path = collapseButton.dataset.collapseFile;
    if (state.collapsedFiles.has(path)) state.collapsedFiles.delete(path);
    else state.collapsedFiles.add(path);
    renderDiff(visibleDiffFiles());
    renderTourAnnotation();
    return;
  }
  const expansionButton = event.target.closest("[data-expand-file]");
  if (expansionButton) {
    void showChangedFile(expansionButton.dataset.expandFile, undefined, undefined, 0, undefined, expansionButton.dataset.fileExpansion === "full");
    return;
  }
  const pageButton = event.target.closest("[data-diff-page]");
  if (pageButton) {
    void showChangedFile(pageButton.dataset.pageFile, undefined, undefined, Number(pageButton.dataset.diffPage), Number(pageButton.dataset.context), pageButton.dataset.pageFull === "true");
    return;
  }
  const contextButton = event.target.closest("[data-expand-context]");
  if (contextButton) {
    const current = Number(contextButton.dataset.context) || 3;
    const next = current < 10 ? 10 : current < 25 ? 25 : current < 100 ? 100 : 200;
    void showChangedFile(contextButton.dataset.expandContext, undefined, undefined, 0, next);
    return;
  }
  const reviewedButton = event.target.closest("[data-reviewed-file]");
  if (reviewedButton) {
    void setReviewed(reviewedButton.dataset.reviewedFile, !(state.session.reviewedFiles ?? []).includes(reviewedButton.dataset.reviewedFile));
    return;
  }
  const findingPin = event.target.closest("[data-finding-id]");
  if (findingPin) {
    hideFindingTooltip();
    openFindingFromCode(findingPin.dataset.findingId);
    return;
  }
  const lineTool = event.target.closest("[data-line-tool]");
  if (lineTool) {
    const toolRow = lineTool.closest(".diff-row");
    if (!toolRow?.dataset.line || lineTool.disabled) return;
    if (lineTool.dataset.lineTool === "comment") openLineComment(toolRow);
    else askAboutLine(toolRow);
    return;
  }
  if (!reviewIsOpen()) return;
  const row = event.target.closest(".diff-row");
  if (!row || !row.dataset.line) return;
  if (event.target.closest(".line-action")) {
    elements.diff.querySelectorAll(".line-action").forEach((action) => { action.tabIndex = -1; });
    event.target.closest(".line-action").tabIndex = 0;
  }
  if (
    state.selectedLine &&
    state.selectedLine.path === row.dataset.path &&
    state.selectedLine.side === row.dataset.side &&
    state.selectedLine.line === Number(row.dataset.line)
  ) {
    openComment(state.selectedLine);
  } else {
    selectLine(row);
  }
});
let syncingSplitScroll = false;
function syncSplitScroll(hunk, side, scrollLeft) {
  syncingSplitScroll = true;
  hunk.querySelectorAll(`.diff-row.split-side[data-side="${side}"]`).forEach((row) => {
    row.scrollLeft = scrollLeft;
  });
  window.requestAnimationFrame(() => { syncingSplitScroll = false; });
}

elements.diff.addEventListener("scroll", (event) => {
  const source = event.target.closest?.(".diff-row.split-side");
  if (!source || syncingSplitScroll) return;
  const hunk = source.closest(".hunk.split-layout");
  if (!hunk) return;
  syncSplitScroll(hunk, source.dataset.side, source.scrollLeft);
}, true);
elements.diff.addEventListener("wheel", (event) => {
  const hunk = event.target.closest?.(".hunk.split-layout");
  const delta = event.deltaX || (event.shiftKey ? event.deltaY : 0);
  if (!hunk || !delta) return;
  const hoveredSide = event.target.closest?.(".diff-row.split-side");
  const side = hoveredSide?.dataset.side ?? (event.clientX < hunk.getBoundingClientRect().left + hunk.clientWidth * state.splitOldWidth / 100 ? "old" : "new");
  const rows = [...hunk.querySelectorAll(`.diff-row.split-side[data-side="${side}"]`)];
  const scrollableRow = rows.reduce((best, row) => row.scrollWidth - row.clientWidth > best.scrollWidth - best.clientWidth ? row : best, rows[0]);
  if (!scrollableRow || scrollableRow.scrollWidth <= scrollableRow.clientWidth) return;
  const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 22 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? scrollableRow.clientWidth : 1;
  const next = Math.max(0, Math.min(scrollableRow.scrollWidth - scrollableRow.clientWidth, scrollableRow.scrollLeft + delta * scale));
  if (next === scrollableRow.scrollLeft) return;
  event.preventDefault();
  syncSplitScroll(hunk, side, next);
}, { passive: false });
elements.diff.addEventListener("pointerover", (event) => {
  const pin = event.target.closest(".finding-pin");
  if (pin) showFindingTooltip(pin);
});
elements.diff.addEventListener("pointerout", (event) => {
  const pin = event.target.closest(".finding-pin");
  if (pin && !pin.contains(event.relatedTarget)) hideFindingTooltip();
});
elements.diff.addEventListener("focusin", (event) => {
  const pin = event.target.closest(".finding-pin");
  if (pin) showFindingTooltip(pin);
});
elements.diff.addEventListener("focusout", (event) => {
  if (event.target.closest(".finding-pin")) hideFindingTooltip();
});
elements.diff.addEventListener("keydown", (event) => {
  if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
  const current = event.target.closest(".line-action");
  if (!current) return;
  const actions = [...elements.diff.querySelectorAll(".line-action:not(:disabled)")];
  const currentIndex = actions.indexOf(current);
  const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? actions.length - 1 : Math.max(0, Math.min(actions.length - 1, currentIndex + (event.key === "ArrowDown" ? 1 : -1)));
  event.preventDefault();
  current.tabIndex = -1;
  actions[nextIndex].tabIndex = 0;
  actions[nextIndex].focus();
});
elements["file-tree"].addEventListener("click", (event) => {
  const reviewButton = event.target.closest("[data-review-file]");
  if (reviewButton) {
    void setReviewed(reviewButton.dataset.reviewFile, !(state.session.reviewedFiles ?? []).includes(reviewButton.dataset.reviewFile));
    return;
  }
  const button = event.target.closest(".file-button");
  if (!button) return;
  if (button.dataset.source) return showRepositoryFile(button.dataset.source);
  if (button.dataset.file) void showChangedFile(button.dataset.file);
});

async function handleFindingClick(event) {
  const action = event.target.closest("button")?.dataset.action;
  const item = event.target.closest("[data-finding-id]");
  if (!action || !item) return;
  const finding = state.session.outline?.findings.find((candidate) => candidate.id === item.dataset.findingId);
  if (!finding) return;
  if (action === "open-finding") {
    event.preventDefault();
    openFindingFromCode(finding.id);
    return;
  }
  if (action === "jump") {
    event.preventDefault();
    state.findingReturn = null;
    state.focusedFindingId = null;
    return showChangedFile(finding.path, finding.line, finding.side);
  }
  if (!reviewIsOpen()) return;
  try {
    state.session = await api(`/api/findings/${encodeURIComponent(finding.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ action }),
    });
    renderSession();
    toast(action === "convert" ? "Finding added to review feedback" : `Finding ${action === "dismiss" ? "dismissed" : "reopened"}`);
  } catch (error) {
    toast(error.message);
  }
}

elements["finding-list"].addEventListener("click", handleFindingClick);
elements["phase-finding-list"].addEventListener("click", handleFindingClick);
elements["all-findings-list"].addEventListener("click", handleFindingClick);
elements["phase-files"].addEventListener("click", (event) => {
  const path = event.target.closest("[data-phase-file]")?.dataset.phaseFile;
  if (path) void showChangedFile(path);
});

elements["comment-list"].addEventListener("click", async (event) => {
  const action = event.target.closest("button")?.dataset.action;
  const item = event.target.closest("[data-comment-id]");
  if (!action || !item) return;
  const comment = state.session.comments.find((candidate) => candidate.id === item.dataset.commentId);
  if (!comment) return;
  if (action === "jump") {
    return showChangedFile(comment.path, comment.line, comment.side);
  }
  if (!reviewIsOpen()) return;
  if (action === "edit") return openCommentEditor(comment);
  if (action === "delete") {
    if (!window.confirm(`Delete feedback at ${comment.path}:${comment.line}?`)) return;
    try {
      state.session = await api(`/api/comments/${encodeURIComponent(comment.id)}`, { method: "DELETE" });
      renderSession();
      toast("Review comment deleted");
    } catch (error) {
      toast(error.message);
    }
  }
});

elements["comment-list"].addEventListener("change", async (event) => {
  const checkbox = event.target.closest('input[data-action="github"]');
  const item = event.target.closest("[data-comment-id]");
  if (!checkbox || !item || !reviewIsOpen()) return;
  checkbox.disabled = true;
  try {
    state.session = await api(`/api/comments/${encodeURIComponent(item.dataset.commentId)}/github`, {
      method: "PATCH",
      body: JSON.stringify({ publish: checkbox.checked }),
    });
    renderSession();
  } catch (error) {
    checkbox.checked = !checkbox.checked;
    checkbox.disabled = false;
    toast(error.message);
  }
});

elements["update-button"].addEventListener("click", installUpdate);

try {
  state.session = await api("/api/session");
  renderSession();
  void checkForUpdate();
} catch (error) {
  elements["connection-banner"].textContent = `Could not load this review: ${error.message}. Check that the server is running and reopen the URL printed in its terminal.`;
  elements["connection-banner"].classList.remove("hidden");
}

window.setInterval(async () => {
  if (state.pollInFlight || (state.session && !reviewIsOpen())) return;
  state.pollInFlight = true;
  const generation = ++state.pollGeneration;
  try {
    const latest = await api("/api/session");
    if (generation !== state.pollGeneration) return;
    elements["connection-banner"].classList.add("hidden");
    const expectedActivity = state.expectedAgentActivity;
    const receivedExpectedActivity = Boolean(
      expectedActivity && latest.agentActivity?.kind === expectedActivity.kind && latest.agentActivity.id !== expectedActivity.previousActivityId
    );
    if (receivedExpectedActivity) state.expectedAgentActivity = null;
    if (state.session && (!expectedActivity || receivedExpectedActivity)) {
      state.session.agentActivity = latest.agentActivity;
      renderAgentActivity();
    }
    if (!state.session || latest.revision > state.session.revision || latest.tourState !== state.session.tourState || (state.session.status === "open" && latest.status !== "open")) {
      const pendingLocalActivity = expectedActivity && !receivedExpectedActivity ? state.session?.agentActivity : undefined;
      state.session = latest;
      if (pendingLocalActivity) state.session.agentActivity = pendingLocalActivity;
      renderSession();
    }
  } catch {
    if (!state.session || reviewIsOpen()) elements["connection-banner"].classList.remove("hidden");
  } finally {
    if (generation === state.pollGeneration) state.pollInFlight = false;
  }
}, 2_000);

window.setInterval(checkForUpdate, 6 * 60 * 60 * 1_000);
