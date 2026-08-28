import { timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
// @ts-expect-error Bun's text loader embeds this JavaScript asset as a string.
import appScript from "../public/app.js" with { type: "text" };
import indexHtml from "../public/index.html" with { type: "text" };
// @ts-expect-error Bun's text loader embeds this CSS asset as a string.
import styles from "../public/styles.css" with { type: "text" };
// @ts-expect-error Bun's text loader embeds this JavaScript asset as a string.
import themeScript from "../public/theme.js" with { type: "text" };
// @ts-expect-error Bun's text loader embeds the local browser runtime in release binaries.
import mermaidScript from "mermaid/dist/mermaid.min.js" with { type: "text" };
import { ProcessError } from "./process.ts";
import { ReviewError } from "./errors.ts";
import { exportReview, type ExportFormat } from "./export.ts";
import { loadRepositoryFile } from "./git.ts";
import { highlightGroups, SYNTAX_THEMES, type HighlightGroup, type SyntaxTheme } from "./highlight.ts";
import { ReviewSession } from "./session.ts";
import { deleteReviewSession, listReviewSessions, resolveReviewSession, reviewSessionDirectory, updateReviewSessionMetadata } from "./session-library.ts";
import { createUpdateService, type UpdateService } from "./update.ts";
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

const PUBLIC_FILES: Record<string, { body: string; contentType: string }> = {
  "index.html": { body: String(indexHtml), contentType: "text/html; charset=utf-8" },
  "app.js": { body: String(appScript), contentType: "text/javascript; charset=utf-8" },
  "theme.js": { body: String(themeScript), contentType: "text/javascript; charset=utf-8" },
  "mermaid.min.js": { body: String(mermaidScript), contentType: "text/javascript; charset=utf-8" },
  "styles.css": { body: String(styles), contentType: "text/css; charset=utf-8" },
};
const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
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
  if (!secureEqual(request.headers.get("x-review-tour-token"), session.browserToken)) {
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

export function createRequestHandler(session: ReviewSession, sessionDirectory = reviewSessionDirectory(), updateService: UpdateService = createUpdateService(), previewRedirect = false) {
  const fetch = async (request: Request) => {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/api/bridge/")) {
        if (!session.bridge) throw new HttpError(404, "Attached-agent mode is not enabled.");
        if (!session.bridge.isAuthorized(request.headers.get("x-review-tour-token"))) {
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
      if (request.method === "GET" && url.pathname === "/api/session") return json(session.snapshot());
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
        exactKeys(input, ["prefetchSteps"]);
        if (!Number.isInteger(input.prefetchSteps) || Number(input.prefetchSteps) < 0 || Number(input.prefetchSteps) > 5) {
          throw new HttpError(422, "Prepare ahead must be between 0 and 5 steps.");
        }
        return json(await session.setPrefetchSteps(Number(input.prefetchSteps)));
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
        exactKeys(input, ["prepareMissingSteps", "includeFindings", "includeCallFlows", "includeDiagrams"]);
        for (const key of ["prepareMissingSteps", "includeFindings", "includeCallFlows", "includeDiagrams"] as const) {
          if (input[key] !== undefined && typeof input[key] !== "boolean") throw new HttpError(422, `${key} must be a boolean.`);
        }
        if (format === "html" && input.prepareMissingSteps === true) await session.prepareTourForExport();
        const artifact = exportReview(session, format, {
          includeFindings: input.includeFindings !== false,
          includeCallFlows: input.includeCallFlows !== false,
          includeDiagrams: input.includeDiagrams !== false,
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
      if (request.method === "POST" && url.pathname === "/api/files/reviewed") {
        const input = await readJsonObject(request);
        exactKeys(input, ["path", "reviewed"]);
        if (typeof input.reviewed !== "boolean") throw new HttpError(422, "reviewed must be a boolean.");
        return json(await session.setFileReviewed(requiredString(input.path, "path", 4_096), input.reviewed));
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
      const activityDiffMatch = /^\/api\/activities\/([^/]+)\/diff$/.exec(url.pathname);
      if (activityDiffMatch && request.method === "GET") {
        return json(session.activityDiff(
          decodeURIComponent(activityDiffMatch[1]),
          requiredString(url.searchParams.get("path"), "path", 4_096),
        ));
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
        exactKeys(input, ["path", "side", "line", "expectedContent", "replacement"]);
        const expectedContent = typeof input.expectedContent === "string" ? input.expectedContent : undefined;
        const replacement = typeof input.replacement === "string" ? input.replacement : undefined;
        if (expectedContent === undefined || expectedContent.length > 20_000) throw new HttpError(422, "expectedContent must be a string of at most 20,000 characters.");
        if (replacement === undefined || replacement.length > 100_000) throw new HttpError(422, "replacement must be a string of at most 100,000 characters.");
        if (expectedContent.includes("\0") || replacement.includes("\0")) throw new HttpError(422, "Inline edits cannot contain binary data.");
        return json(await session.proposeInlineEdit(
          requiredString(input.path, "path", 4_096),
          enumValue(input.side, "side", ["new"]),
          finitePositiveInteger(input.line, "line"),
          expectedContent,
          replacement,
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
      if (request.method === "POST" && url.pathname === "/api/agent/message") {
        const input = await readJsonObject(request, 32 * 1024);
        exactKeys(input, ["body", "selectedContext", "threadId", "anchor", "contextPaths"]);
        let anchor;
        if (input.anchor !== undefined) {
          if (!input.anchor || typeof input.anchor !== "object" || Array.isArray(input.anchor)) throw new ReviewError("anchor must be an object.");
          const value = input.anchor as Record<string, unknown>;
          exactKeys(value, ["path", "side", "line", "content"]);
          if (typeof value.content !== "string" || value.content.length > 16000) throw new ReviewError("Invalid anchor content.");
          anchor = { path: requiredString(value.path, "path", 4096), side: enumValue(value.side, "side", ["old", "new"]), line: finitePositiveInteger(value.line, "line"), content: value.content };
        }
        if (input.contextPaths !== undefined && (!Array.isArray(input.contextPaths) || input.contextPaths.length > 8 || input.contextPaths.some((path) => typeof path !== "string" || !path || path.length > 4_096))) {
          throw new HttpError(422, "contextPaths must contain at most 8 repository paths.");
        }
        return json(await session.ask(
          requiredString(input.body, "body", 8_000),
          optionalString(input.selectedContext, "selectedContext", 16_000),
          { threadId: optionalString(input.threadId, "threadId", 128), anchor, contextPaths: input.contextPaths as string[] | undefined },
        ));
      }
      if (request.method === "POST" && url.pathname === "/api/comments") {
        const input = await readJsonObject(request, 16 * 1024);
        exactKeys(input, ["path", "side", "line", "body"]);
        return json(await session.addComment({
          path: requiredString(input.path, "path", 4_096),
          side: enumValue(input.side, "side", ["old", "new"]),
          line: finitePositiveInteger(input.line, "line"),
          body: requiredString(input.body, "body", 8_000),
        }));
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
        return json(await session.updateComment(decodeURIComponent(commentMatch[1]), requiredString(input.body, "body", 8_000)));
      }
      if (commentMatch && request.method === "DELETE") {
        return json(await session.removeComment(decodeURIComponent(commentMatch[1])));
      }
      const findingMatch = /^\/api\/findings\/([^/]+)$/.exec(url.pathname);
      if (findingMatch && request.method === "PATCH") {
        const input = await readJsonObject(request);
        exactKeys(input, ["action"]);
        return json(await session.updateFinding(
          decodeURIComponent(findingMatch[1]),
          enumValue(input.action, "action", ["dismiss", "reopen", "convert"]),
        ));
      }
      if (request.method === "POST" && url.pathname === "/api/refresh") {
        await readJsonObject(request);
        return json(await session.refreshComparison({ source: "manual" }));
      }
      if (request.method === "POST" && url.pathname === "/api/github/refresh") {
        await readJsonObject(request);
        return json(await session.refreshPullRequest());
      }
      if (request.method === "POST" && url.pathname === "/api/github/review") {
        const input = await readJsonObject(request);
        exactKeys(input, ["outcome", "headOid", "confirm", "decision", "note"]);
        if (input.confirm !== true) throw new HttpError(422, "Publishing a GitHub review requires explicit confirmation.");
        const outcome = enumValue(input.outcome, "outcome", ["accepted", "feedback"]);
        const decision = input.decision === undefined
          ? (outcome === "accepted" ? "approve" : "request-changes")
          : enumValue(input.decision, "decision", ["approve", "approve-with-comments", "request-changes"]);
        return json(await session.publishPullRequest(outcome, requiredString(input.headOid, "headOid", 64), decision, optionalString(input.note, "note", 8_000)));
      }
      if (request.method === "POST" && url.pathname === "/api/close") {
        const input = await readJsonObject(request);
        exactKeys(input, ["outcome", "decision", "note"]);
        const outcome = parseOutcome(input.outcome);
        const decision = input.decision === undefined
          ? (outcome === "accepted" ? "approve" : outcome === "feedback" ? "request-changes" : "cancel")
          : enumValue(input.decision, "decision", ["approve", "approve-with-comments", "request-changes", "cancel"]);
        return json(await session.close(outcome, { decision, note: optionalString(input.note, "note", 8_000) }));
      }
      if (url.pathname.startsWith("/api/")) throw new HttpError(404, "API endpoint not found.");

      // Preview clients open the bare origin, so the token cannot arrive in a fragment.
      // The redirect target must differ from "/" or the browser reloads "/" forever.
      if (previewRedirect && url.pathname === "/") {
        return new Response(null, { status: 302, headers: { ...SECURITY_HEADERS, location: `/t#token=${session.browserToken}` } });
      }

      const shell = url.pathname === "/" || (previewRedirect && url.pathname === "/t");
      const relative = shell ? "index.html" : url.pathname.replace(/^\//, "");
      const publicFile = PUBLIC_FILES[relative];
      if (publicFile) {
        const response = new Response(publicFile.body, { headers: { "content-type": publicFile.contentType } });
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

export function startServer(session: ReviewSession, port: number, sessionDirectory = reviewSessionDirectory(), previewRedirect = false) {
  const options = { hostname: "127.0.0.1", idleTimeout: 60, fetch: createRequestHandler(session, sessionDirectory, undefined, previewRedirect) };
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
