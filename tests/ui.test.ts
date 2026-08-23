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
  expect(app).toContain("setFilePanelWidth(fileResizeStart.width + event.clientX - fileResizeStart.x)");
  expect(app).toContain("setAgentPanelWidth(agentResizeStart.width + agentResizeStart.x - event.clientX)");
  expect(app).toContain("state.session.pullRequest?.sourceRepositoryRoot ?? state.session.comparison.repositoryRoot");
  expect(styles).toContain("grid-template-columns: var(--file-panel-width)");
  expect(styles).toContain("var(--agent-panel-width)");
  expect(app).not.toContain('id="changed-only"');
  expect(styles).toContain(".count, .mode { flex: 0 0 auto; white-space: nowrap;");
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
  expect(app).toContain('const candidates = [state.visibleFile, currentStep()?.anchor.path]');
  expect(styles).toContain(".file-filter-toggle.active");

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
  const [app, styles] = await Promise.all([
    readFile(join(root, "public/app.js"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  const renderTour = app.slice(app.indexOf("function renderTour()"), app.indexOf("function renderFilteredDiff()"));
  expect(app).toContain('note.className = `tour-code-note${step.id === activeStep.id ? " active" : ""}`');
  expect(app).toContain("compactText(step.objective, 180)");
  expect(app).toContain('rows[0].classList.add("tour-anchor-start")');
  expect(app).toContain('rows.at(-1).classList.add("tour-anchor-end")');
  expect(styles).toContain(".diff-row.tour-anchor-start");
  expect(app).toContain("const phase = currentPhase()");
  expect(app).toContain("for (let index = phase.steps.length - 1; index >= 0; index -= 1)");
  expect(app).toContain('insertAdjacentElement("beforebegin", note)');
  expect(app).toContain('document.querySelector(".tour-code-note.active")');
  expect(app).toContain("async function focusCurrentStep()");
  expect(renderTour).not.toContain("scrollIntoView");
  expect(renderTour).not.toContain("showChangedFile");
  expect(app).not.toContain("Planning tour · 0s");
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
  expect(app).toContain("Current prompt");
  expect(app).toContain("elapsed");
  expect(app).toContain('const promptWasOpen = renderedActivityId === activity.id');
  expect(app).toContain('promptWasOpen ? " open" : ""');
  expect(app).toContain('dataset.contentKey !== contentKey');
  expect(app).toContain('querySelector(".agent-activity-elapsed").textContent');
  expect(app).toContain("the tour will switch to a local fallback agent automatically");
  expect(app).toContain('const prefetchSteps = state.session.preferences?.prefetchSteps ?? 2');
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
  expect(app).toContain("loading all ${filteredChangedFiles().length} files in this phase");
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
  const [html, app] = await Promise.all([
    readFile(join(root, "public/index.html"), "utf8"),
    readFile(join(root, "public/app.js"), "utf8"),
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
  expect(app).toContain("evidence.open = true");
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
  expect(app).toContain('output.push(`<h${level}>');
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
  expect(html).toContain('id="tour-intro-dialog"');
  expect(html).toContain('id="begin-tour"');
  expect(html).toContain('id="tour-intro-architecture"');
  expect(app).toContain('tourIntroPending: launchTourIntro');
  expect(app).toContain('state.session.pullRequest?.title ?? state.session.outline.title');
  expect(app).toContain('if (state.session.outline && state.focusedStepId === null && !state.tourIntroPending)');
  expect(app).toContain('state.focusedStepId = state.tourIntroPending ? null : currentStep()?.id ?? null');
  expect(app).toContain('if (!state.tourIntroPending) await focusCurrentStep()');
  expect(app).toContain('elements["tour-intro-dialog"].showModal()');
  expect(app).toContain('state.tourIntroPending = false');
  expect(app).toContain('await focusCurrentStep()');
  expect(styles).toContain('.tour-intro-dialog');
  expect(styles).toContain('.tour-intro-architecture');
});

test("each architecture chart has independent movement and zoom controls", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(join(root, "public/index.html"), "utf8"),
    readFile(join(root, "public/app.js"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  expect(html).toContain('id="architecture-viewer-dialog"');
  expect(html).toContain('id="architecture-viewer-diagram"');
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
  expect(app).toContain('data-diagram-expand="${escapeHtml(key)}"');
  expect(app).toContain("state.architectureDiagramViews.set(viewerKey, { x: 0, y: 0, scale: 1 })");
  expect(app).toContain("function changeArchitectureDiagramView(key, action)");
  expect(app).toContain('svg.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`');
  expect(app).toContain("function registerArchitectureDiagramInteractions(container)");
  expect(app).toContain("registerArchitectureDiagramInteractions(elements.architecture)");
  expect(app).toContain('registerArchitectureDiagramInteractions(elements["architecture-viewer-dialog"])');
  expect(styles).toContain(".architecture-diagram.dragging");
  expect(styles).toContain(".architecture-viewer-dialog[open]");
  expect(styles).toContain("touch-action: none");
});

test("settings consolidate runtime preferences, exports, and sessions", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(join(root, "public/index.html"), "utf8"),
    readFile(join(root, "public/app.js"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  expect(html).toContain('<details id="settings-menu" class="settings-menu">');
  expect(html).toContain('id="prefetch-steps"');
  expect(html).toContain('id="theme-select"');
  expect(html).toContain('id="diff-layout"');
  expect(html).toContain('id="tree-mode"');
  expect(html).toContain('data-export-format="markdown">Markdown');
  expect(html).toContain('data-export-format="html">HTML');
  expect(html).not.toContain('id="export-format"');
  expect(app).toContain("async function downloadExport(format)");
  expect(app).toContain('api("/api/preferences", { method: "POST", body: JSON.stringify({ prefetchSteps }) })');
  expect(styles).toContain(".settings-popover { position: absolute;");
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
  expect(app).toContain("state.session.pullRequest?.repository ?? comparison.repositoryName");
  expect(app).toContain("state.session.pullRequest?.headRefName ?? comparison.branch");
  expect(app).toContain("`${repositoryName} · ${branchName}`");
  expect(styles).toContain(".repository-identity");
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
  expect(styles).toContain(".split-row { min-width: 0; display: grid;");
  expect(styles).toContain("min-height: 18px");
  expect(styles).toContain("line-height: 18px");
  expect(styles).toContain(".diff-row.split-side > .line-code { grid-column: 4; grid-row: 1; }");
  expect(styles).toContain(".diff-row:not(.split-side) > .line-code { grid-column: 5; grid-row: 1; }");
  expect(styles).not.toContain(".line-code::-webkit-scrollbar");
});

test("agent prose and selected paths wrap without widening the pane", async () => {
  const styles = await readFile(join(root, "public/styles.css"), "utf8");
  expect(styles).toContain(".tour-active { flex: 1 1 0; min-width: 0;");
  expect(styles).toContain(".tour-scroll { min-width: 0;");
  expect(styles).toContain(".explanation { min-width: 0; max-width: 100%; overflow-wrap: anywhere;");
  expect(styles).toContain(".anchor { max-width: 100%; overflow-wrap: anywhere;");
  expect(styles).toContain(".selection-pill { min-width: 0; max-width: 100%; overflow-wrap: anywhere;");
  expect(styles).toContain("white-space: normal;");
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
  expect(styles).toContain(".diff-file.collapsed .collapse-caret { transform: rotate(-90deg); }");
});

test("file headers stick to the diff viewport while their file is visible", async () => {
  const styles = await readFile(join(root, "public/styles.css"), "utf8");
  expect(styles).toContain(".diff-file { border: 1px solid var(--border); border-radius: 10px; margin-bottom: 16px; overflow: clip;");
  expect(styles).toContain(".diff-file-header { position: sticky; top: 0; z-index: 3;");
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

test("review comments render inline and their marker opens the existing editor", async () => {
  const [app, styles] = await Promise.all([
    readFile(join(root, "public/app.js"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  expect(app).toContain('document.querySelectorAll(".inline-comment")');
  expect(app).toContain('inline.className = `inline-comment ${comment.status}`');
  expect(app).toContain('data-inline-comment-id="${escapeHtml(comment.id)}"');
  expect(app).toContain('lane.className = `split-inline-comment ${comment.side}-side`');
  expect(app).toContain('splitRow.insertAdjacentElement("afterend", lane)');
  expect(app).toContain("action.dataset.inlineCommentId = comment.id");
  expect(app).toContain("if (comment && reviewIsOpen()) openCommentEditor(comment)");
  expect(styles).toContain(".inline-comment { box-sizing: border-box; position: sticky;");
  expect(styles).toContain(".inline-comment-button { width: 100%;");
  expect(styles).toContain(".split-inline-comment.new-side .inline-comment { grid-column: 2; }");
  expect(styles).toContain(".split-inline-comment.old-side .inline-comment { grid-column: 1; }");
});

test("files expand and collapse in place while line actions expose comment and agent choices", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(join(root, "public/index.html"), "utf8"),
    readFile(join(root, "public/app.js"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  expect(html).toContain("Choose a code line to reveal actions");
  expect(app).toContain('data-file-expansion="${file._full ? "compact" : "full"}"');
  expect(app).toContain('${file._full ? "Collapse file" : "Expand file"}');
  expect(app).toContain('query.set("full", String(requestedFull))');
  expect(app).toContain("function captureFileViewport(path)");
  expect(app).toContain("function restoreFileViewport(anchor)");
  expect(app).toContain("const viewportAnchor = requestedFull !== undefined ? captureFileViewport(path) : null");
  expect(app).toContain("if (!viewportAnchor) {");
  expect(app).toContain("if (viewportAnchor) restoreFileViewport(viewportAnchor)");
  expect(app).toContain('data-line-tool="comment"');
  expect(app).toContain('data-line-tool="ask"');
  expect(app).toContain("function openLineComment(row)");
  expect(app).toContain("function askAboutLine(row)");
  expect(styles).toContain(".line-tools");
  expect(styles).toContain(".diff-row:hover .line-tools");
});

test("split diff panes are resizable and synchronize horizontal scrolling per side", async () => {
  const [app, styles] = await Promise.all([
    readFile(join(root, "public/app.js"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  expect(styles).toContain(".hunk.split-layout { position: relative; width: 100%; min-width: 0; }");
  expect(styles).toContain("grid-template-columns: 42px 42px 22px max-content minmax(max-content, 1fr)");
  expect(styles).toContain("grid-template-columns: minmax(0, var(--split-old-width, 50%)) minmax(0, 1fr)");
  expect(styles).toContain(".split-resizer { position: absolute;");
  expect(styles).toContain(".diff-row.split-side { grid-template-columns: 42px 22px max-content minmax(max-content, 1fr); width: 100%; min-width: 0; overflow-x: auto;");
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
