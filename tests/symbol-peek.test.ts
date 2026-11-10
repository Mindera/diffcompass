import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AttachedAgentBridge } from "../src/bridge.ts";
import { createRequestHandler } from "../src/server.ts";
import { ReviewSession } from "../src/session.ts";
import { resolveSymbolPeek } from "../src/symbol-peek.ts";
import type { GitComparison } from "../src/types.ts";

const roots: string[] = [];
const originalPath = process.env.PATH;

afterEach(async () => {
  process.env.PATH = originalPath;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function kotlinServer(command = "kotlin-lsp", reject = false) {
  const root = await mkdtemp(join(import.meta.dir, "symbol-peek-")); roots.push(root);
  const bin = join(root, "bin"); await mkdir(bin);
  // Exercise the actual stdio transport, including byte-framed Unicode and a
  // server request whose numeric ID collides with our initialize request.
  await writeFile(join(bin, command), `#!${process.execPath}
const reject = ${reject};
const output = message => {
  const body = JSON.stringify(message);
  process.stdout.write('Content-Length: ' + Buffer.byteLength(body) + '\\r\\n\\r\\n' + body);
};
let buffer = Buffer.alloc(0), document;
process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const end = buffer.indexOf('\\r\\n\\r\\n'); if (end < 0) return;
    const length = Number(/Content-Length: (\\d+)/i.exec(buffer.subarray(0, end).toString())[1]);
    if (buffer.length < end + 4 + length) return;
    const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length)); buffer = buffer.subarray(end + 4 + length);
    if (message.method === 'initialize') {
      output({jsonrpc:'2.0', method:'window/logMessage', params:{type:3,message:'Kotlin café 🚀'}});
      output({jsonrpc:'2.0', id:1, method:'workspace/configuration', params:{items:[{section:'kotlin'}]}});
    } else if (message.id === 1 && !message.method) {
      if (JSON.stringify(message.result) !== '[null]') process.exit(3);
      output({jsonrpc:'2.0', id:1, result:{capabilities:{definitionProvider:true,referencesProvider:true}}});
    } else if (message.method === 'textDocument/didOpen') {
      document = message.params.textDocument;
      if (document.languageId !== 'kotlin') process.exit(4);
    } else if (message.method === 'textDocument/definition' || message.method === 'textDocument/references') {
      if (reject) { output({jsonrpc:'2.0',id:message.id,error:{code:-32603,message:'Index unavailable'}}); continue; }
      if (message.params.position.line !== 1 || message.params.position.character !== 27) process.exit(5);
      const line = message.method.endsWith('definition') ? 0 : 2;
      output({jsonrpc:'2.0',id:message.id,result:[{uri:document.uri,range:{start:{line,character:0},end:{line,character:5}}}]});
    }
  }
});
`, { mode: 0o755 });
  await writeFile(join(root, "example.kt"), "val value = 1\nval sample = value + other.value\nprintln(other.value)\n");
  process.env.PATH = bin;
  return comparison(root, ["example.kt"]);
}

test("Kotlin reference lookup uses the selected occurrence and completes a Unicode LSP handshake", async () => {
  const reviewed = await kotlinServer();
  const result = await resolveSymbolPeek(reviewed, { symbol: "value", path: "example.kt", line: 2, column: 28 });
  expect(result.source).toBe("language-server");
  expect(result.definitions).toMatchObject([{ path: "example.kt", line: 1 }]);
  expect(result.usages).toMatchObject([{ path: "example.kt", line: 3 }]);
  expect(result.notice).toContain("kotlin-lsp");
});

test("Kotlin also supports kotlin-language-server and exposes protocol failures instead of claiming zero references", async () => {
  const reviewed = await kotlinServer("kotlin-language-server", true);
  const result = await resolveSymbolPeek(reviewed, { symbol: "value", path: "example.kt", line: 2, column: 28 });
  expect(result.source).toBe("repository-search");
  expect(result.notice).toContain("kotlin-language-server: Language server rejected");
  expect(result.usages.length + result.definitions.length).toBeGreaterThan(0);
});

test("ambiguous or moved source positions do not silently resolve a different occurrence", async () => {
  const reviewed = await kotlinServer();
  for (const column of [undefined, 2]) {
    const result = await resolveSymbolPeek(reviewed, { symbol: "value", path: "example.kt", line: 2, column });
    expect(result.source).toBe("repository-search");
    expect(result.notice).toContain("cannot be identified at this current-workspace position");
  }
  await expect(resolveSymbolPeek(reviewed, { symbol: "value", path: "example.kt", line: 2, column: 0 })).rejects.toThrow("column must be a positive integer");
});

test("Kotlin scripts use built-in syntax lookup when no language server is installed", async () => {
  const root = await mkdtemp(join(import.meta.dir, "symbol-peek-")); roots.push(root);
  await writeFile(join(root, "example.kts"), "val value = 1\nprintln(value)\n");
  process.env.PATH = root;
  const result = await resolveSymbolPeek(comparison(root, ["example.kts"]), { symbol: "value", path: "example.kts", line: 2, column: 9 });
  expect(result.source).toBe("kotlin-syntax");
  expect(result.definitions).toMatchObject([{ path: "example.kts", line: 1 }]);
  expect(result.usages).toMatchObject([{ path: "example.kts", line: 2 }]);
  expect(result.notice).toContain("Same-file syntax candidates");
  expect(result.notice).toContain("No kotlin language server was found on DiffCompass's PATH (kotlin-lsp or kotlin-language-server)");
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

test("bounded fallback searches the selected Kotlin file and related source before unrelated files", async () => {
  const root = await mkdtemp(join(import.meta.dir, "symbol-peek-")); roots.push(root);
  process.env.PATH = root;
  const unrelated = Array.from({ length: 205 }, (_, index) => `document-${index}.md`);
  await Promise.all(unrelated.map(path => writeFile(join(root, path), "Project notes\n")));
  const selected = "PeopleViewModel.kt";
  const sibling = "PeopleScreen.kt";
  const otherSource = "shared/PeopleState.kt";
  await mkdir(join(root, "shared"));
  await writeFile(join(root, selected), "internal val Searching = LoadStates()\nfun search() {\n  emit(PagingData.empty(sourceLoadStates = Searching))\n}\n");
  await writeFile(join(root, sibling), "fun screen() = Searching\n");
  await writeFile(join(root, otherSource), "fun state() = Searching\n");
  const result = await resolveSymbolPeek(comparison(root, [...unrelated, otherSource, sibling, selected]), {
    // A name entered without a source position still uses repository search.
    symbol: "Searching", path: selected,
  });
  expect(result.source).toBe("repository-search");
  expect(result.definitions).toMatchObject([{ path: selected, line: 1 }]);
  expect(result.usages).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: selected, line: 3 }),
    expect.objectContaining({ path: sibling, line: 1 }),
    expect.objectContaining({ path: otherSource, line: 1 }),
  ]));
  expect(result.truncated).toBe(true);

  const syntax = await resolveSymbolPeek(comparison(root, [...unrelated, otherSource, sibling, selected]), {
    symbol: "Searching", path: selected, line: 1, column: 14,
  });
  expect(syntax.source).toBe("kotlin-syntax");
  expect(syntax.definitions).toMatchObject([{ path: selected, line: 1 }]);
  expect(syntax.usages).toMatchObject([{ path: selected, line: 3 }]);
  expect(syntax.truncated).toBe(false);
});

test("partial-identifier suggestions also include the selected file beyond the scan limit", async () => {
  const root = await mkdtemp(join(import.meta.dir, "symbol-peek-")); roots.push(root);
  process.env.PATH = root;
  const files = Array.from({ length: 205 }, (_, index) => `file-${index}.kt`);
  await Promise.all(files.map(path => writeFile(join(root, path), "val other = 1\n")));
  const selected = "PeopleViewModel.kt";
  await writeFile(join(root, selected), "private val Searching = LoadStates()\n");
  const result = await resolveSymbolPeek(comparison(root, [...files, selected]), {
    symbol: "Search", path: selected, line: 1,
  });
  expect(result.suggestions).toContainEqual({ symbol: "Searching", path: selected, line: 1 });
  expect(result.suggestionsTruncated).toBe(true);
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
