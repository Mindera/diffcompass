import { expect, test } from "bun:test";
import { reviewerSuggestions } from "../src/reviewer-suggestions.ts";
import type { AgentChangeActivity } from "../src/types.ts";

function activity(hunk: string): AgentChangeActivity {
  return { id: "suggestion", source: "reviewer", requestMessageId: "request", request: "Deliberately not a source coordinate", adapterId: "reviewer", modelId: "inline-edit", files: [], status: "observed", changeStatus: "pending", createdAt: "now", updatedAt: "now",
    proposal: { baselineTree: "a".repeat(40), resultTree: "b".repeat(40), patch: `diff --git a/docs/preview.md b/docs/preview.md\n--- a/docs/preview.md\n+++ b/docs/preview.md\n${hunk}` } };
}

test("saved reviewer patches yield inline replacement, insertion and deletion cards", () => {
  const cards = reviewerSuggestions(activity("@@ -18,5 +18,6 @@\n sealed interface Session\n \n data class Restored\n+data object Restoring\n data object Missing\n ```\n"));
  expect(cards).toEqual([{ path: "docs/preview.md", line: 20, endLine: 20, afterLine: 20, before: "", replacement: "data object Restoring", kind: "insert", context: { line: 18, content: "sealed interface Session\n\ndata class Restored\ndata object Missing\n```" } }]);
  expect(reviewerSuggestions(activity("@@ -2,2 +2,3 @@\n-old\n+new\n+extra\n context\n"))[0]).toMatchObject({ line: 2, endLine: 2, afterLine: 2, before: "old", replacement: "new\nextra", kind: "replace" });
  expect(reviewerSuggestions(activity("@@ -2,2 +2,1 @@\n-old\n context\n"))[0]).toMatchObject({ line: 2, afterLine: 2, before: "old", replacement: "", kind: "delete" });
});

test("insertion at start, blank-line replacement and separate changed regions retain baseline coordinates", () => {
  expect(reviewerSuggestions(activity("@@ -1 +1,2 @@\n+first\n existing\n"))[0]).toMatchObject({ line: 1, endLine: 1, afterLine: 0, kind: "insert" });
  const cards = reviewerSuggestions(activity("@@ -1,3 +1,3 @@\n-\r\n+nonempty\r\n context\r\n-last\r\n+end\r\n\\ No newline at end of file\n"));
  expect(cards).toHaveLength(2);
  expect(cards[0]).toMatchObject({ before: "", replacement: "nonempty", kind: "replace", afterLine: 1 });
  expect(cards[1]).toMatchObject({ before: "last", replacement: "end", afterLine: 3 });
  expect(cards[0]?.context.content).toBe("\ncontext\nlast");
});

test("only pending reviewer inline proposals are attached to source", () => {
  const proposal = activity("@@ -1 +1 @@\n-a\n+b\n");
  for (const changeStatus of ["applied", "rejected", "undone"] as const) expect(reviewerSuggestions({ ...proposal, changeStatus })).toEqual([]);
  expect(reviewerSuggestions({ ...proposal, source: "agent" })).toEqual([]);
  expect(reviewerSuggestions({ ...proposal, proposal: undefined })).toEqual([]);
});
