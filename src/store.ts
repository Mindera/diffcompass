import { validDomainModels, validDomainDetails } from "./domain-context.ts";
import { validateMapNodeRoles } from "./map-node-roles.ts";

function validNodeRoles(value: unknown): boolean { try { validateMapNodeRoles(value); return true; } catch { return false; } }
import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { isBriefingSectionOrder, type PersistedReviewSession, type SourceCheckpoint } from "./types.ts";
import { normalizeSequenceDiagram } from "./flows.ts";
import { validateSequenceSources } from "./sequence-sources.ts";

function validSequenceSources(flow: Record<string, unknown>): boolean {
  try { validateSequenceSources(flow.messageSources, String(flow.mermaid)); return true; } catch { return false; }
}
import { normalizeReviewArchitectureMermaid, validateReviewArchitecture } from "./architecture.ts";
import { normalizeReviewAdaptiveDiagram, validateReviewAdaptiveDiagram } from "./adaptive-diagrams.ts";

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown, max = 500_000): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function boundedString(value: unknown, max = 500_000): value is string {
  return typeof value === "string" && value.length <= max;
}

function validJson(value: unknown, depth = 0): boolean {
  if (depth > 8 || value === null || typeof value === "boolean") return depth <= 8;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.length <= 16_000;
  if (Array.isArray(value)) return value.length <= 100 && value.every((item) => validJson(item, depth + 1));
  return record(value) && Object.keys(value).length <= 100 && Object.keys(value).every((key) => key.length > 0 && key.length <= 256 && validJson(value[key], depth + 1));
}

function validDryRunScenario(value: unknown): boolean {
  return record(value) && nonEmptyString(value.id, 128) && nonEmptyString(value.title, 500) && nonEmptyString(value.reason, 2_000) &&
    ["test", "example", "invented", "reviewer"].includes(String(value.source)) &&
    (value.description === undefined || nonEmptyString(value.description, 4_000)) &&
    record(value.inputs) && record(value.mocks) && validJson(value.inputs) && validJson(value.mocks) &&
    Array.isArray(value.assumptions) && value.assumptions.length <= 20 && value.assumptions.every((item) => nonEmptyString(item, 2_000)) && new Set(value.assumptions).size === value.assumptions.length &&
    (value.updatedAt === undefined || nonEmptyString(value.updatedAt, 64));
}

function validDryRunTrace(value: unknown): boolean {
  if (!record(value) || !nonEmptyString(value.id, 128) || !record(value.comparison) || !nonEmptyString(value.comparison.base, 4_096) ||
    !nonEmptyString(value.comparison.mergeBase, 4_096) || !nonEmptyString(value.comparison.head, 4_096) || !/^[0-9a-f]{64}$/.test(String(value.comparison.fingerprint)) ||
    !nonEmptyString(value.flowId, 128) || value.flowKind !== "behavior" || !/^[0-9a-f]{64}$/.test(String(value.flowFingerprint)) ||
    (value.detail !== undefined && value.detail !== "compact" && value.detail !== "detailed") ||
    !validDryRunScenario(value.scenario) || !Array.isArray(value.assumptions) || value.assumptions.length > 20 || !value.assumptions.every((item) => nonEmptyString(item, 2_000)) ||
    !Array.isArray(value.steps) || value.steps.length === 0 || value.steps.length > (value.detail === "compact" ? 8 : value.detail === "detailed" ? 24 : 80) || !record(value.outcome) || !nonEmptyString(value.outcome.summary, 8_000) ||
    (value.outcome.value !== undefined && !validJson(value.outcome.value)) || !nonEmptyString(value.preparedAt, 64) || (value.stale !== undefined && typeof value.stale !== "boolean")) return false;
  const ids = new Set<string>();
  return value.steps.every((step, index) => record(step) && nonEmptyString(step.id, 128) && !ids.has(step.id) && Boolean(ids.add(step.id)) &&
    Number(step.order) === index + 1 && ["entry", "calculation", "branch", "call", "mock", "return", "unresolved"].includes(String(step.kind)) &&
    nonEmptyString(step.title, 500) && nonEmptyString(step.explanation, 8_000) && nonEmptyString(step.function, 500) && record(step.source) &&
    nonEmptyString(step.source.path, 4_096) && step.source.side === "new" && Number.isInteger(step.source.startLine) && Number(step.source.startLine) > 0 &&
    Number.isInteger(step.source.endLine) && Number(step.source.endLine) >= Number(step.source.startLine) && Number(step.source.endLine) - Number(step.source.startLine) <= 100 && typeof step.source.changed === "boolean" &&
    (step.arguments === undefined || (record(step.arguments) && validJson(step.arguments))) && (step.locals === undefined || (record(step.locals) && validJson(step.locals))) &&
    Array.isArray(step.valueChanges) && step.valueChanges.length <= 30 && step.valueChanges.every((change) => record(change) && nonEmptyString(change.name, 256) &&
      (change.before === undefined || validJson(change.before)) && (change.after === undefined || validJson(change.after)) && (change.note === undefined || nonEmptyString(change.note, 1_000)) &&
      (change.before !== undefined || change.after !== undefined || change.note !== undefined)) &&
    (step.assumption === undefined || nonEmptyString(step.assumption, 2_000)) &&
    (step.mapLink === undefined || (record(step.mapLink) && nonEmptyString(step.mapLink.callFlowId, 128) &&
      (step.mapLink.nodeId === undefined || nonEmptyString(step.mapLink.nodeId, 128)) && (step.mapLink.edgeId === undefined || nonEmptyString(step.mapLink.edgeId, 128)))));
}

function validArchifyJson(value: unknown, depth = 0): boolean {
  if (depth > 32 || value === null || typeof value === "boolean") return depth <= 32;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.length <= 100_000;
  if (Array.isArray(value)) return value.length <= 2_000 && value.every((item) => validArchifyJson(item, depth + 1));
  if (!record(value) || Object.keys(value).length > 2_000) return false;
  return Object.entries(value).every(([key, item]) => key.length <= 256 && validArchifyJson(item, depth + 1));
}

function validArchifyComparisonView(value: unknown): boolean {
  return record(value) && validArchifyJson(value.ir) && nonEmptyString(value.html, 5 * 1024 * 1024) && nonEmptyString(value.validationReceipt, 32_000);
}

function validArchifyArtifacts(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > 12) return false;
  const ids = new Set<string>();
  return value.every((artifact) => record(artifact) && nonEmptyString(artifact.id, 128) && !ids.has(artifact.id) && Boolean(ids.add(artifact.id)) &&
    ["architecture", "workflow", "sequence", "dataflow", "lifecycle"].includes(String(artifact.type)) && nonEmptyString(artifact.title, 8_000) &&
    validArchifyJson(artifact.ir) && validNodeRoles(artifact.nodeRoles) && validDomainDetails(artifact.domainDetails) && (artifact.purpose === undefined || artifact.purpose === "domain-model") && (artifact.baselineIr === undefined || validArchifyJson(artifact.baselineIr)) &&
    (artifact.comparison === undefined || (record(artifact.comparison) && Object.keys(artifact.comparison).every((key) => key === "before" || key === "delta") &&
      (artifact.comparison.before === undefined || validArchifyComparisonView(artifact.comparison.before)) &&
      (artifact.comparison.delta === undefined || validArchifyComparisonView(artifact.comparison.delta)))) &&
    nonEmptyString(artifact.html, 5 * 1024 * 1024) && Array.isArray(artifact.evidence) && artifact.evidence.length <= 8 && artifact.evidence.every((item) => nonEmptyString(item, 2_000)) &&
    Array.isArray(artifact.affectedFiles) && artifact.affectedFiles.length <= 100 && artifact.affectedFiles.every((item) => nonEmptyString(item, 4_096)) && new Set(artifact.affectedFiles).size === artifact.affectedFiles.length &&
    ["single", "before-after", "before-delta-after"].includes(String(artifact.view)) && nonEmptyString(artifact.validationReceipt, 32_000) && nonEmptyString(artifact.renderedAt, 64));
}

function validArchifyFailures(value: unknown): boolean {
  if (value === undefined) return true;
  return Array.isArray(value) && value.length <= 12 && value.every((failure) => record(failure) && nonEmptyString(failure.id, 128) &&
    ["architecture", "workflow", "sequence", "dataflow", "lifecycle"].includes(String(failure.type)) && nonEmptyString(failure.message, 8_000) && typeof failure.preservedLastValid === "boolean");
}

function validScreenshot(value: unknown): boolean {
  return record(value) && nonEmptyString(value.id, 128) && nonEmptyString(value.name, 512) &&
    ["image/png", "image/jpeg", "image/gif", "image/webp", "video/mp4"].includes(String(value.mimeType)) &&
    Number.isInteger(value.size) && Number(value.size) > 0 && Number(value.size) <= (value.mimeType === "video/mp4" ? 100 : 15) * 1024 * 1024 &&
    typeof value.fileName === "string" && /^[0-9a-f-]{36}\.(?:png|jpg|gif|webp|mp4)$/.test(value.fileName);
}

function validAnchor(value: unknown): boolean {
  if (!record(value)) return false;
  return nonEmptyString(value.path, 4_096) && ["old", "new"].includes(String(value.side)) &&
    Number.isInteger(value.startLine) && Number(value.startLine) > 0 &&
    Number.isInteger(value.endLine) && Number(value.endLine) >= Number(value.startLine);
}

function validOutline(value: unknown): boolean {
  if (!record(value) || !nonEmptyString(value.title, 8_000) || !nonEmptyString(value.summary, 50_000)) return false;
  if (value.planningNotes !== undefined && (!Array.isArray(value.planningNotes) || value.planningNotes.length > 20 || !value.planningNotes.every((note) => nonEmptyString(note, 2_000)))) return false;
  if (!Array.isArray(value.phases) || !Array.isArray(value.callFlows) || !Array.isArray(value.flows) || !Array.isArray(value.findings)) return false;
  if (value.phases.length === 0 || value.phases.length > 50 || value.callFlows.length > 8 || value.flows.length > 50 || value.findings.length > 2_000) return false;
  const phases = value.phases;
  const phaseIds = new Set<string>();
  const stepIds = new Set<string>();
  const filePathsByPhase = new Map<string, Set<string>>();
  const stepsByPhase = new Map<string, Map<string, Record<string, unknown>>>();
  let stepCount = 0;
  for (const phase of phases) {
    if (!record(phase) || !nonEmptyString(phase.id, 128) || phaseIds.has(phase.id) || !nonEmptyString(phase.title, 8_000) ||
      !nonEmptyString(phase.summary, 50_000) || !Array.isArray(phase.fileChanges) || phase.fileChanges.length === 0 || phase.fileChanges.length > 10_000 ||
      !Array.isArray(phase.steps) || phase.steps.length === 0 || phase.steps.length > 100) return false;
    phaseIds.add(phase.id);
    const filePaths = new Set<string>();
    if (!phase.fileChanges.every((file) => record(file) && nonEmptyString(file.path, 4_096) && !filePaths.has(file.path) &&
      Boolean(filePaths.add(file.path)) && nonEmptyString(file.summary, 50_000))) return false;
    filePathsByPhase.set(phase.id, filePaths);
    const phaseSteps = new Map<string, Record<string, unknown>>();
    for (const step of phase.steps) {
      if (!record(step) || !nonEmptyString(step.id, 128) || stepIds.has(step.id) || !nonEmptyString(step.title, 8_000) ||
        !nonEmptyString(step.objective, 50_000) || !validAnchor(step.anchor) || !filePaths.has(String((step.anchor as Record<string, unknown>).path)) ||
        (step.explanation !== undefined && !nonEmptyString(step.explanation, 500_000)) ||
        (step.outdated !== undefined && typeof step.outdated !== "boolean")) return false;
      stepIds.add(step.id);
      phaseSteps.set(step.id, step);
      stepCount += 1;
    }
    stepsByPhase.set(phase.id, phaseSteps);
  }
  if (stepCount > 100) return false;
  if (value.architecture !== undefined) {
    try { validateReviewArchitecture(value.architecture); } catch { return false; }
  }
  if (value.behaviorArchitecture !== undefined) {
    if (!["implemented", "proposed"].includes(String(value.behaviorArchitectureStatus))) return false;
    try { validateReviewArchitecture(value.behaviorArchitecture); } catch { return false; }
  } else if (value.behaviorArchitectureStatus !== undefined) return false;
  if (value.issueAssessment !== undefined && !validIssueAssessment(value.issueAssessment)) return false;
  for (const field of ["stateDiagram", "dataModel"] as const) {
    if (value[field] !== undefined) {
      try { validateReviewAdaptiveDiagram(value[field]); } catch { return false; }
    }
  }
  if (!validDomainModels(value.domainModels) || !validArchifyArtifacts(value.archifyArtifacts) || !validArchifyFailures(value.archifyFailures)) return false;
  const callFlowIds = new Set<string>();
  const validCallFlows = value.callFlows.every((flow) => {
    if (!record(flow) || !nonEmptyString(flow.id, 128) || callFlowIds.has(flow.id) ||
      !nonEmptyString(flow.title, 8_000) || !nonEmptyString(flow.summary, 50_000) || !nonEmptyString(flow.entrypointNodeId, 128) ||
      !["verified", "partial", "unverified"].includes(String(flow.provenance)) || !Array.isArray(flow.nodes) || flow.nodes.length < 2 || flow.nodes.length > 80 ||
      !Array.isArray(flow.edges) || flow.edges.length < 1 || flow.edges.length > 160 || !Array.isArray(flow.affectedFiles) || flow.affectedFiles.length > 100) return false;
    callFlowIds.add(flow.id);
    const nodeIds = new Set<string>();
    if (!flow.nodes.every((node) => record(node) && nonEmptyString(node.id, 128) && !nodeIds.has(node.id) && Boolean(nodeIds.add(node.id)) &&
      nonEmptyString(node.label, 1_000) && ["function", "method", "constructor", "component", "branch", "external"].includes(String(node.kind)) &&
      ["added", "removed", "unchanged", "modified"].includes(String(node.change)) &&
      (node.oldLocation === undefined || validCallLocation(node.oldLocation, "old")) && (node.newLocation === undefined || validCallLocation(node.newLocation, "new")))) return false;
    const edgeIds = new Set<string>();
    return nodeIds.has(flow.entrypointNodeId) && flow.edges.every((edge) => record(edge) && nonEmptyString(edge.id, 128) && !edgeIds.has(edge.id) && Boolean(edgeIds.add(edge.id)) &&
      nonEmptyString(edge.from, 128) && nodeIds.has(edge.from) && nonEmptyString(edge.to, 128) && nodeIds.has(edge.to) &&
      (edge.label === undefined || nonEmptyString(edge.label, 1_000)) && ["added", "removed", "unchanged"].includes(String(edge.change)) &&
      (edge.oldCallSite === undefined || validCallLocation(edge.oldCallSite, "old")) && (edge.newCallSite === undefined || validCallLocation(edge.newCallSite, "new"))) &&
      flow.affectedFiles.every((path) => nonEmptyString(path, 4_096)) && new Set(flow.affectedFiles).size === flow.affectedFiles.length;
  });
  if (!validCallFlows) return false;
  const flowIds = new Set<string>();
  const validFlows = value.flows.every((flow) => record(flow) && nonEmptyString(flow.id, 128) && !flowIds.has(flow.id) && Boolean(flowIds.add(flow.id)) && nonEmptyString(flow.title, 8_000) &&
      nonEmptyString(flow.summary, 50_000) && nonEmptyString(flow.mermaid, 12_000) && validNodeRoles(flow.nodeRoles) &&
      ["verified", "partial", "unverified"].includes(String(flow.provenance)) &&
      Array.isArray(flow.affectedFiles) && flow.affectedFiles.length <= 100 && flow.affectedFiles.every((path) => nonEmptyString(path, 4_096)) && new Set(flow.affectedFiles).size === flow.affectedFiles.length &&
      Number.isInteger(flow.blastRadiusSize) && Number(flow.blastRadiusSize) >= 0);
  if (!validFlows || !value.flows.every((flow) => record(flow) && validSequenceSources(flow))) return false;
  if (value.dryRunPlans !== undefined) {
    if (!Array.isArray(value.dryRunPlans) || value.dryRunPlans.length > 16) return false;
    const identities = new Set<string>();
    const validPlans = value.dryRunPlans.every((plan) => {
      if (!record(plan) || !nonEmptyString(plan.flowId, 128) || plan.flowKind !== "behavior" || !nonEmptyString(plan.title, 500) || !nonEmptyString(plan.summary, 4_000) ||
        !record(plan.source) || !Array.isArray(plan.source.anchors) || plan.source.anchors.length === 0 || plan.source.anchors.length > 20 || !Array.isArray(plan.scenarios) || plan.scenarios.length > 8) return false;
      const key = `${plan.flowKind}:${plan.flowId}`;
      if (identities.has(key)) return false;
      identities.add(key);
      if (!plan.source.anchors.every((anchor) => record(anchor) && nonEmptyString(anchor.path, 4_096) && anchor.side === "new" && Number.isInteger(anchor.startLine) && Number(anchor.startLine) > 0 && Number.isInteger(anchor.endLine) && Number(anchor.endLine) >= Number(anchor.startLine) && Number(anchor.endLine) - Number(anchor.startLine) <= 100 && typeof anchor.changed === "boolean")) return false;
      if (plan.callFlowId !== undefined && (!nonEmptyString(plan.callFlowId, 128) || !callFlowIds.has(plan.callFlowId))) return false;
      if (plan.sequenceFlowId !== undefined && (!nonEmptyString(plan.sequenceFlowId, 128) || !flowIds.has(plan.sequenceFlowId))) return false;
      const scenarioIds = new Set<string>();
      return plan.scenarios.every((scenario) => validDryRunScenario(scenario) && !scenarioIds.has((scenario as Record<string, unknown>).id as string) && Boolean(scenarioIds.add((scenario as Record<string, unknown>).id as string)));
    });
    if (!validPlans) return false;
  }
  if (value.structuralBlastRadii !== undefined && !validStructuralBlastRadii(value.structuralBlastRadii)) return false;
  if (value.structuralAnalysisWarnings !== undefined && (!Array.isArray(value.structuralAnalysisWarnings) || value.structuralAnalysisWarnings.length > 501 || value.structuralAnalysisWarnings.some((warning) => !nonEmptyString(warning, 2_000)))) return false;
  if (value.structuralAnalysisOmissionReason !== undefined && !nonEmptyString(value.structuralAnalysisOmissionReason, 2_000)) return false;
  const structuralNodeIds = new Set(
    Array.isArray(value.structuralBlastRadii)
      ? value.structuralBlastRadii.flatMap((radius) => record(radius) && Array.isArray(radius.nodes)
        ? radius.nodes.flatMap((node) => record(node) && typeof node.id === "string" ? [node.id] : [])
        : [])
      : [],
  );
  const findingIds = new Set<string>();
  return value.findings.every((finding) => record(finding) && nonEmptyString(finding.id, 128) && !findingIds.has(finding.id) && Boolean(findingIds.add(finding.id)) &&
      (finding.phaseId === undefined || (nonEmptyString(finding.phaseId, 128) && phaseIds.has(finding.phaseId))) &&
      (finding.phaseId === undefined || filePathsByPhase.get(String(finding.phaseId))?.has(String(finding.path))) &&
      (finding.stepId === undefined || (() => {
        if (!nonEmptyString(finding.stepId, 128) || finding.phaseId === undefined) return false;
        const step = stepsByPhase.get(String(finding.phaseId))?.get(finding.stepId);
        const anchor = step?.anchor;
        return record(anchor) && anchor.path === finding.path && anchor.side === finding.side &&
          Number(finding.line) >= Number(anchor.startLine) && Number(finding.line) <= Number(anchor.endLine);
      })()) &&
      nonEmptyString(finding.path, 4_096) && ["old", "new"].includes(String(finding.side)) &&
      Number.isInteger(finding.line) && Number(finding.line) > 0 && boundedString(finding.lineContent) && nonEmptyString(finding.message, 50_000) &&
      nonEmptyString(finding.category, 128) && ["critical", "high", "medium", "low"].includes(String(finding.severity)) &&
      ["high", "medium", "low"].includes(String(finding.confidence)) && nonEmptyString(finding.evidence, 100_000) &&
      ["P0", "P1", "P2", "P3"].includes(String(finding.priority)) &&
      (finding.introduced === null || typeof finding.introduced === "boolean") && typeof finding.recallGuard === "boolean" &&
      Number.isInteger(finding.blastRadiusSize) && Number(finding.blastRadiusSize) >= 0 &&
      typeof finding.tested === "boolean" && ["line", "symbol", "file"].includes(String(finding.pinScope)) &&
      (finding.pinnedSymbolIds === undefined || (Array.isArray(finding.pinnedSymbolIds) && finding.pinnedSymbolIds.length <= 80 && finding.pinnedSymbolIds.every((id) => nonEmptyString(id, 256) && structuralNodeIds.has(id)) && new Set(finding.pinnedSymbolIds).size === finding.pinnedSymbolIds.length)) &&
      ["open", "dismissed", "accepted", "false-positive", "intentional", "deferred", "fixed", "obsolete-after-refresh", "converted-to-feedback"].includes(String(finding.status)) &&
      (finding.disposition === undefined || ["accepted", "false-positive", "intentional", "deferred", "fixed", "obsolete-after-refresh"].includes(String(finding.disposition))) &&
      (finding.disposition === undefined || finding.status === finding.disposition) &&
      (finding.reviewerNote === undefined || nonEmptyString(finding.reviewerNote, 8_000)) &&
      (finding.commentId === undefined || nonEmptyString(finding.commentId, 128)) &&
      (finding.outdated === undefined || typeof finding.outdated === "boolean"));
}

function validStructuralLocation(value: unknown): boolean {
  return record(value) && nonEmptyString(value.path, 4_096) && ["old", "new"].includes(String(value.side)) && Number.isInteger(value.line) && Number(value.line) > 0;
}

function validStructuralNode(value: unknown, root = false): boolean {
  if (!record(value) || !nonEmptyString(value.id, 256) || !nonEmptyString(value.symbol, 2_000) ||
    !["function", "method", "constructor", "component", "type", "module", "external"].includes(String(value.kind)) ||
    (value.location !== undefined && !validStructuralLocation(value.location))) return false;
  return (!root || value.location !== undefined) && (value.kind === "external" || value.location !== undefined);
}

function validStructuralTestSource(value: unknown): boolean {
  return record(value) && nonEmptyString(value.path, 4_096) && ["old", "new"].includes(String(value.side)) &&
    Number.isInteger(value.line) && Number(value.line) > 0 && nonEmptyString(value.detail, 4_000);
}

function validStructuralTestEvidence(value: unknown): boolean {
  if (!record(value) || !["not-assessed", "relevant-tests-found", "none-found", "limited"].includes(String(value.state)) ||
    (value.searchScope !== undefined && !nonEmptyString(value.searchScope, 4_000)) ||
    !Array.isArray(value.checkedSources) || value.checkedSources.length > 30 || !value.checkedSources.every(validStructuralTestSource) ||
    !Array.isArray(value.relevantTests) || value.relevantTests.length > 30 || !value.relevantTests.every(validStructuralTestSource) ||
    (value.remainingUncertainty !== undefined && !nonEmptyString(value.remainingUncertainty, 4_000))) return false;
  const anchors = (sources: unknown[]) => new Set(sources.map((source) => record(source) ? `${source.path}:${source.side}:${source.line}` : "")).size === sources.length;
  if (!anchors(value.checkedSources) || !anchors(value.relevantTests)) return false;
  if (value.state === "not-assessed") return value.searchScope === undefined && value.checkedSources.length === 0 && value.relevantTests.length === 0 && value.remainingUncertainty === undefined;
  if (!nonEmptyString(value.searchScope, 4_000)) return false;
  if (value.state === "relevant-tests-found" && value.relevantTests.length === 0) return false;
  if (value.state === "none-found" && value.relevantTests.length > 0) return false;
  return value.state !== "limited" || nonEmptyString(value.remainingUncertainty, 4_000);
}

function structuralNodesReachRoot(nodeIds: Set<string>, edges: unknown[], rootId: string): boolean {
  const targets = new Map<string, string[]>();
  for (const edge of edges) {
    if (!record(edge)) continue;
    const from = String(edge.from);
    const to = String(edge.to);
    targets.set(from, [...(targets.get(from) ?? []), to]);
  }
  return [...nodeIds].every((nodeId) => {
    if (nodeId === rootId) return true;
    const seen = new Set([nodeId]);
    const pending = [nodeId];
    while (pending.length > 0) {
      const current = pending.pop()!;
      for (const next of targets.get(current) ?? []) {
        if (next === rootId) return true;
        if (!seen.has(next)) { seen.add(next); pending.push(next); }
      }
    }
    return false;
  });
}

function validStructuralBlastRadii(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > 500) return false;
  const radiusIds = new Set<string>();
  const changedRootIds = new Set<string>();
  const sourceNodes = new Map<string, Record<string, unknown>>();
  return value.every((radius) => {
    if (!record(radius) || !nonEmptyString(radius.id, 256) || radiusIds.has(radius.id) ||
      !validStructuralNode(radius.symbol, true) || !["codegraph", "language-server", "repository-search", "unavailable"].includes(String(radius.provider)) ||
      !["high", "medium", "low", "unresolved"].includes(String(radius.confidence)) || !["verified", "partial", "unverified"].includes(String(radius.provenance)) ||
      !nonEmptyString(radius.summary, 12_000) || !Array.isArray(radius.nodes) || radius.nodes.length < 1 || radius.nodes.length > 80 ||
      !Array.isArray(radius.edges) || radius.edges.length > 160 || !Array.isArray(radius.directCallerIds) || radius.directCallerIds.length > 80 ||
      !Number.isInteger(radius.reportedDirectCallerCount) || Number(radius.reportedDirectCallerCount) < 0 ||
      !Number.isInteger(radius.reportedReachableNodeCount) || Number(radius.reportedReachableNodeCount) < 0 ||
      !Number.isInteger(radius.reportedImpactedFileCount) || Number(radius.reportedImpactedFileCount) < 0 ||
      !Array.isArray(radius.impactedFiles) || radius.impactedFiles.length > 200 || !radius.impactedFiles.every((path) => nonEmptyString(path, 4_096)) || new Set(radius.impactedFiles).size !== radius.impactedFiles.length ||
      (radius.testEvidence !== undefined && !validStructuralTestEvidence(radius.testEvidence)) ||
      !Array.isArray(radius.nearbyTestGaps) || radius.nearbyTestGaps.length > 50) return false;
    radiusIds.add(radius.id);
    if ((radius.provider === "unavailable") !== (radius.confidence === "unresolved") || (radius.provider === "unavailable" && radius.provenance !== "unverified")) return false;
    const coverage = radius.coverage;
    if (coverage !== undefined) {
      if (!record(coverage) || !["complete", "partial", "unavailable", "unknown"].includes(String(coverage.state)) ||
        !["exact", "lower-bound", "not-reported"].includes(String(coverage.reportedCounts)) ||
        (coverage.omissionReason !== undefined && !nonEmptyString(coverage.omissionReason, 4_000)) ||
        (coverage.state === "partial" && !nonEmptyString(coverage.omissionReason, 4_000)) ||
        (coverage.state === "unknown" && !nonEmptyString(coverage.omissionReason, 4_000)) ||
        (coverage.state === "complete" && coverage.reportedCounts !== "exact") ||
        (coverage.state === "unavailable" && coverage.reportedCounts !== "not-reported") ||
        (radius.provider === "unavailable" && coverage.state !== "unavailable") ||
        (radius.provider !== "unavailable" && coverage.state === "unavailable")) return false;
    }
    const root = radius.symbol as Record<string, unknown>;
    if (changedRootIds.has(String(root.id))) return false;
    changedRootIds.add(String(root.id));
    const nodeIds = new Set<string>();
    if (!radius.nodes.every((node) => {
      if (!validStructuralNode(node)) return false;
      const candidate = node as Record<string, unknown>;
      const id = String(candidate.id);
      if (nodeIds.has(id)) return false;
      nodeIds.add(id);
      const prior = sourceNodes.get(id);
      if (prior && (prior.symbol !== candidate.symbol || prior.kind !== candidate.kind || JSON.stringify(prior.location) !== JSON.stringify(candidate.location))) return false;
      sourceNodes.set(id, candidate);
      return true;
    })) return false;
    const rootNode = radius.nodes.find((node) => record(node) && node.id === root.id);
    if (!record(rootNode) || rootNode.symbol !== root.symbol || rootNode.kind !== root.kind || JSON.stringify(rootNode.location) !== JSON.stringify(root.location)) return false;
    const edgeIds = new Set<string>();
    if (!radius.edges.every((edge) => record(edge) && nonEmptyString(edge.id, 256) && !edgeIds.has(edge.id) && Boolean(edgeIds.add(edge.id)) &&
      nonEmptyString(edge.from, 256) && nodeIds.has(edge.from) && nonEmptyString(edge.to, 256) && nodeIds.has(edge.to) && edge.from !== edge.to && ["calls", "references"].includes(String(edge.relationship)))) return false;
    if (!structuralNodesReachRoot(nodeIds, radius.edges, String(root.id))) return false;
    const directCallerIds = radius.directCallerIds as string[];
    const impactedFiles = radius.impactedFiles as string[];
    const direct = new Set(radius.edges.filter((edge) => record(edge) && edge.to === root.id).map((edge) => String((edge as Record<string, unknown>).from)));
    if (directCallerIds.some((id) => !nonEmptyString(id, 256) || id === root.id || !nodeIds.has(id)) || new Set(directCallerIds).size !== directCallerIds.length || direct.size !== directCallerIds.length || directCallerIds.some((id) => !direct.has(id))) return false;
    if (Number(radius.reportedDirectCallerCount) < directCallerIds.length || Number(radius.reportedReachableNodeCount) < radius.nodes.length - 1 || Number(radius.reportedImpactedFileCount) < impactedFiles.length) return false;
    if (record(coverage) && coverage.state === "complete" && (
      Number(radius.reportedDirectCallerCount) !== directCallerIds.length ||
      Number(radius.reportedReachableNodeCount) !== radius.nodes.length - 1 ||
      Number(radius.reportedImpactedFileCount) !== impactedFiles.length
    )) return false;
    const visiblePaths = radius.nodes.filter(record).map((node) => record(node.location) ? node.location.path : undefined).filter((path): path is string => typeof path === "string");
    if (visiblePaths.some((path) => !impactedFiles.includes(path))) return false;
    if (!radius.nearbyTestGaps.every((gap) => record(gap) && ["no-nearby-tests", "changed-symbol-not-covered", "impacted-path-not-covered", "coverage-unknown"].includes(String(gap.kind)) && nonEmptyString(gap.detail, 8_000) && Array.isArray(gap.nearbyTestFiles) && gap.nearbyTestFiles.length <= 50 && gap.nearbyTestFiles.every((path) => nonEmptyString(path, 4_096)) && new Set(gap.nearbyTestFiles).size === gap.nearbyTestFiles.length)) return false;
    return radius.provider !== "unavailable" || (radius.nodes.length === 1 && radius.edges.length === 0 && directCallerIds.length === 0 && Number(radius.reportedDirectCallerCount) === 0 && Number(radius.reportedReachableNodeCount) === 0);
  });
}

function validCallLocation(value: unknown, side: "old" | "new"): boolean {
  return record(value) && nonEmptyString(value.path, 4_096) && value.side === side && Number.isInteger(value.line) && Number(value.line) > 0;
}

function validComment(value: unknown): boolean {
  const scope = record(value) ? value.scope : undefined;
  const effectiveScope = scope ?? "line";
  return record(value) && nonEmptyString(value.id, 128) && nonEmptyString(value.path, 4_096) &&
    ["old", "new"].includes(String(value.side)) && Number.isInteger(value.line) && Number(value.line) > 0 &&
    (scope === undefined || ["line", "range", "stop"].includes(String(scope))) &&
    (value.endLine === undefined || (Number.isInteger(value.endLine) && Number(value.endLine) >= Number(value.line) && Number(value.endLine) - Number(value.line) <= 99)) &&
    (effectiveScope !== "range" || value.endLine !== undefined) &&
    (effectiveScope !== "line" || value.endLine === undefined || Number(value.endLine) === Number(value.line)) &&
    (value.selectedText === undefined || nonEmptyString(value.selectedText, 16_000)) &&
    (value.context === undefined || boundedString(value.context, 32_000)) &&
    (value.stepId === undefined || nonEmptyString(value.stepId, 128)) &&
    (scope !== "stop" || nonEmptyString(value.stepId, 128)) &&
    nonEmptyString(value.body, 8_000) && boundedString(value.lineContent) && ["active", "outdated"].includes(String(value.status)) &&
    (value.publishToGitHub === undefined || typeof value.publishToGitHub === "boolean") &&
    nonEmptyString(value.createdAt, 64) && nonEmptyString(value.updatedAt, 64);
}

function validPathExplanations(value: unknown, evidencePaths: string[]): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length !== new Set(evidencePaths).size) return false;
  const paths = new Set<string>();
  return value.every((detail) => record(detail) && nonEmptyString(detail.path, 4_096) && evidencePaths.includes(detail.path) && !paths.has(detail.path) && Boolean(paths.add(detail.path)) &&
    nonEmptyString(detail.explanation, 600));
}

function validIssueAssessment(value: unknown): boolean {
  if (!record(value) || !Number.isInteger(value.issueNumber) || Number(value.issueNumber) <= 0 || !nonEmptyString(value.issueUrl, 4_096) || !Array.isArray(value.items) || value.items.length > 20) return false;
  const ids = new Set<string>();
  return value.items.every((item) => {
    if (!record(item) || !nonEmptyString(item.criterionId, 128) || ids.has(item.criterionId) || !nonEmptyString(item.criterion, 4_000) ||
      !["implemented", "missing", "unclear"].includes(String(item.status)) || !nonEmptyString(item.evidence, 12_000) ||
      !Array.isArray(item.evidencePaths) || item.evidencePaths.length > 8 || !item.evidencePaths.every((path) => nonEmptyString(path, 4_096)) ||
      (item.status !== "unclear" && item.evidencePaths.length === 0) || item.basis !== "model-assessment") return false;
    ids.add(item.criterionId);
    return validPathExplanations(item.pathExplanations, item.evidencePaths);
  });
}

function validReviewerTask(value: unknown): boolean {
  if (!record(value) || !boundedString(value.body, 100_000) || !value.body.trim() ||
    !["found", "not-found"].includes(String(value.criteriaStatus)) || !Array.isArray(value.acceptanceCriteria) ||
    value.acceptanceCriteria.length > 20 || !nonEmptyString(value.updatedAt, 64)) return false;
  const criteria: Array<{ id: string; text: string }> = [];
  const ids = new Set<string>();
  for (const candidate of value.acceptanceCriteria) {
    if (!record(candidate) || !nonEmptyString(candidate.id, 128) || ids.has(candidate.id) || !nonEmptyString(candidate.text, 4_000)) return false;
    ids.add(candidate.id);
    criteria.push({ id: candidate.id, text: candidate.text });
  }
  if ((value.criteriaStatus === "found") !== (criteria.length > 0)) return false;
  if (value.assessmentPending !== undefined && typeof value.assessmentPending !== "boolean") return false;
  if (value.assessment !== undefined) {
    if (!record(value.assessment) || !Array.isArray(value.assessment.items) ||
      !validIssueAssessment({ issueNumber: 1, issueUrl: "reviewer-task", items: value.assessment.items }) ||
      value.assessment.items.length !== criteria.length || value.assessment.items.some((item) =>
        !record(item) || criteria.find((criterion) => criterion.id === item.criterionId)?.text !== item.criterion)) return false;
  }
  return value.assessmentError === undefined || nonEmptyString(value.assessmentError, 2_000);
}

function validPullRequest(value: unknown): boolean {
  if (!record(value)) return false;
  const validOid = (candidate: unknown) => typeof candidate === "string" && /^[0-9a-f]{40,64}$/.test(candidate);
  const publication = value.publication;
  return nonEmptyString(value.repository, 500) && /^\S+\/\S+$/.test(String(value.repository)) &&
    Number.isInteger(value.number) && Number(value.number) > 0 && nonEmptyString(value.url, 4_096) &&
    nonEmptyString(value.title, 8_000) && boundedString(value.body, 100_000) && nonEmptyString(value.author, 500) &&
    nonEmptyString(value.baseRefName, 4_096) && validOid(value.baseRefOid) && nonEmptyString(value.headRefName, 4_096) && validOid(value.headRefOid) &&
    nonEmptyString(value.sourceRepositoryRoot, 4_096) && nonEmptyString(value.workspaceRoot, 4_096) && nonEmptyString(value.refNamespace, 4_096) &&
    (value.reviewDecision === undefined || nonEmptyString(value.reviewDecision, 500)) &&
    (value.state === undefined || ["OPEN", "CLOSED", "MERGED"].includes(String(value.state))) &&
    (value.mergeable === undefined || ["MERGEABLE", "CONFLICTING", "UNKNOWN"].includes(String(value.mergeable))) &&
    (value.mergeStateStatus === undefined || nonEmptyString(value.mergeStateStatus, 500)) &&
    Array.isArray(value.commits) && value.commits.length <= 500 && value.commits.every((commit) => record(commit) && validOid(commit.oid) &&
      boundedString(commit.headline, 8_000) && Array.isArray(commit.authors) && commit.authors.length <= 20 && commit.authors.every((author) => nonEmptyString(author, 500))) &&
    Array.isArray(value.checks) && value.checks.length <= 500 && value.checks.every((check) => record(check) && nonEmptyString(check.name, 8_000) &&
      nonEmptyString(check.state, 500) && (check.url === undefined || nonEmptyString(check.url, 4_096))) &&
    Array.isArray(value.threads) && value.threads.length <= 100 && value.threads.every((thread) => record(thread) && nonEmptyString(thread.id, 500) &&
      nonEmptyString(thread.path, 4_096) && (thread.line === undefined || (Number.isInteger(thread.line) && Number(thread.line) > 0)) &&
      (thread.side === undefined || ["old", "new"].includes(String(thread.side))) && typeof thread.resolved === "boolean" &&
      Array.isArray(thread.comments) && thread.comments.length <= 50 && thread.comments.every((comment) => record(comment) && nonEmptyString(comment.id, 500) &&
        nonEmptyString(comment.author, 500) && boundedString(comment.body, 100_000) && nonEmptyString(comment.url, 4_096))) &&
    typeof value.threadsTruncated === "boolean" &&
    (value.linkedIssue === undefined || (record(value.linkedIssue) && nonEmptyString(value.linkedIssue.repository, 500) && value.linkedIssue.repository === value.repository &&
      Number.isInteger(value.linkedIssue.number) && Number(value.linkedIssue.number) > 0 && value.linkedIssue.url === `https://github.com/${value.repository}/issues/${value.linkedIssue.number}` && nonEmptyString(value.linkedIssue.title, 8_000) &&
      (value.linkedIssue.author === undefined || nonEmptyString(value.linkedIssue.author, 500)) &&
      (value.linkedIssue.state === undefined || nonEmptyString(value.linkedIssue.state, 500)) && ["available", "inaccessible", "unavailable"].includes(String(value.linkedIssue.access)) &&
      ["found", "not-found", "malformed", "unavailable"].includes(String(value.linkedIssue.criteriaStatus)) && Array.isArray(value.linkedIssue.acceptanceCriteria) &&
      value.linkedIssue.acceptanceCriteria.length <= 20 && value.linkedIssue.acceptanceCriteria.every((criterion: unknown) => record(criterion) && nonEmptyString(criterion.id, 128) && nonEmptyString(criterion.text, 4_000)))) &&
    (value.reviewerTask === undefined || (validReviewerTask(value.reviewerTask) &&
      (!record(value.linkedIssue) || value.linkedIssue.access !== "available" || value.linkedIssue.criteriaStatus !== "found"))) &&
    (value.providerScope === undefined || (record(value.providerScope) && ["same-repository-closing-issue", "none", "inaccessible", "unavailable"].includes(String(value.providerScope.linkedIssue)) && value.providerScope.relatedResources === "not-requested")) &&
    nonEmptyString(value.updatedAt, 64) &&
    (publication === undefined || (record(publication) && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(String(publication.intentId)) &&
      ["accepted", "feedback"].includes(String(publication.outcome)) && Array.isArray(publication.commentIds) && publication.commentIds.length <= 10_000 &&
      (publication.decision === undefined || ["approve", "approve-with-comments", "request-changes", "cancel"].includes(String(publication.decision))) &&
      (publication.note === undefined || nonEmptyString(publication.note, 8_000)) &&
      publication.commentIds.every((id) => nonEmptyString(id, 128)) && new Set(publication.commentIds).size === publication.commentIds.length &&
      ["pending", "published"].includes(String(publication.status)) && (publication.reviewId === undefined || nonEmptyString(publication.reviewId, 500)) &&
      (publication.url === undefined || nonEmptyString(publication.url, 4_096))));
}

function validMessage(value: unknown): boolean {
  return record(value) && nonEmptyString(value.id, 128) && ["user", "agent"].includes(String(value.role)) &&
    nonEmptyString(value.body, 500_000) && (value.stepId === undefined || nonEmptyString(value.stepId, 128)) &&
    (value.threadId === undefined || nonEmptyString(value.threadId, 128)) &&
    (value.anchor === undefined || (record(value.anchor) && nonEmptyString(value.anchor.path, 4096) &&
      ["old", "new"].includes(String(value.anchor.side)) && Number.isInteger(value.anchor.line) && Number(value.anchor.line) > 0 &&
      (value.anchor.endLine === undefined || (Number.isInteger(value.anchor.endLine) && Number(value.anchor.endLine) >= Number(value.anchor.line) && Number(value.anchor.endLine) - Number(value.anchor.line) <= 99)) &&
      typeof value.anchor.content === "string" && value.anchor.content.length <= 20_000 &&
      (value.anchor.selectedText === undefined || nonEmptyString(value.anchor.selectedText, 16_000)) &&
      (value.anchor.context === undefined || boundedString(value.anchor.context, 32_000)))) &&
    (value.contextPaths === undefined || (Array.isArray(value.contextPaths) && value.contextPaths.length <= 8 &&
      value.contextPaths.every((path) => nonEmptyString(path, 4096)) && new Set(value.contextPaths).size === value.contextPaths.length)) &&
    (value.dryRunContext === undefined || (record(value.dryRunContext) && nonEmptyString(value.dryRunContext.traceId, 128) &&
      nonEmptyString(value.dryRunContext.flowId, 128) && nonEmptyString(value.dryRunContext.scenarioId, 128) && nonEmptyString(value.dryRunContext.stepId, 128))) &&
    nonEmptyString(value.createdAt, 64);
}

function validChangeSummary(value: unknown): boolean {
  return record(value) && ["added", "deleted", "modified", "renamed"].includes(String(value.status)) &&
    Number.isInteger(value.additions) && Number(value.additions) >= 0 &&
    Number.isInteger(value.deletions) && Number(value.deletions) >= 0;
}

function validActivity(value: unknown): boolean {
  return record(value) && nonEmptyString(value.id, 128) && nonEmptyString(value.requestMessageId, 128) &&
    (value.source === undefined || ["agent", "reviewer"].includes(String(value.source))) &&
    nonEmptyString(value.request, 8_000) && (value.stepId === undefined || nonEmptyString(value.stepId, 128)) &&
    nonEmptyString(value.adapterId, 128) && nonEmptyString(value.modelId, 256) &&
    (value.eventId === undefined || nonEmptyString(value.eventId, 128)) &&
    Array.isArray(value.files) && value.files.length <= 10_000 && value.files.every((file) => (
      record(file) && nonEmptyString(file.path, 4_096) && ["added", "modified", "removed"].includes(String(file.change)) &&
      (file.beforeFingerprint === undefined || nonEmptyString(file.beforeFingerprint, 128)) &&
      (file.afterFingerprint === undefined || nonEmptyString(file.afterFingerprint, 128)) &&
      (file.before === undefined || validChangeSummary(file.before)) &&
      (file.after === undefined || validChangeSummary(file.after)) &&
      (file.before !== undefined || file.after !== undefined)
    )) &&
    (value.verification === undefined || nonEmptyString(value.verification, 16_000)) &&
    ["observed", "verified"].includes(String(value.status)) &&
    (value.changeStatus === undefined || ["pending", "applied", "rejected", "undone"].includes(String(value.changeStatus))) &&
    (value.proposal === undefined || (
      record(value.proposal) && boundedString(value.proposal.patch, 12 * 1024 * 1024) &&
      /^[0-9a-f]{40,64}$/.test(String(value.proposal.baselineTree)) &&
      /^[0-9a-f]{40,64}$/.test(String(value.proposal.resultTree)) && value.changeStatus !== undefined
    )) &&
    nonEmptyString(value.createdAt, 64) && nonEmptyString(value.updatedAt, 64);
}

function validSelection(value: unknown): boolean {
  return record(value) && nonEmptyString(value.adapterId, 128) && nonEmptyString(value.modelId, 256) &&
    (value.reasoningEffort === undefined || ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"].includes(String(value.reasoningEffort))) &&
    (value.includeArchitecture === undefined || typeof value.includeArchitecture === "boolean") &&
    (value.includeCallFlows === undefined || typeof value.includeCallFlows === "boolean") &&
    (value.includeFlows === undefined || typeof value.includeFlows === "boolean") &&
    (value.includeFindings === undefined || typeof value.includeFindings === "boolean") &&
    (value.includeAdaptiveDiagrams === undefined || typeof value.includeAdaptiveDiagrams === "boolean") &&
    (value.includeDryRuns === undefined || typeof value.includeDryRuns === "boolean");
}

function validContinuation(value: unknown): boolean {
  return record(value) && ["codex", "claude", "gemini", "copilot"].includes(String(value.adapterId)) && nonEmptyString(value.id, 256);
}

function validRevisionSummary(value: unknown): boolean {
  if (!record(value) || (value.checkpointId !== undefined && !nonEmptyString(value.checkpointId, 128)) ||
    (value.checkpointCreatedAt !== undefined && !nonEmptyString(value.checkpointCreatedAt, 64)) ||
    !Number.isInteger(value.changedFiles) || Number(value.changedFiles) < 0 ||
    !Number.isInteger(value.additions) || Number(value.additions) < 0 ||
    !Number.isInteger(value.deletions) || Number(value.deletions) < 0 || !nonEmptyString(value.text, 2_000)) return false;
  return ["newFiles", "changedAgainFiles", "resolvedFiles", "unchangedFiles"].every((field) =>
    Array.isArray(value[field]) && value[field].length <= 10_000 && value[field].every((path) => nonEmptyString(path, 4_096)) &&
    new Set(value[field]).size === value[field].length);
}

function validCheckpoint(value: unknown): value is SourceCheckpoint {
  if (!record(value)) return false;
  const validOid = (candidate: unknown) => typeof candidate === "string" && /^[0-9a-f]{40,64}$/.test(candidate);
  return /^[0-9a-f-]{36}$/.test(String(value.id)) && ["manual", "decision"].includes(String(value.kind)) &&
    (value.label === undefined || nonEmptyString(value.label, 500)) &&
    /^refs\/diffcompass\/checkpoints\/[A-Za-z0-9._-]{1,128}\/[0-9a-f-]{36}$/.test(String(value.ref)) &&
    validOid(value.sourceTree) && validOid(value.sourceHead) && nonEmptyString(value.base, 4_096) && validOid(value.baseTree) &&
    Array.isArray(value.reviewedFiles) && value.reviewedFiles.length <= 10_000 && value.reviewedFiles.every((path) => nonEmptyString(path, 4_096)) &&
    new Set(value.reviewedFiles).size === value.reviewedFiles.length &&
    (value.outcome === undefined || ["accepted", "feedback"].includes(String(value.outcome))) &&
    (value.decision === undefined || ["approve", "approve-with-comments", "request-changes"].includes(String(value.decision))) &&
    validRevisionSummary(value.summary) && nonEmptyString(value.createdAt, 64);
}

function validPreferences(value: unknown): boolean {
  return record(value) && ["unified", "split"].includes(String(value.diffLayout)) &&
    typeof value.changedFilesOnly === "boolean" && Number.isInteger(value.contextLines) &&
    Number(value.contextLines) >= 3 && Number(value.contextLines) <= 200 &&
    Number.isInteger(value.prefetchSteps) && Number(value.prefetchSteps) >= 0 && Number(value.prefetchSteps) <= 5 &&
    typeof value.requireAllFilesReviewed === "boolean" && ["accepted", "cancelled"].includes(String(value.closeOutcome)) &&
    ["showBriefing", "briefingArchitecture", "briefingSequenceDiagrams", "briefingCallFlows", "briefingNeedsAttention", "briefingReviewEffort"].every((key) => value[key] === undefined || typeof value[key] === "boolean") &&
    (value.briefingOrder === undefined || isBriefingSectionOrder(value.briefingOrder));
}

function validDiffViewPreferences(value: unknown): boolean {
  return record(value) && Object.keys(value).every((key) => ["layout", "wrap"].includes(key)) &&
    ["unified", "split"].includes(String(value.layout)) && ["scroll", "wrap"].includes(String(value.wrap));
}

function validSessionDiffPreferences(value: unknown): boolean {
  return record(value) && Object.keys(value).every((key) => ["desktop", "mobile"].includes(key)) &&
    (value.desktop === undefined || validDiffViewPreferences(value.desktop)) &&
    (value.mobile === undefined || validDiffViewPreferences(value.mobile));
}

function validReviewPolicy(value: unknown): boolean {
  if (!record(value) || !Array.isArray(value.instructions) || value.instructions.length > 32 ||
    value.instructions.some((instruction) => !nonEmptyString(instruction, 2_000)) ||
    new Set(value.instructions).size !== value.instructions.length || !record(value.findings)) return false;
  const findings = value.findings;
  return typeof findings.enabled === "boolean" && Array.isArray(findings.categories) && findings.categories.length <= 32 &&
    findings.categories.every((category) => nonEmptyString(category, 2_000)) &&
    new Set(findings.categories).size === findings.categories.length &&
    ["critical", "high", "medium", "low"].includes(String(findings.minimumSeverity));
}

function validTerminalEvent(value: unknown): boolean {
  return record(value) && Number.isInteger(value.sequence) && Number(value.sequence) > 0 &&
    nonEmptyString(value.id, 128) && value.type === "review.closed" &&
    ["accepted", "feedback", "cancelled"].includes(String(value.outcome)) &&
    (value.decision === undefined || ["approve", "approve-with-comments", "request-changes", "cancel"].includes(String(value.decision))) &&
    (value.note === undefined || nonEmptyString(value.note, 8_000)) &&
    Array.isArray(value.comments) && value.comments.length <= 10_000 && value.comments.every(validComment) &&
    (value.reviewedTree === undefined || (value.outcome === "feedback" && /^[0-9a-f]{40,64}$/.test(String(value.reviewedTree)))) &&
    nonEmptyString(value.createdAt, 64) && typeof value.acknowledged === "boolean";
}

function validBridgePrompt(value: unknown): boolean {
  if (!record(value) || !record(value.event)) return false;
  const event = value.event;
  return Number.isInteger(event.sequence) && Number(event.sequence) > 0 && nonEmptyString(event.id, 128) &&
    event.type === "agent.prompt" && ["tour.outline", "tour.explanation", "review.question", "issue.assessment", "dry-run.plan", "dry-run.trace"].includes(String(event.kind)) &&
    nonEmptyString(event.prompt, 500_000) && nonEmptyString(event.createdAt, 64) &&
    (value.response === undefined || nonEmptyString(value.response, 500_000)) &&
    typeof value.acknowledged === "boolean" && typeof value.committed === "boolean";
}

export async function loadPersistedSession(path: string): Promise<PersistedReviewSession> {
  let value: unknown;
  try {
    const metadata = await stat(path);
    if (!metadata.isFile() || metadata.size > 20 * 1024 * 1024) throw new Error("session file exceeds the 20 MiB limit");
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Could not read review session ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!record(value)) throw new Error("The review session file is invalid.");
  if (value.schemaVersion === 1 && record(value.outline)) {
    const legacySteps = Array.isArray(value.outline.steps) ? value.outline.steps : [];
    const legacyPaths = [...new Set(legacySteps.flatMap((step) => record(step) && record(step.anchor) && typeof step.anchor.path === "string" ? [step.anchor.path] : []))];
    value.outline.phases = [{
      id: "legacy-tour",
      title: "Guided review",
      summary: typeof value.outline.summary === "string" ? value.outline.summary : "Imported from an earlier DiffCompass session.",
      fileChanges: legacyPaths.map((filePath) => ({ path: filePath, summary: "Changed file included in the original tour." })),
      steps: legacySteps,
    }];
    delete value.outline.steps;
    value.schemaVersion = 2;
  }
  if (value.schemaVersion === 2 && Array.isArray(value.checkpoints)) {
    value.schemaVersion = 3;
    value.checkpointRefNamespace ??= typeof value.checkpoints[0] === "object" && value.checkpoints[0] && "ref" in value.checkpoints[0]
      ? String(value.checkpoints[0].ref).replace(/\/[^/]+$/, "")
      : `refs/diffcompass/checkpoints/${basename(path, ".json").replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 128) || "migrated"}`;
  }
  if (value.schemaVersion === 2 && record(value.outline)) {
    value.outline.callFlows ??= [];
    value.outline.flows ??= [];
    value.outline.findings ??= [];
    for (const field of ["behaviorArchitecture", "architecture"] as const) {
      const diagram = value.outline[field];
      if (record(diagram) && typeof diagram.mermaid === "string") {
        diagram.mermaid = normalizeReviewArchitectureMermaid(diagram.mermaid);
      }
    }
    for (const field of ["stateDiagram", "dataModel"] as const) {
      const diagram = value.outline[field];
      if (record(diagram)) normalizeReviewAdaptiveDiagram(diagram);
    }
    if (Array.isArray(value.outline.flows)) {
      for (const flow of value.outline.flows) {
        if (!record(flow)) continue;
        flow.affectedFiles ??= [];
        if (typeof flow.mermaid === "string") flow.mermaid = normalizeSequenceDiagram(flow.mermaid);
      }
    }
    if (Array.isArray(value.outline.findings)) {
      for (const finding of value.outline.findings) {
        if (!record(finding)) continue;
        finding.blastRadiusSize ??= 0;
        finding.tested ??= false;
        finding.pinScope ??= "line";
        // v2 only had a generic dismissed state. Keep it readable and give it
        // the least committal explicit meaning when the session is resumed.
        if (finding.status === "dismissed") {
          finding.disposition ??= "deferred";
          finding.status = finding.disposition;
        } else if (finding.disposition === undefined && ["accepted", "false-positive", "intentional", "deferred", "fixed", "obsolete-after-refresh"].includes(String(finding.status))) {
          finding.disposition = finding.status;
        }
      }
    }
  }
  if (value.schemaVersion === 2 && record(value.preferences)) value.preferences.prefetchSteps ??= 2;
  // v4 adds optional dry-run data. A v3 session has no trace state to
  // transform, but must still advance so the next save uses the current
  // schema instead of repeatedly presenting itself as a legacy snapshot.
  if (value.schemaVersion === 3) value.schemaVersion = 4;
  const session = value as Partial<PersistedReviewSession>;
  if (
    ![2, 3, 4].includes(Number(session.schemaVersion)) ||
    (session.name !== undefined && !nonEmptyString(session.name, 200)) ||
    (session.archived !== undefined && typeof session.archived !== "boolean") ||
    !nonEmptyString(session.repositoryRoot, 16_384) ||
    !nonEmptyString(session.base, 4_096) ||
    !nonEmptyString(session.browserToken, 256) ||
    (session.bridgeToken !== undefined && !nonEmptyString(session.bridgeToken, 256)) ||
    (session.bridgeSequence !== undefined && (!Number.isInteger(session.bridgeSequence) || Number(session.bridgeSequence) < 0)) ||
    (session.bridgeTerminalEvent !== undefined && !validTerminalEvent(session.bridgeTerminalEvent)) ||
    (session.bridgePrompts !== undefined && (!Array.isArray(session.bridgePrompts) || session.bridgePrompts.length > 100 || !session.bridgePrompts.every(validBridgePrompt))) ||
    (session.bridgeLeases !== undefined && (!Array.isArray(session.bridgeLeases) || session.bridgeLeases.length > 101 || session.bridgeLeases.some((lease) => (
      !record(lease) || !nonEmptyString(lease.eventId, 128) || !nonEmptyString(lease.leaseId, 128) ||
      !Number.isFinite(lease.expiresAt) || Number(lease.expiresAt) <= 0
    )))) ||
    !Array.isArray(session.comments) || session.comments.length > 10_000 || !session.comments.every(validComment) ||
    !Array.isArray(session.messages) || session.messages.length > 10_000 || !session.messages.every(validMessage) ||
    (session.activities !== undefined && (!Array.isArray(session.activities) || session.activities.length > 2_000 || !session.activities.every(validActivity))) ||
    (session.reviewedFiles !== undefined && (!Array.isArray(session.reviewedFiles) || session.reviewedFiles.length > 10_000 ||
      !session.reviewedFiles.every((path) => nonEmptyString(path, 4_096)) || new Set(session.reviewedFiles).size !== session.reviewedFiles.length)) ||
    ((session.schemaVersion === 3 || session.schemaVersion === 4) && (!Array.isArray(session.checkpoints) || session.checkpoints.length > 100 || !session.checkpoints.every(validCheckpoint) ||
      !nonEmptyString(session.checkpointRefNamespace, 256) || !/^refs\/diffcompass\/checkpoints\/[A-Za-z0-9._-]{1,128}$/.test(session.checkpointRefNamespace))) ||
    (session.schemaVersion === 2 && session.checkpointRefNamespace !== undefined) ||
    (session.schemaVersion === 2 && session.checkpoints !== undefined) ||
    (session.comparisonView !== undefined && !["full", "since-last-review"].includes(String(session.comparisonView))) ||
    (session.selectedCheckpointId !== undefined && !/^[0-9a-f-]{36}$/.test(session.selectedCheckpointId)) ||
    (session.diffPreferences !== undefined && !validSessionDiffPreferences(session.diffPreferences)) ||
    (session.preferences !== undefined && !validPreferences(session.preferences)) ||
    (session.reviewPolicy !== undefined && !validReviewPolicy(session.reviewPolicy)) ||
    (session.findingGenerationEnabled !== undefined && typeof session.findingGenerationEnabled !== "boolean") ||
    (session.dryRuns !== undefined && (!Array.isArray(session.dryRuns) || session.dryRuns.length > 32 || !session.dryRuns.every(validDryRunTrace))) ||
    (session.pullRequest !== undefined && !validPullRequest(session.pullRequest)) ||
    (session.screenshots !== undefined && (!Array.isArray(session.screenshots) || session.screenshots.length > 12 || !session.screenshots.every(validScreenshot) || new Set(session.screenshots.map((shot) => shot.id)).size !== session.screenshots.length)) ||
    (session.outline !== undefined && !validOutline(session.outline)) ||
    (session.selection !== undefined && !validSelection(session.selection)) ||
    (session.agentContinuation !== undefined && !validContinuation(session.agentContinuation)) ||
    !Number.isInteger(session.currentStepIndex) ||
    !Number.isInteger(session.revision) ||
    !["open", "accepted", "feedback", "cancelled"].includes(session.status ?? "") ||
    !nonEmptyString(session.updatedAt, 64)
  ) {
    throw new Error("The review session file has an unsupported or invalid schema.");
  }
  const outline = session.outline;
  const selection = session.selection;
  const continuation = session.agentContinuation;
  const terminal = session.bridgeTerminalEvent;
  const bridgeEventIds = new Set([
    ...(session.bridgePrompts ?? []).map((record) => record.event.id),
    ...(terminal ? [terminal.id] : []),
  ]);
  if (
    (outline !== undefined && selection === undefined) ||
    (outline === undefined && session.currentStepIndex !== -1) ||
    (outline !== undefined && (session.currentStepIndex! < 0 || session.currentStepIndex! >= outline.phases.flatMap((phase) => phase.steps).length)) ||
    (selection?.adapterId === "attached" && session.bridgeToken === undefined) ||
    (session.bridgePrompts !== undefined && (session.bridgeToken === undefined || session.bridgeSequence === undefined ||
      new Set(session.bridgePrompts.map((record) => record.event.id)).size !== session.bridgePrompts.length ||
      session.bridgePrompts.some((record) => record.event.sequence > session.bridgeSequence!))) ||
    (session.bridgeLeases !== undefined && (session.bridgeToken === undefined ||
      new Set(session.bridgeLeases.map((lease) => lease.eventId)).size !== session.bridgeLeases.length ||
      session.bridgeLeases.some((lease) => !bridgeEventIds.has(lease.eventId)))) ||
    (continuation !== undefined && (selection === undefined || continuation.adapterId !== selection.adapterId)) ||
    (session.pullRequest !== undefined && (
      session.repositoryRoot !== session.pullRequest.workspaceRoot || session.base !== session.pullRequest.baseRefOid ||
      (session.pullRequest.publication !== undefined && session.pullRequest.publication.commentIds.some((id) =>
        !session.comments!.some((comment) => comment.id === id && comment.publishToGitHub === true))) ||
      (["accepted", "feedback"].includes(session.status ?? "") &&
        (session.pullRequest.publication?.status !== "published" || session.pullRequest.publication.outcome !== session.status))
    )) ||
    (session.outline?.issueAssessment !== undefined && (!session.pullRequest?.linkedIssue || session.pullRequest.linkedIssue.access !== "available" ||
      session.outline.issueAssessment.issueNumber !== session.pullRequest.linkedIssue.number || session.outline.issueAssessment.issueUrl !== session.pullRequest.linkedIssue.url ||
      session.outline.issueAssessment.items.length !== session.pullRequest.linkedIssue.acceptanceCriteria.length ||
      session.outline.issueAssessment.items.some((item) => session.pullRequest!.linkedIssue!.acceptanceCriteria.find((criterion) => criterion.id === item.criterionId)?.text !== item.criterion))) ||
    (session.pullRequest?.reviewerTask !== undefined && (
      (session.pullRequest.linkedIssue?.access === "available" && session.pullRequest.linkedIssue.criteriaStatus === "found") ||
      (session.pullRequest.reviewerTask.assessment !== undefined && (
        session.pullRequest.reviewerTask.criteriaStatus !== "found" ||
        session.pullRequest.reviewerTask.assessment.items.length !== session.pullRequest.reviewerTask.acceptanceCriteria.length ||
        session.pullRequest.reviewerTask.assessment.items.some((item) => session.pullRequest!.reviewerTask!.acceptanceCriteria.find((criterion) => criterion.id === item.criterionId)?.text !== item.criterion
      ))
    ))) ||
    (terminal !== undefined && (
      session.bridgeToken === undefined || session.bridgeSequence === undefined || terminal.sequence > session.bridgeSequence ||
      terminal.outcome !== session.status
    )) ||
    ((session.schemaVersion === 3 || session.schemaVersion === 4) && session.checkpoints!.some((checkpoint) => !session.checkpointRefNamespace || !checkpoint.ref.startsWith(`${session.checkpointRefNamespace}/`))) ||
    (session.selectedCheckpointId !== undefined && !session.checkpoints?.some((checkpoint) => checkpoint.id === session.selectedCheckpointId))
  ) throw new Error("The review session file has inconsistent state.");
  return session as PersistedReviewSession;
}

export async function savePersistedSession(path: string, session: PersistedReviewSession): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600);
}
