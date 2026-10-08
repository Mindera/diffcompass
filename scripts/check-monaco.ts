// Starts a fresh fixture and always shuts down its server after browser tests.
import { resolve } from "node:path";
async function checkFixture(samplePr: boolean, scripts: string[], beforeTour = false) {
const child = Bun.spawn([process.execPath, "scripts/monaco-fixture.ts"], { stdout: "pipe", stderr: "inherit", env: { ...process.env, DIFF_VIEWER_PORT: "0", DIFF_VIEWER_STATE: "", DIFF_VIEWER_PR_EXAMPLE: samplePr ? "1" : "0", DIFF_VIEWER_BEFORE_TOUR: beforeTour ? "1" : "0" } });
let output = "", url: string | undefined, repository: string | undefined;
const timeout = setTimeout(() => child.kill(), 30_000);
try {
  for await (const chunk of child.stdout) {
    output += new TextDecoder().decode(chunk);
    url = /^Production fixture: (.+)$/m.exec(output)?.[1]; repository = /^Repository: (.+)$/m.exec(output)?.[1];
    if (url && repository) break;
  }
  clearTimeout(timeout);
  if (!url || !repository) throw Error("Production fixture failed to start: " + output);
  for (const script of scripts) {
    const test = Bun.spawn([process.execPath, script, resolve("node_modules/playwright/index.mjs"), url, repository], { stdout: "inherit", stderr: "inherit" });
    const exitCode = await test.exited;
    if (exitCode) { process.exitCode = exitCode; break; }
  }
} finally { clearTimeout(timeout); child.kill(); await child.exited; }
}
await checkFixture(false, ["scripts/monaco-foundation-browser.mjs", "scripts/monaco-scroll-browser.mjs", "scripts/file-header-browser.mjs", "scripts/monaco-edits-browser.mjs", "scripts/monaco-edits-syntax-browser.mjs", "scripts/monaco-themes-browser.mjs"]);
if (!process.exitCode) await checkFixture(true, ["scripts/renderer-comments-browser.mjs", "scripts/monaco-phase-browser.mjs", "scripts/monaco-phase-scroll-browser.mjs", "scripts/monaco-reviewed-scroll-browser.mjs", "scripts/monaco-sticky-browser.mjs", "scripts/monaco-context-browser.mjs", "scripts/monaco-edits-browser.mjs", "scripts/monaco-edits-syntax-browser.mjs", "scripts/monaco-discussions-browser.mjs", "scripts/monaco-file-explorer-browser.mjs"]);
if (!process.exitCode) await checkFixture(true, ["scripts/monaco-before-tour-browser.mjs"], true);
