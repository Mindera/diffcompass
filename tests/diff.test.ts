import { describe, expect, test } from "bun:test";
import { parseUnifiedDiff } from "../src/diff.ts";

describe("parseUnifiedDiff", () => {
  test("parses additions, deletions, and line numbers", () => {
    const files = parseUnifiedDiff(`diff --git a/src/example.ts b/src/example.ts
index 1111111..2222222 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,3 +1,4 @@
 const one = 1;
-const two = 2;
+const two = 22;
+const three = 3;
 export { one, two };
`);

    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/example.ts");
    expect(files[0].additions).toBe(2);
    expect(files[0].deletions).toBe(1);
    expect(files[0].hunks[0].rows.map((row) => [row.kind, row.oldLine, row.newLine])).toEqual([
      ["context", 1, 1],
      ["deletion", 2, null],
      ["addition", null, 2],
      ["addition", null, 3],
      ["context", 3, 4],
    ]);
  });

  test("recognizes added and deleted files", () => {
    const files = parseUnifiedDiff(`diff --git a/new.txt b/new.txt
new file mode 100644
--- /dev/null
+++ b/new.txt
@@ -0,0 +1 @@
+new
diff --git a/old.txt b/old.txt
deleted file mode 100644
--- a/old.txt
+++ /dev/null
@@ -1 +0,0 @@
-old
`);

    expect(files.map((file) => [file.path, file.status])).toEqual([
      ["new.txt", "added"],
      ["old.txt", "deleted"],
    ]);
  });
});
