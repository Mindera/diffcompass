import { expect, test } from "bun:test";
import { structuralPinsForFinding, validateStructuralBlastRadii } from "../src/structural-blast-radius.ts";
import type { GitComparison, StructuralTestEvidence } from "../src/types.ts";

const comparison: GitComparison = {
  repositoryRoot: "/tmp/repository",
  repositoryName: "repository",
  base: "main",
  mergeBase: "base",
  head: "head",
  patch: "",
  repositoryFiles: ["src/service.ts", "src/consumer.ts", "src/controller.ts", "tests/service.test.ts"],
  files: [{
    path: "src/service.ts", oldPath: "src/service.ts", newPath: "src/service.ts", status: "modified", metadata: [], additions: 1, deletions: 0,
    hunks: [{ header: "@@ -12 +12 @@", oldStart: 12, oldCount: 1, newStart: 12, newCount: 1, rows: [{ kind: "addition", content: "export function process() {}", oldLine: null, newLine: 12 }] }],
  }, {
    path: "src/consumer.ts", oldPath: "src/consumer.ts", newPath: "src/consumer.ts", status: "modified", metadata: [], additions: 1, deletions: 0,
    hunks: [{ header: "@@ -4 +4 @@", oldStart: 4, oldCount: 1, newStart: 4, newCount: 1, rows: [{ kind: "addition", content: "export function consume() {}", oldLine: null, newLine: 4 }] }],
  }],
};

const radius = {
  id: "radius:service-process",
  symbol: { id: "src/service.ts:new:12:process", symbol: "process", kind: "function", location: { path: "src/service.ts", side: "new", line: 12 } },
  provider: "repository-search",
  confidence: "low",
  provenance: "partial",
  summary: "Static caller reach for process, not proof of runtime impact.",
  nodes: [
    { id: "src/service.ts:new:12:process", symbol: "process", kind: "function", location: { path: "src/service.ts", side: "new", line: 12 } },
    { id: "src/consumer.ts:new:4:consume", symbol: "consume", kind: "function", location: { path: "src/consumer.ts", side: "new", line: 4 } },
    { id: "src/controller.ts:new:8:handle", symbol: "handle", kind: "function", location: { path: "src/controller.ts", side: "new", line: 8 } },
  ],
  edges: [
    { id: "consume-process", from: "src/consumer.ts:new:4:consume", to: "src/service.ts:new:12:process", relationship: "calls" },
    { id: "handle-consume", from: "src/controller.ts:new:8:handle", to: "src/consumer.ts:new:4:consume", relationship: "calls" },
  ],
  directCallerIds: ["src/consumer.ts:new:4:consume"],
  reportedDirectCallerCount: 3,
  reportedReachableNodeCount: 12,
  reportedImpactedFileCount: 6,
  coverage: { state: "partial", reportedCounts: "exact", omissionReason: "The provider supplied aggregate totals but not every identity." },
  impactedFiles: ["src/service.ts", "src/consumer.ts", "src/controller.ts"],
  nearbyTestGaps: [{ kind: "changed-symbol-not-covered", detail: "No nearby test references the changed process branch.", nearbyTestFiles: ["tests/service.test.ts"] }],
};

test("validates an isolated bounded static subgraph against its larger provider-reported radius", () => {
  const [result] = validateStructuralBlastRadii([radius], comparison);
  expect(result).toMatchObject({ provider: "repository-search", confidence: "low", provenance: "partial", reportedReachableNodeCount: 12, coverage: { state: "partial", reportedCounts: "exact" } });
  expect(result.directCallerIds).toEqual(["src/consumer.ts:new:4:consume"]);
  expect(result.nodes).toHaveLength(3);
});

test("rejects ambiguous pins and graph claims that do not match the visible subgraph", () => {
  expect(() => validateStructuralBlastRadii([{ ...radius, directCallerIds: ["src/controller.ts:new:8:handle"] }], comparison)).toThrow("directCallerIds");
  expect(() => validateStructuralBlastRadii([{ ...radius, reportedReachableNodeCount: 1 }], comparison)).toThrow("Reported structural counts");
  expect(() => validateStructuralBlastRadii([radius, { ...radius, id: "another-radius" }], comparison)).toThrow("roots must be unique");
});

test("keeps legacy completeness unknown instead of guessing that a saved graph is complete", () => {
  const [result] = validateStructuralBlastRadii([{ ...radius, coverage: undefined }], comparison);
  expect(result!.coverage).toEqual({
    state: "unknown",
    reportedCounts: "not-reported",
    omissionReason: "Reason not supplied by this saved result.",
  });
});

test("validates bounded test-source evidence while retaining legacy test gaps", () => {
  const evidence: StructuralTestEvidence = {
    state: "relevant-tests-found",
    searchScope: "Inspected tests/service.test.ts for process callers.",
    checkedSources: [{ path: "tests/service.test.ts", side: "new", line: 7, detail: "The test source invokes process through its public entry point." }],
    relevantTests: [{ path: "tests/service.test.ts", side: "new", line: 7, detail: "That call reaches process in the saved static graph." }],
    remainingUncertainty: "The source does not establish error-path behavior.",
  };
  const [result] = validateStructuralBlastRadii([{ ...radius, testEvidence: evidence }], comparison);
  expect(result?.testEvidence).toEqual(evidence);
  expect(result?.nearbyTestGaps[0]?.kind).toBe("changed-symbol-not-covered");
  expect(validateStructuralBlastRadii([{ ...radius, testEvidence: { state: "not-assessed", checkedSources: [], relevantTests: [] } }], comparison)[0]?.testEvidence?.state).toBe("not-assessed");
  expect(validateStructuralBlastRadii([{ ...radius, testEvidence: { state: "none-found", searchScope: "Searched tests/service.test.ts for process.", checkedSources: [], relevantTests: [] } }], comparison)[0]?.testEvidence?.state).toBe("none-found");
  expect(validateStructuralBlastRadii([{ ...radius, testEvidence: { state: "limited", searchScope: "Inspected tests/service.test.ts.", checkedSources: [], relevantTests: [], remainingUncertainty: "The saved source does not establish the error path." } }], comparison)[0]?.testEvidence?.state).toBe("limited");
  expect(() => validateStructuralBlastRadii([{ ...radius, testEvidence: { ...evidence, searchScope: undefined } }], comparison)).toThrow("searchScope");
  expect(() => validateStructuralBlastRadii([{ ...radius, testEvidence: { ...evidence, relevantTests: [] } }], comparison)).toThrow("relevant test source");
  expect(() => validateStructuralBlastRadii([{ ...radius, testEvidence: { ...evidence, checkedSources: [{ ...evidence.checkedSources[0], path: "missing.test.ts" }] } }], comparison)).toThrow("repository file");
});

test("requires an explanation for incomplete results and exact saved counts for complete results", () => {
  expect(() => validateStructuralBlastRadii([{ ...radius, coverage: { state: "partial", reportedCounts: "exact" } }], comparison)).toThrow("omissionReason");
  expect(() => validateStructuralBlastRadii([{
    ...radius,
    coverage: { state: "complete", reportedCounts: "exact" },
  }], comparison)).toThrow("complete structural result");
  const [complete] = validateStructuralBlastRadii([{
    ...radius,
    id: "radius:complete",
    symbol: radius.nodes[0],
    nodes: radius.nodes,
    edges: radius.edges,
    directCallerIds: ["src/consumer.ts:new:4:consume"],
    reportedDirectCallerCount: 1,
    reportedReachableNodeCount: 2,
    reportedImpactedFileCount: 3,
    coverage: { state: "complete", reportedCounts: "exact" },
  }], comparison);
  expect(complete!.coverage?.state).toBe("complete");
});

test("reuses one unambiguous source identity across root graphs while roots stay distinct", () => {
  const [first] = validateStructuralBlastRadii([radius, {
    ...radius,
    id: "radius:consumer-root",
    symbol: radius.nodes[1],
    nodes: [radius.nodes[1], radius.nodes[2]],
    edges: [{ id: "handle-consume-again", from: "src/controller.ts:new:8:handle", to: "src/consumer.ts:new:4:consume", relationship: "calls" }],
    directCallerIds: ["src/controller.ts:new:8:handle"],
    reportedDirectCallerCount: 1,
    reportedReachableNodeCount: 1,
    reportedImpactedFileCount: 2,
    coverage: { state: "complete", reportedCounts: "exact" },
    impactedFiles: ["src/consumer.ts", "src/controller.ts"],
  }], comparison);
  expect(first!.symbol.id).toBe("src/service.ts:new:12:process");
});

test("preserves an explicit unavailable-provider result instead of presenting it as zero impact", () => {
  const unavailable = {
    ...radius,
    id: "radius:unavailable",
    provider: "unavailable",
    confidence: "unresolved",
    provenance: "unverified",
    summary: "Structural provider unavailable; no static reach was discovered and this is not proof of zero runtime impact.",
    nodes: [radius.nodes[0]],
    edges: [],
    directCallerIds: [],
    reportedDirectCallerCount: 0,
    reportedReachableNodeCount: 0,
    reportedImpactedFileCount: 1,
    coverage: { state: "unavailable", reportedCounts: "not-reported" },
    impactedFiles: ["src/service.ts"],
    nearbyTestGaps: [{ kind: "coverage-unknown", detail: "No coverage conclusion is available while the provider is unavailable.", nearbyTestFiles: [] }],
  };
  expect(validateStructuralBlastRadii([unavailable], comparison)[0]).toMatchObject({ provider: "unavailable", confidence: "unresolved", reportedReachableNodeCount: 0 });
});

test("pins findings by source identity and falls back to the closest changed declaration", () => {
  const [result] = validateStructuralBlastRadii([radius], comparison);
  expect(structuralPinsForFinding({ path: "src/service.ts", side: "new", line: 13, pinScope: "symbol" }, [result!])).toEqual({ ids: ["src/service.ts:new:12:process"], reportedReachableNodeCount: 12 });
  expect(structuralPinsForFinding({ path: "src/service.ts", side: "new", line: 1, pinScope: "file" }, [result!])).toEqual({ ids: ["src/service.ts:new:12:process"], reportedReachableNodeCount: 12 });
  expect(structuralPinsForFinding({ path: "src/service.ts", side: "new", line: 13, pinScope: "symbol", pinnedSymbolIds: ["src/consumer.ts:new:4:consume"] }, [result!])).toEqual({ ids: ["src/consumer.ts:new:4:consume"], reportedReachableNodeCount: 12 });
});
