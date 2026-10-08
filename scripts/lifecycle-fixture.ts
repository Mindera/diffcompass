#!/usr/bin/env bun
// A fresh, local-only review of captured lifecycle code. No agent is invoked.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareTestFixture } from "../src/test-fixture.ts";
import { installStateMachineExample, stateMachineFile } from "../src/lifecycle-fixture.ts";
import { loadPersistedSession, savePersistedSession } from "../src/store.ts";
import { ReviewSession } from "../src/session.ts";
import { createRequestHandler } from "../src/server.ts";

const root = await mkdtemp(join(tmpdir(), "diffcompass-lifecycle-"));
const fixture = await prepareTestFixture({ root: join(root, "fixture"), extraFiles: { [stateMachineFile.path]: stateMachineFile } });
const saved = await loadPersistedSession(fixture.stateFile);
saved.name = "Lifecycle layout · captured receipt job fixture";
saved.preferences = { ...saved.preferences!, prefetchSteps: 0, showBriefing: false };
saved.selection = { ...saved.selection!, adapterId: "attached", modelId: "Fixture responder (not AI)" };
saved.bridgeToken = crypto.randomUUID();
saved.bridgeSequence = 0;
await installStateMachineExample(saved.outline!);
for (const phase of saved.outline!.phases) for (const step of phase.steps) step.explanation ??= step.objective;
await savePersistedSession(fixture.stateFile, saved);
const session = await ReviewSession.create(fixture.repository, undefined, {
  resume: true, stateFile: fixture.stateFile, attached: true, agentAdapters: [],
  callerModel: "Fixture responder (not AI)", diffPreferenceDirectory: join(root, "preferences"),
});
await session.startTour({ adapterId: "attached", modelId: "Fixture responder (not AI)" });
const handler = createRequestHandler(session, join(root, "sessions"));
const server = Bun.serve({
  hostname: "127.0.0.1", port: Number(process.env.DIFFCOMPASS_FIXTURE_PORT ?? 47786), idleTimeout: 60,
  fetch(request) {
    const url = new URL(request.url);
    const allowed = request.method === "GET" || ["/api/selection", "/api/current", "/api/preferences", "/api/explain"].includes(url.pathname);
    return allowed ? handler(request) : Response.json({ error: "This fixture is read-only outside local navigation." }, { status: 403 });
  },
});
console.log(`Lifecycle fixture: http://127.0.0.1:${server.port}/#token=${session.browserToken}`);
console.log(`Disposable review: ${fixture.stateFile}`);
