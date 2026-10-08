import { expect, test } from "bun:test";
// @ts-expect-error Browser module shared directly with the unit suite.
import { tourDisplaySegments } from "../public/monaco/source-anchor.mjs";
// @ts-expect-error Browser module shared directly with the unit suite.
import { deletedRowLayout } from "../public/monaco/deleted-annotations.mjs";
// @ts-expect-error Browser module shared directly with the unit suite.
import { tourBannerInsets, tourContextState } from "../public/monaco/annotations.mjs";

const changes = [
  { originalStartLineNumber: 5, originalEndLineNumber: 0, modifiedStartLineNumber: 6, modifiedEndLineNumber: 9 },
  { originalStartLineNumber: 6, originalEndLineNumber: 6, modifiedStartLineNumber: 10, modifiedEndLineNumber: 10 },
  { originalStartLineNumber: 8, originalEndLineNumber: 0, modifiedStartLineNumber: 13, modifiedEndLineNumber: 18 },
];
const anchor = (startLine: number, endLine = startLine, side = "old") => ({ side, startLine, endLine });
const segment = (side: string, deleted: boolean, startLine: number, endLine = startLine, sourceStartLine = startLine, sourceEndLine = endLine) => ({ side, deleted, startLine, endLine, sourceStartLine, sourceEndLine });

test("Split banners occupy their reserved source column, including unequal sash widths", () => {
  const bounds = { left: 30, right: 1230 };
  expect(tourBannerInsets(bounds, { left: 30, right: 430 }, false)).toEqual({ left: 6, right: 806 });
  expect(tourBannerInsets(bounds, { left: 430, right: 1230 }, false)).toEqual({ left: 406, right: 6 });
  // Old/new stops can share a vertical position but never cover one another
  // or paint over source in the opposite revision.
  const old = tourBannerInsets(bounds, { left: 30, right: 430 }, false);
  const next = tourBannerInsets(bounds, { left: 430, right: 1230 }, false);
  expect(bounds.right - old.right).toBeLessThan(bounds.left + next.left);
});
test("Unified banners keep the full diff width, independent of the hidden original editor", () => {
  expect(tourBannerInsets({ left: 30, right: 830 }, { left: 30, right: 30 }, true)).toEqual({ left: 6, right: 6 });
  expect(tourBannerInsets({ left: 30, right: 830 }, { left: 80, right: 830 }, true)).toEqual({ left: 6, right: 6 });
});

test("Unified Before stops wait for computed coordinates rather than guessing After lines", () => {
  expect(tourDisplaySegments(anchor(6, 8), true, null)).toEqual([]);
  expect(tourDisplaySegments(anchor(6, 8), true, [])).toEqual([segment("new", false, 6, 8)]);
  expect(tourDisplaySegments(anchor(6, 8, "new"), true, null)).toEqual([segment("new", false, 6, 8)]);
});
test("removed Before stop stays on its deleted row while unchanged Before maps across insertions", () => {
  expect(tourDisplaySegments(anchor(6), true, changes)).toEqual([segment("old", true, 6)]);
  expect(tourDisplaySegments(anchor(7, 8), true, changes)).toEqual([segment("new", false, 11, 12, 7, 8)]);
});
test("mixed Before highlight omits all inserted After source and preserves source endpoints", () => {
  const original = anchor(5, 9);
  expect(tourDisplaySegments(original, true, changes)).toEqual([
    segment("new", false, 5), segment("old", true, 6),
    segment("new", false, 11, 12, 7, 8), segment("new", false, 19, 19, 9, 9),
  ]);
  expect(original).toEqual(anchor(5, 9));
});
test("split and After stops use their own model coordinates, including overlapping ranges", () => {
  expect(tourDisplaySegments(anchor(6, 8), false, changes)).toEqual([segment("old", false, 6, 8)]);
  expect(tourDisplaySegments(anchor(6, 8, "new"), true, changes)).toEqual([segment("new", false, 6, 8)]);
});
test("fully deleted files and first/last Before source lines need no After model line", () => {
  expect(tourDisplaySegments(anchor(1, 3), true, [{ originalStartLineNumber: 1, originalEndLineNumber: 3, modifiedStartLineNumber: 0, modifiedEndLineNumber: 0 }])).toEqual([segment("old", true, 1, 3)]);
});
test("tour focus opens only intersecting mapped gaps and never overwrites a reviewer selection", () => {
  const state = { original: { cursorState: ["saved-before-selection"] }, modified: { cursorState: ["saved-after-selection"] }, modelState: { collapsedRegions: [{ range: [1, 5] }, { range: [11, 13] }, { range: [20, 80] }] } };
  const next = tourContextState(state, anchor(7), changes);
  expect(next.modelState.collapsedRegions.map((region: { range: number[] }) => region.range)).toEqual([[1, 5], [13, 13], [20, 80]]);
  expect(next.original).toBe(state.original); expect(next.modified).toBe(state.modified);
  expect(state.modelState.collapsedRegions[1]!.range).toEqual([11, 13]);
  expect(tourContextState(state, anchor(6), changes)).toBeNull();
  expect(tourContextState(state, anchor(7), null)).toBeNull();
  expect(tourContextState({ modelState: { collapsedRegions: [{ range: [11, 13] }, {}] } }, anchor(7), changes)).toBeNull();
});
test("Before tour spaces precede wrapped source; comments stay after the final fragment", () => {
  const tour = { line: 6, height: 50, placement: "before" }, comment = { line: 6, height: 70 };
  const next = { line: 7, height: 40, placement: "before" };
  const result = deletedRowLayout(6, [2, 1], 20, [comment, tour, next]);
  expect(result.rowTops).toEqual([50, 70, 200]);
  expect(result.cardTops.get(tour)).toBe(0);
  expect(result.cardTops.get(comment)).toBe(90);
  expect(result.cardTops.get(next)).toBe(160);
  expect(result.extra).toBe(160);
});
test("overlapping stops have separate spaces in stable phase order and resize without moving source identity", () => {
  const first = { line: 1, height: 50, placement: "before" }, second = { line: 1, height: 60, placement: "before" };
  const result = deletedRowLayout(1, [1], 20, [first, second]);
  expect(result.rowTops).toEqual([110]); expect(result.cardTops.get(second)).toBe(50);
  first.height = 90;
  const resized = deletedRowLayout(1, [3], 20, [first, second]);
  expect(resized.rowTops).toEqual([150, 170, 190]); expect(resized.cardTops.get(second)).toBe(90);
  expect(deletedRowLayout(1, [3], 20, []).rowTops).toEqual([0, 20, 40]);
});
