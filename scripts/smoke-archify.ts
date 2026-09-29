// Run with BUN_BE_BUN=1 using the installed executable, not a system runtime.
import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArchifyRenderer } from "../src/archify.ts";
import { prepareTestFixture } from "../src/test-fixture.ts";
import branchedMaps from "../tests/fixtures/branched-maps.json";
import type { TourOutline } from "../src/types.ts";

delete process.env.DIFFCOMPASS_ARCHIFY_DIR;
const renderer = ArchifyRenderer.fromEnvironment();
assert(renderer, "Installed executable must discover its bundled renderer without an override");
const root = await mkdtemp(join(tmpdir(), "diffcompass-installed-maps-"));
try {
  const fixture = await prepareTestFixture({ root: join(root, "fixture") });
  const saved = JSON.parse(await readFile(fixture.stateFile, "utf8"));
  // No host Node, Bun, npm, checkout, or network is needed for map generation.
  process.env.PATH = join(root, "no-system-executables");
  const result = await renderer.render(saved.outline);
  assert.deepEqual(result.failures, []);
  assert.deepEqual([...new Set(result.artifacts.map((item) => item.type))].sort(), ["architecture", "dataflow", "lifecycle", "sequence", "workflow"]);
  assert(result.artifacts.some((item) => item.comparison?.before && item.comparison?.delta), "Before/Delta/After must render");
  assert(result.artifacts.every((item) => item.html.includes("<html")));
  const branched = await renderer.render(branchedMaps as unknown as TourOutline);
  assert.deepEqual(branched.failures, []);
  assert.equal(branched.artifacts.length, 5);
  assert(branched.artifacts.filter((map) => map.type === "architecture").every((map) => map.view === "before-delta-after"));
  const directory = ArchifyRenderer.bundledDirectory()!;
  assert((await readFile(join(directory, "LICENSE"), "utf8")).includes("Permission is hereby granted"));
  assert((await readFile(join(directory, "assets/JetBrainsMono-OFL.txt"), "utf8")).includes("SIL OPEN FONT LICENSE"));
  assert((await readFile(join(directory, "renderers/shared/generated-brand-marks.mjs"), "utf8")).includes("Object.freeze([])"));
  console.log(`Installed renderer: ${result.artifacts.length} maps passed, including all five types and Before/Delta/After, without host runtimes.`);
} finally {
  await rm(root, { recursive: true, force: true });
}
