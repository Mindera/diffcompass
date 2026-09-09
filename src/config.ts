import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { BRIEFING_SECTION_IDS, isBriefingSectionOrder, type BriefingSection, type FindingSeverity, type ReasoningEffort, type ReviewPolicy, type ReviewPreferences, type StandaloneAgentAdapterId } from "./types.ts";

export interface RetentionConfig {
  maxAgeDays?: number;
  maxSessions?: number;
  includeArchived: boolean;
}

export interface RepositoryConfig {
  base?: string;
  agent?: StandaloneAgentAdapterId;
  model?: string;
  reasoning?: ReasoningEffort;
  preferences: ReviewPreferences;
  retention: RetentionConfig;
  reviewPolicy: ReviewPolicy;
}

export const DEFAULT_REVIEW_POLICY: ReviewPolicy = {
  instructions: [],
  findings: {
    enabled: true,
    categories: ["correctness", "security", "performance", "maintainability", "testing"],
    minimumSeverity: "low",
  },
};

export const DEFAULT_REVIEW_PREFERENCES: ReviewPreferences = {
  diffLayout: "split",
  changedFilesOnly: false,
  contextLines: 3,
  prefetchSteps: 5,
  requireAllFilesReviewed: false,
  closeOutcome: "accepted",
  showBriefing: true,
  briefingArchitecture: true,
  briefingSequenceDiagrams: false,
  briefingCallFlows: false,
  briefingNeedsAttention: true,
  briefingReviewEffort: true,
  briefingOrder: [...BRIEFING_SECTION_IDS],
};

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: string[], location: string): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`${location} contains an unsupported setting: ${unknown}`);
}

function optionalString(value: unknown, name: string, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}

function optionalInteger(value: unknown, name: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return Number(value);
}

function stringArray(value: unknown, name: string, defaults: string[]): string[] {
  if (value === undefined) return [...defaults];
  if (!Array.isArray(value) || value.length > 32 || value.some((item) => typeof item !== "string" || !item.trim() || item.length > 2_000)) {
    throw new Error(`${name} must be an array of at most 32 non-empty strings.`);
  }
  const normalized = value.map((item) => item.trim());
  if (new Set(normalized).size !== normalized.length) throw new Error(`${name} must not contain duplicates.`);
  return normalized;
}

export async function loadRepositoryConfig(repositoryRoot: string): Promise<RepositoryConfig> {
  const path = join(repositoryRoot, ".code-review-tour.json");
  let raw: string;
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.size > 64 * 1024) throw new Error("configuration must be a regular file no larger than 64 KiB");
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { preferences: { ...DEFAULT_REVIEW_PREFERENCES }, retention: { includeArchived: false }, reviewPolicy: structuredClone(DEFAULT_REVIEW_POLICY) };
    }
    throw new Error(`Could not read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }

  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error(`${path} is not valid JSON.`); }
  if (!object(value)) throw new Error(`${path} must contain a JSON object.`);
  exactKeys(value, ["base", "agent", "model", "reasoning", "diff", "review", "retention", "analysis"], path);
  const diff = value.diff === undefined ? {} : value.diff;
  const review = value.review === undefined ? {} : value.review;
  const retention = value.retention === undefined ? {} : value.retention;
  const analysis = value.analysis === undefined ? {} : value.analysis;
  if (!object(diff) || !object(review) || !object(retention) || !object(analysis)) throw new Error(`${path} diff, review, retention, and analysis settings must be objects.`);
  exactKeys(diff, ["layout", "changedFilesOnly", "contextLines"], `${path} diff`);
  exactKeys(review, ["requireAllFilesReviewed", "closeOutcome", "showBriefing", "briefingArchitecture", "briefingSequenceDiagrams", "briefingNeedsAttention", "briefingReviewEffort", "briefingOrder"], `${path} review`);
  exactKeys(retention, ["maxAgeDays", "maxSessions", "includeArchived"], `${path} retention`);
  exactKeys(analysis, ["instructions", "findings"], `${path} analysis`);
  const findingPolicy = analysis.findings === undefined ? {} : analysis.findings;
  if (!object(findingPolicy)) throw new Error(`${path} analysis.findings must be an object.`);
  exactKeys(findingPolicy, ["enabled", "categories", "minimumSeverity"], `${path} analysis.findings`);

  const agent = value.agent === undefined ? undefined : String(value.agent);
  if (agent !== undefined && !["codex", "claude", "gemini", "copilot"].includes(agent)) {
    throw new Error(`${path} agent must be codex, claude, gemini, or copilot.`);
  }
  const reasoning = value.reasoning === undefined ? undefined : String(value.reasoning);
  if (reasoning !== undefined && !["minimal", "low", "medium", "high", "xhigh", "max", "ultra"].includes(reasoning)) {
    throw new Error(`${path} reasoning is unsupported.`);
  }
  const layout = diff.layout === undefined ? DEFAULT_REVIEW_PREFERENCES.diffLayout : String(diff.layout);
  if (!["unified", "split"].includes(layout)) throw new Error(`${path} diff.layout must be unified or split.`);
  if (diff.changedFilesOnly !== undefined && typeof diff.changedFilesOnly !== "boolean") throw new Error(`${path} diff.changedFilesOnly must be a boolean.`);
  if (review.requireAllFilesReviewed !== undefined && typeof review.requireAllFilesReviewed !== "boolean") throw new Error(`${path} review.requireAllFilesReviewed must be a boolean.`);
  for (const key of ["showBriefing", "briefingArchitecture", "briefingSequenceDiagrams", "briefingCallFlows", "briefingNeedsAttention", "briefingReviewEffort"] as const) {
    if (review[key] !== undefined && typeof review[key] !== "boolean") throw new Error(`${path} review.${key} must be a boolean.`);
  }
  if (review.briefingOrder !== undefined && !isBriefingSectionOrder(review.briefingOrder)) throw new Error(`${path} review.briefingOrder must contain each briefing section exactly once.`);
  const closeOutcome = review.closeOutcome === undefined ? DEFAULT_REVIEW_PREFERENCES.closeOutcome : String(review.closeOutcome);
  if (!["accepted", "cancelled"].includes(closeOutcome)) throw new Error(`${path} review.closeOutcome must be accepted or cancelled.`);
  if (retention.includeArchived !== undefined && typeof retention.includeArchived !== "boolean") throw new Error(`${path} retention.includeArchived must be a boolean.`);
  if (findingPolicy.enabled !== undefined && typeof findingPolicy.enabled !== "boolean") throw new Error(`${path} analysis.findings.enabled must be a boolean.`);
  const minimumSeverity = findingPolicy.minimumSeverity === undefined ? DEFAULT_REVIEW_POLICY.findings.minimumSeverity : String(findingPolicy.minimumSeverity);
  if (!["critical", "high", "medium", "low"].includes(minimumSeverity)) throw new Error(`${path} analysis.findings.minimumSeverity is unsupported.`);

  return {
    base: optionalString(value.base, `${path} base`, 4_096),
    agent: agent as RepositoryConfig["agent"],
    model: optionalString(value.model, `${path} model`, 256),
    reasoning: reasoning as ReasoningEffort | undefined,
    preferences: {
      diffLayout: layout as ReviewPreferences["diffLayout"],
      changedFilesOnly: diff.changedFilesOnly ?? DEFAULT_REVIEW_PREFERENCES.changedFilesOnly,
      contextLines: optionalInteger(diff.contextLines, `${path} diff.contextLines`, 3, 200) ?? DEFAULT_REVIEW_PREFERENCES.contextLines,
      prefetchSteps: DEFAULT_REVIEW_PREFERENCES.prefetchSteps,
      requireAllFilesReviewed: review.requireAllFilesReviewed ?? DEFAULT_REVIEW_PREFERENCES.requireAllFilesReviewed,
      closeOutcome: closeOutcome as ReviewPreferences["closeOutcome"],
      showBriefing: review.showBriefing === true ? true : review.showBriefing === false ? false : DEFAULT_REVIEW_PREFERENCES.showBriefing,
      briefingArchitecture: review.briefingArchitecture === true ? true : review.briefingArchitecture === false ? false : DEFAULT_REVIEW_PREFERENCES.briefingArchitecture,
      briefingSequenceDiagrams: review.briefingSequenceDiagrams === true ? true : review.briefingSequenceDiagrams === false ? false : DEFAULT_REVIEW_PREFERENCES.briefingSequenceDiagrams,
      briefingCallFlows: review.briefingCallFlows === true ? true : review.briefingCallFlows === false ? false : DEFAULT_REVIEW_PREFERENCES.briefingCallFlows,
      briefingNeedsAttention: review.briefingNeedsAttention === true ? true : review.briefingNeedsAttention === false ? false : DEFAULT_REVIEW_PREFERENCES.briefingNeedsAttention,
      briefingReviewEffort: review.briefingReviewEffort === true ? true : review.briefingReviewEffort === false ? false : DEFAULT_REVIEW_PREFERENCES.briefingReviewEffort,
      briefingOrder: (review.briefingOrder === undefined ? DEFAULT_REVIEW_PREFERENCES.briefingOrder : [...review.briefingOrder]) as BriefingSection[],
    },
    retention: {
      maxAgeDays: optionalInteger(retention.maxAgeDays, `${path} retention.maxAgeDays`, 1, 3_650),
      maxSessions: optionalInteger(retention.maxSessions, `${path} retention.maxSessions`, 1, 10_000),
      includeArchived: retention.includeArchived ?? false,
    },
    reviewPolicy: {
      instructions: stringArray(analysis.instructions, `${path} analysis.instructions`, []),
      findings: {
        enabled: findingPolicy.enabled ?? DEFAULT_REVIEW_POLICY.findings.enabled,
        categories: stringArray(findingPolicy.categories, `${path} analysis.findings.categories`, DEFAULT_REVIEW_POLICY.findings.categories),
        minimumSeverity: minimumSeverity as FindingSeverity,
      },
    },
  };
}
