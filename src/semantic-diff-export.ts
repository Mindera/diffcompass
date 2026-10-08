import { cachedSemanticSummaries, type SemanticSummary } from "./semantic-diff.ts";
import { semanticPresentation as presentation } from "../public/semantic-diff-presentation.js";
// @ts-expect-error Bun embeds the same summary styles used by the live review.
import summaryStyles from "../public/semantic-diff.css" with { type: "text" };
import type { GitComparison, TourOutline } from "./types.ts";
import { fileExplanationFor, type FileExplanation } from "./file-explanations.ts";

const text = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/([\\`*_{}\[\]()#+.!|~-])/g, "\\$1");
function code(value: string): string {
  const marker = "`".repeat(Math.max(1, ...[...value.matchAll(/`+/g)].map((match) => match[0].length + 1)));
  return `${marker} ${value.replace(/[\r\n]/g, " ")} ${marker}`;
}
function fence(value: string): string {
  const marker = "`".repeat(Math.max(3, ...[...value.matchAll(/`+/g)].map((match) => match[0].length + 1)));
  return `${marker}text\n${value}\n${marker}`;
}
const details = (title: string, body: string) => `<details>\n<summary>${title}</summary>\n\n${body}\n\n</details>`;

function markdownExplanation(explanation?: FileExplanation): string {
  return [
    ...(explanation?.entries ?? []).flatMap((entry) => [text(entry.summary), entry.steps.length ? details("Related tour stops", entry.steps.map((step) => `- ${text(step.title)} — ${code(`${step.anchor.side === "old" ? "Before" : "After"} ${step.anchor.path}:${step.anchor.startLine}–${step.anchor.endLine}`)}`).join("\n")) : ""]),
    text(explanation?.message ?? "No saved explanation for this file. Only the requested parser details are included."),
    explanation?.omitted ? `${explanation.omitted} additional tour notes are not shown here.` : "",
    explanation?.source ? details("Explanation source", fence(`Before tree: ${explanation.source.beforeTree}\nAfter tree: ${explanation.source.afterTree}\nComparison identity: ${explanation.source.identity}`)) : "",
  ].filter(Boolean).join("\n\n");
}
function markdownSummary(summary: SemanticSummary, explanation?: FileExplanation): string {
  const [heading, description] = presentation.summaryStatus(summary);
  const inventory = summary.changes.map((change) => [
    `#### ${code(change.name)} · ${presentation.kindLabel(change)}`,
    change.categories.map(presentation.categoryLabel).join(" · "),
    ...(change.ambiguous ? ["Ambiguous overload match; these versions were not paired."] : []),
    ...[change.before, change.after].flatMap((anchor) => anchor ? [fence(`${anchor.side === "old" ? "Before" : "After"} ${anchor.path}:${anchor.startLine}–${anchor.endLine}\n${anchor.signature}`)] : []),
  ].join("\n\n")).join("\n\n");
  const evidence = [
    `File: ${summary.path}`, `${summary.status}: ${summary.message}`, summary.notice,
    `Parser: ${summary.engine}; language: ${summary.language ?? "unsupported language"}`,
    `Before tree: ${summary.beforeTree}; after tree: ${summary.afterTree ?? "not captured"}`,
    `SHA-256 before: ${summary.beforeHash ?? "unavailable"}; after: ${summary.afterHash ?? "unavailable"}`,
    "Computed on request; not saved in the review. This export contains only requested summaries still in the server cache at export time (up to 32 files).",
  ].join("\n");
  return [
    `### ${code(summary.path)}`, markdownExplanation(explanation), summary.status !== "analysed" || !summary.changes.length ? `**Code details: ${text(heading)}**` : "", description ? text(description) : "",
    summary.renamed ? "This file was renamed. Its before and after paths are preserved in code details." : "",
    (summary.totalChanges ?? 0) > summary.changes.length ? `Showing ${summary.changes.length} of ${summary.totalChanges} code changes. Use the diff for the rest.` : "",
    inventory ? details(`All code details (${summary.changes.length} items)`, `Parsed declarations, including properties and local variables. ${presentation.scope}\n\n${inventory}`) : "",
    details("How this summary was made", fence(evidence)),
  ].filter(Boolean).join("\n\n");
}

/** Format already requested results; this never starts analysis or reads live source. */
export function renderSemanticSummaries(summaries: SemanticSummary[], totalFiles: number, format: "markdown" | "html", explanations = new Map<string, FileExplanation>(), omitted = 0): string {
  const paths = [...new Set([...explanations.keys(), ...summaries.map((summary) => summary.path)])];
  if (!paths.length) return "";
  const byPath = new Map(summaries.map((summary) => [summary.path, summary]));
  const coverage = `Saved tour explanations: ${[...explanations.values()].filter((entry) => entry.status === "available").length} of ${totalFiles} changed files${omitted ? ` (${omitted} additional explanations omitted by the 200-file export limit)` : ""}. These explanations persist with the tour and are included only when their captured comparison matches. Requested change summaries: ${summaries.length} of ${totalFiles} changed files. Requests can come from the reviewer or tour preparation. Only requested parser results still in the bounded server cache are included; this is not review-wide analysis. Parser summaries are derived and are not persisted in the saved review.`;
  if (format === "html") return `<section class="semantic-export" aria-label="What changed"><style>${summaryStyles}\nbody{grid-template-columns:minmax(0,1fr)}.tabs{min-width:0;overflow-x:auto}.tabs>button{flex-shrink:0}.semantic-export{--border:var(--line,#223044);padding:18px;overflow-wrap:anywhere;max-width:100%}.semantic-export>h2{font-size:20px;margin:0 0 8px}.semantic-export>p{font-size:12px}.semantic-export .semantic-summary{padding:18px 0}.semantic-export h3.semantic-path{margin:0 0 12px;font-size:16px}.semantic-export .muted{color:var(--soft,#8794a7)}.semantic-export .semantic-source-links{font-size:12px;color:var(--soft,#8794a7)}</style><h2>What changed</h2><p>${presentation.escape(coverage)}</p>${paths.map((path) => { const summary = byPath.get(path), explanation = explanations.get(path); return `<article class="semantic-summary" aria-label="${presentation.escape(path)}"><h3 class="semantic-path">${presentation.escape(path)}</h3>${summary ? presentation.summaryHtml(summary, { offline: true, explanation }) : presentation.explanationHtml(path, explanation, { offline: true }) + '<p class="muted">Parser details were not requested or are no longer cached.</p>'}</article>`; }).join("")}</section>`;
  return `\n\n## What changed\n\n${coverage}\n\n${paths.map((path) => {
    const summary = byPath.get(path), explanation = explanations.get(path);
    return summary ? markdownSummary(summary, explanation) : `### ${code(path)}\n\n${markdownExplanation(explanation)}\n\nParser details were not requested or are no longer cached.`;
  }).join("\n\n")}\n`;
}

/** Export only cached results whose exact captured comparison identity still matches. */
export function semanticExport(comparison: GitComparison, format: "markdown" | "html", outline?: TourOutline): string {
  const summaries = cachedSemanticSummaries(comparison);
  const explanations = new Map<string, FileExplanation>();
  let omitted = 0;
  for (const path of new Set(outline?.phases.flatMap((phase) => phase.fileChanges.map((change) => change.path)))) {
    const explanation = fileExplanationFor(comparison, outline, path);
    if (explanation.status !== "available") continue;
    if (explanations.size >= 200) { omitted++; continue; }
    explanations.set(path, explanation);
  }
  for (const summary of summaries) if (!explanations.has(summary.path)) {
    const explanation = fileExplanationFor(comparison, outline, summary.path);
    if (explanation.status !== "available") explanations.set(summary.path, explanation);
  }
  return renderSemanticSummaries(summaries, comparison.files.length, format, explanations, omitted);
}
