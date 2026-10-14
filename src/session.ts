import { buildBriefing, briefingFingerprint, briefingIntent, resolveBriefingQuestion, type BriefingQuestionRequest } from "./briefing.ts";
import { discoverAgentAdapters } from "./adapters.ts";
import { ReviewError } from "./errors.ts";
import { diffSourceIdentity, loadDiffSource } from "./diff-sources.ts";
import { reviewerSuggestions } from "./reviewer-suggestions.ts";
import { githubSuggestionBody, githubSuggestionRangeMatches, type SavedInlineEdit } from "./github-suggestions.ts";
import { TourAgent, type AgentTransportReply, type BridgePromptKind } from "./agent.ts";
import { validateReviewFlow } from "./flows.ts";
import { validateCallFlows } from "./call-flows.ts";
import { validateStructuralBlastRadii } from "./structural-blast-radius.ts";
import { groundedSequenceSources, sequenceArtifactSources, lookupSequenceDefinition } from "./sequence-sources.ts";
import { AttachedAgentBridge } from "./bridge.ts";
import { applyChangePatch, captureWorkingTreeSnapshot, createChangePatch, createProposalWorkspace, loadComparison, loadComparisonBetweenTrees, loadDiffFileWithContext, loadDiffImage, loadDiffText, loadRepositoryFile, removeCheckpointRef, removeProposalWorkspace, writeCheckpointRef, writeProposalFile, type ProposalWorkspace } from "./git.ts";
import { parseUnifiedDiff } from "./diff.ts";
import { DEFAULT_REVIEW_POLICY, DEFAULT_REVIEW_PREFERENCES } from "./config.ts";
import { extractAcceptanceCriteria, publishPullRequestReview as publishGitHubReview, updatePullRequestWorkspace, type GitHubRunner } from "./github.ts";
import { runProcess } from "./process.ts";
import { loadPersistedSession, savePersistedSession } from "./store.ts";
import { tourSteps } from "./tour.ts";
import type { FindingDisposition } from "./types.ts";
import type { AgentAdapterOption, AgentChangeActivity, AgentChangeFile, AgentRunActivity, AgentSelection, BriefingPreferences, ChatMessage, ComparisonView, DiffFile, DiffRow, DiffViewPreferences, DryRunDetail, DryRunFlowKind, DryRunPlan, DryRunScenario, DryRunTrace, GitComparison, PersistedReviewSession, PullRequestContext, ReasoningEffort, ReviewerTaskContext, ReviewComment, ReviewDecisionIntent, ReviewFlow, ReviewOutcome, ReviewPolicy, ReviewPreferences, ReviewScreenshot, ReviewStatus, RevisionSummary, SessionDiffPreferences, SourceCheckpoint, TourOutline } from "./types.ts";
import { isBriefingSectionOrder } from "./types.ts";
import { importReviewScreenshots, screenshotAssetPath } from "./screenshots.ts";
import { revisionSummary } from "./revision.ts";
import { diffPreferenceStoreDirectory, loadGlobalBriefingPreferences, loadGlobalDiffPreferences, restoreGlobalBriefingPreferences, restoreGlobalDiffPreferences, updateGlobalBriefingPreferences, updateGlobalDiffPreferences } from "./diff-preferences.ts";
import { buildNeedsAttention } from "./attention.ts";
import { comparisonFingerprint, dryRunPlanFor, dryRunScenarioFingerprint, traceIsStale, validateDryRunPlans, validateDryRunPlanSourceAnchors, validateDryRunScenario, validateTraceSourceAnchors } from "./dry-runs.ts";
import { ArchifyRenderer, archifyCandidates } from "./archify.ts";

type DiscussionScope = "line" | "range" | "stop";

interface AddCommentInput {
  scope?: DiscussionScope;
  path?: string;
  side?: "old" | "new";
  line?: number;
  endLine?: number;
  selectedText?: string;
  context?: string;
  stepId?: string;
  body: string;
}

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
  private readonly discussionSources = new Map<string, Promise<Awaited<ReturnType<typeof loadDiffSource>>>>();
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
  private readonly dryRunTraces: DryRunTrace[];
  private dryRunPreparation?: {
    id: string;
    flowId: string;
    scenarioId: string;
    detail?: DryRunDetail;
    worker: TourAgent;
    status: "preparing";
    startedAt: string;
  };
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
    this.preferences = structuredClone({
      ...DEFAULT_REVIEW_PREFERENCES,
      ...(defaults.preferences ?? {}),
      ...(persisted?.preferences ?? {}),
    });
    this.diffPreferences = structuredClone(persisted?.diffPreferences ?? initialDiffPreferences);
    const configuredReviewPolicy = structuredClone(persisted?.reviewPolicy ?? defaults.reviewPolicy ?? DEFAULT_REVIEW_POLICY);
    const pullRequestReview = Boolean(persisted?.pullRequest ?? defaults.pullRequest);
    this.reviewPolicy = pullRequestReview && defaults.includeFindings !== false
      ? { ...configuredReviewPolicy, findings: { ...configuredReviewPolicy.findings, enabled: true } }
      : configuredReviewPolicy;
    this.pullRequest = structuredClone(persisted?.pullRequest ?? defaults.pullRequest);
    this.screenshots = structuredClone(persisted?.screenshots ?? []);
    this.checkpoints = structuredClone(persisted?.checkpoints ?? []);
    this.checkpointRefNamespace = persisted?.checkpointRefNamespace ?? `refs/diffcompass/checkpoints/${this.refKey(defaults.stateFile)}`;
    this.comments = structuredClone(persisted?.comments ?? []);
    this.messages = structuredClone(persisted?.messages ?? []);
    this.activities = structuredClone(persisted?.activities ?? []);
    this.dryRunTraces = structuredClone(persisted?.dryRuns ?? []);
    const changedPaths = new Set(this.comparison.files.map((file) => file.path));
    this.reviewedFiles = new Set((persisted?.reviewedFiles ?? []).filter((path) => changedPaths.has(path)));
    this.sessionName = persisted?.name;
    this.archived = persisted?.archived ?? false;
    this.outline = persisted?.outline
      ? {
          ...structuredClone(persisted.outline),
          callFlows: validateCallFlows(persisted.outline.callFlows ?? [], this.comparison),
          structuralBlastRadii: validateStructuralBlastRadii(persisted.outline.structuralBlastRadii ?? [], this.comparison),
          flows: persisted.outline.flows ?? [],
          dryRunPlans: persisted.outline.dryRunPlans ? validateDryRunPlans(persisted.outline.dryRunPlans, { callFlows: persisted.outline.callFlows ?? [], flows: persisted.outline.flows ?? [] }, this.comparison) : [],
          findings: persisted.outline.findings ?? [],
        }
      : undefined;
    this.currentStepIndex = persisted?.currentStepIndex ?? -1;
    this.revision = persisted?.revision ?? 1;
    this.status = persisted?.status ?? "open";
    this.comparisonView = persisted?.comparisonView ?? "full";
    this.selectedCheckpointId = persisted?.selectedCheckpointId;
    this.fullComparison = comparison;
    this.currentRevisionSummary = { changedFiles: 0, additions: 0, deletions: 0, newFiles: [], changedAgainFiles: [], resolvedFiles: [], unchangedFiles: [], text: "No review checkpoint yet. Create one before refreshing to preserve reviewed files." };
    this.selection = persisted?.selection
      ? {
        ...structuredClone(persisted.selection),
        includeFindings: defaults.includeFindings === false ? false : persisted.selection.includeFindings,
        includeAdaptiveDiagrams: persisted.selection.includeAdaptiveDiagrams ?? true,
        includeDryRuns: persisted.selection.includeDryRuns ?? true,
        includeArchify: persisted.selection.includeArchify ?? Boolean(ArchifyRenderer.fromEnvironment()),
      }
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
    if (this.pullRequest?.publication && !(this.pullRequest.publication.outcome === "comment" && this.pullRequest.publication.status === "published")) {
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
      schemaVersion: 4,
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
      dryRuns: structuredClone(this.dryRunTraces),
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

  private async reviewAnchorContent(path: string, side: "old" | "new", line: number): Promise<string | undefined> {
    try { return (await this.discussionRange(path, side, line)).lineContent; }
    catch { return undefined; }
  }

  private githubCommentInDiff(path: string, side: "old" | "new", line: number): boolean {
    return Boolean(this.fullComparison.files.find(file => file.path === path)?.hunks.some(hunk =>
      hunk.rows.some(row => row.kind !== "meta" && (side === "old" ? row.oldLine : row.newLine) === line)));
  }

  private githubCommentUnavailableReason(comment: ReviewComment): string | undefined {
    if (!this.pullRequest) return undefined;
    if (comment.githubPublication) return undefined;
    if (comment.suggestion) {
      if (comment.status !== "active" || comment.suggestion.headOid !== this.pullRequest.headRefOid || comment.suggestion.sourceTree !== this.fullComparison.sourceTree) return "Local only · this suggestion belongs to an outdated PR source. Return it to local and create a new suggestion.";
      return undefined;
    }
    if (/\.png$/i.test(comment.path)) return "Local only · image comments are not included in GitHub reviews.";
    if (comment.scope === "range") return "Local only · quote and range comments are not included in GitHub reviews.";
    if (comment.scope === "stop") return "Local only · tour-stop comments are not included in GitHub reviews.";
    if (!this.githubCommentInDiff(comment.path, comment.side, comment.line)) return "Local only · this line is outside the GitHub diff.";
    return undefined;
  }

  private githubSuggestionUnavailableReason(activity: AgentChangeActivity): string | undefined {
    if (!this.pullRequest) return "GitHub suggestions require a pull request review.";
    if (!activity.inlineEdit || activity.source !== "reviewer" || activity.modelId !== "inline-edit") return "Create a new suggestion to capture its exact source selection.";
    const edit = activity.inlineEdit;
    if (edit.githubUnavailableReason) return edit.githubUnavailableReason;
    if (edit.headOid !== this.pullRequest.headRefOid || edit.sourceTree !== this.fullComparison.sourceTree) return "This suggestion belongs to an outdated PR source. Create a new suggestion.";
    if (activity.changeStatus !== "pending") return "Only pending local suggestions can be added to the GitHub review.";
    return undefined;
  }

  private async validateGitHubSuggestion(edit: SavedInlineEdit): Promise<void> {
    if (!this.pullRequest) throw new ReviewError("GitHub suggestions require a pull request review.");
    if (edit.headOid !== this.pullRequest.headRefOid || edit.sourceTree !== this.fullComparison.sourceTree) throw new ReviewError("This suggestion belongs to an outdated PR source. Create a new suggestion.");
    if (githubSuggestionBody(edit.replacement).length > 8_000 || edit.expectedContent.length > 32_000) throw new ReviewError("This suggestion exceeds the GitHub review draft limit (8,000 characters and 100 source lines).");
    const source = await loadDiffSource(this.fullComparison, diffSourceIdentity(this.fullComparison), edit.path);
    if (!source.available) throw new ReviewError("Only captured regular text files can be suggested on GitHub.");
    const tree = (await runProcess(["git", "rev-parse", `${this.pullRequest.headRefOid}^{tree}`], this.fullComparison.repositoryRoot)).stdout.trim();
    if (tree !== edit.sourceTree) throw new ReviewError("Local source changes are not part of the GitHub PR head. Refresh a clean PR workspace before adding suggestions.");
    // Expanded review context is not necessarily commentable on GitHub. Use
    // the immutable PR diff with GitHub's ordinary three lines of context.
    const patch = await runProcess(["git", "diff", "--no-ext-diff", "--no-textconv", "--no-color", "--find-renames", "--unified=3", "--inter-hunk-context=0", this.fullComparison.mergeBase, this.pullRequest.headRefOid, "--"], this.fullComparison.repositoryRoot);
    if (!githubSuggestionRangeMatches(parseUnifiedDiff(patch.stdout), edit)) throw new ReviewError("GitHub suggestions must select at most 100 After lines inside one PR diff hunk; expanded context stays local.");
    const normalized = source.new.replaceAll("\r\n", "\n");
    const lines = normalized.split("\n");
    if (normalized.endsWith("\n")) lines.pop();
    if (edit.endLine > lines.length || lines.slice(edit.line - 1, edit.endLine).join("\n") !== edit.expectedContent) throw new ReviewError("This suggestion no longer matches the captured PR source.");
  }

  async setSuggestionPublication(id: string, queue: boolean, expectedHeadOid?: string) {
    return this.serializeMutation(async () => {
      this.ensureOpen();
      this.ensurePublicationMutable();
      const activity = this.activities.find(candidate => candidate.id === id);
      if (!activity?.inlineEdit || !activity.proposal || activity.source !== "reviewer" || activity.modelId !== "inline-edit") throw new ReviewError("This activity has no saved reviewer suggestion.");
      const existing = this.comments.find(comment => comment.suggestion?.activityId === id);
      if (existing?.githubPublication) throw new ReviewError("This suggestion was published on GitHub. Create a new suggestion to propose another change.");
      if (queue && activity.changeStatus === "queued" && existing) return this.snapshot();
      if (queue) {
        if (expectedHeadOid !== this.pullRequest?.headRefOid) throw new ReviewError("The suggestion draft is for an outdated pull request revision.");
        const reason = this.githubSuggestionUnavailableReason(activity);
        if (reason) throw new ReviewError(reason);
        await this.validateGitHubSuggestion(activity.inlineEdit);
      } else if (activity.changeStatus !== "queued" || !existing) throw new ReviewError("This suggestion is not queued in the GitHub review.");
      const previousComments = [...this.comments], previousStatus = activity.changeStatus, previousUpdatedAt = activity.updatedAt, previousRevision = this.revision;
      const edit = activity.inlineEdit;
      const now = new Date().toISOString();
      if (queue) {
        if (this.comments.length >= 10_000) throw new ReviewError("This review has reached its comment limit.");
        this.comments.push({ id: crypto.randomUUID(), path: edit.path, side: "new", line: edit.line, endLine: edit.endLine,
          scope: edit.line === edit.endLine ? "line" : "range", context: edit.expectedContent, lineContent: edit.expectedContent.split("\n")[0]!,
          body: githubSuggestionBody(edit.replacement), status: "active", publishToGitHub: true,
          suggestion: { activityId: id, headOid: edit.headOid!, sourceTree: edit.sourceTree, replacement: edit.replacement }, createdAt: now, updatedAt: now });
      } else this.comments.splice(this.comments.indexOf(existing!), 1);
      activity.changeStatus = queue ? "queued" : "pending";
      activity.updatedAt = now;
      this.revision += 1;
      try { await this.persist(); return this.snapshot(); } catch (error) {
        this.comments.splice(0, this.comments.length, ...previousComments);
        activity.changeStatus = previousStatus; activity.updatedAt = previousUpdatedAt; this.revision = previousRevision;
        throw error;
      }
    });
  }

  private refreshFindingLifecycles(): void {
    for (const finding of this.outline?.findings ?? []) {
      const row = this.findRow(finding.path, finding.side, finding.line);
      const outdated = row?.content !== finding.lineContent;
      finding.outdated = outdated;
    }
  }

  private async discussionRange(path: string, side: "old" | "new", startLine: number, endLine = startLine): Promise<{ lineContent: string; context: string }> {
    if (!this.comparison.files.some((file) => file.path === path)) {
      throw new ReviewError("Discussion anchor path must reference a changed file in this comparison.");
    }
    if (!["old", "new"].includes(side) || !Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine) || startLine < 1 || endLine < startLine) {
      throw new ReviewError("Discussion anchor lines must be positive and ordered.");
    }
    if (endLine - startLine > 99) throw new ReviewError("Discussion ranges cannot exceed 100 lines.");
    const file = this.comparison.files.find((candidate) => candidate.path === path);
    const imageExists = side === "old" ? file?.oldPath : file?.newPath;
    if (file && /\.png$/i.test(file.path) && imageExists && startLine === 1 && endLine === 1) {
      return { lineContent: `[PNG image · ${side}]`, context: `[PNG image · ${side}]` };
    }
    const rows = Array.from({ length: endLine - startLine + 1 }, (_, index) => this.findRow(path, side, startLine + index));
    if (rows.every(Boolean)) return { lineContent: rows[0]!.content, context: rows.map(row => row!.content).join("\n") };
    // Expanded context is still part of the captured comparison, never the
    // mutable checkout. Reuse the bounded regular-text source loader, keyed by
    // immutable comparison identity; keep at most eight files in memory.
    const comparison = this.comparison, identity = diffSourceIdentity(comparison);
    const key = JSON.stringify([comparison.repositoryRoot, identity, path]);
    let source = this.discussionSources.get(key);
    if (!source) {
      source = loadDiffSource(comparison, identity, path);
      this.discussionSources.set(key, source);
      if (this.discussionSources.size > 8) this.discussionSources.delete(this.discussionSources.keys().next().value!);
    }
    const captured = await source;
    if (!captured.available) throw new ReviewError("Captured context is unavailable for this file. Use a line in the current diff.");
    const text = captured[side], lines = text.split("\n");
    if (text.endsWith("\n")) lines.pop();
    if (!text || endLine > lines.length) throw new ReviewError("Discussion range must cover consecutive lines in the captured file.");
    return { lineContent: lines[startLine - 1]!, context: lines.slice(startLine - 1, endLine).join("\n") };
  }

  private async normalizeQuestionAnchor(anchor: NonNullable<ChatMessage["anchor"]>): Promise<NonNullable<ChatMessage["anchor"]>> {
    const endLine = anchor.endLine ?? anchor.line;
    const range = await this.discussionRange(anchor.path, anchor.side, anchor.line, endLine);
    if (anchor.content !== range.lineContent) throw new ReviewError("The selected code changed. Select the line or range again before asking.");
    if (anchor.context !== undefined && anchor.context !== range.context) {
      throw new ReviewError("The selected code context changed. Select the range again before asking.");
    }
    if (anchor.selectedText !== undefined) {
      if (!anchor.selectedText.trim() || anchor.selectedText.length > 16_000 || !range.context.includes(anchor.selectedText)) {
        throw new ReviewError("Selected quotation is invalid for the current diff range.");
      }
    }
    if (endLine === anchor.line && anchor.selectedText === undefined && anchor.context === undefined) return structuredClone(anchor);
    return { ...structuredClone(anchor), endLine, context: range.context };
  }

  private resolveDiscussionStep(stepId: string): NonNullable<ReturnType<typeof tourSteps>[number]> {
    if (!stepId || stepId.length > 128) throw new ReviewError("A valid tour stop id is required.");
    const step = tourSteps(this.outline).find((candidate) => candidate.id === stepId);
    if (!step) throw new ReviewError("Discussion stop does not exist in the current tour.");
    return step;
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

  private async reconcileRevisionState(full: GitComparison, sinceFiles: DiffFile[]): Promise<void> {
    const changedPaths = new Set(sinceFiles.map((file) => file.path));
    const currentPaths = new Set(full.files.map((file) => file.path));
    const checkpoint = this.latestCheckpoint();
    const reviewedAtCheckpoint = new Set(checkpoint?.reviewedFiles ?? []);
    this.reviewedFiles.clear();
    for (const path of reviewedAtCheckpoint) if (currentPaths.has(path) && !changedPaths.has(path)) this.reviewedFiles.add(path);
    this.comparison = full;
    for (const comment of this.comments) {
      try {
        const range = await this.discussionRange(comment.path, comment.side, comment.line, comment.endLine ?? comment.line);
        comment.status = range.lineContent === comment.lineContent && (!comment.context || range.context === comment.context) ? "active" : "outdated";
      } catch { comment.status = "outdated"; }
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
    for (const trace of this.dryRunTraces) {
      if (trace.comparison.fingerprint !== comparisonFingerprint(full)) trace.stale = true;
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
        await this.reconcileRevisionState(this.fullComparison, this.currentSinceFiles);
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
    const preferenceDirectory = defaults.diffPreferenceDirectory ?? diffPreferenceStoreDirectory(defaults.stateFile);
    const globalBriefingPreferences = await loadGlobalBriefingPreferences(preferenceDirectory);
    const preferences = persisted?.preferences ?? {
      ...DEFAULT_REVIEW_PREFERENCES,
      ...(defaults.preferences ?? {}),
      ...(globalBriefingPreferences ?? {}),
    };
    const comparison = await loadComparison(persisted?.repositoryRoot ?? cwd, persisted?.base ?? base, preferences.contextLines);
    if (persisted && (
      comparison.repositoryRoot !== persisted.repositoryRoot ||
      comparison.base !== persisted.base
    )) throw new ReviewError("The persisted review does not match the requested repository comparison.");
    const adapters = structuredClone(defaults.agentAdapters ?? await discoverAgentAdapters(comparison.repositoryRoot));
    const preferenceRepositoryRoot = persisted?.pullRequest?.sourceRepositoryRoot ?? defaults.pullRequest?.sourceRepositoryRoot ?? comparison.repositoryRoot;
    const globalDiffPreferences = await loadGlobalDiffPreferences(preferenceDirectory, preferenceRepositoryRoot);
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
    if (session.outline && !session.outline.briefing) session.outline.briefing = await buildBriefing(session.comparison, session.outline, session.briefingIntent());
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
    await session.resumeReviewerTaskAssessment();
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
      includeAdaptiveDiagrams: input.includeAdaptiveDiagrams ?? true,
      includeDryRuns: input.includeDryRuns ?? true,
      includeArchify: input.includeArchify ?? Boolean(ArchifyRenderer.fromEnvironment()),
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
      includeAdaptiveDiagrams: this.selection.includeAdaptiveDiagrams,
      includeDryRuns: this.selection.includeDryRuns,
      includeArchify: this.selection.includeArchify,
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
    const outline = structuredClone(this.outline);
    if (outline?.briefing) outline.briefing.outdated = Boolean(outline.briefing.outdated) || outline.briefing.fingerprint !== briefingFingerprint(this.comparison, this.briefingIntent());
    // HTML is served as a separately sandboxed local resource. Keeping it out
    // of routine JSON snapshots avoids repeatedly moving multi-megabyte HTML.
    if (outline?.archifyArtifacts) {
      outline.archifyArtifacts = outline.archifyArtifacts.map(({ html: _html, comparison, ...artifact }) => ({
        ...artifact,
        ...(comparison ? {
          comparison: Object.fromEntries(Object.entries(comparison).map(([key, view]) => [key, view ? (({ html: _viewHtml, ...safeView }) => safeView)(view) : view])),
        } : {}),
      })) as typeof outline.archifyArtifacts;
    }
    return {
      comparison,
      outline,
      currentStepIndex: this.currentStepIndex,
      comments: this.comments.map(comment => {
        const githubUnavailableReason = this.githubCommentUnavailableReason(comment);
        const githubPublished = Boolean(comment.githubPublication || (this.pullRequest?.publication?.status === "published" && this.pullRequest.publication.commentIds.includes(comment.id)));
        return { ...comment, ...(githubUnavailableReason ? { githubUnavailableReason } : {}), ...(comment.suggestion ? { githubPublished } : {}) };
      }),
      messages: this.messages,
      activities: this.activities.map(({ proposal, ...activity }) => {
        const inlineSuggestions = reviewerSuggestions({ ...activity, proposal });
        const githubSuggestionUnavailableReason = this.githubSuggestionUnavailableReason(activity);
        const githubSuggestionPublished = this.comments.some(comment => comment.suggestion?.activityId === activity.id && (comment.githubPublication || (this.pullRequest?.publication?.status === "published" && this.pullRequest.publication.commentIds.includes(comment.id))));
        return { ...activity, hasProposal: Boolean(proposal), ...(inlineSuggestions.length ? { inlineSuggestions } : {}),
          ...(this.pullRequest && activity.source === "reviewer" ? { githubSuggestionUnavailableReason, canQueueGitHubSuggestion: !githubSuggestionUnavailableReason, githubSuggestionPublished } : {}) };
      }),
      reviewedFiles: [...this.reviewedFiles].sort(),
      checkpoints: structuredClone(this.checkpoints),
      comparisonView: this.comparisonView,
      selectedCheckpointId: this.selectedCheckpointId ?? this.latestCheckpoint()?.id,
      revisionSummary: structuredClone(this.currentRevisionSummary),
      diffPreferences: structuredClone(this.diffPreferences),
      preferences: structuredClone(this.preferences),
      reviewPolicy: structuredClone(this.reviewPolicy),
      findingGenerationEnabled: this.defaults.includeFindings !== false,
      dryRunGenerationEnabled: this.selection?.includeDryRuns !== false,
      dryRunPlans: structuredClone(this.outline?.dryRunPlans ?? []),
      dryRuns: this.dryRunTraces.map((trace) => ({ ...structuredClone(trace), ...(traceIsStale(trace, this.comparison, this.outline ?? { dryRunPlans: [] }) ? { stale: true } : {}) })),
      dryRunPreparation: this.dryRunPreparation
        ? { id: this.dryRunPreparation.id, flowId: this.dryRunPreparation.flowId, scenarioId: this.dryRunPreparation.scenarioId, ...(this.dryRunPreparation.detail ? { detail: this.dryRunPreparation.detail } : {}), status: this.dryRunPreparation.status, startedAt: this.dryRunPreparation.startedAt }
        : undefined,
      pullRequest: structuredClone(this.pullRequest),
      screenshots: structuredClone(this.screenshots),
      revision: this.revision,
      status: this.status,
      agentAdapters: this.agentAdapters,
      agentSelection: this.selection ?? (this.agentAdapters.length > 0 ? this.resolveSelection() : undefined),
      agentMode: this.selection ? `${this.selection.adapterId}-read-only` : undefined,
      agentActivity: structuredClone(this.agentActivity),
      tourState: this.outline ? "active" as const : this.tourPlanning ? "planning" as const : "idle" as const,
      needsAttention: buildNeedsAttention(this.comparison, this.outline, this.pullRequest),
      archifyAvailable: Boolean(ArchifyRenderer.fromEnvironment()),
    };
  }

  /** Prepared traces are exported as saved, offline review evidence. */
  exportDryRuns(): DryRunTrace[] {
    return this.dryRunTraces.map((trace) => ({
      ...structuredClone(trace),
      ...(traceIsStale(trace, this.comparison, this.outline ?? { dryRunPlans: [] }) ? { stale: true } : {}),
    }));
  }

  archifyArtifact(id: string) {
    return this.outline?.archifyArtifacts?.find((artifact) => artifact.id === id);
  }

  archifySequenceSources(id: string) {
    const artifact = this.archifyArtifact(id);
    return artifact ? sequenceArtifactSources(artifact, this.outline?.flows ?? [], this.comparison) : {};
  }

  async resolveArchifySequenceSources(id: string, edgeId: string) {
    const sources = this.archifySequenceSources(id);
    const artifact = this.archifyArtifact(id);
    if (artifact && !sources[edgeId]) sources[edgeId] = await lookupSequenceDefinition(artifact, this.outline?.flows ?? [], this.comparison, edgeId);
    return sources;
  }

  /**
   * Archify is optional. A renderer failure is kept beside the tour as a
   * diagnostic and never discards the normal Mermaid review path.
   */
  private async refreshArchifyArtifacts(outline: TourOutline, previous?: TourOutline): Promise<void> {
    if (!this.selection?.includeArchify) {
      delete outline.archifyArtifacts;
      delete outline.archifyFailures;
      return;
    }
    const candidates = archifyCandidates(outline);
    if (candidates.length === 0) {
      outline.archifyArtifacts = [];
      outline.archifyFailures = [];
      return;
    }
    const renderer = ArchifyRenderer.fromEnvironment();
    if (!renderer) {
      const prior = new Map((previous?.archifyArtifacts ?? []).map((artifact) => [artifact.id, artifact]));
      outline.archifyArtifacts = candidates.flatMap((candidate) => prior.get(candidate.id) ? [prior.get(candidate.id)!] : []);
      outline.archifyFailures = candidates.map((candidate) => ({
        id: candidate.id,
        type: candidate.type,
        message: "The Archify renderer is missing. Reinstall the release package, or configure DIFFCOMPASS_ARCHIFY_DIR for a development checkout.",
        preservedLastValid: prior.has(candidate.id),
      }));
      return;
    }
    const rendered = await renderer.render(outline, previous?.archifyArtifacts);
    outline.archifyArtifacts = rendered.artifacts;
    outline.archifyFailures = rendered.failures;
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

  async expandedDiffFile(path: string, context: number, requestedOffset = 0, requestedLimit = 1_000, fullFile = false, anchor?: { line: number; side: "old" | "new" }) {
    const file = await loadDiffFileWithContext(this.comparison, path, context, fullFile);
    return this.pageDiffFile(file, requestedOffset, requestedLimit, anchor);
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

  async setFileReviewed(path: string, reviewed: boolean, expectedComparisonId?: string) {
    return this.serializeMutation(async () => {
      if (expectedComparisonId !== undefined && expectedComparisonId !== diffSourceIdentity(this.comparison)) throw new ReviewError("This action belongs to a previous comparison. Review the new source before marking it reviewed.");
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

  async proposeInlineEdit(path: string, side: "new", line: number, expectedContent: string, replacement: string, requestedEndLine?: number, expectedComparisonId?: string) {
    return this.serializeMutation(async () => {
      if (expectedComparisonId !== undefined && expectedComparisonId !== diffSourceIdentity(this.comparison)) throw new ReviewError("This draft belongs to a previous comparison. Copy or cancel it before reviewing the new source.");
      this.ensureOpen();
      if (side !== "new") throw new ReviewError("Only lines on the new side of a changed file can be edited.");
      this.ensurePublicationMutable();
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
        if (!Number.isSafeInteger(line) || !Number.isSafeInteger(endLine) || line < 1 || endLine < line || endLine > lines.length || lines.slice(line - 1, endLine).join("\n") !== expectedContent) {
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

        const inlineEdit: SavedInlineEdit = { path, line, endLine, expectedContent, replacement: replacement.replaceAll("\r\n", "\n"), sourceTree: workspace.tree,
          ...(this.pullRequest ? { headOid: this.pullRequest.headRefOid } : {}) };
        if (this.pullRequest) {
          try { await this.validateGitHubSuggestion(inlineEdit); }
          catch (error) { inlineEdit.githubUnavailableReason = error instanceof Error ? error.message : "This suggestion cannot be added to GitHub."; }
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
          inlineEdit,
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
      this.ensurePublicationMutable();
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
          await this.reconcileRevisionState(this.fullComparison, this.currentSinceFiles);
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

  async setBriefingPreferences(preferences: BriefingPreferences) {
    return this.serializeMutation(async () => {
      this.ensureOpen();
      if (![preferences.showBriefing, preferences.briefingArchitecture, preferences.briefingSequenceDiagrams, preferences.briefingCallFlows, preferences.briefingNeedsAttention, preferences.briefingReviewEffort].every((value) => typeof value === "boolean") || !isBriefingSectionOrder(preferences.briefingOrder)) {
        throw new ReviewError("Briefing preferences are invalid.");
      }
      const previous = structuredClone(this.preferences);
      const next = { ...this.preferences, ...preferences };
      if (JSON.stringify(previous) === JSON.stringify(next)) return this.snapshot();
      const previousRevision = this.revision;
      Object.assign(this.preferences, preferences);
      this.revision += 1;
      const preferenceDirectory = this.defaults.diffPreferenceDirectory ?? diffPreferenceStoreDirectory(this.defaults.stateFile);
      let globalUpdated = false;
      let previousGlobal: BriefingPreferences | undefined;
      try {
        previousGlobal = await updateGlobalBriefingPreferences(preferenceDirectory, preferences);
        globalUpdated = preferenceDirectory !== undefined;
        await this.persist();
      } catch (error) {
        Object.assign(this.preferences, previous);
        this.revision = previousRevision;
        if (globalUpdated) await restoreGlobalBriefingPreferences(preferenceDirectory, previousGlobal).catch(() => undefined);
        throw error;
      }
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
        (selection.includeFindings !== undefined && selection.includeFindings !== this.selection?.includeFindings) ||
        (selection.includeAdaptiveDiagrams !== undefined && selection.includeAdaptiveDiagrams !== this.selection?.includeAdaptiveDiagrams) ||
        (selection.includeDryRuns !== undefined && selection.includeDryRuns !== this.selection?.includeDryRuns) ||
        (selection.includeArchify !== undefined && selection.includeArchify !== this.selection?.includeArchify)
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
            this.pullRequest?.linkedIssue,
            this.briefingIntent(),
          );
          receipts.push(...generated.receipts);
          this.ensureComparisonCurrent(comparisonGeneration);
          await validateDryRunPlanSourceAnchors(generated.value.dryRunPlans ?? [], (path) => loadRepositoryFile(this.comparison, path));
          await this.refreshArchifyArtifacts(generated.value, before.outline);
          generated.value.briefing = await buildBriefing(this.comparison, generated.value, this.briefingIntent());
          delete generated.value.briefingProposal;
          this.outline = generated.value;
          this.currentStepIndex = 0;
        } else if (this.currentStepIndex < 0 || this.currentStepIndex >= tourSteps(this.outline).length) {
          this.currentStepIndex = 0;
        }
        if (!this.outline.briefing) this.outline.briefing = await buildBriefing(this.comparison, this.outline, this.briefingIntent());
        this.ensureComparisonCurrent(comparisonGeneration);
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
        if (flow.messageSources) flow.messageSources = groundedSequenceSources(flow, this.comparison);
        if (flow.affectedFiles?.some((path) => !this.comparison.files.some((file) => file.path === path))) {
          throw new Error("Flow affectedFiles must reference changed files in this comparison.");
        }
      } catch (error) {
        throw new ReviewError(error instanceof Error ? error.message : String(error));
      }
      const previous = this.outline.flows[index]!;
      const previousArchify = structuredClone(this.outline.archifyArtifacts);
      const previousArchifyFailures = structuredClone(this.outline.archifyFailures);
      const previousRevision = this.revision;
      this.outline.flows[index] = flow;
      await this.refreshArchifyArtifacts(this.outline, { archifyArtifacts: previousArchify } as TourOutline);
      this.revision += 1;
      try {
        await this.persist();
        return this.snapshot();
      } catch (error) {
        this.outline.flows[index] = previous;
        this.outline.archifyArtifacts = previousArchify;
        this.outline.archifyFailures = previousArchifyFailures;
        this.revision = previousRevision;
        throw error;
      }
    });
  }

  async retrySequenceDiagrams() {
    return this.serialize(async () => {
      const before = this.captureMutableState();
      const terminalEpoch = this.terminalEpoch;
      const comparisonGeneration = this.comparisonGeneration;
      let operationRevision = before.revision;
      try {
        this.ensureOpen();
        if (!this.outline) throw new ReviewError("Start the tour first.");
        const failedIds = new Set((this.outline.archifyFailures ?? []).filter(failure => failure.type === "sequence").map(failure => failure.id));
        if (!failedIds.size) return this.snapshot();
        const ids = new Set(archifyCandidates(this.outline).filter(candidate => candidate.type === "sequence" && failedIds.has(candidate.id)).map(candidate => candidate.id));
        if (!ids.size) throw new ReviewError("The saved sequence source is unsupported. Edit its source before retrying.");
        const renderer = ArchifyRenderer.fromEnvironment();
        if (!renderer) throw new ReviewError("The diagram renderer is unavailable. Restore the renderer before retrying.");
        // Retry rendering saved source only. Never invoke the agent, replace
        // healthy maps, or regenerate the review/sequence evidence.
        const rendered = await renderer.render(this.outline, this.outline.archifyArtifacts, ids);
        this.ensureComparisonCurrent(comparisonGeneration);
        this.ensureOpen();
        if (this.revision !== before.revision) throw new ReviewError("The review changed while diagrams were being retried. Retry against the latest session.");
        this.outline.archifyArtifacts = [...(this.outline.archifyArtifacts ?? []).filter(artifact => !ids.has(artifact.id)), ...rendered.artifacts];
        this.outline.archifyFailures = [...(this.outline.archifyFailures ?? []).filter(failure => !ids.has(failure.id)), ...rendered.failures];
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

  private briefingIntent(): string { return briefingIntent({ pullRequest: this.pullRequest, reviewerTask: this.pullRequest?.reviewerTask }); }

  async regenerateBriefing() {
    return this.serialize(async () => {
      const before = this.captureMutableState(), terminalEpoch = this.terminalEpoch;
      const comparisonGeneration = this.comparisonGeneration;
      let operationRevision = before.revision;
      try {
        this.ensureOpen();
        if (!this.outline) throw new ReviewError("Start the tour to prepare a Briefing.");
        if (!this.agent) { this.selection = this.resolveSelection(); this.agent = this.createAgent(); }
        const intent = this.briefingIntent();
        const base = await buildBriefing(this.comparison, this.outline, intent, undefined);
        const generated = await this.agent.regenerateBriefing(this.comparison, this.outline, base, intent);
        this.ensureComparisonCurrent(comparisonGeneration);
        if (this.revision !== before.revision) throw new ReviewError("The review changed. Regenerate Briefing against the latest snapshot.");
        const document = await buildBriefing(this.comparison, this.outline, intent, generated.value);
        this.ensureComparisonCurrent(comparisonGeneration);
        this.ensureOpen();
        if (this.revision !== before.revision) throw new ReviewError("The review changed while validating Briefing evidence. Retry against the latest snapshot.");
        this.outline.briefing = document;
        this.revision += 1; operationRevision = this.revision;
        await this.persistAgentResult(generated.receipts);
        return this.snapshot();
      } catch (error) { this.restoreMutableState(before, terminalEpoch, operationRevision); throw error; }
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
        await this.refreshArchifyArtifacts(this.outline, before.outline);
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
        await this.refreshArchifyArtifacts(this.outline, before.outline);
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

  private currentDryRunPlan(flowKind: DryRunFlowKind, flowId: string): DryRunPlan {
    const plan = this.outline ? dryRunPlanFor(this.outline, flowKind, flowId) : undefined;
    if (!plan) throw new ReviewError("No dry-run scenarios are available for this flow.");
    return plan;
  }

  private finishDryRunPreparation(id: string): void {
    if (this.dryRunPreparation?.id === id) this.dryRunPreparation = undefined;
  }

  async prepareDryRunPlans() {
    return this.serialize(async () => {
      this.ensureOpen();
      if (!this.outline) throw new ReviewError("Start the tour before preparing dry-run scenarios.");
      if (this.selection?.includeDryRuns === false) throw new ReviewError("Enable dry runs before preparing scenarios.");
      if (this.dryRunPreparation?.status === "preparing") throw new ReviewError("Another dry-run preparation is already in progress.");
      if (!this.agent) {
        this.selection = this.resolveSelection({ includeDryRuns: true });
        this.agent = this.createAgent();
      }
      const id = crypto.randomUUID();
      const comparisonGeneration = this.comparisonGeneration;
      const worker = this.createWorkerAgent();
      const outline = this.outline;
      this.dryRunPreparation = { id, flowId: "planning", scenarioId: "planning", worker, status: "preparing", startedAt: new Date().toISOString() };
      worker.useComparison(this.comparison);
      try {
        const generated = await worker.generateDryRunPlans(this.comparison, outline);
        return await this.serializeMutation(async () => {
          if (this.dryRunPreparation?.id !== id || this.dryRunPreparation.status !== "preparing") throw new ReviewError("Dry-run scenario planning was cancelled.");
          this.ensureOpen();
          this.ensureComparisonCurrent(comparisonGeneration);
          if (!this.outline) throw new ReviewError("The tour changed while dry-run scenarios were being prepared.");
          await validateDryRunPlanSourceAnchors(generated.value, (path) => loadRepositoryFile(this.comparison, path));
          this.outline.dryRunPlans = generated.value;
          for (const trace of this.dryRunTraces) {
            if (traceIsStale(trace, this.comparison, this.outline)) trace.stale = true;
          }
          this.dryRunPreparation = undefined;
          this.revision += 1;
          await this.persistAgentResult(generated.receipts);
          return this.snapshot();
        });
      } finally {
        this.finishDryRunPreparation(id);
        this.workerAgents.delete(worker);
        worker.cancel();
      }
    });
  }

  async updateDryRunScenario(flowKind: DryRunFlowKind, flowId: string, scenario: unknown) {
    return this.serializeMutation(async () => {
      this.ensureOpen();
      if (this.selection?.includeDryRuns === false) throw new ReviewError("Enable dry runs before editing scenarios.");
      const plan = this.currentDryRunPlan(flowKind, flowId);
      const normalized = validateDryRunScenario(scenario, "scenario");
      const existingIndex = plan.scenarios.findIndex((candidate) => candidate.id === normalized.id);
      if (existingIndex < 0 && plan.scenarios.length >= 8) throw new ReviewError("Each execution flow can retain at most eight scenarios.");
      const previous = existingIndex >= 0 ? plan.scenarios[existingIndex] : undefined;
      const next: DryRunScenario = { ...normalized, source: "reviewer", updatedAt: new Date().toISOString() };
      if (existingIndex >= 0) plan.scenarios[existingIndex] = next; else plan.scenarios.push(next);
      for (const trace of this.dryRunTraces) {
        if (trace.flowId === plan.flowId && trace.flowKind === plan.flowKind && trace.scenario.id === next.id && (!previous || dryRunScenarioFingerprint(previous) !== dryRunScenarioFingerprint(next))) {
          trace.stale = true;
        }
      }
      this.revision += 1;
      try {
        await this.persist();
        return this.snapshot();
      } catch (error) {
        if (existingIndex >= 0 && previous) plan.scenarios[existingIndex] = previous; else plan.scenarios.pop();
        this.revision -= 1;
        throw error;
      }
    });
  }

  async prepareDryRun(flowKind: DryRunFlowKind, flowId: string, scenarioId: string, detail: DryRunDetail = "compact") {
    return this.serialize(async () => {
      this.ensureOpen();
      if (this.selection?.includeDryRuns === false) throw new ReviewError("Enable dry runs before preparing a simulated execution.");
      if (!this.outline) throw new ReviewError("Start the tour before preparing a simulated execution.");
      if (this.dryRunPreparation?.status === "preparing") throw new ReviewError("Another dry-run preparation is already in progress.");
      const plan = this.currentDryRunPlan(flowKind, flowId);
      const scenario = plan.scenarios.find((candidate) => candidate.id === scenarioId);
      if (!scenario) throw new ReviewError("The selected dry-run scenario does not exist.");
      if (!this.agent) {
        this.selection = this.resolveSelection({ includeDryRuns: true });
        this.agent = this.createAgent();
      }
      const id = crypto.randomUUID();
      const scenarioFingerprint = dryRunScenarioFingerprint(scenario);
      const comparisonGeneration = this.comparisonGeneration;
      const worker = this.createWorkerAgent();
      const outline = this.outline;
      const retainedTrace = this.dryRunTraces.find((trace) => trace.flowKind === flowKind && trace.flowId === flowId && trace.scenario.id === scenarioId);
      const compactTrace = detail === "detailed" && retainedTrace && !traceIsStale(retainedTrace, this.comparison, outline) && retainedTrace.detail !== "detailed" && retainedTrace.steps.length <= 8
        ? retainedTrace
        : undefined;
      this.dryRunPreparation = { id, flowId: `${flowKind}:${flowId}`, scenarioId, detail, worker, status: "preparing", startedAt: new Date().toISOString() };
      worker.useComparison(this.comparison);
      try {
        const generated = await worker.prepareDryRunTrace(this.comparison, outline, plan.flowId, plan.flowKind, scenario, detail, compactTrace);
        if (compactTrace && generated.value.steps.length <= compactTrace.steps.length) {
          throw new ReviewError("The detailed walkthrough did not add any source-grounded steps. Try preparing it again, or use the compact walkthrough.");
        }
        await validateTraceSourceAnchors(generated.value, (path) => loadRepositoryFile(this.comparison, path));
        return await this.serializeMutation(async () => {
          if (this.dryRunPreparation?.id !== id || this.dryRunPreparation.status !== "preparing") throw new ReviewError("Dry-run preparation was cancelled.");
          this.ensureOpen();
          this.ensureComparisonCurrent(comparisonGeneration);
          const currentPlan = this.currentDryRunPlan(flowKind, flowId);
          const currentScenario = currentPlan.scenarios.find((candidate) => candidate.id === scenarioId);
          if (!currentScenario || dryRunScenarioFingerprint(currentScenario) !== scenarioFingerprint) {
            throw new ReviewError("Scenario inputs changed while the walkthrough was being prepared. Prepare it again for the current inputs.");
          }
          const index = this.dryRunTraces.findIndex((trace) => trace.flowId === plan.flowId && trace.flowKind === plan.flowKind && trace.scenario.id === scenarioId);
          if (index >= 0) this.dryRunTraces.splice(index, 1, generated.value); else this.dryRunTraces.push(generated.value);
          this.dryRunPreparation = undefined;
          this.revision += 1;
          await this.persistAgentResult(generated.receipts);
          return this.snapshot();
        });
      } finally {
        this.finishDryRunPreparation(id);
        this.workerAgents.delete(worker);
        worker.cancel();
      }
    });
  }

  async cancelDryRunPreparation() {
    return this.serializeMutation(async () => {
      const active = this.dryRunPreparation;
      if (!active || active.status !== "preparing") return this.snapshot();
      active.worker.cancel();
      this.dryRunPreparation = undefined;
      this.revision += 1;
      await this.persist();
      return this.snapshot();
    });
  }

  async ask(body: string, selectedContext?: string, conversation?: { threadId?: string; stepId?: string | null; anchor?: ChatMessage["anchor"]; contextPaths?: string[]; dryRunContext?: ChatMessage["dryRunContext"]; briefingContext?: BriefingQuestionRequest }, expectedComparisonId?: string) {
    return this.serialize(async () => {
      if (expectedComparisonId !== undefined && expectedComparisonId !== diffSourceIdentity(this.comparison)) throw new ReviewError("This draft belongs to a previous comparison. Copy or cancel it before reviewing the new source.");
      const before = this.captureMutableState();
      const terminalEpoch = this.terminalEpoch;
      let operationRevision = before.revision;
      const comparisonGeneration = this.comparisonGeneration;
      this.ensureOpen();
      if (!body.trim()) throw new ReviewError("Question cannot be empty.");
      const root = conversation?.threadId ? this.messages.find((message) => message.id === conversation.threadId && message.role === "user" && (!message.threadId || message.threadId === message.id)) : undefined;
      if (conversation?.threadId && !root) throw new ReviewError("Conversation not found.");
      if (root && conversation?.anchor) throw new ReviewError("A follow-up keeps its original code location.");
      if (root && conversation?.stepId !== undefined) throw new ReviewError("A follow-up keeps its original tour stop.");
      if (root && conversation?.briefingContext) throw new ReviewError("A follow-up keeps its original Briefing context.");
      const briefingContext = root?.briefingContext ?? (conversation?.briefingContext ? resolveBriefingQuestion(this.outline?.briefing, conversation.briefingContext) : undefined);
      if (briefingContext && (conversation?.anchor || conversation?.dryRunContext || conversation?.contextPaths?.length || (conversation?.stepId !== undefined && conversation.stepId !== null))) throw new ReviewError("Briefing questions use their explicitly selected context.");
      const anchor = root?.anchor ?? conversation?.anchor;
      const normalizedAnchor = root || !anchor ? anchor : await this.normalizeQuestionAnchor(anchor);
      if (root && conversation?.contextPaths?.length) throw new ReviewError("A follow-up keeps its original file context.");
      const contextPaths = root?.contextPaths ?? [...new Set(conversation?.contextPaths ?? [])];
      if (root && conversation?.dryRunContext) throw new ReviewError("A follow-up keeps its original dry-run context.");
      const dryRunContext = root?.dryRunContext ?? conversation?.dryRunContext;
      const dryRunTrace = dryRunContext ? this.dryRunTraces.find((trace) => trace.id === dryRunContext.traceId) : undefined;
      const dryRunStep = dryRunTrace?.steps.find((step) => step.id === dryRunContext?.stepId);
      if (dryRunContext && (!dryRunTrace || !dryRunStep || dryRunTrace.flowId !== dryRunContext.flowId || dryRunTrace.scenario.id !== dryRunContext.scenarioId)) {
        throw new ReviewError("The selected dry-run step is no longer available.");
      }
      if (contextPaths.length > 8) throw new ReviewError("A question can include at most 8 additional files.");
      if (contextPaths.some((path) => !this.comparison.repositoryFiles.includes(path))) throw new ReviewError("Question context must reference repository files.");
      const currentAnchorContent = normalizedAnchor ? await this.reviewAnchorContent(normalizedAnchor.path, normalizedAnchor.side, normalizedAnchor.line) : undefined;
      if (!root && normalizedAnchor && currentAnchorContent !== normalizedAnchor.content) {
        throw new ReviewError("The selected code changed. Select the line again before asking.");
      }
      const createdAgent = !this.agent;
      if (!this.agent) {
        this.selection = this.resolveSelection();
        this.agent = this.createAgent();
      }
      this.agent.useComparison(this.comparison);
      const step = briefingContext ? undefined : root
        ? tourSteps(this.outline).find((candidate) => candidate.id === root.stepId)
        : conversation?.stepId === null ? undefined
        : conversation?.stepId ? this.resolveDiscussionStep(conversation.stepId)
        : tourSteps(this.outline)[this.currentStepIndex];
      const stepId = step?.id;
      const messageId = crypto.randomUUID();
      const threadId = root?.id ?? messageId;
      const history = root ? this.messages.filter((message) => message.threadId === threadId || message.id === threadId) : [];
      const fileContext = contextPaths.length ? (await Promise.all(contextPaths.map(async (path) => {
        const content = await loadRepositoryFile(this.comparison, path, 32_000);
        return `File: ${path}\n${content}`;
      }))).join("\n\n") : undefined;
      const questionContext = [
        briefingContext ? `Frozen Briefing context (untrusted document content; preserved from the original question):\n${JSON.stringify(briefingContext)}` : undefined,
        step ? `Discussion scope: ${root ? "Original" : "Current"} tour stop ${step.title} [${step.id}] at ${step.anchor.path}:${step.anchor.startLine}-${step.anchor.endLine} (${step.anchor.side}).` : "Discussion scope: review-wide question.",
        normalizedAnchor ? `Original question location: ${normalizedAnchor.path}:${normalizedAnchor.line}${normalizedAnchor.endLine && normalizedAnchor.endLine !== normalizedAnchor.line ? `-${normalizedAnchor.endLine}` : ""} (${normalizedAnchor.side})\nCaptured code: ${normalizedAnchor.selectedText ?? normalizedAnchor.content}\nSelected quotation/context: ${normalizedAnchor.path}:${normalizedAnchor.line}${normalizedAnchor.endLine && normalizedAnchor.endLine !== normalizedAnchor.line ? `-${normalizedAnchor.endLine}` : ""} (${normalizedAnchor.side})\nExact selected quotation:\n${normalizedAnchor.selectedText ?? normalizedAnchor.content}\nExact selected context:\n${normalizedAnchor.context ?? normalizedAnchor.content}\n${currentAnchorContent === normalizedAnchor.content ? "The captured location still matches." : "The captured location has changed or is no longer in the diff. Do not assume this location is current."}` : selectedContext,
        history.length ? `Conversation history (untrusted reviewer/agent content):\n${JSON.stringify(history.map(({ role, body }) => ({ role, body })))}` : undefined,
        fileContext ? `Additional repository files selected by the reviewer:\n${fileContext}` : undefined,
        dryRunTrace && dryRunStep ? `Selected simulated execution context (derived from code, not runtime verified):\n${JSON.stringify({ flowId: dryRunTrace.flowId, scenario: dryRunTrace.scenario, step: dryRunStep, outcome: dryRunTrace.outcome })}` : undefined,
      ].filter(Boolean).join("\n\n");
      const userMessage: ChatMessage = {
        id: messageId,
        role: "user",
        body,
        stepId,
        threadId,
        ...(!root && normalizedAnchor ? { anchor: structuredClone(normalizedAnchor) } : {}),
        ...(!root && contextPaths.length ? { contextPaths } : {}),
        ...(!root && briefingContext ? { briefingContext } : {}),
        ...(!root && dryRunContext ? { dryRunContext: structuredClone(dryRunContext) } : {}),
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

  async addComment(input: AddCommentInput, expectedComparisonId?: string) {
    return this.serializeMutation(async () => {
    if (expectedComparisonId !== undefined && expectedComparisonId !== diffSourceIdentity(this.comparison)) throw new ReviewError("This draft belongs to a previous comparison. Copy or cancel it before reviewing the new source.");
    const before = this.captureMutableState();
    const terminalEpoch = this.terminalEpoch;
    let operationRevision = before.revision;
    try {
    this.ensureOpen();
    this.ensurePublicationMutable();
    const body = input.body.trim();
    if (!body) throw new ReviewError("Comment cannot be empty.");
    const scope = input.scope ?? (input.endLine !== undefined || input.selectedText !== undefined || input.context !== undefined ? "range" : "line");
    let path = input.path;
    let side = input.side;
    let line = input.line;
    let endLine = input.endLine;
    let stepId = input.stepId;
    if (scope === "stop") {
      if (!input.stepId) throw new ReviewError("A stop-level comment requires a tour stop id.");
      const step = this.resolveDiscussionStep(input.stepId);
      path = step.anchor.path;
      side = step.anchor.side;
      line = step.anchor.startLine;
      endLine = step.anchor.endLine;
      stepId = step.id;
      if (input.path !== undefined && input.path !== path) throw new ReviewError("Stop comment path does not match the selected tour stop.");
    }
    if (!path || !side || !Number.isInteger(line)) throw new ReviewError("A comment anchor is required.");
    const anchorPath = path as string;
    const anchorSide = side as "old" | "new";
    const anchorLine = line as number;
    const anchorEndLine = endLine ?? anchorLine;
    const range = await this.discussionRange(anchorPath, anchorSide, anchorLine, anchorEndLine);
    endLine = anchorEndLine;
    if (input.context !== undefined && input.context !== range.context) throw new ReviewError("Comment context does not match the current diff range.");
    if (input.selectedText !== undefined && (!input.selectedText.trim() || input.selectedText.length > 16_000 || !range.context.includes(input.selectedText))) {
      throw new ReviewError("Selected quotation does not match the current diff range.");
    }
    if (scope === "line" && endLine !== anchorLine) throw new ReviewError("Line comments cannot cover a range.");
    if (scope === "stop" && (input.selectedText !== undefined || input.context !== undefined)) throw new ReviewError("Stop comments use the tour stop anchor, not a client-provided quotation.");
    const timestamp = new Date().toISOString();
    this.comments.push({
      path: anchorPath,
      side: anchorSide,
      line: anchorLine,
      ...(scope !== "line" ? { scope } : {}),
      ...(scope !== "line" ? { endLine: anchorEndLine } : {}),
      ...(input.selectedText !== undefined ? { selectedText: input.selectedText } : {}),
      ...(scope !== "line" ? { context: range.context } : {}),
      ...(stepId ? { stepId } : {}),
      body,
      lineContent: range.lineContent,
      status: "active",
      publishToGitHub: scope === "line" && Boolean(this.pullRequest) && !/\.png$/i.test(path) && this.githubCommentInDiff(anchorPath, anchorSide, anchorLine),
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

  async updateComment(id: string, body: string, expectedComparisonId?: string) {
    return this.serializeMutation(async () => {
    if (expectedComparisonId !== undefined && expectedComparisonId !== diffSourceIdentity(this.comparison)) throw new ReviewError("This draft belongs to a previous comparison. Copy or cancel it before reviewing the new source.");
    const before = this.captureMutableState();
    const terminalEpoch = this.terminalEpoch;
    let operationRevision = before.revision;
    try {
    this.ensureOpen();
    this.ensurePublicationMutable();
    const comment = this.comments.find((candidate) => candidate.id === id);
    if (!comment) throw new ReviewError(`Review comment does not exist: ${id}`);
    if (comment.suggestion) throw new ReviewError("Return this suggestion to local and create a new edit to change its replacement.");
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
      if (comment.githubPublication) throw new ReviewError("This suggestion has already been published to GitHub.");
      if (publish && /\.png$/i.test(comment.path)) throw new ReviewError("Image comments remain local because GitHub cannot publish them as inline diff comments.");
      if (publish && comment.scope && comment.scope !== "line" && !comment.suggestion) throw new ReviewError("Range and stop comments remain local; they are not included in GitHub reviews.");
      if (publish && comment.suggestion && this.githubCommentUnavailableReason(comment)) throw new ReviewError(this.githubCommentUnavailableReason(comment)!);
      if (publish && !this.githubCommentInDiff(comment.path, comment.side, comment.line)) throw new ReviewError("Comments on expanded context remain local because that line is outside the GitHub diff.");
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
    if (this.comments[index]!.suggestion) throw new ReviewError("Use Return to local on this suggestion to remove it from the GitHub review without losing the edit.");
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

  async updateFinding(id: string, action: FindingUpdate, reviewerNote?: string, publishToGitHub = false) {
    return this.serializeMutation(async () => {
    const before = this.captureMutableState();
    const terminalEpoch = this.terminalEpoch;
    let operationRevision = before.revision;
    try {
    this.ensureOpen();
    const finding = this.outline?.findings.find((candidate) => candidate.id === id);
    if (!finding) throw new ReviewError(`Review finding does not exist: ${id}`);
    if (publishToGitHub && action !== "convert") throw new ReviewError("Only feedback converted from a finding can be added to a GitHub review.");
    if (publishToGitHub && !this.pullRequest) throw new ReviewError("This is not a GitHub pull request review.");
    if (publishToGitHub && /\.png$/i.test(finding.path)) throw new ReviewError("Image findings remain local because GitHub cannot publish them as inline diff comments.");
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
      if (finding.status !== "converted-to-feedback") {
        const row = this.findRow(finding.path, finding.side, finding.line);
        if (!row) throw new ReviewError("Finding anchor does not exist in the current diff.");
        const timestamp = new Date().toISOString();
        const commentId = crypto.randomUUID();
        const body = `[${finding.priority}] ${finding.message}${finding.outdated ? "\n\nAssess if this is still valid after refresh." : ""}`;
        this.comments.push({
          id: commentId,
          path: finding.path,
          side: finding.side,
          line: finding.line,
          body,
          lineContent: row.content,
          status: "active",
          publishToGitHub,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        finding.status = "converted-to-feedback";
        finding.disposition = undefined;
        finding.reviewerNote = undefined;
        finding.commentId = commentId;
      } else if (publishToGitHub && finding.commentId) {
        const comment = this.comments.find((candidate) => candidate.id === finding.commentId);
        if (comment) comment.publishToGitHub = true;
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
      await this.reconcileRevisionState(refreshed, this.currentSinceFiles);
      await this.selectComparisonView();
      this.comparisonGeneration += 1;
      this.revision += 1;
      operationRevision = this.revision;
      for (const comment of this.comments) {
        try {
          const range = await this.discussionRange(comment.path, comment.side, comment.line, comment.endLine ?? comment.line);
          comment.status = range.lineContent === comment.lineContent && (!comment.context || range.context === comment.context) && (!comment.selectedText || range.context.includes(comment.selectedText)) ? "active" : "outdated";
        } catch {
          comment.status = "outdated";
        }
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

  async saveReviewerTask(body: string) {
    return this.serialize(async () => {
      this.ensureOpen();
      if (!this.pullRequest) throw new ReviewError("This is not a GitHub pull request review.");
      const description = body.trim();
      if (!description || description.length > 100_000 || description.includes("\u0000")) {
        throw new ReviewError("The task description is empty, malformed, or exceeds the safe limit.");
      }
      const linkedIssue = this.pullRequest.linkedIssue;
      if (linkedIssue?.access === "available" && linkedIssue.criteriaStatus === "found") {
        throw new ReviewError("This pull request already has explicit acceptance criteria from its linked issue.");
      }
      const acceptanceCriteria = extractAcceptanceCriteria(description);
      const task: ReviewerTaskContext = {
        body: description,
        criteriaStatus: acceptanceCriteria.length ? "found" : "not-found",
        acceptanceCriteria,
        ...(acceptanceCriteria.length ? { assessmentPending: true } : {}),
        updatedAt: new Date().toISOString(),
      };
      const previous = structuredClone(this.pullRequest.reviewerTask);
      const previousRevision = this.revision;
      this.pullRequest.reviewerTask = task;
      this.revision += 1;
      try {
        await this.persist();
      } catch (error) {
        this.pullRequest.reviewerTask = previous;
        this.revision = previousRevision;
        throw error;
      }
      if (task.criteriaStatus !== "found") return this.snapshot();

      const comparisonGeneration = this.comparisonGeneration;
      if (!this.agent) {
        this.selection = this.resolveSelection();
        this.agent = this.createAgent();
      }
      this.startReviewerTaskAssessment(task, comparisonGeneration);
      return this.snapshot();
    });
  }

  private async resumeReviewerTaskAssessment(): Promise<void> {
    const task = this.pullRequest?.reviewerTask;
    if (this.status !== "open" || !task || task.criteriaStatus !== "found" || task.assessment || task.assessmentError) return;
    if (!task.assessmentPending) {
      task.assessmentPending = true;
      this.revision += 1;
      await this.persist();
    }
    if (!this.agent) {
      this.selection = this.resolveSelection();
      this.agent = this.createAgent();
    }
    this.startReviewerTaskAssessment(task, this.comparisonGeneration);
  }

  private startReviewerTaskAssessment(task: ReviewerTaskContext, comparisonGeneration: number): void {
    const updatedAt = task.updatedAt;
    const worker = this.createWorkerAgent();
    worker.useComparison(this.comparison);
    void (async () => {
      try {
        const generated = await worker.assessReviewerTask(this.comparison, task);
        await this.serializeMutation(async () => {
          const currentTask = this.pullRequest?.reviewerTask;
          if (this.status !== "open" || currentTask?.updatedAt !== updatedAt) return;
          try {
            this.ensureComparisonCurrent(comparisonGeneration);
            delete currentTask.assessmentPending;
            currentTask.assessment = generated.value;
            this.revision += 1;
            await this.persistAgentResult(generated.receipts);
          } catch {
            delete currentTask.assessmentPending;
            currentTask.assessment = undefined;
            currentTask.assessmentError = "The review agent could not assess this task description. The description is saved; edit and try again when the agent is available.";
            this.revision += 1;
            await this.persist();
          }
        });
      } catch {
        await this.serializeMutation(async () => {
          const currentTask = this.pullRequest?.reviewerTask;
          if (this.status !== "open" || currentTask?.updatedAt !== updatedAt) return;
          delete currentTask.assessmentPending;
          currentTask.assessmentError = "The review agent could not assess this task description. The description is saved; edit and try again when the agent is available.";
          this.revision += 1;
          await this.persist();
        });
      } finally {
        this.workerAgents.delete(worker);
        worker.cancel();
      }
    })().catch(() => undefined);
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
        if (!(latest.linkedIssue?.access === "available" && latest.linkedIssue.criteriaStatus === "found")) {
          latest.reviewerTask = previousContext.reviewerTask;
        }
        this.pullRequest = latest;
        this.fullComparison = refreshed;
        await this.updateRevisionSummary(refreshed);
        await this.reconcileRevisionState(refreshed, this.currentSinceFiles);
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
          try {
            const range = await this.discussionRange(comment.path, comment.side, comment.line, comment.endLine ?? comment.line);
            comment.status = range.lineContent === comment.lineContent && (!comment.context || range.context === comment.context) && (!comment.selectedText || range.context.includes(comment.selectedText)) ? "active" : "outdated";
          } catch {
            comment.status = "outdated";
          }
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

  private assertCloseAllowed(outcome: ReviewOutcome, decision?: ReviewDecisionIntent, localOnly = false): void {
    if (outcome !== "cancelled" && this.activities.some((activity) => activity.changeStatus === "pending")) {
      throw new ReviewError("Resolve every pending change before closing: apply locally, reject, or add an eligible suggestion to the GitHub review.");
    }
    if (outcome !== "cancelled" && this.preferences.requireAllFilesReviewed &&
      this.fullComparison.files.some((file) => !this.reviewedFiles.has(file.path))) {
      throw new ReviewError("Mark every changed file as reviewed before completing this review.");
    }
    if (outcome === "accepted" && this.comments.length > 0 && decision !== "approve-with-comments" && !localOnly) {
      throw new ReviewError("Use Approve with comments, request changes, or remove all inline comments.");
    }
  }

  private async validateQueuedGitHubSuggestions(selected: ReviewComment[]): Promise<void> {
    for (const comment of selected.filter(comment => comment.suggestion)) {
      const activity = this.activities.find(activity => activity.id === comment.suggestion!.activityId);
      const edit = activity?.inlineEdit;
      if (!edit || activity?.changeStatus !== "queued" || comment.githubPublication || comment.path !== edit.path || comment.side !== "new" || comment.line !== edit.line || comment.endLine !== edit.endLine ||
        comment.context !== edit.expectedContent || comment.suggestion!.headOid !== edit.headOid || comment.suggestion!.sourceTree !== edit.sourceTree ||
        comment.suggestion!.replacement !== edit.replacement || comment.body !== githubSuggestionBody(edit.replacement)) throw new ReviewError("The queued suggestion no longer matches its saved replacement. Return it to local and try again.");
      await this.validateGitHubSuggestion(edit);
    }
  }

  async publishGitHubSuggestions(expectedHeadOid: string, expectedCommentIds: string[]) {
    return this.serializeMutation(async () => {
      this.ensureOpen();
      if (!this.pullRequest) throw new ReviewError("This is not a GitHub pull request review.");
      if (expectedHeadOid !== this.pullRequest.headRefOid) throw new ReviewError("The confirmation is for an outdated pull request revision. Refresh and confirm again.");
      const existing = this.pullRequest.publication;
      const confirmedIds = [...expectedCommentIds].sort();
      if (existing?.outcome === "comment" && existing.status === "published" && JSON.stringify(existing.commentIds) === JSON.stringify(confirmedIds)) {
        await this.persist(); // Also recovers a previously failed local receipt save.
        return this.snapshot();
      }
      if (existing && !(existing.outcome === "comment" && existing.status === "published") &&
        (existing.outcome !== "comment" || JSON.stringify(existing.commentIds) !== JSON.stringify(confirmedIds))) throw new ReviewError("A different GitHub review publication is already pending. Retry the original selection before changing it.");
      const selected = this.comments.filter(comment => comment.suggestion && comment.publishToGitHub && !comment.githubPublication);
      const commentIds = selected.map(comment => comment.id).sort();
      if (!selected.length) throw new ReviewError("Select at least one queued suggestion to submit.");
      if (JSON.stringify(commentIds) !== JSON.stringify(confirmedIds)) throw new ReviewError("The selected suggestions changed. Open the GitHub confirmation again.");
      if (selected.some(comment => comment.status !== "active")) throw new ReviewError("Outdated suggestions cannot be published to GitHub.");
      await this.validateQueuedGitHubSuggestions(selected);
      const publication = existing?.outcome === "comment" && existing.status === "pending" ? existing
        : { intentId: crypto.randomUUID(), outcome: "comment" as const, commentIds, status: "pending" as const };
      this.pullRequest.publication = publication;
      this.revision += 1;
      await this.persist();
      const result = await publishGitHubReview(this.pullRequest, selected, "comment", publication.intentId, this.defaults.githubRunner);
      this.pullRequest.publication = { ...publication, status: "published", reviewId: result.id, url: result.url };
      for (const comment of selected) {
        comment.githubPublication = { reviewId: result.id, ...(result.url ? { url: result.url } : {}) };
        comment.publishToGitHub = false;
      }
      this.revision += 1;
      await this.persist();
      return this.snapshot();
    });
  }

  async publishPullRequest(outcome: Extract<ReviewOutcome, "accepted" | "feedback">, expectedHeadOid: string, decision: ReviewDecisionIntent = outcome === "accepted" ? "approve" : "request-changes", note?: string, expectedCommentIds?: string[]) {
    return this.serializeMutation(async () => {
      this.ensureOpen();
      if (!this.pullRequest) throw new ReviewError("This is not a GitHub pull request review.");
      if (expectedHeadOid !== this.pullRequest.headRefOid) throw new ReviewError("The confirmation is for an outdated pull request revision. Refresh and confirm again.");
      this.assertCloseAllowed(outcome, decision);
      const selected = this.comments.filter((comment) => comment.publishToGitHub && !comment.githubPublication);
      if (expectedCommentIds && JSON.stringify([...expectedCommentIds].sort()) !== JSON.stringify(selected.map(comment => comment.id).sort())) throw new ReviewError("The selected review comments changed. Open the GitHub confirmation again.");
      if (selected.some((comment) => comment.status !== "active")) throw new ReviewError("Outdated comments cannot be published to GitHub.");
      await this.validateQueuedGitHubSuggestions(selected);
      if (selected.some(comment => !this.githubCommentInDiff(comment.path, comment.side, comment.line))) throw new ReviewError("Comments outside the GitHub diff must remain local. Unselect them before publishing.");
      const commentIds = selected.map((comment) => comment.id).sort();
      const existing = this.pullRequest.publication?.outcome === "comment" && this.pullRequest.publication.status === "published" ? undefined : this.pullRequest.publication;
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

  async close(outcome: ReviewOutcome, options: { githubPublished?: boolean; localOnly?: boolean; decision?: ReviewDecisionIntent; note?: string } = {}) {
    if (this.closePromise) {
      const result = await this.closePromise;
      if (result.outcome !== outcome) throw new ReviewError(`The review already closed as ${result.outcome}.`);
      return result;
    }
    if (this.status !== "open") {
      if (this.status !== outcome) throw new ReviewError(`The review already closed as ${this.status}.`);
      return { outcome, comments: this.comments, status: this.status };
    }
    if (this.pullRequest && outcome !== "cancelled" && !options.githubPublished && !options.localOnly) {
      throw new ReviewError("Publish the pull request review to GitHub, or cancel the local review.");
    }
    if (this.pullRequest?.publication && outcome === "cancelled" && !(this.pullRequest.publication.outcome === "comment" && this.pullRequest.publication.status === "published")) {
      throw new ReviewError("A GitHub review publication has already started. Retry it to determine the final remote result.");
    }
    this.assertCloseAllowed(outcome, options.decision, options.localOnly);
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
