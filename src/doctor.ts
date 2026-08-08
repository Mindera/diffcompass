import { access, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { discoverAgentAdapters } from "./adapters.ts";
import { runProcess } from "./process.ts";

interface Check {
  level: "ok" | "warn" | "error";
  label: string;
  detail: string;
}

async function commandVersion(command: string[]): Promise<string | undefined> {
  try {
    return (await runProcess(command, process.cwd(), [0], { timeoutMs: 5_000 })).stdout.trim();
  } catch {
    return undefined;
  }
}

export async function runDoctor(): Promise<number> {
  const checks: Check[] = [{ level: "ok", label: "Runtime", detail: `Bun ${Bun.version}` }];
  const git = await commandVersion(["git", "--version"]);
  checks.push(git
    ? { level: "ok", label: "Git", detail: git }
    : { level: "error", label: "Git", detail: "not found on PATH" });

  const stateDirectory = join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "code-review-tour", "sessions");
  try {
    await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
    await access(stateDirectory, constants.R_OK | constants.W_OK);
    checks.push({ level: "ok", label: "Sessions", detail: stateDirectory });
  } catch (error) {
    checks.push({ level: "error", label: "Sessions", detail: error instanceof Error ? error.message : String(error) });
  }

  const adapters = await discoverAgentAdapters(process.cwd());
  checks.push(adapters.length > 0
    ? { level: "ok", label: "Agents", detail: adapters.map((adapter) => adapter.label).join(", ") }
    : { level: "warn", label: "Agents", detail: "no standalone Codex or Claude CLI detected; attached mode remains available" });

  for (const check of checks) {
    const marker = check.level === "ok" ? "✓" : check.level === "warn" ? "!" : "✗";
    console.log(`${marker} ${check.label}: ${check.detail}`);
  }
  return checks.some((check) => check.level === "error") ? 1 : 0;
}
