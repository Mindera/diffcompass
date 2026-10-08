import {expect, test} from "bun:test";
import {mkdtemp} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {ArchifyRenderer} from "../../src/archify.ts";
import {prepareTestFixture} from "../../src/test-fixture.ts";
import {loadPersistedSession, savePersistedSession} from "../../src/store.ts";
import {loadComparison} from "../../src/git.ts";
import {validateReviewAdaptiveDiagram} from "../../src/adaptive-diagrams.ts";
import {integrationSources} from "./integration-contract.ts";
import {installStateMachineExample, stateMachineFile, stateMachineDiagram} from "./state-machine-fixture.ts";

test("every state-machine arrow matches executable fixture code, including retries and terminal states", async () => {
  const js = new Bun.Transpiler({loader:"ts"}).transformSync(stateMachineFile.after);
  const {initialState, transitions, transition} = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
  const expected = {
    Pending: {start:"Formatting", cancel:"Cancelled"},
    Formatting: {succeed:"Ready", fail:"Failed", cancel:"Cancelled"},
    Failed: {retry:"Formatting", cancel:"Cancelled"},
    Ready: {}, Cancelled: {},
  };
  expect(initialState).toBe("Pending");
  expect(transitions).toEqual(expected);
  for (const [state, events] of Object.entries(expected)) {
    for (const event of ["start", "succeed", "fail", "retry", "cancel"]) {
      expect(transition(state,event)).toBe((events as Record<string,string>)[event] ?? state);
    }
  }
  const arrows = stateMachineDiagram.mermaid.split("\n").slice(1).map(line=>line.trim());
  expect(arrows).toEqual([
    "[*] --> Pending",
    ...Object.entries(expected).flatMap(([state,events])=>Object.entries(events).map(([event,to])=>`${state} --> ${to} : ${event}`)),
    "Ready --> [*]", "Cancelled --> [*]",
  ]);
  expect(validateReviewAdaptiveDiagram(stateMachineDiagram)).toEqual(stateMachineDiagram);
});

test("full fixture saves a native state machine backed by captured changed code without stale lifecycle artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(),"dc-state-fixture-test-"));
  const fixture = await prepareTestFixture({root:join(root,"fixture"),extraFiles:{[stateMachineFile.path]:stateMachineFile}});
  const saved = await loadPersistedSession(fixture.stateFile);
  const originalSteps = saved.outline!.phases.flatMap(phase=>phase.steps);
  // Simulate both a successful old conversion and an old failure diagnostic.
  const keep = saved.outline!.archifyArtifacts?.filter(a=>a.id!=="lifecycle-state-machine") ?? [];
  saved.outline!.archifyFailures = [{id:"lifecycle-state-machine",type:"lifecycle",message:"Old receipt lifecycle failure",preservedLastValid:false}];
  await installStateMachineExample(saved.outline!, null);
  expect(saved.outline!.stateDiagram).toEqual(stateMachineDiagram);
  expect(saved.outline!.archifyArtifacts ?? []).toEqual(keep);
  expect(saved.outline!.archifyFailures).toEqual([]);
  expect(saved.outline!.phases.flatMap(phase=>phase.steps)).toEqual(originalSteps);
  expect(saved.outline!.phases.flatMap(phase=>phase.fileChanges).some(file=>file.path===stateMachineFile.path)).toBe(true);
  await savePersistedSession(fixture.stateFile,saved);
  expect((await loadPersistedSession(fixture.stateFile)).outline!.stateDiagram).toEqual(stateMachineDiagram);
  const comparison = await loadComparison(fixture.repository,saved.base);
  expect(comparison.files.find(file=>file.path===stateMachineFile.path)?.status).toBe("modified");
  expect((await integrationSources(comparison)).find(file=>file.path===stateMachineFile.path)).toMatchObject({old:stateMachineFile.before,new:stateMachineFile.after});
});


const rendererDirectory = process.env.ARCHIFY_OFFICIAL_DIR ?? process.env.DIFFCOMPASS_ARCHIFY_DIR;
test.skipIf(!rendererDirectory)("fixture installs the matching validated branching lifecycle and retains its native source", async () => {
  const root = await mkdtemp(join(tmpdir(),"dc-state-render-test-"));
  const fixture = await prepareTestFixture({root:join(root,"fixture"),extraFiles:{[stateMachineFile.path]:stateMachineFile}});
  const saved = await loadPersistedSession(fixture.stateFile);
  const outline = saved.outline!;
  const unrelated = outline.archifyArtifacts?.filter(a=>a.id!=="lifecycle-state-machine") ?? [];
  await installStateMachineExample(outline, new ArchifyRenderer(rendererDirectory!));
  expect(outline.archifyFailures?.filter(a=>a.id==="lifecycle-state-machine")).toEqual([]);
  expect(outline.archifyArtifacts?.filter(a=>a.id!=="lifecycle-state-machine")).toEqual(unrelated);
  const artifact = outline.archifyArtifacts!.find(a=>a.id==="lifecycle-state-machine")!;
  expect(artifact.title).toBe(stateMachineDiagram.title);
  expect(artifact.ir.states).toHaveLength(5);
  expect(artifact.ir.transitions).toHaveLength(7);
  expect(artifact.evidence).toEqual(stateMachineDiagram.evidence);
  expect(artifact.affectedFiles).toEqual([stateMachineFile.path]);
  expect(outline.stateDiagram).toEqual(stateMachineDiagram);
  await savePersistedSession(fixture.stateFile,saved);
  const reloaded = (await loadPersistedSession(fixture.stateFile)).outline!;
  expect(reloaded.archifyArtifacts!.find(a=>a.id===artifact.id)).toEqual(artifact);
  expect(reloaded.stateDiagram).toEqual(stateMachineDiagram);
  // A genuine failure must not revive either the old linear artifact or a
  // stale conversion from a previous fixture installation.
  await installStateMachineExample(outline, new ArchifyRenderer(join(root,"missing-renderer")));
  expect(outline.archifyArtifacts).toEqual(unrelated);
  expect(outline.archifyFailures).toEqual([expect.objectContaining({id:"lifecycle-state-machine",preservedLastValid:false})]);
  expect(outline.stateDiagram).toEqual(stateMachineDiagram);
}, 30_000);
