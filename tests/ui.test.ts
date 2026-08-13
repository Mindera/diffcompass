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
  expect(html.slice(agent)).not.toContain('id="review-overview-title"');
  expect(app).toContain("pullRequestDescription(pullRequest.body)");
  expect(app).toContain('data-pr-description-mode="rendered"');
  expect(app).toContain('data-pr-description-mode="source"');
  expect(app).toContain('output.push(`<h${level}>');
  expect(app).toContain('const nextListType = /^\\d/.test(item[1]) ? "ol" : "ul"');
  expect(app).toContain('elements["review-overview-title"].textContent = outline.title');
});

test("export formats live inside the export action instead of masquerading as a page display selector", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(join(root, "public/index.html"), "utf8"),
    readFile(join(root, "public/app.js"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  expect(html).toContain('<details id="export-menu" class="export-menu">');
  expect(html).toContain('data-export-format="markdown">Markdown report');
  expect(html).toContain('data-export-format="html">HTML report');
  expect(html).not.toContain('id="export-format"');
  expect(app).toContain("async function downloadExport(format)");
  expect(styles).toContain(".export-options { position: absolute;");
});

test("topbar controls stay compact and name the theme selector", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(join(root, "public/index.html"), "utf8"),
    readFile(join(root, "public/app.js"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  expect(html).toContain('<label class="theme-control">\n          <span>Theme</span>');
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
  expect(html).toContain('<input id="include-flows" type="checkbox" checked /> Sequence diagrams');
  expect(html).toContain('<input id="include-findings" type="checkbox" checked /> Findings');
  expect(app).toContain('includeFlows: elements["include-flows"].checked');
  expect(app).toContain('includeFindings: elements["include-findings"].checked');
  expect(app).toContain('state.session.findingGenerationEnabled !== false');
  expect(app).toContain('if (!findingGenerationEnabled) elements["include-findings"].checked = false');
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
  expect(html).toContain("Partly verified: some links are inferred");
  expect(app).toContain('label: "Partly verified"');
  expect(app).toContain("Some links were traced; the remaining links are informed inferences.");
  expect(app).toContain('data-flow-file="${escapeHtml(path)}"');
  expect(app).toContain("Exact files were not captured for this saved tour. Regenerate this diagram to add them.");
  expect(app).toContain("The diagram source is invalid or unsupported.");
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

test("review comments render inline and their marker opens the existing editor", async () => {
  const [app, styles] = await Promise.all([
    readFile(join(root, "public/app.js"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  expect(app).toContain('document.querySelectorAll(".inline-comment")');
  expect(app).toContain('inline.className = `inline-comment ${comment.status}`');
  expect(app).toContain('data-inline-comment-id="${escapeHtml(comment.id)}"');
  expect(app).toContain("action.dataset.inlineCommentId = comment.id");
  expect(app).toContain("if (comment && reviewIsOpen()) openCommentEditor(comment)");
  expect(styles).toContain(".inline-comment { box-sizing: border-box; position: sticky;");
  expect(styles).toContain(".inline-comment-button { width: 100%;");
});

test("split diff panes remain equal width and synchronize horizontal scrolling per side", async () => {
  const [app, styles] = await Promise.all([
    readFile(join(root, "public/app.js"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  expect(styles).toContain(".hunk.split-layout { width: 100%; min-width: 0; }");
  expect(styles).toContain("grid-template-columns: 42px 42px 22px max-content minmax(max-content, 1fr)");
  expect(styles).toContain("grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)");
  expect(styles).toContain(".diff-row.split-side { grid-template-columns: 42px 22px max-content minmax(max-content, 1fr); width: 100%; min-width: 0; overflow-x: auto;");
  expect(styles).not.toContain("grid-template-columns: minmax(50%, max-content) minmax(50%, max-content)");
  expect(app).toContain('elements.diff.addEventListener("scroll"');
  expect(app).toContain("function syncSplitScroll(hunk, side, scrollLeft)");
  expect(app).toContain('elements.diff.addEventListener("wheel"');
  expect(app).toContain("event.preventDefault()");
});
