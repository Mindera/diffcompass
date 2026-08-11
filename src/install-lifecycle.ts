import { lstat, mkdir, readFile, readdir, readlink, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, parse, relative, resolve } from "node:path";

type Platform = NodeJS.Platform;

export interface LifecycleEnvironment {
  env?: NodeJS.ProcessEnv;
  platform?: Platform;
  executable?: string;
  sourceRoot?: string;
  spawn?: (command: string[]) => Promise<number>;
}

interface InstallPaths {
  installRoot: string;
  binRoot: string;
  stateRoot: string;
  skillTargets: string[];
}

function pathsFor(env: NodeJS.ProcessEnv, platform: Platform): InstallPaths {
  const home = env.HOME || env.USERPROFILE || homedir();
  const installRoot = resolve(env.CODE_REVIEW_TOUR_INSTALL_ROOT || (platform === "win32"
    ? join(env.LOCALAPPDATA || join(home, "AppData", "Local"), "code-review-tour")
    : join(env.XDG_DATA_HOME || join(home, ".local", "share"), "code-review-tour")));
  const binRoot = resolve(env.CODE_REVIEW_TOUR_BIN_ROOT || (platform === "win32"
    ? join(installRoot, "bin")
    : join(env.XDG_BIN_HOME || join(home, ".local", "bin"))));
  const stateRoot = resolve(env.CODE_REVIEW_TOUR_STATE_ROOT || (platform === "win32"
    ? join(env.LOCALAPPDATA || join(home, "AppData", "Local"), "code-review-tour-state")
    : join(env.XDG_STATE_HOME || join(home, ".local", "state"), "code-review-tour")));
  return {
    installRoot,
    binRoot,
    stateRoot,
    skillTargets: [
      join(env.CODE_REVIEW_TOUR_CODEX_SKILL_ROOT || join(env.CODEX_HOME || join(home, ".codex"), "skills"), "code-review-tour"),
      join(env.CODE_REVIEW_TOUR_CLAUDE_SKILL_ROOT || join(home, ".claude", "skills"), "code-review-tour"),
      join(env.CODE_REVIEW_TOUR_GEMINI_SKILL_ROOT || join(home, ".gemini", "skills"), "code-review-tour"),
      join(env.CODE_REVIEW_TOUR_COPILOT_SKILL_ROOT || join(env.COPILOT_HOME || join(home, ".copilot"), "skills"), "code-review-tour"),
    ].map((path) => resolve(path)),
  };
}

function inside(parent: string, child: string): boolean {
  const location = relative(parent, child);
  return location === "" || (!location.startsWith("..") && !isAbsolute(location));
}

async function readHistory(installRoot: string): Promise<string[]> {
  try {
    const values = (await readFile(join(installRoot, "history"), "utf8")).split(/\r?\n/).filter(Boolean);
    if (values.length > 0) return values;
  } catch {}
  try {
    const value: unknown = JSON.parse(await readFile(join(installRoot, "history.json"), "utf8"));
    if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
  } catch {}
  const entries = await readdir(installRoot, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory() && /^\d+\.\d+\.\d+(?:[-+].+)?$/.test(entry.name)).map((entry) => entry.name).sort();
}

async function currentVersion(paths: InstallPaths, platform: Platform): Promise<string> {
  if (platform === "win32") return (await readFile(join(paths.installRoot, "current-version"), "utf8")).trim();
  return basename(await realpath(join(paths.installRoot, "current")));
}

async function managedLink(path: string, installRoot: string): Promise<boolean> {
  try {
    if (!(await lstat(path)).isSymbolicLink()) return false;
    const target = await readlink(path);
    return inside(installRoot, resolve(dirname(path), target));
  } catch {
    return false;
  }
}

async function switchVersion(paths: InstallPaths, version: string, platform: Platform): Promise<void> {
  const versionRoot = join(paths.installRoot, version);
  const executable = join(versionRoot, "bin", platform === "win32" ? "code-review-tour.exe" : "code-review-tour");
  if (!existsSync(executable)) throw new Error(`Installed version ${version} is incomplete.`);
  if (platform === "win32") {
    await mkdir(paths.binRoot, { recursive: true });
    await writeFile(join(paths.binRoot, ".code-review-tour-managed"), `${paths.installRoot}\n`);
    await writeFile(join(paths.installRoot, "current-version"), `${version}\n`);
    return;
  }
  const binary = join(paths.binRoot, "code-review-tour");
  if (existsSync(binary) && !(await managedLink(binary, paths.installRoot))) {
    throw new Error(`Refusing to replace an unmanaged command: ${binary}`);
  }
  const current = join(paths.installRoot, "current");
  const temporary = join(paths.installRoot, `.current-${process.pid}`);
  await rm(temporary, { force: true });
  await symlink(versionRoot, temporary);
  await rename(temporary, current);
  await mkdir(paths.binRoot, { recursive: true });
  await rm(binary, { force: true });
  await symlink(join(current, "bin", "code-review-tour"), binary);
}

function parseValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

async function locateInstaller(environment: Required<Pick<LifecycleEnvironment, "platform" | "executable" | "sourceRoot">> & { env: NodeJS.ProcessEnv }): Promise<string> {
  if (environment.env.CODE_REVIEW_TOUR_INSTALLER) return resolve(environment.env.CODE_REVIEW_TOUR_INSTALLER);
  const name = environment.platform === "win32" ? "install.ps1" : "install.sh";
  const executable = await realpath(environment.executable).catch(() => environment.executable);
  const candidates = [
    join(dirname(dirname(executable)), "share", "code-review-tour", name),
    join(environment.sourceRoot, "scripts", name),
  ];
  const installer = candidates.find(existsSync);
  if (!installer) throw new Error(`Could not find the bundled ${name}. Reinstall from a release archive.`);
  return installer;
}

async function update(args: string[], environment: LifecycleEnvironment): Promise<string> {
  const env = environment.env ?? process.env;
  const platform = environment.platform ?? process.platform;
  const installer = await locateInstaller({
    env,
    platform,
    executable: environment.executable ?? process.execPath,
    sourceRoot: environment.sourceRoot ?? join(import.meta.dir, ".."),
  });
  const version = parseValue(args, "--version");
  const allowed = new Set(["--version", "--minimal", "--binary-only", "--no-minimal"]);
  for (let index = 0; index < args.length; index += 1) {
    if (!allowed.has(args[index])) throw new Error(`Unknown update option: ${args[index]}`);
    if (args[index] === "--version") index += 1;
  }
  const requestedMode = args.some((arg) => ["--minimal", "--binary-only", "--no-minimal"].includes(arg));
  const persistedMinimal = !requestedMode && await readFile(join(pathsFor(env, platform).installRoot, "install-mode"), "utf8").then((value) => value.trim() === "minimal").catch(() => false);
  const installerArgs = [
    ...(args.includes("--minimal") || persistedMinimal ? ["--minimal"] : []),
    ...(args.includes("--binary-only") ? ["--binary-only"] : []),
    ...(args.includes("--no-minimal") ? ["--no-minimal"] : []),
  ];
  const command = platform === "win32"
    ? ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", installer, ...installerArgs]
    : ["bash", installer, ...installerArgs];
  const run = environment.spawn ?? (async (parts: string[]) => (await Bun.spawn(parts, {
    stdin: "inherit", stdout: "inherit", stderr: "inherit", env: { ...process.env, ...env, ...(version ? { CODE_REVIEW_TOUR_VERSION: version } : {}) },
  }).exited));
  const exitCode = await run(command);
  if (exitCode !== 0) throw new Error(`Update installer exited with ${exitCode}.`);
  return version ? `Updated Code Review Tour to ${version}.` : "Updated Code Review Tour.";
}

async function rollback(args: string[], environment: LifecycleEnvironment): Promise<string> {
  const allowed = new Set(["--to"]);
  for (let index = 0; index < args.length; index += 1) {
    if (!allowed.has(args[index])) throw new Error(`Unknown rollback option: ${args[index]}`);
    index += 1;
  }
  const platform = environment.platform ?? process.platform;
  const paths = pathsFor(environment.env ?? process.env, platform);
  const history = (await readHistory(paths.installRoot)).filter((version) => existsSync(join(paths.installRoot, version)));
  const current = await currentVersion(paths, platform).catch(() => "");
  const requested = parseValue(args, "--to");
  const target = requested ?? history.slice(0, Math.max(0, history.lastIndexOf(current))).reverse().find((version) => version !== current);
  if (!target) throw new Error("No earlier installed version is available to roll back to.");
  if (!history.includes(target)) throw new Error(`Version ${target} is not installed.`);
  await switchVersion(paths, target, platform);
  const updated = [...history.filter((version) => version !== target), target];
  await writeFile(join(paths.installRoot, "history"), `${updated.join("\n")}\n`);
  await writeFile(join(paths.installRoot, "history.json"), `${JSON.stringify(updated, null, 2)}\n`);
  return `Rolled back Code Review Tour from ${current || "unknown"} to ${target}.`;
}

async function removeManagedTarget(target: string, paths: InstallPaths, platform: Platform): Promise<boolean> {
  if (platform !== "win32") {
    if (!(await managedLink(target, paths.installRoot))) return false;
    await rm(target, { force: true });
    return true;
  }
  if (!existsSync(join(target, ".code-review-tour-managed"))) return false;
  await rm(target, { recursive: true, force: true });
  return true;
}

async function uninstall(args: string[], environment: LifecycleEnvironment): Promise<string> {
  const allowed = new Set(["--yes", "--dry-run", "--purge"]);
  for (const arg of args) if (!allowed.has(arg)) throw new Error(`Unknown uninstall option: ${arg}`);
  const platform = environment.platform ?? process.platform;
  const paths = pathsFor(environment.env ?? process.env, platform);
  const dryRun = args.includes("--dry-run");
  const purge = args.includes("--purge");
  const targets = [paths.installRoot, join(paths.binRoot, platform === "win32" ? "code-review-tour.cmd" : "code-review-tour"), ...paths.skillTargets, ...(purge ? [paths.stateRoot] : [])];
  if (dryRun || !args.includes("--yes")) {
    return [
      "Would remove installer-managed files:",
      ...targets.map((target) => `  ${target}`),
      ...(purge ? [] : ["Review sessions are preserved. Use --purge to include them."]),
      ...(dryRun ? [] : ["Repeat with --yes to apply."]),
    ].join("\n");
  }
  const home = resolve((environment.env ?? process.env).HOME || (environment.env ?? process.env).USERPROFILE || homedir());
  for (const root of [paths.installRoot, ...(purge ? [paths.stateRoot] : [])]) {
    if (root === parse(root).root || root === home) throw new Error(`Refusing to remove unsafe root: ${root}`);
  }
  if (!["history", "history.json", "current", "current-version"].some((name) => existsSync(join(paths.installRoot, name)))) {
    throw new Error(`Refusing to remove an install root without Code Review Tour ownership metadata: ${paths.installRoot}`);
  }
  for (const target of paths.skillTargets) await removeManagedTarget(target, paths, platform);
  const binary = join(paths.binRoot, platform === "win32" ? "code-review-tour.cmd" : "code-review-tour");
  const deferredTargets: string[] = [];
  if (platform === "win32") {
    const marker = join(paths.binRoot, ".code-review-tour-managed");
    if (existsSync(marker)) {
      deferredTargets.push(binary, marker);
    }
    deferredTargets.push(paths.installRoot);
  } else if (await managedLink(binary, paths.installRoot)) {
    await rm(binary, { force: true });
  }
  if (platform !== "win32") await rm(paths.installRoot, { recursive: true, force: true });
  if (purge) await rm(paths.stateRoot, { recursive: true, force: true });
  if (deferredTargets.length > 0) {
    const quote = (value: string) => value.replaceAll("'", "''");
    const removals = [...new Set(deferredTargets)].map((target) => `Remove-Item -LiteralPath '${quote(target)}' -Recurse -Force -ErrorAction SilentlyContinue`).join("; ");
    const script = `Wait-Process -Id ${process.pid} -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 500; ${removals}`;
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    const launcher = `Start-Process -WindowStyle Hidden -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-EncodedCommand','${encoded}')`;
    const launcherEncoded = Buffer.from(launcher, "utf16le").toString("base64");
    const cleanup = Bun.spawn(["powershell.exe", "-NoProfile", "-EncodedCommand", launcherEncoded], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    if (await cleanup.exited !== 0) throw new Error("Could not schedule Windows uninstall cleanup.");
  }
  return `Uninstalled Code Review Tour.${purge ? " Review sessions were removed." : " Review sessions were preserved."}`;
}

export async function runLifecycleCommand(command: string, args: string[], environment: LifecycleEnvironment = {}): Promise<string> {
  if (command === "update") return update(args, environment);
  if (command === "rollback") return rollback(args, environment);
  if (command === "uninstall") return uninstall(args, environment);
  throw new Error(`Unknown lifecycle command: ${command}`);
}
