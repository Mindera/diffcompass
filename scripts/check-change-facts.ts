import { listCapturedTree, readCapturedBlobs } from "../src/captured-tree.ts";
import { scanCapturedTree, simpleName } from "../src/change-callers.ts";
import { loadChangeFacts, type FileChangeFacts, type LineRange, type LineSide } from "../src/change-facts.ts";
import { loadComparisonBetweenTrees } from "../src/git.ts";
import type { GitComparison } from "../src/types.ts";

const USAGE = "Usage: bun scripts/check-change-facts.ts time-scan <repo> <commit> [<repo> <commit> ...] | check <repo> <base> <head>";
const [command, ...rest] = process.argv.slice(2);
if (!((command === "time-scan" && rest.length && rest.length % 2 === 0) || (command === "check" && rest.length === 3))) {
  console.error(USAGE);
  process.exit(2);
}

function resolveSha(repo: string, commit: string): string {
  const resolved = Bun.spawnSync(["git", "rev-parse", "--verify", `${commit}^{commit}`], { cwd: repo });
  if (resolved.exitCode) { console.error(`Cannot resolve ${commit} in ${repo}`); process.exit(1); }
  return resolved.stdout.toString().trim();
}

function factRangesOf(file: FileChangeFacts): LineRange[] {
  return [
    ...file.symbols.flatMap((symbol) => [
      ...(symbol.before ? [{ side: "old" as const, startLine: symbol.before.startLine, endLine: symbol.before.endLine }] : []),
      ...(symbol.after ? [{ side: "new" as const, startLine: symbol.after.startLine, endLine: symbol.after.endLine }] : []),
    ]),
    ...file.calls.map((call) => ({ side: call.side, startLine: call.line, endLine: call.line })),
    ...file.tests.map((fact) => ({ side: fact.side, startLine: fact.startLine, endLine: fact.endLine })),
    ...file.imports.map((fact) => ({ side: fact.side, startLine: fact.startLine, endLine: fact.endLine })),
  ];
}

function inRanges(ranges: LineRange[], side: LineSide, line: number): boolean {
  return ranges.some((range) => range.side === side && range.startLine <= line && line <= range.endLine);
}

function changedLinesOf(comparison: GitComparison, path: string): Array<{ side: LineSide; line: number }> {
  const file = comparison.files.find((entry) => entry.path === path)!;
  return file.hunks.flatMap((hunk) => hunk.rows.flatMap((row): Array<{ side: LineSide; line: number }> => row.kind === "deletion" && row.oldLine !== null ? [{ side: "old" as const, line: row.oldLine }] : row.kind === "addition" && row.newLine !== null ? [{ side: "new" as const, line: row.newLine }] : []));
}

function tally<T>(items: Iterable<T>, key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return counts;
}

function sum<T>(items: readonly T[], count: (item: T) => number): number {
  return items.reduce((total, item) => total + count(item), 0);
}

async function check(repo: string, baseRef: string, headRef: string): Promise<void> {
  const base = resolveSha(repo, baseRef), head = resolveSha(repo, headRef);
  const comparison = await loadComparisonBetweenTrees(repo, { base, mergeBase: base, head, sourceTree: head });
  const started = performance.now();
  const facts = await loadChangeFacts(comparison);
  const elapsedMs = Math.round(performance.now() - started);
  const failures: Record<number, string[]> = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };
  const fail = (invariant: number, message: string) => failures[invariant]!.push(message);

  const newEntries = new Map((await listCapturedTree(comparison, "new")).map((entry) => [entry.path, entry.oid]));
  const oldPaths = new Set((await listCapturedTree(comparison, "old")).map((entry) => entry.path));
  const newPaths = new Set(newEntries.keys());
  const headBlobs = await readCapturedBlobs(comparison, [...newEntries.values()]);
  const headLines = (path: string): string[] | null => {
    const oid = newEntries.get(path);
    const text = oid ? headBlobs.get(oid) : null;
    return typeof text === "string" ? text.split("\n") : null;
  };

  for (const diffFile of comparison.files) {
    const matches = facts.files.filter((file) => file.path === diffFile.path);
    if (matches.length !== 1 || !matches[0]!.completeness?.state) fail(1, `${diffFile.path}: ${matches.length} FileChangeFacts entries`);
  }
  for (const file of facts.files) if (!comparison.files.some((entry) => entry.path === file.path)) fail(1, `${file.path}: facts for a path outside the comparison`);

  for (const file of facts.files) {
    if (!comparison.files.some((entry) => entry.path === file.path)) continue;
    const changed = changedLinesOf(comparison, file.path);
    if (file.completeness.state === "unsupported") {
      if (file.unattributed.length) fail(2, `${file.path}: unsupported file carries ${file.unattributed.length} unattributed ranges`);
    } else {
      const ranges = factRangesOf(file);
      for (const { side, line } of changed) {
        const count = [inRanges(ranges, side, line), inRanges(file.unattributed, side, line)].filter(Boolean).length;
        if (count !== 1) fail(2, `${file.path}:${line} (${side}) is in ${count} of fact ranges / unattributed`);
      }
      for (const range of file.unattributed) for (let line = range.startLine; line <= range.endLine; line++) {
        if (!changed.some((entry) => entry.side === range.side && entry.line === line)) fail(2, `${file.path}:${line} (${range.side}) is unattributed but not a changed line`);
      }
    }
    for (const call of file.calls) {
      if (!changed.some((entry) => entry.side === call.side && entry.line === call.line)) fail(3, `${file.path}:${call.line} ${call.change} call ${call.name} is not on a ${call.change === "removed" ? "deletion" : "addition"} row`);
      if (call.change !== (call.side === "old" ? "removed" : "added")) fail(3, `${file.path}:${call.line} call ${call.name} is ${call.change} on side ${call.side}`);
    }
    const lines = file.newPath ? headLines(file.newPath) : null;
    for (const symbol of file.symbols) {
      if (!symbol.change.includes("added") || !symbol.after) continue;
      if (!lines) { fail(4, `${file.path}: head text unavailable for added symbol ${symbol.name}`); continue; }
      const text = lines.slice(symbol.after.startLine - 1, symbol.after.endLine).join("\n");
      if (!text.includes(simpleName(symbol.name))) fail(4, `${file.path}:${symbol.after.startLine}-${symbol.after.endLine} added symbol ${symbol.name} range lacks ${simpleName(symbol.name)}`);
    }
    for (const fact of file.imports) {
      if (fact.target.kind !== "file" && fact.target.kind !== "files") continue;
      const paths = fact.target.kind === "file" ? [fact.target.path] : fact.target.paths;
      const known = fact.side === "old" ? oldPaths : newPaths;
      for (const path of paths) if (!known.has(path)) fail(6, `${file.path}:${fact.startLine} (${fact.side}) import "${fact.specifier}" targets ${path}, absent from the ${fact.side} tree`);
    }
  }

  for (const caller of facts.callers) {
    if (caller.provider !== "name-match") continue;
    const name = simpleName(caller.declaration.name);
    for (const site of caller.callers) {
      const line = headLines(site.path)?.[site.line - 1];
      if (line === undefined) fail(5, `${site.path}:${site.line} caller of ${caller.declaration.name}: head line unavailable`);
      else if (!line.includes(name)) fail(5, `${site.path}:${site.line} caller line lacks ${name}`);
    }
  }

  const message = facts.callerCoverage.nameMatch?.message;
  if (!message || !/^Scanned \d+ of \d+ files/.test(message)) fail(7, `scan message is ${JSON.stringify(message)}`);

  const skipped = facts.files.flatMap((file) => file.completeness.state === "skipped" ? [{ path: file.path, reason: file.completeness.reason }] : []);
  console.log(JSON.stringify({
    repo, base, head,
    files: { total: comparison.files.length, factEntries: facts.files.length, byState: tally(facts.files, (file) => file.completeness.state), skipReasons: tally(skipped, (entry) => entry.reason), skipped },
    facts: {
      symbols: sum(facts.files, (file) => file.symbols.length),
      calls: sum(facts.files, (file) => file.calls.length),
      tests: sum(facts.files, (file) => file.tests.length),
      imports: sum(facts.files, (file) => file.imports.length),
    },
    unattributedLines: sum(facts.files, (file) => sum(file.unattributed, (range) => range.endLine - range.startLine + 1)),
    callersByProvider: tally(facts.callers, (caller) => caller.provider),
    scanMessage: message ?? null,
    codegraph: { state: facts.callerCoverage.codegraph.state, reason: facts.callerCoverage.codegraph.reason ?? null },
    kotlinImportTargets: tally(facts.files.filter((file) => file.language === "kotlin").flatMap((file) => file.imports), (fact) => fact.target.kind),
    elapsedMs,
  }, null, 2));

  const failed = Object.entries(failures).filter(([, messages]) => messages.length);
  if (failed.length) {
    for (const [invariant, messages] of failed) {
      console.error(`Invariant ${invariant} failed (${messages.length}):`);
      for (const line of messages.slice(0, 50)) console.error(`  ${line}`);
    }
    process.exit(1);
  }
  console.log("All invariants hold.");
}

if (command === "check") {
  await check(rest[0]!, rest[1]!, rest[2]!);
  process.exit(0);
}

const unlimited = { files: Infinity, bytes: Infinity, millis: Infinity };
let largestFiles = 0, largestBytes = 0, slowestMs = 0;
for (let index = 0; index < rest.length; index += 2) {
  const repo = rest[index]!, commit = rest[index + 1]!;
  const sha = resolveSha(repo, commit);
  const comparison = await loadComparisonBetweenTrees(repo, { base: sha, mergeBase: sha, head: sha, sourceTree: sha });
  const runsMs: number[] = [];
  let coverage;
  for (let run = 0; run < 3; run++) {
    const started = performance.now();
    coverage = (await scanCapturedTree(comparison, "new", { names: new Set(["timingProbe"]), limits: unlimited })).coverage;
    runsMs.push(Math.round(performance.now() - started));
  }
  const { totalFiles, scannedFiles, scannedBytes } = coverage;
  largestFiles = Math.max(largestFiles, totalFiles);
  largestBytes = Math.max(largestBytes, scannedBytes);
  slowestMs = Math.max(slowestMs, ...runsMs);
  console.log(JSON.stringify({ repo, commit, totalFiles, scannedFiles, scannedBytes, runsMs }));
}

const mebibyte = 1_048_576;
console.log(JSON.stringify({
  limits: {
    files: Math.ceil(4 * largestFiles / 1000) * 1000,
    bytes: Math.ceil(4 * largestBytes / mebibyte) * mebibyte,
    millis: Math.max(5000, Math.ceil(4 * slowestMs / 1000) * 1000),
  },
}));
