import { expect, test } from "bun:test";
// @ts-expect-error Shared browser helper.
import { sourceAnchor, suggestedEditTarget, suggestedEditLanguage, suggestionMatchesSource } from "../public/monaco/source-anchor.mjs";

test("Monaco suggestions replace full After lines, not the selected substring", () => {
  const file = { path: "app.ts", status: "modified", new: "first\r\n  return total;\r\nlast\r\n" };
  const selection = { startLineNumber: 2, startColumn: 10, endLineNumber: 3, endColumn: 1 };
  const anchor = sourceAnchor(file, "new", selection, { preserveEol: true });
  expect(suggestedEditTarget(file, anchor)).toEqual({ path: "app.ts", side: "new", line: 2, endLine: 2, expectedContent: "  return total;" });
  expect(suggestedEditTarget(file, { path: file.path, side: "new", line: 1, endLine: 2 }).expectedContent).toBe("first\n  return total;");
});

test("Monaco suggestions reject Before/deleted/foreign/empty/phantom source and invalid ranges", () => {
  const file = { path: "app.ts", status: "modified", new: "line\n" };
  const anchor = { path: file.path, side: "new", line: 1 };
  for (const invalid of [null, { ...anchor, side: "old" }, { ...anchor, path: "else.ts" }, { ...anchor, line: 0 }, { ...anchor, line: 2 }, { ...anchor, endLine: 0 }, { ...anchor, endLine: 2 }, { ...anchor, line: 1.5 }]) expect(() => suggestedEditTarget(file, invalid)).toThrow();
  expect(() => suggestedEditTarget({ ...file, status: "deleted" }, anchor)).toThrow();
  expect(() => suggestedEditTarget({ ...file, new: "" }, anchor)).toThrow();
  expect(suggestedEditTarget({ ...file, new: "\n" }, anchor).expectedContent).toBe("");
  expect(() => suggestedEditTarget({ ...file, new: "line\n".repeat(101) }, { ...anchor, endLine: 101 })).toThrow();
});

const languages = [
  { id: "kotlin", aliases: ["Kotlin"], extensions: [".kt", ".kts"] },
  { id: "javascript", aliases: ["JavaScript", "js"], extensions: [".js"] },
];

test("pending suggestions only attach to matching captured After source", () => {
  const file = { path: "code.ts", status: "modified", new: "first\r\nold\r\nlast\r\n" };
  const edit = { path: file.path, afterLine: 2, context: { line: 1, content: "first\nold\nlast" } };
  expect(suggestionMatchesSource(file, edit)).toBe(true);
  expect(suggestionMatchesSource({ ...file, new: "first\nchanged\nlast\n" }, edit)).toBe(false);
  expect(suggestionMatchesSource(file, { ...edit, path: "else.ts" })).toBe(false);
  expect(suggestionMatchesSource(file, { ...edit, afterLine: 4 })).toBe(false);
  expect(suggestionMatchesSource({ ...file, status: "deleted" }, edit)).toBe(false);
});
const draftLanguage = (source: string, line: number, endLine = line) => suggestedEditLanguage({ language: "markdown", new: source }, { line, endLine }, languages);

test("suggestion fragments use their enclosing Markdown code fence's registered language", () => {
  const markdown = "# Example\r\n\r\n```kotlin\r\ndata class Restored(val session: Session)\r\ndata object Missing\r\n```\r\nProse\r\n~~~JS title\r\nconst value = 1;\r\n~~~~\r\n";
  expect(draftLanguage(markdown, 4, 5)).toBe("kotlin");
  expect(draftLanguage(markdown, 9)).toBe("javascript");
  expect(draftLanguage("  ```Kt\nval value = 1\n  ```", 2)).toBe("kotlin");
  expect(draftLanguage("```kotlin\nval value = 1", 2)).toBe("kotlin");
  expect(suggestedEditLanguage({ language: "typescript", new: "const value = 1;" }, { line: 1, endLine: 1 }, languages)).toBe("typescript");
});

test("suggestion language stays Markdown for prose, unknown fences and ranges crossing fence boundaries", () => {
  const markdown = "Prose\n```kotlin\nval value = 1\n```\nMore prose\n```js\nconst x = 1;\n```";
  for (const [line, endLine] of [[1, 1], [2, 3], [3, 4], [3, 7], [5, 5]]) expect(draftLanguage(markdown, line!, endLine!)).toBe("markdown");
  expect(draftLanguage("```unknown\ncode\n```", 2)).toBe("markdown");
  expect(draftLanguage("```\ncode\n```", 2)).toBe("markdown");
  expect(draftLanguage("    ```kotlin\ncode\n    ```", 2)).toBe("markdown");
  expect(draftLanguage("```kotlin`bad\ncode\n```", 2)).toBe("markdown");
  // A shorter run, the other fence character, or trailing text isn't a close.
  expect(draftLanguage("````kotlin\n```\n~~~\n```` trailing\nval x = 1\n````", 5)).toBe("kotlin");
});
