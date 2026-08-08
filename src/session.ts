import { discoverAgentAdapters } from "./adapters.ts";
import { ReviewError } from "./errors.ts";
import { TourAgent } from "./agent.ts";
import { AttachedAgentBridge } from "./bridge.ts";
import { applyChangePatch, captureWorkingTreeSnapshot, createChangePatch, createProposalWorkspace, loadComparison, removeProposalWorkspace, type ProposalWorkspace } from "./git.ts";
import { parseUnifiedDiff } from "./diff.ts";
import { loadPersistedSession, savePersistedSession } from "./store.ts";
import type { AgentAdapterOption, AgentChangeActivity, AgentChangeFile, AgentSelection, ChatMessage, DiffFile, DiffRow, PersistedReviewSession, ReasoningEffort, ReviewComment, ReviewOutcome, ReviewStatus, TourOutline } from "./types.ts";

interface AgentDefaults {
  adapterId?: string;
  modelId?: string;
  reasoningEffort?: ReasoningEffort;
  attached?: boolean;
  stateFile?: string;
  resume?: boolean;
}

interface RefreshContext {
  source: "manual" | "watcher" | "agent";
  eventId?: string;
  verification?: string;
}

function fileFingerprint(file: DiffFile): string {
  return new Bun.CryptoHasher("sha256").update(JSON.stringify(file)).digest("hex");
}

function fileSummary(file: DiffFile) {
  return { status: file.status, additions: file.additions, deletions: file.deletions };
}

function comparisonChanges(before: DiffFile[], after: DiffFile[]): AgentChangeFile[] {
  const beforeByPath = new Map(before.map((file) => [file.path, file]));
  const afterByPath = new Map(after.map((file) => [file.path, file]));
  const paths = [...new Set([...beforeByPath.keys(), ...afterByPath.keys()])].sort();
  return paths.flatMap((path) => {
    const previous = beforeByPath.get(path);
    const current = afterByPath.get(path);
    const beforeFingerprint = previous ? fileFingerprint(previous) : undefined;
    const afterFingerprint = current ? fileFingerprint(current) : undefined;
    if (beforeFingerprint === afterFingerprint) return [];
    return [{
      path,
      change: !previous ? "added" as const : !current ? "removed" as const : "modified" as const,
      beforeFingerprint,
      afterFingerprint,
      before: previous ? fileSummary(previous) : undefined,
      after: current ? fileSummary(current) : undefined,
    }];
  });
}

export class ReviewSession {
  readonly comments: ReviewComment[];
  readonly messages: ChatMessage[];
  readonly activities: AgentChangeActivity[];
  readonly browserToken: string;
  outline?: TourOutline;
  currentStepIndex = -1;
  revision = 1;
  status: ReviewStatus = "open";
  private agent?: TourAgent;
  private selection?: AgentSelection;
  private agentContinuation?: PersistedReviewSession["agentContinuation"];
  private commandQueue: Promise<void> = Promise.resolve();
  private mutationQueue: Promise<void> = Promise.resolve();
  private refreshQueue: Promise<void> = Promise.resolve();
  private persistenceQueue: Promise<void> = Promise.resolve();
  private terminalEpoch = 0;
  private closePromise?: Promise<{ outcome: ReviewOutcome; comments: ReviewComment[]; status: ReviewStatus }>;
  private comparisonGeneration = 0;
  private activeAgentRequest?: {
    messageId: string;
    body: string;
    stepId?: string;
    workspace: ProposalWorkspace;
    baselineComparison: Awaited<ReturnType<typeof loadComparison>>;
  };
  private readonly sessionName?: string;
  private readonly archived: boolean;
  private resolveClosed!: (outcome: ReviewOutcome) => void;
  readonly closed = new Promise<ReviewOutcome>((resolve) => {
    this.resolveClosed = resolve;
  });

  private constructor(
    public comparison: Awaited<ReturnType<typeof loadComparison>>,
    readonly agentAdapters: AgentAdapterOption[],
    private readonly defaults: AgentDefaults,
    readonly bridge?: AttachedAgentBridge,
    persisted?: PersistedReviewSession,
  ) {
    this.browserToken = persisted?.browserToken ?? crypto.randomUUID();
    this.comments = structuredClone(persisted?.comments ?? []);
    this.messages = structuredClone(persisted?.messages ?? []);
    this.activities = structuredClone(persisted?.activities ?? []);
    this.sessionName = persisted?.name;
    this.archived = persisted?.archived ?? false;
    this.outline = persisted?.outline
      ? { ...structuredClone(persisted.outline), flows: persisted.outline.flows ?? [], findings: persisted.outline.findings ?? [] }
      : undefined;
    this.currentStepIndex = persisted?.currentStepIndex ?? -1;
    this.revision = persisted?.revision ?? 1;
    this.status = persisted?.status ?? "open";
    this.selection = structuredClone(persisted?.selection);
    this.agentContinuation = structuredClone(persisted?.agentContinuation);
    if (this.status === "open" && this.selection) {
      this.agent = new TourAgent(this.comparison.repositoryRoot, this.selection, this.bridge, this.agentContinuation);
    }
    if (this.status !== "open") queueMicrotask(() => this.resolveClosed(this.status as ReviewOutcome));
  }

  private ensureOpen(): void {
    if (this.status !== "open") throw new ReviewError(`The review is closed (${this.status}).`);
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.commandQueue.then(operation);
    this.commandQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private persistedState(): PersistedReviewSession {
    return {
      schemaVersion: 1,
      name: this.sessionName,
      archived: this.archived,
      repositoryRoot: this.comparison.repositoryRoot,
      base: this.comparison.base,
      browserToken: this.browserToken,
      bridgeToken: this.bridge?.token,
      bridgeSequence: this.bridge?.currentSequence,
      bridgePrompts: this.bridge?.persistedPrompts,
      bridgeLeases: this.bridge?.persistedLeases,
      bridgeTerminalEvent: this.bridge?.persistedTerminalEvent,
      outline: structuredClone(this.outline),
      currentStepIndex: this.currentStepIndex,
      comments: structuredClone(this.comments),
      messages: structuredClone(this.messages),
      activities: structuredClone(this.activities),
      revision: this.revision,
      status: this.status,
      selection: structuredClone(this.selection),
      agentContinuation: this.selection && this.agent
        ? this.agent.continuation(this.selection.adapterId) ?? this.agentContinuation
        : this.agentContinuation,
      updatedAt: new Date().toISOString(),
    };
  }

  private persist(): Promise<void> {
    if (!this.defaults.stateFile) return Promise.resolve();
    const state = this.persistedState();
    this.persistenceQueue = this.persistenceQueue
      .catch(() => undefined)
      .then(() => savePersistedSession(this.defaults.stateFile!, state));
    return this.persistenceQueue;
  }

  private async persistAgentResult(): Promise<void> {
    const committed = this.bridge?.prepareCommitResponses() ?? [];
    try {
      await this.persist();
    } catch (error) {
      this.bridge?.rollbackCommitResponses(committed);
      throw error;
    }
  }

  private ensureComparisonCurrent(generation: number): void {
    if (this.comparisonGeneration !== generation) {
      throw new ReviewError("The comparison changed while the agent was working. Retry this action against the refreshed diff.");
    }
  }

  get currentComparisonGeneration(): number {
    return this.comparisonGeneration;
  }

  get stateFile(): string | undefined {
    return this.defaults.stateFile;
  }

  private captureMutableState() {
    return {
      outline: structuredClone(this.outline),
      currentStepIndex: this.currentStepIndex,
      comments: structuredClone(this.comments),
      messages: structuredClone(this.messages),
      revision: this.revision,
      status: this.status,
      selection: structuredClone(this.selection),
      agentContinuation: structuredClone(this.agentContinuation),
    };
  }

  private restoreMutableState(state: ReturnType<ReviewSession["captureMutableState"]>, terminalEpoch: number, expectedRevision: number): void {
    if (this.status !== "open" || this.terminalEpoch !== terminalEpoch || this.revision !== expectedRevision) return;
    this.outline = state.outline;
    this.currentStepIndex = state.currentStepIndex;
    this.comments.splice(0, this.comments.length, ...state.comments);
    this.messages.splice(0, this.messages.length, ...state.messages);
    this.revision = state.revision;
    this.selection = state.selection;
    this.agentContinuation = state.agentContinuation;
  }

  private findRow(path: string, side: "old" | "new", line: number): DiffRow | undefined {
    const file = this.comparison.files.find((candidate) => candidate.path === path);
    return file?.hunks
      .flatMap((hunk) => hunk.rows)
      .find((row) => row.kind !== "meta" && (side === "old" ? row.oldLine : row.newLine) === line);
  }

  private recordAgentActivity(
    previousFiles: DiffFile[],
    nextFiles: DiffFile[],
    context: RefreshContext,
    proposal: { patch: string; baselineTree: string; resultTree: string },
  ): void {
    if (!this.activeAgentRequest || !this.selection || context.source !== "agent") return;
    const changes = comparisonChanges(previousFiles, nextFiles);
    if (changes.length === 0 || !proposal.patch.trim()) return;
    const retainedPatchBytes = this.activities.reduce(
      (total, activity) => total + (activity.proposal ? new TextEncoder().encode(activity.proposal.patch).byteLength : 0),
      0,
    );
    if (retainedPatchBytes + new TextEncoder().encode(proposal.patch).byteLength > 16 * 1024 * 1024) {
      throw new ReviewError("Pending and undoable agent changes exceed the 16 MiB session limit. Resolve an existing proposal or split this request.");
    }
    const request = this.activeAgentRequest;
    const now = new Date().toISOString();
    this.activities.push({
      id: crypto.randomUUID(),
      requestMessageId: request.messageId,
      request: request.body,
      stepId: request.stepId,
      adapterId: this.selection.adapterId,
      modelId: this.selection.modelId,
      eventId: context.eventId,
      files: changes,
      verification: context.verification?.trim() || undefined,
      status: "verified",
      changeStatus: "pending",
      proposal,
      createdAt: now,
      updatedAt: now,
    });
  }

  static async create(
    cwd: string,
    base?: string,
    defaults: AgentDefaults = {},
  ): Promise<ReviewSession> {
    const persisted = defaults.resume && defaults.stateFile
      ? await loadPersistedSession(defaults.stateFile)
      : undefined;
    const comparison = await loadComparison(persisted?.repositoryRoot ?? cwd, persisted?.base ?? base);
    if (persisted && (
      comparison.repositoryRoot !== persisted.repositoryRoot ||
      comparison.base !== persisted.base
    )) throw new ReviewError("The persisted review does not match the requested repository comparison.");
    const adapters = await discoverAgentAdapters(comparison.repositoryRoot);
    const attached = defaults.attached || Boolean(persisted?.bridgeToken);
    const bridge = attached ? new AttachedAgentBridge(
      persisted?.bridgeToken,
      persisted?.bridgeSequence,
      persisted?.bridgeTerminalEvent,
      persisted?.bridgePrompts,
      persisted?.bridgeLeases,
    ) : undefined;
    if (bridge) {
      adapters.unshift({
        id: "attached",
        label: "Triggering agent",
        modelDiscovery: "default-only",
        models: [{
          id: "current-session",
          label: "Current agent session",
          isDefault: true,
          reasoningEfforts: [],
        }],
        note: "Questions and tour prompts return to the agent that launched this page.",
      });
    }
    const session = new ReviewSession(comparison, adapters, { ...defaults, attached }, bridge, persisted);
    bridge?.setPersistence(() => session.persist());
    if (bridge && persisted && persisted.status !== "open" && !persisted.bridgeTerminalEvent) {
      bridge.prepareClose(persisted.status, persisted.comments);
    }
    await session.persist();
    if (session.status !== "open") bridge?.publishClose();
    return session;
  }

  private resolveSelection(input: Partial<AgentSelection> = {}): AgentSelection {
    const adapterId = input.adapterId ?? this.defaults.adapterId;
    const requestedAdapter = adapterId
      ? this.agentAdapters.find((candidate) => candidate.id === adapterId)
      : undefined;
    if (adapterId && !requestedAdapter) throw new ReviewError(`Agent adapter is not available: ${adapterId}`);
    const adapter = requestedAdapter ?? this.agentAdapters[0];
    if (!adapter) throw new ReviewError("No supported agent CLI was detected. Install Codex or Claude Code and restart.");

    const requestedModel = input.modelId ?? this.defaults.modelId;
    const requestedModelOption = requestedModel
      ? adapter.models.find((candidate) => candidate.id === requestedModel)
      : undefined;
    if (requestedModel && !requestedModelOption) throw new ReviewError(`${adapter.label} model is not available: ${requestedModel}`);
    const model = requestedModelOption ?? adapter.models.find((candidate) => candidate.isDefault) ?? adapter.models[0];
    if (!model) throw new ReviewError(`${adapter.label} did not report any usable models.`);

    const requestedReasoning = input.reasoningEffort ?? this.defaults.reasoningEffort;
    if (requestedReasoning && !model.reasoningEfforts.includes(requestedReasoning)) {
      throw new ReviewError(`${model.label} does not support ${requestedReasoning} reasoning.`);
    }
    const reasoningEffort = requestedReasoning ?? model.defaultReasoningEffort;
    return { adapterId: adapter.id, modelId: model.id, reasoningEffort };
  }

  snapshot() {
    const { patch: _patch, ...rawComparison } = this.comparison;
    const diffRowCount = rawComparison.files.reduce(
      (total, file) => total + file.hunks.reduce((count, hunk) => count + hunk.rows.length, 0),
      0,
    );
    const diffMode = diffRowCount > 2_500 ? "file" : "full";
    const comparison = {
      ...rawComparison,
      files: diffMode === "file"
        ? rawComparison.files.map((file) => ({ ...file, metadata: [...file.metadata], hunks: [] }))
        : rawComparison.files,
      diffMode,
      diffRowCount,
    };
    return {
      comparison,
      outline: this.outline,
      currentStepIndex: this.currentStepIndex,
      comments: this.comments,
      messages: this.messages,
      activities: this.activities.map(({ proposal, ...activity }) => ({ ...activity, hasProposal: Boolean(proposal) })),
      revision: this.revision,
      status: this.status,
      agentAdapters: this.agentAdapters,
      agentSelection: this.selection ?? (this.agentAdapters.length > 0 ? this.resolveSelection() : undefined),
      agentMode: this.selection ? `${this.selection.adapterId}-read-only` : undefined,
    };
  }

  diffFile(path: string, requestedOffset = 0, requestedLimit = 1_000, anchor?: { line: number; side: "old" | "new" }) {
    const file = this.comparison.files.find((candidate) => candidate.path === path);
    if (!file) throw new ReviewError("Changed file does not exist in this comparison.");
    const limit = Math.max(100, Math.min(2_000, requestedLimit));
    const totalRows = file.hunks.reduce((total, hunk) => total + hunk.rows.length, 0);
    let offset = Math.max(0, Math.min(requestedOffset, Math.max(0, totalRows - 1)));
    if (anchor) {
      let rowIndex = 0;
      let found = -1;
      for (const hunk of file.hunks) {
        const local = hunk.rows.findIndex((row) => (anchor.side === "old" ? row.oldLine : row.newLine) === anchor.line);
        if (local >= 0) {
          found = rowIndex + local;
          break;
        }
        rowIndex += hunk.rows.length;
      }
      if (found >= 0) offset = Math.floor(found / limit) * limit;
    }
    const end = Math.min(totalRows, offset + limit);
    let cursor = 0;
    const hunks = file.hunks.flatMap((hunk) => {
      const startInHunk = Math.max(0, offset - cursor);
      const endInHunk = Math.min(hunk.rows.length, end - cursor);
      cursor += hunk.rows.length;
      if (startInHunk >= endInHunk) return [];
      return [{ ...hunk, rows: hunk.rows.slice(startInHunk, endInHunk) }];
    });
    return { file: structuredClone({ ...file, hunks }), offset, limit, totalRows };
  }

  activityDiff(id: string, path: string) {
    const activity = this.activities.find((candidate) => candidate.id === id);
    if (!activity?.proposal) throw new ReviewError("The proposed change does not exist.");
    const file = parseUnifiedDiff(activity.proposal.patch).find((candidate) => candidate.path === path);
    if (!file) throw new ReviewError("The proposed file does not exist in this change.");
    return { file: structuredClone(file) };
  }

  async updateActivity(id: string, action: "apply" | "reject" | "undo") {
    return this.serializeMutation(async () => {
      this.ensureOpen();
      const activity = this.activities.find((candidate) => candidate.id === id);
      if (!activity?.proposal || !activity.changeStatus) throw new ReviewError("This activity has no actionable change bundle.");
      const proposal = activity.proposal;
      if (action === "apply" && activity.changeStatus !== "pending") throw new ReviewError("Only a pending change can be applied.");
      if (action === "reject" && activity.changeStatus !== "pending") throw new ReviewError("Only a pending change can be rejected.");
      if (action === "undo" && activity.changeStatus !== "applied") throw new ReviewError("Only an applied change can be undone.");

      const previousComparison = this.comparison;
      const previousStatus = activity.changeStatus;
      const previousRevision = this.revision;
      const previousGeneration = this.comparisonGeneration;
      const modifiesWorkingTree = action !== "reject";
      const reverse = action === "undo";
      let patched = false;
      try {
        if (modifiesWorkingTree) {
          await applyChangePatch(this.comparison.repositoryRoot, proposal.patch, reverse);
          patched = true;
        }
        if (modifiesWorkingTree) {
          this.comparison = await loadComparison(this.comparison.repositoryRoot, this.comparison.base);
          this.comparisonGeneration += 1;
        }
        activity.changeStatus = action === "apply" ? "applied" : action === "reject" ? "rejected" : "undone";
        if (action === "reject" || action === "undo") activity.proposal = undefined;
        activity.updatedAt = new Date().toISOString();
        this.revision += 1;
        await this.persist();
        return this.snapshot();
      } catch (error) {
        if (patched) {
          await applyChangePatch(this.comparison.repositoryRoot, proposal.patch, !reverse).catch(() => undefined);
        }
        this.comparison = previousComparison;
        this.comparisonGeneration = previousGeneration;
        activity.changeStatus = previousStatus;
        activity.proposal = proposal;
        this.revision = previousRevision;
        throw error;
      }
    });
  }

  async startTour(selection?: Partial<AgentSelection>) {
    return this.serialize(async () => {
      const before = this.captureMutableState();
      const terminalEpoch = this.terminalEpoch;
      let operationRevision = before.revision;
      const comparisonGeneration = this.comparisonGeneration;
      this.ensureOpen();
      const createdAgent = !this.agent;
      if (!this.agent) {
        this.selection = this.resolveSelection(selection);
        this.agent = new TourAgent(this.comparison.repositoryRoot, this.selection, this.bridge);
      } else if (selection && (
        (selection.adapterId !== undefined && selection.adapterId !== this.selection?.adapterId) ||
        (selection.modelId !== undefined && selection.modelId !== this.selection?.modelId) ||
        (selection.reasoningEffort !== undefined && selection.reasoningEffort !== this.selection?.reasoningEffort)
      )) {
        throw new ReviewError("The agent and model cannot be changed after the tour starts.");
      }
      this.agent.useComparison(this.comparison);
      try {
        if (!this.outline) {
          const outline = await this.agent.createOutline(this.comparison);
          this.ensureComparisonCurrent(comparisonGeneration);
          this.outline = outline;
          this.currentStepIndex = 0;
        } else if (this.currentStepIndex < 0 || this.currentStepIndex >= this.outline.steps.length) {
          this.currentStepIndex = 0;
        }
        this.ensureOpen();
        const step = this.outline.steps[this.currentStepIndex];
        if (!step.explanation) {
          const explanation = await this.agent.explainStep(step, this.currentStepIndex, this.outline.steps.length);
          this.ensureComparisonCurrent(comparisonGeneration);
          step.explanation = explanation;
        }
        this.ensureOpen();
        this.revision += 1;
        operationRevision = this.revision;
        await this.persistAgentResult();
        return this.snapshot();
      } catch (error) {
        this.restoreMutableState(before, terminalEpoch, operationRevision);
        if (createdAgent && !this.outline && this.status === "open") {
          this.agent = undefined;
          this.selection = undefined;
        }
        throw error;
      }
    });
  }

  async navigate(direction: "previous" | "next") {
    return this.serialize(async () => {
      const before = this.captureMutableState();
      const terminalEpoch = this.terminalEpoch;
      let operationRevision = before.revision;
      const comparisonGeneration = this.comparisonGeneration;
      try {
      this.ensureOpen();
      if (!this.outline || !this.agent) throw new ReviewError("Start the tour first.");
      this.agent.useComparison(this.comparison);
      const delta = direction === "next" ? 1 : -1;
      const index = Math.max(0, Math.min(this.outline.steps.length - 1, this.currentStepIndex + delta));
      const step = this.outline.steps[index];
      if (!step.explanation) {
        const explanation = await this.agent.explainStep(step, index, this.outline.steps.length);
        this.ensureComparisonCurrent(comparisonGeneration);
        step.explanation = explanation;
      }
      this.ensureOpen();
      this.currentStepIndex = index;
      this.revision += 1;
      operationRevision = this.revision;
      await this.persistAgentResult();
      return this.snapshot();
      } catch (error) {
        this.restoreMutableState(before, terminalEpoch, operationRevision);
        throw error;
      }
    });
  }

  async ask(body: string, selectedContext?: string) {
    return this.serialize(async () => {
      const before = this.captureMutableState();
      const terminalEpoch = this.terminalEpoch;
      let operationRevision = before.revision;
      const comparisonGeneration = this.comparisonGeneration;
      this.ensureOpen();
      if (!body.trim()) throw new ReviewError("Question cannot be empty.");
      const createdAgent = !this.agent;
      if (!this.agent) {
        this.selection = this.resolveSelection();
        this.agent = new TourAgent(this.comparison.repositoryRoot, this.selection, this.bridge);
      }
      this.agent.useComparison(this.comparison);
      const step = this.outline?.steps[this.currentStepIndex];
      const stepId = step?.id;
      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        body,
        stepId,
        createdAt: new Date().toISOString(),
      };
      let proposalWorkspace: ProposalWorkspace | undefined;
      try {
        if (this.selection?.adapterId === "attached") {
          proposalWorkspace = await createProposalWorkspace(this.comparison.repositoryRoot);
          this.activeAgentRequest = {
            messageId: userMessage.id,
            body: userMessage.body,
            stepId,
            workspace: proposalWorkspace,
            baselineComparison: structuredClone(this.comparison),
          };
        }
        const answer = await this.agent.answer(body, selectedContext, step, proposalWorkspace?.path);
        const authorizedGeneration = this.bridge?.consumeResponseRefreshAuthorization();
        if (this.comparisonGeneration !== comparisonGeneration && !(
          this.selection?.adapterId === "attached" && authorizedGeneration === this.comparisonGeneration
        )) {
          this.ensureComparisonCurrent(comparisonGeneration);
        }
        this.ensureOpen();
        this.messages.push(userMessage);
        this.messages.push({ id: crypto.randomUUID(), role: "agent", body: answer, stepId, createdAt: new Date().toISOString() });
        this.revision += 1;
        operationRevision = this.revision;
        await this.persistAgentResult();
        return this.snapshot();
      } catch (error) {
        this.restoreMutableState(before, terminalEpoch, operationRevision);
        if (createdAgent) this.agent = undefined;
        throw error;
      } finally {
        if (this.activeAgentRequest?.messageId === userMessage.id) this.activeAgentRequest = undefined;
        if (proposalWorkspace) await removeProposalWorkspace(this.comparison.repositoryRoot, proposalWorkspace);
      }
    });
  }

  async addComment(input: { path: string; side: "old" | "new"; line: number; body: string }) {
    return this.serializeMutation(async () => {
    const before = this.captureMutableState();
    const terminalEpoch = this.terminalEpoch;
    let operationRevision = before.revision;
    try {
    this.ensureOpen();
    const body = input.body.trim();
    if (!body) throw new ReviewError("Comment cannot be empty.");
    const row = this.findRow(input.path, input.side, input.line);
    if (!row) throw new ReviewError("Comment anchor does not exist in the current diff.");
    const timestamp = new Date().toISOString();
    this.comments.push({
      ...input,
      body,
      lineContent: row.content,
      status: "active",
      id: crypto.randomUUID(),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    this.revision += 1;
    operationRevision = this.revision;
    await this.persist();
    return this.snapshot();
    } catch (error) {
      this.restoreMutableState(before, terminalEpoch, operationRevision);
      throw error;
    }
    });
  }

  async updateComment(id: string, body: string) {
    return this.serializeMutation(async () => {
    const before = this.captureMutableState();
    const terminalEpoch = this.terminalEpoch;
    let operationRevision = before.revision;
    try {
    this.ensureOpen();
    const comment = this.comments.find((candidate) => candidate.id === id);
    if (!comment) throw new ReviewError(`Review comment does not exist: ${id}`);
    const nextBody = body.trim();
    if (!nextBody) throw new ReviewError("Comment cannot be empty.");
    comment.body = nextBody;
    comment.updatedAt = new Date().toISOString();
    this.revision += 1;
    operationRevision = this.revision;
    await this.persist();
    return this.snapshot();
    } catch (error) {
      this.restoreMutableState(before, terminalEpoch, operationRevision);
      throw error;
    }
    });
  }

  async removeComment(id: string) {
    return this.serializeMutation(async () => {
    const before = this.captureMutableState();
    const terminalEpoch = this.terminalEpoch;
    let operationRevision = before.revision;
    try {
    this.ensureOpen();
    const index = this.comments.findIndex((candidate) => candidate.id === id);
    if (index < 0) throw new ReviewError(`Review comment does not exist: ${id}`);
    this.comments.splice(index, 1);
    for (const finding of this.outline?.findings ?? []) {
      if (finding.commentId === id) {
        finding.commentId = undefined;
        finding.status = "open";
      }
    }
    this.revision += 1;
    operationRevision = this.revision;
    await this.persist();
    return this.snapshot();
    } catch (error) {
      this.restoreMutableState(before, terminalEpoch, operationRevision);
      throw error;
    }
    });
  }

  async updateFinding(id: string, action: "dismiss" | "reopen" | "convert") {
    return this.serializeMutation(async () => {
    const before = this.captureMutableState();
    const terminalEpoch = this.terminalEpoch;
    let operationRevision = before.revision;
    try {
    this.ensureOpen();
    const finding = this.outline?.findings.find((candidate) => candidate.id === id);
    if (!finding) throw new ReviewError(`Review finding does not exist: ${id}`);
    if (finding.status === "converted-to-feedback" && action !== "convert") {
      throw new ReviewError("A finding already converted to feedback cannot change state.");
    }
    if (action === "dismiss") finding.status = "dismissed";
    if (action === "reopen") {
      if (finding.status !== "dismissed") throw new ReviewError("Only a dismissed finding can be reopened.");
      finding.status = "open";
    }
    if (action === "convert") {
      if (finding.outdated) throw new ReviewError("Refresh or re-anchor this outdated finding before converting it to feedback.");
      if (finding.status !== "converted-to-feedback") {
        const row = this.findRow(finding.path, finding.side, finding.line);
        if (!row) throw new ReviewError("Finding anchor does not exist in the current diff.");
        const timestamp = new Date().toISOString();
        const commentId = crypto.randomUUID();
        this.comments.push({
          id: commentId,
          path: finding.path,
          side: finding.side,
          line: finding.line,
          body: `[${finding.priority}] ${finding.message}`,
          lineContent: row.content,
          status: "active",
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        finding.status = "converted-to-feedback";
        finding.commentId = commentId;
      }
    }
    this.revision += 1;
    operationRevision = this.revision;
    await this.persist();
    return this.snapshot();
    } catch (error) {
      this.restoreMutableState(before, terminalEpoch, operationRevision);
      throw error;
    }
    });
  }

  async refreshComparison(context: RefreshContext = { source: "manual" }) {
    if (context.source === "watcher" && this.activeAgentRequest) return this.snapshot();
    const operation = this.refreshQueue.then(() => this.serializeMutation(async () => {
      this.ensureOpen();
      const activeRequest = context.source === "agent" ? this.activeAgentRequest : undefined;
      if (context.source === "agent" && !activeRequest) throw new ReviewError("No attached-agent change request is active.");
      const replayed = context.eventId && this.activities.find((activity) => activity.eventId === context.eventId);
      if (replayed) return this.snapshot();

      let refreshed: Awaited<ReturnType<typeof loadComparison>>;
      let proposed: Awaited<ReturnType<typeof loadComparison>> | undefined;
      let proposal: { patch: string; baselineTree: string; resultTree: string } | undefined;
      if (activeRequest) {
        const currentReviewedTree = await captureWorkingTreeSnapshot(this.comparison.repositoryRoot);
        if (currentReviewedTree.tree !== activeRequest.workspace.tree || currentReviewedTree.indexTree !== activeRequest.workspace.indexTree) {
          throw new ReviewError("The reviewed working tree changed while the agent was preparing its proposal. The original files were not touched; retry the request against the latest state.");
        }
        const result = await captureWorkingTreeSnapshot(activeRequest.workspace.path);
        const patch = await createChangePatch(activeRequest.workspace.path, activeRequest.workspace.tree, result.tree);
        proposed = await loadComparison(activeRequest.workspace.path, this.comparison.base);
        proposal = { patch, baselineTree: activeRequest.workspace.tree, resultTree: result.tree };
        refreshed = await loadComparison(this.comparison.repositoryRoot, this.comparison.base);
      } else {
        refreshed = await loadComparison(this.comparison.repositoryRoot, this.comparison.base);
      }
      this.ensureOpen();
      const before = this.captureMutableState();
      const terminalEpoch = this.terminalEpoch;
      let operationRevision = before.revision;
      const previousComparison = this.comparison;
      const previousGeneration = this.comparisonGeneration;
      const previousActivities = structuredClone(this.activities);
      try {
      this.comparison = refreshed;
      this.comparisonGeneration += 1;
      this.revision += 1;
      operationRevision = this.revision;
      for (const comment of this.comments) {
        const row = this.findRow(comment.path, comment.side, comment.line);
        comment.status = row?.content === comment.lineContent ? "active" : "outdated";
      }
      for (const step of this.outline?.steps ?? []) {
        step.outdated = !this.findRow(step.anchor.path, step.anchor.side, step.anchor.startLine);
      }
      for (const finding of this.outline?.findings ?? []) {
        const row = this.findRow(finding.path, finding.side, finding.line);
        finding.outdated = row?.content !== finding.lineContent;
      }
      if (proposal && proposed && activeRequest) {
        this.recordAgentActivity(activeRequest.baselineComparison.files, proposed.files, context, proposal);
      }
      await this.persist();
      return this.snapshot();
      } catch (error) {
        if (this.status === "open" && this.terminalEpoch === terminalEpoch) {
          this.comparison = previousComparison;
          this.comparisonGeneration = previousGeneration;
          this.activities.splice(0, this.activities.length, ...previousActivities);
        }
        this.restoreMutableState(before, terminalEpoch, operationRevision);
        throw error;
      }
    }));
    this.refreshQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async close(outcome: ReviewOutcome) {
    if (this.closePromise) {
      const result = await this.closePromise;
      if (result.outcome !== outcome) throw new ReviewError(`The review already closed as ${result.outcome}.`);
      return result;
    }
    if (this.status !== "open") {
      if (this.status !== outcome) throw new ReviewError(`The review already closed as ${this.status}.`);
      return { outcome, comments: this.comments, status: this.status };
    }
    if (outcome !== "cancelled" && this.activities.some((activity) => activity.changeStatus === "pending")) {
      throw new ReviewError("Apply or reject every pending agent change before closing the review.");
    }
    if (outcome === "accepted" && this.comments.length > 0) {
      throw new ReviewError("Resolve or remove feedback before accepting, or close with feedback.");
    }
    this.closePromise = (async () => {
      const previousRevision = this.revision;
      this.terminalEpoch += 1;
      this.status = outcome;
      this.revision += 1;
      this.agent?.cancel();
      const terminal = this.bridge?.prepareClose(outcome, this.comments);
      try {
        await this.persist();
      } catch (error) {
        if (terminal) this.bridge?.rollbackPreparedClose(terminal.id);
        this.status = "open";
        this.revision = previousRevision;
        this.agent = this.selection
          ? new TourAgent(this.comparison.repositoryRoot, this.selection, this.bridge, this.agentContinuation)
          : undefined;
        this.closePromise = undefined;
        throw error;
      }
      this.bridge?.publishClose();
      this.resolveClosed(outcome);
      return { outcome, comments: this.comments, status: this.status };
    })();
    return this.closePromise;
  }

  async dispose(): Promise<void> {
    this.agent?.cancel();
    this.bridge?.dispose();
    await this.persistenceQueue.catch(() => undefined);
  }
}
