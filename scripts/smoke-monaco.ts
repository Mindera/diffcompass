// Run with BUN_BE_BUN=1 using the installed executable.
import { strict as assert } from "node:assert";
import { monacoAsset, monacoVendorDirectory } from "../src/monaco-assets.ts";
import { deletedSourceAsset } from "../public/monaco/deleted-source-bridge.mjs";
assert(!(await monacoVendorDirectory()).includes("node_modules"), "Installed smoke must use packaged assets, not this checkout's development dependency");
for (const path of ["/monaco/index.html", "/monaco/bootstrap.mjs", "/monaco/app.mjs", "/monaco-controller.mjs", "/vendor/vs/loader.js", "/vendor/vs/assets/editor.worker-Be8ye1pW.js", "/vendor/vs/assets/ts.worker-CMbG-7ft.js", "/vendor/" + deletedSourceAsset]) {
  const asset = await monacoAsset(path);
  assert(asset, "Installed Monaco asset is missing: " + path);
  const source = await new Response(asset.body).text();
  assert(source.length > 100, "Installed Monaco asset is empty: " + path);
  if (path.endsWith(deletedSourceAsset)) assert(source.includes("diffCompassDeletedSource"), "The pinned deleted-source compatibility adapter was not applied");
}
console.log("Installed Monaco: local editor, workers and pinned compatibility adapter passed.");
