import { afterAll, beforeAll, expect, test } from "bun:test";
import { buildBriefing, type BriefingDocument } from "../src/briefing.ts";
import { briefingCoverage, type HunkCoverage } from "../src/briefing-coverage.ts";
import type { LineRange } from "../src/change-facts.ts";
import type { GitComparison } from "../src/types.ts";
import { capturedText, historicalComparison, repositoryComparison } from "./comparison-fixtures.ts";

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

test("a document excerpt cites exactly its lines and never expands", async () => {
  const fixture = await repositoryComparison({ "notes.md": "# Notes\nend\n" }, { "notes.md": "# Notes\nbeta\ngamma\nend\n" });
  try {
    const quoted = (await capturedText(fixture.comparison, "new", "notes.md")).split("\n").slice(1, 3).join("\n");
    const doc = await buildBriefing(fixture.comparison, outline, "", {
      title: "t", sections: [{ id: "s", title: "s", blocks: [{ id: "b", kind: "source", evidenceId: "d1" }] }],
      evidence: [{ id: "d1", path: "notes.md", side: "new", startLine: 2, endLine: 3, quote: quoted }],
    });
    expect(doc.evidence[0]!.kind).toBe("document");
    expect(doc.evidence[0]!.available).toBe(true);
    const hunk = briefingCoverage(fixture.comparison, doc).hunks[0]!;
    expect(hunk.state).toBe("explained");
    expect(hunk.cited).toEqual([{ side: "new", startLine: 2, endLine: 3 }]);
    expect(hunk.expanded).toEqual([]);
    expect(hunk.unexplained).toEqual([]);
  } finally { await fixture.cleanup(); }
}, 30_000);

test("a document excerpt in a replacement cites only its line and leaves the other side unexplained", async () => {
  const fixture = await repositoryComparison({ "notes.md": "# Notes\nalpha\nend\n" }, { "notes.md": "# Notes\nbeta\ngamma\nend\n" });
  try {
    const quoted = (await capturedText(fixture.comparison, "new", "notes.md")).split("\n")[1]!;
    const doc = await buildBriefing(fixture.comparison, outline, "", {
      title: "t", sections: [{ id: "s", title: "s", blocks: [{ id: "b", kind: "source", evidenceId: "d1" }] }],
      evidence: [{ id: "d1", path: "notes.md", side: "new", startLine: 2, endLine: 2, quote: quoted }],
    });
    expect(doc.evidence[0]!.kind).toBe("document");
    expect(doc.evidence[0]!.available).toBe(true);
    const coverage = briefingCoverage(fixture.comparison, doc);
    const hunk = coverage.hunks[0]!;
    expect(hunk.state).toBe("partly-explained");
    expect(hunk.cited).toEqual([{ side: "new", startLine: 2, endLine: 2 }]);
    expect(hunk.expanded).toEqual([]);
    expect(hunk.unexplained).toEqual([{ side: "old", startLine: 2, endLine: 2 }, { side: "new", startLine: 3, endLine: 3 }]);
    expect(coverage.evidenceWithoutDiff).toBe(0);
  } finally { await fixture.cleanup(); }
}, 30_000);

test("document excerpts on both sides of a renamed file explain its replacement by path", async () => {
  const body = Array.from({ length: 20 }, (_, i) => `line ${i}`);
  const before = ["# Old", ...body, "tail old", "end"].join("\n") + "\n";
  const after = ["# Old", ...body, "tail new", "end"].join("\n") + "\n";
  const fixture = await repositoryComparison({ "old-notes.md": before }, { "old-notes.md": null, "new-notes.md": after });
  try {
    const file = fixture.comparison.files[0]!;
    expect(fixture.comparison.files).toHaveLength(1);
    expect(file.oldPath).toBe("old-notes.md");
    expect(file.newPath).toBe("new-notes.md");
    const oldLine = before.split("\n").indexOf("tail old") + 1, newLine = after.split("\n").indexOf("tail new") + 1;
    const oldQuote = (await capturedText(fixture.comparison, "old", "old-notes.md")).split("\n")[oldLine - 1]!;
    const newQuote = (await capturedText(fixture.comparison, "new", "new-notes.md")).split("\n")[newLine - 1]!;
    const doc = await buildBriefing(fixture.comparison, outline, "", {
      title: "t", sections: [{ id: "s", title: "s", blocks: [{ id: "b0", kind: "source", evidenceId: "d0" }, { id: "b1", kind: "source", evidenceId: "d1" }] }],
      evidence: [
        { id: "d0", path: "old-notes.md", side: "old", startLine: oldLine, endLine: oldLine, quote: oldQuote },
        { id: "d1", path: "new-notes.md", side: "new", startLine: newLine, endLine: newLine, quote: newQuote },
      ],
    });
    expect(doc.evidence.every(e => e.kind === "document" && e.available)).toBe(true);
    const hunk = briefingCoverage(fixture.comparison, doc).hunks.find(h => h.path === file.path)!;
    expect(hunk.state).toBe("explained");
    expect(hunk.cited).toEqual([{ side: "old", startLine: oldLine, endLine: oldLine }, { side: "new", startLine: newLine, endLine: newLine }]);
    expect(hunk.expanded).toEqual([]);
  } finally { await fixture.cleanup(); }
}, 30_000);

test("over 8f84166..740bada every changed line is counted exactly once", async () => {
  const history = await historicalComparison("8f84166", "740bada");
  const rowsOf = (path: string) => history.files.find(f => f.path === path)!.hunks.flatMap(h => h.rows);
  const revision = rowsOf("src/revision.ts").find(r => r.kind === "addition")!;
  const gitRows = rowsOf("src/git.ts");
  const afterDeletion = gitRows.find((r, i) => r.kind === "addition" && gitRows[i - 1]?.kind === "deletion")!;
  const cite = async (path: string, line: number, i: number) => ({ id: `e${i}`, path, side: "new" as const, startLine: line, endLine: line, quote: (await capturedText(history, "new", path)).split("\n")[line - 1]! });
  const evidence = [await cite("src/revision.ts", revision.newLine!, 0), await cite("src/git.ts", afterDeletion.newLine!, 1)];
  const doc = await buildBriefing(history, outline, "", {
    title: "t", sections: [{ id: "s", title: "s", blocks: evidence.map((e, i) => ({ id: `b${i}`, kind: "source" as const, evidenceId: e.id })) }], evidence,
  });
  expect(doc.evidence.every(e => e.available && e.kind === "code" && e.diff?.available)).toBe(true);
  const coverage = briefingCoverage(history, doc);
  expect(coverage.state).toBe("measured");
  const gitFile = history.files.find(f => f.path === "src/git.ts")!;
  const gitHunk = coverage.hunks.find(h => h.path === "src/git.ts" && gitFile.hunks[h.hunk]!.rows.some(r => r.kind === "addition" && r.newLine === afterDeletion.newLine))!;
  expect(lines(gitHunk.cited, "new")).toContain(afterDeletion.newLine!);
  expect(gitHunk.expanded.length).toBeGreaterThan(0);
  const changed = history.files.flatMap(f => f.hunks.flatMap(h => h.rows)).filter(r => r.kind === "addition" || r.kind === "deletion").length;
  expect(coverage.totals.changedLines).toBe(changed);
  for (const hunk of coverage.hunks) {
    const all = [...hunk.cited, ...hunk.expanded, ...hunk.unexplained].flatMap(r => lines([r], r.side).map(line => `${r.side}${line}`));
    expect(new Set(all).size).toBe(all.length);
    expect(size(hunk.cited) + size(hunk.expanded) + size(hunk.unexplained)).toBe(hunk.changedLines);
  }
  expect(coverage.hunks.filter(h => h.path === "src/revision.ts").some(h => h.state === "partly-explained")).toBe(true);
}, 30_000);

test("over 57bf907..27b7e44 a Briefing holding no evidence explains nothing", async () => {
  const history = await historicalComparison("57bf907", "27b7e44");
  const doc = await buildBriefing(history, outline, "", { title: "t", sections: [{ id: "s", title: "s", blocks: [{ id: "b", kind: "prose", text: "x", basis: "stated" }] }], evidence: [] });
  const coverage = briefingCoverage(history, doc);
  expect(coverage.hunks.length).toBeGreaterThan(0);
  expect(coverage.hunks.every(h => h.state === "not-explained")).toBe(true);
  expect(coverage.totals.unexplained).toBe(coverage.totals.changedLines);
}, 30_000);
