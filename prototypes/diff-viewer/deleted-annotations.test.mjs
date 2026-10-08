import { test, expect } from "bun:test";
import { deletedRowLayout, badgeDisplayRow } from "./deleted-annotations.mjs";
import { reviewMarkers } from "./annotations.mjs";
test("a Before card sits between its deleted row and subsequent source, not after the replacement", () => {
  const card = { line: 18, height: 90 };
  const layout = deletedRowLayout(18, [1, 1], 20, [card]);
  expect(layout.rowTops).toEqual([0, 110]); expect(layout.cardTops.get(card)).toBe(20); expect(layout.extra).toBe(90);
});
test("wrapped lines, multiple cards on one row, and multiline endpoints keep stable source order", () => {
  const cards = [{ line: 11, height: 80 }, { line: 11, height: 40 }, { line: 12, height: 60 }, { line: 200, height: 99 }];
  const layout = deletedRowLayout(10, [1, 3, 1], 20, cards);
  expect(layout.rowTops).toEqual([0, 20, 40, 60, 200]);
  expect([...layout.cardTops.values()]).toEqual([80, 160, 220]); expect(layout.extra).toBe(180);
});
test("no cards leaves native fragment geometry unchanged", () => {
  expect(deletedRowLayout(1, [2, 1], 20, []).rowTops).toEqual([0, 20, 40]);
});
test("invalid row/card dimensions fail instead of shifting badges onto other lines", () => {
  expect(() => deletedRowLayout(1, [0], 20, [])).toThrow();
  expect(() => deletedRowLayout(1, [1], 20, [{ line: 1, height: NaN }])).toThrow();
});
test("Before question badges match exact CRLF evidence", () => {
  const file = { path: "a.ts", old: "first\r\nremoved\r\n", new: "" };
  const anchor = { path: "a.ts", side: "old", line: 2, content: "removed\r", context: "removed\r" };
  expect(reviewMarkers(file, { messages: [{ id: "q", role: "user", anchor }] })[0]).toMatchObject({ side: "old", line: 2 });
});
test("unchanged Before/After markers share layout space without merging their source identities", () => {
  const changes = [{ originalStartLineNumber: 18, originalEndLineNumber: 18, modifiedStartLineNumber: 18, modifiedEndLineNumber: 19 }];
  expect(badgeDisplayRow({ side: "old", line: 19 }, true, changes)).toBe("new:20");
  expect(badgeDisplayRow({ side: "new", line: 20 }, true, changes)).toBe("new:20");
  expect(badgeDisplayRow({ side: "old", line: 18 }, true, changes)).toBe("old:18");
  expect(badgeDisplayRow({ side: "new", line: 18 }, true, changes)).toBe("new:18");
  expect(badgeDisplayRow({ side: "old", line: 19 }, false, changes)).toBe("old:19");
});
test("layout-only row mapping respects insertion/deletion boundaries and pending diffs", () => {
  const insertion = [{ originalStartLineNumber: 5, originalEndLineNumber: 0, modifiedStartLineNumber: 6, modifiedEndLineNumber: 7 }];
  expect(badgeDisplayRow({ side: "old", line: 5 }, true, insertion)).toBe("new:5");
  expect(badgeDisplayRow({ side: "old", line: 6 }, true, insertion)).toBe("new:8");
  const deletion = [{ originalStartLineNumber: 4, originalEndLineNumber: 5, modifiedStartLineNumber: 3, modifiedEndLineNumber: 0 }];
  expect(badgeDisplayRow({ side: "old", line: 5 }, true, deletion)).toBe("old:5");
  expect(badgeDisplayRow({ side: "old", line: 6 }, true, deletion)).toBe("new:4");
  expect(badgeDisplayRow({ side: "old", line: 6 }, true, null)).toBe("old:6");
});
