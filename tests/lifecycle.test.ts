import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProcess } from "../src/process.ts";
import { loadComparison } from "../src/git.ts";
import { ReviewSession } from "../src/session.ts";
import { loadPersistedSession, savePersistedSession } from "../src/store.ts";
import { createRequestHandler } from "../src/server.ts";
import type { PersistedReviewSession } from "../src/types.ts";

const directories: string[] = [];
const noAdapters = { agentAdapters: [] };

test("line conversations persist and follow-ups retain their original phase context", async () => {
  const { repository, stateFile } = await repositoryFixture();
  await savePersistedSession(stateFile, persistedAttachedSession(repository));
  const session = await ReviewSession.create(repository, undefined, { ...noAdapters, stateFile, resume: true });
  try {
    const anchor = { path: "app.ts", side: "new" as const, line: 2, content: "const changed = 2;" };
    const asking = session.ask("Why two?", undefined, { anchor, contextPaths: ["app.ts"] });
    const [prompt] = await session.bridge!.eventsAfter(7, 1000);
    if (!prompt || prompt.type !== "agent.prompt") throw new Error("Expected question");
    expect(prompt.prompt).toContain("Captured code: const changed = 2;");
    expect(prompt.prompt).toContain("Additional repository files selected by the reviewer:");
    expect(prompt.prompt).toContain("File: app.ts");
    await session.bridge!.respond(prompt.id, "Two is the fixture value.");
    await session.bridge!.ack(prompt.id);
    const first = await asking;
    const root = first.messages[0]!;
    expect(root.threadId).toBe(root.id);
    expect(root.anchor).toEqual(anchor);
    expect(root.contextPaths).toEqual(["app.ts"]);
    session.currentStepIndex = 2; // Same file, different phase.
    const followup = session.ask("Could it be three?", undefined, { threadId: root.id });
    const events = await session.bridge!.eventsAfter(prompt.sequence, 1000);
    const next = events.find((event) => event.type === "agent.prompt" && event.kind === "review.question");
    if (!next || next.type !== "agent.prompt") throw new Error("Expected follow-up");
    expect(next.prompt).toContain("Second step");
    expect(next.prompt).not.toContain("Current tour step: Verification stop");
    expect(next.prompt).toContain("Two is the fixture value.");
    await session.bridge!.respond(next.id, "Yes, if the fixture expects it.");
    await session.bridge!.ack(next.id);
    const result = await followup;
    expect(result.currentStepIndex).toBe(2);
    expect(result.messages.every((message) => message.threadId === root.id)).toBe(true);
    expect((await loadPersistedSession(stateFile)).messages).toEqual(result.messages);
    await expect(session.ask("Invalid", undefined, { threadId: "missing" })).rejects.toThrow("Conversation not found");
    await expect(session.ask("Wrong line", undefined, { anchor: { ...anchor, content: "other" } })).rejects.toThrow("selected code changed");
    await expect(session.ask("Retarget", undefined, { threadId: root.id, anchor })).rejects.toThrow("original code location");
    await expect(session.ask("Retarget files", undefined, { threadId: root.id, contextPaths: ["app.ts"] })).rejects.toThrow("original file context");
  } finally { await session.dispose(); }
});

test("an unselected question remains visibly scoped to the current tour stop without a code anchor", async () => {
  const { repository, stateFile } = await repositoryFixture();
  await savePersistedSession(stateFile, persistedAttachedSession(repository));
  const session = await ReviewSession.create(repository, undefined, { ...noAdapters, stateFile, resume: true });
  try {
    const asking = session.ask("What behavior does this stop establish?");
    const [prompt] = await session.bridge!.eventsAfter(7, 1_000);
    if (!prompt || prompt.type !== "agent.prompt") throw new Error("Expected an unselected question prompt");
    expect(prompt.prompt).toContain("Discussion scope: Current tour stop Second step [second-step]");
    expect(prompt.prompt).not.toContain("Original question location:");
    await session.bridge!.respond(prompt.id, "It establishes the changed fixture value.");
    await session.bridge!.ack(prompt.id);
    const answered = await asking;
    expect(answered.messages[0]).toMatchObject({
      role: "user",
      body: "What behavior does this stop establish?",
      stepId: "second-step",
    });
    expect(answered.messages[0]?.anchor).toBeUndefined();
    expect((await loadPersistedSession(stateFile)).messages[0]?.anchor).toBeUndefined();
  } finally { await session.dispose(); }
});

test("image comments and questions use a stable image-level anchor", async () => {
  const { repository, stateFile } = await repositoryFixture();
  await writeFile(join(repository, "screen.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
  await savePersistedSession(stateFile, persistedAttachedSession(repository));
  const session = await ReviewSession.create(repository, undefined, { ...noAdapters, stateFile, resume: true });
  try {
    const commented = await session.addComment({ path: "screen.png", side: "new", line: 1, body: "This copy is incorrect." });
    expect(commented.comments[0]).toMatchObject({ path: "screen.png", side: "new", line: 1, lineContent: "[PNG image · new]", status: "active", publishToGitHub: false });

    const anchor = { path: "screen.png", side: "new" as const, line: 1, content: "[PNG image · new]" };
    const asking = session.ask("Is this error copy accurate?", undefined, { anchor });
    const events = await session.bridge!.eventsAfter(7, 1000);
    const prompt = events.find((event) => event.type === "agent.prompt" && event.kind === "review.question");
    if (!prompt || prompt.type !== "agent.prompt") throw new Error("Expected image question");
    expect(prompt.prompt).toContain("Captured code: [PNG image · new]");
    await session.bridge!.respond(prompt.id, "The image copy should be corrected.");
    await session.bridge!.ack(prompt.id);
    const answered = await asking;
    expect(answered.messages[0]?.anchor).toEqual(anchor);
  } finally { await session.dispose(); }
});

test("range and stop discussions retain exact anchors, scope prompts, and reject invalid client anchors", async () => {
  const { repository, stateFile } = await repositoryFixture();
  await savePersistedSession(stateFile, persistedAttachedSession(repository));
  const session = await ReviewSession.create(repository, undefined, { ...noAdapters, stateFile, resume: true });
  try {
    const context = "const base = 1;\nconst changed = 2;";
    const range = await session.addComment({
      scope: "range",
      path: "app.ts",
      side: "new",
      line: 1,
      endLine: 2,
      selectedText: "const changed = 2;",
      context,
      body: "These two lines establish the new value.",
    });
    expect(range.comments[0]).toMatchObject({ scope: "range", path: "app.ts", side: "new", line: 1, endLine: 2, selectedText: "const changed = 2;", context, publishToGitHub: false });

    const stop = await session.addComment({ scope: "stop", stepId: "first-step", body: "Remember this behavior at the first stop." });
    expect(stop.comments[1]).toMatchObject({ scope: "stop", stepId: "first-step", path: "app.ts", side: "new", line: 2, endLine: 2, context: "const changed = 2;", publishToGitHub: false });
    expect((await loadPersistedSession(stateFile)).comments).toEqual(stop.comments);

    await expect(session.addComment({ scope: "range", path: "../outside.ts", side: "new", line: 1, endLine: 1, selectedText: "x", body: "bad" })).rejects.toThrow("changed file");
    await expect(session.addComment({ scope: "range", path: "app.ts", side: "new", line: 2, endLine: 4, selectedText: "const changed = 2;", body: "bad" })).rejects.toThrow("consecutive");
    await expect(session.addComment({ scope: "range", path: "app.ts", side: "new", line: 1, endLine: 2, selectedText: "not present", context, body: "bad" })).rejects.toThrow("Selected quotation");
    await expect(session.addComment({ scope: "stop", stepId: "missing-stop", body: "bad" })).rejects.toThrow("does not exist");

    const asking = session.ask("Why is this selected range important?", undefined, {
      anchor: { path: "app.ts", side: "new", line: 1, endLine: 2, content: "const base = 1;", selectedText: "const changed = 2;", context },
    });
    const [prompt] = await session.bridge!.eventsAfter(7, 1_000);
    if (!prompt || prompt.type !== "agent.prompt") throw new Error("Expected scoped question");
    expect(prompt.prompt).toContain("Discussion scope: Current tour stop Second step [second-step]");
    expect(prompt.prompt).toContain("Exact selected quotation:\nconst changed = 2;");
    expect(prompt.prompt).toContain("Exact selected context:\nconst base = 1;\nconst changed = 2;");
    await session.bridge!.respond(prompt.id, "The selected range introduces the value used by the next stop.");
    await session.bridge!.ack(prompt.id);
    const answered = await asking;
    expect(answered.messages[0]?.anchor).toEqual({ path: "app.ts", side: "new", line: 1, endLine: 2, content: "const base = 1;", selectedText: "const changed = 2;", context });

    await writeFile(join(repository, "app.ts"), "const base = 1;\nconst changed = 3;\n");
    const refreshed = await session.refreshComparison();
    expect(refreshed.comments[0]?.status).toBe("outdated");
  } finally { await session.dispose(); }
});

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
      callFlows: [],
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

test("startup screenshots are snapshotted, authenticated, and persisted across resume", async () => {
  const { directory, repository, stateFile } = await repositoryFixture();
  const source = join(directory, "built-ui.png");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  await writeFile(source, png);
  const session = await ReviewSession.create(repository, undefined, { ...noAdapters, stateFile, screenshots: [source] });
  expect(session.snapshot().screenshots).toEqual([expect.objectContaining({ name: "built-ui.png", mimeType: "image/png", size: png.length })]);

  await writeFile(source, "not the imported screenshot");
  const screenshot = session.snapshot().screenshots[0]!;
  const fetch = createRequestHandler(session, directory);
  const unauthorized = await fetch(new Request(`http://127.0.0.1/api/screenshots/${screenshot.id}`));
  expect(unauthorized.status).toBe(401);
  const response = await fetch(new Request(`http://127.0.0.1/api/screenshots/${screenshot.id}`, { headers: { "x-review-tour-token": session.browserToken } }));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/png");
  expect(Buffer.from(await response.arrayBuffer())).toEqual(png);

  const resumed = await ReviewSession.create(repository, undefined, { ...noAdapters, stateFile, resume: true });
  expect(resumed.snapshot().screenshots).toEqual(session.snapshot().screenshots);
});

test("selected diff preferences survive an existing session resume", async () => {
  const { repository, stateFile } = await repositoryFixture();
  const session = await ReviewSession.create(repository, undefined, { ...noAdapters, stateFile });
  await session.setDiffPreferences("desktop", { layout: "unified", wrap: "wrap" });
  await session.setDiffPreferences("mobile", { layout: "split", wrap: "scroll" });

  const resumed = await ReviewSession.create(repository, undefined, { ...noAdapters, stateFile, resume: true });
  expect(resumed.snapshot().diffPreferences).toEqual({
    desktop: { layout: "unified", wrap: "wrap" },
    mobile: { layout: "split", wrap: "scroll" },
  });
});

test("new sessions inherit the last repository-scoped diff preferences", async () => {
  const { directory, repository, stateFile } = await repositoryFixture();
  const first = await ReviewSession.create(repository, undefined, { ...noAdapters, stateFile });
  const nextStateFile = join(directory, "next-session.json");
  try {
    await first.setDiffPreferences("desktop", { layout: "unified", wrap: "wrap" });
    await first.setDiffPreferences("mobile", { layout: "split", wrap: "scroll" });

    const next = await ReviewSession.create(repository, undefined, { ...noAdapters, stateFile: nextStateFile });
    try {
      expect(next.snapshot().diffPreferences).toEqual({
        desktop: { layout: "unified", wrap: "wrap" },
        mobile: { layout: "split", wrap: "scroll" },
      });
    } finally { await next.dispose(); }
  } finally { await first.dispose(); }
});

test("new sessions inherit the global briefing preferences", async () => {
  const { directory, repository, stateFile } = await repositoryFixture();
  const first = await ReviewSession.create(repository, undefined, { ...noAdapters, stateFile });
  try {
    await first.setBriefingPreferences({
      showBriefing: false,
      briefingArchitecture: false,
      briefingSequenceDiagrams: true,
      briefingCallFlows: true,
      briefingNeedsAttention: false,
      briefingReviewEffort: false,
      briefingOrder: ["review-effort", "needs-attention", "call-flows", "sequence-diagrams", "architecture"],
    });

    const next = await ReviewSession.create(repository, undefined, { ...noAdapters, stateFile: join(directory, "next-session.json") });
    try {
      expect(next.snapshot().preferences).toMatchObject({
        showBriefing: false,
        briefingArchitecture: false,
        briefingSequenceDiagrams: true,
        briefingCallFlows: true,
        briefingNeedsAttention: false,
        briefingReviewEffort: false,
        briefingOrder: ["review-effort", "needs-attention", "call-flows", "sequence-diagrams", "architecture"],
      });
    } finally { await next.dispose(); }
  } finally { await first.dispose(); }
});

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
    includeArchitecture: true,
    includeCallFlows: true,
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

test("HTML export preparation fills every missing stop in parallel without moving the tour", async () => {
  const { repository, stateFile } = await repositoryFixture();
  const persisted = persistedAttachedSession(repository);
  persisted.currentStepIndex = 0;
  persisted.outline!.phases[0]!.steps[0]!.explanation = "The first stop is already ready.";
  await savePersistedSession(stateFile, persisted);

  const session = await ReviewSession.create(repository, undefined, { ...noAdapters, stateFile, resume: true });
  const bridge = session.bridge;
  if (!bridge) throw new Error("Expected an attached bridge after resume.");
  const preparing = session.prepareTourForExport();
  let after = 7;
  let answered = 0;
  while (answered < 2) {
    const events = await bridge.eventsAfter(after, 1_000);
    for (const event of events) {
      after = Math.max(after, event.sequence);
      if (event.type !== "agent.prompt" || event.kind !== "tour.explanation") continue;
      answered += 1;
      await bridge.respond(event.id, `Prepared export stop ${answered}.`);
      await bridge.ack(event.id);
    }
  }

  const snapshot = await preparing;
  expect(snapshot.currentStepIndex).toBe(0);
  const explanations = snapshot.outline?.phases.flatMap((phase) => phase.steps).map((step) => step.explanation) ?? [];
  expect(explanations[0]).toBe("The first stop is already ready.");
  expect(new Set(explanations.slice(1))).toEqual(new Set(["Prepared export stop 1.", "Prepared export stop 2."]));
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
  expect(session.snapshot().agentActivity).toMatchObject({
    kind: "tour.explanation",
    label: "Preparing a tour stop",
    status: "waiting",
    prompt: expect.stringContaining("Second step"),
  });
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

test("a reviewer question is issued and answered while stop prefetch remains in flight", async () => {
  const { repository, stateFile } = await repositoryFixture();
  const persisted = persistedAttachedSession(repository);
  persisted.currentStepIndex = 0;
  persisted.outline!.phases[0]!.steps[0]!.explanation = "The current stop is ready.";
  await savePersistedSession(stateFile, persisted);

  const session = await ReviewSession.create(repository, undefined, { ...noAdapters, stateFile, resume: true });
  await session.startTour();
  const bridge = session.bridge!;
  const initial = await bridge.eventsAfter(7, 1_000);
  const prefetch = initial.find((event) => event.type === "agent.prompt" && event.kind === "tour.explanation");
  if (!prefetch || prefetch.type !== "agent.prompt") throw new Error("Expected an in-flight prefetch.");

  const asking = session.ask("Explain this line.");
  let question;
  for (let attempt = 0; attempt < 20 && !question; attempt += 1) {
    const events = await bridge.eventsAfter(prefetch.sequence, 100);
    question = events.find((event) => event.type === "agent.prompt" && event.kind === "review.question");
    if (!question) await Bun.sleep(25);
  }
  if (!question || question.type !== "agent.prompt") throw new Error("Expected the reviewer question while prefetch remained in flight.");
  expect(question.kind).toBe("review.question");
  expect(question.prompt).toContain("Explain this line.");
  await bridge.respond(question.id, "This line keeps the behavior explicit.");
  await bridge.ack(question.id);
  await expect(asking).resolves.toMatchObject({
    messages: expect.arrayContaining([expect.objectContaining({ role: "agent", body: "This line keeps the behavior explicit." })]),
  });
  expect(session.snapshot().outline?.phases[0]?.steps[1]?.explanation).toBeUndefined();
  await bridge.respond(prefetch.id, "The next stop is ready.");
  await bridge.ack(prefetch.id);
  await session.dispose();
});

test("previous supersedes a next navigation that is still preparing", async () => {
  const { repository, stateFile } = await repositoryFixture();
  const persisted = persistedAttachedSession(repository);
  persisted.currentStepIndex = 1;
  persisted.outline!.phases[0]!.steps[0]!.explanation = "The first stop is ready.";
  persisted.outline!.phases[0]!.steps[1]!.explanation = "The current stop is ready.";
  await savePersistedSession(stateFile, persisted);

  const session = await ReviewSession.create(repository, undefined, { ...noAdapters, stateFile, resume: true });
  await session.startTour();
  const bridge = session.bridge!;
  const [prefetch] = await bridge.eventsAfter(7, 1_000);
  if (!prefetch || prefetch.type !== "agent.prompt") throw new Error("Expected the next stop prefetch.");

  const next = session.navigate("next");
  const previous = await Promise.race([
    session.navigate("previous"),
    Bun.sleep(250).then(() => { throw new Error("Previous waited for the unprepared next stop."); }),
  ]);
  expect(previous.currentStepIndex).toBe(0);

  await bridge.respond(prefetch.id, "The future stop is now ready.");
  await bridge.ack(prefetch.id);
  await expect(next).resolves.toMatchObject({ currentStepIndex: 0 });
  expect(session.snapshot().currentStepIndex).toBe(0);
  await session.dispose();
});

test("prefetch keeps a two-stop sliding window instead of preparing the whole tour", async () => {
  const { repository, stateFile } = await repositoryFixture();
  const persisted = persistedAttachedSession(repository);
  persisted.preferences = {
    diffLayout: "split",
    changedFilesOnly: false,
    contextLines: 3,
    prefetchSteps: 2,
    requireAllFilesReviewed: false,
    closeOutcome: "accepted",
    showBriefing: true,
    briefingArchitecture: true,
    briefingSequenceDiagrams: false,
    briefingCallFlows: false,
    briefingNeedsAttention: true,
    briefingReviewEffort: true,
    briefingOrder: ["architecture", "sequence-diagrams", "call-flows", "needs-attention", "review-effort"],
  };
  persisted.currentStepIndex = 0;
  persisted.outline!.phases[0]!.steps[0]!.explanation = "The current stop is ready.";
  persisted.outline!.phases[1]!.steps.push({
    id: "fourth-step",
    title: "Outside the initial window",
    objective: "Prepare this only after navigation advances the window.",
    anchor: { path: "app.ts", side: "new", startLine: 2, endLine: 2 },
  });
  await savePersistedSession(stateFile, persisted);

  const session = await ReviewSession.create(repository, undefined, { ...noAdapters, stateFile, resume: true });
  await session.startTour();
  const bridge = session.bridge!;
  const prompts = new Map<string, Awaited<ReturnType<typeof bridge.eventsAfter>>[number]>();
  for (let attempt = 0; attempt < 20 && prompts.size < 2; attempt += 1) {
    for (const event of await bridge.eventsAfter(7, 100)) {
      if (event.type === "agent.prompt" && event.kind === "tour.explanation") prompts.set(event.id, event);
    }
    if (prompts.size < 2) await Bun.sleep(25);
  }
  const [second, third] = [...prompts.values()].sort((left, right) => left.sequence - right.sequence);
  if (!second || second.type !== "agent.prompt") throw new Error("Expected the first prefetched stop.");
  if (!third || third.type !== "agent.prompt") throw new Error("Expected the second prefetched stop in parallel.");
  expect(second.prompt).toContain("Second step");
  expect(third.prompt).toContain("Verification stop");
  expect(session.snapshot().agentActivity).toMatchObject({ kind: "tour.explanation", stepNumber: 2, totalSteps: 4 });
  await bridge.respond(second.id, "Second ready.");
  await bridge.ack(second.id);
  await bridge.respond(third.id, "Third ready.");
  await bridge.ack(third.id);
  for (let attempt = 0; attempt < 20 && !session.snapshot().outline?.phases[1]?.steps[0]?.explanation; attempt += 1) await Bun.sleep(5);

  expect(await bridge.eventsAfter(third.sequence, 40)).toEqual([]);
  await session.navigate("next");
  const [fourth] = await bridge.eventsAfter(third.sequence, 1_000);
  if (!fourth || fourth.type !== "agent.prompt") throw new Error("Expected navigation to replenish the prefetch window.");
  expect(fourth.prompt).toContain("Outside the initial window");
  await bridge.respond(fourth.id, "Fourth ready.");
  await bridge.ack(fourth.id);
  await session.dispose();
});

test("prepare-ahead zero defers the next explanation until navigation", async () => {
  const { repository, stateFile } = await repositoryFixture();
  const persisted = persistedAttachedSession(repository);
  persisted.currentStepIndex = 0;
  persisted.outline!.phases[0]!.steps[0]!.explanation = "The current stop is ready.";
  await savePersistedSession(stateFile, persisted);

  const session = await ReviewSession.create(repository, undefined, { ...noAdapters, stateFile, resume: true });
  await session.setPrefetchSteps(0);
  await session.startTour();
  expect(session.snapshot().preferences.prefetchSteps).toBe(0);
  expect(await session.bridge!.eventsAfter(7, 40)).toEqual([]);

  const navigation = session.navigate("next");
  const [prompt] = await session.bridge!.eventsAfter(7, 1_000);
  if (!prompt || prompt.type !== "agent.prompt") throw new Error("Expected on-demand explanation after navigation.");
  await session.bridge!.respond(prompt.id, "Prepared on demand.");
  await expect(navigation).resolves.toMatchObject({ currentStepIndex: 1 });
  await session.dispose();
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

test("closing with feedback hands the attached agent the exact reviewed working tree", async () => {
  const { repository, stateFile } = await repositoryFixture();
  const session = await ReviewSession.create(repository, undefined, { ...noAdapters, stateFile, attached: true });

  await session.close("feedback");
  const [closed] = await session.bridge!.eventsAfter(0);
  if (!closed || closed.type !== "review.closed") throw new Error("Expected a feedback close event.");
  if (!closed.reviewedTree) throw new Error("Expected the reviewed tree on feedback.");
  expect(closed.reviewedTree).toMatch(/^[0-9a-f]{40,64}$/);

  await writeFile(join(repository, "app.ts"), "const base = 1;\nconst changed = 2;\nconst feedbackFix = 3;\n");
  const comparison = await loadComparison(repository, closed.reviewedTree);
  expect(comparison.patch).toContain("+const feedbackFix = 3;");
  expect(comparison.patch).not.toContain("+const changed = 2;");
  await session.dispose();

  const resumed = await ReviewSession.create(repository, undefined, { ...noAdapters, stateFile, resume: true });
  const [replayed] = await resumed.bridge!.eventsAfter(0);
  expect(replayed).toMatchObject({ type: "review.closed", outcome: "feedback", reviewedTree: closed.reviewedTree });
  await resumed.dispose();
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
  const starting = session.startTour({ adapterId: "attached", modelId: "current-session", includeArchitecture: false });
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

test("an ignored-file watcher event does not invalidate an in-flight attached outline", async () => {
  const { repository, stateFile } = await repositoryFixture();
  await mkdir(join(repository, ".ace"));
  await writeFile(join(repository, ".git", "info", "exclude"), ".ace/\n");
  const session = await ReviewSession.create(repository, undefined, { ...noAdapters, stateFile, attached: true });
  const bridge = session.bridge!;
  const starting = session.startTour({ adapterId: "attached", modelId: "current-session", includeArchitecture: false, includeCallFlows: false, includeFlows: false, includeFindings: false });
  const [outlinePrompt] = await bridge.eventsAfter(0, 1_000);
  const generation = session.currentComparisonGeneration;

  await writeFile(join(repository, ".ace", "agent-state.json"), "{}\n");
  await session.refreshComparison({ source: "watcher" });
  expect(session.currentComparisonGeneration).toBe(generation);

  await bridge.respond(outlinePrompt!.id, JSON.stringify({
    title: "Current outline", summary: "Generated for the unchanged comparison", phases: [{
      id: "current-phase", title: "Current", summary: "Current phase", fileChanges: [{ path: "app.ts", summary: "Current file" }],
      steps: [{ id: "current", title: "Current", objective: "Current", anchor: { path: "app.ts", side: "new", startLine: 2, endLine: 2 } }],
    }], callFlows: [], flows: [], findings: [],
  }));
  let explanation;
  for (let attempt = 0; attempt < 20 && !explanation; attempt += 1) {
    const events = await bridge.eventsAfter(outlinePrompt!.sequence, 1_000);
    explanation = events.find((event) => event.type === "agent.prompt" && event.kind === "tour.explanation");
    if (!explanation) await Bun.sleep(10);
  }
  if (!explanation || explanation.type !== "agent.prompt") throw new Error("Expected an explanation prompt.");
  await bridge.respond(explanation.id, "The changed line remains current.");
  await expect(starting).resolves.toMatchObject({ outline: { title: "Current outline" } });

  await writeFile(join(repository, "app.ts"), "const base = 1;\nconst changedAgain = 3;\n");
  await session.refreshComparison({ source: "watcher" });
  expect(session.currentComparisonGeneration).toBe(generation + 1);
  await session.dispose();
});

test("a failed automatic outline remains visible in the session so the browser can explain and retry it", async () => {
  const { repository, stateFile } = await repositoryFixture();
  const session = await ReviewSession.create(repository, undefined, { ...noAdapters, stateFile, attached: true });
  const bridge = session.bridge!;
  const starting = session.startTour({ adapterId: "attached", modelId: "current-session" });
  const [prompt] = await bridge.eventsAfter(0, 1_000);

  await bridge.respond(prompt!.id, JSON.stringify({
    title: "Invalid outline",
    summary: "No route can be anchored.",
    phases: [],
    callFlows: [],
    flows: [],
    findings: [],
  }));

  await expect(starting).rejects.toThrow("invalid tour outline");
  expect(session.snapshot()).toMatchObject({
    tourState: "idle",
    outline: undefined,
    agentActivity: {
      kind: "tour.outline",
      status: "failed",
      error: expect.stringContaining("invalid tour outline"),
    },
  });
  await session.close("cancelled");
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

test("a reviewer inline edit stays isolated until apply and remains undoable", async () => {
  const { repository, stateFile } = await repositoryFixture();
  const session = await ReviewSession.create(repository, undefined, { ...noAdapters, stateFile });

  const result = await session.proposeInlineEdit(
    "app.ts",
    "new",
    2,
    "const changed = 2;",
    "const changed = 3;\nconst reviewerAdded = true;",
  );
  expect(result.session.activities).toEqual([expect.objectContaining({
    id: result.activityId,
    source: "reviewer",
    adapterId: "reviewer",
    modelId: "inline-edit",
    status: "observed",
    changeStatus: "pending",
    hasProposal: true,
    files: [expect.objectContaining({ path: "app.ts", change: "modified" })],
  })]);
  expect(await readFile(join(repository, "app.ts"), "utf8")).toBe("const base = 1;\nconst changed = 2;\n");
  expect(session.activityDiff(result.activityId, "app.ts").file.hunks
    .flatMap((hunk) => hunk.rows).map((row) => row.content)).toContain("const reviewerAdded = true;");

  const applied = await session.updateActivity(result.activityId, "apply");
  expect(applied.activities[0]).toMatchObject({ changeStatus: "applied", source: "reviewer" });
  expect(await readFile(join(repository, "app.ts"), "utf8")).toBe("const base = 1;\nconst changed = 3;\nconst reviewerAdded = true;\n");
  await session.updateActivity(result.activityId, "undo");
  expect(await readFile(join(repository, "app.ts"), "utf8")).toBe("const base = 1;\nconst changed = 2;\n");
});

test("a reviewer can propose a validated contiguous multi-line edit", async () => {
  const { repository, stateFile } = await repositoryFixture();
  const session = await ReviewSession.create(repository, undefined, { ...noAdapters, stateFile });

  const result = await session.proposeInlineEdit(
    "app.ts",
    "new",
    1,
    "const base = 1;\nconst changed = 2;",
    "const base = 10;\nconst changed = 20;\nconst added = true;",
    2,
  );
  expect(result.session.activities[0]?.request).toBe("Edit app.ts:1-2");
  expect(result.session.activities[0]?.changeStatus).toBe("pending");
  expect(result.session.activities[0]?.files[0]?.path).toBe("app.ts");
  expect(await readFile(join(repository, "app.ts"), "utf8")).toBe("const base = 1;\nconst changed = 2;\n");

  await session.updateActivity(result.activityId, "apply");
  expect(await readFile(join(repository, "app.ts"), "utf8")).toBe("const base = 10;\nconst changed = 20;\nconst added = true;\n");
});

test("a reviewer inline edit rejects stale, unavailable, and no-op requests", async () => {
  const { repository, stateFile } = await repositoryFixture();
  const session = await ReviewSession.create(repository, undefined, { ...noAdapters, stateFile });

  await expect(session.proposeInlineEdit("app.ts", "new", 2, "stale content", "const changed = 3;"))
    .rejects.toThrow("changed before the edit");
  await expect(session.proposeInlineEdit("app.ts", "new", 999, "not visible", "const base = 4;"))
    .rejects.toThrow("changed before the edit");
  await expect(session.proposeInlineEdit("app.ts", "new", 2, "const changed = 2;", "const changed = 3;", 1))
    .rejects.toThrow("changed before the edit");
  await expect(session.proposeInlineEdit("app.ts", "new", 2, "const changed = 2;", "const changed = 2;"))
    .rejects.toThrow("does not change");
  expect(session.snapshot().activities).toEqual([]);
  expect(await readFile(join(repository, "app.ts"), "utf8")).toBe("const base = 1;\nconst changed = 2;\n");
});

test("a local fallback captures requested edits as a pending proposal without touching the review tree", async () => {
  const { repository, stateFile } = await repositoryFixture();
  await savePersistedSession(stateFile, persistedAttachedSession(repository));
  const session = await ReviewSession.create(repository, undefined, { ...noAdapters, stateFile, resume: true });
  session.bridge!.setFallback({
    async send(prompt, kind) {
      expect(kind).toBe("review.question");
      const match = /isolated proposal workspace ("(?:\\.|[^"])*")/.exec(prompt);
      if (!match) throw new Error("Fallback prompt did not contain the isolated proposal workspace.");
      const workspace = JSON.parse(match[1]!) as string;
      await writeFile(join(workspace, "app.ts"), "const base = 1;\nconst fallbackEdit = 4;\n");
      return { message: "The fallback prepared the requested edit.", verification: "bun test: passed" };
    },
  }, 5);

  const snapshot = await session.ask("Please make this concrete change.");

  expect(snapshot.messages.at(-1)).toMatchObject({ role: "agent", body: "The fallback prepared the requested edit." });
  expect(snapshot.activities).toEqual([expect.objectContaining({
    status: "verified",
    changeStatus: "pending",
    verification: "bun test: passed",
    files: [expect.objectContaining({ path: "app.ts", change: "modified" })],
  })]);
  expect(await readFile(join(repository, "app.ts"), "utf8")).toBe("const base = 1;\nconst changed = 2;\n");
  await session.dispose();
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
