import type { Node, Parser } from "web-tree-sitter";
import { listCapturedTree, readCapturedBlobs, type CapturedTreeEntry } from "./captured-tree.ts";
import { declarationParts, languageParser, SEMANTIC_LIMITS, supportedLanguage, type SyntaxLanguage } from "./semantic-diff.ts";
import { calledName, parseWithin } from "./syntax-nodes.ts";
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
      if (entry.size > SEMANTIC_LIMITS.bytes) { skippedFiles++; continue; }
      if (timeUp()) { stoppedBy = "time"; break; }
      if (scannedFiles >= limits.files) { stoppedBy = "files"; break; }
      if (scannedBytes + entry.size > limits.bytes) { stoppedBy = "bytes"; break; }
      if (index >= loadedUntil) {
        const batch = ordered.slice(index, index + BATCH);
        loadedUntil = index + batch.length;
        const remaining = Math.max(1, Math.min(30_000, Math.ceil(limits.millis - (performance.now() - start))));
        try { texts = await readCapturedBlobs(comparison, batch.filter((item) => item.size <= SEMANTIC_LIMITS.bytes).map((item) => item.oid), remaining); }
        catch (error) {
          if (error instanceof Error && error.message === "Reading captured blobs timed out.") { stoppedBy = "time"; break; }
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
