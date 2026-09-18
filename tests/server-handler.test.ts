import { expect, test } from "bun:test";
import { AttachedAgentBridge } from "../src/bridge.ts";
import { createRequestHandler } from "../src/server.ts";
import { ReviewSession } from "../src/session.ts";
import type { GitComparison } from "../src/types.ts";
import packageJson from "../package.json" with { type: "json" };

function fixture() {
  const comparison: GitComparison = {
    repositoryRoot: "/private/tmp/review-tour-handler",
    repositoryName: "review-tour-handler",
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
  return { session, fetch: createRequestHandler(session, "/private/tmp/review-tour-handler-sessions") };
}

function authorizedRequest(session: ReviewSession, path: string, body: unknown) {
  return new Request(`http://127.0.0.1${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "origin": "http://127.0.0.1", "x-review-tour-token": session.browserToken },
    body: JSON.stringify(body),
  });
}

test("session API exposes the evidence briefing without a second agent pass", async () => {
  const { session, fetch } = fixture();
  const response = await fetch(new Request("http://127.0.0.1/api/session", {
    headers: { "x-review-tour-token": session.browserToken },
  }));
  expect(response.status).toBe(200);
  const payload = await response.json() as { needsAttention: { signals: Array<{ kind: string }>; estimate: { factors: unknown[] } } };
  expect(payload.needsAttention.signals.map((signal) => signal.kind)).toEqual(["tests"]);
  expect(payload.needsAttention.estimate.factors.length).toBeGreaterThan(1);
});

test("reviewer task input is authenticated, bounded, and retained locally", async () => {
  const { session, fetch } = fixture();
  (session as unknown as { pullRequest: unknown }).pullRequest = {
    repository: "acme/widgets", number: 7, url: "https://github.com/acme/widgets/pull/7", title: "PR", body: "", author: "reviewer",
    baseRefName: "main", baseRefOid: "a".repeat(40), headRefName: "feature", headRefOid: "b".repeat(40), sourceRepositoryRoot: "/tmp/widgets", workspaceRoot: "/private/tmp/review-tour-handler", refNamespace: "refs/code-review-tour/test",
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
  const fetch = createRequestHandler(session, "/private/tmp/review-tour-handler-sessions", {
    status: async () => ({ currentVersion: "1.0.6", latestVersion: "1.0.7", updateAvailable: true }),
    install: async () => { installs += 1; return { currentVersion: "1.0.6", latestVersion: "1.0.7", updateAvailable: false, updated: true }; },
  });
  const unauthorized = await fetch(new Request("http://127.0.0.1/api/update"));
  expect(unauthorized.status).toBe(401);
  const status = await fetch(new Request("http://127.0.0.1/api/update", { headers: { "x-review-tour-token": session.browserToken } }));
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

test("attached workers can report bounded progress for a leased prompt", async () => {
  const { session, fetch } = fixture();
  const updates: string[] = [];
  const answer = session.bridge!.send("Explain", "tour.explanation", undefined, (update) => updates.push(update.message));
  const eventsResponse = await fetch(new Request("http://127.0.0.1/api/bridge/events?after=0", {
    headers: { "x-review-tour-token": session.bridge!.token },
  }));
  const { events } = await eventsResponse.json() as { events: Array<{ id: string; leaseId: string }> };
  const event = events[0]!;
  const progress = await fetch(new Request("http://127.0.0.1/api/bridge/progress", {
    method: "POST",
    headers: { "content-type": "application/json", "x-review-tour-token": session.bridge!.token },
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
  const fetch = createRequestHandler(session, "/private/tmp/review-tour-handler-sessions", undefined, true);

  const redirect = await fetch(new Request("http://127.0.0.1/"));
  expect(redirect.status).toBe(302);
  expect(redirect.headers.get("location")).toBe(`/t#token=${session.browserToken}`);

  const shell = await fetch(new Request("http://127.0.0.1/t"));
  expect(shell.status).toBe(200);
  expect(shell.headers.get("content-type")).toBe("text/html; charset=utf-8");
});

test("about reports the running version and review context", async () => {
  const { session, fetch } = fixture();
  const response = await fetch(new Request("http://127.0.0.1/api/about", {
    headers: { "x-review-tour-token": session.browserToken },
  }));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    name: "Code Review Tour",
    version: packageJson.version,
    repository: "review-tour-handler",
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
  expect(await root.text()).not.toContain(session.browserToken);

  const shell = await fetch(new Request("http://127.0.0.1/t"));
  expect(shell.status).toBe(404);
});

test("preview redirect preserves the automatic tour introduction", async () => {
  const { session } = fixture();
  const fetch = createRequestHandler(session, "/private/tmp/review-tour-handler-sessions", undefined, true, true);
  const redirect = await fetch(new Request("http://127.0.0.1/"));
  expect(redirect.headers.get("location")).toBe(`/t#token=${session.browserToken}&intro=1`);
  expect((await fetch(new Request("http://127.0.0.1/t"))).status).toBe(200);
});
