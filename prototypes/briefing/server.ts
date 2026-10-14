import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { approaches, buildReadingCases } from "./content.ts";
import { highlightGroups, type HighlightGroup } from "../../src/highlight.ts";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const cases = await buildReadingCases(repository);
const unique = new Map<string, HighlightGroup>();
for (const item of cases) for (const document of Object.values(item.documents)) for (const source of document.evidence.filter(e => e.available)) {
  const lines = source.quote.split("\n"), key = JSON.stringify([source.path, lines]);
  if (!unique.has(key)) unique.set(key, { id: String(unique.size), path: source.path, lines });
}
const tokens = await highlightGroups([...unique.values()], "diffcompass");
const highlighted = Object.fromEntries([...unique].map(([key, group]) => [key, tokens.find(t => t.id === group.id)!.lines]));
const payload = JSON.stringify({ approaches, cases, highlighted });
const publicFile = (name: string) => resolve(repository, "public", name);
const localFile = (name: string) => fileURLToPath(new URL(name, import.meta.url));
const assets: Record<string, { type: string; body: string }> = {
  "/": { type: "text/html", body: await Bun.file(localFile("index.html")).text() },
  "/lab.js": { type: "text/javascript", body: await Bun.file(localFile("lab.js")).text() },
  "/lab.css": { type: "text/css", body: await Bun.file(localFile("lab.css")).text() },
  "/reader.js": { type: "text/javascript", body: await Bun.file(publicFile("briefing.js")).text() },
  "/diagram-labels.js": { type: "text/javascript", body: await Bun.file(publicFile("diagram-labels.js")).text() },
  "/mermaid.js": { type: "text/javascript", body: await Bun.file(resolve(repository, "node_modules/mermaid/dist/mermaid.min.js")).text() },
  "/styles.css": { type: "text/css", body: (await Promise.all(["styles.css", "map-nodes.css", "briefing.css"].map(name => Bun.file(publicFile(name)).text()))).join("\n") },
  "/cases.json": { type: "application/json", body: payload },
};
const portIndex = process.argv.indexOf("--port");
const port = portIndex === -1 ? 47561 : Number(process.argv[portIndex + 1]);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("--port needs an integer from 0 to 65535.");
const server = Bun.serve({
  hostname: "127.0.0.1", port,
  fetch(request) {
    const url = new URL(request.url);
    if (request.headers.get("host") !== url.host || !["127.0.0.1", "localhost"].includes(url.hostname)) return new Response("Invalid host", { status: 403 });
    if (request.method !== "GET") return new Response("This reading prototype is read-only.", { status: 405 });
    const asset = assets[url.pathname];
    if (!asset) return new Response("Not found", { status: 404 });
    return new Response(asset.body, { headers: {
      "content-type": `${asset.type}; charset=utf-8`, "cache-control": "no-store", "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    } });
  },
});
console.log(`Briefing experiments: http://127.0.0.1:${server.port}/#case=publication&approach=outcome`);
console.log("Two pinned historical changes; four reading approaches. No agent or GitHub calls.");
