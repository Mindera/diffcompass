import { expect, test } from "bun:test";
import { buildNeedsAttention } from "../src/attention.ts";
import type { DiffFile, GitComparison, PullRequestContext, TourOutline } from "../src/types.ts";

const file = (path: string, content: string, line = 1, kind: "addition" | "deletion" = "addition"): DiffFile => ({
  path, oldPath: path, newPath: path, status: "modified", metadata: [], additions: kind === "addition" ? 1 : 0, deletions: kind === "deletion" ? 1 : 0,
  hunks: [{ header: "@@ -1 +1 @@", oldStart: 1, oldCount: 1, newStart: 1, newCount: 1, rows: [{ kind, content, oldLine: kind === "deletion" ? line : null, newLine: kind === "addition" ? line : null }] }],
});

const comparison = (files: DiffFile[]): GitComparison => ({ repositoryRoot: "/tmp/repository", repositoryName: "repository", base: "main", mergeBase: "base", head: "head", patch: "", files, repositoryFiles: files.map((candidate) => candidate.path) });

const outline = (overrides: Partial<TourOutline> = {}): TourOutline => ({
  title: "Review", summary: "Summary", phases: [{ id: "phase", title: "Phase", summary: "Summary", fileChanges: [{ path: "src/api.ts", summary: "API" }], steps: [{ id: "step", title: "Step", objective: "Objective", anchor: { path: "src/api.ts", side: "new", startLine: 1, endLine: 1 } }] }], callFlows: [], flows: [], findings: [], ...overrides,
});

const pullRequest = (overrides: Partial<PullRequestContext> = {}): PullRequestContext => ({
  repository: "acme/repository", number: 7, url: "https://github.com/acme/repository/pull/7", title: "PR", body: "", author: "author", baseRefName: "main", baseRefOid: "a".repeat(40), headRefName: "feature", headRefOid: "b".repeat(40), sourceRepositoryRoot: "/tmp/repository", workspaceRoot: "/tmp/worktree", refNamespace: "refs/code-review-tour/test", commits: [], checks: [], threads: [], threadsTruncated: false, updatedAt: "now", ...overrides,
});

test("derives grounded signals and a factorized estimate deterministically", () => {
  const result = buildNeedsAttention(comparison([
    file("src/api.ts", "export interface PublicApi { value: string; }"),
    file("src/api.test.ts", "test('api', () => {})"),
    file("src/consumer.ts", "export function consume() {}"),
  ]), outline({
    findings: [{ id: "p1", phaseId: "phase", stepId: "step", path: "src/api.ts", side: "new", line: 1, lineContent: "export interface PublicApi { value: string; }", message: "Risk", category: "correctness", severity: "high", confidence: "high", evidence: "The changed contract is used by the consumer.", priority: "P1", introduced: true, recallGuard: true, blastRadiusSize: 3, tested: false, pinScope: "line", status: "open" }],
    callFlows: [{ id: "broad", title: "Broad flow", summary: "Summary", entrypointNodeId: "entry", provenance: "verified", nodes: [], edges: [], affectedFiles: ["src/api.ts", "src/api.test.ts", "src/consumer.ts", "src/other.ts"] }],
  }), pullRequest({ checks: [{ name: "CI", state: "FAILURE", url: "https://github.com/acme/repository/actions" }], mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }));

  expect(result.signals.map((signal) => signal.kind)).toEqual(["finding", "public-contract", "public-contract", "call-flow", "tests", "github-check", "merge-conflict"]);
  expect(result.signals[0]).toMatchObject({ target: { kind: "finding", findingId: "p1" }, basis: "repository-evidence" });
  expect(result.signals.find((signal) => signal.kind === "public-contract")).toMatchObject({ target: { kind: "file", path: "src/api.ts", line: 1 }, basis: "bounded-heuristic" });
  expect(result.estimate.factors.map((factor) => factor.label)).toEqual(["Baseline", "Changed files", "Diff size", "P0/P1 findings", "Public contracts", "Call-flow breadth", "Test surface", "GitHub status"]);
  expect(result.estimate.minutes).toBe(result.estimate.factors.reduce((total, factor) => total + factor.minutes, 0));
});

test("stale markers are surfaced while dismissed findings stay quiet", () => {
  const result = buildNeedsAttention(comparison([file("src/api.ts", "const changed = true;")]), outline({
    phases: [{ id: "phase", title: "Phase", summary: "Summary", fileChanges: [{ path: "src/api.ts", summary: "API" }], steps: [{ id: "step", title: "Step", objective: "Objective", outdated: true, anchor: { path: "src/api.ts", side: "new", startLine: 1, endLine: 1 } }] }],
    findings: [
      { id: "dismissed", phaseId: "phase", path: "src/api.ts", side: "new", line: 1, lineContent: "const changed = true;", message: "Dismissed", category: "correctness", severity: "high", confidence: "high", evidence: "evidence", priority: "P1", introduced: true, recallGuard: false, blastRadiusSize: 1, tested: false, pinScope: "line", status: "dismissed" },
      { id: "outdated", phaseId: "phase", path: "src/api.ts", side: "new", line: 1, lineContent: "old", message: "Outdated", category: "correctness", severity: "high", confidence: "high", evidence: "evidence", priority: "P1", introduced: true, recallGuard: false, blastRadiusSize: 1, tested: false, pinScope: "line", status: "open", outdated: true },
    ],
  }));
  expect(result.signals.map((signal) => signal.kind)).toEqual(["finding", "tests", "stale-analysis", "stale-analysis"]);
  expect(result.signals.find((signal) => signal.kind === "stale-analysis")).toMatchObject({ target: { kind: "file", path: "src/api.ts" } });
});

test("does not manufacture attention for a quiet documentation-only comparison", () => {
  const result = buildNeedsAttention(comparison([file("README.md", "Updated documentation")]), outline());
  expect(result.signals).toEqual([]);
  expect(result.estimate.factors.map((factor) => factor.label)).toEqual(["Baseline", "Changed files", "Diff size"]);
});

test("prioritizes broad static reach only when a saved structural result also reports a test gap", () => {
  const result = buildNeedsAttention(comparison([file("src/api.ts", "export function api() {}")]), outline({
    structuralBlastRadii: [{
      id: "api-radius", symbol: { id: "src/api.ts:new:1:api", symbol: "api", kind: "function", location: { path: "src/api.ts", side: "new", line: 1 } },
      provider: "repository-search", confidence: "low", provenance: "partial", summary: "Static reach, not proof of runtime impact.",
      nodes: [{ id: "src/api.ts:new:1:api", symbol: "api", kind: "function", location: { path: "src/api.ts", side: "new", line: 1 } }],
      edges: [], directCallerIds: [], reportedDirectCallerCount: 8, reportedReachableNodeCount: 12, reportedImpactedFileCount: 1, impactedFiles: ["src/api.ts"],
      coverage: { state: "partial", reportedCounts: "exact", omissionReason: "The provider supplied totals without all source identities." },
      nearbyTestGaps: [{ kind: "no-nearby-tests", detail: "No nearby test references the changed API.", nearbyTestFiles: [] }],
    }],
  }));
  expect(result.signals.find((signal) => signal.kind === "structural-blast-radius")).toMatchObject({
    target: { kind: "structural-blast-radius", structuralBlastRadiusId: "api-radius" },
    basis: "bounded-heuristic",
  });
  expect(result.estimate.factors.map((factor) => factor.label)).toContain("Structural reach");
});

test("does not turn an unverified structural total into broad-reach attention", () => {
  const result = buildNeedsAttention(comparison([file("src/api.ts", "export function api() {}")]), outline({
    structuralBlastRadii: [{
      id: "legacy-api-radius", symbol: { id: "src/api.ts:new:1:api", symbol: "api", kind: "function", location: { path: "src/api.ts", side: "new", line: 1 } },
      provider: "repository-search", confidence: "low", provenance: "partial", summary: "Static reach only, not proof of runtime impact.",
      nodes: [{ id: "src/api.ts:new:1:api", symbol: "api", kind: "function", location: { path: "src/api.ts", side: "new", line: 1 } }],
      edges: [], directCallerIds: [], reportedDirectCallerCount: 8, reportedReachableNodeCount: 12, reportedImpactedFileCount: 1, impactedFiles: ["src/api.ts"],
      coverage: { state: "unknown", reportedCounts: "not-reported", omissionReason: "Reason not supplied by this saved result." },
      nearbyTestGaps: [{ kind: "no-nearby-tests", detail: "No nearby test references the changed API.", nearbyTestFiles: [] }],
    }],
  }));
  expect(result.signals.some((signal) => signal.kind === "structural-blast-radius")).toBe(false);
});

test("export options can omit analysis that is not present in the exported artifact", () => {
  const result = buildNeedsAttention(comparison([file("src/api.ts", "export function api() {}")]), outline({
    findings: [{ id: "p1", path: "src/api.ts", side: "new", line: 1, lineContent: "export function api() {}", message: "Risk", category: "correctness", severity: "high", confidence: "high", evidence: "Evidence", priority: "P1", introduced: true, recallGuard: false, blastRadiusSize: 1, tested: false, pinScope: "line", status: "open" }],
    callFlows: [{ id: "flow", title: "Flow", summary: "Summary", entrypointNodeId: "entry", provenance: "verified", nodes: [], edges: [], affectedFiles: ["src/api.ts", "a.ts", "b.ts", "c.ts"] }],
  }), undefined, { includeFindings: false, includeCallFlows: false });
  expect(result.signals.map((signal) => signal.kind)).toEqual(["public-contract", "tests"]);
});
