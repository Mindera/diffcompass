import { expect, test } from "bun:test";
import { appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CALLER_SCAN_LIMITS, NAME_MATCH_LABEL, scanCapturedTree } from "../src/change-callers.ts";
import { loadChangeFacts } from "../src/change-facts.ts";
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
  const facts = await loadChangeFacts(comparison, { scanLimits: { ...CALLER_SCAN_LIMITS, millis: 60_000 } });
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
    const facts = await loadChangeFacts(fixture.comparison, { scanLimits: { ...CALLER_SCAN_LIMITS, millis: 60_000 } });
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
    const facts = await loadChangeFacts(fixture.comparison, { scanLimits: { files: 1, bytes: 1e9, millis: 1e9 } });
    expect(facts.callerCoverage.nameMatch?.stoppedBy).toBe("files");
    expect(facts.callerCoverage.nameMatch?.message.startsWith("Scanned 1 of")).toBe(true);
  } finally {
    await fixture.cleanup();
  }
}, 30_000);
