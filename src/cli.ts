#!/usr/bin/env bun
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { watch } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { resolveRepositoryRoot } from "./git.ts";
import { loadPersistedSession } from "./store.ts";
import { ReviewSession } from "./session.ts";
import { startServer } from "./server.ts";
import packageJson from "../package.json" with { type: "json" };
import { runDoctor } from "./doctor.ts";
import { runSessionCommand } from "./session-library.ts";

interface Options {
  repository: string;
  base?: string;
  agent?: string;
  model?: string;
  reasoning?: "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
  port: number;
  attached: boolean;
  open: boolean;
  resume?: string;
}

function printHelp(): void {
  console.log(`Code Review Tour ${packageJson.version}

Usage:
  code-review-tour [options]
  code-review-tour doctor
  code-review-tour sessions [list|resume|rename|archive|unarchive|delete]

Options:
  --repo PATH          Repository to review (default: current directory)
  --base REF           Parent branch or Git reference to compare
  --attached           Use the launching agent as the conversation backend
  --open               Open the review automatically in the default browser
  --agent ID           Standalone agent: codex or claude
  --model MODEL        Model identifier reported by the selected agent
  --reasoning EFFORT   minimal, low, medium, high, xhigh, max, or ultra
  --port PORT          Loopback port (default: random)
  --resume FILE        Resume a persisted review session
  --version            Print the installed version
  --help               Show this help`);
}

function parseOptions(args: string[]): Options {
  const options: Options = { repository: process.cwd(), port: 0, attached: false, open: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    if (arg === "--repo" && value) {
      options.repository = value;
      index += 1;
    } else if (arg === "--base" && value) {
      options.base = value;
      index += 1;
    } else if (arg === "--model" && value) {
      options.model = value;
      index += 1;
    } else if (arg === "--agent" && value) {
      options.agent = value;
      index += 1;
    } else if (arg === "--attached") {
      options.attached = true;
    } else if (arg === "--open") {
      options.open = true;
    } else if (arg === "--resume" && value) {
      options.resume = value;
      index += 1;
    } else if (arg === "--reasoning" && value) {
      if (!["minimal", "low", "medium", "high", "xhigh", "max", "ultra"].includes(value)) {
        throw new Error(`Unsupported reasoning effort: ${value}`);
      }
      options.reasoning = value as Options["reasoning"];
      index += 1;
    } else if (arg === "--port" && value) {
      options.port = Number(value);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown or incomplete option: ${arg}`);
    }
  }
  return options;
}

let cliArguments = process.argv.slice(2);
const command = cliArguments[0];
if (command === "--version" || command === "-v") {
  console.log(packageJson.version);
  process.exit(0);
}
if (command === "doctor") {
  process.exit(await runDoctor());
}
if (command === "sessions") {
  const result = await runSessionCommand(cliArguments.slice(1));
  if (!result.resumePath) {
    if (result.output) console.log(result.output);
    process.exit(0);
  }
  cliArguments = ["--resume", result.resumePath, ...(result.open ? ["--open"] : [])];
}
const options = parseOptions(cliArguments);
const stateFile = options.resume ?? join(
  process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"),
  "code-review-tour",
  "sessions",
  `${crypto.randomUUID()}.json`,
);
const intendedRepositoryRoot = options.resume
  ? (await loadPersistedSession(stateFile)).repositoryRoot
  : await resolveRepositoryRoot(options.repository);
const canonicalRepositoryRoot = await realpath(intendedRepositoryRoot);
const absoluteStatePath = resolve(stateFile);
const lexicalStateLocation = relative(canonicalRepositoryRoot, absoluteStatePath);
if (!lexicalStateLocation || (!lexicalStateLocation.startsWith("..") && !isAbsolute(lexicalStateLocation))) {
  throw new Error("Review session state must be stored outside the reviewed repository.");
}
let existingAncestor = dirname(absoluteStatePath);
const missingSegments: string[] = [];
while (true) {
  try {
    existingAncestor = await realpath(existingAncestor);
    break;
  } catch {
    const parent = dirname(existingAncestor);
    if (parent === existingAncestor) throw new Error("Could not resolve the review session state directory.");
    missingSegments.unshift(basename(existingAncestor));
    existingAncestor = parent;
  }
}
const canonicalStateDirectory = join(existingAncestor, ...missingSegments);
const canonicalStatePath = options.resume
  ? await realpath(stateFile)
  : join(canonicalStateDirectory, basename(stateFile));
const stateWithinRepository = relative(canonicalRepositoryRoot, canonicalStatePath);
if (!stateWithinRepository || (!stateWithinRepository.startsWith("..") && !isAbsolute(stateWithinRepository))) {
  throw new Error("Review session state must be stored outside the reviewed repository.");
}
await mkdir(canonicalStateDirectory, { recursive: true, mode: 0o700 });
const session = await ReviewSession.create(options.repository, options.base, {
  adapterId: options.agent ?? (options.attached ? "attached" : undefined),
  modelId: options.model,
  reasoningEffort: options.reasoning,
  attached: options.attached,
  stateFile: canonicalStatePath,
  resume: Boolean(options.resume),
});
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let repositoryWatcher: ReturnType<typeof watch> | undefined;
try {
  repositoryWatcher = watch(session.comparison.repositoryRoot, { recursive: true }, (_event, filename) => {
    if (!filename || String(filename).split(/[\\/]/).includes(".git")) return;
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      session.refreshComparison({ source: "watcher" }).catch((error) => console.error("Could not refresh the review comparison:", error));
    }, 500);
  });
} catch (error) {
  console.warn(`Automatic repository watching is unavailable: ${error instanceof Error ? error.message : String(error)}`);
}
const server = startServer(session, options.port);
const baseUrl = `http://${server.hostname}:${server.port}`;
const reviewUrl = `${baseUrl}/#token=${encodeURIComponent(session.browserToken)}`;
console.log(`Code Review Tour: ${reviewUrl}`);
console.log(`Repository: ${session.comparison.repositoryRoot}`);
console.log(`Comparison: ${session.comparison.base} (${session.comparison.mergeBase.slice(0, 8)}) → working tree`);
console.log(`Tour agents: ${session.agentAdapters.map((adapter) => adapter.label).join(", ") || "none detected"}`);
console.log(`Session state: ${canonicalStatePath}`);
console.log(`Resume: code-review-tour --resume ${JSON.stringify(canonicalStatePath)}`);
let shuttingDown = false;
const shutdown = async (bridgeDirectory?: string, force = false) => {
  if (shuttingDown) return;
  shuttingDown = true;
  if (refreshTimer) clearTimeout(refreshTimer);
  repositoryWatcher?.close();
  server.stop(force);
  await session.dispose();
  if (bridgeDirectory) await rm(bridgeDirectory, { recursive: true, force: true });
};
if (session.bridge) {
  const bridgeDirectory = await mkdtemp(join(tmpdir(), "code-review-tour-"));
  const bridgeTokenFile = join(bridgeDirectory, "bridge-token");
  await writeFile(bridgeTokenFile, session.bridge.token, { mode: 0o600 });
  console.log(`Attached bridge URL: ${baseUrl}`);
  console.log(`Attached bridge token file: ${bridgeTokenFile}`);

  let fallback: ReturnType<typeof setTimeout> | undefined;
  session.closed.then(() => {
    fallback = setTimeout(() => shutdown(bridgeDirectory), 5 * 60 * 1_000);
  });
  session.bridge.terminalAcknowledged.then(() => {
    if (fallback) clearTimeout(fallback);
    setTimeout(() => shutdown(bridgeDirectory), 100);
  });
  process.on("SIGINT", () => shutdown(bridgeDirectory, true));
  process.on("SIGTERM", () => shutdown(bridgeDirectory, true));
} else {
  session.closed.then(() => setTimeout(() => shutdown(), 100));
  process.on("SIGINT", () => shutdown(undefined, true));
  process.on("SIGTERM", () => shutdown(undefined, true));
}

if (options.open) {
  const command = process.platform === "darwin"
    ? ["open", reviewUrl]
    : process.platform === "win32"
      ? ["cmd", "/c", "start", "", reviewUrl]
      : ["xdg-open", reviewUrl];
  try {
    Bun.spawn(command, { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  } catch (error) {
    console.error(`Could not open the browser automatically: ${error instanceof Error ? error.message : String(error)}`);
  }
}
