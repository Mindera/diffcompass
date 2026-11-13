import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadComparison } from "../src/git.ts";
import { runProcess } from "../src/process.ts";
import { parseTourExplanation, reconcileTourNotes } from "../src/tour-reading.ts";
import type { TourOutline } from "../src/types.ts";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

test("short summaries, expandable detail, and old attached-agent text are compatible", async () => {
  expect(await parseTourExplanation("First paragraph.\n\nMore mechanics.")).toEqual({ summary: "First paragraph.", detail: "More mechanics." });
  expect(await parseTourExplanation("First paragraph.\n\n```ts\ncall()\n```")).toEqual({ summary: "First paragraph.", detail: "```ts\ncall()\n```" });
  expect(await parseTourExplanation('```json\n{"summary":"Short.","detail":"Details."}\n```')).toEqual({ summary: "Short.", detail: "Details." });
  for (const message of ['{"summary":', '{"summary":""}', JSON.stringify({ summary: "word ".repeat(101) }), '{"summary":"Short.","notes":[{"kind":"test-gap","text":"No tests"}]}']) await expect(parseTourExplanation(message)).rejects.toThrow();
});

test("notes use immutable captured source, reject fabricated quotes, and stale on supporting changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "diffcompass-tour-notes-")); roots.push(root);
  const git = (...args: string[]) => runProcess(["git", ...args], root);
  await git("init", "-b", "main"); await git("config", "user.name", "Test"); await git("config", "user.email", "test@example.invalid");
  await writeFile(join(root, "app.ts"), "old()\n"); await writeFile(join(root, "guard.ts"), "if (state === Failed) retry()\n");
  await git("add", "."); await git("commit", "-m", "base"); await writeFile(join(root, "app.ts"), "newCode()\n");
  const comparison = await loadComparison(root, "HEAD");
  const anchor = { path: "guard.ts", side: "new" as const, startLine: 1, endLine: 1 };
  const note = { kind: "limitation", text: "Retry is guarded by the failed state.", sources: [{ anchor, quote: "if (state === Failed) retry()" }] };
  await writeFile(join(root, "guard.ts"), "if (state === Shown) retry()\n");
  const value = await parseTourExplanation(JSON.stringify({ summary: "The guard limits retry.", notes: [note] }), comparison);
  expect(value.notes?.[0]?.sources[0]?.blob).toMatch(/^[a-f0-9]{40,64}$/);
  await expect(parseTourExplanation(JSON.stringify({ summary: "Summary", notes: [{ ...note, sources: [{ anchor: { ...anchor, endLine: 50 }, quote: note.sources[0]!.quote }] }] }), comparison)).rejects.toThrow("exceeds captured source");
  await expect(parseTourExplanation(JSON.stringify({ summary: "Summary", notes: [{ ...note, sources: [{ anchor, quote: "if (state === Shown) retry()" }] }] }), comparison)).rejects.toThrow("does not match");
  const outline = { phases: [{ steps: [{ notes: value.notes }] }] } as TourOutline;
  await reconcileTourNotes(outline, comparison); expect(value.notes?.[0]?.outdated).toBe(false);
  const refreshed = await loadComparison(root, "HEAD"); await reconcileTourNotes(outline, refreshed); expect(value.notes?.[0]?.outdated).toBe(true);
  await expect(parseTourExplanation(JSON.stringify({ summary: "Summary", notes: [{ ...note, kind: "divergence" }] }), comparison)).rejects.toThrow("both sources");
  await expect(parseTourExplanation(JSON.stringify({ summary: "Summary", notes: [{ ...note, kind: "test-gap" }] }), comparison)).rejects.toThrow("inspected scope");
});
