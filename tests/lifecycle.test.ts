import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProcess } from "../src/process.ts";
import { ReviewSession } from "../src/session.ts";
import { loadPersistedSession, savePersistedSession } from "../src/store.ts";
import type { PersistedReviewSession } from "../src/types.ts";

const directories: string[] = [];
const noAdapters = { agentAdapters: [] };

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function git(cwd: string, ...args: string[]) {
  return runProcess(["git", ...args], cwd);
}

async function repositoryFixture() {
  const directory = await mkdtemp(join(tmpdir(), "review-tour-lifecycle-"));
  directories.push(directory);
  const repository = join(directory, "repository");
  await mkdir(repository);
  await git(repository, "init", "-b", "main");
  await git(repository, "config", "user.name", "Review Tour Test");
  await git(repository, "config", "user.email", "review-tour@example.test");
  await writeFile(join(repository, "app.ts"), "const base = 1;\n");
  await git(repository, "add", "app.ts");
  await git(repository, "commit", "-m", "base");
  const base = (await git(repository, "rev-parse", "HEAD")).stdout.trim();
  await git(repository, "update-ref", "refs/remotes/origin/main", base);
  await git(repository, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  await git(repository, "switch", "-c", "feature");
  await writeFile(join(repository, "app.ts"), "const base = 1;\nconst changed = 2;\n");
  return { directory, repository: await realpath(repository), stateFile: join(directory, "session.json") };
}

function persistedAttachedSession(repositoryRoot: string, overrides: Partial<PersistedReviewSession> = {}): PersistedReviewSession {
  return {
    schemaVersion: 2,
    repositoryRoot,
    base: "origin/main",
    browserToken: "browser-token",
    bridgeToken: "bridge-token",
    bridgeSequence: 7,
    outline: {
      title: "A resumed review",
      summary: "Continue from the saved stop.",
      phases: [{
        id: "behavior",
        title: "Changed behavior",
        summary: "Inspect the changed behavior.",
        fileChanges: [{ path: "app.ts", summary: "Contains the changed behavior." }],
        steps: [{
          id: "first-step",
          title: "First step",
          objective: "Review the changed line.",
          anchor: { path: "app.ts", side: "new", startLine: 2, endLine: 2 },
        },
        {
          id: "second-step",
          title: "Second step",
          objective: "Review the same changed line from another angle.",
          anchor: { path: "app.ts", side: "new", startLine: 2, endLine: 2 },
        }],
      }, {
        id: "verification",
        title: "Verification",
        summary: "Verify the changed behavior.",
        fileChanges: [{ path: "app.ts", summary: "Provides the behavior to verify." }],
        steps: [{
          id: "third-step",
          title: "Verification stop",
          objective: "Verify the changed line.",
          anchor: { path: "app.ts", side: "new", startLine: 2, endLine: 2 },
        }],
      }],
      flows: [],
      findings: [],
    },
    currentStepIndex: 1,
    comments: [],
    messages: [],
    revision: 4,
    status: "open",
    selection: { adapterId: "attached", modelId: "current-session" },
    updatedAt: "2026-08-08T00:00:00.000Z",
    ...overrides,
  };
}

function proposalWorkspace(prompt: { type: string; prompt?: string }): string {
  const match = /isolated proposal workspace ("(?:\\.|[^"])*")/.exec(prompt.prompt ?? "");
  if (!match) throw new Error("Attached prompt did not include a proposal workspace.");
  return JSON.parse(match[1]) as string;
}

test("attached sessions optionally display the caller model and effort", async () => {
  const { repository, stateFile } = await repositoryFixture();
  const session = await ReviewSession.create(repository, undefined, {
    ...noAdapters,
    stateFile,
    attached: true,
    callerModel: "gpt-5.6-codex",
    callerReasoningEffort: "high",
  });

  expect(session.snapshot().agentAdapters[0]).toMatchObject({
    id: "attached",
    models: [{
      id: "gpt-5.6-codex",
      label: "gpt-5.6-codex · current session",
      defaultReasoningEffort: "high",
      reasoningEfforts: ["high"],
    }],
  });
  expect(session.snapshot().agentSelection).toEqual({
    adapterId: "attached",
    modelId: "gpt-5.6-codex",
    reasoningEffort: "high",
    includeFlows: true,
    includeFindings: true,
  });
});

test("session defaults can disable findings, reject a browser override, and survive resume", async () => {
  const { repository, stateFile } = await repositoryFixture();
  const session = await ReviewSession.create(repository, undefined, {
    stateFile,
    includeFindings: false,
    agentAdapters: [{
      id: "codex",
      label: "Codex",
      modelDiscovery: "default-only",
      models: [{ id: "default", label: "Default", isDefault: true, reasoningEfforts: [] }],
    }],
  });

  expect(session.snapshot()).toMatchObject({
    findingGenerationEnabled: false,
    agentSelection: { includeFindings: false },
  });
  expect((session as unknown as { resolveSelection(input: { includeFindings: boolean }): { includeFindings?: boolean } })
    .resolveSelection({ includeFindings: true }).includeFindings).toBe(false);

  const resumed = await ReviewSession.create(repository, undefined, {
    stateFile,
    resume: true,
    agentAdapters: [{
      id: "codex",
      label: "Codex",
      modelDiscovery: "default-only",
      models: [{ id: "default", label: "Default", isDefault: true, reasoningEfforts: [] }],
    }],
  });
  expect(resumed.snapshot().findingGenerationEnabled).toBe(false);

  const enabledStateFile = join(repository, "..", "enabled-session.json");
  await savePersistedSession(enabledStateFile, {
    ...(await loadPersistedSession(stateFile)),
    findingGenerationEnabled: true,
  });
  const explicitlyDisabledResume = await ReviewSession.create(repository, undefined, {
    stateFile: enabledStateFile,
    resume: true,
    includeFindings: false,
    agentAdapters: [{
      id: "codex",
      label: "Codex",
      modelDiscovery: "default-only",
      models: [{ id: "default", label: "Default", isDefault: true, reasoningEfforts: [] }],
    }],
  });
  expect(explicitlyDisabledResume.snapshot().findingGenerationEnabled).toBe(false);
});

test("a resumed open attached session retains its stop and drives the rehydrated agent bridge", async () => {
  const { repository, stateFile } = await repositoryFixture();
  await savePersistedSession(stateFile, persistedAttachedSession(repository));

  const session = await ReviewSession.create(repository, undefined, { ...noAdapters, stateFile, resume: true });
  const bridge = session.bridge;
  if (!bridge) throw new Error("Expected an attached bridge after resume.");
  expect(session.snapshot().currentStepIndex).toBe(1);

  const started = session.startTour();
  const [prompt] = await bridge.eventsAfter(7, 1_000);
  expect(prompt).toMatchObject({ sequence: 8, type: "agent.prompt", kind: "tour.explanation" });
  await bridge.respond(prompt!.id, "This is the saved second stop.");
  await bridge.ack(prompt!.id);

  const snapshot = await started;
  expect(snapshot.currentStepIndex).toBe(1);
  expect(snapshot.outline?.phases[0]?.steps[1]?.explanation).toBe("This is the saved second stop.");

  const [prefetch] = await bridge.eventsAfter(8, 1_000);
  expect(prefetch).toMatchObject({ sequence: 9, type: "agent.prompt", kind: "tour.explanation" });
  if (!prefetch || prefetch.type !== "agent.prompt") throw new Error("Expected a prefetched explanation prompt.");
  expect(prefetch.prompt).toContain("Verification stop");
  await bridge.respond(prefetch!.id, "The next stop was prepared before navigation.");
  for (let attempt = 0; attempt < 20 && !session.snapshot().outline?.phases[1]?.steps[0]?.explanation; attempt += 1) {
    await Bun.sleep(5);
  }
  expect(session.snapshot().outline?.phases[1]?.steps[0]?.explanation).toBe("The next stop was prepared before navigation.");
});

test("prefetch continuously prepares later stops without blocking navigation to a ready stop", async () => {
  const { repository, stateFile } = await repositoryFixture();
  const persisted = persistedAttachedSession(repository);
  persisted.currentStepIndex = 0;
  persisted.outline!.phases[0]!.steps[0]!.explanation = "The current stop is already ready.";
  persisted.outline!.phases[1]!.steps.push({
    id: "fourth-step",
    title: "Final verification",
    objective: "Finish verifying the changed line.",
    anchor: { path: "app.ts", side: "new", startLine: 2, endLine: 2 },
  });
  await savePersistedSession(stateFile, persisted);

  const session = await ReviewSession.create(repository, undefined, { ...noAdapters, stateFile, resume: true });
  await session.startTour();
  const bridge = session.bridge!;

  const [secondPrompt] = await bridge.eventsAfter(7, 1_000);
  if (!secondPrompt || secondPrompt.type !== "agent.prompt") throw new Error("Expected the second stop prefetch.");
  expect(secondPrompt.prompt).toContain("Second step");
  await bridge.respond(secondPrompt.id, "The second stop is ready.");
  await bridge.ack(secondPrompt.id);

  const [thirdPrompt] = await bridge.eventsAfter(secondPrompt.sequence, 1_000);
  if (!thirdPrompt || thirdPrompt.type !== "agent.prompt") throw new Error("Expected continuous prefetch for the third stop.");
  expect(thirdPrompt.prompt).toContain("Verification stop");

  const navigation = await Promise.race([
    session.navigate("next"),
    Bun.sleep(250).then(() => { throw new Error("Prepared navigation waited behind a later prefetch."); }),
  ]);
  expect(navigation.currentStepIndex).toBe(1);
  expect(navigation.outline?.phases[0]?.steps[1]?.explanation).toBe("The second stop is ready.");

  await bridge.respond(thirdPrompt.id, "The third stop is ready.");
  await bridge.ack(thirdPrompt.id);
  const [fourthPrompt] = await bridge.eventsAfter(thirdPrompt.sequence, 1_000);
  if (!fourthPrompt || fourthPrompt.type !== "agent.prompt") throw new Error("Expected continuous prefetch for the fourth stop.");
  expect(fourthPrompt.prompt).toContain("Final verification");
  await bridge.respond(fourthPrompt.id, "The fourth stop is ready.");
  await bridge.ack(fourthPrompt.id);

  for (let attempt = 0; attempt < 20 && !session.snapshot().outline?.phases[1]?.steps[1]?.explanation; attempt += 1) {
    await Bun.sleep(5);
  }
  expect(session.snapshot().outline?.phases[1]?.steps[1]?.explanation).toBe("The fourth stop is ready.");
});

test("next traverses the flattened route across a phase boundary", async () => {
  const { repository, stateFile } = await repositoryFixture();
  await savePersistedSession(stateFile, persistedAttachedSession(repository));
  const session = await ReviewSession.create(repository, undefined, { ...noAdapters, stateFile, resume: true });
  const pending = session.navigate("next");
  const [prompt] = await session.bridge!.eventsAfter(7, 1_000);
  if (!prompt || prompt.type !== "agent.prompt") throw new Error("Expected a phase-boundary explanation prompt.");
  expect(prompt?.prompt).toContain("Verification stop");
  await session.bridge!.respond(prompt!.id, "Verify the behavior at the phase boundary.");
  const snapshot = await pending;
  expect(snapshot.currentStepIndex).toBe(2);
  expect(snapshot.outline?.phases[1]?.steps[0]).toMatchObject({ id: "third-step", explanation: "Verify the behavior at the phase boundary." });
});

test("a resumed closed attached session emits an immutable terminal event beyond its persisted sequence", async () => {
  const { repository, stateFile } = await repositoryFixture();
  const comments = [{
    id: "comment-1",
    path: "app.ts",
    side: "new" as const,
    line: 2,
    body: "Please explain this branch.",
    lineContent: "const changed = 2;",
    status: "active" as const,
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
  }];
  await savePersistedSession(stateFile, persistedAttachedSession(repository, { status: "feedback", comments }));

  const session = await ReviewSession.create(repository, undefined, { ...noAdapters, stateFile, resume: true });
  const bridge = session.bridge;
  if (!bridge) throw new Error("Expected an attached bridge after resume.");
  const [closed] = await bridge.eventsAfter(7);
  expect(closed).toMatchObject({ sequence: 8, type: "review.closed", outcome: "feedback", comments });

  (closed as { comments: typeof comments }).comments[0]!.body = "mutated response copy";
  const [replayed] = await bridge.eventsAfter(7);
  expect((replayed as { comments: typeof comments }).comments[0]!.body).toBe("Please explain this branch.");
});

test("terminal delivery and acknowledgement remain durable across resume", async () => {
  const { repository, stateFile } = await repositoryFixture();
  const session = await ReviewSession.create(repository, undefined, { ...noAdapters, stateFile, attached: true });
  const bridge = session.bridge;
  if (!bridge) throw new Error("Expected an attached bridge.");

  await session.close("cancelled");
  const persistedClosed = await loadPersistedSession(stateFile);
  expect(persistedClosed.bridgeTerminalEvent).toMatchObject({ outcome: "cancelled", acknowledged: false });
  const sequence = persistedClosed.bridgeTerminalEvent!.sequence;
  const [terminal] = await bridge.eventsAfter(sequence);
  await bridge.ack(terminal!.id);
  expect((await loadPersistedSession(stateFile)).bridgeTerminalEvent?.acknowledged).toBe(true);

  const resumed = await ReviewSession.create(repository, undefined, { ...noAdapters, stateFile, resume: true });
  expect(await resumed.bridge!.eventsAfter(sequence)).toEqual([]);
});

test("refresh is rejected after close", async () => {
  const { repository, stateFile } = await repositoryFixture();
  const session = await ReviewSession.create(repository, undefined, { ...noAdapters, stateFile });

  await session.close("cancelled");
  await expect(session.refreshComparison()).rejects.toThrow("review is closed");
});

test("closing during an attached tour prompt cannot be undone by the rejected operation", async () => {
  const { repository, stateFile } = await repositoryFixture();
  await savePersistedSession(stateFile, persistedAttachedSession(repository, {
    outline: undefined,
    currentStepIndex: -1,
    selection: undefined,
  }));
  const session = await ReviewSession.create(repository, undefined, { ...noAdapters, stateFile, resume: true });
  const bridge = session.bridge;
  if (!bridge) throw new Error("Expected an attached bridge.");

  const starting = session.startTour({ adapterId: "attached", modelId: "current-session" });
  await bridge.eventsAfter(7, 1_000);
  expect(session.snapshot().tourState).toBe("planning");
  await session.close("cancelled");
  await expect(starting).rejects.toThrow("review closed before the attached agent answered");

  expect(session.snapshot().status).toBe("cancelled");
  expect(session.snapshot().tourState).toBe("idle");
  expect((await loadPersistedSession(stateFile)).status).toBe("cancelled");
});

for (const operation of ["ask", "navigate"] as const) {
  test(`closing during an attached ${operation} prompt remains terminal`, async () => {
    const { repository, stateFile } = await repositoryFixture();
    await savePersistedSession(stateFile, persistedAttachedSession(repository));
    const session = await ReviewSession.create(repository, undefined, { ...noAdapters, stateFile, resume: true });
    const bridge = session.bridge!;

    const pending = operation === "ask" ? session.ask("Why?") : session.navigate("previous");
    await bridge.eventsAfter(7, 1_000);
    await session.close("cancelled");
    await expect(pending).rejects.toThrow();
    expect(session.snapshot().status).toBe("cancelled");
  });
}

test("closing during refresh remains terminal", async () => {
  const { repository, stateFile } = await repositoryFixture();
  const session = await ReviewSession.create(repository, undefined, { ...noAdapters, stateFile });

  const refreshing = session.refreshComparison();
  const refreshSettled = refreshing.then(() => "resolved", () => "rejected");
  await session.close("cancelled");
  await refreshSettled;
  expect(session.snapshot().status).toBe("cancelled");
});

test("concurrent identical closes share persistence failure instead of reporting early success", async () => {
  const { repository } = await repositoryFixture();
  const session = await ReviewSession.create(repository, undefined, noAdapters);
  (session as unknown as { defaults: { stateFile?: string } }).defaults.stateFile = "/dev/null/review-session.json";

  const first = session.close("cancelled");
  const second = session.close("cancelled");
  const firstFailure = first.then(() => undefined, (error: unknown) => error);
  const secondFailure = second.then(() => undefined, (error: unknown) => error);
  expect(await firstFailure).toBeInstanceOf(Error);
  expect(await secondFailure).toBeInstanceOf(Error);
  expect(session.snapshot().status).toBe("open");
});

test("a refresh rejects an in-flight outline generated for the previous comparison", async () => {
  const { repository, stateFile } = await repositoryFixture();
  const session = await ReviewSession.create(repository, undefined, { ...noAdapters, stateFile, attached: true });
  const bridge = session.bridge!;
  const starting = session.startTour({ adapterId: "attached", modelId: "current-session" });
  const [prompt] = await bridge.eventsAfter(0, 1_000);

  await writeFile(join(repository, "app.ts"), "const base = 1;\nconst refreshed = 3;\n");
  await session.refreshComparison();
  await bridge.respond(prompt!.id, JSON.stringify({
    title: "Old outline", summary: "Generated before refresh", flows: [], findings: [],
    phases: [{ id: "old-phase", title: "Old", summary: "Old phase", fileChanges: [{ path: "app.ts", summary: "Old file" }], steps: [{ id: "old", title: "Old", objective: "Old", anchor: { path: "app.ts", side: "new", startLine: 2, endLine: 2 } }] }],
  }));

  await expect(starting).rejects.toThrow("comparison changed");
  expect(session.snapshot().outline).toBeUndefined();
  await bridge.ack(prompt!.id);

  const retry = session.startTour();
  const retryEvents = await bridge.eventsAfter(prompt!.sequence, 1_000);
  expect(retryEvents.some((event) => event.sequence > prompt!.sequence && event.type === "agent.prompt")).toBe(true);
  await session.close("cancelled");
  await expect(retry).rejects.toThrow();
});

test("an attached review question can refresh after requested edits and still return its answer", async () => {
  const { repository, stateFile } = await repositoryFixture();
  await savePersistedSession(stateFile, persistedAttachedSession(repository));
  const session = await ReviewSession.create(repository, undefined, { ...noAdapters, stateFile, resume: true });
  const bridge = session.bridge!;
  const asking = session.ask("Please make the requested change.");
  const [prompt] = await bridge.eventsAfter(7, 1_000, undefined, true);

  await writeFile(join(proposalWorkspace(prompt!), "app.ts"), "const base = 1;\nconst edited = 4;\n");
  bridge.validateRefresh(prompt!.id, prompt!.leaseId!);
  await session.refreshComparison({ source: "agent", eventId: prompt!.id, verification: "bun test: passed" });
  bridge.authorizeRefresh(prompt!.id, prompt!.leaseId!, session.currentComparisonGeneration);
  await bridge.respond(prompt!.id, "I made the requested change and refreshed the diff.", prompt!.leaseId);

  const snapshot = await asking;
  expect(snapshot.messages.at(-1)).toMatchObject({ role: "agent", body: "I made the requested change and refreshed the diff." });
  expect(snapshot.activities).toEqual([expect.objectContaining({
    request: "Please make the requested change.",
    eventId: prompt!.id,
    status: "verified",
    changeStatus: "pending",
    verification: "bun test: passed",
    files: [expect.objectContaining({ path: "app.ts", change: "modified" })],
  })]);
  expect(await readFile(join(repository, "app.ts"), "utf8")).toBe("const base = 1;\nconst changed = 2;\n");
  const persisted = await loadPersistedSession(stateFile);
  expect(persisted.activities?.[0]).toMatchObject({ changeStatus: "pending", proposal: { baselineTree: expect.any(String), resultTree: expect.any(String) } });

  const applied = await session.updateActivity(snapshot.activities[0]!.id, "apply");
  expect(applied.activities[0]).toMatchObject({ changeStatus: "applied" });
  expect(await readFile(join(repository, "app.ts"), "utf8")).toBe("const base = 1;\nconst edited = 4;\n");
  const undone = await session.updateActivity(snapshot.activities[0]!.id, "undo");
  expect(undone.activities[0]).toMatchObject({ changeStatus: "undone" });
  expect(await readFile(join(repository, "app.ts"), "utf8")).toBe("const base = 1;\nconst changed = 2;\n");
});

test("watcher refreshes do not expose edits while an isolated agent proposal is in flight", async () => {
  const { repository, stateFile } = await repositoryFixture();
  await savePersistedSession(stateFile, persistedAttachedSession(repository));
  const session = await ReviewSession.create(repository, undefined, { ...noAdapters, stateFile, resume: true });
  const bridge = session.bridge!;
  const asking = session.ask("Update the implementation and add coverage.");
  const [prompt] = await bridge.eventsAfter(7, 1_000, undefined, true);
  const proposal = proposalWorkspace(prompt!);

  await writeFile(join(proposal, "app.ts"), "const base = 1;\nconst edited = 8;\n");
  await session.refreshComparison({ source: "watcher" });
  await writeFile(join(proposal, "app.test.ts"), "test('edited', () => expect(true).toBe(true));\n");
  await session.refreshComparison({ source: "watcher" });
  expect(session.snapshot().activities).toEqual([]);

  bridge.validateRefresh(prompt!.id, prompt!.leaseId!);
  await session.refreshComparison({ source: "agent", eventId: prompt!.id, verification: "bun test: 1 pass" });
  bridge.authorizeRefresh(prompt!.id, prompt!.leaseId!, session.currentComparisonGeneration);
  await bridge.respond(prompt!.id, "Implemented and verified.", prompt!.leaseId);
  const snapshot = await asking;
  expect(snapshot.activities).toEqual([expect.objectContaining({
    status: "verified",
    changeStatus: "pending",
    eventId: prompt!.id,
    verification: "bun test: 1 pass",
    files: [expect.objectContaining({ path: "app.test.ts" }), expect.objectContaining({ path: "app.ts" })],
  })]);
  expect(await Bun.file(join(repository, "app.test.ts")).exists()).toBe(false);
});

test("reject discards a pending proposal and apply conflicts preserve later reviewer edits", async () => {
  const { repository, stateFile } = await repositoryFixture();
  await savePersistedSession(stateFile, persistedAttachedSession(repository));
  const session = await ReviewSession.create(repository, undefined, { ...noAdapters, stateFile, resume: true });
  const bridge = session.bridge!;

  const firstAsk = session.ask("Prepare one change.");
  const [firstPrompt] = await bridge.eventsAfter(7, 1_000, undefined, true);
  await writeFile(join(proposalWorkspace(firstPrompt!), "app.ts"), "const base = 1;\nconst proposal = 3;\n");
  bridge.validateRefresh(firstPrompt!.id, firstPrompt!.leaseId!);
  await session.refreshComparison({ source: "agent", eventId: firstPrompt!.id, verification: "checked" });
  bridge.authorizeRefresh(firstPrompt!.id, firstPrompt!.leaseId!, session.currentComparisonGeneration);
  await bridge.respond(firstPrompt!.id, "Proposal ready.", firstPrompt!.leaseId);
  const first = await firstAsk;
  const rejected = await session.updateActivity(first.activities[0]!.id, "reject");
  expect(rejected.activities[0]).toMatchObject({ changeStatus: "rejected" });
  expect(await readFile(join(repository, "app.ts"), "utf8")).toContain("changed = 2");

  const secondAsk = session.ask("Prepare another change.");
  const [secondPrompt] = await bridge.eventsAfter(firstPrompt!.sequence, 1_000, undefined, true);
  await writeFile(join(proposalWorkspace(secondPrompt!), "app.ts"), "const base = 1;\nconst proposal = 5;\n");
  bridge.validateRefresh(secondPrompt!.id, secondPrompt!.leaseId!);
  await session.refreshComparison({ source: "agent", eventId: secondPrompt!.id, verification: "checked" });
  bridge.authorizeRefresh(secondPrompt!.id, secondPrompt!.leaseId!, session.currentComparisonGeneration);
  await bridge.respond(secondPrompt!.id, "Second proposal ready.", secondPrompt!.leaseId);
  const second = await secondAsk;
  await writeFile(join(repository, "app.ts"), "const base = 1;\nconst reviewer = 9;\n");
  await expect(session.updateActivity(second.activities[1]!.id, "apply")).rejects.toThrow("working tree no longer matches");
  expect(await readFile(join(repository, "app.ts"), "utf8")).toContain("reviewer = 9");
});

test("manual refreshes are not attributed to an attached agent request", async () => {
  const { repository, stateFile } = await repositoryFixture();
  const session = await ReviewSession.create(repository, undefined, { ...noAdapters, stateFile, attached: true });
  await writeFile(join(repository, "app.ts"), "const base = 1;\nconst manual = 9;\n");
  await session.refreshComparison({ source: "manual" });
  expect(session.snapshot().activities).toEqual([]);
});

test("an unrelated refresh still rejects an in-flight attached question", async () => {
  const { repository, stateFile } = await repositoryFixture();
  await savePersistedSession(stateFile, persistedAttachedSession(repository));
  const session = await ReviewSession.create(repository, undefined, { ...noAdapters, stateFile, resume: true });
  const bridge = session.bridge!;
  const asking = session.ask("Explain this.");
  const [prompt] = await bridge.eventsAfter(7, 1_000);

  await writeFile(join(repository, "app.ts"), "const base = 1;\nconst unrelated = 5;\n");
  await session.refreshComparison();
  await bridge.respond(prompt!.id, "Stale answer");

  await expect(asking).rejects.toThrow("comparison changed");
  expect(session.snapshot().messages).toEqual([]);
});

test("a later unrelated refresh invalidates an earlier event-authorized refresh", async () => {
  const { repository, stateFile } = await repositoryFixture();
  await savePersistedSession(stateFile, persistedAttachedSession(repository));
  const session = await ReviewSession.create(repository, undefined, { ...noAdapters, stateFile, resume: true });
  const bridge = session.bridge!;
  const asking = session.ask("Please edit this.");
  const [prompt] = await bridge.eventsAfter(7, 1_000, undefined, true);

  await writeFile(join(repository, "app.ts"), "const base = 1;\nconst edited = 6;\n");
  await session.refreshComparison();
  bridge.authorizeRefresh(prompt!.id, prompt!.leaseId!, session.currentComparisonGeneration);
  await writeFile(join(repository, "app.ts"), "const base = 1;\nconst unrelated = 7;\n");
  await session.refreshComparison();
  await bridge.respond(prompt!.id, "Answer for the earlier refresh", prompt!.leaseId);

  await expect(asking).rejects.toThrow("comparison changed");
});

test("CLI accepts --no-findings and rejects a state path inside the reviewed repository before launching a server", async () => {
  const { directory, repository } = await repositoryFixture();
  const stateFile = join(repository, "review-state.json");
  await savePersistedSession(stateFile, persistedAttachedSession(repository));

  const result = await runProcess(
    [process.execPath, "run", "src/cli.ts", "--no-findings", "--resume", stateFile],
    join(import.meta.dir, ".."),
    [1],
  );
  expect(`${result.stdout}\n${result.stderr}`).toContain("state must be stored outside the reviewed repository");
  expect(directory).toBeDefined();
});
