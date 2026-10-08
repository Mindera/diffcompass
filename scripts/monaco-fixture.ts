// The current per-file production renderer. PR mode adds synthetic read-only
// threads and a safety allowlist, never the legacy multi-file iframe harness.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { prepareTestFixture } from "../src/test-fixture.ts";
import { loadPersistedSession, savePersistedSession } from "../src/store.ts";
import { ReviewSession } from "../src/session.ts";
import { createRequestHandler, startServer } from "../src/server.ts";
import { assertEditablePrFixture, syntheticPrFixtureHandler } from "./monaco-fixture-support.ts";
import { contextFixtureFile } from "../prototypes/diff-viewer/fixtures.mjs";
import { addBeforeTourExamples } from "./monaco-before-tour-fixture.ts";

const resumeFile = process.env.DIFF_VIEWER_STATE ? resolve(process.env.DIFF_VIEWER_STATE) : undefined;
const samplePr = process.env.DIFF_VIEWER_PR_EXAMPLE === "1";
const beforeTour = process.env.DIFF_VIEWER_BEFORE_TOUR === "1";
const previewRedirect = process.argv.includes("--preview-redirect");
const root = resumeFile ? dirname(dirname(resumeFile)) : await mkdtemp(join(tmpdir(), "diffcompass-monaco-production-"));
let fixture: { repository: string; stateFile: string };
if (resumeFile) {
  const saved = await loadPersistedSession(resumeFile);
  if (samplePr && (saved.pullRequest?.repository !== "fixture/checkout" || !saved.pullRequest.url.startsWith("https://example.invalid/"))) throw Error("PR-example mode only accepts an explicitly synthetic fixture, never a real pull request.");
  fixture = { repository: saved.repositoryRoot, stateFile: resumeFile };
} else {
  const extraFiles: Record<string, { before: string; after: string }> = {};
  if (samplePr || beforeTour) extraFiles[contextFixtureFile.path] = contextFixtureFile;
  for (let i = 0; i < 12; i++) extraFiles[`src/lazy-${i}.ts`] = { before: "// Unchanged context\n".repeat(80) + "export const value = 1;\n", after: "// Unchanged context\n".repeat(80) + "export const value = 2;\n" };
  extraFiles["src/whitespace.py"] = { before: "if ready:\n    run()\n", after: "if ready:\n        run()\n" };
  extraFiles["large.txt"] = { before: "base\n", after: "x".repeat(256_001) };
  fixture = await prepareTestFixture({ root: join(root, "fixture"), extraFiles });
  const saved = await loadPersistedSession(fixture.stateFile);
  if (!samplePr) saved.pullRequest = undefined;
  else if (saved.pullRequest) {
    saved.name = "Monaco · sample PR comments and expandable context";
    saved.pullRequest.url = "https://example.invalid/fixture/pull/42";
    saved.pullRequest.linkedIssue = undefined;
    saved.pullRequest.threads = [{
      id: "monaco-sample-thread", path: "src/cart.ts", side: "new", line: 17, resolved: false,
      comments: [{ id: "monaco-sample-comment", author: "Alex (fixture)", body: "Could we document whether this percentage is fractional?", url: "https://example.invalid/comment/1" }],
    }];
    saved.outline!.phases[0]!.fileChanges.push({ path: contextFixtureFile.path, summary: "Expand unchanged context using the labelled gap buttons; the file grows with the page." });
  }
  if (saved.outline) delete saved.outline.issueAssessment;
  if (beforeTour) addBeforeTourExamples(saved);
  saved.preferences = { ...saved.preferences!, prefetchSteps: 0, showBriefing: false };
  saved.selection = { ...saved.selection!, adapterId: "attached", modelId: "Fixture responder (not AI)" };
  saved.bridgeToken = crypto.randomUUID(); saved.bridgeSequence = 0;
  await savePersistedSession(fixture.stateFile, saved);
}
if (samplePr) await assertEditablePrFixture(fixture);
const session = await ReviewSession.create(fixture.repository, undefined, { resume: true, stateFile: fixture.stateFile, attached: true, agentAdapters: [], callerModel: "Fixture responder (not AI)", diffPreferenceDirectory: join(root, "preferences") });
if (samplePr && (session.pullRequest?.repository !== "fixture/checkout" || !session.pullRequest.url.startsWith("https://example.invalid/"))) throw Error("PR-example mode only accepts an explicitly synthetic fixture, never a real pull request.");
if (!resumeFile) await session.startTour({ adapterId: "attached", modelId: "Fixture responder (not AI)" });
if (samplePr && !resumeFile) await session.addComment({ path: "src/cart.ts", side: "new", line: 17, body: "Same-line fixture: a local comment beside the sample PR thread." });
if (beforeTour && !resumeFile) {
  await session.addComment({ path: "src/cart.ts", side: "old", line: 6, body: "Before-side comment: this stays below the removed declaration, with both tour banners above it." });
  await session.addComment({ path: "src/context-example.ts", side: "old", line: 50, body: "Before context comment: tour navigation reveals this gap without changing its source side." });
}
let answering = false;
setInterval(async () => {
  if (answering) return; answering = true;
  try { for (const event of await session.bridge!.eventsAfter(0, 0, undefined, true)) if (event.type === "agent.prompt") await session.bridge!.respond(event.id, "Fixture response — not AI. No source was edited.", event.leaseId); }
  catch (error) { console.error(error); } finally { answering = false; }
}, 200);
const port = Number(process.env.DIFF_VIEWER_PORT || 47681);
const server = samplePr
  ? Bun.serve({ hostname: "127.0.0.1", port, idleTimeout: 60, fetch: syntheticPrFixtureHandler(createRequestHandler(session, join(root, "sessions"), undefined, previewRedirect), session.browserToken, () => assertEditablePrFixture(fixture)) })
  : startServer(session, port, join(root, "sessions"), previewRedirect);
console.log(`Production fixture: http://127.0.0.1:${server.port}/#token=${session.browserToken}`);
console.log(`Repository: ${fixture.repository}`);
console.log(`Session: ${fixture.stateFile}`);
