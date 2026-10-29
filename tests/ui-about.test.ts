import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
function slice(start: string) {
  const begin = app.indexOf(start);
  if (begin < 0) throw new Error(`Missing ${start}`);
  return app.slice(begin, app.indexOf("\n}", begin) + 2);
}
const CODE_ANALYSIS = "TypeScript, TSX and Kotlin. Changes in other languages get no static facts. CodeGraph is used when this repository has a matching index.";

async function renderAbout(codeAnalysis: string) {
  const elements: Record<string, Record<string, unknown>> = {
    "settings-menu": { open: true },
    "about-details": { innerHTML: "" },
    "about-dialog": { showModal() {} },
  };
  const context = {
    elements,
    api: async () => ({
      version: "2.2.2", runtime: "Bun", repository: "r", repositoryPath: "/r",
      comparison: "main → working tree", reviewStatus: "open", agent: "codex", mode: "working tree", codeAnalysis,
    }),
  };
  const pending = runInNewContext(`${slice("function escapeHtml(")}\n${slice("async function openAboutDialog(")}\nopenAboutDialog()`, context) as Promise<void>;
  await pending;
  return elements["about-details"].innerHTML as string;
}

test("the about dialog shows the server's code analysis row after the mode", async () => {
  const html = await renderAbout(CODE_ANALYSIS);
  expect(html.endsWith(`<div><dt>Code analysis</dt><dd>${CODE_ANALYSIS}</dd></div>`)).toBe(true);
});

test("the code analysis row is escaped like every other about row", async () => {
  const html = await renderAbout("<b>x</b>");
  expect(html.endsWith("<div><dt>Code analysis</dt><dd>&lt;b&gt;x&lt;/b&gt;</dd></div>")).toBe(true);
});
