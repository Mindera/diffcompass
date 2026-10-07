import {mkdtemp,realpath} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve,sep} from "node:path";
import {prepareTestFixture} from "../../src/test-fixture.ts";
import {loadPersistedSession,savePersistedSession} from "../../src/store.ts";
import {ReviewSession} from "../../src/session.ts";
import {createRequestHandler} from "../../src/server.ts";
import {deletedSourceAsset,withDeletedSourceBridge} from "./deleted-source-bridge.mjs";
import {integrationSources,integrationRequestAllowed} from "./integration-contract.ts";
import {contextFixtureFile} from "./fixtures.mjs";
import {installStateMachineExample,stateMachineFile} from "./state-machine-fixture.ts";

const container = await mkdtemp(join(tmpdir(),"diffcompass-monaco-full-"));
const fixture = await prepareTestFixture({root:join(container,"fixture"),extraFiles:{[contextFixtureFile.path]:contextFixtureFile,[stateMachineFile.path]:stateMachineFile}});
const saved = await loadPersistedSession(fixture.stateFile);
saved.name = "Monaco integration · synthetic full-product fixture";
saved.preferences = {...saved.preferences!,prefetchSteps:0,showBriefing:false};
saved.outline!.phases[0]!.fileChanges.push({path:contextFixtureFile.path,summary:"Two separated edits: use the gap arrows or Show all context, then Collapse unchanged."});
await installStateMachineExample(saved.outline!);
const explanations: Record<string,string> = {
  "apply-discount":"The optional discount is consumed as a fraction: 0.2 subtracts one fifth of the subtotal. The early return keeps the subtotal unchanged when no discount is supplied. The code does not validate the supplied range.",
  "format-receipt":"The new receipt function delegates arithmetic to total, then uses toFixed(2) to produce two decimal places. It returns a display string, not a numeric amount or a localized currency.",
  "document-fixture":"The README describes the review surfaces exercised by this synthetic fixture. All text files, including the Markdown guide, use Monaco. Preview renders Markdown within the same file card; the receipt image has a dedicated media view.",
};
for(const phase of saved.outline!.phases) for(const step of phase.steps) if(!step.explanation)step.explanation=explanations[step.id] ?? step.objective;
saved.selection = {...saved.selection!,adapterId:"attached",modelId:"Fixture responder (not AI)"};
saved.bridgeToken = crypto.randomUUID();
saved.bridgeSequence = 0;
if(saved.pullRequest) {
  saved.pullRequest.url="https://example.invalid/fixture/pull/42";
  // Linked-issue URLs are schema-validated. The host disables/rewrites their
  // rendered links; the server blocks all external GitHub operations.
  saved.pullRequest.threads=[{
    id:"monaco-integration-thread",path:"src/cart.ts",side:"new",line:17,resolved:false,
    comments:[{id:"monaco-integration-comment",author:"Alex (fixture)",body:"Could we document whether this percentage is fractional?",url:"https://example.invalid/comment/1"}],
  }];
}
await savePersistedSession(fixture.stateFile,saved);
const session = await ReviewSession.create(fixture.repository,undefined,{resume:true,stateFile:fixture.stateFile,attached:true,agentAdapters:[],callerModel:"Fixture responder (not AI)",diffPreferenceDirectory:join(container,"preferences")});
await session.startTour({adapterId:"attached",modelId:"Fixture responder (not AI)"});
await session.addComment({path:"src/cart.ts",side:"new",line:17,body:"Same-line fixture: this comment shares the discount calculation with a question and a finding."});
const files=await integrationSources(session.comparison);
let answering=false;
setInterval(async()=>{
  if(answering)return;answering=true;
  try{for(const event of await session.bridge!.eventsAfter(0,0,undefined,true))if(event.type==="agent.prompt")await session.bridge!.respond(event.id,"Fixture response — not AI. The existing review pipeline received your question and source anchor. No agent was invoked and no source was edited.",event.leaseId);}
  catch(error){console.error(error);}finally{answering=false;}
},200);
const handler=createRequestHandler(session,join(container,"sessions"));
let vendor=resolve(import.meta.dir,"node_modules/monaco-editor/min");
if(!await Bun.file(join(vendor,"vs/loader.js")).exists())vendor=resolve(import.meta.dir,"../../node_modules/monaco-editor/min");
vendor=await realpath(vendor);
const bundle=withDeletedSourceBridge(await Bun.file(join(vendor,deletedSourceAsset)).text());
const assetNames=["index.html","app.mjs","styles.css","fixtures.mjs","annotations.mjs","deleted-selection.mjs","deleted-annotations.mjs","source-anchor.mjs","integration-embed.css","integration-host.css"];
const assets=new Map(assetNames.map(name=>["/prototype/"+name,join(import.meta.dir,["app.mjs","styles.css","annotations.mjs","deleted-selection.mjs","deleted-annotations.mjs","source-anchor.mjs","integration-embed.css"].includes(name)?"../../public/monaco":".",name)]));
const authorized=(request:Request)=>request.headers.get("x-diffcompass-token")===session.browserToken;
const server=Bun.serve({hostname:"127.0.0.1",port:Number(process.env.DIFF_VIEWER_PORT||47660),idleTimeout:120,async fetch(request){
  const url=new URL(request.url);
  if(request.headers.get("host")!==url.host||!["127.0.0.1","localhost"].includes(url.hostname))return new Response("Invalid host",{status:403});
  const file=assets.get(url.pathname);
  if(file){
    let body:BodyInit=Bun.file(file);
    if(url.pathname==="/prototype/index.html")body=(await Bun.file(file).text()).replace("</head>",'<link rel="stylesheet" href="/prototype/integration-embed.css"></head>');
    return new Response(body,{headers:{"content-type":Bun.file(file).type,"cache-control":"no-store","content-security-policy":"frame-ancestors 'self'","x-content-type-options":"nosniff"}});
  }
  if(url.pathname.startsWith("/vendor/")){
    const path=resolve(vendor,decodeURIComponent(url.pathname.slice(8)));
    if(!path.startsWith(vendor+sep))return new Response("Forbidden",{status:403});
    if(url.pathname==="/vendor/"+deletedSourceAsset)return new Response(bundle,{headers:{"content-type":"text/javascript","cache-control":"no-store"}});
    return await Bun.file(path).exists()?new Response(Bun.file(path)):new Response("Not found",{status:404});
  }
  if(url.pathname==="/api/prototype"){
    if(!authorized(request))return new Response("Unauthorized",{status:401});
    return Response.json({files,receiptLine:4,root:container,pullRequestFixture:true,integration:true});
  }
  if(url.pathname==="/api/update"&&request.method==="GET"){
    if(!authorized(request))return new Response("Unauthorized",{status:401});
    return Response.json({updateAvailable:false});
  }
  if(!integrationRequestAllowed(request.method,url.pathname))return Response.json({error:"Disabled in this disposable integration fixture: no external publication, real agent generation, source edits, updates or comparison changes."},{status:403});
  const response=await handler(request),headers=new Headers(response.headers);
  if(url.pathname==="/app.js")return new Response(await response.text()+"\n"+await Bun.file(join(import.meta.dir,"integration-host.js")).text(),{status:response.status,headers});
  if(url.pathname==="/"||url.pathname==="/index.html")return new Response((await response.text()).replace("</head>",'<link rel="stylesheet" href="/prototype/integration-host.css"></head>'),{status:response.status,headers});
  return response;
}});
console.log("Full fixture: http://127.0.0.1:"+server.port+"/#token="+session.browserToken);
console.log("Disposable review: "+fixture.stateFile);
console.log("Monaco source files: "+files.map(f=>f.path).join(", "));
