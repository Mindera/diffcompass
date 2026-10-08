import {expect, spyOn, test} from "bun:test";
import {mkdtemp} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {prepareTestFixture} from "../src/test-fixture.ts";
import {ReviewSession} from "../src/session.ts";
import {ArchifyRenderer} from "../src/archify.ts";
import {loadPersistedSession} from "../src/store.ts";
import {createRequestHandler} from "../src/server.ts";

const app = await Bun.file(new URL("../public/app.js",import.meta.url)).text();
const html = await Bun.file(new URL("../public/index.html",import.meta.url)).text();
function declaration(name:string) {
  const start=app.indexOf(`function ${name}(`);
  if(start<0)throw Error(`Missing ${name}`);
  return app.slice(start,app.indexOf("\n}",start)+2);
}
test("sequence Retry is hidden for healthy/empty views and visible only for actual failures",()=>{
  const state:any={session:{outline:{}},busy:false,retryingSequences:false};
  let nativeFailures:any[]=[],open=true;
  const button:any={};
  const elements={"regenerate-flows":button,flows:{querySelectorAll:()=>nativeFailures}};
  const sync=new Function("state","elements","reviewIsOpen",["sequenceDiagramsFailed","syncSequenceRetryButton"].map(declaration).join("\n")+";return syncSequenceRetryButton;")(state,elements,()=>open);
  sync();expect(button.hidden).toBe(true);
  state.session.outline.archifyFailures=[{type:"lifecycle"}];sync();expect(button.hidden).toBe(true);
  state.session.outline.archifyFailures=[{type:"sequence"}];sync();expect(button.hidden).toBe(false);expect(button.disabled).toBe(false);expect(button.textContent).toBe("Retry");
  state.busy=true;state.retryingSequences=true;sync();expect(button.disabled).toBe(true);expect(button.textContent).toBe("Retrying…");
  state.busy=false;state.retryingSequences=false;open=false;sync();expect(button.disabled).toBe(true);
  open=true;state.session.outline.archifyFailures=[];nativeFailures=[{}];sync();expect(button.hidden).toBe(false);
  nativeFailures=[];sync();expect(button.hidden).toBe(true);
  state.session=null;sync();expect(button.hidden).toBe(true);expect(button.disabled).toBe(true);
  expect(html).toMatch(/id="regenerate-flows"[^>]*hidden[^>]*>Retry<\/button>/);
  expect(app).not.toContain('data-flow-action="regenerate"');
  expect(app).toContain('"/api/diagrams/retry"');
});

test("late native-render failures cannot resurrect Retry after a newer render",()=>{
  const state={flowRenderGeneration:2};let touched=0;
  const show=new Function("state","syncSequenceRetryButton",declaration("showSequenceRenderFailure")+";return showSequenceRenderFailure;")(state,()=>touched++);
  const card={isConnected:true,querySelector:()=>{touched++;return null;}};
  show(card,1);expect(touched).toBe(0);
  show({...card,isConnected:false},2);expect(touched).toBe(0);
  show(card,2);expect(touched).toBeGreaterThan(0);
});

async function fixture() {
  const root=await mkdtemp(join(tmpdir(),"dc-diagram-retry-"));
  const prepared=await prepareTestFixture({root:join(root,"fixture")});
  const session=await ReviewSession.create(prepared.repository,undefined,{resume:true,stateFile:prepared.stateFile,agentAdapters:[],attached:true,diffPreferenceDirectory:join(root,"preferences")});
  session.outline!.archifyFailures=[
    {id:"sequence-checkout-flow",type:"sequence",message:"Render failed",preservedLastValid:false},
    {id:"dataflow-data-model",type:"dataflow",message:"Other failure",preservedLastValid:false},
  ];
  return {session,prepared};
}

test("renderer filtering retries only the selected saved sequence",async()=>{
  const {session}=await fixture();
  const renderer=new ArchifyRenderer("/nonexistent-diffcompass-retry-renderer");
  const result=await renderer.render(session.outline!,[],new Set(["sequence-checkout-flow"]));
  expect(result.failures.map(f=>f.id)).toEqual(["sequence-checkout-flow"]);
  expect((await renderer.render(session.outline!,[],new Set())).failures).toEqual([]);
});

test("failed render retry persists diagnostics; successful retry clears only that failure without agent generation",async()=>{
  const {session,prepared}=await fixture();
  const before=structuredClone(session.outline!);
  let attempts=0;
  const render=async(outline:any,previous:any=[],ids:Set<string>)=>{
    expect(ids).toEqual(new Set(["sequence-checkout-flow"]));
    expect(outline.flows).toEqual(before.flows);
    attempts++;
    return {artifacts:previous.filter((a:any)=>ids.has(a.id)),failures:attempts===1?[{...before.archifyFailures![0]!,message:"Still unavailable"}]:[]};
  };
  const mock=spyOn(ArchifyRenderer,"fromEnvironment").mockReturnValue({render} as unknown as ArchifyRenderer);
  try {
    await session.retrySequenceDiagrams();
    expect(session.outline!.archifyFailures?.map(f=>f.message)).toContain("Still unavailable");
    await session.retrySequenceDiagrams();
    expect(session.outline!.archifyFailures).toEqual([before.archifyFailures![1]!]);
    expect(session.outline!.flows).toEqual(before.flows);
    expect(session.outline!.phases).toEqual(before.phases);
    expect((await loadPersistedSession(prepared.stateFile)).outline!.archifyFailures).toEqual([before.archifyFailures![1]!]);
    await session.retrySequenceDiagrams();expect(attempts).toBe(2);
  } finally {mock.mockRestore();}
});

test("renderer exceptions leave retry available and preserve the saved outline",async()=>{
  const {session}=await fixture(),before=structuredClone(session.outline);
  const mock=spyOn(ArchifyRenderer,"fromEnvironment").mockReturnValue({render:async()=>{throw Error("Renderer unavailable");}} as unknown as ArchifyRenderer);
  try {
    await expect(session.retrySequenceDiagrams()).rejects.toThrow("Renderer unavailable");
    expect(session.outline).toEqual(before);
  } finally {mock.mockRestore();}
});

test("diagram retry endpoint is authenticated, sequence-only, and rejects closed reviews",async()=>{
  const {session}=await fixture(),handler=createRequestHandler(session);
  const request=(body:unknown,authorized=true)=>handler(new Request("http://127.0.0.1:47672/api/diagrams/retry",{
    method:"POST",headers:{host:"127.0.0.1:47672",origin:"http://127.0.0.1:47672","content-type":"application/json",...(authorized?{"x-diffcompass-token":session.browserToken}:{})},body:JSON.stringify(body),
  }));
  expect((await request({type:"sequence"},false)).status).toBe(401);
  expect((await request({type:"all"})).status).toBe(422);
  expect((await request({type:"sequence",id:"invented"})).status).toBe(422);
  session.outline!.archifyFailures=[];
  expect((await request({type:"sequence"})).status).toBe(200);
  session.status="accepted";
  expect((await request({type:"sequence"})).status).not.toBe(200);
});
