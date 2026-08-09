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
  expect(app).toContain("setFilePanelWidth(fileResizeStart.width + event.clientX - fileResizeStart.x)");
  expect(styles).toContain("grid-template-columns: var(--file-panel-width)");
  expect(app).not.toContain('id="changed-only"');
});

test("tour rendering annotates code without continuously stealing navigation", async () => {
  const app = await readFile(join(root, "public/app.js"), "utf8");
  const renderTour = app.slice(app.indexOf("function renderTour()"), app.indexOf("function renderFilteredDiff()"));
  expect(app).toContain('note.className = `tour-code-note${step.id === activeStep.id ? " active" : ""}`');
  expect(app).toContain("compactText(step.objective, 180)");
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

test("phase files and scoped findings are separated from the complete findings view", async () => {
  const [html, app] = await Promise.all([
    readFile(join(root, "public/index.html"), "utf8"),
    readFile(join(root, "public/app.js"), "utf8"),
  ]);
  expect(html).toContain('id="findings-tab"');
  expect(html).toContain('id="phase-files"');
  expect(html).toContain('id="phase-finding-list"');
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

test("topbar controls stay compact and name the theme selector", async () => {
  const [html, styles] = await Promise.all([
    readFile(join(root, "public/index.html"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  expect(html).toContain('<label class="theme-control">\n          <span>Theme</span>');
  expect(styles).toContain(".topbar .button { padding: 6px 9px;");
  expect(styles).toContain(".actions { justify-content: flex-end; gap: 5px;");
});

test("flow provenance uses clear reviewer-facing wording", async () => {
  const [html, app] = await Promise.all([
    readFile(join(root, "public/index.html"), "utf8"),
    readFile(join(root, "public/app.js"), "utf8"),
  ]);
  expect(html).toContain("Partly verified: some links are inferred");
  expect(app).toContain('label: "Partly verified"');
  expect(app).toContain("Some links were traced; the remaining links are informed inferences.");
});

test("diff rows stay dense and the explanation owns a bounded scroll area", async () => {
  const [html, styles] = await Promise.all([
    readFile(join(root, "public/index.html"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  expect(html).toContain('id="tour-scroll" class="tour-scroll"');
  expect(styles).toContain("grid-template-rows: auto minmax(0, 1fr) auto");
  expect(styles).toContain("white-space: pre;");
  expect(styles).toContain("max-height: min(180px, 26vh)");
  expect(styles).toContain(".diff-row.split-side.split-empty");
  expect(styles).not.toContain(".diff-row.split-side.empty");
});
