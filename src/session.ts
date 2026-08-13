import { discoverAgentAdapters } from "./adapters.ts";
import { ReviewError } from "./errors.ts";
import { TourAgent } from "./agent.ts";
import { validateReviewFlow } from "./flows.ts";
import { validateCallFlows } from "./call-flows.ts";
import { AttachedAgentBridge } from "./bridge.ts";
import { applyChangePatch, captureWorkingTreeSnapshot, createChangePatch, createProposalWorkspace, loadComparison, loadDiffFileWithContext, removeProposalWorkspace, type ProposalWorkspace } from "./git.ts";
import { parseUnifiedDiff } from "./diff.ts";
import { DEFAULT_REVIEW_POLICY, DEFAULT_REVIEW_PREFERENCES } from "./config.ts";
import { publishPullRequestReview as publishGitHubReview, updatePullRequestWorkspace, type GitHubRunner } from "./github.ts";
import { runProcess } from "./process.ts";
import { loadPersistedSession, savePersistedSession } from "./store.ts";
import { tourSteps } from "./tour.ts";
import type { AgentAdapterOption, AgentChangeActivity, AgentChangeFile, AgentRunActivity, AgentSelection, ChatMessage, DiffFile, DiffRow, PersistedReviewSession, PullRequestContext, ReasoningEffort, ReviewComment, ReviewFlow, ReviewOutcome, ReviewPolicy, ReviewPreferences, ReviewStatus, TourOutline } from "./types.ts";

interface AgentDefaults {
  adapterId?: string;
  modelId?: string;
  reasoningEffort?: ReasoningEffort;
  callerModel?: string;
  callerReasoningEffort?: ReasoningEffort;
  attached?: boolean;
  stateFile?: string;
  resume?: boolean;
  preferences?: ReviewPreferences;
  reviewPolicy?: ReviewPolicy;
  includeFindings?: boolean;
  pullRequest?: PullRequestContext;
  githubRunner?: GitHubRunner;
  agentAdapters?: AgentAdapterOption[];
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
  readonly reviewedFiles: Set<string>;
  readonly browserToken: string;
  readonly preferences: ReviewPreferences;
  readonly reviewPolicy: ReviewPolicy;
  pullRequest?: PullRequestContext;
  outline?: TourOutline;
  currentStepIndex = -1;
  revision = 1;
  status: ReviewStatus = "open";
  private agent?: TourAgent;
  private selection?: AgentSelection;
  private agentContinuation?: PersistedReviewSession["agentContinuation"];
  private tourPlanning = false;
  private agentActivity?: AgentRunActivity;
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
    this.preferences = structuredClone(persisted?.preferences ?? defaults.preferences ?? DEFAULT_REVIEW_PREFERENCES);
    this.reviewPolicy = structuredClone(persisted?.reviewPolicy ?? defaults.reviewPolicy ?? DEFAULT_REVIEW_POLICY);
    this.pullRequest = structuredClone(persisted?.pullRequest ?? defaults.pullRequest);
    this.comments = structuredClone(persisted?.comments ?? []);
    this.messages = structuredClone(persisted?.messages ?? []);
    this.activities = structuredClone(persisted?.activities ?? []);
    const changedPaths = new Set(this.comparison.files.map((file) => file.path));
    this.reviewedFiles = new Set((persisted?.reviewedFiles ?? []).filter((path) => changedPaths.has(path)));
    this.sessionName = persisted?.name;
    this.archived = persisted?.archived ?? false;
    this.outline = persisted?.outline
      ? { ...structuredClone(persisted.outline), callFlows: validateCallFlows(persisted.outline.callFlows ?? [], this.comparison), flows: persisted.outline.flows ?? [], findings: persisted.outline.findings ?? [] }
      : undefined;
    this.currentStepIndex = persisted?.currentStepIndex ?? -1;
    this.revision = persisted?.revision ?? 1;
    this.status = persisted?.status ?? "open";
    this.selection = persisted?.selection
      ? { ...structuredClone(persisted.selection), includeFindings: defaults.includeFindings === false ? false : persisted.selection.includeFindings }
      : undefined;
    this.agentContinuation = structuredClone(persisted?.agentContinuation);
    if (this.status === "open" && this.selection) {
      this.agent = this.createAgent(this.agentContinuation);
    }
    if (this.status !== "open") queueMicrotask(() => this.resolveClosed(this.status as ReviewOutcome));
  }

  private ensureOpen(): void {
    if (this.status !== "open") throw new ReviewError(`The review is closed (${this.status}).`);
  }

  private ensurePublicationMutable(): void {
    if (this.pullRequest?.publication) {
      throw new ReviewError("A GitHub review publication has started. Retry it before changing comments or refreshing the pull request.");
    }
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
      schemaVersion: 2,
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
      reviewedFiles: [...this.reviewedFiles].sort(),
      preferences: structuredClone(this.preferences),
      reviewPolicy: structuredClone(this.reviewPolicy),
      findingGenerationEnabled: this.defaults.includeFindings !== false,
      pullRequest: structuredClone(this.pullRequest),
      revision: this.revision,
      status: this.status,
      selection: structuredClone(this.selection),
      agentContinuation: this.selection && this.agent
        ? this.agent.continuation() ?? this.agentContinuation
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
      reviewedFiles: [...this.reviewedFiles],
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
    this.reviewedFiles.clear();
    for (const path of state.reviewedFiles) this.reviewedFiles.add(path);
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
    const includeFindings = defaults.includeFindings === false
      ? false
      : persisted?.findingGenerationEnabled ?? defaults.includeFindings;
    const preferences = persisted?.preferences ?? defaults.preferences ?? DEFAULT_REVIEW_PREFERENCES;
    const comparison = await loadComparison(persisted?.repositoryRoot ?? cwd, persisted?.base ?? base, preferences.contextLines);
    if (persisted && (
      comparison.repositoryRoot !== persisted.repositoryRoot ||
      comparison.base !== persisted.base
    )) throw new ReviewError("The persisted review does not match the requested repository comparison.");
    const adapters = structuredClone(defaults.agentAdapters ?? await discoverAgentAdapters(comparison.repositoryRoot));
    const attached = defaults.attached || Boolean(persisted?.bridgeToken);
    const bridge = attached ? new AttachedAgentBridge(
      persisted?.bridgeToken,
      persisted?.bridgeSequence,
      persisted?.bridgeTerminalEvent,
      persisted?.bridgePrompts,
      persisted?.bridgeLeases,
    ) : undefined;
    if (bridge) {
      const persistedAttachedSelection = persisted?.selection?.adapterId === "attached" ? persisted.selection : undefined;
      const callerModel = defaults.callerModel?.trim() || persistedAttachedSelection?.modelId || "current-session";
      const callerReasoning = defaults.callerReasoningEffort ?? persistedAttachedSelection?.reasoningEffort;
      adapters.unshift({
        id: "attached",
        label: "Triggering agent",
        modelDiscovery: "default-only",
        models: [{
          id: callerModel,
          label: callerModel === "current-session" ? "Current agent session" : `${callerModel} · current session`,
          isDefault: true,
          reasoningEfforts: callerReasoning ? [callerReasoning] : [],
          defaultReasoningEffort: callerReasoning,
        }],
        note: callerReasoning
          ? `Questions and tour prompts return to the launching agent (${callerModel}, ${callerReasoning} effort).`
          : `Questions and tour prompts return to the launching agent${callerModel === "current-session" ? "." : ` (${callerModel}).`}`,
      });
    }
    const session = new ReviewSession(comparison, adapters, { ...defaults, attached, preferences, includeFindings }, bridge, persisted);
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
    if (!adapter) throw new ReviewError("No supported agent CLI was detected. Install Codex, Claude Code, Gemini, or Copilot and restart.");

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
    return {
      adapterId: adapter.id,
      modelId: model.id,
      reasoningEffort,
      includeArchitecture: input.includeArchitecture ?? true,
      includeCallFlows: input.includeCallFlows ?? true,
      includeFlows: input.includeFlows ?? true,
      includeFindings: this.defaults.includeFindings === false ? false : input.includeFindings ?? true,
    };
  }

  private resolveFallbackSelection(): AgentSelection | undefined {
    if (this.selection?.adapterId !== "attached") return undefined;
    const standalone = this.agentAdapters.filter((adapter) => adapter.id !== "attached");
    if (standalone.length === 0) return undefined;
    const callerModel = this.selection.modelId.toLowerCase();
    const exactAdapter = standalone.find((adapter) => adapter.models.some((model) => model.id.toLowerCase() === callerModel));
    const namedAdapter = standalone.find((adapter) => callerModel.includes(adapter.id));
    const adapter = exactAdapter ?? namedAdapter ?? standalone.find((candidate) => candidate.id === "codex") ?? standalone[0]!;
    const model = adapter.models.find((candidate) => candidate.id.toLowerCase() === callerModel)
      ?? adapter.models.find((candidate) => candidate.isDefault)
      ?? adapter.models[0];
    if (!model) return undefined;
    const requestedReasoning = this.selection.reasoningEffort;
    const reasoningEffort = requestedReasoning && model.reasoningEfforts.includes(requestedReasoning)
      ? requestedReasoning
      : model.defaultReasoningEffort;
    return {
      adapterId: adapter.id,
      modelId: model.id,
      reasoningEffort,
      includeArchitecture: this.selection.includeArchitecture,
      includeCallFlows: this.selection.includeCallFlows,
      includeFlows: this.selection.includeFlows,
      includeFindings: this.selection.includeFindings,
    };
  }

  private createAgent(continuation?: PersistedReviewSession["agentContinuation"]): TourAgent {
    if (!this.selection) throw new ReviewError("Select a tour agent before starting the tour.");
    return new TourAgent(
      this.comparison.repositoryRoot,
      this.selection,
      this.bridge,
      continuation,
      (activity) => { this.agentActivity = activity; },
      this.resolveFallbackSelection(),
    );
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
      reviewedFiles: [...this.reviewedFiles].sort(),
      preferences: structuredClone(this.preferences),
      reviewPolicy: structuredClone(this.reviewPolicy),
      findingGenerationEnabled: this.defaults.includeFindings !== false,
      pullRequest: structuredClone(this.pullRequest),
      revision: this.revision,
      status: this.status,
      agentAdapters: this.agentAdapters,
      agentSelection: this.selection ?? (this.agentAdapters.length > 0 ? this.resolveSelection() : undefined),
      agentMode: this.selection ? `${this.selection.adapterId}-read-only` : undefined,
      agentActivity: structuredClone(this.agentActivity),
      tourState: this.outline ? "active" as const : this.tourPlanning ? "planning" as const : "idle" as const,
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

  async expandedDiffFile(path: string, context: number, requestedOffset = 0, requestedLimit = 1_000, fullFile = false) {
    const file = await loadDiffFileWithContext(this.comparison, path, context, fullFile);
    return this.pageDiffFile(file, requestedOffset, requestedLimit);
  }

  private pageDiffFile(file: DiffFile, requestedOffset = 0, requestedLimit = 1_000, anchor?: { line: number; side: "old" | "new" }) {
    const limit = Math.max(100, Math.min(2_000, requestedLimit));
    const totalRows = file.hunks.reduce((total, hunk) => total + hunk.rows.length, 0);
    let offset = Math.max(0, Math.min(requestedOffset, Math.max(0, totalRows - 1)));
    if (anchor) {
      let rowIndex = 0;
      for (const hunk of file.hunks) {
        const local = hunk.rows.findIndex((row) => (anchor.side === "old" ? row.oldLine : row.newLine) === anchor.line);
        if (local >= 0) { offset = Math.floor((rowIndex + local) / limit) * limit; break; }
        rowIndex += hunk.rows.length;
      }
    }
    const end = Math.min(totalRows, offset + limit);
    let cursor = 0;
    const hunks = file.hunks.flatMap((hunk) => {
      const startInHunk = Math.max(0, offset - cursor);
      const endInHunk = Math.min(hunk.rows.length, end - cursor);
      cursor += hunk.rows.length;
      return startInHunk < endInHunk ? [{ ...hunk, rows: hunk.rows.slice(startInHunk, endInHunk) }] : [];
    });
    return { file: structuredClone({ ...file, hunks }), offset, limit, totalRows };
  }

  searchDiff(query: string, statuses: DiffFile["status"][] = []) {
    const needle = query.trim().toLocaleLowerCase();
    const allowed = new Set(statuses);
    const matches = this.comparison.files.filter((file) => {
      if (allowed.size > 0 && !allowed.has(file.status)) return false;
      if (!needle) return true;
      return file.path.toLocaleLowerCase().includes(needle) || file.oldPath?.toLocaleLowerCase().includes(needle) ||
        file.metadata.some((line) => line.toLocaleLowerCase().includes(needle)) ||
        file.hunks.some((hunk) => hunk.rows.some((row) => row.content.toLocaleLowerCase().includes(needle)));
    });
    return { paths: matches.map((file) => file.path), count: matches.length };
  }

  async setFileReviewed(path: string, reviewed: boolean) {
    return this.serializeMutation(async () => {
      this.ensureOpen();
      if (!this.comparison.files.some((file) => file.path === path)) throw new ReviewError("Changed file does not exist in this comparison.");
      const wasReviewed = this.reviewedFiles.has(path);
      const previousRevision = this.revision;
      if (reviewed) this.reviewedFiles.add(path); else this.reviewedFiles.delete(path);
      this.revision += 1;
      try {
        await this.persist();
        return this.snapshot();
      } catch (error) {
        if (wasReviewed) this.reviewedFiles.add(path); else this.reviewedFiles.delete(path);
        this.revision = previousRevision;
        throw error;
      }
    });
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
          this.comparison = await loadComparison(this.comparison.repositoryRoot, this.comparison.base, this.preferences.contextLines);
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

  private scheduleNextStepPrefetch(): void {
    void this.serialize(async () => {
      this.ensureOpen();
      if (!this.outline || !this.agent) return;
      const steps = tourSteps(this.outline);
      const windowEnd = Math.min(steps.length - 1, this.currentStepIndex + this.preferences.prefetchSteps);
      const index = steps.findIndex((candidate, candidateIndex) => (
        candidateIndex > this.currentStepIndex && candidateIndex <= windowEnd && !candidate.explanation
      ));
      const step = steps[index];
      if (!step) return;
      const comparisonGeneration = this.comparisonGeneration;
      this.agent.useComparison(this.comparison);
      const explanation = await this.agent.explainStep(step, index, steps.length);
      this.ensureOpen();
      this.ensureComparisonCurrent(comparisonGeneration);
      if (step.explanation) return;
      const previousRevision = this.revision;
      step.explanation = explanation;
      this.revision += 1;
      try {
        await this.persistAgentResult();
        this.scheduleNextStepPrefetch();
      } catch (error) {
        if (step.explanation === explanation && this.revision === previousRevision + 1) {
          step.explanation = undefined;
          this.revision = previousRevision;
        }
        throw error;
      }
    }).catch(() => undefined);
  }

  private navigateToPreparedStep(direction: "previous" | "next", expectedCurrentStepIndex: number, targetIndex: number) {
    return this.serializeMutation(async () => {
      const before = this.captureMutableState();
      const terminalEpoch = this.terminalEpoch;
      let operationRevision = before.revision;
      try {
        this.ensureOpen();
        if (!this.outline || !this.agent) throw new ReviewError("Start the tour first.");
        if (this.currentStepIndex !== expectedCurrentStepIndex) return this.snapshot();
        const steps = tourSteps(this.outline);
        const expectedTarget = Math.max(0, Math.min(steps.length - 1, expectedCurrentStepIndex + (direction === "next" ? 1 : -1)));
        const step = steps[targetIndex];
        if (targetIndex !== expectedTarget || !step?.explanation) return this.snapshot();
        this.currentStepIndex = targetIndex;
        this.revision += 1;
        operationRevision = this.revision;
        await this.persist();
        this.scheduleNextStepPrefetch();
        return this.snapshot();
      } catch (error) {
        this.restoreMutableState(before, terminalEpoch, operationRevision);
        throw error;
      }
    });
  }

  async setPrefetchSteps(prefetchSteps: number) {
    return this.serializeMutation(async () => {
      this.ensureOpen();
      if (!Number.isInteger(prefetchSteps) || prefetchSteps < 0 || prefetchSteps > 4) {
        throw new ReviewError("Prepare ahead must be between 0 and 4 steps.");
      }
      if (this.preferences.prefetchSteps === prefetchSteps) return this.snapshot();
      const previous = this.preferences.prefetchSteps;
      const previousRevision = this.revision;
      this.preferences.prefetchSteps = prefetchSteps;
      this.revision += 1;
      try {
        await this.persist();
      } catch (error) {
        this.preferences.prefetchSteps = previous;
        this.revision = previousRevision;
        throw error;
      }
      this.scheduleNextStepPrefetch();
      return this.snapshot();
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
        this.agent = this.createAgent();
      } else if (selection && (
        (selection.adapterId !== undefined && selection.adapterId !== this.selection?.adapterId) ||
        (selection.modelId !== undefined && selection.modelId !== this.selection?.modelId) ||
        (selection.reasoningEffort !== undefined && selection.reasoningEffort !== this.selection?.reasoningEffort) ||
        (selection.includeArchitecture !== undefined && selection.includeArchitecture !== this.selection?.includeArchitecture) ||
        (selection.includeCallFlows !== undefined && selection.includeCallFlows !== this.selection?.includeCallFlows) ||
        (selection.includeFlows !== undefined && selection.includeFlows !== this.selection?.includeFlows) ||
        (selection.includeFindings !== undefined && selection.includeFindings !== this.selection?.includeFindings)
      )) {
        throw new ReviewError("The agent and model cannot be changed after the tour starts.");
      }
      this.agent.useComparison(this.comparison);
      this.tourPlanning = true;
      try {
        if (!this.outline) {
          const outline = await this.agent.createOutline(
            this.comparison,
            this.reviewPolicy,
            () => this.ensureComparisonCurrent(comparisonGeneration),
          );
          this.ensureComparisonCurrent(comparisonGeneration);
          this.outline = outline;
          this.currentStepIndex = 0;
        } else if (this.currentStepIndex < 0 || this.currentStepIndex >= tourSteps(this.outline).length) {
          this.currentStepIndex = 0;
        }
        this.ensureOpen();
        const steps = tourSteps(this.outline);
        const step = steps[this.currentStepIndex]!;
        if (!step.explanation) {
          const explanation = await this.agent.explainStep(step, this.currentStepIndex, steps.length);
          this.ensureComparisonCurrent(comparisonGeneration);
          step.explanation = explanation;
        }
        this.ensureOpen();
        this.revision += 1;
        operationRevision = this.revision;
        await this.persistAgentResult();
        this.scheduleNextStepPrefetch();
        return this.snapshot();
      } catch (error) {
        this.restoreMutableState(before, terminalEpoch, operationRevision);
        if (createdAgent && !this.outline && this.status === "open") {
          this.agent = undefined;
          this.selection = undefined;
        }
        throw error;
      } finally {
        this.tourPlanning = false;
      }
    });
  }

  async navigate(direction: "previous" | "next") {
    if (this.outline && this.agent) {
      const expectedCurrentStepIndex = this.currentStepIndex;
      const steps = tourSteps(this.outline);
      const targetIndex = Math.max(0, Math.min(steps.length - 1, expectedCurrentStepIndex + (direction === "next" ? 1 : -1)));
      if (steps[targetIndex]?.explanation) {
        return this.navigateToPreparedStep(direction, expectedCurrentStepIndex, targetIndex);
      }
    }
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
      const steps = tourSteps(this.outline);
      const index = Math.max(0, Math.min(steps.length - 1, this.currentStepIndex + delta));
      const step = steps[index]!;
      if (!step.explanation) {
        const explanation = await this.agent.explainStep(step, index, steps.length);
        this.ensureComparisonCurrent(comparisonGeneration);
        step.explanation = explanation;
      }
      this.ensureOpen();
      this.currentStepIndex = index;
      this.revision += 1;
      operationRevision = this.revision;
      await this.persistAgentResult();
      this.scheduleNextStepPrefetch();
      return this.snapshot();
      } catch (error) {
        this.restoreMutableState(before, terminalEpoch, operationRevision);
        throw error;
      }
    });
  }

  async updateFlow(id: string, input: Omit<ReviewFlow, "id">) {
    return this.serializeMutation(async () => {
      this.ensureOpen();
      if (!this.outline) throw new ReviewError("Start the tour first.");
      const index = this.outline.flows.findIndex((flow) => flow.id === id);
      if (index < 0) throw new ReviewError("The flow does not exist.");
      let flow: ReviewFlow;
      try {
        flow = validateReviewFlow({ id, ...input });
        if (flow.affectedFiles?.some((path) => !this.comparison.files.some((file) => file.path === path))) {
          throw new Error("Flow affectedFiles must reference changed files in this comparison.");
        }
      } catch (error) {
        throw new ReviewError(error instanceof Error ? error.message : String(error));
      }
      const previous = this.outline.flows[index]!;
      const previousRevision = this.revision;
      this.outline.flows[index] = flow;
      this.revision += 1;
      try {
        await this.persist();
        return this.snapshot();
      } catch (error) {
        this.outline.flows[index] = previous;
        this.revision = previousRevision;
        throw error;
      }
    });
  }

  async regenerateFlows(id?: string) {
    return this.serialize(async () => {
      const before = this.captureMutableState();
      const terminalEpoch = this.terminalEpoch;
      let operationRevision = before.revision;
      const comparisonGeneration = this.comparisonGeneration;
      try {
        this.ensureOpen();
        if (!this.outline || !this.agent) throw new ReviewError("Start the tour first.");
        this.agent.useComparison(this.comparison);
        const generated = await this.agent.regenerateFlows(this.comparison, this.outline.flows, id);
        this.ensureComparisonCurrent(comparisonGeneration);
        if (this.revision !== before.revision) throw new ReviewError("The review changed while flows were being regenerated. Retry against the latest session.");
        if (id) {
          const index = this.outline.flows.findIndex((flow) => flow.id === id);
          if (index < 0 || generated.length !== 1) throw new ReviewError("The regenerated flow is invalid.");
          this.outline.flows[index] = generated[0]!;
        } else {
          this.outline.flows = generated;
        }
        this.ensureOpen();
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

  async regenerateCallFlows(id?: string) {
    return this.serialize(async () => {
      const before = this.captureMutableState();
      const terminalEpoch = this.terminalEpoch;
      let operationRevision = before.revision;
      const comparisonGeneration = this.comparisonGeneration;
      try {
        this.ensureOpen();
        if (!this.outline || !this.agent) throw new ReviewError("Start the tour first.");
        this.agent.useComparison(this.comparison);
        const generated = await this.agent.regenerateCallFlows(this.comparison, this.outline.callFlows, id);
        this.ensureComparisonCurrent(comparisonGeneration);
        if (this.revision !== before.revision) throw new ReviewError("The review changed while call flows were being regenerated. Retry against the latest session.");
        if (id) {
          const index = this.outline.callFlows.findIndex((flow) => flow.id === id);
          if (index < 0 || generated.length !== 1) throw new ReviewError("The regenerated call flow is invalid.");
          this.outline.callFlows[index] = generated[0]!;
        } else {
          this.outline.callFlows = generated;
        }
        this.ensureOpen();
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
        this.agent = this.createAgent();
      }
      this.agent.useComparison(this.comparison);
      const step = tourSteps(this.outline)[this.currentStepIndex];
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
    this.ensurePublicationMutable();
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
      publishToGitHub: Boolean(this.pullRequest),
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
    this.ensurePublicationMutable();
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

  async setCommentPublication(id: string, publish: boolean) {
    return this.serializeMutation(async () => {
      this.ensureOpen();
      this.ensurePublicationMutable();
      if (!this.pullRequest) throw new ReviewError("This is not a GitHub pull request review.");
      const comment = this.comments.find((candidate) => candidate.id === id);
      if (!comment) throw new ReviewError(`Review comment does not exist: ${id}`);
      const previous = comment.publishToGitHub;
      const previousRevision = this.revision;
      comment.publishToGitHub = publish;
      this.revision += 1;
      try { await this.persist(); return this.snapshot(); } catch (error) {
        comment.publishToGitHub = previous;
        this.revision = previousRevision;
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
    this.ensurePublicationMutable();
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
        proposed = await loadComparison(activeRequest.workspace.path, this.comparison.base, this.preferences.contextLines);
        proposal = { patch, baselineTree: activeRequest.workspace.tree, resultTree: result.tree };
        refreshed = await loadComparison(this.comparison.repositoryRoot, this.comparison.base, this.preferences.contextLines);
      } else {
        refreshed = await loadComparison(this.comparison.repositoryRoot, this.comparison.base, this.preferences.contextLines);
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
      const refreshedPaths = new Set(refreshed.files.map((file) => file.path));
      for (const path of this.reviewedFiles) if (!refreshedPaths.has(path)) this.reviewedFiles.delete(path);
      this.comparisonGeneration += 1;
      this.revision += 1;
      operationRevision = this.revision;
      for (const comment of this.comments) {
        const row = this.findRow(comment.path, comment.side, comment.line);
        comment.status = row?.content === comment.lineContent ? "active" : "outdated";
      }
      for (const step of tourSteps(this.outline)) {
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

  async refreshPullRequest() {
    return this.serializeMutation(async () => {
      this.ensureOpen();
      if (!this.pullRequest) throw new ReviewError("This is not a GitHub pull request review.");
      this.ensurePublicationMutable();
      if (this.activeAgentRequest) throw new ReviewError("Wait for the active agent request before refreshing the pull request.");
      const previousContext = structuredClone(this.pullRequest);
      const previousComparison = this.comparison;
      const previousRevision = this.revision;
      const previousGeneration = this.comparisonGeneration;
      const previousMutable = this.captureMutableState();
      let latest: PullRequestContext | undefined;
      try {
        latest = await updatePullRequestWorkspace(previousContext, this.defaults.githubRunner);
        const refreshed = await loadComparison(latest.workspaceRoot, latest.baseRefOid, this.preferences.contextLines);
        this.pullRequest = latest;
        this.comparison = refreshed;
        this.comparisonGeneration += 1;
        this.revision += 1;
        const refreshedPaths = new Set(refreshed.files.map((file) => file.path));
        for (const path of this.reviewedFiles) if (!refreshedPaths.has(path)) this.reviewedFiles.delete(path);
        for (const comment of this.comments) {
          const row = this.findRow(comment.path, comment.side, comment.line);
          comment.status = row?.content === comment.lineContent ? "active" : "outdated";
        }
        for (const step of tourSteps(this.outline)) step.outdated = !this.findRow(step.anchor.path, step.anchor.side, step.anchor.startLine);
        for (const finding of this.outline?.findings ?? []) {
          const row = this.findRow(finding.path, finding.side, finding.line);
          finding.outdated = row?.content !== finding.lineContent;
        }
        await this.persist();
        return this.snapshot();
      } catch (error) {
        if (latest?.headRefOid !== previousContext.headRefOid) {
          await runProcess(["git", "switch", "--detach", previousContext.headRefOid], previousContext.workspaceRoot).catch(() => undefined);
        }
        this.pullRequest = previousContext;
        this.comparison = previousComparison;
        this.revision = previousRevision;
        this.comparisonGeneration = previousGeneration;
        this.restoreMutableState(previousMutable, this.terminalEpoch, this.revision);
        throw error;
      }
    });
  }

  private assertCloseAllowed(outcome: ReviewOutcome): void {
    if (outcome !== "cancelled" && this.activities.some((activity) => activity.changeStatus === "pending")) {
      throw new ReviewError("Apply or reject every pending agent change before closing the review.");
    }
    if (outcome !== "cancelled" && this.preferences.requireAllFilesReviewed &&
      this.comparison.files.some((file) => !this.reviewedFiles.has(file.path))) {
      throw new ReviewError("Mark every changed file as reviewed before completing this review.");
    }
    if (outcome === "accepted" && this.comments.length > 0) {
      throw new ReviewError("Resolve or remove feedback before accepting, or close with feedback.");
    }
  }

  async publishPullRequest(outcome: Extract<ReviewOutcome, "accepted" | "feedback">, expectedHeadOid: string) {
    return this.serializeMutation(async () => {
      this.ensureOpen();
      if (!this.pullRequest) throw new ReviewError("This is not a GitHub pull request review.");
      if (expectedHeadOid !== this.pullRequest.headRefOid) throw new ReviewError("The confirmation is for an outdated pull request revision. Refresh and confirm again.");
      this.assertCloseAllowed(outcome);
      const selected = this.comments.filter((comment) => comment.publishToGitHub);
      if (selected.some((comment) => comment.status !== "active")) throw new ReviewError("Outdated comments cannot be published to GitHub.");
      const commentIds = selected.map((comment) => comment.id).sort();
      const existing = this.pullRequest.publication;
      if (existing && (existing.outcome !== outcome || JSON.stringify(existing.commentIds) !== JSON.stringify(commentIds))) {
        throw new ReviewError("A different GitHub review publication is already pending. Retry the original selection before changing it.");
      }
      const publication = existing ?? { intentId: crypto.randomUUID(), outcome, commentIds, status: "pending" as const };
      this.pullRequest.publication = publication;
      this.revision += 1;
      await this.persist();
      if (publication.status !== "published") {
        const result = await publishGitHubReview(this.pullRequest, selected, outcome, publication.intentId, this.defaults.githubRunner);
        this.pullRequest.publication = { ...publication, status: "published", reviewId: result.id, url: result.url };
        this.revision += 1;
        await this.persist();
      }
      return this.close(outcome, { githubPublished: true });
    });
  }

  async close(outcome: ReviewOutcome, options: { githubPublished?: boolean } = {}) {
    if (this.closePromise) {
      const result = await this.closePromise;
      if (result.outcome !== outcome) throw new ReviewError(`The review already closed as ${result.outcome}.`);
      return result;
    }
    if (this.status !== "open") {
      if (this.status !== outcome) throw new ReviewError(`The review already closed as ${this.status}.`);
      return { outcome, comments: this.comments, status: this.status };
    }
    if (this.pullRequest && outcome !== "cancelled" && !options.githubPublished) {
      throw new ReviewError("Publish the pull request review to GitHub, or cancel the local review.");
    }
    if (this.pullRequest?.publication && outcome === "cancelled") {
      throw new ReviewError("A GitHub review publication has already started. Retry it to determine the final remote result.");
    }
    this.assertCloseAllowed(outcome);
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
          ? this.createAgent(this.agentContinuation)
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
