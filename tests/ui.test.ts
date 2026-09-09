import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

test("review navigation exposes expanded changed paths and a full repository mode", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(join(root, "public/index.html"), "utf8"),
    readFile(join(root, "public/app.js"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  expect(html).toContain('<select id="tree-mode"');
  expect(html).toContain('<option value="changes">Changed paths</option>');
  expect(html).toContain('<option value="repository">Full repository</option>');
  expect(app).toContain("renderChangedPathList(changedFiles)");
  expect(app).toContain("renderTreeNode(treeFromFiles(repositoryFiles, changedFiles))");
  expect(html).toContain('id="file-resizer"');
  expect(html).toContain('id="agent-resizer"');
  expect(html).toContain('id="file-panel-collapse"');
  expect(html).toContain('id="agent-panel-collapse"');
  expect(app).toContain("setFilePanelWidth(fileResizeStart.width + event.clientX - fileResizeStart.x)");
  expect(app).toContain("setAgentPanelWidth(agentResizeStart.width + agentResizeStart.x - event.clientX)");
  expect(app).toContain("state.session.pullRequest?.sourceRepositoryRoot ?? state.session.comparison.repositoryRoot");
  expect(styles).toContain("grid-template-columns: var(--file-panel-width)");
  expect(styles).toContain("var(--agent-panel-width)");
  expect(styles).toContain(".workspace.file-pane-collapsed");
  expect(styles).toContain(".workspace.agent-pane-collapsed");
  expect(app).toContain('setPaneCollapsed("file", !state.filePanelCollapsed, true)');
  expect(app).toContain('setPaneCollapsed("agent", !state.agentPanelCollapsed, true)');
  expect(app).not.toContain('id="changed-only"');
  expect(styles).toContain(".count, .mode { flex: 0 0 auto; white-space: nowrap;");
});

test("the file pane starts on unreviewed files and has clearer hierarchy controls", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(join(root, "public/index.html"), "utf8"),
    readFile(join(root, "public/app.js"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  expect(html).toContain('<option value="unreviewed" selected>Unreviewed</option>');
  expect(html).toContain('<option value="tour">All files in this tour</option>');
  expect(html).toContain('<option value="">All changed files</option>');
  expect(app).toContain('reviewFilter: "unreviewed"');
  expect(app).toContain('state.reviewFilter === "tour"');
  expect(app).toContain("tourPaths.has(file.path)");
  expect(styles).toContain('font-size: 17px; font-weight: 800;');
  expect(styles).toContain('.tree-children { margin-left: 10px; border-left: 1px solid var(--border-soft);');
});

test("checkpoints use an in-app themed dialog instead of a browser prompt", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(join(root, "public/index.html"), "utf8"),
    readFile(join(root, "public/app.js"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  expect(html).toContain('<dialog id="checkpoint-dialog" class="checkpoint-dialog"');
  expect(html).toContain('id="checkpoint-label"');
  expect(html).toContain("Save checkpoint");
  expect(app).toContain('elements["checkpoint-dialog"].showModal()');
  expect(app).toContain("async function saveCheckpoint()");
  expect(app).not.toContain('window.prompt("Checkpoint label');
  expect(styles).toContain(".checkpoint-dialog");
});

test("revision history exposes labelled checkpoint deletion with outside-click dismissal", async () => {
  const [app, styles] = await Promise.all([
    readFile(join(root, "public/app.js"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  expect(app).toContain('data-checkpoint-action="delete"');
  expect(app).toContain('method: "DELETE"');
  expect(app).toContain('elements["revision-history"].open = false');
  expect(styles).toContain(".checkpoint-history-actions");
});

test("refresh expands files that changed since the review checkpoint", async () => {
  const app = await readFile(join(root, "public", "app.js"), "utf8");
  const source = app.slice(app.indexOf("function expandFilesChangedByRefresh"), app.indexOf("async function refresh()"));
  const state = { collapsedFiles: new Set(["src/cart.ts", "README.md"]) };
  const expandFilesChangedByRefresh = new Function("state", `${source}; return expandFilesChangedByRefresh;`)(state) as (session: unknown) => void;
  expandFilesChangedByRefresh({ revisionSummary: { newFiles: ["new.ts"], changedAgainFiles: ["src/cart.ts"] } });
  expect([...state.collapsedFiles]).toEqual(["README.md"]);
});

test("comparison view switching reopens the changed-since-checkpoint files", async () => {
  const app = await readFile(join(root, "public", "app.js"), "utf8");
  const source = app.slice(app.indexOf("async function switchComparisonView"), app.indexOf("async function createCheckpoint"));
  expect(source).toContain("expandFilesChangedByRefresh(state.session)");
});

test("the tour file filter combines reviewed and unreviewed files from every phase", async () => {
  const app = await readFile(join(root, "public", "app.js"), "utf8");
  const source = app.slice(app.indexOf("function filteredChangedFiles()"), app.indexOf("function renderFileTree()"));
  const state = {
    tourMode: null,
    reviewFilter: "tour",
    statusFilter: "",
    testFilesOnly: false,
    searchQuery: "",
    searchMatches: null,
    session: {
      reviewedFiles: ["src/reviewed.ts", "src/not-in-tour.ts"],
      comparison: { files: [
        { path: "src/reviewed.ts", status: "modified" },
        { path: "src/unreviewed.ts", status: "added" },
        { path: "src/not-in-tour.ts", status: "modified" },
      ] },
      outline: { phases: [
        { fileChanges: [{ path: "src/reviewed.ts" }] },
        { fileChanges: [{ path: "src/unreviewed.ts" }] },
      ] },
    },
  };
  const filteredChangedFiles = new Function("state", "currentPhase", "isTestFile", `${source}; return filteredChangedFiles;`)(state, () => null, () => false) as () => Array<{ path: string }>;

  expect(filteredChangedFiles().map((file) => file.path)).toEqual(["src/reviewed.ts", "src/unreviewed.ts"]);
});

test("narrow layouts expose the changed files as a dismissible drawer", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(join(root, "public/index.html"), "utf8"),
    readFile(join(root, "public/app.js"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  expect(html).toContain('id="file-panel-toggle"');
  expect(html).toContain('aria-controls="file-panel"');
  expect(html).toContain('id="file-panel-close"');
  expect(html).toContain('id="file-panel-backdrop"');
  expect(app).toContain('function setFilePanelOpen(open, { restoreFocus = false } = {})');
  expect(app).toContain('window.matchMedia("(max-width: 900px)").matches');
  expect(app).toContain('if (event.key === "Escape" && state.filePanelOpen)');
  expect(app).toContain('elements["file-panel"].inert = narrowFilePanelLayout() && !state.filePanelOpen');
  expect(app).toContain('if (narrowFilePanelLayout()) setFilePanelOpen(false)');
  expect(styles).toContain('.file-panel-open .file-panel { transform: translateX(0); }');
  expect(styles).toContain('width: min(340px, 88vw)');
  expect(styles).toContain('.file-panel-backdrop { position: fixed;');
});

test("the file pane can filter changed test files without changing the default", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(join(root, "public/index.html"), "utf8"),
    readFile(join(root, "public/app.js"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  expect(html).toContain('id="test-files-filter"');
  expect(html).toContain('aria-pressed="false"');
  expect(html).toContain("Test files only");
  expect(app).toContain('testFilesOnly: false');
  expect(app).toContain("function isTestFile(path)");
  expect(app).toContain("(!state.testFilesOnly || isTestFile(file.path))");
  expect(app).toContain('state.testFilesOnly = !state.testFilesOnly');
  expect(app).toContain('elements["test-files-filter"].disabled = Boolean(state.tourMode)');
  expect(app).toContain("async function ensureReviewDiffs()");
  expect(app).toContain('return files.map((file) => state.diffCache.get(file.path)).filter(Boolean)');
  expect(styles).toContain(".file-filter-toggle.active");
  expect(html).toContain('id="tour-filter-note"');
  expect(html).toContain("The tour controls this file list. Exit the tour to use filters.");
  expect(app).toContain('elements["tour-filter-note"].classList.toggle("hidden", !state.tourMode)');
  expect(app).toContain('elements["file-panel"].title = state.tourMode ? tourFilterMessage : ""');
  expect(styles).toContain(".tour-filter-note");

  const helperSource = app.slice(app.indexOf("function isTestFile(path)"), app.indexOf("function renderTreeNode("));
  const isTestFile = new Function(`${helperSource}; return isTestFile;`)() as (path: string) => boolean;
  expect(isTestFile("src/commonTest/kotlin/CartTest.kt")).toBe(true);
  expect(isTestFile("src/__tests__/cart.ts")).toBe(true);
  expect(isTestFile("src/cart.test.ts")).toBe(true);
  expect(isTestFile("src/cart_test.py")).toBe(true);
  expect(isTestFile("iosApp/CheckoutTests.swift")).toBe(true);
  expect(isTestFile("src/cart.ts")).toBe(false);
  expect(isTestFile("docs/testing-guide.md")).toBe(false);
});

test("tour rendering annotates code without continuously stealing navigation", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(join(root, "public/index.html"), "utf8"),
    readFile(join(root, "public/app.js"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  const renderTour = app.slice(app.indexOf("function renderTour()"), app.indexOf("function renderFilteredDiff()"));
  expect(app).toContain('const isNext = index === activeStepIndex + 1');
  expect(app).toContain('note.className = `tour-code-note${isCurrent ? " active" : isNext ? " next" : ""}`');
  expect(app).toContain('isNext ? "Next stop"');
  expect(app).toContain("compactText(step.objective, 180)");
  expect(app).toContain('anchors[0].classList.add("tour-anchor-start")');
  expect(app).toContain('anchors.at(-1).classList.add("tour-anchor-end")');
  expect(app).toContain("const anchors = rows.length > 0 ? rows : markdownBlocks");
  expect(styles).toContain(".diff-row.tour-anchor-start");
  expect(styles).toContain(".tour-code-note.next {");
  expect(app).toContain("const phase = currentPhase()");
  expect(app).toContain("for (let index = phase.steps.length - 1; index >= 0; index -= 1)");
  expect(app).toContain('insertAdjacentElement("beforebegin", note)');
  expect(app).toContain('document.querySelector(".tour-code-note.active")');
  expect(app).toContain("async function focusCurrentStep()");
  expect(html).toContain('id="current-step-return"');
  expect(app).toContain("function updateCurrentStepReturnVisibility()");
  expect(app).toContain('elements["diff-panel"].addEventListener("scroll", scheduleCurrentStepReturnUpdate');
  expect(app).toContain('elements["current-step-return"].addEventListener("click", () => void focusCurrentStep())');
  expect(styles).toContain(".current-step-return { position: fixed;");
  expect(renderTour).not.toContain("scrollIntoView");
  expect(renderTour).not.toContain("showChangedFile");
  expect(app).not.toContain("Planning tour · 0s");
  expect(app).toContain('`Phase ${phaseIndex + 1} of ${outline.phases.length}: Stop ${stopInPhase + 1} of ${phase.steps.length} (Step ${currentStepIndex + 1})`');
});

test("agent answers scroll into view without hiding the reviewer question", async () => {
  const app = await readFile(join(root, "public/app.js"), "utf8");
  const askAgent = app.slice(app.indexOf("async function askAgent"), app.indexOf("async function close"));
  expect(app).toContain('data-message-id="${escapeHtml(message.id)}"');
  expect(app).toContain("function revealAgentAnswer(questionId)");
  expect(app).toContain("Math.max(scroll.scrollTop, Math.min(questionTop, revealBottom))");
  expect(app).toContain('scroll.scrollTo({ top: target, behavior: "smooth" })');
  expect(app).toContain("requestAnimationFrame(() => revealAgentAnswer(answeredQuestionId))");
  expect(askAgent).toContain("state.questionPending = true");
  expect(askAgent).toContain("state.questionPending = false");
  expect(askAgent).not.toContain('setBusy(true, "The agent is responding…")');
  expect(app).toContain('elements["next-step"].disabled = state.busy || !reviewIsOpen()');
});

test("the questions pane uses compact, responsive conversation controls", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(join(root, "public/index.html"), "utf8"),
    readFile(join(root, "public/app.js"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  expect(html).toContain('class="questions-toggle"');
  expect(html).toContain('class="questions-new"');
  expect(html).toContain('class="conversation-picker-label">Conversation</span>');
  expect(app).toContain('textContent = `Questions (${conversationThreads().length})`');
  expect(styles).toContain('.questions-toggle[aria-expanded="true"]::before');
  expect(styles).toContain('.conversation-picker select { width: 100%; min-width: 0;');
  expect(styles).toContain('appearance: none;');
});

test("questions support removable line and file context while review decisions are explicit", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(join(root, "public/index.html"), "utf8"),
    readFile(join(root, "public/app.js"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  expect(html).toContain('id="add-question-files"');
  expect(html).toContain('id="question-files-dialog"');
  expect(app).toContain("data-remove-line-context");
  expect(app).toContain("data-remove-question-file");
  expect(app).toContain("contextPaths: contextPaths.length ? contextPaths : undefined");
  expect(styles).toContain(".question-context-chip");
  expect(html).toContain(">Request changes</button>");
  expect(html).toContain(">Approve with comments</button>");
  expect(html).toContain(">Approve</button>");
  expect(html).toContain('id="close-review-button"');
  expect(html).toContain(">Close review</button>");
  expect(app).toContain('openReviewDecision("approve-with-comments")');
  expect(app).toContain('openReviewDecision("request-changes")');
  expect(app).toContain('window.confirm("Close this review without approving or requesting changes?")');
  expect(app).toContain('void close("cancelled", "cancel")');
});

test("closing a review shows a five-second self-close countdown", async () => {
  const [html, app] = await Promise.all([
    readFile(join(root, "public/index.html"), "utf8"),
    readFile(join(root, "public/app.js"), "utf8"),
  ]);
  expect(html).toContain('id="cancel-auto-close"');
  expect(html).toContain(">Cancel auto-close</button>");
  expect(app).toContain("function beginCloseCountdown(message)");
  expect(app).toContain("function cancelCloseCountdown()");
  expect(app).toContain("state.closeCountdownSeconds = 5");
  expect(app).toContain('`You can close this window, or it will close in ${seconds} ${seconds === 1 ? "second" : "seconds"}.`');
  expect(app).toContain("window.close()");
  expect(app).toContain("if (window.closed) return");
  expect(app).toContain("function beginCloseCountdownForTransition(previousStatus, result)");
  expect(app).toContain('previousStatus !== "open"');
  expect(app).toContain("beginCloseCountdownForTransition(previousStatus, result)");
  expect(app).toContain("beginCloseCountdownForTransition(previousStatus, latest)");
  expect(app).toContain('`${state.closeCountdownMessage} You can close this window.`');
  expect(app).toContain('elements["cancel-auto-close"].addEventListener("click", cancelCloseCountdown)');
});

test("slow tour work exposes its prompt and safe progress while navigation remains busy", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(join(root, "public/index.html"), "utf8"),
    readFile(join(root, "public/app.js"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  expect(html).toContain('id="agent-activity"');
  expect(html).toContain('id="agent-activity-body"');
  expect(app).toContain("function renderAgentActivity()");
  expect(app).toContain('isQuestion ? elements["chat-messages"] : elements["step-explanation"]');
  expect(app).toContain("Current prompt");
  expect(app).toContain("elapsed");
  expect(app).toContain('const promptWasOpen = renderedActivityId === activity.id');
  expect(app).toContain('promptWasOpen ? " open" : ""');
  expect(app).toContain('dataset.contentKey !== contentKey');
  expect(app).toContain('querySelector(".agent-activity-elapsed").textContent');
  expect(app).toContain("the tour will switch to a local fallback agent automatically");
  expect(app).toContain('const prefetchSteps = state.session.preferences?.prefetchSteps ?? 5');
  expect(app).toContain('`We prepare ${prefetchSteps} ${prefetchSteps === 1 ? "step" : "steps"} in advance.`');
  expect(app).toContain('state.session.agentActivity = latest.agentActivity');
  expect(app).toContain('state.expectedAgentActivity = { kind: "review.question", previousActivityId }');
  expect(app).toContain("Your question is being sent now while tour preparation continues.");
  expect(app).toContain('elements["previous-step"].disabled = busy && state.navigationDirection !== "next"');
  expect(app).toContain('if (state.busy && !(direction === "previous" && state.navigationDirection === "next")) return');
  expect(app).toContain("const generation = ++state.navigationGeneration");
  expect(app).toContain("if (generation !== state.navigationGeneration) return");
  expect(app).toContain("receivedExpectedActivity");
  expect(app).toContain("!expectedActivity || receivedExpectedActivity");
  expect(app).toContain("if (pendingLocalActivity) state.session.agentActivity = pendingLocalActivity");
  expect(app).not.toContain('toast("Review connected and up to date.")');
  expect(app).not.toContain("if (state.busy || state.pollInFlight");
  expect(app).not.toContain("if (state.busy && state.session)");
  expect(styles).toContain(".agent-progress-list");
  expect(styles).toContain(".agent-prompt pre");
  expect(styles).toContain(".agent-activity-warning");
});

test("tour mode scopes diffs to the current phase and can restore the baseline review", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(join(root, "public/index.html"), "utf8"),
    readFile(join(root, "public/app.js"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  expect(html).toContain('id="tour-mode-toggle"');
  expect(app).toContain("if (phasePaths) return state.session.comparison.files.filter((file) => phasePaths.has(file.path))");
  expect(app).toContain('const changedPathsOnly = state.tourMode || state.treeMode === "changes" || filtering');
  expect(app).toContain("async function ensureTourPhaseDiffs()");
  expect(app).toContain('elements["tour-mode-toggle"].textContent = state.tourMode ? "Exit tour" : "Resume tour"');
  expect(app).toContain('toast("Tour exited. All changed files are visible.")');
  expect(app).toContain('toast("Tour resumed. Diffs are scoped to this phase.")');
  expect(app).toContain('{ duration: 9_000, tone: "warning" }');
  expect(app).toContain("window.clearTimeout(state.toastTimer)");
  expect(styles).toContain(".toast.warning { display: flex;");
  expect(app).toContain('elements["diff-search"].disabled = Boolean(state.tourMode)');
  expect(html).not.toContain('id="large-diff-notice"');
  expect(app).not.toContain('elements["large-diff-notice"]');
  expect(styles).toContain(".tour-overview-heading");
});

test("syntax highlighting is local and Mermaid diagrams render as strict SVG with source fallback", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(join(root, "public/index.html"), "utf8"),
    readFile(join(root, "public/app.js"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  expect(html).toContain('<script src="/mermaid.min.js"></script>');
  expect(app).toContain('api("/api/highlight"');
  expect(app).toContain('securityLevel: "strict"');
  expect(app).toContain("window.mermaid.render");
  expect(app).not.toContain("function parseSequence(");
  expect(styles).toContain('.syntax-token.sl-d73a49');
  expect(styles).toContain('.syntax-token.sd-f97583');
  expect(styles).toContain(".sequence-diagram svg");
});

test("phase files start collapsed and scoped findings are separated from the complete findings view", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(join(root, "public/index.html"), "utf8"),
    readFile(join(root, "public/app.js"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  expect(html).toContain('id="findings-tab"');
  expect(html).toContain('id="phase-files"');
  expect(html).toContain('<details id="phase-files-details" class="phase-files-details">');
  expect(html).not.toContain('<details id="phase-files-details" class="phase-files-details" open>');
  expect(app).toContain('elements["phase-files-details"].open = false');
  expect(app).toContain("state.renderedPhaseId !== phase.id");
  expect(html).toContain('id="phase-finding-list"');
  expect(html).toContain('<details id="phase-finding-drawer" class="finding-drawer phase-findings-details">');
  expect(html).not.toContain('<details id="phase-finding-drawer" class="finding-drawer phase-findings-details" open>');
  expect(app).toContain('elements["phase-finding-drawer"].open = false');
  expect(app).toContain("function findingSummary(finding)");
  expect(app).toContain("findingCards(phaseFindings, true)");
  expect(app).toContain("findingSummary(finding)");
  expect(app).toContain('class="compact-finding-file" data-action="jump"');
  expect(app).toContain('class="text-button" data-action="open-finding" type="button">View finding</button>');
  expect(app).toContain('if (action === "open-finding")');
  expect(app).toContain("openFindingFromCode(finding.id)");
  expect(app).toContain('if (action === "jump") {\n    event.preventDefault();');
  expect(app).toContain("return showChangedFile(finding.path, finding.line, finding.side)");
  expect(html).toContain('id="all-findings-list"');
  expect(html).toContain('id="findings-back"');
  expect(app).toContain("finding.stepId === step?.id");
  expect(app).toContain("finding.phaseId === phase?.id && !finding.stepId");
  expect(app).toContain("elements[\"all-findings-list\"].innerHTML = findingCards(findings)");
  expect(app).toContain('state.activeTab = "findings"');
  expect(app).toContain("openFindingFromCode(findingPin.dataset.findingId)");
  expect(app).toContain('classList.toggle("hidden", !state.findingReturn)');
  expect(app).toContain('data-tooltip="${escapeHtml(summary)}"');
  expect(app).toContain('finding.outdated ? "(needs reassessment) " : ""');
  expect(app).toContain('finding.outdated ? " needs-reassessment" : ""');
  expect(app).toContain("evidence.open = true");
  expect(app).toContain('const findingDispositionLabels = {');
  expect(app).toContain('accepted: "Risk accepted"');
  expect(app).toContain('fixed: "Fixed (verified)"');
  expect(app).toContain('"false-positive": "False positive"');
  expect(app).toContain('data-finding-disposition');
  expect(app).toContain('data-finding-note');
  expect(app).toContain('data-action="save-disposition"');
  expect(app).toContain('action: "set-disposition"');
  expect(app).toContain('Finding marked ${findingDispositionLabel(disposition).toLowerCase()}');
  expect(app).toContain('class="finding-disposition ${escapeHtml(disposition)}"');
  expect(app).toContain("finding.outdated ? '<span class=\"finding-reassessment\">Needs reassessment</span>' : \"\"");
  expect(app).toContain('finding.outdated ? "Revalidate" : "Add as feedback"');
  expect(app).not.toContain('finding.outdated ? " disabled" : ""');
  expect(styles).toContain(".finding-badges .finding-reassessment");
  expect(styles).toContain(".finding-pin.needs-reassessment");
  expect(styles).toContain(".finding-badges .finding-disposition.accepted");
  expect(styles).toContain(".finding-badges .finding-disposition.false-positive");
  expect(styles).toContain(".finding-badges .finding-disposition.intentional");
  expect(styles).toContain(".finding-badges .finding-disposition.deferred");
  expect(styles).toContain(".finding-badges .finding-disposition.obsolete-after-refresh");
  expect(styles).toContain(".finding-item.obsolete-after-refresh");
});

test("current stop findings can be collapsed without hiding their count", async () => {
  const [html, styles] = await Promise.all([
    readFile(join(root, "public/index.html"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  expect(html).toContain('<details id="finding-drawer" class="finding-drawer current-step-findings" aria-labelledby="finding-drawer-title" open>');
  expect(html).toContain('<summary class="comment-drawer-heading">');
  expect(styles).toContain(".current-step-findings[open] > summary::before");
});

test("stable tour and pull request context render above the diff instead of inside the agent scroll", async () => {
  const [html, app] = await Promise.all([
    readFile(join(root, "public/index.html"), "utf8"),
    readFile(join(root, "public/app.js"), "utf8"),
  ]);
  const overview = html.indexOf('id="review-overview"');
  const toolbar = html.indexOf('class="diff-toolbar"');
  const agent = html.indexOf('class="agent-panel"');
  expect(overview).toBeGreaterThan(0);
  expect(overview).toBeLessThan(toolbar);
  expect(html).toContain('id="pull-request-description-body"');
  expect(html).not.toContain('<details id="pull-request-description" class="pull-request-description hidden" open>');
  const architecture = html.indexOf('<details id="architecture" class="architecture hidden">');
  expect(architecture).toBeGreaterThan(overview);
  expect(architecture).toBeLessThan(toolbar);
  expect(html).toContain("<summary>Architecture</summary>");
  expect(html).not.toContain('<details id="architecture" class="architecture hidden" open>');
  expect(html.slice(agent)).not.toContain('id="review-overview-title"');
  expect(app).toContain("pullRequestDescription(pullRequest.body)");
  expect(app).toContain('data-pr-description-mode="rendered"');
  expect(app).toContain('data-pr-description-mode="source"');
  expect(app).toContain('markdownSourceBlock(`<h${level}>');
  expect(app).toContain('const nextListType = /^\\d/.test(item[1]) ? "ol" : "ul"');
  expect(app).toContain('elements["review-overview-title"].textContent = outline.title');
  expect(app).toContain('label: `${outline.behaviorArchitectureStatus === "proposed" ? "Proposed" : "Implemented"} behaviour`');
  expect(app).toContain('label: "Implementation journey"');
});

test("agent-launched tours introduce the change before navigating to the first stop", async () => {
  const [html, app, cli, styles] = await Promise.all([
    readFile(join(root, "public/index.html"), "utf8"),
    readFile(join(root, "public/app.js"), "utf8"),
    readFile(join(root, "src/cli.ts"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  expect(cli).toContain('options.startTour ? "&intro=1" : ""');
  expect(cli).toContain("if (options.attached && options.open) options.startTour = true");
  expect(cli).toContain("if (!deferReviewUrl) console.log(`Code Review Tour: ${reviewUrl}`)");
  expect(html).toContain('id="tour-intro-dialog"');
  expect(html).toContain('id="begin-tour"');
  expect(html).toContain('id="tour-intro-architecture"');
  expect(html).toContain('id="tour-intro-sequence"');
  expect(html).toContain('id="tour-intro-call-flows"');
  expect(app).toContain('tourIntroPending: launchTourIntro');
  expect(app).toContain('state.session.pullRequest?.title ?? outline?.title ?? `${state.session.comparison.repositoryName} review briefing`');
  expect(app).toContain('if (state.session.outline && state.focusedStepId === null && !state.tourIntroPending)');
  expect(app).toContain('state.focusedStepId = state.tourIntroPending ? null : currentStep()?.id ?? null');
  expect(app).toContain('if (!state.tourIntroPending) await focusCurrentStep()');
  expect(app).toContain('elements["tour-intro-dialog"].showModal()');
  expect(app).toContain('state.session.preferences?.showBriefing === false');
  expect(app).toContain('state.tourIntroPending = false');
  expect(app).toContain('if (!state.session.outline) {');
  expect(app).toContain('void startTour();');
  expect(app).toContain('await focusCurrentStep()');
  expect(styles.match(/\.tour-intro-dialog \{[^}]*\}/)?.[0]).not.toContain("display: grid");
  expect(styles).toContain('.tour-intro-dialog[open] { display: grid; }');
  expect(styles).toContain('.tour-intro-architecture');
});

test("every statically referenced UI element is registered before the first render", async () => {
  const app = await readFile(join(root, "public/app.js"), "utf8");
  const registry = app.slice(app.indexOf("const elements = Object.fromEntries("), app.indexOf("document.documentElement.dataset.syntaxTheme"));
  const registered = new Set([...registry.matchAll(/"([a-z][a-z0-9-]+)"/g)].map((match) => match[1]));
  const referenced = new Set([...app.matchAll(/elements\["([a-z][a-z0-9-]+)"\]/g)].map((match) => match[1]));
  expect([...referenced].filter((id) => !registered.has(id))).toEqual([]);
});

test("the pre-tour briefing is evidence-labelled, linked, responsive, and exportable", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(join(root, "public/index.html"), "utf8"),
    readFile(join(root, "public/app.js"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  expect(html).toContain('id="tour-intro-attention"');
  expect(html).toContain('id="tour-intro-return"');
  expect(html).toContain("View briefing");
  expect(html).toContain('id="tour-intro-attention-note"');
  expect(html).toContain('<div class="tour-intro-actions">');
  expect(html).toContain('id="tour-intro-estimate-factors"');
  expect(html.indexOf('id="tour-intro-architecture-section"')).toBeLessThan(html.indexOf('id="tour-intro-attention"'));
  expect(app).toContain("function renderTourAttention()");
  expect(app).toContain('querySelector(".tour-intro-scroll").scrollTop = 0');
  expect(app).toContain("Bounded heuristic");
  expect(app).toContain('data-attention-kind');
  expect(app).toContain("review cue");
  expect(app).toContain('openFindingFromCode(target.dataset.attentionId, { fromBriefing: true })');
  expect(app).toContain("function reopenTourIntro()");
  expect(app).toContain("function renderTourIntroDiagrams()");
  expect(app).toContain("renderTourIntroDiagrams();");
  expect(app).toContain('briefingDiagramExpandButton("sequence diagram", "sequence", flow.id)');
  expect(app).toContain('briefingDiagramExpandButton("call flow", "call-flow", flow.id)');
  expect(app).toContain('callFlowCardHtml(callFlow, { showTitle: false, showRegenerate: false, viewer: true })');
  expect(app).toContain('elements["call-flows"].innerHTML = callFlows.map((flow) => callFlowCardHtml(flow)).join("")');
  expect(app).toContain('elements["architecture-viewer-diagram"].dataset.callFlowId');
  expect(app).toContain('state.callFlowModes.set(flow.id, mode.dataset.callFlowMode)');
  expect(app).toContain("function openBriefingDiagramViewer(kind, id)");
  expect(app).toContain('registerArchitectureDiagramInteractions(elements["tour-intro-sequence"])');
  expect(app).toContain('registerArchitectureDiagramInteractions(elements["tour-intro-call-flows"])');
  expect(app).toContain('tourStarted: false');
  expect(app).toContain('elements["begin-tour"].textContent = state.tourStarted ? "Close" : "Start tour"');
  expect(app).toContain('elements["findings-back"].textContent = state.findingReturn?.fromBriefing ? "← Back to briefing" : "← Back to code"');
  expect(app).toContain('openFindingFromCode(target.dataset.attentionId, { fromBriefing: true })');
  expect(app).toContain("if (fromBriefing && target.path && target.line && target.side)");
  expect(app).toContain("reopenTourIntro();");
  expect(app).toContain('state.tourIntroReturn ? "↩ Back to briefing" : "View briefing"');
  expect(app).toContain('activateReviewTab("call-flows", renderCallFlows)');
  expect(styles).toContain(".tour-intro-attention-item");
  expect(styles).toContain(".tour-intro-estimate details { margin-top: 12px; }");
  expect(styles).toContain("grid-template-rows: minmax(0, 1fr) auto");
  expect(styles).toContain(".tour-intro-scroll { min-height: 0");
  expect(styles).toContain("@media (max-width: 600px)");
});

test("each architecture chart has independent movement and zoom controls", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(join(root, "public/index.html"), "utf8"),
    readFile(join(root, "public/app.js"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  expect(html).toContain('id="architecture-viewer-dialog"');
  expect(html).toContain('id="architecture-viewer-diagram"');
  expect(html).toContain('id="architecture-viewer-legend"');
  expect(html).toContain('id="close-architecture-viewer"');
  expect(app).toContain("architectureDiagramViews: new Map()");
  expect(app).toContain('data-architecture-key="${key}"');
  expect(app).toContain('data-diagram-action="move-left"');
  expect(app).toContain('data-diagram-action="move-right"');
  expect(app).toContain('data-diagram-action="zoom-out"');
  expect(app).toContain('data-diagram-action="zoom-in"');
  expect(app).toContain('data-diagram-action="reset"');
  expect(app).toContain("function architectureDiagramControls(label)");
  expect(app).toContain("function architectureDiagramExpandButton(label, key)");
  expect(app).toContain("function openArchitectureDiagramViewer(key)");
  expect(app).toContain('elements["architecture-viewer-legend"].innerHTML = architectureLegend()');
  expect(app).toContain('<header class="architecture-card-heading"><div>');
  expect(app).toContain('${architectureDiagramExpandButton(label, key)}</header>');
  expect(app).toContain('data-diagram-expand="${escapeHtml(key)}"');
  expect(app).toContain('?? elements["architecture-content"].querySelector(`[data-architecture-diagram="${CSS.escape(key)}"]`)');
  expect(app).toContain("state.architectureDiagramViews.set(viewerKey, { x: 0, y: 0, scale: 1 })");
  expect(app).toContain("function changeArchitectureDiagramView(key, action)");
  expect(app).toContain('svg.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`');
  expect(app).toContain("function registerArchitectureDiagramInteractions(container)");
  expect(app).toContain('const expandButton = event.target.closest("[data-diagram-expand]")');
  expect(app).toContain("openArchitectureDiagramViewer(expandButton.dataset.diagramExpand)");
  expect(app).toContain('registerArchitectureDiagramInteractions(elements["tour-intro-architecture"])');
  expect(app).toContain("registerArchitectureDiagramInteractions(elements.architecture)");
  expect(app).toContain('registerArchitectureDiagramInteractions(elements["architecture-viewer-dialog"])');
  expect(app).toContain('aria-label="Architecture diagram legend"');
  expect(app).toContain('`${architectureLegend()}${architectures.map');
  expect(styles).toContain(".architecture-diagram.dragging");
  expect(styles).toContain(".architecture-legend { grid-column: 1 / -1;");
  expect(styles).toContain(".architecture-legend i.removed { border-color: var(--architecture-removed); border-style: dashed; }");
  expect(styles).toContain(".architecture-viewer-dialog[open]");
  expect(styles).toContain(".architecture-content { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));");
  expect(styles).toContain(".architecture-viewer-dialog .architecture-legend { justify-content: center;");
  expect(styles).toContain("touch-action: none");
});

test("symbol peek does not retain state after leaving its review page", async () => {
  const app = await readFile(join(root, "public/app.js"), "utf8");
  const close = app.slice(app.indexOf("function closeSymbolPeek()"), app.indexOf("async function showActivityFile"));
  expect(close).toContain("state.symbolPeek.current = null");
  expect(close).toContain("state.symbolPeek.history = []");
  expect(close).toContain("state.symbolPeek.requestId += 1");
  expect(app).toContain('window.addEventListener("pageshow", (event) => {');
  expect(app).toContain("if (event.persisted && state.symbolPeek.open) closeSymbolPeek()");
});

test("settings consolidate runtime preferences, exports, and sessions", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(join(root, "public/index.html"), "utf8"),
    readFile(join(root, "public/app.js"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  expect(html).toContain('<details id="settings-menu" class="settings-menu">');
  expect(html).toContain('id="prefetch-steps"');
  expect(html).toContain('id="show-tour-briefing"');
  expect(html).toContain('id="briefing-architecture"');
  expect(html).toContain('id="briefing-sequence-diagrams"');
  expect(html).toContain('id="briefing-call-flows"');
  expect(html).toContain('id="briefing-needs-attention"');
  expect(html).toContain('id="briefing-review-effort"');
  expect(html).toContain('data-briefing-option="architecture"');
  expect(html).toContain('draggable="true"');
  expect(html).toContain('id="briefing-options" class="briefing-options"');
  expect(html).toContain('aria-controls="briefing-options"');
  expect(html).toContain('id="theme-select"');
  expect(html).not.toContain('<label><span>Diff view</span>');
  expect(html).not.toContain('id="diff-layout"');
  expect(html).toContain('data-diff-layout="split"');
  expect(html).toContain('data-diff-wrap="wrap"');
  expect(html).toContain('id="tree-mode"');
  expect(html).toContain('data-export-format="markdown">Markdown');
  expect(html).toContain('data-export-format="html">HTML');
  expect(html).toContain('id="html-export-dialog"');
  expect(html).toContain('id="export-prepare-steps"');
  expect(html).toContain('id="export-findings"');
  expect(html).toContain('id="export-call-flows"');
  expect(html).toContain('id="export-diagrams"');
  expect(html).not.toContain('id="export-format"');
  expect(app).toContain("async function downloadExport(format, options = {})");
  expect(app).toContain('elements["html-export-dialog"].showModal()');
  expect(app).toContain('elements["export-prepare-steps"].closest("label").classList.toggle("hidden", missing === 0)');
  expect(app).not.toContain('elements["export-prepare-steps"].disabled = missing === 0');
  expect(app).toContain('prepareMissingSteps: elements["export-prepare-steps"].checked');
  expect(app).toContain("diffWrap: state.diffWrap");
  expect(app).toContain('if (preparingSteps) setBusy(true, "Preparing missing tour stops for the static export…")');
  expect(app).toContain('method: "POST"');
  expect(app).toContain('api("/api/preferences", { method: "POST", body: JSON.stringify({ prefetchSteps }) })');
  expect(app).toContain('async function saveBriefingPreferences(order = briefingOptionOrderFromDom())');
  expect(app).toContain('briefingSequenceDiagrams: elements["briefing-sequence-diagrams"].checked');
  expect(app).toContain('briefingCallFlows: elements["briefing-call-flows"].checked');
  expect(app).toContain('briefingNeedsAttention: elements["briefing-needs-attention"].checked');
  expect(app).toContain('briefingReviewEffort: elements["briefing-review-effort"].checked');
  expect(app).toContain("briefingOrder: order");
  expect(app).toContain("function renderTourBriefingOrder()");
  expect(app).toContain("function renderBriefingOptionOrder");
  expect(app).toContain('addEventListener("dragstart"');
  expect(app).toContain('addEventListener("drop"');
  expect(app).toContain("function moveBriefingDropPlaceholder(clientY)");
  expect(app).toContain('placeholder.className = "briefing-option-placeholder"');
  expect(app).toContain('placeholder.textContent = `${label} will move here`');
  expect(app).toContain('clearBriefingDrag({ save: true })');
  expect(app).toContain("function syncBriefingPreferenceControls()");
  expect(app).toContain('elements["show-tour-briefing"].disabled = state.busy;');
  expect(app).toContain("const dependentControls = [elements[\"briefing-architecture\"], elements[\"briefing-sequence-diagrams\"], elements[\"briefing-call-flows\"], elements[\"briefing-needs-attention\"], elements[\"briefing-review-effort\"]];");
  expect(app).toContain('!elements["show-tour-briefing"].checked');
  expect(styles).toContain(".briefing-options");
  expect(styles).toContain(".briefing-option-placeholder");
  expect(styles).not.toContain(".briefing-option.drop-target");
  expect(app).toContain('document.addEventListener("pointerdown"');
  expect(app).toContain('!elements["settings-menu"].contains(event.target)');
  expect(app).toContain('elements["settings-menu"].open = false');
  expect(styles).toContain(".settings-popover { position: absolute;");
  expect(styles).toContain(".export-options {");
});

test("topbar controls stay compact around a labelled settings menu", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(join(root, "public/index.html"), "utf8"),
    readFile(join(root, "public/app.js"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  expect(html).toContain('aria-label="Review settings"');
  expect(html).toContain('<span>Theme</span><select id="theme-select"');
  expect(styles).toContain(".topbar .button { padding: 6px 9px;");
  expect(styles).toContain(".actions { justify-content: flex-end; gap: 5px;");
  expect(html).toContain('id="update-button" class="button update-button hidden"');
  expect(app).toContain('void checkForUpdate()');
  expect(app).toContain('elements["update-button"].addEventListener("click", installUpdate)');
  expect(app).toContain('elements["update-button"].disabled = busy || state.updateInProgress');
  expect(styles).toContain(".update-button.available { animation: update-arrival");
  expect(styles).toContain(".update-button.updating .update-icon { animation: update-spin");
  expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
});

test("topbar identifies the repository and reviewed branch", async () => {
  const html = await Bun.file(new URL("../public/index.html", import.meta.url)).text();
  const app = await Bun.file(new URL("../public/app.js", import.meta.url)).text();
  const styles = await Bun.file(new URL("../public/styles.css", import.meta.url)).text();

  expect(html).toContain('id="repository-label" class="repository-identity"');
  expect(html).toContain('class="review-identity"');
  expect(html).toContain('id="comparison-label" class="comparison-identity"');
  expect(html.indexOf('id="comparison-label"')).toBeLessThan(html.indexOf('id="file-panel"'));
  expect(app).toContain("state.session.pullRequest?.repository ?? comparison.repositoryName");
  expect(app).toContain("state.session.pullRequest?.headRefName ?? comparison.branch");
  expect(app).toContain("`${repositoryName} · ${branchName}`");
  expect(styles).toContain(".repository-identity");
  expect(styles).toContain(".comparison-identity");
});

test("tour startup defaults diagrams and findings on and sends both choices", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(join(root, "public/index.html"), "utf8"),
    readFile(join(root, "public/app.js"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  expect(html).toContain('<input id="include-architecture" type="checkbox" checked /> Architecture');
  expect(html).toContain('<input id="include-call-flows" type="checkbox" checked /> Call flows');
  expect(html).toContain('<input id="include-flows" type="checkbox" checked /> Sequence diagrams');
  expect(html).toContain('<input id="include-findings" type="checkbox" checked /> Findings');
  expect(app).toContain('includeArchitecture: elements["include-architecture"].checked');
  expect(app).toContain('includeCallFlows: elements["include-call-flows"].checked');
  expect(app).toContain('includeFlows: elements["include-flows"].checked');
  expect(app).toContain('includeFindings: elements["include-findings"].checked');
  expect(app).toContain('state.session.findingGenerationEnabled !== false');
  expect(app).toContain('if (!findingGenerationEnabled) elements["include-findings"].checked = false');
  expect(app).toContain('elements["include-architecture"].disabled = busy');
  expect(app).toContain('elements["include-call-flows"].disabled = busy');
  expect(app).toContain('elements["include-flows"].disabled = busy');
  expect(app).toContain('elements["include-findings"].disabled = busy || state.session?.findingGenerationEnabled === false');
  expect(styles).toContain(".tour-includes {");
  expect(app).toContain('state.session.tourState === "planning"');
  expect(app).toContain('latest.tourState !== state.session.tourState');
});

test("flow provenance uses clear reviewer-facing wording", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(join(root, "public/index.html"), "utf8"),
    readFile(join(root, "public/app.js"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  expect(html).toContain("See how changed entrypoints call through the code before and after this change.");
  expect(app).toContain('label: "Partly verified"');
  expect(app).toContain("Some links were traced; the remaining links are informed inferences.");
  expect(app).toContain('data-flow-file="${escapeHtml(path)}"');
  expect(app).toContain("Exact files were not captured for this saved tour. Regenerate this diagram to add them.");
  expect(app).toContain("The diagram source is invalid or unsupported.");
  expect(app).toContain("This entrypoint did not exist before the change.");
  expect(app).toContain('aria-label="Call-flow legend"');
  expect(app).toContain("A changed callable exists before and after this change");
  expect(app).toContain('toast("Tour paused so this evidence can be shown. Resume the tour when you are ready."');
  expect(styles).toContain(".architecture-impact { margin-top: 12px; }");
  expect(styles).toContain(".flow-impact-list { display: grid;");
  expect(styles).not.toContain(".flow-impact-list { position: absolute;");
  expect(styles).toContain('.flow-impact > summary::after { content: "›";');
  expect(styles).toContain('.compact-finding > summary::before { content: "›";');
});

test("diff rows stay dense and the explanation owns a bounded scroll area", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(join(root, "public/index.html"), "utf8"),
    readFile(join(root, "public/app.js"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  expect(app).toContain('<div class="diff-file-scroll">');
  expect(styles).toContain("grid-template-rows: auto minmax(0, 1fr) auto");
  expect(styles).toContain("white-space: pre;");
  expect(styles).toContain("max-height: min(180px, 26vh)");
  expect(styles).toContain(".diff-row.split-side.split-empty");
  expect(styles).not.toContain(".diff-row.split-side.empty");
  expect(html).toContain('id="tour-scroll" class="tour-scroll"');
  expect(styles).toContain(".diff-file-scroll { max-width: 100%; overflow-x: auto;");
  expect(styles).toContain(".split-row { min-width: 0; display: grid; grid-template-columns: minmax(0, var(--split-old-width, 50%)) minmax(0, 1fr);");
  expect(styles).toContain("min-height: 18px");
  expect(styles).toContain("line-height: 18px");
  expect(styles).toContain(".diff-row.split-side > .line-code { grid-column: 4; grid-row: 1; }");
  expect(styles).toContain(".diff-row.split-side:first-child { border-right: 1px solid var(--border); }");
  expect(styles).toContain(".diff-row:not(.split-side) > .line-code { grid-column: 4; grid-row: 1; }");
  expect(styles).not.toContain(".line-code::-webkit-scrollbar");
});

test("agent prose and selected paths wrap without widening the pane", async () => {
  const styles = await readFile(join(root, "public/styles.css"), "utf8");
  expect(styles).toContain(".tour-active { flex: 1 1 0; min-width: 0;");
  expect(styles).toContain(".tour-scroll { min-width: 0;");
  expect(styles).toContain(".explanation { min-width: 0; max-width: 100%; overflow-wrap: anywhere;");
  expect(styles).toContain(".anchor { max-width: 100%; overflow-wrap: anywhere;");
  expect(styles).toContain(".selection-pill { min-width: 0; max-width: 100%; display: flex;");
  expect(styles).toContain("white-space: normal;");
});

test("the baseline diff renderer retains selectable syntax palettes", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(join(root, "public/index.html"), "utf8"),
    readFile(join(root, "public/app.js"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  expect(html).toContain('id="syntax-theme-select"');
  expect(html).toContain('<option value="github">GitHub</option>');
  expect(html).not.toContain('<option value="catppuccin-latte">Catppuccin Latte</option>');
  expect(html).toContain('<option value="catppuccin-frappe">Catppuccin Frappé</option>');
  expect(html).toContain('<option value="catppuccin-macchiato">Catppuccin Macchiato</option>');
  expect(html).toContain('<option value="catppuccin-mocha">Catppuccin Mocha</option>');
  expect(app).toContain("function splitRows(rows)");
  expect(app).toContain('theme: state.syntaxTheme');
  expect(app).toContain("document.documentElement.dataset.syntaxTheme = state.syntaxTheme");
  expect(styles).toContain(':root[data-theme="light"] .syntax-token { color: var(--syntax-light); }');
  expect(styles).toContain(':root[data-theme="dark"] .syntax-token { color: var(--syntax-dark); }');
  expect(styles).toContain(':root[data-syntax-theme="catppuccin-frappe"] {');
  expect(styles).toContain(':root[data-syntax-theme="catppuccin-macchiato"] {');
  expect(styles).toContain(':root[data-syntax-theme="catppuccin-mocha"] {');
});

test("syntax highlighting resets at hidden hunk gaps and between split sources", async () => {
  const app = await Bun.file(new URL("../public/app.js", import.meta.url)).text();

  expect(app).toContain('section.querySelectorAll(":scope .hunk")');
  expect(app).toContain('["old", "new"].map((side)');
  expect(app).toContain('hunk.querySelectorAll(`.split-side[data-side="${side}"] .line-code`)');
  expect(app).toContain("index += 200");
  expect(app).toContain("Promise.all(batches.map");
  expect(app).not.toContain('const nodes = [...section.querySelectorAll(".line-code")]');
});

test("split diffs keep the native review UI without editor or moved-code overlays", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(join(root, "public/index.html"), "utf8"),
    readFile(join(root, "public/app.js"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  expect(html).not.toContain("monaco");
  expect(app).not.toContain("Monaco");
  expect(app).not.toContain("function detectMovedBlocks(file)");
  expect(app).not.toContain("function renderMovedConnectors()");
  expect(app).not.toContain("data-move-compare");
  expect(app).toContain('${renderDiffFileHeader(file, collapsed)}');
  expect(styles).not.toContain(".moved-connectors");
  expect(styles).not.toContain(".move-banner");
  expect(styles).not.toContain(".monaco-");
});

test("marking a file reviewed collapses its diff while keeping the header available", async () => {
  const [app, styles] = await Promise.all([
    readFile(join(root, "public/app.js"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  expect(app).toContain("collapsedFiles: new Set()");
  expect(app).toContain('if (reviewed) state.collapsedFiles.add(path)');
  expect(app).toContain('data-collapse-file="${escapeHtml(file.path)}"');
  expect(app).toContain('aria-expanded="${!collapsed}"');
  expect(app).toContain("state.collapsedFiles.delete(path);");
  expect(styles).toContain(".diff-file.collapsed .diff-file-scroll { display: none; }");
  expect(styles).toContain(".collapse-caret { position: absolute; left: 12px; top: 50%;");
  expect(styles).toContain(".diff-file.collapsed .collapse-caret { transform: translateY(-50%) rotate(-90deg); }");
});

test("file headers stick to the diff viewport while their file is visible", async () => {
  const styles = await readFile(join(root, "public/styles.css"), "utf8");
  expect(styles).toContain(".diff-file { border: 1px solid var(--border); border-radius: 10px; margin-bottom: 16px; overflow: clip;");
  expect(styles).toContain(".diff-file-header { position: sticky; top: var(--diff-toolbar-height, 0px); z-index: 3;");
  expect(styles).not.toContain(".diff-file { border: 1px solid var(--border); border-radius: 10px; margin-bottom: 16px; overflow: hidden;");
});

test("top-level panes preserve independent scroll positions", async () => {
  const app = await readFile(join(root, "public/app.js"), "utf8");
  expect(app).toContain("tabScrollPositions: new Map()");
  expect(app).toContain("function activateReviewTab(tabName, render = null)");
  expect(app).toContain('state.tabScrollPositions.set(state.activeTab, elements["diff-panel"].scrollTop)');
  expect(app).toContain("const scrollTop = state.tabScrollPositions.get(tabName) ?? 0");
  expect(app).toContain('if (state.activeTab === tabName) elements["diff-panel"].scrollTop = scrollTop');
  expect(app).toContain('elements["diff-tab"].addEventListener("click", () => activateReviewTab("diff"))');
  expect(app).toContain("activateReviewTab(nextTab, render)");
});

test("review comments compose and edit inline with an in-app delete confirmation", async () => {
  const [app, styles] = await Promise.all([
    readFile(join(root, "public/app.js"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  expect(app).toContain('document.querySelectorAll(".inline-comment")');
  expect(app).toContain('inline.className = `inline-comment ${comment.status}`');
  expect(app).toContain('data-inline-comment-id="${escapeHtml(comment.id)}"');
  expect(app).toContain('data-inline-comment-action="edit"');
  expect(app).toContain('data-inline-comment-action="delete"');
  expect(app).toContain("async function deleteReviewComment(comment)");
  expect(app).toContain("function openInlineCommentEditor(row, target, comment,");
  expect(app).toContain('className = "inline-comment-form"');
  expect(app).toContain('data-inline-comment-action="confirm-delete"');
  expect(app).not.toContain("Delete feedback at ${comment.path}:${comment.line}");
  expect(app).toContain('splitRow.insertAdjacentElement("afterend", lane)');
  expect(app).toContain("action.dataset.inlineCommentId = comment.id");
  expect(app).toContain("if (comment && reviewIsOpen()) void openCommentEditor(comment)");
  expect(styles).toContain(".inline-comment { box-sizing: border-box; position: sticky;");
  expect(styles).toContain(".inline-comment-button { width: 100%;");
  expect(styles).toContain(".inline-comment-actions { display: flex;");
  expect(styles).toContain(".split-inline-comment .inline-comment { position: static;");
  expect(styles).toContain(".inline-comment-editor-lane");
  expect(styles).toContain(".comment-item { min-width: 0;");
  expect(styles).toContain(".comment-jump { min-width: 0; max-width: 100%; white-space: normal; overflow-wrap: anywhere; word-break: break-word; }");
  expect(styles).toContain(".comment-status { flex: 0 0 auto;");
});

test("files expand and collapse in place while clicks and selections expose scoped review actions", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(join(root, "public/index.html"), "utf8"),
    readFile(join(root, "public/app.js"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  expect(html).toContain("Choose a code line to comment or ask the agent");
  expect(app).toContain('data-file-expansion="${file._full ? "compact" : "full"}"');
  expect(app).toContain('${file._full ? "Collapse file" : "Expand file"}');
  expect(app).toContain('query.set("full", String(requestedFull))');
  expect(app).toContain("function captureFileViewport(path, origin)");
  expect(app).toContain("function restoreFileViewport(anchor)");
  expect(app).toContain('const row = hunk?.querySelector(".diff-row.addition[data-line], .diff-row.deletion[data-line], .diff-row[data-line]")');
  expect(app).toContain("const viewportAnchor = (viewportOrigin || requestedFull !== undefined) ? captureFileViewport(path, viewportOrigin) : null");
  expect(app).toContain("next, undefined, contextButton");
  expect(app).toContain("if (!viewportAnchor) {");
  expect(app).toContain("if (viewportAnchor) restoreFileViewport(viewportAnchor)");
  expect(html).toContain('data-selection-tool="copy"');
  expect(html).toContain('data-selection-tool="edit"');
  expect(html).toContain('data-selection-tool="comment"');
  expect(html).toContain('data-selection-tool="ask"');
  expect(app).toContain("function openLineComment(row)");
  expect(app).toContain("function askAboutLine(row)");
  expect(app).toContain("function openInlineEdit(row, selection = null)");
  expect(app).toContain("function readCodeSelection()");
  expect(app).toContain("function textOffsetWithin(element, node, offset)");
  expect(app).toContain("function quotedCode(text)");
  expect(app).toContain('data-inline-composer-mode="comment"');
  expect(app).toContain('data-inline-composer-mode="ask"');
  expect(app).toContain('api("/api/edits"');
  expect(app).toContain("endLine: Number(form.dataset.editEndLine)");
  expect(app).toContain("The repository stays untouched until you apply this suggestion.");
  expect(app).toContain("function highlightInlineEdit(form)");
  expect(app).toContain("function syncInlineEditScroll(textarea)");
  expect(app).toContain('groups: [{ id: "inline-edit", path: form.dataset.editPath, lines: value.split("\\n") }]');
  expect(styles).toContain(".line-action:not(:disabled)::after");
  expect(styles).toContain(".line-prefix { position: relative; align-self: stretch; min-height: 18px;");
  expect(styles).toContain(".code-selection-toolbar");
  expect(styles).toContain(".inline-composer-tabs");
  expect(styles).toContain(".inline-edit-lane");
  expect(styles).toContain(".inline-edit-highlight { position: absolute;");
  expect(styles).toContain("caret-color: var(--text-code)");
});

test("split diff panes are resizable and synchronize horizontal scrolling per side", async () => {
  const [app, styles] = await Promise.all([
    readFile(join(root, "public/app.js"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  expect(styles).toContain(".hunk.split-layout { position: relative; width: 100%; min-width: 0; }");
  expect(styles).toContain("grid-template-columns: 42px 22px max-content minmax(max-content, 1fr)");
  expect(styles).toContain("grid-template-columns: minmax(0, var(--split-old-width, 50%)) minmax(0, 1fr)");
  expect(app).toContain('class="split-row"');
  expect(app).toContain("function splitRows(rows)");
  expect(app).not.toContain("function renderSplitTrack(file, hunk, side, findings, moves)");
  expect(styles).toContain(".diff-row.split-side:first-child { border-right: 1px solid var(--border); }");
  expect(styles).toContain(".split-resizer { position: absolute;");
  expect(styles).toContain("grid-template-columns: 42px 22px max-content minmax(max-content, 1fr); width: 100%; min-width: 0; overflow-x: auto;");
  expect(styles).not.toContain("grid-template-columns: minmax(50%, max-content) minmax(50%, max-content)");
  expect(app).toContain('data-split-resizer role="separator"');
  expect(app).toContain('setSplitOldWidth(((event.clientX - bounds.left) / bounds.width) * 100)');
  expect(app).toContain('window.localStorage.setItem(preferenceKey("split-old-width"), String(width))');
  expect(app).toContain('if (!event.target.closest?.("[data-split-resizer]") || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;');
  expect(app).toContain("setSplitOldWidth(50, true)");
  expect(app).toContain('elements.diff.addEventListener("scroll"');
  expect(app).toContain("function syncSplitScroll(hunk, side, scrollLeft)");
  expect(app).toContain('elements.diff.addEventListener("wheel"');
  expect(app).toContain("event.preventDefault()");
});

test("images and videos are exposed through a conditional authenticated media tab", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(join(root, "public/index.html"), "utf8"),
    readFile(join(root, "public/app.js"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  expect(html).toContain('id="screenshots-tab" class="tab hidden"');
  expect(html).toContain('id="screenshots-view" class="review-view hidden"');
  expect(html).toContain('>Media <span id="screenshots-tab-count"');
  expect(app).toContain("function changedImageMedia()");
  expect(app).toContain("const mediaCount = screenshots.length + changedImages.length");
  expect(app).toContain('"X-Review-Tour-Token": state.apiToken');
  expect(app).toContain('apiBlob(`/api/screenshots/${encodeURIComponent(shot.id)}`)');
  expect(app).toContain('apiBlob(`/api/diff/image?${new URLSearchParams({ path: image.path, side: image.side })}`)');
  expect(app).toContain('shot.mimeType === "video/mp4"');
  expect(styles).toContain(".screenshot-gallery { display: grid;");
  expect(styles).toContain(".changed-image-media > a");
});
