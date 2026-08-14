import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { PersistedReviewSession } from "./types.ts";
import { normalizeSequenceDiagram } from "./flows.ts";
import { validateReviewArchitecture } from "./architecture.ts";

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown, max = 500_000): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function boundedString(value: unknown, max = 500_000): value is string {
  return typeof value === "string" && value.length <= max;
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
      nonEmptyString(flow.summary, 50_000) && nonEmptyString(flow.mermaid, 12_000) &&
      ["verified", "partial", "unverified"].includes(String(flow.provenance)) &&
      Array.isArray(flow.affectedFiles) && flow.affectedFiles.length <= 100 && flow.affectedFiles.every((path) => nonEmptyString(path, 4_096)) && new Set(flow.affectedFiles).size === flow.affectedFiles.length &&
      Number.isInteger(flow.blastRadiusSize) && Number(flow.blastRadiusSize) >= 0);
  if (!validFlows) return false;
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
      ["open", "dismissed", "converted-to-feedback"].includes(String(finding.status)) &&
      (finding.commentId === undefined || nonEmptyString(finding.commentId, 128)) &&
      (finding.outdated === undefined || typeof finding.outdated === "boolean"));
}

function validCallLocation(value: unknown, side: "old" | "new"): boolean {
  return record(value) && nonEmptyString(value.path, 4_096) && value.side === side && Number.isInteger(value.line) && Number(value.line) > 0;
}

function validComment(value: unknown): boolean {
  return record(value) && nonEmptyString(value.id, 128) && nonEmptyString(value.path, 4_096) &&
    ["old", "new"].includes(String(value.side)) && Number.isInteger(value.line) && Number(value.line) > 0 &&
    nonEmptyString(value.body, 8_000) && boundedString(value.lineContent) && ["active", "outdated"].includes(String(value.status)) &&
    (value.publishToGitHub === undefined || typeof value.publishToGitHub === "boolean") &&
    nonEmptyString(value.createdAt, 64) && nonEmptyString(value.updatedAt, 64);
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
    Array.isArray(value.commits) && value.commits.length <= 500 && value.commits.every((commit) => record(commit) && validOid(commit.oid) &&
      boundedString(commit.headline, 8_000) && Array.isArray(commit.authors) && commit.authors.length <= 20 && commit.authors.every((author) => nonEmptyString(author, 500))) &&
    Array.isArray(value.checks) && value.checks.length <= 500 && value.checks.every((check) => record(check) && nonEmptyString(check.name, 8_000) &&
      nonEmptyString(check.state, 500) && (check.url === undefined || nonEmptyString(check.url, 4_096))) &&
    Array.isArray(value.threads) && value.threads.length <= 100 && value.threads.every((thread) => record(thread) && nonEmptyString(thread.id, 500) &&
      nonEmptyString(thread.path, 4_096) && (thread.line === undefined || (Number.isInteger(thread.line) && Number(thread.line) > 0)) &&
      (thread.side === undefined || ["old", "new"].includes(String(thread.side))) && typeof thread.resolved === "boolean" &&
      Array.isArray(thread.comments) && thread.comments.length <= 50 && thread.comments.every((comment) => record(comment) && nonEmptyString(comment.id, 500) &&
        nonEmptyString(comment.author, 500) && boundedString(comment.body, 100_000) && nonEmptyString(comment.url, 4_096))) &&
    typeof value.threadsTruncated === "boolean" && nonEmptyString(value.updatedAt, 64) &&
    (publication === undefined || (record(publication) && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(String(publication.intentId)) &&
      ["accepted", "feedback"].includes(String(publication.outcome)) && Array.isArray(publication.commentIds) && publication.commentIds.length <= 10_000 &&
      publication.commentIds.every((id) => nonEmptyString(id, 128)) && new Set(publication.commentIds).size === publication.commentIds.length &&
      ["pending", "published"].includes(String(publication.status)) && (publication.reviewId === undefined || nonEmptyString(publication.reviewId, 500)) &&
      (publication.url === undefined || nonEmptyString(publication.url, 4_096))));
}

function validMessage(value: unknown): boolean {
  return record(value) && nonEmptyString(value.id, 128) && ["user", "agent"].includes(String(value.role)) &&
    nonEmptyString(value.body, 500_000) && (value.stepId === undefined || nonEmptyString(value.stepId, 128)) &&
    nonEmptyString(value.createdAt, 64);
}

function validChangeSummary(value: unknown): boolean {
  return record(value) && ["added", "deleted", "modified", "renamed"].includes(String(value.status)) &&
    Number.isInteger(value.additions) && Number(value.additions) >= 0 &&
    Number.isInteger(value.deletions) && Number(value.deletions) >= 0;
}

function validActivity(value: unknown): boolean {
  return record(value) && nonEmptyString(value.id, 128) && nonEmptyString(value.requestMessageId, 128) &&
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
    (value.includeFindings === undefined || typeof value.includeFindings === "boolean");
}

function validContinuation(value: unknown): boolean {
  return record(value) && ["codex", "claude", "gemini", "copilot"].includes(String(value.adapterId)) && nonEmptyString(value.id, 256);
}

function validPreferences(value: unknown): boolean {
  return record(value) && ["unified", "split"].includes(String(value.diffLayout)) &&
    typeof value.changedFilesOnly === "boolean" && Number.isInteger(value.contextLines) &&
    Number(value.contextLines) >= 3 && Number(value.contextLines) <= 200 &&
    Number.isInteger(value.prefetchSteps) && Number(value.prefetchSteps) >= 0 && Number(value.prefetchSteps) <= 4 &&
    typeof value.requireAllFilesReviewed === "boolean" && ["accepted", "cancelled"].includes(String(value.closeOutcome));
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
    Array.isArray(value.comments) && value.comments.length <= 10_000 && value.comments.every(validComment) &&
    nonEmptyString(value.createdAt, 64) && typeof value.acknowledged === "boolean";
}

function validBridgePrompt(value: unknown): boolean {
  if (!record(value) || !record(value.event)) return false;
  const event = value.event;
  return Number.isInteger(event.sequence) && Number(event.sequence) > 0 && nonEmptyString(event.id, 128) &&
    event.type === "agent.prompt" && ["tour.outline", "tour.explanation", "review.question"].includes(String(event.kind)) &&
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
      summary: typeof value.outline.summary === "string" ? value.outline.summary : "Imported from an earlier Code Review Tour session.",
      fileChanges: legacyPaths.map((filePath) => ({ path: filePath, summary: "Changed file included in the original tour." })),
      steps: legacySteps,
    }];
    delete value.outline.steps;
    value.schemaVersion = 2;
  }
  if (value.schemaVersion === 2 && record(value.outline)) {
    value.outline.callFlows ??= [];
    value.outline.flows ??= [];
    value.outline.findings ??= [];
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
      }
    }
  }
  if (value.schemaVersion === 2 && record(value.preferences)) value.preferences.prefetchSteps ??= 2;
  const session = value as Partial<PersistedReviewSession>;
  if (
    session.schemaVersion !== 2 ||
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
    (session.preferences !== undefined && !validPreferences(session.preferences)) ||
    (session.reviewPolicy !== undefined && !validReviewPolicy(session.reviewPolicy)) ||
    (session.findingGenerationEnabled !== undefined && typeof session.findingGenerationEnabled !== "boolean") ||
    (session.pullRequest !== undefined && !validPullRequest(session.pullRequest)) ||
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
    (terminal !== undefined && (
      session.bridgeToken === undefined || session.bridgeSequence === undefined || terminal.sequence > session.bridgeSequence ||
      terminal.outcome !== session.status
    ))
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
