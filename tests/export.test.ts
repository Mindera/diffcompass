import { expect, test } from "bun:test";
import { exportReview, htmlHighlightGroups } from "../src/export.ts";
import { highlightGroups } from "../src/highlight.ts";
import type { ReviewSession } from "../src/session.ts";

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
  expect(artifact.content).toContain("## Reviewer feedback");
  expect(artifact.content).toContain("diff --git a/app.ts b/app.ts");
  expect(artifact.content).toContain("````diff");
  expect(artifact.content).not.toContain("# </title><script>");
  expect(artifact.content).toContain("# &lt;/title&gt;&lt;script&gt;bad()");
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
    status: "false-positive",
    disposition: "false-positive",
    reviewerNote: "The surrounding validation makes this safe.",
  }];

  const markdown = exportReview(session, "markdown");
  expect(markdown.content).toContain("disposition: False positive");
  expect(markdown.content).toContain("Reviewer note: The surrounding validation makes this safe.");

  const html = exportReview(session, "html");
  expect(html.content).toContain("Disposition: False positive");
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

test("HTML export is a self-contained interactive copy of the review tour", () => {
  const artifact = exportReview(fixture(), "html");
  expect(artifact).toMatchObject({ contentType: "text/html; charset=utf-8", extension: "html" });
  expect(artifact.content).not.toContain('<script src=');
  expect(artifact.content).not.toContain('<link rel="stylesheet"');
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
  expect(artifact.content).toContain('id="architecture-viewer"');
  expect(artifact.content).toContain("className='tour-code-note'");
  expect(artifact.content).toContain('<div class="mermaid sequence-diagram">sequenceDiagram');
  expect(artifact.content).toContain("mermaid.initialize");
  expect(artifact.content).toContain('await mermaid.render("review-tour-export-diagram-"+index,source)');
  expect(artifact.content).toContain('svg.style.maxWidth="100%"');
  expect(artifact.content).toContain('svg.style.width=naturalWidth?"min("+naturalWidth+"px, 100%)":"100%"');
  expect(artifact.content).toContain('svg.removeAttribute("width")');
  expect(artifact.content).not.toContain('mermaid.run({querySelector:".mermaid"})');
  expect(artifact.content).toContain(".viewer-body .architecture-diagram svg{width:100%!important;");
  expect(artifact.content).toContain('<html lang="en" data-diff-wrap="scroll">');
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
  const highlightedGroups = await highlightGroups(htmlHighlightGroups(session), "review-tour");
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
