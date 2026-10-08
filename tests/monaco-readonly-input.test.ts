import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../public/monaco/app.mjs", import.meta.url), "utf8");

test("read-only diff and source viewers use DOM readonly inputs, not native EditContext", () => {
  const diff = app.slice(app.indexOf("monaco.editor.createDiffEditor("), app.indexOf("const editors ="));
  const source = app.slice(app.indexOf("sourceEditor = createWithOverflowLayer("), app.indexOf("if (currentAnchor) sourceEditor.setSelection"));
  for (const options of [diff, source]) {
    expect(options).toContain("readOnly: true");
    expect(options).toContain("domReadOnly: true");
    expect(options).toContain("editContext: false");
  }
});

test("suggested edits and comment composers retain keyboard input", () => {
  const draft = app.slice(app.indexOf("draftEditor = createWithOverflowLayer("), app.indexOf("draftEditor.addCommand"));
  expect(draft).toContain("readOnly: false");
  expect(draft).not.toContain("domReadOnly: true");
  expect(draft).not.toContain("editContext: false");
  expect(app).toContain('input.setAttribute("aria-label", kind === "ask" ? "Agent question" : "Comment text")');
});
