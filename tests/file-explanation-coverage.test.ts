import { expect, test } from "bun:test";
import { TourAgent } from "../src/agent.ts";
import { AttachedAgentBridge } from "../src/bridge.ts";
import { DEFAULT_REVIEW_POLICY } from "../src/config.ts";
import { fileExplanationFor, fileSummarySource, MAX_FILE_EXPLANATION_LENGTH } from "../src/file-explanations.ts";
import { semanticExport } from "../src/semantic-diff-export.ts";
import type { GitComparison, TourOutline } from "../src/types.ts";

const kotlinSummary = "total now subtracts an optional discount. Omitting it preserves the previous calculation; check whether negative discounts or discounts exceeding the value should be allowed.";
function comparison(paths = ["app.ts", "Sample.kt"]): GitComparison {
  return {
    repositoryRoot: "/tmp/unused-coverage-fixture", repositoryName: "fixture", base: "main", mergeBase: "a".repeat(40),
    sourceTree: "b".repeat(40), head: "c".repeat(40), patch: "saved fixture diff", repositoryFiles: paths,
    files: paths.map(path => ({ path, oldPath: path, newPath: path, status: "modified", metadata: [], additions: 1, deletions: 1,
      hunks: [{ header: "@@ -1 +1 @@", oldStart: 1, oldCount: 1, newStart: 1, newCount: 1, rows: [
        { kind: "deletion", oldLine: 1, newLine: null, content: "fun total(value: Int) = value" },
        { kind: "addition", oldLine: null, newLine: 1, content: "fun total(value: Int, discount: Int = 0) = value - discount" },
      ] }],
    })),
  };
}
function outline(captured: GitComparison, complete = true): TourOutline {
  return {
    title: "Discount calculation", summary: "Review the optional discount.", callFlows: [], flows: [], findings: [],
    structuralBlastRadii: [], structuralAnalysisOmissionReason: "This fixture has no structural graph.",
    phases: [{ id: "calculation", title: "Calculation", summary: "Review the calculation.",
      fileChanges: (complete ? captured.files : captured.files.slice(0, 1)).map(file => ({ path: file.path, summary: kotlinSummary })),
      steps: [{ id: "calculate", title: "Calculate", objective: "The discount is subtracted.", anchor: { path: captured.files[0]!.path, side: "new", startLine: 1, endLine: 1 } }],
    }],
  };
}
function start(captured: GitComparison) {
  const bridge = new AttachedAgentBridge();
  const agent = new TourAgent(captured.repositoryRoot, { adapterId: "attached", modelId: "current-session", includeArchitecture: false,
    includeFindings: false, includeAdaptiveDiagrams: false, includeCallFlows: false, includeFlows: false }, bridge);
  return { bridge, pending: agent.createOutline(captured, DEFAULT_REVIEW_POLICY) };
}
async function respond(bridge: AttachedAgentBridge, after: number, value: unknown) {
  const [event] = await bridge.eventsAfter(after, 1_000);
  if (!event || event.type !== "agent.prompt") throw new Error("Expected outline request");
  await bridge.respond(event.id, JSON.stringify(value));
  await bridge.ack(event.id);
  return event;
}

test.each(["omitted", "blank", "overlong", "discarded-phase", "old-rename-path"])("repairs %s explanations before accepting a tour, without requiring extra stops", async mode => {
  const captured = comparison();
  if (mode === "old-rename-path") { captured.files[1]!.status = "renamed"; captured.files[1]!.oldPath = "OldSample.kt"; }
  const bad = outline(captured, mode !== "omitted"), good = outline(captured);
  if (mode === "blank") bad.phases[0]!.fileChanges[1]!.summary = " \n\t";
  if (mode === "overlong") bad.phases[0]!.fileChanges[1]!.summary = "x".repeat(MAX_FILE_EXPLANATION_LENGTH + 1);
  if (mode === "old-rename-path") bad.phases[0]!.fileChanges[1]!.path = "OldSample.kt";
  if (mode === "discarded-phase") {
    const supporting = bad.phases[0]!.fileChanges.splice(1);
    bad.phases.push({ id: "discarded", title: "No valid stop", summary: "Dropped by validation.", fileChanges: supporting, steps: [] });
  }
  const { bridge, pending } = start(captured);
  try {
    const first = await respond(bridge, 0, bad);
    expect(first.prompt).toContain("Every changed file must have a usable fileChanges.summary");
    expect(first.prompt).toContain("do not add stops merely to satisfy file coverage");
    const retry = await respond(bridge, first.sequence, good);
    expect(retry.prompt).toContain('1 changed file: "Sample.kt"');
    expect(retry.prompt).toContain("<previous-outline>\n" + JSON.stringify(bad));
    const result = await pending;
    expect(result.receipts).toEqual([first.id, retry.id]);
    expect(result.value.phases[0]!.steps).toHaveLength(1);
    const explanation = fileExplanationFor(captured, result.value, "Sample.kt");
    expect(explanation.status).toBe("available");
    expect(explanation.entries[0]!.summary).toBe(kotlinSummary);
    expect(explanation.entries[0]!.steps).toEqual([]);
    expect(result.value.phases[0]!.fileChanges[1]!.summarySource).toBe(fileSummarySource(captured));
    for (const format of ["html", "markdown"] as const) {
      const output = semanticExport(captured, format, result.value);
      expect(output).toContain("Saved tour explanations: 2 of 2");
      expect(output).toContain("Omitting it preserves the previous calculation; check whether negative discounts");
    }
  } finally { bridge.dispose(); }
});

test("all-file coverage includes added, deleted, renamed, binary, generated and unsupported files", async () => {
  const captured = comparison(["app.ts", "added.kt", "removed.rb", "renamed.py", "logo.png", "schema.generated.ts", "guide.md"]);
  captured.files[1]!.status = "added"; captured.files[1]!.oldPath = null;
  captured.files[2]!.status = "deleted"; captured.files[2]!.newPath = null;
  captured.files[3]!.status = "renamed"; captured.files[3]!.oldPath = "original.py";
  captured.files[4]!.hunks = []; captured.files[4]!.metadata = ["Binary files differ"];
  const complete = outline(captured);
  complete.phases[0]!.fileChanges[4]!.summary = "The binary image changed. Its pixels were not inspected, so the visual effect is unverified.";
  const { bridge, pending } = start(captured);
  try {
    await respond(bridge, 0, complete);
    const result = (await pending).value;
    expect(result.phases[0]!.steps).toHaveLength(1);
    for (const file of captured.files) expect(fileExplanationFor(captured, result, file.path).status).toBe("available");
    expect(fileExplanationFor(captured, result, "logo.png").entries[0]!.summary).toContain("not inspected");
  } finally { bridge.dispose(); }
});

test("more than 100 files can have explanations without exceeding the tour's step limit", async () => {
  const captured = comparison(Array.from({ length: 150 }, (_, i) => `file-${i}.kt`));
  const { bridge, pending } = start(captured);
  try {
    await respond(bridge, 0, outline(captured));
    const result = (await pending).value;
    expect(result.phases[0]!.steps).toHaveLength(1);
    expect(result.phases[0]!.fileChanges).toHaveLength(150);
  } finally { bridge.dispose(); }
});

test("after two repair attempts incomplete coverage fails instead of accepting optional fallback; diagnostics are bounded", async () => {
  const captured = comparison(Array.from({ length: 150 }, (_, i) => `file-${i}.kt`));
  const { bridge, pending } = start(captured);
  const settled = pending.then(() => undefined, error => error);
  const incomplete = outline(captured, false);
  // Would normally trigger the optional-outline fallback after two retries.
  incomplete.structuralAnalysisOmissionReason = undefined;
  try {
    let after = 0;
    for (let i = 0; i < 3; i++) after = (await respond(bridge, after, incomplete)).sequence;
    const error = await settled;
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("149 changed files");
    expect(error.message).toContain('"file-20.kt", and 129 more');
    expect(error.message).not.toContain('"file-21.kt"');
    expect((await bridge.eventsAfter(after, 0)).filter(event => event.type === "agent.prompt")).toEqual([]);
  } finally { bridge.dispose(); }
});

test("older incomplete tours remain readable with an honest missing notice; unstamped notes remain stale", () => {
  const captured = comparison(), incomplete = outline(captured, false);
  expect(fileExplanationFor(captured, undefined, "Sample.kt").message).toContain("Start a tour");
  const missing = fileExplanationFor(captured, incomplete, "Sample.kt");
  expect(missing.status).toBe("missing");
  expect(missing.message).toBe("This tour has no saved explanation for this file. Ask the agent about this change.");
  expect(missing.message).not.toContain("Start a tour");
  expect(fileExplanationFor(captured, incomplete, "app.ts").status).toBe("stale");
  expect(incomplete.phases[0]!.fileChanges).toHaveLength(1);
  expect(incomplete.phases[0]!.fileChanges[0]!.summarySource).toBeUndefined();
});
