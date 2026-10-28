import { copyFile, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Node, Parser } from "web-tree-sitter";
import { CAPTURED_BLOBS_TIMEOUT, listCapturedTree, readCapturedBlobs, type CapturedTreeEntry } from "./captured-tree.ts";
import { declarationParts, languageParser, SEMANTIC_LIMITS, supportedLanguage, type SyntaxLanguage } from "./semantic-diff.ts";
import { calledName, parseWithin } from "./syntax-nodes.ts";
import type { FileChangeFacts } from "./change-facts.ts";
import { runProcess } from "./process.ts";
import type { GitComparison } from "./types.ts";

export interface ScanLimits { files: number; bytes: number; millis: number }
export interface CallSite { name: string; path: string; line: number; enclosing: string | null }
export interface ScanCoverage { side: "old" | "new"; totalFiles: number; scannedFiles: number; scannedBytes: number; skippedFiles: number; parseErrorFiles: number; stoppedBy?: "files" | "bytes" | "time"; message: string }
export interface TreeScan { coverage: ScanCoverage; callSites: Map<string, CallSite[]> }

const BATCH = 100;
const CLOCK_INTERVAL = 1_000;
const LIMIT_WORDS = { files: "file", bytes: "byte", time: "time" } as const;
// 4x the largest full scan measured 2026-10-28: FPR 1c7a5614 710 files 1825718 bytes 630 ms; mindera-people 17158a06 44 files 115727 bytes 64 ms; diffcompass 27b7e44 187 files 2145546 bytes 880 ms.
export const CALLER_SCAN_LIMITS: ScanLimits = { files: 3000, bytes: 9437184, millis: 5000 };

export const NAME_MATCH_LABEL = "matched by name: may miss callers or include unrelated ones with the same name";
export interface CallerDeclaration { name: string; path: string; side: "old" | "new"; startLine: number; endLine: number }
export interface CallerFact { analysis: string; provider: "name-match" | "codegraph"; declaration: CallerDeclaration; callers: CallSite[]; total: number; truncated?: true }
export const CODEGRAPH_LABEL = "CodeGraph";
export interface CodeGraphCoverage { state: "used" | "skipped"; reason?: string; declarations: number; queried: number; indexedFiles?: number }
export interface CallerCoverage { nameMatch: ScanCoverage | null; names: { searched: number; total: number }; codegraph: CodeGraphCoverage; error?: string }

const MAX_SEARCHED_NAMES = 200;
const MAX_CALLERS = 50;

export function simpleName(name: string): string {
  return name.slice(name.lastIndexOf(".") + 1);
}

export function callerDeclarations(files: readonly FileChangeFacts[]): CallerDeclaration[] {
  const declarations: CallerDeclaration[] = [];
  for (const file of files) {
    if (file.completeness.state !== "complete" && file.completeness.state !== "truncated") continue;
    for (const symbol of file.symbols) {
      const anchor = symbol.after ?? symbol.before;
      if (anchor) declarations.push({ name: symbol.name, path: anchor.path, side: anchor.side, startLine: anchor.startLine, endLine: anchor.endLine });
    }
  }
  return declarations;
}

export function searchedNames(declarations: readonly CallerDeclaration[]): { names: Set<string>; total: number } {
  const all = new Set(declarations.map((declaration) => simpleName(declaration.name)));
  return { names: new Set([...all].slice(0, MAX_SEARCHED_NAMES)), total: all.size };
}

export function nameMatchedCallers(declarations: readonly CallerDeclaration[], scan: TreeScan): CallerFact[] {
  const { names } = searchedNames(declarations);
  return declarations.filter((declaration) => names.has(simpleName(declaration.name))).map((declaration) => {
    const sites = scan.callSites.get(simpleName(declaration.name)) ?? [];
    return { analysis: NAME_MATCH_LABEL, provider: "name-match", declaration, callers: sites.slice(0, MAX_CALLERS), total: sites.length };
  });
}

interface Frame { node: Node; index: number; pushed: boolean }

export async function scanCapturedTree(comparison: GitComparison, side: "old" | "new", options: { names: ReadonlySet<string>; limits: ScanLimits; first?: readonly string[] }): Promise<TreeScan> {
  const start = performance.now();
  const { names, limits } = options;
  const candidates = (await listCapturedTree(comparison, side)).filter((entry) => supportedLanguage(entry.path));
  const byPath = new Map(candidates.map((entry) => [entry.path, entry]));
  const ordered: CapturedTreeEntry[] = [];
  const placed = new Set<string>();
  for (const path of options.first ?? []) {
    const entry = byPath.get(path);
    if (entry && !placed.has(path)) { placed.add(path); ordered.push(entry); }
  }
  for (const entry of candidates) if (!placed.has(entry.path)) ordered.push(entry);

  const callSites = new Map<string, CallSite[]>();
  let scannedFiles = 0, scannedBytes = 0, skippedFiles = 0, parseErrorFiles = 0;
  let stoppedBy: ScanCoverage["stoppedBy"];
  const parsers = new Map<SyntaxLanguage, Parser>();
  const timeUp = () => performance.now() - start >= limits.millis;

  const walk = (root: Node, language: SyntaxLanguage, path: string): CallSite[] | null => {
    const found: CallSite[] = [];
    const chain: string[] = [];
    const stack: Frame[] = [];
    const enter = (node: Node) => {
      const parts = declarationParts(node, language);
      if (parts) chain.push(parts.name.text);
      const callee = names.size && !node.hasError ? calledName(node, language) : undefined;
      if (callee && names.has(callee.text)) found.push({ name: callee.text, path, line: callee.startPosition.row + 1, enclosing: chain.length ? chain.join(".") : null });
      stack.push({ node, index: 0, pushed: Boolean(parts) });
    };
    let visited = 1;
    enter(root);
    while (stack.length) {
      const frame = stack[stack.length - 1];
      if (frame.index >= frame.node.childCount) {
        if (frame.pushed) chain.pop();
        stack.pop();
        continue;
      }
      const child = frame.node.child(frame.index++);
      if (!child) continue;
      if (++visited % CLOCK_INTERVAL === 0 && timeUp()) return null;
      enter(child);
    }
    return found;
  };

  try {
    let texts = new Map<string, string | null>();
    let loadedUntil = 0;
    for (let index = 0; index < ordered.length; index++) {
      const entry = ordered[index];
      if (!Number.isFinite(entry.size) || entry.size > SEMANTIC_LIMITS.bytes) { skippedFiles++; continue; }
      if (timeUp()) { stoppedBy = "time"; break; }
      if (scannedFiles >= limits.files) { stoppedBy = "files"; break; }
      if (scannedBytes + entry.size > limits.bytes) { stoppedBy = "bytes"; break; }
      if (index >= loadedUntil) {
        const batch = ordered.slice(index, index + BATCH);
        loadedUntil = index + batch.length;
        const remaining = Math.max(1, Math.min(30_000, Math.ceil(limits.millis - (performance.now() - start))));
        try { texts = await readCapturedBlobs(comparison, batch.filter((item) => Number.isFinite(item.size) && item.size <= SEMANTIC_LIMITS.bytes).map((item) => item.oid), remaining); }
        catch (error) {
          if (error instanceof Error && error.message === CAPTURED_BLOBS_TIMEOUT) { stoppedBy = "time"; break; }
          throw error;
        }
      }
      const text = texts.get(entry.oid);
      if (text === null || text === undefined) { skippedFiles++; continue; }
      const language = supportedLanguage(entry.path)!;
      let parser = parsers.get(language);
      if (!parser) { parser = await languageParser(language); parsers.set(language, parser); }
      const tree = parseWithin(parser, text, SEMANTIC_LIMITS.parseMicros);
      if (!tree) { skippedFiles++; continue; }
      try {
        const found = walk(tree.rootNode, language, entry.path);
        if (!found) { stoppedBy = "time"; break; }
        if (tree.rootNode.hasError) parseErrorFiles++;
        for (const site of found) {
          const list = callSites.get(site.name);
          if (list) list.push(site); else callSites.set(site.name, [site]);
        }
        scannedFiles++;
        scannedBytes += entry.size;
      } finally {
        tree.delete();
      }
    }
  } finally {
    for (const parser of parsers.values()) parser.delete();
  }

  const base = `Scanned ${scannedFiles} of ${candidates.length} files`;
  const message = stoppedBy ? `${base}; stopped at the ${LIMIT_WORDS[stoppedBy]} limit.` : `${base}.`;
  return { coverage: { side, totalFiles: candidates.length, scannedFiles, scannedBytes, skippedFiles, parseErrorFiles, ...(stoppedBy ? { stoppedBy } : {}), message }, callSites };
}

export type CodeGraphGate = { usable: true; reading: string; indexedFiles?: number } | { usable: false; reason: string };

const GATE_TIMEOUT_MS = 15_000;
const STATUS_TIMEOUT_MS = 5_000;
const QUERY_TIMEOUT_MS = 5_000;
const QUERY_BUDGET_MS = 20_000;
const QUERY_CONCURRENCY = 4;
const MAX_QUERIED_DECLARATIONS = 60;
const QUERY_LIMIT = "50";
const FILTER_REASON = "This repository uses Git content filters, so the working tree cannot be compared without writing to it.";
const TOO_LONG_REASON = "Comparing the working tree with the captured head tree took too long.";

const isTimeout = (error: unknown) => error instanceof Error && /timed out/.test(error.message);

async function gitText(root: string, args: string[], env?: Record<string, string>): Promise<string> {
  return (await runProcess(["git", ...args], root, [0], { timeoutMs: GATE_TIMEOUT_MS, env })).stdout;
}

async function hasContentFilters(root: string): Promise<boolean> {
  const listed = new Set<string>();
  for (const args of [["--cached", "--others", "--exclude-standard"], ["--others", "--ignored", "--exclude-standard"]]) {
    for (const path of (await gitText(root, ["ls-files", "-z", ...args, "--", ":(glob)**/.gitattributes"])).split("\0")) if (path) listed.add(path);
  }
  const files = [...listed].map((path) => join(root, path));
  files.push((await gitText(root, ["rev-parse", "--path-format=absolute", "--git-path", "info/attributes"])).trim());
  for (const file of files) {
    const text = await readFile(file, "utf8").catch(() => "");
    if (text.includes("filter=")) return true;
  }
  return false;
}

async function workingTreeId(root: string): Promise<{ tree: string } | { reason: string }> {
  const temporary = await mkdtemp(join(tmpdir(), "diffcompass-gate-"));
  try {
    await mkdir(join(temporary, "objects"));
    const noAttributes = join(temporary, "no-attributes");
    await writeFile(noAttributes, "");
    const indexFile = join(temporary, "index");
    const objects = (await gitText(root, ["rev-parse", "--path-format=absolute", "--git-path", "objects"])).trim();
    const source = (await gitText(root, ["rev-parse", "--path-format=absolute", "--git-path", "index"])).trim();
    const env = { GIT_INDEX_FILE: indexFile, GIT_OBJECT_DIRECTORY: join(temporary, "objects"), GIT_ALTERNATE_OBJECT_DIRECTORIES: objects, GIT_ATTR_NOSYSTEM: "1" };
    if (await Bun.file(source).exists()) await copyFile(source, indexFile);
    else await gitText(root, ["read-tree", "HEAD"], env);
    const entries = (await gitText(root, ["ls-files", "-v", "-z"], env)).split("\0").filter(Boolean);
    if (entries.some((entry) => /^[a-zS]/.test(entry))) return { reason: "The index marks files as unchanged or outside the worktree, so their working copies cannot be compared." };
    await gitText(root, ["-c", `core.attributesFile=${noAttributes}`, "-c", "core.fsmonitor=false", "add", "-A", "--", "."], env);
    return { tree: (await gitText(root, ["write-tree"], env)).trim() };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function codeGraphGate(comparison: GitComparison, executable: string | null): Promise<CodeGraphGate> {
  const skip = (reason: string): CodeGraphGate => ({ usable: false, reason });
  if (!executable) return skip("CodeGraph is not installed.");
  const root = comparison.repositoryRoot;
  const index = await lstat(join(root, ".codegraph")).catch(() => null);
  if (!index?.isDirectory()) return skip("This repository has no CodeGraph index.");
  if (!comparison.sourceTree) return skip("This review has no captured head tree.");
  let tree: string;
  try {
    if (await hasContentFilters(root)) return skip(FILTER_REASON);
    const id = await workingTreeId(root);
    if ("reason" in id) return skip(id.reason);
    tree = id.tree;
  } catch (error) {
    return skip(isTimeout(error) ? TOO_LONG_REASON : "The working tree could not be compared with the captured head tree.");
  }
  if (tree !== comparison.sourceTree) return skip("The working tree differs from the captured head tree, so the index may describe unreviewed code.");
  let status: any;
  try { status = JSON.parse((await runProcess([executable, "status", "--json"], root, [0], { timeoutMs: STATUS_TIMEOUT_MS })).stdout); }
  catch { return skip("CodeGraph status could not be read."); }
  if (!status || typeof status !== "object") return skip("CodeGraph status could not be read.");
  if (status.initialized !== true) return skip("The CodeGraph index is not initialised.");
  const pending = status.pendingChanges;
  if (!pending || pending.added !== 0 || pending.modified !== 0 || pending.removed !== 0) return skip("The CodeGraph index has pending changes.");
  if (status.worktreeMismatch !== null) return skip("CodeGraph reports a worktree mismatch.");
  const reading = tree + JSON.stringify({ pendingChanges: status.pendingChanges, worktreeMismatch: status.worktreeMismatch, lastIndexed: status.lastIndexed });
  return { usable: true, reading, ...(typeof status.fileCount === "number" ? { indexedFiles: status.fileCount } : {}) };
}

function codeGraphFact(declaration: CallerDeclaration, output: string, repositoryFiles: ReadonlySet<string>): CallerFact | null {
  let parsed: any;
  try { parsed = JSON.parse(output); } catch { return null; }
  const definitions: any[] = Array.isArray(parsed?.definitions) ? parsed.definitions : [];
  const inRange = definitions.filter((entry) => entry?.definition?.filePath === declaration.path && Number.isInteger(entry.definition.startLine) && entry.definition.startLine >= declaration.startLine && entry.definition.startLine <= declaration.endLine);
  const candidates = inRange.length > 1 ? inRange.filter((entry) => entry.definition.startLine === declaration.startLine) : inRange;
  if (candidates.length !== 1) return null;
  const match = candidates[0];
  const known = new Map<string, any>();
  for (const caller of Array.isArray(match.callers) ? match.callers : []) if (caller && typeof caller.id === "string") known.set(caller.id, caller);
  const name = simpleName(declaration.name);
  const sites: CallSite[] = [];
  for (const edge of Array.isArray(match.edges) ? match.edges : []) {
    if (edge?.kind !== "calls" && edge?.kind !== "instantiates") continue;
    const caller = known.get(edge.source);
    if (!caller || typeof caller.filePath !== "string" || !repositoryFiles.has(caller.filePath)) continue;
    if (!Number.isInteger(edge.line) || edge.line < 1) continue;
    sites.push({ name, path: caller.filePath, line: edge.line, enclosing: typeof caller.name === "string" ? caller.name : null });
  }
  return { analysis: CODEGRAPH_LABEL, provider: "codegraph", declaration, callers: sites.slice(0, MAX_CALLERS), total: sites.length, ...(match.truncated === true ? { truncated: true as const } : {}) };
}

export async function codeGraphCallers(comparison: GitComparison, declarations: readonly CallerDeclaration[], executable: string | null): Promise<{ facts: CallerFact[]; coverage: CodeGraphCoverage }> {
  const eligible = declarations.filter((declaration) => declaration.side === "new").slice(0, MAX_QUERIED_DECLARATIONS);
  const skipped = (reason: string): { facts: CallerFact[]; coverage: CodeGraphCoverage } => ({ facts: [], coverage: { state: "skipped", reason, declarations: eligible.length, queried: 0 } });
  if (executable && !eligible.length) return skipped("No changed declarations to look up.");
  const gate = await codeGraphGate(comparison, executable);
  if (!gate.usable) return skipped(gate.reason);
  const repositoryFiles = new Set(comparison.repositoryFiles);
  const results = new Map<number, CallerFact>();
  const started = performance.now();
  let next = 0, queried = 0;
  const worker = async () => {
    while (next < eligible.length && performance.now() - started < QUERY_BUDGET_MS) {
      const index = next++;
      const declaration = eligible[index];
      try {
        const run = await runProcess([executable!, "callers", simpleName(declaration.name), "--json", "--file", declaration.path, "--limit", QUERY_LIMIT], comparison.repositoryRoot, [0], { timeoutMs: QUERY_TIMEOUT_MS });
        queried++;
        const fact = codeGraphFact(declaration, run.stdout, repositoryFiles);
        if (fact) results.set(index, fact);
      } catch {}
    }
  };
  await Promise.all(Array.from({ length: Math.min(QUERY_CONCURRENCY, eligible.length) }, worker));
  const again = await codeGraphGate(comparison, executable);
  if (!again.usable || again.reading !== gate.reading) return skipped("The index or the working tree changed during the query.");
  return {
    facts: [...results.entries()].sort((a, b) => a[0] - b[0]).map(([, fact]) => fact),
    coverage: { state: "used", declarations: eligible.length, queried, ...(gate.indexedFiles !== undefined ? { indexedFiles: gate.indexedFiles } : {}) },
  };
}
