import { timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
// @ts-expect-error Bun's text loader embeds this JavaScript asset as a string.
import appScript from "../public/app.js" with { type: "text" };
import indexHtml from "../public/index.html" with { type: "text" };
// @ts-expect-error Bun's text loader embeds this CSS asset as a string.
import styles from "../public/styles.css" with { type: "text" };
// @ts-expect-error Bun's text loader embeds this JavaScript asset as a string.
import themeScript from "../public/theme.js" with { type: "text" };
import { ProcessError } from "./process.ts";
import { ReviewError } from "./errors.ts";
import { loadRepositoryFile } from "./git.ts";
import { ReviewSession } from "./session.ts";
import { deleteReviewSession, listReviewSessions, resolveReviewSession, reviewSessionDirectory, updateReviewSessionMetadata } from "./session-library.ts";
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
  "styles.css": { body: String(styles), contentType: "text/css; charset=utf-8" },
};
const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
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

export function startServer(session: ReviewSession, port: number, sessionDirectory = reviewSessionDirectory()) {
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
        if ((line === undefined) !== (side === undefined)) throw new HttpError(400, "line and side must be provided together.");
        const diff = context > 3
          ? await session.expandedDiffFile(path, context, offset, limit)
          : session.diffFile(path, offset, limit, line && side ? { line, side } : undefined);
        return json({ ...diff, revision: session.revision, context });
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
      if (request.method === "POST" && url.pathname === "/api/tour/start") {
        return json(await session.startTour(parseAgentSelection(await readJsonObject(request))));
      }
      if (request.method === "POST" && url.pathname === "/api/tour/navigate") {
        const input = await readJsonObject(request);
        exactKeys(input, ["direction"]);
        return json(await session.navigate(enumValue(input.direction, "direction", ["previous", "next"])));
      }
      if (request.method === "POST" && url.pathname === "/api/agent/message") {
        const input = await readJsonObject(request, 32 * 1024);
        exactKeys(input, ["body", "selectedContext"]);
        return json(await session.ask(
          requiredString(input.body, "body", 8_000),
          optionalString(input.selectedContext, "selectedContext", 16_000),
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
        exactKeys(input, ["outcome", "headOid", "confirm"]);
        if (input.confirm !== true) throw new HttpError(422, "Publishing a GitHub review requires explicit confirmation.");
        const outcome = enumValue(input.outcome, "outcome", ["accepted", "feedback"]);
        return json(await session.publishPullRequest(outcome, requiredString(input.headOid, "headOid", 64)));
      }
      if (request.method === "POST" && url.pathname === "/api/close") {
        const input = await readJsonObject(request);
        exactKeys(input, ["outcome"]);
        return json(await session.close(parseOutcome(input.outcome)));
      }
      if (url.pathname.startsWith("/api/")) throw new HttpError(404, "API endpoint not found.");

      const relative = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\//, "");
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

  return Bun.serve({ hostname: "127.0.0.1", port, fetch });
}
