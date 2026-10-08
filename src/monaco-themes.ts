import type { editor } from "monaco-editor";
import { SYNTAX_THEMES, syntaxThemeRegistration, type SyntaxTheme } from "./highlight";

type Palette = { fg: string; bg: string; settings: { scope?: string | string[]; settings: { foreground?: string; fontStyle?: string } }[] };
// Monaco's Monarch token categories are not TextMate scopes. Adapt the palette,
// not the tokenizer: providers, editing, workers and semantic navigation stay native.
const SCOPES: Record<string, string> = {
  comment: "comment", "comment.doc": "comment.block.documentation",
  keyword: "keyword", "keyword.flow": "keyword.control", "keyword.type": "storage.type",
  "keyword.operator": "keyword.operator", operator: "keyword.operator",
  type: "entity.name.type", "type.identifier": "entity.name.type", "type.predefined": "support.type",
  identifier: "variable.other.readwrite", variable: "variable.other.readwrite", "variable.predefined": "variable.language",
  constant: "constant", "constant.number": "constant.numeric", number: "constant.numeric",
  string: "string", "string.escape": "constant.character.escape", "string.invalid": "invalid.illegal",
  "string.link": "markup.underline.link", regexp: "string.regexp", "regexp.escape": "constant.character.escape",
  delimiter: "punctuation", "delimiter.bracket": "punctuation.section.braces",
  tag: "entity.name.tag", "attribute.name": "entity.other.attribute-name", "attribute.value": "string",
  metatag: "meta.tag", annotation: "storage.type.annotation", function: "entity.name.function",
  namespace: "entity.name.namespace", invalid: "invalid.illegal",
  "keyword.md": "markup.heading", "string.md": "markup.inline.raw",
  "string.link.md": "markup.underline.link", "variable.md": "markup.underline.link",
  "strong.md": "markup.bold", "emphasis.md": "markup.italic",
};

// TextMate palettes can use alpha (not supported by Monaco token rules).
// Composite it against the code background rather than silently dropping it.
function rgb(hex: string): number[] {
  let value = hex.replace(/^#/, "");
  if (value.length <= 4) value = [...value].map(char => char + char).join("");
  if (!/^[\da-f]{6}([\da-f]{2})?$/i.test(value)) throw Error(`Invalid theme color: ${hex}`);
  return value.match(/../g)!.map(channel => parseInt(channel, 16));
}
function opaque(color: string, background: string): string {
  const [r, g, b, a = 255] = rgb(color), bg = rgb(background);
  return [r!, g!, b!].map((channel, index) => Math.round(channel * a / 255 + bg[index]! * (1 - a / 255)).toString(16).padStart(2, "0")).join("");
}

export function tokenStyle(theme: Palette, scope: string): { foreground: string; fontStyle: string } {
  let foreground = theme.fg, fontStyle = "", foregroundRank = -1, styleRank = -1;
  for (const entry of theme.settings) {
    const scopes = (Array.isArray(entry.scope) ? entry.scope : [entry.scope || ""]).flatMap(value => value.split(","));
    for (const candidate of scopes.map(value => value.trim())) {
      // Contextual selectors cannot be represented by a single Monarch token.
      if (!candidate || !/^[\w.-]+$/.test(candidate) || !(scope === candidate || scope.startsWith(candidate + "."))) continue;
      const rank = candidate.split(".").length;
      if (entry.settings.foreground !== undefined && rank >= foregroundRank) { foreground = entry.settings.foreground; foregroundRank = rank; }
      if (entry.settings.fontStyle !== undefined && rank >= styleRank) { fontStyle = entry.settings.fontStyle; styleRank = rank; }
    }
  }
  return { foreground: opaque(foreground, theme.bg), fontStyle: fontStyle.split(/\s+/).filter(value => ["italic", "bold", "underline"].includes(value)).join(" ") };
}

type ThemeCatalog = Record<SyntaxTheme, { light: editor.IStandaloneThemeData; dark: editor.IStandaloneThemeData }>;
let catalog: Promise<ThemeCatalog> | undefined;
export function monacoThemes() {
  return catalog ??= (async () => {
    const result = {} as ThemeCatalog;
    for (const name of SYNTAX_THEMES) {
      const pair = {} as typeof result[typeof name];
      for (const mode of ["light", "dark"] as const) {
        const theme = await syntaxThemeRegistration(name, mode === "light");
        const foreground = "#" + opaque(theme.fg, theme.bg), background = "#" + opaque(theme.bg, theme.bg);
        const colors = Object.fromEntries(Object.entries(theme.colors || {}).filter(([key]) => /^(editor|diffEditor|peekView|input|list|scrollbar|selection|focusBorder)/.test(key)));
        pair[mode] = {
          base: theme.type === "light" ? "vs" : "vs-dark", inherit: true,
          rules: [{ token: "", foreground: foreground.slice(1), fontStyle: "" }, ...Object.entries(SCOPES).map(([token, scope]) => ({ token, ...tokenStyle(theme, scope) }))],
          colors: {
            ...colors, "editor.foreground": foreground, "editor.background": background,
            "editorGutter.background": background,
            "diffEditor.unchangedRegionBackground": colors["editorWidget.background"] || background,
            "diffEditor.unchangedRegionForeground": foreground,
          },
        };
      }
      result[name] = pair;
    }
    return result;
  })();
}
