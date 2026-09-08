import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const extract = (start: string, end: string) => app.slice(app.indexOf(start), app.indexOf(end));
const escapeHtml = (text: string) => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const helpers = new Function("escapeHtml", "state", "findingPins", "lineTools", [
  extract("function rowLine(", "function findingPins("),
  extract("function whitespaceChangedRows(", "function renderSplitSide("),
  extract("function syntaxTokenHtml(", "async function highlightRenderedCode("),
  "return { inlineChangedRanges, inlineChangesForRows, diffCodeHtml, renderUnifiedRow };",
].join("\n"))(escapeHtml, {}, () => "", () => "");
const changedText = (text: string, ranges: number[][]) => ranges.map(([start, end]) => text.slice(start, end));

test("word differences retain shared text across multiple edits", () => {
  const before = "const total = subtotal + tax;", after = "const amount = subtotal - tax;";
  const [oldRanges, newRanges] = helpers.inlineChangedRanges(before, after);
  expect(changedText(before, oldRanges)).toEqual(["total", "+"]);
  expect(changedText(after, newRanges)).toEqual(["amount", "-"]);
});

test("insertions, deletions, whitespace, Unicode and identical lines", () => {
  for (const [before, after] of [["return x;", "return await x;"], ["  x", "\tx"], ["café + 🍎", "café + 🍐"], ["", "hello"], ["hello", ""]]) {
    const [oldRanges, newRanges] = helpers.inlineChangedRanges(before, after);
    const remove = (text: string, ranges: number[][]) => [...ranges].reverse().reduce((s, [a, b]) => s.slice(0, a) + s.slice(b), text);
    expect(remove(before, oldRanges)).toBe(remove(after, newRanges));
  }
  expect(helpers.inlineChangedRanges("same", "same")).toEqual([[], []]);
});

test("bounded fallback highlights differing middle and keeps shared edges", () => {
  const before = "prefix a + b suffix", after = "prefix c - d suffix";
  const [oldRanges, newRanges] = helpers.inlineChangedRanges(before, after, {remaining: 0});
  expect(changedText(before, oldRanges)).toEqual(["a + b"]);
  expect(changedText(after, newRanges)).toEqual(["c - d"]);
});

test("unpaired lines retain line backgrounds without invented inline counterparts", () => {
  expect(helpers.inlineChangesForRows([{kind: "addition", content: "new file"}]).size).toBe(0);
});

test("inline spans survive syntax token boundaries without altering source or escaping", () => {
  const token = (content: string) => ({content, light: "112233", dark: "aabbcc", fontStyle: 0});
  const html = helpers.diffCodeHtml("a <tag> z", false, [token("a <"), token("tag"), token("> z")], [[2, 7]]);
  expect(html.match(/class="inline-change"/g)).toHaveLength(3);
  expect(html).toContain("&lt;");
  expect(html).toContain("&gt;");
  expect(html).not.toContain("<tag>");
});

test("unified has a single gutter with the correct side's number and both references", () => {
  for (const [kind, oldLine, newLine, expected] of [["deletion", 10, undefined, 10], ["addition", undefined, 12, 12], ["context", 10, 12, 12]]) {
    const html = helpers.renderUnifiedRow({path: "a.ts"}, {kind, oldLine, newLine, content: "code"}, []);
    expect(html.match(/class="line-number"/g)).toHaveLength(1);
    expect(html).toContain(`>${expected}</span>`);
    expect(html).toContain(`title="Old: ${oldLine ?? "—"} · New: ${newLine ?? "—"}"`);
  }
});

test("wrapping preference is independent across narrow and desktop layouts", () => {
  const storage = new Map([["diff-wrap", "wrap"], ["mobile-diff-wrap", "scroll"]]);
  const source = extract("function diffWrapPreferenceKey(", "const FILE_PANEL_MIN");
  const load = (mobile: boolean) => new Function("window", "narrowFilePanelLayout", "preferenceKey", `${source}; return preferredDiffWrap();`)({localStorage: {getItem: (key: string) => storage.get(key)}}, () => mobile, (key: string) => key);
  expect(load(false)).toBe("wrap");
  expect(load(true)).toBe("scroll");
  storage.clear();
  expect(load(true)).toBe("scroll");
});

test("changing wrapping restores the visible line rather than just the old scroll offset", () => {
  const state = {diffLayout: "unified", diffWrap: "scroll"};
  const panel = {scrollTop: 500, getBoundingClientRect: () => ({top: 100})};
  const row = {dataset: {path: "a.ts", side: "new", line: "80"}, getBoundingClientRect: () => ({top: (state.diffWrap === "wrap" ? 1300 : 800) - panel.scrollTop, bottom: (state.diffWrap === "wrap" ? 1336 : 818) - panel.scrollTop})};
  const elements = {"diff-panel": panel, diff: {querySelectorAll: (selector: string) => selector.startsWith('.diff-row') ? [row] : [], querySelector: () => null}};
  const saved = new Map();
  const window = {scrollY: 0, scrollTo: () => {}, localStorage: {setItem: (key: string, value: string) => saved.set(key, value)}};
  const document = {querySelector: () => ({getBoundingClientRect: () => ({height: 50})})};
  const source = extract("function changeDiffView(", "function isPngDiff(");
  const change = new Function("state", "elements", "window", "document", "syncDiffViewControls", "diffViewRow", "scheduleCurrentStepReturnUpdate", "diffLayoutPreferenceKey", "diffWrapPreferenceKey", `${source}; return changeDiffView;`)(state, elements, window, document, () => {}, () => row, () => {}, () => "layout", () => "wrap");
  change("unified", "wrap");
  expect(row.getBoundingClientRect().top).toBe(300);
  expect(panel.scrollTop).toBe(1000);
  expect(saved.get("wrap")).toBe("wrap");
});

test("changing diff options persists the current session and browser defaults", () => {
  expect(app).toContain('body: JSON.stringify({ diffLayout: layout, diffWrap: wrap, mobile })');
  expect(app).toContain('api("/api/preferences"');
});
