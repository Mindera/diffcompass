import { expect, test } from "bun:test";
import { parseUnifiedDiff } from "../src/diff.ts";
import { captureTourEvidence, reconcileTourEvidence, tourCode, tourCoverage, validTourAnchor } from "../src/tour-evidence.ts";
import type { GitComparison, TourOutline, TourStep } from "../src/types.ts";

const patch = `diff --git a/app.ts b/app.ts
--- a/app.ts
+++ b/app.ts
@@ -1,5 +1,5 @@
 first
-oldOne()
+newOne()
 middle
-oldTwo()
+newTwo()
 last
diff --git a/test.ts b/test.ts
--- a/test.ts
+++ b/test.ts
@@ -1 +1 @@
-oldTest()
+newTest()
diff --git a/image.png b/image.png
Binary files a/image.png and b/image.png differ
`;
const comparison = (): GitComparison => ({ repositoryRoot: "/tmp/test", repositoryName: "test", base: "main", head: "head", mergeBase: "base", patch, repositoryFiles: [], files: parseUnifiedDiff(patch) });
const step = (): TourStep => ({ id: "one", title: "Change", objective: "Read the change", anchor: { path: "app.ts", side: "new", startLine: 2, endLine: 2 } });
const outline = (...steps: TourStep[]): TourOutline => ({ title: "Tour", summary: "Summary", phases: [{ id: "one", title: "Phase", summary: "Summary", fileChanges: [], steps }], callFlows: [], flows: [], findings: [] });
function stamped(s = step(), c = comparison()) { s.evidence = captureTourEvidence(s, c); const o = outline(s); reconcileTourEvidence(o, c); return { s, o, c }; }

test("coverage distinguishes partial blocks, grouped tests and binary changes", () => {
  const { s, o, c } = stamped();
  expect(tourCoverage(o, c)).toMatchObject({ total: 3, covered: 0, partial: 1 });
  s.relatedAnchors = [{ path: "app.ts", side: "old", startLine: 4, endLine: 4 }, { path: "test.ts", side: "new", startLine: 1, endLine: 1 }];
  s.evidence = captureTourEvidence(s, c); reconcileTourEvidence(o, c);
  const coverage = tourCoverage(o, c);
  expect(coverage).toMatchObject({ total: 3, covered: 2, partial: 0 });
  expect(coverage.uncovered).toHaveLength(1); expect(coverage.uncovered[0]?.path).toBe("image.png");
  expect(tourCode(s, c).groups.map(group => group.path)).toEqual(["app.ts", "test.ts"]);
});

test("covering a subset of contiguous added lines is partial, not complete or absent", () => {
  const c = comparison(); c.files[0]!.hunks[0]!.rows = [1, 2, 3].map(line => ({ kind: "addition", content: `line ${line}`, oldLine: null, newLine: line }));
  const { o } = stamped(step(), c);
  expect(tourCoverage(o, c)).toMatchObject({ covered: 0, partial: 1 });
});

test("content identities relocate both sides after line shifts and survive serialization", () => {
  const { s, o, c } = stamped(); s.relatedAnchors = [{ ...s.anchor, side: "old" }]; s.evidence = captureTourEvidence(s, c);
  const restored = JSON.parse(JSON.stringify(o)) as TourOutline;
  for (const row of c.files[0]!.hunks[0]!.rows) { if (row.oldLine !== null) row.oldLine += 20; if (row.newLine !== null) row.newLine += 30; }
  reconcileTourEvidence(restored, c);
  expect(restored.phases[0]!.steps[0]).toMatchObject({ freshness: "current", anchor: { startLine: 32 }, relatedAnchors: [{ startLine: 22 }] });
});

test("changed, removed and ambiguous evidence stays stale even when old line numbers exist", () => {
  for (const mode of ["changed", "removed", "ambiguous"]) {
    const { s, o, c } = stamped();
    const hunk = c.files[0]!.hunks[0]!;
    if (mode === "changed") hunk.rows[2]!.content = "different()";
    if (mode === "removed") c.files[0]!.hunks = [];
    if (mode === "ambiguous") c.files[0]!.hunks.push(structuredClone(hunk));
    reconcileTourEvidence(o, c);
    expect(s.freshness).toBe("outdated"); expect(s.missingEvidence).toBeGreaterThan(0);
    expect(tourCode(s, c).groups).toEqual([]); expect(tourCoverage(o, c).covered).toBe(0);
  }
});

test("legacy stops remain readable but cannot claim verified coverage", () => {
  const s = step(), o = outline(s), c = comparison(); reconcileTourEvidence(o, c);
  expect(s.freshness).toBe("unverified"); expect(tourCoverage(o, c)).toMatchObject({ covered: 0, unverifiedSteps: 1 });
  expect(tourCode(s, c).groups).toHaveLength(1);
});

test("anchor validation rejects missing paths, invalid sides, gaps and unbounded ranges", () => {
  const c = comparison(), a = step().anchor;
  expect(validTourAnchor(a, c)).toBe(true);
  for (const override of [{ path: "missing" }, { side: "both" }, { startLine: 0 }, { endLine: Infinity }, { endLine: 600 }, { startLine: 6, endLine: 6 }]) expect(validTourAnchor({ ...a, ...override }, c)).toBe(false);
  expect(validTourAnchor(a, c, new Set(["test.ts"]))).toBe(false);
});

test("deleted-only files have old-side coverage links; large excerpts stay bounded", () => {
  const c = comparison(); c.files[0]!.status = "deleted"; c.files[0]!.hunks[0]!.rows = Array.from({ length: 1_000 }, (_, i) => ({ kind: "deletion", content: `old ${i}`, oldLine: i + 1, newLine: null }));
  const { s, o } = stamped({ ...step(), anchor: { path: "app.ts", side: "old", startLine: 950, endLine: 952 } }, c);
  expect(tourCoverage(o, c).uncovered[0]?.anchor?.side).toBe("old");
  const group = tourCode(s, c).groups[0]!;
  expect(group.rows.some(row => row.oldLine === 950)).toBe(true); expect(group.limited).toBe(true); expect(group.rows.length).toBeLessThanOrEqual(160);
});

test("an oversized source line is omitted with a visible limit, never silently truncated", () => {
  const c = comparison(); c.files[0]!.hunks[0]!.rows = [{ kind: "addition", content: "x".repeat(100_001), oldLine: null, newLine: 2 }];
  const { s } = stamped(step(), c);
  expect(tourCode(s, c)).toMatchObject({ groups: [], limited: true });
});
