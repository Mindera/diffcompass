import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

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
  expect(styles).toContain(".symbol-peek-panel");
  expect(styles).toContain(".symbol-peek-trail");
});
