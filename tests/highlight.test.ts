import { expect, test } from "bun:test";
import { highlightGroups, languageForPath } from "../src/highlight.ts";

test("detects common repository languages and falls back without loading remote assets", () => {
  expect(languageForPath("shared/src/App.kt")).toBe("kotlin");
  expect(languageForPath("ios/App.swift")).toBe("swift");
  expect(languageForPath("Dockerfile.debug")).toBe("dockerfile");
  expect(languageForPath("unknown.extension")).toBe("markdown");
});

test("returns escaped-by-construction token data with both local themes", async () => {
  const [result] = await highlightGroups([{ id: "app", path: "app.ts", lines: ["const value = '<script>';", "return value;"] }]);
  expect(result?.id).toBe("app");
  expect(result?.lines).toHaveLength(2);
  const tokens = result!.lines.flat();
  expect(tokens.map((token) => token.content).join(""))
    .toBe("const value = '<script>';return value;");
  expect(tokens.every((token) => /^[0-9a-f]{6}$/.test(token.light) && /^[0-9a-f]{6}$/.test(token.dark))).toBe(true);
  expect(tokens.some((token) => token.content.includes("<script>"))).toBe(true);
  const keyword = tokens.find((token) => token.content === "const");
  const string = tokens.find((token) => token.content.includes("<script>"));
  expect(keyword).toMatchObject({ light: "d73a49", dark: "f97583" });
  expect(string).toMatchObject({ light: "032f62", dark: "9ecbff" });

  const [alternate] = await highlightGroups([{ id: "app", path: "app.ts", lines: ["const value = 'text';"] }], "diffcompass");
  expect(alternate!.lines[0]!.find((token) => token.content === "const"))
    .toMatchObject({ light: "cf222e", dark: "c792ea" });

  const catppuccinSignatures = new Set<string>();
  for (const theme of ["catppuccin-frappe", "catppuccin-macchiato", "catppuccin-mocha"] as const) {
    const [catppuccin] = await highlightGroups([{ id: theme, path: "app.ts", lines: ["const value = 'text';"] }], theme);
    const catppuccinTokens = catppuccin!.lines[0]!;
    expect(catppuccinTokens.every((token) => /^[0-9a-f]{6}$/.test(token.light) && /^[0-9a-f]{6}$/.test(token.dark))).toBe(true);
    expect(catppuccinTokens.every((token) => token.light === token.dark)).toBe(true);
    catppuccinSignatures.add(catppuccinTokens.map((token) => token.dark).join(","));
  }
  expect(catppuccinSignatures.size).toBe(3);
});
