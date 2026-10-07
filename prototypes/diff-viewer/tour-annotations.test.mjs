import {test,expect} from "bun:test";
import {tourStopsForFile,fileStatusLabel,tourSourceLabel} from "./annotations.mjs";
const file={path:"a.ts",old:"old\nbody\nend",new:"new\nbody\nend"};
const step=(id,path="a.ts",side="new",startLine=1,endLine=2)=>({id,title:id,objective:"Inspect code",anchor:{path,side,startLine,endLine}});
test("file badges use exact Git status, without guessing from empty source",()=>{
  expect(["added","modified","deleted","renamed",undefined].map(fileStatusLabel)).toEqual(["Added","Modified","Deleted","Renamed","Changed"]);
  expect(tourSourceLabel({...file,status:"added"},"new")).toBe("New file");
  expect(tourSourceLabel({...file,status:"deleted"},"old")).toBe("Deleted file");
  expect(tourSourceLabel({...file,old:"",status:"modified"},"new")).toBe("Updated code");
  expect(tourSourceLabel({...file,status:"renamed"},"old")).toBe("Original code");
  expect(tourSourceLabel({...file,status:"renamed"},"new")).toBe("Updated code");
});
test("current and next refer to phase order, not filtered file order",()=>{
  const steps=[step("a"),step("b","other.ts"),step("c")];
  expect(tourStopsForFile(file,steps,"a").map(s=>[s.id,s.state,s.label])).toEqual([["a","current","Current stop"],["c","other","Stop 3"]]);
  expect(tourStopsForFile(file,steps,"b").map(s=>[s.id,s.state])).toEqual([["a","other"],["c","next"]]);
});
test("Before/After, overlapping anchors and first/last lines remain distinct",()=>{
  const result=tourStopsForFile(file,[step("old","a.ts","old",1,3),step("new","a.ts","new",1,3)],"old");
  expect(result.map(s=>[s.anchor.side,s.state])).toEqual([["old","current"],["new","next"]]);
});
test("invalid source ranges never clamp onto unrelated code",()=>{
  const steps=[step("zero","a.ts","new",0),step("outside","a.ts","new",1,4),step("reverse","a.ts","old",3,1),step("fraction","a.ts","new",1.5,2),step("side","a.ts","workspace")];
  expect(tourStopsForFile(file,steps,"zero")).toEqual([]);
  expect(tourStopsForFile({...file,old:""},[step("missing","a.ts","old")],"missing")).toEqual([]);
});
