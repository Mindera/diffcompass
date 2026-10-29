import { capturedComparisonSource, validateCapturedFileDiff } from "./comparison-source.ts";
import { callerDeclarations, CALLER_SCAN_LIMITS, codeGraphCallers, nameMatchedCallers, scanCapturedTree, searchedNames, type CallerCoverage, type CallerFact, type ScanLimits, type TreeScan } from "./change-callers.ts";
import { kotlinImports, loadTreeModules, typescriptImports, type ImportFact, type TreeModules } from "./change-imports.ts";
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
  | { state: "truncated"; lists: Array<{ list: "symbols" | "calls" | "tests" | "imports"; shown: number; total: number }> }
  | { state: "skipped"; reason: SkipReason; message: string }
  | { state: "unsupported"; message: string };
export interface SymbolFact { analysis: "tree-sitter declaration diff"; name: string; kind: string; change: Array<"added" | "removed" | "signature" | "body">; before?: SemanticAnchor; after?: SemanticAnchor; ambiguous?: true }
export interface CallFact { analysis: "tree-sitter call sites"; name: string; change: "removed" | "added"; side: LineSide; line: number; enclosing: string | null }
export interface TestFact { analysis: "tree-sitter test names"; name: string; side: LineSide; startLine: number; endLine: number; changed: boolean }
export const CHANGE_FACT_LIMITS = { calls: 1_000, tests: 500, imports: 500 } as const;
export interface FileChangeFacts { path: string; oldPath: string | null; newPath: string | null; language: SyntaxLanguage | null; completeness: FileCompleteness; changedLines: number; symbols: SymbolFact[]; calls: CallFact[]; tests: TestFact[]; imports: ImportFact[]; unattributed: LineRange[] }
export interface ChangeFacts { engine: string; comparisonId: string; files: FileChangeFacts[]; callers: CallerFact[]; callerCoverage: CallerCoverage }

const unsupported: FileCompleteness = { state: "unsupported", message: NO_CHANGE_FACTS_MESSAGE };
const TS_TEST_PATH = /\.(?:test|spec)\.(?:ts|tsx|mts|cts)$/i;
const KOTLIN_TEST_DIRECTORY = /(?:^|\/)src\/(?:test|[a-z][A-Za-z]*Test)\//;
const limitReasons = { size: "oversized", time: "time-limit", complexity: "analysis-limit" } as const satisfies Record<NonNullable<SemanticSummary["limit"]>, SkipReason>;

function fileLanguage(file: DiffFile): SyntaxLanguage | undefined {
  const oldLanguage = supportedLanguage(file.oldPath), newLanguage = supportedLanguage(file.newPath);
  if ((file.oldPath && !oldLanguage) || (file.newPath && !newLanguage) || (oldLanguage && newLanguage && oldLanguage !== newLanguage)) return;
  return newLanguage ?? oldLanguage;
}

export function isTestPath(path: string): boolean {
  const language = supportedLanguage(path);
  if (language === "kotlin") return KOTLIN_TEST_DIRECTORY.test(path) || /Tests?\.kt$/.test(path);
  return language !== undefined && (TS_TEST_PATH.test(path) || path.split("/").includes("__tests__"));
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

function factRanges(facts: Pick<FileChangeFacts, "symbols" | "calls" | "tests" | "imports">): LineRange[] {
  return [
    ...facts.symbols.flatMap((symbol) => [
      ...(symbol.before ? [{ side: "old" as const, startLine: symbol.before.startLine, endLine: symbol.before.endLine }] : []),
      ...(symbol.after ? [{ side: "new" as const, startLine: symbol.after.startLine, endLine: symbol.after.endLine }] : []),
    ]),
    ...facts.calls.map((call) => ({ side: call.side, startLine: call.line, endLine: call.line })),
    ...facts.tests.map((test) => ({ side: test.side, startLine: test.startLine, endLine: test.endLine })),
    ...facts.imports.map((fact) => ({ side: fact.side, startLine: fact.startLine, endLine: fact.endLine })),
  ];
}

function unattributedRanges(file: DiffFile, facts: Pick<FileChangeFacts, "completeness" | "symbols" | "calls" | "tests" | "imports">): LineRange[] {
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

function cappedImports(sides: ImportFact[][]): { imports: ImportFact[]; lists: Array<{ list: "imports"; shown: number; total: number }> } {
  const imports = sides.flatMap((side) => side.slice(0, CHANGE_FACT_LIMITS.imports));
  const total = sides.reduce((sum, side) => sum + side.length, 0);
  return { imports, lists: total > imports.length ? [{ list: "imports", shown: imports.length, total }] : [] };
}
type ModulesFor = (side: LineSide) => Promise<TreeModules | null>;

async function analysedFileFacts(comparison: GitComparison, file: DiffFile, modulesFor: ModulesFor): Promise<AnalysedFacts> {
  const identity = { path: file.path, oldPath: file.oldPath, newPath: file.newPath, changedLines: changedLines(file) };
  const language = fileLanguage(file);
  if (!language) return { ...identity, language: null, completeness: unsupported, symbols: [], calls: [], tests: [], imports: [] };
  let before: string, after: string;
  try {
    before = await capturedComparisonSource(comparison, file.path, "old", SEMANTIC_LIMITS.bytes);
    after = await capturedComparisonSource(comparison, file.path, "new", SEMANTIC_LIMITS.bytes);
    await validateCapturedFileDiff(comparison, file.path);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Captured source is unavailable.";
    return { ...identity, language, completeness: { state: "skipped", reason: /limit/.test(message) ? "oversized" : "unreadable", message }, symbols: [], calls: [], tests: [], imports: [] };
  }
  const summary = await analyseSemanticSources(file, before, after, { beforeTree: comparison.mergeBase, afterTree: comparison.sourceTree });
  const facts = summaryFacts(summary, language);
  if (summary.status !== "analysed") return { ...identity, ...facts, calls: [], tests: [], imports: [] };
  const derived = await treeFacts(file, language, before, after, modulesFor);
  if (!derived) return { ...identity, language, completeness: { state: "skipped", reason: "time-limit", message: "Parser time limit reached; use the text diff." }, symbols: [], calls: [], tests: [], imports: [] };
  const calls = derived.calls.slice(0, CHANGE_FACT_LIMITS.calls), tests = derived.tests.slice(0, CHANGE_FACT_LIMITS.tests);
  const { imports, lists: importLists } = cappedImports(derived.imports);
  const lists = [
    ...(facts.completeness.state === "truncated" ? facts.completeness.lists : []),
    ...(derived.calls.length > calls.length ? [{ list: "calls" as const, shown: calls.length, total: derived.calls.length }] : []),
    ...(derived.tests.length > tests.length ? [{ list: "tests" as const, shown: tests.length, total: derived.tests.length }] : []),
    ...importLists,
  ];
  return { ...identity, ...facts, completeness: lists.length ? { state: "truncated", lists } : facts.completeness, calls, tests, imports };
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

const TEST_CALLEES = ["test", "it"], TEST_MODIFIERS = ["skip", "only", "todo", "failing"];

function namedCall(node: Node, callees: string[]): boolean {
  if (node.type !== "call_expression") return false;
  const callee = node.childForFieldName("function");
  if (callee?.type === "identifier") return callees.includes(callee.text);
  if (callee?.type !== "member_expression") return false;
  const object = callee.childForFieldName("object"), property = callee.childForFieldName("property");
  return object?.type === "identifier" && callees.includes(object.text) && !!property && TEST_MODIFIERS.includes(property.text);
}

function literalTitle(call: Node): string | null {
  const argument = call.childForFieldName("arguments")?.namedChild(0);
  if (argument?.type === "string" || (argument?.type === "template_string" && !argument.children.some((child) => child?.type === "template_substitution"))) return argument.text.slice(1, -1);
  return null;
}

function typeScriptTestName(node: Node, title: string): string {
  const names: string[] = [];
  for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
    const describe = namedCall(ancestor, ["describe"]) ? literalTitle(ancestor) : null;
    if (describe !== null) names.unshift(describe);
  }
  return [...names, title].join(" > ");
}

function annotationName(annotation: Node): string | undefined {
  const userType = (parent: Node | null | undefined) => parent?.children.find((child) => child?.type === "user_type");
  const type = userType(annotation) ?? userType(annotation.children.find((child) => child?.type === "constructor_invocation"));
  return type?.children.filter((part) => part?.type === "type_identifier").at(-1)?.text;
}

function isKotlinTest(node: Node): boolean {
  const modifiers = node.children.find((child) => child?.type === "modifiers");
  return !!modifiers?.children.some((annotation) => annotation?.type === "annotation" && annotationName(annotation) === "Test");
}

function kotlinTestName(node: Node): string | null {
  const own = node.children.find((child) => child?.type === "simple_identifier")?.text;
  if (!own) return null;
  const names: string[] = [];
  for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
    if (ancestor.type !== "class_declaration" && ancestor.type !== "object_declaration") continue;
    const name = ancestor.children.find((child) => child?.type === "type_identifier")?.text;
    if (name) names.unshift(name);
  }
  return [...names, own.replace(/^`|`$/g, "")].join(" > ");
}

function testsIn(tree: Tree, language: SyntaxLanguage, side: LineSide, changed: Set<number>): TestFact[] {
  const tests: TestFact[] = [];
  const stack: Node[] = [tree.rootNode];
  while (stack.length) {
    const node = stack.pop()!;
    const title = language === "kotlin" ? (node.type === "function_declaration" && isKotlinTest(node) ? kotlinTestName(node) : null) : (namedCall(node, TEST_CALLEES) ? literalTitle(node) : null);
    const name = title === null ? null : language === "kotlin" ? title : typeScriptTestName(node, title);
    if (name !== null) {
      const startLine = node.startPosition.row + 1, endLine = node.endPosition.row + 1;
      tests.push({ analysis: "tree-sitter test names", name, side, startLine, endLine, changed: [...changed].some((line) => startLine <= line && line <= endLine) });
    }
    for (let i = node.childCount - 1; i >= 0; i--) stack.push(node.child(i)!);
  }
  return tests;
}

async function treeFacts(file: DiffFile, language: SyntaxLanguage, before: string, after: string, modulesFor: ModulesFor): Promise<{ calls: CallFact[]; tests: TestFact[]; imports: ImportFact[][] } | null> {
  let parser: Parser | undefined;
  const trees: Tree[] = [];
  try {
    parser = await languageParser(language);
    for (const source of [before, after]) {
      const tree = parseWithin(parser, source, SEMANTIC_LIMITS.parseMicros);
      if (!tree) return null;
      trees.push(tree);
    }
    const changed = { old: new Set(changedLineNumbers(file, "old")), new: new Set(changedLineNumbers(file, "new")) };
    const importsIn = async (tree: Tree, side: LineSide, path: string | null): Promise<ImportFact[]> => {
      if (language === "kotlin" || !path) return [];
      const modules = await modulesFor(side);
      return modules ? typescriptImports(tree.rootNode, path, side, changed[side], modules) : [];
    };
    return {
      calls: [...callsIn(trees[0]!, language, "old", changed.old), ...callsIn(trees[1]!, language, "new", changed.new)],
      tests: [
        ...(file.oldPath && isTestPath(file.oldPath) ? testsIn(trees[0]!, language, "old", changed.old) : []),
        ...(file.newPath && isTestPath(file.newPath) ? testsIn(trees[1]!, language, "new", changed.new) : []),
      ],
      imports: [await importsIn(trees[0]!, "old", file.oldPath), await importsIn(trees[1]!, "new", file.newPath)],
    };
  } finally {
    for (const tree of trees) tree.delete();
    parser?.delete();
  }
}

async function kotlinFileImports(comparison: GitComparison, file: DiffFile, scans: Record<LineSide, TreeScan | null>): Promise<ImportFact[][]> {
  const parser = await languageParser("kotlin");
  try {
    const sides: ImportFact[][] = [];
    for (const [side, path] of [["old", file.oldPath], ["new", file.newPath]] as const) {
      const scan = scans[side];
      const tree = path && scan ? parseWithin(parser, await capturedComparisonSource(comparison, file.path, side, SEMANTIC_LIMITS.bytes), SEMANTIC_LIMITS.parseMicros) : null;
      try { sides.push(tree && scan && path ? kotlinImports(tree.rootNode, path, side, new Set(changedLineNumbers(file, side)), scan) : []); }
      finally { tree?.delete(); }
    }
    return sides;
  } finally {
    parser.delete();
  }
}

async function withKotlinImports(comparison: GitComparison, file: DiffFile, facts: AnalysedFacts, scans: Record<LineSide, TreeScan | null>): Promise<AnalysedFacts> {
  let sides: ImportFact[][];
  try { sides = await kotlinFileImports(comparison, file, scans); }
  catch { return facts; }
  const { imports, lists: importLists } = cappedImports(sides);
  const lists = [...(facts.completeness.state === "truncated" ? facts.completeness.lists : []), ...importLists];
  return { ...facts, imports: [...facts.imports, ...imports], completeness: lists.length ? { state: "truncated", lists } : facts.completeness };
}

const isAnalysedKotlin = (facts: AnalysedFacts) => facts.language === "kotlin" && (facts.completeness.state === "complete" || facts.completeness.state === "truncated");

export async function loadChangeFacts(comparison: GitComparison, options: { scanLimits?: ScanLimits; codegraph?: string | null } = {}): Promise<ChangeFacts> {
  const modules = new Map<LineSide, Promise<TreeModules | null>>();
  const modulesFor: ModulesFor = (side) => {
    if (!modules.has(side)) modules.set(side, loadTreeModules(comparison, side).catch(() => null));
    return modules.get(side)!;
  };
  const analysed: AnalysedFacts[] = [];
  for (const file of comparison.files) analysed.push(await analysedFileFacts(comparison, file, modulesFor));
  const declarations = callerDeclarations(analysed);
  const { names, total } = searchedNames(declarations);
  const limits = options.scanLimits ?? CALLER_SCAN_LIMITS;
  const kotlin = analysed.flatMap((facts, index) => isAnalysedKotlin(facts) ? [comparison.files[index]] : []);
  let callers: CallerFact[] = [];
  const callerCoverage: CallerCoverage = { nameMatch: null, names: { searched: names.size, total }, codegraph: { state: "skipped", declarations: 0, queried: 0 } };
  const scans: Record<LineSide, TreeScan | null> = { old: null, new: null };
  if (names.size || kotlin.some((file) => file.newPath)) {
    try {
      const first = comparison.files.flatMap((file) => (file.newPath ? [file.newPath] : []));
      scans.new = await scanCapturedTree(comparison, "new", { names, limits, first });
      if (names.size) {
        callers = nameMatchedCallers(declarations, scans.new);
        callerCoverage.nameMatch = scans.new.coverage;
      }
    } catch (error) {
      if (names.size) callerCoverage.error = error instanceof Error ? error.message : String(error);
    }
  }
  if (kotlin.some((file) => file.oldPath)) {
    try {
      const first = comparison.files.flatMap((file) => (file.oldPath ? [file.oldPath] : []));
      scans.old = await scanCapturedTree(comparison, "old", { names: new Set(), limits, first });
    } catch {}
  }
  for (const [index, facts] of analysed.entries()) if (isAnalysedKotlin(facts)) analysed[index] = await withKotlinImports(comparison, comparison.files[index], facts, scans);
  const files: FileChangeFacts[] = analysed.map((facts, index) => ({ ...facts, unattributed: unattributedRanges(comparison.files[index], facts) }));
  const executable = options.codegraph === undefined ? Bun.which("codegraph") : options.codegraph;
  const codegraph = await codeGraphCallers(comparison, declarations, executable);
  callers = [...callers, ...codegraph.facts];
  callerCoverage.codegraph = codegraph.coverage;
  return { engine: CHANGE_FACTS_ENGINE, comparisonId: diffSourceIdentity(comparison), files, callers, callerCoverage };
}
