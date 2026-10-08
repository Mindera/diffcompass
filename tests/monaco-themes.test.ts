import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { SYNTAX_THEMES } from "../src/highlight";
import { monacoThemes, tokenStyle } from "../src/monaco-themes";
import { monacoAsset } from "../src/monaco-assets";
// @ts-expect-error Shared browser module; no DOM is used by these test doubles.
import { installSyntaxThemes } from "../public/monaco/themes.mjs";

test("all syntax choices supply distinct locally bundled Monaco palettes", async () => {
  const themes = await monacoThemes();
  expect(Object.keys(themes)).toEqual([...SYNTAX_THEMES]);
  const signatures = new Set<string>();
  for (const [name, pair] of Object.entries(themes)) {
    signatures.add(JSON.stringify(pair.dark.rules));
    for (const theme of [pair.light, pair.dark]) {
      expect(theme.rules.length).toBeGreaterThan(20);
      expect(theme.rules.every(rule => /^[\da-f]{6}$/i.test(rule.foreground!))).toBe(true);
      expect(theme.colors["editor.background"]).toMatch(/^#[\da-f]{6}$/i);
      expect(theme.colors["editor.foreground"]).toMatch(/^#[\da-f]{6}$/i);
    }
    expect(pair.dark.base).toBe("vs-dark");
    if (name.startsWith("catppuccin")) expect(pair.light).toEqual(pair.dark);
    else { expect(pair.light.base).toBe("vs"); expect(pair.light.rules).not.toEqual(pair.dark.rules); }
  }
  expect(signatures.size).toBe(SYNTAX_THEMES.length);
  const color = (name: keyof typeof themes, token: string) => themes[name].dark.rules.find(rule => rule.token === token)?.foreground;
  expect(color("github", "keyword")).toBe("f97583");
  expect(color("diffcompass", "keyword")).toBe("ff7ab2");
  expect(color("catppuccin-mocha", "string")).toBe("a6e3a1");
  expect(themes["catppuccin-mocha"].dark.colors["editor.background"]).toBe("#1e1e2e");
});

test("scope mapping inherits styles, honors explicit reset, and composites alpha colors", () => {
  const theme = { fg: "#ffffff", bg: "#000000", settings: [
    { scope: "string", settings: { foreground: "#ff000080", fontStyle: "italic" } },
    { scope: "string.quoted", settings: { fontStyle: "" } },
    { scope: "meta.embedded string.quoted", settings: { foreground: "#00ff00" } },
  ] };
  expect(tokenStyle(theme, "string.quoted")).toEqual({ foreground: "800000", fontStyle: "" });
  expect(tokenStyle(theme, "unmatched")).toEqual({ foreground: "ffffff", fontStyle: "" });
});

test("theme catalog and client adapter are served with the release assets", async () => {
  const asset = await monacoAsset("/monaco/theme-data.mjs");
  expect(asset?.type).toContain("javascript");
  expect(asset?.body).toContain('"catppuccin-mocha"');
  expect(asset?.body).toContain("export const syntaxThemes = ");
  expect((await monacoAsset("/monaco/themes.mjs"))?.body).toContain("installSyntaxThemes");
});

test("host sync includes syntax preferences without rebuilding editors or drafts", async () => {
  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const host = await readFile(new URL("../public/monaco-controller.mjs", import.meta.url), "utf8");
  const child = await readFile(new URL("../public/monaco/app.mjs", import.meta.url), "utf8");
  expect(app).toContain("syntaxTheme: state.syntaxTheme");
  expect(host).toContain('attributeFilter: ["data-theme", "data-syntax-theme"]');
  expect(child).toContain("applySyntaxTheme(snapshot.syntaxTheme, light)");
  expect(child).not.toContain('theme: light ? "vs" : "diff-lab"');
});

test("client theme changes are idempotent, support light Catppuccin, and reject unknown preferences", async () => {
  const themes = await monacoThemes(), defined: string[] = [], applied: string[] = [];
  const attributes = new Map<string, boolean>(), properties = new Map<string, string>();
  const root = { dataset: {} as Record<string, string>, toggleAttribute: (name: string, value: boolean) => attributes.set(name, value), style: { setProperty: (name: string, value: string) => properties.set(name, value) } };
  const apply = installSyntaxThemes({ editor: { defineTheme: (name: string) => defined.push(name), setTheme: (name: string) => applied.push(name) } }, themes, root);
  expect(defined).toHaveLength(12);
  apply("catppuccin-mocha", true); apply("catppuccin-mocha", true);
  expect(applied).toEqual(["diffcompass-catppuccin-mocha-light"]);
  expect(attributes.get("data-code-dark")).toBe(true);
  expect(properties.get("--syntax-background")).toBe("#1e1e2e");
  apply("__proto__", true);
  expect(applied.at(-1)).toBe("diffcompass-github-light");
  expect(attributes.get("data-code-dark")).toBe(false);
});

test("pinned deleted-line renderer refreshes tokens without waiting for completion state", async () => {
  const source = String((await monacoAsset("/vendor/vs/editor.api-CalNCsUg.js"))?.body);
  expect(source).not.toContain('()=>w.model.original.tokenization.backgroundTokenizationState===2');
  expect(source).toContain('w.model.original.onDidChangeTokens,()=>({})');
});
