import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
const source = app.slice(app.indexOf("let codeSelectionPointerType = null;"), app.indexOf("function updateCodeSelectionToolbar()"));

function harness(pointer: string | null, coarse = false, viewport: object | null = null) {
  const window = { innerWidth: 800, innerHeight: 900, visualViewport: viewport, matchMedia: () => ({ matches: coarse }) };
  const position = new Function("window", "pointer", `${source}; codeSelectionPointerType = pointer; return positionCodeSelectionToolbar;`)(window, pointer);
  const classes = new Set<string>();
  const properties: Record<string, string> = {};
  const toolbar = {
    classList: { toggle: (name: string, value: boolean) => value ? classes.add(name) : classes.delete(name) },
    style: { left: "100px", top: "100px", setProperty: (name: string, value: string) => { properties[name] = value; } },
    getBoundingClientRect: () => ({ width: 200, height: 40 }),
  };
  position(toolbar, { rect: { left: 200, top: 100, bottom: 120, width: 100 } });
  return { toolbar, classes, properties };
}

test("touch and pen selections dock even on a wide screen; mouse stays floating on hybrids", () => {
  for (const pointer of ["touch", "pen"]) {
    const { toolbar, classes } = harness(pointer);
    expect(classes.has("touch-selection-bar")).toBe(true);
    expect(toolbar.style.left).toBe("");
    expect(toolbar.style.top).toBe("");
  }
  const mouse = harness("mouse", true);
  expect(mouse.classes.has("touch-selection-bar")).toBe(false);
  expect(mouse.toolbar.style.left).toBe("150px");
  expect(mouse.toolbar.style.top).toBe("53px");
  expect(harness(null, true).classes.has("touch-selection-bar")).toBe(true);
  expect(harness(null, false).classes.has("touch-selection-bar")).toBe(false);
});

test("docked actions follow the visible viewport and account for safe areas", () => {
  expect(harness("touch", true, { height: 500, offsetTop: 100 }).properties["--selection-viewport-bottom"]).toBe("300px");
  expect(harness("touch").properties["--selection-viewport-bottom"]).toBe("0px");
  expect(styles).toContain("env(safe-area-inset-bottom, 0px)");
  expect(styles).toContain(".code-selection-toolbar.touch-selection-bar button { min-height: 44px;");
  expect(app).toContain('window.visualViewport?.addEventListener("scroll", updateCodeSelectionToolbar)');
  expect(app).toContain('elements["code-selection-toolbar"].addEventListener("pointerdown", (event) => event.preventDefault())');
});
