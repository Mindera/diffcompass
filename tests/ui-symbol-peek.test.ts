import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

function extract(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  return source.slice(from, to);
}

test("symbol peek keeps the diff context visible and exposes an accessible back trail", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(join(root, "public/index.html"), "utf8"),
    readFile(join(root, "public/app.js"), "utf8"),
    readFile(join(root, "public/styles.css"), "utf8"),
  ]);
  expect(html).toContain('id="symbol-peek-panel"');
  expect(html).toContain('role="dialog" aria-modal="false"');
  expect(html).toContain('aria-live="polite"');
  expect(html).toContain('data-selection-tool="peek"');
  expect(app).toContain('api("/api/symbol-peek"');
  expect(app).toContain('data-symbol-trail-index');
  expect(app).toContain('Current stop');
  expect(app).toContain('function closeSymbolPeek()');
  expect(app).toContain('void focusCurrentStep()');
  expect(app).toContain('data-symbol-location');
  expect(app).toContain('function highlightSymbolPeek()');
  expect(app).toContain('data-symbol-peek-highlight');
  expect(app).toContain('api("/api/highlight"');
  expect(app).toContain('theme: state.syntaxTheme');
  expect(app).toContain('void highlightSymbolPeek();');
  expect(app).toContain('function symbolForCodeSelection(selection)');
  expect(app).toContain('data-symbol-suggestion');
  expect(app).toContain('Try a related identifier');
  expect(styles).toContain(".symbol-peek-suggestions");
  expect(styles).toContain(".symbol-peek-panel");
  expect(styles).toContain(".symbol-peek-trail");
});

test("a partial identifier selection explicitly expands the peek action", async () => {
  const app = await readFile(join(root, "public/app.js"), "utf8");
  const symbolFromText = new Function(`${extract(app, "function symbolFromText(", "function symbolForCodeSelection(")}; return symbolFromText;`)();
  const symbolForCodeSelection = new Function("symbolFromText", `${extract(app, "function symbolForCodeSelection(", "function symbolPeekLocationHtml(")}; return symbolForCodeSelection;`)(symbolFromText);
  const selection = {
    text: "ubtota",
    startLine: 14,
    endLine: 14,
    startOffset: 17,
    endOffset: 23,
    startRow: { dataset: { content: "export function subtotal(items: Item[]): number {" } },
  };

  expect(symbolForCodeSelection(selection)).toEqual({ symbol: "subtotal", expanded: true });
  expect(symbolForCodeSelection({ ...selection, text: "subtotal", startOffset: 16, endOffset: 24 })).toEqual({ symbol: "subtotal", expanded: false });
});
