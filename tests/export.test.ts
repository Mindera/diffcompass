import { expect, test } from "bun:test";
import { exportReview } from "../src/export.ts";
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
      files: [{ path: "app.ts", oldPath: "app.ts", newPath: "app.ts", status: "modified", metadata: [], hunks: [], additions: 2, deletions: 0 }],
    },
    outline: {
      title: "</title><script>bad()</script>",
      summary: "Summary <img src=x onerror=bad()>",
      phases: [{ id: "behavior", title: "Behavior", summary: "Review behavior", fileChanges: [{ path: "app.ts", summary: "Contains behavior" }], steps: [{ id: "one", title: "Step", objective: "Review", anchor: { path: "app.ts", side: "new", startLine: 1, endLine: 1 }, explanation: "Explanation" }] }],
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
  expect(artifact.content).toContain("## Flows");
  expect(artifact.content).toContain("## Reviewer feedback");
  expect(artifact.content).toContain("diff --git a/app.ts b/app.ts");
  expect(artifact.content).toContain("````diff");
  expect(artifact.content).not.toContain("# </title><script>");
  expect(artifact.content).toContain("# &lt;/title&gt;&lt;script&gt;bad()");
});

test("HTML export is self-contained and escapes every untrusted field", () => {
  const artifact = exportReview(fixture(), "html");
  expect(artifact).toMatchObject({ contentType: "text/html; charset=utf-8", extension: "html" });
  expect(artifact.content).not.toContain("<script");
  expect(artifact.content).not.toContain("<img");
  expect(artifact.content).not.toContain("http://");
  expect(artifact.content).not.toContain("https://");
  expect(artifact.content).toContain("&lt;/title&gt;&lt;script&gt;bad()");
  expect(artifact.content).toContain("&lt;script&gt;comment()");
  expect(artifact.content).toContain("&lt;/style&gt;&lt;script&gt;alert(1)");
});
