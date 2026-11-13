import type { Node, Parser } from "web-tree-sitter";
import { kotlinLexicalDeclaration } from "./kotlin-references.ts";
import { languageParser, SEMANTIC_LIMITS } from "./semantic-diff.ts";
import { parseWithin } from "./syntax-nodes.ts";

// This is a bounded source index, not a compiler: no Gradle, generated sources,
// dependency jars, receiver inference or expect/actual source-set selection.
const LIMITS = { files: 500, bytes: 8 * 1024 * 1024, millis: 2500, usages: 49 };
const typeDeclarations = new Set(["class_declaration", "object_declaration", "type_alias"]);
const scopeTypes = new Set(["source_file", "statements", "function_declaration", "lambda_literal", "class_declaration", "object_declaration", "object_literal", "companion_object"]);
interface Location { path: string; line: number }
interface Definition extends Location { qualified: string; private: boolean }
interface Import { qualified: string; name: string; star: boolean }
interface Blocker { name: string; start: number; end: number; from: number; type: boolean; target?: string }
interface Occurrence extends Location {
  name: string; column: number; endColumn: number; parts: string[];
  direct?: string; blocked: boolean; type: boolean; declaration: boolean;
}
interface Source {
  path: string; packageName: string; imports: Import[]; definitions: Definition[];
  occurrences: Occurrence[]; values: string[]; partial: boolean;
}
export interface KotlinTypeReferences {
  definition: Location; usages: Location[]; truncated: boolean; partial: boolean;
}
let active = 0;
const nameOf = (node: Node) => node.text.replace(/^`|`$/g, "");
const qualify = (parent: string, name: string) => parent ? `${parent}.${name}` : name;

function ancestor(node: Node | null, predicate: (node: Node) => boolean): Node | undefined {
  for (let current = node; current; current = current.parent) if (predicate(current)) return current;
}

function scope(node: Node): Node | undefined {
  return ancestor(node.parent, candidate => scopeTypes.has(candidate.type));
}

function importInfo(header: Node): Import | undefined {
  if (header.hasError) return;
  const identifier = header.namedChildren.find(child => child?.type === "identifier");
  if (!identifier) return;
  const parts = identifier.namedChildren.filter((child): child is Node => child?.type === "simple_identifier").map(nameOf);
  const alias = header.namedChildren.find(child => child?.type === "import_alias")?.namedChild(0);
  return { qualified: parts.join("."), name: alias ? nameOf(alias) : parts.at(-1)!, star: header.namedChildren.some(child => child?.type === "wildcard_import") };
}

function navigationParts(node: Node): string[] | undefined {
  if (node.type === "simple_identifier") return [nameOf(node)];
  if (node.type !== "navigation_expression") return;
  const receiver = node.namedChild(0), suffix = node.namedChild(1);
  if (!receiver || suffix?.type !== "navigation_suffix" || suffix.child(0)?.text !== "." || suffix.namedChild(0)?.type !== "simple_identifier") return;
  const prefix = navigationParts(receiver);
  return prefix ? [...prefix, nameOf(suffix.namedChild(0)!)] : undefined;
}

function parseSource(parser: Parser, path: string, content: string): Source | undefined {
  if (Buffer.byteLength(content) > SEMANTIC_LIMITS.bytes || content.split("\n").length > SEMANTIC_LIMITS.lines) return;
  const tree = parseWithin(parser, content, SEMANTIC_LIMITS.parseMicros);
  if (!tree) return;
  try {
    const root = tree.rootNode;
    const packageHeader = root.namedChildren.find(child => child?.type === "package_header");
    if (packageHeader?.hasError) return;
    const packageName = packageHeader?.namedChild(0)?.namedChildren.filter((child): child is Node => child?.type === "simple_identifier").map(nameOf).join(".") ?? "";
    const source: Source = { path, packageName, imports: [], definitions: [], occurrences: [], values: [], partial: root.hasError };
    const nodes: Node[] = [], blockers: Blocker[] = [];
    const stack = [{ node: root, depth: 0 }];
    let visited = 0;
    while (stack.length) {
      const { node, depth } = stack.pop()!;
      if (++visited > SEMANTIC_LIMITS.nodes || depth > SEMANTIC_LIMITS.depth) return;
      if (node.type === "import_header") {
        const entry = importInfo(node);
        if (entry) source.imports.push(entry);
      }
      if (node.type === "simple_identifier" || node.type === "type_identifier") nodes.push(node);
      for (const child of node.namedChildren) if (child) stack.push({ node: child, depth: depth + 1 });
    }
    for (const node of nodes) {
      const parent = node.parent!;
      const name = nameOf(node);
      if (typeDeclarations.has(parent.type) && parent.namedChildren.find(child => child?.type === "type_identifier" || child?.type === "simple_identifier")?.id === node.id) {
        const owner = scope(parent);
        if (!owner) continue;
        const target = owner.type === "source_file" ? qualify(packageName, name) : undefined;
        blockers.push({ name, start: owner.startIndex, end: owner.endIndex, from: owner.type === "statements" ? parent.startIndex : 0, type: true, target });
        if (target) source.definitions.push({ path, line: node.startPosition.row + 1, qualified: target, private: parent.namedChildren.some(child => child?.type === "modifiers" && /\bprivate\b/.test(child.text)) });
      } else if (parent.type === "type_parameter") {
        const owner = parent.parent?.parent;
        if (owner) blockers.push({ name, start: owner.startIndex, end: owner.endIndex, from: 0, type: true });
      } else if (node.type === "simple_identifier") {
        const value = kotlinLexicalDeclaration(node);
        if (!value) continue;
        blockers.push({ name, start: value.scope.startIndex, end: value.scope.endIndex, from: value.visibleFrom, type: false });
        if (value.scope.type === "source_file") source.values.push(qualify(packageName, name));
      }
    }
    const blockersByName = new Map<string, Blocker[]>();
    for (const block of blockers) {
      const entries = blockersByName.get(block.name) ?? [];
      entries.push(block);
      blockersByName.set(block.name, entries);
    }
    for (const node of nodes) {
      const parent = node.parent!;
      if (ancestor(node, current => current.type === "ERROR" || current.isMissing)) continue;
      const name = nameOf(node);
      let parts = [name], direct: string | undefined, declaration = false;
      const type = node.type === "type_identifier";
      const header = ancestor(parent, current => current.type === "import_header");
      if (header) {
        const info = importInfo(header);
        const identifier = header.namedChildren.find(child => child?.type === "identifier");
        if (!info || info.star || (identifier?.lastNamedChild?.id !== node.id && parent.type !== "import_alias")) continue;
        direct = info.qualified;
      } else if (typeDeclarations.has(parent.type) && source.definitions.some(def => def.qualified === qualify(packageName, name) && def.line === node.startPosition.row + 1)) {
        direct = qualify(packageName, name);
        declaration = true;
      } else if (type && parent.type === "user_type") {
        const prefix = parent.namedChildren.filter((child): child is Node => !!child && child.endIndex <= node.endIndex);
        if (prefix.some(child => child.type !== "type_identifier")) continue; // Nested generic receivers need type resolution.
        parts = prefix.map(nameOf);
      } else if (type && parent.type === "callable_reference") {
        if (parent.namedChildCount !== 1) continue;
      } else if (node.type === "simple_identifier") {
        if (parent.type === "navigation_suffix") {
          const navigation = parent.parent;
          parts = navigation ? navigationParts(navigation) ?? [] : [];
          if (!parts.length) continue;
        } else if (!((parent.type === "call_expression" || parent.type === "navigation_expression") && parent.namedChild(0)?.id === node.id)
          && !(parent.type === "callable_reference" && parent.namedChildCount === 1)) continue;
      } else continue;
      if (!direct && ancestor(parent, current => ["property_declaration", "function_declaration"].includes(current.type) && current.hasError)) continue;
      const local = (blockersByName.get(parts[0]!) ?? []).filter(block => block.start <= node.startIndex && node.endIndex <= block.end && block.from <= node.startIndex && (!type || block.type));
      // A top-level type is a candidate; all other lexical bindings shadow it.
      const blocked = !direct && local.some(block => !block.target);
      source.occurrences.push({ path, name, line: node.startPosition.row + 1, column: node.startPosition.column + 1, endColumn: node.endPosition.column + 1, parts, direct, blocked, type, declaration });
    }
    return source;
  } finally { tree.delete(); }
}

/** Resolve top-level Kotlin types from current workspace syntax and imports. */
export async function kotlinTypeReferences(
  paths: readonly string[], read: (path: string) => Promise<string>,
  request: { path: string; symbol: string; line: number; column?: number },
): Promise<{ result?: KotlinTypeReferences; notice?: string }> {
  if (active >= SEMANTIC_LIMITS.requests) return { notice: "Built-in Kotlin lookup is busy; try again." };
  active++;
  let parser: Parser | undefined;
  try {
    parser = await languageParser("kotlin");
    const selectedContent = await read(request.path);
    const selected = parseSource(parser, request.path, selectedContent);
    const positions = selected?.occurrences.filter(node => node.name === request.symbol && node.line === request.line && (request.column === undefined || (node.column <= request.column && request.column < node.endColumn))) ?? [];
    if (!selected || positions.length !== 1 || positions[0]!.blocked) return {};
    const position = positions[0]!;
    const sources = [selected];
    let bytes = Buffer.byteLength(selectedContent), count = 1, truncated = false, partial = selected.partial;
    const deadline = performance.now() + LIMITS.millis;
    // Filter before spending the budget: PNGs and other non-Kotlin assets must
    // not crowd out declarations. Prefer the likely declaration filename.
    const imported = selected.imports.find(entry => !entry.star && entry.name === request.symbol);
    const likelyName = (position.direct ?? imported?.qualified ?? request.symbol).split(".").at(-1)!;
    const candidates = [...new Set(paths)].filter(path => /\.kts?$/i.test(path) && path !== request.path)
      .sort((a, b) => Number(b.split("/").at(-1) === `${likelyName}.kt`) - Number(a.split("/").at(-1) === `${likelyName}.kt`));
    for (const path of candidates) {
      if (count >= LIMITS.files || bytes >= LIMITS.bytes || performance.now() >= deadline) { truncated = true; break; }
      count++;
      let content: string;
      try { content = await read(path); } catch { partial = true; continue; }
      bytes += Buffer.byteLength(content);
      if (bytes > LIMITS.bytes) { truncated = true; break; }
      const source = parseSource(parser, path, content);
      if (!source) { partial = true; continue; }
      sources.push(source);
      partial ||= source.partial;
    }
    const definitions = new Map<string, Definition[]>();
    const values = new Set(sources.flatMap(source => source.values));
    for (const source of sources) for (const def of source.definitions) definitions.set(def.qualified, [...(definitions.get(def.qualified) ?? []), def]);
    const lookup = (qualified: string, source: Source, occurrence: Occurrence): Definition | undefined => {
      const matches = (definitions.get(qualified) ?? []).filter(def => !def.private || def.path === source.path);
      if (matches.length !== 1 || (!occurrence.type && !occurrence.direct && values.has(qualified))) return;
      return matches[0];
    };
    const resolve = (source: Source, occurrence: Occurrence): Definition | undefined => {
      if (occurrence.blocked) return;
      if (occurrence.direct) return lookup(occurrence.direct, source, occurrence);
      if (occurrence.parts.length > 1) return lookup(occurrence.parts.join("."), source, occurrence);
      const imports = source.imports.filter(entry => !entry.star && entry.name === occurrence.name);
      if (imports.length) return imports.length === 1 ? lookup(imports[0]!.qualified, source, occurrence) : undefined;
      const samePackage = qualify(source.packageName, occurrence.name);
      // An alias removes the original unqualified name, including in its own package.
      if (source.imports.some(entry => !entry.star && entry.qualified === samePackage && entry.name !== occurrence.name)) return;
      if (definitions.has(samePackage) || (!occurrence.type && values.has(samePackage))) return lookup(samePackage, source, occurrence);
      const stars = source.imports.filter(entry => entry.star);
      // Multiple wildcard scopes may contain dependency types outside this index.
      return stars.length === 1 ? lookup(qualify(stars[0]!.qualified, occurrence.name), source, occurrence) : undefined;
    };
    const target = resolve(selected, position);
    if (!target) return { notice: "Built-in Kotlin lookup could not identify a unique top-level type from packages and imports; the name may be ambiguous or require compiler resolution." };
    const usages = new Map<string, Location>();
    for (const source of sources) for (const occurrence of source.occurrences) {
      if (occurrence.declaration || resolve(source, occurrence) !== target) continue;
      usages.set(`${occurrence.path}:${occurrence.line}`, { path: occurrence.path, line: occurrence.line });
    }
    const locations = [...usages.values()].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
    return { result: { definition: { path: target.path, line: target.line }, usages: locations.slice(0, LIMITS.usages), truncated: truncated || locations.length > LIMITS.usages, partial } };
  } catch {
    return { notice: "Built-in Kotlin lookup could not parse the selected source." };
  } finally {
    parser?.delete();
    active--;
  }
}
