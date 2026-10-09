import { execFile } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { promisify } from "node:util";

const exec = promisify(execFile);
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
type Response = { status: number; data: any; headers: Record<string, string> };
export type Api = (method: "GET" | "PUT", path: string, body?: Record<string, string>) => Promise<Response>;
const org = "Mindera";
const team = "minders";
const teamPath = `orgs/${org}/teams/${team}`;

// gh obtains the token from its local keychain or the workflow's GH_TOKEN.
// Neither the token nor request headers are written to logs or files.
export function githubClient(run: (args: string[]) => Promise<string>, wait = pause): Api {
  const request: Api = async (method, path, body) => {
    for (let attempt = 0; ; attempt++) {
      if (attempt > 0 && method === "PUT") {
        // A lost response may hide a successful write. Recheck before retrying
        // so a concurrent maintainer promotion can never be overwritten here.
        const current = await request("GET", path);
        if (current.status !== 404) return current;
      }
      const args = ["api", "--hostname", "github.com", "--include", "--method", method, path,
        "-H", "Accept: application/vnd.github+json", "-H", "X-GitHub-Api-Version: 2022-11-28"];
      for (const [key, value] of Object.entries(body ?? {})) args.push("-f", `${key}=${value}`);
      const output = await run(args);
      const match = /^HTTP\/\S+ (\d{3})[^\n]*\r?\n([\s\S]*?)\r?\n\r?\n([\s\S]*)$/.exec(output);
      if (!match) {
        if (attempt < 3) { await wait(2 ** (attempt + 1) * 1000); continue; }
        throw new Error("GitHub CLI returned no API response. Check authentication and network access.");
      }
      const status = Number(match[1]);
      const headers = Object.fromEntries(match[2]!.split(/\r?\n/).map(line => {
        const separator = line.indexOf(":");
        return [line.slice(0, separator).toLowerCase(), line.slice(separator + 1).trim()];
      }));
      let data;
      try { data = match[3]!.trim() ? JSON.parse(match[3]!) : null; }
      catch { data = { message: "GitHub returned a non-JSON response." }; }
      const limited = status === 429 || (status === 403 && (headers["retry-after"] || headers["x-ratelimit-remaining"] === "0" || /secondary rate limit/i.test(data?.message ?? "")));
      if (attempt < 3 && (limited || status >= 500)) {
        const seconds = Math.max(2 ** (attempt + 1), Number(headers["retry-after"]) || (limited ? 60 : 0));
        // Leave prolonged outages/limits visible for an operator instead of
        // keeping a runner occupied indefinitely. Reruns only add missing users.
        if (seconds <= 300) { await wait(seconds * 1000); continue; }
      }
      return { status, data, headers };
    }
  };
  return request;
}

export const github = githubClient(async args => {
  const result = await exec("gh", args, { encoding: "utf8", maxBuffer: 2 * 1024 * 1024, timeout: 60_000 })
    .catch((error: { stdout?: string }) => ({ stdout: error.stdout ?? "" }));
  return result.stdout;
});

function requireStatus(response: Response, expected: number, context: string) {
  if (response.status !== expected) throw new Error(`${context}: GitHub returned ${response.status}. ${response.data?.message ?? ""}`.trim());
}

export async function listMembers(api: Api, path: string): Promise<Map<string, string>> {
  const members = new Map<string, string>();
  for (let page = 1; ; page++) {
    const response = await api("GET", `${path}?per_page=100&role=all&page=${page}`);
    requireStatus(response, 200, `Listing ${path}`);
    if (!Array.isArray(response.data) || response.data.some(user => typeof user.login !== "string" || !/^[a-z0-9-]+$/i.test(user.login))) {
      throw new Error(`Invalid member list from ${path}`);
    }
    for (const user of response.data) members.set(user.login.toLowerCase(), user.login);
    if (response.data.length < 100) return members;
  }
}

export async function syncMinders(api: Api, { dryRun = false, wait = pause, log = console.log } = {}) {
  requireStatus(await api("GET", teamPath), 200, "Reading the Minders team");
  const members = await listMembers(api, `orgs/${org}/members`);
  const existing = await listMembers(api, `${teamPath}/members`);
  const missing = [...members].filter(([key]) => !existing.has(key)).map(([, login]) => login).sort();
  const result = { organizationMembers: members.size, existingMembers: existing.size, missing: missing.length, added: 0, alreadyAdded: 0, departed: 0, remaining: missing.length, errors: [] as string[] };
  log(`${org}: ${members.size} organization members; ${existing.size} in ${team}; ${missing.length} missing.${dryRun ? " Dry run: no changes." : ""}`);
  if (dryRun) return result;
  for (const login of missing) {
    // Recheck immediately before adding: never invite someone who has left
    // the organization since the initial paginated snapshot.
    const organizationMembership = await api("GET", `orgs/${org}/members/${login}`);
    if (organizationMembership.status === 404) { result.departed++; continue; }
    requireStatus(organizationMembership, 204, `Checking organization membership for ${login}`);
    const membership = await api("GET", `${teamPath}/memberships/${login}`);
    if (membership.status === 200) {
      // A concurrent addition may have made this person a maintainer.
      // Never PUT over existing roles, including pending memberships.
      if (membership.data?.state === "active") result.alreadyAdded++;
      else result.errors.push(`${login}: existing membership is not active`);
      continue;
    }
    requireStatus(membership, 404, `Checking team membership for ${login}`);
    const added = await api("PUT", `${teamPath}/memberships/${login}`, { role: "member" });
    requireStatus(added, 200, `Adding ${login}`);
    if (added.data?.state === "active") result.added++;
    else result.errors.push(`${login}: GitHub did not activate the membership`);
    if (result.added % 25 === 0) log(`Added ${result.added} of ${missing.length} missing members.`);
    await wait(1000); // Serialize writes and stay below secondary write limits.
  }
  const currentOrg = await listMembers(api, `orgs/${org}/members`);
  const currentTeam = await listMembers(api, `${teamPath}/members`);
  result.organizationMembers = currentOrg.size;
  result.remaining = [...currentOrg.keys()].filter(login => !currentTeam.has(login)).length;
  if (result.remaining) result.errors.push(`${result.remaining} organization member(s) are still missing; rerun the sync.`);
  return result;
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== "--dry-run")) throw new Error("Usage: bun scripts/sync-minders.ts [--dry-run]");
    const result = await syncMinders(github, { dryRun: args.includes("--dry-run") });
    const summary = `Minders sync${args.length ? " (dry run)" : ""}: ${result.organizationMembers} organization members; ${result.added} added; ${result.alreadyAdded} concurrently added; ${result.departed} departed; ${result.remaining} missing.\n`;
    console.log(summary.trim());
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
    for (const error of result.errors) console.error(error);
    if (result.errors.length) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
