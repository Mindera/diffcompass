import { lstat } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isAbsolute, join, relative, resolve } from "node:path";
import { loadRepositoryFile } from "./git.ts";
import { ReviewError } from "./errors.ts";
import { runProcess } from "./process.ts";
import type { GitComparison } from "./types.ts";

const MAX_SYMBOL_LENGTH = 200;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_SEARCH_FILES = 200;
const MAX_SEARCH_BYTES = 2 * 1024 * 1024;
const MAX_RESULTS = 50;
const MAX_SUGGESTIONS = 5;
const MAX_SUGGESTION_IDENTIFIERS = 10_000;
const MAX_CODEGRAPH_OUTPUT = 512 * 1024;
const MAX_EXCERPT_LINES = 7;
const MAX_LINE_LENGTH = 500;

export type SymbolPeekSource = "codegraph" | "language-server" | "repository-search";

export interface SymbolPeekLocation {
  path: string;
  line: number;
  endLine: number;
  kind: "definition" | "usage";
  excerpt: string[];
}

export interface SymbolPeekSuggestion {
  symbol: string;
  path: string;
  line: number;
}

export interface SymbolPeekRequest {
  symbol: string;
  path?: string;
  line?: number;
  side?: "old" | "new";
}

export interface SymbolPeekResult {
  symbol: string;
  source: SymbolPeekSource;
  sourceLabel: string;
  definitions: SymbolPeekLocation[];
  usages: SymbolPeekLocation[];
  raw?: string;
  notice: string;
  truncated: boolean;
  suggestions?: SymbolPeekSuggestion[];
  suggestionsTruncated?: boolean;
}

interface LspLocation {
  uri?: string;
  targetUri?: string;
  range?: { start?: { line?: number; character?: number }; end?: { line?: number; character?: number } };
  targetRange?: { start?: { line?: number; character?: number }; end?: { line?: number; character?: number } };
}

interface SearchMatch {
  path: string;
  line: number;
  content: string;
}

function normalizeSymbol(value: string): string {
  const trimmed = value.trim().slice(0, MAX_SYMBOL_LENGTH);
  const identifiers = trimmed.match(/[\p{L}\p{N}_$]+/gu) ?? [];
  const symbol = identifiers.at(-1) ?? trimmed;
  if (!symbol || symbol.length > MAX_SYMBOL_LENGTH || !/^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(symbol)) {
    throw new ReviewError("Choose a single symbol name made of letters, numbers, _, or $.");
  }
  return symbol;
}

function ensureRequest(comparison: GitComparison, request: SymbolPeekRequest): SymbolPeekRequest & { symbol: string } {
  const symbol = normalizeSymbol(request.symbol);
  if (request.path !== undefined && !comparison.repositoryFiles.includes(request.path) && !comparison.files.some((file) => file.path === request.path)) {
    throw new ReviewError("Symbol peek must reference a repository file.");
  }
  if (request.line !== undefined && (!Number.isSafeInteger(request.line) || request.line <= 0)) {
    throw new ReviewError("Symbol peek line must be a positive integer.");
  }
  return { ...request, symbol };
}

function excerpt(content: string, line: number): string[] {
  const lines = content.split(/\r?\n/);
  const start = Math.max(0, line - 1 - Math.floor(MAX_EXCERPT_LINES / 2));
  return lines.slice(start, start + MAX_EXCERPT_LINES).map((value) => value.length > MAX_LINE_LENGTH ? `${value.slice(0, MAX_LINE_LENGTH - 1)}…` : value);
}

function isDefinition(line: string, symbol: string): boolean {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:function|class|interface|enum|type|struct|trait|def|fn|func|sub|module|object|const|let|var|val|fun|property|${escaped}\\s*[:=])\\s*(?:[\\w$<>[\\]., ]+\\s+)?${escaped}\\b|${escaped}\\s*[:=]`).test(line)
    || new RegExp(`\\b${escaped}\\s*\\(`).test(line) && /(?:function|def|fn|func|fun|method|override|public|private|protected|async|export)/i.test(line);
}

async function searchRepositoryAsync(comparison: GitComparison, symbol: string): Promise<{ matches: SearchMatch[]; truncated: boolean }> {
  const pattern = new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
  let bytes = 0;
  let files = 0;
  let truncated = false;
  const matches: SearchMatch[] = [];
  for (const path of comparison.repositoryFiles) {
    if (files >= MAX_SEARCH_FILES || bytes >= MAX_SEARCH_BYTES || matches.length >= MAX_RESULTS) {
      truncated = true;
      break;
    }
    files += 1;
    let content: string;
    try {
      content = await loadRepositoryFile(comparison, path, MAX_FILE_BYTES);
    } catch {
      continue;
    }
    bytes += new TextEncoder().encode(content).byteLength;
    if (bytes > MAX_SEARCH_BYTES) {
      truncated = true;
      break;
    }
    for (const [index, line] of content.split(/\r?\n/).entries()) {
      if (matches.length >= MAX_RESULTS) break;
      pattern.lastIndex = 0;
      if (pattern.test(line)) matches.push({ path, line: index + 1, content: line });
    }
  }
  return { matches, truncated };
}

function compareSuggestions(left: SymbolPeekSuggestion, right: SymbolPeekSuggestion, request: SymbolPeekRequest & { symbol: string }): number {
  const needle = request.symbol.toLowerCase();
  const score = (candidate: SymbolPeekSuggestion) => [
    candidate.path === request.path ? 0 : 1,
    candidate.symbol.toLowerCase().startsWith(needle) ? 0 : 1,
    candidate.symbol.length - request.symbol.length,
    request.line === undefined ? 0 : Math.abs(candidate.line - request.line),
  ];
  const leftScore = score(left);
  const rightScore = score(right);
  for (let index = 0; index < leftScore.length; index += 1) {
    if (leftScore[index] !== rightScore[index]) return leftScore[index]! - rightScore[index]!;
  }
  return left.symbol.localeCompare(right.symbol) || left.path.localeCompare(right.path) || left.line - right.line;
}

async function partialSymbolSuggestions(comparison: GitComparison, request: SymbolPeekRequest & { symbol: string }): Promise<{ suggestions: SymbolPeekSuggestion[]; truncated: boolean }> {
  const needle = request.symbol.toLowerCase();
  if (needle.length < 2) return { suggestions: [], truncated: false };
  const suggestions = new Map<string, SymbolPeekSuggestion>();
  let bytes = 0;
  let files = 0;
  let identifiers = 0;
  let truncated = false;
  scan: for (const path of comparison.repositoryFiles) {
    if (files >= MAX_SEARCH_FILES || bytes >= MAX_SEARCH_BYTES) {
      truncated = true;
      break;
    }
    files += 1;
    let content: string;
    try {
      content = await loadRepositoryFile(comparison, path, MAX_FILE_BYTES);
    } catch {
      continue;
    }
    bytes += new TextEncoder().encode(content).byteLength;
    if (bytes > MAX_SEARCH_BYTES) {
      truncated = true;
      break;
    }
    for (const [lineIndex, line] of content.split(/\r?\n/).entries()) {
      for (const match of line.matchAll(/[\p{L}_$][\p{L}\p{N}_$]*/gu)) {
        if (identifiers >= MAX_SUGGESTION_IDENTIFIERS) {
          truncated = true;
          break scan;
        }
        identifiers += 1;
        const symbol = match[0]!;
        if (symbol.length > MAX_SYMBOL_LENGTH || symbol.toLowerCase() === needle || !symbol.toLowerCase().includes(needle)) continue;
        const candidate = { symbol, path, line: lineIndex + 1 };
        const existing = suggestions.get(symbol);
        if (!existing || compareSuggestions(candidate, existing, request) < 0) suggestions.set(symbol, candidate);
      }
    }
  }
  return { suggestions: [...suggestions.values()].sort((left, right) => compareSuggestions(left, right, request)).slice(0, MAX_SUGGESTIONS), truncated };
}

async function materializeLocations(comparison: GitComparison, locations: Array<{ path: string; line: number; kind: "definition" | "usage" }>): Promise<SymbolPeekLocation[]> {
  const contentByPath = new Map<string, string>();
  const result: SymbolPeekLocation[] = [];
  for (const location of locations.slice(0, MAX_RESULTS)) {
    let content = contentByPath.get(location.path);
    if (content === undefined) {
      try {
        content = await loadRepositoryFile(comparison, location.path, MAX_FILE_BYTES);
      } catch {
        continue;
      }
      contentByPath.set(location.path, content);
    }
    result.push({ ...location, endLine: location.line, excerpt: excerpt(content, location.line) });
  }
  return result;
}

function sourceResult(symbol: string, source: SymbolPeekSource, definitions: SymbolPeekLocation[], usages: SymbolPeekLocation[], notice: string, truncated = false, raw?: string): SymbolPeekResult {
  return {
    symbol,
    source,
    sourceLabel: source === "codegraph" ? "CodeGraph" : source === "language-server" ? "Language server" : "Repository search",
    definitions,
    usages,
    ...(raw ? { raw } : {}),
    notice,
    truncated,
  };
}

async function hasCodeGraphIndex(root: string): Promise<boolean> {
  try {
    return (await lstat(join(root, ".codegraph"))).isDirectory();
  } catch {
    return false;
  }
}

function parseCodeGraphLocations(comparison: GitComparison, output: string): Array<{ path: string; line: number; kind: "definition" | "usage" }> {
  const paths = new Set(comparison.repositoryFiles);
  const locations: Array<{ path: string; line: number; kind: "definition" | "usage" }> = [];
  const pattern = /(?:^|[\s`(])((?:\.\/)?[^\s`():]+):(\d+)(?::\d+)?/g;
  for (const match of output.matchAll(pattern)) {
    const path = match[1]!.replace(/^\.\//, "");
    const line = Number(match[2]);
    if (!paths.has(path) || !Number.isSafeInteger(line) || line <= 0) continue;
    const context = output.slice(Math.max(0, (match.index ?? 0) - 100), Math.min(output.length, (match.index ?? 0) + 160));
    const kind = /definition|declaration|defined|symbol:/i.test(context) || locations.length === 0 ? "definition" : "usage";
    if (!locations.some((candidate) => candidate.path === path && candidate.line === line)) locations.push({ path, line, kind });
    if (locations.length >= MAX_RESULTS) break;
  }
  return locations.map((location) => ({ ...location, kind: location.kind === "definition" ? "definition" : "usage" }));
}

async function codeGraphResult(comparison: GitComparison, request: SymbolPeekRequest & { symbol: string }): Promise<SymbolPeekResult | undefined> {
  if (!(await hasCodeGraphIndex(comparison.repositoryRoot)) || !Bun.which("codegraph")) return undefined;
  const query = [request.symbol, request.path ? `at ${request.path}` : undefined, request.line ? `line ${request.line}` : undefined].filter(Boolean).join(" ");
  try {
    const result = await runProcess(["codegraph", "explore", query], comparison.repositoryRoot, [0], { timeoutMs: 3_000 });
    const raw = result.stdout.slice(0, MAX_CODEGRAPH_OUTPUT);
    const locations = parseCodeGraphLocations(comparison, raw);
    const materialized = await materializeLocations(comparison, locations);
    return sourceResult(request.symbol, "codegraph", materialized.filter((location) => location.kind === "definition"), materialized.filter((location) => location.kind === "usage"), materialized.length ? "Resolved by the repository's CodeGraph index." : "CodeGraph is available, but returned no file locations for this symbol.", result.stdout.length > MAX_CODEGRAPH_OUTPUT, raw);
  } catch {
    return undefined;
  }
}

function languageServerForPath(path?: string): { command: string; args: string[] } | undefined {
  const extension = path?.split(".").at(-1)?.toLowerCase();
  const candidates = extension === "ts" || extension === "tsx" || extension === "js" || extension === "jsx" || extension === "mjs" || extension === "cjs"
    ? [{ command: "typescript-language-server", args: ["--stdio"] }]
    : extension === "py" ? [{ command: "pylsp", args: [] }]
      : extension === "rs" ? [{ command: "rust-analyzer", args: [] }]
        : extension === "go" ? [{ command: "gopls", args: ["serve"] }]
          : extension === "swift" ? [{ command: "sourcekit-lsp", args: [] }]
            : extension === "java" ? [{ command: "jdtls", args: [] }] : [];
  return candidates.find((candidate) => Bun.which(candidate.command));
}

function locationPath(root: string, repositoryFiles: Set<string>, uri: string): string | undefined {
  try {
    const path = fileURLToPath(uri);
    const relativePath = relative(resolve(root), resolve(path));
    if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath) || !repositoryFiles.has(relativePath)) return undefined;
    return relativePath;
  } catch {
    return undefined;
  }
}

async function runLanguageServer(comparison: GitComparison, request: SymbolPeekRequest & { symbol: string }, server: { command: string; args: string[] }): Promise<{ locations: Array<{ path: string; line: number; kind: "definition" | "usage" }>; truncated: boolean } | undefined> {
  if (!request.path) return undefined;
  const content = await loadRepositoryFile(comparison, request.path, MAX_FILE_BYTES);
  const lines = content.split(/\r?\n/);
  const line = Math.min(lines.length, request.line ?? 1);
  const character = Math.max(0, lines[line - 1]?.indexOf(request.symbol) ?? 0);
  const rootUri = pathToFileURL(comparison.repositoryRoot).toString();
  const documentUri = pathToFileURL(resolve(comparison.repositoryRoot, request.path)).toString();
  const child = Bun.spawn([server.command, ...server.args], { cwd: comparison.repositoryRoot, stdin: "pipe", stdout: "pipe", stderr: "ignore" });
  const stdin = child.stdin;
  const stdout = child.stdout;
  if (!stdin || !stdout) {
    child.kill();
    return undefined;
  }
  let buffer = "";
  const decoder = new TextDecoder();
  const reader = stdout.getReader();
  const readMessage = async (): Promise<Record<string, unknown>> => {
    const deadline = Date.now() + 2_500;
    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd >= 0) {
        const headers = buffer.slice(0, headerEnd);
        const match = /Content-Length:\s*(\d+)/i.exec(headers);
        if (!match) throw new Error("Invalid language-server response header.");
        const length = Number(match[1]);
        const start = headerEnd + 4;
        if (buffer.length >= start + length) {
          const payload = buffer.slice(start, start + length);
          buffer = buffer.slice(start + length);
          return JSON.parse(payload) as Record<string, unknown>;
        }
      }
      const remaining = Math.max(1, deadline - Date.now());
      const value = await Promise.race([reader.read(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Language server timed out.")), remaining))]);
      if (value.done) throw new Error("Language server exited before replying.");
      buffer += decoder.decode(value.value, { stream: true });
      if (buffer.length > MAX_CODEGRAPH_OUTPUT) throw new Error("Language server response is too large.");
    }
  };
  const send = (message: Record<string, unknown>) => {
    const payload = JSON.stringify(message);
    stdin.write(`Content-Length: ${new TextEncoder().encode(payload).byteLength}\r\n\r\n${payload}`);
  };
  const response = async (id: number): Promise<Record<string, unknown>> => {
    while (true) {
      const message = await readMessage();
      if (message.id === id) return message;
    }
  };
  try {
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { processId: process.pid, rootUri, workspaceFolders: [{ uri: rootUri, name: comparison.repositoryName }], capabilities: {} } });
    await response(1);
    send({ jsonrpc: "2.0", method: "initialized", params: {} });
    send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri: documentUri, languageId: request.path.split(".").at(-1) ?? "text", version: 1, text: content } } });
    send({ jsonrpc: "2.0", id: 2, method: "textDocument/definition", params: { textDocument: { uri: documentUri }, position: { line: line - 1, character } } });
    const definitionResponse = await response(2);
    send({ jsonrpc: "2.0", id: 3, method: "textDocument/references", params: { textDocument: { uri: documentUri }, position: { line: line - 1, character }, context: { includeDeclaration: false } } });
    const referencesResponse = await response(3);
    const repositoryFiles = new Set(comparison.repositoryFiles);
    const locations: Array<{ path: string; line: number; kind: "definition" | "usage" }> = [];
    const append = (value: unknown, kind: "definition" | "usage") => {
      const values = Array.isArray(value) ? value : value ? [value] : [];
      for (const candidate of values) {
        if (!candidate || typeof candidate !== "object") continue;
        const location = candidate as LspLocation;
        const path = locationPath(comparison.repositoryRoot, repositoryFiles, location.targetUri ?? location.uri ?? "");
        const range = location.targetRange ?? location.range;
        const targetLine = Number(range?.start?.line);
        if (!path || !Number.isSafeInteger(targetLine) || targetLine < 0) continue;
        if (!locations.some((existing) => existing.path === path && existing.line === targetLine + 1 && existing.kind === kind)) locations.push({ path, line: targetLine + 1, kind });
        if (locations.length >= MAX_RESULTS) break;
      }
    };
    append(definitionResponse.result, "definition");
    append(referencesResponse.result, "usage");
    return { locations, truncated: locations.length >= MAX_RESULTS };
  } catch {
    return undefined;
  } finally {
    try { stdin.end(); } catch { /* language servers may already have exited */ }
    try { child.kill(); } catch { /* language servers may already have exited */ }
  }
}

async function languageServerResult(comparison: GitComparison, request: SymbolPeekRequest & { symbol: string }): Promise<SymbolPeekResult | undefined> {
  const server = languageServerForPath(request.path);
  if (!server) return undefined;
  let result: Awaited<ReturnType<typeof runLanguageServer>>;
  try {
    result = await runLanguageServer(comparison, request, server);
  } catch {
    return undefined;
  }
  if (!result) return undefined;
  const materialized = await materializeLocations(comparison, result.locations);
  return sourceResult(request.symbol, "language-server", materialized.filter((location) => location.kind === "definition"), materialized.filter((location) => location.kind === "usage"), materialized.length ? `Resolved by ${server.command}.` : `${server.command} returned no locations for this symbol.`, result.truncated);
}

async function withPartialSymbolSuggestions(comparison: GitComparison, request: SymbolPeekRequest & { symbol: string }, result: SymbolPeekResult): Promise<SymbolPeekResult> {
  if (result.definitions.length || result.usages.length) return result;
  const suggestions = await partialSymbolSuggestions(comparison, request);
  if (suggestions.suggestions.length === 0 && !suggestions.truncated) return result;
  return {
    ...result,
    suggestions: suggestions.suggestions,
    ...(suggestions.truncated ? { suggestionsTruncated: true } : {}),
    notice: suggestions.suggestions.length
      ? `${result.notice} Related identifiers below come from a bounded repository search.`
      : result.notice,
  };
}

export async function resolveSymbolPeek(comparison: GitComparison, input: SymbolPeekRequest): Promise<SymbolPeekResult> {
  const request = ensureRequest(comparison, input);
  const codeGraph = await codeGraphResult(comparison, request);
  if (codeGraph) return withPartialSymbolSuggestions(comparison, request, codeGraph);
  const languageServer = await languageServerResult(comparison, request);
  if (languageServer) return withPartialSymbolSuggestions(comparison, request, languageServer);
  const search = await searchRepositoryAsync(comparison, request.symbol);
  const definitions: SymbolPeekLocation[] = [];
  const usages: SymbolPeekLocation[] = [];
  const matches = await materializeLocations(comparison, search.matches.map((match) => ({ ...match, kind: isDefinition(match.content, request.symbol) ? "definition" as const : "usage" as const })));
  for (const match of matches) (match.kind === "definition" ? definitions : usages).push(match);
  const notice = matches.length
    ? "CodeGraph and a language server were unavailable; results come from a bounded repository search."
    : "No definition or usage was found. CodeGraph and a language server were unavailable, and repository search was bounded.";
  return withPartialSymbolSuggestions(comparison, request, sourceResult(request.symbol, "repository-search", definitions, usages, notice, search.truncated));
}
