import { expect, test } from "bun:test";
import { analyseSemanticSources, type SemanticSummary } from "../src/semantic-diff.ts";
import { renderSemanticSummaries } from "../src/semantic-diff-export.ts";

const base: SemanticSummary = { path: "cart.ts", status: "analysed", engine: "parser fixture", beforeTree: "a".repeat(40), afterTree: "b".repeat(40), beforeHash: "c".repeat(64), afterHash: "d".repeat(64), language: "typescript", message: "Fixture evidence.", notice: "Syntax does not prove behaviour.", renamed: false, changes: [] };
const render = (summary: SemanticSummary, format: "markdown" | "html") => renderSemanticSummaries([summary], 4, format);
test("exports keep parser inventories collapsed and label absent saved explanations", async () => {
  const before = "export function total(items: Item[]) { return 1; }\n";
  const after = "interface Discount { percentage: number }\nfunction subtotal(items: Item[]) { return 1; }\nexport function total(items: Item[], discount?: Discount) { const amount = subtotal(items); return amount; }\n";
  const summary = await analyseSemanticSources({ path: "cart.ts", oldPath: "cart.ts", newPath: "cart.ts", status: "modified", metadata: [], hunks: [], additions: 3, deletions: 1 }, before, after, base);
  expect(summary.status).toBe("analysed");
  const html = render(summary, "html"), markdown = render(summary, "markdown");
  const overview = html.split('<details class="semantic-code-details">')[0]!;
  expect(overview).toContain("No explanation for this file yet");
  expect(overview).not.toContain("data-semantic-primary");
  expect(overview).not.toContain("total.amount");
  expect(overview).not.toContain("SHA-256");
  const markdownOverview = markdown.split("<summary>All code details")[0]!;
  expect(markdownOverview).toContain("No saved explanation for this file");
  expect(markdownOverview).not.toContain("total.amount");
  for (const output of [html, markdown]) {
    expect(output).toContain("All code details (5 items)"); expect(output).toContain("total.amount");
    expect(output).toContain("Before cart.ts:1"); expect(output).toContain("After cart.ts:3");
    expect(output).toContain(summary.beforeTree); expect(output).toContain(summary.afterHash!);
    expect(output).toContain("1 of 4 changed files"); expect(output).toContain("not review-wide analysis");
    expect(output).toContain("not persisted in the saved review");
  }
  expect(html).not.toMatch(/<button|data-semantic-anchor|data-semantic-retry|href="\//);
  expect(html).not.toContain('class="semantic-code-details" open');
});
test("offline summaries distinguish fallback states and no supported structural changes", () => {
  for (const [status, heading] of [["unsupported", "This file type isn’t supported"], ["parse-error", "Couldn’t read all of this code"], ["unavailable", "Summary unavailable"], ["limited", "This file exceeds the summary limits"], ["generated", "Generated code — summary skipped"], ["analysed", "No declaration changes found"]] as const) {
    const summary = { ...base, status, message: "Exact reason from parser" };
    for (const format of ["html", "markdown"] as const) {
      const output = render(summary, format);
      expect(output).toContain(heading); expect(output).toContain(summary.message);
      expect(output).not.toContain("All code details"); expect(output).not.toContain("data-semantic-retry");
    }
  }
  expect(renderSemanticSummaries([], 4, "html")).toBe("");
  expect(renderSemanticSummaries([], 4, "markdown")).toBe("");
});
test("renames, ambiguous overloads and truncation remain visible, with exact old/new identities", () => {
  const summary: SemanticSummary = { ...base, renamed: true, totalChanges: 203, changes: Array.from({ length: 8 }, (_, i) => ({ name: `run${i}`, kind: "function declaration", categories: [i % 2 ? "removed" : "added"], ambiguous: i === 0, ...(i % 2 ? { before: { path: "old.ts", side: "old", startLine: i + 1, endLine: i + 2, signature: `function run${i}()` } } : { after: { path: "new.ts", side: "new", startLine: i + 3, endLine: i + 4, signature: `function run${i}()` } }) })) };
  for (const format of ["html", "markdown"] as const) {
    const output = render(summary, format);
    const overview = output.split(format === "html" ? '<details class="semantic-code-details">' : "<summary>All code details")[0]!;
    expect(overview).toContain("Showing 8 of 203 code changes"); expect(overview).toContain("This file was renamed");
    expect(overview).not.toContain("data-semantic-primary");
    expect(output).toContain("Before old.ts:2–3"); expect(output).toContain("After new.ts:3–4");
    expect(output).toContain("Ambiguous overload match; these versions were not paired.");
  }
});
test("export formatting escapes hostile paths and labels without losing exact signatures", () => {
  const hostile = "<script>alert(1)</script>`[click](javascript:bad)";
  const signature = "const x = `\n````\n</details><img src=x onerror=alert(1)>\n# injected\n`;";
  const summary: SemanticSummary = { ...base, path: hostile, message: hostile, changes: [{ name: hostile, kind: "variable declarator", categories: ["added"], after: { path: hostile, side: "new", startLine: 1, endLine: 6, signature } }] };
  const html = render(summary, "html");
  expect(html).not.toContain("<script>"); expect(html).not.toContain("<img"); expect(html).not.toContain('href="javascript:');
  expect(html).toContain("&lt;script&gt;"); expect(html).toContain("&lt;/details&gt;&lt;img");
  const markdown = render(summary, "markdown");
  expect(markdown).toContain(`### \`\` ${hostile} \`\``);
  expect(markdown).toContain(`\`\`\`\`\`text\nAfter ${hostile}:1–6\n${signature}\n\`\`\`\`\``);
});
