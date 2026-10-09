// Run with BUN_BE_BUN=1 using the installed executable, not a system runtime.
import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArchifyRenderer } from "../src/archify.ts";
import { prepareTestFixture } from "../src/test-fixture.ts";
import branchedMaps from "../tests/fixtures/branched-maps.json";
import lifecycleBoundaries from "../tests/fixtures/lifecycle-boundaries.json";
import type { TourOutline } from "../src/types.ts";

delete process.env.DIFFCOMPASS_ARCHIFY_DIR;
const renderer = ArchifyRenderer.fromEnvironment();
assert(renderer, "Installed executable must discover its bundled renderer without an override");
const root = await mkdtemp(join(tmpdir(), "diffcompass-installed-maps-"));
try {
  const fixture = await prepareTestFixture({ root: join(root, "fixture") });
  const saved = JSON.parse(await readFile(fixture.stateFile, "utf8"));
  const callFlows = structuredClone(saved.outline.callFlows);
  assert(callFlows.length > 0, "Fixture must retain native Call flows");
  // No host Node, Bun, npm, checkout, or network is needed for map generation.
  process.env.PATH = join(root, "no-system-executables");
  const result = await renderer.render(saved.outline);
  assert.deepEqual(result.failures, []);
  // Call flows stay in their native viewer; do not duplicate them as workflows.
  assert.deepEqual([...new Set(result.artifacts.map((item) => item.type))].sort(), ["architecture", "dataflow", "lifecycle", "sequence"]);
  assert.deepEqual(saved.outline.callFlows, callFlows, "Rendering maps must preserve native Call flows");
  assert(result.artifacts.some((item) => item.comparison?.before && item.comparison?.delta), "Before/Delta/After must render");
  assert(result.artifacts.every((item) => item.html.includes("<html")));
  const branched = await renderer.render(branchedMaps as unknown as TourOutline);
  assert.deepEqual(branched.failures, []);
  assert.equal(branched.artifacts.length, 5);
  assert(branched.artifacts.filter((map) => map.type === "architecture").every((map) => map.view === "before-delta-after"));
  // Exercise labelled initial/final transitions with the bundled renderer
  // on every package check, including CI where optional renderer tests skip.
  for (const example of lifecycleBoundaries) {
    const input = { ...saved.outline, stateDiagram: { ...saved.outline.stateDiagram, mermaid: `stateDiagram-v2\n${example.body}` } };
    const lifecycle = await renderer.render(input, [], new Set(["lifecycle-state-machine"]));
    assert.deepEqual(lifecycle.failures, [], example.name);
    assert.equal(lifecycle.artifacts.length, 1, example.name);
    const artifact = lifecycle.artifacts[0]!;
    const states = artifact.ir.states as Array<{ id: string; label: string; sublabel?: string }>;
    const name = (id: string) => {
      const state = states.find(state => state.id === id)!;
      return state.sublabel?.endsWith(" boundary") ? "[*]" : state.label;
    };
    const edges = artifact.ir.transitions as Array<{ from: string; to: string; label?: string }>;
    assert.deepEqual(edges.map(edge => `${name(edge.from)} --> ${name(edge.to)}${edge.label ? ` : ${edge.label}` : ""}`), example.body.split("\n"), example.name);
  }
  const directory = ArchifyRenderer.bundledDirectory()!;
  assert((await readFile(join(directory, "LICENSE"), "utf8")).includes("Permission is hereby granted"));
  assert((await readFile(join(directory, "assets/JetBrainsMono-OFL.txt"), "utf8")).includes("SIL OPEN FONT LICENSE"));
  assert((await readFile(join(directory, "renderers/shared/generated-brand-marks.mjs"), "utf8")).includes("Object.freeze([])"));
  console.log(`Installed renderer: ${result.artifacts.length} maps passed, including all four generated types and Before/Delta/After, with native Call flows preserved and without host runtimes.`);
  console.log(`Installed renderer: ${lifecycleBoundaries.length} lifecycle boundary regressions passed with every arrow and event label preserved.`);
} finally {
  await rm(root, { recursive: true, force: true });
}
