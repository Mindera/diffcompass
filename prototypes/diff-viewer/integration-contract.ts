import type { GitComparison } from "../../src/types.ts";
import { runProcess } from "../../src/process.ts";

export function integrationRequestAllowed(method: string, path: string): boolean {
  if (!path.startsWith("/api/")) return true;
  if (method === "GET") return /^\/api\/(session|about|diff(?:\/search|\/image|\/markdown)?|files|sequence-sources\/[^/]+|screenshots\/[^/]+)$/.test(path);
  if (method === "POST") return /^\/api\/(diagrams\/retry|preferences|highlight|symbol-peek|files\/reviewed|comments|agent\/message|tour\/navigate|export)$/.test(path);
  return ["PATCH", "DELETE"].includes(method) && /^\/api\/comments\/[^/]+$/.test(path);
}
const languages: Record<string, string> = { ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", kt: "kotlin", kts: "kotlin", json: "json", css: "css", html: "html", md: "markdown", markdown: "markdown", txt: "plaintext" };
const mediaExtensions = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "ico", "bmp", "tif", "tiff", "pdf", "mp4", "mov", "mp3", "wav"]);
export function integrationLanguage(path: string): string | null {
  const extension = path.split(".").at(-1)?.toLowerCase() ?? "";
  // Unknown text formats still have a useful diff. Git's binary metadata and
  // the captured-source validation below remain the content safety boundary.
  return mediaExtensions.has(extension) ? null : languages[extension] ?? "plaintext";
}
export async function integrationSources(comparison: GitComparison) {
  // The harness forbids refresh, edits and comparison switching. Read immutable
  // captured trees only; never silently substitute current working files.
  const oldTree = comparison.mergeBase, newTree = comparison.sourceTree;
  if (!oldTree || !newTree || ![oldTree,newTree].every(tree=>/^[a-f0-9]{40,64}$/.test(tree))) throw Error("Captured comparison trees are required.");
  let total = 0;
  const files = [];
  for (const file of comparison.files) {
    const language = integrationLanguage(file.path);
    if (!language || file.metadata.some(line=>/^(Binary files |GIT binary patch)/.test(line))) continue;
    const texts: string[] = [];
    for (const [tree,path] of [[oldTree,file.oldPath],[newTree,file.newPath]]) {
      if (!path) { texts.push(""); continue; }
      const mode = await runProcess(["git","ls-tree",tree!,"--",path],comparison.repositoryRoot);
      if (!/^100(644|755) blob /.test(mode.stdout)) throw Error("Unsupported source mode: "+path);
      const result = await runProcess(["git","show",tree+":"+path],comparison.repositoryRoot);
      const size = Buffer.byteLength(result.stdout);
      total += size;
      if (size > 256_000 || total > 2_000_000 || result.stdout.includes("\0") || result.stdout.includes("\uFFFD")) throw Error("Fixture source exceeds safe text limits: "+path);
      texts.push(result.stdout);
    }
    files.push({path:file.path,language,old:texts[0]!,new:texts[1]!});
  }
  return files;
}
