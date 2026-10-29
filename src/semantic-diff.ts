import { createHash } from "node:crypto";
import { Parser, Language, type Node, type Tree } from "web-tree-sitter";
// Bun embeds these assets in compiled releases; no runtime downloads or project imports.
// @ts-expect-error Bun file loader.
import runtimeWasm from "web-tree-sitter/tree-sitter.wasm" with { type: "file" };
// @ts-expect-error Bun file loader.
import typescriptWasm from "tree-sitter-wasms/out/tree-sitter-typescript.wasm" with { type: "file" };
// @ts-expect-error Bun file loader.
import tsxWasm from "tree-sitter-wasms/out/tree-sitter-tsx.wasm" with { type: "file" };
// @ts-expect-error Bun file loader.
import kotlinWasm from "tree-sitter-wasms/out/tree-sitter-kotlin.wasm" with { type: "file" };
import { capturedComparisonSource, validateCapturedFileDiff } from "./comparison-source.ts";
import type { DiffFile, GitComparison, TourAnchor } from "./types.ts";

export const SEMANTIC_ENGINE = "tree-sitter 0.25.10 / grammars 0.1.13 / summary 4";
export const SEMANTIC_LIMITS = { bytes: 256_000, lines: 10_000, declarations: 1_000, changes: 200, nodes: 100_000, depth: 200, parseMicros: 150_000, cachedFiles: 32, requests: 4 } as const;
export const SEMANTIC_NOTICE = "Syntax evidence only: changes or unchanged syntax do not prove behaviour, equivalence, or runtime impact. Names are matched within this file; overload ambiguity is retained. Imports, expressions and unsupported declarations may need the text diff. Display labels are shortened; open source for exact text.";
export const SYNTAX_LANGUAGES = [{ id: "typescript", extensions: [".ts", ".mts", ".cts"] }, { id: "tsx", extensions: [".tsx"] }, { id: "kotlin", extensions: [".kt", ".kts"] }] as const;
export type SyntaxLanguage = (typeof SYNTAX_LANGUAGES)[number]["id"];
export interface SemanticAnchor extends TourAnchor { signature: string }
interface SyntaxInput { name: string; optional: boolean; defaulted?: boolean }
export interface SemanticChange { name: string; kind: string; scope?: "local" | "member" | "top-level"; categories: Array<"added" | "removed" | "signature" | "body">; before?: SemanticAnchor; after?: SemanticAnchor; ambiguous?: boolean; inputs?: { added: SyntaxInput[]; removed: SyntaxInput[] } }
export interface SemanticSummary {
  path: string;
  status: "analysed" | "unsupported" | "parse-error" | "unavailable" | "limited" | "generated";
  limit?: "size" | "time" | "complexity";
  language?: SyntaxLanguage;
  engine: string;
  beforeTree: string;
  afterTree?: string;
  beforeHash?: string;
  afterHash?: string;
  message: string;
  notice: string;
  changes: SemanticChange[];
  totalChanges?: number;
  renamed: boolean;
}
interface Declaration { key: string; name: string; kind: string; scope?: SemanticChange["scope"]; signature: string; body: string; anchor: SemanticAnchor; inputs?: SyntaxInput[]; parent?: Declaration }
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const assets = { typescript: typescriptWasm, tsx: tsxWasm, kotlin: kotlinWasm };
let initialized: Promise<void> | undefined;
const languages = new Map<SyntaxLanguage, Promise<Language>>();
export async function languageParser(language: SyntaxLanguage): Promise<Parser> {
  initialized ??= Bun.file(runtimeWasm).arrayBuffer().then((bytes) => Parser.init({ wasmBinary: new Uint8Array(bytes) })).catch((error) => { initialized = undefined; throw error; });
  await initialized;
  if (!languages.has(language)) languages.set(language, Bun.file(assets[language]).arrayBuffer().then((bytes) => Language.load(new Uint8Array(bytes))).catch((error) => { languages.delete(language); throw error; }));
  const parser = new Parser();
  parser.setLanguage(await languages.get(language)!);
  return parser;
}
export function supportedLanguage(path: string | null): SyntaxLanguage | undefined {
  if (!path) return undefined;
  const lower = path.toLowerCase();
  return SYNTAX_LANGUAGES.find((language) => language.extensions.some((extension) => lower.endsWith(extension)))?.id;
}
const comment = (node: Node) => /^(?:comment|line_comment|multiline_comment|block_comment|shebang_line)$/.test(node.type);
const children = (node: Node, named = false): Node[] => (named ? node.namedChildren : node.children).filter((child): child is Node => child !== null);
const tsDeclarations = new Set(["function_declaration", "generator_function_declaration", "function_signature", "class_declaration", "abstract_class_declaration", "interface_declaration", "type_alias_declaration", "enum_declaration", "method_definition", "method_signature", "abstract_method_signature", "public_field_definition", "property_signature", "variable_declarator", "internal_module"]);
const ktDeclarations = new Set(["function_declaration", "class_declaration", "object_declaration", "companion_object", "property_declaration", "type_alias"]);

export function declarationParts(node: Node, language: SyntaxLanguage): { name: Node; bodies: Node[] } | undefined {
  if (language !== "kotlin") {
    if (!tsDeclarations.has(node.type)) return;
    const name = node.childForFieldName("name");
    // Destructuring and computed names are not stable declaration identities.
    if (!name || !["identifier", "type_identifier", "property_identifier", "private_property_identifier", "string"].includes(name.type)) return;
    const value = ["variable_declarator", "public_field_definition"].includes(node.type) ? node.childForFieldName("value") : null;
    const body = node.childForFieldName("body") ?? (value && ["arrow_function", "function_expression", "function"].includes(value.type) ? value.childForFieldName("body") : value);
    return { name, bodies: body ? [body] : [] };
  }
  if (!ktDeclarations.has(node.type)) return;
  const variable = children(node, true).find((child) => child.type === "variable_declaration");
  const name = children(node, true).find((child) => child.type === "simple_identifier" || child.type === "type_identifier")
    ?? (variable && children(variable, true).find((child) => child.type === "simple_identifier"));
  if (!name) return;
  let bodies = children(node, true).filter((child) => ["function_body", "class_body", "enum_class_body", "getter", "setter", "property_delegate"].includes(child.type));
  if (node.type === "property_declaration") {
    const equal = children(node).findIndex((child) => child.type === "=");
    if (equal !== -1) bodies = [...bodies, ...children(node).slice(equal + 1).filter((child) => child.isNamed && !comment(child))];
  }
  return { name, bodies };
}

/** Facts from parameter nodes only; never reconstruct inputs from display signatures. */
function declarationInputs(node: Node, language: SyntaxLanguage): SyntaxInput[] | undefined {
  const callable = node.type === "variable_declarator" || node.type === "public_field_definition" ? node.childForFieldName("value") : node;
  if (!callable) return;
  const parameters = language === "kotlin"
    ? children(callable, true).find((child) => child.type === "function_value_parameters")
    : callable.childForFieldName("parameters");
  const single = language !== "kotlin" ? callable.childForFieldName("parameter") : null;
  if (!parameters) return single?.type === "identifier" && single.text.length < 400 ? [{ name: single.text, optional: false }] : undefined;
  const inputs: SyntaxInput[] = [];
  for (const parameter of children(parameters, true).filter((child) => !comment(child))) {
    if (inputs.length >= 64) return;
    if (language === "kotlin" && parameter.type !== "parameter") continue; // Default expressions are siblings of the parameter.
    const name = language === "kotlin" ? children(parameter, true).find((child) => child.type === "simple_identifier") : parameter.childForFieldName("pattern");
    if (!name || !["identifier", "simple_identifier"].includes(name.type)) return; // Destructuring/rest inputs need the full code.
    let next = parameter.nextSibling;
    while (next && comment(next)) next = next.nextSibling;
    const defaulted = language === "kotlin" ? next?.type === "=" : Boolean(parameter.childForFieldName("value"));
    inputs.push({ name: name.text.slice(0, 400), optional: language === "kotlin" ? defaulted : parameter.type === "optional_parameter", ...(defaulted ? { defaulted: true } : {}) });
  }
  if (inputs.some((input) => input.name.length >= 400) || new Set(inputs.map((input) => input.name)).size !== inputs.length) return;
  return inputs;
}
function inputChanges(before?: SyntaxInput[], after?: SyntaxInput[]): SemanticChange["inputs"] {
  if (!before || !after) return;
  const added = after.filter((input) => !before.some((old) => old.name === input.name));
  const removed = before.filter((input) => !after.some((next) => next.name === input.name));
  // Renamed/reordered/replaced inputs require inspection, not a guessed correspondence.
  if (added.length && removed.length) return;
  const sharedBefore = before.filter((input) => !removed.includes(input)).map((input) => input.name);
  const sharedAfter = after.filter((input) => !added.includes(input)).map((input) => input.name);
  if (JSON.stringify(sharedBefore) !== JSON.stringify(sharedAfter) || (!added.length && !removed.length)) return;
  return { added, removed };
}

function inspectTree(tree: Tree, language: SyntaxLanguage, path: string, side: "old" | "new"): { declarations: Declaration[]; syntax: string } {
  let visited = 0;
  const fingerprints = new Map<number, string>();
  const fingerprint = (node: Node, depth = 0): string => {
    if (++visited > SEMANTIC_LIMITS.nodes || depth > SEMANTIC_LIMITS.depth) throw new Error("Syntax tree exceeds the analysis complexity limit.");
    if (comment(node)) return "";
    const value = hash(JSON.stringify([node.type, node.childCount ? children(node).map((child) => fingerprint(child, depth + 1)).filter(Boolean) : node.text]));
    fingerprints.set(node.id, value);
    return value;
  };
  const syntax = fingerprint(tree.rootNode);
  const sourceText = tree.rootNode.text;
  const declarations: Declaration[] = [];
  const signatureHash = (node: Node, excluded: Set<number>, ancestors: Set<number>): string => {
    if (excluded.has(node.id)) return "<body>";
    if (comment(node)) return "";
    if (!ancestors.has(node.id)) return fingerprints.get(node.id) ?? "";
    return hash(JSON.stringify([node.type, node.childCount ? children(node).map((child) => signatureHash(child, excluded, ancestors)).filter(Boolean) : node.text]));
  };
  const walk = (node: Node, owners: string[], parent?: Declaration) => {
    const parts = declarationParts(node, language);
    let nextOwners = owners;
    let nextParent = parent;
    if (parts) {
      if (declarations.length >= SEMANTIC_LIMITS.declarations) throw new Error("File exceeds the 1,000 declaration analysis limit.");
      const name = [...owners, parts.name.text].join(".");
      const bodies = new Set(parts.bodies.map((body) => body.id));
      let wrapper = node;
      if (language !== "kotlin" && node.parent?.type === "export_statement") wrapper = node.parent;
      const ancestors = new Set<number>();
      for (const body of parts.bodies) for (let parent = body.parent; parent; parent = parent.parent) {
        ancestors.add(parent.id);
        if (parent.id === wrapper.id) break;
      }
      const binding = language !== "kotlin" && node.type === "variable_declarator" ? node.parent?.childForFieldName("kind")?.text ?? "" : "";
      const exportedBinding = node.type === "variable_declarator" && node.parent?.parent?.type === "export_statement" ? "export" : "";
      const signature = hash(signatureHash(wrapper, bodies, ancestors) + binding + exportedBinding);
      const body = hash(parts.bodies.map((body) => fingerprints.get(body.id) ?? "").join("|"));
      const end = parts.bodies.length ? Math.min(...parts.bodies.map((body) => body.startIndex)) : node.endIndex;
      const label = sourceText.slice(wrapper.startIndex, end).trim().replace(/\s+/g, " ").slice(0, 400);
      nextParent = { key: `${node.type}:${hash(parts.name.text)}`, name: name.length > 400 ? name.slice(0, 399) + "…" : name, kind: node.type.replace(/_/g, " "), signature, body, inputs: declarationInputs(node, language), parent, anchor: { path, side, startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1, signature: label } };
      if (language === "kotlin" && node.type === "property_declaration") {
        nextParent.scope = ["class_body", "enum_class_body"].includes(node.parent?.type ?? "") ? "member" : node.parent?.type === "source_file" ? "top-level" : "local";
      }
      declarations.push(nextParent);
      nextOwners = [...owners, parts.name.text];
    }
    for (const child of children(node, true)) walk(child, nextOwners, nextParent);
  };
  walk(tree.rootNode, []);
  return { declarations, syntax };
}

function compareDeclarations(before: Declaration[], after: Declaration[]): SemanticChange[] {
  const changes: SemanticChange[] = [];
  const indexChildren = (declarations: Declaration[]) => {
    const index = new Map<Declaration | undefined, Declaration[]>();
    for (const declaration of declarations) {
      const siblings = index.get(declaration.parent) ?? [];
      siblings.push(declaration);
      index.set(declaration.parent, siblings);
    }
    return index;
  };
  const oldChildren = indexChildren(before), newChildren = indexChildren(after);
  const unmatched = (entry: Declaration, side: "old" | "new", ambiguous: boolean) => {
    changes.push({ name: entry.name, kind: entry.kind, ...(entry.scope ? { scope: entry.scope } : {}), categories: [side === "old" ? "removed" : "added"], ...(side === "old" ? { before: entry.anchor } : { after: entry.anchor }), ...(ambiguous ? { ambiguous: true } : {}) });
    // Without a matched parent, its children cannot establish independent identity.
    for (const child of (side === "old" ? oldChildren : newChildren).get(entry) ?? []) unmatched(child, side, ambiguous);
  };
  const compareChildren = (oldParent?: Declaration, newParent?: Declaration) => {
    const before = oldChildren.get(oldParent) ?? [], after = newChildren.get(newParent) ?? [];
    const keys = new Set([...before, ...after].map((declaration) => declaration.key));
    for (const key of keys) {
      let old = before.filter((declaration) => declaration.key === key);
      let next = after.filter((declaration) => declaration.key === key);
      const pair = (left: Declaration, right: Declaration) => {
        const categories: SemanticChange["categories"] = [];
        if (left.signature !== right.signature) categories.push("signature");
        if (left.body !== right.body) categories.push("body");
        const inputs = inputChanges(left.inputs, right.inputs);
        if (categories.length) changes.push({ name: right.name, kind: right.kind, ...(right.scope ? { scope: right.scope } : {}), categories, before: left.anchor, after: right.anchor, ...(inputs ? { inputs } : {}) });
        old = old.filter((item) => item !== left); next = next.filter((item) => item !== right);
        // Scope matching to this parent pair, even when its signature changed.
        compareChildren(left, right);
      };
      // First consume exact syntax, then unique signatures. Never pair by ordinal.
      for (const left of [...old]) {
        const exact = next.find((right) => right.signature === left.signature && right.body === left.body);
        if (exact) pair(left, exact);
      }
      for (const left of [...old]) {
        const matches = next.filter((right) => right.signature === left.signature);
        if (matches.length === 1 && old.filter((entry) => entry.signature === left.signature).length === 1) pair(left, matches[0]!);
      }
      if (old.length === 1 && next.length === 1) pair(old[0]!, next[0]!);
      const ambiguous = old.length > 0 && next.length > 0;
      for (const entry of old) unmatched(entry, "old", ambiguous);
      for (const entry of next) unmatched(entry, "new", ambiguous);
    }
  };
  compareChildren();
  return changes;
}

export async function analyseSemanticSources(file: DiffFile, before: string, after: string, identities: { beforeTree: string; afterTree?: string }): Promise<SemanticSummary> {
  const base: SemanticSummary = { path: file.path, status: "analysed", engine: SEMANTIC_ENGINE, ...identities, notice: SEMANTIC_NOTICE, message: "", changes: [], renamed: file.status === "renamed" };
  const oldLanguage = supportedLanguage(file.oldPath), newLanguage = supportedLanguage(file.newPath);
  const language = newLanguage ?? oldLanguage;
  if (!language || (file.oldPath && !oldLanguage) || (file.newPath && !newLanguage) || (oldLanguage && newLanguage && oldLanguage !== newLanguage)) return { ...base, status: "unsupported", message: "Syntax summary supports TypeScript (.ts/.mts/.cts), TSX and Kotlin (.kt/.kts). Unsupported or different before/after languages retain the text diff." };
  base.language = language;
  if ([before, after].some((source) => Buffer.byteLength(source) > SEMANTIC_LIMITS.bytes || source.split("\n").length > SEMANTIC_LIMITS.lines)) return { ...base, status: "limited", limit: "size", message: "Syntax analysis is limited to 256,000 bytes and 10,000 lines per version. Use the text diff." };
  if ([file.oldPath, file.newPath].some((path) => path && /(?:^|\/)(?:generated|__generated__)(?:\/|$)|\.generated\./i.test(path)) || [before, after].some((source) => /(?:@generated|code generated.*do not edit|auto-generated)/i.test(source.slice(0, 2048)))) return { ...base, status: "generated", message: "Generated-file marker detected; syntax summary skipped. Inspect the text diff or generator source." };
  base.beforeHash = hash(before); base.afterHash = hash(after);
  let parser: Parser | undefined;
  const trees: Tree[] = [];
  try {
    parser = await languageParser(language);
    for (const [index, source] of [before, after].entries()) {
      const deadline = performance.now() + SEMANTIC_LIMITS.parseMicros / 1000;
      const tree = parser.parse(source, null, { progressCallback: () => performance.now() > deadline });
      if (!tree) return { ...base, status: "limited", limit: "time", message: "Parser time limit reached; use the text diff." };
      trees.push(tree);
      if (tree.rootNode.hasError) {
        const errors = tree.rootNode.descendantsOfType("ERROR");
        return { ...base, status: "parse-error", message: `${index === 0 ? "Before" : "After"} source was not fully parsed${errors[0] ? ` near line ${errors[0].startPosition.row + 1}` : ""}. This may be invalid or newer syntax unsupported by the bundled grammar. No structural claims are made; use the text diff.` };
      }
    }
    const old = inspectTree(trees[0]!, language, file.oldPath ?? file.path, "old");
    const next = inspectTree(trees[1]!, language, file.newPath ?? file.path, "new");
    const changes = compareDeclarations(old.declarations, next.declarations);
    const message = changes.length ? `${changes.length} declaration change${changes.length === 1 ? "" : "s"}. Body includes initializer/member syntax; enclosing and nested declarations can both be listed.` : old.syntax === next.syntax ? (before === after ? "No syntax change detected (the file may have moved or changed metadata)." : "Only comments or formatting changed in the parsed syntax. This is not proof of behavioural equivalence.") : "No supported declaration change detected. Other syntax changed; inspect imports, expressions and the text diff.";
    return { ...base, message: message + (changes.length > SEMANTIC_LIMITS.changes ? ` Showing the first ${SEMANTIC_LIMITS.changes}.` : ""), changes: changes.slice(0, SEMANTIC_LIMITS.changes), totalChanges: changes.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "parser failed";
    const limited = /limit/.test(message);
    return { ...base, status: limited ? "limited" : "unavailable", ...(limited ? { limit: "complexity" as const } : {}), message: `Syntax analysis unavailable: ${message}. Text diff remains available.` };
  } finally { trees.forEach((tree) => tree.delete()); parser?.delete(); }
}

// Derived data only: never persisted into authored evidence or reused across comparisons.
const cache = new WeakMap<GitComparison, Map<string, SemanticSummary>>();
function cacheKey(comparison: GitComparison, file: DiffFile): string {
  return hash(JSON.stringify([SEMANTIC_ENGINE, comparison.repositoryRoot, comparison.mergeBase, comparison.sourceTree, file]));
}
export function cachedSemanticSummaries(comparison: GitComparison): SemanticSummary[] {
  const entries = cache.get(comparison);
  return comparison.files.flatMap((file) => { const entry = entries?.get(cacheKey(comparison, file)); return entry ? [entry] : []; });
}
const inFlight = new WeakMap<GitComparison, Map<string, Promise<SemanticSummary>>>();
let activeRequests = 0;
export function semanticDiffForFile(comparison: GitComparison, path: string): Promise<SemanticSummary> {
  const file = comparison.files.find((entry) => entry.path === path);
  if (!file) return Promise.reject(new Error("Changed file does not exist in this comparison."));
  const key = cacheKey(comparison, file);
  const cached = cache.get(comparison)?.get(key);
  if (cached) return Promise.resolve(cached);
  let pending = inFlight.get(comparison);
  const existing = pending?.get(key);
  if (existing) return existing;
  if (activeRequests >= SEMANTIC_LIMITS.requests) return Promise.resolve({ path, status: "unavailable", engine: SEMANTIC_ENGINE, beforeTree: comparison.mergeBase, afterTree: comparison.sourceTree, notice: SEMANTIC_NOTICE, message: "Four syntax analyses are already running. Retry when one completes; the text diff remains available.", changes: [], renamed: file.status === "renamed" });
  if (!pending) { pending = new Map(); inFlight.set(comparison, pending); }
  activeRequests++;
  const result = computeSemanticDiff(comparison, path).finally(() => { activeRequests--; pending!.delete(key); });
  pending.set(key, result);
  return result;
}
async function computeSemanticDiff(comparison: GitComparison, path: string): Promise<SemanticSummary> {
  const file = comparison.files.find((file) => file.path === path);
  if (!file) throw new Error("Changed file does not exist in this comparison.");
  const key = cacheKey(comparison, file);
  const found = cache.get(comparison)?.get(key);
  if (found) return found;
  const identities = { beforeTree: comparison.mergeBase, afterTree: comparison.sourceTree };
  const captured = { ...comparison, files: [structuredClone(file)] };
  let result = await analyseSemanticSources(captured.files[0]!, "", "", identities);
  if (result.status !== "unsupported") {
    try {
      if (!captured.sourceTree) throw new Error("Captured after source is unavailable. Refresh the review to capture both versions.");
      const before = await capturedComparisonSource(captured, path, "old", SEMANTIC_LIMITS.bytes);
      const after = await capturedComparisonSource(captured, path, "new", SEMANTIC_LIMITS.bytes);
      await validateCapturedFileDiff(captured, path);
      result = await analyseSemanticSources(captured.files[0]!, before, after, identities);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Captured source unavailable.";
      result = { ...result, beforeHash: undefined, afterHash: undefined, status: /limit/.test(detail) ? "limited" : "unavailable", ...(/limit/.test(detail) ? { limit: "size" as const } : {}), message: detail + " Text diff remains available.", changes: [] };
    }
  }
  // Failures are retryable; no poisoned parser/source cache.
  if (result.status !== "unavailable" && key === cacheKey(comparison, file)) {
    let entries = cache.get(comparison);
    if (!entries) { entries = new Map(); cache.set(comparison, entries); }
    if (entries.size >= SEMANTIC_LIMITS.cachedFiles) entries.delete(entries.keys().next().value!);
    entries.set(key, result);
  }
  return result;
}
