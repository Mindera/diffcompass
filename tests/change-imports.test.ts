import { afterEach, expect, test } from "bun:test";
import { listCapturedTree } from "../src/captured-tree.ts";
import { loadChangeFacts, type ChangeFacts, type FileChangeFacts } from "../src/change-facts.ts";
import { resolveKotlinImports, resolveTypescriptImports, resolveTypescriptSpecifier, type ImportFact, type ImportSite, type ImportTarget, type KotlinImportSite, type TreeModules } from "../src/change-imports.ts";
import type { GitComparison } from "../src/types.ts";
import { historicalComparison, repositoryComparison } from "./comparison-fixtures.ts";

async function historicalFacts(base: string, head: string): Promise<{ comparison: GitComparison; facts: ChangeFacts }> {
  const comparison = await historicalComparison(base, head);
  return { comparison, facts: await loadChangeFacts(comparison, { codegraph: null }) };
}
const revision = historicalFacts("8f84166", "740bada");
const suggestions = historicalFacts("57bf907", "27b7e44");

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

const unresolved = (reason: string): ImportTarget => ({ kind: "unresolved", reason });

function fileFacts(facts: ChangeFacts, path: string): FileChangeFacts {
  const file = facts.files.find((entry) => entry.path === path);
  if (!file) throw new Error(`${path} has no change facts.`);
  return file;
}

const importsOf = (facts: ChangeFacts, path: string): ImportFact[] => fileFacts(facts, path).imports;

async function repositoryFile(before: Record<string, string>, after: Record<string, string | null>, path: string): Promise<FileChangeFacts> {
  const { comparison, cleanup } = await repositoryComparison(before, after);
  cleanups.push(cleanup);
  return fileFacts(await loadChangeFacts(comparison, { codegraph: null }), path);
}

async function repositoryImports(before: Record<string, string>, after: Record<string, string | null>, path: string): Promise<ImportFact[]> {
  return (await repositoryFile(before, after, path)).imports;
}

async function headTargets(after: Record<string, string>): Promise<Record<string, ImportTarget>> {
  const imports = await repositoryImports({}, after, "src/main.ts");
  return Object.fromEntries(imports.filter((fact) => fact.side === "new").map((fact) => [fact.specifier, fact.target]));
}

async function expectFileTargetsInTree({ comparison, facts }: { comparison: GitComparison; facts: ChangeFacts }): Promise<void> {
  const paths = { old: new Set((await listCapturedTree(comparison, "old")).map((entry) => entry.path)), new: new Set((await listCapturedTree(comparison, "new")).map((entry) => entry.path)) };
  const targets = facts.files.flatMap((file) => file.imports.flatMap((fact) => fact.target.kind === "file" ? [{ side: fact.side, path: fact.target.path }] : fact.target.kind === "files" ? fact.target.paths.map((path) => ({ side: fact.side, path })) : []));
  expect(targets.length).toBeGreaterThan(0);
  expect(targets.filter(({ side, path }) => !paths[side].has(path))).toEqual([]);
}

test("8f84166..740bada resolves relative imports to head files and bun:test as external", async () => {
  const { facts } = await revision;
  expect(importsOf(facts, "src/revision.ts").find((fact) => fact.side === "new" && fact.specifier === "./types.ts")).toMatchObject({ analysis: "tree-sitter imports", changed: true, target: { kind: "file", path: "src/types.ts" } });
  const tests = importsOf(facts, "tests/revision-aware.test.ts").filter((fact) => fact.side === "new");
  const target = (specifier: string) => tests.find((fact) => fact.specifier === specifier)?.target;
  expect(target("bun:test")).toEqual({ kind: "external", name: "bun:test" });
  expect(target("../src/revision.ts")).toEqual({ kind: "file", path: "src/revision.ts" });
}, 30_000);

test("every file target of 8f84166..740bada is a file of its side's captured tree", async () => {
  await expectFileTargetsInTree(await revision);
}, 30_000);

test("every file target of 57bf907..27b7e44 is a file of its side's captured tree", async () => {
  await expectFileTargetsInTree(await suggestions);
}, 30_000);

test("each head specifier resolves by the head tree's files, manifests and commented tsconfig", async () => {
  const targets = await headTargets({
    "packages/ui/package.json": '{"name":"@acme/ui"}',
    "lib/package.json": '{"name":"lib"}',
    "lib/index.ts": "export const lib = 1;\n",
    "both.ts": "export const both = 1;\n",
    "both.tsx": "export const both = 1;\n",
    "both.js": "export const both = 1;\n",
    "tsconfig.json": '{\n  // aliases\n  "compilerOptions": { "paths": { "@/*": ["src/*"] } }\n}\n',
    "src/main.ts": ['import "../lib";', 'import "@acme/ui";', 'import "@/util";', 'import "../both";', 'import "zod";', 'import "./missing";', 'import "node:fs";', 'import "../both.js";'].join("\n") + "\n",
  });
  expect(targets).toEqual({
    "../lib": unresolved("directory has its own package.json"),
    "@acme/ui": unresolved("workspace package"),
    "@/util": unresolved("tsconfig paths alias"),
    "../both": unresolved("more than one matching file"),
    zod: { kind: "external", name: "zod" },
    "./missing": unresolved("no matching file in the captured tree"),
    "node:fs": { kind: "external", name: "node:fs" },
    "../both.js": unresolved("JavaScript extension substitution is not implemented"),
  });
}, 30_000);

test("a base-side import resolves against the base tree", async () => {
  const imports = await repositoryImports({ "src/use.ts": 'import "./old";\n', "src/old.ts": "export const old = 1;\n" }, { "src/old.ts": null, "src/use.ts": "" }, "src/use.ts");
  expect(imports).toEqual([{ analysis: "tree-sitter imports", side: "old", startLine: 1, endLine: 1, specifier: "./old", changed: true, target: { kind: "file", path: "src/old.ts" } }]);
}, 30_000);

test("paths inherited through a followed tsconfig extends make a bare specifier an alias", async () => {
  const targets = await headTargets({
    "tsconfig.json": '{ "extends": "./config/compiler.json" }',
    "config/compiler.json": '{ "compilerOptions": { "paths": { "domain/*": ["src/domain/*"] } } }',
    "src/main.ts": 'import { Model } from "domain/model";\nexport type Main = Model;\n',
  });
  expect(targets["domain/model"]).toEqual(unresolved("tsconfig paths alias"));
}, 30_000);

test("paths inherited through any entry of an array tsconfig extends make a bare specifier an alias", async () => {
  const targets = await headTargets({
    "tsconfig.json": '{ "extends": ["./a.json", "./b.json"] }',
    "a.json": '{ "compilerOptions": { "strict": true } }',
    "b.json": '{ "compilerOptions": { "paths": { "domain/*": ["src/domain/*"] } } }',
    "src/main.ts": 'import { Model } from "domain/model";\nexport type Main = Model;\n',
  });
  expect(targets["domain/model"]).toEqual(unresolved("tsconfig paths alias"));
}, 30_000);

test("a tsconfig extending a package leaves bare specifiers unresolved as an incomplete index", async () => {
  const targets = await headTargets({
    "tsconfig.json": '{ "extends": "@tsconfig/node20/tsconfig.json" }',
    "src/main.ts": 'import { z } from "zod";\nexport const schema = z;\n',
  });
  expect(targets.zod).toMatchObject({ kind: "unresolved" });
  expect((targets.zod as { reason: string }).reason.startsWith("package and alias index incomplete")).toBe(true);
}, 30_000);

test("a bare specifier naming a file under a tsconfig baseUrl is unresolved and others stay external", async () => {
  const targets = await headTargets({
    "tsconfig.json": '{ "compilerOptions": { "baseUrl": "./src" } }',
    "src/domain/model.ts": "export type Model = { id: string };\n",
    "src/main.ts": 'import type { Model } from "domain/model";\nimport { z } from "zod";\nexport const schema: Model | typeof z | null = null;\n',
  });
  expect(targets["domain/model"]).toEqual(unresolved("tsconfig baseUrl path"));
  expect(targets.zod).toEqual({ kind: "external", name: "zod" });
}, 30_000);

test("tsconfig moduleSuffixes leaves a relative specifier unresolved", async () => {
  const targets = await headTargets({
    "tsconfig.json": '{ "compilerOptions": { "moduleSuffixes": [".native", ""] } }',
    "src/value.ts": "export const value = 1;\n",
    "src/value.native.ts": "export const value = 2;\n",
    "src/main.ts": 'import { value } from "./value";\nexport const main = value;\n',
  });
  expect(targets["./value"]).toEqual(unresolved("tsconfig moduleSuffixes changes relative resolution"));
}, 30_000);

test("export-from and dynamic import specifiers are import facts with their own line ranges", async () => {
  const imports = await repositoryImports({ "src/main.ts": 'export { a } from "./a";\n' }, {
    "src/a.ts": "export const a = 1;\n",
    "src/main.ts": 'export { a } from "./a";\nexport async function load() {\n  return import(\n    "./a"\n  );\n}\n',
  }, "src/main.ts");
  expect(imports.map(({ side, startLine, endLine, specifier, changed }) => ({ side, startLine, endLine, specifier, changed }))).toEqual([
    { side: "old", startLine: 1, endLine: 1, specifier: "./a", changed: false },
    { side: "new", startLine: 1, endLine: 1, specifier: "./a", changed: false },
    { side: "new", startLine: 3, endLine: 5, specifier: "./a", changed: true },
  ]);
}, 30_000);

test("relative, absolute, scheme and bare specifiers each take their own rule", () => {
  const modules: TreeModules = { files: new Set(["index.ts", "src/a.ts"]), workspacePackages: new Set(), aliasPatterns: [], baseUrls: [], relativeOptions: [], complete: true };
  const resolve = (specifier: string) => resolveTypescriptSpecifier(specifier, "src/main.ts", modules);
  expect(resolve("./a")).toEqual({ kind: "file", path: "src/a.ts" });
  expect(resolve("..")).toEqual({ kind: "file", path: "index.ts" });
  expect(resolve("../../a")).toEqual(unresolved("outside the repository"));
  expect(resolve("/a")).toEqual(unresolved("absolute specifier"));
  expect(resolve("bun:sqlite")).toEqual({ kind: "external", name: "bun:sqlite" });
  expect(resolve("https://example.test/a.ts")).toEqual(unresolved("unsupported specifier scheme"));
  expect(resolve("@scope/pkg/deep/path")).toEqual({ kind: "external", name: "@scope/pkg" });
  expect(resolve("lodash/fp")).toEqual({ kind: "external", name: "lodash" });
  expect(resolve("~/a")).toEqual(unresolved("not a package name"));
  expect(resolveTypescriptSpecifier("zod", "src/main.ts", { ...modules, complete: false, reason: "package and alias index incomplete: x" })).toEqual(unresolved("package and alias index incomplete: x"));
  expect(resolveTypescriptSpecifier("./a", "src/main.ts", { ...modules, relativeOptions: ["rootDirs"] })).toEqual(unresolved("tsconfig rootDirs changes relative resolution"));
});

test("a TypeScript declaration file is an import target and a candidate beside a directory index", () => {
  const modules: TreeModules = { files: new Set(["src/types.d.ts", "src/foo.d.ts", "src/foo/index.ts"]), workspacePackages: new Set(), aliasPatterns: [], baseUrls: [], relativeOptions: [], complete: true };
  expect(resolveTypescriptSpecifier("./types", "src/main.ts", modules)).toEqual({ kind: "file", path: "src/types.d.ts" });
  expect(resolveTypescriptSpecifier("./foo", "src/main.ts", modules)).toEqual(unresolved("more than one matching file"));
  expect(resolveTypescriptSpecifier("types", "src/main.ts", { ...modules, baseUrls: ["src"] })).toEqual(unresolved("tsconfig baseUrl path"));
});

test("a TypeScript import index that cannot be built keeps that side's import facts, each unresolved with the error", () => {
  const modules: TreeModules = { files: new Set(["src/a.ts"]), workspacePackages: new Set(), aliasPatterns: [], baseUrls: [], relativeOptions: [], complete: true };
  const site = (side: "old" | "new", specifier: string): ImportSite => ({ side, startLine: 1, endLine: 1, specifier, changed: true });
  const fact = (side: "old" | "new", specifier: string, target: ImportTarget): ImportFact => ({ analysis: "tree-sitter imports", ...site(side, specifier), target });
  const sites = (side: "old" | "new") => [site(side, "./a"), site(side, "zod")];
  const unavailable = unresolved("import index unavailable: tree listing failed");
  expect([...resolveTypescriptImports(sites("old"), "src/main.ts", modules), ...resolveTypescriptImports(sites("new"), "src/main.ts", { error: "tree listing failed" })]).toEqual([
    fact("old", "./a", { kind: "file", path: "src/a.ts" }), fact("old", "zod", { kind: "external", name: "zod" }),
    fact("new", "./a", unavailable), fact("new", "zod", unavailable),
  ]);
});

test("a Kotlin package index that cannot be built keeps that side's import facts, each unresolved with the error", () => {
  const packages = new Map([["demo", { files: ["demo/Color.kt"], names: new Map([["Color", ["demo/Color.kt"]]]), namesComplete: true }]]);
  const scan = { kotlin: { complete: true, unindexed: [], packages }, coverage: { side: "new" as const, totalFiles: 1, scannedFiles: 1, scannedBytes: 40, skippedFiles: 0, parseErrorFiles: 0, message: "Scanned 1 of 1 files." }, javaFiles: 0 };
  const site = (side: "old" | "new", hasError: boolean): KotlinImportSite => ({ side, startLine: 3, endLine: 3, specifier: "demo.Color", changed: false, segments: ["demo", "Color"], star: false, hasError });
  const fact = (side: "old" | "new", target: ImportTarget): ImportFact => ({ analysis: "tree-sitter imports", side, startLine: 3, endLine: 3, specifier: "demo.Color", changed: false, target });
  const unavailable = unresolved("package index unavailable: blob read failed");
  expect([...resolveKotlinImports([site("old", true), site("old", false)], { error: "blob read failed" }), ...resolveKotlinImports([site("new", true), site("new", false)], scan)]).toEqual([
    fact("old", unavailable), fact("old", unavailable),
    fact("new", unresolved("import could not be fully parsed")), fact("new", { kind: "file", path: "demo/Color.kt" }),
  ]);
});

test("imports beyond the limit on one side mark the file truncated", async () => {
  const file = await repositoryFile({}, { "src/main.ts": Array.from({ length: 505 }, (_, i) => `import "./m${i}";`).join("\n") + "\n" }, "src/main.ts");
  expect(file.imports).toHaveLength(500);
  expect(file.completeness).toEqual({ state: "truncated", lists: [{ list: "imports", shown: 500, total: 505 }] });
}, 30_000);

const KOTLIN_ROOT = "shop/src/main/kotlin/com/acme";
const kotlinPath = (path: string) => `${KOTLIN_ROOT}/${path}`;
const CHECKOUT = kotlinPath("ui/Checkout.kt");

const kotlinBase = (): Record<string, string> => ({
  [kotlinPath("billing/Receipt.kt")]: "package com.acme.billing\n\nclass Receipt\n",
  [kotlinPath("billing/Tax.kt")]: "package com.acme.billing\n\nfun tax() = 1\n",
  [kotlinPath("billing/TaxAlt.kt")]: "package com.acme.billing\n\nfun tax(rate: Int) = rate\n",
  [kotlinPath("legacy/Old.kt")]: "package com.acme.legacy\n\nclass Old\n",
  [CHECKOUT]: "package com.acme.ui\n\nimport com.acme.legacy.Old\n\nclass Checkout\n",
});

const kotlinHead = (extra: Record<string, string | null> = {}): Record<string, string | null> => ({
  [kotlinPath("legacy/Old.kt")]: null,
  [kotlinPath("billing/Receipt.kt")]: "package com.acme.billing\n\nclass Receipt {\n    val total = 0\n}\n",
  [CHECKOUT]: "package com.acme.ui\n\nimport com.acme.billing.Receipt\nimport com.acme.billing.*\nimport com.acme.billing.tax\nimport kotlinx.coroutines.flow.Flow\n\nclass Checkout\n",
  ...extra,
});

async function kotlinTargets(before: Record<string, string>, after: Record<string, string | null>, scanLimits?: { files: number; bytes: number; millis: number }, path = CHECKOUT): Promise<{ new: Record<string, ImportTarget>; old: Record<string, ImportTarget> }> {
  const { comparison, cleanup } = await repositoryComparison(before, after);
  cleanups.push(cleanup);
  const facts = await loadChangeFacts(comparison, { codegraph: null, ...(scanLimits ? { scanLimits } : {}) });
  const bySide = (side: "old" | "new") => Object.fromEntries(importsOf(facts, path).filter((fact) => fact.side === side).map((fact) => [fact.specifier, fact.target]));
  return { new: bySide("new"), old: bySide("old") };
}

const billing = ["Receipt.kt", "Tax.kt", "TaxAlt.kt"].map((name) => kotlinPath(`billing/${name}`));
const unlimited = { bytes: 1e9, millis: 1e9 };

test("Kotlin imports resolve through the package index of their own side's tree", async () => {
  const targets = await kotlinTargets(kotlinBase(), kotlinHead());
  expect(targets.new["com.acme.billing.Receipt"]).toEqual({ kind: "file", path: kotlinPath("billing/Receipt.kt") });
  expect(targets.new["com.acme.billing.*"]).toEqual({ kind: "files", paths: expect.arrayContaining(billing), partial: false });
  expect((targets.new["com.acme.billing.*"] as { paths: string[] }).paths).toHaveLength(3);
  expect(targets.new["com.acme.billing.tax"]).toEqual(unresolved("declared in more than one file"));
  expect(targets.new["kotlinx.coroutines.flow.Flow"]).toEqual({ kind: "external", name: "kotlinx.coroutines.flow.Flow" });
  expect(targets.old["com.acme.legacy.Old"]).toEqual({ kind: "file", path: kotlinPath("legacy/Old.kt") });
}, 30_000);

test("a scan stopped by the file limit leaves Kotlin imports unresolved rather than external", async () => {
  const stopped = await kotlinTargets(kotlinBase(), kotlinHead(), { files: 2, ...unlimited });
  expect(stopped.new["com.acme.billing.*"]).toEqual({ kind: "files", paths: [kotlinPath("billing/Receipt.kt")], partial: true });
  for (const specifier of ["com.acme.billing.Receipt", "kotlinx.coroutines.flow.Flow"]) {
    expect(stopped.new[specifier]).toMatchObject({ kind: "unresolved", reason: expect.stringMatching(/^package index incomplete: Scanned 2 of/) });
  }
  const three = await kotlinTargets(kotlinBase(), kotlinHead(), { files: 3, ...unlimited });
  expect(three.new["com.acme.billing.tax"]).toMatchObject({ kind: "unresolved", reason: expect.stringMatching(/^package index incomplete/) });
}, 30_000);

test("Java files in the captured tree leave Kotlin imports unresolved rather than external", async () => {
  const head = kotlinHead({
    "shop/src/main/java/com/acme/legacy/Ledger.java": "package com.acme.legacy;\n\npublic class Ledger {}\n",
    [CHECKOUT]: "package com.acme.ui\n\nimport com.acme.billing.*\nimport com.acme.legacy.Ledger\nimport kotlinx.coroutines.flow.Flow\n\nclass Checkout\n",
  });
  const targets = await kotlinTargets(kotlinBase(), head);
  for (const specifier of ["com.acme.legacy.Ledger", "kotlinx.coroutines.flow.Flow"]) {
    expect(targets.new[specifier]).toMatchObject({ kind: "unresolved", reason: expect.stringMatching(/^may be a Java declaration/) });
  }
  expect(targets.new["com.acme.billing.*"]).toMatchObject({ kind: "files", partial: true });
}, 30_000);

test("a star import of an enum's members targets the enum's file, never external", async () => {
  const before = { "demo/Color.kt": "package demo\n\nenum class Color { RED }\n", "demo/Use.kt": "package demo\n\nval first = 1\n" };
  const targets = await kotlinTargets(before, { "demo/Use.kt": "package demo\n\nimport demo.Color.*\n\nval first = RED\n" }, undefined, "demo/Use.kt");
  expect(targets.new["demo.Color.*"]).toEqual({ kind: "file", path: "demo/Color.kt" });
}, 30_000);

test("a name declared twice in one Kotlin file targets that file", async () => {
  const before = { "demo/Mappers.kt": "package demo\n\nclass A\nclass B\nfun A.label() = 1\nfun B.label() = 2\n", "app/Use.kt": "package app\n\nval first = 1\n" };
  const targets = await kotlinTargets(before, { "app/Use.kt": "package app\n\nimport demo.label\n\nval first = 2\n" }, undefined, "app/Use.kt");
  expect(targets.new["demo.label"]).toEqual({ kind: "file", path: "demo/Mappers.kt" });
}, 30_000);

test("a Kotlin import of a name its package does not declare names that declaration", async () => {
  const before = { "demo/Color.kt": "package demo\n\nenum class Color { RED }\n", "demo/Use.kt": "package demo\n\nval first = 1\n" };
  const targets = await kotlinTargets(before, { "demo/Use.kt": "package demo\n\nimport demo.Missing\n\nval first = 2\n" }, undefined, "demo/Use.kt");
  expect(targets.new["demo.Missing"]).toEqual(unresolved("Missing is not declared in package demo"));
}, 30_000);

test("a Kotlin package name with a backticked segment resolves imports of its declarations", async () => {
  const before = { "acme/in/Thing.kt": "package com.acme.`in`\n\nclass Thing\n", "app/Use.kt": "package app\n\nval first = 1\n" };
  const targets = await kotlinTargets(before, { "app/Use.kt": "package app\n\nimport com.acme.`in`.Thing\n\nval first = 2\n" }, undefined, "app/Use.kt");
  expect(targets.new["com.acme.in.Thing"]).toEqual({ kind: "file", path: "acme/in/Thing.kt" });
}, 30_000);

const DEFAULT_PACKAGE_USE = "package app\n\nimport Foo\nimport Color.*\nimport kotlinx.coroutines.flow.Flow\n\nval first = RED\n";

test("Kotlin imports of default-package declarations target their files while undeclared names stay external", async () => {
  const before = { "Foo.kt": "class Foo\n", "Color.kt": "enum class Color { RED }\n", "app/Use.kt": "package app\n\nval first = 1\n" };
  const targets = (await kotlinTargets(before, { "app/Use.kt": DEFAULT_PACKAGE_USE }, undefined, "app/Use.kt")).new;
  expect(targets.Foo).toEqual({ kind: "file", path: "Foo.kt" });
  expect(targets["Color.*"]).toEqual({ kind: "file", path: "Color.kt" });
  expect(targets["kotlinx.coroutines.flow.Flow"]).toEqual({ kind: "external", name: "kotlinx.coroutines.flow.Flow" });
  const broken = (await kotlinTargets({ ...before, "build/Tasks.kt": "import java.io.File\n\nval x = 1\n\nfun broken( {\n" }, { "app/Use.kt": DEFAULT_PACKAGE_USE }, undefined, "app/Use.kt")).new;
  expect(broken["kotlinx.coroutines.flow.Flow"]).toEqual({ kind: "external", name: "kotlinx.coroutines.flow.Flow" });
}, 30_000);

test("a package holding an unparseable file leaves its names unresolved while other packages stay external", async () => {
  const broken = "package com.acme.billing\n\nfun tax(rate: Int) = rate\n\nfun broken( {\n";
  const targets = await kotlinTargets({ ...kotlinBase(), [kotlinPath("billing/TaxAlt.kt")]: broken }, kotlinHead({ [kotlinPath("billing/TaxAlt.kt")]: broken }));
  const reason = unresolved("a file of package com.acme.billing could not be fully parsed");
  expect(targets.new["com.acme.billing.tax"]).toEqual(reason);
  expect(targets.new["com.acme.billing.Receipt"]).toEqual(reason);
  expect(targets.new["kotlinx.coroutines.flow.Flow"]).toEqual({ kind: "external", name: "kotlinx.coroutines.flow.Flow" });
}, 30_000);

const DEMO_USE = "package demo\n\nimport demo.Color\nimport kotlinx.coroutines.flow.Flow\n\nval first = Color.RED\n";

async function demoTargets(extra: Record<string, string>): Promise<Record<string, ImportTarget>> {
  const before = { "demo/Color.kt": "package demo\n\nenum class Color { RED }\n", "demo/Use.kt": "package demo\n\nval first = 1\n" };
  return (await kotlinTargets(before, { "demo/Use.kt": DEMO_USE, ...extra }, undefined, "demo/Use.kt")).new;
}

test("an unparsed Kotlin file without a package line joins the default package when its first node is clean", async () => {
  const targets = await demoTargets({ "build/Tasks.kt": "import java.io.File\n\nval x = 1\n\nfun broken( {\n" });
  expect(targets["demo.Color"]).toEqual({ kind: "file", path: "demo/Color.kt" });
  expect(targets["kotlinx.coroutines.flow.Flow"]).toEqual({ kind: "external", name: "kotlinx.coroutines.flow.Flow" });
}, 30_000);

test("an unparsed Kotlin file whose first node is an error names itself as unplaced", async () => {
  const targets = await demoTargets({ "build/Tasks.kt": "pakage build ( {\n\nclass X\n" });
  const reason = unresolved("package index incomplete: no package known for build/Tasks.kt");
  expect(targets["demo.Color"]).toEqual(reason);
  expect(targets["kotlinx.coroutines.flow.Flow"]).toEqual(reason);
}, 30_000);

test("an unparsed Kotlin file whose file annotation holds the error names itself as unplaced although a clean node follows", async () => {
  const targets = await demoTargets({ "build/Tasks.kt": "@file:Suppress(,)\n\nclass X\n" });
  expect(targets["demo.Color"]).toEqual(unresolved("package index incomplete: no package known for build/Tasks.kt"));
}, 30_000);

test("unplaced Kotlin files are counted after the first one named", async () => {
  const targets = await demoTargets({
    "build/Tasks.kt": "@file:JvmName(\"Tasks\")\npackage com.acme.( {\n\nclass X\n",
    "build/More.kt": "// lead\n) build\n\nclass X\n",
  });
  expect(targets["demo.Color"]).toMatchObject({ kind: "unresolved", reason: expect.stringMatching(/^package index incomplete: no package known for build\/(?:Tasks|More)\.kt and 1 more file$/) });
}, 30_000);
