import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { acquireSessionLock } from "./session-library.ts";
import { isBriefingSectionOrder, type BriefingPreferences, type DiffViewPreferences, type SessionDiffPreferences } from "./types.ts";

interface DiffPreferenceStore {
  schemaVersion: 1;
  repositories: Record<string, SessionDiffPreferences>;
  briefing?: BriefingPreferences;
}

const STORE_NAME = ".diff-preferences.json";
let updateQueue: Promise<void> = Promise.resolve();

function validPreferences(value: unknown): value is DiffViewPreferences {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === 2 &&
    ["unified", "split"].includes(String((value as Record<string, unknown>).layout)) &&
    ["scroll", "wrap"].includes(String((value as Record<string, unknown>).wrap));
}

function validSessionPreferences(value: unknown): value is SessionDiffPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).every((scope) => ["desktop", "mobile"].includes(scope) && validPreferences(record[scope]));
}

function validBriefingPreferences(value: unknown): value is BriefingPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = ["showBriefing", "briefingArchitecture", "briefingSequenceDiagrams", "briefingCallFlows", "briefingNeedsAttention", "briefingReviewEffort", "briefingOrder"];
  const legacyKeys = keys.slice(0, 4);
  const currentKeys = keys.slice(0, 6);
  return (Object.keys(record).length === keys.length || Object.keys(record).length === currentKeys.length || Object.keys(record).length === legacyKeys.length) &&
    Object.keys(record).every((key) => key === "briefingOrder" ? isBriefingSectionOrder(record[key]) : keys.includes(key) && typeof record[key] === "boolean");
}

function storePath(directory: string): string {
  return join(directory, STORE_NAME);
}

function repositoryKey(repositoryRoot: string): string {
  return resolve(repositoryRoot);
}

async function loadStore(directory: string): Promise<DiffPreferenceStore> {
  try {
    const value = JSON.parse(await readFile(storePath(directory), "utf8")) as Record<string, unknown>;
    if (value.schemaVersion !== 1 || !value.repositories || typeof value.repositories !== "object" || Array.isArray(value.repositories)) {
      return { schemaVersion: 1, repositories: {} };
    }
    const repositories: Record<string, SessionDiffPreferences> = {};
    for (const [root, preferences] of Object.entries(value.repositories)) {
      if (root.length <= 4_096 && validSessionPreferences(preferences)) repositories[root] = structuredClone(preferences);
    }
    return {
      schemaVersion: 1,
      repositories,
      briefing: validBriefingPreferences(value.briefing) ? structuredClone(value.briefing) : undefined,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: 1, repositories: {} };
    return { schemaVersion: 1, repositories: {} };
  }
}

async function saveStore(directory: string, store: DiffPreferenceStore): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = storePath(directory);
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

async function updateStore<T>(directory: string, update: (store: DiffPreferenceStore) => T | Promise<T>): Promise<T> {
  const operation = updateQueue.then(async () => {
    const path = storePath(directory);
    const release = await acquireSessionLock(path);
    try {
      const store = await loadStore(directory);
      const result = await update(store);
      await saveStore(directory, store);
      return result;
    } finally {
      await release();
    }
  });
  updateQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export function diffPreferenceStoreDirectory(stateFile?: string): string | undefined {
  return stateFile ? dirname(stateFile) : undefined;
}

export async function loadGlobalDiffPreferences(directory: string | undefined, repositoryRoot: string): Promise<SessionDiffPreferences | undefined> {
  if (!directory) return undefined;
  const store = await loadStore(directory);
  const preferences = store.repositories[repositoryKey(repositoryRoot)];
  return preferences ? structuredClone(preferences) : undefined;
}

export async function loadGlobalBriefingPreferences(directory: string | undefined): Promise<BriefingPreferences | undefined> {
  if (!directory) return undefined;
  const store = await loadStore(directory);
  return store.briefing ? structuredClone(store.briefing) : undefined;
}

export async function updateGlobalBriefingPreferences(directory: string | undefined, preferences: BriefingPreferences): Promise<BriefingPreferences | undefined> {
  if (!directory) return undefined;
  return updateStore(directory, (store) => {
    const previous = structuredClone(store.briefing);
    store.briefing = structuredClone(preferences);
    return previous;
  });
}

export async function restoreGlobalBriefingPreferences(directory: string | undefined, previous: BriefingPreferences | undefined): Promise<void> {
  if (!directory) return;
  await updateStore(directory, (store) => {
    if (previous) store.briefing = structuredClone(previous);
    else delete store.briefing;
  });
}

export async function updateGlobalDiffPreferences(
  directory: string | undefined,
  repositoryRoot: string,
  scope: "desktop" | "mobile",
  preferences: DiffViewPreferences,
): Promise<SessionDiffPreferences | undefined> {
  if (!directory) return undefined;
  return updateStore(directory, (store) => {
    const key = repositoryKey(repositoryRoot);
    const previous = structuredClone(store.repositories[key]);
    store.repositories[key] = { ...store.repositories[key], [scope]: structuredClone(preferences) };
    return previous;
  });
}

export async function restoreGlobalDiffPreferences(
  directory: string | undefined,
  repositoryRoot: string,
  previous: SessionDiffPreferences | undefined,
): Promise<void> {
  if (!directory) return;
  await updateStore(directory, (store) => {
    const key = repositoryKey(repositoryRoot);
    if (previous) store.repositories[key] = structuredClone(previous);
    else delete store.repositories[key];
  });
}
