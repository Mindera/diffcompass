import { timingSafeEqual } from "node:crypto";
import { monacoAsset } from "./monaco-assets.ts";
import { resolve } from "node:path";
import { withArchifyEmbedAdapter } from "./archify-embed.ts";
import { highlightedSequenceSources } from "./sequence-walkthrough-preview.ts";
import { BRAND_FILES } from "./brand.ts";
// @ts-expect-error Bun's text loader embeds this JavaScript asset as a string.
import appScript from "../public/app.js" with { type: "text" };
// @ts-expect-error Bun embeds the sequence iframe lifecycle bridge.
import sequenceWalkthroughHost from "../public/sequence-walkthrough-host.js" with { type: "text" };
// @ts-expect-error Bun embeds the shared browser runtime.
import mapPresentationScript from "../public/map-presentation.js" with { type: "text" };
// @ts-expect-error Bun embeds the shared caption layout runtime.
import diagramLabelsScript from "../public/diagram-labels.js" with { type: "text" };
import indexHtml from "../public/index.html" with { type: "text" };
// @ts-expect-error Bun's text loader embeds this CSS asset as a string.
import styles from "../public/styles.css" with { type: "text" };
// @ts-expect-error Bun embeds the shared native/embedded map skin.
import mapNodeStyles from "../public/map-nodes.css" with { type: "text" };
// @ts-expect-error Bun's text loader embeds this JavaScript asset as a string.
import themeScript from "../public/theme.js" with { type: "text" };
// @ts-expect-error Bun's text loader embeds the local browser runtime in release binaries.
import mermaidScript from "mermaid/dist/mermaid.min.js" with { type: "text" };
import packageJson from "../package.json" with { type: "json" };
import { ProcessError } from "./process.ts";
import { ReviewError } from "./errors.ts";
import { exportReview, htmlHighlightGroups, type ExportFormat } from "./export.ts";
import { loadRepositoryFile } from "./git.ts";
import { diffSourceIdentity, diffSourceManifest, loadDiffSource } from "./diff-sources.ts";
import { highlightGroups, SYNTAX_THEMES, type HighlightGroup, type SyntaxTheme } from "./highlight.ts";
import { resolveSymbolPeek } from "./symbol-peek.ts";
import { ReviewSession } from "./session.ts";
import { deleteReviewSession, listReviewSessions, resolveReviewSession, reviewSessionDirectory, updateReviewSessionMetadata } from "./session-library.ts";
import { createUpdateService, type UpdateService } from "./update.ts";
import { isBriefingSectionOrder, type BriefingPreferences } from "./types.ts";
import {
  enumValue,
  exactKeys,
  finitePositiveInteger,
  HttpError,
  optionalString,
  parseAgentSelection,
  parseOutcome,
  readJsonObject,
  requiredString,
} from "./validation.ts";

const PUBLIC_FILES: Record<string, { body: BodyInit; contentType: string }> = {
  ...BRAND_FILES,
  "index.html": { body: String(indexHtml), contentType: "text/html; charset=utf-8" },
  "app.js": { body: String(diagramLabelsScript) + "\n" + String(appScript) + "\n" + String(mapPresentationScript), contentType: "text/javascript; charset=utf-8" },
  "theme.js": { body: String(themeScript), contentType: "text/javascript; charset=utf-8" },
  "sequence-walkthrough-host.js": { body: String(sequenceWalkthroughHost), contentType: "text/javascript; charset=utf-8" },
  "mermaid.min.js": { body: String(mermaidScript), contentType: "text/javascript; charset=utf-8" },
  "styles.css": { body: `${styles}\n${mapNodeStyles}`, contentType: "text/css; charset=utf-8" },
};
const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

function json(value: unknown, status = 200): Response {
  const response = Response.json(value, { status });
  for (const [name, headerValue] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, headerValue);
  return response;
}

function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: error.message }, error.status);
  if (error instanceof ReviewError) return json({ error: error.message }, 409);
  if (error instanceof ProcessError) {
    console.error(error);
    const githubReviewPublication = error.command[0] === "gh" &&
      error.command.includes("api") &&
      error.command.some((part) => /^repos\/[^/]+\/[^/]+\/pulls\/\d+\/reviews$/.test(part)) &&
      error.command.includes("--method") && error.command.includes("POST");
    const githubStatus = /\(HTTP (\d{3})\)/.exec(error.stderr)?.[1];
    if (githubReviewPublication && githubStatus === "422") {
      return json({ error: "GitHub rejected this review (HTTP 422). It was not published. GitHub can reject approvals on your own pull request." }, 422);
    }
    return json({ error: "The agent command failed. Check the server terminal for details." }, 502);
  }
  const requestId = crypto.randomUUID();
  console.error(`[${requestId}]`, error);
  return json({ error: `Unexpected review error. Check the server terminal with request id ${requestId}.` }, 500);
}

function secureEqual(actual: string | null, expected: string): boolean {
  if (actual === null) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function requireBrowserAuthorization(request: Request, session: ReviewSession): void {
  if (!secureEqual(request.headers.get("x-diffcompass-token"), session.browserToken)) {
    throw new HttpError(401, "Invalid review session token.");
  }
  if (!["GET", "HEAD"].includes(request.method)) {
    const requestUrl = new URL(request.url);
    const origin = request.headers.get("origin");
    const fetchSite = request.headers.get("sec-fetch-site");
    if (origin !== requestUrl.origin || (fetchSite && !["same-origin", "none"].includes(fetchSite))) {
      throw new HttpError(403, "Cross-origin review mutations are not allowed.");
    }
  }
}

export function createRequestHandler(session: ReviewSession, sessionDirectory = reviewSessionDirectory(), updateService: UpdateService = createUpdateService(), previewRedirect = false, launchTourIntro = false) {
  const fetch = async (request: Request) => {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/api/bridge/")) {
        if (!session.bridge) throw new HttpError(404, "Attached-agent mode is not enabled.");
        if (!session.bridge.isAuthorized(request.headers.get("x-diffcompass-token"))) {
          throw new HttpError(401, "Invalid attached-agent bridge token.");
        }
        if (request.method === "GET" && url.pathname === "/api/bridge/context") {
          return json({ comparison: session.comparison, session: session.snapshot() });
        }
        if (request.method === "GET" && url.pathname === "/api/bridge/events") {
          const after = Math.max(0, Number(url.searchParams.get("after") ?? 0) || 0);
          const waitMs = Math.max(0, Number(url.searchParams.get("waitMs") ?? 0) || 0);
          return json({ events: await session.bridge.eventsAfter(after, waitMs, request.signal, true) });
        }
        if (request.method === "POST" && url.pathname === "/api/bridge/respond") {
          const input = await readJsonObject(request, 512 * 1024);
          exactKeys(input, ["eventId", "message", "leaseId"]);
          await session.bridge.respond(
            requiredString(input.eventId, "eventId", 128),
            requiredString(input.message, "message", 500_000),
            requiredString(input.leaseId, "leaseId", 128),
          );
          return json({ accepted: true });
        }
        if (request.method === "POST" && url.pathname === "/api/bridge/ack") {
          const input = await readJsonObject(request);
          exactKeys(input, ["eventId", "leaseId"]);
          await session.bridge.ack(requiredString(input.eventId, "eventId", 128), requiredString(input.leaseId, "leaseId", 128));
          return json({ accepted: true });
        }
        if (request.method === "POST" && url.pathname === "/api/bridge/renew") {
          const input = await readJsonObject(request);
          exactKeys(input, ["eventId", "leaseId"]);
          await session.bridge.renew(requiredString(input.eventId, "eventId", 128), requiredString(input.leaseId, "leaseId", 128));
          return json({ renewed: true });
        }
        if (request.method === "POST" && url.pathname === "/api/bridge/progress") {
          const input = await readJsonObject(request, 16 * 1024);
          exactKeys(input, ["eventId", "leaseId", "message"]);
          session.bridge.reportProgress(
            requiredString(input.eventId, "eventId", 128),
            requiredString(input.leaseId, "leaseId", 128),
            requiredString(input.message, "message", 2_000),
          );
          return json({ accepted: true });
        }
        if (request.method === "POST" && url.pathname === "/api/bridge/refresh") {
          const input = await readJsonObject(request);
          exactKeys(input, ["eventId", "leaseId", "verification"]);
          const eventId = requiredString(input.eventId, "eventId", 128);
          const leaseId = requiredString(input.leaseId, "leaseId", 128);
          session.bridge.validateRefresh(eventId, leaseId);
          const snapshot = await session.refreshComparison({
            source: "agent",
            eventId,
            verification: optionalString(input.verification, "verification", 16_000),
          });
          session.bridge.authorizeRefresh(eventId, leaseId, session.currentComparisonGeneration);
          return json(snapshot);
        }
        throw new HttpError(404, "Bridge endpoint not found.");
      }

      if (url.pathname.startsWith("/api/")) requireBrowserAuthorization(request, session);
      const capturedComparison = request.headers.get("x-diffcompass-comparison");
      if (url.pathname.startsWith("/api/") && !["GET", "HEAD"].includes(request.method) && capturedComparison !== null && capturedComparison !== diffSourceIdentity(session.comparison)) {
        throw new HttpError(409, "This draft belongs to a previous comparison. Copy or cancel it before reviewing the new source.");
      }
      if (request.method === "GET" && url.pathname.startsWith("/api/sequence-sources/")) {
        const id = decodeURIComponent(url.pathname.slice("/api/sequence-sources/".length));
        const edge = url.searchParams.get("edge");
        const comparison = session.comparison;
        const sources = edge ? await session.resolveArchifySequenceSources(id, edge) : session.archifySequenceSources(id);
        return json(await highlightedSequenceSources(sources, comparison));
      }
      if (request.method === "GET" && url.pathname.startsWith("/archify/")) {
        const id = decodeURIComponent(url.pathname.slice("/archify/".length));
        const artifact = session.archifyArtifact(id);
        if (!artifact) throw new HttpError(404, "Archify artifact is unavailable.");
        const requestedView = url.searchParams.get("view");
        const comparisonView = requestedView === "before" ? artifact.comparison?.before : requestedView === "delta" ? artifact.comparison?.delta : undefined;
        if ((requestedView === "before" || requestedView === "delta") && !comparisonView) throw new HttpError(404, "That comparison state is unavailable for this map.");
        const html = comparisonView?.html ?? artifact.html;
        const sources = artifact.type === "sequence" && !comparisonView
          ? await highlightedSequenceSources(session.archifySequenceSources(id), session.comparison) : {};
        // Archify artifacts are validated at generation time and additionally
        // sandboxed by the iframe. This CSP makes their self-contained viewer
        // interactive while forbidding all network and parent-page access.
        return new Response(withArchifyEmbedAdapter(html, artifact.type, requestedView === "before" ? undefined : artifact.domainDetails, artifact.purpose === "domain-model", requestedView === "before" ? undefined : artifact.nodeRoles, sources, { ir: comparisonView?.ir ?? artifact.ir }), {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
            "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; worker-src blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
            "referrer-policy": "no-referrer",
            "x-content-type-options": "nosniff",
          },
        });
      }
      if (request.method === "GET" && url.pathname === "/api/session") return json(session.snapshot());
      if (request.method === "GET" && url.pathname === "/api/diff/sources") {
        const comparison = session.comparison;
        const path = url.searchParams.get("path");
        if (path === null) return json(diffSourceManifest(comparison));
        const comparisonId = url.searchParams.get("comparisonId") ?? "";
        const generation = session.currentComparisonGeneration;
        const result = await loadDiffSource(comparison, comparisonId, path);
        if (generation !== session.currentComparisonGeneration || comparisonId !== diffSourceIdentity(session.comparison)) {
          throw new HttpError(409, "The comparison changed while loading source. Reload the diff.");
        }
        return json(result);
      }
      if (request.method === "GET" && url.pathname === "/api/about") {
        const snapshot = session.snapshot();
        return json({
          name: "DiffCompass",
          version: packageJson.version,
          runtime: `Bun ${Bun.version}`,
          repository: snapshot.comparison.repositoryName,
          repositoryPath: snapshot.comparison.repositoryRoot,
          comparison: `${snapshot.comparison.base} → working tree`,
          reviewStatus: snapshot.status,
          agent: snapshot.agentSelection?.adapterId ?? "not selected",
          mode: snapshot.pullRequest ? "pull request workspace" : "working tree",
        });
      }
      if (request.method === "GET" && url.pathname.startsWith("/api/screenshots/")) {
        const id = url.pathname.slice("/api/screenshots/".length);
        const screenshot = session.screenshot(id);
        if (!screenshot) throw new HttpError(404, "Media not found.");
        const file = Bun.file(screenshot.path);
        if (!await file.exists()) throw new HttpError(404, "Media asset is unavailable.");
        const response = new Response(file, { headers: { "content-type": screenshot.metadata.mimeType } });
        for (const [name, headerValue] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, headerValue);
        return response;
      }
      if (request.method === "POST" && url.pathname === "/api/preferences") {
        const input = await readJsonObject(request);
        exactKeys(input, ["prefetchSteps", "diffLayout", "diffWrap", "mobile", "showBriefing", "briefingArchitecture", "briefingSequenceDiagrams", "briefingCallFlows", "briefingNeedsAttention", "briefingReviewEffort", "briefingOrder"]);
        if (input.prefetchSteps !== undefined) {
          if (Object.keys(input).length !== 1 || !Number.isInteger(input.prefetchSteps) || Number(input.prefetchSteps) < 0 || Number(input.prefetchSteps) > 5) {
            throw new HttpError(422, "Prepare ahead must be between 0 and 5 steps.");
          }
          return json(await session.setPrefetchSteps(Number(input.prefetchSteps)));
        }
        const briefingKeys = ["showBriefing", "briefingArchitecture", "briefingSequenceDiagrams", "briefingCallFlows", "briefingNeedsAttention", "briefingReviewEffort", "briefingOrder"] as const;
        const briefingBooleanKeys = briefingKeys.slice(0, -1);
        if (briefingKeys.some((key) => input[key] !== undefined)) {
          if (Object.keys(input).length !== briefingKeys.length || briefingBooleanKeys.some((key) => typeof input[key] !== "boolean") || !isBriefingSectionOrder(input.briefingOrder)) {
            throw new HttpError(422, "Briefing preferences must include six boolean values and each briefing section exactly once.");
          }
          return json(await session.setBriefingPreferences({
            showBriefing: input.showBriefing as boolean,
            briefingArchitecture: input.briefingArchitecture as boolean,
            briefingSequenceDiagrams: input.briefingSequenceDiagrams as boolean,
            briefingCallFlows: input.briefingCallFlows as boolean,
            briefingNeedsAttention: input.briefingNeedsAttention as boolean,
            briefingReviewEffort: input.briefingReviewEffort as boolean,
            briefingOrder: input.briefingOrder as BriefingPreferences["briefingOrder"],
          }));
        }
        if (input.diffLayout === undefined || input.diffWrap === undefined || typeof input.mobile !== "boolean" ||
          !["unified", "split"].includes(String(input.diffLayout)) || !["scroll", "wrap"].includes(String(input.diffWrap))) {
          throw new HttpError(422, "Diff preferences must include a valid layout, wrap mode, and device scope.");
        }
        return json(await session.setDiffPreferences(input.mobile ? "mobile" : "desktop", {
          layout: input.diffLayout as "unified" | "split",
          wrap: input.diffWrap as "scroll" | "wrap",
        }));
      }
      if (request.method === "GET" && url.pathname === "/api/update") return json(await updateService.status());
      if (request.method === "POST" && url.pathname === "/api/update") {
        const input = await readJsonObject(request);
        exactKeys(input, []);
        return json(await updateService.install());
      }
      if (request.method === "POST" && url.pathname === "/api/export") {
        const format = enumValue(url.searchParams.get("format"), "format", ["markdown", "html"]) as ExportFormat;
        const input = await readJsonObject(request);
        exactKeys(input, ["prepareMissingSteps", "includeFindings", "includeCallFlows", "includeStructuralBlastRadius", "includeDiagrams", "includeDryRuns", "diffWrap"]);
        for (const key of ["prepareMissingSteps", "includeFindings", "includeCallFlows", "includeStructuralBlastRadius", "includeDiagrams", "includeDryRuns"] as const) {
          if (input[key] !== undefined && typeof input[key] !== "boolean") throw new HttpError(422, `${key} must be a boolean.`);
        }
        if (input.diffWrap !== undefined && input.diffWrap !== "scroll" && input.diffWrap !== "wrap") throw new HttpError(422, "diffWrap must be scroll or wrap.");
        if (format === "html" && input.prepareMissingSteps === true) await session.prepareTourForExport();
        const highlightedGroups = format === "html" ? await highlightGroups(htmlHighlightGroups(session), "diffcompass") : undefined;
        const markdownPreviews = format === "html"
          ? (await Promise.all(session.comparison.files
            .filter((file) => /\.md$/i.test(file.path))
            .flatMap((file) => {
              const sides: Array<"old" | "new"> = [];
              if (file.oldPath) sides.push("old");
              if (file.newPath) sides.push("new");
              return sides.map(async (side) => {
                try {
                  return { path: file.path, side, content: await session.diffText(file.path, side) };
                } catch {
                  return undefined;
                }
              });
            }))).filter((preview): preview is NonNullable<typeof preview> => preview !== undefined)
          : undefined;
        const artifact = exportReview(session, format, {
          includeFindings: input.includeFindings !== false,
          includeCallFlows: input.includeCallFlows !== false,
          includeStructuralBlastRadius: input.includeStructuralBlastRadius !== false,
          includeDiagrams: input.includeDiagrams !== false,
          includeDryRuns: input.includeDryRuns !== false,
          diffWrap: input.diffWrap as "scroll" | "wrap" | undefined,
          highlightedGroups,
          markdownPreviews,
        });
        const baseName = session.comparison.repositoryName.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "code-review";
        const response = new Response(artifact.content, {
          headers: {
            "content-type": artifact.contentType,
            "content-disposition": `attachment; filename="${baseName}-review.${artifact.extension}"`,
          },
        });
        for (const [name, headerValue] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, headerValue);
        return response;
      }
      if (request.method === "GET" && url.pathname === "/api/sessions") {
        return json(await listReviewSessions(sessionDirectory, url.searchParams.get("all") === "true"));
      }
      const sessionMatch = /^\/api\/sessions\/([^/]+)$/.exec(url.pathname);
      if (sessionMatch && request.method === "PATCH") {
        const id = decodeURIComponent(sessionMatch[1]);
        const input = await readJsonObject(request);
        exactKeys(input, ["action", "name"]);
        const action = enumValue(input.action, "action", ["rename", "archive", "unarchive"]);
        const updated = await updateReviewSessionMetadata(id, action === "rename"
          ? { name: requiredString(input.name, "name", 200) }
          : { archived: action === "archive" }, sessionDirectory);
        return json(updated);
      }
      if (sessionMatch && request.method === "DELETE") {
        const id = decodeURIComponent(sessionMatch[1]);
        const input = await readJsonObject(request);
        exactKeys(input, ["confirm"]);
        if (input.confirm !== true) throw new HttpError(422, "Session deletion requires explicit confirmation.");
        const target = await resolveReviewSession(id, sessionDirectory);
        if (session.stateFile && resolve(target.path) === resolve(session.stateFile)) {
          throw new HttpError(409, "The currently running session cannot delete itself. Close its server first.");
        }
        return json(await deleteReviewSession(id, sessionDirectory));
      }
      if (request.method === "GET" && url.pathname === "/api/files") {
        const path = requiredString(url.searchParams.get("path"), "path", 4_096);
        return json({ path, content: await loadRepositoryFile(session.comparison, path) });
      }
      if (request.method === "POST" && url.pathname === "/api/symbol-peek") {
        const input = await readJsonObject(request);
        exactKeys(input, ["symbol", "path", "line", "side"]);
        const line = input.line === undefined ? undefined : finitePositiveInteger(input.line, "line");
        return json(await resolveSymbolPeek(session.comparison, {
          symbol: requiredString(input.symbol, "symbol", 200),
          path: input.path === undefined ? undefined : requiredString(input.path, "path", 4_096),
          line,
          side: input.side === undefined ? undefined : enumValue(input.side, "side", ["old", "new"]),
        }));
      }
      if (request.method === "POST" && url.pathname === "/api/files/reviewed") {
        const input = await readJsonObject(request);
        exactKeys(input, ["path", "reviewed"]);
        if (typeof input.reviewed !== "boolean") throw new HttpError(422, "reviewed must be a boolean.");
        return json(await session.setFileReviewed(requiredString(input.path, "path", 4_096), input.reviewed, capturedComparison ?? undefined));
      }
      if (request.method === "GET" && url.pathname === "/api/diff/search") {
        const queryValue = url.searchParams.get("q");
        const query = queryValue === null || queryValue === "" ? "" : optionalString(queryValue, "q", 200) ?? "";
        const statuses = url.searchParams.getAll("status").map((status) => enumValue(status, "status", ["added", "deleted", "modified", "renamed"]));
        return json(session.searchDiff(query, statuses));
      }
      if (request.method === "POST" && url.pathname === "/api/highlight") {
        const input = await readJsonObject(request, 4 * 1024 * 1024);
        exactKeys(input, ["groups", "theme"]);
        const syntaxTheme = input.theme === undefined ? "github" : enumValue(input.theme, "theme", SYNTAX_THEMES) as SyntaxTheme;
        if (!Array.isArray(input.groups) || input.groups.length > 200) throw new HttpError(422, "groups must be an array with at most 200 entries.");
        let totalLines = 0;
        let totalCharacters = 0;
        const ids = new Set<string>();
        const groups = input.groups.map((candidate): HighlightGroup => {
          if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new HttpError(422, "Each highlight group must be an object.");
          const value = candidate as Record<string, unknown>;
          exactKeys(value, ["id", "path", "lines"]);
          const id = requiredString(value.id, "id", 128);
          const path = requiredString(value.path, "path", 4_096);
          if (ids.has(id)) throw new HttpError(422, "Highlight group ids must be unique.");
          ids.add(id);
          if (!Array.isArray(value.lines) || value.lines.length > 12_000 || !value.lines.every((line) => typeof line === "string" && line.length <= 20_000)) {
            throw new HttpError(422, "Highlight lines are malformed or exceed their limits.");
          }
          totalLines += value.lines.length;
          totalCharacters += value.lines.reduce((sum, line) => sum + String(line).length, 0);
          return { id, path, lines: value.lines as string[] };
        });
        if (totalLines > 12_000 || totalCharacters > 2_000_000) throw new HttpError(413, "The highlight request is too large.");
        return json({ groups: await highlightGroups(groups, syntaxTheme) });
      }
      if (request.method === "GET" && url.pathname === "/api/diff") {
        const path = requiredString(url.searchParams.get("path"), "path", 4_096);
        const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
        const limit = Math.max(100, Math.min(2_000, Number(url.searchParams.get("limit") ?? 1_000) || 1_000));
        const lineValue = url.searchParams.get("line");
        const line = lineValue === null ? undefined : finitePositiveInteger(Number(lineValue), "line");
        const sideValue = url.searchParams.get("side");
        const side = sideValue === null ? undefined : enumValue(sideValue, "side", ["old", "new"]);
        const contextValue = url.searchParams.get("context");
        const context = contextValue === null ? session.preferences.contextLines : Math.min(200, finitePositiveInteger(Number(contextValue), "context"));
        const fullValue = url.searchParams.get("full");
        const full = fullValue === null ? false : enumValue(fullValue, "full", ["true", "false"]) === "true";
        if ((line === undefined) !== (side === undefined)) throw new HttpError(400, "line and side must be provided together.");
        const diff = full || context > 3
          ? await session.expandedDiffFile(path, context, offset, limit, full)
          : session.diffFile(path, offset, limit, line && side ? { line, side } : undefined);
        return json({ ...diff, revision: session.revision, context, full });
      }
      if (request.method === "GET" && url.pathname === "/api/diff/image") {
        const path = requiredString(url.searchParams.get("path"), "path", 4_096);
        const side = enumValue(url.searchParams.get("side"), "side", ["old", "new"]);
        const image = await session.diffImage(path, side);
        const response = new Response(image.data, { headers: { "content-type": image.mimeType } });
        for (const [name, headerValue] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, headerValue);
        return response;
      }
      if (request.method === "GET" && url.pathname === "/api/diff/markdown") {
        const path = requiredString(url.searchParams.get("path"), "path", 4_096);
        const side = enumValue(url.searchParams.get("side"), "side", ["old", "new"]);
        return json({ path, side, content: await session.diffText(path, side) });
      }
      const activityDiffMatch = /^\/api\/activities\/([^/]+)\/diff$/.exec(url.pathname);
      if (activityDiffMatch && request.method === "GET") {
        return json(session.activityDiff(
          decodeURIComponent(activityDiffMatch[1]),
          requiredString(url.searchParams.get("path"), "path", 4_096),
        ));
      }
      const suggestionPublicationMatch = /^\/api\/activities\/([^/]+)\/github$/.exec(url.pathname);
      if (suggestionPublicationMatch && request.method === "POST") {
        const input = await readJsonObject(request);
        exactKeys(input, ["queue", "headOid"]);
        if (typeof input.queue !== "boolean") throw new HttpError(422, "queue must be a boolean.");
        return json(await session.setSuggestionPublication(decodeURIComponent(suggestionPublicationMatch[1]!), input.queue,
          input.queue ? requiredString(input.headOid, "headOid", 64) : undefined));
      }
      const activityMatch = /^\/api\/activities\/([^/]+)$/.exec(url.pathname);
      if (activityMatch && request.method === "POST") {
        const input = await readJsonObject(request);
        exactKeys(input, ["action"]);
        return json(await session.updateActivity(
          decodeURIComponent(activityMatch[1]),
          enumValue(input.action, "action", ["apply", "reject", "undo"]),
        ));
      }
      if (request.method === "POST" && url.pathname === "/api/edits") {
        const input = await readJsonObject(request, 128 * 1024);
        exactKeys(input, ["path", "side", "line", "endLine", "expectedContent", "replacement"]);
        const expectedContent = typeof input.expectedContent === "string" ? input.expectedContent : undefined;
        const replacement = typeof input.replacement === "string" ? input.replacement : undefined;
        if (expectedContent === undefined || expectedContent.length > 100_000) throw new HttpError(422, "expectedContent must be a string of at most 100,000 characters.");
        if (replacement === undefined || replacement.length > 100_000) throw new HttpError(422, "replacement must be a string of at most 100,000 characters.");
        if (expectedContent.includes("\0") || replacement.includes("\0")) throw new HttpError(422, "Inline edits cannot contain binary data.");
        return json(await session.proposeInlineEdit(
          requiredString(input.path, "path", 4_096),
          enumValue(input.side, "side", ["new"]),
          finitePositiveInteger(input.line, "line"),
          expectedContent,
          replacement,
          input.endLine === undefined ? undefined : finitePositiveInteger(input.endLine, "endLine"),
          capturedComparison ?? undefined,
        ));
      }
      if (request.method === "POST" && url.pathname === "/api/tour/start") {
        return json(await session.startTour(parseAgentSelection(await readJsonObject(request))));
      }
      if (request.method === "POST" && url.pathname === "/api/tour/navigate") {
        const input = await readJsonObject(request);
        exactKeys(input, ["direction"]);
        return json(await session.navigate(enumValue(input.direction, "direction", ["previous", "next"])));
      }
      const flowMatch = /^\/api\/flows\/([^/]+)$/.exec(url.pathname);
      if (flowMatch && request.method === "PATCH") {
        const input = await readJsonObject(request, 128 * 1024);
        exactKeys(input, ["title", "summary", "mermaid", "provenance", "blastRadiusSize", "affectedFiles"]);
        const blastRadiusSize = Number(input.blastRadiusSize);
        if (!Number.isInteger(blastRadiusSize) || blastRadiusSize < 0 || blastRadiusSize > 100_000) {
          throw new HttpError(422, "blastRadiusSize must be an integer between 0 and 100000.");
        }
        if (!Array.isArray(input.affectedFiles) || input.affectedFiles.length > 100 || input.affectedFiles.some((path) => typeof path !== "string" || !path.trim() || path.length > 4_096)) {
          throw new HttpError(422, "affectedFiles must contain at most 100 changed paths.");
        }
        return json(await session.updateFlow(decodeURIComponent(flowMatch[1]), {
          title: requiredString(input.title, "title", 8_000),
          summary: requiredString(input.summary, "summary", 50_000),
          mermaid: requiredString(input.mermaid, "mermaid", 12_000),
          provenance: enumValue(input.provenance, "provenance", ["verified", "partial", "unverified"]),
          blastRadiusSize,
          affectedFiles: input.affectedFiles,
        }));
      }
      if (request.method === "POST" && url.pathname === "/api/diagrams/retry") {
        const input = await readJsonObject(request);
        exactKeys(input, ["type"]);
        enumValue(input.type, "type", ["sequence"]);
        return json(await session.retrySequenceDiagrams());
      }
      if (request.method === "POST" && url.pathname === "/api/flows/regenerate") {
        const input = await readJsonObject(request);
        exactKeys(input, ["id"]);
        return json(await session.regenerateFlows(optionalString(input.id, "id", 128)));
      }
      if (request.method === "POST" && url.pathname === "/api/call-flows/regenerate") {
        const input = await readJsonObject(request);
        exactKeys(input, ["id"]);
        return json(await session.regenerateCallFlows(optionalString(input.id, "id", 128)));
      }
      if (request.method === "POST" && url.pathname === "/api/dry-runs/plans") {
        const input = await readJsonObject(request);
        exactKeys(input, []);
        return json(await session.prepareDryRunPlans());
      }
      if (request.method === "POST" && url.pathname === "/api/dry-runs/scenarios") {
        const input = await readJsonObject(request, 96 * 1024);
        exactKeys(input, ["flowKind", "flowId", "scenario"]);
        if (input.flowKind !== "behavior") throw new HttpError(422, "flowKind must be behavior.");
        return json(await session.updateDryRunScenario(
          "behavior",
          requiredString(input.flowId, "flowId", 128),
          input.scenario,
        ));
      }
      if (request.method === "POST" && url.pathname === "/api/dry-runs/prepare") {
        const input = await readJsonObject(request);
        exactKeys(input, ["flowKind", "flowId", "scenarioId", "detail"]);
        if (input.flowKind !== "behavior") throw new HttpError(422, "flowKind must be behavior.");
        if (input.detail !== undefined && input.detail !== "compact" && input.detail !== "detailed") throw new HttpError(422, "detail must be compact or detailed.");
        return json(await session.prepareDryRun(
          "behavior",
          requiredString(input.flowId, "flowId", 128),
          requiredString(input.scenarioId, "scenarioId", 128),
          input.detail === "detailed" ? "detailed" : "compact",
        ));
      }
      if (request.method === "POST" && url.pathname === "/api/dry-runs/cancel") {
        const input = await readJsonObject(request);
        exactKeys(input, []);
        return json(await session.cancelDryRunPreparation());
      }
      if (request.method === "POST" && url.pathname === "/api/agent/message") {
        const input = await readJsonObject(request, 32 * 1024);
        exactKeys(input, ["body", "selectedContext", "threadId", "stepId", "anchor", "contextPaths", "dryRunContext"]);
        let anchor;
        if (input.anchor !== undefined) {
          if (!input.anchor || typeof input.anchor !== "object" || Array.isArray(input.anchor)) throw new ReviewError("anchor must be an object.");
          const value = input.anchor as Record<string, unknown>;
          exactKeys(value, ["path", "side", "line", "endLine", "content", "selectedText", "context"]);
          if (typeof value.content !== "string" || value.content.length > 20000) throw new ReviewError("Invalid anchor content.");
          if (value.endLine !== undefined && (!Number.isSafeInteger(value.endLine) || Number(value.endLine) < Number(value.line) || Number(value.endLine) - Number(value.line) > 99)) {
            throw new ReviewError("Invalid anchor range.");
          }
          if (value.selectedText !== undefined && (typeof value.selectedText !== "string" || !value.selectedText.trim() || value.selectedText.length > 16000)) throw new ReviewError("Invalid selected quotation.");
          if (value.context !== undefined && (typeof value.context !== "string" || value.context.length > 32000)) throw new ReviewError("Invalid selected context.");
          anchor = {
            path: requiredString(value.path, "path", 4096),
            side: enumValue(value.side, "side", ["old", "new"]),
            line: finitePositiveInteger(value.line, "line"),
            ...(value.endLine === undefined ? {} : { endLine: Number(value.endLine) }),
            content: value.content,
            ...(value.selectedText === undefined ? {} : { selectedText: value.selectedText }),
            ...(value.context === undefined ? {} : { context: value.context }),
          };
        }
        if (input.contextPaths !== undefined && (!Array.isArray(input.contextPaths) || input.contextPaths.length > 8 || input.contextPaths.some((path) => typeof path !== "string" || !path || path.length > 4_096))) {
          throw new HttpError(422, "contextPaths must contain at most 8 repository paths.");
        }
        let dryRunContext;
        if (input.dryRunContext !== undefined) {
          if (!input.dryRunContext || typeof input.dryRunContext !== "object" || Array.isArray(input.dryRunContext)) throw new HttpError(422, "dryRunContext must be an object.");
          const value = input.dryRunContext as Record<string, unknown>;
          exactKeys(value, ["traceId", "flowId", "scenarioId", "stepId"]);
          dryRunContext = {
            traceId: requiredString(value.traceId, "dryRunContext.traceId", 128),
            flowId: requiredString(value.flowId, "dryRunContext.flowId", 128),
            scenarioId: requiredString(value.scenarioId, "dryRunContext.scenarioId", 128),
            stepId: requiredString(value.stepId, "dryRunContext.stepId", 128),
          };
        }
        return json(await session.ask(
          requiredString(input.body, "body", 8_000),
          optionalString(input.selectedContext, "selectedContext", 16_000),
          {
            threadId: optionalString(input.threadId, "threadId", 128),
            ...(input.stepId === null ? { stepId: null } : { stepId: optionalString(input.stepId, "stepId", 128) }),
            anchor,
            contextPaths: input.contextPaths as string[] | undefined,
            dryRunContext,
          },
          capturedComparison ?? undefined,
        ));
      }
      if (request.method === "POST" && url.pathname === "/api/comments") {
        const input = await readJsonObject(request, 16 * 1024);
        exactKeys(input, ["scope", "path", "side", "line", "endLine", "selectedText", "context", "stepId", "body"]);
        const scope = input.scope === undefined ? undefined : enumValue(input.scope, "scope", ["line", "range", "stop"]);
        if (input.endLine !== undefined && (!Number.isSafeInteger(input.endLine) || Number(input.endLine) < Number(input.line) || Number(input.endLine) - Number(input.line) > 99)) {
          throw new HttpError(422, "endLine must be an ordered range of at most 100 lines.");
        }
        if (input.selectedText !== undefined && (typeof input.selectedText !== "string" || !input.selectedText.trim() || input.selectedText.length > 16_000)) {
          throw new HttpError(422, "selectedText must be non-empty and at most 16,000 characters.");
        }
        if (input.context !== undefined && (typeof input.context !== "string" || input.context.length > 32_000)) {
          throw new HttpError(422, "context must be at most 32,000 characters.");
        }
        return json(await session.addComment({
          scope,
          ...(input.path === undefined ? {} : { path: requiredString(input.path, "path", 4_096) }),
          ...(input.side === undefined ? {} : { side: enumValue(input.side, "side", ["old", "new"]) }),
          ...(input.line === undefined ? {} : { line: finitePositiveInteger(input.line, "line") }),
          ...(input.endLine === undefined ? {} : { endLine: Number(input.endLine) }),
          ...(input.selectedText === undefined ? {} : { selectedText: input.selectedText as string }),
          ...(input.context === undefined ? {} : { context: input.context as string }),
          ...(input.stepId === undefined ? {} : { stepId: requiredString(input.stepId, "stepId", 128) }),
          body: requiredString(input.body, "body", 8_000),
        }, capturedComparison ?? undefined));
      }
      const commentMatch = /^\/api\/comments\/([^/]+)$/.exec(url.pathname);
      const commentPublicationMatch = /^\/api\/comments\/([^/]+)\/github$/.exec(url.pathname);
      if (commentPublicationMatch && request.method === "PATCH") {
        const input = await readJsonObject(request);
        exactKeys(input, ["publish"]);
        if (typeof input.publish !== "boolean") throw new HttpError(422, "publish must be a boolean.");
        return json(await session.setCommentPublication(decodeURIComponent(commentPublicationMatch[1]), input.publish));
      }
      if (commentMatch && request.method === "PATCH") {
        const input = await readJsonObject(request, 16 * 1024);
        exactKeys(input, ["body"]);
        return json(await session.updateComment(decodeURIComponent(commentMatch[1]), requiredString(input.body, "body", 8_000), capturedComparison ?? undefined));
      }
      if (commentMatch && request.method === "DELETE") {
        return json(await session.removeComment(decodeURIComponent(commentMatch[1])));
      }
      const findingMatch = /^\/api\/findings\/([^/]+)$/.exec(url.pathname);
      if (findingMatch && request.method === "PATCH") {
        const input = await readJsonObject(request, 16 * 1024);
        exactKeys(input, ["action", "disposition", "note", "publish"]);
        const action = enumValue(input.action, "action", ["dismiss", "reopen", "convert", "set-disposition", "accepted", "false-positive", "intentional", "deferred", "fixed", "obsolete-after-refresh"] as const);
        const disposition = input.disposition === undefined
          ? undefined
          : enumValue(input.disposition, "disposition", ["accepted", "false-positive", "intentional", "deferred", "fixed", "obsolete-after-refresh"] as const);
        if (action === "set-disposition" && disposition === undefined) throw new HttpError(422, "disposition is required when setting a finding disposition.");
        if (action !== "set-disposition" && disposition !== undefined && action !== disposition) throw new HttpError(422, "disposition must match action.");
        if (input.publish !== undefined && typeof input.publish !== "boolean") throw new HttpError(422, "publish must be a boolean.");
        if (input.publish === true && action !== "convert") throw new HttpError(422, "publish is supported only when converting a finding to feedback.");
        const update = action === "set-disposition" ? disposition! : action;
        return json(await session.updateFinding(decodeURIComponent(findingMatch[1]), update, optionalString(input.note, "note", 8_000), input.publish === true));
      }
      if (request.method === "POST" && url.pathname === "/api/refresh") {
        await readJsonObject(request);
        return json(await session.refreshComparison({ source: "manual" }));
      }
      if (request.method === "POST" && url.pathname === "/api/comparison/view") {
        const input = await readJsonObject(request);
        exactKeys(input, ["view"]);
        return json(await session.setComparisonView(enumValue(input.view, "view", ["full", "since-last-review"])));
      }
      if (request.method === "POST" && url.pathname === "/api/checkpoints") {
        const input = await readJsonObject(request);
        exactKeys(input, ["label"]);
        return json(await session.createManualCheckpoint(optionalString(input.label, "label", 500)));
      }
      const checkpointMatch = /^\/api\/checkpoints\/([^/]+)$/.exec(url.pathname);
      if (checkpointMatch && request.method === "DELETE") {
        return json(await session.deleteCheckpoint(decodeURIComponent(checkpointMatch[1])));
      }
      if (request.method === "POST" && url.pathname === "/api/github/refresh") {
        await readJsonObject(request);
        return json(await session.refreshPullRequest());
      }
      if (request.method === "POST" && url.pathname === "/api/pull-request/reviewer-task") {
        const input = await readJsonObject(request, 128 * 1024);
        exactKeys(input, ["body"]);
        return json(await session.saveReviewerTask(requiredString(input.body, "body", 100_000)));
      }
      if (request.method === "POST" && url.pathname === "/api/github/suggestions") {
        const input = await readJsonObject(request);
        exactKeys(input, ["headOid", "confirm", "commentIds"]);
        if (input.confirm !== true) throw new HttpError(422, "Publishing GitHub suggestions requires explicit confirmation.");
        if (!Array.isArray(input.commentIds) || !input.commentIds.length || input.commentIds.length > 10_000 ||
          input.commentIds.some(id => typeof id !== "string" || !id || id.length > 128) || new Set(input.commentIds).size !== input.commentIds.length) throw new HttpError(422, "commentIds must contain unique suggestion identifiers.");
        return json(await session.publishGitHubSuggestions(requiredString(input.headOid, "headOid", 64), input.commentIds as string[]));
      }
      if (request.method === "POST" && url.pathname === "/api/github/review") {
        const input = await readJsonObject(request);
        exactKeys(input, ["outcome", "headOid", "confirm", "decision", "note", "commentIds"]);
        if (input.confirm !== true) throw new HttpError(422, "Publishing a GitHub review requires explicit confirmation.");
        if (input.commentIds !== undefined && (!Array.isArray(input.commentIds) || input.commentIds.length > 10_000 ||
          input.commentIds.some(id => typeof id !== "string" || !id || id.length > 128) || new Set(input.commentIds).size !== input.commentIds.length)) throw new HttpError(422, "commentIds must contain unique review comment identifiers.");
        const outcome = enumValue(input.outcome, "outcome", ["accepted", "feedback"]);
        const decision = input.decision === undefined
          ? (outcome === "accepted" ? "approve" : "request-changes")
          : enumValue(input.decision, "decision", ["approve", "approve-with-comments", "request-changes"]);
        return json(await session.publishPullRequest(outcome, requiredString(input.headOid, "headOid", 64), decision, optionalString(input.note, "note", 8_000), input.commentIds as string[] | undefined));
      }
      if (request.method === "POST" && url.pathname === "/api/close") {
        const input = await readJsonObject(request);
        exactKeys(input, ["outcome", "decision", "note", "localOnly"]);
        const outcome = parseOutcome(input.outcome);
        const decision = input.decision === undefined
          ? (outcome === "accepted" ? "approve" : outcome === "feedback" ? "request-changes" : "cancel")
          : enumValue(input.decision, "decision", ["approve", "approve-with-comments", "request-changes", "cancel"]);
        const localOnly = input.localOnly === true;
        if (localOnly && (outcome !== "accepted" || !["approve", "approve-with-comments"].includes(decision))) {
          throw new HttpError(422, "Local-only closure is available only for pull request approval.");
        }
        return json(await session.close(outcome, { decision, note: optionalString(input.note, "note", 8_000), localOnly }));
      }
      if (url.pathname.startsWith("/api/")) throw new HttpError(404, "API endpoint not found.");

      // Preview clients open the bare origin, so the token cannot arrive in a fragment.
      // The redirect target must differ from "/" or the browser reloads "/" forever.
      if (previewRedirect && url.pathname === "/") {
        return new Response(null, { status: 302, headers: { ...SECURITY_HEADERS, location: `/t#token=${session.browserToken}${launchTourIntro ? "&intro=1" : ""}` } });
      }

      const monacoFile = await monacoAsset(url.pathname);
      if (monacoFile) {
        const headers = new Headers({ ...SECURITY_HEADERS, "content-type": monacoFile.type });
        if (monacoFile.frame) {
          headers.set("x-frame-options", "SAMEORIGIN");
          headers.set("content-security-policy", SECURITY_HEADERS["content-security-policy"].replace("frame-ancestors 'none'", "frame-ancestors 'self'") + "; worker-src 'self' blob:; font-src 'self' data:");
        }
        return new Response(monacoFile.body, { headers });
      }
      const shell = url.pathname === "/" || (previewRedirect && url.pathname === "/t");
      const relative = shell ? "index.html" : url.pathname.replace(/^\//, "");
      const publicFile = PUBLIC_FILES[relative];
      if (publicFile) {
        // Preview hosts can draw native controls over the web viewport without
        // reporting an inset. Mark this explicit launch mode, not a guessed UA.
        const body = shell && previewRedirect
          ? String(publicFile.body).replace("<html ", '<html data-preview-host="true" ')
          : publicFile.body;
        const response = new Response(body, { headers: { "content-type": publicFile.contentType } });
        for (const [name, headerValue] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, headerValue);
        return response;
      }
      return new Response("Not found", { status: 404, headers: SECURITY_HEADERS });
    } catch (error) {
      return errorResponse(error);
    }
  };

  return fetch;
}

// Local preview tools skip the OS ephemeral range (49152+) when scanning for servers,
// so an OS-assigned port leaves the review undiscoverable.
const DISCOVERABLE_PORT_START = 47550;
const DISCOVERABLE_PORT_END = 47599;

export function startServer(session: ReviewSession, port: number, sessionDirectory = reviewSessionDirectory(), previewRedirect = false, launchTourIntro = false) {
  const options = { hostname: "127.0.0.1", idleTimeout: 60, fetch: createRequestHandler(session, sessionDirectory, undefined, previewRedirect, launchTourIntro) };
  if (port !== 0) return Bun.serve({ ...options, port });
  for (let candidate = DISCOVERABLE_PORT_START; candidate <= DISCOVERABLE_PORT_END; candidate += 1) {
    try {
      return Bun.serve({ ...options, port: candidate });
    } catch (error) {
      if ((error as { code?: string }).code !== "EADDRINUSE") throw error;
    }
  }
  return Bun.serve({ ...options, port: 0 });
}
