import { expect, test } from "bun:test";
import { githubClient, listMembers, syncMinders, type Api } from "../scripts/sync-minders.ts";

const root = "orgs/Mindera/teams/minders";
const response = (status: number, data: any = null) => ({ status, data, headers: {} });
const quiet = { wait: async (_ms: number) => {}, log: (_message: string) => {} };

function fixture(org: string[], initial: Record<string, string> = {}) {
  const members = new Set(org);
  const team = new Map(Object.entries(initial));
  const writes: Array<{ login: string; role?: string }> = [];
  const api: Api = async (method, path, body) => {
    const url = new URL(path, "https://api.github.com/");
    const route = url.pathname.slice(1);
    if (method === "GET" && route === root) return response(200, { slug: "minders" });
    if (method === "GET" && ["orgs/Mindera/members", `${root}/members`].includes(route)) {
      const users = route === "orgs/Mindera/members" ? [...members] : [...team.keys()];
      const page = Number(url.searchParams.get("page"));
      expect(url.searchParams.get("per_page")).toBe("100");
      expect(url.searchParams.get("role")).toBe("all");
      return response(200, users.slice((page - 1) * 100, page * 100).map(login => ({ login })));
    }
    const login = route.split("/").at(-1)!;
    if (method === "GET" && route.startsWith("orgs/Mindera/members/")) return response(members.has(login) ? 204 : 404);
    if (route.startsWith(`${root}/memberships/`)) {
      if (method === "GET") return team.has(login) ? response(200, { state: "active", role: team.get(login) }) : response(404);
      writes.push({ login, role: body?.role });
      team.set(login, body!.role!);
      return response(200, { state: "active", role: body!.role });
    }
    throw Error(`Unexpected ${method} ${path}`);
  };
  return { api, members, team, writes };
}

test("sync covers all pages, preserves maintainers and leaves existing non-org team members alone", async () => {
  const org = Array.from({ length: 309 }, (_, i) => `member-${i}`);
  const existing = Object.fromEntries(org.slice(0, 201).map(login => [login, "maintainer"]));
  const f = fixture(org, { ...existing, outside: "member" });
  const result = await syncMinders(f.api, quiet);
  expect(result).toMatchObject({ organizationMembers: 309, added: 108, remaining: 0, errors: [] });
  expect(f.writes).toEqual(org.slice(201).sort().map(login => ({ login, role: "member" })));
  expect(f.team.get("member-0")).toBe("maintainer");
  expect(f.team.get("outside")).toBe("member");
  f.writes.length = 0;
  expect(await syncMinders(f.api, quiet)).toMatchObject({ added: 0, missing: 0, remaining: 0 });
  expect(f.writes).toEqual([]);
});

test("dry run calculates missing members without mutations", async () => {
  const f = fixture(["one", "two"], { one: "maintainer" });
  expect(await syncMinders(f.api, { ...quiet, dryRun: true })).toMatchObject({ missing: 1, added: 0, remaining: 1 });
  expect(f.writes).toEqual([]);
});

test("a member leaving after the initial snapshot is never added", async () => {
  const f = fixture(["departing"]);
  const api: Api = async (method, path, body) => {
    if (path === "orgs/Mindera/members/departing") f.members.delete("departing");
    return f.api(method, path, body);
  };
  expect(await syncMinders(api, quiet)).toMatchObject({ departed: 1, added: 0, remaining: 0, errors: [] });
  expect(f.writes).toEqual([]);
});

test("a concurrent maintainer addition is preserved", async () => {
  const f = fixture(["promoted"]);
  const api: Api = async (method, path, body) => {
    if (method === "GET" && path === `${root}/memberships/promoted`) f.team.set("promoted", "maintainer");
    return f.api(method, path, body);
  };
  expect(await syncMinders(api, quiet)).toMatchObject({ alreadyAdded: 1, added: 0, remaining: 0 });
  expect(f.team.get("promoted")).toBe("maintainer");
  expect(f.writes).toEqual([]);
});

test("permission errors stop the batch and reruns retain completed additions", async () => {
  const f = fixture(["one", "two"]);
  const api: Api = async (method, path, body) => method === "PUT" && path.endsWith("/two")
    ? response(403, { message: "Forbidden" }) : f.api(method, path, body);
  await expect(syncMinders(api, quiet)).rejects.toThrow("GitHub returned 403");
  expect(f.writes).toEqual([{ login: "one", role: "member" }]);
  expect(await syncMinders(f.api, quiet)).toMatchObject({ added: 1, remaining: 0 });
  expect(f.writes).toEqual([{ login: "one", role: "member" }, { login: "two", role: "member" }]);
});

test("pending membership is not overwritten or reported as active", async () => {
  const f = fixture(["pending"]);
  const api: Api = async (method, path, body) => path === `${root}/memberships/pending`
    ? response(200, { state: "pending", role: "maintainer" }) : f.api(method, path, body);
  const result = await syncMinders(api, quiet);
  expect(result.remaining).toBe(1);
  expect(result.errors.length).toBeGreaterThan(0);
  expect(f.writes).toEqual([]);
});

test("a pending PUT response does not count as a successful addition", async () => {
  const f = fixture(["pending"]);
  const api: Api = async (method, path, body) => method === "PUT"
    ? response(200, { state: "pending", role: "member" }) : f.api(method, path, body);
  expect(await syncMinders(api, quiet)).toMatchObject({ added: 0, remaining: 1 });
});

test("a newly joined organization member is detected by final verification", async () => {
  const f = fixture(["one"]);
  const api: Api = async (method, path, body) => {
    const result = await f.api(method, path, body);
    if (method === "PUT") f.members.add("newcomer");
    return result;
  };
  const result = await syncMinders(api, quiet);
  expect(result).toMatchObject({ added: 1, organizationMembers: 2, remaining: 1 });
  expect(result.errors).toHaveLength(1);
});

test("unreadable member lists fail instead of looking like an empty organization", async () => {
  await expect(listMembers(async () => response(403), "orgs/Mindera/members")).rejects.toThrow("403");
  await expect(listMembers(async () => response(200, {}), "orgs/Mindera/members")).rejects.toThrow("Invalid member list");
});

const http = (status: number, body = "", headers = "") => `HTTP/2.0 ${status} status\nContent-Type: application/json\r\n${headers}\r\n${body}`;
test("GitHub transport handles empty 204 membership checks and sends role as a JSON field", async () => {
  const calls: string[][] = [];
  const api = githubClient(async args => { calls.push(args); return http(204); }, quiet.wait);
  expect((await api("GET", "orgs/Mindera/members/one")).status).toBe(204);
  await api("PUT", `${root}/memberships/one`, { role: "member" });
  expect(calls[1]).toContain("role=member");
  expect(calls[1]).not.toContain("Authorization");
});

test("GitHub transport retries network errors and non-JSON server errors", async () => {
  const responses = ["", http(502, "<html>Bad Gateway</html>"), http(200, '{"state":"active"}')];
  const waits: number[] = [];
  const api = githubClient(async () => responses.shift()!, async ms => { waits.push(ms); });
  expect((await api("GET", "membership")).data.state).toBe("active");
  expect(waits).toEqual([2000, 4000]);
});

test("GitHub transport respects rate limits and does not retry authorization failures", async () => {
  const responses = [http(429, '{}', 'Retry-After: 65\r\n'), http(200, '{}'), http(403, '{"message":"Forbidden"}')];
  const waits: number[] = [];
  const api = githubClient(async () => responses.shift()!, async ms => { waits.push(ms); });
  expect((await api("GET", "members")).status).toBe(200);
  expect((await api("GET", "members")).status).toBe(403);
  expect(waits).toEqual([65000]);
});

test("GitHub transport bounds repeated failures", async () => {
  let attempts = 0;
  const api = githubClient(async () => { attempts++; return http(503, '{}'); }, quiet.wait);
  expect((await api("GET", "members")).status).toBe(503);
  expect(attempts).toBe(4);
});

test("retrying an uncertain write preserves a membership created or promoted meanwhile", async () => {
  const methods: string[] = [];
  const responses = ["", http(200, '{"state":"active","role":"maintainer"}')];
  const api = githubClient(async args => { methods.push(args[args.indexOf("--method") + 1]!); return responses.shift()!; }, quiet.wait);
  expect((await api("PUT", `${root}/memberships/one`, { role: "member" })).data.role).toBe("maintainer");
  expect(methods).toEqual(["PUT", "GET"]);
});
