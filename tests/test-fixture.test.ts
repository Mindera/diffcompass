import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReviewSession } from "../src/session.ts";
import { loadPersistedSession, savePersistedSession } from "../src/store.ts";
import { prepareTestFixture } from "../src/test-fixture.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

test("materializes, resumes, and resets a complete deterministic tour fixture", async () => {
  const parent = await mkdtemp(join(tmpdir(), "review-tour-fixture-test-"));
  directories.push(parent);
  const root = join(parent, "fixture");
  const created = await prepareTestFixture({ root });
  const persisted = await loadPersistedSession(created.stateFile);

  expect(created.created).toBe(true);
  expect(persisted.outline?.phases).toHaveLength(2);
  expect(persisted.outline?.phases.flatMap((phase) => phase.steps)).toHaveLength(4);
  expect(persisted.outline?.phases.flatMap((phase) => phase.steps).map((step) => Boolean(step.explanation))).toEqual([true, false, false, false]);
  expect(persisted.outline?.architecture?.dependencyChanges).toHaveLength(2);
  expect(persisted.outline?.behaviorArchitectureStatus).toBe("implemented");
  expect(persisted.outline?.behaviorArchitecture?.dependencyChanges).toHaveLength(2);
  expect(persisted.outline?.callFlows).toHaveLength(1);
  expect(persisted.outline?.callFlows[0]?.edges).toHaveLength(2);
  expect(persisted.outline?.flows).toHaveLength(1);
  expect(persisted.outline?.findings.map((finding) => finding.priority)).toEqual(["P1", "P3"]);
  expect(persisted.comments).toHaveLength(1);
  expect(persisted.activities).toHaveLength(1);

  const session = await ReviewSession.create(created.repository, undefined, {
    stateFile: created.stateFile,
    resume: true,
    agentAdapters: [],
  });
  expect(session.comparison.files.map((file) => file.path)).toEqual(["README.md", "screens/receipt.png", "src/cart.ts", "docs/preview.md", "src/receipt.ts"]);
  expect(session.currentStepIndex).toBe(0);
  await session.dispose();

  persisted.revision = 9;
  await savePersistedSession(created.stateFile, persisted);
  const resumed = await prepareTestFixture({ root });
  expect(resumed.created).toBe(false);
  expect((await loadPersistedSession(resumed.stateFile)).revision).toBe(9);

  const reset = await prepareTestFixture({ root, reset: true });
  expect(reset.created).toBe(true);
  expect((await loadPersistedSession(reset.stateFile)).revision).toBe(4);
});

test("fixture launcher starts the persisted tour so prepare-ahead begins immediately", async () => {
  const launcher = await readFile(join(import.meta.dir, "..", "scripts", "test-fixture.ts"), "utf8");
  expect(launcher).toContain('fixture.stateFile,\n  "--start-tour",\n  ...forwarded');
});
