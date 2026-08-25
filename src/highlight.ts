import { getSingletonHighlighter, type BuiltinLanguage, type BuiltinTheme, type ThemeRegistration } from "shiki";

export interface HighlightToken {
  content: string;
  light: string;
  dark: string;
  fontStyle: number;
}

export interface HighlightGroup {
  id: string;
  path: string;
  lines: string[];
}

const LANGUAGES: BuiltinLanguage[] = [
  "bash", "c", "cpp", "csharp", "css", "dart", "diff", "dockerfile", "go", "groovy", "html",
  "java", "javascript", "json", "jsonc", "jsx", "kotlin", "make", "markdown", "php",
  "properties", "python", "ruby", "rust", "scss", "shellscript", "sql", "swift", "toml", "tsx",
  "typescript", "vue", "xml", "yaml", "zsh",
];

const EXTENSIONS: Record<string, BuiltinLanguage> = {
  bash: "bash", c: "c", cc: "cpp", cpp: "cpp", cs: "csharp", css: "css", dart: "dart", diff: "diff",
  go: "go", gradle: "groovy", groovy: "groovy", h: "c", hpp: "cpp", htm: "html", html: "html",
  java: "java", js: "javascript", json: "json", jsonc: "jsonc", jsx: "jsx", kt: "kotlin", kts: "kotlin",
  md: "markdown", mjs: "javascript", php: "php", plist: "xml", properties: "properties", py: "python",
  rb: "ruby", rs: "rust", scss: "scss", sh: "shellscript", sql: "sql", swift: "swift", toml: "toml",
  ts: "typescript", tsx: "tsx", vue: "vue", xml: "xml", yaml: "yaml", yml: "yaml", zsh: "zsh",
};

let highlighterPromise: ReturnType<typeof getSingletonHighlighter> | undefined;

export const SYNTAX_THEMES = ["github", "vitesse", "review-tour", "catppuccin-frappe", "catppuccin-macchiato", "catppuccin-mocha"] as const;
export type SyntaxTheme = typeof SYNTAX_THEMES[number];

const REVIEW_TOUR_LIGHT: ThemeRegistration = {
  name: "review-tour-light",
  type: "light",
  colors: { "editor.foreground": "#24292F", "editor.background": "#FFFFFF" },
  settings: [
    { settings: { foreground: "#24292F", background: "#FFFFFF" } },
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#6E7781", fontStyle: "italic" } },
    { scope: ["keyword", "storage", "storage.type", "keyword.operator.new"], settings: { foreground: "#CF222E" } },
    { scope: ["entity.name.function", "support.function", "meta.function-call"], settings: { foreground: "#8250DF" } },
    { scope: ["entity.name.type", "entity.name.class", "support.type", "support.class"], settings: { foreground: "#953800" } },
    { scope: ["string", "string.quoted", "punctuation.definition.string"], settings: { foreground: "#0A3069" } },
    { scope: ["constant.numeric", "constant.language", "constant.character", "variable.language"], settings: { foreground: "#0550AE" } },
    { scope: ["entity.name.tag", "string.regexp"], settings: { foreground: "#116329" } },
  ],
};

const REVIEW_TOUR_DARK: ThemeRegistration = {
  name: "review-tour-dark",
  type: "dark",
  colors: { "editor.foreground": "#D6DEEB", "editor.background": "#09111B" },
  settings: [
    { settings: { foreground: "#D6DEEB", background: "#09111B" } },
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#73849A", fontStyle: "italic" } },
    { scope: ["keyword", "keyword.control"], settings: { foreground: "#FF7AB2" } },
    { scope: ["storage", "storage.type"], settings: { foreground: "#C792EA" } },
    { scope: ["entity.name.type", "entity.name.class", "support.type", "support.class"], settings: { foreground: "#FFC777" } },
    { scope: ["entity.name.function", "support.function", "meta.function-call"], settings: { foreground: "#82AAFF" } },
    { scope: ["string", "string.quoted", "punctuation.definition.string"], settings: { foreground: "#C3E88D" } },
    { scope: ["constant.character.escape", "string.regexp"], settings: { foreground: "#89DDFF" } },
    { scope: ["constant.numeric", "constant.language", "variable.language"], settings: { foreground: "#F78C6C" } },
  ],
};

const THEME_PAIRS: Record<SyntaxTheme, { light: BuiltinTheme | ThemeRegistration; dark: BuiltinTheme | ThemeRegistration }> = {
  github: { light: "github-light", dark: "github-dark" },
  vitesse: { light: "vitesse-light", dark: "vitesse-dark" },
  "review-tour": { light: REVIEW_TOUR_LIGHT, dark: REVIEW_TOUR_DARK },
  "catppuccin-frappe": { light: "catppuccin-frappe", dark: "catppuccin-frappe" },
  "catppuccin-macchiato": { light: "catppuccin-macchiato", dark: "catppuccin-macchiato" },
  "catppuccin-mocha": { light: "catppuccin-mocha", dark: "catppuccin-mocha" },
};

function highlighter() {
  highlighterPromise ??= getSingletonHighlighter({
    themes: [
      "github-light", "github-dark", "vitesse-light", "vitesse-dark",
      "catppuccin-latte", "catppuccin-frappe", "catppuccin-macchiato", "catppuccin-mocha",
      REVIEW_TOUR_LIGHT, REVIEW_TOUR_DARK,
    ],
    langs: LANGUAGES,
  });
  return highlighterPromise;
}

export function languageForPath(path: string): BuiltinLanguage {
  const basename = path.split("/").at(-1)?.toLowerCase() ?? "";
  if (basename === "dockerfile" || basename.startsWith("dockerfile.")) return "dockerfile";
  if (basename === "makefile" || basename.startsWith("makefile.")) return "make";
  const extension = basename.includes(".") ? basename.split(".").at(-1)! : "";
  return EXTENSIONS[extension] ?? "markdown";
}

function colorClass(color: string | undefined): string {
  return (color ?? "").replace(/^#/, "").toLowerCase();
}

export async function highlightGroups(groups: HighlightGroup[], theme: SyntaxTheme = "github"): Promise<Array<{ id: string; lines: HighlightToken[][] }>> {
  const instance = await highlighter();
  const themes = THEME_PAIRS[theme];
  return groups.map((group) => {
    const lines = instance.codeToTokensWithThemes(group.lines.join("\n"), {
      lang: languageForPath(group.path),
      themes,
    });
    return {
      id: group.id,
      lines: lines.map((line) => line.map((token) => ({
        content: token.content,
        light: colorClass(token.variants.light?.color),
        dark: colorClass(token.variants.dark?.color),
        fontStyle: token.variants.dark?.fontStyle ?? token.variants.light?.fontStyle ?? 0,
      }))),
    };
  });
}
