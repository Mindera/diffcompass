import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const source = app.slice(app.indexOf("async function showChangedFile("), app.indexOf("async function showRepositoryFile("));
function harness(monaco: boolean) {
  let complete!: () => void;
  const pending = new Promise<void>(resolve => { complete = resolve; });
  const calls: unknown[][] = [];
  const state = { tourMode:false, fileRequestId:0, collapsedFiles:new Set(["src/cart.ts"]), session:{comparison:{diffMode:"full"}}, monacoRenderer:{active:monaco, owns:()=>monaco, reveal:(...args: unknown[])=>{calls.push(["monaco",...args]);return pending;}} };
  const elements = { diff:{querySelector:(selector: string)=>({scrollIntoView:(options: unknown)=>calls.push(["scroll",selector,options])})} };
  const noop = () => {};
  const show = new Function("state","elements","CSS","filteredChangedFiles","renderActiveTab","renderDiff","renderComments","renderFindings","revealCodeLocation","renderTourAnnotation", `${source}; return showChangedFile;`)(
    state,elements,{escape:(path: string)=>path},()=>[{path:"src/cart.ts"}],noop,noop,noop,noop,
    (...args: unknown[])=>{calls.push(["line",...args]);return pending;},noop,
  ) as (path: string,line?: number,side?: string)=>Promise<boolean>;
  return {show,complete,calls,state};
}

test("file-only Monaco navigation waits for the header reveal without inventing a source line", async () => {
  const h=harness(true); let returned=false;
  const opening=h.show("src/cart.ts").then(result=>{returned=true;return result;});
  await Promise.resolve();
  expect(h.calls).toEqual([["monaco","src/cart.ts"]]);
  expect(h.state.collapsedFiles.has("src/cart.ts")).toBe(false);
  expect(returned).toBe(false);
  h.complete(); expect(await opening).toBe(true);
});

test("native files scroll their outer card", async () => {
  const h=harness(false); expect(await h.show("src/cart.ts")).toBe(true);
  expect(h.calls).toEqual([["scroll",':scope > [data-path="src/cart.ts"]',{behavior:"smooth",block:"start"}]]);
});

test("line navigation finishes before the caller selects code for editing", async () => {
  const h=harness(true); let returned=false;
  const opening=h.show("src/cart.ts",17,"new").then(()=>{returned=true;});
  await Promise.resolve();
  expect(h.calls.at(-1)).toEqual(["line","src/cart.ts","new",17]);
  expect(returned).toBe(false);
  h.complete(); await opening; expect(returned).toBe(true);
});
