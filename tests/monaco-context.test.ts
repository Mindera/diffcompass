import { expect, test } from "bun:test";
// @ts-expect-error Shared browser helper.
import { expandedRegionState } from "../public/monaco/annotations.mjs";
import { syntheticPrFixtureHandler } from "../scripts/monaco-fixture-support.ts";

test("Expand all reveals the whole selected gap without changing other regions", () => {
  const state = { original: { scrollTop: 20 }, modelState: { collapsedRegions: [{ range: [1, 40] }, { range: [47, 175] }, { range: [181, 216] }] } };
  const next = expandedRegionState(state, 1);
  expect(next.modelState.collapsedRegions.map((r: any) => r.range)).toEqual([[1, 40], [175, 175], [181, 216]]);
  expect(next.original).toBe(state.original);
  expect(state.modelState.collapsedRegions[1]!.range).toEqual([47, 175]);
  const short = { modelState: { collapsedRegions: [{ range: [5, 8] }] } };
  expect(expandedRegionState(short, 0).modelState.collapsedRegions[0].range).toEqual([8, 8]);
  for (const args of [[{}, 0], [state, -1], [state, 99], [state, 0.5]]) expect(expandedRegionState(...args)).toBeNull();
});

test("editable sample PR capability is server-owned, checked on each Apply/Undo, and never permits GitHub writes", async () => {
  let safe = true, checks = 0;
  const calls: string[] = [];
  const handler = syntheticPrFixtureHandler(async request => {
    calls.push(new URL(request.url).pathname);
    return Response.json({ comparison: {}, reviewedFiles: [] });
  }, "fixture-token", async () => { checks++; if (!safe) throw Error("Not disposable"); });
  const request = (path: string, action?: string) => new Request(`http://127.0.0.1:47684${path}`, {
    method: action ? "POST" : "GET",
    headers: { host: "127.0.0.1:47684", origin: "http://127.0.0.1:47684", "x-diffcompass-token": "fixture-token" },
    ...(action ? { body: JSON.stringify({ action }) } : {}),
  });
  expect((await (await handler(request("/api/session"))).json()).fixtureCanApplySuggestions).toBe(true);
  for (const action of ["apply", "undo", "reject"]) expect((await handler(request("/api/activities/proposal", action))).status).toBe(200);
  expect(checks).toBe(2);
  safe = false;
  for (const action of ["apply", "undo", "unknown"]) expect((await handler(request("/api/activities/proposal", action))).status).toBe(403);
  for (const path of ["/api/github/review", "/api/github/refresh", "/api/refresh"]) expect((await handler(request(path, "apply"))).status).toBe(403);
  expect(calls).toEqual(["/api/session", "/api/activities/proposal", "/api/activities/proposal", "/api/activities/proposal"]);
});

test("sample PR capability is fixture-only, authenticated, and cannot enable GitHub operations", async () => {
  const calls: string[] = [];
  const handler = syntheticPrFixtureHandler(async request => {
    calls.push(new URL(request.url).pathname);
    return Response.json({ comparisonId: "captured", files: [] });
  }, "fixture-token");
  const request = (path: string, method = "GET", token = "fixture-token") => new Request(`http://127.0.0.1:47684${path}`, { method, headers: { host: "127.0.0.1:47684", origin: "http://127.0.0.1:47684", "x-diffcompass-token": token } });
  expect((await handler(request("/api/diff/sources", "GET", "wrong"))).status).toBe(401);
  expect(calls).toEqual([]);
  expect(await (await handler(request("/api/diff/sources"))).json()).toEqual({ comparisonId: "captured", files: [], pullRequestFixture: true });
  for (const path of ["/api/github/review", "/api/github/refresh", "/api/refresh", "/api/diagrams/retry", "/api/update"]) expect((await handler(request(path, "POST"))).status).toBe(403);
  expect(calls).toEqual(["/api/diff/sources"]);
  expect((await handler(request("/api/tour/navigate", "POST"))).status).toBe(200);
  expect(await (await handler(request("/api/update"))).json()).toEqual({ updateAvailable: false });
  expect((await handler(request("/api/edits", "POST"))).status).toBe(200);
  expect((await handler(request("/api/activities/proposal/diff"))).status).toBe(200);
  for (const action of ["apply", "undo", "reject"]) {
    const input = request("/api/activities/proposal", "POST");
    expect((await handler(new Request(input, { body: JSON.stringify({ action }) }))).status).toBe(action === "reject" ? 200 : 403);
  }
});
