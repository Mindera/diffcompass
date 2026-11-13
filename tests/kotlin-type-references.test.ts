import { expect, test } from "bun:test";
import { kotlinTypeReferences } from "../src/kotlin-type-references.ts";

function lookup(sources: Record<string, string>, path = "Model.kt", symbol = "Model", line = 2, column?: number) {
  return kotlinTypeReferences(Object.keys(sources), async name => {
    if (!(name in sources)) throw new Error("Missing fixture");
    return sources[name]!;
  }, { path, symbol, line, column });
}

test("Kotlin type candidates follow one wildcard scope, explicit imports, class literals and constructor references", async () => {
  const { result } = await lookup({
    "Model.kt": "package domain\nclass Model\n",
    "Use.kt": "package ui\nimport domain.*\nfun make() = Model()\nval ref = ::Model\nval type = Model::class\nval member = Model.Companion\n",
    "Ambiguous.kt": "package ui\nimport domain.*\nimport external.*\nfun make() = Model()\n",
    "Explicit.kt": "package ui\nimport domain.Model\nimport external.*\nfun make() = Model()\n",
    "Hidden.kt": "package ui\nimport external.Model\nimport domain.*\nfun make() = Model()\n",
  });
  expect(result?.usages).toEqual([
    { path: "Explicit.kt", line: 2 }, { path: "Explicit.kt", line: 4 },
    ...[3, 4, 5, 6].map(line => ({ path: "Use.kt", line })),
  ]);
});

test("nested types, type parameters, callable bindings and qualified receiver values cannot become type references", async () => {
  const { result } = await lookup({
    "Model.kt": "package domain\nclass Model\n",
    "Use.kt": [
      "package ui", "import domain.Model",
      "fun <Model> identity(value: Model) = value",
      "class Outer {", "  class Model", "  fun make() = Model()", "}",
      "fun shadow(Model: () -> Unit) = Model()",
      "fun qualified(domain: Other) = domain.Model()",
      "fun local() { typealias Model = String; val value: Model = \"\" }",
      "fun make(value: Model) = value",
    ].join("\n"),
  });
  expect(result?.usages).toEqual([{ path: "Use.kt", line: 2 }, { path: "Use.kt", line: 11 }]);
});

test("private types stay in their file and aliases hide the original unqualified name", async () => {
  const sources = {
    "Model.kt": "package domain\nprivate class Model\nfun make() = Model()\n",
    "Other.kt": "package domain\nfun bad() = Model()\n",
  };
  expect((await lookup(sources)).result?.usages).toEqual([{ path: "Model.kt", line: 3 }]);
  expect((await lookup(sources, "Other.kt", "Model", 2)).result).toBeUndefined();
  const { result } = await lookup({
    "Model.kt": "package domain\nclass Model\n",
    "Alias.kt": "package domain\nimport domain.Model as Renamed\nfun bad() = Model()\nfun good() = Renamed()\n",
  });
  expect(result?.usages).toEqual([{ path: "Alias.kt", line: 2 }, { path: "Alias.kt", line: 4 }]);
});

test("type selection uses UTF-16 columns and refuses strings, comments and ambiguous positions", async () => {
  const line = 'fun use() { println("🚀"); Model(); other.Model() }';
  const sources = { "Model.kt": `package domain\nclass Model\n${line}\n// Model\nval text = "Model"\n` };
  const result = await lookup(sources, "Model.kt", "Model", 3, line.indexOf("Model") + 1);
  expect(result.result?.definition).toEqual({ path: "Model.kt", line: 2 });
  for (const [row, column] of [[3, undefined], [3, line.lastIndexOf("Model") + 1], [4, undefined], [5, undefined]]) {
    expect((await lookup(sources, "Model.kt", "Model", row!, column)).result).toBeUndefined();
  }
});

test("bounded Kotlin indexing marks partial files and caps results and source scans", async () => {
  const result = await lookup({
    "Model.kt": `package domain\nclass Model\n${Array.from({ length: 60 }, (_, i) => `fun use${i}() = Model()`).join("\n")}\n`,
    "Broken.kt": "package domain\nfun (",
  });
  expect(result.result?.usages).toHaveLength(49);
  expect(result.result?.truncated).toBe(true);
  expect(result.result?.partial).toBe(true);
  const bounded = await lookup({
    "Model.kt": "package domain\nclass Model\n",
    ...Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`Empty${i}.kt`, "// empty\n"])),
  });
  expect(bounded.result?.definition).toEqual({ path: "Model.kt", line: 2 });
  expect(bounded.result?.truncated).toBe(true);
});
