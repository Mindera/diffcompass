import {test,expect} from "bun:test";
import {fileChangeCounts,gutterRowGradient} from "./annotations.mjs";
test("file totals come from Git metadata, not rendered Monaco rows",()=>{
  expect(fileChangeCounts({additions:6,deletions:0,status:"added",hunks:[]})).toEqual({added:"+6",removed:"−0",label:"6 added lines, 0 removed lines"});
  expect(fileChangeCounts({additions:0,deletions:4,status:"deleted"}).removed).toBe("−4");
  expect(fileChangeCounts({additions:0,deletions:0,status:"renamed"}).added).toBe("+0");
});
test("unknown or invalid counts are not invented",()=>{
  for(const file of [undefined,{}, {additions:1}, {additions:-1,deletions:0}, {additions:1.5,deletions:0}])expect(fileChangeCounts(file)).toBeNull();
});
const red="rgba(255, 0, 0, 0.2)",green="rgba(155, 185, 85, 0.2)";
test("row colors follow measured viewport geometry and leave annotation gaps clear",()=>{
  const result=gutterRowGradient([{top:80,bottom:120,color:red},{top:180,bottom:200,color:green}],100,120);
  expect(result).toBe(`linear-gradient(to bottom, transparent 0px, ${red} 0px, ${red} 20px, transparent 20px, transparent 80px, ${green} 80px, ${green} 100px, transparent 100px)`);
});
test("wrapped/adjacent rows merge without changing their total height",()=>{
  expect(gutterRowGradient([{top:0,bottom:20,color:red},{top:20,bottom:60,color:red}],0,100)).toBe(`linear-gradient(to bottom, transparent 0px, ${red} 0px, ${red} 60px, transparent 60px)`);
});
test("empty, offscreen and ambiguous overlapping paint never imply source rows",()=>{
  expect(gutterRowGradient([],0,100)).toBe("none");
  expect(gutterRowGradient([{top:200,bottom:220,color:red}],0,100)).toBe("none");
  expect(gutterRowGradient([{top:0,bottom:20,color:red},{top:10,bottom:30,color:green}],0,100)).toBe("none");
});
