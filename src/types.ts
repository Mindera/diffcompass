export type DiffRowKind = "context" | "addition" | "deletion" | "meta";

export interface DiffRow {
  kind: DiffRowKind;
  content: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  rows: DiffRow[];
}

export interface DiffFile {
  oldPath: string | null;
  newPath: string | null;
  path: string;
  status: "added" | "deleted" | "modified" | "renamed";
  metadata: string[];
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

export interface GitComparison {
  repositoryRoot: string;
  repositoryName: string;
  branch?: string;
  base: string;
  mergeBase: string;
  head: string;
  /** The immutable tree used as the new side of this comparison. */
  sourceTree?: string;
  sourceKind?: "working-tree" | "tree";
  patch: string;
  files: DiffFile[];
  repositoryFiles: string[];
}

export type ComparisonView = "full" | "since-last-review";
export type CheckpointKind = "manual" | "decision";
export type RevisionFileClassification = "new" | "changed-again" | "resolved" | "unchanged";

export interface RevisionSummary {
  checkpointId?: string;
  checkpointCreatedAt?: string;
  changedFiles: number;
  additions: number;
  deletions: number;
  newFiles: string[];
  changedAgainFiles: string[];
  resolvedFiles: string[];
  unchangedFiles: string[];
  text: string;
}

export interface SourceCheckpoint {
  id: string;
  kind: CheckpointKind;
  label?: string;
  ref: string;
  sourceTree: string;
  sourceHead: string;
  base: string;
  baseTree: string;
  reviewedFiles: string[];
  outcome?: Extract<ReviewOutcome, "accepted" | "feedback">;
  decision?: Exclude<ReviewDecisionIntent, "cancel">;
  summary: RevisionSummary;
  createdAt: string;
}

export interface TourAnchor {
  path: string;
  side: "old" | "new";
  startLine: number;
  endLine: number;
}

export interface TourStep {
  id: string;
  title: string;
  objective: string;
  anchor: TourAnchor;
  explanation?: string;
  outdated?: boolean;
}

export interface TourFileChange {
  path: string;
  summary: string;
}

export interface TourPhase {
  id: string;
  title: string;
  summary: string;
  fileChanges: TourFileChange[];
  steps: TourStep[];
}

export interface TourOutline {
  /** Source-backed domain vocabulary, saved with the reviewed snapshot. */
  domainModels?: import("./domain-context.ts").DomainModel[];
  title: string;
  summary: string;
  planningNotes?: string[];
  behaviorArchitecture?: ReviewArchitecture;
  behaviorArchitectureStatus?: "implemented" | "proposed";
  architecture?: ReviewArchitecture;
  stateDiagram?: ReviewAdaptiveDiagram;
  dataModel?: ReviewAdaptiveDiagram;
  /**
   * Validated, self-contained Archify HTML. These artifacts are optional and
   * never replace the constrained Mermaid source kept above.
   */
  archifyArtifacts?: ArchifyArtifact[];
  /** Renderer diagnostics for a candidate that did not replace its last-good artifact. */
  archifyFailures?: ArchifyFailure[];
  phases: TourPhase[];
  callFlows: CallFlow[];
  /** Static caller/reachability evidence for changed symbols. This is not a runtime trace. */
  structuralBlastRadii?: StructuralBlastRadius[];
  /** Validation failures remaining after bounded repair; not evidence of zero impact. */
  structuralAnalysisWarnings?: string[];
  /** Why no changed declarations could be analysed (not a claim of zero impact). */
  structuralAnalysisOmissionReason?: string;
  flows: ReviewFlow[];
  /** Scenario suggestions only. Detailed execution traces are prepared on demand. */
  dryRunPlans?: DryRunPlan[];
  findings: ReviewFinding[];
  issueAssessment?: IssueAssessment;
}

/** The structural source used for one changed symbol. Providers can be incomplete. */
export type StructuralProvider = "codegraph" | "language-server" | "repository-search" | "unavailable";
export type StructuralConfidence = "high" | "medium" | "low" | "unresolved";
export type StructuralResultCompleteness = "complete" | "partial" | "unavailable" | "unknown";
export type StructuralCountBasis = "exact" | "lower-bound" | "not-reported";

export interface StructuralLocation {
  path: string;
  side: "old" | "new";
  line: number;
}

/**
 * A source-level identity. `id` is deliberately independent from `symbol`, so two
 * same-named methods in different files or scopes cannot be merged in the UI.
 * The same source identity may occur in more than one isolated root subgraph.
 */
export interface StructuralBlastNode {
  id: string;
  symbol: string;
  kind: "function" | "method" | "constructor" | "component" | "type" | "module" | "external";
  location?: StructuralLocation;
}

/** Edges are oriented caller/reference source -> target. */
export interface StructuralBlastEdge {
  id: string;
  from: string;
  to: string;
  relationship: "calls" | "references";
}

export interface StructuralTestGap {
  kind: "no-nearby-tests" | "changed-symbol-not-covered" | "impacted-path-not-covered" | "coverage-unknown";
  detail: string;
  nearbyTestFiles: string[];
}

/** A source anchor inspected while assessing tests for one structural root. */
export interface StructuralTestSource {
  path: string;
  side: "old" | "new";
  line: number;
  /** What this source text shows; never a claim that the test ran or passed. */
  detail: string;
}

/**
 * Bounded source-level test context for one structural root. This is not test
 * execution, runtime coverage, or a coverage-runner result.
 */
export interface StructuralTestEvidence {
  state: "not-assessed" | "relevant-tests-found" | "none-found" | "limited";
  /** Exact files, symbols, or commands whose source/output was inspected. */
  searchScope?: string;
  checkedSources: StructuralTestSource[];
  /** Test-source anchors whose code appears relevant to this symbol's behavior. */
  relevantTests: StructuralTestSource[];
  /** Known boundary of the assessment; required for a limited result. */
  remainingUncertainty?: string;
}

/**
 * Whether this saved graph includes every identity returned by its provider.
 * `unknown` is retained for sessions saved before this field existed: it does
 * not imply that the graph is complete or that omitted identities do not exist.
 */
export interface StructuralBlastCoverage {
  state: StructuralResultCompleteness;
  /** Whether reported counts are exact totals, only lower bounds, or absent. */
  reportedCounts: StructuralCountBasis;
  /** Why identities or totals are absent. Required for newly-produced partial results. */
  omissionReason?: string;
}

/**
 * A bounded structural subgraph for one changed symbol. Reported counts may be
 * larger than the visible graph because a provider capped or grouped its result.
 * Structural reach is an authored/static path, never proof of runtime impact.
 */
export interface StructuralBlastRadius {
  id: string;
  symbol: StructuralBlastNode;
  provider: StructuralProvider;
  confidence: StructuralConfidence;
  provenance: "verified" | "partial" | "unverified";
  summary: string;
  /** Visible, selectable nodes for this symbol only. Includes `symbol`. */
  nodes: StructuralBlastNode[];
  edges: StructuralBlastEdge[];
  /** Visible direct callers/references; each has an edge to `symbol.id`. */
  directCallerIds: string[];
  /** Total provider-reported counts, including nodes or files not rendered here. */
  reportedDirectCallerCount: number;
  reportedReachableNodeCount: number;
  reportedImpactedFileCount: number;
  /** Saved-result completeness and whether the reported counts are evidence-backed totals. */
  coverage?: StructuralBlastCoverage;
  /** Bounded known impacted files. The reported count may be larger. */
  impactedFiles: string[];
  /** Optional for sessions saved before bounded test-assessment evidence existed. */
  testEvidence?: StructuralTestEvidence;
  nearbyTestGaps: StructuralTestGap[];
}

export type IssueAccess = "available" | "inaccessible" | "unavailable";
export type IssueCriteriaStatus = "found" | "not-found" | "malformed" | "unavailable";

export interface AcceptanceCriterion {
  id: string;
  text: string;
}

export interface LinkedIssueContext {
  repository: string;
  number: number;
  url: string;
  title: string;
  author?: string;
  state?: string;
  access: IssueAccess;
  criteriaStatus: IssueCriteriaStatus;
  acceptanceCriteria: AcceptanceCriterion[];
}

export interface IssueAssessmentItem {
  criterionId: string;
  criterion: string;
  status: "implemented" | "missing" | "unclear";
  evidence: string;
  evidencePaths: string[];
  pathExplanations?: Array<{ path: string; explanation: string }>;
  basis: "model-assessment";
}

export interface IssueAssessment {
  issueNumber: number;
  issueUrl: string;
  items: IssueAssessmentItem[];
}

/** A reviewer-owned fallback when GitHub has no usable linked issue. It is never provider data. */
export interface ReviewerTaskContext {
  body: string;
  criteriaStatus: "found" | "not-found";
  acceptanceCriteria: AcceptanceCriterion[];
  assessmentPending?: boolean;
  assessment?: { items: IssueAssessmentItem[] };
  assessmentError?: string;
  updatedAt: string;
}

export interface CallFlowLocation {
  path: string;
  side: "old" | "new";
  line: number;
}

export interface CallFlowNode {
  id: string;
  label: string;
  kind: "function" | "method" | "constructor" | "component" | "branch" | "external";
  change: "added" | "removed" | "unchanged" | "modified";
  oldLocation?: CallFlowLocation;
  newLocation?: CallFlowLocation;
}

export interface CallFlowEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  change: "added" | "removed" | "unchanged";
  oldCallSite?: CallFlowLocation;
  newCallSite?: CallFlowLocation;
}

export interface CallFlow {
  id: string;
  title: string;
  summary: string;
  entrypointNodeId: string;
  provenance: "verified" | "partial" | "unverified";
  nodes: CallFlowNode[];
  edges: CallFlowEdge[];
  affectedFiles: string[];
  outdated?: boolean;
}

export interface ReviewArchitecture {
  nodeRoles?: import("./map-node-roles.ts").MapNodeRoles;
  title: string;
  summary: string;
  mermaid: string;
  dependencyChanges: string[];
  affectedFiles: string[];
  outdated?: boolean;
}

export type ReviewAdaptiveDiagramKind = "state-machine" | "data-model";

export interface ReviewAdaptiveDiagram {
  kind: ReviewAdaptiveDiagramKind;
  title: string;
  summary: string;
  mermaid: string;
  evidence: string[];
  materiallyImprovesUnderstanding: string;
  affectedFiles: string[];
}

export type ArchifyDiagramType = "architecture" | "workflow" | "sequence" | "dataflow" | "lifecycle";

/** JSON is deliberately kept as data, never interpreted by the review UI. */
export type ArchifyJson = null | boolean | number | string | ArchifyJson[] | { [key: string]: ArchifyJson };

/** A separately validated, self-contained comparison surface for one map. */
export interface ArchifyComparisonView {
  /** The exact renderer-validated JSON IR for this comparison state. */
  ir: { [key: string]: ArchifyJson };
  /** Standalone renderer output, loaded only inside a sandboxed iframe. */
  html: string;
  validationReceipt: string;
}

export interface ArchifyArtifact {
  nodeRoles?: import("./map-node-roles.ts").MapNodeRoles;
  purpose?: "domain-model";
  domainDetails?: Record<string, import("./domain-context.ts").DomainNodeDetail>;
  id: string;
  type: ArchifyDiagramType;
  title: string;
  /** The exact, renderer-validated JSON IR. */
  ir: { [key: string]: ArchifyJson };
  /** Legacy independently validated baseline retained when resuming an older session. */
  baselineIr?: { [key: string]: ArchifyJson };
  /**
   * Separately rendered comparison states. `before` contains only components
   * evidenced before the review; `delta` contains only entities with both
   * evidenced before and after states. Entirely new components are After-only.
   */
  comparison?: {
    before?: ArchifyComparisonView;
    delta?: ArchifyComparisonView;
  };
  /** Standalone renderer output, loaded only inside a sandboxed iframe. */
  html: string;
  evidence: string[];
  affectedFiles: string[];
  /** Comparison controls are present only when their independently bounded states exist. */
  view: "single" | "before-after" | "before-delta-after";
  validationReceipt: string;
  renderedAt: string;
}

export interface ArchifyFailure {
  id: string;
  type: ArchifyDiagramType;
  message: string;
  /** True means an earlier validated artifact remains available. */
  preservedLastValid: boolean;
}

export interface ReviewFlow {
  /** One-based message order plus exact caption guards against stale links. */
  messageSources?: SequenceMessageSource[];
  nodeRoles?: import("./map-node-roles.ts").MapNodeRoles;
  id: string;
  title: string;
  summary: string;
  mermaid: string;
  provenance: "verified" | "partial" | "unverified";
  blastRadiusSize: number;
  affectedFiles?: string[];
  outdated?: boolean;
}

export interface SequenceSourceAnchor {
  /** Runtime lookup candidate, not authored evidence of the message. */
  definition?: boolean;
  path: string;
  side: "old" | "new";
  startLine: number;
  endLine: number;
  quote: string;
}

export interface SequenceMessageSource {
  message: number;
  label: string;
  anchors: SequenceSourceAnchor[];
}

/**
 * Dry runs describe a code behavior, not a renderer artifact. A behavior can
 * link to either diagram when one happens to exist, but remains usable when
 * both diagram surfaces are disabled or no diagram was warranted.
 */
export type DryRunFlowKind = "behavior";

export interface DryRunScenario {
  id: string;
  title: string;
  /** Why this case is useful for reviewing this changed behavior. */
  reason: string;
  /** Existing repository evidence is preferred; invented samples are always labelled. */
  source: "test" | "example" | "invented" | "reviewer";
  description?: string;
  inputs: Record<string, unknown>;
  mocks: Record<string, unknown>;
  assumptions: string[];
  updatedAt?: string;
}

export interface DryRunPlanSource {
  /** Bounded, new-side code evidence used to plan the simulation. */
  anchors: DryRunSourceAnchor[];
}

export interface DryRunPlan {
  /** A snapshot-stable behavior identity owned by the dry-run planner. */
  flowId: string;
  flowKind: DryRunFlowKind;
  title: string;
  summary: string;
  source: DryRunPlanSource;
  /** Optional correlations to diagram evidence in this outline snapshot. */
  callFlowId?: string;
  sequenceFlowId?: string;
  scenarios: DryRunScenario[];
}

export interface DryRunSourceAnchor {
  path: string;
  side: "new";
  startLine: number;
  endLine: number;
  /** True when the anchored line is an added line in the reviewed comparison. */
  changed: boolean;
}

/** Optional, renderer-independent correlation to the persisted call-flow evidence. */
export interface DryRunMapLink {
  callFlowId: string;
  nodeId?: string;
  edgeId?: string;
}

export interface DryRunValueChange {
  name: string;
  before?: unknown;
  after?: unknown;
  note?: string;
}

export interface DryRunStep {
  id: string;
  order: number;
  kind: "entry" | "calculation" | "branch" | "call" | "mock" | "return" | "unresolved";
  title: string;
  explanation: string;
  source: DryRunSourceAnchor;
  function: string;
  arguments?: Record<string, unknown>;
  locals?: Record<string, unknown>;
  valueChanges: DryRunValueChange[];
  assumption?: string;
  mapLink?: DryRunMapLink;
}

/** Compact is the normal walkthrough; detailed is an explicit reviewer request. */
export type DryRunDetail = "compact" | "detailed";

export interface DryRunTrace {
  id: string;
  comparison: {
    base: string;
    mergeBase: string;
    head: string;
    fingerprint: string;
  };
  flowId: string;
  flowKind: DryRunFlowKind;
  flowFingerprint: string;
  /** Older saved traces predate this field and are treated as compact. */
  detail?: DryRunDetail;
  scenario: DryRunScenario;
  assumptions: string[];
  steps: DryRunStep[];
  outcome: {
    summary: string;
    value?: unknown;
  };
  preparedAt: string;
  /** A source or scenario edit makes the retained simulation read-only historical context. */
  stale?: boolean;
}

export type FindingDisposition =
  | "accepted"
  | "false-positive"
  | "intentional"
  | "deferred"
  | "fixed"
  | "obsolete-after-refresh";

export interface ReviewFinding {
  id: string;
  phaseId?: string;
  stepId?: string;
  path: string;
  side: "old" | "new";
  line: number;
  lineContent: string;
  message: string;
  category: string;
  severity: "critical" | "high" | "medium" | "low";
  confidence: "high" | "medium" | "low";
  evidence: string;
  priority: "P0" | "P1" | "P2" | "P3";
  introduced: boolean | null;
  recallGuard: boolean;
  blastRadiusSize: number;
  tested: boolean;
  pinScope: "line" | "symbol" | "file";
  /** Source identities from a structural blast result, when structural evidence exists. */
  pinnedSymbolIds?: string[];
  /** Operational state. `dismissed` is accepted only while migrating old sessions. */
  status: "open" | FindingDisposition | "dismissed" | "converted-to-feedback";
  /** Reviewer-owned resolution preserved when the finding is refreshed or regenerated. */
  disposition?: FindingDisposition;
  reviewerNote?: string;
  commentId?: string;
  outdated?: boolean;
}

export interface ReviewComment {
  id: string;
  path: string;
  side: "old" | "new";
  line: number;
  /** The discussion scope. Missing means the legacy line-level scope. */
  scope?: "line" | "range" | "stop";
  endLine?: number;
  /** Exact reviewer-selected quotation, when a range was selected. */
  selectedText?: string;
  /** Exact complete diff-row context used to validate the quotation. */
  context?: string;
  /** Stable tour stop id for stop-level discussions. */
  stepId?: string;
  body: string;
  lineContent: string;
  status: "active" | "outdated";
  publishToGitHub?: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ReviewOutcome = "accepted" | "feedback" | "cancelled";
export type ReviewDecisionIntent = "approve" | "approve-with-comments" | "request-changes" | "cancel";
export type ReviewStatus = "open" | ReviewOutcome;

export interface DiffViewPreferences {
  layout: "unified" | "split";
  wrap: "scroll" | "wrap";
}

export interface SessionDiffPreferences {
  desktop?: DiffViewPreferences;
  mobile?: DiffViewPreferences;
}

export const BRIEFING_SECTION_IDS = ["architecture", "sequence-diagrams", "call-flows", "needs-attention", "review-effort"] as const;
export type BriefingSection = typeof BRIEFING_SECTION_IDS[number];

export function isBriefingSectionOrder(value: unknown): value is BriefingSection[] {
  return Array.isArray(value) && value.length === BRIEFING_SECTION_IDS.length &&
    new Set(value).size === BRIEFING_SECTION_IDS.length &&
    value.every((section) => BRIEFING_SECTION_IDS.includes(section as BriefingSection));
}

export interface ReviewPreferences {
  diffLayout: "unified" | "split";
  changedFilesOnly: boolean;
  contextLines: number;
  prefetchSteps: number;
  requireAllFilesReviewed: boolean;
  closeOutcome: Extract<ReviewOutcome, "accepted" | "cancelled">;
  showBriefing: boolean;
  briefingArchitecture: boolean;
  briefingSequenceDiagrams: boolean;
  briefingCallFlows: boolean;
  briefingNeedsAttention: boolean;
  briefingReviewEffort: boolean;
  briefingOrder: BriefingSection[];
}

export type BriefingPreferences = Pick<ReviewPreferences, "showBriefing" | "briefingArchitecture" | "briefingSequenceDiagrams" | "briefingCallFlows" | "briefingNeedsAttention" | "briefingReviewEffort" | "briefingOrder">;

export type FindingSeverity = "critical" | "high" | "medium" | "low";

export interface ReviewPolicy {
  instructions: string[];
  findings: {
    enabled: boolean;
    categories: string[];
    minimumSeverity: FindingSeverity;
  };
}

export interface PullRequestContext {
  repository: string;
  number: number;
  url: string;
  title: string;
  body: string;
  author: string;
  baseRefName: string;
  baseRefOid: string;
  headRefName: string;
  headRefOid: string;
  sourceRepositoryRoot: string;
  workspaceRoot: string;
  refNamespace: string;
  reviewDecision?: string;
  /** GitHub's current pull request state, when it is available in the snapshot. */
  state?: "OPEN" | "CLOSED" | "MERGED";
  /** GitHub's mergeability metadata is absent while GitHub is still calculating it. */
  mergeable?: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  mergeStateStatus?: string;
  commits: Array<{ oid: string; headline: string; authors: string[] }>;
  checks: Array<{ name: string; state: string; url?: string }>;
  threads: Array<{
    id: string;
    path: string;
    line?: number;
    side?: "old" | "new";
    resolved: boolean;
    comments: Array<{ id: string; author: string; body: string; url: string }>;
  }>;
  threadsTruncated: boolean;
  linkedIssue?: LinkedIssueContext;
  reviewerTask?: ReviewerTaskContext;
  providerScope?: {
    linkedIssue: "same-repository-closing-issue" | "none" | "inaccessible" | "unavailable";
    relatedResources: "not-requested";
  };
  publication?: {
    intentId: string;
    outcome: Extract<ReviewOutcome, "accepted" | "feedback">;
    decision?: ReviewDecisionIntent;
    note?: string;
    commentIds: string[];
    status: "pending" | "published";
    reviewId?: string;
    url?: string;
  };
  updatedAt: string;
}

export type ReviewBriefingTarget =
  | { kind: "finding"; findingId: string }
  | { kind: "file"; path: string; side?: "old" | "new"; line?: number }
  | { kind: "call-flow"; callFlowId: string }
  | { kind: "structural-blast-radius"; structuralBlastRadiusId: string }
  | { kind: "review-section"; section: "findings" | "call-flows" | "structural-blast-radius" | "pull-request" | "diff" };

export interface ReviewBriefingSignal {
  id: string;
  kind: "finding" | "public-contract" | "call-flow" | "structural-blast-radius" | "tests" | "stale-analysis" | "github-check" | "merge-conflict";
  title: string;
  detail: string;
  evidence: string;
  basis: "repository-evidence" | "bounded-heuristic";
  target: ReviewBriefingTarget;
}

export interface ReviewTimeFactor {
  label: string;
  minutes: number;
  detail: string;
  basis: "repository-evidence" | "bounded-heuristic";
}

export interface ReviewBriefing {
  signals: ReviewBriefingSignal[];
  estimate: {
    minutes: number;
    factors: ReviewTimeFactor[];
  };
}

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  body: string;
  stepId?: string;
  /** Root user message ID; independent of the currently selected tour step. */
  threadId?: string;
  /** Captured source, retained even if the reviewed code later changes. */
  anchor?: {
    path: string;
    side: "old" | "new";
    line: number;
    content: string;
    endLine?: number;
    /** Exact reviewer-selected quotation, when a range was selected. */
    selectedText?: string;
    /** Exact complete diff-row context used to validate the quotation. */
    context?: string;
  };
  /** Extra repository files explicitly added when this conversation started. */
  contextPaths?: string[];
  dryRunContext?: {
    traceId: string;
    flowId: string;
    scenarioId: string;
    stepId: string;
  };
  createdAt: string;
}

export interface AgentChangeFile {
  path: string;
  change: "added" | "modified" | "removed";
  beforeFingerprint?: string;
  afterFingerprint?: string;
  before?: {
    status: DiffFile["status"];
    additions: number;
    deletions: number;
  };
  after?: {
    status: DiffFile["status"];
    additions: number;
    deletions: number;
  };
}

export interface AgentChangeActivity {
  id: string;
  source?: "agent" | "reviewer";
  requestMessageId: string;
  request: string;
  stepId?: string;
  adapterId: string;
  modelId: string;
  eventId?: string;
  files: AgentChangeFile[];
  verification?: string;
  status: "observed" | "verified";
  changeStatus?: "pending" | "applied" | "rejected" | "undone";
  proposal?: {
    patch: string;
    baselineTree: string;
    resultTree: string;
  };
  createdAt: string;
  updatedAt: string;
}

export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
export type StandaloneAgentAdapterId = "codex" | "claude" | "gemini" | "copilot";

export interface AgentModelOption {
  id: string;
  label: string;
  isDefault: boolean;
  reasoningEfforts: ReasoningEffort[];
  defaultReasoningEffort?: ReasoningEffort;
}

export interface AgentAdapterOption {
  id: string;
  label: string;
  models: AgentModelOption[];
  modelDiscovery: "catalog" | "aliases" | "default-only";
  note?: string;
}

export interface AgentSelection {
  adapterId: string;
  modelId: string;
  reasoningEffort?: ReasoningEffort;
  includeArchitecture?: boolean;
  includeCallFlows?: boolean;
  includeFlows?: boolean;
  includeFindings?: boolean;
  includeAdaptiveDiagrams?: boolean;
  includeDryRuns?: boolean;
  includeArchify?: boolean;
}

export interface AgentRunActivity {
  id: string;
  kind: "tour.outline" | "tour.explanation" | "review.question" | "issue.assessment" | "dry-run.plan" | "dry-run.trace";
  label: string;
  status: "waiting" | "running" | "completed" | "failed";
  prompt: string;
  promptTruncated?: boolean;
  stepNumber?: number;
  totalSteps?: number;
  updates: Array<{ message: string; createdAt: string }>;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
}

export interface PersistedReviewSession {
  schemaVersion: 2 | 3 | 4;
  name?: string;
  archived?: boolean;
  repositoryRoot: string;
  base: string;
  browserToken: string;
  bridgeToken?: string;
  bridgeSequence?: number;
  bridgePrompts?: Array<{
    event: {
      sequence: number;
      id: string;
      type: "agent.prompt";
      kind: "tour.outline" | "tour.explanation" | "review.question" | "issue.assessment" | "dry-run.plan" | "dry-run.trace";
      prompt: string;
      createdAt: string;
    };
    response?: string;
    acknowledged: boolean;
    committed: boolean;
  }>;
  bridgeLeases?: Array<{ eventId: string; leaseId: string; expiresAt: number }>;
  bridgeTerminalEvent?: {
    sequence: number;
    id: string;
    type: "review.closed";
    outcome: ReviewOutcome;
    decision?: ReviewDecisionIntent;
    note?: string;
    comments: ReviewComment[];
    reviewedTree?: string;
    createdAt: string;
    acknowledged: boolean;
  };
  outline?: TourOutline;
  currentStepIndex: number;
  comments: ReviewComment[];
  messages: ChatMessage[];
  activities?: AgentChangeActivity[];
  reviewedFiles?: string[];
  /** Added in schema 3. Kept optional so schema 2 callers remain source-compatible. */
  checkpoints?: SourceCheckpoint[];
  checkpointRefNamespace?: string;
  comparisonView?: ComparisonView;
  selectedCheckpointId?: string;
  diffPreferences?: SessionDiffPreferences;
  preferences?: ReviewPreferences;
  reviewPolicy?: ReviewPolicy;
  findingGenerationEnabled?: boolean;
  /** Prepared simulations are durable so their Previous/Next navigation works offline after resume. */
  dryRuns?: DryRunTrace[];
  pullRequest?: PullRequestContext;
  screenshots?: ReviewScreenshot[];
  revision: number;
  status: ReviewStatus;
  selection?: AgentSelection;
  agentContinuation?: { adapterId: StandaloneAgentAdapterId; id: string };
  updatedAt: string;
}

export interface ReviewScreenshot {
  id: string;
  name: string;
  mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "video/mp4";
  size: number;
  fileName: string;
}
