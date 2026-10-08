import type { AgentChangeActivity, DiffFile } from "./types.ts";

export type SavedInlineEdit = NonNullable<AgentChangeActivity["inlineEdit"]>;

/** A longer Markdown fence keeps literal backticks inside the replacement. */
export function githubSuggestionBody(replacement: string): string {
  const runs = replacement.match(/`+/g) ?? [];
  const fence = "`".repeat(runs.reduce((length, run) => Math.max(length, run.length + 1), 3));
  return `${fence}suggestion\n${replacement}\n${fence}`;
}

export function githubSuggestionRangeMatches(files: DiffFile[], edit: SavedInlineEdit): boolean {
  if (!Number.isSafeInteger(edit.line) || !Number.isSafeInteger(edit.endLine) || edit.line < 1 || edit.endLine < edit.line || edit.endLine - edit.line > 99) return false;
  const file = files.find(file => file.path === edit.path && file.newPath === edit.path && file.status !== "deleted");
  if (!file || file.metadata.some(line => /^(Binary files |GIT binary patch|(?:new|old|deleted file|new file) mode 120000)/.test(line))) return false;
  return file.hunks.some(hunk => {
    const rows = hunk.rows.filter(row => row.newLine !== null && row.newLine >= edit.line && row.newLine <= edit.endLine && row.kind !== "meta");
    return rows.length === edit.endLine - edit.line + 1 && rows.every((row, index) => row.newLine === edit.line + index) &&
      rows.map(row => row.content.replace(/\r$/, "")).join("\n") === edit.expectedContent;
  });
}
