import type { Node, Parser, Tree } from "web-tree-sitter";
import { declarationParts, type SyntaxLanguage } from "./semantic-diff.ts";

function typeScriptCallee(callee: Node | null): Node | undefined {
  if (!callee) return;
  if (callee.type === "identifier") return callee;
  if (callee.type === "member_expression") return callee.childForFieldName("property") ?? undefined;
}

export function calledName(node: Node, language: SyntaxLanguage): Node | undefined {
  if (language !== "kotlin") {
    if (node.type === "call_expression") return typeScriptCallee(node.childForFieldName("function"));
    if (node.type === "new_expression") return typeScriptCallee(node.childForFieldName("constructor"));
    return;
  }
  if (node.type !== "call_expression") return;
  const callee = node.namedChild(0);
  if (!callee) return;
  if (callee.type === "simple_identifier") return callee;
  if (callee.type !== "navigation_expression") return;
  const suffix = callee.children.filter((child) => child?.type === "navigation_suffix").at(-1);
  return suffix?.children.find((child) => child?.type === "simple_identifier") ?? undefined;
}

export function enclosingName(node: Node, language: SyntaxLanguage): string | null {
  const names: string[] = [];
  for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
    const parts = declarationParts(ancestor, language);
    if (parts) names.unshift(parts.name.text);
  }
  return names.length ? names.join(".") : null;
}

export function parseWithin(parser: Parser, source: string, micros: number): Tree | null {
  const deadline = performance.now() + micros / 1000;
  const tree = parser.parse(source, null, { progressCallback: () => performance.now() > deadline });
  if (!tree) parser.reset();
  return tree;
}
