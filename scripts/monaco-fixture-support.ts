// Safety wrapper for synthetic PR examples only. Normal production fixtures
// and the shipped server do not advertise the sample-thread capability.
import { lstat, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { prepareTestFixture } from "../src/test-fixture.ts";
import { loadPersistedSession } from "../src/store.ts";
import { runProcess } from "../src/process.ts";

// Resuming an arbitrary review must never opt a real repository into fixture
// edits. Require an owned, standalone temporary fixture with no Git remotes.
export async function assertEditablePrFixture(fixture: { repository: string; stateFile: string }) {
  const root = await realpath(dirname(fixture.stateFile));
  const withinTemp = relative(await realpath(tmpdir()), root);
  if (!withinTemp || withinTemp.startsWith("..") || isAbsolute(withinTemp)) throw Error("Editable PR fixtures must live in the system temporary directory.");
  const owned = await prepareTestFixture({ root }); // Existing marker/schema verification, never reset.
  const saved = await loadPersistedSession(owned.stateFile);
  if (await realpath(fixture.stateFile) !== owned.stateFile || await realpath(fixture.repository) !== owned.repository
    || owned.repository !== join(root, "repository") || saved.repositoryRoot !== owned.repository
    || saved.pullRequest?.repository !== "fixture/checkout" || !saved.pullRequest.url.startsWith("https://example.invalid/")
    || saved.pullRequest.sourceRepositoryRoot !== owned.repository || saved.pullRequest.workspaceRoot !== owned.repository) {
    throw Error("Editable PR fixtures must reference only their owned synthetic repository.");
  }
  const gitDirectory = await lstat(join(owned.repository, ".git"));
  if (!gitDirectory.isDirectory() || gitDirectory.isSymbolicLink()) throw Error("Editable PR fixtures cannot use a shared Git worktree.");
  const remotes = await runProcess(["git", "remote"], owned.repository);
  if (remotes.stdout.trim()) throw Error("Editable PR fixtures cannot have Git remotes.");
}

export function syntheticPrFixtureHandler(handler: (request: Request) => Promise<Response>, token: string, verifyEditableRepository?: () => Promise<void>) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (!["127.0.0.1", "localhost"].includes(url.hostname) || request.headers.get("host") !== url.host) return new Response("Invalid host", { status: 403 });
    if (url.pathname.startsWith("/api/")) {
      if (request.headers.get("x-diffcompass-token") !== token) return new Response("Unauthorized", { status: 401 });
      if (request.method !== "GET" && request.headers.get("origin") !== url.origin) return new Response("Invalid origin", { status: 403 });
      if (request.method === "GET" && url.pathname === "/api/update") return Response.json({ updateAvailable: false });
      // Apply/Undo use the real local pipeline, only after validating the
      // disposable repository. No GitHub or arbitrary source operations.
      let proposalAction = false;
      if (request.method === "POST" && /^\/api\/activities\/[^/]+$/.test(url.pathname)) {
        try {
          const { action } = await request.clone().json();
          proposalAction = action === "reject";
          if (verifyEditableRepository && ["apply", "undo"].includes(action)) {
            await verifyEditableRepository();
            proposalAction = true;
          }
        } catch { /* Fail closed for malformed requests or unsafe repositories. */ }
      }
      const allowed = proposalAction || (request.method === "GET"
        ? /^\/api\/(session|about|diff(?:\/sources|\/search|\/image|\/markdown)?|files|activities\/[^/]+\/diff|sequence-sources\/[^/]+|screenshots\/[^/]+)$/.test(url.pathname)
        : request.method === "POST"
          ? /^\/api\/(preferences|highlight|symbol-peek|files\/reviewed|comments|edits|agent\/message|tour\/navigate|export)$/.test(url.pathname)
          : ["PATCH", "DELETE"].includes(request.method) && /^\/api\/comments\/[^/]+$/.test(url.pathname));
      if (!allowed) return Response.json({ error: "Disabled in this synthetic PR fixture. Only validated disposable repositories support Apply/Undo; GitHub operations, generation and comparison refresh remain blocked." }, { status: 403 });
    }
    const response = await handler(request);
    if (response.ok && url.pathname.startsWith("/api/") && response.headers.get("content-type")?.includes("application/json")) {
      const data = await response.json();
      const capability = { pullRequestFixture: true, ...(verifyEditableRepository ? { fixtureCanApplySuggestions: true } : {}) };
      if (data.comparison && data.reviewedFiles) Object.assign(data, capability);
      if (data.session?.comparison) Object.assign(data.session, capability);
      if (request.method === "GET" && url.pathname === "/api/diff/sources" && !url.searchParams.has("path")) data.pullRequestFixture = true;
      const headers = new Headers(response.headers); headers.delete("content-length");
      return Response.json(data, { status: response.status, headers });
    }
    return response;
  };
}
