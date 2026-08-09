import { runProcess } from "./process.ts";
import type { AgentAdapterOption, AgentModelOption, ReasoningEffort } from "./types.ts";
import packageJson from "../package.json" with { type: "json" };

interface CodexModelEntry {
  id?: string;
  model?: string;
  displayName?: string;
  hidden?: boolean;
  isDefault?: boolean;
  defaultReasoningEffort?: ReasoningEffort;
  supportedReasoningEfforts?: Array<ReasoningEffort | { reasoningEffort?: ReasoningEffort; effort?: ReasoningEffort }>;
}

interface JsonRpcResponse {
  id?: number;
  result?: { data?: CodexModelEntry[] };
}

export function parseCodexModelList(output: string): AgentModelOption[] {
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    let response: JsonRpcResponse;
    try {
      response = JSON.parse(line) as JsonRpcResponse;
    } catch {
      continue;
    }
    if (response.id !== 2 || !Array.isArray(response.result?.data)) continue;
    return response.result.data
      .filter((model) => !model.hidden && Boolean(model.id ?? model.model))
      .map((model) => ({
        id: model.id ?? model.model!,
        label: model.displayName ?? model.id ?? model.model!,
        isDefault: Boolean(model.isDefault),
        defaultReasoningEffort: model.defaultReasoningEffort,
        reasoningEfforts: (model.supportedReasoningEfforts ?? [])
          .map((effort) => typeof effort === "string" ? effort : effort.reasoningEffort ?? effort.effort)
          .filter((effort): effort is ReasoningEffort => Boolean(effort)),
      }));
  }
  return [];
}

async function discoverCodexModels(executable: string, cwd: string): Promise<AgentModelOption[]> {
  const child = Bun.spawn([executable, "app-server"], {
    cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const requests = [
    { method: "initialize", id: 1, params: { clientInfo: { name: "code-review-tour", version: packageJson.version } } },
    { method: "initialized", params: {} },
    { method: "model/list", id: 2, params: { limit: 100, includeHidden: false } },
  ];
  child.stdin.write(requests.map((request) => JSON.stringify(request)).join("\n") + "\n");
  child.stdin.flush();

  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let output = "";
  const deadline = Date.now() + 5_000;
  try {
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const next = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Codex model discovery timed out.")), remaining);
        }),
      ]);
      if (timer) clearTimeout(timer);
      if (next.done) break;
      output += decoder.decode(next.value, { stream: true });
      const models = parseCodexModelList(output);
      if (models.length > 0) return models;
    }
    throw new Error("The Codex App Server did not return a model catalog.");
  } finally {
    child.stdin.end();
    await reader.cancel().catch(() => undefined);
    child.kill();
  }
}

async function executableVersion(executable: string, cwd: string): Promise<string | undefined> {
  try {
    const result = await runProcess([executable, "--version"], cwd);
    return result.stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

export function parseCopilotModelList(output: string): AgentModelOption[] {
  const section = /(?:^|\n)\s*Supported models:?\s*\n([\s\S]*?)(?=\n\s*(?:Options|Commands|Tool availability|Environment variables)\b|$)/i.exec(output)?.[1];
  if (!section) return [];
  const ids = new Set<string>();
  for (const line of section.split("\n")) {
    const match = /^\s*(?:[-*]\s*)?`?([a-z][a-z0-9.-]*(?:-[a-z0-9.-]+)+|auto)`?(?:\s{2,}|\s+\|)/i.exec(line);
    if (match) ids.add(match[1]!);
  }
  return [...ids].map((id, index) => ({
    id,
    label: id === "auto" ? "Copilot auto" : id,
    isDefault: id === "auto" || (index === 0 && !ids.has("auto")),
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
  }));
}

async function discoverCopilotModels(executable: string, cwd: string): Promise<AgentModelOption[]> {
  const result = await runProcess([executable, "help"], cwd, [0], { timeoutMs: 5_000 });
  return parseCopilotModelList(`${result.stdout}\n${result.stderr}`);
}

export async function discoverAgentAdapters(cwd: string): Promise<AgentAdapterOption[]> {
  const adapters: AgentAdapterOption[] = [];
  const codex = Bun.which("codex");
  const claude = Bun.which("claude");
  const gemini = Bun.which("gemini");
  const copilot = Bun.which("copilot");

  if (codex) {
    let models: AgentModelOption[] = [];
    let note: string | undefined;
    try {
      models = await discoverCodexModels(codex, cwd);
    } catch (error) {
      note = `Model discovery failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (models.length === 0) {
      models = [{ id: "default", label: "Codex CLI default", isDefault: true, reasoningEfforts: [] }];
      note ??= "The installed Codex CLI did not return a model catalog; its configured default will be used.";
    }
    adapters.push({ id: "codex", label: "Codex", models, modelDiscovery: "catalog", note });
  }

  if (claude) {
    const version = await executableVersion(claude, cwd);
    adapters.push({
      id: "claude",
      label: "Claude Code",
      modelDiscovery: "default-only",
      models: [{
        id: "default",
        label: "Claude CLI default",
        isDefault: true,
        reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
      }],
      note: `${version ? `${version}. ` : ""}Claude Code does not expose a model-list command, so the CLI's authenticated default is used.`,
    });
  }

  if (gemini) {
    const version = await executableVersion(gemini, cwd);
    adapters.push({
      id: "gemini",
      label: "Gemini CLI",
      modelDiscovery: "aliases",
      models: [
        { id: "auto", label: "Gemini auto", isDefault: true, reasoningEfforts: [] },
        { id: "pro", label: "Gemini Pro routing", isDefault: false, reasoningEfforts: [] },
        { id: "flash", label: "Gemini Flash routing", isDefault: false, reasoningEfforts: [] },
        { id: "flash-lite", label: "Gemini Flash-Lite routing", isDefault: false, reasoningEfforts: [] },
      ],
      note: `${version ? `${version}. ` : ""}Gemini CLI exposes routing aliases rather than an authenticated headless model catalog; account availability is checked by the CLI.`,
    });
  }

  if (copilot) {
    const version = await executableVersion(copilot, cwd);
    let models: AgentModelOption[] = [];
    let note: string | undefined;
    try {
      models = await discoverCopilotModels(copilot, cwd);
    } catch (error) {
      note = `Model discovery failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (models.length === 0) {
      models = [{ id: "auto", label: "Copilot auto", isDefault: true, reasoningEfforts: ["low", "medium", "high", "xhigh", "max"] }];
      note ??= "The installed Copilot CLI did not expose its model catalog; automatic model selection will be used.";
    }
    adapters.push({
      id: "copilot",
      label: "GitHub Copilot CLI",
      modelDiscovery: models.length > 1 ? "catalog" : "default-only",
      models,
      note: `${version ? `${version}. ` : ""}${note ?? "Models were detected from the installed CLI."}`,
    });
  }

  return adapters;
}
