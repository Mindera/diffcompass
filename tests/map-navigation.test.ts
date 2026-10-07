import {expect,test} from "bun:test";
const app=await Bun.file(new URL("../public/app.js",import.meta.url)).text();
const html=await Bun.file(new URL("../public/index.html",import.meta.url)).text();
function declaration(name:string) {
  const start=app.indexOf(`function ${name}(`);
  if(start<0)throw Error(`Missing ${name}`);
  return app.slice(start,app.indexOf("\n}",start)+2);
}
function navigation(outline:any={}) {
  const state={session:{outline},mapArtifactSelections:new Map()};
  const names=["archifyArtifacts","hasArchifyArtifact","mapViewForArtifact","mapArtifacts","mapDiagramChoices","mapFailures","componentArchitectureEntries","savedCallFlows","legacySequenceFlows","adaptiveEntries","availableMapViews","selectedArchifyArtifact"];
  const methods=new Function("state",names.map(declaration).join("\n")+";return {availableMapViews,mapArtifacts,mapDiagramChoices,mapFailures,legacySequenceFlows,adaptiveEntries,selectedArchifyArtifact};")(state);
  return {...methods,state};
}
test("map navigation is flat and labels the impact view Blast radius",()=>{
  expect(html).toContain('disabled>Diagrams</button>');
  expect(html).toContain('aria-label="Diagrams"');
  expect(html).toContain('aria-pressed="true">Architecture &amp; design</button>');
  expect(html).toContain('<strong>Architecture &amp; design</strong>');
  expect(navigation().availableMapViews()[0].label).toBe("Architecture & design");
  expect(html).not.toContain('id="maps-understand-select"');
  for(const id of ["archify","call-flows","sequence","adaptive","structural-blast-radius"])expect(html).toContain(`data-map-view="${id}"`);
  expect(html).not.toContain("Explore impact");
  expect(html).toContain('aria-pressed="false">Blast radius</button>');
});
test("interactive and fallback diagrams share a single category, without duplicate sequences",()=>{
  const n=navigation({architecture:{},callFlows:[{id:"call"}],flows:[{id:"saved"},{id:"branch"}],stateDiagram:{},dataModel:{},archifyArtifacts:[
    {id:"components",type:"architecture"},{id:"sequence-saved",type:"sequence"},{id:"lifecycle-state-machine",type:"lifecycle"},
    {id:"domain-checkout",type:"architecture",purpose:"domain-model"},{id:"structural-symbol",type:"architecture"},{id:"call-duplicate",type:"workflow"},
  ]});
  expect(n.availableMapViews().map((v:any)=>v.id)).toEqual(["archify","structural-blast-radius","call-flows","sequence","adaptive"]);
  expect(n.mapArtifacts("archify").map((v:any)=>v.id)).toEqual(["components","domain-checkout"]);
  expect(n.mapArtifacts("sequence").map((v:any)=>v.id)).toEqual(["sequence-saved"]);
  expect(n.mapArtifacts("adaptive").map((v:any)=>v.id)).toEqual(["lifecycle-state-machine"]);
  expect(n.legacySequenceFlows()).toEqual([{id:"branch"}]);
  expect(n.adaptiveEntries().map((v:any)=>v.key)).toEqual(["data-model"]);
});
test("empty, fallback-only and failed map categories remain honest and reachable",()=>{
  expect(navigation().availableMapViews().map((v:any)=>v.id)).toEqual(["archify","structural-blast-radius"]);
  expect(navigation({flows:[{id:"native"}],dataModel:{}}).availableMapViews().map((v:any)=>v.id)).toEqual(["archify","structural-blast-radius","sequence","adaptive"]);
  const n=navigation({archifyFailures:[{id:"sequence-broken",type:"sequence",message:"invalid"},{id:"lifecycle-broken",type:"lifecycle",message:"invalid"},{id:"workflow-old",type:"workflow",message:"legacy"}]});
  expect(n.availableMapViews().map((v:any)=>v.id)).toEqual(["archify","structural-blast-radius","sequence","adaptive"]);
  expect(n.mapFailures("archify")).toEqual([]);
  expect(n.mapFailures("sequence")).toHaveLength(1);
  expect(n.mapFailures("adaptive")).toHaveLength(1);
});
test("adaptive picker includes native state-machine fallbacks and interactive data diagrams exactly once",()=>{
  const n=navigation({stateDiagram:{title:"Retry lifecycle"},dataModel:{title:"Checkout data"},archifyArtifacts:[{id:"dataflow-data-model",type:"dataflow",title:"Checkout data"}]});
  const choices=n.mapDiagramChoices("adaptive");
  expect(choices.map((choice:any)=>choice.id)).toEqual(["dataflow-data-model","native-state"]);
  expect(choices[1]).toMatchObject({nativeKey:"state",label:"State machine (fallback)",title:"Retry lifecycle"});
  n.state.mapArtifactSelections.set("adaptive","native-state");
  expect(n.selectedArchifyArtifact(choices,"adaptive").id).toBe("native-state");
});
test("each map category retains its own selection and recovers when an artifact disappears",()=>{
  const n=navigation(),components=[{id:"a"},{id:"b"}],sequences=[{id:"s"},{id:"t"}];
  n.state.mapArtifactSelections.set("archify","b");n.state.mapArtifactSelections.set("sequence","t");
  expect(n.selectedArchifyArtifact(components,"archify")).toEqual({id:"b"});
  expect(n.selectedArchifyArtifact(sequences,"sequence")).toEqual({id:"t"});
  expect(n.selectedArchifyArtifact(components,"archify")).toEqual({id:"b"});
  expect(n.selectedArchifyArtifact([{id:"s"}],"sequence")).toEqual({id:"s"});
  expect(n.selectedArchifyArtifact([],"adaptive")).toBeUndefined();
});
