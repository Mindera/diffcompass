import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prepareTestFixture } from "../src/test-fixture.ts";
import { loadPersistedSession, savePersistedSession } from "../src/store.ts";
import { loadComparison } from "../src/git.ts";
import { captureTourEvidence } from "../src/tour-evidence.ts";
import { parseTourExplanation } from "../src/tour-reading.ts";
import { ReviewSession } from "../src/session.ts";
import { createRequestHandler } from "../src/server.ts";
import { exportReview } from "../src/export.ts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

test("persisted tours retain grouped sources and coverage, relocate content on refresh, then reject changed evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "diffcompass-tour-reading-")); roots.push(root);
  const before = Array.from({ length: 100 }, (_, i) => i === 59 ? "export const value = 1;" : `// stable context ${i + 1}`).join("\n") + "\n";
  const after = before.replace("value = 1", "value = 2");
  const fixture = await prepareTestFixture({ root: join(root, "fixture"), extraFiles: { "src/fresh.ts": { before, after } } });
  const saved = await loadPersistedSession(fixture.stateFile);
  const comparison = await loadComparison(fixture.repository, saved.base);
  const first = saved.outline!.phases[0]!.steps[0]!;
  saved.outline!.phases[0]!.fileChanges.push({ path: "src/fresh.ts", summary: "Changes the value." }, { path: "src/receipt.ts", summary: "Formats the value." });
  first.anchor = { path: "src/fresh.ts", side: "new", startLine: 60, endLine: 60 };
  first.relatedAnchors = [{ path: "src/receipt.ts", side: "new", startLine: 3, endLine: 5 }];
  first.importance = "key"; first.explanationDetail = "Details retained in saved tours.";
  first.notes = (await parseTourExplanation(JSON.stringify({ summary: "Summary", notes: [{ kind: "limitation", text: "The value is fixed.", sources: [{ anchor: first.anchor, quote: "export const value = 2;" }] }] }), comparison)).notes;
  for (const step of saved.outline!.phases.flatMap(phase => phase.steps)) step.evidence = captureTourEvidence(step, comparison);
  saved.preferences = { ...saved.preferences!, prefetchSteps: 0 }; saved.pullRequest = undefined; delete saved.outline!.issueAssessment;
  await savePersistedSession(fixture.stateFile, saved);
  const defaults = { resume: true, stateFile: fixture.stateFile, attached: true, agentAdapters: [], diffPreferenceDirectory: join(root, "preferences") };
  const session = await ReviewSession.create(fixture.repository, undefined, defaults);
  expect(session.outline!.phases[0]!.steps[0]!.freshness).toBe("current");
  expect(session.tourCode(first.id).groups.map(group => group.path)).toEqual(["src/fresh.ts", "src/receipt.ts"]);
  const initialCoverage = session.snapshot().tourCoverage;
  expect(initialCoverage.covered).toBeGreaterThan(0);
  expect(initialCoverage.uncovered.some(block => block.path === "screens/receipt.png")).toBe(true);
  for (const format of ["markdown", "html"] as const) {
    const result = exportReview(session, format).content;
    expect(result).toContain("Details retained in saved tours."); expect(result).toContain("Not covered"); expect(result).toContain("The value is fixed.");
  }
  const handler = createRequestHandler(session, join(root, "sessions"));
  const url = "http://127.0.0.1:47550/api/tour/code?stepId=" + first.id;
  expect((await handler(new Request(url))).status).toBe(401);
  const response = await handler(new Request(url, { headers: { "x-diffcompass-token": session.browserToken } }));
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  expect((await response.json()).groups).toHaveLength(2);
  await writeFile(join(fixture.repository, "src/fresh.ts"), "// inserted outside the changed block\n" + after);
  await session.refreshComparison({ source: "manual" });
  const relocated = session.outline!.phases[0]!.steps[0]!;
  expect(relocated.freshness).toBe("current"); expect(relocated.anchor.startLine).toBe(61);
  expect(relocated.notes?.[0]?.outdated).toBe(true); // Conservative supporting-file freshness.
  expect(session.snapshot().tourCoverage.covered).toBe(initialCoverage.covered);
  expect(session.snapshot().tourCoverage.total).toBe(initialCoverage.total + 1);
  const current = await readFile(join(fixture.repository, "src/fresh.ts"), "utf8");
  await writeFile(join(fixture.repository, "src/fresh.ts"), current.replace("value = 2", "value = 3"));
  await session.refreshComparison({ source: "manual" });
  expect(session.outline!.phases[0]!.steps[0]!.freshness).toBe("outdated"); expect(session.tourCode(first.id).groups).toEqual([]);
  const resumed = await ReviewSession.create(fixture.repository, undefined, defaults);
  expect(resumed.outline!.phases[0]!.steps[0]!.freshness).toBe("outdated");
  expect(resumed.snapshot().tourCoverage).toEqual(session.snapshot().tourCoverage);
}, 20_000);
