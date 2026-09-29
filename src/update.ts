import packageJson from "../package.json" with { type: "json" };
import { ReviewError } from "./errors.ts";
import { runLifecycleCommand } from "./install-lifecycle.ts";
import { runProcess } from "./process.ts";

const RELEASE_REPOSITORY = "rcosteira79/diffcompass";
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
  update?: () => Promise<void>;
} = {}): UpdateService {
  const currentVersion = options.currentVersion ?? packageJson.version;
  const now = options.now ?? Date.now;
  const latestVersion = options.latestVersion ?? (async () => (await runProcess(
    ["gh", "api", `repos/${RELEASE_REPOSITORY}/releases/latest`, "--jq", ".tag_name"],
    process.cwd(),
    [0],
    { timeoutMs: 10_000 },
  )).stdout.trim());
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
