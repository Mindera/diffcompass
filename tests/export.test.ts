import { expect, test } from "bun:test";
import { exportReview, htmlHighlightGroups } from "../src/export.ts";
import { highlightGroups } from "../src/highlight.ts";
import { domainFixtureModel } from "../src/domain-fixture.ts";
import type { ReviewSession } from "../src/session.ts";

test("Markdown keeps domain definitions and relationship citations even without an optional renderer", () => {
  const session = fixture();
  session.outline!.domainModels = [structuredClone(domainFixtureModel)];
  const markdown = exportReview(session, "markdown").content;
  expect(markdown).toContain("## Domain vocabulary");
  expect(markdown).toContain("Receipt → Cart: summarises");
  expect(markdown).toContain("CONTEXT.md:3");
  expect(exportReview(session,"markdown",{includeDiagrams:false}).content).not.toContain("## Domain vocabulary");
});

function fixture(): ReviewSession {
  return {
    comparison: {
      repositoryName: "widgets",
      repositoryRoot: "/tmp/widgets",
      base: "main",
      mergeBase: "abc",
      head: "def",
      patch: "diff --git a/app.ts b/app.ts\n+const fence = ```;\n+const payload = '</style><script>alert(1)</script>';",
      repositoryFiles: ["app.ts"],
      files: [{
        path: "app.ts",
        oldPath: "app.ts",
        newPath: "app.ts",
        status: "added",
        metadata: [],
        hunks: [{
          header: "@@ -0,0 +1,2 @@",
          oldStart: 0,
          oldCount: 0,
          newStart: 1,
          newCount: 2,
          rows: [
            { kind: "addition", content: "const fence = ```;", oldLine: null, newLine: 1 },
            { kind: "addition", content: "const payload = '</style><script>alert(1)</script>';", oldLine: null, newLine: 2 },
          ],
        }],
        additions: 2,
        deletions: 0,
      }],
    },
    outline: {
      title: "</title><script>bad()</script>",
      summary: "Summary <img src=x onerror=bad()>",
      behaviorArchitectureStatus: "proposed",
      behaviorArchitecture: { title: "Behavior", summary: "Proposed structure", mermaid: "flowchart LR\n  user[\"User\"]:::external\n  app[\"App\"]:::new\n  user -->|uses| app", dependencyChanges: ["Added User → App: uses"], affectedFiles: ["app.ts"] },
      architecture: { title: "Components", summary: "Changed structure", mermaid: "flowchart LR\n  app[\"App\"]:::touched\n  api[\"API\"]:::external\n  app -->|calls| api", dependencyChanges: ["Added App → API: calls"], affectedFiles: ["app.ts"] },
      stateDiagram: { kind: "state-machine", title: "App lifecycle", summary: "A grounded lifecycle.", mermaid: "stateDiagram-v2\n  [*] --> ready\n  ready --> done", evidence: ["app.ts handles the lifecycle"], materiallyImprovesUnderstanding: "The lifecycle is easier to follow as states.", affectedFiles: ["app.ts"] },
      phases: [{ id: "behavior", title: "Behavior", summary: "Review behavior", fileChanges: [{ path: "app.ts", summary: "Contains behavior" }], steps: [{ id: "one", title: "Step", objective: "Review", anchor: { path: "app.ts", side: "new", startLine: 1, endLine: 1 }, explanation: "**Explanation** with `code`." }] }],
      callFlows: [],
      flows: [{ id: "flow", title: "Flow", summary: "Summary", mermaid: "sequenceDiagram\n  A->>B: call", provenance: "verified", blastRadiusSize: 1, affectedFiles: ["app.ts"] }],
      findings: [],
    },
    comments: [{ id: "comment", path: "app.ts", side: "new", line: 1, body: "<script>comment()</script>", lineContent: "code", status: "active", createdAt: "now", updatedAt: "now" }],
    reviewedFiles: new Set(["app.ts"]),
    status: "feedback",
  } as unknown as ReviewSession;
}

test("Markdown export contains the tour, feedback, flow, and complete diff with collision-safe fences", () => {
  const artifact = exportReview(fixture(), "markdown");
  expect(artifact).toMatchObject({ contentType: "text/markdown; charset=utf-8", extension: "md" });
  expect(artifact.content).toContain("## Tour");
  expect(artifact.content).toContain("## First-pass review time");
  expect(artifact.content).toContain("## Architecture");
  expect(artifact.content).toContain("### Proposed behaviour: Behavior");
  expect(artifact.content).toContain("### Implementation journey: Components");
  expect(artifact.content).toContain("## Sequence diagrams");
  expect(artifact.content).toContain("## Adaptive diagrams");
  expect(artifact.content).toContain("### State machine: App lifecycle");
  expect(artifact.content).toContain("## Reviewer feedback");
  expect(artifact.content).toContain("diff --git a/app.ts b/app.ts");
  expect(artifact.content).toContain("````diff");
  expect(artifact.content).not.toContain("# </title><script>");
  expect(artifact.content).toContain("# &lt;/title&gt;&lt;script&gt;bad()");
});

test("exports prepared dry-run traces for offline review and can omit them", () => {
  const session = fixture();
  (session as unknown as { exportDryRuns: () => unknown[] }).exportDryRuns = () => [{
    id: "trace", flowId: "format-receipt", flowKind: "behavior", flowFingerprint: "f".repeat(64),
    comparison: { base: "main", mergeBase: "abc", head: "def", fingerprint: "c".repeat(64) },
    detail: "detailed",
    scenario: { id: "primary", title: "Receipt with discount", reason: "Shows the changed output.", source: "invented", inputs: { amount: 20 }, mocks: {}, assumptions: ["The amount is finite."] },
    assumptions: ["This is derived from inspected source."],
    steps: [{
      id: "format", order: 1, kind: "return", title: "Format the amount", explanation: "The formatter returns a two-decimal string.",
      source: { path: "app.ts", side: "new", startLine: 1, endLine: 1, changed: true }, function: "receipt",
      arguments: { amount: 20 }, locals: { formatted: "20.00" }, valueChanges: [{ name: "result", after: "20.00" }],
    }, {
      id: "return", order: 2, kind: "return", title: "Return the receipt", explanation: "The formatted receipt becomes the simulated output.",
      source: { path: "app.ts", side: "new", startLine: 2, endLine: 2, changed: false }, function: "receipt",
      valueChanges: [], assumption: "The formatter receives the sample amount.",
    }],
    outcome: { summary: "The simulated output is 20.00.", value: "20.00" }, preparedAt: "2026-08-13T10:00:00.000Z",
  }];

  const markdown = exportReview(session, "markdown").content;
  expect(markdown).toContain("## Dry runs");
  expect(markdown).toContain("Simulated from code, not executed/runtime verified.");
  expect(markdown).toContain("Walkthrough detail: Detailed");
  expect(markdown).toContain("Receipt with discount");
  expect(markdown).toContain("The simulated output is 20.00.");
  expect(exportReview(session, "markdown", { includeDryRuns: false }).content).not.toContain("## Dry runs");

  const html = exportReview(session, "html").content;
  expect(html).toContain('data-view="dry-runs"');
  expect(html).toContain('data-view-panel="dry-runs"');
  expect(html).toContain("Simulated from code, not executed/runtime verified.");
  expect(html).toContain("Detailed simulation");
  expect(html).toContain("data-export-dry-run");
  expect(html).toContain("data-export-dry-run-step");
  expect(html).toContain("data-export-dry-run-counter");
  expect(html).toContain('data-export-dry-run-action="previous"');
  expect(html).toContain('data-export-dry-run-action="restart"');
  expect(html).toContain('data-export-dry-run-action="next"');
  expect(html).toContain("Scenario assumptions");
  expect(html).toContain("Global assumptions");
  expect(html).toContain("Value changes");
  expect(html).toContain("Local values");
  expect(html).toContain("20.00");
  const dryRunScript = html.match(/<script>\(\(\)=>\{const sync=card=>[\s\S]*?<\/script>/)?.[0];
  expect(dryRunScript).toBeDefined();
  const steps = [{ hidden: false }, { hidden: true }];
  const counter = { textContent: "" };
  const previous = { disabled: false };
  const restart = { disabled: false };
  const next = { disabled: false };
  const card = {
    dataset: {} as Record<string, string>,
    querySelectorAll: (selector: string) => selector === "[data-export-dry-run-step]" ? steps : [],
    querySelector: (selector: string) => selector === "[data-export-dry-run-counter]" ? counter
      : selector === '[data-export-dry-run-action="previous"]' ? previous
        : selector === '[data-export-dry-run-action="restart"]' ? restart
          : selector === '[data-export-dry-run-action="next"]' ? next : null,
  };
  let clickListener: ((event: { target: { closest: (selector: string) => unknown } }) => void) | undefined;
  new Function("document", dryRunScript!.slice("<script>".length, -"</script>".length))({
    querySelectorAll: (selector: string) => selector === "[data-export-dry-run]" ? [card] : [],
    addEventListener: (type: string, listener: typeof clickListener) => { if (type === "click") clickListener = listener; },
  });
  expect(counter.textContent).toBe("Step 1 of 2");
  expect(previous.disabled).toBe(true);
  const nextButton = { dataset: { exportDryRunAction: "next" }, closest: (selector: string) => selector === "[data-export-dry-run-action]" ? nextButton : card };
  clickListener!({ target: nextButton });
  expect(steps).toEqual([{ hidden: true }, { hidden: false }]);
  expect(counter.textContent).toBe("Step 2 of 2");
  expect(next.disabled).toBe(true);
  const restartButton = { dataset: { exportDryRunAction: "restart" }, closest: (selector: string) => selector === "[data-export-dry-run-action]" ? restartButton : card };
  clickListener!({ target: restartButton });
  expect(steps).toEqual([{ hidden: false }, { hidden: true }]);
  expect(exportReview(session, "html", { includeDryRuns: false }).content).not.toContain('data-view="dry-runs"');
});

test("exports finding dispositions and reviewer notes in Markdown and self-contained HTML", () => {
  const session = fixture();
  session.outline!.findings = [{
    id: "finding",
    phaseId: "behavior",
    stepId: "one",
    path: "app.ts",
    side: "new",
    line: 1,
    lineContent: "code",
    message: "Static finding",
    category: "correctness",
    severity: "high",
    confidence: "high",
    evidence: "Evidence",
    priority: "P1",
    introduced: true,
    recallGuard: false,
    blastRadiusSize: 1,
    tested: false,
    pinScope: "line",
    pinnedSymbolIds: ["app.ts:new:1:fence"],
    status: "false-positive",
    disposition: "false-positive",
    reviewerNote: "The surrounding validation makes this safe.",
  }];

  const markdown = exportReview(session, "markdown");
  expect(markdown.content).toContain("disposition: False positive");
  expect(markdown.content).toContain("Symbols linked to this finding: `app.ts:new:1:fence`");
  expect(markdown.content).toContain("Reviewer note: The surrounding validation makes this safe.");

  const html = exportReview(session, "html");
  expect(html.content).toContain("Disposition: False positive");
  expect(html.content).toContain("Symbols linked to this finding");
  expect(html.content).toContain("app.ts:new:1:fence");
  expect(html.content).toContain("The surrounding validation makes this safe.");
});

test("exports accepted findings as risk accepted", () => {
  const session = fixture();
  session.outline!.findings = [{
    id: "finding",
    phaseId: "behavior",
    stepId: "one",
    path: "app.ts",
    side: "new",
    line: 2,
    lineContent: "const changed = 2;",
    message: "Validate the changed value.",
    category: "correctness",
    severity: "medium",
    confidence: "high",
    evidence: "The new branch has no guard.",
    priority: "P2",
    introduced: true,
    recallGuard: false,
    blastRadiusSize: 1,
    tested: false,
    pinScope: "line",
    status: "accepted",
    disposition: "accepted",
  }];

  expect(exportReview(session, "markdown").content).toContain("disposition: Risk accepted");
  expect(exportReview(session, "html").content).toContain("Disposition: Risk accepted");
});

test("exports finding evidence as labelled, scannable facts", () => {
  const session = fixture();
  session.outline!.findings = [{
    id: "structured-evidence", phaseId: "behavior", stepId: "one", path: "app.ts", side: "new", line: 2,
    lineContent: "const changed = 2;", message: "An empty value produces an unusable record.", category: "correctness",
    severity: "high", confidence: "high",
    evidence: "Observation: `load` accepts an empty value.\nCausal path: The empty value reaches `save` unchanged.\nImpact: The persisted record cannot be reopened.\nCoverage: No changed test exercises an empty value.",
    priority: "P2", introduced: true, recallGuard: false, blastRadiusSize: 1, tested: false, pinScope: "line", status: "open",
  }];

  const markdown = exportReview(session, "markdown").content;
  expect(markdown).toContain("Evidence trail:");
  expect(markdown).toContain("- **Observation:** `load` accepts an empty value.");
  expect(markdown).toContain("- **Causal path:** The empty value reaches `save` unchanged.");

  const html = exportReview(session, "html").content;
  expect(html).toContain("Evidence trail · high confidence");
  expect(html).toContain('class="finding-evidence-list"');
  expect(html).toContain("<strong>Impact</strong>");
  expect(html).toContain("The persisted record cannot be reopened.");
});

test("exports fixed findings as fixed verified", () => {
  const session = fixture();
  session.outline!.findings = [{
    id: "finding",
    phaseId: "behavior",
    stepId: "one",
    path: "app.ts",
    side: "new",
    line: 2,
    lineContent: "const changed = 2;",
    message: "Validate the changed value.",
    category: "correctness",
    severity: "medium",
    confidence: "high",
    evidence: "The new branch has no guard.",
    priority: "P2",
    introduced: true,
    recallGuard: false,
    blastRadiusSize: 1,
    tested: false,
    pinScope: "line",
    status: "fixed",
    disposition: "fixed",
  }];

  expect(exportReview(session, "markdown").content).toContain("disposition: Fixed (verified)");
  expect(exportReview(session, "html").content).toContain("Disposition: Fixed (verified)");
});

test("exports the bounded issue assessment with its model disclaimer", () => {
  const session = fixture();
  session.pullRequest = {
    repository: "acme/widgets", number: 7, url: "https://github.com/acme/widgets/pull/7", title: "PR", body: "", author: "author",
    baseRefName: "main", baseRefOid: "a".repeat(40), headRefName: "feature", headRefOid: "b".repeat(40), sourceRepositoryRoot: "/tmp/widgets", workspaceRoot: "/tmp/widgets", refNamespace: "refs/diffcompass/test",
    commits: [], checks: [{ name: "verify", state: "IN_PROGRESS", url: "https://github.com/acme/widgets/actions/runs/1" }], threads: [], threadsTruncated: false, mergeable: "MERGEABLE", mergeStateStatus: "UNSTABLE", providerScope: { linkedIssue: "same-repository-closing-issue", relatedResources: "not-requested" },
    linkedIssue: { repository: "acme/widgets", number: 12, url: "https://github.com/acme/widgets/issues/12", title: "Retry", access: "available", criteriaStatus: "found", acceptanceCriteria: [{ id: "criterion-1", text: "A request can be retried" }] }, updatedAt: "now",
  } as unknown as NonNullable<ReviewSession["pullRequest"]>;
  session.outline!.issueAssessment = { issueNumber: 12, issueUrl: "https://github.com/acme/widgets/issues/12", items: [{ criterionId: "criterion-1", criterion: "A request can be retried", status: "implemented", evidence: "The changed handler retries the request.", evidencePaths: ["app.ts"], basis: "model-assessment" }] };
  expect(exportReview(session, "markdown").content).toContain("Model assessment based on cited repository paths; statuses are not verified test results.");
  expect(exportReview(session, "markdown").content).toContain("## GitHub checks");
  expect(exportReview(session, "markdown").content).toContain("**Running**. GitHub has not reported a final result for this check.");
  expect(exportReview(session, "markdown").content).toContain("this review did not fetch check or workflow details.");
  expect(exportReview(session, "html").content).toContain("Issue-to-implementation assessment");
  expect(exportReview(session, "html").content).toContain("A request can be retried");
  expect(exportReview(session, "html").content).toContain("No merge conflict reported by GitHub.");
  expect(exportReview(session, "html").content).toContain("GitHub has not provided a stable merge status. This review snapshot does not include why.");
  expect(exportReview(session, "html").content).toContain("View run in GitHub");
});

test("exports a reviewer task without presenting it as GitHub data", () => {
  const session = fixture();
  session.pullRequest = {
    repository: "acme/widgets", number: 7, url: "https://github.com/acme/widgets/pull/7", title: "PR", body: "", author: "author",
    baseRefName: "main", baseRefOid: "a".repeat(40), headRefName: "feature", headRefOid: "b".repeat(40), sourceRepositoryRoot: "/tmp/widgets", workspaceRoot: "/tmp/widgets", refNamespace: "refs/diffcompass/test",
    commits: [], checks: [], threads: [], threadsTruncated: false, providerScope: { linkedIssue: "none", relatedResources: "not-requested" },
    reviewerTask: {
      body: "## Acceptance Criteria\n- [ ] A reviewer can save a local task",
      criteriaStatus: "found",
      acceptanceCriteria: [{ id: "criterion-1", text: "A reviewer can save a local task" }],
      assessment: { items: [{ criterionId: "criterion-1", criterion: "A reviewer can save a local task", status: "implemented", evidence: "The session stores the reviewer task.", evidencePaths: ["src/session.ts"], basis: "model-assessment" }] },
      updatedAt: "now",
    },
    updatedAt: "now",
  } as unknown as NonNullable<ReviewSession["pullRequest"]>;
  const markdown = exportReview(session, "markdown").content;
  const html = exportReview(session, "html").content;
  expect(markdown).toContain("## Task-to-implementation assessment");
  expect(markdown).toContain("reviewer-supplied task description, stored locally");
  expect(markdown).toContain("not sent to GitHub");
  expect(markdown).toContain("A reviewer can save a local task");
  expect(html).toContain("Task-to-implementation assessment");
  expect(html).toContain("No issue, pull request, comment, or other provider resource was requested");
});

test("HTML export is a self-contained interactive copy of the review tour", () => {
  const artifact = exportReview(fixture(), "html");
  expect(artifact).toMatchObject({ contentType: "text/html; charset=utf-8", extension: "html" });
  expect(artifact.content).not.toContain('<script src=');
  expect(artifact.content).not.toContain('<link rel="stylesheet"');
  const brand = artifact.content.match(/class="brand-mark" src="data:image\/svg\+xml;base64,([^\"]+)"/);
  const favicon = artifact.content.match(/rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml;base64,([^\"]+)"/);
  expect(brand).not.toBeNull();
  expect(favicon).not.toBeNull();
  expect(Buffer.from(brand![1]!, "base64").toString()).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
  expect(Buffer.from(favicon![1]!, "base64").toString()).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
  expect(artifact.content).not.toContain('src="/brand/');
  expect(artifact.content).not.toContain("</title><script>bad()");
  expect(artifact.content).not.toContain("<img src=x onerror=bad()>");
  expect(artifact.content).toContain("&lt;/title&gt;&lt;script&gt;bad()");
  expect(artifact.content).toContain("&lt;script&gt;comment()");
  expect(artifact.content).toContain("&lt;/style&gt;&lt;script&gt;alert(1)");
  expect(artifact.content).toContain('<main class="workspace">');
  expect(artifact.content).toContain("How much time might this review take?");
  expect(artifact.content).toContain("Bounded heuristic");
  expect(artifact.content).toContain('<aside class="file-panel">');
  expect(artifact.content).toContain('<aside class="agent-panel">');
  expect(artifact.content).toContain('data-view="diff"');
  expect(artifact.content).toContain('class="tour-step" data-step="0"');
  expect(artifact.content).toContain('id="previous"');
  expect(artifact.content).toContain('id="next"');
  expect(artifact.content).toContain("steps.forEach((node,index)=>node.hidden=index!==current)");
  expect(artifact.content).toContain("<strong>Explanation</strong> with <code>code</code>.");
  expect(artifact.content).toContain('data-diff-file="app.ts"');
  expect(artifact.content).toContain('class="file-diff single-side"');
  expect(artifact.content).not.toContain('data-path="app.ts" data-side="old"');
  expect(artifact.content).toContain('<div class="diff-row">');
  expect(artifact.content).toContain('class="architecture-legend"');
  expect(artifact.content).toContain('data-diagram-expand="behavior"');
  expect(artifact.content).toContain("App lifecycle");
  expect(artifact.content).toContain('data-view="adaptive"');
  expect(artifact.content).toContain('data-view-panel="adaptive"');
  expect(artifact.content).toContain('class="adaptive-legend" style="margin-bottom:12px"');
  expect(artifact.content).toContain('id="architecture-viewer"');
  expect(artifact.content).toContain('id="focus-mode-toggle"');
  expect(artifact.content).toContain('id="shortcuts-button"');
  expect(artifact.content).toContain('id="shortcut-help-dialog"');
  expect(artifact.content).toContain("event.repeat");
  expect(artifact.content).toContain("DOMContentLoaded");
  expect(artifact.content).toContain("className='tour-code-note'");
  expect(artifact.content).toContain('<div class="mermaid sequence-diagram">sequenceDiagram');
  expect(artifact.content).toContain("mermaid.initialize");
  expect(artifact.content).toContain('await mermaid.render("diffcompass-export-diagram-"+index,source)');
  expect(artifact.content).toContain('svg.style.maxWidth="100%"');
  expect(artifact.content).toContain('svg.style.width=naturalWidth?"min("+naturalWidth+"px, 100%)":"100%"');
  expect(artifact.content).toContain('svg.removeAttribute("width")');
  expect(artifact.content).not.toContain('mermaid.run({querySelector:".mermaid"})');
  expect(artifact.content).toContain(".viewer-body .architecture-diagram svg{width:100%!important;");
  expect(artifact.content).toContain('<html lang="en" data-diff-wrap="scroll">');
});

test("HTML export embeds validated Archify artifacts and preserves the authored-topology boundary", () => {
  const session = fixture();
  session.outline!.archifyArtifacts = [{
    id: "architecture-journey",
    type: "architecture",
    title: "Changed components",
    ir: { schema_version: 1, diagram_type: "architecture", meta: { title: "After" }, components: [] },
    html: "<!doctype html><html><body><script>window.archify=true</script></body></html>",
    comparison: {
      before: { ir: { schema_version: 1, diagram_type: "architecture", meta: { title: "Before" }, components: [] }, html: "<!doctype html><html><body><script>window.archifyBefore=true</script></body></html>", validationReceipt: '{"validated":true}' },
      delta: { ir: { schema_version: 1, diagram_type: "architecture", meta: { title: "Delta" }, components: [] }, html: "<!doctype html><html><body><script>window.archifyDelta=true</script></body></html>", validationReceipt: '{"validated":true}' },
    },
    evidence: ["app.ts wires the changed components."],
    affectedFiles: ["app.ts"],
    view: "before-delta-after",
    validationReceipt: '{"validated":true}',
    renderedAt: "2026-09-18T12:00:00.000Z",
  }];

  const artifact = exportReview(session, "html");
  expect(artifact.content).toContain("Validated map");
  expect(artifact.content).toContain("data-diffcompass-camera");
  expect(artifact.content).toContain("Fit entire map");
  expect(artifact.content).toContain('sandbox="allow-scripts allow-downloads"');
  expect(artifact.content).toContain('srcdoc="&lt;!doctype html&gt;');
  expect(artifact.content).toContain("bounded saved evidence only");
  expect(artifact.content).toContain('data-archify-export-view="before"');
  expect(artifact.content).toContain('data-archify-export-view="delta"');
  expect(artifact.content).toContain("data-archify-export-frame");
  expect(artifact.content).toContain('data-view="maps">Maps');
  expect(artifact.content).toContain('data-view-panel="maps"');
  const report = exportReview(session, "markdown").content;
  expect(report).toContain("## Maps");
  expect(report).toContain("#### Before");
  expect(report).toContain("#### Delta");
  expect(report).toContain("app.ts wires the changed components.");
  expect(exportReview(session, "html", { includeDiagrams: false }).content).not.toContain('data-archify-export-frame=');
  expect(exportReview(session, "markdown", { includeDiagrams: false }).content).not.toContain("## Maps");
});

test("HTML and Markdown exports include the evidence briefing when signals exist", () => {
  const session = fixture();
  session.outline!.findings = [{ id: "briefing-finding", phaseId: "behavior", stepId: "one", path: "app.ts", side: "new", line: 1, lineContent: "const fence = ```;", message: "Important issue", category: "correctness", severity: "critical", confidence: "high", evidence: "The changed line is the evidence.", priority: "P1", introduced: true, recallGuard: true, blastRadiusSize: 1, tested: false, pinScope: "line", status: "open" }];
  expect(exportReview(session, "markdown").content).toContain("## Needs your attention");
  const html = exportReview(session, "html").content;
  expect(html).toContain('class="attention-briefing"');
  expect(html).toContain("review cues shown");
  expect(html).toContain('data-view="findings"');
  expect(html).toContain("The changed line is the evidence.");
});

test("HTML export preserves the selected wrapped diff presentation", () => {
  const artifact = exportReview(fixture(), "html", { diffWrap: "wrap" });
  expect(artifact.content).toContain('<html lang="en" data-diff-wrap="wrap">');
  expect(artifact.content).toContain('html[data-diff-wrap="wrap"] .diff-side code{min-width:0;white-space:pre-wrap;overflow-wrap:anywhere}');
  expect(artifact.content).toContain('content:"Split · Wrap"');
});

test("HTML export embeds server-prepared syntax highlighting", async () => {
  const session = fixture();
  const highlightedGroups = await highlightGroups(htmlHighlightGroups(session), "diffcompass");
  const artifact = exportReview(session, "html", { highlightedGroups });
  expect(artifact.content).toContain('class="syntax-token');
  expect(artifact.content).toContain("--syntax-dark:#");
  expect(artifact.content).toContain("const");
});

test("HTML export embeds a safe interactive Markdown preview", () => {
  const session = fixture();
  const file = session.comparison.files[0]!;
  file.path = "README.md";
  file.oldPath = "README.md";
  file.newPath = "README.md";
  file.status = "modified";
  file.hunks = [{
    header: "@@ -1 +1 @@",
    oldStart: 1, oldCount: 1, newStart: 1, newCount: 1,
    rows: [
      { kind: "deletion", content: "# Old heading", oldLine: 1, newLine: null },
      { kind: "addition", content: "# Preview heading", oldLine: null, newLine: 1 },
    ],
  }];
  session.outline!.phases[0]!.fileChanges[0]!.path = "README.md";
  session.outline!.phases[0]!.steps[0]!.anchor.path = "README.md";
  const artifact = exportReview(session, "html", {
    markdownPreviews: [
      { path: "README.md", side: "old", content: "# Old heading\n" },
      { path: "README.md", side: "new", content: "# Preview heading\n\n**Bold** and `<safe>`.\n\n| Name | Result |\n| :--- | ---: |\n| `<script>` | **safe** |\n\n```kotlin\nval safe = `<value>`\n```\n\n<script>bad()</script>" },
    ],
  });

  expect(artifact.content).toContain('data-markdown-toggle>Preview</button>');
  expect(artifact.content).toContain('class="diff-source"');
  expect(artifact.content).toContain('class="markdown-diff" hidden');
  expect(artifact.content).toContain('class="markdown-preview rendered-markdown" data-markdown-side="old"');
  expect(artifact.content).toContain('class="markdown-preview rendered-markdown" data-markdown-side="new"');
  expect(artifact.content).toContain('data-markdown-path="README.md" data-markdown-side="new" data-source-start="1" data-source-end="1"><h1><span class="inline-change">Preview</span> heading</h1>');
  expect(artifact.content).toContain('<h1><span class="inline-change">Old</span> heading</h1>');
  expect(artifact.content).toContain("<strong>Bold</strong> and <code>&lt;safe&gt;</code>.");
  expect(artifact.content).toContain("&lt;script&gt;bad()&lt;/script&gt;");
  expect(artifact.content).not.toContain("<script>bad()</script>");
  expect(artifact.content).toContain('<table><thead><tr><th class="align-left">Name</th><th class="align-right">Result</th>');
  expect(artifact.content).toContain('<td class="align-left"><code>&lt;script&gt;</code></td><td class="align-right"><strong>safe</strong></td>');
  expect(artifact.content).toContain("<pre><code>val safe = `&lt;value&gt;`</code></pre>");
  expect(artifact.content).toContain("button.textContent=showPreview?'Changes':'Preview'");
  expect(artifact.content).toContain("const annotatePreview=()=>");
  expect(artifact.content).toContain(".diff-side{border-bottom:0}");
});

test("HTML export prioritizes tour files when the syntax budget is exceeded", () => {
  const session = fixture();
  const rows = Array.from({ length: 12_001 }, (_, index) => ({
    kind: "addition" as const,
    content: `const unrelated${index} = ${index};`,
    oldLine: null,
    newLine: index + 1,
  }));
  session.comparison.files.unshift({
    path: "generated.ts", oldPath: "/dev/null", newPath: "generated.ts", status: "added", metadata: [],
    hunks: [{ header: "@@ -0,0 +1,12001 @@", oldStart: 0, oldCount: 0, newStart: 1, newCount: rows.length, rows }],
    additions: rows.length, deletions: 0,
  });

  const groups = htmlHighlightGroups(session);
  expect(groups.reduce((total, group) => total + group.lines.length, 0)).toBe(12_000);
  expect(groups[0]).toMatchObject({ id: "export-1-0-new", path: "app.ts" });
  expect(groups.some((group) => group.id.endsWith("-old"))).toBe(false);
});

test("HTML export preserves interactive call-tree modes", () => {
  const session = fixture();
  session.outline!.callFlows = [{ id: "calls", title: "Call graph", summary: "Calls", entrypointNodeId: "entry", provenance: "verified", nodes: [{ id: "entry", label: "entry", kind: "function", change: "modified", newLocation: { path: "app.ts", side: "new", line: 1 } }, { id: "child", label: "child", kind: "function", change: "added", newLocation: { path: "app.ts", side: "new", line: 1 } }], edges: [{ id: "edge", from: "entry", to: "child", change: "added", newCallSite: { path: "app.ts", side: "new", line: 1 }, label: "calls" }], affectedFiles: ["app.ts"] }];
  const artifact = exportReview(session, "html");
  expect(artifact.content).toContain('class="call-flow-card"');
  expect(artifact.content).toContain('data-call-mode="changes"');
  expect(artifact.content).toContain('data-call-mode="before"');
  expect(artifact.content).toContain('data-call-mode="after"');
  expect(artifact.content).toContain('class="call-tree-legend"');
  expect(artifact.content).toContain('class="call-node modified entrypoint"');
});

test("exports structural provider limits, isolated identities, and test-gap evidence", () => {
  const session = fixture();
  session.outline!.structuralBlastRadii = [{
    id: "app-radius", symbol: { id: "app.ts:new:1:fence", symbol: "fence", kind: "function", location: { path: "app.ts", side: "new", line: 1 } },
    provider: "repository-search", confidence: "low", provenance: "partial", summary: "Static reach only, not proof of runtime impact.",
    nodes: [
      { id: "app.ts:new:1:fence", symbol: "fence", kind: "function", location: { path: "app.ts", side: "new", line: 1 } },
      { id: "app.ts:new:2:consumer", symbol: "consumer", kind: "function", location: { path: "app.ts", side: "new", line: 2 } },
    ],
    edges: [{ id: "consumer-fence", from: "app.ts:new:2:consumer", to: "app.ts:new:1:fence", relationship: "calls" }],
    directCallerIds: ["app.ts:new:2:consumer"], reportedDirectCallerCount: 4, reportedReachableNodeCount: 10, reportedImpactedFileCount: 1, impactedFiles: ["app.ts"],
    coverage: { state: "partial", reportedCounts: "exact", omissionReason: "The provider returned aggregate totals without every identity." },
    testEvidence: {
      state: "relevant-tests-found", searchScope: "Inspected tests/fence.test.ts for fence callers.",
      checkedSources: [{ path: "tests/fence.test.ts", side: "new", line: 8, detail: "The test source calls consumer." }],
      relevantTests: [{ path: "tests/fence.test.ts", side: "new", line: 8, detail: "consumer reaches fence in the saved graph." }],
      remainingUncertainty: "The source does not establish failure-path behavior.",
    },
    nearbyTestGaps: [{ kind: "no-nearby-tests", detail: "No nearby test covers fence.", nearbyTestFiles: [] }],
  }];
  session.outline!.findings = [{
    id: "structural-finding", phaseId: "behavior", stepId: "one", path: "app.ts", side: "new", line: 1, lineContent: "const fence = ```;",
    message: "The changed fence is structurally broad.", category: "testing", severity: "medium", confidence: "low", evidence: "The static provider found bounded caller reach.",
    priority: "P1", introduced: true, recallGuard: false, blastRadiusSize: 10, tested: false, pinScope: "symbol", pinnedSymbolIds: ["app.ts:new:1:fence"], status: "open",
  }];
  const markdown = exportReview(session, "markdown");
  expect(markdown.content).toContain("## What could this change affect?");
  expect(markdown.content).toContain("What depends on `fence`?");
  expect(markdown.content).toContain("After changes");
  expect(markdown.content).toContain("These functions call fence, directly or indirectly.");
  expect(markdown.content).toContain("1 supplied of 4 reported");
  expect(markdown.content).toContain("Incomplete provider result");
  expect(markdown.content).toContain("How we found these connections:");
  expect(markdown.content).toContain("We searched the code for places that use fence.");
  expect(markdown.content).toContain("Other callers may exist that this search didn't find.");
  expect(markdown.content).toContain("What the diagram shows:");
  expect(markdown.content).toContain("Code that calls fence, directly or through another function.");
  expect(markdown.content).toContain("Technical data (raw metadata and identities):");
  expect(markdown.content).toContain("How it was found: repository-search");
  expect(markdown.content).toContain("Source of this result: partial");
  expect(markdown.content).toContain("Related tests:");
  expect(markdown.content).toContain("tests/fence.test.ts:8 (new)");
  expect(markdown.content).toContain("Based on reading the test code; no test-run result is available.");
  expect(markdown.content).toContain("Search details:");
  expect(markdown.content).toContain("Static relationships only; not confirmed runtime impact.");
  expect(markdown.content).toContain("Symbols linked to this finding: `app.ts:new:1:fence`");
  const html = exportReview(session, "html");
  expect(html.content).toContain('data-view="maps"');
  expect(html.content).toContain('data-view-panel="maps"');
  expect(html.content).toContain("Analysis details");
  expect(html.content).toContain("app.ts:new:1:fence");
  expect(html.content).toContain("After changes");
  expect(html.content).toContain("Static relationships only; not confirmed runtime impact.");
  expect(html.content).toContain("How we found these connections");
  expect(html.content).toContain("What the diagram shows");
  expect(html.content).toContain("How it was found");
  expect(html.content).toContain("Source of this result");
  expect(html.content).toContain("Related tests");
  expect(html.content).toContain("Search details");
  expect(html.content).toContain('class="structural-technical-edge"');
  expect(html.content).toContain('data-open-file="app.ts"');
  expect(html.content).toContain('data-open-file="tests/fence.test.ts"');
  expect(html.content).toContain("Symbols linked to this finding");
  session.outline!.structuralBlastRadii![0]!.coverage = { state: "complete", reportedCounts: "exact" };
  session.outline!.structuralBlastRadii![0]!.reportedDirectCallerCount = 1;
  session.outline!.structuralBlastRadii![0]!.reportedReachableNodeCount = 1;
  const completeHtml = exportReview(session, "html").content;
  expect(completeHtml).not.toContain("All available results shown");
  expect(completeHtml).toContain("1 caller, direct or indirect");
  expect(completeHtml).toContain("Files involved");
  session.outline!.structuralBlastRadii![0]!.coverage = { state: "partial", reportedCounts: "exact", omissionReason: "The provider returned aggregate totals without every identity." };
  session.outline!.structuralBlastRadii![0]!.testEvidence = { state: "not-assessed", checkedSources: [], relevantTests: [] };
  expect(exportReview(session, "markdown").content).toContain("Tests were not assessed for this symbol.");
  session.outline!.structuralBlastRadii![0]!.testEvidence = { state: "none-found", searchScope: "Searched tests for fence.", checkedSources: [], relevantTests: [] };
  expect(exportReview(session, "html").content).toContain("We did not find related test code in the recorded search.");
  session.outline!.structuralBlastRadii![0]!.nodes.push({ id: "external", symbol: "external caller", kind: "external" });
  session.outline!.structuralBlastRadii![0]!.edges.push({ id: "external-consumer", from: "external", to: "app.ts:new:2:consumer", relationship: "calls" });
  const missingSource = exportReview(session, "markdown").content;
  expect(missingSource).toContain("One caller has no source link.");
  const reviewCopy = missingSource.slice(missingSource.indexOf("Analysis details:"), missingSource.indexOf("Technical data"));
  expect(reviewCopy).not.toContain("Confidence:");
  expect(reviewCopy).not.toContain("Result limit");
  expect(reviewCopy).not.toContain("upstream caller/reference");
  expect(exportReview(session, "html", { includeStructuralBlastRadius: false }).content).not.toContain('data-view="structural"');
});

test("HTML export can omit findings, call flows, and diagrams", () => {
  const session = fixture();
  session.outline!.findings = [{ id: "finding", phaseId: "behavior", stepId: "one", path: "app.ts", side: "new", line: 1, lineContent: "code", message: "Static finding", category: "correctness", severity: "high", confidence: "high", evidence: "Evidence", priority: "P1", introduced: true, recallGuard: false, blastRadiusSize: 1, tested: false, pinScope: "line", status: "open" }];
  session.outline!.callFlows = [{ id: "calls", title: "Call graph", summary: "Calls", entrypointNodeId: "entry", provenance: "verified", nodes: [{ id: "entry", label: "entry", kind: "function", change: "modified", newLocation: { path: "app.ts", side: "new", line: 1 } }, { id: "child", label: "child", kind: "function", change: "added", newLocation: { path: "app.ts", side: "new", line: 1 } }], edges: [{ id: "edge", from: "entry", to: "child", change: "added", newCallSite: { path: "app.ts", side: "new", line: 1 } }], affectedFiles: ["app.ts"] }];

  const artifact = exportReview(session, "html", { includeFindings: false, includeCallFlows: false, includeDiagrams: false });
  expect(artifact.content).not.toContain("Static finding");
  expect(artifact.content).not.toContain("Call graph");
  expect(artifact.content).not.toContain("How the change fits together");
  expect(artifact.content).not.toContain("Sequence diagrams");
  expect(artifact.content).not.toContain("mermaid.initialize");
  expect(artifact.content).toContain("Reviewer feedback");
  expect(artifact.content).toContain('class="tour-step" data-step="0"');
});

test("exports preserve range, stop, and question anchors", () => {
  const session = fixture() as unknown as { comments: unknown[]; messages: unknown[] };
  session.comments.push({ id: "range", path: "app.ts", side: "new", line: 1, endLine: 2, scope: "range", selectedText: "const fence = ```;", context: "const fence = ```;\nconst payload = 'safe';", body: "Review both lines.", lineContent: "const fence = ```;", status: "active", createdAt: "now", updatedAt: "now" });
  session.comments.push({ id: "stop", path: "app.ts", side: "new", line: 1, endLine: 1, scope: "stop", stepId: "one", context: "const fence = ```;", body: "This stop matters.", lineContent: "const fence = ```;", status: "active", createdAt: "now", updatedAt: "now" });
  session.messages = [
    { id: "question", role: "user", threadId: "question", stepId: "one", body: "Why this range?", anchor: { path: "app.ts", side: "new", line: 1, endLine: 2, content: "const fence = ```;", selectedText: "const fence = ```;", context: "const fence = ```;\nconst payload = 'safe';", }, createdAt: "now" },
    { id: "answer", role: "agent", threadId: "question", stepId: "one", body: "It establishes the payload.", createdAt: "now" },
  ];
  const markdownArtifact = exportReview(session as unknown as ReviewSession, "markdown");
  expect(markdownArtifact.content).toContain("Selected quotation:");
  expect(markdownArtifact.content).toContain("## Questions");
  expect(markdownArtifact.content).toContain("Tour stop: Step");
  const htmlArtifact = exportReview(session as unknown as ReviewSession, "html");
  expect(htmlArtifact.content).toContain("Selected range");
  expect(htmlArtifact.content).toContain("Tour stop: Step");
  expect(htmlArtifact.content).toContain('data-view-panel="questions"');
});
