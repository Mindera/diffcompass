import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rename, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadComparison, loadDiffImage } from "../src/git.ts";
import { runProcess } from "../src/process.ts";
import { createRequestHandler } from "../src/server.ts";
import { ReviewSession } from "../src/session.ts";
import type { GitComparison } from "../src/types.ts";

const roots: string[] = [];
const before = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=", "base64");
// Distinct valid PNG, including transparent pixels.
const after = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "review-tour-png-"));
  roots.push(root);
  const repository = join(root, "repository");
  await mkdir(repository);
  const git = (...args: string[]) => runProcess(["git", ...args], repository);
  await git("init", "-b", "main");
  await git("config", "user.name", "PNG Test");
  await git("config", "user.email", "png@example.test");
  await mkdir(join(repository, "screens"));
  for (const path of ["modified.png", "deleted.png", "renamed.png", "unchanged.png", "screens/escape.png"]) {
    await writeFile(join(repository, path), path === "deleted.png" ? after : before);
  }
  await git("add", ".");
  await git("commit", "-m", "Base screenshots");
  await writeFile(join(repository, "modified.png"), after);
  await rm(join(repository, "deleted.png"));
  await rename(join(repository, "renamed.png"), join(repository, "new name.png"));
  await git("add", "renamed.png", "new name.png");
  await writeFile(join(repository, "added.PNG"), after);
  const comparison = await loadComparison(repository, "main");
  return { root, repository, comparison, git };
}

test("PNG diffs read exact baseline and working-tree bytes, including renamed and untracked images", async () => {
  const { comparison } = await fixture();
  expect(comparison.files.find((file) => file.path === "added.PNG")).toMatchObject({ status: "added", oldPath: null });
  expect(comparison.files.find((file) => file.path === "deleted.png")).toMatchObject({ status: "deleted", newPath: null });
  expect(comparison.files.find((file) => file.path === "new name.png")).toMatchObject({ status: "renamed", oldPath: "renamed.png" });
  for (const [path, side, bytes] of [
    ["modified.png", "old", before], ["modified.png", "new", after],
    ["added.PNG", "new", after], ["deleted.png", "old", after],
    ["new name.png", "old", before], ["new name.png", "new", before],
  ] as const) {
    const image = await loadDiffImage(comparison, path, side);
    expect(image.mimeType).toBe("image/png");
    expect(Buffer.from(image.data)).toEqual(bytes);
  }
  await expect(loadDiffImage(comparison, "added.PNG", "old")).rejects.toThrow("no old version");
  await expect(loadDiffImage(comparison, "deleted.png", "new")).rejects.toThrow("no new version");
  await expect(loadDiffImage(comparison, "unchanged.png", "new")).rejects.toThrow("does not exist");
  await expect(loadDiffImage(comparison, "../modified.png", "new")).rejects.toThrow("does not exist");
});

test("image reads reject invalid PNGs, symlinks, parent escapes, missing files and oversized versions", async () => {
  const { root, repository, comparison, git } = await fixture();
  await writeFile(join(repository, "modified.png"), "Not a PNG");
  await expect(loadDiffImage(comparison, "modified.png", "new")).rejects.toThrow("not a valid PNG");
  await rm(join(repository, "modified.png"));
  await expect(loadDiffImage(comparison, "modified.png", "new")).rejects.toThrow("unavailable");
  await writeFile(join(root, "outside.png"), before);
  await symlink(join(root, "outside.png"), join(repository, "modified.png"));
  await expect(loadDiffImage(comparison, "modified.png", "new")).rejects.toThrow("unavailable");
  await writeFile(join(repository, "screens/escape.png"), after);
  const escaped = await loadComparison(repository, "main");
  await rm(join(repository, "screens"), { recursive: true });
  await mkdir(join(root, "outside"));
  await writeFile(join(root, "outside/escape.png"), after);
  await symlink(join(root, "outside"), join(repository, "screens"));
  await expect(loadDiffImage(escaped, "screens/escape.png", "new")).rejects.toThrow("path is invalid");
  await truncate(join(repository, "added.PNG"), 20 * 1024 * 1024 + 1);
  await expect(loadDiffImage(comparison, "added.PNG", "new")).rejects.toThrow("too large");
  await git("add", "added.PNG");
  const tree = (await git("write-tree")).stdout.trim();
  const oversizedBase = { ...comparison, mergeBase: tree, files: [{ ...comparison.files.find((file) => file.path === "added.PNG")!, oldPath: "added.PNG" }] };
  await expect(loadDiffImage(oversizedBase, "added.PNG", "old")).rejects.toThrow("too large");
});

test("PNG endpoint requires session authentication and returns private binary image responses", async () => {
  const { root, comparison } = await fixture();
  type Constructor = new (comparison: GitComparison, adapters: [], defaults: Record<string, never>) => ReviewSession;
  const session = new (ReviewSession as unknown as Constructor)(comparison, [], {});
  const fetch = createRequestHandler(session, join(root, "sessions"));
  const request = (path: string, authenticated = true) => fetch(new Request(`http://127.0.0.1${path}`, {
    headers: authenticated ? { "x-review-tour-token": session.browserToken } : {},
  }));
  expect((await request("/api/diff/image?path=modified.png&side=new", false)).status).toBe(401);
  const response = await request("/api/diff/image?path=modified.png&side=old");
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/png");
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(Buffer.from(await response.arrayBuffer())).toEqual(before);
  expect((await request("/api/diff/image?path=modified.png&side=invalid")).status).toBe(422);
  expect((await request("/api/diff/image?path=unchanged.png&side=new")).status).toBe(409);
  expect((await request("/api/diff/image?path=deleted.png&side=new")).status).toBe(409);
});
