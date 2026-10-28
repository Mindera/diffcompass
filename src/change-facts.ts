import { capturedComparisonSource, validateCapturedFileDiff } from "./comparison-source.ts";
import { diffSourceIdentity } from "./diff-sources.ts";
import { analyseSemanticSources, languageParser, SEMANTIC_ENGINE, SEMANTIC_LIMITS, supportedLanguage, type SemanticAnchor, type SemanticSummary, type SyntaxLanguage } from "./semantic-diff.ts";
import { calledName, enclosingName, parseWithin } from "./syntax-nodes.ts";
import type { DiffFile, GitComparison } from "./types.ts";
import type { Node, Parser, Tree } from "web-tree-sitter";

export const CHANGE_FACTS_ENGINE = `${SEMANTIC_ENGINE} / change facts 1`;
export const NO_CHANGE_FACTS_MESSAGE = "No change facts: DiffCompass derives change facts from TypeScript, TSX and Kotlin files only.";
export type LineSide = "old" | "new";
export interface LineRange { side: LineSide; startLine: number; endLine: number }
export type SkipReason = "generated" | "oversized" | "unreadable" | "parse-error" | "time-limit" | "analysis-limit" | "unavailable";
export type FileCompleteness =
  | { state: "complete" }
  | { state: "truncated"; lists: Array<{ list: "symbols" | "calls"; shown: number; total: number }> }
  | { state: "skipped"; reason: SkipReason; message: string }
  | { state: "unsupported"; message: string };
export interface SymbolFact { analysis: "tree-sitter declaration diff"; name: string; kind: string; change: Array<"added" | "removed" | "signature" | "body">; before?: SemanticAnchor; after?: SemanticAnchor; ambiguous?: true }
export interface CallFact { analysis: "tree-sitter call sites"; name: string; change: "removed" | "added"; side: LineSide; line: number; enclosing: string | null }
export const CHANGE_FACT_LIMITS = { calls: 1_000 } as const;
export interface FileChangeFacts { path: string; oldPath: string | null; newPath: string | null; language: SyntaxLanguage | null; completeness: FileCompleteness; changedLines: number; symbols: SymbolFact[]; calls: CallFact[]; unattributed: LineRange[] }
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

export function lineRanges(side: LineSide, lines: Iterable<number>): LineRange[] {
  const ranges: LineRange[] = [];
  for (const line of [...new Set(lines)].sort((a, b) => a - b)) {
    const last = ranges.at(-1);
    if (last && line === last.endLine + 1) last.endLine = line;
    else ranges.push({ side, startLine: line, endLine: line });
  }
  return ranges;
}

function changedLineNumbers(file: DiffFile, side: LineSide): number[] {
  return file.hunks.flatMap((hunk) => hunk.rows.flatMap((row) => {
    const line = side === "old" ? (row.kind === "deletion" ? row.oldLine : null) : (row.kind === "addition" ? row.newLine : null);
    return line === null ? [] : [line];
  }));
}

function factRanges(facts: Pick<FileChangeFacts, "symbols" | "calls">): LineRange[] {
  return [
    ...facts.symbols.flatMap((symbol) => [
      ...(symbol.before ? [{ side: "old" as const, startLine: symbol.before.startLine, endLine: symbol.before.endLine }] : []),
      ...(symbol.after ? [{ side: "new" as const, startLine: symbol.after.startLine, endLine: symbol.after.endLine }] : []),
    ]),
    ...facts.calls.map((call) => ({ side: call.side, startLine: call.line, endLine: call.line })),
  ];
}

function unattributedRanges(file: DiffFile, facts: Pick<FileChangeFacts, "completeness" | "symbols" | "calls">): LineRange[] {
  if (facts.completeness.state === "unsupported") return [];
  const ranges = facts.completeness.state === "skipped" ? [] : factRanges(facts);
  const uncovered = (side: LineSide) => changedLineNumbers(file, side).filter((line) => !ranges.some((range) => range.side === side && range.startLine <= line && line <= range.endLine));
  return [...lineRanges("old", uncovered("old")), ...lineRanges("new", uncovered("new"))];
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

type AnalysedFacts = Omit<FileChangeFacts, "unattributed">;

async function analysedFileFacts(comparison: GitComparison, file: DiffFile): Promise<AnalysedFacts> {
  const identity = { path: file.path, oldPath: file.oldPath, newPath: file.newPath, changedLines: changedLines(file) };
  const language = fileLanguage(file);
  if (!language) return { ...identity, language: null, completeness: unsupported, symbols: [], calls: [] };
  let before: string, after: string;
  try {
    before = await capturedComparisonSource(comparison, file.path, "old", SEMANTIC_LIMITS.bytes);
    after = await capturedComparisonSource(comparison, file.path, "new", SEMANTIC_LIMITS.bytes);
    await validateCapturedFileDiff(comparison, file.path);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Captured source is unavailable.";
    return { ...identity, language, completeness: { state: "skipped", reason: /limit/.test(message) ? "oversized" : "unreadable", message }, symbols: [], calls: [] };
  }
  const summary = await analyseSemanticSources(file, before, after, { beforeTree: comparison.mergeBase, afterTree: comparison.sourceTree });
  const facts = summaryFacts(summary, language);
  if (summary.status !== "analysed") return { ...identity, ...facts, calls: [] };
  const calls = await callFacts(file, language, before, after);
  if (!calls) return { ...identity, language, completeness: { state: "skipped", reason: "time-limit", message: "Parser time limit reached; use the text diff." }, symbols: [], calls: [] };
  const shown = calls.slice(0, CHANGE_FACT_LIMITS.calls);
  const lists = [...(facts.completeness.state === "truncated" ? facts.completeness.lists : []), ...(calls.length > shown.length ? [{ list: "calls" as const, shown: shown.length, total: calls.length }] : [])];
  return { ...identity, ...facts, completeness: lists.length ? { state: "truncated", lists } : facts.completeness, calls: shown };
}

function callsIn(tree: Tree, language: SyntaxLanguage, side: LineSide, changed: Set<number>): CallFact[] {
  const calls: Array<CallFact & { column: number }> = [];
  const stack: Node[] = [tree.rootNode];
  while (stack.length) {
    const node = stack.pop()!;
    const name = calledName(node, language);
    const line = name ? name.startPosition.row + 1 : 0;
    if (name && changed.has(line)) calls.push({ analysis: "tree-sitter call sites", name: name.text, change: side === "old" ? "removed" : "added", side, line, enclosing: enclosingName(node, language), column: name.startPosition.column });
    for (let i = node.childCount - 1; i >= 0; i--) stack.push(node.child(i)!);
  }
  return calls.sort((a, b) => a.line - b.line || a.column - b.column).map(({ column, ...call }) => call);
}

async function callFacts(file: DiffFile, language: SyntaxLanguage, before: string, after: string): Promise<CallFact[] | null> {
  let parser: Parser | undefined;
  const trees: Tree[] = [];
  try {
    parser = await languageParser(language);
    for (const source of [before, after]) {
      const tree = parseWithin(parser, source, SEMANTIC_LIMITS.parseMicros);
      if (!tree) return null;
      trees.push(tree);
    }
    return [
      ...callsIn(trees[0]!, language, "old", new Set(changedLineNumbers(file, "old"))),
      ...callsIn(trees[1]!, language, "new", new Set(changedLineNumbers(file, "new"))),
    ];
  } finally {
    for (const tree of trees) tree.delete();
    parser?.delete();
  }
}

async function fileFacts(comparison: GitComparison, file: DiffFile): Promise<FileChangeFacts> {
  const facts = await analysedFileFacts(comparison, file);
  return { ...facts, unattributed: unattributedRanges(file, facts) };
}

export async function loadChangeFacts(comparison: GitComparison): Promise<ChangeFacts> {
  const files: FileChangeFacts[] = [];
  for (const file of comparison.files) files.push(await fileFacts(comparison, file));
  return { engine: CHANGE_FACTS_ENGINE, comparisonId: diffSourceIdentity(comparison), files };
}
