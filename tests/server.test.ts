import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AttachedAgentBridge } from "../src/bridge.ts";
import { loadComparison } from "../src/git.ts";
import { runProcess } from "../src/process.ts";
import { startServer } from "../src/server.ts";
import { ReviewSession } from "../src/session.ts";

const repositories: string[] = [];
const servers: Array<ReturnType<typeof startServer>> = [];

afterEach(async () => {
  for (const server of servers.splice(0)) server.stop(true);
  await Promise.all(repositories.splice(0).map((repository) => rm(repository, { recursive: true, force: true })));
});

async function git(cwd: string, ...args: string[]) {
  return runProcess(["git", ...args], cwd);
}

type ReviewSessionConstructor = new (
  comparison: Awaited<ReturnType<typeof loadComparison>>,
  adapters: [],
  defaults: Record<string, never>,
  bridge: AttachedAgentBridge,
) => ReviewSession;

async function fixture() {
  const repository = await mkdtemp(join(tmpdir(), "review-tour-server-"));
  repositories.push(repository);
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

  const comparison = await loadComparison(repository);
  const bridge = new AttachedAgentBridge("bridge-token-0123456789");
  const session = new (ReviewSession as unknown as ReviewSessionConstructor)(comparison, [], {}, bridge);
  const server = startServer(session, 0);
  servers.push(server);
  const url = `http://${server.hostname}:${server.port}`;
  return { bridge, comparison, session, url };
}

function browserHeaders(url: string, token: string, headers: HeadersInit = {}): Headers {
  return new Headers({
    "content-type": "application/json",
    "origin": url,
    "x-review-tour-token": token,
    ...headers,
  });
}

async function jsonRequest(url: string, path: string, init: RequestInit = {}) {
  return fetch(`${url}${path}`, init);
}

test("browser and bridge endpoints require their own non-interchangeable token", async () => {
  const { bridge, session, url } = await fixture();

  expect((await jsonRequest(url, "/api/session")).status).toBe(401);
  expect((await jsonRequest(url, "/api/session", {
    headers: { "x-review-tour-token": bridge.token },
  })).status).toBe(401);
  expect((await jsonRequest(url, "/api/session", {
    headers: { "x-review-tour-token": session.browserToken },
  })).status).toBe(200);

  expect((await jsonRequest(url, "/api/bridge/context", {
    headers: { "x-review-tour-token": session.browserToken },
  })).status).toBe(401);
  expect((await jsonRequest(url, "/api/bridge/context", {
    headers: { "x-review-tour-token": bridge.token },
  })).status).toBe(200);
});

test("bridge responses require the active event lease", async () => {
  const { bridge, url } = await fixture();
  const answer = bridge.send("Explain", "tour.explanation");
  const eventResponse = await jsonRequest(url, "/api/bridge/events?after=0", {
    headers: { "x-review-tour-token": bridge.token },
  });
  const { events } = await eventResponse.json() as { events: Array<{ id: string; leaseId: string }> };
  const event = events[0]!;
  const headers = { "content-type": "application/json", "x-review-tour-token": bridge.token };

  expect((await jsonRequest(url, "/api/bridge/respond", {
    method: "POST", headers, body: JSON.stringify({ eventId: event.id, leaseId: "wrong", message: "No" }),
  })).status).toBe(409);
  expect((await jsonRequest(url, "/api/bridge/renew", {
    method: "POST", headers, body: JSON.stringify({ eventId: event.id, leaseId: event.leaseId }),
  })).status).toBe(200);
  expect((await jsonRequest(url, "/api/bridge/respond", {
    method: "POST", headers, body: JSON.stringify({ eventId: event.id, leaseId: event.leaseId, message: "Yes" }),
  })).status).toBe(200);
  await expect(answer).resolves.toBe("Yes");
});

test("a same-code-unit Unicode token mismatch is rejected as unauthorized rather than crashing", async () => {
  const { session, url } = await fixture();
  (session as { browserToken: string }).browserToken = "é";

  const response = await jsonRequest(url, "/api/session", {
    headers: { "x-review-tour-token": "a" },
  });
  expect(response.status).toBe(401);
});

test("browser mutations require an authenticated same-origin JSON request", async () => {
  const { session, url } = await fixture();
  const validComment = { path: "app.ts", side: "new", line: 2, body: "Explain this branch." };

  expect((await jsonRequest(url, "/api/comments", {
    method: "POST",
    headers: { "content-type": "application/json", "x-review-tour-token": session.browserToken },
    body: JSON.stringify(validComment),
  })).status).toBe(403);
  expect((await jsonRequest(url, "/api/comments", {
    method: "POST",
    headers: browserHeaders(url, session.browserToken, { origin: "http://attacker.invalid" }),
    body: JSON.stringify(validComment),
  })).status).toBe(403);
  expect((await jsonRequest(url, "/api/comments", {
    method: "POST",
    headers: browserHeaders(url, session.browserToken),
    body: JSON.stringify(validComment),
  })).status).toBe(200);
});

test("comment API rejects malformed bodies and anchors outside the diff", async () => {
  const { session, url } = await fixture();
  const headers = browserHeaders(url, session.browserToken);

  expect((await jsonRequest(url, "/api/comments", {
    method: "POST",
    headers: browserHeaders(url, session.browserToken, { "content-type": "text/plain" }),
    body: "not json",
  })).status).toBe(415);
  expect((await jsonRequest(url, "/api/comments", {
    method: "POST",
    headers,
    body: JSON.stringify({ path: "app.ts", side: "new", line: 2, body: "Note", unexpected: true }),
  })).status).toBe(422);
  expect((await jsonRequest(url, "/api/comments", {
    method: "POST",
    headers,
    body: JSON.stringify({ path: "app.ts", side: "new", line: 2, body: "x".repeat(20_000) }),
  })).status).toBe(413);
  expect((await jsonRequest(url, "/api/comments", {
    method: "POST",
    headers,
    body: JSON.stringify({ path: "missing.ts", side: "new", line: 1, body: "Fake feedback" }),
  })).status).toBe(409);
  expect((await jsonRequest(url, "/api/comments", {
    method: "POST",
    headers,
    body: JSON.stringify({ path: "app.ts", side: "old", line: 200, body: "Bad line" }),
  })).status).toBe(409);
});

test("close is terminal while an identical close remains idempotent", async () => {
  const { session, url } = await fixture();
  const headers = browserHeaders(url, session.browserToken);

  expect((await jsonRequest(url, "/api/close", {
    method: "POST",
    headers,
    body: JSON.stringify({ outcome: "accepted" }),
  })).status).toBe(200);
  expect((await jsonRequest(url, "/api/close", {
    method: "POST",
    headers,
    body: JSON.stringify({ outcome: "accepted" }),
  })).status).toBe(200);
  expect((await jsonRequest(url, "/api/close", {
    method: "POST",
    headers,
    body: JSON.stringify({ outcome: "feedback" }),
  })).status).toBe(409);
  expect((await jsonRequest(url, "/api/comments", {
    method: "POST",
    headers,
    body: JSON.stringify({ path: "app.ts", side: "new", line: 2, body: "Too late" }),
  })).status).toBe(409);
});
