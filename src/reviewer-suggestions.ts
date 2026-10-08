import { parseUnifiedDiff } from "./diff.ts";
import type { AgentChangeActivity } from "./types.ts";

export interface InlineSuggestion {
  path: string;
  line: number;
  endLine: number;
  afterLine: number;
  before: string;
  replacement: string;
  kind: "insert" | "replace" | "delete";
  context: { line: number; content: string };
}

// Derive cards from the saved patch, including proposals created before inline
// cards existed. Never infer source coordinates from the human request label.
export function reviewerSuggestions(activity: AgentChangeActivity): InlineSuggestion[] {
  if (activity.source !== "reviewer" || activity.modelId !== "inline-edit" || activity.changeStatus !== "pending" || !activity.proposal) return [];
  return parseUnifiedDiff(activity.proposal.patch).flatMap(file => file.hunks.flatMap(hunk => {
    const sourceRows = hunk.rows.filter(row => row.oldLine !== null);
    const context = { line: sourceRows[0]?.oldLine ?? 1, content: sourceRows.map(row => row.content.replace(/\r$/, "")).join("\n") };
    const cards: InlineSuggestion[] = [];
    let cursor = hunk.oldCount === 0 ? hunk.oldStart + 1 : hunk.oldStart;
    let start = cursor, removed: string[] = [], added: string[] = [];
    const flush = () => {
      if (!removed.length && !added.length) return;
      const afterLine = removed.length ? cursor - 1 : start - 1;
      cards.push({ path: file.path, line: removed.length ? start : Math.max(1, start - 1), endLine: Math.max(1, afterLine), afterLine,
        before: removed.join("\n"), replacement: added.join("\n"), kind: !removed.length ? "insert" : added.length ? "replace" : "delete", context });
      removed = []; added = [];
    };
    for (const row of hunk.rows) {
      if (row.kind === "meta") continue;
      if (row.kind === "context") { flush(); cursor = row.oldLine! + 1; continue; }
      if (!removed.length && !added.length) start = cursor;
      if (row.kind === "deletion") { removed.push(row.content.replace(/\r$/, "")); cursor = row.oldLine! + 1; }
      else added.push(row.content.replace(/\r$/, ""));
    }
    flush(); return cards;
  }));
}
