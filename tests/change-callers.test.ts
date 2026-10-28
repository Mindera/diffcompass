import { expect, test } from "bun:test";
import { appendFile, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CALLER_SCAN_LIMITS, CODEGRAPH_LABEL, NAME_MATCH_LABEL, scanCapturedTree } from "../src/change-callers.ts";
import { loadChangeFacts } from "../src/change-facts.ts";
import { runProcess } from "../src/process.ts";
import { capturedText, historicalComparison, repositoryComparison } from "./comparison-fixtures.ts";

const wide = { files: 10_000, bytes: 64 * 1024 * 1024, millis: 60_000 };
const names = new Set(["classifyRevisionFiles"]);

test("collects call sites from the captured head tree and reports full coverage", async () => {
  const comparison = await historicalComparison("8f84166", "740bada");
  const scan = await scanCapturedTree(comparison, "new", { names: new Set(["revisionSummary"]), limits: wide });
  const sites = scan.callSites.get("revisionSummary") ?? [];
  expect(sites.some((site) => site.path === "src/session.ts")).toBe(true);
  for (const site of sites) expect((await capturedText(comparison, "new", site.path)).split("\n")[site.line - 1]).toContain("revisionSummary");
  const { totalFiles, scannedFiles } = scan.coverage;
  expect(scan.coverage.stoppedBy).toBeUndefined();
  expect(scannedFiles).toBe(totalFiles);
  expect(scan.coverage.message).toBe(`Scanned ${totalFiles} of ${totalFiles} files.`);
}, 30_000);

test("stops at the file limit after scanning the preferred files first", async () => {
  const comparison = await historicalComparison("8f84166", "740bada");
  const scan = await scanCapturedTree(comparison, "new", { names, limits: { ...wide, files: 2 }, first: ["src/revision.ts"] });
  expect(scan.coverage.scannedFiles).toBe(2);
  expect(scan.coverage.stoppedBy).toBe("files");
  expect(scan.coverage.message.endsWith("stopped at the file limit.")).toBe(true);
}, 30_000);

test("stops at the time and byte limits before parsing", async () => {
  const comparison = await historicalComparison("8f84166", "740bada");
  const timed = await scanCapturedTree(comparison, "new", { names, limits: { ...wide, millis: 0 } });
  expect(timed.coverage.scannedFiles).toBe(0);
  expect(timed.coverage.stoppedBy).toBe("time");
  const bytes = await scanCapturedTree(comparison, "new", { names, limits: { ...wide, bytes: 1 } });
  expect(bytes.coverage.scannedFiles).toBe(0);
  expect(bytes.coverage.stoppedBy).toBe("bytes");
}, 30_000);

test("resolves with partial coverage when the time budget is tiny", async () => {
  const comparison = await historicalComparison("8f84166", "740bada");
  const scan = await scanCapturedTree(comparison, "new", { names, limits: { ...wide, millis: 1 } });
  expect(scan.coverage.stoppedBy).toBe("time");
  expect(scan.coverage.scannedFiles).toBeLessThan(scan.coverage.totalFiles);
}, 30_000);

test("scans deeply nested sources without quadratic enclosing lookups", async () => {
  const depth = 300;
  const text = `export function outer() {\n${"if (x) {\n".repeat(depth)}${"ping();\n".repeat(5_000)}${"}\n".repeat(depth)}}\n`;
  const fixture = await repositoryComparison({}, { "deep.ts": text });
  try {
    const started = performance.now();
    const scan = await scanCapturedTree(fixture.comparison, "new", { names: new Set(["ping"]), limits: wide });
    const sites = scan.callSites.get("ping") ?? [];
    expect(sites).toHaveLength(5_000);
    expect(sites.every((site) => site.enclosing === "outer")).toBe(true);
    expect(performance.now() - started).toBeLessThan(5_000);
  } finally {
    await fixture.cleanup();
  }
}, 30_000);

test("reads callers from the captured tree, never the checkout", async () => {
  const fixture = await repositoryComparison({}, { "a.ts": "export function ping() {}\nping();\n" });
  try {
    await writeFile(join(fixture.root, "b.ts"), "ping();\n");
    await appendFile(join(fixture.root, "a.ts"), "ping();\n");
    const scan = await scanCapturedTree(fixture.comparison, "new", { names: new Set(["ping"]), limits: wide });
    expect(scan.callSites.get("ping")).toEqual([{ name: "ping", path: "a.ts", line: 2, enclosing: null }]);
  } finally {
    await fixture.cleanup();
  }
}, 30_000);

test("the default limits cover a full scan of this repository's own tree", async () => {
  const comparison = await historicalComparison("27b7e44", "27b7e44");
  const scan = await scanCapturedTree(comparison, "new", { names: new Set(["timingProbe"]), limits: { ...CALLER_SCAN_LIMITS, millis: Infinity } });
  const { totalFiles, scannedFiles, skippedFiles } = scan.coverage;
  expect(scan.coverage.stoppedBy).toBeUndefined();
  expect(scannedFiles + skippedFiles).toBe(totalFiles);
}, 30_000);

test("reports name-matched callers of changed declarations from the captured head tree", async () => {
  const comparison = await historicalComparison("8f84166", "740bada");
  const facts = await loadChangeFacts(comparison, { scanLimits: { ...CALLER_SCAN_LIMITS, millis: 60_000 }, codegraph: null });
  const fact = facts.callers.find((caller) => caller.declaration.name === "revisionSummary" && caller.declaration.path === "src/revision.ts");
  expect(fact?.provider).toBe("name-match");
  expect(fact?.analysis).toBe(NAME_MATCH_LABEL);
  expect(fact?.callers.some((site) => site.path === "src/session.ts")).toBe(true);
  for (const site of fact?.callers ?? []) expect((await capturedText(comparison, "new", site.path)).split("\n")[site.line - 1]).toContain("revisionSummary");
  expect(facts.callerCoverage.nameMatch?.message).toMatch(/^Scanned (\d+) of \1 files\.$/);
}, 30_000);

test("lists only callers in the captured tree for a declaration added in the head", async () => {
  const fixture = await repositoryComparison({}, { "a.ts": "export function ping() {}\n", "b.ts": 'import { ping } from "./a.ts";\nping();\n' });
  try {
    await writeFile(join(fixture.root, "c.ts"), "ping();\n");
    const facts = await loadChangeFacts(fixture.comparison, { scanLimits: { ...CALLER_SCAN_LIMITS, millis: 60_000 }, codegraph: null });
    const fact = facts.callers.find((caller) => caller.declaration.name === "ping");
    expect(fact?.callers.map((site) => [site.path, site.line])).toEqual([["b.ts", 2]]);
    expect(fact?.total).toBe(1);
  } finally {
    await fixture.cleanup();
  }
}, 30_000);

test("reports the file limit that stopped the caller search", async () => {
  const fixture = await repositoryComparison({}, { "a.ts": "export function ping() {}\n", "b.ts": 'import { ping } from "./a.ts";\nping();\n' });
  try {
    const facts = await loadChangeFacts(fixture.comparison, { scanLimits: { files: 1, bytes: 1e9, millis: 1e9 }, codegraph: null });
    expect(facts.callerCoverage.nameMatch?.stoppedBy).toBe("files");
    expect(facts.callerCoverage.nameMatch?.message.startsWith("Scanned 1 of")).toBe(true);
  } finally {
    await fixture.cleanup();
  }
}, 30_000);

const HEAD_FILES = { ".gitignore": ".codegraph/\n", "a.ts": "export function ping() {}\n", "b.ts": 'import { ping } from "./a.ts";\nping();\n' };
const cleanStatus = { initialized: true, pendingChanges: { added: 0, modified: 0, removed: 0 }, worktreeMismatch: null, lastIndexed: 1700000000, fileCount: 2 };
const definition = { name: "ping", kind: "function", filePath: "a.ts", startLine: 1, id: "function:a" };
const callersAnswer = (overrides: Record<string, unknown> = {}, callers?: unknown[]) => ({
  symbol: "ping",
  definitions: [{
    definition,
    callers: callers ?? [{ id: "function:b", name: "main", filePath: "b.ts", startLine: 1 }, { id: "function:g", name: "ghost", filePath: "ghost.ts", startLine: 1 }, { id: "file:b", name: "b.ts", filePath: "b.ts", startLine: 1 }],
    edges: callers?.length === 0 ? [] : [{ source: "function:b", target: "function:a", kind: "calls", line: 2 }, { source: "function:g", target: "function:a", kind: "calls", line: 3 }, { source: "file:b", target: "function:a", kind: "imports", line: 1 }],
    total: 3, limit: 50, truncated: false, ...overrides,
  }],
  total: 3,
});
const FAKE_SCRIPT = `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const dir = path.dirname(process.argv[1]);
const stateFile = path.join(dir, "state.json");
const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
const args = process.argv.slice(2);
fs.appendFileSync(path.join(dir, "calls.log"), args.join(" ") + "\\n");
if (args[0] === "status") console.log(JSON.stringify(state.status));
else if (args[0] === "callers") {
  console.log(JSON.stringify(state.callers));
  if (state.changeAfterCallers) {
    state.status.pendingChanges.modified = 1;
    fs.writeFileSync(stateFile, JSON.stringify(state));
  }
}
`;

async function gitIn(root: string, ...args: string[]): Promise<string> {
  return (await runProcess(["git", ...args], root)).stdout;
}

async function codeGraphFixture(state: { status?: unknown; callers?: unknown; changeAfterCallers?: boolean } = {}, files: Record<string, string> = HEAD_FILES) {
  const fixture = await repositoryComparison({}, files);
  const directory = await mkdtemp(join(tmpdir(), "diffcompass-fake-codegraph-"));
  const executable = join(directory, "codegraph");
  await writeFile(executable, FAKE_SCRIPT);
  await chmod(executable, 0o700);
  await writeFile(join(directory, "state.json"), JSON.stringify({ status: cleanStatus, callers: callersAnswer(), ...state }));
  await mkdir(join(fixture.root, ".codegraph"));
  const calls = async () => (await readFile(join(directory, "calls.log"), "utf8").catch(() => "")).split("\n").filter(Boolean);
  const cleanup = async () => { await fixture.cleanup(); await rm(directory, { recursive: true, force: true }); };
  return { ...fixture, executable, calls, cleanup };
}

const load = (fixture: { comparison: Parameters<typeof loadChangeFacts>[0]; executable: string }, codegraph: string | null = fixture.executable) => loadChangeFacts(fixture.comparison, { scanLimits: wide, codegraph });
const pingFacts = (facts: Awaited<ReturnType<typeof loadChangeFacts>>) => facts.callers.filter((caller) => caller.declaration.name === "ping");
const skipped = (reason: string) => expect.objectContaining({ state: "skipped", reason });

test.skipIf(process.platform === "win32")("adds CodeGraph callers beside the name-matched ones when the index is current", async () => {
  const fixture = await codeGraphFixture();
  try {
    const facts = await load(fixture);
    const [nameMatch, codegraph] = pingFacts(facts);
    expect(pingFacts(facts)).toHaveLength(2);
    expect(nameMatch.provider).toBe("name-match");
    expect(nameMatch.analysis).toBe(NAME_MATCH_LABEL);
    expect(nameMatch.callers.map((site) => [site.path, site.line])).toEqual([["b.ts", 2]]);
    expect(codegraph.provider).toBe("codegraph");
    expect(codegraph.analysis).toBe(CODEGRAPH_LABEL);
    expect(codegraph.callers).toEqual([{ name: "ping", path: "b.ts", line: 2, enclosing: "main" }]);
    expect(codegraph.total).toBe(1);
    expect(codegraph.truncated).toBeUndefined();
    expect(facts.callerCoverage.codegraph).toEqual({ state: "used", declarations: 1, queried: 1, indexedFiles: 2 });
  } finally {
    await fixture.cleanup();
  }
}, 30_000);

test.skipIf(process.platform === "win32")("carries CodeGraph truncation and keeps the name-matched fact when CodeGraph lists no callers", async () => {
  const truncated = await codeGraphFixture({ callers: callersAnswer({ truncated: true }) });
  try {
    expect(pingFacts(await load(truncated))[1].truncated).toBe(true);
  } finally {
    await truncated.cleanup();
  }
  const empty = await codeGraphFixture({ callers: callersAnswer({}, []) });
  try {
    const [nameMatch, codegraph] = pingFacts(await load(empty));
    expect(codegraph.provider).toBe("codegraph");
    expect(codegraph.callers).toEqual([]);
    expect(codegraph.total).toBe(0);
    expect(nameMatch.callers.map((site) => site.path)).toEqual(["b.ts"]);
  } finally {
    await empty.cleanup();
  }
}, 30_000);

test.skipIf(process.platform === "win32")("skips CodeGraph when the index has pending changes or changes during the query", async () => {
  const pending = await codeGraphFixture({ status: { ...cleanStatus, pendingChanges: { added: 0, modified: 1, removed: 0 } } });
  try {
    const facts = await load(pending);
    expect(facts.callerCoverage.codegraph).toEqual(skipped("The CodeGraph index has pending changes."));
    expect(pingFacts(facts).map((fact) => fact.provider)).toEqual(["name-match"]);
  } finally {
    await pending.cleanup();
  }
  const changing = await codeGraphFixture({ changeAfterCallers: true });
  try {
    const facts = await load(changing);
    expect(facts.callerCoverage.codegraph).toEqual(skipped("The index or the working tree changed during the query."));
    expect(pingFacts(facts).map((fact) => fact.provider)).toEqual(["name-match"]);
  } finally {
    await changing.cleanup();
  }
}, 30_000);

test.skipIf(process.platform === "win32")("skips CodeGraph for a missing index or a missing executable", async () => {
  const fixture = await codeGraphFixture();
  try {
    expect((await load(fixture, null)).callerCoverage.codegraph).toEqual(skipped("CodeGraph is not installed."));
    await rm(join(fixture.root, ".codegraph"), { recursive: true });
    expect((await load(fixture)).callerCoverage.codegraph).toEqual(skipped("This repository has no CodeGraph index."));
    expect(await fixture.calls()).toEqual([]);
  } finally {
    await fixture.cleanup();
  }
}, 30_000);

test.skipIf(process.platform === "win32")("skips CodeGraph when the working tree differs, without writing any object", async () => {
  const fixture = await codeGraphFixture();
  try {
    await writeFile(join(fixture.root, "a.ts"), "export function ping() { return 1; }\n");
    const count = async () => (await gitIn(fixture.root, "count-objects", "-v")).split("\n").find((line) => line.startsWith("count:"));
    const before = await count();
    const facts = await load(fixture);
    expect(facts.callerCoverage.codegraph).toEqual(skipped("The working tree differs from the captured head tree, so the index may describe unreviewed code."));
    expect(await count()).toBe(before);
    expect((await fixture.calls()).some((line) => line.startsWith("status"))).toBe(false);
  } finally {
    await fixture.cleanup();
  }
}, 30_000);

test.skipIf(process.platform === "win32")("skips CodeGraph when a head, untracked or excluded attributes file names a content filter", async () => {
  const filterReason = "This repository uses Git content filters, so the working tree cannot be compared without writing to it.";
  const line = "*.bin filter=lfs diff=lfs merge=lfs -text\n";
  const committed = await codeGraphFixture({}, { ...HEAD_FILES, ".gitattributes": line });
  try {
    expect((await load(committed)).callerCoverage.codegraph).toEqual(skipped(filterReason));
    expect((await committed.calls()).some((call) => call.startsWith("status"))).toBe(false);
  } finally {
    await committed.cleanup();
  }
  const untracked = await codeGraphFixture();
  try {
    await writeFile(join(untracked.root, ".gitattributes"), line);
    expect((await load(untracked)).callerCoverage.codegraph).toEqual(skipped(filterReason));
    await appendFile(join(untracked.root, ".git", "info", "exclude"), ".gitattributes\n");
    expect((await load(untracked)).callerCoverage.codegraph).toEqual(skipped(filterReason));
  } finally {
    await untracked.cleanup();
  }
}, 30_000);

test.skipIf(process.platform === "win32")("skips CodeGraph when the index marks a file assume-unchanged", async () => {
  const fixture = await codeGraphFixture();
  try {
    await gitIn(fixture.root, "update-index", "--assume-unchanged", "a.ts");
    await writeFile(join(fixture.root, "a.ts"), "export function ping() { return 1; }\n");
    const facts = await load(fixture);
    expect(facts.callerCoverage.codegraph).toEqual(skipped("The index marks files as unchanged or outside the worktree, so their working copies cannot be compared."));
    expect(pingFacts(facts).map((fact) => fact.provider)).toEqual(["name-match"]);
  } finally {
    await fixture.cleanup();
  }
}, 30_000);

test.skipIf(process.platform === "win32")("runs no repository hook while comparing the working tree", async () => {
  const fixture = await codeGraphFixture();
  try {
    const marker = join(dirname(fixture.executable), "hook-ran");
    const hook = join(fixture.root, ".git", "hooks", "post-index-change");
    await mkdir(dirname(hook), { recursive: true });
    await writeFile(hook, `#!/bin/sh\necho ran >> "${marker}"\n`);
    await chmod(hook, 0o700);
    const facts = await load(fixture);
    expect(await Bun.file(marker).exists()).toBe(false);
    expect(facts.callerCoverage.codegraph?.state).toBe("used");
  } finally {
    await fixture.cleanup();
  }
}, 30_000);

const definitionAt =(startLine: number, id: string, caller: string) => ({
  definition: { name: "ping", kind: "function", filePath: "a.ts", startLine, id },
  callers: [{ id: `function:${caller}`, name: caller, filePath: "b.ts", startLine: 1 }],
  edges: [{ source: `function:${caller}`, target: id, kind: "calls", line: 2 }],
  total: 1, limit: 50, truncated: false,
});

test.skipIf(process.platform === "win32")("adds nothing when several CodeGraph definitions fit one declaration equally", async () => {
  const files = { ...HEAD_FILES, "a.ts": "export class A { ping() {} } export class B { ping() {} }\n" };
  const answer = { symbol: "ping", definitions: [definitionAt(1, "method:a", "first"), definitionAt(1, "method:b", "second")], total: 2 };
  const fixture = await codeGraphFixture({ callers: answer }, files);
  try {
    const facts = await load(fixture);
    const pings = facts.callers.filter((caller) => caller.declaration.name.endsWith("ping"));
    expect(pings.length).toBeGreaterThan(0);
    expect(pings.some((fact) => fact.provider === "codegraph")).toBe(false);
    expect(facts.callerCoverage.codegraph?.state).toBe("used");
  } finally {
    await fixture.cleanup();
  }
}, 30_000);

test.skipIf(process.platform === "win32")("picks the CodeGraph definition starting on the declaration's own line when several lie inside it", async () => {
  const files = { ...HEAD_FILES, "a.ts": "export function ping() {\n  return 1;\n}\n" };
  const answer = { symbol: "ping", definitions: [definitionAt(2, "function:inner", "inner"), definitionAt(1, "function:outer", "outer")], total: 2 };
  const fixture = await codeGraphFixture({ callers: answer }, files);
  try {
    const codegraph = pingFacts(await load(fixture)).filter((fact) => fact.provider === "codegraph");
    expect(codegraph).toHaveLength(1);
    expect(codegraph[0].callers.map((site) => site.enclosing)).toEqual(["outer"]);
  } finally {
    await fixture.cleanup();
  }
}, 30_000);
