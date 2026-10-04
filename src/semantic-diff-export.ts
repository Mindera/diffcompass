import { cachedSemanticSummaries, type SemanticSummary } from "./semantic-diff.ts";
import type { GitComparison } from "./types.ts";
const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
function lines(summary: SemanticSummary): string[] {
  return [summary.path, `${summary.status}: ${summary.message}`, summary.notice, `Parser: ${summary.engine}`, `Before: ${summary.beforeTree}; after: ${summary.afterTree ?? "not captured"}`, `SHA-256 before: ${summary.beforeHash ?? "unavailable"}; after: ${summary.afterHash ?? "unavailable"}`, ...summary.changes.flatMap((change) => [`${change.name}: ${change.categories.join(", ")}${change.ambiguous ? " (ambiguous overload match)" : ""}`, ...[change.before, change.after].flatMap((anchor) => anchor ? [`${anchor.side === "old" ? "Before" : "After"} ${anchor.path}:${anchor.startLine}–${anchor.endLine}: ${anchor.signature}`] : [])])];
}
/** Export only requested cached summaries; preserve provenance and disclose coverage. */
export function semanticExport(comparison: GitComparison, format: "markdown" | "html"): string {
  const summaries = cachedSemanticSummaries(comparison);
  if (!summaries.length) return "";
  const coverage = `Requested syntax summaries: ${summaries.length} of ${comparison.files.length} changed files. Only requested results still in the bounded server cache are included; this is not review-wide analysis. Summaries are derived and are not persisted in the saved review.`;
  if (format === "html") return `<section aria-label="Requested syntax summaries"><h2>Syntax changes</h2><p>${escape(coverage)}</p>${summaries.map((summary) => `<details><summary>${escape(summary.path)}</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${escape(lines(summary).join("\n"))}</pre></details>`).join("")}</section>`;
  const fence = (text: string) => { const marker = "`".repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((match) => match[0].length + 1))); return `${marker}text\n${text}\n${marker}`; };
  return `\n\n## Syntax changes\n\n${coverage}\n\n${summaries.map((summary) => fence(lines(summary).join("\n"))).join("\n\n")}\n`;
}
