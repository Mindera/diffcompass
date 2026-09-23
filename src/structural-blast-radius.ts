import type { GitComparison, StructuralBlastCoverage, StructuralBlastEdge, StructuralBlastNode, StructuralBlastRadius, StructuralLocation } from "./types.ts";

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${field} must be a non-empty string no longer than ${max} characters.`);
  return value.trim();
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 10_000_000) throw new Error(`${field} must be an integer between 0 and 10000000.`);
  return Number(value);
}

function location(value: unknown, field: string, comparison: GitComparison, requireChangedFile = false): StructuralLocation {
  if (!record(value)) throw new Error(`${field} must be a source location.`);
  const unknown = Object.keys(value).find((key) => !["path", "side", "line"].includes(key));
  if (unknown) throw new Error(`${field} contains an unsupported field: ${unknown}`);
  const path = text(value.path, `${field}.path`, 4_096);
  if (!comparison.repositoryFiles.includes(path) && !comparison.files.some((file) => file.path === path || file.oldPath === path)) throw new Error(`${field}.path must reference a repository file.`);
  if (requireChangedFile && !comparison.files.some((file) => file.path === path || file.oldPath === path)) throw new Error(`${field}.path must reference a changed file.`);
  if (value.side !== "old" && value.side !== "new") throw new Error(`${field}.side must be old or new.`);
  const line = positiveInteger(value.line, `${field}.line`);
  if (line < 1) throw new Error(`${field}.line must be positive.`);
  return { path, side: value.side, line };
}

function sameLocation(left: StructuralLocation | undefined, right: StructuralLocation | undefined): boolean {
  return left?.path === right?.path && left?.side === right?.side && left?.line === right?.line;
}

function changedLocation(location: StructuralLocation, comparison: GitComparison): boolean {
  return comparison.files.some((file) => (file.path === location.path || file.oldPath === location.path) && file.hunks.some((hunk) =>
    hunk.rows.some((row) => (location.side === "old" ? row.oldLine : row.newLine) === location.line),
  ));
}

function node(value: unknown, field: string, comparison: GitComparison, root = false): StructuralBlastNode {
  if (!record(value)) throw new Error(`${field} must be an object.`);
  const unknown = Object.keys(value).find((key) => !["id", "symbol", "kind", "location"].includes(key));
  if (unknown) throw new Error(`${field} contains an unsupported field: ${unknown}`);
  const kind = String(value.kind);
  if (!["function", "method", "constructor", "component", "type", "module", "external"].includes(kind)) throw new Error(`${field}.kind is invalid.`);
  const source = value.location === undefined ? undefined : location(value.location, `${field}.location`, comparison, root);
  if (kind !== "external" && !source) throw new Error(`${field} needs a source location.`);
  if (root && !source) throw new Error("A changed structural symbol needs a source location.");
  if (root && source && !changedLocation(source, comparison)) throw new Error("A changed structural symbol must point to a row in the comparison.");
  return {
    id: text(value.id, `${field}.id`, 256),
    symbol: text(value.symbol, `${field}.symbol`, 2_000),
    kind: kind as StructuralBlastNode["kind"],
    ...(source ? { location: source } : {}),
  };
}

function edge(value: unknown, field: string, nodeIds: Set<string>): StructuralBlastEdge {
  if (!record(value)) throw new Error(`${field} must be an object.`);
  const unknown = Object.keys(value).find((key) => !["id", "from", "to", "relationship"].includes(key));
  if (unknown) throw new Error(`${field} contains an unsupported field: ${unknown}`);
  const from = text(value.from, `${field}.from`, 256);
  const to = text(value.to, `${field}.to`, 256);
  if (!nodeIds.has(from) || !nodeIds.has(to)) throw new Error(`${field} must connect declared structural nodes.`);
  if (from === to) throw new Error(`${field} cannot connect a structural node to itself.`);
  if (value.relationship !== "calls" && value.relationship !== "references") throw new Error(`${field}.relationship must be calls or references.`);
  return { id: text(value.id, `${field}.id`, 256), from, to, relationship: value.relationship };
}

function reachableToRoot(nodes: StructuralBlastNode[], edges: StructuralBlastEdge[], rootId: string): boolean {
  const parents = new Map<string, string[]>();
  for (const edge of edges) parents.set(edge.from, [...(parents.get(edge.from) ?? []), edge.to]);
  return nodes.every((candidate) => {
    if (candidate.id === rootId) return true;
    const seen = new Set<string>([candidate.id]);
    const pending = [candidate.id];
    while (pending.length) {
      const current = pending.pop()!;
      for (const next of parents.get(current) ?? []) {
        if (next === rootId) return true;
        if (!seen.has(next)) { seen.add(next); pending.push(next); }
      }
    }
    return false;
  });
}

function testGaps(value: unknown, comparison: GitComparison): StructuralBlastRadius["nearbyTestGaps"] {
  if (!Array.isArray(value) || value.length > 50) throw new Error("nearbyTestGaps must contain at most 50 entries.");
  return value.map((candidate, index) => {
    if (!record(candidate)) throw new Error(`nearbyTestGaps[${index}] must be an object.`);
    const unknown = Object.keys(candidate).find((key) => !["kind", "detail", "nearbyTestFiles"].includes(key));
    if (unknown) throw new Error(`nearbyTestGaps[${index}] contains an unsupported field: ${unknown}`);
    if (![
      "no-nearby-tests", "changed-symbol-not-covered", "impacted-path-not-covered", "coverage-unknown",
    ].includes(String(candidate.kind))) throw new Error(`nearbyTestGaps[${index}].kind is invalid.`);
    if (!Array.isArray(candidate.nearbyTestFiles) || candidate.nearbyTestFiles.length > 50 || candidate.nearbyTestFiles.some((path) => typeof path !== "string" || !comparison.repositoryFiles.includes(path)) || new Set(candidate.nearbyTestFiles).size !== candidate.nearbyTestFiles.length) {
      throw new Error(`nearbyTestGaps[${index}].nearbyTestFiles must be unique repository paths.`);
    }
    return {
      kind: candidate.kind as StructuralBlastRadius["nearbyTestGaps"][number]["kind"],
      detail: text(candidate.detail, `nearbyTestGaps[${index}].detail`, 8_000),
      nearbyTestFiles: candidate.nearbyTestFiles,
    };
  });
}

function testSource(value: unknown, field: string, comparison: GitComparison): NonNullable<StructuralBlastRadius["testEvidence"]>["checkedSources"][number] {
  if (!record(value)) throw new Error(`${field} must be an object.`);
  const unknown = Object.keys(value).find((key) => !["path", "side", "line", "detail"].includes(key));
  if (unknown) throw new Error(`${field} contains an unsupported field: ${unknown}`);
  return {
    ...location({ path: value.path, side: value.side, line: value.line }, field, comparison),
    detail: text(value.detail, `${field}.detail`, 4_000),
  };
}

function testSources(value: unknown, field: string, comparison: GitComparison): NonNullable<StructuralBlastRadius["testEvidence"]>["checkedSources"] {
  if (!Array.isArray(value) || value.length > 30) throw new Error(`${field} must contain at most 30 source anchors.`);
  const sources = value.map((candidate, index) => testSource(candidate, `${field}[${index}]`, comparison));
  const anchors = new Set<string>();
  if (sources.some((source) => anchors.has(`${source.path}:${source.side}:${source.line}`) || !anchors.add(`${source.path}:${source.side}:${source.line}`))) {
    throw new Error(`${field} must not repeat a source anchor.`);
  }
  return sources;
}

/** Undefined remains valid for saved sessions that predate structured test evidence. */
function testEvidence(value: unknown, comparison: GitComparison): StructuralBlastRadius["testEvidence"] | undefined {
  if (value === undefined) return undefined;
  if (!record(value)) throw new Error("testEvidence must be an object.");
  const unknown = Object.keys(value).find((key) => !["state", "searchScope", "checkedSources", "relevantTests", "remainingUncertainty"].includes(key));
  if (unknown) throw new Error(`testEvidence contains an unsupported field: ${unknown}`);
  const state = String(value.state);
  if (!(["not-assessed", "relevant-tests-found", "none-found", "limited"] as const).includes(state as NonNullable<StructuralBlastRadius["testEvidence"]>["state"])) throw new Error("testEvidence.state is invalid.");
  const searchScope = value.searchScope === undefined ? undefined : text(value.searchScope, "testEvidence.searchScope", 4_000);
  const checkedSources = testSources(value.checkedSources, "testEvidence.checkedSources", comparison);
  const relevantTests = testSources(value.relevantTests, "testEvidence.relevantTests", comparison);
  const remainingUncertainty = value.remainingUncertainty === undefined ? undefined : text(value.remainingUncertainty, "testEvidence.remainingUncertainty", 4_000);
  if (state === "not-assessed" && (searchScope || checkedSources.length || relevantTests.length || remainingUncertainty)) throw new Error("A not-assessed test result must not imply that test sources were checked.");
  if (state !== "not-assessed" && !searchScope) throw new Error("An assessed test result needs testEvidence.searchScope.");
  if (state === "relevant-tests-found" && !relevantTests.length) throw new Error("A relevant-tests-found result needs a relevant test source.");
  if (state === "none-found" && relevantTests.length) throw new Error("A none-found result cannot include relevant test sources.");
  if (state === "limited" && !remainingUncertainty) throw new Error("A limited test result needs remainingUncertainty.");
  return {
    state: state as NonNullable<StructuralBlastRadius["testEvidence"]>["state"],
    ...(searchScope ? { searchScope } : {}),
    checkedSources,
    relevantTests,
    ...(remainingUncertainty ? { remainingUncertainty } : {}),
  };
}

function coverage(value: unknown, provider: string): StructuralBlastCoverage {
  if (value === undefined) {
    return {
      state: provider === "unavailable" ? "unavailable" : "unknown",
      reportedCounts: "not-reported",
      omissionReason: "Reason not supplied by this saved result.",
    };
  }
  if (!record(value)) throw new Error("coverage must be an object.");
  const unknown = Object.keys(value).find((key) => !["state", "reportedCounts", "omissionReason"].includes(key));
  if (unknown) throw new Error(`coverage contains an unsupported field: ${unknown}`);
  const state = String(value.state);
  const reportedCounts = String(value.reportedCounts);
  if (!(["complete", "partial", "unavailable", "unknown"] as const).includes(state as StructuralBlastCoverage["state"])) throw new Error("coverage.state is invalid.");
  if (!(["exact", "lower-bound", "not-reported"] as const).includes(reportedCounts as StructuralBlastCoverage["reportedCounts"])) throw new Error("coverage.reportedCounts is invalid.");
  const omissionReason = value.omissionReason === undefined ? undefined : text(value.omissionReason, "coverage.omissionReason", 4_000);
  if (state === "partial" && !omissionReason) throw new Error("A partial structural result needs coverage.omissionReason.");
  if (state === "complete" && reportedCounts !== "exact") throw new Error("A complete structural result needs exact reported counts.");
  if (state === "unavailable" && reportedCounts !== "not-reported") throw new Error("An unavailable structural result cannot report total counts.");
  if (state === "unknown" && !omissionReason) throw new Error("An unknown structural result needs coverage.omissionReason.");
  if (provider === "unavailable" && state !== "unavailable") throw new Error("An unavailable structural provider needs unavailable coverage.");
  if (provider !== "unavailable" && state === "unavailable") throw new Error("Only an unavailable structural provider may have unavailable coverage.");
  return { state: state as StructuralBlastCoverage["state"], reportedCounts: reportedCounts as StructuralBlastCoverage["reportedCounts"], ...(omissionReason ? { omissionReason } : {}) };
}

export function validateStructuralBlastRadius(value: unknown, comparison: GitComparison): StructuralBlastRadius {
  if (!record(value)) throw new Error("Structural blast radius must be an object.");
  const unknown = Object.keys(value).find((key) => ![
    "id", "symbol", "provider", "confidence", "provenance", "summary", "nodes", "edges", "directCallerIds",
    "reportedDirectCallerCount", "reportedReachableNodeCount", "reportedImpactedFileCount", "coverage", "impactedFiles", "testEvidence", "nearbyTestGaps",
  ].includes(key));
  if (unknown) throw new Error(`Structural blast radius contains an unsupported field: ${unknown}`);
  const provider = String(value.provider);
  if (!["codegraph", "language-server", "repository-search", "unavailable"].includes(provider)) throw new Error("Structural provider is invalid.");
  const confidence = String(value.confidence);
  if (!["high", "medium", "low", "unresolved"].includes(confidence)) throw new Error("Structural confidence is invalid.");
  const provenance = String(value.provenance);
  if (!["verified", "partial", "unverified"].includes(provenance)) throw new Error("Structural provenance is invalid.");
  if ((provider === "unavailable") !== (confidence === "unresolved")) throw new Error("Only an unavailable structural provider may be unresolved.");
  if (provider === "unavailable" && provenance !== "unverified") throw new Error("An unavailable structural provider must be unverified.");
  const resultCoverage = coverage(value.coverage, provider);
  const symbol = node(value.symbol, "symbol", comparison, true);
  if (!Array.isArray(value.nodes) || value.nodes.length < 1 || value.nodes.length > 80) throw new Error("Structural blast radius must contain between 1 and 80 visible nodes.");
  const nodes = value.nodes.map((candidate, index) => node(candidate, `nodes[${index}]`, comparison));
  const nodeIds = new Set(nodes.map((candidate) => candidate.id));
  if (nodeIds.size !== nodes.length) throw new Error("Structural node ids must be unique within a subgraph.");
  const root = nodes.find((candidate) => candidate.id === symbol.id);
  if (!root || root.symbol !== symbol.symbol || root.kind !== symbol.kind || !sameLocation(root.location, symbol.location)) throw new Error("Structural nodes must contain the exact changed symbol identity.");
  if (!Array.isArray(value.edges) || value.edges.length > 160) throw new Error("Structural blast radius must contain at most 160 visible edges.");
  const edges = value.edges.map((candidate, index) => edge(candidate, `edges[${index}]`, nodeIds));
  if (new Set(edges.map((candidate) => candidate.id)).size !== edges.length) throw new Error("Structural edge ids must be unique.");
  if (!reachableToRoot(nodes, edges, symbol.id)) throw new Error("Every visible structural node must reach the changed symbol.");
  if (!Array.isArray(value.directCallerIds) || value.directCallerIds.length > 80 || value.directCallerIds.some((id) => typeof id !== "string") || new Set(value.directCallerIds).size !== value.directCallerIds.length) throw new Error("directCallerIds must be unique structural node ids.");
  const directCallerIds = value.directCallerIds as string[];
  const actualDirectCallers = new Set(edges.filter((candidate) => candidate.to === symbol.id).map((candidate) => candidate.from));
  if (directCallerIds.some((id) => id === symbol.id || !nodeIds.has(id)) || directCallerIds.length !== actualDirectCallers.size || directCallerIds.some((id) => !actualDirectCallers.has(id))) {
    throw new Error("directCallerIds must exactly identify visible edges into the changed symbol.");
  }
  const reportedDirectCallerCount = positiveInteger(value.reportedDirectCallerCount, "reportedDirectCallerCount");
  const reportedReachableNodeCount = positiveInteger(value.reportedReachableNodeCount, "reportedReachableNodeCount");
  if (reportedDirectCallerCount < directCallerIds.length || reportedReachableNodeCount < nodes.length - 1) throw new Error("Reported structural counts cannot be smaller than the visible subgraph.");
  if (!Array.isArray(value.impactedFiles) || value.impactedFiles.length > 200 || value.impactedFiles.some((path) => typeof path !== "string" || !comparison.repositoryFiles.includes(path)) || new Set(value.impactedFiles).size !== value.impactedFiles.length) {
    throw new Error("impactedFiles must contain unique repository paths.");
  }
  const impactedFiles = value.impactedFiles as string[];
  const visiblePaths = new Set(nodes.flatMap((candidate) => candidate.location ? [candidate.location.path] : []));
  if ([...visiblePaths].some((path) => !impactedFiles.includes(path))) throw new Error("impactedFiles must include every visible structural source path.");
  const reportedImpactedFileCount = positiveInteger(value.reportedImpactedFileCount, "reportedImpactedFileCount");
  if (reportedImpactedFileCount < impactedFiles.length) throw new Error("reportedImpactedFileCount cannot be smaller than impactedFiles.");
  if (resultCoverage.state === "complete" && (
    reportedDirectCallerCount !== directCallerIds.length ||
    reportedReachableNodeCount !== nodes.length - 1 ||
    reportedImpactedFileCount !== impactedFiles.length
  )) throw new Error("A complete structural result must report exactly the saved graph and impacted files.");
  if (provider === "unavailable" && (nodes.length !== 1 || edges.length !== 0 || directCallerIds.length !== 0 || reportedDirectCallerCount !== 0 || reportedReachableNodeCount !== 0)) {
    throw new Error("An unavailable provider must preserve only the changed symbol and no discovered reach.");
  }
  const nearbyTestEvidence = testEvidence(value.testEvidence, comparison);
  return {
    id: text(value.id, "Structural blast radius id", 256),
    symbol,
    provider: provider as StructuralBlastRadius["provider"],
    confidence: confidence as StructuralBlastRadius["confidence"],
    provenance: provenance as StructuralBlastRadius["provenance"],
    summary: text(value.summary, "Structural blast radius summary", 12_000),
    nodes,
    edges,
    directCallerIds,
    reportedDirectCallerCount,
    reportedReachableNodeCount,
    reportedImpactedFileCount,
    coverage: resultCoverage,
    impactedFiles,
    ...(nearbyTestEvidence ? { testEvidence: nearbyTestEvidence } : {}),
    nearbyTestGaps: testGaps(value.nearbyTestGaps, comparison),
  };
}

export function validateStructuralBlastRadii(value: unknown, comparison: GitComparison): StructuralBlastRadius[] {
  if (!Array.isArray(value) || value.length > 500) throw new Error("Structural blast radii must contain at most 500 changed symbols.");
  const radii = value.map((candidate) => validateStructuralBlastRadius(candidate, comparison));
  if (new Set(radii.map((radius) => radius.id)).size !== radii.length) throw new Error("Structural blast radius ids must be unique.");
  if (new Set(radii.map((radius) => radius.symbol.id)).size !== radii.length) throw new Error("Changed structural roots must be unique.");
  const sourceNodes = new Map<string, StructuralBlastNode>();
  for (const radius of radii) {
    for (const candidate of radius.nodes) {
      const prior = sourceNodes.get(candidate.id);
      if (prior && (prior.symbol !== candidate.symbol || prior.kind !== candidate.kind || !sameLocation(prior.location, candidate.location))) {
        throw new Error("The same structural source identity must resolve to the same symbol and location in every subgraph.");
      }
      sourceNodes.set(candidate.id, candidate);
    }
  }
  return radii;
}

export interface StructuralFindingInput {
  path: string;
  side: "old" | "new";
  line: number;
  pinScope: "line" | "symbol" | "file";
  pinnedSymbolIds?: string[];
}

/** Use provider totals only when the saved result identifies them as exact. */
export function structuralReachCountForPriority(radius: StructuralBlastRadius): number {
  return radius.coverage?.reportedCounts === "exact"
    ? radius.reportedReachableNodeCount
    : Math.max(0, radius.nodes.length - 1);
}

/**
 * Prefer explicit pins supplied by a structural provider. When none are available,
 * use the closest changed declaration in the same file/side, then file scope. This
 * mirrors the conservative nearest-declaration rule used by mobile-code-review.
 */
export function structuralPinsForFinding(finding: StructuralFindingInput, radii: StructuralBlastRadius[]): { ids: string[]; reportedReachableNodeCount: number } {
  const radiiByNode = new Map<string, StructuralBlastRadius[]>();
  for (const radius of radii) for (const node of radius.nodes) radiiByNode.set(node.id, [...(radiiByNode.get(node.id) ?? []), radius]);
  const explicit = finding.pinnedSymbolIds?.filter((id, index, all) => all.indexOf(id) === index && radiiByNode.has(id)) ?? [];
  if (explicit.length) {
    const selected = explicit.flatMap((id) => {
      const candidates = radiiByNode.get(id) ?? [];
      const matchingRoot = candidates.filter((radius) => radius.symbol.id === id);
      return matchingRoot.length === 1 ? matchingRoot : candidates.length === 1 ? candidates : [];
    });
    return { ids: explicit, reportedReachableNodeCount: selected.length ? Math.max(...selected.map(structuralReachCountForPriority)) : 0 };
  }
  const sameSource = radii.filter((radius) => radius.symbol.location?.path === finding.path && radius.symbol.location?.side === finding.side);
  const preceding = sameSource.filter((radius) => (radius.symbol.location?.line ?? Number.POSITIVE_INFINITY) <= finding.line)
    .sort((left, right) => (right.symbol.location?.line ?? 0) - (left.symbol.location?.line ?? 0));
  const selected = finding.pinScope === "file" ? sameSource : preceding.slice(0, 1);
  return {
    ids: selected.map((radius) => radius.symbol.id),
    reportedReachableNodeCount: selected.length ? Math.max(...selected.map(structuralReachCountForPriority)) : 0,
  };
}
