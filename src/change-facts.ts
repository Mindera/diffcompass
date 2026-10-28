import { capturedComparisonSource, validateCapturedFileDiff } from "./comparison-source.ts";
import { diffSourceIdentity } from "./diff-sources.ts";
import { analyseSemanticSources, SEMANTIC_ENGINE, SEMANTIC_LIMITS, supportedLanguage, type SemanticAnchor, type SemanticSummary, type SyntaxLanguage } from "./semantic-diff.ts";
import type { DiffFile, GitComparison } from "./types.ts";

export const CHANGE_FACTS_ENGINE = `${SEMANTIC_ENGINE} / change facts 1`;
export const NO_CHANGE_FACTS_MESSAGE = "No change facts: DiffCompass derives change facts from TypeScript, TSX and Kotlin files only.";
export type LineSide = "old" | "new";
export interface LineRange { side: LineSide; startLine: number; endLine: number }
export type SkipReason = "generated" | "oversized" | "unreadable" | "parse-error" | "time-limit" | "analysis-limit" | "unavailable";
export type FileCompleteness =
  | { state: "complete" }
  | { state: "truncated"; lists: Array<{ list: "symbols"; shown: number; total: number }> }
  | { state: "skipped"; reason: SkipReason; message: string }
  | { state: "unsupported"; message: string };
export interface SymbolFact { analysis: "tree-sitter declaration diff"; name: string; kind: string; change: Array<"added" | "removed" | "signature" | "body">; before?: SemanticAnchor; after?: SemanticAnchor; ambiguous?: true }
export interface FileChangeFacts { path: string; oldPath: string | null; newPath: string | null; language: SyntaxLanguage | null; completeness: FileCompleteness; changedLines: number; symbols: SymbolFact[] }
export interface ChangeFacts { engine: string; comparisonId: string; files: FileChangeFacts[] }

const unsupported: FileCompleteness = { state: "unsupported", message: NO_CHANGE_FACTS_MESSAGE };
const limitReasons = { size: "oversized", time: "time-limit", complexity: "analysis-limit" } as const satisfies Record<NonNullable<SemanticSummary["limit"]>, SkipReason>;

function fileLanguage(file: DiffFile): SyntaxLanguage | undefined {
  const oldLanguage = supportedLanguage(file.oldPath), newLanguage = supportedLanguage(file.newPath);
  if ((file.oldPath && !oldLanguage) || (file.newPath && !newLanguage) || (oldLanguage && newLanguage && oldLanguage !== newLanguage)) return;
  return newLanguage ?? oldLanguage;
}

function changedLines(file: DiffFile): number {
  return file.hunks.reduce((total, hunk) => total + hunk.rows.filter((row) => row.kind === "addition" || row.kind === "deletion").length, 0);
}

function symbolFacts(summary: SemanticSummary): SymbolFact[] {
  return summary.changes.map((change) => ({
    analysis: "tree-sitter declaration diff", name: change.name, kind: change.kind, change: [...change.categories],
    ...(change.before ? { before: change.before } : {}), ...(change.after ? { after: change.after } : {}), ...(change.ambiguous ? { ambiguous: true as const } : {}),
  }));
}

function summaryFacts(summary: SemanticSummary, language: SyntaxLanguage): Pick<FileChangeFacts, "language" | "completeness" | "symbols"> {
  const skipped = (reason: SkipReason) => ({ language, completeness: { state: "skipped" as const, reason, message: summary.message }, symbols: [] });
  switch (summary.status) {
    case "generated": return skipped("generated");
    case "parse-error": return skipped("parse-error");
    case "limited": return skipped(summary.limit ? limitReasons[summary.limit] : "analysis-limit");
    case "unavailable": return skipped("unavailable");
    case "unsupported": return { language: null, completeness: unsupported, symbols: [] };
    case "analysed": {
      const total = summary.totalChanges ?? summary.changes.length;
      return { language, completeness: total > summary.changes.length ? { state: "truncated", lists: [{ list: "symbols", shown: summary.changes.length, total }] } : { state: "complete" }, symbols: symbolFacts(summary) };
    }
  }
}

async function fileFacts(comparison: GitComparison, file: DiffFile): Promise<FileChangeFacts> {
  const identity = { path: file.path, oldPath: file.oldPath, newPath: file.newPath, changedLines: changedLines(file) };
  const language = fileLanguage(file);
  if (!language) return { ...identity, language: null, completeness: unsupported, symbols: [] };
  let before: string, after: string;
  try {
    before = await capturedComparisonSource(comparison, file.path, "old", SEMANTIC_LIMITS.bytes);
    after = await capturedComparisonSource(comparison, file.path, "new", SEMANTIC_LIMITS.bytes);
    await validateCapturedFileDiff(comparison, file.path);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Captured source is unavailable.";
    return { ...identity, language, completeness: { state: "skipped", reason: /limit/.test(message) ? "oversized" : "unreadable", message }, symbols: [] };
  }
  const summary = await analyseSemanticSources(file, before, after, { beforeTree: comparison.mergeBase, afterTree: comparison.sourceTree });
  return { ...identity, ...summaryFacts(summary, language) };
}

export async function loadChangeFacts(comparison: GitComparison): Promise<ChangeFacts> {
  const files: FileChangeFacts[] = [];
  for (const file of comparison.files) files.push(await fileFacts(comparison, file));
  return { engine: CHANGE_FACTS_ENGINE, comparisonId: diffSourceIdentity(comparison), files };
}
