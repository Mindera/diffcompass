import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AttachedAgentBridge } from "../src/bridge.ts";
import { createRequestHandler } from "../src/server.ts";
import { ReviewSession } from "../src/session.ts";
import { resolveSymbolPeek } from "../src/symbol-peek.ts";
import type { GitComparison } from "../src/types.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function comparison(root: string, repositoryFiles: string[]): GitComparison {
  return {
    repositoryRoot: root,
    repositoryName: "symbols",
    base: "main",
    mergeBase: "base",
    head: "head",
    patch: "",
    repositoryFiles,
    files: [],
  };
}

test("symbol peek returns definitions and usages from a bounded repository search", async () => {
  const root = await mkdtemp(join(import.meta.dir, "symbol-peek-"));
  roots.push(root);
  await writeFile(join(root, "src.ts"), "export function resolveReview() { return true; }\nresolveReview();\n");
  await writeFile(join(root, "consumer.ts"), "import { resolveReview } from './src';\nconst result = resolveReview();\n");

  const result = await resolveSymbolPeek(comparison(root, ["src.ts", "consumer.ts"]), {
    symbol: "resolveReview",
    path: "src.ts",
    line: 1,
    side: "new",
  });

  expect(result.source).toBe("repository-search");
  expect(result.sourceLabel).toBe("Repository search");
  expect(result.definitions).toMatchObject([{ path: "src.ts", line: 1, kind: "definition" }]);
  expect(result.usages).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: "src.ts", line: 2, kind: "usage" }),
    expect.objectContaining({ path: "consumer.ts", line: 1, kind: "usage" }),
  ]));
  expect(result.notice).toContain("bounded repository search");
});

test("symbol peek rejects traversal and only displays regular repository files", async () => {
  const root = await mkdtemp(join(import.meta.dir, "symbol-peek-"));
  roots.push(root);
  await writeFile(join(root, "safe.ts"), "const safe = true;\n");
  await symlink("/etc/hosts", join(root, "linked.ts"));
  const reviewed = comparison(root, ["safe.ts", "linked.ts"]);

  await expect(resolveSymbolPeek(reviewed, { symbol: "safe", path: "../etc/hosts", line: 1 })).rejects.toThrow("repository file");
  const result = await resolveSymbolPeek(reviewed, { symbol: "safe", path: "linked.ts", line: 1 });
  expect([...result.definitions, ...result.usages].every((location) => location.path !== "linked.ts")).toBe(true);
});

test("symbol peek keeps the fallback result bounded", async () => {
  const root = await mkdtemp(join(import.meta.dir, "symbol-peek-"));
  roots.push(root);
  const files = Array.from({ length: 205 }, (_, index) => `file-${String(index).padStart(3, "0")}.ts`);
  await Promise.all(files.map((path, index) => writeFile(join(root, path), index === 204 ? "function lastSymbol() {}\n" : "const other = 1;\n")));

  const result = await resolveSymbolPeek(comparison(root, files), { symbol: "lastSymbol" });
  expect(result.source).toBe("repository-search");
  expect(result.truncated).toBe(true);
  expect(result.definitions).toHaveLength(0);
});

test("symbol peek offers bounded explicit partial-identifier suggestions after a miss", async () => {
  const root = await mkdtemp(join(import.meta.dir, "symbol-peek-"));
  roots.push(root);
  await writeFile(join(root, "cart.ts"), [
    "export function subtotal() { return 1; }",
    "const subtotalForMember = subtotal();",
    "const subtotalForGuest = subtotal();",
    "const subtotalForInvoice = subtotal();",
    "const subtotalForReceipt = subtotal();",
    "const subtotalForPreview = subtotal();",
    "const subtotalForExport = subtotal();",
  ].join("\n"));

  const result = await resolveSymbolPeek(comparison(root, ["cart.ts"]), { symbol: "ubtota", path: "cart.ts", line: 1 });

  expect(result.definitions).toHaveLength(0);
  expect(result.usages).toHaveLength(0);
  expect(result.suggestions).toEqual(expect.arrayContaining([expect.objectContaining({ symbol: "subtotal", path: "cart.ts", line: 1 })]));
  expect(result.suggestions).toHaveLength(5);
  expect(result.notice).toContain("Related identifiers");
});

test("symbol peek is authenticated and bounded at the review API boundary", async () => {
  const root = await mkdtemp(join(import.meta.dir, "symbol-peek-"));
  roots.push(root);
  await writeFile(join(root, "app.ts"), "export function inspectSymbol() {}\ninspectSymbol();\n");
  const reviewed = comparison(root, ["app.ts"]);
  type Constructor = new (comparison: GitComparison, adapters: [], defaults: Record<string, never>, bridge: AttachedAgentBridge) => ReviewSession;
  const session = new (ReviewSession as unknown as Constructor)(reviewed, [], {}, new AttachedAgentBridge("bridge-token"));
  const fetch = createRequestHandler(session, join(root, "sessions"));
  const body = { symbol: "inspectSymbol", path: "app.ts", line: 1, side: "new" };
  const unauthorized = await fetch(new Request("http://127.0.0.1/api/symbol-peek", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://127.0.0.1" },
    body: JSON.stringify(body),
  }));
  expect(unauthorized.status).toBe(401);

  const response = await fetch(new Request("http://127.0.0.1/api/symbol-peek", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://127.0.0.1", "x-diffcompass-token": session.browserToken },
    body: JSON.stringify(body),
  }));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ symbol: "inspectSymbol", source: "repository-search", sourceLabel: "Repository search" });

  const malformed = await fetch(new Request("http://127.0.0.1/api/symbol-peek", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://127.0.0.1", "x-diffcompass-token": session.browserToken },
    body: JSON.stringify({ ...body, command: "cat /etc/hosts" }),
  }));
  expect(malformed.status).toBe(422);
});
