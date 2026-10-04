import { describe, expect, test } from "bun:test";
import { files, locate, sourceAnchor } from "./fixtures.mjs";

const file = { path: "sample.ts", old: "old one\nold two\n", new: "new one\nnew two\n" };
const selection = (start, firstColumn, end = start, endColumn = firstColumn) => ({
  startLineNumber: start, startColumn: firstColumn,
  endLineNumber: end, endColumn,
});

describe("source anchors, independent of rendered/folded rows", () => {
  test.each(["old", "new"])("captures the %s side, never the other model", side => {
    const anchor = sourceAnchor(file, side, selection(1, 1, 2, 8));
    expect(anchor).toEqual({ path: "sample.ts", side, line: 1, endLine: 2,
      content: `${side} one`, selectedText: `${side} one\n${side} two`,
      context: `${side} one\n${side} two` });
  });
  test("retains full-line validation context for a partial quotation", () => {
    expect(sourceAnchor(file, "new", selection(1, 5, 2, 4))).toMatchObject({
      line: 1, endLine: 2, selectedText: "one\nnew", context: "new one\nnew two",
    });
  });
  test("excludes the next line when a selection ends at column one", () => {
    expect(sourceAnchor(file, "new", selection(1, 5, 2, 1))).toMatchObject({
      line: 1, endLine: 1, selectedText: "one", context: "new one",
    });
  });
  test("a caret selects the entire source line for review", () => {
    expect(sourceAnchor(file, "new", selection(2, 4)).selectedText).toBe("new two");
  });
  test("normalizes CRLF consistently with the server's source rows", () => {
    expect(sourceAnchor({ ...file, new: "one\r\ntwo\r\n" }, "new", selection(1, 1, 3, 1)).context).toBe("one\ntwo");
  });
  test("uses Monaco UTF-16 columns without corrupting Unicode", () => {
    expect(sourceAnchor({ ...file, new: "a🧭b" }, "new", selection(1, 2, 1, 4)).selectedText).toBe("🧭");
  });
  test.each(["old", "new"])("rejects an absent %s side", side => {
    expect(() => sourceAnchor({ ...file, [side]: "" }, side, selection(1, 1))).toThrow("no source");
  });
  test("does not accept current/unknown as historical source sides", () => {
    expect(() => sourceAnchor(file, "current", selection(1, 1))).toThrow("Invalid source side");
  });
  test.each([
    selection(0, 1), selection(4, 1), selection(2, 1, 1, 1),
    selection(1, 0), selection(1, 9), selection(1, 5, 1, 3),
    selection(1, 1, 2, 9), selection(1.5, 1), selection(1, 1.5),
  ])("rejects invalid coordinates %#", range => {
    expect(() => sourceAnchor(file, "new", range)).toThrow("Invalid source selection");
  });
  test("accepts 100 lines and rejects 101", () => {
    const big = { ...file, new: Array(101).fill("x").join("\n") };
    expect(sourceAnchor(big, "new", selection(1, 1, 100, 2)).endLine).toBe(100);
    expect(() => sourceAnchor(big, "new", selection(1, 1, 101, 2))).toThrow("1–100");
  });
  test("supports the last line without a trailing newline", () => {
    expect(sourceAnchor({ ...file, new: "last" }, "new", selection(1, 1, 1, 5)).context).toBe("last");
  });
});

describe("comparison fixtures", () => {
  test("finding and question targets refer to the actual changed lines", () => {
    expect(locate(files[0].old, "return amount -")).toBe(18);
    expect(locate(files[0].new, "const percentage =")).toBe(18);
    expect(locate(files[0].new, "amount.toFixed(2)")).toBe(locate(files[0].new, "const amount = total") + 1);
  });
  test("covers additions, deletions, plain text and larger unchanged gaps", () => {
    expect(files.find(f => f.path === "added.ts").old).toBe("");
    expect(files.find(f => f.path === "removed.ts").new).toBe("");
    expect(files.find(f => f.path === "notes.txt").language).toBe("plaintext");
    expect(files.find(f => f.path === "large.ts").new.split("\n").length).toBeGreaterThan(2700);
  });
});
