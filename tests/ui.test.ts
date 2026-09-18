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
  expect(styles).toContain(".current-step-return, .pull-request-return { position: fixed;");
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
  expect(askAgent).toContain("state.pendingQuestions.set(localId, pending)");
  expect(askAgent).toContain("state.pendingQuestions.delete(localId)");
  expect(askAgent).not.toContain("state.questionPending");
  expect(askAgent).not.toContain('setBusy(true, "The agent is responding…")');
  expect(app).toContain('elements["next-step"].disabled = state.busy || !reviewIsOpen()');
});

test("line and image questions compose inline while queued questions retain their own anchors", async () => {
  const [app, styles] = await Promise.all([
    readFile(join(root, "public/app.js"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  const askAboutLine = app.slice(app.indexOf("function askAboutLine(row)"), app.indexOf("function closeInlineEdit()"));
  const askAgent = app.slice(app.indexOf("async function askAgent"), app.indexOf("async function close"));
  expect(askAboutLine).toContain('openInlineCommentEditor(row, lineTarget(row), null, { mode: "ask" })');
  expect(askAboutLine).not.toContain("openConversation(null)");
  expect(askAgent).toContain("clearSelectedLine();");
  expect(askAgent).toContain("void (async () => {");
  expect(app).toContain("for (const pending of state.pendingQuestions.values())");
  expect(app).toContain('state.pendingQuestions.has(message.id) ? \'<span class="chat-message-status">Queued</span>\'');
  expect(styles).toContain(".chat-message-status");
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
  expect(html).toContain('id="github-review-confirmation-dialog"');
  expect(html).toContain('id="github-review-confirmation-pull-request"');
  expect(html).toContain('id="github-review-confirmation-revision"');
  expect(html).toContain('id="github-review-confirmation-comments"');
  expect(html).toContain('id="github-review-confirmation-local-only"');
  expect(html).toContain("Approve tour without approving the pull request");
  expect(app).toContain("function openGitHubReviewConfirmation(outcome, decision, note)");
  expect(app).toContain("function updateGitHubReviewConfirmation()");
  expect(app).toContain('elements["github-review-confirmation-dialog"].showModal()');
  expect(app).toContain('void close(pending.outcome, pending.decision, pending.note, true, publishToGitHub)');
  expect(styles).toContain(".github-review-confirmation-summary");
  expect(app).toContain('window.confirm("Close this review without approving or requesting changes?")');
  expect(app).toContain('void close("cancelled", "cancel")');
});

test("scoped discussion exposes stop and range anchors in the composer and prompt context", async () => {
  const [html, app, styles, agent] = await Promise.all([
    readFile(join(root, "public/index.html"), "utf8"),
    readFile(join(root, "public/app.js"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
    readFile(join(root, "src/agent.ts"), "utf8"),
  ]);
  expect(html).toContain('id="comment-stop"');
  expect(html).toContain('class="button secondary" type="button">Add stop comment</button>');
  expect(html).toContain('id="step-comment-form"');
  expect(html).toContain('id="question-scope" class="question-scope"');
  expect(html.indexOf('id="questions-scroll"')).toBeLessThan(html.indexOf('id="question-scope" class="question-scope"'));
  expect(html.indexOf('id="question-scope" class="question-scope"')).toBeLessThan(html.indexOf('class="question-composer"'));
  expect(html).not.toContain('id="conversation-context"');
  expect(app).toContain('scope: "stop", stepId: step.id');
  expect(app).toContain('scope: "range"');
  expect(app).toContain("form.dataset.commentSelectedText");
  expect(app).toContain("Exact selected quotation");
  expect(app).toContain("Exact selected context");
  expect(agent).toContain("Current tour stop id:");
  expect(app).toContain("function commentScope(comment)");
  expect(app).toContain("function quotationLabel(text)");
  expect(app).toContain("async function highlightCommentQuotes()");
  expect(app).toContain('data-comment-quote-path');
  expect(app).toContain('void highlightCommentQuotes();');
  expect(app).toContain('void highlightRenderedCode();\n  void highlightCommentQuotes();');
  expect(app).toContain("function conversationScopeMarkup(thread = null)");
  expect(app).toContain("function renderQuestionScope(thread = conversationThreads().find");
  expect(app).toContain("function discussionStopLabel(scope)");
  expect(app).toContain("Phase ${scope.phaseIndex + 1} · ${scope.phase.title} — Stop ${scope.stopIndex + 1} · ${scope.step.title}");
  expect(app).toContain("No code selection. This question is scoped to this stop.");
  expect(app).toContain("function anchorRowsMatch(anchor)");
  expect(app).toContain("if (!anchorRowsMatch(anchor)) continue;");
  expect(app).toContain("Open selected-code conversation");
  expect(app).not.toContain("anchorBelongsToDiscussionStop");
  expect(app).toContain("clearSelectedLine();");
  expect(app).toContain('class="selection-quote-preview" open');
  expect(styles).toContain(".step-discussion");
  expect(styles).toContain(".step-discussion > button { justify-self: start; min-height: 32px; }");
  expect(styles).toContain(".comment-quote");
  expect(styles).toContain(".questions-body { flex: 1; min-height: 0; overflow: hidden;");
  expect(styles).toContain(".question-composer { flex: 0 0 auto;");
  expect(styles).toContain(".selection-quote-preview pre { max-height: 160px;");
  expect(styles).toContain(".conversation-scope");
  expect(styles).toContain(".question-scope");
});

test("question scopes retain phase and stop numbers alongside their names", async () => {
  const app = await readFile(join(root, "public/app.js"), "utf8");
  const source = app.slice(app.indexOf("function discussionStop(stepId)"), app.indexOf("function anchorRowsMatch"));
  const state = {
    selectedLine: null as { path: string; side: string; line: number; content: string } | null,
    tourMode: true,
    session: {
      outline: {
        phases: [{
          title: "Build the receipt",
          steps: [{ id: "validate", title: "Validate items" }],
        }, {
          title: "Format the receipt",
          steps: [{ id: "format", title: "Format totals" }],
        }],
      },
    },
  };
  const helpers = new Function("state", "currentStep", "escapeHtml", "reviewAnchorLabel", `${source}; return { conversationScopeLabel, conversationScopeMarkup };`)(
    state,
    () => state.session.outline.phases[1].steps[0],
    (value: string) => value,
    () => "selected code",
  ) as {
    conversationScopeLabel: (thread: unknown) => string;
    conversationScopeMarkup: (thread: unknown) => string;
  };
  const thread = { root: { stepId: "format" } };
  expect(helpers.conversationScopeLabel(thread)).toBe("Original tour stop: Phase 2 · Format the receipt — Stop 1 · Format totals");
  expect(helpers.conversationScopeMarkup(thread)).toContain("Phase 2 · Format the receipt — Stop 1 · Format totals");
  state.selectedLine = { path: "src/cart.ts", side: "new", line: 7, content: "applyDiscount();" };
  expect(helpers.conversationScopeMarkup(null)).toContain("Selected code: selected code");
  state.tourMode = false;
  expect(helpers.conversationScopeMarkup(null)).toContain("Review-wide question");
});

test("comment scope labels name the discussion kind before their anchor", async () => {
  const app = await readFile(join(root, "public", "app.js"), "utf8");
  const source = app.slice(app.indexOf("function commentScope(comment)"), app.indexOf("function quotationLabel(text)"));
  const commentScope = new Function("state", `${source}; return commentScope;`)({
    session: { outline: { phases: [{ steps: [{ id: "format", title: "Format the receipt" }] }] } },
  }) as (comment: { scope?: string; stepId?: string }) => string;

  expect(commentScope({})).toBe("Line comment");
  expect(commentScope({ scope: "range" })).toBe("Line range comment");
  expect(commentScope({ scope: "stop", stepId: "format" })).toBe("Tour stop comment · Format the receipt");
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
  expect(app).toContain('function flowProvenanceLegend()');
  expect(app).toContain('aria-label="Diagram verification legend"');
  expect(styles).toContain('.flow-card header > div:first-child { display: flex;');
  expect(styles).toContain('.provenance-legend > span { display: grid;');
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
  expect(app).toContain("function findingEvidenceParts(evidence)");
  expect(app).toContain('class="finding-evidence-list"');
  expect(app).toContain("Evidence trail · ${escapeHtml(finding.confidence)} confidence");
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
  expect(app).toContain('data-action="publish-finding"');
  expect(app).toContain("Add to PR review");
  expect(app).toContain('publishFinding ? { publish: true } : {}');
  expect(app).toContain("Finding added to the pending PR review");
  expect(app).not.toContain('finding.outdated ? " disabled" : ""');
  expect(styles).toContain(".finding-badges .finding-reassessment");
  expect(styles).toContain(".finding-pin.needs-reassessment");
  expect(styles).toContain(".finding-badges .finding-disposition.accepted");
  expect(styles).toContain(".finding-badges .finding-disposition.false-positive");
  expect(styles).toContain(".finding-badges .finding-disposition.intentional");
  expect(styles).toContain(".finding-badges .finding-disposition.deferred");
  expect(styles).toContain(".finding-badges .finding-disposition.obsolete-after-refresh");
  expect(styles).toContain(".finding-item.obsolete-after-refresh");
  expect(styles).toContain(".finding-evidence-list li");
});

test("the agent header preserves the selected triggering model and effort", async () => {
  const app = await readFile(join(root, "public/app.js"), "utf8");

  expect(app).toContain('const modelIdentity = model?.id === "current-session" ? "Current agent session" : model?.id');
  expect(app).toContain('[adapter.label, modelIdentity, reasoning].filter(Boolean).join(" · ")');
  expect(app).toContain('elements["agent-name"].title = agentIdentity;');
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

test("rendered pull request Markdown permits safe screenshot images and evidence excerpts skip imports", async () => {
  const app = await readFile(join(root, "public", "app.js"), "utf8");
  const escapeHtml = (value: unknown) => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
  const inlineSource = app.slice(app.indexOf("function renderInlineChangeText"), app.indexOf("function markdownTableCells"));
  const renderInlineMarkdown = new Function("escapeHtml", `${inlineSource}; return renderInlineMarkdown;`)(escapeHtml) as (value: string) => string;
  expect(renderInlineMarkdown('<img width="360" alt="Legal screen" src="https://github.com/user-attachments/assets/example">')).toContain('class="markdown-inline-image"');
  expect(renderInlineMarkdown('<img src="javascript:alert(1)">')).toContain("&lt;img");

  const excerptSource = app.slice(app.indexOf("const ISSUE_ASSESSMENT_EXCERPT_LIMIT"), app.indexOf("function issueAssessmentPathExplanation"));
  const { issueAssessmentExcerpt, issueAssessmentProofExcerpts } = new Function("state", `${excerptSource}; return { issueAssessmentExcerpt, issueAssessmentProofExcerpts };`)({ session: { comparison: { files: [] } } }) as {
    issueAssessmentExcerpt: (path: string, content: string, terms: string[]) => { startLine: number; lines: string[] };
    issueAssessmentProofExcerpts: (item: unknown, path: string, content: string, terms: string[]) => Array<{ role?: string; startLine: number; lines: string[] }>;
  };
  const excerpt = issueAssessmentExcerpt("LegalNavHost.kt", [
    "package example",
    "import example.LegalScene",
    "import example.ProfileScreen",
    "data object Terms : ProfileDestination",
    "onTermsClick = { navController.navigate(ProfileDestination.Terms) }",
  ].join("\n"), ["profile", "terms"]);
  expect(excerpt.startLine).toBe(5);
  expect(excerpt.lines.join("\n")).not.toContain("import example.LegalScene");
  expect(excerpt.lines.join("\n")).not.toContain("data object Terms");

  const proof = issueAssessmentProofExcerpts({
    criterion: "Entries are sorted by creation date",
    evidence: "The implementation sorts incoming entries before returning the ordered result.",
    pathExplanations: [{ explanation: "This function receives entries, orders them, and returns the result." }],
  }, "EntrySorter.kt", [
    "import example.Entry",
    "fun sortEntries(entries: List<Entry>): List<Entry> {",
    "  val ordered = entries.sortedBy { it.createdAt }",
    "  return ordered",
    "}",
  ].join("\n"), ["entries", "sort", "ordered"]);
  expect(proof.map((excerpt) => excerpt.role)).toEqual(["Input", "Transformation", "Output"]);
  expect(proof[1].lines.join("\n")).toContain("sortedBy");
  expect(proof[2].lines.join("\n")).toContain("return ordered");
});

test("GitHub issue assessment discloses its bounded provider scope and model basis", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(join(root, "public", "index.html"), "utf8"),
    readFile(join(root, "public", "app.js"), "utf8"),
    readFile(join(root, "public", "styles.css"), "utf8"),
  ]);
  expect(app).toContain("Issue-to-implementation assessment");
  expect(app).toContain("related issues and earlier pull requests: not requested");
  expect(app).toContain("Only issue metadata and explicit criteria are retained");
  expect(app).toContain("statuses are not verified test results");
  expect(app).toContain("issue.access !== \"available\"");
  expect(app).toContain("function issueAssessmentItems(items)");
  expect(app).toContain("function linkedIssueSummary(issue, reviewerTask)");
  expect(app).toContain("function reviewerTaskSummary(issue, task)");
  expect(app).toContain("Task-to-implementation assessment");
  expect(app).toContain("not sent to GitHub");
  expect(app).toContain('data-reviewer-task-edit');
  expect(app).toContain('data-reviewer-task-toggle');
  expect(app).toContain("Collapse task");
  expect(app).toContain("Expand task");
  expect(app).toContain('api("/api/pull-request/reviewer-task"');
  expect(app).toContain('class="pull-request-context"');
  expect(app).toContain('class="linked-issue-criteria"');
  expect(app).toContain('data-pull-request-width aria-pressed="${state.pullRequestWide}"');
  expect(app).toContain('window.localStorage.setItem(preferenceKey("pull-request-wide"), String(state.pullRequestWide))');
  expect(app).toContain('elements["pull-request-content"].addEventListener("click", togglePullRequestContentWidth)');
  expect(app).toContain('<details class="issue-criterion ${escapeHtml(item.status)}">');
  expect(app).toContain("issueAssessmentItems(assessment.items)");
  expect(app).toContain("function issueEvidencePathLinks(paths)");
  expect(app).toContain('data-issue-evidence-file="${escapeHtml(path)}"');
  expect(app).toContain('data-issue-assessment-explain="${escapeHtml(item.criterionId)}"');
  expect(app).toContain("function openIssueAssessmentExplanation(item, returnTarget)");
  expect(app).toContain("This is a model explanation based on cited repository paths. It is not a verified test result.");
  expect(app).toContain("const ISSUE_ASSESSMENT_EXCERPT_LIMIT = 3;");
  expect(app).toContain("function issueAssessmentExcerpt(path, content, terms)");
  expect(app).toContain("function issueAssessmentPathExplanation(item, path)");
  expect(app).toContain("async function hydrateIssueAssessmentCodeExcerpts(item, requestId)");
  expect(app).toContain('data-issue-assessment-excerpt-highlight="${escapeHtml(id)}"');
  expect(app).toContain('api(`/api/files?path=${encodeURIComponent(path)}`)');
  expect(app).toContain('body: JSON.stringify({ groups, theme: state.syntaxTheme })');
  expect(app).toContain("function dismissIssueAssessmentOnBackdrop(event)");
  expect(app).toContain('elements["issue-assessment-dialog"].addEventListener("click", dismissIssueAssessmentOnBackdrop)');
  expect(app).toContain("async function showIssueEvidenceFile(path)");
  expect(app).toContain("elements[\"pull-request-content\"].addEventListener(\"click\", handleIssueAssessmentClick)");
  expect(html).toContain('id="issue-assessment-dialog"');
  expect(html).toContain('id="close-issue-assessment"');
  expect(html).toContain('id="reviewer-task-dialog"');
  expect(html).toContain('id="reviewer-task-body"');
  expect(html).toContain('data-reviewer-task-mode="preview"');
  expect(html).toContain('id="reviewer-task-preview"');
  expect(html).toContain("Tab indents selected lines");
  expect(app).toContain("function updateReviewerTaskPreview()");
  expect(app).toContain("function handleReviewerTaskEditorKeydown(event)");
  expect(app).toContain('elements["reviewer-task-body"].addEventListener("keydown", handleReviewerTaskEditorKeydown)');
  expect(app).toContain("assessmentPending");
  expect(styles).toContain(".issue-criterion.implemented");
  expect(styles).toContain(".issue-criterion.missing");
  expect(styles).toContain(".issue-criterion.unclear");
  expect(styles).toContain(".issue-criterion summary");
  expect(styles).toContain(".issue-criteria, .issue-criterion, .issue-criterion summary, .issue-criterion-title { min-width: 0; max-width: 100%; }");
  expect(styles).toContain(".issue-criterion-title { overflow-wrap: anywhere; white-space: normal;");
  expect(styles).toContain("@container (max-width: 560px) { .issue-criterion summary { grid-template-columns: 12px minmax(0, 1fr); }");
  expect(styles).toContain(".issue-assessment-evidence");
  expect(styles).toContain(".issue-evidence-file");
  expect(styles).toContain(".issue-evidence-file { display: inline; max-width: 100%;");
  expect(styles).toContain("overflow-wrap: anywhere; word-break: break-word;");
  expect(styles).toContain(".issue-assessment-dialog");
  expect(styles).toContain(".reviewer-task-dialog");
  expect(styles).toContain(".reviewer-task-preview");
  expect(styles).toContain(".issue-assessment-code-excerpt");
  expect(styles).toContain(".issue-assessment-code-excerpts");
  expect(styles).toContain(".issue-assessment-excerpt-heading");
  expect(styles).toContain("white-space: pre-wrap");
  expect(styles).toContain("overflow-wrap: anywhere");
  expect(styles).toContain(".pull-request-context { display: grid;");
  expect(styles).toContain(".pull-request-content.wide { max-width: none; }");
  expect(styles).toContain(".pull-request-header-actions");
  expect(styles).toContain("grid-template-columns: repeat(auto-fit, minmax(min(100%, 390px), 1fr));");
  expect(styles).toContain(".pull-request-content > .panel-heading { height: auto;");
  expect(styles).toContain(".reviewer-task-heading h3 { margin: 0; white-space: nowrap; }");
  expect(styles).toContain(".reviewer-task-actions { display: flex;");

  const summarySource = app.slice(app.indexOf("function reviewerTaskSummary(issue, task)"), app.indexOf("async function api("));
  const linkedIssueSummary = new Function("escapeHtml", "state", `${summarySource}; return linkedIssueSummary;`)((value: unknown) => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;"), { reviewerTaskCollapsed: false }) as (issue: unknown, reviewerTask?: unknown) => string;
  const linked = linkedIssueSummary({
    number: 12,
    title: "Bounded linked issue",
    url: "https://github.com/example/repo/issues/12",
    access: "available",
    criteriaStatus: "found",
    acceptanceCriteria: [{ id: "criterion-1", text: "Only explicit criteria are retained" }],
  });
  expect(linked).toContain("Linked issue");
  expect(linked).toContain("Only explicit criteria are retained");
  expect(linked).toContain("related issues and earlier pull requests: not requested");

  const manual = linkedIssueSummary(undefined, {
    criteriaStatus: "found",
    acceptanceCriteria: [{ id: "criterion-1", text: "A reviewer can supply this task locally" }],
  });
  expect(manual).toContain("Reviewer task");
  expect(manual).toContain("not sent to GitHub");

  const escape = (value: unknown) => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
  const assessmentSource = app.slice(app.indexOf("function issueEvidencePathLinks(paths)"), app.indexOf("function reviewerTaskSummary(issue, task)"));
  const issueAssessmentItems = new Function("escapeHtml", "renderInlineMarkdown", `${assessmentSource}; return issueAssessmentItems;`)(escape, escape) as (items: unknown[]) => string;
  const assessmentMarkup = issueAssessmentItems([{
    criterionId: "criterion-1",
    criterion: "Only explicit criteria are retained",
    status: "implemented",
    evidence: "src/github.ts bounds parsing to explicit criteria.",
    evidencePaths: ["src/github.ts", "tests/github.test.ts"],
  }]);
  expect(assessmentMarkup).toContain('data-issue-evidence-file="src/github.ts"');
  expect(assessmentMarkup).toContain('data-issue-evidence-file="tests/github.test.ts"');
  expect(assessmentMarkup).toContain('data-issue-assessment-explain="criterion-1"');

  const excerptSource = app.slice(app.indexOf("const ISSUE_ASSESSMENT_EXCERPT_LIMIT"), app.indexOf("function reviewerTaskSummary(issue, task)"));
  const issueAssessmentExcerpt = new Function("state", `${excerptSource}; return issueAssessmentExcerpt;`)({
    session: {
      comparison: {
        files: [{ path: "src/assessment.ts", hunks: [{ rows: [{ kind: "addition", newLine: 12, content: 'const status = "implemented";' }] }] }],
      },
    },
  }) as (path: string, content: string, terms: string[]) => { path: string; startLine: number; lines: string[] };
  const excerpt = issueAssessmentExcerpt("src/assessment.ts", Array.from({ length: 25 }, (_, index) => index === 11 ? 'const status = "implemented";' : `const line${index + 1} = true;`).join("\n"), ["implemented"]);
  expect(excerpt).toMatchObject({ path: "src/assessment.ts", startLine: 4 });
  expect(excerpt.lines).toHaveLength(15);
  expect(excerpt.lines).toContain('const status = "implemented";');

  const excerptMarkupSource = app.slice(app.indexOf("function issueAssessmentPathExplanation(item, path)"), app.indexOf("function issueAssessmentExcerptSection(item)"));
  const { issueAssessmentExcerptMarkup } = new Function("escapeHtml", `${excerptMarkupSource}; return { issueAssessmentExcerptMarkup };`)(escape) as {
    issueAssessmentExcerptMarkup: (excerpt: { path: string; startLine: number; lines: string[] }, id: string, explanation: string) => string;
  };
  expect(issueAssessmentExcerptMarkup(excerpt, "excerpt", "The changed status is validated here.")).toContain("How it contributes:");
  expect(issueAssessmentExcerptMarkup(excerpt, "excerpt", "The changed status is validated here.")).toContain("The changed status is validated here.");

  const backdropSource = app.slice(app.indexOf("function dismissIssueAssessmentOnBackdrop(event)"), app.indexOf("async function showIssueEvidenceFile(path)"));
  let closes = 0;
  const dialog = {
    getBoundingClientRect: () => ({ left: 20, right: 100, top: 30, bottom: 80 }),
    close: () => { closes += 1; },
  };
  const dismissIssueAssessmentOnBackdrop = new Function("elements", `${backdropSource}; return dismissIssueAssessmentOnBackdrop;`)({ "issue-assessment-dialog": dialog }) as (event: { target: unknown; clientX: number; clientY: number }) => void;
  dismissIssueAssessmentOnBackdrop({ target: dialog, clientX: 10, clientY: 20 });
  dismissIssueAssessmentOnBackdrop({ target: dialog, clientX: 60, clientY: 50 });
  dismissIssueAssessmentOnBackdrop({ target: {}, clientX: 10, clientY: 20 });
  expect(closes).toBe(1);
});

test("reviewer task editor keeps Tab inside the Markdown source and indents selected lines", async () => {
  const app = await readFile(join(root, "public", "app.js"), "utf8");
  const source = app.slice(app.indexOf("function updateReviewerTaskIndentation"), app.indexOf("async function saveReviewerTask"));
  const InputEvent = class { constructor(readonly type: string) {} };
  const updateIndentation = new Function("Event", `${source}; return updateReviewerTaskIndentation;`)(InputEvent) as (textarea: {
    value: string;
    selectionStart: number;
    selectionEnd: number;
    setSelectionRange: (start: number, end: number) => void;
    dispatchEvent: (event: { type: string }) => void;
  }, outdent: boolean) => void;
  const events: string[] = [];
  const textarea = {
    value: "first line\nsecond line",
    selectionStart: 0,
    selectionEnd: "first line\nsecond line".length,
    setSelectionRange(start: number, end: number) {
      this.selectionStart = start;
      this.selectionEnd = end;
    },
    dispatchEvent(event: { type: string }) { events.push(event.type); },
  };

  updateIndentation(textarea, false);
  expect(textarea).toMatchObject({ value: "  first line\n  second line", selectionStart: 2, selectionEnd: 26 });
  updateIndentation(textarea, true);
  expect(textarea).toMatchObject({ value: "first line\nsecond line", selectionStart: 0, selectionEnd: 22 });
  expect(events).toEqual(["input", "input"]);
});

test("saving a reviewer task closes its dialog before the background assessment responds", async () => {
  const app = await readFile(join(root, "public", "app.js"), "utf8");
  const source = app.slice(app.indexOf("async function saveReviewerTask()"), app.indexOf("async function api("));
  let closed = 0;
  let resolveRequest: (value: unknown) => void = () => undefined;
  const state = { busy: false, session: { status: "open" } } as { busy: boolean; session: unknown };
  const elements = {
    "reviewer-task-body": { value: "## Acceptance Criteria\n- [ ] Persist the task" },
    "reviewer-task-dialog": { close: () => { closed += 1; } },
  };
  const saveReviewerTask = new Function("state", "elements", "reviewIsOpen", "setBusy", "api", "renderSession", "toast", `${source}; return saveReviewerTask;`)(
    state,
    elements,
    () => true,
    (busy: boolean) => { state.busy = busy; },
    () => new Promise((resolve) => { resolveRequest = resolve; }),
    () => undefined,
    () => undefined,
  ) as () => Promise<void>;

  const saving = saveReviewerTask();
  expect(closed).toBe(1);
  expect(state.busy).toBe(true);
  resolveRequest({ pullRequest: { reviewerTask: { assessmentPending: true } } });
  await saving;
  expect(state.busy).toBe(false);
});

test("pull request description controls switch the rendered and raw source views", async () => {
  const app = await readFile(join(root, "public", "app.js"), "utf8");
  const source = app.slice(app.indexOf("function setPullRequestDescriptionMode("), app.indexOf("async function api("));
  const state = { prDescriptionMode: "rendered", prDescriptionCollapsed: false };
  let pullRequestRenders = 0;
  let overviewRenders = 0;
  let focused = false;
  const setMode = new Function("state", "renderPullRequest", "renderReviewOverview", `${source}; return setPullRequestDescriptionMode;`)(
    state,
    () => { pullRequestRenders += 1; },
    () => { overviewRenders += 1; },
  ) as (event: { target: { closest: (selector: string) => unknown }; currentTarget: { querySelector: (selector: string) => { focus: (options: FocusOptions) => void } | null } }) => void;

  setMode({
    target: { closest: () => ({ dataset: { prDescriptionMode: "source" } }) },
    currentTarget: { querySelector: () => ({ focus: () => { focused = true; } }) },
  });

  expect(state.prDescriptionMode).toBe("source");
  expect(pullRequestRenders).toBe(1);
  expect(overviewRenders).toBe(1);
  expect(focused).toBe(true);

  setMode({
    target: { closest: (selector: string) => selector === "[data-pr-description-toggle]" ? { dataset: { prDescriptionToggle: "" } } : null },
    currentTarget: { querySelector: () => ({ focus: () => { focused = true; } }) },
  });

  expect(state.prDescriptionCollapsed).toBe(true);
  expect(pullRequestRenders).toBe(2);
  expect(overviewRenders).toBe(2);
  expect(app).toContain('aria-label="Raw Markdown source"');
  expect(app).toContain("data-pr-description-toggle");
  expect(app).toContain("Collapse description");
  expect(app).toContain("Expand description");
  expect(app).toContain('elements["pull-request-content"].addEventListener("click", setPullRequestDescriptionMode)');
  expect(app).toContain('elements["pull-request-description"].addEventListener("click", setPullRequestDescriptionMode)');
});

test("pull request content can use and persist the full available width", async () => {
  const [app, styles] = await Promise.all([
    readFile(join(root, "public", "app.js"), "utf8"),
    readFile(join(root, "public", "styles.css"), "utf8"),
  ]);
  const source = app.slice(app.indexOf("function setPullRequestContentWidth("), app.indexOf("function initializeUiPreferences("));
  const classes = new Set<string>();
  const workspaceClasses = new Set<string>();
  const writes: Array<[string, string]> = [];
  const state = { pullRequestWide: false };
  const setWidth = new Function("state", "elements", "window", "preferenceKey", `${source}; return setPullRequestContentWidth;`)(
    state,
    {
      "pull-request-content": { classList: { toggle: (name: string, enabled: boolean) => { if (enabled) classes.add(name); else classes.delete(name); } } },
      workspace: { classList: { toggle: (name: string, enabled: boolean) => { if (enabled) workspaceClasses.add(name); else workspaceClasses.delete(name); } } },
    },
    { localStorage: { setItem: (key: string, value: string) => writes.push([key, value]) } },
    (name: string) => `review-tour:test:${name}`,
  ) as (wide: boolean, persist?: boolean) => void;

  setWidth(true, true);

  expect(state.pullRequestWide).toBe(true);
  expect(classes.has("wide")).toBe(true);
  expect(workspaceClasses.has("pull-request-wide")).toBe(true);
  expect(writes).toEqual([["review-tour:test:pull-request-wide", "true"]]);
  expect(styles).toContain(".workspace.pull-request-wide");
  expect(styles).toContain(".workspace.pull-request-wide .file-panel,");
  expect(styles).toContain(".workspace.pull-request-wide .agent-panel { display: none; }");
});

test("GitHub check snapshots explain known state, can be updated, and link commit revisions", async () => {
  const [app, styles] = await Promise.all([
    readFile(join(root, "public", "app.js"), "utf8"),
    readFile(join(root, "public", "styles.css"), "utf8"),
  ]);
  const source = app.slice(app.indexOf("function githubStatusLabel("), app.indexOf("function renderPullRequest("));
  const helpers = new Function(`${source}; return { githubCheckStatus, githubPullRequestStatus, githubCommitUrl };`)() as {
    githubCheckStatus: (state: string) => { label: string; explanation: string };
    githubPullRequestStatus: (pullRequest: { state?: string; mergeable?: string; mergeStateStatus?: string }) => { heading: string; details: string[] };
    githubCommitUrl: (pullRequest: { repository: string; number: number; url: string }, oid: string) => string;
  };

  expect(helpers.githubCheckStatus("IN_PROGRESS")).toEqual({ label: "Running", explanation: "GitHub has not reported a final result for this check." });
  expect(helpers.githubCheckStatus("FAILURE")).toEqual({ label: "Needs attention", explanation: "GitHub reported Failure. Open the check run for provider details." });
  expect(helpers.githubPullRequestStatus({ mergeable: "MERGEABLE", mergeStateStatus: "UNSTABLE" })).toEqual({
    heading: "Mergeability",
    details: ["No merge conflict reported by GitHub.", "GitHub has not provided a stable merge status. This review snapshot does not include why."],
  });
  expect(helpers.githubPullRequestStatus({ state: "MERGED", mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" })).toEqual({
    heading: "Pull request status",
    details: ["This pull request has been merged. Mergeability is no longer applicable."],
  });
  expect(helpers.githubCommitUrl({ repository: "acme/widgets", number: 7, url: "https://github.com/acme/widgets/pull/7" }, "a".repeat(40))).toBe(`https://github.com/acme/widgets/commit/${"a".repeat(40)}`);
  expect(helpers.githubCommitUrl({ repository: "acme/widgets", number: 7, url: "https://example.test/acme/widgets/pull/7" }, "a".repeat(40))).toBe("");
  expect(app).toContain("function githubChecksSummary(pullRequest)");
  expect(app).toContain("Snapshot captured when this review was loaded.");
  expect(app).toContain("data-github-snapshot-refresh");
  expect(app).toContain("function refreshGitHubSnapshot(event)");
  expect(app).toContain("githubSnapshotRefreshing");
  expect(app).toContain("Updating snapshot…");
  expect(app).toContain('elements["pull-request-content"].addEventListener("click", refreshGitHubSnapshot)');
  expect(app).toContain("function githubCommitUrl(pullRequest, oid)");
  expect(app).toContain("github-commit-link");
  expect(app).toContain("this review does not fetch check or workflow details.");
  expect(app).toContain('target="_blank" rel="noreferrer">View run in GitHub</a>');
  expect(styles).toContain(".github-checks {");
  expect(styles).toContain(".github-check-list {");
  expect(styles).toContain(".github-checks-actions {");
  expect(styles).toContain(".github-snapshot-progress {");
});

test("pull request file links retain their reading position and provide a return control", async () => {
  const [app, html, styles] = await Promise.all([
    readFile(join(root, "public", "app.js"), "utf8"),
    readFile(join(root, "public", "index.html"), "utf8"),
    readFile(join(root, "public", "styles.css"), "utf8"),
  ]);
  const source = app.slice(app.indexOf("function rememberPullRequestReturn()"), app.indexOf("let currentStepReturnFrame"));
  const state = { activeTab: "pull-request", tabScrollPositions: new Map<string, number>(), pullRequestReturn: null as { scrollTop: number } | null, session: { pullRequest: {} } };
  const elements = { "diff-panel": { scrollTop: 1_240 } };
  const activations: string[] = [];
  const helpers = new Function("state", "elements", "activateReviewTab", `${source}; return { rememberPullRequestReturn, returnToPullRequest };`)(
    state, elements, (tab: string) => activations.push(tab),
  ) as { rememberPullRequestReturn: () => boolean; returnToPullRequest: () => void };

  expect(helpers.rememberPullRequestReturn()).toBe(true);
  expect(state.tabScrollPositions.get("pull-request")).toBe(1_240);
  state.activeTab = "diff";
  helpers.returnToPullRequest();
  expect(state.pullRequestReturn).toBeNull();
  expect(activations).toEqual(["pull-request"]);
  expect(html).toContain('id="pull-request-return"');
  expect(app).toContain('elements["pull-request-return"].addEventListener("click", returnToPullRequest)');
  expect(styles).toContain(".current-step-return, .pull-request-return {");
});

test("GitHub review threads open their file and remain visible beside the diff", async () => {
  const [app, styles] = await Promise.all([
    readFile(join(root, "public", "app.js"), "utf8"),
    readFile(join(root, "public", "styles.css"), "utf8"),
  ]);
  expect(app).toContain("function githubReviewThreadCard(thread)");
  expect(app).toContain('data-github-thread-jump="${escapeHtml(thread.id)}"');
  expect(app).toContain("function renderGitHubReviewThreads()");
  expect(app).toContain('inline.className = `github-thread-inline ${thread.resolved ? "resolved" : "open"}`');
  expect(app).toContain("function handleGitHubReviewThreadClick(event)");
  expect(app).toContain('void showAnalysisFile(thread.path, thread.line, thread.side ?? "new")');
  expect(app).toContain('elements["pull-request-content"].addEventListener("click", handleGitHubReviewThreadClick)');
  expect(app).toContain("Reply in GitHub");
  expect(styles).toContain(".github-thread-inline {");
  expect(styles).toContain(".split-github-thread {");
  expect(styles).toContain(".github-thread-card .comment-jump");
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
  expect(app).toContain('const briefingWasOpen = elements["tour-intro-dialog"].open;');
  expect(app).toContain("if (briefingWasOpen) {");
  expect(app).toContain('elements["tour-intro-dialog"].querySelector(".tour-intro-scroll").scrollTop = briefingScroll;');
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
  expect(app).toContain('elements["architecture-viewer-legend"].innerHTML = architecture.value.kind ? adaptiveLegend(architecture.value.kind) : architectureLegend()');
  expect(app).toContain('<header class="architecture-card-heading"><div>');
  expect(app).toContain('${architectureDiagramExpandButton(label, key)}</header>');
  expect(app).toContain('data-diagram-expand="${escapeHtml(key)}"');
  expect(app).toContain('?? elements["architecture-content"].querySelector(`[data-architecture-diagram="${CSS.escape(key)}"]`)');
  expect(app).toContain("state.architectureDiagramViews.set(viewerKey, { x: 0, y: 0, scale: 1 })");
  expect(app).toContain("function changeArchitectureDiagramView(key, action)");
  expect(app).toContain('svg.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`');
  expect(app).toContain("function registerArchitectureDiagramInteractions(container)");
  expect(app).toContain("function interactiveDiagramKey(diagram)");
  expect(app).toContain(".architecture-diagram[data-adaptive-diagram]");
  expect(app).toContain("event.ctrlKey");
  expect(app).toContain("Math.exp(-event.deltaY * 0.01)");
  expect(app).toContain('const expandButton = event.target.closest("[data-diagram-expand]")');
  expect(app).toContain("openArchitectureDiagramViewer(expandButton.dataset.diagramExpand)");
  expect(app).toContain('registerArchitectureDiagramInteractions(elements["tour-intro-architecture"])');
  expect(app).toContain("registerArchitectureDiagramInteractions(elements.architecture)");
  expect(app).toContain('registerArchitectureDiagramInteractions(elements["adaptive-view"])');
  expect(app).toContain('registerArchitectureDiagramInteractions(elements["architecture-viewer-dialog"])');
  expect(app).toContain('briefingDiagramExpandButton("sequence diagram", "sequence", flow.id)');
  expect(app).toContain('elements.flows.querySelector(`[data-flow-index="${state.session.outline.flows.indexOf(sequence)}"]`)');
  expect(app).toContain('aria-label="Architecture diagram legend"');
  expect(app).toContain('`${architectureLegend()}${architectures.map');
  expect(styles).toContain(".architecture-diagram.dragging");
  expect(styles).toContain(".architecture-legend { grid-column: 1 / -1;");
  expect(styles).toContain(".adaptive-legend { display: flex; flex-wrap: wrap; align-items: center; gap: 7px 16px; margin: 0 0 12px;");
  expect(styles).toContain(".architecture-legend i.removed { border-color: var(--architecture-removed); border-style: dashed; }");
  expect(styles).toContain(".architecture-viewer-dialog[open]");
  expect(styles).toContain(".architecture-content { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));");
  expect(styles).toContain(".architecture-viewer-dialog .architecture-legend { justify-content: center;");
  expect(styles).toContain("touch-action: none");
});

test("diagram zoom can scale a tall chart down to a comfortable viewer fit", async () => {
  const app = await readFile(join(root, "public/app.js"), "utf8");
  const source = app.slice(app.indexOf("const ARCHITECTURE_ZOOM_MIN"), app.indexOf("function architectureCard("));
  const state = { architectureDiagramViews: new Map() };
  const controls = new Function(
    "state",
    "document",
    "CSS",
    `${source}; return { architectureDiagramView, changeArchitectureDiagramView };`,
  )(state, { querySelector: () => null }, { escape: (value: string) => value }) as {
    architectureDiagramView(key: string): { scale: number };
    changeArchitectureDiagramView(key: string, action: string): void;
  };

  for (let index = 0; index < 4; index += 1) controls.changeArchitectureDiagramView("tall-state-machine", "zoom-out");
  expect(controls.architectureDiagramView("tall-state-machine").scale).toBe(0.25);
  controls.changeArchitectureDiagramView("tall-state-machine", "zoom-out");
  expect(controls.architectureDiagramView("tall-state-machine").scale).toBe(0.25);
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
  expect(app).toContain('elements["show-tour-briefing"].disabled = state.briefingPreferencesSaving;');
  expect(app).toContain('const disabled = state.briefingPreferencesSaving || !elements["show-tour-briefing"].checked;');
  expect(app).toContain("state.briefingPreferencesSaving = true;");
  expect(app).toContain("state.briefingPreferencesSaving = false;");
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
  expect(styles).toContain("grid-template-rows: 54px 44px;");
  expect(styles).toContain(".topbar > .tabs { grid-column: 1 / -1; grid-row: 2; }");
  expect(styles).toContain(".topbar > .actions { grid-column: 2; grid-row: 1; }");
  expect(styles).toContain("height: calc(100vh - 98px);");
  expect(styles).toContain(".focus-mode .topbar { height: 58px; grid-template-rows: 58px; }");
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
  expect(styles).toContain(".collapse-caret { position: absolute; left: 1px; top: 2px;");
  expect(styles).toContain(".diff-file.collapsed .collapse-caret { transform: rotate(-45deg); }");
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
  expect(app).toContain("function selectedQuotation(comment)");
  expect(app).not.toContain("initialBody: quotedCode(selected.text)");
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
  expect(styles).toContain(".comment-quote-details summary");
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

test("images and videos are exposed through an authenticated media tab with an empty state", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(join(root, "public/index.html"), "utf8"),
    readFile(join(root, "public/app.js"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  expect(html).toContain('id="screenshots-tab" class="tab"');
  expect(html).toContain('id="screenshots-view" class="review-view hidden"');
  expect(html).toContain('>Media <span id="screenshots-tab-count" class="tab-count hidden">0</span>');
  expect(app).toContain("function changedImageMedia()");
  expect(app).toContain("const mediaCount = screenshots.length + changedImages.length");
  expect(app).toContain('"conversations", "screenshots", ...(state.session?.pullRequest');
  expect(app).toContain('elements["screenshots-tab-count"].classList.toggle("hidden", mediaCount === 0)');
  expect(app).toContain('No media is available for this review.');
  expect(app).toContain('"X-Review-Tour-Token": state.apiToken');
  expect(app).toContain('apiBlob(`/api/screenshots/${encodeURIComponent(shot.id)}`)');
  expect(app).toContain('apiBlob(`/api/diff/image?${new URLSearchParams({ path: image.path, side: image.side })}`)');
  expect(app).toContain('shot.mimeType === "video/mp4"');
  expect(styles).toContain(".screenshot-gallery { display: grid;");
  expect(styles).toContain(".media-empty { grid-column: 1 / -1; }");
  expect(styles).toContain(".changed-image-media > a");
  expect(styles).toContain(".tab { flex: 0 0 auto;");
  expect(styles).toContain("font-size: 13px;");
});
