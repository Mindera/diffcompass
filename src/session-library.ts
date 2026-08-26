import { chmod, lstat, mkdir, readFile, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { loadRepositoryConfig, type RetentionConfig } from "./config.ts";
import { resolveRepositoryRoot } from "./git.ts";
import { loadPersistedSession, savePersistedSession } from "./store.ts";
import type { PersistedReviewSession } from "./types.ts";
import { removePullRequestWorkspace } from "./github.ts";

export interface SessionSummary {
  id: string;
  path: string;
  name: string;
  repositoryRoot: string;
  repositoryName: string;
  base: string;
  status: PersistedReviewSession["status"];
  archived: boolean;
  comments: number;
  activities: number;
  updatedAt: string;
}

export interface RetentionResult {
  sessions: SessionSummary[];
  temporaryDirectories: string[];
  protectedSessions: SessionSummary[];
  changedSessions: SessionSummary[];
}

interface LibraryMetadata {
  schemaVersion: 1;
  sessions: Record<string, { name?: string; archived?: boolean }>;
}

async function loadLibraryMetadata(directory: string): Promise<LibraryMetadata> {
  try {
    const value = JSON.parse(await readFile(join(directory, ".library.json"), "utf8")) as LibraryMetadata;
    if (value.schemaVersion !== 1 || !value.sessions || typeof value.sessions !== "object" || Array.isArray(value.sessions)) {
      throw new Error("invalid library metadata schema");
    }
    for (const [id, metadata] of Object.entries(value.sessions)) {
      if (!/^[A-Za-z0-9-]{1,128}$/.test(id) || !metadata || typeof metadata !== "object" || Array.isArray(metadata) ||
        (metadata.name !== undefined && (typeof metadata.name !== "string" || !metadata.name.trim() || metadata.name.length > 200)) ||
        (metadata.archived !== undefined && typeof metadata.archived !== "boolean")) {
        throw new Error("invalid library metadata entry");
      }
    }
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: 1, sessions: {} };
    throw new Error(`Could not read the review session library: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function saveLibraryMetadata(directory: string, metadata: LibraryMetadata): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, ".library.json");
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

export function reviewSessionDirectory(): string {
  return join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "code-review-tour", "sessions");
}

function lockPath(sessionPath: string): string {
  return `${sessionPath}.lock`;
}

async function activeSessionLock(sessionPath: string): Promise<boolean> {
  const path = lockPath(sessionPath);
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as { pid?: unknown };
    if (!Number.isInteger(value.pid) || Number(value.pid) <= 0) return false;
    try {
      process.kill(Number(value.pid), 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "EPERM";
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    return false;
  }
}

async function processIsAlive(pid: unknown): Promise<boolean> {
  if (!Number.isInteger(pid) || Number(pid) <= 0) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function activeTemporaryDirectory(path: string): Promise<boolean> {
  try {
    const value = JSON.parse(await readFile(join(path, ".active.json"), "utf8")) as { pid?: unknown };
    return processIsAlive(value.pid);
  } catch {
    return false;
  }
}

export async function acquireSessionLock(sessionPath: string): Promise<() => Promise<void>> {
  const path = lockPath(sessionPath);
  const token = crypto.randomUUID();
  await mkdir(join(path, ".."), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await writeFile(path, `${JSON.stringify({ pid: process.pid, token, startedAt: new Date().toISOString() })}\n`, { mode: 0o600, flag: "wx" });
      return async () => {
        try {
          const current = JSON.parse(await readFile(path, "utf8")) as { token?: string };
          if (current.token === token) await unlink(path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await activeSessionLock(sessionPath)) throw new Error("This review session is already open in another process.");
      await unlink(path).catch((unlinkError) => {
        if ((unlinkError as NodeJS.ErrnoException).code !== "ENOENT") throw unlinkError;
      });
    }
  }
  throw new Error("Could not acquire the review session lock.");
}

export async function pruneReviewSessions(
  policy: RetentionConfig & { temporaryMaxAgeHours?: number },
  options: { directory?: string; repositoryRoot?: string; apply?: boolean; now?: Date; temporaryRoot?: string } = {},
): Promise<RetentionResult> {
  if (policy.maxAgeDays === undefined && policy.maxSessions === undefined && policy.temporaryMaxAgeHours === undefined) {
    throw new Error("Retention requires maxAgeDays, maxSessions, or temporaryMaxAgeHours.");
  }
  const directory = options.directory ?? reviewSessionDirectory();
  const now = options.now ?? new Date();
  const { sessions } = await listReviewSessions(directory, true);
  const scope = sessions.filter((session) => (!options.repositoryRoot || session.repositoryRoot === options.repositoryRoot) &&
    (policy.includeArchived || !session.archived));
  const cutoff = policy.maxAgeDays === undefined ? undefined : now.getTime() - policy.maxAgeDays * 86_400_000;
  const targets = scope.filter((session, index) =>
    (cutoff !== undefined && new Date(session.updatedAt).getTime() < cutoff) ||
    (policy.maxSessions !== undefined && index >= policy.maxSessions));
  const result: RetentionResult = { sessions: [], temporaryDirectories: [], protectedSessions: [], changedSessions: [] };
  const metadata = await loadLibraryMetadata(directory);
  for (const target of targets) {
    if (!options.apply) {
      if (await activeSessionLock(target.path)) result.protectedSessions.push(target);
      else result.sessions.push(target);
      continue;
    }
    let release: (() => Promise<void>) | undefined;
    try {
      release = await acquireSessionLock(target.path);
      const file = await lstat(target.path);
      if (!file.isFile() || file.isSymbolicLink()) { result.changedSessions.push(target); continue; }
      const current = await loadPersistedSession(target.path);
      if (current.updatedAt !== target.updatedAt) { result.changedSessions.push(target); continue; }
      if (current.pullRequest) {
        const expectedWorkspace = resolve(dirname(directory), "worktrees", target.id, "workspace");
        if (resolve(current.pullRequest.workspaceRoot) !== expectedWorkspace) throw new Error("Persisted pull request workspace is outside the owned worktree directory.");
        await removePullRequestWorkspace(current.pullRequest);
      }
      await unlink(target.path);
      await rm(`${target.path}.assets`, { recursive: true, force: true });
      delete metadata.sessions[target.id];
      result.sessions.push(target);
    } catch (error) {
      if (error instanceof Error && error.message.includes("already open")) result.protectedSessions.push(target);
      else if ((error as NodeJS.ErrnoException).code !== "ENOENT") result.changedSessions.push(target);
    } finally {
      await release?.();
    }
  }
  if (options.apply && result.sessions.length > 0) await saveLibraryMetadata(directory, metadata);

  if (policy.temporaryMaxAgeHours !== undefined) {
    const temporaryRoot = options.temporaryRoot ?? tmpdir();
    const temporaryCutoff = now.getTime() - policy.temporaryMaxAgeHours * 3_600_000;
    const entries = await readdir(temporaryRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^code-review-tour-(?:proposal-|index-)?[A-Za-z0-9]+$/.test(entry.name)) continue;
      const path = join(temporaryRoot, entry.name);
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink() || metadata.mtimeMs >= temporaryCutoff || await activeTemporaryDirectory(path)) continue;
      result.temporaryDirectories.push(path);
      if (options.apply) await rm(path, { recursive: true, force: true });
    }
  }
  return result;
}

export async function listReviewSessions(
  directory = reviewSessionDirectory(),
  includeArchived = false,
): Promise<{ sessions: SessionSummary[]; invalid: string[] }> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { sessions: [], invalid: [] };
    throw error;
  }
  const metadata = await loadLibraryMetadata(directory);
  const sessions: SessionSummary[] = [];
  const invalid: string[] = [];
  for (const entry of entries.filter((candidate) => candidate.endsWith(".json") && candidate !== ".library.json").sort()) {
    const path = join(directory, entry);
    try {
      const session = await loadPersistedSession(path);
      const id = entry.slice(0, -5);
      const libraryEntry = metadata.sessions[id];
      const archived = libraryEntry?.archived ?? session.archived ?? false;
      if (archived && !includeArchived) continue;
      sessions.push({
        id,
        path,
        name: libraryEntry?.name ?? session.name ?? basename(session.repositoryRoot),
        repositoryRoot: session.repositoryRoot,
        repositoryName: basename(session.repositoryRoot),
        base: session.base,
        status: session.status,
        archived,
        comments: session.comments.length,
        activities: session.activities?.length ?? 0,
        updatedAt: session.updatedAt,
      });
    } catch {
      invalid.push(entry);
    }
  }
  sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return { sessions, invalid };
}

export async function resolveReviewSession(
  id: string,
  directory = reviewSessionDirectory(),
): Promise<SessionSummary> {
  if (!/^[A-Za-z0-9-]{1,128}$/.test(id)) throw new Error("Session ID must contain only letters, numbers, and hyphens.");
  const { sessions } = await listReviewSessions(directory, true);
  const matches = sessions.filter((session) => session.id === id || session.id.startsWith(id));
  if (matches.length === 0) throw new Error(`No review session matches: ${id}`);
  if (matches.length > 1) throw new Error(`Review session ID is ambiguous: ${id}`);
  return matches[0]!;
}

export async function updateReviewSessionMetadata(
  id: string,
  input: { name?: string; archived?: boolean },
  directory = reviewSessionDirectory(),
): Promise<SessionSummary> {
  const summary = await resolveReviewSession(id, directory);
  const metadata = await loadLibraryMetadata(directory);
  const entry = { ...metadata.sessions[summary.id] };
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name || name.length > 200) throw new Error("Session name must contain between 1 and 200 characters.");
    entry.name = name;
  }
  if (input.archived !== undefined) entry.archived = input.archived;
  metadata.sessions[summary.id] = entry;
  await saveLibraryMetadata(directory, metadata);
  return (await listReviewSessions(directory, true)).sessions.find((candidate) => candidate.id === summary.id)!;
}

export async function deleteReviewSession(
  id: string,
  directory = reviewSessionDirectory(),
): Promise<SessionSummary> {
  const summary = await resolveReviewSession(id, directory);
  await unlink(summary.path);
  await rm(`${summary.path}.assets`, { recursive: true, force: true });
  const metadata = await loadLibraryMetadata(directory);
  delete metadata.sessions[summary.id];
  await saveLibraryMetadata(directory, metadata);
  return summary;
}

function formatSessionList(sessions: SessionSummary[], invalid: string[]): string {
  if (sessions.length === 0) return invalid.length > 0
    ? `No valid review sessions found. ${invalid.length} unreadable session file(s) were ignored.`
    : "No review sessions found.";
  const rows = sessions.map((session) => ({
    id: session.id.slice(0, 8),
    name: session.name,
    status: session.archived ? "archived" : session.status,
    updated: session.updatedAt.replace("T", " ").slice(0, 16),
    review: `${session.comments} feedback · ${session.activities} changes`,
  }));
  const widths = {
    id: Math.max(2, ...rows.map((row) => row.id.length)),
    name: Math.max(4, ...rows.map((row) => row.name.length)),
    status: Math.max(6, ...rows.map((row) => row.status.length)),
    updated: 16,
  };
  const line = (row: { id: string; name: string; status: string; updated: string; review: string }) =>
    `${row.id.padEnd(widths.id)}  ${row.name.padEnd(widths.name)}  ${row.status.padEnd(widths.status)}  ${row.updated.padEnd(widths.updated)}  ${row.review}`;
  return [
    line({ id: "ID", name: "NAME", status: "STATUS", updated: "UPDATED", review: "REVIEW" }),
    ...rows.map(line),
    ...(invalid.length > 0 ? [`\nIgnored ${invalid.length} unreadable session file(s).`] : []),
  ].join("\n");
}

export type SessionCommandResult = { resumePath?: string; open?: boolean; output?: string };

export async function runSessionCommand(args: string[], directory = reviewSessionDirectory()): Promise<SessionCommandResult> {
  const command = args[0] ?? "list";
  if (command === "list") {
    const unknown = args.filter((arg) => arg !== "list" && arg !== "--all");
    if (unknown.length > 0) throw new Error(`Unknown sessions option: ${unknown[0]}`);
    const result = await listReviewSessions(directory, args.includes("--all"));
    return { output: formatSessionList(result.sessions, result.invalid) };
  }
  if (command === "resume") {
    const id = args[1];
    if (!id) throw new Error("sessions resume requires a session ID.");
    const unknown = args.slice(2).filter((arg) => arg !== "--open");
    if (unknown.length > 0) throw new Error(`Unknown sessions resume option: ${unknown[0]}`);
    return { resumePath: (await resolveReviewSession(id, directory)).path, open: args.includes("--open") };
  }
  if (command === "rename") {
    const id = args[1];
    const name = args.slice(2).join(" ");
    if (!id || !name) throw new Error("sessions rename requires a session ID and name.");
    const session = await updateReviewSessionMetadata(id, { name }, directory);
    return { output: `Renamed ${session.id.slice(0, 8)} to ${JSON.stringify(session.name)}.` };
  }
  if (command === "archive" || command === "unarchive") {
    const id = args[1];
    if (!id || args.length !== 2) throw new Error(`sessions ${command} requires exactly one session ID.`);
    const session = await updateReviewSessionMetadata(id, { archived: command === "archive" }, directory);
    return { output: `${command === "archive" ? "Archived" : "Restored"} ${session.id.slice(0, 8)} (${session.name}).` };
  }
  if (command === "delete") {
    const id = args[1];
    if (!id) throw new Error("sessions delete requires a session ID.");
    if (!args.includes("--yes")) throw new Error("sessions delete is destructive; repeat with --yes.");
    const unknown = args.slice(2).filter((arg) => arg !== "--yes");
    if (unknown.length > 0) throw new Error(`Unknown sessions delete option: ${unknown[0]}`);
    const session = await deleteReviewSession(id, directory);
    return { output: `Deleted ${session.id.slice(0, 8)} (${session.name}).` };
  }
  if (command === "prune") {
    const allowed = new Set(["--repo", "--days", "--max", "--temp-hours", "--include-archived", "--yes"]);
    for (let index = 1; index < args.length; index += 1) {
      const arg = args[index]!;
      if (!allowed.has(arg)) throw new Error(`Unknown sessions prune option: ${arg}`);
      if (["--repo", "--days", "--max", "--temp-hours"].includes(arg)) {
        if (!args[index + 1] || args[index + 1]!.startsWith("--")) throw new Error(`${arg} requires a value.`);
        index += 1;
      }
    }
    const value = (name: string) => {
      const index = args.indexOf(name);
      return index < 0 ? undefined : args[index + 1];
    };
    const positive = (name: string) => {
      const raw = value(name);
      if (raw === undefined) return undefined;
      const number = Number(raw);
      if (!Number.isInteger(number) || number <= 0) throw new Error(`${name} must be a positive integer.`);
      return number;
    };
    const repository = value("--repo");
    const repositoryRoot = repository ? await resolveRepositoryRoot(repository) : undefined;
    const configured = repositoryRoot ? (await loadRepositoryConfig(repositoryRoot)).retention : { includeArchived: false };
    const policy = {
      maxAgeDays: positive("--days") ?? configured.maxAgeDays,
      maxSessions: positive("--max") ?? configured.maxSessions,
      temporaryMaxAgeHours: positive("--temp-hours"),
      includeArchived: args.includes("--include-archived") || configured.includeArchived,
    };
    const result = await pruneReviewSessions(policy, { directory, repositoryRoot, apply: args.includes("--yes") });
    const action = args.includes("--yes") ? "Deleted" : "Would delete";
    const lines = [
      `${action} ${result.sessions.length} session(s) and ${result.temporaryDirectories.length} temporary director${result.temporaryDirectories.length === 1 ? "y" : "ies"}.`,
      ...(result.protectedSessions.length ? [`Protected ${result.protectedSessions.length} active session(s).`] : []),
      ...(result.changedSessions.length ? [`Skipped ${result.changedSessions.length} session(s) that changed during pruning.`] : []),
      ...(!args.includes("--yes") && (result.sessions.length || result.temporaryDirectories.length) ? ["Repeat with --yes to apply."] : []),
    ];
    return { output: lines.join("\n") };
  }
  if (command === "help" || command === "--help" || command === "-h") {
    return { output: `Usage:
  code-review-tour sessions [list] [--all]
  code-review-tour sessions resume ID [--open]
  code-review-tour sessions rename ID NAME
  code-review-tour sessions archive|unarchive ID
  code-review-tour sessions delete ID --yes
  code-review-tour sessions prune [--repo PATH] [--days N] [--max N] [--temp-hours N] [--include-archived] [--yes]` };
  }
  throw new Error(`Unknown sessions command: ${command}`);
}
