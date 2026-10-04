import { expect, test } from "bun:test";
import { analyseSemanticSources, SEMANTIC_LIMITS } from "../src/semantic-diff.ts";
import type { DiffFile } from "../src/types.ts";

const file = (path = "test.ts", extra: Partial<DiffFile> = {}): DiffFile => ({ path, oldPath: path, newPath: path, status: "modified", metadata: [], hunks: [], additions: 0, deletions: 0, ...extra });
const analyse = (before: string, after: string, path = "test.ts", extra: Partial<DiffFile> = {}) => analyseSemanticSources(file(path, extra), before, after, { beforeTree: "a".repeat(40), afterTree: "b".repeat(40) });

test("parser-backed TypeScript declarations distinguish signature, body, addition and removal", async () => {
  const result = await analyse("export function go(x: number) { return x; }\nconst removed = 1;", "export function go(x: string) { return x.length; }\nconst added = 1;");
  expect(result.status).toBe("analysed");
  expect(result.changes.map(({ name, categories }) => [name, categories])).toEqual([["go", ["signature", "body"]], ["removed", ["removed"]], ["added", ["added"]]]);
  expect(result.changes[0]?.before).toMatchObject({ path: "test.ts", side: "old", startLine: 1 });
  expect(result.changes[0]?.after).toMatchObject({ path: "test.ts", side: "new", startLine: 1 });
  expect(result.beforeHash).not.toBe(result.afterHash);
});
test("Kotlin parser handles extension signatures, expect/actual, nested functions and property bodies", async () => {
  const before = "expect class Platform\nclass Box {\n val value: Int = 1\n fun String.run(x: Int): Int {\n  fun nested() = 1\n  return x\n }\n}\n";
  const result = await analyse(before, before.replace("expect class", "actual class").replace("Int = 1", "Int = 2").replace("String.run", "Int.run").replace("nested() = 1", "nested() = 2"), "Box.kt");
  expect(result.status).toBe("analysed");
  expect(result.changes.find((change) => change.name === "Platform")?.categories).toEqual(["signature"]);
  expect(result.changes.find((change) => change.name === "Box.value")?.categories).toEqual(["body"]);
  expect(result.changes.find((change) => change.name === "Box.run")?.categories).toEqual(["signature", "body"]);
});
test("Kotlin annotation/overload syntax and script/module extensions use the same bounded parsers", async () => {
  const before = "@Composable\nfun Greeting(name: String) {\n Text(name)\n}\nfun String.value(): Int = 1\nfun Int.value(): Int = 1\n";
  const result = await analyse(before, before.replace("Text(name)", 'Text("Hello " + name)').replace("String.value(): Int = 1", "String.value(): Int = 2"), "Greeting.kt");
  expect(result.status).toBe("analysed"); expect(result.changes.map((change) => change.name)).toEqual(["Greeting", "value"]);
  expect(result.changes.every((change) => change.categories.join() === "body")).toBe(true);
  for (const extension of ["mts", "cts"]) expect((await analyse("const a = 1;", "const a = 2;", `file.${extension}`)).status).toBe("analysed");
  expect((await analyse("val a = 1\n", "val a = 2\n", "script.kts")).status).toBe("analysed");
});
test("comment/format changes use parsed structure, while strings and ASI remain syntax", async () => {
  const comments = await analyse("// before\nfunction go() { return 1; }", "/** after */\nfunction go() {\n return 1;\n}\n");
  expect(comments.status).toBe("analysed"); expect(comments.changes).toEqual([]); expect(comments.message).toContain("Only comments or formatting");
  expect((await analyse('const a = "a b";', 'const a = "ab";')).changes[0]?.categories).toEqual(["body"]);
  expect((await analyse("function go() { return 1; }", "function go() { return\n1; }")).changes[0]?.categories).toEqual(["body"]);
});
test("arrow signatures, type aliases and exported bindings are classified", async () => {
  expect((await analyse("const fn = (x: number) => x;", "const fn = (x: string) => x;")).changes[0]?.categories).toEqual(["signature"]);
  expect((await analyse("type Id = number;", "type Id = string;")).changes[0]?.categories).toEqual(["signature"]);
  expect((await analyse("const x = 1;", "export const x = 1;")).changes[0]?.categories).toEqual(["signature"]);
});
test("overloads match unique signatures without using ordinal; ambiguous signatures stay explicit", async () => {
  const moved = await analyse("function go(x: string): string;\nfunction go(x: number): number;", "function go(x: number): number;\nfunction go(x: string): string;");
  expect(moved.changes).toEqual([]); expect(moved.message).toContain("Other syntax changed");
  const ambiguous = await analyse("function go(x: string): void;\nfunction go(x: number): void;", "function go(x: boolean): void;\nfunction go(x: bigint): void;");
  expect(ambiguous.changes).toHaveLength(4); expect(ambiguous.changes.every((change) => change.ambiguous)).toBe(true);
});
test("TSX, nested owners, added/deleted files and file renames retain source identities", async () => {
  expect((await analyse("const Page = () => <p>old</p>;", "const Page = () => <p>new</p>;", "Page.tsx")).changes[0]?.categories).toEqual(["body"]);
  const nested = await analyse("class A { run() { return 1; } }\nclass B { run() { return 1; } }", "class A { run() { return 2; } }\nclass B { run() { return 1; } }");
  expect(nested.changes.map((change) => change.name)).toEqual(["A", "A.run"]);
  expect((await analyse("", "const x = 1;", "new.ts", { oldPath: null, status: "added" })).changes[0]?.before).toBeUndefined();
  expect((await analyse("const x = 1;", "", "old.ts", { newPath: null, status: "deleted" })).changes[0]?.after).toBeUndefined();
  const renamed = await analyse("const x = 1;", "const x = 2;", "new.ts", { oldPath: "old.ts", status: "renamed" });
  expect(renamed.renamed).toBe(true); expect(renamed.changes[0]?.before?.path).toBe("old.ts"); expect(renamed.changes[0]?.after?.path).toBe("new.ts");
});
test("failures, unsupported/mixed files and successful empty results are distinct", async () => {
  expect((await analyse("", "function broken( {")).status).toBe("parse-error");
  expect((await analyse("", "value = 1", "file.py")).status).toBe("unsupported");
  expect((await analyse("const x = 1;", "val x = 1", "new.kt", { oldPath: "old.ts" })).status).toBe("unsupported");
  const empty = await analyse("", ""); expect(empty.status).toBe("analysed"); expect(empty.changes).toEqual([]);
  const imports = await analyse('import "before";', 'import "after";'); expect(imports.status).toBe("analysed"); expect(imports.message).toContain("No supported declaration change");
  expect((await analyse("// @generated\nconst x = 1;", "const x = 2;")).status).toBe("generated");
  expect((await analyse("", " ".repeat(SEMANTIC_LIMITS.bytes + 1))).status).toBe("limited");
  expect((await analyse("", "\n".repeat(SEMANTIC_LIMITS.lines))).status).toBe("limited");
});
test("results and resource lifetime stay bounded across repeated analyses", async () => {
  const result = await analyse("", Array.from({ length: 205 }, (_, i) => `const value${i} = ${i};`).join("\n"));
  expect(result.totalChanges).toBe(205); expect(result.changes).toHaveLength(200); expect(result.message).toContain("first 200");
  for (let i = 0; i < 10; i++) expect((await analyse("", `const x = ${i};`)).status).toBe("analysed");
  const tooMany = await analyse("", Array.from({ length: 1001 }, (_, i) => `const value${i} = ${i};`).join("\n"));
  expect(tooMany.status).toBe("limited"); expect(tooMany.changes).toEqual([]);
});
