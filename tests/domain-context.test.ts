import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { domainPrompt, loadDomainDocuments, validateDomainModels, validDomainModels } from "../src/domain-context.ts";
import { domainFixtureModel, domainFixtureText } from "../src/domain-fixture.ts";
import { archifyCandidates } from "../src/archify.ts";
import { withArchifyEmbedAdapter } from "../src/archify-embed.ts";
import { runProcess } from "../src/process.ts";
import type { GitComparison, TourOutline } from "../src/types.ts";

const comparison = {repositoryFiles:["src/receipt.ts"],files:[{path:"src/receipt.ts"}]} as GitComparison;
const docs = [{path:"CONTEXT.md",scope:"",text:domainFixtureText}];
test("domain models retain supported concepts and exact source quotes", () => {
  expect(validateDomainModels([domainFixtureModel],docs,comparison)).toEqual([domainFixtureModel]);
  expect(validateDomainModels(undefined,docs,comparison)).toEqual([]);
  expect(validateDomainModels([domainFixtureModel],[],comparison)).toEqual([]);
  expect(domainPrompt([])).toContain("retain code-derived names");
});
test("no glossary is a no-op even when a repository is unavailable", async () => {
  expect(await loadDomainDocuments({...comparison,repositoryRoot:"/no-such-domain-repository",repositoryFiles:[]})).toEqual([]);
});
test("fabricated evidence, invalid graph endpoints and duplicate identities are rejected", () => {
  const model = structuredClone(domainFixtureModel);
  model.relationships[0]!.source.quote = "Invented relationship";
  expect(() => validateDomainModels([model],docs,comparison)).toThrow();
  model.relationships[0]!.to = "missing";
  expect(validDomainModels([model])).toBe(false);
  expect(validDomainModels([domainFixtureModel,domainFixtureModel])).toBe(false);
});
test("a nested glossary takes precedence over the root glossary for code bindings", () => {
  expect(() => validateDomainModels([domainFixtureModel],[...docs,{path:"src/CONTEXT.md",scope:"src",text:"# Different vocabulary"}],comparison)).toThrow("nearest glossary");
});
test("domain map candidates use definitions, not code-change comparison states", () => {
  const outline = {domainModels:[domainFixtureModel],callFlows:[],flows:[]} as unknown as TourOutline;
  const candidate = archifyCandidates(outline)[0]!;
  expect(candidate.purpose).toBe("domain-model");
  expect(candidate.comparison).toBeUndefined();
  expect(candidate.domainDetails?.receipt?.term).toBe("Receipt");
  expect(candidate.ir.connections).toHaveLength(2);
});
test("glossary details are safely embedded and absent for unmatched components", () => {
  const details = {receipt:{...domainFixtureModel.concepts[0]!,context:"Checkout",definition:"</script><script>alert(1)</script>"}};
  const html = withArchifyEmbedAdapter("<html><body></body></html>","architecture",details);
  expect(html).toContain("data-code-review-tour-domain");
  expect(html).not.toContain("</script><script>alert(1)");
  expect(withArchifyEmbedAdapter("<html><body></body></html>")).not.toContain("data-code-review-tour-domain");
});
test("discovery finds scoped glossaries and context-map links but skips symlinks and unrelated modules", async () => {
  const root = await mkdtemp(join(tmpdir(),"crt-domain-test-"));
  await mkdir(join(root,"one")); await mkdir(join(root,"two")); await mkdir(join(root,"three"));
  await writeFile(join(root,"CONTEXT-MAP.md"),"[One](one/CONTEXT.md) [Two](two/CONTEXT.md)");
  await writeFile(join(root,"one/CONTEXT.md"),"# One");
  await writeFile(join(root,"two/CONTEXT.md"),"# Two");
  await writeFile(join(root,"three/CONTEXT.md"),"# Three");
  await symlink(join(root,"one/CONTEXT.md"),join(root,"CONTEXT.md"));
  const found = await loadDomainDocuments({...comparison,repositoryRoot:root,repositoryFiles:["CONTEXT.md","CONTEXT-MAP.md","one/CONTEXT.md","two/CONTEXT.md","three/CONTEXT.md"],files:[{path:"one/code.ts"}]} as GitComparison);
  expect(found.map(doc=>doc.path).sort()).toEqual(["CONTEXT-MAP.md","one/CONTEXT.md","two/CONTEXT.md"]);
});
test("tree reviews read glossary content from the reviewed tree, not the working copy", async () => {
  const root = await mkdtemp(join(tmpdir(),"crt-domain-snapshot-"));
  await runProcess(["git","init"],root);
  await writeFile(join(root,"CONTEXT.md"),"# Original vocabulary");
  await runProcess(["git","add","CONTEXT.md"],root);
  const tree = (await runProcess(["git","write-tree"],root)).stdout.trim();
  await writeFile(join(root,"CONTEXT.md"),"# Later vocabulary");
  const found = await loadDomainDocuments({...comparison,repositoryRoot:root,repositoryFiles:["CONTEXT.md"],sourceKind:"tree",sourceTree:tree});
  expect(found[0]?.text).toBe("# Original vocabulary");
});
