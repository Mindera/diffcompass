import { realpath } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { monacoThemes } from "./monaco-themes";
// @ts-expect-error The compatibility adapter is shared with browser regression tests.
import { deletedSourceAsset, withDeletedSourceBridge } from "../public/monaco/deleted-source-bridge.mjs";
// @ts-expect-error Bun embeds this browser asset as text.
import asset0 from "../public/monaco/app.mjs" with { type: "text" };
// @ts-expect-error Bun embeds this browser asset as text.
import asset1 from "../public/monaco/annotations.mjs" with { type: "text" };
// @ts-expect-error Bun embeds this browser asset as text.
import asset2 from "../public/monaco/deleted-selection.mjs" with { type: "text" };
// @ts-expect-error Bun embeds this browser asset as text.
import asset3 from "../public/monaco/deleted-annotations.mjs" with { type: "text" };
// @ts-expect-error Bun embeds this browser asset as text.
import asset4 from "../public/monaco/source-anchor.mjs" with { type: "text" };
// @ts-expect-error Bun embeds this browser asset as text.
import asset5 from "../public/monaco/styles.css" with { type: "text" };
// @ts-expect-error Bun embeds this browser asset as text.
import asset6 from "../public/monaco/integration-embed.css" with { type: "text" };
import asset7 from "../public/monaco/index.html" with { type: "text" };
// @ts-expect-error Bun embeds this browser asset as text.
import bootstrap from "../public/monaco/bootstrap.mjs" with { type: "text" };
// @ts-expect-error Bun embeds this browser asset as text.
import penScroll from "../public/monaco/pen-scroll.mjs" with { type: "text" };
// @ts-expect-error Bun embeds this browser asset as text.
import mobileActions from "../public/monaco/mobile-actions.mjs" with { type: "text" };
// @ts-expect-error Bun embeds this browser asset as text.
import controller from "../public/monaco-controller.mjs" with { type: "text" };
// @ts-expect-error Bun embeds this browser asset as text.
import themes from "../public/monaco/themes.mjs" with { type: "text" };
const files: Record<string, { body: string; type: string }> = {
  "/monaco/themes.mjs": { body: String(themes), type: "text/javascript; charset=utf-8" },
  "/monaco/bootstrap.mjs": { body: String(bootstrap), type: "text/javascript; charset=utf-8" },
  "/monaco/pen-scroll.mjs": { body: String(penScroll), type: "text/javascript; charset=utf-8" },
  "/monaco/mobile-actions.mjs": { body: String(mobileActions), type: "text/javascript; charset=utf-8" },
  "/monaco-controller.mjs": { body: String(controller), type: "text/javascript; charset=utf-8" },
  "/monaco/app.mjs": { body: String(asset0), type: "text/javascript; charset=utf-8" },
  "/monaco/annotations.mjs": { body: String(asset1), type: "text/javascript; charset=utf-8" },
  "/monaco/deleted-selection.mjs": { body: String(asset2), type: "text/javascript; charset=utf-8" },
  "/monaco/deleted-annotations.mjs": { body: String(asset3), type: "text/javascript; charset=utf-8" },
  "/monaco/source-anchor.mjs": { body: String(asset4), type: "text/javascript; charset=utf-8" },
  "/monaco/styles.css": { body: String(asset5), type: "text/css; charset=utf-8" },
  "/monaco/integration-embed.css": { body: String(asset6), type: "text/css; charset=utf-8" },
  "/monaco/index.html": { body: String(asset7), type: "text/html; charset=utf-8" },
};

let vendorRoot: Promise<string> | undefined;
async function root() {
  return vendorRoot ??= (async () => {
    const executable = await realpath(process.execPath);
    for (const candidate of [
      resolve(dirname(executable), "../share/diffcompass/monaco/min"),
      resolve(import.meta.dir, "../node_modules/monaco-editor/min"),
    ]) {
      if (await Bun.file(join(candidate, "vs/loader.js")).exists()) return realpath(candidate);
    }
    throw Error("Local Monaco assets are unavailable. Reinstall DiffCompass or use the current renderer.");
  })();
}
export const monacoVendorDirectory = root;
let bridge: Promise<string> | undefined;
let themeData: Promise<string> | undefined;

export async function monacoAsset(path: string): Promise<{ body: BodyInit; type: string; frame?: boolean } | null> {
  if (path === "/monaco/theme-data.mjs") {
    themeData ??= monacoThemes().then(themes => `export const syntaxThemes = ${JSON.stringify(themes)};`);
    return { body: await themeData, type: "text/javascript; charset=utf-8" };
  }
  const embedded = files[path];
  if (embedded) return { ...embedded, frame: path === "/monaco/index.html" };
  if (!path.startsWith("/vendor/vs/")) return null;
  const relative = path.slice("/vendor/".length);
  if (!/^[a-zA-Z0-9_@./-]+\.(js|css|ttf)$/.test(relative) || relative.split("/").includes("..")) return null;
  const directory = await root();
  const requested = await realpath(join(directory, relative)).catch(() => null);
  if (!requested || !requested.startsWith(directory + sep)) return null;
  const type = relative.endsWith(".js") ? "text/javascript" : relative.endsWith(".css") ? "text/css" : "font/ttf";
  if (relative === deletedSourceAsset) {
    bridge ??= Bun.file(requested).text().then(withDeletedSourceBridge);
    return { body: await bridge, type };
  }
  return { body: Bun.file(requested), type };
}
