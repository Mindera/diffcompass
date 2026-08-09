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
  activeTab: "diff",
  visibleFile: null,
  diffCache: new Map(),
  diffCacheRevision: null,
  fileRequestId: 0,
  proposalPreview: false,
  searchQuery: "",
  searchMatches: null,
  searchRequestId: 0,
  searchTimer: null,
  statusFilter: "",
  reviewFilter: "",
  preferenceRepository: null,
  changedOnly: null,
  diffLayout: null,
  pollInFlight: false,
  pollGeneration: 0,
};

const elements = Object.fromEntries(
  [
    "repository-label", "comparison-label", "file-count", "file-tree", "diff", "empty-diff", "diff-view", "flows-view", "flows", "flows-empty", "diff-tab", "flows-tab", "activity-tab", "activity-tab-count", "activity-view", "activity-empty", "activity-list", "pull-request-tab", "pull-request-view", "pull-request-content", "large-diff-notice", "connection-banner", "diff-search", "status-filter", "review-filter", "changed-only", "diff-layout", "filter-summary",
    "theme-select", "sessions-button", "sessions-dialog", "close-sessions", "show-archived-sessions", "sessions-list", "refresh-button", "close-button", "feedback-button", "closed-banner", "tour-empty", "tour-active", "start-tour", "tour-title",
    "tour-summary", "step-count", "progress-value", "step-anchor", "step-title", "step-objective",
    "step-explanation", "previous-step", "next-step", "chat-messages", "chat-form", "chat-input",
    "selection-pill", "comment-dialog", "comment-form", "comment-location", "comment-body", "cancel-comment", "toast",
    "agent-name", "agent-mode", "agent-select", "model-select", "reasoning-select", "agent-note", "comment-drawer", "comment-list", "comment-count", "save-comment", "finding-drawer", "finding-list", "finding-count",
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

function renderInlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function renderMarkdown(value) {
  const output = [];
  let listOpen = false;
  for (const line of String(value).split("\n")) {
    const item = /^\s*[-*]\s+(.+)$/.exec(line);
    if (item) {
      if (!listOpen) output.push("<ul>");
      listOpen = true;
      output.push(`<li>${renderInlineMarkdown(item[1])}</li>`);
      continue;
    }
    if (listOpen) {
      output.push("</ul>");
      listOpen = false;
    }
    if (line.trim()) output.push(`<p>${renderInlineMarkdown(line)}</p>`);
  }
  if (listOpen) output.push("</ul>");
  return output.join("");
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

function toast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.remove("hidden");
  window.setTimeout(() => elements.toast.classList.add("hidden"), 3500);
}

function setBusy(busy, label = "Working…") {
  state.busy = busy;
  elements["start-tour"].disabled = busy;
  elements["previous-step"].disabled = busy;
  elements["next-step"].disabled = busy;
  elements["agent-select"].disabled = busy;
  elements["model-select"].disabled = busy;
  elements["reasoning-select"].disabled = busy;
  elements["refresh-button"].disabled = busy;
  elements["close-button"].disabled = busy;
  elements["feedback-button"].disabled = busy;
  elements["chat-form"].querySelector("button").disabled = busy || !reviewIsOpen();
  if (busy && !elements["tour-active"].classList.contains("hidden")) {
    elements["step-explanation"].innerHTML = `<span class="loading">${escapeHtml(label)}</span>`;
  }
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
  return `review-tour:${state.session.comparison.repositoryRoot}:${name}`;
}

function initializeUiPreferences() {
  const repository = state.session.comparison.repositoryRoot;
  if (state.preferenceRepository === repository) return;
  state.preferenceRepository = repository;
  const savedLayout = window.localStorage.getItem(preferenceKey("diff-layout"));
  const savedChangedOnly = window.localStorage.getItem(preferenceKey("changed-only"));
  state.diffLayout = ["unified", "split"].includes(savedLayout) ? savedLayout : state.session.preferences?.diffLayout ?? "unified";
  state.changedOnly = savedChangedOnly === null ? state.session.preferences?.changedFilesOnly ?? false : savedChangedOnly === "true";
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

function renderTreeNode(node, depth = 0) {
  return Object.entries(node)
    .sort(([a, av], [b, bv]) => Number(Boolean(av.__file)) - Number(Boolean(bv.__file)) || a.localeCompare(b))
    .map(([name, value]) => {
      if (value.__file) {
        const file = value.__file;
        if (!file.changed) return `<button class="file-button unchanged" data-source="${escapeHtml(file.path)}" title="${escapeHtml(file.path)}"><span class="file-name">${escapeHtml(name)}</span></button>`;
        const reviewed = state.session.reviewedFiles?.includes(file.path);
        return `<div class="file-entry${reviewed ? " reviewed" : ""}"><button class="file-button" data-file="${escapeHtml(file.path)}">
          <span class="file-name" title="${escapeHtml(file.path)}">${escapeHtml(name)}</span>
          <span class="file-stats"><span class="plus">+${file.changed.additions}</span> <span class="minus">-${file.changed.deletions}</span></span>
        </button><button class="review-toggle" type="button" data-review-file="${escapeHtml(file.path)}" aria-label="${escapeHtml(`${reviewed ? "Mark unreviewed" : "Mark reviewed"}: ${file.path}`)}" title="${reviewed ? "Mark unreviewed" : "Mark reviewed"}"${reviewIsOpen() ? "" : " disabled"}>${reviewed ? "✓" : "○"}</button></div>`;
      }
      return `<details class="tree-directory" ${depth === 0 ? "open" : ""}><summary>${escapeHtml(name)}</summary><div class="tree-children">${renderTreeNode(value, depth + 1)}</div></details>`;
    })
    .join("");
}

function filteredChangedFiles() {
  const reviewed = new Set(state.session.reviewedFiles ?? []);
  const searchMatches = state.searchQuery && state.searchMatches ? new Set(state.searchMatches) : null;
  return state.session.comparison.files.filter((file) =>
    (!state.statusFilter || file.status === state.statusFilter) &&
    (!state.reviewFilter || (state.reviewFilter === "reviewed") === reviewed.has(file.path)) &&
    (!searchMatches || searchMatches.has(file.path))
  );
}

function renderFileTree() {
  const comparison = state.session.comparison;
  const changedFiles = filteredChangedFiles();
  const filtering = Boolean(state.searchQuery || state.statusFilter || state.reviewFilter);
  const repositoryFiles = state.changedOnly || filtering
    ? changedFiles.map((file) => file.path)
    : comparison.repositoryFiles ?? comparison.files.map((file) => file.path);
  elements["file-tree"].innerHTML = renderTreeNode(treeFromFiles(repositoryFiles, changedFiles));
  const reviewedCount = (state.session.reviewedFiles ?? []).length;
  elements["file-count"].textContent = filtering
    ? `${changedFiles.length}/${comparison.files.length} match`
    : `${comparison.files.length} changed · ${reviewedCount} reviewed`;
  elements["filter-summary"].textContent = `${changedFiles.length} of ${comparison.files.length} changed files · ${reviewedCount} reviewed`;
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
    .map((finding) => `<button class="finding-pin ${finding.priority.toLowerCase()}" data-finding-id="${escapeHtml(finding.id)}" title="${escapeHtml(finding.message)}">${finding.priority}</button>`).join("");
}

function renderUnifiedRow(file, row, findings) {
  const line = rowLine(row);
  const side = rowSide(row);
  const prefix = row.kind === "addition" ? "+" : row.kind === "deletion" ? "−" : " ";
  return `<div class="diff-row ${row.kind}" data-path="${escapeHtml(file.path)}" data-side="${side}" data-line="${line ?? ""}" data-content="${escapeHtml(row.content)}">
    <span class="line-number">${row.oldLine ?? ""}</span><span class="line-number">${row.newLine ?? ""}</span>
    <button class="line-prefix line-action" type="button" tabindex="-1"${line && !state.proposalPreview ? ` aria-describedby="diff-instructions" aria-label="${escapeHtml(`Review ${file.path}, ${side} line ${line}`)}"` : " disabled"}><span class="row-prefix">${prefix}</span><span class="review-dot hidden">●</span></button>
    <span class="finding-markers">${findingPins(file, row, side, findings)}</span><pre class="line-code">${escapeHtml(row.content || " ")}</pre>
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
  const kind = row?.kind ?? "empty";
  const prefix = kind === "addition" ? "+" : kind === "deletion" ? "−" : " ";
  return `<div class="diff-row split-side ${kind}" data-path="${escapeHtml(file.path)}" data-side="${side}" data-line="${line ?? ""}" data-content="${escapeHtml(content)}">
    <span class="line-number">${line ?? ""}</span>
    <button class="line-prefix line-action" type="button" tabindex="-1"${line && !state.proposalPreview ? ` aria-describedby="diff-instructions" aria-label="${escapeHtml(`Review ${file.path}, ${side} line ${line}`)}"` : " disabled"}><span class="row-prefix">${prefix}</span><span class="review-dot hidden">●</span></button>
    <span class="finding-markers">${row ? findingPins(file, row, side, findings) : ""}</span><pre class="line-code">${escapeHtml(content || " ")}</pre>
  </div>`;
}

function renderDiff(files) {
  const findings = state.proposalPreview ? [] : state.session.outline?.findings ?? [];
  elements.diff.innerHTML = files
    .map((file) => `<section class="diff-file" id="file-${CSS.escape(file.path)}" data-path="${escapeHtml(file.path)}">
      <header class="diff-file-header">
        <span class="diff-file-title"><span class="status">${escapeHtml(file.status)}</span>${escapeHtml(file.path)}</span>
        <span class="file-stats">${state.proposalPreview ? '<span class="proposal-label">pending proposal</span> · ' : `<button class="text-button review-file-button" type="button" data-reviewed-file="${escapeHtml(file.path)}"${reviewIsOpen() ? "" : " disabled"}>${state.session.reviewedFiles?.includes(file.path) ? "✓ Reviewed" : "Mark reviewed"}</button> · `}${file._page ? `<button class="text-button" type="button" data-diff-page="${Math.max(0, file._page.offset - file._page.limit)}" data-page-file="${escapeHtml(file.path)}" data-context="${fileContext(file)}"${file._page.offset === 0 ? " disabled" : ""}>Previous chunk</button> <span>${file._page.offset + 1}–${Math.min(file._page.totalRows, file._page.offset + file._page.limit)} of ${file._page.totalRows}</span> <button class="text-button" type="button" data-diff-page="${file._page.offset + file._page.limit}" data-page-file="${escapeHtml(file.path)}" data-context="${fileContext(file)}"${file._page.offset + file._page.limit >= file._page.totalRows ? " disabled" : ""}>Next chunk</button> · ` : ""}<span class="plus">+${file.additions}</span> <span class="minus">-${file.deletions}</span></span>
      </header>
      ${file.hunks.map((hunk) => `<div class="hunk">
        <div class="hunk-header"><span>${escapeHtml(hunk.header)}</span>${!state.proposalPreview && fileContext(file) < 200 ? `<button class="text-button" type="button" data-expand-context="${escapeHtml(file.path)}" data-context="${fileContext(file)}">Expand context</button>` : ""}</div>
        ${state.diffLayout === "split"
          ? splitRows(hunk.rows).map(([oldRow, newRow]) => `<div class="split-row">${renderSplitSide(file, oldRow, "old", findings)}${renderSplitSide(file, newRow, "new", findings)}</div>`).join("")
          : hunk.rows.map((row) => renderUnifiedRow(file, row, findings)).join("")}
      </div>`).join("")}
    </section>`)
    .join("");
  const actions = [...elements.diff.querySelectorAll(".line-action:not(:disabled)")];
  const selected = actions.find((action) => action.closest(".diff-row")?.classList.contains("selected")) ?? actions[0];
  if (selected) selected.tabIndex = 0;
  elements["empty-diff"].classList.toggle("hidden", files.length > 0);
}

function visibleDiffFiles() {
  const comparison = state.session.comparison;
  const files = filteredChangedFiles();
  if (comparison.diffMode !== "file") return files;
  const path = currentStep()?.anchor.path ?? state.visibleFile ?? files[0]?.path;
  state.visibleFile = path;
  const cached = state.diffCache.get(path);
  return cached ? [cached] : [];
}

async function showChangedFile(path, line, side, requestedOffset, requestedContext) {
  const requestId = ++state.fileRequestId;
  state.activeTab = "diff";
  state.proposalPreview = false;
  state.visibleFile = path;
  renderActiveTab();
  let files = filteredChangedFiles();
  if (state.session.comparison.diffMode === "file" || requestedContext !== undefined) {
    let file = state.diffCache.get(path);
    const containsAnchor = !line || !side || file?.hunks.some((hunk) => hunk.rows.some((row) => (side === "old" ? row.oldLine : row.newLine) === line));
    if (!file || requestedOffset !== undefined || requestedContext !== undefined || !containsAnchor) {
      elements.diff.innerHTML = '<div class="empty">Loading file diff…</div>';
      elements["empty-diff"].classList.add("hidden");
      try {
        const query = new URLSearchParams({ path });
        if (requestedOffset !== undefined) query.set("offset", String(requestedOffset));
        if (requestedContext !== undefined) query.set("context", String(requestedContext));
        if (line && side) { query.set("line", String(line)); query.set("side", side); }
        const result = await api(`/api/diff?${query}`);
        if (requestId !== state.fileRequestId || state.visibleFile !== path) return;
        file = { ...result.file, _context: result.context, _page: { offset: result.offset, limit: result.limit, totalRows: result.totalRows } };
        state.diffCache.set(path, file);
      } catch (error) {
        if (requestId === state.fileRequestId) toast(error.message);
        return;
      }
    }
    files = [file];
  } else if (!files.some((file) => file.path === path)) {
    const requested = state.session.comparison.files.find((file) => file.path === path);
    files = requested ? [requested] : files;
  }
  renderDiff(files);
  renderComments();
  renderFindings();
  document.querySelector(`.diff-file[data-path="${CSS.escape(path)}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  if (line && side) {
    const row = document.querySelector(`.diff-row[data-path="${CSS.escape(path)}"][data-side="${side}"][data-line="${line}"]`);
    row?.scrollIntoView({ behavior: "smooth", block: "center" });
    row?.classList.add("selected");
  }
  highlightAnchor();
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
    elements.diff.innerHTML = `<section class="source-file"><header class="diff-file-header"><span class="diff-file-title">${escapeHtml(path)}</span><span class="muted">unchanged</span></header><pre class="source-code">${escapeHtml(file.content)}</pre></section>`;
    elements["empty-diff"].classList.add("hidden");
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
  return outline?.steps[currentStepIndex];
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
  elements["agent-note"].textContent = adapter?.note ?? "Install Codex, Claude Code, Gemini, or Copilot, then restart the server.";
  elements["agent-name"].textContent = adapter?.label ?? "No agent detected";
  renderReasoningOptions();
}

function renderAgentOptions() {
  const adapters = state.session.agentAdapters ?? [];
  const selected = state.session.agentSelection?.adapterId ?? adapters[0]?.id;
  elements["agent-select"].innerHTML = adapters
    .map((adapter) => `<option value="${escapeHtml(adapter.id)}">${escapeHtml(adapter.label)}</option>`)
    .join("");
  if (selected) elements["agent-select"].value = selected;
  elements["agent-select"].disabled = state.busy || !reviewIsOpen();
  elements["model-select"].disabled = state.busy || !reviewIsOpen();
  elements["start-tour"].disabled = state.busy || !reviewIsOpen() || adapters.length === 0;
  if (adapters.length === 0) elements["agent-note"].textContent = "Install Codex, Claude Code, Gemini, or Copilot, then restart the server.";
  renderModelOptions();
}

function renderComments() {
  document.querySelectorAll(".diff-row.has-comment").forEach((row) => {
    row.classList.remove("has-comment");
    row.querySelector(".review-dot")?.classList.add("hidden");
    row.removeAttribute("title");
  });
  for (const comment of state.session.comments) {
    const selector = `.diff-row[data-path="${CSS.escape(comment.path)}"][data-side="${comment.side}"][data-line="${comment.line}"]`;
    const row = document.querySelector(selector);
    if (!row) continue;
    row.classList.add("has-comment");
    row.title = comment.body;
    row.querySelector(".review-dot")?.classList.remove("hidden");
  }
  elements["comment-count"].textContent = String(state.session.comments.length);
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
    <div>${renderMarkdown(pullRequest.body || "No description provided.")}</div>
    <h3>Checks</h3><ul>${checks}</ul>
    <h3>Commits</h3><ul>${commits}</ul>
    <h3>Existing review threads${pullRequest.threadsTruncated ? " (first 100)" : ""}</h3>${threads}`;
}

function renderFindings() {
  document.querySelectorAll(".diff-row.has-finding").forEach((row) => row.classList.remove("has-finding"));
  const findings = state.session.outline?.findings ?? [];
  for (const finding of findings.filter((candidate) => candidate.status === "open")) {
    const row = document.querySelector(`.diff-row[data-path="${CSS.escape(finding.path)}"][data-side="${finding.side}"][data-line="${finding.line}"]`);
    row?.classList.add("has-finding");
  }
  elements["finding-count"].textContent = String(findings.filter((finding) => finding.status === "open").length);
  const disabled = reviewIsOpen() ? "" : " disabled";
  const ordered = [...findings].sort((left, right) => left.priority.localeCompare(right.priority) || left.path.localeCompare(right.path) || left.line - right.line);
  elements["finding-list"].innerHTML = ordered.length === 0
    ? '<p class="comment-empty">No evidence-backed findings were generated.</p>'
    : ordered.map((finding) => `<article class="finding-item ${finding.priority.toLowerCase()} ${escapeHtml(finding.status)}${finding.outdated ? " outdated" : ""}" data-finding-id="${escapeHtml(finding.id)}">
      <div class="finding-heading"><button class="comment-jump" data-action="jump" type="button">${escapeHtml(finding.path)}:${finding.line}</button><span class="finding-priority">${finding.priority}</span></div>
      <strong>${escapeHtml(finding.category)} · ${escapeHtml(finding.severity)}</strong>
      <p>${renderInlineMarkdown(finding.message)}</p>
      <details><summary>Evidence · ${escapeHtml(finding.confidence)} confidence</summary><p>${renderInlineMarkdown(finding.evidence)}</p></details>
      <div class="finding-badges"><span>${finding.introduced === true ? "introduced" : finding.introduced === false ? "pre-existing" : "attribution unknown"}</span><span>${finding.tested ? "tested" : "untested"}</span><span>blast ${finding.blastRadiusSize}</span><span>${escapeHtml(finding.pinScope)} pin</span>${finding.recallGuard ? "<span>recall-protected</span>" : ""}${finding.outdated ? "<span>outdated</span>" : ""}</div>
      <div class="comment-actions">
        ${finding.status === "open" ? `<button class="text-button" data-action="convert" type="button"${disabled}${finding.outdated ? " disabled" : ""}>Add as feedback</button><button class="text-button" data-action="dismiss" type="button"${disabled}>Dismiss</button>` : finding.status === "dismissed" ? `<button class="text-button" data-action="reopen" type="button"${disabled}>Reopen</button>` : '<span class="muted">Added to feedback</span>'}
      </div>
    </article>`).join("");
}

function parseSequence(mermaid) {
  const participants = [];
  const participantIds = new Set();
  const events = [];
  const unsupported = [];
  for (const rawLine of String(mermaid).split("\n").slice(1)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("%%")) continue;
    const participant = /^(?:participant|actor)\s+([^\s]+)(?:\s+as\s+(.+))?$/i.exec(line);
    if (participant) {
      participants.push({ id: participant[1], label: participant[2] ?? participant[1] });
      participantIds.add(participant[1]);
      continue;
    }
    const message = /^(\S+)\s*(--?>>|--?>)\s*([^:]+):\s*(.+)$/.exec(line);
    if (message) {
      const from = message[1];
      const to = message[3].trim();
      if (!participantIds.has(from)) { participants.push({ id: from, label: from }); participantIds.add(from); }
      if (!participantIds.has(to)) { participants.push({ id: to, label: to }); participantIds.add(to); }
      events.push({ from, to, label: message[4], return: message[2].startsWith("--") });
    }
    else if (/^(alt|else|loop|opt|end)\b/i.test(line)) events.push({ control: line });
    else unsupported.push(line);
  }
  return { participants, events, unsupported };
}

function renderFlows() {
  const flows = state.session.outline?.flows ?? [];
  elements["flows-empty"].classList.toggle("hidden", flows.length > 0);
  elements["flows-empty"].textContent = state.session.outline
    ? "No goal-critical, high-blast runtime flow was identified for this change."
    : "Start the tour to generate grounded main-flow diagrams.";
  elements.flows.innerHTML = flows.map((flow) => {
    const sequence = parseSequence(flow.mermaid);
    return `<article class="flow-card">
      <header><div><span class="provenance ${flow.provenance}">${escapeHtml(flow.provenance)}</span><h2>${escapeHtml(flow.title)}</h2></div><span class="blast">affects ${flow.blastRadiusSize}</span></header>
      <p>${escapeHtml(flow.summary)}</p>
      ${sequence.unsupported.length > 0 ? `<div class="flow-warning">This flow uses unsupported Mermaid constructs, so only its source is shown to avoid a misleading partial diagram.</div>` : `<div class="sequence-diagram" role="img" aria-label="Sequence diagram: ${escapeHtml(flow.title)}">
        <div class="sequence-participants">${sequence.participants.map((participant) => `<div><strong>${escapeHtml(participant.label)}</strong><span>${escapeHtml(participant.id)}</span></div>`).join("")}</div>
        <div class="sequence-events">${sequence.events.map((event) => event.control
          ? `<div class="sequence-control">${escapeHtml(event.control)}</div>`
          : `<div class="sequence-event${event.return ? " return" : ""}"><span>${escapeHtml(event.from)}</span><b>${event.return ? "⇠" : "→"}</b><span>${escapeHtml(event.to)}</span><em>${escapeHtml(event.label)}</em></div>`).join("")}</div>
      </div>`}
      <details class="mermaid-source"${sequence.unsupported.length > 0 ? " open" : ""}><summary>Mermaid source</summary><pre>${escapeHtml(flow.mermaid)}</pre></details>
    </article>`;
  }).join("");
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
  return ["diff", "flows", "activity", ...(state.session?.pullRequest ? ["pull-request"] : [])];
}

function renderActiveTab() {
  for (const tabName of ["diff", "flows", "activity", "pull-request"]) {
    const active = state.activeTab === tabName;
    elements[`${tabName}-view`].classList.toggle("hidden", !active);
    elements[`${tabName}-tab`].classList.toggle("active", active);
    elements[`${tabName}-tab`].setAttribute("aria-selected", String(active));
    elements[`${tabName}-tab`].tabIndex = active ? 0 : -1;
  }
}

function highlightAnchor() {
  document.querySelectorAll(".tour-anchor").forEach((row) => row.classList.remove("tour-anchor"));
  const step = currentStep();
  if (!step) return;
  const { path, side, startLine, endLine } = step.anchor;
  const rows = [...document.querySelectorAll(`.diff-row[data-path="${CSS.escape(path)}"][data-side="${side}"]`)]
    .filter((row) => Number(row.dataset.line) >= startLine && Number(row.dataset.line) <= endLine);
  rows.forEach((row) => row.classList.add("tour-anchor"));
  (rows[0] ?? document.querySelector(`.diff-file[data-path="${CSS.escape(path)}"]`))?.scrollIntoView({ behavior: "smooth", block: "center" });
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
  const active = Boolean(outline);
  elements["tour-empty"].classList.toggle("hidden", active);
  elements["tour-active"].classList.toggle("hidden", !active);
  if (!outline) return;

  const step = outline.steps[currentStepIndex];
  if (state.session.comparison.diffMode === "file" && state.visibleFile !== step.anchor.path) void showChangedFile(step.anchor.path, step.anchor.startLine, step.anchor.side);
  elements["tour-title"].textContent = outline.title;
  elements["tour-summary"].textContent = outline.summary;
  elements["step-count"].textContent = `Step ${currentStepIndex + 1} of ${outline.steps.length}`;
  elements["progress-value"].value = ((currentStepIndex + 1) / outline.steps.length) * 100;
  elements["step-anchor"].textContent = `${step.anchor.path}:${step.anchor.startLine}-${step.anchor.endLine}`;
  elements["step-title"].textContent = step.title;
  elements["step-objective"].textContent = step.objective;
  elements["step-explanation"].innerHTML = renderMarkdown(step.explanation || "Waiting for the agent…");
  elements["previous-step"].disabled = state.busy || !reviewIsOpen() || currentStepIndex === 0;
  elements["next-step"].disabled = state.busy || !reviewIsOpen() || currentStepIndex === outline.steps.length - 1;
  renderMessages();
  highlightAnchor();
}

function renderFilteredDiff() {
  renderFileTree();
  const files = visibleDiffFiles();
  renderDiff(files);
  elements["empty-diff"].textContent = filteredChangedFiles().length === 0
    ? "No changed files match these filters."
    : "No changes found for this comparison.";
  const large = state.session.comparison.diffMode === "file";
  if (large && files.length === 0 && filteredChangedFiles().length > 0) {
    const target = filteredChangedFiles()[0].path;
    state.visibleFile = target;
    void showChangedFile(target);
  }
  renderComments();
  renderFindings();
  highlightAnchor();
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
    renderSession();
    toast(reviewed ? "File marked reviewed" : "File marked unreviewed");
  } catch (error) {
    toast(error.message);
  }
}

function renderSession() {
  const { comparison, comments } = state.session;
  initializeUiPreferences();
  state.proposalPreview = false;
  elements["repository-label"].textContent = comparison.repositoryName;
  elements["comparison-label"].textContent = `${comparison.base} → working tree`;
  elements["diff-search"].value = state.searchQuery;
  elements["status-filter"].value = state.statusFilter;
  elements["review-filter"].value = state.reviewFilter;
  elements["changed-only"].checked = state.changedOnly;
  elements["diff-layout"].value = state.diffLayout;
  renderFileTree();
  const large = comparison.diffMode === "file";
  if (state.diffCacheRevision !== state.session.revision) {
    state.diffCache.clear();
    state.diffCacheRevision = state.session.revision;
    if (state.searchQuery) void refreshDiffSearch();
  }
  elements["large-diff-notice"].classList.toggle("hidden", !large);
  elements["large-diff-notice"].textContent = large ? `Large diff (${comparison.diffRowCount.toLocaleString()} rows): loading one file at a time.` : "";
  renderDiff(visibleDiffFiles());
  if (large && visibleDiffFiles().length === 0 && filteredChangedFiles().length > 0) {
    const step = currentStep();
    const target = filteredChangedFiles().some((file) => file.path === step?.anchor.path) ? step?.anchor.path : state.visibleFile;
    void showChangedFile(target && filteredChangedFiles().some((file) => file.path === target) ? target : filteredChangedFiles()[0].path, step?.anchor.startLine, step?.anchor.side);
  }
  renderComments();
  renderFindings();
  renderFlows();
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
  elements["start-tour"].disabled = state.busy || closed || (state.session.agentAdapters ?? []).length === 0;
  elements["chat-input"].disabled = closed;
  elements["chat-form"].querySelector("button").disabled = state.busy || closed;
  elements["comment-drawer"].classList.toggle("closed", closed);
  if (closed && elements["comment-dialog"].open) elements["comment-dialog"].close();
  elements["agent-mode"].textContent = state.session.agentSelection?.adapterId === "attached" ? "edits on request" : "read-only";
  renderAgentOptions();
  renderTour();
}

async function startTour() {
  if (!reviewIsOpen()) return;
  setBusy(true);
  const startedAt = Date.now();
  const timer = window.setInterval(() => {
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    elements["start-tour"].textContent = `Planning tour · ${seconds}s`;
  }, 1000);
  elements["start-tour"].textContent = "Planning tour · 0s";
  try {
    state.session = await api("/api/tour/start", {
      method: "POST",
      body: JSON.stringify({
        adapterId: elements["agent-select"].value,
        modelId: elements["model-select"].value,
        reasoningEffort: elements["reasoning-select"].value || undefined,
      }),
    });
    renderSession();
  } catch (error) {
    toast(error.message);
  } finally {
    window.clearInterval(timer);
    setBusy(false);
    elements["start-tour"].textContent = "Start tour";
    renderTour();
  }
}

async function navigate(direction) {
  if (!reviewIsOpen()) return;
  setBusy(true, direction === "next" ? "Preparing the next stop…" : "Returning to the previous stop…");
  try {
    state.session = await api("/api/tour/navigate", { method: "POST", body: JSON.stringify({ direction }) });
    renderTour();
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
    renderTour();
  }
}

function selectLine(row) {
  document.querySelectorAll(".diff-row.selected").forEach((item) => item.classList.remove("selected"));
  row.classList.add("selected");
  state.selectedLine = {
    path: row.dataset.path,
    side: row.dataset.side,
    line: Number(row.dataset.line),
    content: row.dataset.content,
  };
  elements["selection-pill"].textContent = `${state.selectedLine.path}:${state.selectedLine.line} · click again to comment`;
  elements["selection-pill"].classList.remove("hidden");
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
  setBusy(true, "The agent is responding…");
  try {
    state.session = await api("/api/agent/message", {
      method: "POST",
      body: JSON.stringify({ body, selectedContext }),
    });
    renderSession();
  } catch (error) {
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
elements["previous-step"].addEventListener("click", () => navigate("previous"));
elements["next-step"].addEventListener("click", () => navigate("next"));
elements["chat-form"].addEventListener("submit", askAgent);
elements["comment-form"].addEventListener("submit", saveComment);
elements["cancel-comment"].addEventListener("click", () => elements["comment-dialog"].close());
elements["close-button"].addEventListener("click", () => close(state.session.preferences?.closeOutcome ?? "accepted"));
elements["feedback-button"].addEventListener("click", () => close("feedback"));
elements["refresh-button"].addEventListener("click", refresh);
elements["theme-select"].value = window.reviewTourTheme.preference();
elements["theme-select"].addEventListener("change", () => window.reviewTourTheme.set(elements["theme-select"].value));
elements["sessions-button"].addEventListener("click", () => { elements["sessions-dialog"].showModal(); void loadSessions(); });
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
elements["changed-only"].addEventListener("change", () => {
  state.changedOnly = elements["changed-only"].checked;
  window.localStorage.setItem(preferenceKey("changed-only"), String(state.changedOnly));
  renderFileTree();
});
elements["diff-layout"].addEventListener("change", () => {
  state.diffLayout = elements["diff-layout"].value;
  window.localStorage.setItem(preferenceKey("diff-layout"), state.diffLayout);
  renderFilteredDiff();
});
elements["diff-tab"].addEventListener("click", () => { state.activeTab = "diff"; renderActiveTab(); });
elements["flows-tab"].addEventListener("click", () => { state.activeTab = "flows"; renderFlows(); renderActiveTab(); });
elements["activity-tab"].addEventListener("click", () => { state.activeTab = "activity"; renderActivities(); renderActiveTab(); });
elements["pull-request-tab"].addEventListener("click", () => { state.activeTab = "pull-request"; renderPullRequest(); renderActiveTab(); });
document.querySelector(".tabs").addEventListener("keydown", (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const tabs = availableTabs();
  const currentIndex = tabs.indexOf(state.activeTab);
  const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 :
    (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  state.activeTab = tabs[nextIndex];
  if (state.activeTab === "flows") renderFlows();
  if (state.activeTab === "activity") renderActivities();
  renderActiveTab();
  elements[`${state.activeTab}-tab`].focus();
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
  const pageButton = event.target.closest("[data-diff-page]");
  if (pageButton) {
    void showChangedFile(pageButton.dataset.pageFile, undefined, undefined, Number(pageButton.dataset.diffPage), Number(pageButton.dataset.context));
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
    document.querySelector(`.finding-item[data-finding-id="${CSS.escape(findingPin.dataset.findingId)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
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

elements["finding-list"].addEventListener("click", async (event) => {
  const action = event.target.closest("button")?.dataset.action;
  const item = event.target.closest("[data-finding-id]");
  if (!action || !item) return;
  const finding = state.session.outline?.findings.find((candidate) => candidate.id === item.dataset.findingId);
  if (!finding) return;
  if (action === "jump") return showChangedFile(finding.path, finding.line, finding.side);
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

try {
  state.session = await api("/api/session");
  renderSession();
} catch (error) {
  elements["connection-banner"].textContent = `Could not load this review: ${error.message}. Check that the server is running and reopen the URL printed in its terminal.`;
  elements["connection-banner"].classList.remove("hidden");
}

window.setInterval(async () => {
  if (state.busy || state.pollInFlight || (state.session && !reviewIsOpen())) return;
  state.pollInFlight = true;
  const generation = ++state.pollGeneration;
  try {
    const latest = await api("/api/session");
    if (generation !== state.pollGeneration) return;
    elements["connection-banner"].classList.add("hidden");
    if (!state.session || latest.revision > state.session.revision || (state.session.status === "open" && latest.status !== "open")) {
      state.session = latest;
      renderSession();
      toast("Review connected and up to date.");
    }
  } catch {
    if (!state.session || reviewIsOpen()) elements["connection-banner"].classList.remove("hidden");
  } finally {
    if (generation === state.pollGeneration) state.pollInFlight = false;
  }
}, 2_000);
