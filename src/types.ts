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
  title: string;
  summary: string;
  planningNotes?: string[];
  behaviorArchitecture?: ReviewArchitecture;
  behaviorArchitectureStatus?: "implemented" | "proposed";
  architecture?: ReviewArchitecture;
  stateDiagram?: ReviewAdaptiveDiagram;
  dataModel?: ReviewAdaptiveDiagram;
  phases: TourPhase[];
  callFlows: CallFlow[];
  flows: ReviewFlow[];
  findings: ReviewFinding[];
  issueAssessment?: IssueAssessment;
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

export interface ReviewFlow {
  id: string;
  title: string;
  summary: string;
  mermaid: string;
  provenance: "verified" | "partial" | "unverified";
  blastRadiusSize: number;
  affectedFiles?: string[];
  outdated?: boolean;
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
  | { kind: "review-section"; section: "findings" | "call-flows" | "pull-request" | "diff" };

export interface ReviewBriefingSignal {
  id: string;
  kind: "finding" | "public-contract" | "call-flow" | "tests" | "stale-analysis" | "github-check" | "merge-conflict";
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
}

export interface AgentRunActivity {
  id: string;
  kind: "tour.outline" | "tour.explanation" | "review.question" | "issue.assessment";
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
  schemaVersion: 2 | 3;
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
      kind: "tour.outline" | "tour.explanation" | "review.question" | "issue.assessment";
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
