import { expect, test } from "bun:test";
const script = await Bun.file(new URL("../public/semantic-diff.js", import.meta.url)).text();
const app = await Bun.file(new URL("../public/app.js", import.meta.url)).text();
function harness() {
  const requests: { resolve: (value: any) => void; reject: (error: Error) => void }[] = [];
  let click!: (event: any) => Promise<void>;
  const state = { session: { comparison: { mergeBase: "before", sourceTree: "after", patch: "patch", files: [{ path: "old name.ts" }] } }, proposalPreview: false, collapsedFiles: new Set<string>() };
  const scope: any = {};
  const anchors: any[] = [];
  const elements = { diff: { addEventListener: (_: string, listener: typeof click) => click = listener, querySelectorAll: () => [], querySelector: () => null } };
  new Function("globalThis", "state", "elements", "api", "document", "showChangedFile", "diffViewRow", "CSS", "toast", script)(scope, state, elements, () => new Promise((resolve, reject) => requests.push({ resolve, reject })), { getElementById: () => elements.diff }, async (...args: any[]) => { anchors.push(args); return true; }, () => ({ scrollIntoView() {}, classList: { add() {} }, querySelector: () => null }), { escape: (value: string) => value }, () => {});
  return { state, control: scope.DiffCompassSemantic.control, summaryHtml: scope.DiffCompassSemantic.summaryHtml, requests, anchors, click: (selector: string, dataset: any, panel = "old name.ts") => click({ target: { closest: (query: string) => query === selector ? { dataset, closest: () => ({ dataset: { semanticPanel: panel } }) } : null } }) };
}
test("syntax summary is reachable from real diff controls, keyboard buttons and escaped evidence", () => {
  expect(app).toContain('globalThis.DiffCompassSemantic?.control(file)'); expect(app).toContain('globalThis.DiffCompassSemantic?.hydrate()');
  const h = harness(); expect(h.control({ path: "old name.ts" })).toContain('aria-expanded="false"'); expect(h.control({ path: "old name.ts" })).toContain('type="button"');
  h.state.proposalPreview = true; expect(h.control({ path: "old name.ts" })).toBe("");
  const markup = h.summaryHtml({ path: "file.ts", status: "analysed", message: "<script>x</script>", notice: "syntax only", changes: [{ name: "<img>", kind: "function", categories: ["body"], before: { path: "old.ts", side: "old", startLine: 1, signature: "a<b" } }] });
  expect(markup).not.toContain("<script>"); expect(markup).not.toContain("<img>"); expect(markup).toContain("Before: old.ts:1"); expect(markup).toContain("body / initializer changed");
});
test("refresh discards in-flight results; close/reopen and transport failure can recover", async () => {
  const h = harness(); await h.click("[data-semantic-file]", { semanticFile: "old name.ts" });
  expect(h.requests).toHaveLength(1); expect(h.control({ path: "old name.ts" })).toContain('aria-expanded="true"');
  h.state.session.comparison.sourceTree = "refreshed";
  h.requests[0]!.resolve({ changes: [{ after: { side: "new", startLine: 88 } }] }); await Promise.resolve();
  expect(h.control({ path: "old name.ts" })).toContain('aria-expanded="false"');
  await h.click("[data-semantic-file]", { semanticFile: "old name.ts" }); h.requests[1]!.reject(new Error("offline")); await Promise.resolve();
  await h.click("[data-semantic-retry]", { semanticRetry: "old name.ts" }); expect(h.requests).toHaveLength(3);
  h.requests[2]!.resolve({ changes: [{ before: { path: "prior.ts", side: "old", startLine: 1200 } }] }); await Promise.resolve();
  await h.click("[data-semantic-anchor]", { semanticAnchor: "0", semanticSide: "old" });
  expect(h.anchors).toEqual([["old name.ts", 1200, "old", undefined, 200, true]]);
});
