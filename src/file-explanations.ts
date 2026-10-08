import { createHash } from "node:crypto";
import { comparisonFingerprint } from "./dry-runs.ts";
import type { GitComparison, TourAnchor, TourOutline } from "./types.ts";

export const FILE_EXPLANATION_PROMPT = `Each fileChanges.summary is the explanation shown under "What changed" for that file, not a declaration inventory. Write 2–3 concise plain-text sentences, at most 120 words: explain the concrete before/after mechanism (or the role introduced/removed for an added/deleted file), why that mechanism matters in this change, and one specific review concern when supported. Explain relationships or sequencing that a list of symbols would miss. Do not merely list added functions, properties or inputs, or say "the code changed". For documentation, describe the changed guidance, not an implemented runtime effect. Ground claims in the selected comparison and inspected evidence; distinguish intended outcomes from demonstrated behaviour. Do not invent author intent, test results, runtime guarantees, or unsupported rationale. For example, "The host retains a popped modal until its exit completes, so navigation can choose the destination before the sheet disappears. Check that cancellation also releases the retained entry." is useful only when the code supports that mechanism. Do not copy the example into unrelated reviews. Do not supply summarySource: the server records source identity.`;

export interface FileExplanation {
  status: "available" | "missing" | "stale";
  message: string;
  entries: Array<{ phase: string; summary: string; steps: Array<{ title: string; anchor: TourAnchor }> }>;
  omitted: number;
  source?: { beforeTree: string; afterTree: string; identity: string };
}

/** Covers the complete comparison because a file's explanation can refer to collaborators. */
const sourceCache = new WeakMap<GitComparison, { values: unknown[]; stamp: string }>();
export function fileSummarySource(comparison: GitComparison): string | undefined {
  if (!comparison.sourceTree) return;
  const values = [comparison.base, comparison.mergeBase, comparison.head, comparison.patch, comparison.sourceTree];
  const cached = sourceCache.get(comparison);
  if (cached && values.every((value, index) => value === cached.values[index])) return cached.stamp;
  const stamp = createHash("sha256").update(JSON.stringify(["file-explanation-1", comparison.sourceTree, comparisonFingerprint(comparison)])).digest("hex");
  sourceCache.set(comparison, { values, stamp });
  return stamp;
}

/** Project existing tour summaries; never generate, persist a second copy, or read live source. */
export function fileExplanationFor(comparison: GitComparison, outline: TourOutline | undefined, path: string): FileExplanation {
  const result: FileExplanation = { status: "missing", message: "No explanation for this file yet. Start a tour or ask the agent about this change.", entries: [], omitted: 0 };
  const file = comparison.files.find((entry) => entry.path === path);
  if (!file || !outline) return result;
  const source = fileSummarySource(comparison);
  const lines = { old: new Set<number>(), new: new Set<number>() };
  for (const hunk of file.hunks) for (const row of hunk.rows) if (row.kind !== "meta") {
    if (row.oldLine !== null) lines.old.add(row.oldLine);
    if (row.newLine !== null) lines.new.add(row.newLine);
  }
  let stale = false;
  for (const phase of outline.phases) {
    const change = phase.fileChanges.find((entry) => entry.path === path);
    if (!change) continue;
    const steps = phase.steps.filter((step) => step.anchor.path === path);
    if (!source || change.summarySource !== source || steps.some((step) => step.outdated)) { stale = true; continue; }
    if (typeof change.summary !== "string" || !change.summary.trim() || change.summary.length > 4_000) continue;
    if (result.entries.length >= 6) { result.omitted++; continue; }
    const validSteps = steps.filter(({ anchor }) => {
      if (!Number.isSafeInteger(anchor.startLine) || !Number.isSafeInteger(anchor.endLine) || anchor.startLine < 1 || anchor.endLine < anchor.startLine) return false;
      const side = lines[anchor.side];
      if (!side || anchor.endLine - anchor.startLine + 1 > side.size) return false;
      for (let line = anchor.startLine; line <= anchor.endLine; line++) if (!side.has(line)) return false;
      return true;
    }).slice(0, 8);
    result.entries.push({ phase: phase.title, summary: change.summary, steps: validSteps.map(({ title, anchor }) => ({ title, anchor: { ...anchor, path: (anchor.side === "old" ? file.oldPath : file.newPath) ?? path } })) });
  }
  if (result.entries.length) {
    result.status = "available";
    result.source = { beforeTree: comparison.mergeBase, afterTree: comparison.sourceTree!, identity: source! };
    result.message = "From the tour agent’s review of this captured comparison. This is an explanation of the code, not a runtime verification.";
    if (stale) result.message += " Older notes for this file were omitted.";
  } else if (stale) {
    result.status = "stale";
    result.message = "The saved tour explanation is from another comparison, or its source version was not recorded. Ask the agent for an updated explanation; a new tour will save one for this comparison.";
  }
  return result;
}
