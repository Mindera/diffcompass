import { afterEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPersistedSession, savePersistedSession } from "../src/store.ts";
import type { PersistedReviewSession, ReviewFinding } from "../src/types.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function temporaryStateFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "diffcompass-store-"));
  directories.push(directory);
  return join(directory, "nested", "session.json");
}

function persistedSession(): PersistedReviewSession {
  return {
    schemaVersion: 2,
    repositoryRoot: "/private/tmp/repository",
    base: "origin/main",
    browserToken: "browser-token",
    bridgeToken: "bridge-token",
    outline: {
      title: "Review the change",
      summary: "A short summary",
      phases: [{
        id: "behavior",
        title: "Changed behavior",
        summary: "Review the changed behavior.",
        fileChanges: [{ path: "src/app.ts", summary: "Implements the changed behavior." }],
        steps: [{
          id: "entrypoint",
          title: "Entry point",
          objective: "Understand the changed behavior",
          anchor: { path: "src/app.ts", side: "new", startLine: 2, endLine: 2 },
        }],
      }],
      callFlows: [],
      flows: [],
      findings: [],
    },
    currentStepIndex: 0,
    comments: [{
      id: "comment-1",
      path: "src/app.ts",
      side: "new",
      line: 2,
      body: "Check the empty path.",
      lineContent: "return result;",
      status: "active",
      createdAt: "2026-08-08T00:00:00.000Z",
      updatedAt: "2026-08-08T00:00:00.000Z",
    }],
    messages: [{
      id: "message-1",
      role: "user",
      body: "Why is this needed?",
      createdAt: "2026-08-08T00:00:00.000Z",
    }],
    reviewedFiles: ["src/app.ts"],
    revision: 3,
    status: "open",
    selection: { adapterId: "attached", modelId: "current-session" },
    updatedAt: "2026-08-08T00:00:00.000Z",
  };
}

test("persists a complete session atomically and with owner-only permissions where supported", async () => {
  const path = await temporaryStateFile();
  const expected = persistedSession();

  await savePersistedSession(path, expected);

  expect(await loadPersistedSession(path)).toEqual(expected);
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual(expected);
  if (process.platform !== "win32") {
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(join(path, ".."))).mode & 0o777).toBe(0o700);
  }
});

test("persists impact repair diagnostics and rejects malformed diagnostics", async () => {
  const path = await temporaryStateFile();
  const session = persistedSession();
  session.outline!.structuralAnalysisWarnings = ["structuralBlastRadii[1] was omitted: invalid provider."];
  session.outline!.structuralAnalysisOmissionReason = "No declarations could be identified.";
  await savePersistedSession(path, session);
  expect((await loadPersistedSession(path))?.outline?.structuralAnalysisWarnings).toEqual(session.outline!.structuralAnalysisWarnings);
  expect((await loadPersistedSession(path))?.outline?.structuralAnalysisOmissionReason).toBe("No declarations could be identified.");
  session.outline!.structuralAnalysisWarnings = ["x".repeat(2_001)];
  await writeFile(path, JSON.stringify(session));
  await expect(loadPersistedSession(path)).rejects.toThrow();
});

test("sequence source anchors survive persistence and malformed message references are rejected", async () => {
  const path = await temporaryStateFile();
  const session = persistedSession();
  const anchors = [{ path: "src/app.ts", side: "new" as const, startLine: 2, endLine: 2, quote: "run();" }];
  session.outline!.flows = [{ id: "flow", title: "Flow", summary: "Call", mermaid: "sequenceDiagram\n participant A\n participant B\n A->>B: run", provenance: "partial", blastRadiusSize: 1, affectedFiles: ["src/app.ts"], messageSources: [{ message: 1, label: "run", anchors }] }];
  await savePersistedSession(path, session);
  expect((await loadPersistedSession(path))?.outline?.flows[0]?.messageSources?.[0]?.anchors).toEqual(anchors);
  session.outline!.flows[0]!.messageSources![0]!.message = 10;
  await writeFile(path, JSON.stringify(session));
  await expect(loadPersistedSession(path)).rejects.toThrow();
});

test("persists bounded structural blast-radius evidence and accepts older outlines without it", async () => {
  const path = await temporaryStateFile();
  const session = persistedSession();
  session.outline!.structuralBlastRadii = [{
    id: "radius:app", symbol: { id: "src/app.ts:new:2:result", symbol: "result", kind: "function", location: { path: "src/app.ts", side: "new", line: 2 } },
    provider: "repository-search", confidence: "low", provenance: "partial", summary: "Static reach only, not proof of runtime impact.",
    nodes: [
      { id: "src/app.ts:new:2:result", symbol: "result", kind: "function", location: { path: "src/app.ts", side: "new", line: 2 } },
      { id: "src/consumer.ts:new:4:consume", symbol: "consume", kind: "function", location: { path: "src/consumer.ts", side: "new", line: 4 } },
    ],
    edges: [{ id: "consume-result", from: "src/consumer.ts:new:4:consume", to: "src/app.ts:new:2:result", relationship: "calls" }],
    directCallerIds: ["src/consumer.ts:new:4:consume"], reportedDirectCallerCount: 4, reportedReachableNodeCount: 12, reportedImpactedFileCount: 3,
    testEvidence: {
      state: "limited", searchScope: "Inspected tests/result.test.ts for result references.", checkedSources: [], relevantTests: [],
      remainingUncertainty: "No test source anchor was retained with this saved assessment.",
    },
    impactedFiles: ["src/app.ts", "src/consumer.ts"], nearbyTestGaps: [{ kind: "no-nearby-tests", detail: "No nearby test covers the changed branch.", nearbyTestFiles: [] }],
  }];
  session.outline!.findings = [{
    id: "pinned-finding", phaseId: "behavior", stepId: "entrypoint", path: "src/app.ts", side: "new", line: 2, lineContent: "return result;",
    message: "The changed result has broad static reach.", category: "testing", severity: "medium", confidence: "low", evidence: "Structural evidence identifies callers.",
    priority: "P1", introduced: true, recallGuard: false, blastRadiusSize: 12, tested: false, pinScope: "symbol", pinnedSymbolIds: ["src/app.ts:new:2:result"], status: "open",
  }];
  await savePersistedSession(path, session);
  await expect(loadPersistedSession(path)).resolves.toMatchObject({ outline: { structuralBlastRadii: [{ id: "radius:app", reportedReachableNodeCount: 12, directCallerIds: ["src/consumer.ts:new:4:consume"], testEvidence: { state: "limited" } }], findings: [{ pinnedSymbolIds: ["src/app.ts:new:2:result"] }] } });

  const malformedPin = structuredClone(session);
  malformedPin.outline!.findings[0]!.pinnedSymbolIds = ["missing:structural:node"];
  await writeFile(path, JSON.stringify(malformedPin));
  await expect(loadPersistedSession(path)).rejects.toThrow("unsupported or invalid schema");

  const disconnectedGraph = structuredClone(session);
  disconnectedGraph.outline!.structuralBlastRadii![0]!.nodes.push({ id: "detached:external", symbol: "detached", kind: "external" });
  await writeFile(path, JSON.stringify(disconnectedGraph));
  await expect(loadPersistedSession(path)).rejects.toThrow("unsupported or invalid schema");

  const legacy = persistedSession();
  await savePersistedSession(path, legacy);
  await expect(loadPersistedSession(path)).resolves.toEqual(legacy);
});

test("persists only bounded validated Archify artifacts", async () => {
  const path = await temporaryStateFile();
  const session = persistedSession();
  session.outline!.archifyArtifacts = [{
    id: "architecture-journey", type: "architecture", title: "Changed components",
    ir: { schema_version: 1, diagram_type: "architecture", meta: { title: "After" } },
    baselineIr: { schema_version: 1, diagram_type: "architecture", meta: { title: "Before" } },
    comparison: {
      before: { ir: { schema_version: 1, diagram_type: "architecture", meta: { title: "Before" } }, html: "<!doctype html><title>Before</title>", validationReceipt: '{"ok":true}' },
      delta: { ir: { schema_version: 1, diagram_type: "architecture", meta: { title: "Delta" } }, html: "<!doctype html><title>Delta</title>", validationReceipt: '{"ok":true}' },
    },
    html: "<!doctype html><title>Archify</title>", evidence: ["src/app.ts changed"], affectedFiles: ["src/app.ts"],
    view: "before-delta-after", validationReceipt: '{"ok":true}', renderedAt: "2026-09-18T12:00:00.000Z",
  }];
  await savePersistedSession(path, session);
  await expect(loadPersistedSession(path)).resolves.toMatchObject({ outline: { archifyArtifacts: [{ id: "architecture-journey", view: "before-delta-after" }] } });

  const malformed = structuredClone(session) as unknown as { outline: { archifyArtifacts: Array<Record<string, unknown>> } };
  malformed.outline.archifyArtifacts[0]!.html = "";
  await writeFile(path, JSON.stringify(malformed));
  await expect(loadPersistedSession(path)).rejects.toThrow("unsupported or invalid schema");

  const malformedComparison = structuredClone(session) as unknown as { outline: { archifyArtifacts: Array<{ comparison?: { before?: { html: string } } }> } };
  malformedComparison.outline.archifyArtifacts[0]!.comparison!.before!.html = "";
  await writeFile(path, JSON.stringify(malformedComparison));
  await expect(loadPersistedSession(path)).rejects.toThrow("unsupported or invalid schema");
});

test("persists optional diff preferences while accepting older sessions without them", async () => {
  const path = await temporaryStateFile();
  const session = persistedSession();
  session.diffPreferences = {
    desktop: { layout: "unified", wrap: "wrap" },
    mobile: { layout: "split", wrap: "scroll" },
  };
  await savePersistedSession(path, session);
  await expect(loadPersistedSession(path)).resolves.toMatchObject({ diffPreferences: session.diffPreferences });

  for (const diffPreferences of [
    { desktop: { layout: "columns", wrap: "wrap" } },
    { mobile: { layout: "split", wrap: "fold" } },
    { tablet: { layout: "split", wrap: "scroll" } },
  ]) {
    await writeFile(path, JSON.stringify({ ...session, diffPreferences }));
    await expect(loadPersistedSession(path)).rejects.toThrow("unsupported or invalid schema");
  }
});

test("repairs Mermaid keyword IDs in architecture and sequence flows when loading an older session", async () => {
  const path = await temporaryStateFile();
  const session = persistedSession();
  session.outline!.architecture = {
    title: "Application graph",
    summary: "The application assembles the dependency graph.",
    mermaid: `flowchart LR
  app["Application"]:::touched
  graph["Dependency graph"]:::new
  app -->|creates| graph
  classDef new stroke:#2e7d32,stroke-width:3px
  classDef touched stroke:#f9a825,stroke-width:3px
  classDef removed stroke:#c62828,stroke-width:3px,stroke-dasharray:4 3
  classDef external stroke:#888888,stroke-dasharray:3 3`,
    dependencyChanges: ["Added Application → Dependency graph: creates"],
    affectedFiles: ["src/app.ts"],
  };
  session.outline!.flows = [{
    id: "image-preview",
    title: "Image preview",
    summary: "The screen renders an image box.",
    mermaid: `sequenceDiagram
  participant Screen as Preview screen
  participant Box as Image box
  Screen->>Box: render image
  Note right of Box: Image box`,
    provenance: "verified",
    blastRadiusSize: 1,
    affectedFiles: ["src/app.ts"],
  }];
  await savePersistedSession(path, session);

  const loaded = await loadPersistedSession(path);
  expect(loaded.outline!.architecture!.mermaid).toContain('graph_component["Dependency graph"]:::new');
  expect(loaded.outline!.architecture!.mermaid).toContain("app -->|creates| graph_component");
  expect(loaded.outline!.flows[0]!.mermaid).toBe(`sequenceDiagram
  participant Screen as Preview screen
  participant Box_participant as Image box
  Screen->>Box_participant: render image
  Note right of Box_participant: Image box`);
});

test("rejects unreadable JSON and unsupported persisted schemas", async () => {
  const path = await temporaryStateFile();
  await savePersistedSession(path, persistedSession());
  await writeFile(path, "not json");
  const unreadable = await loadPersistedSession(path).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect((unreadable as Error).message).toContain("Could not read review session");

  await writeFile(path, JSON.stringify({ ...persistedSession(), schemaVersion: 3 }));
  const unsupported = await loadPersistedSession(path).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect((unsupported as Error).message).toContain("unsupported or invalid schema");

  await writeFile(path, JSON.stringify({ ...persistedSession(), findingGenerationEnabled: "no" }));
  const malformedSessionOption = await loadPersistedSession(path).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect((malformedSessionOption as Error).message).toContain("unsupported or invalid schema");

  await writeFile(path, JSON.stringify({ schemaVersion: 2, repositoryRoot: "/tmp" }));
  const incomplete = await loadPersistedSession(path).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect((incomplete as Error).message).toContain("unsupported or invalid schema");
});

test("migrates legacy v1 finding metadata without discarding the session", async () => {
  const path = await temporaryStateFile();
  const current = persistedSession();
  const legacy = structuredClone(current) as unknown as Record<string, any>;
  legacy.schemaVersion = 1;
  legacy.outline.steps = legacy.outline.phases[0].steps;
  delete legacy.outline.phases;
  legacy.outline.findings = [{
    id: "legacy-finding",
    path: "src/app.ts",
    side: "new",
    line: 2,
    lineContent: "return result;",
    message: "Review this result.",
    category: "correctness",
    severity: "medium",
    confidence: "medium",
    evidence: "The changed line returns directly.",
    priority: "P2",
    introduced: null,
    recallGuard: false,
    status: "open",
  } as unknown as ReviewFinding];
  legacy.outline.flows = [{
    id: "legacy-flow",
    title: "Legacy flow",
    summary: "Saved before exact affected files were recorded.",
    mermaid: "sequenceDiagram\n  A-->>B: returns; failures are logged",
    provenance: "verified",
    blastRadiusSize: 2,
  }];
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(legacy));

  const migrated = await loadPersistedSession(path);
  expect(migrated.schemaVersion).toBe(2);
  expect(migrated.outline?.phases[0]).toMatchObject({ id: "legacy-tour", fileChanges: [{ path: "src/app.ts" }] });
  expect(migrated.outline?.findings[0]).toMatchObject({ blastRadiusSize: 0, tested: false, pinScope: "line" });
  expect(migrated.outline?.findings[0]?.phaseId).toBeUndefined();
  expect(migrated.outline?.findings[0]?.stepId).toBeUndefined();
  expect(migrated.outline?.flows[0]).toMatchObject({
    affectedFiles: [],
    blastRadiusSize: 2,
    mermaid: "sequenceDiagram\n  A-->>B: returns&#59; failures are logged",
  });
});

test("migrates the legacy generic finding dismissal to an explicit deferred disposition", async () => {
  const path = await temporaryStateFile();
  const legacy = persistedSession();
  legacy.outline!.findings = [{
    id: "dismissed-finding",
    phaseId: "behavior",
    stepId: "entrypoint",
    path: "src/app.ts",
    side: "new",
    line: 2,
    lineContent: "return result;",
    message: "Review this result.",
    category: "correctness",
    severity: "medium",
    confidence: "medium",
    evidence: "The changed line returns directly.",
    priority: "P2",
    introduced: true,
    recallGuard: false,
    blastRadiusSize: 1,
    tested: false,
    pinScope: "line",
    status: "dismissed",
  } as unknown as ReviewFinding];
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(legacy));

  const migrated = await loadPersistedSession(path);
  expect(migrated.outline?.findings[0]).toMatchObject({ status: "deferred", disposition: "deferred" });
});

test("persists explicit finding dispositions and bounded reviewer notes", async () => {
  const path = await temporaryStateFile();
  const session = persistedSession();
  session.outline!.findings = [{
    id: "finding-1",
    phaseId: "behavior",
    stepId: "entrypoint",
    path: "src/app.ts",
    side: "new",
    line: 2,
    lineContent: "return result;",
    message: "Review this result.",
    category: "correctness",
    severity: "medium",
    confidence: "medium",
    evidence: "The changed line returns directly.",
    priority: "P2",
    introduced: true,
    recallGuard: false,
    blastRadiusSize: 1,
    tested: false,
    pinScope: "line",
    status: "false-positive",
    disposition: "false-positive",
    reviewerNote: "The caller validates this value before reaching the changed line.",
  }];
  await savePersistedSession(path, session);
  await expect(loadPersistedSession(path)).resolves.toEqual(session);

  const malformed = structuredClone(session);
  malformed.outline!.findings[0]!.reviewerNote = "x".repeat(8_001);
  await writeFile(path, JSON.stringify(malformed));
  await expect(loadPersistedSession(path)).rejects.toThrow("unsupported or invalid schema");
});

test("rejects duplicate tour identities and finding scopes that do not match their anchors", async () => {
  const path = await temporaryStateFile();
  await mkdir(join(path, ".."), { recursive: true });

  const duplicateStep = persistedSession();
  duplicateStep.outline!.phases.push({
    id: "testing",
    title: "Test behavior",
    summary: "Verify the changed behavior.",
    fileChanges: [{ path: "src/app.test.ts", summary: "Verifies the behavior." }],
    steps: [{
      id: "entrypoint",
      title: "Duplicate stop",
      objective: "Inspect the duplicate stop",
      anchor: { path: "src/app.test.ts", side: "new", startLine: 1, endLine: 1 },
    }],
  });
  await writeFile(path, JSON.stringify(duplicateStep));
  await expect(loadPersistedSession(path)).rejects.toThrow("unsupported or invalid schema");

  const duplicateFinding = persistedSession();
  const finding = {
    id: "duplicate",
    path: "src/app.ts",
    side: "new" as const,
    line: 2,
    lineContent: "return result;",
    message: "Duplicate finding.",
    category: "correctness",
    severity: "medium" as const,
    confidence: "high" as const,
    evidence: "Specific evidence.",
    priority: "P2" as const,
    introduced: true,
    recallGuard: false,
    blastRadiusSize: 1,
    tested: false,
    pinScope: "line" as const,
    status: "open" as const,
  };
  duplicateFinding.outline!.findings = [finding, { ...finding }];
  await writeFile(path, JSON.stringify(duplicateFinding));
  await expect(loadPersistedSession(path)).rejects.toThrow("unsupported or invalid schema");

  const mismatchedScope = persistedSession();
  mismatchedScope.outline!.findings = [{
    id: "wrong-stop",
    phaseId: "behavior",
    stepId: "entrypoint",
    path: "src/app.ts",
    side: "old",
    line: 2,
    lineContent: "return result;",
    message: "This does not belong to the new-side stop.",
    category: "correctness",
    severity: "medium",
    confidence: "high",
    evidence: "The side does not match.",
    priority: "P2",
    introduced: null,
    recallGuard: false,
    blastRadiusSize: 1,
    tested: false,
    pinScope: "line",
    status: "open",
  }];
  await writeFile(path, JSON.stringify(mismatchedScope));
  await expect(loadPersistedSession(path)).rejects.toThrow("unsupported or invalid schema");
});

test("rejects malformed nested persisted findings while accepting their complete schema", async () => {
  const path = await temporaryStateFile();
  const valid = persistedSession();
  valid.outline!.findings = [{
    id: "finding-1",
    path: "src/app.ts",
    side: "new",
    line: 2,
    lineContent: "return result;",
    message: "Handle the empty result.",
    category: "correctness",
    severity: "high",
    confidence: "high",
    evidence: "No empty guard is visible in the new path.",
    priority: "P1",
    introduced: true,
    recallGuard: false,
    blastRadiusSize: 4,
    tested: false,
    pinScope: "line",
    status: "open",
  }];
  await savePersistedSession(path, valid);
  await expect(loadPersistedSession(path)).resolves.toEqual(valid);

  const malformed = structuredClone(valid);
  const malformedFinding = malformed.outline!.findings[0]! as { evidence?: string };
  delete malformedFinding.evidence;
  await writeFile(path, JSON.stringify(malformed));
  await expect(loadPersistedSession(path)).rejects.toThrow("unsupported or invalid schema");
});

test("rejects duplicate or malformed reviewed file paths", async () => {
  const path = await temporaryStateFile();
  await mkdir(join(path, ".."), { recursive: true });
  const duplicate = persistedSession();
  duplicate.reviewedFiles = ["src/app.ts", "src/app.ts"];
  await writeFile(path, JSON.stringify(duplicate));
  await expect(loadPersistedSession(path)).rejects.toThrow("unsupported or invalid schema");

  const malformed = persistedSession() as PersistedReviewSession & { reviewedFiles: unknown[] };
  malformed.reviewedFiles = [""];
  await writeFile(path, JSON.stringify(malformed));
  await expect(loadPersistedSession(path)).rejects.toThrow("unsupported or invalid schema");
});

test("persists complete review preferences and rejects partial or out-of-range values", async () => {
  const path = await temporaryStateFile();
  const valid = persistedSession();
  valid.preferences = {
    diffLayout: "split",
    changedFilesOnly: true,
    contextLines: 25,
    prefetchSteps: 2,
    requireAllFilesReviewed: true,
    closeOutcome: "cancelled",
    showBriefing: true,
    briefingArchitecture: true,
    briefingSequenceDiagrams: false,
    briefingCallFlows: false,
    briefingNeedsAttention: true,
    briefingReviewEffort: true,
    briefingOrder: ["architecture", "sequence-diagrams", "call-flows", "needs-attention", "review-effort"],
  };
  await savePersistedSession(path, valid);
  await expect(loadPersistedSession(path)).resolves.toEqual(valid);

  for (const preferences of [
    { ...valid.preferences, contextLines: 2 },
    { ...valid.preferences, prefetchSteps: 6 },
    { ...valid.preferences, diffLayout: "columns" },
    { diffLayout: "split" },
  ]) {
    await writeFile(path, JSON.stringify({ ...valid, preferences }));
    await expect(loadPersistedSession(path)).rejects.toThrow("unsupported or invalid schema");
  }
});

test("persists bounded review policy and rejects duplicate or malformed policy data", async () => {
  const path = await temporaryStateFile();
  const valid = persistedSession();
  valid.reviewPolicy = {
    instructions: ["Treat authentication as high risk."],
    findings: { enabled: true, categories: ["security", "correctness"], minimumSeverity: "medium" },
  };
  await savePersistedSession(path, valid);
  await expect(loadPersistedSession(path)).resolves.toEqual(valid);

  for (const reviewPolicy of [
    { instructions: ["x", "x"], findings: { enabled: true, categories: ["security"], minimumSeverity: "low" } },
    { instructions: ["x"], findings: { enabled: true, categories: ["security", "security"], minimumSeverity: "low" } },
    { instructions: ["x"], findings: { enabled: true, categories: ["security"], minimumSeverity: "info" } },
  ]) {
    await writeFile(path, JSON.stringify({ ...valid, reviewPolicy }));
    await expect(loadPersistedSession(path)).rejects.toThrow("unsupported or invalid schema");
  }
});

test("persists valid change activity and rejects malformed nested activity", async () => {
  const path = await temporaryStateFile();
  const valid = persistedSession();
  valid.activities = [{
    id: "activity-1",
    requestMessageId: "message-1",
    request: "Please update this path.",
    adapterId: "attached",
    modelId: "current-session",
    eventId: "event-1",
    files: [{
      path: "src/app.ts",
      change: "modified",
      beforeFingerprint: "before",
      afterFingerprint: "after",
      before: { status: "modified", additions: 1, deletions: 0 },
      after: { status: "modified", additions: 2, deletions: 1 },
    }],
    verification: "bun test: passed",
    status: "verified",
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:01:00.000Z",
  }];
  await savePersistedSession(path, valid);
  await expect(loadPersistedSession(path)).resolves.toEqual(valid);

  const malformed = structuredClone(valid);
  (malformed.activities![0]!.files[0] as { change: string }).change = "rewritten";
  await writeFile(path, JSON.stringify(malformed));
  await expect(loadPersistedSession(path)).rejects.toThrow("unsupported or invalid schema");
});

test("pull request state is bounded and cannot redirect its workspace or publication", async () => {
  const path = await temporaryStateFile();
  const valid = persistedSession();
  const workspace = "/private/tmp/review-state/worktrees/session/workspace";
  valid.repositoryRoot = workspace;
  valid.base = "a".repeat(40);
  valid.comments[0]!.publishToGitHub = true;
  valid.pullRequest = {
    repository: "acme/widgets", number: 7, url: "https://github.com/acme/widgets/pull/7", title: "PR", body: "", author: "author",
    baseRefName: "main", baseRefOid: valid.base, headRefName: "feature", headRefOid: "b".repeat(40), sourceRepositoryRoot: "/private/tmp/repository",
    workspaceRoot: workspace, refNamespace: "refs/diffcompass/session", commits: [], checks: [], threads: [], threadsTruncated: false,
    publication: { intentId: crypto.randomUUID(), outcome: "feedback", commentIds: ["comment-1"], status: "pending" },
    updatedAt: "2026-08-09T00:00:00.000Z",
  };
  await savePersistedSession(path, valid);
  await expect(loadPersistedSession(path)).resolves.toEqual(valid);

  for (const mutate of [
    (copy: PersistedReviewSession) => { copy.repositoryRoot = "/private/tmp/other"; },
    (copy: PersistedReviewSession) => { copy.pullRequest!.publication!.commentIds = ["missing"]; },
    (copy: PersistedReviewSession) => { copy.pullRequest!.headRefOid = "not-an-oid"; },
  ]) {
    const malformed = structuredClone(valid);
    mutate(malformed);
    await writeFile(path, JSON.stringify(malformed));
    await expect(loadPersistedSession(path)).rejects.toThrow();
  }
});

test("preserving an existing parent mode does not loosen or tighten it", async () => {
  const path = await temporaryStateFile();
  const parent = join(path, "..");
  await mkdir(parent, { recursive: true });
  if (process.platform === "win32") return;
  await chmod(parent, 0o755);

  await savePersistedSession(path, persistedSession());

  expect((await stat(parent)).mode & 0o777).toBe(0o755);
  expect((await stat(path)).mode & 0o777).toBe(0o600);
});

test("rejects persisted state files above the 20 MiB limit before parsing", async () => {
  const path = await temporaryStateFile();
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, Buffer.alloc(20 * 1024 * 1024 + 1, 0x20));

  await expect(loadPersistedSession(path)).rejects.toThrow("20 MiB limit");
});

test("rejects inconsistent persisted session relationships", async () => {
  const path = await temporaryStateFile();
  await savePersistedSession(path, persistedSession());
  const invalidIndex = persistedSession();
  invalidIndex.currentStepIndex = 2;
  await writeFile(path, JSON.stringify(invalidIndex));
  await expect(loadPersistedSession(path)).rejects.toThrow("inconsistent state");

  const wrongContinuation = persistedSession();
  wrongContinuation.selection = { adapterId: "claude", modelId: "default" };
  wrongContinuation.agentContinuation = { adapterId: "codex", id: "thread" };
  await writeFile(path, JSON.stringify(wrongContinuation));
  await expect(loadPersistedSession(path)).rejects.toThrow("inconsistent state");

  const attachedWithoutToken = persistedSession();
  attachedWithoutToken.bridgeToken = undefined;
  await writeFile(path, JSON.stringify(attachedWithoutToken));
  await expect(loadPersistedSession(path)).rejects.toThrow("inconsistent state");
});

test("accepts matched Gemini and Copilot continuation state", async () => {
  const path = await temporaryStateFile();
  for (const adapterId of ["gemini", "copilot"] as const) {
    const valid = persistedSession();
    valid.selection = { adapterId, modelId: "auto" };
    valid.agentContinuation = { adapterId, id: `${adapterId}-session` };
    await savePersistedSession(path, valid);
    await expect(loadPersistedSession(path)).resolves.toEqual(valid);
  }
});
