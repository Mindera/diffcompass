import { timingSafeEqual } from "node:crypto";
import { ReviewError } from "./errors.ts";
import type { AgentTransport, AgentTransportReply, BridgePromptKind } from "./agent.ts";
import type { PersistedReviewSession, ReviewComment, ReviewDecisionIntent } from "./types.ts";

export interface BridgePromptEvent {
  sequence: number;
  id: string;
  type: "agent.prompt";
  kind: BridgePromptKind;
  prompt: string;
  createdAt: string;
}

export const DEFAULT_FALLBACK_INACTIVITY_MS: Record<BridgePromptEvent["kind"], number> = {
  "tour.outline": 5 * 60 * 1_000,
  "tour.explanation": 90_000,
  "review.question": 90_000,
  "issue.assessment": 5 * 60 * 1_000,
};

export interface BridgeClosedEvent {
  sequence: number;
  id: string;
  type: "review.closed";
  outcome: "accepted" | "feedback" | "cancelled";
  decision?: ReviewDecisionIntent;
  note?: string;
  comments: ReviewComment[];
  reviewedTree?: string;
  createdAt: string;
}

export type BridgeEvent = BridgePromptEvent | BridgeClosedEvent;

export interface PersistedBridgeTerminalEvent extends BridgeClosedEvent {
  acknowledged: boolean;
}

interface PendingPrompt {
  resolve: (reply: AgentTransportReply) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  fallbackTimer?: ReturnType<typeof setTimeout>;
  fallbackActive?: boolean;
  attachment?: { name: string; content: string };
  progress?: (update: { status: "waiting" | "running"; message: string }) => void;
}

type PersistedPrompt = NonNullable<PersistedReviewSession["bridgePrompts"]>[number];

interface EventLease {
  id: string;
  expiresAt: number;
}

export class AttachedAgentBridge implements AgentTransport {
  readonly token: string;
  private sequence = 0;
  private readonly events: BridgeEvent[] = [];
  private readonly pending = new Map<string, PendingPrompt>();
  private readonly promptRecords = new Map<string, PersistedPrompt>();
  private readonly acknowledged = new Set<string>();
  private readonly leases = new Map<string, EventLease>();
  private readonly refreshAuthorized = new Map<string, number>();
  private readonly listeners = new Set<() => void>();
  private disposed = false;
  private terminalEvent?: BridgeClosedEvent;
  private terminalPublished = false;
  private persistCheckpoint?: () => Promise<void>;
  private fallback?: AgentTransport;
  private fallbackFactory?: () => AgentTransport;
  private fallbackResultHandler?: (eventId: string, kind: BridgePromptKind, reply: AgentTransportReply) => Promise<number | undefined>;
  private fallbackInactivityMs = { ...DEFAULT_FALLBACK_INACTIVITY_MS };
  private resolveTerminalAcknowledged!: () => void;
  readonly terminalAcknowledged = new Promise<void>((resolve) => {
    this.resolveTerminalAcknowledged = resolve;
  });

  constructor(
    token: string = crypto.randomUUID(),
    initialSequence = 0,
    terminal?: PersistedBridgeTerminalEvent,
    prompts: PersistedReviewSession["bridgePrompts"] = [],
    leases: PersistedReviewSession["bridgeLeases"] = [],
  ) {
    this.token = token;
    this.sequence = Math.max(initialSequence, terminal?.sequence ?? 0);
    if (terminal) {
      const { acknowledged, ...event } = structuredClone(terminal);
      this.terminalEvent = event;
      this.terminalPublished = true;
      this.disposed = true;
      if (acknowledged) {
        this.acknowledged.add(event.id);
        queueMicrotask(() => this.resolveTerminalAcknowledged());
      } else {
        this.events.push(event);
      }
    }
    for (const record of structuredClone(prompts)) {
      this.promptRecords.set(record.event.id, record);
      if (record.acknowledged) this.acknowledged.add(record.event.id);
      else this.events.push(record.event);
    }
    for (const lease of structuredClone(leases)) this.leases.set(lease.eventId, { id: lease.leaseId, expiresAt: lease.expiresAt });
  }

  setPersistence(callback: () => Promise<void>): void {
    this.persistCheckpoint = callback;
  }

  setFallback(
    transport: AgentTransport,
    inactivityMs?: number | Partial<Record<BridgePromptEvent["kind"], number>>,
  ): void {
    this.fallback = transport;
    this.fallbackFactory = undefined;
    this.configureFallbackInactivity(inactivityMs);
    for (const eventId of this.pending.keys()) this.armFallback(eventId);
  }

  setFallbackFactory(
    factory: () => AgentTransport,
    inactivityMs?: number | Partial<Record<BridgePromptEvent["kind"], number>>,
  ): void {
    this.fallbackFactory = factory;
    this.fallback = undefined;
    this.configureFallbackInactivity(inactivityMs);
    for (const eventId of this.pending.keys()) this.armFallback(eventId);
  }

  setFallbackResultHandler(
    handler: (eventId: string, kind: BridgePromptKind, reply: AgentTransportReply) => Promise<number | undefined>,
  ): void {
    this.fallbackResultHandler = handler;
  }

  private configureFallbackInactivity(
    inactivityMs?: number | Partial<Record<BridgePromptEvent["kind"], number>>,
  ): void {
    this.fallbackInactivityMs = typeof inactivityMs === "number"
      ? Object.fromEntries(Object.keys(DEFAULT_FALLBACK_INACTIVITY_MS).map((kind) => [kind, inactivityMs])) as Record<BridgePromptEvent["kind"], number>
      : { ...DEFAULT_FALLBACK_INACTIVITY_MS, ...inactivityMs };
  }

  get currentSequence(): number {
    return this.sequence;
  }

  get persistedTerminalEvent(): PersistedBridgeTerminalEvent | undefined {
    if (!this.terminalEvent) return undefined;
    return { ...structuredClone(this.terminalEvent), acknowledged: this.acknowledged.has(this.terminalEvent.id) };
  }

  get persistedPrompts(): NonNullable<PersistedReviewSession["bridgePrompts"]> {
    return structuredClone([...this.promptRecords.values()]);
  }

  get persistedLeases(): NonNullable<PersistedReviewSession["bridgeLeases"]> {
    return [...this.leases].map(([eventId, lease]) => ({ eventId, leaseId: lease.id, expiresAt: lease.expiresAt }));
  }

  async send(
    prompt: string,
    kind: BridgePromptKind,
    attachment?: { name: string; content: string },
    progress?: (update: { status: "waiting" | "running"; message: string }) => void,
  ): Promise<AgentTransportReply> {
    if (this.disposed) return Promise.reject(new ReviewError("The review is closed."));
    const restored = [...this.promptRecords.values()].find((record) => (
      !record.committed && record.event.kind === kind && record.event.prompt === prompt && !this.pending.has(record.event.id)
    ));
    if (restored?.response !== undefined) return { message: restored.response, receipt: restored.event.id };
    if (restored) {
      progress?.({ status: this.leases.has(restored.event.id) ? "running" : "waiting", message: this.leases.has(restored.event.id) ? "The triggering agent already claimed this prompt." : "Waiting for the triggering agent to claim this prompt." });
      return this.waitForResponse(restored.event, progress, attachment);
    }
    const id = crypto.randomUUID();
    const event: BridgePromptEvent = {
      sequence: ++this.sequence,
      id,
      type: "agent.prompt",
      kind,
      prompt,
      createdAt: new Date().toISOString(),
    };
    this.promptRecords.set(id, { event, acknowledged: false, committed: false });
    if (this.persistCheckpoint) {
      try {
        await this.persistCheckpoint();
      } catch (error) {
        this.promptRecords.delete(id);
        throw new ReviewError(`Could not persist the attached-agent event: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (this.disposed) throw new ReviewError("The review is closed.");
    this.events.push(event);
    this.notify();
    progress?.({ status: "waiting", message: "Waiting for the triggering agent to claim this prompt." });
    return this.waitForResponse(event, progress, attachment);
  }

  private waitForResponse(event: BridgePromptEvent, progress?: PendingPrompt["progress"], attachment?: PendingPrompt["attachment"]): Promise<AgentTransportReply> {
    const id = event.id;
    return new Promise<AgentTransportReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(id);
        if (pending?.fallbackTimer) clearTimeout(pending.fallbackTimer);
        this.pending.delete(id);
        const index = this.events.findIndex((candidate) => candidate.id === id);
        if (index >= 0) this.events.splice(index, 1);
        this.promptRecords.delete(id);
        void this.persistCheckpoint?.().catch(() => undefined);
        reject(new Error("The attached agent did not answer within 30 minutes."));
      }, 30 * 60 * 1_000);
      this.pending.set(id, { resolve, reject, timer, progress, attachment });
      this.armFallback(id);
    });
  }

  private armFallback(eventId: string): void {
    const pending = this.pending.get(eventId);
    const record = this.promptRecords.get(eventId);
    if (!pending || !record || pending.fallbackActive || (!this.fallback && !this.fallbackFactory)) return;
    if (pending.fallbackTimer) clearTimeout(pending.fallbackTimer);
    pending.fallbackTimer = setTimeout(() => void this.continueWithFallback(eventId), this.fallbackInactivityMs[record.event.kind]);
  }

  private async continueWithFallback(eventId: string): Promise<void> {
    const pending = this.pending.get(eventId);
    const record = this.promptRecords.get(eventId);
    const fallback = this.fallbackFactory?.() ?? this.fallback;
    if (!pending || pending.fallbackActive || !record || record.response !== undefined || !fallback || this.disposed) return;
    pending.fallbackActive = true;
    if (pending.fallbackTimer) clearTimeout(pending.fallbackTimer);
    pending.fallbackTimer = undefined;
    const index = this.events.findIndex((event) => event.id === eventId);
    if (index >= 0) this.events.splice(index, 1);
    this.leases.delete(eventId);
    pending.progress?.({ status: "running", message: "The triggering agent stopped reporting progress. Continuing automatically with a local fallback agent…" });
    await this.persistCheckpoint?.().catch(() => undefined);
    try {
      const response = await fallback.send(record.event.prompt, record.event.kind, pending.attachment, pending.progress);
      const reply = typeof response === "string" ? { message: response } : response;
      const message = reply.message;
      if (!message.trim()) throw new Error("The fallback agent returned an empty response.");
      if (this.disposed) throw new Error("The review closed before the fallback agent answered.");
      const authorizedGeneration = await this.fallbackResultHandler?.(eventId, record.event.kind, reply);
      if (authorizedGeneration !== undefined) this.refreshAuthorized.set(eventId, authorizedGeneration);
      record.response = message;
      record.acknowledged = true;
      this.acknowledged.add(eventId);
      await this.persistCheckpoint?.();
      clearTimeout(pending.timer);
      this.pending.delete(eventId);
      pending.resolve({ message, receipt: eventId });
    } catch (error) {
      this.pending.delete(eventId);
      this.promptRecords.delete(eventId);
      this.acknowledged.delete(eventId);
      clearTimeout(pending.timer);
      await this.persistCheckpoint?.().catch(() => undefined);
      pending.reject(new Error(`The attached agent stopped responding and the local fallback failed: ${error instanceof Error ? error.message : String(error)}`));
    }
  }

  async respond(eventId: string, message: string, leaseId?: string): Promise<void> {
    if (this.pending.get(eventId)?.fallbackActive) throw new ReviewError("This prompt was abandoned by the attached agent and continued with a local fallback.");
    this.requireLease(eventId, leaseId);
    const record = this.promptRecords.get(eventId);
    const prior = record?.response;
    if (prior !== undefined) {
      if (prior !== message) throw new ReviewError("This bridge event already has a different response.");
      return;
    }
    if (this.disposed) throw new ReviewError("The review is closed.");
    if (!record) throw new ReviewError(`No unanswered bridge event exists with id ${eventId}.`);
    if (!message.trim()) throw new ReviewError("The attached agent response cannot be empty.");
    record.response = message;
    try {
      await this.persistCheckpoint?.();
    } catch (error) {
      record.response = undefined;
      throw error;
    }
    const pending = this.pending.get(eventId);
    if (pending) {
      pending.progress?.({ status: "running", message: "The triggering agent returned a response. Saving it to the tour…" });
      clearTimeout(pending.timer);
      if (pending.fallbackTimer) clearTimeout(pending.fallbackTimer);
      this.pending.delete(eventId);
      pending.resolve({ message, receipt: eventId });
    }
  }

  validateRefresh(eventId: string, leaseId: string): void {
    this.requireLease(eventId, leaseId);
    const record = this.promptRecords.get(eventId);
    if (record?.event.kind !== "review.question") throw new ReviewError("Only a review question may refresh the comparison before responding.");
  }

  authorizeRefresh(eventId: string, leaseId: string, comparisonGeneration: number): void {
    this.validateRefresh(eventId, leaseId);
    this.refreshAuthorized.set(eventId, comparisonGeneration);
  }

  consumeResponseRefreshAuthorization(receipts: string[]): number | undefined {
    for (const eventId of receipts) {
      const generation = this.refreshAuthorized.get(eventId);
      this.refreshAuthorized.delete(eventId);
      if (generation !== undefined) return generation;
    }
    return undefined;
  }

  prepareCommitResponses(receipts: string[]): PersistedPrompt[] {
    const changed: PersistedPrompt[] = [];
    for (const id of new Set(receipts)) {
      const record = this.promptRecords.get(id);
      if (!record) continue;
      if (record.response === undefined || record.committed) continue;
      changed.push(structuredClone(record));
      record.committed = true;
      if (record.acknowledged) this.promptRecords.delete(id);
    }
    return changed;
  }

  rollbackCommitResponses(records: PersistedPrompt[]): void {
    for (const record of records) this.promptRecords.set(record.event.id, structuredClone(record));
  }

  close(outcome: BridgeClosedEvent["outcome"], comments: ReviewComment[], reviewedTree?: string, decision?: BridgeClosedEvent["decision"], note?: string): BridgeClosedEvent {
    const event = this.prepareClose(outcome, comments, reviewedTree, decision, note);
    this.publishClose();
    return event;
  }

  prepareClose(outcome: BridgeClosedEvent["outcome"], comments: ReviewComment[], reviewedTree?: string, decision?: BridgeClosedEvent["decision"], note?: string): BridgeClosedEvent {
    if (this.terminalEvent) {
      if (this.terminalEvent.outcome !== outcome) throw new ReviewError(`The review already closed as ${this.terminalEvent.outcome}.`);
      return structuredClone(this.terminalEvent);
    }
    this.terminalEvent = {
      sequence: ++this.sequence,
      id: crypto.randomUUID(),
      type: "review.closed",
      outcome,
      ...(decision ? { decision } : {}),
      ...(note ? { note } : {}),
      comments: structuredClone(comments),
      ...(reviewedTree ? { reviewedTree } : {}),
      createdAt: new Date().toISOString(),
    };
    this.disposed = true;
    return structuredClone(this.terminalEvent);
  }

  rollbackPreparedClose(eventId: string): void {
    if (!this.terminalEvent || this.terminalPublished || this.terminalEvent.id !== eventId) return;
    this.terminalEvent = undefined;
    this.disposed = false;
  }

  publishClose(): void {
    if (!this.terminalEvent || this.terminalPublished) return;
    this.events.push(this.terminalEvent);
    this.terminalPublished = true;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      if (pending.fallbackTimer) clearTimeout(pending.fallbackTimer);
      pending.reject(new Error("The review closed before the attached agent answered."));
      this.pending.delete(id);
    }
    this.notify();
  }

  async ack(eventId: string, leaseId?: string): Promise<void> {
    if (this.acknowledged.has(eventId)) return;
    this.requireLease(eventId, leaseId);
    const index = this.events.findIndex((event) => event.id === eventId);
    if (index < 0) throw new ReviewError(`Bridge event does not exist: ${eventId}`);
    if (this.pending.has(eventId)) throw new ReviewError("Answer the prompt before acknowledging it.");
    this.acknowledged.add(eventId);
    const promptRecord = this.promptRecords.get(eventId);
    if (promptRecord) promptRecord.acknowledged = true;
    if (promptRecord?.committed) this.promptRecords.delete(eventId);
    const lease = this.leases.get(eventId);
    this.leases.delete(eventId);
    try {
      await this.persistCheckpoint?.();
    } catch (error) {
      this.acknowledged.delete(eventId);
      if (lease) this.leases.set(eventId, lease);
      if (promptRecord) {
        promptRecord.acknowledged = false;
        this.promptRecords.set(eventId, promptRecord);
      }
      throw error;
    }
    const [event] = this.events.splice(index, 1);
    if (event?.type === "review.closed") this.resolveTerminalAcknowledged();
  }

  async renew(eventId: string, leaseId: string): Promise<void> {
    this.requireLease(eventId, leaseId);
    const previous = this.leases.get(eventId)!;
    this.leases.set(eventId, { id: leaseId, expiresAt: Date.now() + 30 * 60 * 1_000 });
    try {
      await this.persistCheckpoint?.();
    } catch (error) {
      this.leases.set(eventId, previous);
      throw error;
    }
  }

  reportProgress(eventId: string, leaseId: string, message: string): void {
    if (!this.leases.has(eventId)) throw new ReviewError("Claim this bridge prompt before reporting progress.");
    this.requireLease(eventId, leaseId);
    if (!message.trim()) throw new ReviewError("Agent progress cannot be empty.");
    const record = this.promptRecords.get(eventId);
    if (!record || record.response !== undefined) throw new ReviewError("This bridge prompt is no longer active.");
    if (this.pending.get(eventId)?.fallbackActive) throw new ReviewError("This prompt already continued with a local fallback.");
    this.pending.get(eventId)?.progress?.({ status: "running", message });
    this.armFallback(eventId);
  }

  private requireLease(eventId: string, leaseId?: string): void {
    const lease = this.leases.get(eventId);
    if (!lease) return;
    if (!leaseId || lease.id !== leaseId || lease.expiresAt <= Date.now()) {
      throw new ReviewError("This bridge event is leased to a different or expired worker.");
    }
  }

  dispose(reason = "The review server stopped."): void {
    this.disposed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      if (pending.fallbackTimer) clearTimeout(pending.fallbackTimer);
      pending.reject(new Error(reason));
    }
    this.pending.clear();
    this.listeners.forEach((listener) => listener());
    this.listeners.clear();
  }

  async eventsAfter(after: number, waitMs = 0, signal?: AbortSignal, claim = false): Promise<Array<BridgeEvent & { leaseId?: string }>> {
    const available = () => {
      const now = Date.now();
      const events = this.events.filter((event) => (
        event.sequence > after || !this.acknowledged.has(event.id)
      ) && (!claim || (this.leases.get(event.id)?.expiresAt ?? 0) <= now));
      if (!claim) return events;
      return events.map((event) => {
        const leaseId = crypto.randomUUID();
        this.leases.set(event.id, { id: leaseId, expiresAt: now + 30 * 60 * 1_000 });
        return { ...event, leaseId };
      });
    };
    const current = available();
    if (current.length > 0 || waitMs <= 0 || this.disposed || signal?.aborted) {
      const persisted = await this.persistClaimed(current, claim);
      this.reportClaims(persisted, claim);
      return persisted;
    }

    await new Promise<void>((resolve) => {
      const listener = () => {
        finish();
      };
      const onAbort = () => finish();
      const finish = () => {
        clearTimeout(timer);
        this.listeners.delete(listener);
        signal?.removeEventListener("abort", onAbort);
        resolve();
      };
      const timer = setTimeout(() => {
        finish();
      }, Math.min(waitMs, 55_000));
      this.listeners.add(listener);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    const persisted = await this.persistClaimed(available(), claim);
    this.reportClaims(persisted, claim);
    return persisted;
  }

  private reportClaims(events: Array<BridgeEvent & { leaseId?: string }>, claimed: boolean): void {
    if (!claimed) return;
    for (const event of events) {
      this.pending.get(event.id)?.progress?.({ status: "running", message: "The triggering agent claimed the prompt and is working on it." });
      this.armFallback(event.id);
    }
  }

  private async persistClaimed(events: Array<BridgeEvent & { leaseId?: string }>, claimed: boolean): Promise<Array<BridgeEvent & { leaseId?: string }>> {
    if (!claimed || events.length === 0 || !this.persistCheckpoint) return structuredClone(events);
    try {
      await this.persistCheckpoint();
      return structuredClone(events);
    } catch (error) {
      for (const event of events) {
        const lease = this.leases.get(event.id);
        if (lease?.id === event.leaseId) this.leases.delete(event.id);
      }
      throw error;
    }
  }

  isAuthorized(token: string | null): boolean {
    if (token === null) return false;
    const actual = Buffer.from(token);
    const expected = Buffer.from(this.token);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
    this.listeners.clear();
  }
}
