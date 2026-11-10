#!/usr/bin/env bun
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { watch } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { resolveRepositoryRoot } from "./git.ts";
import { loadPersistedSession } from "./store.ts";
import { ReviewSession } from "./session.ts";
import { startServer } from "./server.ts";
import packageJson from "../package.json" with { type: "json" };
import { runDoctor } from "./doctor.ts";
import { acquireSessionLock, reviewSessionDirectory, runSessionCommand } from "./session-library.ts";
import { loadRepositoryConfig } from "./config.ts";
import { createPullRequestWorkspace, loadPullRequestContext, removePullRequestWorkspace } from "./github.ts";
import type { PullRequestContext } from "./types.ts";
import { runBridgeCommand } from "./bridge-command.ts";
import { runLifecycleCommand } from "./install-lifecycle.ts";
import { prepareAndOpenReviewPage } from "./open-review.ts";

interface Options {
  repository: string;
  base?: string;
  agent?: string;
  model?: string;
  reasoning?: "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
  callerModel?: string;
  callerReasoning?: "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
  port: number;
  attached: boolean;
  open: boolean;
  startTour: boolean;
  disableFindings: boolean;
  previewRedirect: boolean;
  media: string[];
  mediaIncludeChangedImages?: boolean;
  intentFile?: string;
  resume?: string;
  pullRequest?: string;
}

function printHelp(): void {
  console.log(`DiffCompass ${packageJson.version}

Usage:
  diffcompass [options]
  diffcompass doctor
  diffcompass bridge context|next|respond|ack|renew|refresh [options]
  diffcompass pr URL|NUMBER [options]
  diffcompass sessions [list|resume|rename|archive|unarchive|delete|prune]
  diffcompass update [--version VERSION] [--minimal]
  diffcompass rollback [--to VERSION]
  diffcompass uninstall [--dry-run|--yes] [--purge]

Options:
  --repo PATH          Repository to review (default: current directory)
  --base REF           Parent branch, commit, or captured Git tree to compare
  --attached           Use the launching agent as the conversation backend
  --start-tour         Prepare stop one before opening the review page
                       (implied by --attached --open)
  --no-findings        Skip finding generation for this review session
  --open               Open the review automatically in the default browser
  --agent ID           Standalone agent: codex, claude, gemini, or copilot
  --model MODEL        Model identifier reported by the selected agent
  --reasoning EFFORT   minimal, low, medium, high, xhigh, max, or ultra
  --caller-model MODEL Optional attached-agent model label
  --caller-reasoning EFFORT
                       Optional attached-agent effort label
  --port PORT          Loopback port (default: random)
  --preview-redirect   Redirect / to the tokenized URL so remote previews work
  --media PATH         Add an image or MP4 to the Media tab (repeatable)
  --media-include-changed-images
                       Also show changed PNGs in Media (loaded on demand)
  --intent-file PATH   Give the Briefing author-stated context from a text file
  --resume FILE        Resume a persisted review session
  --version            Print the installed version
  --help               Show this help`);
}

function parseOptions(args: string[]): Options {
  const options: Options = { repository: process.cwd(), port: 0, attached: false, open: false, startTour: false, disableFindings: false, previewRedirect: false, media: [] };
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
    } else if (arg === "--start-tour") {
      options.startTour = true;
    } else if (arg === "--no-findings") {
      options.disableFindings = true;
    } else if (arg === "--open") {
      options.open = true;
    } else if (arg === "--preview-redirect") {
      options.previewRedirect = true;
    } else if (arg === "--media-include-changed-images") {
      options.mediaIncludeChangedImages = true;
    } else if (arg === "--media" && value) {
      options.media.push(resolve(value));
      index += 1;
    } else if (arg === "--intent-file" && value) {
      options.intentFile = resolve(value);
      index += 1;
    } else if (arg === "--screenshot") {
      throw new Error("--screenshot was replaced by --media; pass each image or MP4 with --media PATH.");
    } else if (arg === "--resume" && value) {
      options.resume = value;
      index += 1;
    } else if (arg === "--reasoning" && value) {
      if (!["minimal", "low", "medium", "high", "xhigh", "max", "ultra"].includes(value)) {
        throw new Error(`Unsupported reasoning effort: ${value}`);
      }
      options.reasoning = value as Options["reasoning"];
      index += 1;
    } else if (arg === "--caller-model" && value) {
      options.callerModel = value;
      index += 1;
    } else if (arg === "--caller-reasoning" && value) {
      if (!["minimal", "low", "medium", "high", "xhigh", "max", "ultra"].includes(value)) {
        throw new Error(`Unsupported caller reasoning effort: ${value}`);
      }
      options.callerReasoning = value as Options["callerReasoning"];
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
if (command === "bridge") {
  process.exit(await runBridgeCommand(cliArguments.slice(1)));
}
if (command === "sessions") {
  const result = await runSessionCommand(cliArguments.slice(1));
  if (!result.resumePath) {
    if (result.output) console.log(result.output);
    process.exit(0);
  }
  cliArguments = ["--resume", result.resumePath, ...(result.open ? ["--open"] : [])];
}
if (command === "update" || command === "rollback" || command === "uninstall") {
  console.log(await runLifecycleCommand(command, cliArguments.slice(1)));
  process.exit(0);
}
let pullRequestIdentifier: string | undefined;
if (command === "pr") {
  pullRequestIdentifier = cliArguments[1];
  if (!pullRequestIdentifier) throw new Error("The pr command requires a GitHub pull request URL or number.");
  cliArguments = cliArguments.slice(2);
}
const options = parseOptions(cliArguments);
if (options.attached && options.open) options.startTour = true;
if ((options.callerModel || options.callerReasoning) && !options.attached && !options.resume) {
  throw new Error("--caller-model and --caller-reasoning require --attached or --resume.");
}
options.pullRequest = pullRequestIdentifier;
let authorIntent: string | undefined;
if (options.intentFile) {
  const metadata = await lstat(options.intentFile).catch(() => undefined);
  if (!metadata?.isFile()) throw new Error(`Intent file must be a regular file: ${options.intentFile}`);
  authorIntent = await readFile(options.intentFile, "utf8");
  if (authorIntent.length > 24000) throw new Error(`Intent file exceeds its size limit (24000 characters): ${options.intentFile}`);
}
const stateFile = options.resume ?? join(
  process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"),
  "diffcompass",
  "sessions",
  `${crypto.randomUUID()}.json`,
);
const resumedState = options.resume ? await loadPersistedSession(stateFile) : undefined;
// A completed PR review may have already released its isolated checkout.
const intendedRepositoryRoot = resumedState
  ? resumedState.pullRequest?.sourceRepositoryRoot ?? resumedState.repositoryRoot
  : await resolveRepositoryRoot(options.repository);
const canonicalRepositoryRoot = await realpath(intendedRepositoryRoot);
const repositoryConfig = await loadRepositoryConfig(canonicalRepositoryRoot);
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
const releaseSessionLock = await acquireSessionLock(canonicalStatePath);
let session: ReviewSession;
let pullRequest: PullRequestContext | undefined;
let createdPullRequestWorkspace = false;
const workspaceContainer = join(dirname(canonicalStateDirectory), "worktrees", basename(canonicalStatePath, ".json"));
try {
  let reviewRepository = options.repository;
  let reviewBase = options.base ?? repositoryConfig.base;
  if (options.pullRequest) {
    pullRequest = await loadPullRequestContext(canonicalRepositoryRoot, options.pullRequest);
    reviewRepository = await createPullRequestWorkspace(pullRequest, workspaceContainer);
    createdPullRequestWorkspace = true;
    reviewBase = pullRequest.baseRefOid;
  } else if (resumedState?.pullRequest) {
    pullRequest = resumedState.pullRequest;
    if (resolve(pullRequest.workspaceRoot) !== join(workspaceContainer, "workspace")) {
      throw new Error("Persisted pull request workspace is outside the owned worktree directory.");
    }
    const missing = await lstat(pullRequest.workspaceRoot).then(() => false, (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return true;
    });
    if (missing && resumedState.status !== "open") {
      await createPullRequestWorkspace(pullRequest, workspaceContainer);
      createdPullRequestWorkspace = true;
    }
  }
  session = await ReviewSession.create(reviewRepository, reviewBase, {
    adapterId: options.attached ? "attached" : options.agent ?? repositoryConfig.agent,
    modelId: options.attached ? undefined : options.model ?? repositoryConfig.model,
    reasoningEffort: options.attached ? undefined : options.reasoning ?? repositoryConfig.reasoning,
    callerModel: options.callerModel,
    callerReasoningEffort: options.callerReasoning,
    attached: options.attached,
    stateFile: canonicalStatePath,
    diffPreferenceDirectory: reviewSessionDirectory(),
    resume: Boolean(options.resume),
    preferences: repositoryConfig.preferences,
    reviewPolicy: repositoryConfig.reviewPolicy,
    includeFindings: options.disableFindings ? false : undefined,
    pullRequest,
    screenshots: options.media,
    mediaIncludeChangedImages: options.mediaIncludeChangedImages ?? resumedState?.mediaIncludeChangedImages ?? repositoryConfig.mediaIncludeChangedImages,
    authorIntent,
  });
  if (session.pullRequest?.workspaceRoot) {
    await writeFile(join(session.pullRequest.workspaceRoot, "..", ".active.json"), `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`, { mode: 0o600 });
  }
} catch (error) {
  let cleanupError: unknown;
  if (createdPullRequestWorkspace && pullRequest) {
    try { await removePullRequestWorkspace(pullRequest); } catch (failure) { cleanupError = failure; }
  }
  await releaseSessionLock().catch((failure) => { cleanupError ??= failure; });
  if (cleanupError) throw new Error(`Review startup failed and its isolated workspace could not be cleaned up: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`, { cause: error });
  throw error;
}
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let repositoryWatcher: ReturnType<typeof watch> | undefined;
if (!session.pullRequest) {
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
}
const server = startServer(session, options.port, undefined, options.previewRedirect, options.startTour);
const baseUrl = `http://${server.hostname}:${server.port}`;
const reviewUrl = `${baseUrl}/#token=${encodeURIComponent(session.browserToken)}${options.startTour ? "&intro=1" : ""}`;
try {
  await releaseSessionLock.publishUrls({ reviewUrl, bridgeUrl: session.bridge ? baseUrl : undefined });
} catch (error) {
  if (refreshTimer) clearTimeout(refreshTimer);
  repositoryWatcher?.close();
  await server.stop(true);
  await session.dispose();
  await releaseSessionLock();
  throw error;
}
const deferReviewUrl = options.open && options.startTour;
if (!deferReviewUrl) console.log(`DiffCompass: ${reviewUrl}`);
console.log(`Repository: ${session.comparison.repositoryRoot}`);
console.log(`Comparison: ${session.comparison.base} (${session.comparison.mergeBase.slice(0, 8)}) → working tree`);
console.log(`Tour agents: ${session.agentAdapters.map((adapter) => adapter.label).join(", ") || "none detected"}`);
console.log(`Session state: ${canonicalStatePath}`);
console.log(`Resume: diffcompass --resume ${JSON.stringify(canonicalStatePath)}`);
let shuttingDown = false;
let terminalDeliveryTimer: ReturnType<typeof setTimeout> | undefined;
const shutdown = async (bridgeDirectory?: string, force = false) => {
  if (shuttingDown) return;
  shuttingDown = true;
  if (terminalDeliveryTimer) clearTimeout(terminalDeliveryTimer);
  if (refreshTimer) clearTimeout(refreshTimer);
  repositoryWatcher?.close();
  const stopped = server.stop(force);
  await session.dispose();
  await stopped;
  try {
    // Interrupted, unfinished reviews still need their checkout for resume.
    // Normal attached shutdown waits for terminal delivery or timeout.
    if (session.status !== "open" && session.pullRequest) await removePullRequestWorkspace(session.pullRequest);
  } catch (error) {
    console.warn(`Could not remove the completed review workspace: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (session.pullRequest?.workspaceRoot) await unlink(join(session.pullRequest.workspaceRoot, "..", ".active.json")).catch(() => undefined);
    try { await releaseSessionLock(); }
    finally { if (bridgeDirectory) await rm(bridgeDirectory, { recursive: true, force: true }); }
  }
};
if (session.bridge) {
  const bridgeDirectory = await mkdtemp(join(tmpdir(), "diffcompass-"));
  await writeFile(join(bridgeDirectory, ".active.json"), `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`, { mode: 0o600 });
  const bridgeTokenFile = join(bridgeDirectory, "bridge-token");
  await writeFile(bridgeTokenFile, session.bridge.token, { mode: 0o600 });
  console.log(`Attached bridge URL: ${baseUrl}`);
  console.log(`Attached bridge token file: ${bridgeTokenFile}`);

  session.closed.then(() => {
    if (!shuttingDown) terminalDeliveryTimer = setTimeout(() => shutdown(bridgeDirectory), 5 * 60 * 1_000);
  });
  session.bridge.terminalAcknowledged.then(() => {
    if (terminalDeliveryTimer) clearTimeout(terminalDeliveryTimer);
    if (!shuttingDown) setTimeout(() => shutdown(bridgeDirectory), 100);
  });
  process.on("SIGINT", () => shutdown(bridgeDirectory, true));
  process.on("SIGTERM", () => shutdown(bridgeDirectory, true));
} else {
  session.closed.then(() => setTimeout(() => shutdown(), 100));
  process.on("SIGINT", () => shutdown(undefined, true));
  process.on("SIGTERM", () => shutdown(undefined, true));
}

const automaticTour = options.startTour ? session.startTour() : undefined;

if (options.open) {
  await prepareAndOpenReviewPage(automaticTour, reviewUrl);
  if (deferReviewUrl) console.log(`DiffCompass: ${reviewUrl}`);
} else if (automaticTour) {
  void automaticTour.catch((error) => {
    console.error(`Could not start the tour automatically: ${error instanceof Error ? error.message : String(error)}`);
  });
}
