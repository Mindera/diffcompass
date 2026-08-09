import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { PersistedReviewSession } from "./types.ts";

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
  if (!Array.isArray(value.steps) || !Array.isArray(value.flows) || !Array.isArray(value.findings)) return false;
  if (value.steps.length > 100 || value.flows.length > 50 || value.findings.length > 2_000) return false;
  return value.steps.every((step) => record(step) && nonEmptyString(step.id, 128) && nonEmptyString(step.title, 8_000) &&
    nonEmptyString(step.objective, 50_000) && validAnchor(step.anchor) &&
    (step.explanation === undefined || nonEmptyString(step.explanation, 500_000)) &&
    (step.outdated === undefined || typeof step.outdated === "boolean")) &&
    value.flows.every((flow) => record(flow) && nonEmptyString(flow.id, 128) && nonEmptyString(flow.title, 8_000) &&
      nonEmptyString(flow.summary, 50_000) && nonEmptyString(flow.mermaid, 12_000) &&
      ["verified", "partial", "unverified"].includes(String(flow.provenance)) &&
      Number.isInteger(flow.blastRadiusSize) && Number(flow.blastRadiusSize) >= 0) &&
    value.findings.every((finding) => record(finding) && nonEmptyString(finding.id, 128) &&
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

function validComment(value: unknown): boolean {
  return record(value) && nonEmptyString(value.id, 128) && nonEmptyString(value.path, 4_096) &&
    ["old", "new"].includes(String(value.side)) && Number.isInteger(value.line) && Number(value.line) > 0 &&
    nonEmptyString(value.body, 8_000) && boundedString(value.lineContent) && ["active", "outdated"].includes(String(value.status)) &&
    nonEmptyString(value.createdAt, 64) && nonEmptyString(value.updatedAt, 64);
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
    (value.reasoningEffort === undefined || ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"].includes(String(value.reasoningEffort)));
}

function validContinuation(value: unknown): boolean {
  return record(value) && ["codex", "claude"].includes(String(value.adapterId)) && nonEmptyString(value.id, 256);
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
    value.outline.flows ??= [];
    value.outline.findings ??= [];
    if (Array.isArray(value.outline.findings)) {
      for (const finding of value.outline.findings) {
        if (!record(finding)) continue;
        finding.blastRadiusSize ??= 0;
        finding.tested ??= false;
        finding.pinScope ??= "line";
      }
    }
  }
  const session = value as Partial<PersistedReviewSession>;
  if (
    session.schemaVersion !== 1 ||
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
    (outline !== undefined && (session.currentStepIndex! < 0 || session.currentStepIndex! >= outline.steps.length)) ||
    (selection?.adapterId === "attached" && session.bridgeToken === undefined) ||
    (session.bridgePrompts !== undefined && (session.bridgeToken === undefined || session.bridgeSequence === undefined ||
      new Set(session.bridgePrompts.map((record) => record.event.id)).size !== session.bridgePrompts.length ||
      session.bridgePrompts.some((record) => record.event.sequence > session.bridgeSequence!))) ||
    (session.bridgeLeases !== undefined && (session.bridgeToken === undefined ||
      new Set(session.bridgeLeases.map((lease) => lease.eventId)).size !== session.bridgeLeases.length ||
      session.bridgeLeases.some((lease) => !bridgeEventIds.has(lease.eventId)))) ||
    (continuation !== undefined && (selection === undefined || continuation.adapterId !== selection.adapterId)) ||
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
