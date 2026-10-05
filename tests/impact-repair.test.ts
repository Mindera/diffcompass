import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { TourAgent } from "../src/agent.ts";
import { DEFAULT_REVIEW_POLICY } from "../src/config.ts";
import { validateStructuralBlastRadii } from "../src/structural-blast-radius.ts";
import type { GitComparison } from "../src/types.ts";

const comparison: GitComparison = {
  repositoryRoot: "/tmp/repository", repositoryName: "repository", base: "main", mergeBase: "base", head: "head", patch: "",
  repositoryFiles: ["app.ts"],
  files: [{ oldPath: "app.ts", newPath: "app.ts", path: "app.ts", status: "modified", metadata: [], additions: 2, deletions: 0,
    hunks: [{ header: "@@ -0,0 +1,2 @@", oldStart: 0, oldCount: 0, newStart: 1, newCount: 2,
      rows: [1, 2].map((line) => ({ kind: "addition" as const, content: `export function f${line}() {}`, oldLine: null, newLine: line })) }],
  }],
};

function radius(line = 1) {
  const symbol = { id: `f${line}`, symbol: `f${line}`, kind: "function", location: { path: "app.ts", side: "new", line } };
  return {
    id: `radius-${line}`, symbol, provider: "repository-search", confidence: "low", provenance: "partial",
    summary: "Bounded static search, not runtime impact.", nodes: [symbol], edges: [], directCallerIds: [],
    reportedDirectCallerCount: 0, reportedReachableNodeCount: 0, reportedImpactedFileCount: 1, impactedFiles: ["app.ts"],
    coverage: { state: "partial", reportedCounts: "lower-bound", omissionReason: "Only this file was searched." }, nearbyTestGaps: [],
  };
}

function outline(extra: Record<string, unknown>) {
  return {
    title: "Review", summary: "Changed declarations.", flows: [], callFlows: [], findings: [],
    phases: [{ id: "phase", title: "Behavior", summary: "The function changed.", fileChanges: [{ path: "app.ts", summary: "Defines functions." }],
      steps: [{ id: "step", title: "Function", objective: "The function changed.", anchor: { path: "app.ts", side: "new", startLine: 1, endLine: 1 } }] }],
    ...extra,
  };
}

async function generate(responses: Record<string, unknown>[]) {
  const prompts: string[] = [];
  const agent = new TourAgent("/tmp/repository", { adapterId: "attached", modelId: "current-session", includeArchitecture: false, includeFindings: false }, {
    async send(prompt) {
      prompts.push(prompt);
      if (prompts.length > responses.length) throw new Error("Unexpected extra repair");
      return JSON.stringify(responses[prompts.length - 1]);
    },
  });
  return { result: (await agent.createOutline(comparison, DEFAULT_REVIEW_POLICY)).value, prompts };
}

test("repairs only rejected impact evidence and retains good results omitted by the repair", async () => {
  const bad = { ...radius(2), provider: "invented" };
  const { result, prompts } = await generate([
    outline({ structuralBlastRadii: [radius(), bad] }),
    outline({ structuralBlastRadii: [radius(2)] }),
  ]);
  expect(prompts).toHaveLength(2);
  expect(prompts[1]).toContain("structuralBlastRadii[1] was omitted: Structural provider is invalid");
  expect(prompts[1]).toContain("Do not claim zero impact or invent callers");
  expect(result.structuralBlastRadii?.map((r) => r.id).sort()).toEqual(["radius-1", "radius-2"]);
  expect(result.structuralAnalysisWarnings).toEqual([]);
  expect(validateStructuralBlastRadii(result.structuralBlastRadii, comparison)).toHaveLength(2);
});

test("bounded repair preserves good subgraphs and persists exact remaining failures", async () => {
  const response = outline({ structuralBlastRadii: [radius(), { ...radius(2), provider: "invented" }] });
  const { result, prompts } = await generate([response, response, response]);
  expect(prompts).toHaveLength(3);
  expect(result.structuralBlastRadii?.map((r) => r.id)).toEqual(["radius-1"]);
  expect(result.structuralAnalysisWarnings).toEqual(["structuralBlastRadii[1] was omitted: Structural provider is invalid."]);
  expect(result.planningNotes?.[0]).toContain("Structural provider is invalid");
});

test("duplicate roots and conflicting shared identities reject only the offending subgraph", async () => {
  const other = radius(2);
  const shared = { id: "shared", symbol: "caller", kind: "function", location: { path: "app.ts", side: "new", line: 1 } };
  const withCaller = (r: ReturnType<typeof radius>, symbol: typeof shared) => ({
    ...r, nodes: [...r.nodes, symbol], edges: [{ id: "call", from: "shared", to: r.symbol.id, relationship: "calls" }],
    directCallerIds: ["shared"], reportedDirectCallerCount: 1, reportedReachableNodeCount: 1,
  });
  const response = outline({ structuralBlastRadii: [withCaller(radius(), shared), withCaller(other, { ...shared, symbol: "different" }), withCaller(radius(), shared)] });
  const { result } = await generate([response, response, response]);
  expect(result.structuralBlastRadii).toHaveLength(1);
  expect(result.structuralAnalysisWarnings?.join(" ")).toContain("same structural source identity");
  expect(result.structuralAnalysisWarnings?.join(" ")).toContain("ids must be unique");
});

test("missing or malformed analysis requests repair instead of silently becoming empty", async () => {
  for (const extra of [{}, { structuralBlastRadii: "invalid" }, { structuralBlastRadii: [] }]) {
    const { result, prompts } = await generate([outline(extra), outline({ structuralBlastRadii: [radius()] })]);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("structuralBlastRadii");
    expect(result.structuralBlastRadii).toHaveLength(1);
  }
});

test("explicit empty analysis is allowed, while failed analysis remains visibly diagnosed", async () => {
  const { prompts } = await generate([outline({ structuralBlastRadii: [], structuralAnalysisOmissionReason: "No identifiable changed declarations." })]);
  expect(prompts).toHaveLength(1);
  const { result } = await generate([outline({}), outline({}), outline({})]);
  expect(result.structuralBlastRadii).toEqual([]);
  expect(result.structuralAnalysisWarnings?.[0]).toContain("missing");
});

test("unavailable analysis preserves the known root without inventing callers", async () => {
  const unavailable = {
    ...radius(), provider: "unavailable", confidence: "unresolved", provenance: "unverified",
    coverage: { state: "unavailable", reportedCounts: "not-reported", omissionReason: "Source provider could not run." },
  };
  const { result, prompts } = await generate([outline({}), outline({ structuralBlastRadii: [unavailable] })]);
  expect(prompts).toHaveLength(2);
  expect(result.structuralBlastRadii?.[0]).toMatchObject({ provider: "unavailable", coverage: { reportedCounts: "not-reported" }, edges: [] });
  expect(result.structuralAnalysisWarnings).toEqual([]);
});

test("exhausted repair retains earlier valid results even if the last responses omit analysis", async () => {
  const { result } = await generate([
    outline({ structuralBlastRadii: [radius(), { ...radius(2), provider: "invalid" }] }), outline({}), outline({}),
  ]);
  expect(result.structuralBlastRadii?.map((r) => r.id)).toEqual(["radius-1"]);
  expect(result.structuralAnalysisWarnings?.[0]).toContain("missing");
});

test("Explore impact displays escaped repair diagnostics alongside valid results", () => {
  const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const source = app.slice(app.indexOf("function renderStructuralBlastRadii()"), app.indexOf("function structuralGraphElement"));
  const element = () => ({ innerHTML: "", textContent: "", value: "", disabled: false, classList: { add() {}, toggle() {} } });
  const warning = element();
  const elements = Object.fromEntries(["structural-blast-radius-tab", "structural-blast-radius-empty", "structural-blast-radius-select", "structural-blast-radius"].map((id) => [id, element()]));
  const render = new Function("state", "elements", "document", "escapeHtml", "structuralPickerOptionLabel", "structuralBlastRadiusCard", `${source}; renderStructuralBlastRadii();`);
  const state = { session: { outline: { structuralBlastRadii: [radius()], structuralAnalysisWarnings: ["Invalid <source>"] } } };
  render(state, elements, { getElementById: () => warning }, (s: string) => s.replaceAll("<", "&lt;"), () => "Function", () => "valid graph");
  expect(warning.innerHTML).toContain("Impact analysis is incomplete");
  expect(warning.innerHTML).toContain("Invalid &lt;source>");
  expect(elements["structural-blast-radius"]!.innerHTML).toBe("valid graph");
  expect(elements["structural-blast-radius-empty"]!.textContent).toContain("does not mean the change has no impact");
});
