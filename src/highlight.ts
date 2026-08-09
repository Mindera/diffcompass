import { getSingletonHighlighter, type BuiltinLanguage } from "shiki";

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

function highlighter() {
  highlighterPromise ??= getSingletonHighlighter({
    themes: ["github-light", "github-dark"],
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

export async function highlightGroups(groups: HighlightGroup[]): Promise<Array<{ id: string; lines: HighlightToken[][] }>> {
  const instance = await highlighter();
  return groups.map((group) => {
    const lines = instance.codeToTokensWithThemes(group.lines.join("\n"), {
      lang: languageForPath(group.path),
      themes: { light: "github-light", dark: "github-dark" },
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
