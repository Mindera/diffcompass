import {test,expect} from "bun:test";
import {mkdtemp,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {runProcess} from "../../src/process.ts";
import {loadComparison,loadComparisonBetweenTrees} from "../../src/git.ts";
import {integrationRequestAllowed as allowed,integrationLanguage,integrationSources} from "./integration-contract.ts";
import {prepareTestFixture} from "../../src/test-fixture.ts";
import {loadPersistedSession} from "../../src/store.ts";
import {contextFixtureFile} from "./fixtures.mjs";
test("late Monaco readiness preserves an already chosen review view",async()=>{
  const host=await Bun.file(new URL("./integration-host.js",import.meta.url)).text();
  const start=host.indexOf("ready(view) {")+"ready(view) {".length;
  const body=host.slice(start,host.indexOf("\n    },",start));
  for(const activeTab of ["diff","archify","sequence","adaptive","structural-blast-radius","findings"]) {
    let focused=0,synced=0;
    const ready=new Function("state","currentStep","focusCurrentStep","sync",`let child; return function(view) {${body}}`)(
      {activeTab,tourMode:true},()=>({id:"stop"}),()=>focused++,()=>synced++,
    );
    ready({});expect(synced).toBe(1);expect(focused).toBe(activeTab==="diff"?1:0);
  }
});
test("full integration context example is a real two-change captured file",async()=>{
  const parent=await mkdtemp(join(tmpdir(),"dc-context-fixture-test-"));
  const fixture=await prepareTestFixture({root:join(parent,"fixture"),extraFiles:{[contextFixtureFile.path]:contextFixtureFile}});
  const saved=await loadPersistedSession(fixture.stateFile);
  const comparison=await loadComparison(fixture.repository,saved.base);
  const file=comparison.files.find(file=>file.path===contextFixtureFile.path)!;
  expect(file.status).toBe("modified");
  expect(file.hunks).toHaveLength(2);
  expect((await integrationSources(comparison)).find(file=>file.path===contextFixtureFile.path)).toMatchObject({old:contextFixtureFile.before,new:contextFixtureFile.after});
  expect(contextFixtureFile.before.split("\n").length).toBeGreaterThan(150);
});
test("fixture extension cannot escape its repo or overwrite baseline files",async()=>{
  const parent=await mkdtemp(join(tmpdir(),"dc-context-fixture-safety-"));
  for(const path of ["../outside.ts","/outside.ts","src/../outside.ts","src\\outside.ts",".git/config",".GIT/config","src//bad.ts","src/./bad.ts","src/cart.ts"]) {
    await expect(prepareTestFixture({root:join(parent,"fixture"),extraFiles:{[path]:{before:"a",after:"b"}}})).rejects.toThrow("extra fixture path");
  }
});
test("integration retains local review routes but blocks external and source mutations",()=>{
  for(const [method,path] of [["GET","/api/session"],["GET","/api/files"],["POST","/api/tour/navigate"],["POST","/api/export"],["POST","/api/comments"],["PATCH","/api/comments/abc"],["POST","/api/agent/message"]])expect(allowed(method!,path!)).toBe(true);
  for(const [method,path] of [["POST","/api/github/review"],["GET","/api/github/refresh"],["POST","/api/update"],["POST","/api/edits"],["POST","/api/refresh"],["POST","/api/comparison/view"],["DELETE","/api/sessions/all"],["POST","/api/tour/start"],["POST","/api/dry-runs/prepare"]])expect(allowed(method!,path!)).toBe(false);
});
test("all text files use Monaco languages while media remains a specialized preview",()=>{
  expect(integrationLanguage("src/cart.ts")).toBe("typescript");
  expect(integrationLanguage("src/State.kt")).toBe("kotlin");
  expect(integrationLanguage("README.md")).toBe("markdown");
  expect(integrationLanguage("docs/GUIDE.MD")).toBe("markdown");
  expect(integrationLanguage("LICENSE")).toBe("plaintext");
  expect(integrationLanguage("custom.unknown")).toBe("plaintext");
  expect(integrationLanguage("screens/receipt.png")).toBeNull();
});
test("every captured text file in the full fixture has a Monaco source pair",async()=>{
  const parent=await mkdtemp(join(tmpdir(),"dc-all-text-fixture-"));
  const fixture=await prepareTestFixture({root:join(parent,"fixture")});
  const saved=await loadPersistedSession(fixture.stateFile);
  const comparison=await loadComparison(fixture.repository,saved.base);
  const sources=await integrationSources(comparison);
  expect(sources.map(file=>file.path).sort()).toEqual(comparison.files.filter(file=>!file.path.endsWith(".png")).map(file=>file.path).sort());
  expect(sources.filter(file=>file.language==="markdown").map(file=>file.path).sort()).toEqual(["README.md","docs/checkout-guide.md","docs/preview.md"]);
});
test("full fixture reads both captured trees, not subsequently changed working files",async()=>{
  const root=await mkdtemp(join(tmpdir(),"dc-monaco-capture-test-"));
  const git=async(...args:string[])=>(await runProcess(["git",...args],root)).stdout.trim();
  await git("init","--initial-branch=fixture");
  await git("config","user.name","Fixture");await git("config","user.email","fixture@example.invalid");
  await writeFile(join(root,"cart.ts"),"export const total = 1;\n");
  await writeFile(join(root,"removed.ts"),"export const legacy = 1;\n");
  await git("add",".");await git("-c","core.hooksPath=/dev/null","commit","-m","Before");
  const before=await git("rev-parse","HEAD");
  await writeFile(join(root,"cart.ts"),"export const total = 2;\n");
  await writeFile(join(root,"new.kt"),"val total = 2\n");
  await writeFile(join(root,"README.md"),"# Native preview\n");
  await writeFile(join(root,"LICENSE"),"Captured plain text\n");
  await writeFile(join(root,"binary.bin"),new Uint8Array([0,255,0,1]));
  await git("rm","--","removed.ts");await git("add",".");
  const after=await git("write-tree");
  const comparison=await loadComparisonBetweenTrees(root,{base:before,mergeBase:before,sourceTree:after});
  await writeFile(join(root,"cart.ts"),"WORKSPACE MUST NOT APPEAR\n");
  const files=await integrationSources(comparison);
  expect(files.map(file=>file.path)).toEqual(["LICENSE","README.md","cart.ts","new.kt","removed.ts"]);
  expect(files.find(file=>file.path==="LICENSE")).toMatchObject({old:"",new:"Captured plain text\n",language:"plaintext"});
  expect(files.find(file=>file.path==="README.md")).toMatchObject({old:"",new:"# Native preview\n",language:"markdown"});
  expect(files.find(file=>file.path==="cart.ts")).toMatchObject({old:"export const total = 1;\n",new:"export const total = 2;\n"});
  expect(files.find(file=>file.path==="new.kt")).toMatchObject({old:"",new:"val total = 2\n",language:"kotlin"});
  expect(files.find(file=>file.path==="removed.ts")).toMatchObject({old:"export const legacy = 1;\n",new:""});
  await expect(integrationSources({...comparison,sourceTree:undefined})).rejects.toThrow("Captured comparison trees");
  await expect(integrationSources({...comparison,sourceTree:"HEAD"})).rejects.toThrow("Captured comparison trees");
});
