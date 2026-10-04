import { expect, test } from "bun:test";
import { reviewMarkers, highestPriority, collapsedRegionState, commentDescription, commentSubmission } from "./annotations.mjs";
const file = { path: "a.ts", old: "before\nreturn 1;", new: "after\nreturn 2;" };
const anchor = { path: "a.ts", side: "new", line: 2, content: "return 2;" };
const question = (id, target = anchor) => ({ id, threadId: id, role: "user", body: id, anchor: target });
const session = { messages: [question("a"), { id: "reply", threadId: "a", role: "agent" }, { id: "followup", role: "user", threadId: "a" }, question("b")], outline: { findings: [{ id: "finding", path: "a.ts", side: "new", line: 2, lineContent: "return 2;", priority: "P2" }] } };
test("quote comments expose the exact selected text and compact source location", () => {
  expect(commentDescription({ side: "new", line: 103, endLine: 103, selectedText: "amount = total" })).toEqual({ kind: "Quote comment", location: "After · L103", quote: "amount = total", quoteLines: 1 });
  const quote = "  <Widget>\r\n    😀\r\n  </Widget>";
  expect(commentDescription({ side: "old", line: 1, endLine: 3, selectedText: quote })).toEqual({ kind: "Quote comment", location: "Before · L1–3", quote, quoteLines: 3 });
});
test("ordinary line/range comments are not labelled quotations", () => {
  expect(commentDescription({ side: "old", line: 4 }).kind).toBe("Line comment");
  expect(commentDescription({ side: "new", line: 4, endLine: 6, selectedText: "  " }).kind).toBe("Line range comment");
});
test("an empty caret selection does not attach full-line context as an explicit quote", () => {
  const selected = { ...anchor, endLine: 2, selectedText: "return", context: "return 2;" };
  expect(commentSubmission(selected, "body", false)).toEqual({ path: "a.ts", side: "new", line: 2, endLine: 2, scope: "line", context: "return 2;", body: "body" });
  expect(commentSubmission(selected, "body", true)).toMatchObject({ scope: "range", selectedText: "return", context: "return 2;" });
});
test("groups conversations by source line, not number of messages; keeps co-located findings", () => {
  const markers = reviewMarkers(file, session);
  expect(markers).toHaveLength(1);
  expect(markers[0].conversations.map(t => t.id)).toEqual(["a", "b"]);
  expect(markers[0].conversations[0].messages).toHaveLength(3);
  expect(markers[0].findings[0].priority).toBe("P2");
});
test("old and new line identities never merge", () => {
  expect(reviewMarkers(file, { messages: [question("new"), question("old", { ...anchor, side: "old", content: "return 1;" })] }).map(m => m.side)).toEqual(["new", "old"]);
});
test("does not pin stale, unknown, out-of-bounds or other-file conversations", () => {
  expect(reviewMarkers(file, { messages: [question("stale", { ...anchor, content: "return 1;" }), question("file", { ...anchor, path: "b.ts" }), question("side", { ...anchor, side: "current" }), question("range", { ...anchor, context: "wrong" }), question("bounds", { ...anchor, line: 10 })] })).toEqual([]);
});
test("ignores outdated findings and roots without code; tolerates legacy messages", () => {
  expect(reviewMarkers(file, { messages: [{ id: "review", role: "user" }, { ...question("legacy"), threadId: undefined }, { id: "answer", role: "agent" }], outline: { findings: [{ ...session.outline.findings[0], outdated: true }] } })[0]).toMatchObject({ findings: [], conversations: [{ id: "legacy" }] });
});
test("priority label represents the highest real priority", () => {
  expect(highestPriority([{ priority: "P2" }, { priority: "P1" }])).toBe("P1");
  expect(highestPriority([{ priority: "unknown" }])).toBe("?");
});
test("collapsing an interval leaves other gaps and view state untouched", () => {
  const state = { original: { scroll: 42 }, modified: { scroll: 44 }, modelState: { collapsedRegions: [{ range: [1, 5] }, { range: [30, 80] }] } };
  const next = collapsedRegionState(state, [[1, 15], [23, 101]], 1);
  expect(next.modelState.collapsedRegions).toEqual([{ range: [1, 5] }, { range: [23, 101] }]);
  expect(next.original).toBe(state.original);
  expect(next.modified).toBe(state.modified);
  expect(state.modelState.collapsedRegions[1].range).toEqual([30, 80]);
});
test("rejects unfamiliar or stale folding-state shapes", () => {
  expect(collapsedRegionState({}, [[1, 4]], 0)).toBeNull();
  expect(collapsedRegionState({ modelState: { collapsedRegions: [{ range: [4, 1] }] } }, [[1, 4]], 0)).toBeNull();
  expect(collapsedRegionState({ modelState: { collapsedRegions: [] } }, [[1, 4]], 0)).toBeNull();
  expect(collapsedRegionState({ modelState: { collapsedRegions: [null] } }, [[1, 4]], 0)).toBeNull();
});
