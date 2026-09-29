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
  const parent = await mkdtemp(join(tmpdir(), "diffcompass-fixture-test-"));
  directories.push(parent);
  const root = join(parent, "fixture");
  const created = await prepareTestFixture({ root });
  const persisted = await loadPersistedSession(created.stateFile);

  expect(created.created).toBe(true);
  expect(persisted.outline?.phases).toHaveLength(2);
  expect(persisted.outline?.structuralBlastRadii?.map((radius) => [radius.symbol.symbol, radius.coverage?.state])).toEqual([
    ["total", "complete"], ["subtotal", "complete"], ["Discount", "partial"], ["receipt", "unavailable"],
  ]);
  expect(persisted.outline?.structuralBlastRadii?.map((radius) => [radius.symbol.symbol, radius.testEvidence?.state])).toEqual([
    ["total", "relevant-tests-found"], ["subtotal", "relevant-tests-found"], ["Discount", "limited"], ["receipt", "not-assessed"],
  ]);
  expect(persisted.outline?.structuralBlastRadii?.[0]?.testEvidence?.relevantTests).toMatchObject([
    { path: "tests/cart.test.ts", side: "new", line: 5 },
  ]);
  expect(persisted.outline?.structuralBlastRadii?.[0]?.testEvidence?.checkedSources[0]?.detail).toBe("Checks the formatted receipt amount when a discount is supplied.");
  expect(persisted.outline?.structuralBlastRadii?.[0]?.testEvidence?.relevantTests[0]?.detail).toBe("The receipt calls total.");
  const subtotalRadius = persisted.outline?.structuralBlastRadii?.find((radius) => radius.symbol.symbol === "subtotal");
  expect(subtotalRadius?.reportedReachableNodeCount).toBe(3);
  expect(subtotalRadius?.nodes.map((node) => node.id)).toEqual([
    "src/cart.ts:new:10:subtotal", "src/cart.ts:new:14:total", "src/receipt.ts:new:3:receipt", "fixture:external:checkout",
  ]);
  expect(persisted.outline?.phases.flatMap((phase) => phase.steps)).toHaveLength(4);
  expect(persisted.outline?.phases.flatMap((phase) => phase.steps).map((step) => Boolean(step.explanation))).toEqual([true, false, false, false]);
  expect(persisted.outline?.architecture?.dependencyChanges).toHaveLength(2);
  expect(persisted.outline?.behaviorArchitectureStatus).toBe("implemented");
  expect(persisted.outline?.behaviorArchitecture?.dependencyChanges).toHaveLength(2);
  expect(persisted.outline?.stateDiagram?.kind).toBe("state-machine");
  expect(persisted.outline?.dataModel?.kind).toBe("data-model");
  expect(persisted.outline?.callFlows).toHaveLength(1);
  expect(persisted.outline?.callFlows[0]?.edges).toHaveLength(2);
  expect(persisted.outline?.flows).toHaveLength(1);
  expect(persisted.outline?.dryRunPlans).toHaveLength(1);
  expect(persisted.outline?.dryRunPlans?.[0]?.scenarios.map((scenario) => scenario.id)).toEqual(["fractional-discount", "no-discount", "ambiguous-percentage", "empty-cart"]);
  expect(persisted.dryRuns).toHaveLength(1);
  expect(persisted.dryRuns?.[0]?.detail).toBe("compact");
  expect(persisted.dryRuns?.[0]?.steps).toHaveLength(6);
  expect(persisted.dryRuns?.[0]?.outcome.value).toBe("Total: 20.00");
  expect(persisted.outline?.findings.map((finding) => finding.priority)).toEqual(["P1", "P3"]);
  expect(persisted.pullRequest).toMatchObject({
    repository: "fixture/checkout",
    number: 42,
    linkedIssue: { number: 24, access: "available", criteriaStatus: "found" },
    providerScope: { linkedIssue: "same-repository-closing-issue", relatedResources: "not-requested" },
  });
  expect(persisted.outline?.issueAssessment?.items.map((item) => item.status)).toEqual(["implemented", "implemented", "missing", "unclear"]);
  expect(persisted.comments).toHaveLength(1);
  expect(persisted.activities).toHaveLength(1);

  const session = await ReviewSession.create(created.repository, undefined, {
    stateFile: created.stateFile,
    resume: true,
    agentAdapters: [],
  });
  expect(session.snapshot().needsAttention.signals.map((signal) => signal.kind)).toEqual(["finding", "public-contract", "public-contract", "tests"]);
  expect(session.snapshot().needsAttention.estimate.factors.some((factor) => factor.label === "P0/P1 findings")).toBe(true);
  expect(session.comparison.files.map((file) => file.path)).toEqual(["README.md", "docs/checkout-guide.md", "docs/preview.md", "screens/receipt.png", "src/cart.ts", "src/receipt.ts", "tests/cart.test.ts"]);
  expect(session.comparison.files.find((file) => file.path === "docs/checkout-guide.md")?.status).toBe("modified");
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
