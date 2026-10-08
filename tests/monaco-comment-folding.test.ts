import { expect, test } from "bun:test";
// @ts-ignore Browser module has no separate declaration file.
import { sourceLineHidden, hiddenCommentCounts, hiddenQuestions } from "../public/monaco/deleted-annotations.mjs";

const state = { modelState: { collapsedRegions: [{ range: [47, 175] }] } };
test("comment folding uses its own source line, including both gap boundaries", () => {
  for (const side of ["old", "new"]) {
    expect(sourceLineHidden(side, 46, state, [])).toBe(false);
    expect(sourceLineHidden(side, 47, state, [])).toBe(true);
    expect(sourceLineHidden(side, 50, state, [])).toBe(true);
    expect(sourceLineHidden(side, 174, state, [])).toBe(true);
    expect(sourceLineHidden(side, 175, state, [])).toBe(false);
    expect(sourceLineHidden(side, 50, { modelState: { collapsedRegions: [] } }, [])).toBe(false);
  }
});

test("Before comments are mapped to the serialized After folding coordinates", () => {
  const changes = [{ originalStartLineNumber: 10, originalEndLineNumber: 11, modifiedStartLineNumber: 10, modifiedEndLineNumber: 15 }];
  expect(sourceLineHidden("old", 42, state, changes)).toBe(false);
  expect(sourceLineHidden("old", 43, state, changes)).toBe(true);
  expect(sourceLineHidden("old", 170, state, changes)).toBe(true);
  expect(sourceLineHidden("old", 171, state, changes)).toBe(false);
  expect(sourceLineHidden("old", 11, state, changes)).toBe(false);
});

test("hidden comment counts follow card anchors, both gap boundaries, source mapping and split sides", () => {
  const file = { path: "test.ts", old: "line\n".repeat(200), new: "line\n".repeat(204) };
  const comment = (side: string, line: number, endLine?: number) => ({ path: file.path, side, line, endLine });
  const changes = [{ originalStartLineNumber: 10, originalEndLineNumber: 11, modifiedStartLineNumber: 10, modifiedEndLineNumber: 15 }];
  const comments = [comment("new", 46), comment("new", 47), comment("new", 50, 52), comment("new", 170, 175), comment("new", 174), comment("new", 175), comment("old", 43), comment("old", 170), comment("old", 171), { ...comment("new", 50), path: "other.ts" }];
  expect(hiddenCommentCounts(file, { comments }, "new", [47, 175], changes)).toEqual({ comments: 3, threads: 0 });
  expect(hiddenCommentCounts(file, { comments }, "old", [47, 175], changes)).toEqual({ comments: 2, threads: 0 });
  expect(hiddenCommentCounts(file, { comments }, "both", [47, 175], changes)).toEqual({ comments: 5, threads: 0 });
  expect(hiddenCommentCounts(file, { comments }, "both", [175, 175], changes)).toEqual({ comments: 0, threads: 0 });
});

test("hidden thread counts include current and resolved threads, not file-level, outdated or invalid anchors", () => {
  const file = { path: "test.ts", old: "line\n".repeat(80), new: "line\n".repeat(80) };
  const thread = { path: file.path, side: "new", line: 50 };
  const threads = [thread, { ...thread, side: "old", resolved: true }, { ...thread, outdated: true }, { ...thread, line: undefined }, { ...thread, line: 81 }, { ...thread, path: "other.ts" }];
  expect(hiddenCommentCounts(file, { pullRequest: { threads } }, "both", [47, 175], [])).toEqual({ comments: 0, threads: 2 });
  expect(hiddenCommentCounts(file, { pullRequest: { threads } }, "old", [47, 175], [])).toEqual({ comments: 0, threads: 1 });
});

test("hidden questions count matching conversation roots, not replies, follow-ups, stale or unanchored questions", () => {
  const file = { path: "test.ts", old: "line\n".repeat(200), new: "line\n".repeat(204) };
  const anchor = { path: file.path, side: "new", line: 50, endLine: 52, content: "line", context: "line\nline\nline" };
  const messages = [
    { id: "after", role: "user", threadId: "after", anchor },
    { id: "answer", role: "agent", threadId: "after" },
    { id: "follow-up", role: "user", threadId: "after", anchor },
    { id: "before", role: "user", threadId: "before", anchor: { ...anchor, side: "old", line: 43, endLine: 45 } },
    { id: "stale", role: "user", anchor: { ...anchor, content: "previous code" } },
    { id: "changed-context", role: "user", anchor: { ...anchor, context: "different range" } },
    { id: "unanchored", role: "user" },
    { id: "other-file", role: "user", anchor: { ...anchor, path: "other.ts" } },
    { id: "outside", role: "user", anchor: { ...anchor, line: 175, endLine: 177 } },
  ];
  const changes = [{ originalStartLineNumber: 10, originalEndLineNumber: 11, modifiedStartLineNumber: 10, modifiedEndLineNumber: 15 }];
  expect(hiddenQuestions(file, { messages }, "both", [47, 175], changes).map((q: { id: string }) => q.id)).toEqual(["after", "before"]);
  expect(hiddenQuestions(file, { messages }, "old", [47, 175], changes).map((q: { id: string }) => q.id)).toEqual(["before"]);
  expect(hiddenQuestions(file, { messages }, "new", [47, 175], changes).map((q: { id: string }) => q.id)).toEqual(["after"]);
});
