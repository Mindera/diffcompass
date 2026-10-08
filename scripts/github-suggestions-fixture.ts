// Offline only: every launch owns a new temporary repository, and the GitHub
// runner records simulated reviews without ever executing gh or a network call.
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitHubRunner } from "../src/github.ts";
import { prepareTestFixture } from "../src/test-fixture.ts";
import { loadPersistedSession, savePersistedSession } from "../src/store.ts";
import { ReviewSession } from "../src/session.ts";
import { createRequestHandler } from "../src/server.ts";
import { assertEditablePrFixture } from "./monaco-fixture-support.ts";

const root = await mkdtemp(join(tmpdir(), "diffcompass-github-suggestions-"));
const fixture = await prepareTestFixture({ root: join(root, "fixture") });
const saved = await loadPersistedSession(fixture.stateFile);
saved.name = "Offline GitHub suggestions · simulated publication";
saved.pullRequest!.url = "https://example.invalid/fixture/pull/42";
saved.pullRequest!.linkedIssue = undefined;
saved.pullRequest!.body = "Offline suggestion-review fixture. Publish suggestions records a local payload only.";
saved.comments = [];
saved.activities = [];
if (saved.outline) delete saved.outline.issueAssessment;
saved.preferences = { ...saved.preferences!, prefetchSteps: 0, showBriefing: false };
saved.selection = { ...saved.selection!, adapterId: "attached", modelId: "Fixture responder (not AI)" };
saved.bridgeToken = crypto.randomUUID();
saved.bridgeSequence = 0;
await savePersistedSession(fixture.stateFile, saved);
await assertEditablePrFixture(fixture);

const context = saved.pullRequest!;
const payloadFile = join(root, "simulated-reviews.json");
const payloads: unknown[] = [];
const reviews: { id: number; body: string; html_url: string }[] = [];
await writeFile(payloadFile, "[]\n");
const runner: GitHubRunner = async (command, _cwd, _accepted, options) => {
  let value: unknown;
  if (command.slice(0, 3).join(" ") === "gh repo view") value = { nameWithOwner: context.repository };
  else if (command.slice(0, 3).join(" ") === "gh pr view") value = { ...context, url: "https://github.com/fixture/checkout/pull/42", author: { login: "fixture-author" }, commits: [], statusCheckRollup: [], closingIssuesReferences: [] };
  else if (command.includes("graphql")) value = { data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false }, nodes: [] } } } } };
  else if (command.at(-1)?.includes("reviews?per_page")) {
    const page = Number(new URL(command.at(-1)!, "https://api.github.com/").searchParams.get("page") ?? 1);
    value = reviews.slice((page - 1) * 100, page * 100);
  }
  else if (command.includes("--method") && command[2] === "repos/fixture/checkout/pulls/42/reviews") {
    const payload = JSON.parse(options?.input ?? "{}");
    payloads.push(payload);
    await writeFile(payloadFile, JSON.stringify(payloads, null, 2) + "\n");
    value = { id: reviews.length + 1, body: payload.body, html_url: `https://example.invalid/fixture/review/${reviews.length + 1}` };
    reviews.push(value as typeof reviews[number]);
  } else throw Error(`Unsupported offline GitHub command: ${command.join(" ")}`);
  return { stdout: JSON.stringify(value), stderr: "", exitCode: 0 };
};
const session = await ReviewSession.create(fixture.repository, undefined, {
  resume: true, stateFile: fixture.stateFile, attached: true, agentAdapters: [],
  callerModel: "Fixture responder (not AI)", githubRunner: runner, diffPreferenceDirectory: join(root, "preferences"),
});
await session.startTour({ adapterId: "attached", modelId: "Fixture responder (not AI)" });
await session.addComment({ path: "src/cart.ts", side: "new", line: 17, body: "Ordinary comment: keep this drafted when submitting suggestions." });
let answering = false;
setInterval(async () => {
  if (answering) return;
  answering = true;
  try {
    for (const event of await session.bridge!.eventsAfter(0, 0, undefined, true)) {
      if (event.type === "agent.prompt") await session.bridge!.respond(event.id, "Offline fixture response — not AI.", event.leaseId);
    }
  } catch (error) { console.error(error); } finally { answering = false; }
}, 200);

const handler = createRequestHandler(session, join(root, "sessions"));
const server = Bun.serve({ hostname: "127.0.0.1", port: Number(process.env.DIFF_VIEWER_PORT || 0), idleTimeout: 60,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      if (!["127.0.0.1", "localhost"].includes(url.hostname) || request.headers.get("host") !== url.host ||
        request.headers.get("x-diffcompass-token") !== session.browserToken ||
        (request.method !== "GET" && request.headers.get("origin") !== url.origin)) return new Response("Unauthorized", { status: 403 });
      if (request.method === "GET" && url.pathname === "/api/update") return Response.json({ updateAvailable: false });
      const allowed = request.method === "GET" || (request.method === "POST"
        ? /^\/api\/(preferences|highlight|symbol-peek|files\/reviewed|comments|edits|agent\/message|tour\/navigate|activities\/[^/]+(?:\/github)?|github\/suggestions)$/.test(url.pathname)
        : ["PATCH", "DELETE"].includes(request.method) && /^\/api\/comments\/[^/]+(?:\/github)?$/.test(url.pathname));
      if (!allowed) return Response.json({ error: "Disabled in the offline suggestions fixture." }, { status: 403 });
    }
    return handler(request);
  },
});
console.log(`Production fixture: http://127.0.0.1:${server.port}/#token=${session.browserToken}`);
console.log(`Repository: ${fixture.repository}`);
console.log(`Simulated reviews: ${payloadFile}`);
console.log("Offline fixture: Publish suggestions writes only the local JSON above. No real GitHub reviews are sent.");
