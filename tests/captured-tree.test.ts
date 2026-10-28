import { expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { listCapturedTree, readCapturedBlobs } from "../src/captured-tree.ts";
import { runProcess } from "../src/process.ts";
import { capturedText, historicalComparison, repositoryComparison } from "./comparison-fixtures.ts";

test("lists the captured tree with blob sizes for both sides", async () => {
  const comparison = await historicalComparison("8f84166", "740bada");
  const head = await listCapturedTree(comparison, "new");
  expect(head.map((entry) => entry.path)).toEqual(comparison.repositoryFiles);
  const revision = head.find((entry) => entry.path === "src/revision.ts");
  expect(revision?.size).toBe(Buffer.byteLength(await capturedText(comparison, "new", "src/revision.ts")));
  const base = await listCapturedTree(comparison, "old");
  expect(base.some((entry) => entry.path === "src/revision.ts")).toBe(false);
}, 30_000);

test("reads captured blobs through one process", async () => {
  const comparison = await historicalComparison("8f84166", "740bada");
  const head = await listCapturedTree(comparison, "new");
  const revision = head.find((entry) => entry.path === "src/revision.ts")!;
  const gitFile = head.find((entry) => entry.path === "src/git.ts")!;
  const blobs = await readCapturedBlobs(comparison, [revision.oid, gitFile.oid, revision.oid]);
  expect(blobs.get(revision.oid)).toBe(await capturedText(comparison, "new", "src/revision.ts"));
  expect(blobs.get(gitFile.oid)).toBe(await capturedText(comparison, "new", "src/git.ts"));
}, 30_000);

test("reports a timed-out blob read as a timeout every time", async () => {
  const comparison = await historicalComparison("8f84166", "740bada");
  const oids = (await listCapturedTree(comparison, "new")).map((entry) => entry.oid);
  for (let attempt = 0; attempt < 20; attempt++) {
    await expect(readCapturedBlobs(comparison, oids, 1)).rejects.toThrow(/^Reading captured blobs timed out\.$/);
  }
}, 30_000);

test("maps binary and missing blobs to null", async () => {
  const fixture = await repositoryComparison({}, {});
  try {
    await writeFile(join(fixture.root, "logo.bin"), new Uint8Array([0, 1, 2]));
    await runProcess(["git", "add", "-A"], fixture.root);
    await runProcess(["git", "commit", "-m", "binary"], fixture.root);
    const tree = (await runProcess(["git", "rev-parse", "HEAD"], fixture.root)).stdout.trim();
    const comparison = { ...fixture.comparison, sourceTree: tree };
    const entry = (await listCapturedTree(comparison, "new")).find((item) => item.path === "logo.bin")!;
    const blobs = await readCapturedBlobs(comparison, [entry.oid, "0".repeat(40)]);
    expect(blobs.get(entry.oid)).toBeNull();
    expect(blobs.get("0".repeat(40))).toBeNull();
  } finally {
    await fixture.cleanup();
  }
}, 30_000);
