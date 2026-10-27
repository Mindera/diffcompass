import { captureBriefingDiagrams, briefingDiagramHtml, BRIEFING_DIAGRAM_CSP } from "../../src/briefing-diagrams.ts";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { buildReadingCases } from "./content.ts";
import { highlightGroups, type HighlightGroup } from "../../src/highlight.ts";
import { monacoAsset } from "../../src/monaco-assets.ts";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const casesIndex = process.argv.indexOf("--cases");
if (casesIndex !== -1 && !process.argv[casesIndex + 1]) throw new Error("--cases needs a local TypeScript module path.");
const defaultCases = resolve(repository, "prototypes/briefing/local/cases.ts");
const casesPath = casesIndex !== -1 ? resolve(process.argv[casesIndex + 1]!)
  : !process.argv.includes("--builtin") && existsSync(defaultCases) ? defaultCases : undefined;
const builder = casesPath ? (await import(pathToFileURL(casesPath).href)).buildReadingCases : buildReadingCases;
const captured = await builder(repository) as Awaited<ReturnType<typeof buildReadingCases>>;
const cases = captured.map(({ documents, scenarios, ...item }) => ({ ...item, document: documents.outcome }));
if (!cases.length || cases.some(item => !item.repositoryName)) throw new Error("Reading cases need repository names and at least one example.");
const unique = new Map<string, HighlightGroup>();
for (const item of cases) for (const source of item.document.evidence.filter(e => e.available)) {
  const lines = source.kind === "code" && source.diff?.available ? source.diff.rows.map(r => r.content) : source.quote.split("\n"), key = JSON.stringify([source.path, lines]);
  if (!unique.has(key)) unique.set(key, { id: String(unique.size), path: source.path, lines });
}
const tokens = await highlightGroups([...unique.values()], "diffcompass");
const highlighted = Object.fromEntries([...unique].map(([key, group]) => [key, tokens.find(t => t.id === group.id)!.lines]));
const diagramPages = new Map<string, string>();
const capturedDocuments = new Set<string>();
for (const { document } of cases) {
  if (capturedDocuments.has(document.id)) continue;
  capturedDocuments.add(document.id);
  await captureBriefingDiagrams(document);
  for (const diagram of document.diagrams) {
    const html = briefingDiagramHtml(diagram);
    if (html) diagramPages.set(`/briefing-diagram/${document.id}/${diagram.id}`, html);
    delete diagram.archifyHtml;
  }
}
const payload = JSON.stringify({ cases, highlighted });
const publicFile = (name: string) => resolve(repository, "public", name);
const localFile = (name: string) => fileURLToPath(new URL(name, import.meta.url));
const assets: Record<string, { type: string; body: string }> = {
  "/": { type: "text/html", body: await Bun.file(localFile("index.html")).text() },
  "/lab.js": { type: "text/javascript", body: await Bun.file(localFile("lab.js")).text() },
  "/panes.js": { type: "text/javascript", body: await Bun.file(localFile("panes.js")).text() },
  "/lab.css": { type: "text/css", body: await Bun.file(localFile("lab.css")).text() },
  "/map-presentation.js": { type: "text/javascript", body: await Bun.file(publicFile("map-presentation.js")).text() },
  "/reader.js": { type: "text/javascript", body: (await Promise.all(["call-tree.js", "briefing.js"].map(name => Bun.file(publicFile(name)).text()))).join("\n") },
  "/diagram-labels.js": { type: "text/javascript", body: await Bun.file(publicFile("diagram-labels.js")).text() },
  "/mermaid.js": { type: "text/javascript", body: await Bun.file(resolve(repository, "node_modules/mermaid/dist/mermaid.min.js")).text() },
  "/styles.css": { type: "text/css", body: (await Promise.all(["styles.css", "call-tree.css", "map-nodes.css", "briefing.css"].map(name => Bun.file(publicFile(name)).text()))).join("\n") },
  "/cases.json": { type: "application/json", body: payload },
};
const portIndex = process.argv.indexOf("--port");
const port = portIndex === -1 ? 47561 : Number(process.argv[portIndex + 1]);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("--port needs an integer from 0 to 65535.");
const server = Bun.serve({
  hostname: "127.0.0.1", port,
  async fetch(request) {
    const url = new URL(request.url);
    if (request.headers.get("host") !== url.host || !["127.0.0.1", "localhost"].includes(url.hostname)) return new Response("Invalid host", { status: 403 });
    if (["GET", "HEAD"].includes(request.method) && url.pathname.startsWith("/briefing-diagram/")) {
      const html = diagramPages.get(decodeURI(url.pathname));
      return new Response(request.method === "HEAD" ? null : html ?? "Saved diagram viewer unavailable.", { status: html ? 200 : 404, headers: {
        "content-type": "text/html; charset=utf-8", "content-security-policy": BRIEFING_DIAGRAM_CSP + "; frame-ancestors 'self'", "cache-control": "no-store",
      } });
    }
    if (request.method !== "GET") return new Response("This reading prototype is read-only.", { status: 405 });
    const monaco = await monacoAsset(url.pathname);
    if (monaco) return new Response(monaco.body, { headers: {
      "content-type": monaco.type, "cache-control": "no-store", "x-content-type-options": "nosniff",
      "content-security-policy": `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; worker-src 'self' blob:; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors ${monaco.frame ? "'self'" : "'none'"}`,
    } });
    const asset = assets[url.pathname];
    if (!asset) return new Response("Not found", { status: 404 });
    return new Response(asset.body, { headers: {
      "content-type": `${asset.type}; charset=utf-8`, "cache-control": "no-store", "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    } });
  },
});
console.log(`Briefing preview: http://127.0.0.1:${server.port}/#case=${cases[0]!.id}`);
console.log(`${cases.length} pinned historical changes; outcome-first reading view. No agent or GitHub calls.`);
