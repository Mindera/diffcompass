import { mkdtemp, writeFile, mkdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, sep } from "node:path";
import { createRequestHandler } from "../../src/server.ts";
import { ReviewSession } from "../../src/session.ts";
import { runProcess } from "../../src/process.ts";
import { files, locate, sourceAnchor } from "./fixtures.mjs";

// This process only reviews its own disposable fixture, never the user's repo.
const root = await mkdtemp(join(tmpdir(), "diffcompass-viewer-"));
const repo = join(root, "repository");
await mkdir(repo);
const git = (...args: string[]) => runProcess(["git", ...args], repo);
await git("init", "-b", "main");
await git("config", "user.name", "Diff viewer fixture");
await git("config", "user.email", "fixture@example.invalid");
for (const file of files) if (file.old) await writeFile(join(repo, file.path), file.old);
await git("add", ".");
await git("commit", "-m", "Fixture baseline");
const base = (await git("rev-parse", "HEAD")).stdout.trim();
for (const file of files) if (file.new) await writeFile(join(repo, file.path), file.new);
await git("rm", "removed.ts");
await git("add", ".");
await git("commit", "-m", "Fixture change");
const session = await ReviewSession.create(repo, base, { attached: true, callerModel: "Fixture responder (not AI)", agentAdapters: [], stateFile: join(root, "session.json"), diffPreferenceDirectory: join(root, "preferences") });
session.preferences.prefetchSteps = 0;
session.preferences.showBriefing = false;
const receiptLine = locate(files[0]!.new, "const amount = total");
session.outline = { title: "Diff viewer comparison", summary: "One fixture, two renderers. Questions use a deterministic test responder, not AI.", phases: [{ id: "checkout", title: "Checkout", summary: "Review discount and receipt changes.", fileChanges: files.map(f => ({ path: f.path, summary: "Comparison fixture" })), steps: [{ id: "discount", title: "Discount calculation", objective: "Check percentage handling", anchor: { path: "checkout.ts", side: "new", startLine: 18, endLine: 19 }, explanation: "The new implementation treats the discount as a percentage and clamps it to 0–100." }] }], callFlows: [], flows: [], findings: [{ id: "rounding", message: "Check rounding at the display boundary", lineContent: files[0]!.new.split("\n")[receiptLine]!, category: "correctness", severity: "medium", confidence: "medium", evidence: "Fixture only: display formatting changed to toFixed(2).", introduced: true, recallGuard: false, blastRadiusSize: 1, tested: false, pinScope: "line", status: "open", priority: "P2", path: "checkout.ts", side: "new", line: receiptLine + 1 }] };
// All explanations are fixture-authored, so starting the tour initializes its
// selection/step state without asking any agent to generate content.
await session.startTour({ adapterId: "attached", modelId: "Fixture responder (not AI)", includeArchitecture: false, includeCallFlows: false, includeFlows: false, includeFindings: false, includeAdaptiveDiagrams: false, includeDryRuns: false, includeArchify: false });
for (const body of ["Why clamp the percentage?", "Should invalid discounts be reported instead?"]) {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  session.messages.push({ id, threadId: id, role: "user", body, createdAt, anchor: sourceAnchor(files[0], "new", { startLineNumber: 18, startColumn: 1, endLineNumber: 19, endColumn: 40 }) });
  session.messages.push({ id: crypto.randomUUID(), threadId: id, role: "agent", body: "Fixture response — not an AI answer. This seeded conversation demonstrates a source-linked discussion.", createdAt });
}
await session.addComment({ path: "checkout.ts", side: "new", line: 19, body: "Fixture comment: should we clamp invalid discounts or report them?" });
let answering = false;
setInterval(async () => {
  if (answering) return;
  answering = true;
  try {
    for (const event of await session.bridge!.eventsAfter(0, 0, undefined, true)) {
      if (event.type === "agent.prompt") await session.bridge!.respond(event.id, "Fixture responder — not an AI answer. The real question pipeline received your selected path, source side, line range, quotation, and question. No agent was invoked and no source was edited.", event.leaseId);
    }
  } catch (error) { console.error(error); } finally { answering = false; }
}, 200);
const handler = createRequestHandler(session, join(root, "sessions"));
let vendor = resolve(import.meta.dir, "node_modules/monaco-editor/min");
if (!await Bun.file(join(vendor, "vs/loader.js")).exists()) vendor = resolve(import.meta.dir, "../../node_modules/monaco-editor/min");
vendor = await realpath(vendor);
const assets = new Map(["index.html", "app.mjs", "styles.css", "current-bridge.js", "current.css", "fixtures.mjs", "annotations.mjs"].map(name => [`/prototype/${name}`, join(import.meta.dir, name)]));
const server = Bun.serve({ hostname: "127.0.0.1", port: Number(process.env.DIFF_VIEWER_PORT || 47620), idleTimeout: 120, async fetch(request) {
  const url = new URL(request.url);
  if (request.headers.get("host") !== url.host || !["127.0.0.1", "localhost"].includes(url.hostname)) return new Response("Invalid host", { status: 403 });
  if (url.pathname === "/") return Response.redirect(`/prototype/index.html#token=${session.browserToken}`);
  const file = assets.get(url.pathname);
  if (file) return new Response(Bun.file(file), { headers: { "cache-control": "no-store", "content-security-policy": "frame-ancestors 'self'", "x-content-type-options": "nosniff" } });
  if (url.pathname.startsWith("/vendor/")) {
    const requested = resolve(vendor, decodeURIComponent(url.pathname.slice(8)));
    if (!requested.startsWith(vendor + sep)) return new Response("Forbidden", { status: 403 });
    return await Bun.file(requested).exists() ? new Response(Bun.file(requested)) : new Response("Not found", { status: 404 });
  }
  if (url.pathname === "/api/prototype") {
    if (request.headers.get("x-diffcompass-token") !== session.browserToken) return new Response("Unauthorized", { status: 401 });
    return Response.json({ files, receiptLine, revision: session.revision, root });
  }
  // The framed app probes for updates on boot. Keep that probe local and inert.
  if (url.pathname === "/api/update" && request.method === "GET") {
    if (request.headers.get("x-diffcompass-token") !== session.browserToken) return new Response("Unauthorized", { status: 401 });
    return Response.json({ updateAvailable: false });
  }
  // No installs, releases, real agent edits, global session deletion or external publication.
  if (url.pathname.startsWith("/api/") && !/^\/api\/(session$|diff(?:\/|$)|files(?:$|\/)|highlight$|comments(?:$|\/)|agent\/message$|symbol-peek(?:$|\/)|findings(?:$|\/)|preferences$)/.test(url.pathname)) return Response.json({ error: "Disabled in this isolated prototype" }, { status: 403 });
  const mapped = url.pathname === "/current" ? new Request(new URL("/index.html", url), request) : request;
  const response = await handler(mapped);
  const headers = new Headers(response.headers);
  // Only this isolated harness may embed the production page. Production CSP is unchanged.
  headers.delete("x-frame-options");
  headers.set("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'");
  if (url.pathname === "/current") return new Response((await response.text()).replace("</head>", '<link rel="stylesheet" href="/prototype/current.css"></head>'), { headers });
  if (url.pathname === "/app.js") return new Response((await response.text()) + "\n" + await Bun.file(join(import.meta.dir, "current-bridge.js")).text(), { headers });
  return new Response(response.body, { status: response.status, headers });
} });
console.log(`Compare: http://127.0.0.1:${server.port}/#token=${session.browserToken}`);
console.log(`Disposable review: ${root}`);
