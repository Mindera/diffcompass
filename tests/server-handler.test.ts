import { createSemanticPresentation } from "../public/semantic-diff-presentation.js";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { AttachedAgentBridge } from "../src/bridge.ts";
import { createRequestHandler } from "../src/server.ts";
import { ReviewSession } from "../src/session.ts";
import type { GitComparison } from "../src/types.ts";
import packageJson from "../package.json" with { type: "json" };

function fixture() {
  const comparison: GitComparison = {
    repositoryRoot: "/private/tmp/diffcompass-handler",
    repositoryName: "diffcompass-handler",
    base: "main",
    mergeBase: "a".repeat(40),
    head: "b".repeat(40),
    patch: "diff --git a/app.ts b/app.ts\n+const changed = 2;\n",
    repositoryFiles: ["app.ts"],
    files: [{
      oldPath: "app.ts", newPath: "app.ts", path: "app.ts", status: "modified", metadata: [], additions: 1, deletions: 0,
      hunks: [{ header: "@@ -1,0 +1,1 @@", oldStart: 1, oldCount: 0, newStart: 1, newCount: 1, rows: [
        { kind: "addition", content: "const changed = 2;", oldLine: null, newLine: 1 },
      ] }],
    }],
  };
  type Constructor = new (comparison: GitComparison, adapters: [], defaults: Record<string, never>, bridge: AttachedAgentBridge) => ReviewSession;
  const session = new (ReviewSession as unknown as Constructor)(comparison, [], {}, new AttachedAgentBridge("bridge-token"));
  return { session, fetch: createRequestHandler(session, "/private/tmp/diffcompass-handler-sessions") };
}

function authorizedRequest(session: ReviewSession, path: string, body: unknown) {
  return new Request(`http://127.0.0.1${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "origin": "http://127.0.0.1", "x-diffcompass-token": session.browserToken },
    body: JSON.stringify(body),
  });
}

test("the served app bundle includes caption placement before its consumers", async () => {
  const { fetch } = fixture();
  const response = await fetch(new Request("http://127.0.0.1/app.js"));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("javascript");
  const bundle = await response.text();
  const captions = readFileSync(new URL("../public/diagram-labels.js", import.meta.url), "utf8");
  const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const captionStart = bundle.indexOf(captions);
  const appStart = bundle.indexOf(app);
  expect(captionStart).toBeGreaterThanOrEqual(0);
  expect(appStart).toBeGreaterThanOrEqual(0);
  expect(captionStart + captions.length).toBeLessThanOrEqual(appStart);
  const summaryPresentation = `const semanticPresentation = (${createSemanticPresentation.toString()})();`;
  const summaryUi = readFileSync(new URL("../public/semantic-diff.js", import.meta.url), "utf8");
  expect(bundle.indexOf(summaryPresentation)).toBeGreaterThanOrEqual(0);
  expect(bundle.indexOf(summaryPresentation) + summaryPresentation.length).toBeLessThanOrEqual(bundle.indexOf(summaryUi));
});

test("session API exposes the evidence briefing without a second agent pass", async () => {
  const { session, fetch } = fixture();
  const response = await fetch(new Request("http://127.0.0.1/api/session", {
    headers: { "x-diffcompass-token": session.browserToken },
  }));
  expect(response.status).toBe(200);
  const payload = await response.json() as { needsAttention: { signals: Array<{ kind: string }>; estimate: { factors: unknown[] } } };
  expect(payload.needsAttention.signals.map((signal) => signal.kind)).toEqual(["tests"]);
  expect(payload.needsAttention.estimate.factors.length).toBeGreaterThan(1);
});

test("validated Archify HTML is served in a network-denied sandbox resource and omitted from snapshots", async () => {
  const { session, fetch } = fixture();
  (session as unknown as { outline: unknown }).outline = {
    title: "Tour", summary: "Summary", phases: [{ id: "phase", title: "Phase", summary: "Summary", fileChanges: [{ path: "app.ts", summary: "Changed" }], steps: [{ id: "step", title: "Step", objective: "Review", anchor: { path: "app.ts", side: "new", startLine: 1, endLine: 1 } }] }], callFlows: [], flows: [], findings: [],
    archifyArtifacts: [{ id: "architecture-journey", type: "architecture", title: "Changed components", ir: { schema_version: 1, diagram_type: "architecture" }, html: "<!doctype html><script>window.archify=true</script>", comparison: { before: { ir: { schema_version: 1, diagram_type: "architecture" }, html: "<!doctype html><script>window.archifyBefore=true</script>", validationReceipt: '{"ok":true}' }, delta: { ir: { schema_version: 1, diagram_type: "architecture" }, html: "<!doctype html><script>window.archifyDelta=true</script>", validationReceipt: '{"ok":true}' } }, evidence: ["app.ts changed"], affectedFiles: ["app.ts"], view: "before-delta-after", validationReceipt: '{"ok":true}', renderedAt: "2026-09-18T12:00:00.000Z" }],
  };
  const snapshot = await fetch(new Request("http://127.0.0.1/api/session", { headers: { "x-diffcompass-token": session.browserToken } }));
  const snapshotText = await snapshot.text();
  expect(snapshotText).not.toContain("window.archify=true");
  expect(snapshotText).not.toContain("window.archifyBefore=true");

  const artifact = await fetch(new Request("http://127.0.0.1/archify/architecture-journey"));
  expect(artifact.status).toBe(200);
  const artifactHtml = await artifact.text();
  expect(artifactHtml).toContain("window.archify=true");
  expect(artifactHtml).toContain("data-diffcompass-embed");
  expect(artifactHtml).toContain("Fit entire map");
  expect(artifactHtml).toContain("Archify.view={zoomIn");
  expect(artifactHtml).toContain("touch-action:none");
  expect(artifactHtml).toContain("new ResizeObserver(refit)");
  expect(artifactHtml).not.toContain("container.style.height");
  expect(artifactHtml).not.toContain("pointer-events:none!important");
  expect(artifact.headers.get("content-security-policy")).toContain("connect-src 'none'");

  const before = await fetch(new Request("http://127.0.0.1/archify/architecture-journey?view=before"));
  expect(before.status).toBe(200);
  expect(await before.text()).toContain("window.archifyBefore=true");
  const delta = await fetch(new Request("http://127.0.0.1/archify/architecture-journey?view=delta"));
  expect(delta.status).toBe(200);
  expect(await delta.text()).toContain("window.archifyDelta=true");
  expect((await fetch(new Request("http://127.0.0.1/archify/architecture-journey?view=unknown"))).status).toBe(200);
});

test("reviewer task input is authenticated, bounded, and retained locally", async () => {
  const { session, fetch } = fixture();
  (session as unknown as { pullRequest: unknown }).pullRequest = {
    repository: "acme/widgets", number: 7, url: "https://github.com/acme/widgets/pull/7", title: "PR", body: "", author: "reviewer",
    baseRefName: "main", baseRefOid: "a".repeat(40), headRefName: "feature", headRefOid: "b".repeat(40), sourceRepositoryRoot: "/tmp/widgets", workspaceRoot: "/private/tmp/diffcompass-handler", refNamespace: "refs/diffcompass/test",
    commits: [], checks: [], threads: [], threadsTruncated: false, providerScope: { linkedIssue: "none", relatedResources: "not-requested" }, updatedAt: "now",
  };
  const saved = await fetch(authorizedRequest(session, "/api/pull-request/reviewer-task", {
    body: "A local description without explicit acceptance criteria.",
  }));
  expect(saved.status).toBe(200);
  expect((await saved.json()).pullRequest.reviewerTask).toMatchObject({
    body: "A local description without explicit acceptance criteria.",
    criteriaStatus: "not-found",
    acceptanceCriteria: [],
  });
  const malformed = await fetch(authorizedRequest(session, "/api/pull-request/reviewer-task", {
    body: "valid", unexpected: true,
  }));
  expect(malformed.status).toBe(422);
});

test("update endpoints expose availability and require an authenticated click to install", async () => {
  const { session } = fixture();
  let installs = 0;
  const fetch = createRequestHandler(session, "/private/tmp/diffcompass-handler-sessions", {
    status: async () => ({ currentVersion: "1.0.6", latestVersion: "1.0.7", updateAvailable: true }),
    install: async () => { installs += 1; return { currentVersion: "1.0.6", latestVersion: "1.0.7", updateAvailable: false, updated: true }; },
  });
  const unauthorized = await fetch(new Request("http://127.0.0.1/api/update"));
  expect(unauthorized.status).toBe(401);
  const status = await fetch(new Request("http://127.0.0.1/api/update", { headers: { "x-diffcompass-token": session.browserToken } }));
  expect(await status.json()).toMatchObject({ latestVersion: "1.0.7", updateAvailable: true });
  const installed = await fetch(authorizedRequest(session, "/api/update", {}));
  expect(await installed.json()).toMatchObject({ latestVersion: "1.0.7", updated: true });
  expect(installs).toBe(1);
});

test("runtime preferences persist a bounded prepare-ahead window", async () => {
  const { session, fetch } = fixture();
  const updated = await fetch(authorizedRequest(session, "/api/preferences", { prefetchSteps: 5 }));
  expect(updated.status).toBe(200);
  expect((await updated.json()).preferences).toMatchObject({ prefetchSteps: 5 });

  const invalid = await fetch(authorizedRequest(session, "/api/preferences", { prefetchSteps: 6 }));
  expect(invalid.status).toBe(422);
});

test("dry-run endpoints are authenticated, use the renderer-independent behavior identity, and reject malformed input", async () => {
  const { session, fetch } = fixture();
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const dryRuns = session as unknown as {
    prepareDryRunPlans: () => Promise<unknown>;
    updateDryRunScenario: (kind: string, flowId: string, scenario: unknown) => Promise<unknown>;
    prepareDryRun: (kind: string, flowId: string, scenarioId: string, detail?: string) => Promise<unknown>;
    cancelDryRunPreparation: () => Promise<unknown>;
  };
  dryRuns.prepareDryRunPlans = async () => { calls.push({ method: "plans", args: [] }); return { planned: true }; };
  dryRuns.updateDryRunScenario = async (...args) => { calls.push({ method: "scenario", args }); return { saved: true }; };
  dryRuns.prepareDryRun = async (...args) => { calls.push({ method: "prepare", args }); return { prepared: true }; };
  dryRuns.cancelDryRunPreparation = async () => { calls.push({ method: "cancel", args: [] }); return { cancelled: true }; };

  const toggle = await fetch(authorizedRequest(session, "/api/dry-runs/enabled", { enabled: false }));
  const planned = await fetch(authorizedRequest(session, "/api/dry-runs/plans", {}));
  const saved = await fetch(authorizedRequest(session, "/api/dry-runs/scenarios", { flowKind: "behavior", flowId: "receipt", scenario: { id: "case" } }));
  const prepared = await fetch(authorizedRequest(session, "/api/dry-runs/prepare", { flowKind: "behavior", flowId: "receipt", scenarioId: "case" }));
  const detailed = await fetch(authorizedRequest(session, "/api/dry-runs/prepare", { flowKind: "behavior", flowId: "receipt", scenarioId: "case", detail: "detailed" }));
  const cancelled = await fetch(authorizedRequest(session, "/api/dry-runs/cancel", {}));
  expect(toggle.status).toBe(404);
  expect(await planned.json()).toEqual({ planned: true });
  expect(await saved.json()).toEqual({ saved: true });
  expect(await prepared.json()).toEqual({ prepared: true });
  expect(await detailed.json()).toEqual({ prepared: true });
  expect(await cancelled.json()).toEqual({ cancelled: true });
  expect(calls).toEqual([
    { method: "plans", args: [] },
    { method: "scenario", args: ["behavior", "receipt", { id: "case" }] },
    { method: "prepare", args: ["behavior", "receipt", "case", "compact"] },
    { method: "prepare", args: ["behavior", "receipt", "case", "detailed"] },
    { method: "cancel", args: [] },
  ]);

  expect((await fetch(authorizedRequest(session, "/api/dry-runs/prepare", { flowKind: "sequence", flowId: "receipt", scenarioId: "case" }))).status).toBe(422);
  expect((await fetch(authorizedRequest(session, "/api/dry-runs/prepare", { flowKind: "behavior", flowId: "receipt", scenarioId: "case", detail: "verbose" }))).status).toBe(422);
  expect((await fetch(authorizedRequest(session, "/api/dry-runs/plans", { unexpected: true }))).status).toBe(422);
});

test("briefing preferences persist and require the complete bounded selection", async () => {
  const { session, fetch } = fixture();
  const updated = await fetch(authorizedRequest(session, "/api/preferences", {
    showBriefing: false,
    briefingArchitecture: false,
    briefingSequenceDiagrams: true,
    briefingCallFlows: true,
    briefingNeedsAttention: false,
    briefingReviewEffort: false,
    briefingOrder: ["review-effort", "needs-attention", "call-flows", "sequence-diagrams", "architecture"],
  }));
  expect(updated.status).toBe(200);
  expect((await updated.json()).preferences).toMatchObject({
    showBriefing: false,
    briefingArchitecture: false,
    briefingSequenceDiagrams: true,
    briefingCallFlows: true,
    briefingNeedsAttention: false,
    briefingReviewEffort: false,
    briefingOrder: ["review-effort", "needs-attention", "call-flows", "sequence-diagrams", "architecture"],
  });

  const reenabled = await fetch(authorizedRequest(session, "/api/preferences", {
    showBriefing: true,
    briefingArchitecture: false,
    briefingSequenceDiagrams: true,
    briefingCallFlows: true,
    briefingNeedsAttention: false,
    briefingReviewEffort: false,
    briefingOrder: ["review-effort", "needs-attention", "call-flows", "sequence-diagrams", "architecture"],
  }));
  expect(reenabled.status).toBe(200);
  expect((await reenabled.json()).preferences.showBriefing).toBe(true);

  const invalid = await fetch(authorizedRequest(session, "/api/preferences", {
    showBriefing: true,
    briefingArchitecture: true,
    briefingNeedsAttention: true,
    briefingReviewEffort: true,
    briefingOrder: ["architecture", "sequence-diagrams", "call-flows", "needs-attention", "review-effort"],
  }));
  expect(invalid.status).toBe(422);
});

test("diff preferences persist independently for desktop and mobile sessions", async () => {
  const { session, fetch } = fixture();
  const desktop = await fetch(authorizedRequest(session, "/api/preferences", { diffLayout: "unified", diffWrap: "wrap", mobile: false }));
  expect(desktop.status).toBe(200);
  expect((await desktop.json()).diffPreferences).toEqual({ desktop: { layout: "unified", wrap: "wrap" } });

  const mobile = await fetch(authorizedRequest(session, "/api/preferences", { diffLayout: "split", diffWrap: "scroll", mobile: true }));
  expect(mobile.status).toBe(200);
  expect((await mobile.json()).diffPreferences).toEqual({
    desktop: { layout: "unified", wrap: "wrap" },
    mobile: { layout: "split", wrap: "scroll" },
  });

  const invalid = await fetch(authorizedRequest(session, "/api/preferences", { diffLayout: "unified", mobile: false }));
  expect(invalid.status).toBe(422);
});

test("discussion endpoints validate paths, ranges, stop ids, and preserve quotations", async () => {
  const { session, fetch } = fixture();
  (session as unknown as { outline: unknown; currentStepIndex: number }).outline = {
    title: "Tour", summary: "Summary", phases: [{ id: "phase", title: "Phase", summary: "Summary", fileChanges: [{ path: "app.ts", summary: "Changed" }], steps: [{ id: "stop-1", title: "Current stop", objective: "Review", anchor: { path: "app.ts", side: "new", startLine: 1, endLine: 1 } }] }], callFlows: [], flows: [], findings: [],
  };
  (session as unknown as { currentStepIndex: number }).currentStepIndex = 0;
  const range = await fetch(authorizedRequest(session, "/api/comments", {
    scope: "range", path: "app.ts", side: "new", line: 1, endLine: 1,
    selectedText: "changed", context: "const changed = 2;", body: "Keep this value visible.",
  }));
  expect(range.status).toBe(200);
  expect((await range.json()).comments[0]).toMatchObject({ scope: "range", endLine: 1, selectedText: "changed", context: "const changed = 2;" });

  const stop = await fetch(authorizedRequest(session, "/api/comments", { scope: "stop", stepId: "stop-1", body: "This belongs to the stop." }));
  expect(stop.status).toBe(200);
  expect((await stop.json()).comments[1]).toMatchObject({ scope: "stop", stepId: "stop-1", path: "app.ts" });

  const invalidPath = await fetch(authorizedRequest(session, "/api/comments", { path: "../secret.ts", side: "new", line: 1, body: "bad" }));
  expect(invalidPath.status).toBe(409);
  const invalidRange = await fetch(authorizedRequest(session, "/api/comments", { scope: "range", path: "app.ts", side: "new", line: 1, endLine: 101, selectedText: "changed", body: "bad" }));
  expect(invalidRange.status).toBe(422);
  const invalidStop = await fetch(authorizedRequest(session, "/api/comments", { scope: "stop", stepId: "missing", body: "bad" }));
  expect(invalidStop.status).toBe(409);

  const invalidQuestionScope = await fetch(authorizedRequest(session, "/api/agent/message", { body: "What changed?", stepId: false }));
  expect(invalidQuestionScope.status).toBe(422);
});

test("inline edit requests accept only the editable new side", async () => {
  const { session, fetch } = fixture();
  const response = await fetch(authorizedRequest(session, "/api/edits", {
    path: "app.ts",
    side: "old",
    line: 1,
    expectedContent: "const base = 1;",
    replacement: "const base = 2;",
  }));
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ error: expect.stringContaining("side") });
});

test("inline edit drafts are comparison-scoped at the HTTP and serialized mutation boundaries", async () => {
  const { session, fetch } = fixture();
  const request = authorizedRequest(session, "/api/edits", { path: "app.ts", side: "new", line: 1, expectedContent: "const changed = 2;", replacement: "const changed = 3;" });
  request.headers.set("x-diffcompass-comparison", "old-comparison");
  expect((await fetch(request)).status).toBe(409);
  await expect(session.proposeInlineEdit("app.ts", "new", 1, "const changed = 2;", "const changed = 3;", 1, "old-comparison")).rejects.toThrow("previous comparison");
});

test("attached workers can report bounded progress for a leased prompt", async () => {
  const { session, fetch } = fixture();
  const updates: string[] = [];
  const answer = session.bridge!.send("Explain", "tour.explanation", undefined, (update) => updates.push(update.message));
  const eventsResponse = await fetch(new Request("http://127.0.0.1/api/bridge/events?after=0", {
    headers: { "x-diffcompass-token": session.bridge!.token },
  }));
  const { events } = await eventsResponse.json() as { events: Array<{ id: string; leaseId: string }> };
  const event = events[0]!;
  const progress = await fetch(new Request("http://127.0.0.1/api/bridge/progress", {
    method: "POST",
    headers: { "content-type": "application/json", "x-diffcompass-token": session.bridge!.token },
    body: JSON.stringify({ eventId: event.id, leaseId: event.leaseId, message: "Tracing the changed path." }),
  }));
  expect(progress.status).toBe(200);
  expect(updates.at(-1)).toBe("Tracing the changed path.");
  await session.bridge!.respond(event.id, "Done", event.leaseId);
  await answer;
});

test("in-process handler serves bundled Mermaid with the hardened browser policy", async () => {
  const { fetch } = fixture();
  const response = await fetch(new Request("http://127.0.0.1/mermaid.min.js"));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/javascript");
  expect(response.headers.get("content-security-policy")).toContain("script-src 'self'");
  expect((await response.text()).length).toBeGreaterThan(1_000_000);
});

test("brand assets referenced by the shell and manifest are served with their native formats", async () => {
  const { fetch } = fixture();
  const origin = "http://127.0.0.1";
  const shell = await (await fetch(new Request(origin))).text();
  const paths = [...shell.matchAll(/(?:src|href)="(\/brand\/[^\"]+)"/g)].map((match) => match[1]!);
  expect(paths.length).toBeGreaterThan(0);
  for (const path of paths) {
    const response = await fetch(new Request(new URL(path, origin)));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    if (path.endsWith(".svg")) {
      expect(response.headers.get("content-type")).toBe("image/svg+xml");
      expect(await response.text()).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    } else if (path.endsWith(".ico")) {
      expect(response.headers.get("content-type")).toBe("image/x-icon");
      expect([...new Uint8Array(await response.arrayBuffer()).slice(0, 4)]).toEqual([0, 0, 1, 0]);
    } else if (path.endsWith(".png")) {
      expect(response.headers.get("content-type")).toBe("image/png");
      expect([...new Uint8Array(await response.arrayBuffer()).slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    } else if (path.endsWith(".webmanifest")) {
      expect(response.headers.get("content-type")).toBe("application/manifest+json");
      const manifest = await response.json() as { icons: Array<{ src: string; sizes: string }> };
      for (const icon of manifest.icons) {
        const asset = await fetch(new Request(new URL(icon.src, origin + path)));
        expect(asset.status).toBe(200);
        expect(asset.headers.get("content-type")).toBe("image/png");
        const bytes = await asset.arrayBuffer();
        const png = new DataView(bytes);
        expect(`${png.getUint32(16)}x${png.getUint32(20)}`).toBe(icon.sizes);
      }
    }
  }
});

test("review shell permits authenticated video blobs without loosening script or connection policy", async () => {
  const { session, fetch } = fixture();
  const response = await fetch(new Request(`http://127.0.0.1/?token=${session.browserToken}`));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/html");
  const policy = response.headers.get("content-security-policy")!;
  const directives = new Map(policy.split(";").map((directive) => {
    const [name, ...sources] = directive.trim().split(/\s+/);
    return [name, sources];
  }));
  expect(directives.get("img-src")).toContain("https:");
  expect(directives.get("media-src")).toEqual(["'self'", "blob:"]);
  expect(directives.get("script-src")).toEqual(["'self'"]);
  expect(directives.get("connect-src")).toEqual(["'self'"]);
  expect(directives.get("object-src")).toEqual(["'none'"]);
});

test("in-process handler authenticates, bounds, and returns dual-theme highlight tokens", async () => {
  const { session, fetch } = fixture();
  const unauthorized = await fetch(new Request("http://127.0.0.1/api/highlight", {
    method: "POST", headers: { "content-type": "application/json", "origin": "http://127.0.0.1" }, body: JSON.stringify({ groups: [] }),
  }));
  expect(unauthorized.status).toBe(401);

  const response = await fetch(authorizedRequest(session, "/api/highlight", {
    groups: [{ id: "app", path: "app.ts", lines: ["const changed = 2;"] }],
  }));
  expect(response.status).toBe(200);
  const payload = await response.json() as { groups: Array<{ lines: Array<Array<{ content: string; light: string; dark: string }>> }> };
  const tokens = payload.groups[0]!.lines[0]!;
  expect(tokens.map((token) => token.content).join("")).toBe("const changed = 2;");
  expect(tokens.every((token) => /^[0-9a-f]{6}$/.test(token.light) && /^[0-9a-f]{6}$/.test(token.dark))).toBe(true);

  const discontinuous = await fetch(authorizedRequest(session, "/api/highlight", {
    groups: [
      { id: "comment-start", path: "Model.kt", lines: ["/**", " * Hidden closing delimiter follows"] },
      { id: "later-hunk", path: "Model.kt", lines: ["data class Visible(val value: String)"] },
      { id: "control", path: "Model.kt", lines: ["data class Visible(val value: String)"] },
    ],
  }));
  expect(discontinuous.status).toBe(200);
  const discontinuousPayload = await discontinuous.json() as { groups: Array<{ id: string; lines: Array<Array<{ content: string; light: string; dark: string }>> }> };
  expect(discontinuousPayload.groups.find((group) => group.id === "later-hunk")?.lines)
    .toEqual(discontinuousPayload.groups.find((group) => group.id === "control")?.lines);

  const duplicate = await fetch(authorizedRequest(session, "/api/highlight", {
    groups: [{ id: "same", path: "a.ts", lines: ["a"] }, { id: "same", path: "b.ts", lines: ["b"] }],
  }));
  expect(duplicate.status).toBe(422);
});

test("preview redirect sends a bare origin to the tokenized shell", async () => {
  const { session } = fixture();
  const fetch = createRequestHandler(session, "/private/tmp/diffcompass-handler-sessions", undefined, true);

  const redirect = await fetch(new Request("http://127.0.0.1/"));
  expect(redirect.status).toBe(302);
  expect(redirect.headers.get("location")).toBe(`/t#token=${session.browserToken}`);

  const shell = await fetch(new Request("http://127.0.0.1/t"));
  expect(shell.status).toBe(200);
  expect(shell.headers.get("content-type")).toBe("text/html; charset=utf-8");
  expect(await shell.text()).toContain('<html data-preview-host="true" lang="en">');
});

test("about reports the running version and review context", async () => {
  const { session, fetch } = fixture();
  const response = await fetch(new Request("http://127.0.0.1/api/about", {
    headers: { "x-diffcompass-token": session.browserToken },
  }));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    name: "DiffCompass",
    version: packageJson.version,
    repository: "diffcompass-handler",
    comparison: "main → working tree",
    reviewStatus: "open",
    agent: "not selected",
    mode: "working tree",
  });
});

test("preview redirect stays off by default", async () => {
  const { session, fetch } = fixture();

  const root = await fetch(new Request("http://127.0.0.1/"));
  expect(root.status).toBe(200);
  const html = await root.text();
  expect(html).not.toContain(session.browserToken);
  expect(html).not.toContain('data-preview-host="true"');

  const shell = await fetch(new Request("http://127.0.0.1/t"));
  expect(shell.status).toBe(404);
});

test("preview redirect preserves the automatic tour introduction", async () => {
  const { session } = fixture();
  const fetch = createRequestHandler(session, "/private/tmp/diffcompass-handler-sessions", undefined, true, true);
  const redirect = await fetch(new Request("http://127.0.0.1/"));
  expect(redirect.headers.get("location")).toBe(`/t#token=${session.browserToken}&intro=1`);
  expect((await fetch(new Request("http://127.0.0.1/t"))).status).toBe(200);
});
