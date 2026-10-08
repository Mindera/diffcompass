// Each browser script owns its fixture: source edits, review state and captured
// preferences must not leak between independent regressions. Keep going after
// failures so CI reports every failing script rather than one per push.
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
const groups = {
  local: { samplePr: false, scripts: ["monaco-foundation", "monaco-scroll", "file-header", "monaco-edits", "monaco-edits-syntax", "monaco-themes", "monaco-semantic", "monaco-mount", "monaco-paged-draft"] },
  navigation: { samplePr: true, scripts: ["monaco-phase", "monaco-phase-scroll", "monaco-reviewed-scroll", "monaco-sticky", "monaco-file-explorer"] },
  discussions: { samplePr: true, scripts: ["renderer-comments", "monaco-context", "monaco-edits", "monaco-edits-syntax", "monaco-discussions"] },
  before: { samplePr: true, beforeTour: true, scripts: ["monaco-before-tour"] },
};
const requested = process.env.MONACO_CHECK_GROUP;
if (requested && !Object.hasOwn(groups, requested)) throw Error("Unknown MONACO_CHECK_GROUP: " + requested);
for (const [name, group] of Object.entries(groups)) {
  if (requested && name !== requested) continue;
  for (const script of group.scripts) {
    console.log(`BROWSER CHECK scripts/${script}-browser.mjs (${name} fixture)`);
    await checkFixture(group.samplePr, [`scripts/${script}-browser.mjs`], "beforeTour" in group && group.beforeTour);
  }
}
