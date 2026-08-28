import { expect, test } from "bun:test";
import { AttachedAgentBridge } from "../src/bridge.ts";
import { createRequestHandler } from "../src/server.ts";
import { ReviewSession } from "../src/session.ts";
import type { GitComparison } from "../src/types.ts";

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

test("preview redirect stays off by default", async () => {
  const { session, fetch } = fixture();

  const root = await fetch(new Request("http://127.0.0.1/"));
  expect(root.status).toBe(200);
  expect(await root.text()).not.toContain(session.browserToken);

  const shell = await fetch(new Request("http://127.0.0.1/t"));
  expect(shell.status).toBe(404);
});
