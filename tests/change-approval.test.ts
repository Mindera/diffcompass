import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyChangePatch, captureWorkingTreeSnapshot, createChangePatch, createProposalWorkspace, removeProposalWorkspace } from "../src/git.ts";
import { runProcess } from "../src/process.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

test("approval patches preserve binary, deleted, and untracked files through apply and undo", async () => {
  const root = await mkdtemp(join(tmpdir(), "review-tour-approval-"));
  directories.push(root);
  const repository = join(root, "repository");
  await mkdir(repository);
  await runProcess(["git", "init", "-b", "main"], repository);
  await runProcess(["git", "config", "user.name", "Review Tour Test"], repository);
  await runProcess(["git", "config", "user.email", "review-tour@example.test"], repository);
  await writeFile(join(repository, "remove.txt"), "remove me\n");
  await writeFile(join(repository, "asset.bin"), Uint8Array.from([0, 1, 2, 3, 4, 5]));
  await runProcess(["git", "add", "-A"], repository);
  await runProcess(["git", "commit", "-m", "base"], repository);

  const workspace = await createProposalWorkspace(repository);
  await unlink(join(workspace.path, "remove.txt"));
  await writeFile(join(workspace.path, "asset.bin"), Uint8Array.from([0, 9, 8, 7, 6, 5]));
  await writeFile(join(workspace.path, "new.txt"), "new proposal\n");
  const result = await captureWorkingTreeSnapshot(workspace.path);
  const patch = await createChangePatch(workspace.path, workspace.tree, result.tree);
  await removeProposalWorkspace(repository, workspace);

  expect(await readFile(join(repository, "remove.txt"), "utf8")).toBe("remove me\n");
  expect(await Bun.file(join(repository, "new.txt")).exists()).toBe(false);
  expect([...await readFile(join(repository, "asset.bin"))]).toEqual([0, 1, 2, 3, 4, 5]);

  await applyChangePatch(repository, patch);
  expect(await Bun.file(join(repository, "remove.txt")).exists()).toBe(false);
  expect(await readFile(join(repository, "new.txt"), "utf8")).toBe("new proposal\n");
  expect([...await readFile(join(repository, "asset.bin"))]).toEqual([0, 9, 8, 7, 6, 5]);

  await applyChangePatch(repository, patch, true);
  expect(await readFile(join(repository, "remove.txt"), "utf8")).toBe("remove me\n");
  expect(await Bun.file(join(repository, "new.txt")).exists()).toBe(false);
  expect([...await readFile(join(repository, "asset.bin"))]).toEqual([0, 1, 2, 3, 4, 5]);
});
