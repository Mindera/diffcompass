import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReasoningEffort, ReviewPreferences } from "./types.ts";

export interface RetentionConfig {
  maxAgeDays?: number;
  maxSessions?: number;
  includeArchived: boolean;
}

export interface RepositoryConfig {
  base?: string;
  agent?: "codex" | "claude";
  model?: string;
  reasoning?: ReasoningEffort;
  preferences: ReviewPreferences;
  retention: RetentionConfig;
}

export const DEFAULT_REVIEW_PREFERENCES: ReviewPreferences = {
  diffLayout: "unified",
  changedFilesOnly: false,
  contextLines: 3,
  requireAllFilesReviewed: false,
  closeOutcome: "accepted",
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

export async function loadRepositoryConfig(repositoryRoot: string): Promise<RepositoryConfig> {
  const path = join(repositoryRoot, ".code-review-tour.json");
  let raw: string;
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.size > 64 * 1024) throw new Error("configuration must be a regular file no larger than 64 KiB");
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { preferences: { ...DEFAULT_REVIEW_PREFERENCES }, retention: { includeArchived: false } };
    }
    throw new Error(`Could not read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }

  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error(`${path} is not valid JSON.`); }
  if (!object(value)) throw new Error(`${path} must contain a JSON object.`);
  exactKeys(value, ["base", "agent", "model", "reasoning", "diff", "review", "retention"], path);
  const diff = value.diff === undefined ? {} : value.diff;
  const review = value.review === undefined ? {} : value.review;
  const retention = value.retention === undefined ? {} : value.retention;
  if (!object(diff) || !object(review) || !object(retention)) throw new Error(`${path} diff, review, and retention settings must be objects.`);
  exactKeys(diff, ["layout", "changedFilesOnly", "contextLines"], `${path} diff`);
  exactKeys(review, ["requireAllFilesReviewed", "closeOutcome"], `${path} review`);
  exactKeys(retention, ["maxAgeDays", "maxSessions", "includeArchived"], `${path} retention`);

  const agent = value.agent === undefined ? undefined : String(value.agent);
  if (agent !== undefined && !["codex", "claude"].includes(agent)) throw new Error(`${path} agent must be codex or claude.`);
  const reasoning = value.reasoning === undefined ? undefined : String(value.reasoning);
  if (reasoning !== undefined && !["minimal", "low", "medium", "high", "xhigh", "max", "ultra"].includes(reasoning)) {
    throw new Error(`${path} reasoning is unsupported.`);
  }
  const layout = diff.layout === undefined ? DEFAULT_REVIEW_PREFERENCES.diffLayout : String(diff.layout);
  if (!["unified", "split"].includes(layout)) throw new Error(`${path} diff.layout must be unified or split.`);
  if (diff.changedFilesOnly !== undefined && typeof diff.changedFilesOnly !== "boolean") throw new Error(`${path} diff.changedFilesOnly must be a boolean.`);
  if (review.requireAllFilesReviewed !== undefined && typeof review.requireAllFilesReviewed !== "boolean") throw new Error(`${path} review.requireAllFilesReviewed must be a boolean.`);
  const closeOutcome = review.closeOutcome === undefined ? DEFAULT_REVIEW_PREFERENCES.closeOutcome : String(review.closeOutcome);
  if (!["accepted", "cancelled"].includes(closeOutcome)) throw new Error(`${path} review.closeOutcome must be accepted or cancelled.`);
  if (retention.includeArchived !== undefined && typeof retention.includeArchived !== "boolean") throw new Error(`${path} retention.includeArchived must be a boolean.`);

  return {
    base: optionalString(value.base, `${path} base`, 4_096),
    agent: agent as RepositoryConfig["agent"],
    model: optionalString(value.model, `${path} model`, 256),
    reasoning: reasoning as ReasoningEffort | undefined,
    preferences: {
      diffLayout: layout as ReviewPreferences["diffLayout"],
      changedFilesOnly: diff.changedFilesOnly ?? DEFAULT_REVIEW_PREFERENCES.changedFilesOnly,
      contextLines: optionalInteger(diff.contextLines, `${path} diff.contextLines`, 3, 200) ?? DEFAULT_REVIEW_PREFERENCES.contextLines,
      requireAllFilesReviewed: review.requireAllFilesReviewed ?? DEFAULT_REVIEW_PREFERENCES.requireAllFilesReviewed,
      closeOutcome: closeOutcome as ReviewPreferences["closeOutcome"],
    },
    retention: {
      maxAgeDays: optionalInteger(retention.maxAgeDays, `${path} retention.maxAgeDays`, 1, 3_650),
      maxSessions: optionalInteger(retention.maxSessions, `${path} retention.maxSessions`, 1, 10_000),
      includeArchived: retention.includeArchived ?? false,
    },
  };
}
