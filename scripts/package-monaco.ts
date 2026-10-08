// Release-time only: the installed application never downloads editor assets.
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { deletedSourceAsset, withDeletedSourceBridge, deletedSourceHash } from "../public/monaco/deleted-source-bridge.mjs";
const target = process.argv[2];
if (!target) throw Error("Usage: bun scripts/package-monaco.ts <new directory>");
const source = resolve(import.meta.dir, "../node_modules/monaco-editor");
const pkg = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
if (pkg.version !== "0.55.1") throw Error("Revalidate the Monaco compatibility adapter before upgrading.");
withDeletedSourceBridge(await readFile(join(source, "min", deletedSourceAsset), "utf8"));
await mkdir(resolve(target));
for (const name of ["min", "LICENSE", "ThirdPartyNotices.txt"]) await cp(join(source, name), join(target, name), { recursive: true });
await writeFile(join(target, "BUNDLE.json"), JSON.stringify({ version: pkg.version, deletedSourceHash, adapter: "DiffCompass version-guarded deleted-source DOM mapping and shared helper lifetimes; applied in memory" }, null, 2) + "\n");
console.log("Packaged local Monaco " + pkg.version);
