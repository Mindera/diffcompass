import { afterAll, beforeAll, expect, test } from "bun:test";
import { buildBriefing, type BriefingDocument } from "../src/briefing.ts";
import { briefingCoverage, type HunkCoverage } from "../src/briefing-coverage.ts";
import type { LineRange } from "../src/change-facts.ts";
import type { GitComparison } from "../src/types.ts";
import { capturedText, repositoryComparison } from "./comparison-fixtures.ts";

const outline = { title: "t", summary: "s", phases: [], flows: [], callFlows: [], findings: [] };
const calcBase = ["// head", "const value = 10;", ...Array.from({ length: 40 }, (_, i) => `// context ${i}`)].join("\n") + "\n";
const calcHead = ["// head", "const subtotal = 20;", "const value = subtotal * 0.9;", ...Array.from({ length: 40 }, (_, i) => `// context ${i}`)].join("\n") + "\n";
const large = (name: string) => Array.from({ length: 200 }, (_, i) => `${name}(${i});`).join("\n") + "\n";

let cleanup: () => Promise<void>, comparison: GitComparison;
beforeAll(async () => {
  const fixture = await repositoryComparison(
    { "calc.ts": calcBase, "log.ts": 'log("start");\nretry(1);\n', "large.ts": large("oldCall"), "other.ts": "const a = 1;\n" },
    { "calc.ts": calcHead, "log.ts": 'log("begin");\nretry(3);\n', "large.ts": large("newCall"), "other.ts": "const a = 2;\n" },
  );
  comparison = fixture.comparison; cleanup = fixture.cleanup;
}, 30_000);
afterAll(async () => { await cleanup?.(); });

async function quote(path: string, line: number) { return (await capturedText(comparison, "new", path)).split("\n")[line - 1]!; }
async function documentWith(cites: Array<[string, number]>, extra: Array<{ id: string; path: string; startLine: number; endLine: number; quote: string }> = []) {
  const evidence = await Promise.all(cites.map(async ([path, line], i) => ({ id: `e${i}`, path, side: "new" as const, startLine: line, endLine: line, quote: await quote(path, line) })));
  return buildBriefing(comparison, outline, "", {
    title: "t", sections: [{ id: "s", title: "s", blocks: evidence.map((e, i) => ({ id: `b${i}`, kind: "source" as const, evidenceId: e.id })) }],
    evidence: [...evidence.map(e => ({ ...e })), ...extra.map(e => ({ ...e, side: "new" as const }))],
  });
}
const hunksOf = (coverage: ReturnType<typeof briefingCoverage>, path: string) => coverage.hunks.filter(h => h.path === path);
const size = (ranges: LineRange[]) => ranges.reduce((n, r) => n + r.endLine - r.startLine + 1, 0);
const lines = (ranges: LineRange[], side: "old" | "new") => ranges.filter(r => r.side === side).flatMap(r => Array.from({ length: r.endLine - r.startLine + 1 }, (_, i) => r.startLine + i));

test("a replacement cited on one side explains both sides and keeps cited apart from expanded", async () => {
  const doc = await documentWith([["calc.ts", 3]]);
  const [hunk] = hunksOf(briefingCoverage(comparison, doc), "calc.ts") as [HunkCoverage];
  expect(hunk.state).toBe("explained");
  expect(hunk.cited).toEqual([{ side: "new", startLine: 3, endLine: 3 }]);
  expect(hunk.expanded).toEqual([{ side: "old", startLine: 2, endLine: 2 }, { side: "new", startLine: 2, endLine: 2 }]);
  expect(hunk.unexplained).toEqual([]);
}, 30_000);

test("lines expanded from a neighbouring citation are expanded, not cited", async () => {
  const hunk = hunksOf(briefingCoverage(comparison, await documentWith([["log.ts", 1]])), "log.ts")[0]!;
  expect(hunk.state).toBe("explained");
  expect(hunk.cited).toEqual([{ side: "new", startLine: 1, endLine: 1 }]);
  expect(lines(hunk.cited, "new")).not.toContain(2);
  expect(lines(hunk.expanded, "new")).toContain(2);
  expect(lines(hunk.expanded, "old")).toContain(2);
}, 30_000);

test("rows behind an omitted-lines marker stay unexplained", async () => {
  const doc = await documentWith([["large.ts", 100]]);
  const hunk = hunksOf(briefingCoverage(comparison, doc), "large.ts")[0]!;
  expect(hunk.state).toBe("partly-explained");
  expect(hunk.unexplained.length).toBeGreaterThan(0);
  const diff = doc.evidence[0]!.diff!;
  if (!diff.available) throw Error(diff.reason);
  expect(diff.rows.some(r => r.kind === "meta")).toBe(true);
  const shownNew = new Set(diff.rows.map(r => r.newLine)), shownOld = new Set(diff.rows.map(r => r.oldLine));
  const captured = comparison.files.find(f => f.path === "large.ts")!.hunks[0]!.rows;
  const hidden = (side: "old" | "new") => captured
    .filter(r => r.kind === (side === "old" ? "deletion" : "addition"))
    .map(r => (side === "old" ? r.oldLine : r.newLine)!)
    .filter(line => !(side === "old" ? shownOld : shownNew).has(line));
  expect(hidden("new").length).toBeGreaterThan(0);
  expect(hidden("old").length).toBeGreaterThan(0);
  expect(lines(hunk.unexplained, "new")).toEqual(hidden("new"));
  expect(lines(hunk.unexplained, "old")).toEqual(hidden("old"));
}, 30_000);

test("an uncited file is not explained and every hunk partitions its changed lines", async () => {
  const coverage = briefingCoverage(comparison, await documentWith([["calc.ts", 3], ["large.ts", 100]]));
  const other = hunksOf(coverage, "other.ts")[0]!;
  expect(other.state).toBe("not-explained");
  expect(other.unexplained).toEqual([{ side: "old", startLine: 1, endLine: 1 }, { side: "new", startLine: 1, endLine: 1 }]);
  for (const hunk of coverage.hunks) {
    const all = [...hunk.cited, ...hunk.expanded, ...hunk.unexplained].flatMap(r => lines([r], r.side).map(line => `${r.side}${line}`));
    expect(size(hunk.cited) + size(hunk.expanded) + size(hunk.unexplained)).toBe(hunk.changedLines);
    expect(new Set(all).size).toBe(all.length);
    const captured = comparison.files.find(f => f.path === hunk.path)!.hunks[hunk.hunk]!.rows;
    expect(hunk.changedLines).toBe(captured.filter(r => r.kind === "addition" || r.kind === "deletion").length);
  }
  const stateOf = (path: string) => hunksOf(coverage, path)[0]!.state;
  expect([stateOf("calc.ts"), stateOf("large.ts"), stateOf("log.ts"), stateOf("other.ts")]).toEqual(["explained", "partly-explained", "not-explained", "not-explained"]);
  expect(coverage.totals.hunks).toBe(coverage.hunks.length);
  expect(coverage.totals.explained).toBe(1);
  expect(coverage.totals.partlyExplained).toBe(1);
  expect(coverage.totals.notExplained).toBe(2);
  expect(coverage.totals.changedLines).toBe(coverage.hunks.reduce((n, h) => n + h.changedLines, 0));
  expect(coverage.totals.cited).toBe(coverage.hunks.reduce((n, h) => n + size(h.cited), 0));
  expect(coverage.totals.expanded).toBe(coverage.hunks.reduce((n, h) => n + size(h.expanded), 0));
  expect(coverage.totals.unexplained).toBe(coverage.hunks.reduce((n, h) => n + size(h.unexplained), 0));
}, 30_000);

test("shown code evidence without a diff is counted and explains nothing", async () => {
  const doc = structuredClone(await documentWith([["calc.ts", 3]]));
  delete doc.evidence[0]!.diff;
  const coverage = briefingCoverage(comparison, doc);
  expect(coverage.evidenceWithoutDiff).toBe(1);
  expect(hunksOf(coverage, "calc.ts")[0]!.state).toBe("not-explained");
}, 30_000);

test("a diff that is unavailable explains nothing", async () => {
  const doc = structuredClone(await documentWith([["calc.ts", 3]]));
  doc.evidence[0]!.diff = { available: false, reason: "gone" };
  const coverage = briefingCoverage(comparison, doc);
  expect(coverage.evidenceWithoutDiff).toBe(0);
  expect(hunksOf(coverage, "calc.ts")[0]!.state).toBe("not-explained");
}, 30_000);

test("a diff whose paths do not match the comparison file explains nothing", async () => {
  const doc = structuredClone(await documentWith([["calc.ts", 3]]));
  const diff = doc.evidence[0]!.diff!;
  if (!diff.available) throw Error(diff.reason);
  diff.newPath = "elsewhere.ts";
  expect(hunksOf(briefingCoverage(comparison, doc), "calc.ts")[0]!.state).toBe("not-explained");
}, 30_000);

test("another comparison makes the coverage unavailable", async () => {
  const doc: BriefingDocument = { ...(await documentWith([["calc.ts", 3]])), comparisonId: "f".repeat(64) };
  const coverage = briefingCoverage(comparison, doc);
  expect(coverage.state).toBe("unavailable");
  expect(coverage.hunks).toEqual([]);
  expect(coverage.totals.hunks).toBe(0);
}, 30_000);

test("evidence no block references counts as nothing until a diagram element shows it", async () => {
  const extra = { id: "x1", path: "other.ts", startLine: 1, endLine: 1, quote: "const a = 2;" };
  const doc = await documentWith([["calc.ts", 3]], [extra]);
  expect(doc.evidence.some(e => e.id === "x1" && e.available)).toBe(true);
  expect(hunksOf(briefingCoverage(comparison, doc), "other.ts")[0]!.state).toBe("not-explained");
  const shown = structuredClone(doc);
  shown.diagrams.push({ id: "d1", title: "d", family: "architecture", ir: {}, elements: [{ id: "x", label: "x", kind: "components", evidenceIds: ["x1"] }] });
  shown.sections[0]!.blocks.push({ id: "b-d1", kind: "diagram", diagramId: "d1" });
  const other = hunksOf(briefingCoverage(comparison, shown), "other.ts")[0]!;
  expect(other.state).toBe("explained");
  expect(other.cited).toEqual([{ side: "new", startLine: 1, endLine: 1 }]);
}, 30_000);
