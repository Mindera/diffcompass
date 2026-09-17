const fragment = new URLSearchParams(window.location.hash.slice(1));
const fragmentToken = fragment.get("token");
const launchTourIntro = fragment.get("intro") === "1";
const DEFAULT_BRIEFING_ORDER = ["architecture", "sequence-diagrams", "call-flows", "needs-attention", "review-effort"];
let briefingDrag = null;
let briefingKeyboardDragKey = null;
if (fragmentToken) {
  window.sessionStorage.setItem("review-tour-token", fragmentToken);
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
}

const state = {
  session: null,
  apiToken: fragmentToken ?? window.sessionStorage.getItem("review-tour-token"),
  selectedLine: null,
  codeSelection: null,
  deletingCommentId: null,
  deletingCheckpointId: null,
  busy: false,
  briefingPreferencesSaving: false,
  pendingQuestions: new Map(),
  activeThreadId: null,
  questionsOpen: false,
  questionDrafts: new Map(),
  questionContextPaths: new Set(),
  questionPanePercent: 45,
  mobileAgentPane: "tour",
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
  reviewDiffLoadKey: null,
  reviewDiffLoadPromise: null,
  reviewDiffLoadGeneration: 0,
  highlightRequestId: 0,
  inlineEditHighlightRequestId: 0,
  flowRenderGeneration: 0,
  architectureDiagramViews: new Map(),
  architectureDiagramDrag: null,
  callFlowModes: new Map(),
  proposalPreview: false,
  proposalActivityId: null,
  searchQuery: "",
  searchMatches: null,
  searchRequestId: 0,
  searchTimer: null,
  statusFilter: "",
  reviewFilter: "unreviewed",
  testFilesOnly: false,
  preferenceRepository: null,
  treeMode: null,
  diffLayout: null,
  diffWrap: "scroll",
  diffPreferenceSave: Promise.resolve(),
  showDiffMarkers: false,
  renderedDiffFiles: [],
  filePanelWidth: 240,
  agentPanelWidth: 420,
  filePanelCollapsed: false,
  agentPanelCollapsed: false,
  splitOldWidth: 50,
  renderedPhaseId: null,
  tourMode: null,
  tourStarted: false,
  focusedStepId: null,
  tourIntroReturn: false,
  focusMode: false,
  shortcutHelpReturnTarget: null,
  tourIntroPending: launchTourIntro,
  tourIntroShown: false,
  focusedFindingId: null,
  findingReturn: null,
  pollInFlight: false,
  pollGeneration: 0,
  expectedAgentActivity: null,
  updateInProgress: false,
  toastTimer: null,
  closeCountdownTimer: null,
  closeCountdownSeconds: null,
  closeCountdownMessage: null,
  prDescriptionMode: "rendered",
  pullRequestWide: false,
  syntaxTheme: ["github", "vitesse", "review-tour", "catppuccin-frappe", "catppuccin-macchiato", "catppuccin-mocha"].includes(window.localStorage.getItem("review-tour-syntax-theme"))
    ? window.localStorage.getItem("review-tour-syntax-theme")
    : "github",
  commentQuoteHighlightRequestId: 0,
  screenshotUrls: new Map(),
  diffImageUrls: new Map(),
  diffImageRequestId: 0,
  markdownPreviewPaths: new Set(),
  markdownPreviewCache: new Map(),
  markdownPreviewRequestId: 0,
  repositoryFileView: "preview",
  repositoryFilePath: null,
  repositoryFileContent: "",
  filePanelOpen: false,
  symbolPeek: { history: [], current: null, requestId: 0, highlightRequestId: 0, compact: false },
  issueAssessmentExcerptRequestId: 0,
};

const elements = Object.fromEntries(
  [
    "workspace", "repository-label", "comparison-label", "file-count", "file-tree", "file-panel", "file-panel-toggle", "file-panel-close", "file-panel-collapse", "file-panel-backdrop", "file-resizer", "agent-panel", "agent-panel-collapse", "agent-resizer", "diff-panel", "diff", "empty-diff", "diff-view", "review-overview", "tour-overview", "tour-mode-toggle", "tour-intro-return", "current-step-return", "review-overview-title", "review-overview-summary", "pull-request-description", "pull-request-description-body", "call-flows-view", "call-flows", "call-flows-empty", "call-flows-tab", "regenerate-call-flows", "sequence-view", "architecture", "architecture-content", "flows", "flows-empty", "diff-tab", "sequence-tab", "findings-tab", "findings-tab-count", "findings-view", "findings-back", "all-findings-empty", "all-findings-list", "activity-tab", "activity-tab-count", "activity-view", "activity-empty", "activity-list", "screenshots-tab", "screenshots-tab-count", "screenshots-view", "screenshots", "pull-request-tab", "pull-request-view", "pull-request-content", "connection-banner", "diff-search", "status-filter", "review-filter", "test-files-filter", "tour-filter-note", "tree-mode", "comparison-view", "revision-summary", "revision-history", "checkpoint-history", "filter-summary",
    "settings-menu", "prefetch-steps", "show-tour-briefing", "briefing-options", "briefing-architecture", "briefing-sequence-diagrams", "briefing-call-flows", "briefing-needs-attention", "briefing-review-effort", "theme-select", "syntax-theme-select", "update-button", "update-label", "sessions-button", "sessions-dialog", "close-sessions", "show-archived-sessions", "sessions-list", "about-button", "about-dialog", "about-details", "close-about", "export-menu", "refresh-button", "checkpoint-button", "close-button", "close-review-button", "feedback-button", "approve-comments-button", "review-decision-dialog", "review-decision-form", "review-decision-eyebrow", "review-decision-title", "review-decision-description", "review-decision-note", "cancel-review-decision", "submit-review-decision", "checkpoint-dialog", "checkpoint-form", "checkpoint-label", "cancel-checkpoint", "closed-banner", "closed-banner-message", "cancel-auto-close", "tour-empty", "tour-empty-title", "tour-empty-description", "agent-config", "tour-active", "start-tour", "include-architecture", "include-call-flows", "include-flows", "include-findings",
    "workspace", "repository-label", "comparison-label", "file-count", "file-tree", "file-panel", "file-panel-toggle", "file-panel-close", "file-panel-collapse", "file-panel-backdrop", "file-resizer", "agent-panel", "agent-panel-collapse", "agent-resizer", "diff-panel", "diff", "empty-diff", "diff-view", "review-overview", "tour-overview", "tour-mode-toggle", "current-step-return", "review-overview-title", "review-overview-summary", "pull-request-description", "pull-request-description-body", "call-flows-view", "call-flows", "call-flows-empty", "call-flows-tab", "regenerate-call-flows", "sequence-view", "architecture", "architecture-content", "flows", "flows-empty", "diff-tab", "sequence-tab", "findings-tab", "findings-tab-count", "findings-view", "findings-back", "all-findings-empty", "all-findings-list", "activity-tab", "activity-tab-count", "activity-view", "activity-empty", "activity-list", "screenshots-tab", "screenshots-tab-count", "screenshots-view", "screenshots", "pull-request-tab", "pull-request-view", "pull-request-content", "connection-banner", "diff-search", "status-filter", "review-filter", "test-files-filter", "tree-mode", "comparison-view", "revision-summary", "revision-history", "checkpoint-history", "filter-summary",
    "settings-menu", "prefetch-steps", "theme-select", "syntax-theme-select", "update-button", "update-label", "sessions-button", "sessions-dialog", "close-sessions", "show-archived-sessions", "sessions-list", "about-button", "about-dialog", "about-details", "close-about", "export-menu", "refresh-button", "checkpoint-button", "close-button", "close-review-button", "feedback-button", "approve-comments-button", "review-decision-dialog", "review-decision-form", "review-decision-eyebrow", "review-decision-title", "review-decision-description", "review-decision-note", "cancel-review-decision", "submit-review-decision", "checkpoint-dialog", "checkpoint-form", "checkpoint-label", "cancel-checkpoint", "closed-banner", "closed-banner-message", "cancel-auto-close", "tour-empty", "tour-empty-title", "tour-empty-description", "agent-config", "tour-active", "start-tour", "include-architecture", "include-call-flows", "include-flows", "include-findings",
    "workspace", "repository-label", "comparison-label", "file-count", "file-tree", "file-panel", "file-panel-toggle", "file-panel-close", "file-panel-collapse", "file-panel-backdrop", "file-resizer", "agent-panel", "agent-panel-collapse", "agent-resizer", "diff-panel", "diff", "empty-diff", "diff-view", "symbol-peek-panel", "symbol-peek-title", "symbol-peek-close", "symbol-peek-trail", "symbol-peek-form", "symbol-peek-input", "symbol-peek-status", "symbol-peek-result", "symbol-peek-open", "review-overview", "tour-overview", "tour-mode-toggle", "current-step-return", "review-overview-title", "review-overview-summary", "pull-request-description", "pull-request-description-body", "call-flows-view", "call-flows", "call-flows-empty", "call-flows-tab", "regenerate-call-flows", "sequence-view", "architecture", "architecture-content", "flows", "flows-empty", "diff-tab", "sequence-tab", "findings-tab", "findings-tab-count", "findings-view", "findings-back", "all-findings-empty", "all-findings-list", "activity-tab", "activity-tab-count", "activity-view", "activity-empty", "activity-list", "screenshots-tab", "screenshots-tab-count", "screenshots-view", "screenshots", "pull-request-tab", "pull-request-view", "pull-request-content", "connection-banner", "diff-search", "status-filter", "review-filter", "test-files-filter", "tree-mode", "diff-layout", "filter-summary",
    "settings-menu", "prefetch-steps", "theme-select", "syntax-theme-select", "update-button", "update-label", "sessions-button", "sessions-dialog", "close-sessions", "show-archived-sessions", "sessions-list", "about-button", "about-dialog", "about-details", "close-about", "export-menu", "refresh-button", "close-button", "close-review-button", "feedback-button", "approve-comments-button", "review-decision-dialog", "review-decision-form", "review-decision-eyebrow", "review-decision-title", "review-decision-description", "review-decision-note", "cancel-review-decision", "submit-review-decision", "closed-banner", "closed-banner-message", "cancel-auto-close", "tour-empty", "tour-empty-title", "tour-empty-description", "agent-config", "tour-active", "start-tour", "include-architecture", "include-call-flows", "include-flows", "include-findings",
    "step-count", "progress-value", "phase-count", "phase-title", "phase-summary", "phase-files-details", "phase-files-count", "phase-files", "phase-finding-drawer", "phase-finding-count", "phase-finding-list", "step-anchor", "step-title", "step-objective", "step-discussion", "step-discussion-scope", "comment-stop", "step-comment-form", "step-comment-input", "cancel-step-comment", "step-comment-list", "tour-scroll", "planning-activity", "planning-activity-body", "planning-notes", "planning-note-list",
    "shortcut-help-dialog", "shortcut-help-title", "shortcuts-button", "close-shortcut-help", "focus-mode-toggle",
    "step-explanation", "agent-activity", "agent-activity-title", "agent-activity-body", "previous-step", "next-step", "chat-messages", "chat-form", "chat-input",
    "conversations-tab", "conversations-view", "conversation-list", "conversation-select", "question-scope", "questions-pane", "questions-toggle", "questions-body", "questions-scroll", "questions-resizer", "new-question", "show-tour-pane", "show-questions-pane", "agent-pane-switch",
    "selection-pill", "code-selection-toolbar", "question-file-context", "add-question-files", "question-files-dialog", "question-files-form", "question-files-search", "question-files-tree", "cancel-question-files", "tour-intro-dialog", "tour-intro-title", "tour-intro-summary", "tour-intro-attention", "tour-intro-attention-note", "tour-intro-attention-list", "tour-intro-estimate", "tour-intro-estimate-summary", "tour-intro-estimate-factors", "tour-intro-architecture-section", "tour-intro-architecture", "tour-intro-sequence-section", "tour-intro-sequence", "tour-intro-call-flows-section", "tour-intro-call-flows", "begin-tour", "architecture-viewer-dialog", "architecture-viewer-eyebrow", "architecture-viewer-title", "architecture-viewer-shell", "architecture-viewer-controls", "architecture-viewer-legend", "architecture-viewer-diagram", "architecture-viewer-help", "close-architecture-viewer", "issue-assessment-dialog", "issue-assessment-title", "issue-assessment-description", "close-issue-assessment", "html-export-dialog", "html-export-form", "html-export-description", "export-prepare-steps", "export-findings", "export-call-flows", "export-diagrams", "cancel-html-export", "finding-tooltip", "toast",
    "agent-name", "agent-mode", "agent-select", "model-select", "reasoning-select", "agent-note", "comment-drawer", "comment-list", "comment-count", "finding-drawer", "finding-list", "finding-count", "regenerate-flows", "flow-dialog", "flow-form", "flow-id", "flow-title", "flow-summary", "flow-provenance", "flow-blast-radius", "flow-affected-files", "flow-mermaid", "cancel-flow",
  ].map((id) => [id, document.getElementById(id)]),
);

document.documentElement.dataset.syntaxTheme = state.syntaxTheme;

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

const findingDispositionLabels = {
  accepted: "Risk accepted",
  "false-positive": "False positive",
  intentional: "Intentional",
  deferred: "Deferred",
  fixed: "Fixed (verified)",
  "obsolete-after-refresh": "Obsolete after refresh",
};

function findingDispositionLabel(disposition) {
  return findingDispositionLabels[disposition] || "Open";
}

function renderInlineChangeText(value, ranges = [], baseOffset = 0) {
  let html = "";
  let inChange = false;
  let offset = 0;
  for (const character of String(value)) {
    const sourceOffset = baseOffset + offset;
    const changed = ranges.some(([start, end]) => start <= sourceOffset && sourceOffset < end);
    if (changed !== inChange) html += changed ? '<span class="inline-change">' : "</span>";
    inChange = changed;
    html += escapeHtml(character);
    offset += character.length;
  }
  if (inChange) html += "</span>";
  return html;
}

function renderInlineMarkdown(value, ranges = [], baseOffset = 0) {
  const text = String(value);
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*/g;
  let html = "";
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index;
    html += renderInlineChangeText(text.slice(cursor, index), ranges, baseOffset + cursor);
    if (match[1] !== undefined) html += `<code>${renderInlineChangeText(match[1], ranges, baseOffset + index + 1)}</code>`;
    else html += `<strong>${renderInlineChangeText(match[2], ranges, baseOffset + index + 2)}</strong>`;
    cursor = index + match[0].length;
  }
  return html + renderInlineChangeText(text.slice(cursor), ranges, baseOffset + cursor);
}

function markdownTableCells(line) {
  const value = String(line).trim();
  if (!value.includes("|")) return null;
  const body = value.replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let cell = "";
  let code = false;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (character === "\\" && body[index + 1] === "|") {
      cell += "|";
      index += 1;
    } else if (character === "`") {
      code = !code;
      cell += character;
    } else if (character === "|" && !code) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells.length > 1 ? cells : null;
}

function markdownTableAlignments(line, columns) {
  const cells = markdownTableCells(line);
  if (!cells || cells.length !== columns || !cells.every((cell) => /^:?-{3,}:?$/.test(cell))) return null;
  return cells.map((cell) => cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : "left");
}

function markdownFenceStart(line) {
  const match = /^\s*(`{3,}|~{3,})\s*([A-Za-z0-9_+.-]*)\s*$/.exec(line);
  return match ? { marker: match[1][0], length: match[1].length, language: match[2], lines: [] } : null;
}

function markdownFenceEnd(line, fence) {
  const value = line.trim();
  return value.length >= fence.length && [...value].every((character) => character === fence.marker);
}

function markdownCodeBlock(fence) {
  const language = fence.language ? ` class="language-${escapeHtml(fence.language)}"` : "";
  return `<pre><code${language}>${escapeHtml(fence.lines.join("\n"))}</code></pre>`;
}

function markdownSourceBlock(html, startLine, endLine, source) {
  if (!source) return html;
  const changed = [...source.changedLines].some((line) => line >= startLine && line <= endLine);
  return `<section class="markdown-source-block${changed ? ` ${source.side === "old" ? "deletion" : "addition"}` : ""}" data-markdown-path="${escapeHtml(source.path)}" data-markdown-side="${source.side}" data-source-start="${startLine}" data-source-end="${endLine}">${html}</section>`;
}

function markdownInlineSource(value, line, source, sourceLine) {
  if (!source) return renderInlineMarkdown(value);
  const offset = sourceLine.indexOf(value);
  return renderInlineMarkdown(value, source.changedRanges.get(line) ?? [], Math.max(0, offset));
}

function renderMarkdown(value, headingOffset = 1, source = null) {
  const output = [];
  let listType = null;
  let listItems = [];
  let listStart = null;
  let fence = null;
  const closeList = () => {
    if (listType) output.push(markdownSourceBlock(`<${listType}>${listItems.map((item) => item.html).join("")}</${listType}>`, listStart, listItems.at(-1)?.line ?? listStart, source));
    listType = null;
    listItems = [];
    listStart = null;
  };
  const lines = String(value).split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (fence) {
      if (markdownFenceEnd(line, fence)) {
        output.push(markdownSourceBlock(markdownCodeBlock(fence), fence.startLine, index + 1, source));
        fence = null;
      } else {
        fence.lines.push(line);
      }
      continue;
    }
    const fenceStart = markdownFenceStart(line);
    if (fenceStart) {
      closeList();
      fence = { ...fenceStart, startLine: index + 1 };
      continue;
    }
    const headers = markdownTableCells(line);
    const alignments = headers && markdownTableAlignments(lines[index + 1] ?? "", headers.length);
    if (headers && alignments) {
      closeList();
      const startLine = index + 1;
      const tableRows = [];
      index += 2;
      while (index < lines.length) {
        const cells = markdownTableCells(lines[index]);
        if (!cells) break;
        tableRows.push({ line: index + 1, sourceLine: lines[index], cells: headers.map((_header, cellIndex) => cells[cellIndex] ?? "") });
        index += 1;
      }
      index -= 1;
      output.push(markdownSourceBlock(`<div class="markdown-table-wrap"><table><thead><tr>${headers.map((header, cellIndex) => `<th class="align-${alignments[cellIndex]}">${markdownInlineSource(header, startLine, source, line)}</th>`).join("")}</tr></thead><tbody>${tableRows.map((row) => `<tr>${row.cells.map((cell, cellIndex) => `<td class="align-${alignments[cellIndex]}">${markdownInlineSource(cell, row.line, source, row.sourceLine)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`, startLine, index + 1, source));
      continue;
    }
    const heading = /^\s*(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      closeList();
      const level = Math.min(6, heading[1].length + headingOffset);
      output.push(markdownSourceBlock(`<h${level}>${markdownInlineSource(heading[2], index + 1, source, line)}</h${level}>`, index + 1, index + 1, source));
      continue;
    }
    const item = /^\s*([-*]|\d+[.)])\s+(.+)$/.exec(line);
    if (item) {
      const nextListType = /^\d/.test(item[1]) ? "ol" : "ul";
      if (listType !== nextListType) {
        closeList();
        listType = nextListType;
        listStart = index + 1;
      }
      listItems.push({ line: index + 1, html: `<li>${markdownInlineSource(item[2], index + 1, source, line)}</li>` });
      continue;
    }
    closeList();
    if (line.trim()) output.push(markdownSourceBlock(`<p>${markdownInlineSource(line, index + 1, source, line)}</p>`, index + 1, index + 1, source));
  }
  closeList();
  if (fence) output.push(markdownSourceBlock(markdownCodeBlock(fence), fence.startLine, lines.length, source));
  return output.join("");
}

function pullRequestDescription(body) {
  const value = body || "No description provided.";
  const rendered = state.prDescriptionMode === "rendered";
  return `<div class="description-mode" role="group" aria-label="Pull request description display">
    <button class="text-button${rendered ? " active" : ""}" type="button" data-pr-description-mode="rendered" aria-pressed="${rendered}">Rendered</button>
    <button class="text-button${rendered ? "" : " active"}" type="button" data-pr-description-mode="source" aria-pressed="${!rendered}">Source</button>
  </div>${rendered ? `<div class="rendered-markdown">${renderMarkdown(value)}</div>` : `<pre class="markdown-source" aria-label="Raw Markdown source">${escapeHtml(value)}</pre>`}`;
}

function setPullRequestDescriptionMode(event) {
  const button = event.target.closest("[data-pr-description-mode]");
  if (!button) return;
  const mode = button.dataset.prDescriptionMode;
  if (!["rendered", "source"].includes(mode)) return;
  state.prDescriptionMode = mode;
  renderPullRequest();
  renderReviewOverview();
  event.currentTarget.querySelector(`[data-pr-description-mode="${mode}"]`)?.focus({ preventScroll: true });
}

function issueEvidencePathLinks(paths) {
  return paths.map((path) => `<button class="issue-evidence-file" type="button" data-issue-evidence-file="${escapeHtml(path)}" title="Open ${escapeHtml(path)} in the review">${escapeHtml(path)}</button>`).join(", ");
}

const ISSUE_ASSESSMENT_EXCERPT_LIMIT = 3;
const ISSUE_ASSESSMENT_EXCERPT_CONTEXT = 8;
const ISSUE_ASSESSMENT_EXCERPT_LINE_LIMIT = 15;
const ISSUE_ASSESSMENT_IGNORED_TERMS = new Set([
  "acceptance", "assessment", "criteria", "criterion", "evidence", "explicit", "implementation", "implemented", "issue", "issues", "linked", "missing", "model", "only", "path", "paths", "provider", "pull", "related", "repository", "request", "requests", "retained", "reviewed", "status", "statuses", "test", "tests", "unclear", "using", "with", "without",
]);

function issueAssessmentEvidenceTerms(evidence) {
  const terms = String(evidence ?? "").match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? [];
  return [...new Set(terms.map((term) => term.toLocaleLowerCase()).filter((term) => term.length >= 4 && !ISSUE_ASSESSMENT_IGNORED_TERMS.has(term)))].sort((left, right) => right.length - left.length).slice(0, 24);
}

function issueAssessmentLineScore(line, terms) {
  const source = String(line ?? "").toLocaleLowerCase();
  return terms.reduce((score, term) => score + (source.includes(term) ? term.length : 0), 0);
}

function issueAssessmentChangedAnchor(path, terms) {
  const file = state.session?.comparison?.files?.find((candidate) => candidate.path === path);
  const rows = file?.hunks?.flatMap((hunk) => hunk.rows ?? []) ?? [];
  let best = null;
  for (const row of rows) {
    if (!row.newLine || row.kind === "deletion") continue;
    const score = issueAssessmentLineScore(row.content, terms);
    if (score > (best?.score ?? 0)) best = { line: row.newLine, score };
  }
  if (best?.score) return best.line;
  return rows.find((row) => row.kind === "addition" && row.newLine)?.newLine ?? null;
}

function issueAssessmentExcerpt(path, content, terms) {
  const lines = String(content ?? "").split("\n");
  const changedAnchor = issueAssessmentChangedAnchor(path, terms);
  let matchedAnchor = null;
  let bestScore = 0;
  lines.forEach((line, index) => {
    const score = issueAssessmentLineScore(line, terms);
    if (score > bestScore) {
      bestScore = score;
      matchedAnchor = index + 1;
    }
  });
  const anchor = changedAnchor ?? matchedAnchor ?? 1;
  const length = Math.min(ISSUE_ASSESSMENT_EXCERPT_LINE_LIMIT, Math.max(1, lines.length));
  const startLine = Math.max(1, Math.min(Math.max(1, lines.length - length + 1), anchor - ISSUE_ASSESSMENT_EXCERPT_CONTEXT));
  return { path, startLine, lines: lines.slice(startLine - 1, startLine - 1 + length) };
}

function issueAssessmentPathExplanation(item, path) {
  const explanation = item.pathExplanations?.find((detail) => detail?.path === path)?.explanation;
  return typeof explanation === "string" && explanation.trim() ? explanation.trim() : "No file-specific contribution was retained for this assessment.";
}

function issueAssessmentExcerptMarkup(excerpt, id, explanation) {
  const endLine = excerpt.startLine + excerpt.lines.length - 1;
  return `<article class="issue-assessment-code-excerpt"><header><div class="issue-assessment-excerpt-heading"><strong>${escapeHtml(excerpt.path)}:${excerpt.startLine}${endLine > excerpt.startLine ? `–${endLine}` : ""}</strong><span><b>How it contributes:</b> ${escapeHtml(explanation)}</span></div><button class="text-button" type="button" data-issue-evidence-file="${escapeHtml(excerpt.path)}">Open file</button></header><pre><code data-issue-assessment-excerpt-highlight="${escapeHtml(id)}">${escapeHtml(excerpt.lines.join("\n"))}</code></pre></article>`;
}

function issueAssessmentExcerptSection(item) {
  const paths = [...new Set(item.evidencePaths)].slice(0, ISSUE_ASSESSMENT_EXCERPT_LIMIT);
  if (paths.length === 0) return "";
  const omitted = item.evidencePaths.length - paths.length;
  return `<section><span class="issue-evidence-label">Cited code excerpts</span><p class="issue-assessment-excerpt-note">Short, bounded previews from the cited paths. Open a file to inspect its full context.</p><div class="issue-assessment-code-excerpts" data-issue-assessment-excerpts><p class="muted">Loading cited source…</p></div>${omitted > 0 ? `<p class="muted">${omitted} additional cited ${omitted === 1 ? "file is" : "files are"} available from the assessment.</p>` : ""}</section>`;
}

async function hydrateIssueAssessmentCodeExcerpts(item, requestId) {
  const target = elements["issue-assessment-description"].querySelector("[data-issue-assessment-excerpts]");
  const paths = [...new Set(item.evidencePaths)].slice(0, ISSUE_ASSESSMENT_EXCERPT_LIMIT);
  if (!target || paths.length === 0) return;
  const sources = await Promise.all(paths.map(async (path) => {
    try {
      const file = await api(`/api/files?path=${encodeURIComponent(path)}`);
      return { path, content: file.content };
    } catch {
      return { path, content: null };
    }
  }));
  if (requestId !== state.issueAssessmentExcerptRequestId || !target.isConnected || !elements["issue-assessment-dialog"].open) return;
  const terms = issueAssessmentEvidenceTerms(item.evidence);
  const excerpts = sources.filter((source) => typeof source.content === "string").map((source) => issueAssessmentExcerpt(source.path, source.content, terms));
  const unavailable = sources.length - excerpts.length;
  target.innerHTML = `${excerpts.map((excerpt, index) => issueAssessmentExcerptMarkup(excerpt, `issue-assessment-excerpt-${index}`, issueAssessmentPathExplanation(item, excerpt.path))).join("")}${unavailable ? `<p class="muted">${unavailable} cited ${unavailable === 1 ? "file could" : "files could"} not be displayed.</p>` : ""}` || '<p class="muted">No cited source could be displayed.</p>';
  const groups = excerpts.map((excerpt, index) => ({ id: `issue-assessment-excerpt-${index}`, path: excerpt.path, lines: excerpt.lines }));
  if (groups.length === 0) return;
  try {
    const highlighted = await api("/api/highlight", {
      method: "POST",
      body: JSON.stringify({ groups, theme: state.syntaxTheme }),
    });
    if (requestId !== state.issueAssessmentExcerptRequestId || !target.isConnected || !elements["issue-assessment-dialog"].open) return;
    for (const group of highlighted.groups ?? []) {
      const code = target.querySelector(`[data-issue-assessment-excerpt-highlight="${CSS.escape(group.id)}"]`);
      if (code) code.innerHTML = group.lines.map((line) => line.map((token) => syntaxTokenHtml(token)).join("")).join("\n");
    }
  } catch {
    // Raw escaped source remains readable if highlighting is unavailable.
  }
}

function issueAssessmentItems(items) {
  return items.map((item) => `<details class="issue-criterion ${escapeHtml(item.status)}"><summary><span class="issue-criterion-title">${escapeHtml(item.criterion)}</span><span class="issue-status">${escapeHtml(item.status)}</span></summary><div class="issue-assessment-evidence"><p><span class="issue-evidence-label">Assessment</span>${renderInlineMarkdown(item.evidence)}</p>${item.evidencePaths.length ? `<small><span class="issue-evidence-label">Repository evidence</span>${issueEvidencePathLinks(item.evidencePaths)}</small>` : ""}<button class="text-button issue-assessment-explain" type="button" data-issue-assessment-explain="${escapeHtml(item.criterionId)}">Show me how</button></div></details>`).join("");
}

let issueAssessmentReturnTarget = null;

function openIssueAssessmentExplanation(item, returnTarget) {
  issueAssessmentReturnTarget = returnTarget instanceof HTMLElement ? returnTarget : null;
  const requestId = ++state.issueAssessmentExcerptRequestId;
  elements["issue-assessment-title"].textContent = "How this assessment is grounded";
  elements["issue-assessment-description"].innerHTML = `<p class="issue-assessment-model-note">This is a model explanation based on cited repository paths. It is not a verified test result.</p><section><span class="issue-evidence-label">Acceptance criterion</span><p>${escapeHtml(item.criterion)}</p></section><section><span class="issue-evidence-label">How the cited code is relevant</span><div class="issue-assessment-explanation">${renderInlineMarkdown(item.evidence)}</div></section>${issueAssessmentExcerptSection(item)}${item.evidencePaths.length ? `<section><span class="issue-evidence-label">Inspect the cited files</span><p class="issue-assessment-file-links">${issueEvidencePathLinks(item.evidencePaths)}</p></section>` : ""}`;
  elements["issue-assessment-dialog"].showModal();
  elements["close-issue-assessment"].focus();
  void hydrateIssueAssessmentCodeExcerpts(item, requestId);
}

function dismissIssueAssessmentOnBackdrop(event) {
  const dialog = elements["issue-assessment-dialog"];
  if (event.target !== dialog) return;
  const bounds = dialog.getBoundingClientRect();
  if (event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom) return;
  dialog.close();
}

async function showIssueEvidenceFile(path) {
  const changed = state.session.comparison.files.some((file) => file.path === path);
  const opened = changed ? await showAnalysisFile(path) : await showRepositoryFile(path);
  if (opened) toast(changed ? `Opened ${path} in the diff` : `Opened ${path}; it is unchanged in this pull request.`);
}

function handleIssueAssessmentClick(event) {
  const explain = event.target.closest("[data-issue-assessment-explain]");
  if (explain) {
    const item = state.session.outline?.issueAssessment?.items.find((candidate) => candidate.criterionId === explain.dataset.issueAssessmentExplain);
    if (item) openIssueAssessmentExplanation(item, explain);
    return;
  }
  const file = event.target.closest("[data-issue-evidence-file]");
  if (file) {
    if (elements["issue-assessment-dialog"].open) {
      issueAssessmentReturnTarget = null;
      elements["issue-assessment-dialog"].close();
    }
    void showIssueEvidenceFile(file.dataset.issueEvidenceFile);
  }
}

function linkedIssueSummary(issue) {
  if (!issue) return `<section class="linked-issue-summary"><h3>Linked issue</h3><p class="muted">No linked issue was reported for this pull request. No issue or related provider resources were fetched.</p><p class="provider-boundary">Provider scope: linked closing issue only · related issues and earlier pull requests: not requested. Only issue metadata and explicit criteria are retained.</p></section>`;
  const heading = `<p class="linked-issue-heading"><a href="${escapeHtml(issue.url)}" rel="noreferrer">#${issue.number} ${escapeHtml(issue.title)}</a> <span class="mode">${escapeHtml(issue.access)}</span></p>`;
  const boundary = '<p class="provider-boundary">Provider scope: one same-repository closing issue · related issues and earlier pull requests: not requested. Only issue metadata and explicit criteria are retained.</p>';
  if (issue.access !== "available") return `<section class="linked-issue-summary"><h3>Linked issue</h3>${heading}${boundary}<p class="muted">The linked issue is ${escapeHtml(issue.access)}. Its content was not retained.</p></section>`;
  if (issue.criteriaStatus === "malformed") return `<section class="linked-issue-summary"><h3>Linked issue</h3>${heading}${boundary}<p class="muted">The linked issue body was malformed or exceeded the safe limit. No criteria were retained.</p></section>`;
  if (issue.criteriaStatus !== "found") return `<section class="linked-issue-summary"><h3>Linked issue</h3>${heading}${boundary}<p class="muted">No explicit acceptance criteria were found in the issue body.</p></section>`;
  return `<section class="linked-issue-summary"><h3>Linked issue</h3>${heading}${boundary}<p class="linked-issue-criteria-label">${issue.acceptanceCriteria.length} explicit acceptance ${issue.acceptanceCriteria.length === 1 ? "criterion" : "criteria"}</p><ol class="linked-issue-criteria">${issue.acceptanceCriteria.map((criterion) => `<li>${escapeHtml(criterion.text)}</li>`).join("")}</ol></section>`;
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

async function apiBlob(path) {
  if (!state.apiToken) throw new Error("This review URL is missing its session token. Reopen the URL printed by the server.");
  const response = await fetch(path, { headers: { "X-Review-Tour-Token": state.apiToken } });
  if (!response.ok) {
    const value = await response.json().catch(() => ({}));
    throw new Error(value.error || `Request failed: ${response.status}`);
  }
  return response.blob();
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

function renderClosedBanner() {
  const closed = !reviewIsOpen();
  elements["closed-banner"].classList.toggle("hidden", !closed);
  if (!closed) {
    elements["cancel-auto-close"].classList.add("hidden");
    return;
  }
  elements["cancel-auto-close"].classList.toggle("hidden", state.closeCountdownSeconds === null || state.closeCountdownSeconds <= 0);
  if (state.closeCountdownSeconds !== null) {
    const seconds = state.closeCountdownSeconds;
    const countdown = seconds > 0
      ? `You can close this window, or it will close in ${seconds} ${seconds === 1 ? "second" : "seconds"}.`
      : "Closing this window…";
    elements["closed-banner-message"].textContent = `${state.closeCountdownMessage} ${countdown}`;
    return;
  }
  if (state.closeCountdownMessage !== null) {
    elements["closed-banner-message"].textContent = `${state.closeCountdownMessage} You can close this window.`;
    return;
  }
  elements["closed-banner-message"].textContent = state.session.status === "cancelled"
    ? "This review was closed without a decision. It is now read-only."
    : `This review is closed as ${state.session.status}. It is now read-only.`;
}

function cancelCloseCountdown() {
  if (state.closeCountdownTimer !== null) window.clearInterval(state.closeCountdownTimer);
  state.closeCountdownTimer = null;
  state.closeCountdownSeconds = null;
  renderClosedBanner();
}

function beginCloseCountdown(message) {
  if (state.closeCountdownTimer) window.clearInterval(state.closeCountdownTimer);
  state.closeCountdownMessage = message;
  state.closeCountdownSeconds = 5;
  renderClosedBanner();
  state.closeCountdownTimer = window.setInterval(() => {
    if (state.closeCountdownSeconds === null) return;
    state.closeCountdownSeconds -= 1;
    renderClosedBanner();
    if (state.closeCountdownSeconds > 0) return;
    window.clearInterval(state.closeCountdownTimer);
    state.closeCountdownTimer = null;
    window.close();
    window.setTimeout(() => {
      if (window.closed) return;
      state.closeCountdownSeconds = null;
      renderClosedBanner();
    }, 250);
  }, 1_000);
}

function beginCloseCountdownForTransition(previousStatus, result) {
  if (previousStatus !== "open" || state.session.status === "open" || state.closeCountdownMessage !== null) return;
  const submitted = state.session.status === "feedback" && result
    ? (result.comments?.length ?? 0) + (result.note?.trim() ? 1 : 0)
    : undefined;
  beginCloseCountdown(submitted === undefined
    ? state.session.status === "cancelled" ? "This review was closed without a decision." : `This review is closed as ${state.session.status}.`
    : `${submitted} feedback item(s) submitted.`);
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
  elements["checkpoint-button"].disabled = busy;
  elements["comparison-view"].disabled = busy;
  elements["close-button"].disabled = busy;
  elements["close-review-button"].disabled = busy;
  elements["approve-comments-button"].disabled = busy;
  elements["feedback-button"].disabled = busy;
  elements["export-menu"].querySelectorAll("button").forEach((button) => { button.disabled = busy; });
  elements["regenerate-flows"].disabled = busy || !reviewIsOpen() || !state.session?.outline;
  elements["chat-form"].querySelector("button").disabled = busy || !reviewIsOpen();
  syncBriefingPreferenceControls();
  if (busy && !elements["tour-active"].classList.contains("hidden")) {
    elements["step-explanation"].innerHTML = `<span class="loading">${escapeHtml(label)}</span>`;
  }
  renderAgentActivity();
}

function syncBriefingPreferenceControls() {
  elements["show-tour-briefing"].disabled = state.briefingPreferencesSaving;
  const disabled = state.briefingPreferencesSaving || !elements["show-tour-briefing"].checked;
  elements["briefing-architecture"].disabled = disabled;
  elements["briefing-sequence-diagrams"].disabled = disabled;
  elements["briefing-call-flows"].disabled = disabled;
  elements["briefing-needs-attention"].disabled = disabled;
  elements["briefing-review-effort"].disabled = disabled;
  elements["briefing-options"].querySelectorAll("[data-briefing-option]").forEach((option) => {
    option.draggable = !disabled;
    option.tabIndex = disabled ? -1 : 0;
    option.setAttribute("aria-disabled", String(disabled));
  });
}

function renderAgentActivity() {
  const activity = state.session?.agentActivity;
  const visible = Boolean(activity && (state.busy || activity.status === "waiting" || activity.status === "running" || activity.status === "failed"));
  const isQuestion = activity?.kind === "review.question";
  const activityAnchor = isQuestion ? elements["chat-messages"] : elements["step-explanation"];
  activityAnchor.insertAdjacentElement("afterend", elements["agent-activity"]);
  const pendingForActiveThread = [...state.pendingQuestions.values()].some((pending) => pending.threadId === state.activeThreadId);
  const otherThread = isQuestion && state.pendingQuestions.size > 0 && !pendingForActiveThread;
  elements["agent-activity"].classList.toggle("hidden", !visible || Boolean(otherThread));
  if (!visible) return;
  const renderedActivityId = elements["agent-activity"].dataset.activityId;
  const promptWasOpen = renderedActivityId === activity.id && Boolean(elements["agent-activity-body"].querySelector(".agent-prompt")?.open);
  elements["agent-activity"].dataset.activityId = activity.id;
  const status = activity.localQueued ? "Question queued" : activity.status === "waiting" ? "Waiting for agent" : activity.status === "running" ? "Agent working" : activity.status === "failed" ? "Agent failed" : "Agent finished";
  const prefetchSteps = state.session.preferences?.prefetchSteps ?? 5;
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

async function openAboutDialog() {
  elements["settings-menu"].open = false;
  elements["about-details"].innerHTML = "<div><dt>Status</dt><dd>Loading…</dd></div>";
  elements["about-dialog"].showModal();
  try {
    const about = await api("/api/about");
    const rows = [
      ["Version", about.version],
      ["Runtime", about.runtime],
      ["Repository", about.repository],
      ["Location", about.repositoryPath],
      ["Comparison", about.comparison],
      ["Review", about.reviewStatus],
      ["Agent", about.agent],
      ["Mode", about.mode],
    ];
    elements["about-details"].innerHTML = rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");
  } catch (error) {
    elements["about-details"].innerHTML = `<div><dt>Error</dt><dd>${escapeHtml(error.message)}</dd></div>`;
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

function shortcutTargetIsEditable(target) {
  return Boolean(target?.closest?.("input, textarea, select, [contenteditable='true'], [role='textbox']"));
}

function submitTextareaOnModifiedEnter(event) {
  if (event.defaultPrevented || event.repeat || event.isComposing || event.key !== "Enter" || !(event.metaKey || event.ctrlKey) || event.altKey) return;
  const textarea = event.target.closest?.("textarea");
  if (!textarea || textarea.disabled || textarea.readOnly) return;
  const form = textarea.closest("form");
  if (form) {
    const submit = form.querySelector('[type="submit"]');
    if (!submit || submit.disabled) return;
    event.preventDefault();
    form.requestSubmit(submit);
    return;
  }
  const finding = textarea.closest(".finding-item");
  const saveFinding = finding?.querySelector('[data-action="save-disposition"]');
  if (!saveFinding || saveFinding.disabled) return;
  event.preventDefault();
  saveFinding.click();
}

function modalDialogIsOpen() {
  return Boolean(document.querySelector("dialog[open]"));
}

function renderFocusMode() {
  document.body.classList.toggle("focus-mode", state.focusMode);
  const button = elements["focus-mode-toggle"];
  button.setAttribute("aria-pressed", String(state.focusMode));
  button.setAttribute("aria-label", state.focusMode ? "Exit focus mode" : "Enter focus mode");
  button.title = state.focusMode ? "Exit focus mode (Z)" : "Enter focus mode (Z)";
  button.textContent = state.focusMode ? "Exit focus" : "Focus mode";
}

async function toggleFocusMode() {
  state.focusMode = !state.focusMode;
  renderFocusMode();
  if (state.focusMode && state.tourMode) await focusCurrentStep();
  else elements["focus-mode-toggle"].focus({ preventScroll: true });
}

function openShortcutHelp() {
  if (elements["shortcut-help-dialog"].open) return;
  state.shortcutHelpReturnTarget = document.activeElement instanceof HTMLElement ? document.activeElement : elements["shortcuts-button"];
  elements["shortcut-help-dialog"].showModal();
  elements["close-shortcut-help"].focus();
}

function restoreShortcutHelpFocus() {
  const target = state.shortcutHelpReturnTarget;
  state.shortcutHelpReturnTarget = null;
  (target?.isConnected ? target : elements["shortcuts-button"])?.focus({ preventScroll: true });
}

async function handleNextStep() {
  const steps = state.session.outline?.phases.flatMap((phase) => phase.steps) ?? [];
  if (!steps.length || !state.tourMode || !reviewIsOpen()) return;
  if (state.session.currentStepIndex === steps.length - 1) {
    state.questionsOpen = true;
    await toggleTourMode();
  } else await navigate("next");
}

function narrowFilePanelLayout() {
  return window.matchMedia("(max-width: 900px)").matches;
}

function setFilePanelOpen(open, { restoreFocus = false } = {}) {
  state.filePanelOpen = narrowFilePanelLayout() && Boolean(open);
  document.body.classList.toggle("file-panel-open", state.filePanelOpen);
  elements["file-panel-toggle"].setAttribute("aria-expanded", String(state.filePanelOpen));
  elements["file-panel-backdrop"].classList.toggle("hidden", !state.filePanelOpen);
  elements["file-panel"].setAttribute("aria-hidden", String(narrowFilePanelLayout() && !state.filePanelOpen));
  elements["file-panel"].inert = narrowFilePanelLayout() && !state.filePanelOpen;
  if (state.filePanelOpen) elements["file-panel-close"].focus();
  else if (restoreFocus) elements["file-panel-toggle"].focus();
}

function preferenceKey(name) {
  const repository = state.session.pullRequest?.sourceRepositoryRoot ?? state.session.comparison.repositoryRoot;
  return `review-tour:${repository}:${name}`;
}

function diffLayoutPreferenceKey() {
  return preferenceKey(narrowFilePanelLayout() ? "mobile-diff-layout" : "diff-layout");
}

function preferredDiffLayout() {
  const sessionPreference = typeof state !== "undefined" ? state.session?.diffPreferences?.[narrowFilePanelLayout() ? "mobile" : "desktop"]?.layout : undefined;
  if (["unified", "split"].includes(sessionPreference)) return sessionPreference;
  const saved = window.localStorage.getItem(diffLayoutPreferenceKey());
  if (["unified", "split"].includes(saved)) return saved;
  return narrowFilePanelLayout() ? "unified" : state.session.preferences?.diffLayout ?? "split";
}

function diffWrapPreferenceKey() {
  return preferenceKey(narrowFilePanelLayout() ? "mobile-diff-wrap" : "diff-wrap");
}

function preferredDiffWrap() {
  const sessionPreference = typeof state !== "undefined" ? state.session?.diffPreferences?.[narrowFilePanelLayout() ? "mobile" : "desktop"]?.wrap : undefined;
  if (["scroll", "wrap"].includes(sessionPreference)) return sessionPreference;
  const saved = window.localStorage.getItem(diffWrapPreferenceKey());
  return ["scroll", "wrap"].includes(saved) ? saved : "scroll";
}

const FILE_PANEL_MIN = 220;
const FILE_PANEL_MAX = 480;
const AGENT_PANEL_MIN = 360;
const AGENT_PANEL_MAX = 720;
const COLLAPSED_PANE_WIDTH = 40;
const SPLIT_PANE_MIN = 20;
const SPLIT_PANE_MAX = 80;

function diffPanelMinimum() {
  return window.innerWidth <= 1050 ? 360 : 420;
}

function setFilePanelWidth(value, persist = false) {
  const agentWidth = state.agentPanelCollapsed ? COLLAPSED_PANE_WIDTH : state.agentPanelWidth;
  const viewportLimit = Math.max(FILE_PANEL_MIN, Math.min(FILE_PANEL_MAX, window.innerWidth - agentWidth - diffPanelMinimum()));
  const width = Math.round(Math.max(FILE_PANEL_MIN, Math.min(viewportLimit, value)));
  state.filePanelWidth = width;
  elements.workspace.style.setProperty("--file-panel-width", `${width}px`);
  elements["file-resizer"].setAttribute("aria-valuenow", String(width));
  if (persist) window.localStorage.setItem(preferenceKey("file-panel-width"), String(width));
  scheduleCurrentStepReturnUpdate();
}

function setAgentPanelWidth(value, persist = false) {
  const fileWidth = state.filePanelCollapsed ? COLLAPSED_PANE_WIDTH : state.filePanelWidth;
  const viewportLimit = Math.max(AGENT_PANEL_MIN, Math.min(AGENT_PANEL_MAX, window.innerWidth - fileWidth - diffPanelMinimum()));
  const width = Math.round(Math.max(AGENT_PANEL_MIN, Math.min(viewportLimit, value)));
  state.agentPanelWidth = width;
  elements.workspace.style.setProperty("--agent-panel-width", `${width}px`);
  elements["agent-resizer"].setAttribute("aria-valuenow", String(width));
  if (persist) window.localStorage.setItem(preferenceKey("agent-panel-width"), String(width));
  scheduleCurrentStepReturnUpdate();
}

function setPaneCollapsed(side, collapsed, persist = false) {
  const isFilePane = side === "file";
  const stateKey = isFilePane ? "filePanelCollapsed" : "agentPanelCollapsed";
  const className = isFilePane ? "file-pane-collapsed" : "agent-pane-collapsed";
  const button = elements[isFilePane ? "file-panel-collapse" : "agent-panel-collapse"];
  const label = isFilePane ? "changed files" : "agent pane";
  state[stateKey] = Boolean(collapsed);
  elements.workspace.classList.toggle(className, state[stateKey]);
  button.setAttribute("aria-expanded", String(!state[stateKey]));
  button.setAttribute("aria-label", `${state[stateKey] ? "Expand" : "Collapse"} ${label}`);
  button.title = `${state[stateKey] ? "Expand" : "Collapse"} ${label}`;
  button.textContent = isFilePane
    ? (state[stateKey] ? "›" : "‹")
    : (state[stateKey] ? "‹" : "›");
  if (persist) window.localStorage.setItem(preferenceKey(`${side}-panel-collapsed`), String(state[stateKey]));
  setAgentPanelWidth(state.agentPanelWidth);
  setFilePanelWidth(state.filePanelWidth);
  scheduleCurrentStepReturnUpdate();
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

function setPullRequestContentWidth(wide, persist = false) {
  state.pullRequestWide = Boolean(wide);
  elements["pull-request-content"].classList.toggle("wide", state.pullRequestWide);
  if (persist) window.localStorage.setItem(preferenceKey("pull-request-wide"), String(state.pullRequestWide));
}

function initializeUiPreferences() {
  const repository = state.session.pullRequest?.sourceRepositoryRoot ?? state.session.comparison.repositoryRoot;
  if (state.preferenceRepository === repository) return;
  state.preferenceRepository = repository;
  const savedTreeMode = window.localStorage.getItem(preferenceKey("tree-mode"));
  const savedFilePanelWidth = Number(window.localStorage.getItem(preferenceKey("file-panel-width")));
  const savedAgentPanelWidth = Number(window.localStorage.getItem(preferenceKey("agent-panel-width")));
  const savedFilePanelCollapsed = window.localStorage.getItem(preferenceKey("file-panel-collapsed")) === "true";
  const savedAgentPanelCollapsed = window.localStorage.getItem(preferenceKey("agent-panel-collapsed")) === "true";
  const savedSplitOldWidth = Number(window.localStorage.getItem(preferenceKey("split-old-width")));
  const savedQuestionPanePercent = Number(window.localStorage.getItem(preferenceKey("question-pane-percent")));
  const savedPullRequestWide = window.localStorage.getItem(preferenceKey("pull-request-wide")) === "true";
  const legacyChangedOnly = window.localStorage.getItem(preferenceKey("changed-only"));
  state.diffLayout = preferredDiffLayout();
  state.diffWrap = preferredDiffWrap();
  state.showDiffMarkers = window.localStorage.getItem(preferenceKey("show-diff-markers")) === "true";
  state.treeMode = ["changes", "repository"].includes(savedTreeMode)
    ? savedTreeMode
    : legacyChangedOnly !== null
      ? (legacyChangedOnly === "true" ? "changes" : "repository")
      : state.session.preferences?.changedFilesOnly ? "changes" : "repository";
  setFilePanelWidth(Number.isFinite(savedFilePanelWidth) && savedFilePanelWidth > 0 ? savedFilePanelWidth : 240);
  setAgentPanelWidth(Number.isFinite(savedAgentPanelWidth) && savedAgentPanelWidth > 0 ? savedAgentPanelWidth : 420);
  setPaneCollapsed("file", savedFilePanelCollapsed);
  setPaneCollapsed("agent", savedAgentPanelCollapsed);
  setSplitOldWidth(Number.isFinite(savedSplitOldWidth) && savedSplitOldWidth > 0 ? savedSplitOldWidth : 50);
  setPullRequestContentWidth(savedPullRequestWide);
  resizeQuestions(Number.isFinite(savedQuestionPanePercent) && savedQuestionPanePercent > 0 ? savedQuestionPanePercent : 45);
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
  return renderTreeNode(treeFromFiles(files.map((file) => file.path), files), 0, true);
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

function renderTreeNode(node, depth = 0, expandAll = false, parentPath = "") {
  return Object.entries(node)
    .sort(([a, av], [b, bv]) => Number(Boolean(av.__file)) - Number(Boolean(bv.__file)) || a.localeCompare(b))
    .map(([name, value]) => {
      if (value.__file) {
        const file = value.__file;
        if (!file.changed) return `<button class="file-button unchanged" data-source="${escapeHtml(file.path)}" title="${escapeHtml(file.path)}"><span class="file-name">${escapeHtml(name)}</span></button>`;
        return renderChangedFileEntry(file.changed, name);
      }
      // Keep real branches, but don't make reviewers open each directory in
      // a single-child chain just to reach its files.
      let label = name;
      let directory = value;
      while (Object.keys(directory).length === 1) {
        const [childName, child] = Object.entries(directory)[0];
        if (child.__file) break;
        label += `/${childName}`;
        directory = child;
      }
      const path = parentPath ? `${parentPath}/${label}` : label;
      return `<details class="tree-directory" ${expandAll || depth === 0 ? "open" : ""}><summary title="${escapeHtml(path)}"><span class="tree-directory-path">${escapeHtml(label)}</span></summary><div class="tree-children">${renderTreeNode(directory, depth + 1, expandAll, path)}</div></details>`;
    })
    .join("");
}

function filteredChangedFiles() {
  const reviewed = new Set(state.session.reviewedFiles ?? []);
  const searchMatches = state.searchQuery && state.searchMatches ? new Set(state.searchMatches) : null;
  const phasePaths = state.tourMode ? new Set(currentPhase()?.fileChanges.map((change) => change.path) ?? []) : null;
  const tourPaths = state.reviewFilter === "tour"
    ? new Set(state.session.outline?.phases.flatMap((phase) => phase.fileChanges.map((change) => change.path)) ?? [])
    : null;
  if (phasePaths) return state.session.comparison.files.filter((file) => phasePaths.has(file.path));
  return state.session.comparison.files.filter((file) =>
    (!state.statusFilter || file.status === state.statusFilter) &&
    (!state.reviewFilter || (tourPaths ? tourPaths.has(file.path) : (state.reviewFilter === "reviewed") === reviewed.has(file.path))) &&
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
    .filter((finding) => finding.path === file.path && finding.side === side && finding.line === line && finding.status === "open")
    .map((finding) => {
      const summary = `${finding.outdated ? "(needs reassessment) " : ""}${findingSummary(finding)}`;
      const reassessmentClass = finding.outdated ? " needs-reassessment" : "";
      return `<button class="finding-pin ${finding.priority.toLowerCase()}${reassessmentClass}" data-finding-id="${escapeHtml(finding.id)}" data-tooltip="${escapeHtml(summary)}" aria-label="${escapeHtml(`${finding.priority} finding: ${summary}`)}" aria-describedby="finding-tooltip">${finding.priority}</button>`;
    }).join("");
}

function whitespaceChangedRows(rows) {
  const marked = new Set();
  for (const [oldRow, newRow] of splitRows(rows)) {
    if (oldRow?.kind !== "deletion" || newRow?.kind !== "addition") continue;
    const oldText = oldRow.content;
    const newText = newRow.content;
    // Do not strip internal whitespace: it may be part of a string or token.
    if (oldText !== newText && oldText.replace(/^[ \t]+|[ \t]+$/g, "") === newText.replace(/^[ \t]+|[ \t]+$/g, "")) {
      marked.add(oldRow);
      marked.add(newRow);
    }
  }
  return marked;
}

function inlineChangedRanges(before, after, budget = { remaining: 200_000 }) {
  if (before === after) return [[], []];
  const tokenize = (text) => [...text.matchAll(/[\p{L}\p{N}_]+|[ \t]+|[^\s]/gu)].map(match => ({text: match[0], start: match.index, end: match.index + match[0].length}));
  const oldTokens = tokenize(before), newTokens = tokenize(after);
  let start = 0, oldEnd = oldTokens.length, newEnd = newTokens.length;
  while (start < oldEnd && start < newEnd && oldTokens[start].text === newTokens[start].text) start++;
  while (oldEnd > start && newEnd > start && oldTokens[oldEnd - 1].text === newTokens[newEnd - 1].text) { oldEnd--; newEnd--; }
  const oldPart = oldTokens.slice(start, oldEnd), newPart = newTokens.slice(start, newEnd);
  const wholeRange = (tokens) => tokens.length ? [[tokens[0].start, tokens.at(-1).end]] : [];
  const cost = (oldPart.length + 1) * (newPart.length + 1);
  // Bound work on generated/minified lines and large replacement blocks.
  if (cost > 100_000 || cost > budget.remaining) return [wholeRange(oldPart), wholeRange(newPart)];
  budget.remaining -= cost;
  const table = Array.from({length: oldPart.length + 1}, () => new Uint32Array(newPart.length + 1));
  for (let i = oldPart.length - 1; i >= 0; i--) {
    for (let j = newPart.length - 1; j >= 0; j--) {
      table[i][j] = oldPart[i].text === newPart[j].text ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const oldRanges = [], newRanges = [];
  const add = (ranges, token) => {
    if (ranges.at(-1)?.[1] === token.start) ranges.at(-1)[1] = token.end;
    else ranges.push([token.start, token.end]);
  };
  let i = 0, j = 0;
  while (i < oldPart.length || j < newPart.length) {
    if (i < oldPart.length && j < newPart.length && oldPart[i].text === newPart[j].text) { i++; j++; }
    else if (i < oldPart.length && (j === newPart.length || table[i + 1][j] >= table[i][j + 1])) add(oldRanges, oldPart[i++]);
    else add(newRanges, newPart[j++]);
  }
  return [oldRanges, newRanges];
}

function inlineChangesForRows(rows) {
  const changes = new Map();
  const budget = {remaining: 200_000};
  for (const [oldRow, newRow] of splitRows(rows)) {
    if (oldRow?.kind !== "deletion" || newRow?.kind !== "addition") continue;
    const [oldRanges, newRanges] = inlineChangedRanges(oldRow.content, newRow.content, budget);
    changes.set(oldRow, oldRanges);
    changes.set(newRow, newRanges);
  }
  return changes;
}

function diffCodeHtml(content, marked = false, tokens = null, ranges = []) {
  const leading = content.match(/^[ \t]*/)[0].length;
  const trailing = content.length - content.match(/[ \t]*$/)[0].length;
  let offset = 0;
  let rangeIndex = 0;
  const render = (text) => {
    let inChange = false;
    let html = "";
    for (const character of text) {
      while (rangeIndex < ranges.length && ranges[rangeIndex][1] <= offset) rangeIndex++;
      const changed = rangeIndex < ranges.length && ranges[rangeIndex][0] <= offset;
      if (changed !== inChange) html += changed ? '<span class="inline-change">' : '</span>';
      inChange = changed;
      const edge = offset < leading || offset >= trailing;
      offset += character.length;
      html += marked && edge && /[ \t]/.test(character)
        ? `<span class="diff-whitespace" data-symbol="${character === "\t" ? "→" : "·"}">${character}</span>`
        : escapeHtml(character);
    }
    if (inChange) html += '</span>';
    return html;
  };
  return tokens ? tokens.map((token) => syntaxTokenHtml(token, render(token.content))).join("") || " " : render(content) || " ";
}

function renderUnifiedRow(file, row, findings, whitespaceOnly = false, ranges = []) {
  const line = rowLine(row);
  const side = rowSide(row);
  const prefix = row.kind === "addition" ? "+" : row.kind === "deletion" ? "−" : " ";
  return `<div class="diff-row ${row.kind}" data-path="${escapeHtml(file.path)}" data-side="${side}" data-line="${line ?? ""}" data-old-line="${row.oldLine ?? ""}" data-new-line="${row.newLine ?? ""}" data-content="${escapeHtml(row.content)}">
    <span class="line-number" title="Old: ${row.oldLine ?? "—"} · New: ${row.newLine ?? "—"}">${line ?? ""}</span>
    <button class="line-prefix line-action" type="button" tabindex="-1"${line && !state.proposalPreview ? ` aria-describedby="diff-instructions" aria-label="${escapeHtml(`Review ${file.path}, ${side} line ${line}`)}"` : " disabled"}><span class="row-prefix">${prefix}</span><span class="review-dot hidden">●</span></button>
    <span class="finding-markers">${findingPins(file, row, side, findings)}</span><pre class="line-code" data-inline-ranges="${escapeHtml(JSON.stringify(ranges))}"${whitespaceOnly ? ' data-whitespace-only="true" title="Only leading/trailing spaces or tabs differ on this line."' : ""}>${diffCodeHtml(row.content, whitespaceOnly, null, ranges)}</pre>
  </div>`;
}

function splitRows(rows) {
  const pairs = [];
  for (let index = 0; index < rows.length;) {
    const row = rows[index];
    if (row.kind === "context" || row.kind === "meta") {
      pairs.push([row, row]);
      index += 1;
      continue;
    }
    const removed = [];
    const added = [];
    while (index < rows.length && rows[index].kind !== "context" && rows[index].kind !== "meta") {
      if (rows[index].kind === "deletion") removed.push(rows[index]);
      else added.push(rows[index]);
      index += 1;
    }
    for (let pair = 0; pair < Math.max(removed.length, added.length); pair += 1) {
      pairs.push([removed[pair] ?? null, added[pair] ?? null]);
    }
  }
  return pairs;
}

function renderSplitSide(file, row, side, findings, whitespaceOnly = false, ranges = []) {
  const line = side === "old" ? row?.oldLine : row?.newLine;
  const content = row?.content ?? "";
  const kind = row?.kind ?? "split-empty";
  const prefix = kind === "addition" ? "+" : kind === "deletion" ? "−" : " ";
  return `<div class="diff-row split-side ${kind}" data-path="${escapeHtml(file.path)}" data-side="${side}" data-line="${line ?? ""}" data-content="${escapeHtml(content)}">
    <span class="line-number">${line ?? ""}</span>
    <button class="line-prefix line-action" type="button" tabindex="-1"${line && !state.proposalPreview ? ` aria-describedby="diff-instructions" aria-label="${escapeHtml(`Review ${file.path}, ${side} line ${line}`)}"` : " disabled"}><span class="row-prefix">${prefix}</span><span class="review-dot hidden">●</span></button>
    <span class="finding-markers">${row ? findingPins(file, row, side, findings) : ""}</span><pre class="line-code" data-inline-ranges="${escapeHtml(JSON.stringify(ranges))}"${whitespaceOnly ? ' data-whitespace-only="true" title="Only leading/trailing spaces or tabs differ on this line."' : ""}>${diffCodeHtml(content, whitespaceOnly, null, ranges)}</pre>
  </div>`;
}

function renderDiffFileHeader(file, collapsed, fullContent = false) {
  const markdownPreview = isMarkdownFile(file) && state.markdownPreviewPaths.has(file.path);
  const markdownControl = isMarkdownFile(file) && !state.proposalPreview
    ? `<button class="text-button" type="button" data-markdown-preview="${escapeHtml(file.path)}">${markdownPreview ? "Changes" : "Preview"}</button> · `
    : "";
  const reviewControls = state.proposalPreview
    ? `<span class="proposal-label">pending suggestion</span>${state.proposalActivityId ? ` · <button class="text-button" type="button" data-preview-activity-action="apply" data-preview-activity-id="${escapeHtml(state.proposalActivityId)}">Apply</button> · <button class="text-button danger" type="button" data-preview-activity-action="reject" data-preview-activity-id="${escapeHtml(state.proposalActivityId)}">Reject</button> · ` : " · "}`
    : `${markdownControl}${fullContent || isPngDiff(file) || markdownPreview ? "" : `<button class="text-button" type="button" data-file-expansion="${file._full ? "compact" : "full"}" data-expand-file="${escapeHtml(file.path)}">${file._full ? "Collapse file" : "Expand file"}</button> · `}<button class="text-button review-file-button" type="button" data-reviewed-file="${escapeHtml(file.path)}"${reviewIsOpen() ? "" : " disabled"}>${state.session.reviewedFiles?.includes(file.path) ? "✓ Reviewed" : "Mark reviewed"}</button> · `;
  const paging = !fullContent && file._page && file._page.totalRows > file._page.limit
    ? `<button class="text-button" type="button" data-diff-page="${Math.max(0, file._page.offset - file._page.limit)}" data-page-file="${escapeHtml(file.path)}" data-context="${fileContext(file)}" data-page-full="${Boolean(file._full)}"${file._page.offset === 0 ? " disabled" : ""}>Previous chunk</button> <span>${file._page.offset + 1}–${Math.min(file._page.totalRows, file._page.offset + file._page.limit)} of ${file._page.totalRows}</span> <button class="text-button" type="button" data-diff-page="${file._page.offset + file._page.limit}" data-page-file="${escapeHtml(file.path)}" data-context="${fileContext(file)}" data-page-full="${Boolean(file._full)}"${file._page.offset + file._page.limit >= file._page.totalRows ? " disabled" : ""}>Next chunk</button> · `
    : "";
  return `<header class="diff-file-header">
    <span class="status mobile-file-status">${escapeHtml(file.status)}</span>
    <button class="diff-file-toggle" type="button" data-collapse-file="${escapeHtml(file.path)}" aria-expanded="${!collapsed}" aria-label="${escapeHtml(`${collapsed ? "Expand" : "Collapse"} ${file.path}`)}"><span class="collapse-caret" aria-hidden="true">⌄</span><span class="diff-file-title"><span class="status">${escapeHtml(file.status)}</span>${escapeHtml(file.path)}</span></button>
    <span class="file-stats">${reviewControls}${paging}${isPngDiff(file) ? "PNG image" : `<span class="plus">+${file.additions}</span> <span class="minus">-${file.deletions}</span>`}</span>
  </header>`;
}

function revealCodeLocation(path, side, line, { smooth = true } = {}) {
  const row = elements.diff.querySelector(`.diff-row[data-path="${CSS.escape(path)}"][data-side="${side}"][data-line="${line}"]`);
  if (row) {
    row.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "center" });
    row.classList.add("selected");
    return true;
  }
  return false;
}

function renderDiff(files, { proposalActivityId = null } = {}) {
  if (state.codeSelection) hideCodeSelectionToolbar(true);
  state.proposalPreview = Boolean(proposalActivityId);
  state.proposalActivityId = proposalActivityId;
  state.renderedDiffFiles = files;
  syncDiffViewControls();
  const findings = state.proposalPreview ? [] : state.session.outline?.findings ?? [];
  elements.diff.innerHTML = files
    .map((file) => {
      const collapsed = !state.proposalPreview && state.collapsedFiles.has(file.path);
      const layout = file.status === "added" ? "unified" : state.diffLayout;
      return `<section class="diff-file${collapsed ? " collapsed" : ""}" id="file-${CSS.escape(file.path)}" data-path="${escapeHtml(file.path)}">
      ${renderDiffFileHeader(file, collapsed)}
      <div class="diff-file-scroll">
      ${isPngDiff(file) ? renderPngDiff(file) : /\.md$/i.test(file.path) && state.markdownPreviewPaths?.has(file.path) ? renderMarkdownDiff(file) : file.hunks.map((hunk) => {
        const whitespaceRows = whitespaceChangedRows(hunk.rows);
        const inlineChanges = inlineChangesForRows(hunk.rows);
        return `<div class="hunk ${layout}-layout">
        <div class="hunk-header"><span>${escapeHtml(hunk.header)}</span>${!state.proposalPreview && !file._full && fileContext(file) < 200 ? `<button class="text-button" type="button" data-expand-context="${escapeHtml(file.path)}" data-context="${fileContext(file)}">Expand context</button>` : ""}</div>
        ${whitespaceRows.size ? `<div class="whitespace-summary">${whitespaceRows.size / 2} line pair${whitespaceRows.size === 2 ? "" : "s"}: only leading/trailing whitespace differs. <span>· space · → tab</span></div>` : ""}
        ${layout === "split"
          ? `<div class="split-resizer" data-split-resizer role="separator" aria-label="Resize old and new diff panes" aria-orientation="vertical" aria-valuemin="${SPLIT_PANE_MIN}" aria-valuemax="${SPLIT_PANE_MAX}" aria-valuenow="${state.splitOldWidth}" aria-valuetext="Old side ${state.splitOldWidth}%, new side ${100 - state.splitOldWidth}%" tabindex="0"></div>${splitRows(hunk.rows).map(([oldRow, newRow]) => `<div class="split-row">${renderSplitSide(file, oldRow, "old", findings, whitespaceRows.has(oldRow), inlineChanges.get(oldRow))}${renderSplitSide(file, newRow, "new", findings, whitespaceRows.has(newRow), inlineChanges.get(newRow))}</div>`).join("")}`
          : hunk.rows.map((row) => renderUnifiedRow(file, row, findings, whitespaceRows.has(row), inlineChanges.get(row))).join("")}
      </div>`; }).join("")}
      </div>
    </section>`;
    })
    .join("");
  const actions = [...elements.diff.querySelectorAll(".line-action:not(:disabled)")];
  const selected = actions.find((action) => action.closest(".diff-row")?.classList.contains("selected")) ?? actions[0];
  if (selected) selected.tabIndex = 0;
  elements["empty-diff"].classList.toggle("hidden", files.length > 0);
  void highlightRenderedCode();
  void hydrateDiffImages(files);
  if (files.some((file) => /\.md$/i.test(file.path) && state.markdownPreviewPaths?.has(file.path))) void hydrateMarkdownPreviews(files);
  renderConversationBadges();
}

function currentDiffRenderOptions() {
  return state.proposalPreview ? { proposalActivityId: state.proposalActivityId } : {};
}

function syncDiffViewControls() {
  elements.diff.classList.toggle("wrap-code", state.diffWrap === "wrap");
  elements.diff.classList.toggle("show-diff-markers", state.showDiffMarkers);
  document.getElementById("show-diff-markers").checked = state.showDiffMarkers;
  document.querySelectorAll("[data-diff-layout]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.diffLayout === state.diffLayout)));
  document.querySelectorAll("[data-diff-wrap]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.diffWrap === state.diffWrap)));
}

function persistDiffPreferences() {
  if (typeof api !== "function" || !state.session) return;
  const layout = state.diffLayout;
  const wrap = state.diffWrap;
  const mobile = narrowFilePanelLayout();
  state.diffPreferenceSave = (state.diffPreferenceSave ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const session = await api("/api/preferences", {
        method: "POST",
        body: JSON.stringify({ diffLayout: layout, diffWrap: wrap, mobile }),
      });
      if (state.session) state.session.diffPreferences = session.diffPreferences;
    })
    .catch((error) => toast(error.message));
}

function diffViewRow(path, side, line) {
  return elements.diff.querySelector(`.diff-row[data-path="${CSS.escape(path)}"][data-side="${side}"][data-line="${line}"]`)
    ?? elements.diff.querySelector(`.diff-row[data-path="${CSS.escape(path)}"][data-${side}-line="${line}"]`);
}

function changeDiffView(layout, wrap, persist = true) {
  if (!["unified", "split"].includes(layout) || !["scroll", "wrap"].includes(wrap)) return;
  const panel = elements["diff-panel"];
  const panelTop = panel.getBoundingClientRect().top;
  const toolbarHeight = document.querySelector('.diff-toolbar').getBoundingClientRect().height;
  const row = [...elements.diff.querySelectorAll('.diff-row[data-line]:not([data-line=""])')].find(row => row.getBoundingClientRect().bottom > panelTop + toolbarHeight + 80);
  const anchor = row ? {path: row.dataset.path, side: row.dataset.side, line: row.dataset.line, top: row.getBoundingClientRect().top} : null;
  const scrollTop = panel.scrollTop;
  const pageTop = window.scrollY;
  const rerender = state.diffLayout !== layout && !elements.diff.querySelector('.source-file');
  const forms = [...elements.diff.querySelectorAll('.inline-edit-form, .inline-comment-form')];
  state.diffLayout = layout;
  state.diffWrap = wrap;
  if (persist) {
    window.localStorage.setItem(diffLayoutPreferenceKey(), state.diffLayout);
    window.localStorage.setItem(diffWrapPreferenceKey(), state.diffWrap);
    if (typeof persistDiffPreferences === "function") persistDiffPreferences();
  }
  if (rerender) {
    // Use the currently displayed files, including expanded/proposal diffs.
    renderDiff(state.renderedDiffFiles, currentDiffRenderOptions());
    renderComments();
    renderFindings();
    renderTourAnnotation();
    for (const form of forms) {
      const edit = form.classList.contains("inline-edit-form");
      const side = edit ? "new" : form.dataset.commentSide;
      const target = diffViewRow(edit ? form.dataset.editPath : form.dataset.commentPath, side, edit ? form.dataset.editLine : form.dataset.commentLine);
      if (!target) continue;
      const split = target.closest(".split-row");
      if (split) {
        const lane = document.createElement("div");
        lane.className = edit ? "inline-edit-lane" : `inline-comment-editor-lane ${side}-side`;
        lane.append(form);
        split.insertAdjacentElement("afterend", lane);
      } else target.insertAdjacentElement("afterend", form);
    }
    if (state.selectedLine) diffViewRow(state.selectedLine.path, state.selectedLine.side, state.selectedLine.line)?.classList.add("selected");
  } else syncDiffViewControls();
  // Restore the same source line, not its old pixel scroll offset: wrapping
  // changes the height of every preceding line. No smooth jump via the top.
  window.scrollTo({top: pageTop, behavior: "instant"});
  panel.scrollTop = scrollTop;
  const target = anchor && diffViewRow(anchor.path, anchor.side, anchor.line);
  if (target) panel.scrollTop += target.getBoundingClientRect().top - anchor.top;
  scheduleCurrentStepReturnUpdate();
}

function isPngDiff(file) {
  return /\.png$/i.test(file.path);
}

function isMarkdownFile(file) {
  return /\.md$/i.test(file.path);
}

function markdownSides(file) {
  return [file.oldPath ? ["old", "Before"] : null, file.newPath ? ["new", "After"] : null].filter(Boolean);
}

function markdownChangedLines(file, side) {
  const kind = side === "old" ? "deletion" : "addition";
  const key = side === "old" ? "oldLine" : "newLine";
  return new Set(file.hunks.flatMap((hunk) => hunk.rows.filter((row) => row.kind === kind && row[key] !== null).map((row) => row[key])));
}

function markdownChangedRanges(file, side) {
  const kind = side === "old" ? "deletion" : "addition";
  const key = side === "old" ? "oldLine" : "newLine";
  const ranges = new Map();
  for (const hunk of file.hunks) {
    const inlineChanges = inlineChangesForRows(hunk.rows);
    for (const row of hunk.rows) {
      if (row.kind === kind && row[key] !== null) ranges.set(row[key], inlineChanges.get(row) ?? []);
    }
  }
  return ranges;
}

function renderMarkdownDiff(file) {
  const sides = markdownSides(file);
  return `<div class="markdown-diff${sides.length === 1 ? " single" : ""}">${sides.map(([side, label]) => `<section class="markdown-diff-side ${side}"><header>${label}</header><article class="markdown-preview rendered-markdown" data-markdown-path="${escapeHtml(file.path)}" data-markdown-side="${side}"><p class="muted">Loading Markdown preview…</p></article></section>`).join("")}</div>`;
}

async function hydrateMarkdownPreviews(files) {
  const requestId = ++state.markdownPreviewRequestId;
  const revision = state.session.revision;
  const previews = files.filter((file) => isMarkdownFile(file) && state.markdownPreviewPaths.has(file.path));
  for (const file of previews) {
    for (const [side] of markdownSides(file)) {
      const target = elements.diff.querySelector(`[data-markdown-path="${CSS.escape(file.path)}"][data-markdown-side="${side}"]`);
      if (!target) continue;
      const key = `${revision}:${file.path}:${side}`;
      try {
        let content = state.markdownPreviewCache.get(key);
        if (content === undefined) {
          const result = await api(`/api/diff/markdown?${new URLSearchParams({ path: file.path, side })}`);
          if (requestId !== state.markdownPreviewRequestId || !target.isConnected) return;
          content = result.content;
          state.markdownPreviewCache.set(key, content);
        }
        target.innerHTML = renderMarkdown(content, 0, { path: file.path, side, changedLines: markdownChangedLines(file, side), changedRanges: markdownChangedRanges(file, side) }) || '<p class="muted">This Markdown file is empty.</p>';
      } catch (error) {
        if (requestId === state.markdownPreviewRequestId && target.isConnected) target.innerHTML = `<p class="markdown-preview-error">${escapeHtml(error.message)}</p>`;
      }
    }
  }
  if (requestId === state.markdownPreviewRequestId) renderTourAnnotation();
}

function renderPngDiff(file) {
  if (state.proposalPreview) return '<p class="image-diff-loading">Image preview is unavailable for this pending suggestion.</p>';
  const singleLabel = file.status === "added" ? "Added" : file.status === "deleted" ? "Removed" : null;
  const sides = [
    file.oldPath ? ["old", singleLabel ?? "Before"] : null,
    file.newPath ? ["new", singleLabel ?? "After"] : null,
  ].filter(Boolean);
  const askDisabled = !state.session.outline || !reviewIsOpen();
  return `<div class="image-diff ${escapeHtml(file.status)}${sides.length === 1 ? " single" : ""}">${sides.map(([side, label]) => `<figure class="image-diff-side ${side}" data-diff-image-path="${escapeHtml(file.path)}" data-diff-image-side="${side}" data-path="${escapeHtml(file.path)}" data-side="${side}" data-line="1" data-content="${escapeHtml(`[PNG image · ${side}]`)}"><div class="image-review-actions" role="group" aria-label="Actions for ${escapeHtml(`${file.path}, ${label.toLowerCase()} image`)}"><button type="button" data-image-tool="comment"${reviewIsOpen() ? "" : " disabled"}>Comment</button><button type="button" data-image-tool="ask"${askDisabled ? ' disabled title="Start a tour to ask the agent about this image."' : ""}>Ask agent</button></div><div class="image-diff-loading">Loading ${label.toLowerCase()} image…</div><figcaption>${label}</figcaption></figure>`).join("")}</div>`;
}

async function hydrateDiffImages(files) {
  const requestId = ++state.diffImageRequestId;
  const revision = state.session.revision;
  const visibleKeys = new Set((state.proposalPreview ? [] : files.filter(isPngDiff)).flatMap((file) => [file.oldPath ? `${file.path}:old:${revision}` : null, file.newPath ? `${file.path}:new:${revision}` : null].filter(Boolean)));
  for (const [key, url] of state.diffImageUrls) {
    if (!visibleKeys.has(key)) {
      URL.revokeObjectURL(url);
      state.diffImageUrls.delete(key);
    }
  }
  const pending = [...elements.diff.querySelectorAll("[data-diff-image-path]")];
  async function hydrate(figure) {
    const path = figure.dataset.diffImagePath;
    const side = figure.dataset.diffImageSide;
    const key = `${path}:${side}:${revision}`;
    try {
      let url = state.diffImageUrls.get(key);
      if (!url) {
        const blob = await apiBlob(`/api/diff/image?${new URLSearchParams({ path, side })}`);
        if (requestId !== state.diffImageRequestId || !figure.isConnected) return;
        url = URL.createObjectURL(blob);
        state.diffImageUrls.set(key, url);
      }
      const loading = figure.querySelector(".image-diff-loading");
      if (loading) loading.outerHTML = `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" title="Open full-size image"><img src="${escapeHtml(url)}" alt="${escapeHtml(`${side === "old" ? "Before" : "After"}: ${path}`)}" /></a>`;
      const img = figure.querySelector("img");
      if (img) img.onerror = () => {
        const link = img.closest("a");
        link.className = "image-diff-loading";
        link.textContent = "Unable to display this PNG. Open the original image.";
      };
    } catch (error) {
      const loading = figure.querySelector(".image-diff-loading");
      if (loading) loading.textContent = error.message;
    }
  }
  // Keep large screenshot collections from starting every binary read at once.
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
    while (pending.length && requestId === state.diffImageRequestId) await hydrate(pending.shift());
  }));
}

function syntaxTokenHtml(token, contentHtml = escapeHtml(token.content)) {
  const styles = [token.fontStyle & 1 ? "syntax-italic" : "", token.fontStyle & 2 ? "syntax-bold" : "", token.fontStyle & 4 ? "syntax-underline" : ""].filter(Boolean).join(" ");
  return `<span class="syntax-token sl-${escapeHtml(token.light)} sd-${escapeHtml(token.dark)} ${styles}" style="--syntax-light:#${escapeHtml(token.light)};--syntax-dark:#${escapeHtml(token.dark)}">${contentHtml}</span>`;
}

async function highlightRenderedCode() {
  const requestId = ++state.highlightRequestId;
  const groups = [...elements.diff.querySelectorAll(".diff-file")].flatMap((section, fileIndex) =>
    [...section.querySelectorAll(":scope .hunk")].flatMap((hunk, hunkIndex) => {
      // A hidden gap between hunks may contain syntax that closes a multiline
      // comment or string. Never carry tokenizer state across that gap. In
      // split view the old and new files are independent sources as well.
      const segments = hunk.classList.contains("split-layout")
        ? ["old", "new"].map((side) => [...hunk.querySelectorAll(`.split-side[data-side="${side}"] .line-code`)])
        : [[...hunk.querySelectorAll(".line-code")]];
      return segments.flatMap((nodes, segmentIndex) => {
        if (nodes.length === 0) return [];
        const id = `diff-${fileIndex}-${hunkIndex}-${segmentIndex}`;
        nodes.forEach((node) => { node.dataset.highlightGroup = id; });
        return [{ id, path: section.dataset.path, lines: nodes.map((node) => node.textContent ?? "") }];
      });
    })
  );
  const source = elements.diff.querySelector(".source-file .source-code");
  if (source) {
    const lines = (source.textContent ?? "").split("\n");
    source.dataset.highlightGroup = "source";
    groups.push({ id: "source", path: source.closest(".source-file")?.dataset.path ?? "source.txt", lines });
  }
  if (groups.length === 0 || groups.reduce((sum, group) => sum + group.lines.length, 0) > 12_000) return;
  try {
    const batches = [];
    for (let index = 0; index < groups.length; index += 200) batches.push(groups.slice(index, index + 200));
    const results = await Promise.all(batches.map((batch) => api("/api/highlight", {
      method: "POST",
      body: JSON.stringify({ groups: batch, theme: state.syntaxTheme }),
    })));
    if (requestId !== state.highlightRequestId) return;
    for (const group of results.flatMap((result) => result.groups)) {
      if (group.id === "source") {
        const target = elements.diff.querySelector('.source-code[data-highlight-group="source"]');
        if (target) target.innerHTML = group.lines.map((line) => line.map((token) => syntaxTokenHtml(token)).join("")).join("\n");
        continue;
      }
      const nodes = [...elements.diff.querySelectorAll(`.line-code[data-highlight-group="${CSS.escape(group.id)}"]`)];
      group.lines.forEach((line, index) => { if (nodes[index]) nodes[index].innerHTML = diffCodeHtml(nodes[index].closest(".diff-row").dataset.content, nodes[index].dataset.whitespaceOnly === "true", line, JSON.parse(nodes[index].dataset.inlineRanges || "[]")); });
    }
  } catch {
    // Raw escaped source remains readable if highlighting is unavailable.
  }
}

function visibleDiffFiles() {
  const comparison = state.session.comparison;
  const files = filteredChangedFiles();
  if (comparison.diffMode !== "file") return files.map((file) => state.diffCache.get(file.path) ?? file);
  return files.map((file) => state.diffCache.get(file.path)).filter(Boolean);
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
    if (requestId !== state.fileRequestId || state.proposalPreview || !state.tourMode || currentPhase()?.id !== phase.id) return;
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

async function ensureReviewDiffs() {
  if (state.tourMode || state.session.comparison.diffMode !== "file") return;
  const files = filteredChangedFiles();
  const missing = files.map((file) => file.path).filter((path) => !state.diffCache.has(path));
  if (missing.length === 0) return;
  const key = `${state.session.revision}:${files.map((file) => file.path).join("\0")}`;
  if (state.reviewDiffLoadKey === key && state.reviewDiffLoadPromise) return state.reviewDiffLoadPromise;
  const generation = ++state.reviewDiffLoadGeneration;
  const revision = state.session.revision;
  const load = (async () => {
    if (visibleDiffFiles().length === 0) elements.diff.innerHTML = '<div class="empty">Loading changed files…</div>';
    let failures = 0;
    for (let offset = 0; offset < missing.length; offset += 8) {
      const results = await Promise.allSettled(missing.slice(offset, offset + 8).map(async (path) => {
        const result = await api(`/api/diff?${new URLSearchParams({ path })}`);
        return [path, { ...result.file, _context: result.context, _full: result.full, _page: { offset: result.offset, limit: result.limit, totalRows: result.totalRows } }];
      }));
      if (generation !== state.reviewDiffLoadGeneration || state.proposalPreview || state.tourMode || state.session.revision !== revision) return;
      for (const result of results) {
        if (result.status === "fulfilled") state.diffCache.set(result.value[0], result.value[1]);
        else failures += 1;
      }
    }
    renderDiff(visibleDiffFiles());
    renderComments();
    renderFindings();
    renderTourAnnotation();
    if (failures > 0) toast(`Could not load ${failures} changed file diff${failures === 1 ? "" : "s"}.`);
  })();
  state.reviewDiffLoadKey = key;
  state.reviewDiffLoadPromise = load;
  try { await load; } finally {
    if (state.reviewDiffLoadPromise === load) {
      state.reviewDiffLoadKey = null;
      state.reviewDiffLoadPromise = null;
    }
  }
}

function captureFileViewport(path, origin) {
  const panel = elements["diff-panel"];
  const file = elements.diff.querySelector(`.diff-file[data-path="${CSS.escape(path)}"]`);
  const header = file?.querySelector(":scope > .diff-file-header");
  if (!header) return null;
  const hunk = origin && file.contains(origin) ? origin.closest(".hunk") : null;
  const row = hunk?.querySelector(".diff-row.addition[data-line], .diff-row.deletion[data-line], .diff-row[data-line]");
  const target = row ?? header;
  return {
    path,
    scrollTop: panel.scrollTop,
    side: row?.dataset.side,
    line: row?.dataset.line,
    targetOffset: target.getBoundingClientRect().top - panel.getBoundingClientRect().top,
  };
}

function restoreFileViewport(anchor) {
  if (!anchor) return;
  const panel = elements["diff-panel"];
  panel.scrollTop = anchor.scrollTop;
  const row = anchor.side && anchor.line
    ? elements.diff.querySelector(`.diff-row[data-path="${CSS.escape(anchor.path)}"][data-side="${anchor.side}"][data-line="${anchor.line}"]`)
    : null;
  const target = row ?? elements.diff.querySelector(`.diff-file[data-path="${CSS.escape(anchor.path)}"] > .diff-file-header`);
  if (!target) return;
  const currentOffset = target.getBoundingClientRect().top - panel.getBoundingClientRect().top;
  panel.scrollTop += currentOffset - anchor.targetOffset;
}

async function showChangedFile(path, line, side, requestedOffset, requestedContext, requestedFull, viewportOrigin) {
  if (state.tourMode && !filteredChangedFiles().some((file) => file.path === path)) {
    toast("That file belongs to another phase. Exit the tour to browse every changed file.", { duration: 9_000, tone: "warning" });
    return false;
  }
  const requestId = ++state.fileRequestId;
  const viewportAnchor = (viewportOrigin || requestedFull !== undefined) ? captureFileViewport(path, viewportOrigin) : null;
  const expansionButton = requestedFull !== undefined
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
  state.proposalActivityId = null;
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
        if (requestId !== state.fileRequestId || state.visibleFile !== path) return false;
        file = { ...result.file, _context: result.context, _full: result.full, _page: { offset: result.offset, limit: result.limit, totalRows: result.totalRows } };
        state.diffCache.set(path, file);
      } catch (error) {
        if (expansionButton?.isConnected) {
          expansionButton.disabled = false;
          expansionButton.removeAttribute("aria-busy");
          expansionButton.textContent = expansionLabel;
        }
        if (requestId === state.fileRequestId) toast(error.message);
        return false;
      }
    }
    files = visibleDiffFiles();
  } else if (!files.some((file) => file.path === path)) {
    const requested = state.session.comparison.files.find((file) => file.path === path);
    files = requested ? [requested] : files;
  }
  renderDiff(files);
  renderComments();
  renderFindings();
  if (!viewportAnchor) document.querySelector(`.diff-file[data-path="${CSS.escape(path)}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  if (line && side) revealCodeLocation(path, side, line);
  renderTourAnnotation();
  if (viewportAnchor) restoreFileViewport(viewportAnchor);
  return true;
}

async function showRepositoryFile(path) {
  state.activeTab = "diff";
  state.proposalPreview = false;
  state.proposalActivityId = null;
  renderActiveTab();
  const requestId = ++state.fileRequestId;
  elements.diff.innerHTML = '<div class="empty">Loading source…</div>';
  try {
    const file = await api(`/api/files?path=${encodeURIComponent(path)}`);
    if (requestId !== state.fileRequestId) return false;
    state.repositoryFilePath = path;
    state.repositoryFileContent = file.content;
    state.repositoryFileView = /\.md$/i.test(path) ? "preview" : "source";
    renderRepositoryFile(path, file.content);
    elements["empty-diff"].classList.add("hidden");
    return true;
  } catch (error) {
    if (requestId === state.fileRequestId) toast(error.message);
    return false;
  }
}

function renderRepositoryFile(path, content) {
  const markdown = /\.md$/i.test(path);
  const preview = markdown && state.repositoryFileView === "preview";
  elements.diff.innerHTML = `<section class="source-file" data-path="${escapeHtml(path)}"><header class="diff-file-header"><span class="diff-file-title">${escapeHtml(path)}</span><span class="file-stats">${markdown ? `<button class="text-button" type="button" data-source-view="${preview ? "source" : "preview"}">${preview ? "Source" : "Preview"}</button> · ` : ""}<span class="muted">unchanged</span></span></header>${preview ? `<article class="markdown-preview rendered-markdown">${renderMarkdown(content, 0) || '<p class="muted">This Markdown file is empty.</p>'}</article>` : `<pre class="source-code">${escapeHtml(content)}</pre>`}</section>`;
  if (!preview) void highlightRenderedCode();
}

function symbolPeekContext() {
  if (state.codeSelection) return { path: state.codeSelection.path, line: state.codeSelection.startLine, side: state.codeSelection.side };
  if (state.selectedLine) return { path: state.selectedLine.path, line: state.selectedLine.line, side: state.selectedLine.side };
  const step = currentStep();
  return step ? { path: step.anchor.path, line: step.anchor.startLine, side: step.anchor.side } : {};
}

function symbolFromText(value) {
  return String(value ?? "").match(/[\p{L}_$][\p{L}\p{N}_$]*/gu)?.at(-1) ?? "";
}

function symbolForCodeSelection(selection) {
  const fallback = symbolFromText(selection.text);
  if (selection.startLine !== selection.endLine) return { symbol: fallback, expanded: false };
  const content = selection.startRow?.dataset.content ?? "";
  for (const match of content.matchAll(/[\p{L}_$][\p{L}\p{N}_$]*/gu)) {
    const start = match.index ?? 0;
    const symbol = match[0];
    const end = start + symbol.length;
    if (start <= selection.startOffset && selection.endOffset <= end) return { symbol, expanded: content.slice(selection.startOffset, selection.endOffset) !== symbol };
  }
  return { symbol: fallback, expanded: false };
}

function symbolPeekLocationHtml(location, highlightId) {
  const label = `${location.path}:${location.line}`;
  return `<article class="symbol-peek-location"><header><span class="symbol-peek-kind">${escapeHtml(location.kind)}</span><strong>${escapeHtml(label)}</strong><button class="text-button" type="button" data-symbol-location="${escapeHtml(location.path)}" data-symbol-line="${location.line}" data-symbol-side="new">Open in code</button></header><pre><code data-symbol-peek-highlight="${highlightId}" data-symbol-peek-path="${escapeHtml(location.path)}">${escapeHtml(location.excerpt.join("\n"))}</code></pre></article>`;
}

function symbolPeekSuggestionsHtml(result) {
  if (!result.suggestions?.length) return "";
  const choices = result.suggestions.map((suggestion) => `<button class="text-button" type="button" data-symbol-suggestion="${escapeHtml(suggestion.symbol)}" data-symbol-suggestion-path="${escapeHtml(suggestion.path)}" data-symbol-suggestion-line="${suggestion.line}"><code>${escapeHtml(suggestion.symbol)}</code><span>${escapeHtml(`${suggestion.path}:${suggestion.line}`)}</span></button>`).join("");
  return `<section class="symbol-peek-suggestions"><h3>Try a related identifier</h3><p class="muted">Partial matches from a bounded repository search.</p><div>${choices}</div>${result.suggestionsTruncated ? '<p class="muted">Suggestions were limited to keep this review responsive.</p>' : ""}</section>`;
}

async function highlightSymbolPeek() {
  const peek = state.symbolPeek;
  const result = peek.result;
  if (!peek.open || peek.compact || peek.loading || !result) return;
  const targets = [...elements["symbol-peek-result"].querySelectorAll("[data-symbol-peek-highlight]")];
  const groups = targets.map((target) => ({
    id: target.dataset.symbolPeekHighlight,
    path: target.dataset.symbolPeekPath,
    lines: (target.textContent ?? "").split("\n"),
  })).filter((group) => group.id && group.path);
  if (groups.length === 0 || groups.length > 200 || groups.reduce((total, group) => total + group.lines.length, 0) > 12_000) return;
  const requestId = ++peek.highlightRequestId;
  try {
    const response = await api("/api/highlight", {
      method: "POST",
      body: JSON.stringify({ groups, theme: state.syntaxTheme }),
    });
    if (requestId !== peek.highlightRequestId || !peek.open || peek.result !== result) return;
    const targetsById = new Map(targets.map((target) => [target.dataset.symbolPeekHighlight, target]));
    for (const group of response.groups) {
      const target = targetsById.get(group.id);
      if (target) target.innerHTML = group.lines.map((line) => line.map((token) => syntaxTokenHtml(token)).join("")).join("\n");
    }
  } catch {
    // Raw escaped source remains readable if highlighting is unavailable.
  }
}

function renderSymbolPeek() {
  const peek = state.symbolPeek;
  const result = peek.result;
  const panel = elements["symbol-peek-panel"];
  panel.classList.toggle("hidden", !peek.open);
  panel.classList.toggle("symbol-peek-compact", Boolean(peek.open && peek.compact));
  panel.tabIndex = peek.open && peek.compact ? 0 : -1;
  panel.setAttribute("aria-expanded", String(Boolean(peek.open && !peek.compact)));
  elements["symbol-peek-close"].textContent = peek.compact ? "Close" : "Back to code";
  elements["symbol-peek-close"].setAttribute("aria-label", peek.compact ? "Close symbol context" : "Back to code");
  if (!peek.open) return;
  elements["symbol-peek-input"].value = peek.current?.symbol ?? "";
  const trail = peek.history.map((entry, index) => `<button type="button" class="text-button" data-symbol-trail-index="${index}" aria-label="Return to ${escapeHtml(entry.symbol)}" title="Return to ${escapeHtml(entry.symbol)}">${escapeHtml(entry.symbol)}</button>`).join('<span aria-hidden="true">›</span>');
  elements["symbol-peek-trail"].classList.toggle("hidden", !peek.current || !trail);
  elements["symbol-peek-trail"].innerHTML = trail ? `<span class="symbol-peek-trail-label">Peek trail</span>${trail}<span aria-hidden="true">›</span><span class="symbol-peek-trail-current" aria-current="page">${escapeHtml(peek.current.symbol)} <span>(current)</span></span>` : "";
  if (!peek.current) {
    elements["symbol-peek-status"].textContent = "Choose a symbol from the code or enter one above.";
    elements["symbol-peek-result"].innerHTML = "";
    return;
  }
  if (peek.loading) {
    elements["symbol-peek-status"].textContent = `Resolving ${peek.current.symbol}…`;
    elements["symbol-peek-result"].innerHTML = "";
    return;
  }
  if (!result) return;
  elements["symbol-peek-title"].textContent = result.symbol;
  elements["symbol-peek-status"].textContent = `${result.sourceLabel}: ${result.notice}${result.truncated ? " Some results were truncated to keep this review responsive." : ""}`;
  const definitions = result.definitions.length ? `<section><h3>Definitions (${result.definitions.length})</h3>${result.definitions.map((location, index) => symbolPeekLocationHtml(location, `symbol-definition-${index}`)).join("")}</section>` : '<p class="muted">No definition locations found.</p>';
  const usages = result.usages.length ? `<section><h3>Usages (${result.usages.length})</h3>${result.usages.map((location, index) => symbolPeekLocationHtml(location, `symbol-usage-${index}`)).join("")}</section>` : '<p class="muted">No usage locations found.</p>';
  const raw = result.raw ? `<details class="symbol-peek-raw"><summary>Raw ${escapeHtml(result.sourceLabel)} response</summary><pre>${escapeHtml(result.raw)}</pre></details>` : "";
  elements["symbol-peek-result"].innerHTML = `${definitions}${usages}${symbolPeekSuggestionsHtml(result)}${raw}`;
  void highlightSymbolPeek();
}

async function resolvePeekSymbol(symbol, context = symbolPeekContext(), pushHistory = true) {
  const normalized = symbolFromText(symbol);
  if (!normalized) {
    elements["symbol-peek-input"].focus();
    return toast("Enter a symbol name to peek.", { tone: "warning" });
  }
  const peek = state.symbolPeek;
  if (pushHistory && peek.current) peek.history.push({ ...peek.current });
  peek.open = true;
  peek.compact = false;
  peek.current = { symbol: normalized, ...context };
  peek.result = null;
  peek.loading = true;
  const requestId = ++peek.requestId;
  renderSymbolPeek();
  try {
    const result = await api("/api/symbol-peek", {
      method: "POST",
      body: JSON.stringify({ symbol: normalized, ...(context.path ? { path: context.path } : {}), ...(context.line ? { line: context.line } : {}), ...(context.side ? { side: context.side } : {}) }),
    });
    if (requestId !== peek.requestId) return;
    peek.result = result;
  } catch (error) {
    if (requestId === peek.requestId) toast(error.message, { tone: "warning", duration: 6_000 });
  } finally {
    if (requestId === peek.requestId) {
      peek.loading = false;
      renderSymbolPeek();
    }
  }
}

function compactSymbolPeek() {
  const peek = state.symbolPeek;
  if (!peek.open || peek.compact) return;
  peek.compact = true;
  renderSymbolPeek();
}

function expandSymbolPeek() {
  const peek = state.symbolPeek;
  if (!peek.open || !peek.compact) return;
  peek.compact = false;
  renderSymbolPeek();
  elements["symbol-peek-panel"].focus({ preventScroll: true });
}

async function openSymbolPeekLocation(path, line, side) {
  const isChangedFile = state.session.comparison.files.some((file) => file.path === path);
  const opened = isChangedFile
    ? await showChangedFile(path, line, side)
    : await showRepositoryFile(path);
  if (opened) compactSymbolPeek();
}

function closeSymbolPeek() {
  state.symbolPeek.open = false;
  state.symbolPeek.loading = false;
  state.symbolPeek.current = null;
  state.symbolPeek.result = null;
  state.symbolPeek.history = [];
  state.symbolPeek.compact = false;
  state.symbolPeek.requestId += 1;
  state.symbolPeek.highlightRequestId += 1;
  renderSymbolPeek();
  void focusCurrentStep();
}

async function showActivityFile(activityId, path) {
  const requestId = ++state.fileRequestId;
  state.reviewDiffLoadGeneration += 1;
  state.activeTab = "diff";
  state.proposalPreview = true;
  state.proposalActivityId = activityId;
  renderActiveTab();
  elements.diff.innerHTML = '<div class="empty">Loading proposed diff…</div>';
  elements["empty-diff"].classList.add("hidden");
  try {
    const result = await api(`/api/activities/${encodeURIComponent(activityId)}/diff?path=${encodeURIComponent(path)}`);
    if (requestId !== state.fileRequestId || !state.proposalPreview || state.proposalActivityId !== activityId) return;
    renderDiff([result.file], { proposalActivityId: activityId });
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
  const model = adapter?.models.find((candidate) => candidate.id === selected) ?? adapter?.models[0];
  const reasoning = state.session.agentSelection?.adapterId === adapter?.id && state.session.agentSelection?.modelId === model?.id
    ? state.session.agentSelection.reasoningEffort
    : model?.defaultReasoningEffort;
  const modelIdentity = model?.id === "current-session" ? "Current agent session" : model?.id;
  const agentIdentity = adapter
    ? [adapter.label, modelIdentity, reasoning].filter(Boolean).join(" · ")
    : "No agent detected";
  elements["agent-name"].textContent = agentIdentity;
  elements["agent-name"].title = agentIdentity;
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

function commentScope(comment) {
  const scope = comment.scope ?? "line";
  if (scope === "stop") {
    const step = state.session.outline?.phases.flatMap((phase) => phase.steps).find((candidate) => candidate.id === comment.stepId);
    return step ? `Tour stop comment · ${step.title}` : "Tour stop comment";
  }
  return scope === "range" ? "Line range comment" : "Line comment";
}

function quotationLabel(text) {
  const lineCount = text.replaceAll("\r\n", "\n").split("\n").length;
  return `Selected quotation · ${lineCount} ${lineCount === 1 ? "line" : "lines"}`;
}

function selectedQuotation(comment) {
  if (!comment.selectedText) return "";
  const label = quotationLabel(comment.selectedText);
  return `<details class="comment-quote-details"><summary>${escapeHtml(label)}</summary><blockquote class="comment-quote" data-comment-quote-path="${escapeHtml(comment.path)}">${escapeHtml(comment.selectedText)}</blockquote></details>`;
}

async function highlightCommentQuotes() {
  const requestId = ++state.commentQuoteHighlightRequestId;
  const targets = [...document.querySelectorAll(".comment-quote[data-comment-quote-path]")]
    .map((target, index) => ({
      target,
      id: `comment-quote-${requestId}-${index}`,
      path: target.dataset.commentQuotePath,
      lines: (target.textContent ?? "").replaceAll("\r\n", "\n").split("\n"),
    }))
    .filter((target) => target.path && target.lines.some((line) => line.length > 0));
  if (targets.length === 0) return;
  try {
    const batches = [];
    for (let index = 0; index < targets.length; index += 100) batches.push(targets.slice(index, index + 100));
    const results = await Promise.all(batches.map(async (batch) => await api("/api/highlight", {
      method: "POST",
      body: JSON.stringify({
        groups: batch.map(({ id, path, lines }) => ({ id, path, lines })),
        theme: state.syntaxTheme,
      }),
    })));
    if (requestId !== state.commentQuoteHighlightRequestId) return;
    const highlighted = new Map(results.flatMap((result) => result.groups).map((group) => [group.id, group]));
    for (const target of targets) {
      const group = highlighted.get(target.id);
      if (!group || !target.target.isConnected) continue;
      target.target.innerHTML = group.lines.map((line) => line.map((token) => syntaxTokenHtml(token)).join("")).join("\n") || " ";
    }
  } catch {
    // Quoted source remains safely escaped and readable if highlighting is unavailable.
  }
}

function commentLocation(comment) {
  const endLine = comment.endLine ?? comment.line;
  if (/\.png$/i.test(comment.path)) return `${comment.path} · ${comment.side} image`;
  return `${comment.path}:${comment.line}${endLine !== comment.line ? `-${endLine}` : ""} · ${comment.side}`;
}

function commentRowSelector(comment, line = comment.line) {
  return `.diff-row[data-path="${CSS.escape(comment.path)}"][data-side="${comment.side}"][data-line="${line}"]`;
}

function renderComments() {
  document.querySelectorAll(".split-inline-comment").forEach((comment) => comment.remove());
  document.querySelectorAll(".inline-comment").forEach((comment) => comment.remove());
  document.querySelectorAll(".diff-row.has-comment").forEach((row) => {
    row.classList.remove("has-comment");
    row.querySelector(".review-dot")?.classList.add("hidden");
    const action = row.querySelector(".line-action");
    action?.removeAttribute("data-inline-comment-id");
    action?.setAttribute("aria-label", `Review ${row.dataset.path}, ${row.dataset.side} line ${row.dataset.line}`);
    row.removeAttribute("title");
  });
  document.querySelectorAll(".image-diff-side.has-comment").forEach((image) => {
    image.classList.remove("has-comment");
    image.removeAttribute("title");
  });
  for (const comment of state.session.comments) {
    const selector = commentRowSelector(comment);
    const imageSelector = `.image-diff-side[data-path="${CSS.escape(comment.path)}"][data-side="${comment.side}"]`;
    const row = document.querySelector(selector) ?? (/\.png$/i.test(comment.path) ? document.querySelector(imageSelector) : null);
    if (!row) continue;
    const endLine = comment.endLine ?? comment.line;
    for (let line = comment.line; line <= endLine; line += 1) document.querySelector(commentRowSelector(comment, line))?.classList.add("has-comment");
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
    const confirmingDelete = state.deletingCommentId === comment.id;
    inline.innerHTML = `<header class="inline-comment-header${confirmingDelete ? " confirming-delete" : ""}"><span class="inline-comment-label">${escapeHtml(commentScope(comment))}</span><span class="inline-comment-actions${confirmingDelete ? " confirming" : ""}">${confirmingDelete
      ? `<span>Delete this comment?</span><button type="button" data-inline-comment-action="cancel-delete" data-inline-comment-id="${escapeHtml(comment.id)}">Cancel</button><button class="danger confirm" type="button" data-inline-comment-action="confirm-delete" data-inline-comment-id="${escapeHtml(comment.id)}">Delete</button>`
      : `<button type="button" data-inline-comment-action="edit" data-inline-comment-id="${escapeHtml(comment.id)}">Edit</button><button class="danger" type="button" data-inline-comment-action="delete" data-inline-comment-id="${escapeHtml(comment.id)}">Delete</button>`}</span></header><button class="inline-comment-button" type="button" data-inline-comment-id="${escapeHtml(comment.id)}" aria-label="${escapeHtml(`Edit comment at ${commentLocation(comment)}`)}"><p>${renderInlineMarkdown(comment.body)}</p></button>${selectedQuotation(comment)}`;
    const splitRow = row.closest(".split-row");
    if (row.classList.contains("image-diff-side")) {
      row.querySelector("figcaption").insertAdjacentElement("beforebegin", inline);
    } else if (splitRow) {
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
    ? '<p class="comment-empty">Choose Comment on a changed line or image to add feedback.</p>'
    : state.session.comments.map((comment) => `<article class="comment-item ${escapeHtml(comment.status)}" data-comment-id="${escapeHtml(comment.id)}">
      <div class="comment-meta"><button class="comment-jump" data-action="jump" type="button">${escapeHtml(commentLocation(comment))}</button><span class="comment-status">${escapeHtml(commentScope(comment))} · ${escapeHtml(comment.status)}</span></div>
      ${selectedQuotation(comment)}
      ${comment.scope === "stop" ? `<div class="comment-anchor-context">Scoped to stop <strong>${escapeHtml(commentScope(comment).replace("Tour stop comment · ", ""))}</strong></div>` : ""}
      <p>${renderInlineMarkdown(comment.body)}</p>
      ${state.session.pullRequest && (comment.scope ?? "line") === "line" && !/\.png$/i.test(comment.path) ? `<label class="toggle-control"><input data-action="github" type="checkbox"${comment.publishToGitHub ? " checked" : ""}${disabled} /> Include in GitHub review</label>` : ""}
      <div class="comment-actions">
        ${state.deletingCommentId === comment.id
          ? `<span class="delete-confirmation">Delete this comment?</span><button class="text-button" data-action="cancel-delete" type="button">Cancel</button><button class="text-button danger" data-action="confirm-delete" type="button">Delete</button>`
          : `<button class="text-button" data-action="edit" type="button"${disabled}>Edit</button><button class="text-button danger" data-action="delete" type="button"${disabled}>Delete</button>`}
      </div>
    </article>`).join("");
  void highlightCommentQuotes();
  renderStepDiscussion();
}

function renderPullRequest() {
  const pullRequest = state.session.pullRequest;
  elements["pull-request-tab"].classList.toggle("hidden", !pullRequest);
  if (!pullRequest) {
    if (state.activeTab === "pull-request") state.activeTab = "diff";
    elements["pull-request-content"].innerHTML = "";
    return;
  }
  const mergeability = pullRequest.mergeable || pullRequest.mergeStateStatus ? `<li><strong>Mergeability</strong> — ${escapeHtml(pullRequest.mergeable ?? "unknown")}${pullRequest.mergeStateStatus ? ` · ${escapeHtml(pullRequest.mergeStateStatus)}` : ""}</li>` : "";
  const checks = `${mergeability}${pullRequest.checks.length === 0 ? "<li>No checks reported.</li>" : pullRequest.checks.map((check) => `<li><strong>${escapeHtml(check.name)}</strong> — ${escapeHtml(check.state)}</li>`).join("")}`;
  const commits = pullRequest.commits.length === 0 ? "<li>No commits reported.</li>" : pullRequest.commits.map((commit) => `<li><code>${escapeHtml(commit.oid.slice(0, 8))}</code> ${escapeHtml(commit.headline)} <span class="muted">${escapeHtml(commit.authors.join(", "))}</span></li>`).join("");
  const threads = pullRequest.threads.length === 0 ? "<p class=\"muted\">No existing review threads.</p>" : pullRequest.threads.map((thread) => `<article class="comment-item"><div class="comment-meta"><span>${escapeHtml(thread.path)}${thread.line ? `:${thread.line}` : ""}</span><span>${thread.resolved ? "resolved" : "open"}</span></div>${thread.comments.map((comment) => `<p><strong>${escapeHtml(comment.author)}</strong>: ${renderInlineMarkdown(comment.body)}</p>`).join("")}</article>`).join("");
  const issue = pullRequest.linkedIssue;
  const assessment = state.session.outline?.issueAssessment;
  const issueAssessment = !issue ? "" : `<section class="issue-assessment"><h3>Issue-to-implementation assessment</h3>${issue.access !== "available" ? `<p class="muted">The linked issue is ${escapeHtml(issue.access)}. No assessment was generated.</p>` : issue.criteriaStatus === "malformed" ? `<p class="muted">The linked issue body was malformed or exceeded the safe limit. No criteria were assessed.</p>` : issue.criteriaStatus === "not-found" ? `<p class="muted">No explicit acceptance criteria were found in the issue body.</p>` : !assessment ? `<p class="muted">Start the tour to map the ${issue.acceptanceCriteria.length} explicit acceptance ${issue.acceptanceCriteria.length === 1 ? "criterion" : "criteria"} to repository evidence.</p>` : `<p class="assessment-disclaimer">Model assessment based on cited repository paths; statuses are not verified test results.</p><div class="issue-criteria">${issueAssessmentItems(assessment.items)}</div>`}</section>`;
  elements["pull-request-content"].classList.toggle("wide", state.pullRequestWide);
  elements["pull-request-content"].innerHTML = `
    <div class="panel-heading"><div><div class="eyebrow">GitHub pull request</div><h2>#${pullRequest.number} ${escapeHtml(pullRequest.title)}</h2></div><div class="pull-request-header-actions"><button class="button secondary" type="button" data-pull-request-width aria-pressed="${state.pullRequestWide}" title="${state.pullRequestWide ? "Return to a centred reading width" : "Use the full available review width"}">${state.pullRequestWide ? "Center width" : "Full width"}</button><span class="mode">${escapeHtml(pullRequest.reviewDecision ?? "REVIEW REQUIRED")}</span></div></div>
    <p class="muted">${escapeHtml(pullRequest.repository)} · ${escapeHtml(pullRequest.author)} · ${escapeHtml(pullRequest.baseRefName)} ← ${escapeHtml(pullRequest.headRefName)} · ${escapeHtml(pullRequest.headRefOid.slice(0, 8))}</p>
    <div class="pull-request-context"><section class="pull-request-description-panel"><h3>Pull request description</h3>${pullRequestDescription(pullRequest.body)}</section>${linkedIssueSummary(issue)}</div>${issueAssessment}
    <h3>Checks</h3><ul>${checks}</ul>
    <h3>Commits</h3><ul>${commits}</ul>
    <h3>Existing review threads${pullRequest.threadsTruncated ? " (first 100)" : ""}</h3>${threads}`;
}

function togglePullRequestContentWidth(event) {
  const button = event.target.closest("[data-pull-request-width]");
  if (!button) return;
  setPullRequestContentWidth(!state.pullRequestWide, true);
  renderPullRequest();
  event.currentTarget.querySelector("[data-pull-request-width]")?.focus({ preventScroll: true });
}

function renderReviewOverview() {
  const outline = state.session.outline;
  const pullRequest = state.session.pullRequest;
  const showBriefing = state.session.preferences?.showBriefing !== false;
  elements["review-overview"].classList.toggle("hidden", !outline && !pullRequest);
  elements["tour-overview"].classList.toggle("hidden", !outline);
  elements["tour-intro-return"].classList.toggle("hidden", !outline || !state.tourIntroShown || !showBriefing);
  elements["tour-intro-return"].textContent = state.tourIntroReturn ? "↩ Back to briefing" : "View briefing";
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

const findingEvidenceLabels = new Map([
  ["observation", "Observation"],
  ["changed code", "Changed code"],
  ["causal path", "Causal path"],
  ["execution path", "Causal path"],
  ["runtime path", "Causal path"],
  ["impact", "Impact"],
  ["outcome", "Impact"],
  ["coverage", "Coverage"],
  ["test coverage", "Coverage"],
]);

function findingEvidenceParts(evidence) {
  const value = String(evidence ?? "").trim();
  if (!value) return [];
  let chunks = value.split(/\n+/).map((part) => part.replace(/^\s*[-*•]\s+/, "").trim()).filter(Boolean);
  if (chunks.length === 1) {
    const sentences = chunks[0].match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g)?.map((part) => part.trim()).filter(Boolean) ?? [];
    if (sentences.length > 1) chunks = sentences;
  }
  return chunks.map((part, index) => {
    const labelled = /^([^:]{1,32}):\s+(.+)$/.exec(part);
    const label = labelled ? findingEvidenceLabels.get(labelled[1].trim().toLowerCase()) : undefined;
    return { label: label ?? (chunks.length === 1 ? "Evidence" : `Evidence ${index + 1}`), body: label ? labelled[2].trim() : part };
  });
}

function renderFindingEvidence(evidence) {
  return `<ol class="finding-evidence-list">${findingEvidenceParts(evidence).map((part) => `<li><strong>${escapeHtml(part.label)}</strong><div>${renderInlineMarkdown(part.body)}</div></li>`).join("")}</ol>`;
}

function findingCards(findings, compact = false) {
  const disabled = reviewIsOpen() ? "" : " disabled";
  const ordered = [...findings].sort((left, right) => left.priority.localeCompare(right.priority) || left.path.localeCompare(right.path) || left.line - right.line);
  return ordered.length === 0
    ? '<p class="comment-empty">No findings in this scope.</p>'
    : ordered.map((finding) => {
      const focused = finding.id === state.focusedFindingId;
      const disposition = finding.disposition || (finding.status === "dismissed" ? "deferred" : "");
      const findingComment = finding.commentId ? state.session.comments.find((comment) => comment.id === finding.commentId) : null;
      const convertedLabel = findingComment?.publishToGitHub ? "Added to PR review" : "Added to feedback";
      const classes = `finding-item ${finding.priority.toLowerCase()} ${escapeHtml(finding.status)}${disposition ? ` ${escapeHtml(disposition)}` : ""}${finding.outdated ? " outdated" : ""}${focused ? " focused" : ""}`;
      const body = `<div class="finding-heading"><button class="comment-jump" data-action="jump" type="button">${escapeHtml(finding.path)}:${finding.line}</button><span class="finding-priority">${finding.priority}</span></div>
      <strong>${escapeHtml(finding.category)} · ${escapeHtml(finding.severity)}</strong>
      <p>${renderInlineMarkdown(finding.message)}</p>
      <details class="finding-evidence"><summary>Evidence trail · ${escapeHtml(finding.confidence)} confidence</summary>${renderFindingEvidence(finding.evidence)}</details>
      <div class="finding-badges"><span>${finding.introduced === true ? "introduced" : finding.introduced === false ? "pre-existing" : "attribution unknown"}</span><span>${finding.tested ? "tested" : "untested"}</span><span>blast ${finding.blastRadiusSize}</span><span>${escapeHtml(finding.pinScope)} pin</span>${finding.recallGuard ? "<span>recall-protected</span>" : ""}${disposition ? `<span class="finding-disposition ${escapeHtml(disposition)}">${escapeHtml(findingDispositionLabel(disposition))}</span>` : ""}${finding.outdated ? '<span class="finding-reassessment">Needs reassessment</span>' : ""}</div>
      ${finding.reviewerNote ? `<div class="finding-note"><strong>Reviewer note</strong><p>${renderInlineMarkdown(finding.reviewerNote)}</p></div>` : ""}
      <div class="comment-actions">
        ${finding.status === "converted-to-feedback" ? `<span class="muted">${convertedLabel}</span>` : `<label class="finding-disposition-control"><span>Disposition</span><select data-finding-disposition${disabled}><option value=""${!disposition ? " selected" : ""}>Open</option>${Object.entries(findingDispositionLabels).map(([value, label]) => `<option value="${value}"${disposition === value ? " selected" : ""}>${label}</option>`).join("")}</select></label><textarea data-finding-note rows="2" maxlength="8000" placeholder="Optional reviewer note"${disabled}>${escapeHtml(finding.reviewerNote || "")}</textarea><button class="text-button" data-action="save-disposition" type="button"${disabled}>Save disposition</button>${finding.status === "open" ? `<button class="text-button" data-action="convert" type="button"${disabled}>${finding.outdated ? "Revalidate" : "Add as feedback"}</button>${state.session.pullRequest && !/\.png$/i.test(finding.path) ? `<button class="text-button" data-action="publish-finding" type="button"${disabled}>Add to PR review</button>` : ""}` : `<button class="text-button" data-action="reopen" type="button"${disabled}>Reopen</button>`}`}
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
  elements["findings-back"].textContent = state.findingReturn?.fromBriefing ? "← Back to briefing" : "← Back to code";
}

function openFindingFromCode(findingId, { fromBriefing = false } = {}) {
  const finding = state.session.outline?.findings.find((candidate) => candidate.id === findingId);
  state.findingReturn = {
    tab: state.activeTab,
    visibleFile: state.visibleFile,
    scrollTop: elements["diff-panel"].scrollTop,
    findingId,
    fromBriefing,
    path: finding?.path,
    line: finding?.line,
    side: finding?.side,
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

async function returnToFindingCode() {
  const target = state.findingReturn;
  if (!target) return;
  const fromBriefing = target.fromBriefing === true;
  state.findingReturn = null;
  state.focusedFindingId = null;
  state.tourIntroReturn = fromBriefing;
  state.activeTab = fromBriefing ? "diff" : target.tab;
  renderFindings();
  renderActiveTab();
  if (fromBriefing && target.path && target.line && target.side) {
    await showChangedFile(target.path, target.line, target.side);
    reopenTourIntro();
    return;
  }
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

function flowProvenanceLegend() {
  return `<div class="provenance-legend" role="list" aria-label="Diagram verification legend">${["verified", "partial", "unverified"].map((provenance) => {
    const copy = flowProvenanceCopy(provenance);
    return `<span role="listitem"><i class="provenance ${provenance}">${escapeHtml(copy.label)}</i><span>${escapeHtml(copy.detail)}</span></span>`;
  }).join("")}</div>`;
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

function callFlowCardHtml(flow, { showTitle = true, showRegenerate = true, viewer = false } = {}) {
  const provenance = flowProvenanceCopy(flow.provenance);
  const mode = state.callFlowModes.get(flow.id) ?? "changes";
  const counts = flow.edges.reduce((result, edge) => ({ ...result, [edge.change]: result[edge.change] + 1 }), { added: 0, removed: 0, unchanged: 0 });
  const heading = showTitle ? `<h2>${escapeHtml(flow.title)}</h2>` : "";
  const regenerate = showRegenerate ? `<button class="text-button" data-call-flow-regenerate type="button"${!reviewIsOpen() ? " disabled" : ""}>Regenerate</button>` : "";
  return `<article class="flow-card call-flow-card${viewer ? " architecture-viewer-call-flow-card" : ""}" data-call-flow-id="${escapeHtml(flow.id)}"><header><div><span class="provenance ${flow.provenance}" title="${escapeHtml(provenance.detail)}">${escapeHtml(provenance.label)}</span>${heading}</div>${regenerate}</header><p>${escapeHtml(flow.summary)}</p><div class="call-flow-summary"><span class="plus">+${counts.added} calls</span><span class="minus">−${counts.removed} calls</span></div><details class="flow-impact call-flow-impact"><summary>affects ${flow.affectedFiles.length}</summary><div class="flow-impact-list"><strong>Affected changed files</strong>${flow.affectedFiles.map((path) => `<button class="flow-affected-file" type="button" data-flow-file="${escapeHtml(path)}">${escapeHtml(path)}</button>`).join("")}</div></details><div class="call-flow-modes" role="group" aria-label="Call-flow version">${["changes", "before", "after"].map((candidate) => `<button type="button" data-call-flow-mode="${candidate}" class="${mode === candidate ? "active" : ""}">${candidate[0].toUpperCase()}${candidate.slice(1)}</button>`).join("")}</div><div class="call-tree-legend" role="list" aria-label="Call-flow legend"><span role="listitem"><i class="entrypoint" aria-hidden="true"></i>Entry point</span><span role="listitem"><i class="added" aria-hidden="true"></i>Added</span><span role="listitem"><i class="modified" aria-hidden="true"></i>Changed callable</span><span role="listitem"><i class="removed" aria-hidden="true"></i>Removed</span><span role="listitem"><i class="unchanged" aria-hidden="true"></i>Unchanged</span></div><p class="call-tree-caption">A changed callable exists before and after this change, but its implementation or outgoing calls changed.</p><div class="call-tree">${renderCallTree(flow, mode)}</div></article>`;
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
  const shell = document.querySelector(`[data-architecture-key="${CSS.escape(key)}"]`);
  const svg = shell?.querySelector(".architecture-diagram svg");
  const label = shell?.querySelector("[data-diagram-zoom-label]");
  const view = architectureDiagramView(key);
  if (svg) svg.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  if (label) label.textContent = `${Math.round(view.scale * 100)}%`;
}

function architectureDiagramControls(label) {
  return `<div class="diagram-controls" role="group" aria-label="${escapeHtml(`${label} diagram controls`)}">
    <span class="diagram-control-label">Move</span>
    <button type="button" data-diagram-action="move-left" aria-label="Move diagram left" title="Move left">←</button>
    <button type="button" data-diagram-action="move-up" aria-label="Move diagram up" title="Move up">↑</button>
    <button type="button" data-diagram-action="move-down" aria-label="Move diagram down" title="Move down">↓</button>
    <button type="button" data-diagram-action="move-right" aria-label="Move diagram right" title="Move right">→</button>
    <span class="diagram-control-label">Zoom</span>
    <button type="button" data-diagram-action="zoom-out" aria-label="Zoom diagram out" title="Zoom out">−</button>
    <button class="diagram-zoom-label" type="button" data-diagram-action="reset" data-diagram-zoom-label aria-label="Reset diagram view" title="Reset view">100%</button>
    <button type="button" data-diagram-action="zoom-in" aria-label="Zoom diagram in" title="Zoom in">+</button>
  </div>`;
}

function architectureDiagramExpandButton(label, key) {
  return `<button class="diagram-expand-button" type="button" data-diagram-expand="${escapeHtml(key)}" aria-label="${escapeHtml(`Expand ${label} diagram`)}" title="Open diagram viewer"><span aria-hidden="true">⛶</span> Expand</button>`;
}

function briefingDiagramExpandButton(label, kind, id) {
  return `<button class="diagram-expand-button" type="button" data-briefing-diagram-expand="${escapeHtml(kind)}" data-briefing-diagram-id="${escapeHtml(id)}" aria-label="${escapeHtml(`Expand ${label}`)}" title="Open diagram viewer"><span aria-hidden="true">⛶</span> Expand</button>`;
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
    <header class="architecture-card-heading"><div><span class="architecture-label">${escapeHtml(label)}</span><h2>${escapeHtml(architecture.title)}</h2></div>${architectureDiagramExpandButton(label, key)}</header>
    <p>${escapeHtml(architecture.summary)}</p>
    <div class="architecture-diagram-shell" data-architecture-key="${key}">
      ${architectureDiagramControls(label)}
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

function architectureLegend() {
  return `<div class="architecture-legend" role="list" aria-label="Architecture diagram legend">
    <span role="listitem"><i class="new" aria-hidden="true"></i>New</span>
    <span role="listitem"><i class="touched" aria-hidden="true"></i>Changed</span>
    <span role="listitem"><i class="removed" aria-hidden="true"></i>Removed</span>
    <span role="listitem"><i class="external" aria-hidden="true"></i>Outside this change</span>
  </div>`;
}

function tourIntroArchitectureCard(architecture, label, key) {
  return `<article class="tour-intro-chart">
    <div class="tour-intro-chart-heading"><div><span class="architecture-label">${escapeHtml(label)}</span><h4>${escapeHtml(architecture.title)}</h4></div>${architectureDiagramExpandButton(label, key)}</div>
    <p>${escapeHtml(architecture.summary)}</p>
    <div class="sequence-diagram mermaid-render" data-tour-intro-architecture-diagram="${key}" role="img" aria-label="${escapeHtml(`${label}: ${architecture.title}`)}"><span class="loading">Rendering diagram…</span></div>
    <div class="flow-warning hidden" data-tour-intro-architecture-error="${key}">The component diagram is unavailable.</div>
  </article>`;
}

function tourIntroSequenceCard(flow, index) {
  return `<article class="tour-intro-chart tour-intro-flow-card">
    <div class="tour-intro-chart-heading"><div><span class="architecture-label">Sequence diagram</span><h4>${escapeHtml(flow.title)}</h4></div>${briefingDiagramExpandButton("sequence diagram", "sequence", flow.id)}</div>
    <p>${escapeHtml(flow.summary)}</p>
    <div class="sequence-diagram mermaid-render" data-tour-intro-flow-index="${index}" role="img" aria-label="Sequence diagram: ${escapeHtml(flow.title)}"><span class="loading">Rendering diagram…</span></div>
    <p class="tour-intro-flow-impact">Affects ${flow.affectedFiles?.length || flow.blastRadiusSize} changed file${(flow.affectedFiles?.length || flow.blastRadiusSize) === 1 ? "" : "s"}.</p>
  </article>`;
}

function tourIntroCallFlowCard(flow) {
  const affectedFiles = flow.affectedFiles ?? [];
  return `<article class="tour-intro-chart tour-intro-flow-card">
    <div class="tour-intro-chart-heading"><div><span class="architecture-label">Call flow</span><h4>${escapeHtml(flow.title)}</h4></div>${briefingDiagramExpandButton("call flow", "call-flow", flow.id)}</div>
    <p>${escapeHtml(flow.summary)}</p>
    <div class="call-tree tour-intro-call-tree" data-tour-intro-call-flow="${escapeHtml(flow.id)}">${renderCallTree(flow, "changes")}</div>
    <p class="tour-intro-flow-impact">Affects ${affectedFiles.length || flow.blastRadiusSize} changed file${(affectedFiles.length || flow.blastRadiusSize) === 1 ? "" : "s"}.</p>
  </article>`;
}

function openArchitectureDiagramViewer(key) {
  const architecture = architectureEntries().find((entry) => entry.key === key);
  const source = elements["tour-intro-architecture"].querySelector(`[data-tour-intro-architecture-diagram="${CSS.escape(key)}"]`)
    ?? elements["architecture-content"].querySelector(`[data-architecture-diagram="${CSS.escape(key)}"]`);
  if (!architecture || !source?.querySelector("svg")) {
    toast("The component diagram is not ready yet.");
    return;
  }
  const viewerKey = `viewer-${key}`;
  state.architectureDiagramViews.set(viewerKey, { x: 0, y: 0, scale: 1 });
  elements["architecture-viewer-eyebrow"].textContent = "Component diagram";
  elements["architecture-viewer-title"].textContent = architecture.value.title;
  elements["architecture-viewer-controls"].innerHTML = architectureDiagramControls(architecture.label);
  elements["architecture-viewer-legend"].innerHTML = architectureLegend();
  elements["architecture-viewer-shell"].dataset.architectureKey = viewerKey;
  elements["architecture-viewer-diagram"].dataset.architectureDiagram = viewerKey;
  delete elements["architecture-viewer-diagram"].dataset.callFlowId;
  elements["architecture-viewer-diagram"].className = "sequence-diagram architecture-diagram";
  elements["architecture-viewer-diagram"].setAttribute("role", "img");
  elements["architecture-viewer-help"].classList.remove("hidden");
  elements["architecture-viewer-diagram"].setAttribute("aria-label", `${architecture.label}: ${architecture.value.title}. Drag to move; use arrow keys to move and plus or minus to zoom.`);
  elements["architecture-viewer-diagram"].innerHTML = source.innerHTML;
  elements["architecture-viewer-dialog"].showModal();
  applyArchitectureDiagramView(viewerKey);
  elements["architecture-viewer-diagram"].focus();
}

function openBriefingDiagramViewer(kind, id) {
  const sequence = kind === "sequence" ? state.session.outline?.flows.find((flow) => flow.id === id) : null;
  const callFlow = kind === "call-flow" ? state.session.outline?.callFlows.find((flow) => flow.id === id) : null;
  const source = sequence
    ? elements["tour-intro-sequence"].querySelector(`[data-tour-intro-flow-index="${state.session.outline.flows.indexOf(sequence)}"]`)
    : callFlow ? elements["tour-intro-call-flows"].querySelector(`[data-tour-intro-call-flow="${CSS.escape(id)}"]`) : null;
  if ((!sequence && !callFlow) || (sequence && (!source || !source.querySelector("svg")))) {
    toast(`The ${sequence ? "sequence diagram" : "call flow"} is not ready yet.`);
    return;
  }
  const viewerKey = `viewer-${kind}-${id}`;
  elements["architecture-viewer-eyebrow"].textContent = sequence ? "Sequence diagram" : "Call flow";
  elements["architecture-viewer-title"].textContent = (sequence ?? callFlow).title;
  elements["architecture-viewer-legend"].innerHTML = "";
  if (sequence) {
    delete elements["architecture-viewer-diagram"].dataset.callFlowId;
    elements["architecture-viewer-diagram"].innerHTML = source.innerHTML;
    state.architectureDiagramViews.set(viewerKey, { x: 0, y: 0, scale: 1 });
    elements["architecture-viewer-controls"].innerHTML = architectureDiagramControls("Sequence diagram");
    elements["architecture-viewer-shell"].dataset.architectureKey = viewerKey;
    elements["architecture-viewer-diagram"].dataset.architectureDiagram = viewerKey;
    elements["architecture-viewer-diagram"].className = "sequence-diagram architecture-diagram";
    elements["architecture-viewer-diagram"].setAttribute("role", "img");
    elements["architecture-viewer-diagram"].setAttribute("aria-label", `Sequence diagram: ${sequence.title}. Drag to move; use arrow keys to move and plus or minus to zoom.`);
    elements["architecture-viewer-help"].classList.remove("hidden");
  } else {
    elements["architecture-viewer-controls"].innerHTML = "";
    delete elements["architecture-viewer-shell"].dataset.architectureKey;
    delete elements["architecture-viewer-diagram"].dataset.architectureDiagram;
    elements["architecture-viewer-diagram"].dataset.callFlowId = callFlow.id;
    elements["architecture-viewer-diagram"].className = "architecture-viewer-call-flow";
    elements["architecture-viewer-diagram"].setAttribute("role", "region");
    elements["architecture-viewer-diagram"].setAttribute("aria-label", `Call flow details: ${callFlow.title}`);
    elements["architecture-viewer-diagram"].innerHTML = callFlowCardHtml(callFlow, { showTitle: false, showRegenerate: false, viewer: true });
    elements["architecture-viewer-help"].classList.add("hidden");
  }
  elements["architecture-viewer-dialog"].showModal();
  if (sequence) applyArchitectureDiagramView(viewerKey);
  elements["architecture-viewer-diagram"].focus();
}

function attentionSignalTarget(target) {
  if (target.kind === "finding") return `data-attention-kind="finding" data-attention-id="${escapeHtml(target.findingId)}"`;
  if (target.kind === "call-flow") return `data-attention-kind="call-flow" data-attention-id="${escapeHtml(target.callFlowId)}"`;
  if (target.kind === "file") return `data-attention-kind="file" data-attention-path="${escapeHtml(target.path)}"${target.side ? ` data-attention-side="${target.side}"` : ""}${target.line ? ` data-attention-line="${target.line}"` : ""}`;
  return `data-attention-kind="section" data-attention-section="${escapeHtml(target.section)}"`;
}

function attentionTargetLabel(target) {
  if (target.kind === "finding") return "View finding";
  if (target.kind === "call-flow") return "Open call flow";
  if (target.kind === "file") return `Open ${target.path}${target.line ? `:${target.line}` : ""}`;
  return `Open ${target.section.replaceAll("-", " ")} section`;
}

function renderTourAttention() {
  const briefing = state.session.needsAttention;
  const signals = briefing?.signals ?? [];
  const findingCount = signals.filter((signal) => signal.kind === "finding").length;
  const showAttention = state.session.preferences?.briefingNeedsAttention !== false;
  const showEffort = state.session.preferences?.briefingReviewEffort !== false;
  elements["tour-intro-attention"].classList.toggle("hidden", !showAttention || signals.length === 0);
  elements["tour-intro-attention-note"].textContent = signals.length === 0 ? "" : `${signals.length} review cue${signals.length === 1 ? "" : "s"} shown; ${findingCount === 0 ? "none are" : findingCount === 1 ? "one is" : `${findingCount} are`} unresolved P0/P1 finding${findingCount === 1 ? "" : "s"}. Other cues point to contracts, tests, flows, stale analysis, or GitHub status; lower-priority findings remain in Findings.`;
  elements["tour-intro-attention-list"].innerHTML = signals.map((signal) => `<article class="tour-intro-attention-item ${signal.kind}" role="listitem"><div class="tour-intro-attention-heading"><strong>${escapeHtml(signal.title)}</strong><span class="attention-basis">${signal.basis === "bounded-heuristic" ? "Bounded heuristic" : "Repository evidence"}</span></div><p>${escapeHtml(signal.detail)}</p><details><summary>Evidence</summary><p>${escapeHtml(signal.evidence)}</p></details><button type="button" class="text-button" ${attentionSignalTarget(signal.target)}>${escapeHtml(attentionTargetLabel(signal.target))}</button></article>`).join("");
  const estimate = briefing?.estimate;
  elements["tour-intro-estimate"].classList.toggle("hidden", !showEffort || !estimate);
  elements["tour-intro-estimate-summary"].textContent = estimate ? `About ${estimate.minutes} minutes for a first pass, based on the visible diff and review signals. It is a rough planning aid, not a risk score or quality rating.` : "Estimate unavailable.";
  elements["tour-intro-estimate-factors"].innerHTML = (estimate?.factors ?? []).map((factor) => `<div class="tour-intro-estimate-factor"><span>${escapeHtml(factor.label)}</span><strong>+${factor.minutes} min</strong><small>${escapeHtml(factor.detail)} · ${factor.basis === "bounded-heuristic" ? "bounded heuristic" : "repository evidence"}</small></div>`).join("");
}

function briefingArchitectureEntries() {
  return state.session.preferences?.briefingArchitecture === false ? [] : architectureEntries();
}

function briefingSequenceFlows() {
  return state.session.preferences?.briefingSequenceDiagrams === true ? (state.session.outline?.flows ?? []) : [];
}

function briefingCallFlows() {
  return state.session.preferences?.briefingCallFlows === true ? (state.session.outline?.callFlows ?? []) : [];
}

function briefingOrder() {
  const saved = state.session.preferences?.briefingOrder;
  return Array.isArray(saved) && saved.length === DEFAULT_BRIEFING_ORDER.length && new Set(saved).size === saved.length && saved.every((key) => DEFAULT_BRIEFING_ORDER.includes(key))
    ? [...saved]
    : [...DEFAULT_BRIEFING_ORDER];
}

function briefingOptionOrderFromDom() {
  const current = [...elements["briefing-options"].querySelectorAll("[data-briefing-option]")]
    .map((option) => option.dataset.briefingOption)
    .filter((key) => DEFAULT_BRIEFING_ORDER.includes(key));
  return [...current, ...DEFAULT_BRIEFING_ORDER.filter((key) => !current.includes(key))];
}

function renderBriefingOptionOrder(order = briefingOrder()) {
  const options = new Map([...elements["briefing-options"].querySelectorAll("[data-briefing-option]")].map((option) => [option.dataset.briefingOption, option]));
  order.forEach((key, index) => {
    const option = options.get(key);
    if (!option) return;
    elements["briefing-options"].appendChild(option);
    option.setAttribute("aria-posinset", String(index + 1));
    option.setAttribute("aria-setsize", String(order.length));
    option.setAttribute("aria-grabbed", String(briefingKeyboardDragKey === key));
  });
}

function renderTourBriefingOrder() {
  const sections = new Map([
    ["architecture", elements["tour-intro-architecture-section"]],
    ["sequence-diagrams", elements["tour-intro-sequence-section"]],
    ["call-flows", elements["tour-intro-call-flows-section"]],
    ["needs-attention", elements["tour-intro-attention"]],
    ["review-effort", elements["tour-intro-estimate"]],
  ]);
  const scroll = elements["tour-intro-dialog"].querySelector(".tour-intro-scroll");
  briefingOrder().forEach((key) => {
    const section = sections.get(key);
    if (section) scroll.appendChild(section);
  });
}

function renderTourIntro() {
  const outline = state.session.outline;
  const architectures = briefingArchitectureEntries();
  const flows = briefingSequenceFlows();
  const callFlows = briefingCallFlows();
  elements["tour-intro-title"].textContent = state.session.pullRequest?.title ?? outline?.title ?? `${state.session.comparison.repositoryName} review briefing`;
  elements["tour-intro-summary"].textContent = outline?.summary ?? "Grounded signals from this comparison are ready. Start the tour when you’re ready to explore the change.";
  renderTourAttention();
  elements["tour-intro-architecture-section"].classList.toggle("hidden", architectures.length === 0);
  elements["tour-intro-architecture"].innerHTML = `${architectureLegend()}${architectures.map(({ key, label, value }) => tourIntroArchitectureCard(value, label, key)).join("")}`;
  elements["tour-intro-sequence-section"].classList.toggle("hidden", flows.length === 0);
  elements["tour-intro-sequence"].innerHTML = flows.map(tourIntroSequenceCard).join("");
  elements["tour-intro-call-flows-section"].classList.toggle("hidden", callFlows.length === 0);
  elements["tour-intro-call-flows"].innerHTML = callFlows.map(tourIntroCallFlowCard).join("");
  renderTourBriefingOrder();
  elements["begin-tour"].textContent = state.tourStarted ? "Close" : "Start tour";
}

function renderTourIntroDiagrams() {
  const architectures = briefingArchitectureEntries();
  const flows = briefingSequenceFlows();
  if (architectures.length === 0 && flows.length === 0) return;
  const generation = ++state.flowRenderGeneration;
  void renderFlowDiagrams(architectures, flows, generation);
}

function maybeShowTourIntro() {
  if (!state.tourIntroPending || state.tourIntroShown || state.session.preferences?.showBriefing === false || elements["tour-intro-dialog"].open) return;
  renderTourIntro();
  renderTourIntroDiagrams();
  state.tourIntroShown = true;
  elements["tour-intro-dialog"].showModal();
  window.requestAnimationFrame(() => { elements["tour-intro-dialog"].querySelector(".tour-intro-scroll").scrollTop = 0; });
}

function reopenTourIntro() {
  if (state.session.preferences?.showBriefing === false) return;
  state.tourIntroReturn = false;
  state.tourIntroPending = false;
  state.tourIntroShown = true;
  renderReviewOverview();
  renderTourIntro();
  renderTourIntroDiagrams();
  elements["tour-intro-dialog"].showModal();
  window.requestAnimationFrame(() => { elements["tour-intro-dialog"].querySelector(".tour-intro-scroll").scrollTop = 0; });
}

function renderArchitecture() {
  const architectures = architectureEntries();
  if (state.tourIntroPending && !state.tourIntroShown) renderTourIntro();
  elements.architecture.classList.toggle("hidden", architectures.length === 0);
  elements["architecture-content"].innerHTML = `${architectureLegend()}${architectures.map(({ key, label, value }) => architectureCard(value, label, key)).join("")}`;
  const generation = ++state.flowRenderGeneration;
  void renderFlowDiagrams(architectures, [], generation);
}

function renderCallFlows() {
  const callFlows = state.session.outline?.callFlows ?? [];
  elements["regenerate-call-flows"].disabled = state.busy || !reviewIsOpen() || !state.session.outline;
  elements["call-flows-empty"].classList.toggle("hidden", callFlows.length > 0);
  elements["call-flows-empty"].textContent = state.session.outline ? "No changed call graph was identified for this comparison." : "Start the tour to trace changed calls from their entrypoints.";
  elements["call-flows"].innerHTML = callFlows.map((flow) => callFlowCardHtml(flow)).join("");
}

function renderSequenceDiagrams() {
  const flows = state.session.outline?.flows ?? [];
  const generation = ++state.flowRenderGeneration;
  elements["regenerate-flows"].disabled = state.busy || !reviewIsOpen() || !state.session.outline;
  elements["flows-empty"].classList.toggle("hidden", flows.length > 0);
  elements["flows-empty"].textContent = state.session.outline
    ? "No goal-critical, high-blast runtime flow was identified for this change."
    : "Start the tour to generate grounded sequence diagrams.";
  const cards = flows.map((flow, index) => {
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
  elements.flows.innerHTML = flows.length > 0 ? `${flowProvenanceLegend()}${cards}` : "";
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
    const introTarget = elements["tour-intro-architecture"].querySelector(`[data-tour-intro-architecture-diagram="${architecture.key}"]`);
    if (introTarget) {
      try {
        const introResult = await window.mermaid.render(`review-tour-intro-architecture-${architecture.key}-${generation}`, architecture.value.mermaid);
        if (generation !== state.flowRenderGeneration || !introTarget.isConnected) return;
        introTarget.innerHTML = introResult.svg;
        introTarget.querySelector("svg")?.setAttribute("aria-hidden", "true");
      } catch {
        introTarget.innerHTML = '<span class="muted">Diagram unavailable</span>';
        elements["tour-intro-architecture"].querySelector(`[data-tour-intro-architecture-error="${architecture.key}"]`)?.classList.remove("hidden");
      }
    }
  }
  for (let index = 0; index < flows.length; index += 1) {
    if (generation !== state.flowRenderGeneration) return;
    const card = elements.flows.querySelector(`[data-flow-id="${CSS.escape(flows[index].id)}"]`);
    const target = card?.querySelector(`[data-flow-index="${index}"]`);
    const introTarget = elements["tour-intro-sequence"].querySelector(`[data-tour-intro-flow-index="${index}"]`);
    if (target) {
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
    if (introTarget) {
      try {
        const introResult = await window.mermaid.render(`review-tour-intro-flow-${generation}-${index}`, flows[index].mermaid);
        if (generation !== state.flowRenderGeneration || !introTarget.isConnected) return;
        introTarget.innerHTML = introResult.svg;
        introTarget.querySelector("svg")?.setAttribute("aria-hidden", "true");
      } catch {
        introTarget.innerHTML = '<span class="muted">Diagram unavailable</span>';
      }
    }
  }
}

function renderActivities() {
  const activities = [...(state.session.activities ?? [])].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  elements["activity-empty"].classList.toggle("hidden", activities.length > 0);
  elements["activity-tab-count"].textContent = String(activities.length);
  elements["activity-tab-count"].classList.toggle("hidden", activities.length === 0);
  elements["activity-list"].innerHTML = activities.map((activity) => {
    const reviewerAuthored = activity.source === "reviewer";
    return `<article class="activity-card" data-activity-id="${escapeHtml(activity.id)}">
    <header>
      <div><span class="activity-status ${escapeHtml(activity.status)}">${activity.status === "verified" ? "verified" : "observed"}</span>${activity.changeStatus ? `<span class="change-status ${escapeHtml(activity.changeStatus)}">${escapeHtml(activity.changeStatus)}</span>` : ""}<h2>${escapeHtml(activity.request)}</h2></div>
      <time datetime="${escapeHtml(activity.updatedAt)}">${escapeHtml(new Date(activity.updatedAt).toLocaleString())}</time>
    </header>
    <div class="activity-agent">${reviewerAuthored ? "Reviewer · inline edit" : `${escapeHtml(activity.adapterId)} · ${escapeHtml(activity.modelId)}${activity.stepId ? ` · tour step ${escapeHtml(activity.stepId)}` : ""}`}</div>
    <div class="activity-files">${activity.files.map((file) => `<button type="button" class="activity-file"${activity.hasProposal ? ` data-activity-id="${escapeHtml(activity.id)}" data-activity-file="${escapeHtml(file.path)}"` : activity.changeStatus ? " disabled" : ` data-current-file="${escapeHtml(file.path)}"`}>
      <span><strong>${escapeHtml(file.path)}</strong><small>${escapeHtml(file.change)}</small></span>
      <span class="file-stats">${file.after ? `<span class="plus">+${file.after.additions}</span> <span class="minus">-${file.after.deletions}</span>` : "removed from diff"}</span>
    </button>`).join("")}</div>
    <section class="activity-verification"><div class="eyebrow">Verification</div>${activity.verification ? renderMarkdown(activity.verification) : `<p class="muted">${reviewerAuthored ? "No automated verification was run for this reviewer-authored suggestion." : activity.status === "verified" ? "No verification summary was supplied." : "Waiting for the agent's explicit refresh."}</p>`}</section>
    ${activity.changeStatus ? `<div class="activity-actions">
      ${activity.changeStatus === "pending" ? '<button type="button" class="button primary" data-activity-action="apply">Apply</button><button type="button" class="button secondary" data-activity-action="reject">Reject</button>' : ""}
      ${activity.changeStatus === "applied" ? '<button type="button" class="button secondary" data-activity-action="undo">Undo</button>' : ""}
      ${["rejected", "undone"].includes(activity.changeStatus) ? `<span class="muted">${activity.changeStatus === "rejected" ? "Proposal discarded" : "Applied change undone"}</span>` : ""}
    </div>` : ""}
  </article>`;
  }).join("");
}

function changedImageMedia() {
  const revision = state.session?.revision ?? 0;
  return (state.session?.comparison?.files ?? []).filter(isPngDiff).flatMap((file) => [
    file.oldPath ? { id: `diff:${revision}:${file.path}:old`, path: file.path, side: "old", name: `${file.path} · Before` } : null,
    file.newPath ? { id: `diff:${revision}:${file.path}:new`, path: file.path, side: "new", name: `${file.path} · After` } : null,
  ].filter(Boolean));
}

function availableTabs() {
  return ["diff", "call-flows", "sequence", "findings", "activity", "conversations", "screenshots", ...(state.session?.pullRequest ? ["pull-request"] : [])];
}

function renderActiveTab() {
  for (const tabName of ["diff", "call-flows", "sequence", "findings", "activity", "conversations", "screenshots", "pull-request"]) {
    const active = state.activeTab === tabName;
    elements[`${tabName}-view`].classList.toggle("hidden", !active);
    elements[`${tabName}-tab`].classList.toggle("active", active);
    elements[`${tabName}-tab`].setAttribute("aria-selected", String(active));
    elements[`${tabName}-tab`].tabIndex = active ? 0 : -1;
  }
  scheduleCurrentStepReturnUpdate();
}

async function renderScreenshots() {
  const screenshots = state.session?.screenshots ?? [];
  const changedImages = changedImageMedia();
  const mediaCount = screenshots.length + changedImages.length;
  elements["screenshots-tab-count"].textContent = String(mediaCount);
  elements["screenshots-tab-count"].classList.toggle("hidden", mediaCount === 0);
  if (mediaCount === 0) {
    elements.screenshots.innerHTML = '<p class="empty compact media-empty">No media is available for this review.</p>';
    return;
  }
  const visibleIds = new Set([...screenshots.map((shot) => shot.id), ...changedImages.map((image) => image.id)]);
  for (const [id, url] of state.screenshotUrls) {
    if (!visibleIds.has(id)) {
      URL.revokeObjectURL(url);
      state.screenshotUrls.delete(id);
    }
  }
  elements.screenshots.innerHTML = [
    ...screenshots.map((shot) => `<figure class="screenshot-card" data-screenshot-id="${escapeHtml(shot.id)}"><div class="screenshot-loading">Loading media…</div><figcaption><strong>${escapeHtml(shot.name)}</strong><span>${Math.max(1, Math.round(shot.size / 1024)).toLocaleString()} KiB</span></figcaption></figure>`),
    ...changedImages.map((image) => `<figure class="screenshot-card changed-image-media" data-changed-image-id="${escapeHtml(image.id)}"><div class="screenshot-loading">Loading changed image…</div><figcaption><strong>${escapeHtml(image.name)}</strong><span>Changed PNG</span></figcaption></figure>`),
  ].join("");
  await Promise.all([...screenshots.map(async (shot) => {
    try {
      let url = state.screenshotUrls.get(shot.id);
      if (!url) {
        url = URL.createObjectURL(await apiBlob(`/api/screenshots/${encodeURIComponent(shot.id)}`));
        state.screenshotUrls.set(shot.id, url);
      }
      const card = elements.screenshots.querySelector(`[data-screenshot-id="${CSS.escape(shot.id)}"]`);
      if (card) card.querySelector(".screenshot-loading").outerHTML = shot.mimeType === "video/mp4"
        ? `<video src="${escapeHtml(url)}" controls preload="metadata" aria-label="${escapeHtml(shot.name)}"></video>`
        : `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" title="Open full-size image"><img src="${escapeHtml(url)}" alt="${escapeHtml(shot.name)}" /></a>`;
    } catch (error) {
      const card = elements.screenshots.querySelector(`[data-screenshot-id="${CSS.escape(shot.id)}"]`);
      if (card) card.querySelector(".screenshot-loading").textContent = error.message;
    }
  }), ...changedImages.map(async (image) => {
    try {
      let url = state.screenshotUrls.get(image.id);
      if (!url) {
        url = URL.createObjectURL(await apiBlob(`/api/diff/image?${new URLSearchParams({ path: image.path, side: image.side })}`));
        state.screenshotUrls.set(image.id, url);
      }
      const card = elements.screenshots.querySelector(`[data-changed-image-id="${CSS.escape(image.id)}"]`);
      if (card) card.querySelector(".screenshot-loading").outerHTML = `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" title="Open full-size image"><img src="${escapeHtml(url)}" alt="${escapeHtml(image.name)}" /></a>`;
    } catch (error) {
      const card = elements.screenshots.querySelector(`[data-changed-image-id="${CSS.escape(image.id)}"]`);
      if (card) card.querySelector(".screenshot-loading").textContent = error.message;
    }
  })]);
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

let currentStepReturnFrame = null;

function updateCurrentStepReturnVisibility() {
  currentStepReturnFrame = null;
  const button = elements["current-step-return"];
  if (!state.session || !state.tourMode || state.activeTab !== "diff" || !currentStep()) {
    button.classList.add("hidden");
    return;
  }
  const panel = elements["diff-panel"];
  const target = elements.diff.querySelector(".tour-code-note.active")
    ?? elements.diff.querySelector(".diff-row.tour-anchor, .markdown-source-block.tour-anchor");
  const panelBounds = panel.getBoundingClientRect();
  button.style.right = `${Math.max(12, window.innerWidth - panelBounds.right + 14)}px`;
  button.style.bottom = `${Math.max(12, window.innerHeight - Math.min(window.innerHeight, panelBounds.bottom) + 14)}px`;
  button.setAttribute("aria-label", `Return to current tour step ${state.session.currentStepIndex + 1}`);
  if (!target) {
    button.classList.remove("hidden");
    return;
  }
  const targetBounds = target.getBoundingClientRect();
  const fileHeader = target.closest(".diff-file")?.querySelector(":scope > .diff-file-header");
  const headerBounds = fileHeader?.getBoundingClientRect();
  const visibleTop = headerBounds && headerBounds.top <= panelBounds.top + 1
    ? Math.max(0, panelBounds.top, headerBounds.bottom)
    : Math.max(0, panelBounds.top);
  const visibleBottom = Math.min(window.innerHeight, panelBounds.bottom);
  const visible = visibleBottom > visibleTop && targetBounds.bottom > visibleTop + 4 && targetBounds.top < visibleBottom - 4;
  button.classList.toggle("hidden", visible);
}

function scheduleCurrentStepReturnUpdate() {
  if (currentStepReturnFrame !== null) return;
  currentStepReturnFrame = window.requestAnimationFrame(updateCurrentStepReturnVisibility);
}

function renderTourAnnotation() {
  document.querySelectorAll(".tour-anchor, .tour-anchor-start, .tour-anchor-end").forEach((row) => row.classList.remove("tour-anchor", "tour-anchor-start", "tour-anchor-end"));
  document.querySelectorAll(".tour-code-note").forEach((note) => note.remove());
  scheduleCurrentStepReturnUpdate();
  if (!state.tourMode) return;
  const activeStep = currentStep();
  const phase = currentPhase();
  if (!activeStep || !phase) return;
  const activeStepIndex = phase.steps.findIndex((step) => step.id === activeStep.id);
  for (let index = phase.steps.length - 1; index >= 0; index -= 1) {
    const step = phase.steps[index];
    const { path, side, startLine, endLine } = step.anchor;
    const rows = [...document.querySelectorAll(`.diff-row[data-path="${CSS.escape(path)}"][data-side="${side}"]`)]
      .filter((row) => Number(row.dataset.line) >= startLine && Number(row.dataset.line) <= endLine);
    const markdownBlocks = [...document.querySelectorAll(`.markdown-source-block[data-markdown-path="${CSS.escape(path)}"][data-markdown-side="${side}"]`)]
      .filter((block) => Number(block.dataset.sourceEnd) >= startLine && Number(block.dataset.sourceStart) <= endLine);
    const anchors = rows.length > 0 ? rows : markdownBlocks;
    if (step.id === activeStep.id && anchors.length > 0) {
      anchors.forEach((anchor) => anchor.classList.add("tour-anchor"));
      anchors[0].classList.add("tour-anchor-start");
      anchors.at(-1).classList.add("tour-anchor-end");
    }
    const firstAnchor = anchors[0];
    if (!firstAnchor) continue;
    const isCurrent = step.id === activeStep.id;
    const isNext = index === activeStepIndex + 1;
    const note = document.createElement("aside");
    note.className = `tour-code-note${isCurrent ? " active" : isNext ? " next" : ""}`;
    note.setAttribute("aria-label", `${isCurrent ? "Current" : isNext ? "Next" : "Tour"} stop: ${step.title}`);
    note.innerHTML = `<span>${isCurrent ? "Current stop" : isNext ? "Next stop" : `Stop ${index + 1}`}</span><strong>${escapeHtml(compactText(step.title, 100))}</strong><p>${escapeHtml(compactText(step.objective, 180))}</p>`;
    (firstAnchor.closest(".split-row") ?? firstAnchor).insertAdjacentElement("beforebegin", note);
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
    ?? document.querySelector(`.markdown-source-block[data-markdown-path="${CSS.escape(step.anchor.path)}"][data-markdown-side="${step.anchor.side}"][data-source-start="${step.anchor.startLine}"]`)
    ?? document.querySelector(`.diff-file[data-path="${CSS.escape(step.anchor.path)}"]`);
  target?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function conversationThreads() {
  const threads = new Map();
  let legacyRoot = null;
  for (const message of state.session?.messages ?? []) {
    if (message.role === "user" && !message.threadId) legacyRoot = message.id;
    const id = message.threadId ?? legacyRoot ?? message.id;
    if (!threads.has(id)) threads.set(id, { id, root: message, messages: [] });
    threads.get(id).messages.push(message);
  }
  for (const pending of state.pendingQuestions.values()) {
    if (!threads.has(pending.threadId)) threads.set(pending.threadId, { id: pending.threadId, root: pending, messages: [] });
    if (!threads.get(pending.threadId).messages.some((message) => message.id === pending.id)) threads.get(pending.threadId).messages.push(pending);
  }
  return [...threads.values()];
}

function renderQuestionLayout() {
  const panel = elements["questions-pane"].closest(".agent-panel");
  const guided = Boolean(state.tourMode && state.session.outline);
  const open = state.questionsOpen || !guided;
  panel.classList.toggle("questions-open", open);
  panel.classList.toggle("questions-only", Boolean(state.session.outline && !guided));
  panel.dataset.mobilePane = guided ? state.mobileAgentPane : "questions";
  panel.style.setProperty("--questions-share", String(state.questionPanePercent));
  panel.style.setProperty("--tour-share", String(100 - state.questionPanePercent));
  elements["questions-body"].classList.toggle("hidden", !open);
  elements["questions-toggle"].setAttribute("aria-expanded", String(open));
  elements["questions-toggle"].disabled = !guided;
  elements["questions-toggle"].textContent = `Questions (${conversationThreads().length})`;
  elements["questions-resizer"].classList.toggle("hidden", !guided || !open);
  elements["show-tour-pane"].disabled = !guided;
  elements["show-tour-pane"].setAttribute("aria-pressed", String(guided && state.mobileAgentPane === "tour"));
  elements["show-questions-pane"].setAttribute("aria-pressed", String(!guided || state.mobileAgentPane === "questions"));
}

function openConversation(id = null) {
  state.questionDrafts.set(state.activeThreadId, { body: elements["chat-input"].value, line: state.selectedLine, contextPaths: [...state.questionContextPaths] });
  state.activeThreadId = id;
  const draft = state.questionDrafts.get(id);
  elements["chat-input"].value = draft?.body ?? "";
  state.selectedLine = id ? null : draft?.line ?? null;
  state.questionContextPaths = new Set(id ? [] : draft?.contextPaths ?? []);
  elements["chat-input"].placeholder = id ? "Follow up on this conversation…" : "Ask about this review or selected code…";
  state.questionsOpen = true;
  state.mobileAgentPane = "questions";
  renderMessages();
  renderAgentActivity();
}

function reviewAnchorLabel(anchor) {
  if (anchor.scope === "stop") return `Tour stop: ${anchor.stepTitle ?? anchor.stepId ?? "current stop"}`;
  const endLine = anchor.endLine ?? anchor.line;
  return /^\[PNG image · (old|new)\]$/.test(anchor.content)
    ? `${anchor.path} · ${anchor.side} image`
    : `${anchor.path}:${anchor.line}${endLine !== anchor.line ? `-${endLine}` : ""} (${anchor.side})`;
}

function discussionStop(stepId) {
  if (!stepId) return undefined;
  const phaseIndex = state.session.outline?.phases.findIndex((phase) => phase.steps.some((step) => step.id === stepId)) ?? -1;
  const phase = phaseIndex >= 0 ? state.session.outline?.phases[phaseIndex] : undefined;
  const stopIndex = phase?.steps.findIndex((step) => step.id === stepId) ?? -1;
  const step = stopIndex >= 0 ? phase?.steps[stopIndex] : undefined;
  return step && phase ? { step, phase, phaseIndex, stopIndex } : undefined;
}

function discussionStopLabel(scope) {
  return scope.step ? `Phase ${scope.phaseIndex + 1} · ${scope.phase.title} — Stop ${scope.stopIndex + 1} · ${scope.step.title}` : "";
}

function conversationScope(thread = null) {
  const root = thread?.root;
  const stop = root ? discussionStop(root.stepId) : state.tourMode ? discussionStop(currentStep()?.id) : undefined;
  const anchor = root?.anchor ?? (!thread ? state.selectedLine : undefined);
  return { ...stop, anchor, original: Boolean(root) };
}

function conversationScopeLabel(thread = null) {
  const scope = conversationScope(thread);
  const stop = scope.step ? `${scope.original ? "Original" : "Current"} tour stop: ${discussionStopLabel(scope)}` : "Review-wide question";
  return scope.anchor ? `${stop} · selected ${reviewAnchorLabel(scope.anchor)}` : stop;
}

function conversationScopeMarkup(thread = null) {
  const scope = conversationScope(thread);
  const heading = scope.step ? `${scope.original ? "Original" : "Current"} tour stop` : "Review-wide question";
  const stop = scope.step ? escapeHtml(discussionStopLabel(scope)) : "No tour stop is attached.";
  const selection = scope.anchor
    ? `Selected code: ${escapeHtml(reviewAnchorLabel(scope.anchor))}. Exact quotation and diff context are retained.`
    : scope.step ? "No code selection. This question is scoped to this stop." : "No code selection.";
  return `<span class="conversation-scope"><strong>${escapeHtml(heading)}</strong><span>${stop}</span></span><span class="conversation-scope-detail">${selection}</span>`;
}

function anchorRowsMatch(anchor) {
  const endLine = anchor.endLine ?? anchor.line;
  if (/^\[PNG image · (old|new)\]$/.test(anchor.content)) {
    const image = elements.diff.querySelector(`.image-diff-side[data-path="${CSS.escape(anchor.path)}"][data-side="${anchor.side}"]`);
    return image?.dataset.content === anchor.content;
  }
  const rows = Array.from({ length: endLine - anchor.line + 1 }, (_, offset) => elements.diff.querySelector(
    `.diff-row[data-path="${CSS.escape(anchor.path)}"][data-side="${anchor.side}"][data-line="${anchor.line + offset}"]`,
  ));
  return rows.every(Boolean) && rows[0]?.dataset.content === anchor.content &&
    (anchor.context === undefined || rows.map((row) => row.dataset.content).join("\n") === anchor.context);
}

function renderConversationBadges() {
  elements.diff.querySelectorAll(".conversation-badge").forEach((badge) => badge.remove());
  if (state.proposalPreview) return;
  for (const thread of conversationThreads()) {
    const anchor = thread.root.anchor;
    if (!anchor) continue;
    if (!anchorRowsMatch(anchor)) continue;
    const row = elements.diff.querySelector(`.diff-row[data-path="${CSS.escape(anchor.path)}"][data-side="${anchor.side}"][data-line="${anchor.line}"]`)
      ?? elements.diff.querySelector(`.image-diff-side[data-path="${CSS.escape(anchor.path)}"][data-side="${anchor.side}"]`);
    if (!row) continue;
    const badge = document.createElement("button");
    badge.type = "button";
    badge.className = "conversation-badge";
    badge.dataset.conversation = thread.id;
    const scope = conversationScopeLabel(thread);
    badge.title = `${compactText(thread.root.body, 120)}\n${scope}`;
    badge.setAttribute("aria-label", `Open selected-code conversation, ${scope}: ${compactText(thread.root.body, 80)}`);
    badge.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 3h14v10H8l-5 4V3Z" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
    (row.querySelector(".finding-markers") ?? row.querySelector(".image-review-actions"))?.append(badge);
  }
}

function renderStepDiscussion() {
  const step = currentStep();
  const comments = step ? state.session.comments.filter((comment) => comment.scope === "stop" && comment.stepId === step.id) : [];
  elements["step-discussion"].classList.toggle("hidden", !step);
  if (!step) return;
  elements["step-discussion-scope"].textContent = `Comments are attached to “${step.title}” and stay with this stop if the diff moves.`;
  elements["comment-stop"].disabled = !reviewIsOpen() || state.busy;
  elements["step-comment-list"].innerHTML = comments.length
    ? comments.map((comment) => `<article class="step-comment" data-comment-id="${escapeHtml(comment.id)}"><span class="comment-status">${escapeHtml(comment.status)}</span><p>${renderInlineMarkdown(comment.body)}</p><div class="comment-actions"><button class="text-button" data-step-comment-action="edit" type="button">Edit</button><button class="text-button danger" data-step-comment-action="delete" type="button">Delete</button></div></article>`).join("")
    : '<p class="comment-empty">No comments on this stop yet.</p>';
}

function renderQuestionScope(thread = conversationThreads().find((item) => item.id === state.activeThreadId)) {
  elements["question-scope"].innerHTML = conversationScopeMarkup(thread);
}

function renderMessages() {
  const threads = conversationThreads();
  const thread = threads.find((item) => item.id === state.activeThreadId);
  const messages = thread?.messages ?? [];
  const content = messages
    .map((message) => `<div class="chat-message ${message.role}" data-message-id="${escapeHtml(message.id)}">${renderMarkdown(message.body)}${state.pendingQuestions.has(message.id) ? '<span class="chat-message-status">Queued</span>' : ""}</div>`)
    .join("");
  if (elements["chat-messages"].innerHTML !== content) elements["chat-messages"].innerHTML = content;
  renderQuestionScope(thread);
  const options = '<option value="">New question</option>' + threads.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(compactText(item.root.body, 80))}</option>`).join("");
  if (elements["conversation-select"].innerHTML !== options) elements["conversation-select"].innerHTML = options;
  elements["conversation-select"].value = state.activeThreadId ?? "";
  elements["conversation-list"].innerHTML = threads.length ? threads.map((item) => `<article class="conversation-card"><button type="button" class="conversation-title" data-conversation="${escapeHtml(item.id)}">${escapeHtml(compactText(item.root.body, 180))}</button><p class="muted">${escapeHtml(conversationScopeLabel(item))} · ${item.messages.length} messages${item.messages.some((message) => state.pendingQuestions.has(message.id)) ? " · queued" : ""}</p>${item.root.anchor ? `<button type="button" class="text-button" data-conversation-code="${escapeHtml(item.id)}">Show context</button>` : ""}</article>`).join("") : '<p class="empty">No conversations yet. Ask a question from a changed line, image, or the Questions pane.</p>';
  const starting = !thread;
  elements["selection-pill"].classList.toggle("hidden", !starting || !state.selectedLine);
  elements["selection-pill"].innerHTML = starting && state.selectedLine
    ? `<span>${escapeHtml(`${reviewAnchorLabel(state.selectedLine)} selected`)}</span><button type="button" data-remove-line-context aria-label="Remove selected context from question">×</button>`
    : "";
  elements["question-file-context"].innerHTML = starting ? [...state.questionContextPaths].map((path) => `<span class="question-context-chip"><span>${escapeHtml(path)}</span><button type="button" data-remove-question-file="${escapeHtml(path)}" aria-label="Remove ${escapeHtml(path)} from question context">×</button></span>`).join("") : "";
  elements["add-question-files"].classList.toggle("hidden", !starting);
  renderQuestionLayout();
  renderConversationBadges();
}

function revealAgentAnswer(questionId) {
  const scroll = elements["questions-scroll"];
  const question = elements["chat-messages"].querySelector(`[data-message-id="${CSS.escape(questionId)}"]`);
  const answer = question?.nextElementSibling;
  if (!question || !answer?.classList.contains("agent")) return;
  const scrollRect = scroll.getBoundingClientRect();
  const questionTop = scroll.scrollTop + question.getBoundingClientRect().top - scrollRect.top - 14;
  const answerBottom = scroll.scrollTop + answer.getBoundingClientRect().bottom - scrollRect.top + 14;
  const revealBottom = answerBottom - scroll.clientHeight;
  const target = Math.max(scroll.scrollTop, Math.min(questionTop, revealBottom));
  if (target > scroll.scrollTop) scroll.scrollTo({ top: target, behavior: "smooth" });
}

function renderTour() {
  const { outline, currentStepIndex } = state.session;
  renderReviewOverview();
  const active = Boolean(outline);
  const planning = state.session.tourState === "planning";
  elements["tour-empty"].classList.toggle("hidden", active);
  elements["tour-active"].classList.toggle("hidden", !active);
  renderMessages();
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
  elements["step-count"].textContent = `Phase ${phaseIndex + 1} of ${outline.phases.length}: Stop ${stopInPhase + 1} of ${phase.steps.length} (Step ${currentStepIndex + 1})`;
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
  renderStepDiscussion();
  renderAgentActivity();
  const planningNotes = outline.planningNotes ?? [];
  elements["planning-notes"].classList.toggle("hidden", planningNotes.length === 0);
  elements["planning-note-list"].innerHTML = planningNotes.map((note) => `<li>${escapeHtml(note)}</li>`).join("");
  elements["previous-step"].disabled = (state.busy && state.navigationDirection !== "next") || !reviewIsOpen() || !state.tourMode || currentStepIndex === 0;
  elements["next-step"].disabled = state.busy || !reviewIsOpen() || !state.tourMode;
  elements["next-step"].textContent = currentStepIndex === steps.length - 1 ? "Finish tour" : "Next";
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
  if (large) void ensureReviewDiffs();
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

function nextRenderedPath(path) {
  const index = state.renderedDiffFiles.findIndex((file) => file.path === path);
  if (index < 0) return null;
  return state.renderedDiffFiles[index + 1]?.path ?? null;
}

function captureNextFileAnchor(path) {
  if (!path) return null;
  const panel = elements["diff-panel"];
  const file = elements.diff.querySelector(`.diff-file[data-path="${CSS.escape(path)}"]`);
  const header = file?.querySelector(":scope > .diff-file-header");
  if (!file || !header) return null;
  const panelBounds = panel.getBoundingClientRect();
  const toolbarBounds = document.querySelector(".diff-toolbar")?.getBoundingClientRect();
  const visibleTop = Math.max(panelBounds.top, toolbarBounds?.bottom ?? panelBounds.top);
  const visibleBottom = Math.min(panelBounds.bottom, window.innerHeight);
  const fileBounds = file.getBoundingClientRect();
  const headerBounds = header.getBoundingClientRect();
  const naturalHeaderBottom = fileBounds.top + headerBounds.height;
  const wasVisible = naturalHeaderBottom > visibleTop && fileBounds.top < visibleBottom;
  return { path, visibleTop, wasVisible };
}

function recoverVisibleFileHeader(anchor, expectedScrollTop) {
  if (!anchor) return;
  const panel = elements["diff-panel"];
  if (expectedScrollTop !== undefined && panel.scrollTop !== expectedScrollTop) return;
  const file = elements.diff.querySelector(`.diff-file[data-path="${CSS.escape(anchor.path)}"]`);
  if (!file) return;
  const fileBounds = file.getBoundingClientRect();
  if (anchor.wasVisible && fileBounds.top >= anchor.visibleTop) return;
  panel.scrollTop += fileBounds.top - anchor.visibleTop;
}

function recoverVisibleFileHeaderAfterLayout(anchor) {
  if (!anchor) return;
  const panel = elements["diff-panel"];
  const expectedScrollTop = panel.scrollTop;
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => recoverVisibleFileHeader(anchor, expectedScrollTop)));
}

async function setReviewed(path, reviewed) {
  if (!reviewIsOpen() || state.busy) return;
  const nextPath = reviewed ? nextRenderedPath(path) : null;
  try {
    const previousRevision = state.session.revision;
    state.session = await api("/api/files/reviewed", {
      method: "POST",
      body: JSON.stringify({ path, reviewed }),
    });
    if (state.diffCacheRevision === previousRevision) state.diffCacheRevision = state.session.revision;
    // Capture after the request so scrolling while it is pending is respected.
    // Sticky headers conceal whether a collapse moved the next file's actual
    // beginning above the viewport, so recovery tracks the file section.
    const nextFileAnchor = captureNextFileAnchor(nextPath);
    if (reviewed) state.collapsedFiles.add(path);
    else state.collapsedFiles.delete(path);
    renderSession();
    recoverVisibleFileHeaderAfterLayout(nextFileAnchor);
    toast(reviewed ? "File marked reviewed" : "File marked unreviewed");
  } catch (error) {
    toast(error.message);
  }
}

function isInPlaceSessionUpdate(previous, latest) {
  if (!previous) return false;
  // Explanations and comments can be updated without replacing the diff.
  // Only skip the full render when everything else is unchanged, including
  // the route, selected stop, diff, and review lifecycle.
  const structuralSnapshot = ({ revision, agentActivity, comments, messages, outline, ...session }) => ({
    ...session,
    outline: outline ? {
      ...outline,
      phases: outline.phases.map((phase) => ({
        ...phase,
        steps: phase.steps.map(({ explanation, ...step }) => step),
      })),
    } : outline,
  });
  return JSON.stringify(structuralSnapshot(previous)) === JSON.stringify(structuralSnapshot(latest));
}

function isSamePhaseNavigationUpdate(previous, latest) {
  if (!previous?.outline || !latest?.outline || previous.currentStepIndex === latest.currentStepIndex) return false;
  const previousSteps = previous.outline.phases.flatMap((phase) => phase.steps);
  const latestSteps = latest.outline.phases.flatMap((phase) => phase.steps);
  const previousStep = previousSteps[previous.currentStepIndex];
  const latestStep = latestSteps[latest.currentStepIndex];
  const previousPhase = previous.outline.phases.find((phase) => phase.steps.some((step) => step.id === previousStep?.id));
  const latestPhase = latest.outline.phases.find((phase) => phase.steps.some((step) => step.id === latestStep?.id));
  if (!previousPhase || previousPhase.id !== latestPhase?.id) return false;
  const navigationSnapshot = ({ revision, agentActivity, currentStepIndex, outline, ...session }) => ({
    ...session,
    outline: outline ? {
      ...outline,
      phases: outline.phases.map((phase) => ({
        ...phase,
        steps: phase.steps.map(({ explanation, ...step }) => step),
      })),
    } : outline,
  });
  return JSON.stringify(navigationSnapshot(previous)) === JSON.stringify(navigationSnapshot(latest));
}

function renderInPlaceSessionUpdate(previous, { closeCommentEditor = false } = {}) {
  // Keep loaded/expanded diffs valid across this metadata-only revision.
  if (state.diffCacheRevision === previous.revision) state.diffCacheRevision = state.session.revision;
  const panel = elements["diff-panel"];
  const scroll = elements["tour-scroll"];
  const scrollTop = scroll.scrollTop;
  const diffScrollTop = panel.scrollTop;
  const commentsChanged = JSON.stringify(previous.comments) !== JSON.stringify(state.session.comments);
  // Retain a visible code line when comments above it change height. Capture
  // now, after the request, so scrolling while a save is pending is respected.
  const panelTop = panel.getBoundingClientRect().top;
  const anchor = commentsChanged || closeCommentEditor
    ? [...elements.diff.querySelectorAll(".diff-row")].find((row) => row.getBoundingClientRect().bottom > panelTop)
    : null;
  const anchorTop = anchor?.getBoundingClientRect().top;
  const oldStep = previous.outline?.phases.flatMap((phase) => phase.steps)[previous.currentStepIndex];
  const step = currentStep();
  if (step?.explanation !== oldStep?.explanation) {
    elements["step-explanation"].innerHTML = renderMarkdown(step.explanation || "Waiting for the agent…");
  }
  if (commentsChanged) renderComments();
  if (JSON.stringify(previous.messages) !== JSON.stringify(state.session.messages)) renderMessages();
  if (closeCommentEditor) closeInlineCommentEditor();
  elements["feedback-button"].classList.remove("hidden");
  renderAgentActivity();
  scroll.scrollTop = scrollTop;
  if (commentsChanged || closeCommentEditor) {
    panel.scrollTop = diffScrollTop;
    if (anchor) panel.scrollTop += anchor.getBoundingClientRect().top - anchorTop;
  }
}

function renderSessionUpdate(previous, options) {
  if (isInPlaceSessionUpdate(previous, state.session)) {
    renderInPlaceSessionUpdate(previous, options);
    return false;
  }
  if (isSamePhaseNavigationUpdate(previous, state.session)) {
    if (state.diffCacheRevision === previous.revision) state.diffCacheRevision = state.session.revision;
    renderFindings();
    renderTour();
    return true;
  }
  renderSession();
  return false;
}

function renderSession() {
  const { comparison, comments } = state.session;
  const briefingWasOpen = elements["tour-intro-dialog"].open;
  const briefingScroll = briefingWasOpen ? elements["tour-intro-dialog"].querySelector(".tour-intro-scroll").scrollTop : 0;
  if (state.tourMode === null && state.session.outline) state.tourMode = true;
  initializeUiPreferences();
  state.proposalPreview = false;
  state.proposalActivityId = null;
  const repositoryName = state.session.pullRequest?.repository ?? comparison.repositoryName;
  const branchName = state.session.pullRequest?.headRefName ?? comparison.branch ?? `detached@${comparison.head.slice(0, 8)}`;
  const repositoryIdentity = `${repositoryName} · ${branchName}`;
  elements["repository-label"].textContent = repositoryIdentity;
  elements["repository-label"].title = repositoryIdentity;
  elements["comparison-label"].textContent = state.session.comparisonView === "since-last-review"
    ? `${comparison.base} → since last review`
    : `${comparison.base} → working tree`;
  elements["comparison-view"].value = state.session.comparisonView ?? "full";
  elements["comparison-view"].disabled = !state.session.checkpoints?.length || Boolean(state.tourMode);
  elements["revision-summary"].textContent = state.session.revisionSummary?.text ?? "";
  elements["checkpoint-history"].innerHTML = (state.session.checkpoints ?? []).slice().reverse().map((checkpoint, index) => {
    const title = checkpoint.label ?? (checkpoint.kind === "decision" ? (checkpoint.decision ?? checkpoint.outcome ?? "Decision") : "Manual checkpoint");
    const confirmingDelete = state.deletingCheckpointId === checkpoint.id;
    const actions = confirmingDelete
      ? `<span class="checkpoint-delete-confirmation">Delete this checkpoint?</span><button type="button" data-checkpoint-action="cancel-delete" data-checkpoint-id="${escapeHtml(checkpoint.id)}">Cancel</button><button type="button" class="danger confirm" data-checkpoint-action="confirm-delete" data-checkpoint-id="${escapeHtml(checkpoint.id)}">Delete</button>`
      : `<button type="button" class="danger" data-checkpoint-action="delete" data-checkpoint-id="${escapeHtml(checkpoint.id)}" aria-label="Delete ${escapeHtml(title)}">Delete</button>`;
    return `<li><span class="checkpoint-history-entry"><strong>${escapeHtml(title)}</strong> · ${escapeHtml(new Date(checkpoint.createdAt).toLocaleString())}${index === 0 ? " · latest" : ""}</span><span class="checkpoint-history-actions">${actions}</span></li>`;
  }).join("");
  elements["revision-history"].classList.toggle("hidden", !(state.session.checkpoints ?? []).length);
  elements["checkpoint-button"].classList.toggle("hidden", Boolean(state.session.pullRequest));
  elements["diff-search"].value = state.searchQuery;
  elements["status-filter"].value = state.statusFilter;
  elements["review-filter"].value = state.reviewFilter;
  elements["review-filter"].querySelector('option[value="tour"]').disabled = !state.session.outline;
  elements["test-files-filter"].setAttribute("aria-pressed", String(state.testFilesOnly));
  elements["test-files-filter"].classList.toggle("active", state.testFilesOnly);
  elements["tree-mode"].value = state.treeMode;
  elements["prefetch-steps"].value = String(state.session.preferences?.prefetchSteps ?? 5);
  renderBriefingOptionOrder();
  elements["show-tour-briefing"].checked = state.session.preferences?.showBriefing !== false;
  elements["briefing-architecture"].checked = state.session.preferences?.briefingArchitecture !== false;
  elements["briefing-sequence-diagrams"].checked = state.session.preferences?.briefingSequenceDiagrams === true;
  elements["briefing-call-flows"].checked = state.session.preferences?.briefingCallFlows === true;
  elements["briefing-needs-attention"].checked = state.session.preferences?.briefingNeedsAttention !== false;
  elements["briefing-review-effort"].checked = state.session.preferences?.briefingReviewEffort !== false;
  syncBriefingPreferenceControls();
  elements["diff-search"].disabled = Boolean(state.tourMode);
  elements["status-filter"].disabled = Boolean(state.tourMode);
  elements["review-filter"].disabled = Boolean(state.tourMode);
  elements["test-files-filter"].disabled = Boolean(state.tourMode);
  elements["tree-mode"].disabled = Boolean(state.tourMode);
  const tourFilterMessage = "The tour controls this file list. Exit the tour to use filters.";
  elements["tour-filter-note"].classList.toggle("hidden", !state.tourMode);
  elements["file-panel"].title = state.tourMode ? tourFilterMessage : "";
  elements["diff-search"].title = state.tourMode ? tourFilterMessage : "";
  elements["status-filter"].title = state.tourMode ? tourFilterMessage : "";
  elements["review-filter"].title = state.tourMode ? tourFilterMessage : "";
  elements["test-files-filter"].title = state.tourMode ? "Exit the tour to filter test files." : "Show only changed test files";
  renderFileTree();
  const large = comparison.diffMode === "file";
  if (state.diffCacheRevision !== state.session.revision) {
    state.diffCache.clear();
    state.diffCacheRevision = state.session.revision;
    if (state.searchQuery) void refreshDiffSearch();
  }
  renderDiff(visibleDiffFiles());
  if (state.tourMode && large) void ensureTourPhaseDiffs();
  if (!state.tourMode && large) void ensureReviewDiffs();
  renderComments();
  renderFindings();
  renderReviewOverview();
  renderArchitecture();
  if (state.activeTab === "call-flows") renderCallFlows();
  if (state.activeTab === "sequence") renderSequenceDiagrams();
  renderActivities();
  renderPullRequest();
  if (briefingWasOpen) {
    renderTourIntro();
    renderTourIntroDiagrams();
    elements["tour-intro-dialog"].querySelector(".tour-intro-scroll").scrollTop = briefingScroll;
  }
  void renderScreenshots();
  renderActiveTab();
  elements["feedback-button"].classList.remove("hidden");
  const closed = !reviewIsOpen();
  renderClosedBanner();
  elements["refresh-button"].disabled = state.busy || (closed && !state.session.pullRequest);
  elements["refresh-button"].textContent = closed && state.session.pullRequest ? "Review new head" : "Refresh";
  elements["checkpoint-button"].disabled = state.busy || closed || Boolean(state.session.pullRequest);
  elements["close-button"].disabled = state.busy || closed;
  const cancelOnly = state.session.preferences?.closeOutcome === "cancelled";
  elements["close-button"].textContent = cancelOnly ? "Close review" : "Approve";
  elements["close-review-button"].classList.toggle("hidden", cancelOnly);
  elements["close-review-button"].disabled = state.busy || closed;
  elements["approve-comments-button"].classList.toggle("hidden", cancelOnly);
  elements["feedback-button"].classList.toggle("hidden", cancelOnly);
  elements["approve-comments-button"].disabled = state.busy || closed;
  elements["feedback-button"].disabled = state.busy || closed;
  elements["prefetch-steps"].disabled = closed;
  elements["start-tour"].disabled = state.busy || closed || (state.session.agentAdapters ?? []).length === 0;
  elements["chat-input"].disabled = closed;
  elements["chat-form"].querySelector("button").disabled = state.busy || closed;
  elements["comment-drawer"].classList.toggle("closed", closed);
  if (closed) closeInlineCommentEditor();
  elements["agent-mode"].textContent = state.session.agentSelection?.adapterId === "attached" ? "edits on request" : "read-only";
  renderAgentOptions();
  renderTour();
  maybeShowTourIntro();
  if (state.session.outline && state.focusedStepId === null && !state.tourIntroPending) void focusCurrentStep();
}

async function beginPreparedTour() {
  if (state.tourStarted) {
    state.tourIntroPending = false;
    state.tourIntroReturn = false;
    elements["tour-intro-dialog"].close();
    renderReviewOverview();
    return;
  }
  if (!state.session.outline) {
    elements["tour-intro-dialog"].close();
    void startTour();
    return;
  }
  state.tourIntroPending = false;
  state.tourIntroReturn = false;
  state.tourStarted = true;
  state.tourMode = true;
  elements["tour-intro-dialog"].close();
  renderReviewOverview();
  await focusCurrentStep();
}

async function startTour() {
  if (!reviewIsOpen()) return;
  state.tourIntroReturn = false;
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
    state.tourStarted = true;
    state.focusedStepId = state.tourIntroPending ? null : currentStep()?.id ?? null;
    renderSession();
    elements["tour-scroll"].scrollTop = 0;
    if (!state.tourIntroPending) await focusCurrentStep();
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
  let shouldFocus = false;
  try {
    const session = await api("/api/tour/navigate", { method: "POST", body: JSON.stringify({ direction }) });
    if (generation !== state.navigationGeneration) return;
    const previous = state.session;
    state.session = session;
    renderSessionUpdate(previous);
    await ensureTourPhaseDiffs();
    if (generation !== state.navigationGeneration) return;
    shouldFocus = true;
  } catch (error) {
    if (generation === state.navigationGeneration) toast(error.message);
  } finally {
    if (generation !== state.navigationGeneration) return;
    state.navigationDirection = null;
    setBusy(false);
    renderTour();
  }
  if (shouldFocus && generation === state.navigationGeneration) await focusCurrentStep();
}

async function toggleTourMode() {
  if (!state.session.outline || state.busy) return;
  state.tourMode = !state.tourMode;
  state.fileRequestId += 1;
  state.phaseDiffLoadKey = null;
  state.phaseDiffLoadPromise = null;
  state.reviewDiffLoadGeneration += 1;
  state.reviewDiffLoadKey = null;
  state.reviewDiffLoadPromise = null;
  state.visibleFile = null;
  state.activeTab = "diff";
  renderSession();
  elements["diff-panel"].scrollTop = 0;
  if (state.tourMode) {
    await ensureTourPhaseDiffs();
    await focusCurrentStep();
    toast("Tour resumed. Diffs are scoped to this phase.");
  } else {
    await ensureReviewDiffs();
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

function missingExportStepCount() {
  return state.session?.outline?.phases.flatMap((phase) => phase.steps).filter((step) => !step.explanation).length ?? 0;
}

function openHtmlExportDialog() {
  const missing = missingExportStepCount();
  elements["export-prepare-steps"].checked = false;
  elements["html-export-description"].textContent = missing === 0
    ? "Every tour step is already prepared. Choose which supporting analysis to include."
    : `${missing} ${missing === 1 ? "step explanation is" : "step explanations are"} not prepared yet. Export the current tour as-is, or prepare them before downloading.`;
  elements["export-prepare-steps"].closest("label").classList.toggle("hidden", missing === 0);
  elements["settings-menu"].open = false;
  elements["html-export-dialog"].showModal();
}

async function downloadExport(format, options = {}) {
  if (!state.apiToken || state.busy) return;
  const buttons = elements["export-menu"].querySelectorAll("button");
  buttons.forEach((button) => { button.disabled = true; });
  const preparingSteps = format === "html" && options.prepareMissingSteps && missingExportStepCount() > 0;
  if (preparingSteps) setBusy(true, "Preparing missing tour stops for the static export…");
  try {
    const response = await fetch(`/api/export?format=${encodeURIComponent(format)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Review-Tour-Token": state.apiToken },
      body: JSON.stringify(options),
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
    if (preparingSteps) {
      setBusy(false);
      try {
        state.session = await api("/api/session");
        renderSession();
      } catch { /* The export already succeeded; normal polling will reconnect. */ }
    }
    buttons.forEach((button) => { button.disabled = state.busy; });
    elements["export-menu"].open = false;
  }
}

function selectLine(row, discussion = null) {
  document.querySelectorAll(".diff-row.selected, .image-diff-side.selected").forEach((item) => item.classList.remove("selected"));
  row.classList.add("selected");
  row.querySelectorAll(".image-review-actions button:not(:disabled)").forEach((button) => { button.tabIndex = 0; });
  state.selectedLine = {
    path: row.dataset.path,
    side: row.dataset.side,
    line: Number(row.dataset.line),
    content: row.dataset.content,
    ...(discussion?.endLine && discussion.endLine !== Number(row.dataset.line) ? { endLine: discussion.endLine } : {}),
    ...(discussion?.selectedText ? { selectedText: discussion.selectedText } : {}),
    ...(discussion?.context ? { context: discussion.context } : {}),
  };
  const image = row.classList.contains("image-diff-side");
  elements["selection-pill"].textContent = image
    ? `${state.selectedLine.path} (${state.selectedLine.side} image) selected · comment or ask the agent`
    : `${state.selectedLine.path}:${state.selectedLine.line} selected · comment or ask the agent`;
  elements["selection-pill"].classList.remove("hidden");
  renderQuestionScope();
}

function clearSelectedLine() {
  document.querySelectorAll(".diff-row.selected, .image-diff-side.selected").forEach((item) => item.classList.remove("selected"));
  state.selectedLine = null;
  renderQuestionScope();
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
  openInlineCommentEditor(row, target, existing);
}

function askAboutLine(row) {
  openInlineCommentEditor(row, lineTarget(row), null, { mode: "ask" });
}

function closeInlineEdit() {
  elements.diff.querySelectorAll(".inline-edit-lane, .inline-edit-form").forEach((editor) => editor.remove());
}

function revealInlineForm(form) {
  if (narrowFilePanelLayout()) form.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function openInlineEdit(row, selection = null) {
  if (!reviewIsOpen() || row.dataset.side !== "new") return;
  closeInlineEdit();
  selectLine(row);
  const target = lineTarget(row);
  const startLine = selection?.startLine ?? target.line;
  const endLine = selection?.endLine ?? target.line;
  const expectedContent = selection?.expectedContent ?? target.content;
  const form = document.createElement("form");
  form.className = "inline-edit-form";
  form.dataset.editPath = target.path;
  form.dataset.editLine = String(startLine);
  form.dataset.editEndLine = String(endLine);
  form.dataset.editExpected = expectedContent;
  const location = startLine === endLine ? `${target.path}:${startLine}` : `${target.path}:${startLine}-${endLine}`;
  form.innerHTML = `<header><div><span class="eyebrow">Reviewer suggestion</span><strong>${escapeHtml(location)}</strong></div><button class="text-button" type="button" data-inline-edit-cancel>Cancel</button></header>
    <div class="inline-edit-editor"><pre class="inline-edit-highlight" aria-hidden="true"><code>${escapeHtml(expectedContent)}</code></pre><textarea name="replacement" aria-label="Replacement code" spellcheck="false">${escapeHtml(expectedContent)}</textarea></div>
    <footer><span>The repository stays untouched until you apply this suggestion.</span><button class="button primary" type="submit">Propose edit</button></footer>`;
  const splitRow = row.closest(".split-row");
  if (splitRow) {
    const lane = document.createElement("div");
    lane.className = "inline-edit-lane";
    lane.append(form);
    splitRow.insertAdjacentElement("afterend", lane);
  } else {
    row.insertAdjacentElement("afterend", form);
  }
  revealInlineForm(form);
  const textarea = form.querySelector("textarea");
  syncInlineEditScroll(textarea);
  void highlightInlineEdit(form);
  textarea.focus({ preventScroll: true });
  textarea.setSelectionRange(0, textarea.value.length);
}

function syncInlineEditScroll(textarea) {
  const highlight = textarea.closest(".inline-edit-editor")?.querySelector(".inline-edit-highlight");
  if (!highlight) return;
  highlight.scrollTop = textarea.scrollTop;
  highlight.scrollLeft = textarea.scrollLeft;
}

async function highlightInlineEdit(form) {
  const textarea = form.querySelector('textarea[name="replacement"]');
  const target = form.querySelector(".inline-edit-highlight code");
  if (!textarea || !target) return;
  const requestId = ++state.inlineEditHighlightRequestId;
  const value = textarea.value;
  target.innerHTML = escapeHtml(value) || " ";
  try {
    const result = await api("/api/highlight", {
      method: "POST",
      body: JSON.stringify({ groups: [{ id: "inline-edit", path: form.dataset.editPath, lines: value.split("\n") }], theme: state.syntaxTheme }),
    });
    if (requestId !== state.inlineEditHighlightRequestId || !form.isConnected || textarea.value !== value) return;
    target.innerHTML = result.groups[0].lines.map((line) => line.map((token) => syntaxTokenHtml(token)).join("")).join("\n") || " ";
    syncInlineEditScroll(textarea);
  } catch {
    // The raw escaped mirror remains readable beneath the editor.
  }
}

async function performActivityAction(activityId, action) {
  if (state.busy || !reviewIsOpen()) return;
  if ((action === "reject" || action === "undo") && !window.confirm(action === "reject"
    ? "Reject this proposed change? The proposal will remain in the audit trail."
    : "Undo this applied change? This stops if overlapping edits were made afterwards.")) return;
  const activity = state.session.activities?.find((candidate) => candidate.id === activityId);
  const label = activity?.source === "reviewer" ? "Reviewer suggestion" : "Agent change";
  setBusy(true, `${action === "apply" ? "Applying" : action === "reject" ? "Rejecting" : "Undoing"} ${label.toLowerCase()}…`);
  try {
    state.session = await api(`/api/activities/${encodeURIComponent(activityId)}`, {
      method: "POST",
      body: JSON.stringify({ action }),
    });
    state.proposalPreview = false;
    state.proposalActivityId = null;
    renderSession();
    toast(`${label} ${action === "apply" ? "applied" : action === "reject" ? "rejected" : "undone"}`);
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
    renderSession();
  }
}

function closeInlineCommentEditor() {
  elements.diff.querySelectorAll(".inline-comment-editor-lane, .inline-comment-form").forEach((editor) => editor.remove());
}

function dismissInlineCommentEditor(form, returnFocus) {
  if (!form.isConnected) return;
  closeInlineCommentEditor();
  returnFocus?.focus({ preventScroll: true });
}

function updateInlineComposerMode(form, mode) {
  form.dataset.composerMode = mode;
  form.querySelectorAll("[data-inline-composer-mode]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.inlineComposerMode === mode)));
  form.querySelector(".inline-comment-label").textContent = mode === "ask" ? "Ask agent" : "New review comment";
  form.querySelector("textarea").placeholder = mode === "ask" ? "What do you want to understand about this code?" : "What should the agent revisit?";
  form.querySelector("textarea").setAttribute("aria-label", mode === "ask" ? "Question for agent" : "Review comment");
  form.querySelector("footer span").textContent = mode === "ask" ? "The selected code is included as context." : form.dataset.commentSelectedText ? "The selected quotation is attached separately." : "Markdown is supported.";
  form.querySelector('[type="submit"]').textContent = mode === "ask" ? "Ask agent" : "Add comment";
}

function openInlineCommentEditor(row, target, comment, { mode = "comment", initialBody = "", endLine = target.line, selection = null } = {}) {
  if (!reviewIsOpen()) return;
  closeInlineCommentEditor();
  selectLine(row);
  const form = document.createElement("form");
  form.className = "inline-comment-form";
  form.dataset.commentPath = target.path;
  form.dataset.commentSide = target.side;
  form.dataset.commentLine = String(target.line);
  if (selection) {
    if (endLine !== target.line) form.dataset.commentEndLine = String(endLine);
    form.dataset.commentSelectedText = selection.text;
    form.dataset.commentContext = selection.expectedContent;
  }
  if (comment) form.dataset.commentId = comment.id;
  const image = row.classList.contains("image-diff-side");
  const location = image ? `${target.path} · ${target.side} image` : endLine === target.line ? `${target.path}:${target.line}` : `${target.path}:${target.line}-${endLine}`;
  const askDisabled = !state.session.outline;
  const selectionPreview = selection ? `<details class="selection-quote-preview" open><summary>${escapeHtml(quotationLabel(selection.text))}</summary><pre>${escapeHtml(selection.text)}</pre></details>` : "";
  form.innerHTML = `<header><div><span class="inline-comment-label">${comment ? escapeHtml(commentScope(comment)) : selection ? "Line range comment" : "New review comment"}</span><strong>${escapeHtml(location)}</strong></div><button class="text-button" type="button" data-inline-comment-cancel>Cancel</button></header>
    ${selectionPreview}
    ${comment ? "" : `<div class="inline-composer-tabs" role="group" aria-label="Message type"><button type="button" data-inline-composer-mode="comment" aria-pressed="true">Comment</button><button type="button" data-inline-composer-mode="ask" aria-pressed="false"${askDisabled ? ' disabled title="Start a tour to ask the agent."' : ""}>Ask agent</button></div>`}
    <textarea name="body" aria-label="Review comment" placeholder="What should the agent revisit?">${escapeHtml(comment?.body ?? initialBody)}</textarea>
    <footer><span>${selection ? "The exact quotation and diff context are retained." : "Markdown is supported."}</span><button class="button primary" type="submit">${comment ? "Save comment" : "Add comment"}</button></footer>`;
  form.dataset.composerMode = "comment";
  if (!comment && mode === "ask" && !askDisabled) updateInlineComposerMode(form, "ask");
  const splitRow = row.closest(".split-row");
  if (image) {
    row.querySelector("figcaption").insertAdjacentElement("beforebegin", form);
  } else if (splitRow) {
    const lane = document.createElement("div");
    lane.className = `inline-comment-editor-lane ${target.side}-side`;
    lane.append(form);
    splitRow.insertAdjacentElement("afterend", lane);
  } else {
    row.insertAdjacentElement("afterend", form);
  }
  revealInlineForm(form);
  const textarea = form.querySelector("textarea");
  const returnFocus = row.querySelector(".line-action:not(:disabled), .image-review-actions button:not(:disabled)");
  form.querySelector("[data-inline-comment-cancel]").addEventListener("click", () => dismissInlineCommentEditor(form, returnFocus));
  form.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    dismissInlineCommentEditor(form, returnFocus);
  });
  textarea.focus({ preventScroll: true });
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}

async function openCommentEditor(comment) {
  if (comment.scope === "stop") return openStepCommentEditor(comment);
  const selector = /\.png$/i.test(comment.path)
    ? `.image-diff-side[data-path="${CSS.escape(comment.path)}"][data-side="${comment.side}"]`
    : `.diff-row[data-path="${CSS.escape(comment.path)}"][data-side="${comment.side}"][data-line="${comment.line}"]`;
  let row = elements.diff.querySelector(selector);
  if (!row) {
    await showChangedFile(comment.path, comment.line, comment.side);
    row = elements.diff.querySelector(selector);
  }
  if (!row) return toast("That comment's location is no longer visible in the current diff.", { tone: "warning", duration: 6_000 });
  openInlineCommentEditor(row, lineTarget(row), comment);
}

function codeElement(node) {
  return (node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement)?.closest?.(".line-code");
}

function textOffsetWithin(element, node, offset) {
  const range = document.createRange();
  range.selectNodeContents(element);
  range.setEnd(node, offset);
  return range.toString().length;
}

function readCodeSelection() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  const startCode = codeElement(range.startContainer);
  const endCode = codeElement(range.endContainer);
  const startRow = startCode?.closest(".diff-row");
  const endRow = endCode?.closest(".diff-row");
  if (!startRow || !endRow || startRow.dataset.path !== endRow.dataset.path || startRow.dataset.side !== endRow.dataset.side) return null;
  const hunk = startRow.closest(".hunk");
  if (!hunk || hunk !== endRow.closest(".hunk")) return null;
  const rows = [...hunk.querySelectorAll(`.diff-row[data-path="${CSS.escape(startRow.dataset.path)}"][data-side="${startRow.dataset.side}"][data-line]:not([data-line=""])`)]
    .filter((row) => !row.classList.contains("split-empty"));
  const startIndex = rows.indexOf(startRow);
  const endIndex = rows.indexOf(endRow);
  if (startIndex < 0 || endIndex < startIndex) return null;
  const selectedRows = rows.slice(startIndex, endIndex + 1);
  const lineNumbers = selectedRows.map((row) => Number(row.dataset.line));
  if (lineNumbers.some((line, index) => index > 0 && line !== lineNumbers[index - 1] + 1)) return null;
  const startOffset = textOffsetWithin(startCode, range.startContainer, range.startOffset);
  const endOffset = textOffsetWithin(endCode, range.endContainer, range.endOffset);
  const text = selectedRows.map((row, index) => {
    const content = row.dataset.content;
    if (selectedRows.length === 1) return content.slice(startOffset, endOffset);
    if (index === 0) return content.slice(startOffset);
    if (index === selectedRows.length - 1) return content.slice(0, endOffset);
    return content;
  }).join("\n");
  if (!text.trim()) return null;
  return {
    path: startRow.dataset.path,
    side: startRow.dataset.side,
    startLine: lineNumbers[0],
    endLine: lineNumbers.at(-1),
    text,
    startOffset,
    endOffset,
    expectedContent: selectedRows.map((row) => row.dataset.content).join("\n"),
    startRow,
    endRow,
    rect: range.getBoundingClientRect(),
  };
}

function hideCodeSelectionToolbar(clearSelection = false) {
  elements["code-selection-toolbar"].classList.add("hidden");
  state.codeSelection = null;
  if (clearSelection) window.getSelection()?.removeAllRanges();
}

function updateCodeSelectionToolbar() {
  const selected = readCodeSelection();
  if (!selected || state.proposalPreview || !reviewIsOpen()) return hideCodeSelectionToolbar();
  state.codeSelection = selected;
  const toolbar = elements["code-selection-toolbar"];
  toolbar.querySelector('[data-selection-tool="edit"]').disabled = selected.side !== "new";
  toolbar.querySelector('[data-selection-tool="ask"]').disabled = !state.session.outline;
  const peek = toolbar.querySelector('[data-selection-tool="peek"]');
  const candidate = symbolForCodeSelection(selected);
  peek.textContent = candidate.expanded ? `Peek ${candidate.symbol}` : "Peek symbol";
  toolbar.classList.remove("hidden");
  const bounds = toolbar.getBoundingClientRect();
  const left = Math.max(8, Math.min(window.innerWidth - bounds.width - 8, selected.rect.left + selected.rect.width / 2 - bounds.width / 2));
  const preferredTop = selected.rect.top - bounds.height - 7;
  toolbar.style.left = `${left}px`;
  toolbar.style.top = `${preferredTop >= 8 ? preferredTop : selected.rect.bottom + 7}px`;
}

async function submitInlineAsk(form) {
  const body = form.elements.body.value.trim();
  if (!body || !state.session.outline) return;
  const selector = `.diff-row[data-path="${CSS.escape(form.dataset.commentPath)}"][data-side="${form.dataset.commentSide}"][data-line="${form.dataset.commentLine}"]`;
  const row = elements.diff.querySelector(selector);
  if (!row) return toast("That code location is no longer visible.", { tone: "warning" });
  closeInlineCommentEditor();
  openConversation(null);
  selectLine(row, {
    endLine: form.dataset.commentEndLine ? Number(form.dataset.commentEndLine) : Number(form.dataset.commentLine),
    selectedText: form.dataset.commentSelectedText,
    context: form.dataset.commentContext,
  });
  elements["chat-input"].value = body;
  await askAgent({ preventDefault() {} });
}

async function saveInlineComment(form) {
  if (!reviewIsOpen()) return;
  const body = form.elements.body.value.trim();
  if (!body) return;
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const commentId = form.dataset.commentId;
    const latest = commentId
      ? await api(`/api/comments/${encodeURIComponent(commentId)}`, { method: "PATCH", body: JSON.stringify({ body }) })
      : await api("/api/comments", { method: "POST", body: JSON.stringify({
        ...(form.dataset.commentSelectedText ? { scope: "range", selectedText: form.dataset.commentSelectedText, context: form.dataset.commentContext } : {}),
        path: form.dataset.commentPath,
        side: form.dataset.commentSide,
        line: Number(form.dataset.commentLine),
        ...(form.dataset.commentEndLine ? { endLine: Number(form.dataset.commentEndLine) } : {}),
        body,
      }) });
    const previous = state.session;
    state.session = latest;
    renderSessionUpdate(previous, { closeCommentEditor: true });
    toast(commentId ? "Review comment updated" : "Review comment added");
  } catch (error) {
    toast(error.message);
    submit.disabled = false;
  }
}

function openStepCommentEditor(comment = null) {
  if (!reviewIsOpen() || !currentStep()) return;
  elements["step-comment-form"].classList.remove("hidden");
  elements["step-comment-form"].dataset.commentId = comment?.id ?? "";
  elements["step-comment-input"].value = comment?.body ?? "";
  elements["step-comment-form"].querySelector('[type="submit"]').textContent = comment ? "Save stop comment" : "Add stop comment";
  elements["step-comment-input"].focus({ preventScroll: true });
}

async function saveStepComment(event) {
  event.preventDefault();
  if (!reviewIsOpen()) return;
  const body = elements["step-comment-input"].value.trim();
  const step = currentStep();
  if (!body || !step) return;
  const commentId = elements["step-comment-form"].dataset.commentId;
  const submit = elements["step-comment-form"].querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const latest = commentId
      ? await api(`/api/comments/${encodeURIComponent(commentId)}`, { method: "PATCH", body: JSON.stringify({ body }) })
      : await api("/api/comments", { method: "POST", body: JSON.stringify({ scope: "stop", stepId: step.id, body }) });
    const previous = state.session;
    state.session = latest;
    elements["step-comment-form"].classList.add("hidden");
    elements["step-comment-input"].value = "";
    renderSessionUpdate(previous, { closeCommentEditor: true });
    toast(commentId ? "Stop comment updated" : "Stop comment added");
  } catch (error) {
    toast(error.message);
    submit.disabled = false;
  }
}

async function deleteReviewComment(comment) {
  if (!reviewIsOpen()) return;
  try {
    const latest = await api(`/api/comments/${encodeURIComponent(comment.id)}`, { method: "DELETE" });
    const previous = state.session;
    state.session = latest;
    state.deletingCommentId = null;
    renderSessionUpdate(previous);
    toast("Review comment deleted");
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
    ? `${state.selectedLine.path}:${state.selectedLine.line}${state.selectedLine.endLine && state.selectedLine.endLine !== state.selectedLine.line ? `-${state.selectedLine.endLine}` : ""} (${state.selectedLine.side})\n${state.selectedLine.selectedText ? `Exact selected quotation:\n${state.selectedLine.selectedText}\nExact selected context:\n${state.selectedLine.context ?? state.selectedLine.content}` : state.selectedLine.content}`
    : undefined;
  const originalThreadId = state.activeThreadId;
  const requestThreadId = originalThreadId?.startsWith("local-question-") ? null : originalThreadId;
  const localId = `local-question-${crypto.randomUUID()}`;
  const requestedStepId = !requestThreadId && state.tourMode ? currentStep()?.id ?? null : null;
  const anchor = !requestThreadId && state.selectedLine ? { ...state.selectedLine } : undefined;
  const contextPaths = !requestThreadId ? [...state.questionContextPaths] : [];
  const pending = { id: localId, threadId: requestThreadId ?? localId, role: "user", body, ...(requestedStepId ? { stepId: requestedStepId } : {}), anchor, contextPaths };
  state.pendingQuestions.set(localId, pending);
  state.activeThreadId = pending.threadId;
  state.questionDrafts.delete(originalThreadId);
  state.questionsOpen = true;
  state.mobileAgentPane = "questions";
  // Each request owns its captured location. Clear the draft now instead of
  // clearing whichever line a later queued question selected.
  clearSelectedLine();
  renderMessages();
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
  renderAgentActivity();
  void (async () => {
    let answeredQuestionId = null;
    try {
      const response = await api("/api/agent/message", {
        method: "POST",
        body: JSON.stringify({ body, selectedContext, threadId: requestThreadId ?? undefined, stepId: requestThreadId ? undefined : requestedStepId, anchor, contextPaths: contextPaths.length ? contextPaths : undefined }),
      });
      const previous = state.session;
      state.session = response;
      answeredQuestionId = [...state.session.messages].reverse().find((message) => message.role === "user" && message.body === body)?.id ?? null;
      const answered = state.session.messages.find((message) => message.id === answeredQuestionId);
      if (state.activeThreadId === pending.threadId) state.activeThreadId = answered?.threadId ?? answeredQuestionId;
      state.expectedAgentActivity = null;
      state.pendingQuestions.delete(localId);
      renderSessionUpdate(previous);
    } catch (error) {
      state.expectedAgentActivity = null;
      state.pendingQuestions.delete(localId);
      if (state.activeThreadId === pending.threadId) {
        state.activeThreadId = originalThreadId;
        elements["chat-input"].value = body;
      } else state.questionDrafts.set(originalThreadId, { body, line: anchor, contextPaths });
      renderMessages();
      toast(error.message);
    } finally {
      renderTour();
      if (answeredQuestionId) requestAnimationFrame(() => revealAgentAnswer(answeredQuestionId));
    }
  })();
}

async function close(outcome, decision = outcome === "accepted" ? "approve" : outcome === "feedback" ? "request-changes" : "cancel", note) {
  if (!reviewIsOpen()) return;
  if (decision === "approve" && state.session.comments.length > 0) {
    toast("Use Approve with comments, request changes, or remove all inline comments.");
    return;
  }
  try {
    let result;
    if (state.session.pullRequest && outcome !== "cancelled") {
      const selected = state.session.comments.filter((comment) => comment.publishToGitHub).length;
      const action = decision === "approve-with-comments" ? "approve with comments" : outcome === "accepted" ? "approve" : "request changes on";
      if (!window.confirm(`Publish a GitHub review to ${action} ${state.session.pullRequest.repository}#${state.session.pullRequest.number} at ${state.session.pullRequest.headRefOid.slice(0, 8)} with ${selected} selected inline comment(s)?`)) return;
      result = await api("/api/github/review", { method: "POST", body: JSON.stringify({ outcome, decision, note, headOid: state.session.pullRequest.headRefOid, confirm: true }) });
    } else {
      result = await api("/api/close", { method: "POST", body: JSON.stringify({ outcome, decision, note }) });
    }
    const previousStatus = state.session.status;
    state.session = { ...state.session, status: result.status };
    beginCloseCountdownForTransition(previousStatus, result);
    renderSession();
  } catch (error) {
    toast(error.message);
  }
}

function requestCloseReview() {
  if (!reviewIsOpen()) return;
  if (!window.confirm("Close this review without approving or requesting changes?")) return;
  void close("cancelled", "cancel");
}

function openReviewDecision(decision) {
  const requestChanges = decision === "request-changes";
  elements["review-decision-dialog"].dataset.decision = decision;
  elements["review-decision-eyebrow"].textContent = requestChanges ? "Changes required" : "Non-blocking review";
  elements["review-decision-title"].textContent = requestChanges ? "Request changes" : "Approve with comments";
  elements["review-decision-description"].textContent = requestChanges
    ? "Explain what must change before this review can be approved. Inline comments will be included too."
    : "Leave an overall non-blocking note while approving this review. Inline comments will be included too.";
  elements["submit-review-decision"].textContent = requestChanges ? "Request changes" : "Approve with comments";
  elements["review-decision-note"].value = "";
  elements["review-decision-dialog"].showModal();
  elements["review-decision-note"].focus();
}

function expandFilesChangedByRefresh(session) {
  const summary = session.revisionSummary;
  for (const path of [...(summary?.newFiles ?? []), ...(summary?.changedAgainFiles ?? [])]) {
    state.collapsedFiles.delete(path);
  }
}

async function refresh() {
  if ((!reviewIsOpen() && !state.session.pullRequest) || state.busy) return;
  setBusy(true, "Refreshing the comparison…");
  try {
    const refreshed = await api(state.session.pullRequest ? "/api/github/refresh" : "/api/refresh", { method: "POST", body: "{}" });
    expandFilesChangedByRefresh(refreshed);
    state.session = refreshed;
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

async function switchComparisonView(view) {
  if (state.busy || !state.session?.checkpoints?.length) return;
  setBusy(true, "Switching comparison range…");
  try {
    const previous = state.session;
    state.session = await api("/api/comparison/view", { method: "POST", body: JSON.stringify({ view }) });
    expandFilesChangedByRefresh(state.session);
    renderSessionUpdate(previous, { closeCommentEditor: true });
  } catch (error) {
    toast(error.message);
    elements["comparison-view"].value = state.session.comparisonView ?? "full";
  } finally {
    setBusy(false);
    renderSession();
  }
}

async function createCheckpoint() {
  if (!reviewIsOpen() || state.busy || state.session.pullRequest) return;
  elements["checkpoint-label"].value = "";
  elements["checkpoint-dialog"].showModal();
  elements["checkpoint-label"].focus();
}

async function saveCheckpoint() {
  if (!reviewIsOpen() || state.busy || state.session.pullRequest) return;
  const label = elements["checkpoint-label"].value.trim();
  elements["checkpoint-dialog"].close();
  setBusy(true, "Saving review checkpoint…");
  try {
    state.session = await api("/api/checkpoints", { method: "POST", body: JSON.stringify({ label }) });
    renderSession();
    toast("Review checkpoint saved. Future refreshes will preserve unchanged reviewed files.");
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
    renderSession();
  }
}

async function deleteCheckpoint(checkpoint) {
  if (!reviewIsOpen() || state.busy) return;
  setBusy(true, "Deleting review checkpoint…");
  try {
    const previous = state.session;
    state.session = await api(`/api/checkpoints/${encodeURIComponent(checkpoint.id)}`, { method: "DELETE" });
    state.deletingCheckpointId = null;
    renderSessionUpdate(previous, { closeCommentEditor: true });
    toast("Review checkpoint deleted");
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
    renderSession();
  }
}

elements["start-tour"].addEventListener("click", startTour);
elements["begin-tour"].addEventListener("click", () => void beginPreparedTour());
elements["tour-intro-return"].addEventListener("click", reopenTourIntro);
elements["tour-intro-dialog"].addEventListener("cancel", (event) => event.preventDefault());
elements["tour-intro-dialog"].addEventListener("click", (event) => {
  const target = event.target.closest("[data-attention-kind]");
  if (!target) return;
  const kind = target.dataset.attentionKind;
  state.tourIntroPending = false;
  state.tourIntroShown = true;
  state.tourIntroReturn = true;
  renderReviewOverview();
  elements["tour-intro-dialog"].close();
  if (kind === "finding") {
    state.tourMode = false;
    return openFindingFromCode(target.dataset.attentionId, { fromBriefing: true });
  }
  state.tourMode = false;
  renderSession();
  if (kind === "file") return void showChangedFile(target.dataset.attentionPath, Number(target.dataset.attentionLine) || undefined, target.dataset.attentionSide);
  if (kind === "call-flow") {
    activateReviewTab("call-flows", renderCallFlows);
    window.requestAnimationFrame(() => document.querySelector(`[data-call-flow-id="${CSS.escape(target.dataset.attentionId)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
    return;
  }
  if (kind === "section") {
    const section = target.dataset.attentionSection;
    const tab = section === "findings" ? "findings" : section === "call-flows" ? "call-flows" : section === "pull-request" ? "pull-request" : "diff";
    const render = tab === "findings" ? renderFindings : tab === "call-flows" ? renderCallFlows : tab === "pull-request" ? renderPullRequest : null;
    activateReviewTab(tab, render);
  }
});
elements["close-architecture-viewer"].addEventListener("click", () => elements["architecture-viewer-dialog"].close());
elements["architecture-viewer-diagram"].addEventListener("click", (event) => {
  const flowId = elements["architecture-viewer-diagram"].dataset.callFlowId;
  if (!flowId) return;
  const flow = state.session.outline?.callFlows.find((candidate) => candidate.id === flowId);
  if (!flow) return;
  const mode = event.target.closest("[data-call-flow-mode]");
  if (mode) {
    state.callFlowModes.set(flow.id, mode.dataset.callFlowMode);
    elements["architecture-viewer-diagram"].innerHTML = callFlowCardHtml(flow, { showTitle: false, showRegenerate: false, viewer: true });
    return;
  }
  const location = event.target.closest("[data-call-path]");
  const affected = event.target.closest("[data-flow-file]");
  if (!location && !affected) return;
  elements["architecture-viewer-dialog"].close();
  if (elements["tour-intro-dialog"].open) {
    state.tourIntroPending = false;
    state.tourIntroShown = true;
    state.tourIntroReturn = true;
    elements["tour-intro-dialog"].close();
    state.tourMode = false;
    renderSession();
  }
  if (location) void showAnalysisFile(location.dataset.callPath, Number(location.dataset.callLine), location.dataset.callSide);
  else void showAnalysisFile(affected.dataset.flowFile);
});
elements["tour-mode-toggle"].addEventListener("click", toggleTourMode);
elements["previous-step"].addEventListener("click", () => navigate("previous"));
elements["next-step"].addEventListener("click", () => void handleNextStep());
elements["questions-toggle"].addEventListener("click", () => {
  state.questionsOpen = !state.questionsOpen;
  renderQuestionLayout();
});
elements["new-question"].addEventListener("click", () => {
  openConversation();
  clearSelectedLine();
  renderMessages();
  elements["chat-input"].focus({ preventScroll: true });
});
elements["conversation-select"].addEventListener("change", (event) => {
  openConversation(event.target.value || null);
  if (!event.target.value) {
    clearSelectedLine();
    renderMessages();
  }
});
elements["comment-stop"].addEventListener("click", () => openStepCommentEditor());
elements["cancel-step-comment"].addEventListener("click", () => {
  elements["step-comment-form"].classList.add("hidden");
  elements["step-comment-input"].value = "";
});
elements["step-comment-form"].addEventListener("submit", saveStepComment);
elements["step-comment-list"].addEventListener("click", (event) => {
  const button = event.target.closest("[data-step-comment-action]");
  const item = event.target.closest("[data-comment-id]");
  const comment = item && state.session.comments.find((candidate) => candidate.id === item.dataset.commentId);
  if (!button || !comment) return;
  if (button.dataset.stepCommentAction === "edit") void openStepCommentEditor(comment);
  if (button.dataset.stepCommentAction === "delete") void deleteReviewComment(comment);
});
elements["selection-pill"].addEventListener("click", (event) => {
  if (!event.target.closest("[data-remove-line-context]")) return;
  state.selectedLine = null;
  renderMessages();
});
elements["question-file-context"].addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-question-file]");
  if (!button) return;
  state.questionContextPaths.delete(button.dataset.removeQuestionFile);
  renderMessages();
});
function renderQuestionFilePicker() {
  const query = elements["question-files-search"].value.trim().toLowerCase();
  const files = state.session.comparison.repositoryFiles.filter((path) => !query || path.toLowerCase().includes(query));
  const root = { directories: new Map(), files: [] };
  for (const path of files) {
    const parts = path.split("/");
    const name = parts.pop();
    let node = root;
    for (const part of parts) {
      if (!node.directories.has(part)) node.directories.set(part, { directories: new Map(), files: [] });
      node = node.directories.get(part);
    }
    node.files.push({ name, path });
  }
  const renderNode = (node) => [
    ...[...node.directories.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, child]) => `<details ${query ? "open" : ""}><summary>${escapeHtml(name)}</summary><div>${renderNode(child)}</div></details>`),
    ...node.files.sort((a, b) => a.name.localeCompare(b.name)).map(({ name, path }) => `<label><input type="checkbox" value="${escapeHtml(path)}" ${state.questionContextPaths.has(path) ? "checked" : ""} /><span>${escapeHtml(name)}</span></label>`),
  ].join("");
  elements["question-files-tree"].innerHTML = files.length ? renderNode(root) : '<p class="empty">No repository files match this filter.</p>';
}
elements["add-question-files"].addEventListener("click", () => {
  elements["question-files-search"].value = "";
  renderQuestionFilePicker();
  elements["question-files-dialog"].showModal();
  elements["question-files-search"].focus();
});
elements["question-files-search"].addEventListener("input", renderQuestionFilePicker);
elements["cancel-question-files"].addEventListener("click", () => elements["question-files-dialog"].close());
elements["question-files-form"].addEventListener("submit", (event) => {
  event.preventDefault();
  const selected = [...elements["question-files-tree"].querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
  const visible = new Set([...elements["question-files-tree"].querySelectorAll('input[type="checkbox"]')].map((input) => input.value));
  const next = new Set([...state.questionContextPaths].filter((path) => !visible.has(path)));
  for (const path of selected) next.add(path);
  if (next.size > 8) { toast("Choose at most 8 files for one question."); return; }
  state.questionContextPaths = next;
  elements["question-files-dialog"].close();
  renderMessages();
});
elements["show-tour-pane"].addEventListener("click", () => { state.mobileAgentPane = "tour"; renderQuestionLayout(); });
elements["show-questions-pane"].addEventListener("click", () => { state.mobileAgentPane = "questions"; state.questionsOpen = true; renderQuestionLayout(); });
function resizeQuestions(percent, persist = false) {
  state.questionPanePercent = Math.max(25, Math.min(70, percent));
  elements["questions-resizer"].setAttribute("aria-valuenow", String(Math.round(state.questionPanePercent)));
  elements["questions-resizer"].setAttribute("aria-valuetext", `Questions ${Math.round(state.questionPanePercent)}%, tour ${Math.round(100 - state.questionPanePercent)}%`);
  if (persist && state.preferenceRepository) window.localStorage.setItem(preferenceKey("question-pane-percent"), String(state.questionPanePercent));
  renderQuestionLayout();
}
elements["questions-resizer"].addEventListener("keydown", (event) => {
  if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  resizeQuestions(event.key === "Home" ? 25 : event.key === "End" ? 70 : state.questionPanePercent + (event.key === "ArrowUp" ? 5 : -5), true);
});
elements["questions-resizer"].addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  const separator = event.currentTarget;
  const startY = event.clientY;
  const startPercent = state.questionPanePercent;
  const height = elements["questions-pane"].getBoundingClientRect().height + elements["tour-active"].getBoundingClientRect().height;
  separator.setPointerCapture(event.pointerId);
  const move = (next) => resizeQuestions(startPercent + (startY - next.clientY) / height * 100);
  const end = () => { resizeQuestions(state.questionPanePercent, true); separator.removeEventListener("pointermove", move); separator.removeEventListener("pointerup", end); separator.removeEventListener("pointercancel", end); };
  separator.addEventListener("pointermove", move);
  separator.addEventListener("pointerup", end);
  separator.addEventListener("pointercancel", end);
});
elements["questions-resizer"].addEventListener("dblclick", () => resizeQuestions(45, true));
elements["chat-form"].addEventListener("submit", askAgent);
elements["close-button"].addEventListener("click", () => state.session.preferences?.closeOutcome === "cancelled" ? requestCloseReview() : close("accepted", "approve"));
elements["close-review-button"].addEventListener("click", requestCloseReview);
elements["cancel-auto-close"].addEventListener("click", cancelCloseCountdown);
elements["approve-comments-button"].addEventListener("click", () => openReviewDecision("approve-with-comments"));
elements["feedback-button"].addEventListener("click", () => openReviewDecision("request-changes"));
elements["cancel-review-decision"].addEventListener("click", () => elements["review-decision-dialog"].close());
elements["review-decision-form"].addEventListener("submit", (event) => {
  event.preventDefault();
  const decision = elements["review-decision-dialog"].dataset.decision;
  const note = elements["review-decision-note"].value.trim();
  if (!note) return;
  elements["review-decision-dialog"].close();
  void close(decision === "request-changes" ? "feedback" : "accepted", decision, note);
});
elements["symbol-peek-open"]?.addEventListener("click", () => {
  const symbol = state.codeSelection ? symbolForCodeSelection(state.codeSelection).symbol : symbolFromText(state.selectedLine?.content ?? "");
  if (symbol) void resolvePeekSymbol(symbol);
  else {
    state.symbolPeek.open = true;
    state.symbolPeek.compact = false;
    state.symbolPeek.current = null;
    state.symbolPeek.result = null;
    renderSymbolPeek();
    elements["symbol-peek-input"].focus();
  }
});
elements["symbol-peek-close"]?.addEventListener("click", closeSymbolPeek);
window.addEventListener("pageshow", (event) => {
  if (event.persisted && state.symbolPeek.open) closeSymbolPeek();
});
elements["symbol-peek-form"]?.addEventListener("submit", (event) => {
  event.preventDefault();
  void resolvePeekSymbol(elements["symbol-peek-input"].value);
});
elements["symbol-peek-panel"]?.addEventListener("click", (event) => {
  if (state.symbolPeek.compact) return expandSymbolPeek();
  const trail = event.target.closest("[data-symbol-trail-index]");
  if (trail) {
    const index = Number(trail.dataset.symbolTrailIndex);
    const entry = state.symbolPeek.history[index];
    if (!entry) return;
    state.symbolPeek.history = state.symbolPeek.history.slice(0, index);
    void resolvePeekSymbol(entry.symbol, entry, false);
    return;
  }
  const location = event.target.closest("[data-symbol-location]");
  if (!location) {
    const suggestion = event.target.closest("[data-symbol-suggestion]");
    if (suggestion) void resolvePeekSymbol(suggestion.dataset.symbolSuggestion, { path: suggestion.dataset.symbolSuggestionPath, line: Number(suggestion.dataset.symbolSuggestionLine), side: "new" });
    return;
  }
  const path = location.dataset.symbolLocation;
  const line = Number(location.dataset.symbolLine);
  void openSymbolPeekLocation(path, line, location.dataset.symbolSide);
});
elements["symbol-peek-panel"]?.addEventListener("keydown", (event) => {
  if (!state.symbolPeek.compact || !["Enter", " "].includes(event.key)) return;
  event.preventDefault();
  expandSymbolPeek();
});
elements["refresh-button"].addEventListener("click", refresh);
elements["comparison-view"].addEventListener("change", () => void switchComparisonView(elements["comparison-view"].value));
elements["checkpoint-button"].addEventListener("click", () => void createCheckpoint());
elements["cancel-checkpoint"].addEventListener("click", () => elements["checkpoint-dialog"].close());
elements["checkpoint-form"].addEventListener("submit", (event) => {
  event.preventDefault();
  void saveCheckpoint();
});
elements["revision-history"].addEventListener("click", (event) => {
  const action = event.target.closest("[data-checkpoint-action]");
  if (!action) return;
  const checkpoint = state.session?.checkpoints?.find((candidate) => candidate.id === action.dataset.checkpointId);
  if (!checkpoint) return;
  if (action.dataset.checkpointAction === "delete") {
    state.deletingCheckpointId = checkpoint.id;
    renderSession();
  } else if (action.dataset.checkpointAction === "cancel-delete") {
    state.deletingCheckpointId = null;
    renderSession();
  } else if (action.dataset.checkpointAction === "confirm-delete") {
    void deleteCheckpoint(checkpoint);
  }
});
const reviewActions = document.getElementById("review-actions");
const reviewActionsToggle = document.getElementById("review-actions-toggle");
function setReviewActionsOpen(open) {
  reviewActions.classList.toggle("open", open);
  reviewActionsToggle.setAttribute("aria-expanded", String(open));
}
reviewActionsToggle.addEventListener("click", () => setReviewActionsOpen(!reviewActions.classList.contains("open")));
reviewActions.addEventListener("click", (event) => {
  if (event.target.closest("#review-options button")) setReviewActionsOpen(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && reviewActions.classList.contains("open")) {
    setReviewActionsOpen(false);
    reviewActionsToggle.focus();
  }
});
document.addEventListener("keydown", submitTextareaOnModifiedEnter);
document.addEventListener("keydown", (event) => {
  if (event.defaultPrevented || event.repeat || shortcutTargetIsEditable(event.target) || modalDialogIsOpen()) return;
  const systemModifier = event.ctrlKey || event.metaKey || event.altKey;
  if (event.key === "?" && event.shiftKey && !systemModifier) {
    event.preventDefault();
    openShortcutHelp();
    return;
  }
  if (systemModifier || event.shiftKey) return;
  const key = event.key.toLowerCase();
  if (key === "j" && state.tourMode && reviewIsOpen()) {
    event.preventDefault();
    void handleNextStep();
  } else if (key === "k" && state.tourMode && reviewIsOpen()) {
    event.preventDefault();
    void navigate("previous");
  } else if (key === "z") {
    event.preventDefault();
    void toggleFocusMode();
  }
});
document.addEventListener("pointerdown", (event) => {
  if (!reviewActions.contains(event.target)) setReviewActionsOpen(false);
  if (elements["settings-menu"].open && !elements["settings-menu"].contains(event.target)) {
    elements["settings-menu"].open = false;
  }
  if (elements["revision-history"].open && !elements["revision-history"].contains(event.target)) {
    elements["revision-history"].open = false;
  }
});
elements["file-panel-toggle"].addEventListener("click", () => setFilePanelOpen(!state.filePanelOpen));
elements["file-panel-close"].addEventListener("click", () => setFilePanelOpen(false, { restoreFocus: true }));
elements["file-panel-collapse"].addEventListener("click", () => setPaneCollapsed("file", !state.filePanelCollapsed, true));
elements["agent-panel-collapse"].addEventListener("click", () => setPaneCollapsed("agent", !state.agentPanelCollapsed, true));
elements["file-panel-backdrop"].addEventListener("click", () => setFilePanelOpen(false, { restoreFocus: true }));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.filePanelOpen) setFilePanelOpen(false, { restoreFocus: true });
});
window.addEventListener("resize", () => {
  if (!narrowFilePanelLayout() && state.filePanelOpen) setFilePanelOpen(false);
  else {
    const hidden = narrowFilePanelLayout() && !state.filePanelOpen;
    elements["file-panel"].setAttribute("aria-hidden", String(hidden));
    elements["file-panel"].inert = hidden;
  }
});
elements["export-menu"].addEventListener("click", (event) => {
  const button = event.target.closest("[data-export-format]");
  if (!button) return;
  if (button.dataset.exportFormat === "html") openHtmlExportDialog();
  else { elements["settings-menu"].open = false; void downloadExport(button.dataset.exportFormat); }
});
elements["cancel-html-export"].addEventListener("click", () => elements["html-export-dialog"].close());
elements["html-export-form"].addEventListener("submit", (event) => {
  event.preventDefault();
  const options = {
    prepareMissingSteps: elements["export-prepare-steps"].checked,
    includeFindings: elements["export-findings"].checked,
    includeCallFlows: elements["export-call-flows"].checked,
    includeDiagrams: elements["export-diagrams"].checked,
    diffWrap: state.diffWrap,
  };
  elements["html-export-dialog"].close();
  void downloadExport("html", options);
});
elements["pull-request-content"].addEventListener("click", setPullRequestDescriptionMode);
elements["pull-request-content"].addEventListener("click", togglePullRequestContentWidth);
elements["pull-request-content"].addEventListener("click", handleIssueAssessmentClick);
elements["pull-request-description"].addEventListener("click", setPullRequestDescriptionMode);
elements["close-issue-assessment"].addEventListener("click", () => elements["issue-assessment-dialog"].close());
elements["issue-assessment-dialog"].addEventListener("click", handleIssueAssessmentClick);
elements["issue-assessment-dialog"].addEventListener("click", dismissIssueAssessmentOnBackdrop);
elements["issue-assessment-dialog"].addEventListener("close", () => {
  state.issueAssessmentExcerptRequestId += 1;
  const target = issueAssessmentReturnTarget;
  issueAssessmentReturnTarget = null;
  if (target?.isConnected) target.focus({ preventScroll: true });
});
elements["regenerate-flows"].addEventListener("click", () => regenerateFlows());
elements["regenerate-call-flows"].addEventListener("click", () => regenerateCallFlows());
elements["flow-form"].addEventListener("submit", saveFlow);
elements["cancel-flow"].addEventListener("click", () => elements["flow-dialog"].close());
elements["theme-select"].value = window.reviewTourTheme.preference();
elements["theme-select"].addEventListener("change", () => window.reviewTourTheme.set(elements["theme-select"].value));
elements["syntax-theme-select"].value = state.syntaxTheme;
elements["syntax-theme-select"].addEventListener("change", () => {
  state.syntaxTheme = elements["syntax-theme-select"].value;
  window.localStorage.setItem("review-tour-syntax-theme", state.syntaxTheme);
  document.documentElement.dataset.syntaxTheme = state.syntaxTheme;
  void highlightRenderedCode();
  void highlightCommentQuotes();
  void highlightSymbolPeek();
});
elements["prefetch-steps"].addEventListener("change", async () => {
  const previous = state.session.preferences?.prefetchSteps ?? 5;
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
async function saveBriefingPreferences(order = briefingOptionOrderFromDom()) {
  const values = {
    showBriefing: elements["show-tour-briefing"].checked,
    briefingArchitecture: elements["briefing-architecture"].checked,
    briefingSequenceDiagrams: elements["briefing-sequence-diagrams"].checked,
    briefingCallFlows: elements["briefing-call-flows"].checked,
    briefingNeedsAttention: elements["briefing-needs-attention"].checked,
    briefingReviewEffort: elements["briefing-review-effort"].checked,
    briefingOrder: order,
  };
  state.briefingPreferencesSaving = true;
  syncBriefingPreferenceControls();
  try {
    state.session = await api("/api/preferences", { method: "POST", body: JSON.stringify(values) });
    if (!values.showBriefing) elements["tour-intro-dialog"].close();
    renderSession();
  } catch (error) {
    toast(error.message);
    renderSession();
  } finally {
    state.briefingPreferencesSaving = false;
    syncBriefingPreferenceControls();
  }
}
[
  "show-tour-briefing",
  "briefing-architecture",
  "briefing-sequence-diagrams",
  "briefing-call-flows",
  "briefing-needs-attention",
  "briefing-review-effort",
].forEach((id) => elements[id].addEventListener("change", () => void saveBriefingPreferences()));
elements["briefing-options"].addEventListener("click", (event) => {
  if (event.target.closest("input")) return;
  event.target.closest("[data-briefing-option]")?.focus();
});
function clearBriefingDrag({ save = false } = {}) {
  if (!briefingDrag) return;
  const { option, placeholder } = briefingDrag;
  if (placeholder.isConnected && save) placeholder.replaceWith(option);
  else placeholder.remove();
  option.classList.remove("dragging", "dragging-hidden");
  briefingDrag = null;
  const order = briefingOptionOrderFromDom();
  renderBriefingOptionOrder(order);
  if (save) void saveBriefingPreferences(order);
}

function moveBriefingDropPlaceholder(clientY) {
  if (!briefingDrag) return;
  const options = [...elements["briefing-options"].querySelectorAll("[data-briefing-option]")]
    .filter((option) => option !== briefingDrag.option);
  const nextOption = options.find((option) => {
    const bounds = option.getBoundingClientRect();
    return clientY < bounds.top + bounds.height / 2;
  });
  if (nextOption) elements["briefing-options"].insertBefore(briefingDrag.placeholder, nextOption);
  else elements["briefing-options"].appendChild(briefingDrag.placeholder);
}

elements["briefing-options"].addEventListener("dragstart", (event) => {
  const option = event.target.closest("[data-briefing-option]");
  if (!option || option.getAttribute("aria-disabled") === "true") return;
  const placeholder = document.createElement("div");
  placeholder.className = "briefing-option-placeholder";
  placeholder.setAttribute("aria-hidden", "true");
  placeholder.style.height = `${option.getBoundingClientRect().height}px`;
  const label = option.querySelector("label span")?.textContent?.trim() ?? "Section";
  placeholder.textContent = `${label} will move here`;
  option.after(placeholder);
  briefingDrag = { option, placeholder };
  option.classList.add("dragging");
  event.dataTransfer?.setData("text/plain", option.dataset.briefingOption ?? "");
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  requestAnimationFrame(() => {
    if (briefingDrag?.option === option) option.classList.add("dragging-hidden");
  });
});
elements["briefing-options"].addEventListener("dragover", (event) => {
  if (!briefingDrag) return;
  event.preventDefault();
  moveBriefingDropPlaceholder(event.clientY);
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
});
elements["briefing-options"].addEventListener("drop", (event) => {
  if (!briefingDrag) return;
  event.preventDefault();
  moveBriefingDropPlaceholder(event.clientY);
  clearBriefingDrag({ save: true });
});
elements["briefing-options"].addEventListener("dragend", () => clearBriefingDrag());
elements["briefing-options"].addEventListener("keydown", (event) => {
  const option = event.target.closest("[data-briefing-option]");
  if (!option || event.target.closest("input") || option.getAttribute("aria-disabled") === "true") return;
  const key = option.dataset.briefingOption;
  if (event.key === "Escape" && briefingKeyboardDragKey) {
    briefingKeyboardDragKey = null;
    renderBriefingOptionOrder();
    return;
  }
  if ((event.key === " " || event.key === "Enter") && !briefingKeyboardDragKey) {
    event.preventDefault();
    briefingKeyboardDragKey = key;
    renderBriefingOptionOrder();
    return;
  }
  if (!briefingKeyboardDragKey || briefingKeyboardDragKey !== key || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  const order = briefingOptionOrderFromDom();
  const index = order.indexOf(key);
  const nextIndex = index + (event.key === "ArrowUp" ? -1 : 1);
  if (nextIndex < 0 || nextIndex >= order.length) return;
  [order[index], order[nextIndex]] = [order[nextIndex], order[index]];
  renderBriefingOptionOrder(order);
  void saveBriefingPreferences(order);
  option.focus();
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
  scheduleCurrentStepReturnUpdate();
});
window.matchMedia("(max-width: 900px)").addEventListener("change", () => {
  setReviewActionsOpen(false);
  if (!state.session) return;
  changeDiffView(preferredDiffLayout(), preferredDiffWrap(), false);
});
// Keep the code viewport below the actual toolbar, including text zoom/wrapping.
function updateMobileViewportHeight() {
  const viewport = window.visualViewport;
  // Keyboard resizing changes the visible height; pinch zoom must not relayout code.
  if (!viewport || viewport.scale !== 1) return;
  document.documentElement.style.setProperty("--mobile-viewport-height", `${viewport.height}px`);
}
window.visualViewport?.addEventListener("resize", updateMobileViewportHeight);
updateMobileViewportHeight();
new ResizeObserver(([entry]) => {
  document.documentElement.style.setProperty("--mobile-topbar-height", `${entry.target.getBoundingClientRect().height}px`);
}).observe(document.querySelector(".topbar"));
window.addEventListener("scroll", scheduleCurrentStepReturnUpdate, { passive: true });
elements["diff-panel"].addEventListener("scroll", scheduleCurrentStepReturnUpdate, { passive: true });
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
document.addEventListener("selectionchange", () => window.requestAnimationFrame(updateCodeSelectionToolbar));
elements["code-selection-toolbar"].addEventListener("pointerdown", (event) => event.preventDefault());
elements["code-selection-toolbar"].addEventListener("click", (event) => {
  const button = event.target.closest("[data-selection-tool]");
  const selected = state.codeSelection;
  if (!button || !selected || button.disabled) return;
  const tool = button.dataset.selectionTool;
  if (tool === "copy") {
    void navigator.clipboard.writeText(selected.text).then(() => toast("Selected code copied"), () => toast("Could not copy the selected code.", { tone: "warning" }));
  } else if (tool === "edit") {
    openInlineEdit(selected.endRow, selected);
  } else if (tool === "peek") {
    void resolvePeekSymbol(symbolForCodeSelection(selected).symbol, { path: selected.path, line: selected.startLine, side: selected.side });
  } else {
    const target = lineTarget(selected.startRow);
    openInlineCommentEditor(selected.endRow, target, null, { mode: tool === "ask" ? "ask" : "comment", endLine: selected.endLine, selection: selected });
  }
  hideCodeSelectionToolbar(true);
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
  void highlightRenderedCode();
  void highlightSymbolPeek();
  elements.diff.querySelectorAll(".inline-edit-form").forEach((form) => void highlightInlineEdit(form));
  if (state.session) renderArchitecture();
  if (state.session && state.activeTab === "call-flows") renderCallFlows();
  if (state.session && state.activeTab === "sequence") renderSequenceDiagrams();
});
elements["sessions-button"].addEventListener("click", () => { elements["settings-menu"].open = false; elements["sessions-dialog"].showModal(); void loadSessions(); });
elements["close-sessions"].addEventListener("click", () => elements["sessions-dialog"].close());
elements["show-archived-sessions"].addEventListener("change", loadSessions);
elements["about-button"].addEventListener("click", () => void openAboutDialog());
elements["close-about"].addEventListener("click", () => elements["about-dialog"].close());
elements["focus-mode-toggle"].addEventListener("click", () => void toggleFocusMode());
elements["shortcuts-button"].addEventListener("click", openShortcutHelp);
elements["close-shortcut-help"].addEventListener("click", () => elements["shortcut-help-dialog"].close());
elements["shortcut-help-dialog"].addEventListener("close", restoreShortcutHelpFocus);
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
document.getElementById("show-diff-markers").addEventListener("change", (event) => {
  state.showDiffMarkers = event.target.checked;
  window.localStorage.setItem(preferenceKey("show-diff-markers"), String(state.showDiffMarkers));
  syncDiffViewControls();
});
document.querySelectorAll("[data-diff-layout]").forEach(button => button.addEventListener("click", () => changeDiffView(button.dataset.diffLayout, state.diffWrap)));
document.querySelectorAll("[data-diff-wrap]").forEach(button => button.addEventListener("click", () => changeDiffView(state.diffLayout, button.dataset.diffWrap)));
new ResizeObserver(([entry]) => {
  if (entry.target.getBoundingClientRect().height > 0) {
    elements["diff-panel"].style.setProperty("--diff-toolbar-height", `${entry.target.getBoundingClientRect().height}px`);
  }
}).observe(document.querySelector('.diff-toolbar'));
elements["diff-tab"].addEventListener("click", () => activateReviewTab("diff"));
elements["call-flows-tab"].addEventListener("click", () => activateReviewTab("call-flows", renderCallFlows));
elements["sequence-tab"].addEventListener("click", () => activateReviewTab("sequence", renderSequenceDiagrams));
elements["findings-tab"].addEventListener("click", () => activateReviewTab("findings", renderFindings));
elements["findings-back"].addEventListener("click", returnToFindingCode);
elements["activity-tab"].addEventListener("click", () => activateReviewTab("activity", renderActivities));
elements["conversations-tab"].addEventListener("click", () => activateReviewTab("conversations", renderMessages));
elements["conversation-list"].addEventListener("click", (event) => {
  const button = event.target.closest("[data-conversation], [data-conversation-code]");
  if (!button) return;
  if (button.dataset.conversation) { openConversation(button.dataset.conversation); return; }
  const anchor = conversationThreads().find((thread) => thread.id === button.dataset.conversationCode)?.root.anchor;
  if (anchor) void showAnalysisFile(anchor.path, anchor.line, anchor.side);
});
elements["screenshots-tab"].addEventListener("click", () => activateReviewTab("screenshots", renderScreenshots));
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
function finishArchitectureDiagramDrag(event) {
  const drag = state.architectureDiagramDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  drag.diagram.classList.remove("dragging");
  if (drag.diagram.hasPointerCapture(event.pointerId)) drag.diagram.releasePointerCapture(event.pointerId);
  state.architectureDiagramDrag = null;
}

function registerArchitectureDiagramInteractions(container) {
  container.addEventListener("click", (event) => {
    const briefingExpandButton = event.target.closest("[data-briefing-diagram-expand]");
    if (briefingExpandButton) {
      openBriefingDiagramViewer(briefingExpandButton.dataset.briefingDiagramExpand, briefingExpandButton.dataset.briefingDiagramId);
      return;
    }
    const expandButton = event.target.closest("[data-diagram-expand]");
    if (expandButton) {
      openArchitectureDiagramViewer(expandButton.dataset.diagramExpand);
      return;
    }
    const diagramAction = event.target.closest("[data-diagram-action]");
    if (diagramAction) {
      const shell = diagramAction.closest("[data-architecture-key]");
      if (shell) changeArchitectureDiagramView(shell.dataset.architectureKey, diagramAction.dataset.diagramAction);
      return;
    }
    const fileButton = event.target.closest("[data-flow-file]");
    if (fileButton) void showAnalysisFile(fileButton.dataset.flowFile);
  });
  container.addEventListener("pointerdown", (event) => {
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
  container.addEventListener("pointermove", (event) => {
    const drag = state.architectureDiagramDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const view = architectureDiagramView(drag.key);
    view.x = drag.originX + event.clientX - drag.startX;
    view.y = drag.originY + event.clientY - drag.startY;
    applyArchitectureDiagramView(drag.key);
  });
  container.addEventListener("pointerup", finishArchitectureDiagramDrag);
  container.addEventListener("pointercancel", finishArchitectureDiagramDrag);
  container.addEventListener("keydown", (event) => {
    const diagram = event.target.closest(".architecture-diagram[data-architecture-diagram]");
    if (!diagram) return;
    const action = ({ ArrowLeft: "move-left", ArrowRight: "move-right", ArrowUp: "move-up", ArrowDown: "move-down", "+": "zoom-in", "=": "zoom-in", "-": "zoom-out", "0": "reset" })[event.key];
    if (!action) return;
    event.preventDefault();
    changeArchitectureDiagramView(diagram.dataset.architectureDiagram, action);
  });
}

registerArchitectureDiagramInteractions(elements["tour-intro-architecture"]);
registerArchitectureDiagramInteractions(elements["tour-intro-sequence"]);
registerArchitectureDiagramInteractions(elements["tour-intro-call-flows"]);
registerArchitectureDiagramInteractions(elements.architecture);
registerArchitectureDiagramInteractions(elements["architecture-viewer-dialog"]);
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
        : nextTab === "conversations" ? renderMessages
          : nextTab === "screenshots" ? renderScreenshots
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
  void performActivityAction(card.dataset.activityId, actionButton.dataset.activityAction);
});

elements.diff.addEventListener("submit", (event) => {
  const commentForm = event.target.closest(".inline-comment-form");
  if (commentForm) {
    event.preventDefault();
    if (commentForm.dataset.composerMode === "ask") void submitInlineAsk(commentForm);
    else void saveInlineComment(commentForm);
    return;
  }
  const form = event.target.closest(".inline-edit-form");
  if (!form) return;
  event.preventDefault();
  if (state.busy || !reviewIsOpen()) return;
  const replacement = form.elements.replacement.value;
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  void (async () => {
    try {
      const result = await api("/api/edits", {
        method: "POST",
        body: JSON.stringify({
          path: form.dataset.editPath,
          side: "new",
          line: Number(form.dataset.editLine),
          endLine: Number(form.dataset.editEndLine),
          expectedContent: form.dataset.editExpected,
          replacement,
        }),
      });
      state.session = result.session;
      const path = form.dataset.editPath;
      renderSession();
      await showActivityFile(result.activityId, path);
      toast("Reviewer suggestion created. Apply or reject it after previewing the diff.");
    } catch (error) {
      toast(error.message, { tone: "warning", duration: 6_000 });
      submit.disabled = false;
    }
  })();
});

let inlineEditHighlightTimer = null;
elements.diff.addEventListener("input", (event) => {
  const form = event.target.closest?.(".inline-edit-form");
  if (!form || event.target.name !== "replacement") return;
  const mirror = form.querySelector(".inline-edit-highlight code");
  if (mirror) mirror.textContent = event.target.value || " ";
  syncInlineEditScroll(event.target);
  window.clearTimeout(inlineEditHighlightTimer);
  inlineEditHighlightTimer = window.setTimeout(() => void highlightInlineEdit(form), 90);
});

elements.diff.addEventListener("click", (event) => {
  const sourceView = event.target.closest("[data-source-view]");
  if (sourceView) {
    state.repositoryFileView = sourceView.dataset.sourceView;
    renderRepositoryFile(state.repositoryFilePath, state.repositoryFileContent);
    return;
  }
  const markdownPreview = event.target.closest("[data-markdown-preview]");
  if (markdownPreview) {
    const path = markdownPreview.dataset.markdownPreview;
    if (state.markdownPreviewPaths.has(path)) state.markdownPreviewPaths.delete(path);
    else state.markdownPreviewPaths.add(path);
    renderDiff(state.renderedDiffFiles, currentDiffRenderOptions());
    renderComments();
    renderFindings();
    renderTourAnnotation();
    return;
  }
  const conversation = event.target.closest("[data-conversation]");
  if (conversation) { event.stopPropagation(); openConversation(conversation.dataset.conversation); return; }
  const previewAction = event.target.closest("[data-preview-activity-action]");
  if (previewAction) {
    void performActivityAction(previewAction.dataset.previewActivityId, previewAction.dataset.previewActivityAction);
    return;
  }
  if (event.target.closest("[data-inline-edit-cancel]")) {
    closeInlineEdit();
    return;
  }
  const inlineAction = event.target.closest("[data-inline-comment-action]");
  if (inlineAction) {
    const comment = state.session.comments.find((candidate) => candidate.id === inlineAction.dataset.inlineCommentId);
    if (!comment || !reviewIsOpen()) return;
    const action = inlineAction.dataset.inlineCommentAction;
    if (action === "edit") void openCommentEditor(comment);
    else if (action === "delete") { state.deletingCommentId = comment.id; renderComments(); }
    else if (action === "cancel-delete") { state.deletingCommentId = null; renderComments(); }
    else if (action === "confirm-delete") void deleteReviewComment(comment);
    return;
  }
  const inlineComment = event.target.closest("[data-inline-comment-id]");
  if (inlineComment) {
    const comment = state.session.comments.find((candidate) => candidate.id === inlineComment.dataset.inlineCommentId);
    if (comment && reviewIsOpen()) void openCommentEditor(comment);
    return;
  }
  const collapseButton = event.target.closest("[data-collapse-file]");
  if (collapseButton) {
    const path = collapseButton.dataset.collapseFile;
    if (state.collapsedFiles.has(path)) state.collapsedFiles.delete(path);
    else state.collapsedFiles.add(path);
    const files = state.proposalPreview ? state.renderedDiffFiles : visibleDiffFiles();
    renderDiff(files, currentDiffRenderOptions());
    renderTourAnnotation();
    return;
  }
  const expansionButton = event.target.closest("[data-expand-file]");
  if (expansionButton) {
    void showChangedFile(expansionButton.dataset.expandFile, undefined, undefined, 0, undefined, expansionButton.dataset.fileExpansion === "full", expansionButton);
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
    void showChangedFile(contextButton.dataset.expandContext, undefined, undefined, 0, next, undefined, contextButton);
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
  const composerMode = event.target.closest("[data-inline-composer-mode]");
  if (composerMode) {
    updateInlineComposerMode(composerMode.closest(".inline-comment-form"), composerMode.dataset.inlineComposerMode);
    return;
  }
  const imageTool = event.target.closest("[data-image-tool]");
  if (imageTool) {
    const image = imageTool.closest(".image-diff-side");
    if (!image || imageTool.disabled) return;
    if (imageTool.dataset.imageTool === "comment") openLineComment(image);
    else askAboutLine(image);
    return;
  }
  if (!reviewIsOpen()) return;
  const row = event.target.closest(".diff-row");
  if (!row || !row.dataset.line) return;
  const browserSelection = window.getSelection();
  if (state.codeSelection || (browserSelection && !browserSelection.isCollapsed)) return;
  if (event.target.closest(".line-action")) {
    elements.diff.querySelectorAll(".line-action").forEach((action) => { action.tabIndex = -1; });
    event.target.closest(".line-action").tabIndex = 0;
  }
  openLineComment(row);
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
  if (event.target.matches?.('.inline-edit-form textarea[name="replacement"]')) {
    syncInlineEditScroll(event.target);
    return;
  }
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
  if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
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
  if (narrowFilePanelLayout()) setFilePanelOpen(false);
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
  if (action === "save-disposition") {
    const disposition = item.querySelector("[data-finding-disposition]")?.value;
    const note = item.querySelector("[data-finding-note]")?.value.trim();
    try {
      state.session = await api(`/api/findings/${encodeURIComponent(finding.id)}`, {
        method: "PATCH",
        body: JSON.stringify(disposition ? { action: "set-disposition", disposition, note: note || undefined } : { action: "reopen" }),
      });
      renderSession();
      toast(disposition ? `Finding marked ${findingDispositionLabel(disposition).toLowerCase()}` : "Finding reopened");
    } catch (error) {
      toast(error.message);
    }
    return;
  }
  if (!reviewIsOpen()) return;
  try {
    const publishFinding = action === "publish-finding";
    state.session = await api(`/api/findings/${encodeURIComponent(finding.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ action: publishFinding ? "convert" : action, ...(publishFinding ? { publish: true } : {}) }),
    });
    renderSession();
    toast(publishFinding ? "Finding added to the pending PR review" : action === "convert" ? "Finding added to review feedback" : action === "dismiss" ? "Finding deferred" : "Finding reopened");
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
  if (action === "edit") return void openCommentEditor(comment);
  if (action === "delete") { state.deletingCommentId = comment.id; renderComments(); }
  if (action === "cancel-delete") { state.deletingCommentId = null; renderComments(); }
  if (action === "confirm-delete") void deleteReviewComment(comment);
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
elements["current-step-return"].addEventListener("click", () => void focusCurrentStep());
setFilePanelOpen(false);
renderFocusMode();

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
      const previousSession = state.session;
      const previousStatus = previousSession?.status;
      state.session = latest;
      beginCloseCountdownForTransition(previousStatus, latest);
      if (pendingLocalActivity) state.session.agentActivity = pendingLocalActivity;
      const navigatedWithinPhase = renderSessionUpdate(previousSession);
      if (navigatedWithinPhase) void focusCurrentStep();
    }
  } catch {
    if (!state.session || reviewIsOpen()) elements["connection-banner"].classList.remove("hidden");
  } finally {
    if (generation === state.pollGeneration) state.pollInFlight = false;
  }
}, 2_000);

window.setInterval(checkForUpdate, 6 * 60 * 60 * 1_000);
