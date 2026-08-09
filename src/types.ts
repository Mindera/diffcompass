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
  patch: string;
  files: DiffFile[];
  repositoryFiles: string[];
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
  phases: TourPhase[];
  flows: ReviewFlow[];
  findings: ReviewFinding[];
}

export interface ReviewFlow {
  id: string;
  title: string;
  summary: string;
  mermaid: string;
  provenance: "verified" | "partial" | "unverified";
  blastRadiusSize: number;
  affectedFiles?: string[];
}

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
  status: "open" | "dismissed" | "converted-to-feedback";
  commentId?: string;
  outdated?: boolean;
}

export interface ReviewComment {
  id: string;
  path: string;
  side: "old" | "new";
  line: number;
  body: string;
  lineContent: string;
  status: "active" | "outdated";
  publishToGitHub?: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ReviewOutcome = "accepted" | "feedback" | "cancelled";
export type ReviewStatus = "open" | ReviewOutcome;

export interface ReviewPreferences {
  diffLayout: "unified" | "split";
  changedFilesOnly: boolean;
  contextLines: number;
  requireAllFilesReviewed: boolean;
  closeOutcome: Extract<ReviewOutcome, "accepted" | "cancelled">;
}

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
  publication?: {
    intentId: string;
    outcome: Extract<ReviewOutcome, "accepted" | "feedback">;
    commentIds: string[];
    status: "pending" | "published";
    reviewId?: string;
    url?: string;
  };
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  body: string;
  stepId?: string;
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
  includeFlows?: boolean;
  includeFindings?: boolean;
}

export interface PersistedReviewSession {
  schemaVersion: 2;
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
      kind: "tour.outline" | "tour.explanation" | "review.question";
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
    comments: ReviewComment[];
    createdAt: string;
    acknowledged: boolean;
  };
  outline?: TourOutline;
  currentStepIndex: number;
  comments: ReviewComment[];
  messages: ChatMessage[];
  activities?: AgentChangeActivity[];
  reviewedFiles?: string[];
  preferences?: ReviewPreferences;
  reviewPolicy?: ReviewPolicy;
  pullRequest?: PullRequestContext;
  revision: number;
  status: ReviewStatus;
  selection?: AgentSelection;
  agentContinuation?: { adapterId: StandaloneAgentAdapterId; id: string };
  updatedAt: string;
}
