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
});

test("HTML export embeds server-prepared syntax highlighting", async () => {
  const session = fixture();
  const highlightedGroups = await highlightGroups(htmlHighlightGroups(session), "review-tour");
  const artifact = exportReview(session, "html", { highlightedGroups });
  expect(artifact.content).toContain('class="syntax-token');
  expect(artifact.content).toContain("--syntax-dark:#");
  expect(artifact.content).toContain("const");
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
