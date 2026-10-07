import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, rename, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadComparison } from "../src/git.ts";
import { runProcess } from "../src/process.ts";
import { diffSourceIdentity, diffSourceManifest, loadDiffSource, MAX_SOURCE_BYTES } from "../src/diff-sources.ts";
import { createRequestHandler } from "../src/server.ts";
import { ReviewSession } from "../src/session.ts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "diffcompass-sources-")); roots.push(root);
  const git = (...args: string[]) => runProcess(["git", ...args], root);
  await git("init", "-b", "main"); await git("config", "user.name", "Test"); await git("config", "user.email", "test@example.invalid");
  await writeFile(join(root, "main.py"), "if ready:\n    run()\n");
  await writeFile(join(root, "rename.txt"), "stable rename contents\n".repeat(10));
  await writeFile(join(root, "deleted.txt"), "old only\n");
  await git("add", "."); await git("commit", "-m", "base");
  await writeFile(join(root, "main.py"), "if ready:\n        run()\n");
  await rename(join(root, "rename.txt"), join(root, "renamed.txt"));
  await rm(join(root, "deleted.txt"));
  await writeFile(join(root, "added.txt"), "captured new\r\n");
  await git("add", ".");
  const comparison = await loadComparison(root, "HEAD");
  return { root, git, comparison };
}

test("captured source API is immutable, including working-tree comparisons, renames and absent sides", async () => {
  const { root, comparison } = await fixture();
  const manifest = diffSourceManifest(comparison);
  expect(manifest.files.find(file => file.path === "main.py")?.language).toBe("python");
  expect(JSON.stringify(manifest)).not.toContain("run()");
  await writeFile(join(root, "main.py"), "different workspace contents\n");
  const source = await loadDiffSource(comparison, manifest.comparisonId, "main.py");
  expect(source.available).toBe(true);
  if (source.available) { expect(source.old).toBe("if ready:\n    run()\n"); expect(source.new).toBe("if ready:\n        run()\n"); expect(source.blobs.old).not.toBe(source.blobs.new); }
  const added = await loadDiffSource(comparison, manifest.comparisonId, "added.txt");
  expect(added.available && added.old).toBe(""); expect(added.available && added.new).toBe("captured new\r\n");
  const deleted = await loadDiffSource(comparison, manifest.comparisonId, "deleted.txt");
  expect(deleted.available && deleted.new).toBe("");
  const renamed = await loadDiffSource(comparison, manifest.comparisonId, "renamed.txt");
  expect(renamed.available && renamed.old).toBe(renamed.available && renamed.new);
  await expect(loadDiffSource(comparison, "stale", "main.py")).rejects.toMatchObject({ status: 409 });
  await expect(loadDiffSource(comparison, manifest.comparisonId, "../secret")).rejects.toMatchObject({ status: 404 });
  expect(diffSourceIdentity({ ...comparison, sourceTree: "a".repeat(40) })).not.toBe(manifest.comparisonId);
});

test("unavailable files are isolated; bounded, literal, UTF-8 regular blob loading fails closed", async () => {
  const { root } = await fixture();
  await writeFile(join(root, "oversized.txt"), "x".repeat(MAX_SOURCE_BYTES + 1));
  await writeFile(join(root, "binary.txt"), new Uint8Array([97, 0, 98]));
  await writeFile(join(root, "encoding.txt"), new Uint8Array([0xff, 0xfe, 97]));
  await writeFile(join(root, ":[glob].txt"), "literal file\n");
  if (process.platform !== "win32") await symlink("main.py", join(root, "link.txt"));
  const comparison = await loadComparison(root, "HEAD"), id = diffSourceIdentity(comparison);
  for (const path of ["oversized.txt", "binary.txt", "encoding.txt", ...(process.platform === "win32" ? [] : ["link.txt"])]) {
    const source = await loadDiffSource(comparison, id, path); expect(source.available).toBe(false);
    expect("old" in source).toBe(false);
  }
  const literal = await loadDiffSource(comparison, id, ":[glob].txt");
  expect(literal.available && literal.new).toBe("literal file\n");
  expect((await loadDiffSource(comparison, id, "main.py")).available).toBe(true);
  const legacy = { ...comparison, sourceTree: undefined };
  expect((await loadDiffSource(legacy, diffSourceIdentity(legacy), "main.py")).available).toBe(false);
});

test("normal server authenticates source routes and rejects stale writes; Monaco frame is same-origin only", async () => {
  const { root, comparison } = await fixture();
  type Constructor = new (value: typeof comparison, adapters: [], defaults: Record<string, never>) => ReviewSession;
  const session = new (ReviewSession as unknown as Constructor)(comparison, [], {});
  const handler = createRequestHandler(session, join(root, "sessions"));
  const request = (path: string, init?: RequestInit) => handler(new Request("http://127.0.0.1:47550" + path, init));
  expect((await request("/api/diff/sources")).status).toBe(401);
  const headers = { "x-diffcompass-token": session.browserToken };
  const manifest = await (await request("/api/diff/sources", { headers })).json();
  const source = await request(`/api/diff/sources?comparisonId=${manifest.comparisonId}&path=main.py`, { headers });
  expect(source.status).toBe(200); expect(source.headers.get("cache-control")).toBe("no-store");
  expect((await request("/api/files/reviewed", { method: "POST", headers: { ...headers, origin: "http://127.0.0.1:47550", "content-type": "application/json", "x-diffcompass-comparison": "stale" }, body: JSON.stringify({ path: "main.py", reviewed: true }) })).status).toBe(409);
  const frame = await request("/monaco/index.html");
  expect(frame.status).toBe(200); expect(frame.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  expect(frame.headers.get("content-security-policy")).toContain("frame-ancestors 'self'");
  expect(frame.headers.get("content-security-policy")).not.toContain("unsafe-eval");
  expect((await request("/")).headers.get("x-frame-options")).toBe("DENY");
  expect((await request("/monaco-controller.mjs")).status).toBe(200);
  expect((await request("/vendor/vs/loader.js")).status).toBe(200);
  expect((await request("/vendor/vs/nonexistent.js")).status).toBe(404);
});

test("queued comments and reviewed-file writes recheck captured identity after a comparison changes", async () => {
  const { comparison } = await fixture();
  type Constructor = new (value: typeof comparison, adapters: [], defaults: Record<string, never>) => ReviewSession;
  const session = new (ReviewSession as unknown as Constructor)(comparison, [], {});
  const identity = diffSourceIdentity(comparison);
  const snapshot = await session.addComment({ path: "main.py", side: "new", line: 2, body: "Original comment" }, identity);
  const comment = snapshot.comments[0]!;
  // Hold the same serialized mutation queue used by refresh. Both requests
  // enter while their identity is valid, but execute after the source changes.
  let release!: () => void;
  (session as unknown as { mutationQueue: Promise<void> }).mutationQueue = new Promise(resolve => { release = resolve; });
  const add = session.addComment({ path: "main.py", side: "new", line: 2, body: "Stale new comment" }, identity);
  const edit = session.updateComment(comment.id, "Stale edit", identity);
  const reviewed = session.setFileReviewed("main.py", true, identity);
  const results = Promise.allSettled([add, edit, reviewed]);
  session.comparison = { ...comparison, sourceTree: "a".repeat(40) };
  release();
  for (const result of await results) {
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.reason.message).toContain("previous comparison");
  }
  expect(session.snapshot().comments).toHaveLength(1);
  expect(session.snapshot().comments[0]!.body).toBe("Original comment");
  expect(session.snapshot().reviewedFiles).not.toContain("main.py");
  expect(session.snapshot().revision).toBe(snapshot.revision);
});
