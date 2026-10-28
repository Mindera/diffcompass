import { expect, test } from "bun:test";
import { appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { scanCapturedTree } from "../src/change-callers.ts";
import { capturedText, historicalComparison, repositoryComparison } from "./comparison-fixtures.ts";

const wide = { files: 10_000, bytes: 64 * 1024 * 1024, millis: 60_000 };
const names = new Set(["classifyRevisionFiles"]);

test("collects call sites from the captured head tree and reports full coverage", async () => {
  const comparison = await historicalComparison("8f84166", "740bada");
  const scan = await scanCapturedTree(comparison, "new", { names, limits: wide });
  const sites = scan.callSites.get("classifyRevisionFiles") ?? [];
  expect(sites.some((site) => site.path === "src/revision.ts" && site.line === 27 && site.enclosing !== null)).toBe(true);
  for (const site of sites) expect((await capturedText(comparison, "new", site.path)).split("\n")[site.line - 1]).toContain("classifyRevisionFiles");
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
