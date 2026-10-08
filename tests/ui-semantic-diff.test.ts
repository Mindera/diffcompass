import { expect, test } from "bun:test";
import { analyseSemanticSources } from "../src/semantic-diff.ts";
import { semanticPresentation } from "../public/semantic-diff-presentation.js";
const script = await Bun.file(new URL("../public/semantic-diff.js", import.meta.url)).text();
const app = await Bun.file(new URL("../public/app.js", import.meta.url)).text();
function harness() {
  const requests: { resolve: (value: any) => void; reject: (error: Error) => void }[] = [];
  let click!: (event: any) => Promise<void>;
  const state: any = { session: { comparison: { mergeBase: "before", sourceTree: "after", patch: "patch", files: [{ path: "old name.ts" }] } }, tourMode: false, proposalPreview: false, collapsedFiles: new Set<string>(), diffCache: new Map([["old name.ts", { hunks: [{ rows: [{ kind: "deletion", oldLine: 1, newLine: null, content: "old value" }] }] }]]), questionContextPaths: new Set(["live.ts"]), dryRunQuestionContext: {} };
  const scope: any = {}, anchors: any[] = [], notices: string[] = [];
  let focused = false, conversations = 0;
  const elements = { diff: { addEventListener: (_: string, listener: typeof click) => click = listener, querySelectorAll: () => [], querySelector: () => null }, "chat-input": { value: "", focus() { focused = true; } } };
  new Function("globalThis", "state", "elements", "api", "document", "showChangedFile", "diffViewRow", "CSS", "toast", "semanticPresentation", "openConversation", "clearSelectedLine", "renderQuestionScope", script)(scope, state, elements, () => new Promise((resolve, reject) => requests.push({ resolve, reject })), { getElementById: () => elements.diff }, async (...args: any[]) => { anchors.push(args); return true; }, () => ({ scrollIntoView() {}, classList: { add() {} }, querySelector: () => null }), { escape: (value: string) => value }, (value: string) => notices.push(value), semanticPresentation, () => { conversations++; }, () => { state.selectedLine = null; }, () => {});
  return { state, elements, notices, focused: () => focused, conversations: () => conversations, control: scope.DiffCompassSemantic.control, summaryHtml: scope.DiffCompassSemantic.summaryHtml, requests, anchors, click: (selector: string, dataset: any, panel = "old name.ts") => click({ target: { closest: (query: string) => query.split(", ").includes(selector) ? { dataset, closest: () => ({ dataset: { semanticPanel: panel } }) } : null } }) };
}
test("syntax summary is reachable from real diff controls, keyboard buttons and escaped evidence", () => {
  expect(app).toContain('globalThis.DiffCompassSemantic?.control(file)'); expect(app).toContain('globalThis.DiffCompassSemantic?.hydrate()');
  const h = harness(); expect(h.control({ path: "old name.ts" })).toContain('aria-expanded="false"'); expect(h.control({ path: "old name.ts" })).toContain('type="button"');
  expect(h.control({ path: "old name.ts" })).toContain('>What changed</button>');
  h.state.proposalPreview = true; expect(h.control({ path: "old name.ts" })).toBe("");
  const markup = h.summaryHtml({ path: "file.ts", status: "analysed", message: "<script>x</script>", notice: "syntax only", changes: [{ name: "<img>", kind: "function", categories: ["body"], before: { path: "old.ts", side: "old", startLine: 1, signature: "a<b" } }] });
  expect(markup).not.toContain("<script>"); expect(markup).not.toContain("<img>"); expect(markup).toContain("Before: old.ts:1"); expect(markup).toContain("Code or value changed");
});
test("guided tours hide the optional summary and reject stale actions while an existing request finishes", async () => {
  const h = harness();
  await h.click("[data-semantic-file]", { semanticFile: "old name.ts" });
  h.state.tourMode = true;
  expect(h.control({ path: "old name.ts" })).toBe("");
  await h.click("[data-semantic-retry]", { semanticRetry: "old name.ts" });
  expect(h.requests).toHaveLength(1);
  h.requests[0]!.resolve({ changes: [{ after: { side: "new", startLine: 88 } }] }); await Promise.resolve();
  await h.click("[data-semantic-anchor]", { semanticAnchor: "0", semanticSide: "new" });
  expect(h.anchors).toEqual([]);
  h.state.tourMode = false;
  expect(h.control({ path: "old name.ts" })).toContain('aria-expanded="true"');
});
test("saved explanation leads the panel, with exact parser source indexes in collapsed details", async () => {
  const before = "export function total(items: Item[]) { return 1; }\n";
  const after = "interface Discount { percentage: number }\nfunction subtotal(items: Item[]) { return 1; }\nexport function total(items: Item[], discount?: Discount) { const amount = subtotal(items); return amount; }\n";
  const summary = await analyseSemanticSources({ path: "cart.ts", oldPath: "cart.ts", newPath: "cart.ts", status: "modified", metadata: [], hunks: [], additions: 3, deletions: 1 }, before, after, { beforeTree: "a".repeat(40), afterTree: "b".repeat(40) });
  const html = harness().summaryHtml({ ...summary, explanation: { status: "available", entries: [{ phase: "Calculation", summary: "The total applies a discount to the subtotal. Check the fraction expected from callers.", steps: [] }], message: "From the captured comparison.", omitted: 0 } });
  const overview = html.split('<details class="semantic-code-details">')[0]!;
  expect(overview).toContain("The total applies a discount to the subtotal");
  expect(overview).not.toContain("Added interface");
  expect(overview).not.toContain("data-semantic-primary");
  expect(overview).not.toContain("total.amount");
  expect(overview).not.toContain("declaration changes");
  expect(overview).not.toContain("SHA-256");
  expect(html).toContain("All code details (5 items)");
  expect(html).toContain("total.amount");
  const amount = summary.changes.findIndex((change) => change.name === "total.amount");
  expect(html).toContain(`data-semantic-anchor="${amount}" data-semantic-side="new"`);
  expect(html).not.toContain('class="semantic-code-details" open');
  expect(html).toContain("How this summary was made");
});
test("code details retain ambiguous declarations without inventing a prose interpretation", () => {
  const html = harness().summaryHtml({ path: "file.ts", status: "analysed", changes: [{ name: "run", kind: "function declaration", categories: ["added"], ambiguous: true }], message: "", notice: "" });
  expect(html).toContain("Ambiguous overload match; these versions were not paired.");
  expect(html.split('<details class="semantic-code-details">')[0]).toContain("No explanation for this file yet");
});
test("fallback states stay distinct and truncation is visible without opening technical evidence", () => {
  const h = harness();
  const summary = { path: "file.ts", status: "analysed", message: "Other syntax changed; inspect the text diff.", notice: "", changes: [] };
  expect(h.summaryHtml(summary)).toContain("No declaration changes found");
  expect(h.summaryHtml(summary)).toContain(summary.message);
  expect(h.summaryHtml({ ...summary, status: "parse-error" })).toContain("Couldn’t read all of this code");
  expect(h.summaryHtml({ ...summary, status: "unsupported" })).toContain("This file type isn’t supported");
  expect(h.summaryHtml({ ...summary, status: "unavailable" })).toContain("Try again");
  const html = h.summaryHtml({ ...summary, totalChanges: 201, changes: [{ name: "f", kind: "function declaration", categories: ["added"] }] });
  expect(html.split('<details class="semantic-code-details">')[0]).toContain("Showing 1 of 201 code changes");
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

test("file explanation opens the existing composer with captured context, preserves drafts and never sends automatically", async () => {
  const h = harness();
  await h.click("[data-semantic-file]", { semanticFile: "old name.ts" });
  h.requests[0]!.resolve({ changes: [] }); await Promise.resolve();
  h.elements["chat-input"].value = "Keep my draft";
  await h.click("[data-semantic-explain]", { semanticExplain: "old name.ts" });
  expect(h.elements["chat-input"].value).toBe("Keep my draft"); expect(h.notices).toHaveLength(1);
  h.elements["chat-input"].value = "";
  await h.click("[data-semantic-explain]", { semanticExplain: "old name.ts" });
  expect(h.elements["chat-input"].value).toContain('Explain what changed in "old name.ts"');
  expect(h.state.selectedLine).toEqual({ path: "old name.ts", side: "old", line: 1, content: "old value" });
  expect(h.state.questionContextPaths.size).toBe(0); expect(h.state.dryRunQuestionContext).toBeNull();
  expect(h.requests).toHaveLength(1); expect(h.focused()).toBe(true);
});
test("related tour source links use canonical paths, and outline updates invalidate in-flight narratives", async () => {
  const h = harness();
  await h.click("[data-semantic-file]", { semanticFile: "old name.ts" });
  h.requests[0]!.resolve({ changes: [], explanation: { entries: [{ steps: [{ anchor: { path: "prior.ts", side: "old", startLine: 12 } }] }] } }); await Promise.resolve();
  await h.click("[data-semantic-explanation-anchor]", { semanticExplanationAnchor: "0:0" });
  expect(h.anchors).toEqual([["old name.ts", 12, "old", undefined, 200, true]]);
  await h.click("[data-semantic-retry]", { semanticRetry: "old name.ts" });
  h.state.session.outline = { phases: [{ title: "Updated", fileChanges: [], steps: [] }] };
  h.requests[1]!.resolve({ changes: [] }); await Promise.resolve();
  expect(h.control({ path: "old name.ts" })).toContain('aria-expanded="false"');
});

test("Monaco source links reuse its captured-side navigation with the canonical renamed path", async () => {
  const h = harness(), revealed: any[] = [];
  h.state.monacoRenderer = { owns: () => true, reveal: async (...args: any[]) => { revealed.push(args); return true; } };
  await h.click("[data-semantic-file]", { semanticFile: "old name.ts" });
  h.requests[0]!.resolve({ changes: [{ before: { path: "prior.ts", side: "old", startLine: 1200 } }], explanation: { entries: [{ steps: [{ anchor: { side: "new", startLine: 12 } }] }] } }); await Promise.resolve();
  await h.click("[data-semantic-anchor]", { semanticAnchor: "0", semanticSide: "old" });
  await h.click("[data-semantic-explanation-anchor]", { semanticExplanationAnchor: "0:0" });
  expect(revealed).toEqual([["old name.ts", "old", 1200], ["old name.ts", "new", 12]]);
  expect(h.anchors).toEqual([]);
  expect(h.notices).toEqual([]);
});

test("unavailable Monaco navigation reports the failure without switching source or renderer", async () => {
  const h = harness();
  h.state.monacoRenderer = { owns: () => true, reveal: async () => false };
  await h.click("[data-semantic-file]", { semanticFile: "old name.ts" });
  h.requests[0]!.resolve({ changes: [{ after: { side: "new", startLine: 12 } }] }); await Promise.resolve();
  await h.click("[data-semantic-anchor]", { semanticAnchor: "0", semanticSide: "new" });
  expect(h.anchors).toEqual([]);
  expect(h.notices).toEqual(["This captured source line could not be opened. Finish any retained draft and try again."]);
});
