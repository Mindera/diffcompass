import packageJson from "../package.json" with { type: "json" };
import { ReviewError } from "./errors.ts";
import { runLifecycleCommand } from "./install-lifecycle.ts";

const RELEASE_REPOSITORY = "Mindera/diffcompass";
const RELEASES_LATEST_URL = `https://github.com/${RELEASE_REPOSITORY}/releases/latest`;
const CHECK_TTL_MS = 6 * 60 * 60 * 1_000;

export interface UpdateStatus {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  updated?: boolean;
}

export interface UpdateService {
  status(force?: boolean): Promise<UpdateStatus>;
  install(): Promise<UpdateStatus>;
}

export type ReleaseFetch = (url: string, init: RequestInit) => Promise<Pick<Response, "ok" | "url">>;

export async function latestReleaseTag(fetcher: ReleaseFetch = fetch): Promise<string> {
  const response = await fetcher(RELEASES_LATEST_URL, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(10_000) });
  const tag = response.ok && response.url
    ? /\/releases\/tag\/(v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/.exec(new URL(response.url).pathname)?.[1]
    : undefined;
  if (!tag) throw new Error(`Unexpected latest-release location: ${response.url}`);
  return tag;
}

type Version = [number, number, number];

function parseVersion(value: string): Version {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value.trim());
  if (!match) throw new Error(`Unsupported release version: ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const left = parseVersion(candidate);
  const right = parseVersion(current);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index]! > right[index]!;
  }
  return false;
}

export function createUpdateService(options: {
  currentVersion?: string;
  now?: () => number;
  latestVersion?: () => Promise<string>;
  fetch?: ReleaseFetch;
  update?: () => Promise<void>;
} = {}): UpdateService {
  const currentVersion = options.currentVersion ?? packageJson.version;
  const now = options.now ?? Date.now;
  const latestVersion = options.latestVersion ?? (() => latestReleaseTag(options.fetch ?? fetch));
  const update = options.update ?? (async () => {
    await runLifecycleCommand("update", []);
  });
  let cached: { value: UpdateStatus; checkedAt: number } | undefined;
  let checking: Promise<UpdateStatus> | undefined;
  let installing: Promise<UpdateStatus> | undefined;

  const status = async (force = false): Promise<UpdateStatus> => {
    if (!force && cached && now() - cached.checkedAt < CHECK_TTL_MS) return cached.value;
    if (checking) return checking;
    checking = (async () => {
      try {
        const latest = (await latestVersion()).replace(/^v/, "");
        const value = { currentVersion, latestVersion: latest, updateAvailable: isNewerVersion(latest, currentVersion) };
        cached = { value, checkedAt: now() };
        return value;
      } catch {
        throw new ReviewError("Could not check for DiffCompass updates.");
      }
    })().finally(() => { checking = undefined; });
    return checking;
  };

  return {
    status,
    async install() {
      if (installing) return installing;
      installing = (async () => {
        const available = await status(true);
        if (!available.updateAvailable) return available;
        try {
          await update();
        } catch (error) {
          throw new ReviewError(`Could not install ${available.latestVersion}: ${error instanceof Error ? error.message : String(error)}`);
        }
        const value = { ...available, updateAvailable: false, updated: true };
        cached = { value, checkedAt: now() };
        return value;
      })().finally(() => { installing = undefined; });
      return installing;
    },
  };
}
