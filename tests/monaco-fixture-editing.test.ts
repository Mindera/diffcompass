import { expect, test } from "bun:test";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareTestFixture } from "../src/test-fixture.ts";
import { loadPersistedSession, savePersistedSession } from "../src/store.ts";
import { runProcess } from "../src/process.ts";
import { assertEditablePrFixture } from "../scripts/monaco-fixture-support.ts";

test("editable PR fixture validates ownership, paths, synthetic identity and Git isolation", async () => {
  const root = await mkdtemp(join(tmpdir(), "diffcompass-fixture-edit-safety-"));
  try {
    const fixture = await prepareTestFixture({ root: join(root, "fixture") });
    const saved = await loadPersistedSession(fixture.stateFile);
    saved.pullRequest!.url = "https://example.invalid/fixture/pull/42";
    await savePersistedSession(fixture.stateFile, saved);
    await expect(assertEditablePrFixture(fixture)).resolves.toBeUndefined();

    const other = await prepareTestFixture({ root: join(root, "other") });
    await expect(assertEditablePrFixture({ ...fixture, repository: other.repository })).rejects.toThrow("owned synthetic repository");
    saved.pullRequest!.sourceRepositoryRoot = other.repository;
    await savePersistedSession(fixture.stateFile, saved);
    await expect(assertEditablePrFixture(fixture)).rejects.toThrow("owned synthetic repository");
    saved.pullRequest!.sourceRepositoryRoot = fixture.repository;
    saved.pullRequest!.url = "https://github.com/fixture/checkout/pull/42";
    await savePersistedSession(fixture.stateFile, saved);
    await expect(assertEditablePrFixture(fixture)).rejects.toThrow("owned synthetic repository");
    saved.pullRequest!.url = "https://example.invalid/fixture/pull/42";
    await savePersistedSession(fixture.stateFile, saved);

    await runProcess(["git", "remote", "add", "origin", "https://example.invalid/not-a-real-remote"], fixture.repository);
    await expect(assertEditablePrFixture(fixture)).rejects.toThrow("Git remotes");
    await runProcess(["git", "remote", "remove", "origin"], fixture.repository);
    // Canonicalizing the session path must not permit a different repository.
    const linked = join(root, "linked"); await symlink(fixture.root, linked);
    await expect(assertEditablePrFixture({ ...fixture, repository: other.repository, stateFile: join(linked, "session.json") })).rejects.toThrow("owned synthetic repository");
    await expect(assertEditablePrFixture({ repository: root, stateFile: join(root, "session.json") })).rejects.toThrow("unowned fixture");
  } finally { await rm(root, { recursive: true, force: true }); }
});
