import type { Node } from "web-tree-sitter";
import { languageParser, SEMANTIC_LIMITS } from "./semantic-diff.ts";
import { parseWithin } from "./syntax-nodes.ts";

export interface KotlinReferences {
  definition: number;
  usages: number[];
  truncated: boolean;
  partial: boolean;
}

interface Declaration {
  name: Node;
  scope: Node;
  visibleFrom: number;
  member: boolean;
  supported: boolean;
}

const classes = new Set(["class_declaration", "object_declaration", "object_literal", "companion_object"]);
const scopes = new Set(["source_file", "statements", "function_declaration", "lambda_literal", "for_statement", "catch_block", "when_expression", ...classes]);
let active = 0;

function ancestor(node: Node | null, predicate: (node: Node) => boolean): Node | undefined {
  for (let current = node; current; current = current.parent) if (predicate(current)) return current;
}

function enclosingScope(node: Node): Node | undefined {
  return ancestor(node.parent, candidate => scopes.has(candidate.type));
}

function parsedContext(node: Node): boolean {
  for (let current: Node | null = node; current && !classes.has(current.type) && current.type !== "source_file"; current = current.parent) {
    if (current.type === "ERROR" || current.isMissing || (["property_declaration", "function_declaration"].includes(current.type) && current.hasError)) return false;
  }
  return true;
}

export function kotlinLexicalDeclaration(name: Node): Declaration | undefined {
  const parent = name.parent;
  if (!parent) return;
  let scope: Node | undefined;
  let visibleFrom = 0;
  let member = false;
  let supported = parsedContext(name);
  if (parent.type === "variable_declaration") {
    const owner = parent.parent?.type === "multi_variable_declaration" ? parent.parent.parent : parent.parent;
    if (owner?.type === "property_declaration") {
      scope = enclosingScope(owner);
      member = !!scope && classes.has(scope.type);
      visibleFrom = scope?.type === "source_file" || member ? 0 : owner.endIndex;
      // Extension properties need receiver type resolution.
      supported &&= !owner.namedChildren.some(child => child?.type === "user_type");
    } else if (owner?.type === "lambda_parameters") {
      scope = ancestor(owner.parent, node => node.type === "lambda_literal");
    } else if (owner?.type === "for_statement") {
      scope = owner;
      visibleFrom = owner.namedChildren.find(child => child?.type === "control_structure_body")?.startIndex ?? owner.endIndex;
    } else if (owner?.type === "when_subject") {
      scope = owner.parent ?? undefined;
      visibleFrom = owner.endIndex;
    }
  } else if (parent.type === "parameter" && parent.parent?.type === "function_value_parameters") {
    scope = ancestor(parent.parent.parent, node => node.type === "function_declaration");
  } else if (parent.type === "class_parameter") {
    scope = ancestor(parent.parent, node => classes.has(node.type));
    member = parent.namedChildren.some(child => child?.type === "binding_pattern_kind");
  } else if (parent.type === "catch_block") {
    scope = parent;
  } else if (parent.type === "function_declaration") {
    scope = enclosingScope(parent);
    member = !!scope && classes.has(scope.type);
    visibleFrom = scope?.type === "source_file" || member ? 0 : parent.startIndex;
    supported &&= !parent.namedChildren.some(child => child && child.endIndex <= name.startIndex && ["user_type", "nullable_type", "function_type"].includes(child.type));
  }
  return scope ? { name, scope, visibleFrom, member, supported } : undefined;
}

function reference(node: Node): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (parent.type === "value_argument" && parent.children.some(child => child?.type === "=" && child.startIndex > node.endIndex)) return false;
  return !ancestor(parent, candidate => ["import_header", "package_header", "label", "annotation", "callable_reference"].includes(candidate.type));
}

/** Same-file lexical candidates, not compiler/type resolution. No project import or subprocess. */
export async function kotlinReferences(content: string, symbol: string, line: number, column?: number): Promise<KotlinReferences | undefined> {
  if (active >= SEMANTIC_LIMITS.requests || Buffer.byteLength(content) > SEMANTIC_LIMITS.bytes || content.split("\n").length > SEMANTIC_LIMITS.lines) return;
  active++;
  let parser: Awaited<ReturnType<typeof languageParser>> | undefined;
  let tree: ReturnType<typeof parseWithin> = null;
  try {
    parser = await languageParser("kotlin");
    tree = parseWithin(parser, content, SEMANTIC_LIMITS.parseMicros);
    if (!tree) return;
    const identifiers: Node[] = [];
    const stack = [{ node: tree.rootNode, depth: 0 }];
    let visited = 0;
    while (stack.length) {
      const { node, depth } = stack.pop()!;
      if (++visited > SEMANTIC_LIMITS.nodes || depth > SEMANTIC_LIMITS.depth) return;
      if (["simple_identifier", "interpolated_identifier"].includes(node.type) && node.text.replace(/^`|`$/g, "") === symbol) identifiers.push(node);
      for (const child of node.namedChildren) if (child) stack.push({ node: child, depth: depth + 1 });
    }
    const candidates = identifiers.filter(node => node.startPosition.row === line - 1 && (column === undefined || (node.startPosition.column <= column - 1 && column - 1 < node.endPosition.column)));
    if (candidates.length !== 1) return;
    const selected = candidates[0]!;
    const declarations = identifiers.map(kotlinLexicalDeclaration).filter((value): value is Declaration => !!value);
    const byName = new Map(declarations.map(value => [value.name.id, value]));
    const byScope = new Map<number, Declaration[]>();
    for (const value of declarations) byScope.set(value.scope.id, [...(byScope.get(value.scope.id) ?? []), value]);
    const inScope = (scope: Node, node: Node, membersOnly = false) => {
      const matches = (byScope.get(scope.id) ?? []).filter(value => value.visibleFrom <= node.startIndex && (!membersOnly || value.member));
      // Keep overloads and duplicate declarations ambiguous instead of joining them.
      return matches.length === 1 && matches[0]!.supported ? matches[0] : undefined;
    };
    const binding = (node: Node): Declaration | undefined => {
      const own = byName.get(node.id);
      if (own) return own.supported && (byScope.get(own.scope.id)?.length === 1) ? own : undefined;
      if (!parsedContext(node) || !reference(node)) return;
      if (node.parent?.type === "navigation_suffix") {
        const navigation = node.parent.parent;
        const receiver = navigation?.namedChild(0);
        if (receiver?.type !== "this_expression" || receiver.text !== "this") return;
        const scope = ancestor(navigation?.parent ?? null, current => classes.has(current.type));
        return scope ? inScope(scope, node, true) : undefined;
      }
      for (let scope = enclosingScope(node); scope; scope = enclosingScope(scope)) {
        if (byScope.get(scope.id)?.some(value => value.visibleFrom <= node.startIndex)) return inScope(scope, node);
      }
    };
    const target = binding(selected);
    if (!target) return;
    const usages = [...new Set(identifiers.filter(node => node.id !== target.name.id && binding(node)?.name.id === target.name.id).map(node => node.startPosition.row + 1))].sort((a, b) => a - b);
    return { definition: target.name.startPosition.row + 1, usages: usages.slice(0, 49), truncated: usages.length > 49, partial: tree.rootNode.hasError };
  } catch {
    return; // Unavailable parser/grammar uses the existing labelled text fallback.
  } finally {
    tree?.delete();
    parser?.delete();
    active--;
  }
}
