import { discoverAgentAdapters } from "./adapters.ts";
import { ReviewError } from "./errors.ts";
import { TourAgent, type AgentTransportReply, type BridgePromptKind } from "./agent.ts";
import { validateReviewFlow } from "./flows.ts";
import { validateCallFlows } from "./call-flows.ts";
import { AttachedAgentBridge } from "./bridge.ts";
import { applyChangePatch, captureWorkingTreeSnapshot, createChangePatch, createProposalWorkspace, loadComparison, loadComparisonBetweenTrees, loadDiffFileWithContext, loadDiffImage, loadDiffText, loadRepositoryFile, removeCheckpointRef, removeProposalWorkspace, writeCheckpointRef, writeProposalFile, type ProposalWorkspace } from "./git.ts";
import { parseUnifiedDiff } from "./diff.ts";
import { DEFAULT_REVIEW_POLICY, DEFAULT_REVIEW_PREFERENCES } from "./config.ts";
import { publishPullRequestReview as publishGitHubReview, updatePullRequestWorkspace, type GitHubRunner } from "./github.ts";
import { runProcess } from "./process.ts";
import { loadPersistedSession, savePersistedSession } from "./store.ts";
import { tourSteps } from "./tour.ts";
import type { FindingDisposition } from "./types.ts";
import type { AgentAdapterOption, AgentChangeActivity, AgentChangeFile, AgentRunActivity, AgentSelection, ChatMessage, ComparisonView, DiffFile, DiffRow, DiffViewPreferences, GitComparison, PersistedReviewSession, PullRequestContext, ReasoningEffort, ReviewComment, ReviewDecisionIntent, ReviewFlow, ReviewOutcome, ReviewPolicy, ReviewPreferences, ReviewScreenshot, ReviewStatus, RevisionSummary, SessionDiffPreferences, SourceCheckpoint, TourOutline } from "./types.ts";
import { importReviewScreenshots, screenshotAssetPath } from "./screenshots.ts";
import { revisionSummary } from "./revision.ts";
import { diffPreferenceStoreDirectory, loadGlobalDiffPreferences, restoreGlobalDiffPreferences, updateGlobalDiffPreferences } from "./diff-preferences.ts";

interface AgentDefaults {
  adapterId?: string;
  modelId?: string;
  reasoningEffort?: ReasoningEffort;
  callerModel?: string;
  callerReasoningEffort?: ReasoningEffort;
  attached?: boolean;
  stateFile?: string;
  diffPreferenceDirectory?: string;
  resume?: boolean;
  preferences?: ReviewPreferences;
  reviewPolicy?: ReviewPolicy;
  includeFindings?: boolean;
  pullRequest?: PullRequestContext;
  screenshots?: string[];
  githubRunner?: GitHubRunner;
  agentAdapters?: AgentAdapterOption[];
}

interface RefreshContext {
  source: "manual" | "watcher" | "agent";
  eventId?: string;
  verification?: string;
}

const FINDING_DISPOSITIONS: FindingDisposition[] = ["accepted", "false-positive", "intentional", "deferred", "fixed", "obsolete-after-refresh"];

type FindingUpdate = "dismiss" | "reopen" | "convert" | FindingDisposition;

function isFindingDisposition(value: string): value is FindingDisposition {
  return FINDING_DISPOSITIONS.includes(value as FindingDisposition);
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

function sameComparison(before: GitComparison, after: GitComparison): boolean {
  return before.repositoryRoot === after.repositoryRoot &&
    before.repositoryName === after.repositoryName &&
    before.branch === after.branch &&
    before.base === after.base &&
    before.mergeBase === after.mergeBase &&
    before.head === after.head &&
    before.sourceTree === after.sourceTree &&
    before.patch === after.patch &&
    before.repositoryFiles.length === after.repositoryFiles.length &&
    before.repositoryFiles.every((path, index) => path === after.repositoryFiles[index]);
}

export class ReviewSession {
  readonly comments: ReviewComment[];
  readonly messages: ChatMessage[];
  readonly activities: AgentChangeActivity[];
  readonly reviewedFiles: Set<string>;
  private diffPreferences?: SessionDiffPreferences;
  readonly browserToken: string;
  readonly preferences: ReviewPreferences;
  readonly reviewPolicy: ReviewPolicy;
  readonly screenshots: ReviewScreenshot[];
  readonly checkpoints: SourceCheckpoint[];
  readonly checkpointRefNamespace: string;
  comparisonView: ComparisonView = "full";
  selectedCheckpointId?: string;
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
  private readonly agentActivities = new Map<string, AgentRunActivity>();
  private readonly prefetchTasks = new Map<string, Promise<void>>();
  private readonly workerAgents = new Set<TourAgent>();
  private commandQueue: Promise<void> = Promise.resolve();
  private mutationQueue: Promise<void> = Promise.resolve();
  private refreshQueue: Promise<void> = Promise.resolve();
  private persistenceQueue: Promise<void> = Promise.resolve();
  private agentResultQueue: Promise<void> = Promise.resolve();
  private terminalEpoch = 0;
  private closePromise?: Promise<{ outcome: ReviewOutcome; comments: ReviewComment[]; status: ReviewStatus; decision?: ReviewDecisionIntent; note?: string }>;
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
  private fullComparison: GitComparison;
  private currentRevisionSummary: RevisionSummary;
  private currentSinceFiles: DiffFile[] = [];
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
    initialDiffPreferences?: SessionDiffPreferences,
  ) {
    this.browserToken = persisted?.browserToken ?? crypto.randomUUID();
    this.preferences = structuredClone(persisted?.preferences ?? defaults.preferences ?? DEFAULT_REVIEW_PREFERENCES);
    this.diffPreferences = structuredClone(persisted?.diffPreferences ?? initialDiffPreferences);
    this.reviewPolicy = structuredClone(persisted?.reviewPolicy ?? defaults.reviewPolicy ?? DEFAULT_REVIEW_POLICY);
    this.pullRequest = structuredClone(persisted?.pullRequest ?? defaults.pullRequest);
    this.screenshots = structuredClone(persisted?.screenshots ?? []);
    this.checkpoints = structuredClone(persisted?.checkpoints ?? []);
    this.checkpointRefNamespace = persisted?.checkpointRefNamespace ?? `refs/code-review-tour/checkpoints/${this.refKey(defaults.stateFile)}`;
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
    this.comparisonView = persisted?.comparisonView ?? "full";
    this.selectedCheckpointId = persisted?.selectedCheckpointId;
    this.fullComparison = comparison;
    this.currentRevisionSummary = { changedFiles: 0, additions: 0, deletions: 0, newFiles: [], changedAgainFiles: [], resolvedFiles: [], unchangedFiles: [], text: "No review checkpoint yet. Create one before refreshing to preserve reviewed files." };
    this.selection = persisted?.selection
      ? { ...structuredClone(persisted.selection), includeFindings: defaults.includeFindings === false ? false : persisted.selection.includeFindings }
      : undefined;
    this.agentContinuation = structuredClone(persisted?.agentContinuation);
    if (this.status === "open" && this.selection) {
      this.agent = this.createAgent(this.agentContinuation);
    }
    if (this.status !== "open") queueMicrotask(() => this.resolveClosed(this.status as ReviewOutcome));
  }

  private static refKey(value?: string): string {
    const source = value?.split(/[\\/]/).at(-1)?.replace(/\.json$/i, "") || crypto.randomUUID();
    return source.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 128) || crypto.randomUUID();
  }

  private refKey(value?: string): string {
    return ReviewSession.refKey(value);
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
      schemaVersion: 3,
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
      checkpoints: structuredClone(this.checkpoints),
      checkpointRefNamespace: this.checkpointRefNamespace,
      comparisonView: this.comparisonView,
      selectedCheckpointId: this.selectedCheckpointId,
      diffPreferences: structuredClone(this.diffPreferences),
      preferences: structuredClone(this.preferences),
      reviewPolicy: structuredClone(this.reviewPolicy),
      findingGenerationEnabled: this.defaults.includeFindings !== false,
      pullRequest: structuredClone(this.pullRequest),
      screenshots: structuredClone(this.screenshots),
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

  private persistAgentResult(receipts: string[] = []): Promise<void> {
    const operation = this.agentResultQueue.then(async () => {
      const committed = this.bridge?.prepareCommitResponses(receipts) ?? [];
      try {
        await this.persist();
      } catch (error) {
        this.bridge?.rollbackCommitResponses(committed);
        throw error;
      }
    });
    this.agentResultQueue = operation.then(() => undefined, () => undefined);
    return operation;
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

  private reviewAnchorContent(path: string, side: "old" | "new", line: number): string | undefined {
    const row = this.findRow(path, side, line);
    if (row) return row.content;
    const file = this.comparison.files.find((candidate) => candidate.path === path);
    const imageExists = side === "old" ? file?.oldPath : file?.newPath;
    return file && /\.png$/i.test(file.path) && imageExists && line === 1 ? `[PNG image · ${side}]` : undefined;
  }

  private refreshFindingLifecycles(): void {
    for (const finding of this.outline?.findings ?? []) {
      const row = this.findRow(finding.path, finding.side, finding.line);
      const outdated = row?.content !== finding.lineContent;
      finding.outdated = outdated;
    }
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
    this.ensureProposalCapacity(proposal.patch);
    const request = this.activeAgentRequest;
    const now = new Date().toISOString();
    this.activities.push({
      id: crypto.randomUUID(),
      source: "agent",
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

  private ensureProposalCapacity(patch: string): void {
    const retainedPatchBytes = this.activities.reduce(
      (total, activity) => total + (activity.proposal ? new TextEncoder().encode(activity.proposal.patch).byteLength : 0),
      0,
    );
    if (retainedPatchBytes + new TextEncoder().encode(patch).byteLength > 16 * 1024 * 1024) {
      throw new ReviewError("Pending and undoable changes exceed the 16 MiB session limit. Resolve an existing proposal or split this edit.");
    }
  }

  private async captureFallbackProposal(
    eventId: string,
    kind: BridgePromptKind,
    reply: AgentTransportReply,
  ): Promise<number | undefined> {
    if (kind !== "review.question" || !this.activeAgentRequest) return undefined;
    const result = await captureWorkingTreeSnapshot(this.activeAgentRequest.workspace.path);
    if (result.tree === this.activeAgentRequest.workspace.tree) return undefined;
    await this.refreshComparison({
      source: "agent",
      eventId,
      verification: reply.verification ?? "The local fallback agent did not provide a verification summary.",
    });
    return this.comparisonGeneration;
  }

  private latestCheckpoint(): SourceCheckpoint | undefined {
    return this.checkpoints.at(-1);
  }

  private selectedCheckpoint(): SourceCheckpoint | undefined {
    if (this.selectedCheckpointId) return this.checkpoints.find((checkpoint) => checkpoint.id === this.selectedCheckpointId);
    return this.latestCheckpoint();
  }

  private async comparisonForView(full: GitComparison = this.fullComparison): Promise<GitComparison> {
    if (this.comparisonView !== "since-last-review") return full;
    const checkpoint = this.selectedCheckpoint();
    if (!checkpoint) return full;
    try {
      return await loadComparisonBetweenTrees(full.repositoryRoot, {
        repositoryName: full.repositoryName,
        branch: full.branch,
        base: full.base,
        mergeBase: checkpoint.sourceTree,
        head: full.head,
        sourceTree: full.sourceTree ?? full.head,
        contextLines: this.preferences.contextLines,
      });
    } catch {
      return full;
    }
  }

  private async updateRevisionSummary(full: GitComparison): Promise<void> {
    const checkpoint = this.latestCheckpoint();
    if (!checkpoint || !full.sourceTree) {
      this.currentSinceFiles = [];
      this.currentRevisionSummary = {
        changedFiles: 0, additions: 0, deletions: 0, newFiles: [], changedAgainFiles: [], resolvedFiles: [], unchangedFiles: [],
        text: "No review checkpoint yet. Create one before refreshing to preserve reviewed files.",
      };
      return;
    }
    const checkpointComparison = await loadComparisonBetweenTrees(full.repositoryRoot, {
      repositoryName: full.repositoryName,
      branch: full.branch,
      base: full.base,
      mergeBase: checkpoint.baseTree,
      head: checkpoint.sourceHead,
      sourceTree: checkpoint.sourceTree,
      contextLines: this.preferences.contextLines,
    });
    const since = await loadComparisonBetweenTrees(full.repositoryRoot, {
      repositoryName: full.repositoryName,
      branch: full.branch,
      base: full.base,
      mergeBase: checkpoint.sourceTree,
      head: full.head,
      sourceTree: full.sourceTree,
      contextLines: this.preferences.contextLines,
    });
    this.currentSinceFiles = since.files;
    this.currentRevisionSummary = revisionSummary(checkpoint.id, checkpoint.createdAt, checkpointComparison.files, full.files, since.files);
  }

  private reconcileRevisionState(full: GitComparison, sinceFiles: DiffFile[]): void {
    const changedPaths = new Set(sinceFiles.map((file) => file.path));
    const currentPaths = new Set(full.files.map((file) => file.path));
    const checkpoint = this.latestCheckpoint();
    const reviewedAtCheckpoint = new Set(checkpoint?.reviewedFiles ?? []);
    this.reviewedFiles.clear();
    for (const path of reviewedAtCheckpoint) if (currentPaths.has(path) && !changedPaths.has(path)) this.reviewedFiles.add(path);
    this.comparison = full;
    for (const comment of this.comments) {
      comment.status = this.reviewAnchorContent(comment.path, comment.side, comment.line) === comment.lineContent ? "active" : "outdated";
    }
    for (const step of tourSteps(this.outline)) {
      step.outdated = changedPaths.has(step.anchor.path) || !this.findRow(step.anchor.path, step.anchor.side, step.anchor.startLine);
    }
    for (const finding of this.outline?.findings ?? []) {
      const row = this.findRow(finding.path, finding.side, finding.line);
      finding.outdated = changedPaths.has(finding.path) || row?.content !== finding.lineContent;
    }
    const diagrams = [this.outline?.architecture, this.outline?.behaviorArchitecture, ...(this.outline?.flows ?? []), ...(this.outline?.callFlows ?? [])];
    for (const diagram of diagrams) {
      if (!diagram?.affectedFiles) continue;
      diagram.outdated = diagram.affectedFiles.some((path) => changedPaths.has(path));
    }
  }

  private async selectComparisonView(): Promise<void> {
    this.comparison = await this.comparisonForView(this.fullComparison);
  }

  async setComparisonView(view: ComparisonView) {
    return this.serializeMutation(async () => {
      this.ensureOpen();
      if (view !== "full" && view !== "since-last-review") throw new ReviewError("Unknown comparison view.");
      if (view === this.comparisonView) return this.snapshot();
      this.comparisonView = view;
      await this.selectComparisonView();
      this.comparisonGeneration += 1;
      this.revision += 1;
      this.agent?.useComparison(this.comparison);
      await this.persist();
      return this.snapshot();
    });
  }

  private async createCheckpointRecord(kind: "manual" | "decision", decision?: ReviewDecisionIntent, outcome?: Extract<ReviewOutcome, "accepted" | "feedback">): Promise<SourceCheckpoint> {
    const full = await loadComparison(this.fullComparison.repositoryRoot, this.fullComparison.base, this.preferences.contextLines);
    const sourceTree = full.sourceTree;
    if (!sourceTree) throw new ReviewError("The current source snapshot could not be captured.");
    const id = crypto.randomUUID();
    const ref = `${this.checkpointRefNamespace}/${id}`;
    const previous = this.latestCheckpoint();
    let summary: RevisionSummary;
    if (previous) {
      const previousComparison = await loadComparisonBetweenTrees(full.repositoryRoot, {
        base: full.base, mergeBase: previous.baseTree, sourceTree: previous.sourceTree, head: previous.sourceHead,
        contextLines: this.preferences.contextLines,
      });
      const since = await loadComparisonBetweenTrees(full.repositoryRoot, {
        base: full.base, mergeBase: previous.sourceTree, sourceTree, head: full.head,
        contextLines: this.preferences.contextLines,
      });
      summary = revisionSummary(id, new Date().toISOString(), previousComparison.files, full.files, since.files);
    } else {
      summary = revisionSummary(id, new Date().toISOString(), [], full.files, full.files);
      summary.text = `${kind === "manual" ? "Manual" : "Decision"} checkpoint created at the current source.`;
    }
    await writeCheckpointRef(full.repositoryRoot, ref, sourceTree);
    const checkpoint: SourceCheckpoint = {
      id, kind, ref, sourceTree, sourceHead: full.head, base: full.base, baseTree: full.mergeBase,
      reviewedFiles: [...new Set([...this.reviewedFiles, ...(previous?.reviewedFiles ?? [])])].filter((path) => full.files.some((file) => file.path === path)).sort(),
      ...(outcome ? { outcome } : {}),
      ...(decision && decision !== "cancel" ? { decision } : {}),
      summary,
      createdAt: summary.checkpointCreatedAt!,
    };
    this.checkpoints.push(checkpoint);
    this.fullComparison = full;
    this.currentSinceFiles = [];
    this.currentRevisionSummary = summary;
    return checkpoint;
  }

  async createManualCheckpoint(label?: string) {
    return this.serializeMutation(async () => {
      this.ensureOpen();
      if (this.pullRequest) throw new ReviewError("Manual checkpoints are available for local reviews only.");
      const previousRevision = this.revision;
      const previousComparison = this.comparison;
      const previousFullComparison = this.fullComparison;
      const previousRevisionSummary = structuredClone(this.currentRevisionSummary);
      const previousSinceFiles = structuredClone(this.currentSinceFiles);
      const checkpoint = await this.createCheckpointRecord("manual");
      if (label?.trim()) {
        checkpoint.label = label.trim().slice(0, 500);
        checkpoint.summary.text = `Manual checkpoint: ${checkpoint.label}`.slice(0, 2_000);
      }
      await this.selectComparisonView();
      this.revision += 1;
      try {
        await this.persist();
      } catch (error) {
        this.checkpoints.pop();
        await removeCheckpointRef(this.fullComparison.repositoryRoot, checkpoint.ref).catch(() => undefined);
        this.fullComparison = previousFullComparison;
        this.comparison = previousComparison;
        this.currentRevisionSummary = previousRevisionSummary;
        this.currentSinceFiles = previousSinceFiles;
        this.revision = previousRevision;
        throw error;
      }
      return this.snapshot();
    });
  }

  async deleteCheckpoint(id: string) {
    return this.serializeMutation(async () => {
      this.ensureOpen();
      const index = this.checkpoints.findIndex((checkpoint) => checkpoint.id === id);
      if (index < 0) throw new ReviewError("The review checkpoint does not exist.");
      const checkpoint = this.checkpoints[index];
      const previousCheckpoints = structuredClone(this.checkpoints);
      const previousSelectedCheckpointId = this.selectedCheckpointId;
      const previousComparison = this.comparison;
      const previousComparisonView = this.comparisonView;
      const previousSummary = structuredClone(this.currentRevisionSummary);
      const previousSinceFiles = structuredClone(this.currentSinceFiles);
      const previousGeneration = this.comparisonGeneration;
      const previousRevision = this.revision;
      const previousMutable = this.captureMutableState();
      let refRemoved = false;
      try {
        await removeCheckpointRef(this.fullComparison.repositoryRoot, checkpoint.ref);
        refRemoved = true;
        this.checkpoints.splice(index, 1);
        if (this.selectedCheckpointId === id) this.selectedCheckpointId = undefined;
        if (!this.latestCheckpoint() && this.comparisonView === "since-last-review") this.comparisonView = "full";
        await this.updateRevisionSummary(this.fullComparison);
        this.reconcileRevisionState(this.fullComparison, this.currentSinceFiles);
        await this.selectComparisonView();
        this.comparisonGeneration += 1;
        this.revision += 1;
        await this.persist();
        return this.snapshot();
      } catch (error) {
        if (refRemoved) await writeCheckpointRef(this.fullComparison.repositoryRoot, checkpoint.ref, checkpoint.sourceTree).catch(() => undefined);
        this.checkpoints.splice(0, this.checkpoints.length, ...previousCheckpoints);
        this.selectedCheckpointId = previousSelectedCheckpointId;
        this.comparison = previousComparison;
        this.comparisonView = previousComparisonView;
        this.currentRevisionSummary = previousSummary;
        this.currentSinceFiles = previousSinceFiles;
        this.comparisonGeneration = previousGeneration;
        this.outline = previousMutable.outline;
        this.currentStepIndex = previousMutable.currentStepIndex;
        this.comments.splice(0, this.comments.length, ...previousMutable.comments);
        this.messages.splice(0, this.messages.length, ...previousMutable.messages);
        this.reviewedFiles.clear();
        for (const path of previousMutable.reviewedFiles) this.reviewedFiles.add(path);
        this.selection = previousMutable.selection;
        this.agentContinuation = previousMutable.agentContinuation;
        this.revision = previousRevision;
        throw error;
      }
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
    const preferenceRepositoryRoot = persisted?.pullRequest?.sourceRepositoryRoot ?? defaults.pullRequest?.sourceRepositoryRoot ?? comparison.repositoryRoot;
    const globalDiffPreferences = await loadGlobalDiffPreferences(defaults.diffPreferenceDirectory ?? diffPreferenceStoreDirectory(defaults.stateFile), preferenceRepositoryRoot);
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
    const session = new ReviewSession(comparison, adapters, { ...defaults, attached, preferences, includeFindings }, bridge, persisted, globalDiffPreferences);
    await session.selectComparisonView();
    await session.updateRevisionSummary(session.fullComparison).catch(() => undefined);
    if (defaults.screenshots?.length) {
      if (!defaults.stateFile) throw new ReviewError("Screenshots require persisted review session storage.");
      session.screenshots.splice(0, session.screenshots.length, ...await importReviewScreenshots(defaults.screenshots, defaults.stateFile, session.screenshots));
    }
    bridge?.setPersistence(() => session.persist());
    bridge?.setFallbackResultHandler((eventId, kind, reply) => session.captureFallbackProposal(eventId, kind, reply));
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

  private createAgent(
    continuation?: PersistedReviewSession["agentContinuation"],
    configureFallback = true,
  ): TourAgent {
    if (!this.selection) throw new ReviewError("Select a tour agent before starting the tour.");
    return new TourAgent(
      this.comparison.repositoryRoot,
      this.selection,
      this.bridge,
      continuation,
      (activity) => this.recordAgentRunActivity(activity),
      configureFallback ? this.resolveFallbackSelection() : undefined,
    );
  }

  private createWorkerAgent(): TourAgent {
    // The primary attached agent owns the bridge fallback factory. Workers share
    // that bridge, but must not replace its factory with their shorter lifetime.
    const worker = this.createAgent(undefined, false);
    this.workerAgents.add(worker);
    return worker;
  }

  private recordAgentRunActivity(activity: AgentRunActivity): void {
    this.agentActivities.set(activity.id, structuredClone(activity));
    if (activity.status === "completed") this.agentActivities.delete(activity.id);
    const candidates = [...this.agentActivities.values()];
    const active = candidates.filter((candidate) => candidate.status === "waiting" || candidate.status === "running");
    const interactive = active
      .filter((candidate) => candidate.kind === "review.question")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    const explanations = active
      .filter((candidate) => candidate.kind === "tour.explanation")
      .sort((left, right) => (left.stepNumber ?? Number.MAX_SAFE_INTEGER) - (right.stepNumber ?? Number.MAX_SAFE_INTEGER));
    const background = explanations[0] ?? active.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    const latestTerminal = [...candidates.filter((candidate) => candidate.status === "failed"), activity]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    this.agentActivity = structuredClone(interactive ?? background ?? latestTerminal ?? activity);
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
      checkpoints: structuredClone(this.checkpoints),
      comparisonView: this.comparisonView,
      selectedCheckpointId: this.selectedCheckpointId ?? this.latestCheckpoint()?.id,
      revisionSummary: structuredClone(this.currentRevisionSummary),
      diffPreferences: structuredClone(this.diffPreferences),
      preferences: structuredClone(this.preferences),
      reviewPolicy: structuredClone(this.reviewPolicy),
      findingGenerationEnabled: this.defaults.includeFindings !== false,
      pullRequest: structuredClone(this.pullRequest),
      screenshots: structuredClone(this.screenshots),
      revision: this.revision,
      status: this.status,
      agentAdapters: this.agentAdapters,
      agentSelection: this.selection ?? (this.agentAdapters.length > 0 ? this.resolveSelection() : undefined),
      agentMode: this.selection ? `${this.selection.adapterId}-read-only` : undefined,
      agentActivity: structuredClone(this.agentActivity),
      tourState: this.outline ? "active" as const : this.tourPlanning ? "planning" as const : "idle" as const,
    };
  }

  screenshot(id: string): { metadata: ReviewScreenshot; path: string } | undefined {
    const metadata = this.screenshots.find((candidate) => candidate.id === id);
    if (!metadata || !this.defaults.stateFile) return undefined;
    return { metadata, path: screenshotAssetPath(this.defaults.stateFile, metadata) };
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

  diffImage(path: string, side: "old" | "new") {
    return loadDiffImage(this.comparison, path, side);
  }

  diffText(path: string, side: "old" | "new") {
    return loadDiffText(this.comparison, path, side);
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

  async proposeInlineEdit(path: string, side: "new", line: number, expectedContent: string, replacement: string, requestedEndLine?: number) {
    return this.serializeMutation(async () => {
      this.ensureOpen();
      if (side !== "new") throw new ReviewError("Only lines on the new side of a changed file can be edited.");
      const changedFile = this.comparison.files.find((candidate) => candidate.path === path && candidate.status !== "deleted");
      if (!changedFile) throw new ReviewError("Only lines on the new side of a changed file can be edited.");
      if (replacement.includes("\0")) throw new ReviewError("Inline edits cannot contain binary data.");

      let workspace: ProposalWorkspace | undefined;
      try {
        workspace = await createProposalWorkspace(this.comparison.repositoryRoot);
        const workspaceComparison = { ...this.comparison, repositoryRoot: workspace.path };
        const content = await loadRepositoryFile(workspaceComparison, path);
        const newline = content.includes("\r\n") ? "\r\n" : "\n";
        const normalized = content.replaceAll("\r\n", "\n");
        const terminalNewline = normalized.endsWith("\n");
        const lines = normalized.split("\n");
        if (terminalNewline) lines.pop();
        const endLine = requestedEndLine ?? line;
        if (endLine < line || endLine > lines.length || lines.slice(line - 1, endLine).join("\n") !== expectedContent) {
          throw new ReviewError("This file changed before the edit was submitted. Refresh it and try again.");
        }
        const replacementLines = replacement === "" ? [] : replacement.replaceAll("\r\n", "\n").split("\n");
        lines.splice(line - 1, endLine - line + 1, ...replacementLines);
        const nextContent = `${lines.join(newline)}${terminalNewline ? newline : ""}`;
        if (nextContent === content) throw new ReviewError("The proposed edit does not change this file.");
        await writeProposalFile(workspace, path, nextContent);

        const result = await captureWorkingTreeSnapshot(workspace.path);
        const patch = await createChangePatch(workspace.path, workspace.tree, result.tree);
        if (!patch.trim()) throw new ReviewError("The proposed edit does not change this file.");
        this.ensureProposalCapacity(patch);
        const proposedComparison = await loadComparison(workspace.path, this.comparison.base, this.preferences.contextLines);
        const files = comparisonChanges(this.comparison.files, proposedComparison.files);
        if (files.length !== 1 || files[0]?.path !== path) {
          throw new ReviewError("The inline edit affected an unexpected file and was discarded.");
        }

        const now = new Date().toISOString();
        const activity: AgentChangeActivity = {
          id: crypto.randomUUID(),
          source: "reviewer",
          requestMessageId: `reviewer-${crypto.randomUUID()}`,
          request: `Edit ${path}:${line}${endLine === line ? "" : `-${endLine}`}`,
          adapterId: "reviewer",
          modelId: "inline-edit",
          files,
          status: "observed",
          changeStatus: "pending",
          proposal: { patch, baselineTree: workspace.tree, resultTree: result.tree },
          createdAt: now,
          updatedAt: now,
        };
        this.activities.push(activity);
        const previousRevision = this.revision;
        this.revision += 1;
        try {
          await this.persist();
        } catch (error) {
          this.activities.pop();
          this.revision = previousRevision;
          throw error;
        }
        return { session: this.snapshot(), activityId: activity.id };
      } finally {
        if (workspace) await removeProposalWorkspace(this.comparison.repositoryRoot, workspace);
      }
    });
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
      const previousFullComparison = this.fullComparison;
      const previousRevisionSummary = structuredClone(this.currentRevisionSummary);
      const previousSinceFiles = structuredClone(this.currentSinceFiles);
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
          this.fullComparison = await loadComparison(this.comparison.repositoryRoot, this.fullComparison.base, this.preferences.contextLines);
          await this.updateRevisionSummary(this.fullComparison);
          this.reconcileRevisionState(this.fullComparison, this.currentSinceFiles);
          await this.selectComparisonView();
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
        this.fullComparison = previousFullComparison;
        this.currentRevisionSummary = previousRevisionSummary;
        this.currentSinceFiles = previousSinceFiles;
        this.comparisonGeneration = previousGeneration;
        activity.changeStatus = previousStatus;
        activity.proposal = proposal;
        this.revision = previousRevision;
        throw error;
      }
    });
  }

  private scheduleNextStepPrefetch(): void {
    if (this.status !== "open") return;
    if (!this.outline || !this.agent || this.preferences.prefetchSteps === 0) return;
    const steps = tourSteps(this.outline);
    const windowEnd = Math.min(steps.length - 1, this.currentStepIndex + this.preferences.prefetchSteps);
    for (let index = this.currentStepIndex + 1; index <= windowEnd; index += 1) {
      const step = steps[index];
      if (!step || step.explanation || this.prefetchTasks.has(step.id)) continue;
      const task = this.prefetchStep(step.id, index, steps.length);
      this.prefetchTasks.set(step.id, task);
      void task.finally(() => this.prefetchTasks.delete(step.id)).catch(() => undefined);
    }
  }

  async prepareTourForExport() {
    if (!this.outline) throw new ReviewError("Start the tour before exporting it.");
    const steps = tourSteps(this.outline);
    const missing = steps.map((step, index) => ({ step, index })).filter(({ step }) => !step.explanation);
    if (missing.length === 0) return this.snapshot();
    this.ensureOpen();
    if (!this.agent) throw new ReviewError("The tour agent is unavailable, so the missing stops cannot be prepared.");

    const tasks = missing.map(({ step, index }) => {
      const existing = this.prefetchTasks.get(step.id);
      if (existing) return existing;
      const task = this.prefetchStep(step.id, index, steps.length);
      this.prefetchTasks.set(step.id, task);
      void task.finally(() => this.prefetchTasks.delete(step.id)).catch(() => undefined);
      return task;
    });
    const results = await Promise.allSettled(tasks);
    const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failure) throw failure.reason;
    const remaining = tourSteps(this.outline).filter((step) => !step.explanation);
    if (remaining.length > 0) throw new ReviewError(`${remaining.length} tour stop(s) could not be prepared for export.`);
    return this.snapshot();
  }

  private async prefetchStep(stepId: string, index: number, totalSteps: number): Promise<void> {
    const outline = this.outline;
    if (!outline) return;
    const step = tourSteps(outline).find((candidate) => candidate.id === stepId);
    if (!step || step.explanation) return;
    const comparisonGeneration = this.comparisonGeneration;
    const worker = this.createWorkerAgent();
    worker.useComparison(this.comparison);
    try {
      const generated = await worker.explainStep(step, index, totalSteps, outline);
      await this.serializeMutation(async () => {
        this.ensureOpen();
        this.ensureComparisonCurrent(comparisonGeneration);
        const current = tourSteps(this.outline).find((candidate) => candidate.id === stepId);
        if (!current || current.explanation) return;
        const previousRevision = this.revision;
        current.explanation = generated.value;
        this.revision += 1;
        try {
          await this.persistAgentResult(generated.receipts);
        } catch (error) {
          if (current.explanation === generated.value && this.revision === previousRevision + 1) {
            current.explanation = undefined;
            this.revision = previousRevision;
          }
          throw error;
        }
      });
    } finally {
      this.workerAgents.delete(worker);
      worker.cancel();
    }
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
      if (!Number.isInteger(prefetchSteps) || prefetchSteps < 0 || prefetchSteps > 5) {
        throw new ReviewError("Prepare ahead must be between 0 and 5 steps.");
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

  async setDiffPreferences(scope: "desktop" | "mobile", preferences: DiffViewPreferences) {
    return this.serializeMutation(async () => {
      this.ensureOpen();
      if (!["unified", "split"].includes(preferences.layout) || !["scroll", "wrap"].includes(preferences.wrap)) {
        throw new ReviewError("Diff preferences are invalid.");
      }
      const previous = structuredClone(this.diffPreferences);
      const preferenceRepositoryRoot = this.pullRequest?.sourceRepositoryRoot ?? this.comparison.repositoryRoot;
      const preferenceDirectory = this.defaults.diffPreferenceDirectory ?? diffPreferenceStoreDirectory(this.defaults.stateFile);
      const current = this.diffPreferences?.[scope];
      if (current?.layout === preferences.layout && current.wrap === preferences.wrap) return this.snapshot();
      this.diffPreferences = {
        ...this.diffPreferences,
        [scope]: structuredClone(preferences),
      };
      const previousRevision = this.revision;
      this.revision += 1;
      let globalUpdated = false;
      let previousGlobal: SessionDiffPreferences | undefined;
      try {
        previousGlobal = await updateGlobalDiffPreferences(preferenceDirectory, preferenceRepositoryRoot, scope, preferences);
        globalUpdated = preferenceDirectory !== undefined;
        await this.persist();
      } catch (error) {
        this.diffPreferences = previous;
        this.revision = previousRevision;
        if (globalUpdated) await restoreGlobalDiffPreferences(preferenceDirectory, preferenceRepositoryRoot, previousGlobal).catch(() => undefined);
        throw error;
      }
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
      const receipts: string[] = [];
      try {
        if (!this.outline) {
          const generated = await this.agent.createOutline(
            this.comparison,
            this.reviewPolicy,
            () => this.ensureComparisonCurrent(comparisonGeneration),
          );
          receipts.push(...generated.receipts);
          this.ensureComparisonCurrent(comparisonGeneration);
          this.outline = generated.value;
          this.currentStepIndex = 0;
        } else if (this.currentStepIndex < 0 || this.currentStepIndex >= tourSteps(this.outline).length) {
          this.currentStepIndex = 0;
        }
        this.ensureOpen();
        const steps = tourSteps(this.outline);
        const step = steps[this.currentStepIndex]!;
        if (!step.explanation) {
          const explanation = await this.agent.explainStep(step, this.currentStepIndex, steps.length, this.outline);
          receipts.push(...explanation.receipts);
          this.ensureComparisonCurrent(comparisonGeneration);
          step.explanation = explanation.value;
        }
        this.ensureOpen();
        this.revision += 1;
        operationRevision = this.revision;
        await this.persistAgentResult(receipts);
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
      const expectedCurrentStepIndex = this.currentStepIndex;
      const delta = direction === "next" ? 1 : -1;
      const steps = tourSteps(this.outline);
      const index = Math.max(0, Math.min(steps.length - 1, this.currentStepIndex + delta));
      const step = steps[index]!;
      let receipts: string[] = [];
      if (!step.explanation) {
        await this.prefetchTasks.get(step.id)?.catch(() => undefined);
      }
      if (this.currentStepIndex !== expectedCurrentStepIndex) return this.snapshot();
      if (!step.explanation) {
        const explanation = await this.agent.explainStep(step, index, steps.length, this.outline);
        receipts = explanation.receipts;
        this.ensureComparisonCurrent(comparisonGeneration);
        if (this.currentStepIndex !== expectedCurrentStepIndex) {
          await this.persistAgentResult(receipts);
          return this.snapshot();
        }
        step.explanation = explanation.value;
      }
      this.ensureOpen();
      this.currentStepIndex = index;
      this.revision += 1;
      operationRevision = this.revision;
      await this.persistAgentResult(receipts);
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
          if (index < 0 || generated.value.length !== 1) throw new ReviewError("The regenerated flow is invalid.");
          this.outline.flows[index] = generated.value[0]!;
        } else {
          this.outline.flows = generated.value;
        }
        this.ensureOpen();
        this.revision += 1;
        operationRevision = this.revision;
        await this.persistAgentResult(generated.receipts);
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
          if (index < 0 || generated.value.length !== 1) throw new ReviewError("The regenerated call flow is invalid.");
          this.outline.callFlows[index] = generated.value[0]!;
        } else {
          this.outline.callFlows = generated.value;
        }
        this.ensureOpen();
        this.revision += 1;
        operationRevision = this.revision;
        await this.persistAgentResult(generated.receipts);
        return this.snapshot();
      } catch (error) {
        this.restoreMutableState(before, terminalEpoch, operationRevision);
        throw error;
      }
    });
  }

  async ask(body: string, selectedContext?: string, conversation?: { threadId?: string; anchor?: ChatMessage["anchor"]; contextPaths?: string[] }) {
    return this.serialize(async () => {
      const before = this.captureMutableState();
      const terminalEpoch = this.terminalEpoch;
      let operationRevision = before.revision;
      const comparisonGeneration = this.comparisonGeneration;
      this.ensureOpen();
      if (!body.trim()) throw new ReviewError("Question cannot be empty.");
      const root = conversation?.threadId ? this.messages.find((message) => message.id === conversation.threadId && message.role === "user" && (!message.threadId || message.threadId === message.id)) : undefined;
      if (conversation?.threadId && !root) throw new ReviewError("Conversation not found.");
      if (root && conversation?.anchor) throw new ReviewError("A follow-up keeps its original code location.");
      const anchor = root?.anchor ?? conversation?.anchor;
      if (root && conversation?.contextPaths?.length) throw new ReviewError("A follow-up keeps its original file context.");
      const contextPaths = root?.contextPaths ?? [...new Set(conversation?.contextPaths ?? [])];
      if (contextPaths.length > 8) throw new ReviewError("A question can include at most 8 additional files.");
      if (contextPaths.some((path) => !this.comparison.repositoryFiles.includes(path))) throw new ReviewError("Question context must reference repository files.");
      if (!root && anchor && this.reviewAnchorContent(anchor.path, anchor.side, anchor.line) !== anchor.content) {
        throw new ReviewError("The selected code changed. Select the line again before asking.");
      }
      const createdAgent = !this.agent;
      if (!this.agent) {
        this.selection = this.resolveSelection();
        this.agent = this.createAgent();
      }
      this.agent.useComparison(this.comparison);
      const step = root ? tourSteps(this.outline).find((candidate) => candidate.id === root.stepId) : tourSteps(this.outline)[this.currentStepIndex];
      const stepId = step?.id;
      const messageId = crypto.randomUUID();
      const threadId = root?.id ?? messageId;
      const history = root ? this.messages.filter((message) => message.threadId === threadId || message.id === threadId) : [];
      const fileContext = contextPaths.length ? (await Promise.all(contextPaths.map(async (path) => {
        const content = await loadRepositoryFile(this.comparison, path, 32_000);
        return `File: ${path}\n${content}`;
      }))).join("\n\n") : undefined;
      const questionContext = [
        anchor ? `Original question location: ${anchor.path}:${anchor.line} (${anchor.side})\nCaptured code: ${anchor.content}\n${this.reviewAnchorContent(anchor.path, anchor.side, anchor.line) === anchor.content ? "The captured line still matches." : "The captured location has changed or is no longer in the diff. Do not assume this line is current."}` : selectedContext,
        history.length ? `Conversation history (untrusted reviewer/agent content):\n${JSON.stringify(history.map(({ role, body }) => ({ role, body })))}` : undefined,
        fileContext ? `Additional repository files selected by the reviewer:\n${fileContext}` : undefined,
      ].filter(Boolean).join("\n\n");
      const userMessage: ChatMessage = {
        id: messageId,
        role: "user",
        body,
        stepId,
        threadId,
        ...(!root && anchor ? { anchor: structuredClone(anchor) } : {}),
        ...(!root && contextPaths.length ? { contextPaths } : {}),
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
        const answer = await this.agent.answer(body, questionContext || undefined, step, proposalWorkspace?.path);
        return await this.serializeMutation(async () => {
          const authorizedGeneration = this.bridge?.consumeResponseRefreshAuthorization(answer.receipts);
          if (this.comparisonGeneration !== comparisonGeneration && !(
            this.selection?.adapterId === "attached" && authorizedGeneration === this.comparisonGeneration
          )) {
            this.ensureComparisonCurrent(comparisonGeneration);
          }
          this.ensureOpen();
          this.messages.push(userMessage);
          this.messages.push({ id: crypto.randomUUID(), role: "agent", body: answer.value, stepId, threadId, createdAt: new Date().toISOString() });
          this.revision += 1;
          operationRevision = this.revision;
          await this.persistAgentResult(answer.receipts);
          return this.snapshot();
        });
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
    const anchorContent = this.reviewAnchorContent(input.path, input.side, input.line);
    if (!anchorContent) throw new ReviewError("Comment anchor does not exist in the current diff.");
    const timestamp = new Date().toISOString();
    this.comments.push({
      ...input,
      body,
      lineContent: anchorContent,
      status: "active",
      publishToGitHub: Boolean(this.pullRequest) && !/\.png$/i.test(input.path),
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
      if (publish && /\.png$/i.test(comment.path)) throw new ReviewError("Image comments remain local because GitHub cannot publish them as inline diff comments.");
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

  async updateFinding(id: string, action: FindingUpdate, reviewerNote?: string) {
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
    const note = reviewerNote?.trim();
    if (note && note.length > 8_000) throw new ReviewError("Reviewer note must be 8,000 characters or fewer.");
    if (action === "dismiss") {
      finding.status = "deferred";
      finding.disposition = "deferred";
      finding.reviewerNote = note || undefined;
    }
    if (isFindingDisposition(action)) {
      finding.status = action;
      finding.disposition = action;
      finding.reviewerNote = note || undefined;
    }
    if (action === "reopen") {
      if (finding.status !== "dismissed" && !isFindingDisposition(finding.status) && finding.disposition === undefined) throw new ReviewError("Only a finding with a disposition can be reopened.");
      finding.status = "open";
      finding.disposition = undefined;
      finding.reviewerNote = undefined;
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
        finding.disposition = undefined;
        finding.reviewerNote = undefined;
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
      if (context.source === "watcher" && sameComparison(this.fullComparison, refreshed)) return this.snapshot();
      const before = this.captureMutableState();
      const terminalEpoch = this.terminalEpoch;
      let operationRevision = before.revision;
      const previousComparison = this.comparison;
      const previousFullComparison = this.fullComparison;
      const previousRevisionSummary = structuredClone(this.currentRevisionSummary);
      const previousSinceFiles = structuredClone(this.currentSinceFiles);
      const previousGeneration = this.comparisonGeneration;
      const previousActivities = structuredClone(this.activities);
      try {
      this.fullComparison = refreshed;
      await this.updateRevisionSummary(refreshed);
      this.reconcileRevisionState(refreshed, this.currentSinceFiles);
      await this.selectComparisonView();
      this.comparisonGeneration += 1;
      this.revision += 1;
      operationRevision = this.revision;
      for (const comment of this.comments) {
        comment.status = this.reviewAnchorContent(comment.path, comment.side, comment.line) === comment.lineContent ? "active" : "outdated";
      }
      for (const step of tourSteps(this.outline)) {
        step.outdated = !this.findRow(step.anchor.path, step.anchor.side, step.anchor.startLine);
      }
      this.refreshFindingLifecycles();
      if (proposal && proposed && activeRequest) {
        this.recordAgentActivity(activeRequest.baselineComparison.files, proposed.files, context, proposal);
      }
      await this.persist();
      return this.snapshot();
      } catch (error) {
        if (this.status === "open" && this.terminalEpoch === terminalEpoch) {
          this.comparison = previousComparison;
          this.fullComparison = previousFullComparison;
          this.currentRevisionSummary = previousRevisionSummary;
          this.currentSinceFiles = previousSinceFiles;
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
      if (!this.pullRequest) throw new ReviewError("This is not a GitHub pull request review.");
      const wasClosed = this.status !== "open";
      if (wasClosed && this.status === "cancelled") throw new ReviewError("A cancelled review cannot be reopened.");
      if (wasClosed && this.bridge) throw new ReviewError("Attached-agent reviews cannot start a new pass after closing; start a new review session for the updated pull request.");
      if (!wasClosed) this.ensurePublicationMutable();
      if (this.activeAgentRequest) throw new ReviewError("Wait for the active agent request before refreshing the pull request.");
      const previousContext = structuredClone(this.pullRequest);
      const previousComparison = this.comparison;
      const previousFullComparison = this.fullComparison;
      const previousRevisionSummary = structuredClone(this.currentRevisionSummary);
      const previousSinceFiles = structuredClone(this.currentSinceFiles);
      const previousStatus = this.status;
      const previousRevision = this.revision;
      const previousGeneration = this.comparisonGeneration;
      const previousMutable = this.captureMutableState();
      let latest: PullRequestContext | undefined;
      try {
        latest = await updatePullRequestWorkspace(previousContext, this.defaults.githubRunner);
        const refreshed = await loadComparison(latest.workspaceRoot, latest.baseRefOid, this.preferences.contextLines);
        if (wasClosed && latest.headRefOid === previousContext.headRefOid) throw new ReviewError("The pull request has no new head revision to review.");
        if (wasClosed) latest.publication = undefined;
        this.pullRequest = latest;
        this.fullComparison = refreshed;
        await this.updateRevisionSummary(refreshed);
        this.reconcileRevisionState(refreshed, this.currentSinceFiles);
        await this.selectComparisonView();
        if (wasClosed) {
          this.status = "open";
          this.closePromise = undefined;
          this.terminalEpoch += 1;
          this.agent = this.selection ? this.createAgent(this.agentContinuation) : undefined;
        }
        this.comparisonGeneration += 1;
        this.revision += 1;
        const refreshedPaths = new Set(refreshed.files.map((file) => file.path));
        for (const path of this.reviewedFiles) if (!refreshedPaths.has(path)) this.reviewedFiles.delete(path);
        for (const comment of this.comments) {
          comment.status = this.reviewAnchorContent(comment.path, comment.side, comment.line) === comment.lineContent ? "active" : "outdated";
        }
        for (const step of tourSteps(this.outline)) step.outdated = !this.findRow(step.anchor.path, step.anchor.side, step.anchor.startLine);
        this.refreshFindingLifecycles();
        await this.persist();
        return this.snapshot();
      } catch (error) {
        if (latest?.headRefOid !== previousContext.headRefOid) {
          await runProcess(["git", "switch", "--detach", previousContext.headRefOid], previousContext.workspaceRoot).catch(() => undefined);
        }
        this.pullRequest = previousContext;
        this.comparison = previousComparison;
        this.fullComparison = previousFullComparison;
        this.currentRevisionSummary = previousRevisionSummary;
        this.currentSinceFiles = previousSinceFiles;
        this.status = previousStatus;
        this.revision = previousRevision;
        this.comparisonGeneration = previousGeneration;
        this.restoreMutableState(previousMutable, this.terminalEpoch, this.revision);
        throw error;
      }
    });
  }

  private assertCloseAllowed(outcome: ReviewOutcome, decision?: ReviewDecisionIntent): void {
    if (outcome !== "cancelled" && this.activities.some((activity) => activity.changeStatus === "pending")) {
      throw new ReviewError("Apply or reject every pending agent change before closing the review.");
    }
    if (outcome !== "cancelled" && this.preferences.requireAllFilesReviewed &&
      this.fullComparison.files.some((file) => !this.reviewedFiles.has(file.path))) {
      throw new ReviewError("Mark every changed file as reviewed before completing this review.");
    }
    if (outcome === "accepted" && this.comments.length > 0 && decision !== "approve-with-comments") {
      throw new ReviewError("Use Approve with comments, request changes, or remove all inline comments.");
    }
  }

  async publishPullRequest(outcome: Extract<ReviewOutcome, "accepted" | "feedback">, expectedHeadOid: string, decision: ReviewDecisionIntent = outcome === "accepted" ? "approve" : "request-changes", note?: string) {
    return this.serializeMutation(async () => {
      this.ensureOpen();
      if (!this.pullRequest) throw new ReviewError("This is not a GitHub pull request review.");
      if (expectedHeadOid !== this.pullRequest.headRefOid) throw new ReviewError("The confirmation is for an outdated pull request revision. Refresh and confirm again.");
      this.assertCloseAllowed(outcome, decision);
      const selected = this.comments.filter((comment) => comment.publishToGitHub);
      if (selected.some((comment) => comment.status !== "active")) throw new ReviewError("Outdated comments cannot be published to GitHub.");
      const commentIds = selected.map((comment) => comment.id).sort();
      const existing = this.pullRequest.publication;
      const existingDecision = existing?.decision ?? (existing?.outcome === "accepted" ? "approve" : "request-changes");
      if (existing && (existing.outcome !== outcome || existingDecision !== decision || existing.note !== note || JSON.stringify(existing.commentIds) !== JSON.stringify(commentIds))) {
        throw new ReviewError("A different GitHub review publication is already pending. Retry the original selection before changing it.");
      }
      const publication = existing
        ? { ...existing, decision: existingDecision }
        : { intentId: crypto.randomUUID(), outcome, decision, ...(note ? { note } : {}), commentIds, status: "pending" as const };
      this.pullRequest.publication = publication;
      this.revision += 1;
      await this.persist();
      if (publication.status !== "published") {
        const result = await publishGitHubReview(this.pullRequest, selected, outcome, publication.intentId, this.defaults.githubRunner, publication.note);
        this.pullRequest.publication = { ...publication, status: "published", reviewId: result.id, url: result.url };
        this.revision += 1;
        await this.persist();
      }
      return this.close(outcome, { githubPublished: true, decision, note });
    });
  }

  async close(outcome: ReviewOutcome, options: { githubPublished?: boolean; decision?: ReviewDecisionIntent; note?: string } = {}) {
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
    this.assertCloseAllowed(outcome, options.decision);
    this.closePromise = (async () => {
      const previousRevision = this.revision;
      let transitioned = false;
      let terminal: ReturnType<AttachedAgentBridge["prepareClose"]> | undefined;
      let createdCheckpoint: SourceCheckpoint | undefined;
      try {
        if (outcome !== "cancelled") {
          createdCheckpoint = await this.createCheckpointRecord("decision", options.decision, outcome);
        }
        const reviewedTree = outcome === "feedback" && this.bridge ? createdCheckpoint?.sourceTree : undefined;
        this.terminalEpoch += 1;
        this.status = outcome;
        this.revision += 1;
        transitioned = true;
        this.agent?.cancel();
        for (const worker of this.workerAgents) worker.cancel();
        this.workerAgents.clear();
        terminal = this.bridge?.prepareClose(outcome, this.comments, reviewedTree, options.decision, options.note);
        await this.persist();
      } catch (error) {
        if (createdCheckpoint) {
          this.checkpoints.splice(this.checkpoints.findIndex((checkpoint) => checkpoint.id === createdCheckpoint!.id), 1);
          await removeCheckpointRef(this.fullComparison.repositoryRoot, createdCheckpoint.ref).catch(() => undefined);
        }
        if (terminal) this.bridge?.rollbackPreparedClose(terminal.id);
        if (transitioned) {
          this.status = "open";
          this.revision = previousRevision;
          this.agent = this.selection
            ? this.createAgent(this.agentContinuation)
            : undefined;
        }
        this.closePromise = undefined;
        throw error;
      }
      this.bridge?.publishClose();
      this.resolveClosed(outcome);
      return { outcome, comments: this.comments, status: this.status, decision: options.decision, note: options.note };
    })();
    return this.closePromise;
  }

  async dispose(): Promise<void> {
    this.agent?.cancel();
    for (const worker of this.workerAgents) worker.cancel();
    this.workerAgents.clear();
    this.bridge?.dispose();
    await this.persistenceQueue.catch(() => undefined);
  }
}
