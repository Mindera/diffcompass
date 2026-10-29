import { posix } from "node:path";
import type { Node } from "web-tree-sitter";
import { listCapturedTree, readCapturedBlobs, type CapturedTreeEntry } from "./captured-tree.ts";
import type { GitComparison } from "./types.ts";

export type ImportTarget = { kind: "file"; path: string } | { kind: "files"; paths: string[]; partial: boolean } | { kind: "external"; name: string } | { kind: "unresolved"; reason: string };
export interface ImportFact { analysis: "tree-sitter imports"; side: "old" | "new"; startLine: number; endLine: number; specifier: string; changed: boolean; target: ImportTarget }
export interface TreeModules { files: ReadonlySet<string>; workspacePackages: ReadonlySet<string>; aliasPatterns: readonly string[]; baseUrls: readonly string[]; relativeOptions: readonly string[]; complete: boolean; reason?: string }

const MANIFEST_LIMIT = 500, TSCONFIG_LIMIT = 100, CONFIG_BYTES = 256_000;
const TSCONFIG_PATH = /(?:^|\/)tsconfig[^/]*\.json$/;
const JAVASCRIPT_EXTENSION = /\.(?:js|jsx|mjs|cjs)$/;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const PACKAGE_NAME = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function readConfigs(comparison: GitComparison, selected: readonly CapturedTreeEntry[], failures: string[]): Promise<Array<[string, string]>> {
  const readable: CapturedTreeEntry[] = [];
  for (const entry of selected) {
    if (entry.size <= CONFIG_BYTES) readable.push(entry);
    else failures.push(`${entry.path} is over ${CONFIG_BYTES.toLocaleString("en-US")} bytes`);
  }
  let texts: Map<string, string | null>;
  try { texts = await readCapturedBlobs(comparison, readable.map((entry) => entry.oid)); }
  catch { failures.push("package.json and tsconfig files could not be read"); return []; }
  return readable.flatMap((entry): Array<[string, string]> => {
    const text = texts.get(entry.oid);
    if (typeof text === "string") return [[entry.path, text]];
    failures.push(`${entry.path} is unreadable`);
    return [];
  });
}

function extendedConfig(from: string, value: unknown, files: ReadonlySet<string>): string | null {
  if (typeof value !== "string" || (!value.startsWith("./") && !value.startsWith("../"))) return null;
  const joined = posix.normalize(posix.join(posix.dirname(from), value));
  const path = posix.extname(joined) ? joined : `${joined}.json`;
  return files.has(path) ? path : null;
}

export async function loadTreeModules(comparison: GitComparison, side: "old" | "new"): Promise<TreeModules> {
  const entries = await listCapturedTree(comparison, side);
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  const files = new Set(byPath.keys());
  const failures: string[] = [];
  const workspacePackages = new Set<string>(), aliasPatterns = new Set<string>(), baseUrls = new Set<string>(), relativeOptions = new Set<string>();

  const manifests = entries.filter((entry) => posix.basename(entry.path) === "package.json");
  if (manifests.length > MANIFEST_LIMIT) failures.push(`more than ${MANIFEST_LIMIT} package.json files`);
  for (const [path, text] of await readConfigs(comparison, manifests.slice(0, MANIFEST_LIMIT), failures)) {
    let manifest: unknown;
    try { manifest = JSON.parse(text); } catch { failures.push(`${path} does not parse`); continue; }
    const name = record(manifest).name;
    if (typeof name === "string") workspacePackages.add(name);
  }

  const read = new Set<string>();
  let pending = entries.filter((entry) => TSCONFIG_PATH.test(entry.path)).map((entry) => entry.path);
  while (pending.length) {
    const batch = [...new Set(pending)].filter((path) => !read.has(path));
    pending = [];
    const room = TSCONFIG_LIMIT - read.size;
    if (batch.length > room) failures.push(`more than ${TSCONFIG_LIMIT} tsconfig files`);
    const selected = batch.slice(0, Math.max(0, room));
    for (const path of selected) read.add(path);
    for (const [path, text] of await readConfigs(comparison, selected.map((path) => byPath.get(path)!), failures)) {
      let config: unknown;
      try { config = Bun.JSONC.parse(text); } catch { failures.push(`${path} does not parse`); continue; }
      const options = record(record(config).compilerOptions);
      for (const pattern of Object.keys(record(options.paths))) aliasPatterns.add(pattern);
      if (typeof options.baseUrl === "string") baseUrls.add(posix.normalize(posix.join(posix.dirname(path), options.baseUrl)));
      const suffixes = options.moduleSuffixes;
      if (suffixes !== undefined && !(Array.isArray(suffixes) && suffixes.length === 1 && suffixes[0] === "")) relativeOptions.add("moduleSuffixes");
      if (Array.isArray(options.rootDirs) && options.rootDirs.length) relativeOptions.add("rootDirs");
      const extended = record(config).extends;
      for (const value of extended === undefined ? [] : Array.isArray(extended) ? extended : [extended]) {
        const followed = extendedConfig(path, value, files);
        if (followed) pending.push(followed);
        else failures.push(`${path} extends ${JSON.stringify(value)}, which cannot be followed`);
      }
    }
  }

  return {
    files, workspacePackages, aliasPatterns: [...aliasPatterns], baseUrls: [...baseUrls], relativeOptions: [...relativeOptions],
    complete: !failures.length, ...(failures.length ? { reason: `package and alias index incomplete: ${failures[0]}` } : {}),
  };
}

function stringText(node: Node | null | undefined): string | null {
  if (node?.type !== "string" || node.namedChildCount !== 1) return null;
  const fragment = node.namedChild(0);
  return fragment?.type === "string_fragment" ? fragment.text : null;
}

function typescriptSpecifier(node: Node): string | null {
  if (node.type === "import_statement" || node.type === "export_statement") return stringText(node.childForFieldName("source"));
  if (node.type !== "call_expression" || node.childForFieldName("function")?.type !== "import") return null;
  const args = node.childForFieldName("arguments");
  return args?.namedChildCount === 1 ? stringText(args.namedChild(0)) : null;
}

function importFact(node: Node, side: "old" | "new", specifier: string, changedLines: ReadonlySet<number>, target: ImportTarget): ImportFact {
  const startLine = node.startPosition.row + 1, endLine = node.endPosition.row + 1;
  let changed = false;
  for (let line = startLine; line <= endLine && !changed; line++) changed = changedLines.has(line);
  return { analysis: "tree-sitter imports", side, startLine, endLine, specifier, changed, target };
}

export function typescriptImports(root: Node, path: string, side: "old" | "new", changedLines: ReadonlySet<number>, modules: TreeModules): ImportFact[] {
  const facts: ImportFact[] = [];
  const stack: Node[] = [root];
  while (stack.length) {
    const node = stack.pop()!;
    const specifier = typescriptSpecifier(node);
    if (specifier !== null) facts.push(importFact(node, side, specifier, changedLines, resolveTypescriptSpecifier(specifier, path, modules)));
    for (let i = node.childCount - 1; i >= 0; i--) stack.push(node.child(i)!);
  }
  return facts;
}

const unresolved = (reason: string): ImportTarget => ({ kind: "unresolved", reason });
const moduleCandidates = (target: string) => [target, `${target}.ts`, `${target}.tsx`, posix.join(target, "index.ts"), posix.join(target, "index.tsx")];

function relativeTarget(specifier: string, fromPath: string, modules: TreeModules): ImportTarget {
  if (JAVASCRIPT_EXTENSION.test(specifier)) return unresolved("JavaScript extension substitution is not implemented");
  if (modules.relativeOptions.length) return unresolved(`tsconfig ${modules.relativeOptions[0]} changes relative resolution`);
  const target = posix.normalize(posix.join(posix.dirname(fromPath), specifier));
  if (target === ".." || target.startsWith("../")) return unresolved("outside the repository");
  if (modules.files.has(posix.join(target, "package.json"))) return unresolved("directory has its own package.json");
  const found = moduleCandidates(target).filter((path) => modules.files.has(path));
  if (found.length === 1) return { kind: "file", path: found[0] };
  return unresolved(found.length ? "more than one matching file" : "no matching file in the captured tree");
}

export function resolveTypescriptSpecifier(specifier: string, fromPath: string, modules: TreeModules): ImportTarget {
  if (specifier === "." || specifier === ".." || specifier.startsWith("./") || specifier.startsWith("../")) return relativeTarget(specifier, fromPath, modules);
  if (specifier.startsWith("/")) return unresolved("absolute specifier");
  if (specifier.startsWith("node:") || specifier.startsWith("bun:")) return { kind: "external", name: specifier };
  if (SCHEME.test(specifier)) return unresolved("unsupported specifier scheme");
  if (modules.aliasPatterns.some((pattern) => pattern.includes("*") ? specifier.startsWith(pattern.slice(0, pattern.indexOf("*"))) : specifier === pattern)) return unresolved("tsconfig paths alias");
  if (modules.baseUrls.some((base) => moduleCandidates(posix.join(base, specifier)).some((path) => modules.files.has(path)))) return unresolved("tsconfig baseUrl path");
  const name = specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/");
  if (!PACKAGE_NAME.test(name)) return unresolved("not a package name");
  if (modules.workspacePackages.has(name)) return unresolved("workspace package");
  if (!modules.complete) return unresolved(modules.reason ?? "package and alias index incomplete");
  return { kind: "external", name };
}
