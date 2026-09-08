import type { ReviewSession } from "./session.ts";
import type { CallFlow, DiffFile, DiffRow, FindingDisposition, IssueAssessment, LinkedIssueContext, ReviewerTaskContext, ReviewAdaptiveDiagram, ReviewArchitecture, ReviewComment, ReviewFinding } from "./types.ts";
import type { HighlightGroup, HighlightToken } from "./highlight.ts";
import { buildNeedsAttention } from "./attention.ts";
// @ts-expect-error Bun's text loader embeds Mermaid in the self-contained HTML export.
import mermaidScript from "mermaid/dist/mermaid.min.js" with { type: "text" };

export type ExportFormat = "markdown" | "html";
export interface HtmlExportOptions {
  includeFindings?: boolean;
  includeCallFlows?: boolean;
  includeDiagrams?: boolean;
  diffWrap?: "scroll" | "wrap";
  highlightedGroups?: Array<{ id: string; lines: HighlightToken[][] }>;
  markdownPreviews?: Array<{ path: string; side: "old" | "new"; content: string }>;
}

const findingDispositionLabels: Record<FindingDisposition, string> = {
  accepted: "Risk accepted",
  "false-positive": "False positive",
  intentional: "Intentional",
  deferred: "Deferred",
  fixed: "Fixed (verified)",
  "obsolete-after-refresh": "Obsolete after refresh",
};

function findingDisposition(finding: ReviewFinding): string {
  return finding.disposition
    ? findingDispositionLabels[finding.disposition]
    : finding.status === "dismissed"
      ? "Deferred"
      : finding.status === "converted-to-feedback"
        ? "Added to feedback"
        : "Open";
}

const findingEvidenceLabels = new Map([
  ["observation", "Observation"], ["changed code", "Changed code"],
  ["causal path", "Causal path"], ["execution path", "Causal path"], ["runtime path", "Causal path"],
  ["impact", "Impact"], ["outcome", "Impact"],
  ["coverage", "Coverage"], ["test coverage", "Coverage"],
]);

function findingEvidenceParts(evidence: string): Array<{ label: string; body: string }> {
  let chunks = evidence.trim().split(/\n+/).map((part) => part.replace(/^\s*[-*•]\s+/, "").trim()).filter(Boolean);
  if (chunks.length === 1) {
    const sentences = chunks[0]!.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g)?.map((part) => part.trim()).filter(Boolean) ?? [];
    if (sentences.length > 1) chunks = sentences;
  }
  return chunks.map((part, index) => {
    const labelled = /^([^:]{1,32}):\s+(.+)$/.exec(part);
    const label = labelled ? findingEvidenceLabels.get(labelled[1]!.trim().toLowerCase()) : undefined;
    return { label: label ?? (chunks.length === 1 ? "Evidence" : `Evidence ${index + 1}`), body: label ? labelled![2]!.trim() : part };
  });
}

function findingEvidenceHtml(evidence: string): string {
  return `<ol class="finding-evidence-list">${findingEvidenceParts(evidence).map((part) => `<li><strong>${escapeHtml(part.label)}</strong><div>${inlineHtml(part.body)}</div></li>`).join("")}</ol>`;
}

function markdownFence(language: string, content: string): string {
  const longest = Math.max(2, ...[...content.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(longest + 1);
  return `${fence}${language}\n${content}\n${fence}`;
}

function markdownText(value: unknown): string {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function reviewLocation(path: string, side: "old" | "new", line: number): string {
  return /\.png$/i.test(path) ? `${path} · ${side} image` : `${path}:${line} (${side})`;
}

function commentLocation(comment: ReviewComment): string {
  const endLine = comment.endLine ?? comment.line;
  if (/\.png$/i.test(comment.path)) return `${comment.path} · ${comment.side} image`;
  return `${comment.path}:${comment.line}${endLine !== comment.line ? `-${endLine}` : ""} (${comment.side})`;
}

function commentScope(comment: ReviewComment, session: ReviewSession): string {
  if ((comment.scope ?? "line") === "stop") {
    const step = session.outline?.phases.flatMap((phase) => phase.steps).find((candidate) => candidate.id === comment.stepId);
    return `Tour stop${step ? `: ${step.title}` : comment.stepId ? `: ${comment.stepId}` : ""}`;
  }
  return (comment.scope ?? "line") === "range" ? "Selected range" : "Line";
}

function markdownArchitecture(label: string, architecture: ReviewArchitecture): string[] {
  return [`### ${label}: ${markdownText(architecture.title)}`, "", markdownText(architecture.summary), "", "Relationship changes:", "", ...architecture.dependencyChanges.map((change) => `- ${markdownText(change)}`), "", "Affected changed files:", "", ...architecture.affectedFiles.map((path) => `- ${markdownText(path)}`), "", markdownFence("mermaid", architecture.mermaid), ""];
}

function markdownIssueAssessment(issue: LinkedIssueContext | undefined, assessment: IssueAssessment | undefined, reviewerTask?: ReviewerTaskContext): string[] {
  if (reviewerTask) {
    const lines = ["## Task-to-implementation assessment", "", "Source: reviewer-supplied task description, stored locally in this review session.", "", "Provider scope: this task description was not sent to GitHub. No issue, pull request, comment, or other provider resource was requested for this assessment.", "", "### Task description", "", markdownFence("markdown", reviewerTask.body), ""];
    if (reviewerTask.criteriaStatus === "not-found") return [...lines, "No explicit acceptance criteria were found in the saved task description.", ""];
    if (reviewerTask.assessmentError) return [...lines, reviewerTask.assessmentError, ""];
    if (reviewerTask.assessmentPending) return [...lines, "Assessing the saved acceptance criteria in the background.", ""];
    if (!reviewerTask.assessment) return [...lines, "The saved task is ready to assess when a review agent is available.", ""];
    lines.push("Model assessment based on cited repository paths; statuses are not verified test results.", "");
    for (const item of reviewerTask.assessment.items) {
      lines.push(`### ${markdownText(item.status)}: ${markdownText(item.criterion)}`, "", markdownText(item.evidence), "", `Repository evidence: ${item.evidencePaths.length ? item.evidencePaths.map(markdownText).join(", ") : "none cited"}`, "");
    }
    return lines;
  }
  if (!issue) return ["## Issue-to-implementation assessment", "", "No linked issue was reported for this pull request. No issue or related provider resources were fetched.", "", "Provider scope: one same-repository closing issue; related issues and earlier pull requests were not requested. Only issue metadata and explicit criteria are retained.", ""];
  const lines = ["## Issue-to-implementation assessment", "", `Source: [#${issue.number} ${markdownText(issue.title)}](${issue.url})`, "", "Provider scope: one same-repository closing issue; related issues and earlier pull requests were not requested. Only issue metadata and explicit criteria are retained.", ""];
  if (issue.access !== "available") return [...lines, `The linked issue is ${issue.access}; its content was not included.`, ""];
  if (issue.criteriaStatus === "malformed") return [...lines, "The linked issue body was malformed or exceeded the safe limit; no criteria were assessed.", ""];
  if (issue.criteriaStatus === "not-found") return [...lines, "No explicit acceptance criteria were found in the issue body.", ""];
  if (!assessment) return [...lines, "Start the tour to map the explicit acceptance criteria to repository evidence.", ""];
  lines.push("Model assessment based on cited repository paths; statuses are not verified test results.", "");
  for (const item of assessment.items) {
    lines.push(`### ${markdownText(item.status)}: ${markdownText(item.criterion)}`, "", markdownText(item.evidence), "", `Repository evidence: ${item.evidencePaths.length ? item.evidencePaths.map(markdownText).join(", ") : "none cited"}`, "");
  }
  return lines;
}

function githubStatusLabel(state: string): string {
  return state.trim().toLocaleLowerCase().replaceAll("_", " ").replace(/\b\w/g, (character) => character.toLocaleUpperCase());
}

function githubCheckStatus(state: string): { label: string; explanation: string } {
  const value = state.trim().toLocaleUpperCase();
  if (value === "IN_PROGRESS") return { label: "Running", explanation: "GitHub has not reported a final result for this check." };
  if (["QUEUED", "PENDING", "REQUESTED", "WAITING"].includes(value)) return { label: "Pending", explanation: "GitHub has not reported a final result for this check." };
  if (value === "SUCCESS") return { label: "Passed", explanation: "GitHub reported a successful result." };
  if (["FAILURE", "FAILED", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED"].includes(value)) return { label: "Needs attention", explanation: `GitHub reported ${githubStatusLabel(value)}. Open the check run for provider details.` };
  if (["NEUTRAL", "SKIPPED", "COMPLETED"].includes(value)) return { label: "Completed", explanation: `GitHub reported ${githubStatusLabel(value)}.` };
  return { label: githubStatusLabel(value), explanation: "GitHub reported this state; the review snapshot does not include an explanation." };
}

function githubMergeabilitySummary(mergeable: string | undefined, mergeStateStatus: string | undefined): string[] {
  const details: string[] = [];
  if (mergeable === "MERGEABLE") details.push("No merge conflict reported by GitHub.");
  else if (mergeable === "CONFLICTING") details.push("GitHub reports merge conflicts between the pull request branches.");
  else if (mergeable === "UNKNOWN") details.push("GitHub did not report whether the pull request branches merge cleanly.");
  if (mergeStateStatus === "UNSTABLE") details.push("GitHub has not provided a stable merge status. This review snapshot does not include why.");
  else if (mergeStateStatus) details.push(`GitHub also reported ${githubStatusLabel(mergeStateStatus)} as the merge status. This snapshot does not include an explanation for that status.`);
  return details;
}

function githubPullRequestStatusSummary(state: string | undefined, mergeable: string | undefined, mergeStateStatus: string | undefined): { heading: string; details: string[] } {
  if (state === "MERGED") return { heading: "Pull request status", details: ["This pull request has been merged. Mergeability is no longer applicable."] };
  return { heading: "Mergeability", details: githubMergeabilitySummary(mergeable, mergeStateStatus) };
}

function markdownGitHubChecks(session: ReviewSession): string[] {
  const pullRequest = session.pullRequest;
  if (!pullRequest) return [];
  const lines = ["## GitHub checks", "", "Snapshot captured when this review was loaded. These statuses do not include a provider-supplied reason; this review did not fetch check or workflow details.", ""];
  const pullRequestStatus = githubPullRequestStatusSummary(pullRequest.state, pullRequest.mergeable, pullRequest.mergeStateStatus);
  for (const detail of pullRequestStatus.details) lines.push(`- ${pullRequestStatus.heading}: ${detail}`);
  for (const check of pullRequest.checks) {
    const status = githubCheckStatus(check.state);
    lines.push(`- ${markdownText(check.name)} — **${status.label}**. ${status.explanation}${check.url ? ` [View run in GitHub](${check.url})` : ""}`);
  }
  if (pullRequest.checks.length === 0) lines.push("- GitHub reported no checks for this pull request.");
  return [...lines, ""];
}

function markdownAdaptiveDiagram(label: string, diagram: ReviewAdaptiveDiagram): string[] {
  return [`### ${label}: ${markdownText(diagram.title)}`, "", markdownText(diagram.summary), "", `Why this view: ${markdownText(diagram.materiallyImprovesUnderstanding)}`, "", "Repository evidence:", "", ...diagram.evidence.map((item) => `- ${markdownText(item)}`), "", "Affected changed files:", "", ...diagram.affectedFiles.map((path) => `- ${markdownText(path)}`), "", markdownFence("mermaid", diagram.mermaid), ""];
}

function markdown(session: ReviewSession): string {
  const outline = session.outline;
  const briefing = buildNeedsAttention(session.comparison, outline, session.pullRequest);
  const lines = [
    `# ${markdownText(outline?.title ?? `Code review: ${session.comparison.repositoryName}`)}`,
    "",
    markdownText(outline?.summary ?? "No guided tour was generated."),
    "",
    "## Comparison",
    "",
    `- Repository: ${markdownText(session.comparison.repositoryName)}`,
    `- Base: ${markdownText(session.comparison.base)}`,
    `- Merge base: ${markdownText(session.comparison.mergeBase)}`,
    `- Head: ${markdownText(session.comparison.head)}`,
    `- Status: ${session.status}`,
    "",
  ];
  if (briefing.signals.length > 0) {
    const findingCount = briefing.signals.filter((signal) => signal.kind === "finding").length;
    lines.push("## Needs your attention", "", `${briefing.signals.length} review cues shown; ${findingCount === 0 ? "none are" : findingCount === 1 ? "one is" : `${findingCount} are`} unresolved P0/P1 findings. Other cues point to contracts, tests, flows, stale analysis, or GitHub status; lower-priority findings remain in Findings.`, "");
    for (const signal of briefing.signals) {
      const target = signal.target.kind === "finding" ? `finding ${signal.target.findingId}` : signal.target.kind === "call-flow" ? `call flow ${signal.target.callFlowId}` : signal.target.kind === "file" ? `${signal.target.path}${signal.target.line ? `:${signal.target.line}` : ""}` : `${signal.target.section} section`;
      lines.push(`- **${markdownText(signal.title)}** — ${markdownText(signal.detail)} (open ${markdownText(target)}; ${signal.basis === "bounded-heuristic" ? "bounded heuristic" : "repository evidence"})`, `  Evidence: ${markdownText(signal.evidence)}`);
    }
    lines.push("");
  }
  lines.push("## First-pass review time", "", `About ${briefing.estimate.minutes} minutes for a first pass, based on the visible diff and review signals. This is a rough planning aid, not a risk score or quality rating.`, "", "Contributing factors:", "", ...briefing.estimate.factors.map((factor) => `- ${markdownText(factor.label)}: +${factor.minutes} min — ${markdownText(factor.detail)} (${factor.basis === "bounded-heuristic" ? "bounded heuristic" : "repository evidence"})`), "");
  if (session.pullRequest) lines.push(...markdownGitHubChecks(session), ...markdownIssueAssessment(session.pullRequest.linkedIssue, outline?.issueAssessment, session.pullRequest.reviewerTask));
  if (outline?.phases.length) {
    lines.push("## Tour", "");
    let stopNumber = 0;
    outline.phases.forEach((phase, phaseIndex) => {
      lines.push(`### Phase ${phaseIndex + 1}: ${markdownText(phase.title)}`, "", markdownText(phase.summary), "", "Files:", "");
      for (const file of phase.fileChanges) lines.push(`- ${markdownText(file.path)} — ${markdownText(file.summary)}`);
      lines.push("");
      for (const step of phase.steps) {
        stopNumber += 1;
        lines.push(`#### Stop ${stopNumber}: ${markdownText(step.title)}`, "", `${markdownText(step.anchor.path)}:${step.anchor.startLine}-${step.anchor.endLine} (${step.anchor.side})`, "", markdownText(step.objective), "");
        if (step.explanation) lines.push(markdownText(step.explanation), "");
      }
    });
  }
  if (outline?.behaviorArchitecture || outline?.architecture) {
    lines.push("## Architecture", "");
    if (outline.behaviorArchitecture) lines.push(...markdownArchitecture(`${outline.behaviorArchitectureStatus === "proposed" ? "Proposed" : "Implemented"} behaviour`, outline.behaviorArchitecture));
    if (outline.architecture) lines.push(...markdownArchitecture("Implementation journey", outline.architecture));
  }
  if (outline?.stateDiagram || outline?.dataModel) {
    lines.push("## Adaptive diagrams", "");
    if (outline.stateDiagram) lines.push(...markdownAdaptiveDiagram("State machine", outline.stateDiagram));
    if (outline.dataModel) lines.push(...markdownAdaptiveDiagram("Data model / ER", outline.dataModel));
  }
  if (outline?.callFlows?.length) {
    lines.push("## Call flows", "");
    for (const flow of outline.callFlows) {
      const nodes = new Map(flow.nodes.map((node) => [node.id, node]));
      lines.push(`### ${markdownText(flow.title)}`, "", `${flow.provenance}; ${flow.edges.filter((edge) => edge.change === "added").length} added and ${flow.edges.filter((edge) => edge.change === "removed").length} removed calls`, "", markdownText(flow.summary), "", `Entrypoint: ${markdownText(nodes.get(flow.entrypointNodeId)?.label ?? flow.entrypointNodeId)}`, "");
      for (const edge of flow.edges) lines.push(`- ${edge.change === "added" ? "+" : edge.change === "removed" ? "−" : "→"} ${markdownText(nodes.get(edge.from)?.label ?? edge.from)} → ${markdownText(nodes.get(edge.to)?.label ?? edge.to)}${edge.label ? ` — ${markdownText(edge.label)}` : ""}`);
      lines.push("", "Affected changed files:", "", ...flow.affectedFiles.map((path) => `- ${markdownText(path)}`), "");
    }
  }
  if (outline?.flows.length) {
    lines.push("## Sequence diagrams", "");
    for (const flow of outline.flows) {
      const affected = flow.affectedFiles?.length ? flow.affectedFiles.map((path) => `- ${markdownText(path)}`) : ["- Exact affected files were not captured for this saved tour."];
      lines.push(`### ${markdownText(flow.title)}`, "", `${flow.provenance}; affects ${flow.affectedFiles?.length || flow.blastRadiusSize} changed files`, "", markdownText(flow.summary), "", "Affected changed files:", "", ...affected, "", markdownFence("mermaid", flow.mermaid), "");
    }
  }
  if (outline?.findings.length) {
    lines.push("## Findings", "");
    for (const finding of outline.findings) {
      lines.push(`### ${finding.priority}: ${markdownText(finding.category)} at ${markdownText(finding.path)}:${finding.line}`, "", `Scope: ${markdownText(finding.phaseId ?? "unscoped")}${finding.stepId ? ` / ${markdownText(finding.stepId)}` : ""}; disposition: ${findingDisposition(finding)}; severity: ${finding.severity}; confidence: ${finding.confidence}`, "", markdownText(finding.message), "", "Evidence trail:", "", ...findingEvidenceParts(finding.evidence).map((part) => `- **${markdownText(part.label)}:** ${markdownText(part.body)}`), ...(finding.reviewerNote ? ["", `Reviewer note: ${markdownText(finding.reviewerNote)}`] : []), "");
    }
  }
  if (session.comments.length) {
    lines.push("## Reviewer feedback", "");
    for (const comment of session.comments) {
      lines.push(`### ${markdownText(commentLocation(comment))}`, "", `Scope: ${markdownText(commentScope(comment, session))}`, `Status: ${comment.status}`, "");
      if (comment.selectedText) lines.push("Selected quotation:", "", markdownFence("text", comment.selectedText), "");
      if (comment.context) lines.push("Selected context:", "", markdownFence("text", comment.context), "");
      lines.push(markdownText(comment.body), "");
    }
  }
  const messages = session.messages ?? [];
  const questionRoots = messages.filter((message) => message.role === "user" && (!message.threadId || message.threadId === message.id));
  if (questionRoots.length) {
    lines.push("## Questions", "");
    for (const root of questionRoots) {
      const threadId = root.threadId ?? root.id;
      const replies = messages.filter((message) => message.threadId === threadId || message.id === threadId);
      const step = root.stepId ? outline?.phases.flatMap((phase) => phase.steps).find((candidate) => candidate.id === root.stepId) : undefined;
      lines.push(`### ${markdownText(step ? `Tour stop: ${step.title}` : "Review-wide question")}`, "", markdownText(root.body), "");
      if (root.anchor) {
        lines.push(`Anchor: ${markdownText(commentLocation({ id: "export", path: root.anchor.path, side: root.anchor.side, line: root.anchor.line, endLine: root.anchor.endLine, body: "", lineContent: root.anchor.content, status: "active", createdAt: "", updatedAt: "" }))}`, "");
        if (root.anchor.selectedText) lines.push("Selected quotation:", "", markdownFence("text", root.anchor.selectedText), "");
        if (root.anchor.context) lines.push("Selected context:", "", markdownFence("text", root.anchor.context), "");
      }
      for (const reply of replies.filter((message) => message.id !== root.id)) lines.push(`${reply.role === "agent" ? "Agent" : "Reviewer"}:`, "", markdownText(reply.body), "");
    }
  }
  lines.push("## Changed files", "");
  for (const file of session.comparison.files) {
    lines.push(`- ${markdownText(file.path)} (${file.status}, +${file.additions}/-${file.deletions})${session.reviewedFiles.has(file.path) ? " — reviewed" : ""}`);
  }
  lines.push("", "## Diff", "", markdownFence("diff", session.comparison.patch), "");
  return lines.join("\n");
}

function escapeHtml(value: unknown): string {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function inlineChangeHtml(value: unknown, ranges: Array<[number, number]> = [], baseOffset = 0): string {
  let html = "";
  let inChange = false;
  let offset = 0;
  for (const character of String(value)) {
    const sourceOffset = baseOffset + offset;
    const changed = ranges.some(([start, end]) => start <= sourceOffset && sourceOffset < end);
    if (changed !== inChange) html += changed ? '<span class="inline-change">' : "</span>";
    inChange = changed;
    html += escapeHtml(character);
    offset += character.length;
  }
  if (inChange) html += "</span>";
  return html;
}

function inlineHtml(value: unknown, ranges: Array<[number, number]> = [], baseOffset = 0): string {
  const text = String(value);
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let html = "";
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index;
    html += inlineChangeHtml(text.slice(cursor, index), ranges, baseOffset + cursor);
    if (match[1] !== undefined) html += `<code>${inlineChangeHtml(match[1], ranges, baseOffset + index + 1)}</code>`;
    else if (match[2] !== undefined) html += `<strong>${inlineChangeHtml(match[2], ranges, baseOffset + index + 2)}</strong>`;
    else html += `<em>${inlineChangeHtml(match[3], ranges, baseOffset + index + 1)}</em>`;
    cursor = index + match[0].length;
  }
  return html + inlineChangeHtml(text.slice(cursor), ranges, baseOffset + cursor);
}

function markdownTableCells(line: string): string[] | undefined {
  const value = line.trim();
  if (!value.includes("|")) return undefined;
  const body = value.replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cell = "";
  let code = false;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index]!;
    if (character === "\\" && body[index + 1] === "|") {
      cell += "|";
      index += 1;
    } else if (character === "`") {
      code = !code;
      cell += character;
    } else if (character === "|" && !code) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells.length > 1 ? cells : undefined;
}

function markdownTableAlignments(line: string, columns: number): Array<"left" | "center" | "right"> | undefined {
  const cells = markdownTableCells(line);
  if (!cells || cells.length !== columns || !cells.every((cell) => /^:?-{3,}:?$/.test(cell))) return undefined;
  return cells.map((cell) => cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : "left");
}

interface MarkdownRenderSource {
  path: string;
  side: "old" | "new";
  changedLines: Set<number>;
  changedRanges: Map<number, Array<[number, number]>>;
}

function markdownSourceBlock(html: string, startLine: number, endLine: number, source?: MarkdownRenderSource): string {
  if (!source) return html;
  const changed = [...source.changedLines].some((line) => line >= startLine && line <= endLine);
  return `<section class="markdown-source-block${changed ? ` ${source.side === "old" ? "deletion" : "addition"}` : ""}" data-markdown-path="${escapeHtml(source.path)}" data-markdown-side="${source.side}" data-source-start="${startLine}" data-source-end="${endLine}">${html}</section>`;
}

function markdownInlineHtml(value: string, line: number, source: MarkdownRenderSource | undefined, sourceLine: string): string {
  if (!source) return inlineHtml(value);
  return inlineHtml(value, source.changedRanges.get(line) ?? [], Math.max(0, sourceLine.indexOf(value)));
}

function renderedMarkdown(value: unknown, headingOffset = 2, source?: MarkdownRenderSource): string {
  const output: string[] = [];
  let list: "ul" | "ol" | null = null;
  let listItems: Array<{ line: number; html: string }> = [];
  let listStart = 0;
  let fence: { lines: string[]; startLine: number } | null = null;
  const closeList = () => {
    if (list) output.push(markdownSourceBlock(`<${list}>${listItems.map((item) => item.html).join("")}</${list}>`, listStart, listItems.at(-1)?.line ?? listStart, source));
    list = null;
    listItems = [];
    listStart = 0;
  };
  const lines = String(value).split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (/^\s*```/.test(line)) {
      closeList();
      if (fence) { output.push(markdownSourceBlock(`<pre><code>${escapeHtml(fence.lines.join("\n"))}</code></pre>`, fence.startLine, index + 1, source)); fence = null; } else fence = { lines: [], startLine: index + 1 };
      continue;
    }
    if (fence) { fence.lines.push(line); continue; }
    const headers = markdownTableCells(line);
    const alignments = headers && markdownTableAlignments(lines[index + 1] ?? "", headers.length);
    if (headers && alignments) {
      closeList();
      const startLine = index + 1;
      const tableRows: Array<{ line: number; sourceLine: string; cells: string[] }> = [];
      index += 2;
      while (index < lines.length) {
        const cells = markdownTableCells(lines[index]!);
        if (!cells) break;
        tableRows.push({ line: index + 1, sourceLine: lines[index]!, cells: headers.map((_header, cellIndex) => cells[cellIndex] ?? "") });
        index += 1;
      }
      index -= 1;
      output.push(markdownSourceBlock(`<div class="markdown-table-wrap"><table><thead><tr>${headers.map((header, cellIndex) => `<th class="align-${alignments[cellIndex]}">${markdownInlineHtml(header, startLine, source, line)}</th>`).join("")}</tr></thead><tbody>${tableRows.map((row) => `<tr>${row.cells.map((cell, cellIndex) => `<td class="align-${alignments[cellIndex]}">${markdownInlineHtml(cell, row.line, source, row.sourceLine)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`, startLine, index + 1, source));
      continue;
    }
    const heading = /^\s*(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) { closeList(); const level = Math.min(6, heading[1].length + headingOffset); output.push(markdownSourceBlock(`<h${level}>${markdownInlineHtml(heading[2]!, index + 1, source, line)}</h${level}>`, index + 1, index + 1, source)); continue; }
    const unordered = /^\s*[-*]\s+(.+)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (unordered || ordered) {
      const next = unordered ? "ul" : "ol";
      if (list !== next) { closeList(); list = next; listStart = index + 1; }
      listItems.push({ line: index + 1, html: `<li>${markdownInlineHtml((unordered ?? ordered)![1]!, index + 1, source, line)}</li>` });
      continue;
    }
    closeList();
    if (line.trim()) output.push(markdownSourceBlock(`<p>${markdownInlineHtml(line.trim(), index + 1, source, line)}</p>`, index + 1, index + 1, source));
  }
  closeList();
  if (fence) output.push(markdownSourceBlock(`<pre><code>${escapeHtml(fence.lines.join("\n"))}</code></pre>`, fence.startLine, lines.length, source));
  return output.join("");
}

function splitRows(rows: DiffRow[]): Array<[DiffRow | null, DiffRow | null]> {
  const pairs: Array<[DiffRow | null, DiffRow | null]> = [];
  for (let index = 0; index < rows.length;) {
    const row = rows[index]!;
    if (row.kind === "context" || row.kind === "meta") { pairs.push([row, row]); index += 1; continue; }
    const removed: DiffRow[] = [];
    const added: DiffRow[] = [];
    while (index < rows.length && rows[index]!.kind === "deletion") removed.push(rows[index++]!);
    while (index < rows.length && rows[index]!.kind === "addition") added.push(rows[index++]!);
    for (let pair = 0; pair < Math.max(removed.length, added.length); pair += 1) pairs.push([removed[pair] ?? null, added[pair] ?? null]);
  }
  return pairs;
}

export function htmlHighlightGroups(session: ReviewSession): HighlightGroup[] {
  const groups = session.comparison.files.flatMap((file, fileIndex) => file.hunks.flatMap((hunk, hunkIndex) => {
    const pairs = splitRows(hunk.rows);
    const sides: Array<"old" | "new"> = file.status === "added" ? ["new"] : file.status === "deleted" ? ["old"] : ["old", "new"];
    return sides.map((side) => ({
      id: `export-${fileIndex}-${hunkIndex}-${side}`,
      path: file.path,
      lines: pairs.map((pair) => {
        const row = pair[side === "old" ? 0 : 1];
        if (!row || (row.kind !== "context" && row.kind !== "meta" && row.kind !== (side === "old" ? "deletion" : "addition"))) return "";
        return row.content;
      }),
    })).filter((group) => group.lines.some(Boolean));
  }));
  const tourPaths = session.outline?.phases.flatMap((phase) => phase.steps.map((step) => step.anchor.path)) ?? [];
  const currentPath = tourPaths[session.currentStepIndex];
  const priorities = new Map([...new Set([currentPath, ...tourPaths].filter((path): path is string => Boolean(path)))].map((path, index) => [path, index]));
  const ordered = groups.map((group, index) => ({ group, index })).sort((left, right) =>
    (priorities.get(left.group.path) ?? Number.MAX_SAFE_INTEGER) - (priorities.get(right.group.path) ?? Number.MAX_SAFE_INTEGER) || left.index - right.index,
  );
  let remaining = 12_000;
  return ordered.flatMap(({ group }) => {
    if (remaining <= 0) return [];
    const lines = group.lines.slice(0, remaining);
    remaining -= lines.length;
    return lines.length ? [{ ...group, lines }] : [];
  });
}

function highlightedCode(tokens: HighlightToken[] | undefined, fallback: string): string {
  if (!tokens) return escapeHtml(fallback);
  return tokens.map((token) => {
    const styles = [token.fontStyle & 1 ? "syntax-italic" : "", token.fontStyle & 2 ? "syntax-bold" : "", token.fontStyle & 4 ? "syntax-underline" : ""].filter(Boolean).join(" ");
    return `<span class="syntax-token ${styles}" style="--syntax-light:#${escapeHtml(token.light)};--syntax-dark:#${escapeHtml(token.dark)}">${escapeHtml(token.content)}</span>`;
  }).join("");
}

function diffSide(file: DiffFile, row: DiffRow | null, side: "old" | "new", findings: ReviewFinding[], session: ReviewSession, tokens?: HighlightToken[]): string {
  if (!row) return '<div class="diff-side empty-line" aria-hidden="true"></div>';
  const line = side === "old" ? row.oldLine : row.newLine;
  const visibleKind = row.kind === "context" || row.kind === "meta" || (side === "old" ? row.kind === "deletion" : row.kind === "addition");
  if (!visibleKind) return '<div class="diff-side empty-line" aria-hidden="true"></div>';
  const marker = row.kind === "addition" ? "+" : row.kind === "deletion" ? "−" : "";
  const lineFindings = line === null ? [] : findings.filter((finding) => finding.path === file.path && finding.side === side && finding.line === line);
  const lineComments = line === null ? [] : session.comments.filter((comment) => comment.path === file.path && comment.side === side && comment.line === line);
  const badges = [...lineFindings.map((finding) => `<span class="line-badge finding-badge" title="${escapeHtml(finding.message)}">${finding.priority}</span>`), ...lineComments.map((comment) => `<span class="line-badge comment-badge" title="${escapeHtml(comment.body)}">Comment</span>`)].join("");
  return `<div class="diff-side ${row.kind}" data-path="${escapeHtml(file.path)}" data-side="${side}" data-line="${line ?? ""}"><span class="line-number">${line ?? ""}</span><span class="line-marker">${marker}</span><code>${highlightedCode(tokens, row.content)}</code>${badges}</div>`;
}

function markdownChangedLines(file: DiffFile, side: "old" | "new"): Set<number> {
  const kind = side === "old" ? "deletion" : "addition";
  return new Set(file.hunks.flatMap((hunk) => hunk.rows
    .filter((row) => row.kind === kind)
    .map((row) => side === "old" ? row.oldLine : row.newLine)
    .filter((line): line is number => line !== null)));
}

function inlineChangedRanges(before: string, after: string): [Array<[number, number]>, Array<[number, number]>] {
  if (before === after) return [[], []];
  const tokenize = (text: string) => [...text.matchAll(/[\p{L}\p{N}_]+|[ \t]+|[^\s]/gu)].map((match) => ({ text: match[0], start: match.index, end: match.index + match[0].length }));
  const oldTokens = tokenize(before);
  const newTokens = tokenize(after);
  let start = 0;
  let oldEnd = oldTokens.length;
  let newEnd = newTokens.length;
  while (start < oldEnd && start < newEnd && oldTokens[start]!.text === newTokens[start]!.text) start += 1;
  while (oldEnd > start && newEnd > start && oldTokens[oldEnd - 1]!.text === newTokens[newEnd - 1]!.text) { oldEnd -= 1; newEnd -= 1; }
  const oldPart = oldTokens.slice(start, oldEnd);
  const newPart = newTokens.slice(start, newEnd);
  const wholeRange = (tokens: typeof oldTokens): Array<[number, number]> => tokens.length ? [[tokens[0]!.start, tokens.at(-1)!.end]] : [];
  if ((oldPart.length + 1) * (newPart.length + 1) > 100_000) return [wholeRange(oldPart), wholeRange(newPart)];
  const table = Array.from({ length: oldPart.length + 1 }, () => new Uint32Array(newPart.length + 1));
  for (let oldIndex = oldPart.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newPart.length - 1; newIndex >= 0; newIndex -= 1) {
      table[oldIndex]![newIndex] = oldPart[oldIndex]!.text === newPart[newIndex]!.text
        ? table[oldIndex + 1]![newIndex + 1]! + 1
        : Math.max(table[oldIndex + 1]![newIndex]!, table[oldIndex]![newIndex + 1]!);
    }
  }
  const oldRanges: Array<[number, number]> = [];
  const newRanges: Array<[number, number]> = [];
  const add = (ranges: Array<[number, number]>, token: (typeof oldTokens)[number]) => {
    if (ranges.at(-1)?.[1] === token.start) ranges.at(-1)![1] = token.end;
    else ranges.push([token.start, token.end]);
  };
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldPart.length || newIndex < newPart.length) {
    if (oldIndex < oldPart.length && newIndex < newPart.length && oldPart[oldIndex]!.text === newPart[newIndex]!.text) { oldIndex += 1; newIndex += 1; }
    else if (oldIndex < oldPart.length && (newIndex === newPart.length || table[oldIndex + 1]![newIndex]! >= table[oldIndex]![newIndex + 1]!)) add(oldRanges, oldPart[oldIndex++]!);
    else add(newRanges, newPart[newIndex++]!);
  }
  return [oldRanges, newRanges];
}

function markdownChangedRanges(file: DiffFile, side: "old" | "new"): Map<number, Array<[number, number]>> {
  const ranges = new Map<number, Array<[number, number]>>();
  for (const hunk of file.hunks) {
    for (const [oldRow, newRow] of splitRows(hunk.rows)) {
      if (oldRow?.kind !== "deletion" || newRow?.kind !== "addition") continue;
      const [oldRanges, newRanges] = inlineChangedRanges(oldRow.content, newRow.content);
      const row = side === "old" ? oldRow : newRow;
      const line = side === "old" ? row.oldLine : row.newLine;
      if (line !== null) ranges.set(line, side === "old" ? oldRanges : newRanges);
    }
  }
  return ranges;
}

function fileDiff(file: DiffFile, findings: ReviewFinding[], session: ReviewSession, fileIndex: number, highlighted: Map<string, HighlightToken[][]>, markdown: Partial<Record<"old" | "new", string>> = {}): string {
  const hunks = file.hunks.map((hunk, hunkIndex) => `<div class="diff-hunk"><div class="hunk-heading">${escapeHtml(hunk.header)}</div>${splitRows(hunk.rows).map(([oldRow, newRow], rowIndex) => {
    const oldSide = file.status === "added" ? "" : diffSide(file, oldRow, "old", findings, session, highlighted.get(`export-${fileIndex}-${hunkIndex}-old`)?.[rowIndex]);
    const newSide = file.status === "deleted" ? "" : diffSide(file, newRow, "new", findings, session, highlighted.get(`export-${fileIndex}-${hunkIndex}-new`)?.[rowIndex]);
    return `<div class="diff-row">${oldSide}${newSide}</div>`;
  }).join("")}</div>`).join("");
  const layout = file.status === "added" || file.status === "deleted" ? " single-side" : "";
  const markdownSides = (["old", "new"] as const).filter((side) => markdown[side] !== undefined);
  const toggle = markdownSides.length ? '<button type="button" class="markdown-toggle" data-markdown-toggle>Preview</button>' : "";
  const source = `<div class="diff-source">${hunks || '<p class="empty-copy">No textual diff is available for this file.</p>'}</div>`;
  const preview = markdownSides.length ? `<div class="markdown-diff${markdownSides.length === 1 ? " single" : ""}" hidden>${markdownSides.map((side) => `<section class="markdown-diff-side ${side}"><header>${side === "old" ? "Before" : "After"}</header><article class="markdown-preview rendered-markdown" data-markdown-side="${side}">${markdown[side]!.trim() ? renderedMarkdown(markdown[side], 0, { path: file.path, side, changedLines: markdownChangedLines(file, side), changedRanges: markdownChangedRanges(file, side) }) : '<p class="empty-copy">This Markdown file is empty.</p>'}</article></section>`).join("")}</div>` : "";
  return `<details class="file-diff${layout}" open><summary><span>${escapeHtml(file.status)}</span><strong>${escapeHtml(file.path)}</strong>${toggle}<small>+${file.additions} −${file.deletions}</small></summary>${source}${preview}</details>`;
}

function html(session: ReviewSession, options: HtmlExportOptions): string {
  const outline = session.outline;
  const includeFindings = options.includeFindings !== false;
  const includeCallFlows = options.includeCallFlows !== false;
  const includeDiagrams = options.includeDiagrams !== false;
  const diffWrap = options.diffWrap === "wrap" ? "wrap" : "scroll";
  const findings = includeFindings ? outline?.findings ?? [] : [];
  const briefing = buildNeedsAttention(session.comparison, outline, session.pullRequest, { includeFindings, includeCallFlows });
  const highlighted = new Map((options.highlightedGroups ?? []).map((group) => [group.id, group.lines]));
  const markdownPreviews = new Map<string, Partial<Record<"old" | "new", string>>>();
  for (const preview of options.markdownPreviews ?? []) {
    const sides = markdownPreviews.get(preview.path) ?? {};
    sides[preview.side] = preview.content;
    markdownPreviews.set(preview.path, sides);
  }
  const filesByPath = new Map(session.comparison.files.map((file) => [file.path, file]));
  let stopNumber = 0;
  const findingCard = (finding: ReviewFinding) => `<article class="finding ${finding.priority.toLowerCase()} ${finding.disposition ? escapeHtml(finding.disposition) : ""}"><header><span>${finding.priority}</span><strong>${escapeHtml(finding.category)} · ${escapeHtml(finding.severity)}</strong></header><code>${escapeHtml(finding.path)}:${finding.line}</code><p>${inlineHtml(finding.message)}</p><div class="finding-disposition">Disposition: ${escapeHtml(findingDisposition(finding))}</div>${finding.reviewerNote ? `<div class="finding-note"><strong>Reviewer note</strong><p>${inlineHtml(finding.reviewerNote)}</p></div>` : ""}<details><summary>Evidence trail · ${escapeHtml(finding.confidence)} confidence</summary>${findingEvidenceHtml(finding.evidence)}</details></article>`;
  const briefingTarget = (signal: (typeof briefing.signals)[number]) => {
    const target = signal.target;
    if (target.kind === "file") return `<button type="button" data-open-file="${escapeHtml(target.path)}">Open ${escapeHtml(target.path)}${target.line ? `:${target.line}` : ""}</button>`;
    if (target.kind === "finding") return `<button type="button" data-view="findings">Open finding ${escapeHtml(target.findingId)}</button>`;
    if (target.kind === "call-flow") return `<button type="button" data-view="calls">Open call flow</button>`;
    return `<button type="button" data-view="diff">Open ${escapeHtml(target.section.replaceAll("-", " "))} section</button>`;
  };
  const findingEvidenceStyles = `<style>.finding-evidence-list{display:grid;gap:6px;margin:8px 0 2px;padding:0;list-style:none}.finding-evidence-list li{display:grid;grid-template-columns:90px minmax(0,1fr);gap:8px;border:1px solid var(--line);border-radius:6px;padding:7px;background:var(--code)}.finding-evidence-list li>strong{color:var(--soft);font-size:8px;text-transform:uppercase}.finding-evidence-list li>div{min-width:0;color:#cbd5e3;overflow-wrap:anywhere}@media(max-width:600px){.finding-evidence-list li{grid-template-columns:1fr;gap:2px}}</style>`;
  const briefingStyles = `<style>.attention-briefing,.review-estimate{max-width:1050px;margin:0 auto;padding:18px 24px;border-bottom:1px solid var(--line)}.attention-briefing h2,.review-estimate h2{margin:4px 0;font-size:16px}.attention-briefing>.muted,.review-estimate>.muted{margin:6px 0;color:var(--soft);font-size:11px}.attention-list{display:grid;gap:8px;margin-top:12px}.attention-item{border:1px solid var(--line);border-left:3px solid var(--amber);border-radius:8px;padding:10px;background:var(--item)}.attention-item.finding,.attention-item.github-check,.attention-item.merge-conflict{border-left-color:var(--red)}.attention-item header{display:flex;justify-content:space-between;gap:10px}.attention-item header small{color:var(--soft);font-size:9px}.attention-item p{margin:4px 0;color:var(--soft);font-size:10px}.attention-item details{color:var(--soft);font-size:9px}.attention-item button{border:0;padding:2px 0;color:var(--accent);background:transparent;font-size:10px;cursor:pointer}.review-estimate details{margin-top:12px;color:var(--soft);font-size:10px}.review-estimate details p{margin:7px 0}.review-estimate small{color:var(--soft)}@media(max-width:600px){.attention-item header{align-items:flex-start;flex-direction:column;gap:2px}}</style>`;
  const githubCheckStyles = `<style>.github-checks-export{margin-top:16px;border:1px solid var(--line);border-radius:8px;padding:12px;background:var(--item)}.github-checks-export h3,.github-checks-export h4{margin:0}.github-checks-export header,.github-check-export-item{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.github-checks-export header p,.github-checks-export p{margin:4px 0 0;color:var(--soft);font-size:11px;line-height:1.45}.github-checks-export a{color:var(--accent)}.github-mergeability-export{margin-top:12px;border:1px solid var(--line);border-radius:7px;padding:9px;background:var(--raised)}.github-mergeability-export h4{color:var(--soft);font-size:10px;letter-spacing:.06em;text-transform:uppercase}.github-check-export-list{display:grid;gap:6px;margin:12px 0 0;padding:0;list-style:none}.github-check-export-item{border:1px solid var(--line);border-radius:7px;padding:9px;background:var(--raised)}.github-check-export-item strong{display:block;overflow-wrap:anywhere;font-size:12px}.github-check-export-status{display:inline-block;margin-right:6px;color:var(--text);font-weight:800}.github-check-export-boundary{border-top:1px solid var(--line);padding-top:9px}@media(max-width:600px){.github-checks-export header,.github-check-export-item{flex-direction:column}}</style>`;
  const findingCount = briefing.signals.filter((signal) => signal.kind === "finding").length;
  const briefingNote = `${briefing.signals.length} review cues shown; ${findingCount === 0 ? "none are" : findingCount === 1 ? "one is" : `${findingCount} are`} unresolved P0/P1 findings. Other cues point to contracts, tests, flows, stale analysis, or GitHub status; lower-priority findings remain in Findings.`;
  const briefingSection = findingEvidenceStyles + briefingStyles + githubCheckStyles + (briefing.signals.length > 0 ? `<section class="attention-briefing" aria-labelledby="attention-title"><span class="eyebrow">Evidence briefing</span><h2 id="attention-title">Needs your attention</h2><p class="muted">${escapeHtml(briefingNote)}</p><div class="attention-list">${briefing.signals.map((signal) => `<article class="attention-item ${signal.kind}"><header><strong>${escapeHtml(signal.title)}</strong><small>${signal.basis === "bounded-heuristic" ? "Bounded heuristic" : "Repository evidence"}</small></header><p>${escapeHtml(signal.detail)}</p><details><summary>Evidence</summary><p>${escapeHtml(signal.evidence)}</p></details>${briefingTarget(signal)}</article>`).join("")}</div></section>` : "");
  const estimateSection = `<section class="review-estimate" aria-labelledby="estimate-title"><span class="eyebrow">Review effort</span><h2 id="estimate-title">How much time might this review take? About ${briefing.estimate.minutes} minutes</h2><p class="muted">A rough first-pass planning aid based on the visible diff and review signals, not a risk score or quality rating.</p><details><summary>Why this estimate?</summary><div>${briefing.estimate.factors.map((factor) => `<p><strong>${escapeHtml(factor.label)} · +${factor.minutes} min</strong><br><small>${escapeHtml(factor.detail)} · ${factor.basis === "bounded-heuristic" ? "bounded heuristic" : "repository evidence"}</small></p>`).join("")}</div></details></section>`;
  const architectureLegend = '<div class="architecture-legend" aria-label="Diagram colour legend"><span><i class="new"></i>New</span><span><i class="changed"></i>Changed</span><span><i class="removed"></i>Removed</span><span><i class="external"></i>Outside this change</span></div>';
  const diagramControls = '<div class="diagram-controls"><span>Move</span><button type="button" data-diagram-action="move-left" aria-label="Move diagram left">←</button><button type="button" data-diagram-action="move-up" aria-label="Move diagram up">↑</button><button type="button" data-diagram-action="move-down" aria-label="Move diagram down">↓</button><button type="button" data-diagram-action="move-right" aria-label="Move diagram right">→</button><span>Zoom</span><button type="button" data-diagram-action="zoom-out" aria-label="Zoom out">−</button><button type="button" class="diagram-zoom" data-diagram-action="reset">100%</button><button type="button" data-diagram-action="zoom-in" aria-label="Zoom in">+</button></div>';
  const adaptiveLegend = '<div class="adaptive-legend" aria-label="Adaptive diagram legend"><span><i class="entity"></i>Entity or state</span><span><i class="relationship"></i>Relationship or transition</span><span><i class="attribute"></i>Attribute or terminal</span></div>';
  const adaptiveSection = (key: string, label: string, diagram: ReviewAdaptiveDiagram) => '<article class="diagram-card architecture-card adaptive-card"><header><div><span class="eyebrow">' + escapeHtml(label) + '</span><h3>' + escapeHtml(diagram.title) + '</h3></div><button class="expand-diagram" type="button" data-diagram-expand="' + escapeHtml(key) + '">⛶ Expand</button></header><p>' + escapeHtml(diagram.summary) + '</p><p><strong>Why this view:</strong> ' + escapeHtml(diagram.materiallyImprovesUnderstanding) + '</p><ul>' + diagram.evidence.map((item) => '<li>' + escapeHtml(item) + '</li>').join("") + '</ul><div class="diagram-shell" data-diagram-key="' + escapeHtml(key) + '">' + diagramControls + '<div class="mermaid architecture-diagram" tabindex="0">' + escapeHtml(diagram.mermaid) + '</div><small>Drag to move · Arrow keys move · +/− zoom · 0 resets</small></div><h4>Affected changed files</h4><ul>' + diagram.affectedFiles.map((path) => '<li>' + escapeHtml(path) + '</li>').join("") + '</ul></article>';
  const adaptive = includeDiagrams ? [outline?.stateDiagram ? adaptiveSection("state", "State machine", outline.stateDiagram) : "", outline?.dataModel ? adaptiveSection("data-model", "Data model / ER", outline.dataModel) : ""].join("") : "";
  const adaptiveView = adaptive ? '<section class="view" data-view-panel="adaptive" hidden><section class="overview-section"><span class="eyebrow">Analysis</span><h2>Adaptive diagrams</h2><div class="diagram-grid">' + adaptiveLegend + adaptive + '</div></section></section>' : "";
  const adaptiveTab = adaptive ? `<button type="button" data-view="adaptive">Adaptive diagrams <span>${[outline?.stateDiagram, outline?.dataModel].filter(Boolean).length}</span></button>` : "";
  const renderExport = (document: string) => {
    const withAdaptiveTab = adaptive
      ? document.replace('<nav class="tabs" aria-label="Review views">', `<nav class="tabs" aria-label="Review views">${adaptiveTab}`)
      : document;
    const withViewerLegend = adaptive
      ? withAdaptiveTab.replace(`<div class="viewer-body">${architectureLegend}`, `<div class="viewer-body">${architectureLegend}${adaptiveLegend}`)
      : withAdaptiveTab;
    return withViewerLegend.replace('</section><aside class="agent-panel">', `${adaptiveView}</section><aside class="agent-panel">`);
  };
  const architectureSection = (key: string, label: string, architecture: ReviewArchitecture) => `<article class="diagram-card architecture-card"><header><div><span class="eyebrow">${escapeHtml(label)}</span><h3>${escapeHtml(architecture.title)}</h3></div><button class="expand-diagram" type="button" data-diagram-expand="${key}">⛶ Expand</button></header><p>${escapeHtml(architecture.summary)}</p><div class="diagram-shell" data-diagram-key="${key}">${diagramControls}<div class="mermaid architecture-diagram" tabindex="0">${escapeHtml(architecture.mermaid)}</div><small>Drag to move · Arrow keys move · +/− zoom · 0 resets</small></div><h4>Relationship changes</h4><ul>${architecture.dependencyChanges.map((change) => `<li>${escapeHtml(change)}</li>`).join("")}</ul></article>`;
  const architecture = includeDiagrams ? [outline?.behaviorArchitecture ? architectureSection("behavior", `${outline.behaviorArchitectureStatus === "proposed" ? "Proposed" : "Implemented"} behaviour`, outline.behaviorArchitecture) : "", outline?.architecture ? architectureSection("journey", "Implementation journey", outline.architecture) : ""].join("") : "";
  const stepPanels = outline?.phases.flatMap((phase, phaseIndex) => {
    const phaseFindings = findings.filter((finding) => finding.phaseId === phase.id && !finding.stepId);
    return phase.steps.map((step, stepInPhase) => {
      stopNumber += 1;
      const scoped = findings.filter((finding) => finding.stepId === step.id);
      return `<section class="tour-step" data-step="${stopNumber - 1}" data-phase="${phaseIndex + 1}" data-stop-in-phase="${stepInPhase + 1}" data-path="${escapeHtml(step.anchor.path)}" data-side="${step.anchor.side}" data-line="${step.anchor.startLine}" data-end-line="${step.anchor.endLine}" hidden><section class="phase-card"><div class="anchor">Phase ${phaseIndex + 1}</div><h3>${escapeHtml(phase.title)}</h3><p class="objective">${escapeHtml(phase.summary)}</p><details class="phase-files"><summary><span>Files in this phase</span><span>${phase.fileChanges.length}</span></summary><div>${phase.fileChanges.map((change) => { const file = filesByPath.get(change.path); return `<button type="button" data-open-file="${escapeHtml(change.path)}"><span><strong>${escapeHtml(change.path)}</strong><small>${escapeHtml(change.summary)}</small></span>${file ? `<span class="file-stats"><b>+${file.additions}</b> <i>−${file.deletions}</i></span>` : ""}</button>`; }).join("")}</div></details>${phaseFindings.length ? `<details class="phase-findings"><summary><span>Phase findings</span><span>${phaseFindings.length}</span></summary>${phaseFindings.map(findingCard).join("")}</details>` : ""}</section><article class="step-card"><code class="anchor">${escapeHtml(step.anchor.path)}:${step.anchor.startLine}-${step.anchor.endLine}</code><h3>${escapeHtml(step.title)}</h3><p class="objective">${escapeHtml(step.objective)}</p><div class="prose">${renderedMarkdown(step.explanation ?? "Explanation unavailable.")}</div></article>${scoped.length ? `<section class="finding-drawer"><div class="drawer-heading"><div><span class="eyebrow">Agent analysis</span><h3>Current stop findings</h3></div><span>${scoped.length}</span></div>${scoped.map(findingCard).join("")}</section>` : ""}<span class="step-meta" data-phase="${phaseIndex + 1}" data-phase-count="${outline.phases.length}" data-stop="${stepInPhase + 1}" data-stops-in-phase="${phase.steps.length}"></span></section>`;
    });
  }).join("") ?? "";
  const flows = includeDiagrams ? outline?.flows.map((flow) => `<article class="sequence-card"><header><div><span class="provenance ${flow.provenance}">${escapeHtml(flow.provenance === "verified" ? "Verified" : flow.provenance === "partial" ? "Partly verified" : "Unverified")}</span><h3>${escapeHtml(flow.title)}</h3></div><details class="flow-impact"><summary>affects ${flow.affectedFiles?.length || flow.blastRadiusSize}</summary><div>${(flow.affectedFiles ?? []).map((path) => `<button type="button" data-open-file="${escapeHtml(path)}">${escapeHtml(path)}</button>`).join("")}</div></details></header><p>${escapeHtml(flow.summary)}</p><div class="mermaid sequence-diagram">${escapeHtml(flow.mermaid)}</div><details class="mermaid-source"><summary>Mermaid source</summary><pre>${escapeHtml(flow.mermaid)}</pre></details></article>`).join("") ?? "" : "";
  const callTree = (flow: CallFlow, mode: "changes" | "before" | "after") => {
    const nodes = new Map(flow.nodes.map((node) => [node.id, node]));
    const visibleNode = (node: CallFlow["nodes"][number] | undefined) => Boolean(node) && (mode === "before" ? node!.change !== "added" : mode === "after" ? node!.change !== "removed" : true);
    const edges = flow.edges.filter((edge) => (mode === "before" ? edge.change !== "added" : mode === "after" ? edge.change !== "removed" : true) && visibleNode(nodes.get(edge.from)) && visibleNode(nodes.get(edge.to)));
    const children = new Map<string, typeof edges>();
    for (const edge of edges) children.set(edge.from, [...(children.get(edge.from) ?? []), edge]);
    let budget = 240;
    const branch = (nodeId: string, ancestry = new Set<string>(), depth = 0): string => {
      if (budget-- <= 0) return '<span class="call-tree-limit">More branches omitted</span>';
      const node = nodes.get(nodeId);
      if (!node || !visibleNode(node)) return "";
      const location = mode === "before" ? node.oldLocation : mode === "after" ? node.newLocation : node.newLocation ?? node.oldLocation;
      const recursive = ancestry.has(nodeId);
      const nextAncestry = new Set(ancestry).add(nodeId);
      const branches = recursive || depth >= 12 ? "" : (children.get(nodeId) ?? []).map((edge) => {
        const child = nodes.get(edge.to);
        const evidence = mode === "before" ? edge.oldCallSite : mode === "after" ? edge.newCallSite : edge.change === "removed" ? edge.oldCallSite : edge.newCallSite ?? edge.oldCallSite;
        return `<li class="call-edge ${edge.change}"><div class="call-edge-row"><span class="call-edge-mark">${edge.change === "added" ? "+" : edge.change === "removed" ? "−" : "→"}</span>${evidence ? `<button type="button" data-call-path="${escapeHtml(evidence.path)}" data-call-side="${evidence.side}" data-call-line="${evidence.line}">${escapeHtml(edge.label || "calls")}</button>` : `<span>${escapeHtml(edge.label || "calls")}</span>`}<span class="call-arrow">→</span><span>${escapeHtml(child?.label ?? edge.to)}</span></div>${branch(edge.to, nextAncestry, depth + 1)}</li>`;
      }).join("");
      return `<div class="call-node ${node.change}${nodeId === flow.entrypointNodeId ? " entrypoint" : ""}"><div class="call-node-row"><span class="call-kind">${escapeHtml(node.kind)}</span>${location ? `<button type="button" data-call-path="${escapeHtml(location.path)}" data-call-side="${location.side}" data-call-line="${location.line}">${escapeHtml(node.label)}</button>` : `<strong>${escapeHtml(node.label)}</strong>`}${recursive ? '<span class="call-cycle">recursive</span>' : ""}</div>${branches ? `<ul>${branches}</ul>` : ""}</div>`;
    };
    return branch(flow.entrypointNodeId) || `<p class="call-tree-empty">${mode === "before" ? "This entrypoint did not exist before the change." : mode === "after" ? "This entrypoint no longer exists after the change." : "No calls are available in this view."}</p>`;
  };
  const callFlows = includeCallFlows ? outline?.callFlows?.map((flow) => {
    const added = flow.edges.filter((edge) => edge.change === "added").length;
    const removed = flow.edges.filter((edge) => edge.change === "removed").length;
    return `<article class="call-flow-card" data-call-flow="${escapeHtml(flow.id)}"><header><div><span class="provenance ${flow.provenance}">${escapeHtml(flow.provenance === "verified" ? "Verified" : flow.provenance === "partial" ? "Partly verified" : "Unverified")}</span><h3>${escapeHtml(flow.title)}</h3></div></header><p>${escapeHtml(flow.summary)}</p><div class="call-flow-summary"><strong>+${added} calls</strong><strong>−${removed} calls</strong></div><details class="flow-impact"><summary>affects ${flow.affectedFiles.length}</summary><div>${flow.affectedFiles.map((path) => `<button type="button" data-open-file="${escapeHtml(path)}">${escapeHtml(path)}</button>`).join("")}</div></details><div class="call-flow-modes">${(["changes", "before", "after"] as const).map((mode) => `<button type="button" data-call-mode="${mode}"${mode === "changes" ? ' class="active"' : ""}>${mode}</button>`).join("")}</div><div class="call-tree-legend"><span><i class="entrypoint"></i>Entry point</span><span><i class="added"></i>Added</span><span><i class="modified"></i>Changed callable</span><span><i class="removed"></i>Removed</span><span><i class="unchanged"></i>Unchanged</span></div><p class="call-tree-caption">A changed callable exists before and after this change, but its implementation or outgoing calls changed.</p>${(["changes", "before", "after"] as const).map((mode) => `<div class="call-tree" data-call-tree="${mode}"${mode === "changes" ? "" : " hidden"}>${callTree(flow, mode)}</div>`).join("")}</article>`;
  }).join("") ?? "" : "";
  const comments = session.comments.map((comment) => `<article class="comment"><code>${escapeHtml(commentLocation(comment))}</code><strong>${escapeHtml(commentScope(comment, session))}</strong>${comment.selectedText ? `<blockquote>${escapeHtml(comment.selectedText)}</blockquote>` : ""}<p>${inlineHtml(comment.body)}</p><span>${escapeHtml(comment.status)}</span></article>`).join("");
  const messages = session.messages ?? [];
  const questions = messages.filter((message) => message.role === "user" && (!message.threadId || message.threadId === message.id)).map((root) => {
    const threadId = root.threadId ?? root.id;
    const replies = messages.filter((message) => message.threadId === threadId || message.id === threadId).filter((message) => message.id !== root.id);
  const step = root.stepId ? outline?.phases.flatMap((phase) => phase.steps).find((candidate) => candidate.id === root.stepId) : undefined;
  const anchor = root.anchor ? `<code>${escapeHtml(commentLocation({ id: "export", path: root.anchor.path, side: root.anchor.side, line: root.anchor.line, endLine: root.anchor.endLine, body: "", lineContent: root.anchor.content, status: "active", createdAt: "", updatedAt: "" }))}</code>${root.anchor.selectedText ? `<blockquote>${escapeHtml(root.anchor.selectedText)}</blockquote>` : ""}` : "";
  return `<article class="comment"><strong>${escapeHtml(step ? `Tour stop: ${step.title}` : "Review-wide question")}</strong>${anchor}<p>${inlineHtml(root.body)}</p>${replies.map((reply) => `<p><strong>${reply.role === "agent" ? "Agent" : "Reviewer"}:</strong> ${inlineHtml(reply.body)}</p>`).join("")}</article>`;
  }).join("");
  const issueAssessment = (issue: LinkedIssueContext | undefined, assessment: IssueAssessment | undefined, reviewerTask?: ReviewerTaskContext) => {
    if (reviewerTask) {
      const intro = `<section class="issue-assessment"><h3>Task-to-implementation assessment</h3><p>Source: reviewer-supplied task description, stored locally in this review session.</p><p>Provider scope: this task description was not sent to GitHub. No issue, pull request, comment, or other provider resource was requested for this assessment.</p><details><summary>Task description</summary><pre>${escapeHtml(reviewerTask.body)}</pre></details>`;
      if (reviewerTask.criteriaStatus === "not-found") return `${intro}<p>No explicit acceptance criteria were found in the saved task description.</p></section>`;
      if (reviewerTask.assessmentError) return `${intro}<p>${escapeHtml(reviewerTask.assessmentError)}</p></section>`;
      if (reviewerTask.assessmentPending) return `${intro}<p>Assessing the saved acceptance criteria in the background.</p></section>`;
      if (!reviewerTask.assessment) return `${intro}<p>The saved task is ready to assess when a review agent is available.</p></section>`;
      return `${intro}<p class="assessment-disclaimer">Model assessment based on cited repository paths; statuses are not verified test results.</p>${reviewerTask.assessment.items.map((item) => `<article class="issue-criterion ${escapeHtml(item.status)}"><strong>${escapeHtml(item.criterion)}</strong><span class="issue-status">${escapeHtml(item.status)}</span><p>${inlineHtml(item.evidence)}</p><small>Repository evidence: ${item.evidencePaths.map(escapeHtml).join(", ") || "none cited"}</small></article>`).join("")}</section>`;
    }
    if (!issue) return `<section class="issue-assessment"><h3>Issue-to-implementation assessment</h3><p>No linked issue was reported. No issue or related provider resources were fetched.</p><p>Provider scope: one same-repository closing issue; related issues and earlier pull requests were not requested. Only issue metadata and explicit criteria are retained.</p></section>`;
    const intro = `<section class="issue-assessment"><h3>Issue-to-implementation assessment</h3><p><a href="${escapeHtml(issue.url)}" rel="noreferrer">#${issue.number} ${escapeHtml(issue.title)}</a></p><p>Provider scope: one same-repository closing issue; related issues and earlier pull requests were not requested. Only issue metadata and explicit criteria are retained.</p>`;
    if (issue.access !== "available") return `${intro}<p>The linked issue is ${escapeHtml(issue.access)}; its content was not included.</p></section>`;
    if (issue.criteriaStatus === "malformed") return `${intro}<p>The linked issue body was malformed or exceeded the safe limit; no criteria were assessed.</p></section>`;
    if (issue.criteriaStatus === "not-found") return `${intro}<p>No explicit acceptance criteria were found in the issue body.</p></section>`;
    if (!assessment) return `${intro}<p>Start the tour to map the explicit acceptance criteria to repository evidence.</p></section>`;
    return `${intro}<p class="assessment-disclaimer">Model assessment based on cited repository paths; statuses are not verified test results.</p>${assessment.items.map((item) => `<article class="issue-criterion ${escapeHtml(item.status)}"><strong>${escapeHtml(item.criterion)}</strong><span class="issue-status">${escapeHtml(item.status)}</span><p>${inlineHtml(item.evidence)}</p><small>Repository evidence: ${item.evidencePaths.map(escapeHtml).join(", ") || "none cited"}</small></article>`).join("")}</section>`;
  };
  const githubChecks = (pullRequest: NonNullable<ReviewSession["pullRequest"]>) => {
    const pullRequestStatus = githubPullRequestStatusSummary(pullRequest.state, pullRequest.mergeable, pullRequest.mergeStateStatus);
    const checks = pullRequest.checks.length === 0
      ? '<p>GitHub reported no checks for this pull request.</p>'
      : `<ul class="github-check-export-list">${pullRequest.checks.map((check) => {
        const status = githubCheckStatus(check.state);
        return `<li class="github-check-export-item"><div><strong>${escapeHtml(check.name)}</strong><p><span class="github-check-export-status">${escapeHtml(status.label)}</span>${escapeHtml(status.explanation)}</p></div>${check.url ? `<a href="${escapeHtml(check.url)}" target="_blank" rel="noreferrer">View run in GitHub</a>` : '<span class="muted">No check-run link was included.</span>'}</li>`;
      }).join("")}</ul>`;
    return `<section class="github-checks-export"><header><div><h3>GitHub checks</h3><p>Snapshot captured when this review was loaded.</p></div><a href="${escapeHtml(pullRequest.url)}" target="_blank" rel="noreferrer">View pull request in GitHub</a></header>${pullRequestStatus.details.length ? `<section class="github-mergeability-export"><h4>${pullRequestStatus.heading}</h4>${pullRequestStatus.details.map((detail) => `<p>${escapeHtml(detail)}</p>`).join("")}</section>` : ""}${checks}<p class="github-check-export-boundary">These statuses do not include a provider-supplied reason. This review did not fetch check or workflow details.</p></section>`;
  };
  const pr = session.pullRequest ? `<section id="pull-request-metadata" class="pr-description"><span class="eyebrow">Pull request #${session.pullRequest.number} · ${escapeHtml(session.pullRequest.author)}</span><h2>${escapeHtml(session.pullRequest.title)}</h2><div class="prose">${renderedMarkdown(session.pullRequest.body || "No pull request description was provided.")}</div>${githubChecks(session.pullRequest)}${issueAssessment(session.pullRequest.linkedIssue, outline?.issueAssessment, session.pullRequest.reviewerTask)}</section>` : "";
  const fileButtons = session.comparison.files.map((file) => `<button type="button" class="file-button" data-file="${escapeHtml(file.path)}"><span class="status ${escapeHtml(file.status)}">${escapeHtml(file.status.slice(0, 1).toUpperCase())}</span><span><strong>${escapeHtml(file.path)}</strong><small>${escapeHtml(file.status)}</small></span><span class="file-stats"><b>+${file.additions}</b> <i>−${file.deletions}</i></span></button>`).join("");
  const diffs = `${briefingSection}${estimateSection}${session.comparison.files.map((file, index) => `<section class="exported-diff" data-diff-file="${escapeHtml(file.path)}" hidden>${fileDiff(file, findings, session, index, highlighted, markdownPreviews.get(file.path))}</section>`).join("")}` + (questions ? `</section><section class="view comments" data-view-panel="questions" hidden><h2>Questions</h2>${questions}` : "");
  const allFindings = findings.map(findingCard).join("");
  const tabs = [`<button type="button" data-view="diff" class="active">Diff <span>${session.comparison.files.length}</span></button>`, callFlows ? `<button type="button" data-view="calls">Call flows <span>${outline?.callFlows?.length ?? 0}</span></button>` : "", flows ? `<button type="button" data-view="sequences">Sequences <span>${outline?.flows.length ?? 0}</span></button>` : "", includeFindings ? `<button type="button" data-view="findings">Findings <span>${findings.length}</span></button>` : "", comments ? `<button type="button" data-view="feedback">Feedback <span>${session.comments.length}</span></button>` : "", questions ? `<button type="button" data-view="questions">Questions <span>${questions ? messages.filter((message) => message.role === "user" && (!message.threadId || message.threadId === message.id)).length : 0}</span></button>` : "", `<style>.focus-mode .tabs{display:flex}.focus-mode .tabs>[data-view]{display:none}.focus-mode .shortcut-help-dialog{display:none}.focus-mode .shortcut-help-dialog[open]{display:block}</style>`, `<button id="focus-mode-toggle" type="button" aria-pressed="false" title="Enter focus mode (Z)">Focus mode</button>`, `<button id="shortcuts-button" type="button" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">? Shortcuts</button>`, `<dialog id="shortcut-help-dialog" class="shortcut-help-dialog" aria-labelledby="shortcut-help-title" aria-describedby="shortcut-help-description"><div class="dialog-heading"><div><div class="eyebrow">Keyboard help</div><h2 id="shortcut-help-title">Review shortcuts</h2></div><button id="close-shortcut-help" type="button">Close</button></div><p id="shortcut-help-description">Shortcuts pause while typing or editing. Existing buttons remain available.</p><table class="shortcut-table"><tbody><tr><th scope="row"><kbd>J</kbd></th><td>Next tour stop</td></tr><tr><th scope="row"><kbd>K</kbd></th><td>Previous tour stop</td></tr><tr><th scope="row"><kbd>Z</kbd></th><td>Toggle focus mode</td></tr><tr><th scope="row"><kbd>?</kbd></th><td>Show this help</td></tr></tbody></table><p class="shortcut-help-note">Focus mode widens the diff and hides secondary review chrome. Use <strong>Exit focus</strong> or press <kbd>Z</kbd> to return.</p></dialog>`, `<script>window.addEventListener("DOMContentLoaded",()=>{const next=()=>document.getElementById("next"),previous=()=>document.getElementById("previous"),focus=document.getElementById("focus-mode-toggle"),help=document.getElementById("shortcuts-button"),dialog=document.getElementById("shortcut-help-dialog"),closeHelp=document.getElementById("close-shortcut-help");let returnFocus=null;const sync=()=>{const active=document.body.classList.contains("focus-mode");focus.setAttribute("aria-pressed",String(active));focus.textContent=active?"Exit focus":"Focus mode";focus.title=active?"Exit focus mode (Z)":"Enter focus mode (Z)"};const editable=target=>Boolean(target?.closest?.("input,textarea,select,[contenteditable='true'],[role='textbox']"));const modal=()=>Boolean(document.querySelector("dialog[open]"));const showHelp=()=>{if(dialog.open)return;returnFocus=document.activeElement;dialog.showModal();closeHelp.focus()};focus.addEventListener("click",()=>{document.body.classList.toggle("focus-mode");sync();focus.focus()});help.addEventListener("click",showHelp);closeHelp.addEventListener("click",()=>dialog.close());dialog.addEventListener("close",()=>{if(returnFocus?.isConnected)returnFocus.focus();returnFocus=null});document.addEventListener("keydown",event=>{if(event.defaultPrevented||event.repeat||editable(event.target)||modal())return;const system=event.ctrlKey||event.metaKey||event.altKey;if(event.key==="?"&&event.shiftKey&&!system){event.preventDefault();showHelp();return}if(system||event.shiftKey)return;const key=event.key.toLowerCase();if(key==="j"&&!next().disabled){event.preventDefault();next().click()}else if(key==="k"&&!previous().disabled){event.preventDefault();previous().click()}else if(key==="z"){event.preventDefault();focus.click()}});sync()});</script>`].join("");
  return renderExport(`<!doctype html>
<html lang="en" data-diff-wrap="${diffWrap}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(outline?.title ?? "Code review tour")}</title>
<style>
:root{color-scheme:dark;--bg:#080d14;--panel:#0d141e;--raised:#121b27;--item:#101a27;--line:#223044;--soft:#8794a7;--text:#e5ebf4;--accent:#8f92ff;--accent2:#aa9fff;--green:#44d18e;--red:#ff7781;--amber:#f5b85c;--code:#0a111a;font-family:Inter,ui-sans-serif,system-ui,sans-serif}*{box-sizing:border-box}html,body{height:100%;margin:0;overflow:hidden}body{display:grid;grid-template-rows:auto auto minmax(0,1fr);background:var(--bg);color:var(--text);line-height:1.5}button{font:inherit;color:inherit}.topbar{display:flex;align-items:center;gap:18px;height:58px;padding:0 18px;border-bottom:1px solid var(--line);background:#0a1018}.brand{font-weight:850}.comparison{overflow:hidden;color:var(--soft);font:11px ui-monospace,SFMono-Regular,Menlo,monospace;text-overflow:ellipsis;white-space:nowrap}.tour-title{margin-left:auto;overflow:hidden;font-size:12px;text-overflow:ellipsis;white-space:nowrap}.tabs{display:flex;gap:3px;height:42px;padding:5px 14px;border-bottom:1px solid var(--line);background:var(--panel)}.tabs button{border:0;border-radius:6px;padding:0 11px;color:var(--soft);background:transparent;font-size:11px;cursor:pointer}.tabs button.active{color:var(--text);background:var(--raised)}.tabs span,.count{margin-left:5px;border-radius:999px;padding:1px 5px;background:var(--item);color:var(--soft);font-size:9px}.workspace{display:grid;grid-template-columns:250px minmax(0,1fr) 420px;min-height:0}.file-panel,.agent-panel{min-width:0;min-height:0;background:var(--panel)}.file-panel{border-right:1px solid var(--line);overflow:auto}.panel-heading,.agent-heading{display:flex;align-items:center;justify-content:space-between;height:58px;padding:0 14px;border-bottom:1px solid var(--line)}.eyebrow{color:var(--soft);font-size:9px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.file-list{padding:8px}.file-button,.phase-files button{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:7px;width:100%;border:1px solid transparent;border-radius:7px;padding:7px;color:var(--soft);background:transparent;text-align:left;cursor:pointer}.file-button:hover,.file-button.active,.phase-files button:hover{border-color:var(--line);color:var(--text);background:var(--raised)}.file-button strong,.file-button small,.phase-files strong,.phase-files small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.file-button strong,.phase-files strong{font:10px ui-monospace,SFMono-Regular,Menlo,monospace}.file-button small,.phase-files small{font-size:9px}.status{display:grid;width:18px;height:18px;border-radius:4px;place-items:center;background:var(--item);color:var(--accent);font-size:9px;font-weight:900}.file-stats{white-space:nowrap;font-size:9px}.file-stats b{color:var(--green)}.file-stats i{color:var(--red);font-style:normal}.diff-panel{min-width:0;min-height:0;overflow:auto;background:var(--code)}.view{min-height:100%;padding-bottom:38px}.view[hidden],.tour-step[hidden],.exported-diff[hidden]{display:none}.review-overview{padding:18px 20px;border-bottom:1px solid var(--line);background:var(--panel)}.review-overview h1{margin:4px 0;font-size:20px}.review-overview>p{margin:0;color:var(--soft);font-size:11px}.architecture,.pr-description{margin-top:11px;border-top:1px solid var(--line);padding-top:9px}.architecture summary,.pr-description summary{color:var(--soft);cursor:pointer;font-size:11px;font-weight:700}.overview-section{max-width:1050px;margin:0 auto;padding:24px}.overview-section>h2{font-size:15px}.diagram-grid,.call-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.diagram-card,.call-flow{min-width:0;border:1px solid var(--line);border-radius:10px;padding:14px;background:var(--panel)}.diagram-card>header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.diagram-card h3,.call-flow h3{margin:4px 0;font-size:14px}.diagram-card p,.call-flow p{color:var(--soft);font-size:11px}.architecture-legend{display:flex;grid-column:1/-1;flex-wrap:wrap;gap:8px 16px;margin-bottom:2px;color:#aab5c5;font-size:10px}.architecture-legend span{display:flex;align-items:center;gap:6px}.architecture-legend i{width:17px;height:11px;border:3px solid #888;border-radius:2px}.architecture-legend .new{border-color:#2e7d32}.architecture-legend .changed{border-color:#f9a825}.architecture-legend .removed{border-color:#c62828;border-style:dashed}.architecture-legend .external{border-width:1px;border-style:dashed}.expand-diagram,.diagram-controls button,#architecture-viewer-close{border:1px solid var(--line);border-radius:6px;padding:6px 8px;color:var(--text);background:var(--raised);font-size:10px;cursor:pointer}.diagram-controls{display:flex;align-items:center;justify-content:flex-end;gap:4px}.diagram-controls>span{margin-inline:5px 2px;color:var(--soft);font-size:8px;font-weight:800;text-transform:uppercase}.diagram-controls button{width:27px;height:27px;padding:0}.diagram-controls .diagram-zoom{width:48px}.diagram-shell>small{display:block;margin-top:5px;color:var(--soft);font-size:8px;text-align:right}.mermaid{display:grid;min-height:190px;margin-top:8px;overflow:hidden;border:1px solid var(--line);border-radius:8px;padding:12px;place-items:center;background:var(--code)}.architecture-diagram{cursor:grab;touch-action:none;user-select:none}.architecture-diagram.dragging{cursor:grabbing}.architecture-diagram svg{transform-origin:center;transition:transform .12s ease}.mermaid svg{max-width:100%;height:auto}.architecture-viewer{width:100vw;height:100vh;max-width:none;max-height:none;margin:0;border:0;padding:0;color:var(--text);background:var(--bg)}.architecture-viewer::backdrop{background:#000}.viewer-header{display:flex;align-items:center;gap:14px;height:54px;padding:0 12px;border-bottom:1px solid var(--line)}.viewer-header strong{margin-right:auto}.viewer-body{display:grid;height:calc(100vh - 54px);grid-template-rows:auto minmax(0,1fr);padding:10px}.viewer-body .architecture-legend{padding:4px 8px}.viewer-body .diagram-shell{display:grid;min-height:0;grid-template-rows:auto minmax(0,1fr)}.viewer-body .mermaid{height:100%;margin-top:6px}.diff-toolbar{position:sticky;top:0;z-index:2;display:flex;justify-content:space-between;padding:9px 14px;border-bottom:1px solid var(--line);background:#0d141eee;color:var(--soft);font-size:10px;backdrop-filter:blur(12px)}.file-diff{margin:14px;overflow:hidden;border:1px solid var(--line);border-radius:9px;background:var(--code)}.file-diff>summary{display:flex;gap:10px;align-items:center;padding:10px 12px;background:var(--raised);cursor:pointer}.file-diff>summary span{color:var(--accent);font-size:9px;text-transform:uppercase}.file-diff>summary small{margin-left:auto;color:var(--soft)}.diff-hunk{overflow-x:auto}.hunk-heading{position:sticky;left:0;padding:5px 12px;color:#92a6c6;background:#121e2d;font:11px ui-monospace,SFMono-Regular,Menlo,monospace}.diff-row{display:grid;grid-template-columns:minmax(430px,1fr) minmax(430px,1fr);min-width:860px;border-left:3px solid transparent}.diff-side{display:grid;grid-template-columns:45px 18px minmax(max-content,1fr) auto;min-width:0;border-bottom:1px solid rgba(80,100,125,.18);font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}.diff-side:first-child{border-right:1px solid var(--line)}.diff-side code{display:block;padding:2px 7px;white-space:pre}.diff-side.addition{background:rgba(35,134,84,.28)}.diff-side.deletion{background:rgba(189,65,74,.25)}.diff-row.tour-anchor{border-left-color:var(--accent2);box-shadow:inset -2px 0 rgba(143,146,255,.25);background-image:linear-gradient(90deg,rgba(143,146,255,.28),rgba(143,146,255,.12))}.diff-row.tour-anchor-start{border-top:2px solid var(--accent2)}.diff-row.tour-anchor-end{border-bottom:2px solid var(--accent2)}.tour-code-note{margin:9px 12px 7px;border:1px dashed rgba(143,146,255,.25);border-left:5px solid var(--accent);border-radius:10px;padding:8px 11px;color:var(--text);background:#151b2b;box-shadow:0 5px 16px #0006;font-size:11px;line-height:1.4;opacity:.7}.tour-code-note.active{border:2px solid var(--accent2);border-left-width:7px;padding:10px 12px;background:#171d30;box-shadow:0 9px 24px #0006,0 0 0 2px rgba(143,146,255,.12);opacity:1}.tour-code-note.next{border-color:#74633d;border-left-color:var(--amber);background:#211e18;opacity:.9}.tour-code-note span{margin-right:8px;color:var(--accent2);font:9px ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:uppercase}.tour-code-note strong{font-size:12px}.tour-code-note p{display:inline;margin-left:8px;color:#aab5c5}.syntax-token{color:var(--syntax-dark)}.syntax-italic{font-style:italic}.syntax-bold{font-weight:700}.syntax-underline{text-decoration:underline}.empty-line{min-height:20px;background:#09121d}.line-number,.line-marker{padding:2px 5px;color:#66758a;text-align:right}.line-badge{align-self:center;margin-right:4px;border-radius:4px;padding:1px 4px;font:700 8px system-ui}.finding-badge{background:var(--amber);color:#171007}.comment-badge{background:var(--accent);color:#fff}.agent-panel{display:grid;grid-template-rows:58px auto minmax(0,1fr) auto;border-left:1px solid var(--line)}.agent-heading strong{font-size:12px}.mode{border:1px solid var(--line);border-radius:999px;padding:3px 7px;color:var(--soft);font-size:9px}.tour-progress{padding:10px 14px;border-bottom:1px solid var(--line);color:var(--soft);font-size:10px}.tour-progress progress{display:block;width:100%;height:3px;margin-top:7px;border:0;accent-color:var(--accent)}.tour-scroll{min-height:0;overflow:auto;padding:14px 16px}.phase-card{margin-bottom:14px;border:1px solid var(--line);border-radius:9px;padding:12px;background:var(--item)}.phase-card h3,.step-card h3{margin:5px 0;font-size:15px}.anchor{display:inline-block;max-width:100%;overflow-wrap:anywhere;color:var(--accent2);font:10px ui-monospace,SFMono-Regular,Menlo,monospace}.objective{color:#aab6c6;font-size:11px}.phase-files,.phase-findings{margin-top:10px;border-top:1px solid var(--line);padding-top:9px}.phase-files summary,.phase-findings summary{display:flex;justify-content:space-between;color:#aab5c5;cursor:pointer;font-size:10px;font-weight:700;text-transform:uppercase}.phase-files>div{display:grid;gap:4px;margin-top:7px}.step-card{border-top:1px solid var(--line);padding-top:12px}.prose{font-size:11px;line-height:1.52}.prose p{margin:0 0 9px}.prose code{border-radius:4px;padding:1px 4px;background:#1a2635}.prose pre{overflow:auto;border:1px solid var(--line);border-radius:7px;padding:9px;background:var(--code)}.finding-drawer{margin-top:20px;border-top:1px solid var(--line);padding-top:14px}.drawer-heading{display:flex;align-items:center;justify-content:space-between}.drawer-heading h3{margin:4px 0;font-size:13px}.finding,.comment{margin:8px 0;border:1px solid var(--line);border-left:3px solid var(--amber);border-radius:8px;padding:9px 10px;background:var(--item);font-size:10px}.finding.p0,.finding.p1{border-left-color:var(--red)}.finding header{display:flex;gap:7px;align-items:center}.finding header span{border-radius:4px;padding:2px 5px;background:#2a3240;font-weight:900}.finding>code{display:block;margin:6px 0;color:var(--accent2)}.finding p,.comment p{margin:6px 0;color:#cbd5e3}.finding details{color:var(--soft)}.tour-controls{display:flex;gap:8px;justify-content:flex-end;padding:12px 14px;border-top:1px solid var(--line)}.tour-controls button{border:1px solid var(--line);border-radius:7px;padding:7px 13px;background:var(--raised);font-size:11px;cursor:pointer}.tour-controls button:disabled{opacity:.4;cursor:default}.tour-controls .next{background:var(--accent);color:#101325;font-weight:800}.call-flow ol{padding-left:20px}.call-flow li{margin:6px 0;font-size:11px}.call-flow li.added>span{color:var(--green)}.call-flow li.removed>span{color:var(--red)}.comments,.all-findings{max-width:900px;margin:auto;padding:24px}.comments h2,.all-findings h2{font-size:15px}.empty-copy{padding:14px;color:var(--soft)}@media(max-width:1050px){.workspace{grid-template-columns:190px minmax(0,1fr) 350px}.diagram-grid{grid-template-columns:1fr}}@media(max-width:760px){html,body{height:auto;overflow:auto}.workspace{display:block}.file-panel{display:none}.diff-panel{min-height:55vh}.agent-panel{min-height:70vh;border:1px solid var(--line)}.topbar{height:auto;min-height:58px}.tour-title{display:none}.diagram-grid{grid-template-columns:1fr}}
.overview-section{width:100%;max-width:none;margin:0;padding:24px}.architecture .overview-section{padding:14px 0 0}.view[hidden],.tour-step[hidden],.exported-diff[hidden],[data-call-tree][hidden]{display:none!important}.call-flow-card,.sequence-card{width:100%;margin-bottom:18px;border:1px solid var(--line);border-radius:12px;padding:18px;background:var(--panel)}.call-flow-card>header,.sequence-card>header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.call-flow-card h3,.sequence-card h3{display:inline;margin:0 0 0 8px;font-size:18px}.call-flow-card>p,.sequence-card>p{color:var(--soft);font-size:12px}.provenance{border:1px solid var(--line);border-radius:999px;padding:3px 7px;color:var(--soft);font-size:9px;text-transform:uppercase}.provenance.verified{border-color:#357a5a;color:#69daa0}.provenance.partial{border-color:#74633d;color:var(--amber)}.flow-impact{margin-bottom:12px;color:var(--soft);font-size:10px}.flow-impact>summary{width:max-content;cursor:pointer;text-transform:uppercase}.flow-impact>div{display:grid;gap:5px;margin-top:7px;border:1px solid var(--line);border-radius:8px;padding:9px;background:var(--raised)}.flow-impact button,.call-node button,.call-edge button{border:0;padding:0;color:inherit;background:transparent;font:inherit;text-align:left;cursor:pointer}.call-flow-summary{display:flex;gap:12px;margin:12px 0 5px;font-size:11px}.call-flow-summary strong:first-child{color:var(--green)}.call-flow-summary strong:last-child{color:var(--red)}.call-flow-modes{display:inline-flex;gap:2px;margin:4px 0 14px;padding:3px;border:1px solid var(--line);border-radius:7px;background:var(--code)}.call-flow-modes button{border:0;border-radius:5px;padding:5px 10px;color:var(--soft);background:transparent;font-size:10px;font-weight:600;text-transform:capitalize;cursor:pointer}.call-flow-modes button.active{color:var(--text);background:var(--raised)}.call-tree-legend{display:flex;flex-wrap:wrap;gap:7px 13px;margin-bottom:6px;color:var(--soft);font-size:9px}.call-tree-legend span{display:inline-flex;align-items:center;gap:5px}.call-tree-legend i{width:13px;height:9px;border:1px solid var(--line);border-radius:3px}.call-tree-legend i.entrypoint{border-color:rgba(143,146,255,.45);box-shadow:inset 3px 0 var(--accent)}.call-tree-legend i.added{border-color:var(--green)}.call-tree-legend i.modified{border-color:var(--amber)}.call-tree-legend i.removed{border-color:var(--red)}.call-tree-legend i.unchanged{opacity:.45}.call-tree-caption{margin:0 0 10px;color:var(--soft);font-size:9px}.call-tree{overflow:auto;padding:14px;border:1px solid var(--line);border-radius:8px;background:var(--code)}.call-tree ul{margin:4px 0 0 17px;padding:0 0 0 17px;border-left:1px solid var(--line);list-style:none}.call-edge{position:relative;margin:4px 0}.call-edge:before{content:"";position:absolute;top:12px;left:-17px;width:13px;border-top:1px solid var(--line)}.call-edge-row,.call-node-row{display:flex;align-items:center;gap:7px;min-height:25px;width:max-content;max-width:100%;font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace}.call-node-row{padding:2px 7px;border:1px solid var(--line);border-radius:6px;background:var(--panel)}.call-node.entrypoint>.call-node-row{border-color:rgba(143,146,255,.45);box-shadow:inset 3px 0 var(--accent)}.call-node.added>.call-node-row,.call-edge.added>.call-edge-row{color:var(--green)}.call-node.removed>.call-node-row,.call-edge.removed>.call-edge-row{color:var(--red)}.call-node.modified>.call-node-row{border-color:var(--amber)}.call-edge.unchanged>.call-edge-row{opacity:.56}.call-edge-mark{width:12px;font-weight:800;text-align:center}.call-arrow{color:var(--soft)}.call-kind,.call-cycle{border:1px solid var(--line);border-radius:999px;padding:1px 5px;color:var(--soft);font:700 8px/1.4 system-ui;text-transform:uppercase}.call-tree-empty,.call-tree-limit{color:var(--soft)}.sequence-card .sequence-diagram{min-height:360px;overflow:auto}.sequence-card .sequence-diagram svg{display:block;width:auto;min-width:min(620px,100%);max-width:100%;height:auto}.mermaid-source{margin-top:10px;color:var(--soft);font-size:10px}.mermaid-source summary{cursor:pointer}.mermaid-source pre{overflow:auto;border-radius:7px;padding:10px;background:var(--bg);color:var(--soft)}
.view[data-view-panel="calls"] .call-grid{display:block}.view[data-view-panel="sequences"] .diagram-grid{grid-template-columns:1fr}
.file-diff.single-side .diff-row{grid-template-columns:minmax(430px,1fr);min-width:430px}.file-diff.single-side .diff-side:first-child{border-right:0}.diff-side{border-bottom:0}.markdown-toggle{margin-left:auto;border:1px solid var(--line);border-radius:6px;padding:4px 9px;color:var(--text);background:var(--panel);font-size:10px;cursor:pointer}.file-diff>summary .markdown-toggle+small{margin-left:0}.markdown-diff[hidden],.diff-source[hidden]{display:none!important}.markdown-diff{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;min-width:0;background:var(--line)}.markdown-diff.single{grid-template-columns:minmax(0,1fr)}.markdown-diff-side{min-width:0;background:var(--panel)}.markdown-diff-side>header{border-bottom:1px solid var(--line);padding:7px 12px;color:var(--soft);background:var(--raised);font-size:10px;font-weight:700;text-align:center}.markdown-preview{width:min(100%,920px);margin:0 auto;padding:30px 36px 48px;color:var(--text);font-size:14px;line-height:1.65}.markdown-preview h1,.markdown-preview h2,.markdown-preview h3,.markdown-preview h4,.markdown-preview h5,.markdown-preview h6{margin:1.4em 0 .55em;line-height:1.25}.markdown-preview h1{margin-top:0;border-bottom:1px solid var(--line);padding-bottom:.35em;font-size:2em}.markdown-preview h2{border-bottom:1px solid var(--line);padding-bottom:.25em;font-size:1.55em}.markdown-preview p{margin:.8em 0}.markdown-preview ul,.markdown-preview ol{padding-left:2em}.markdown-preview code{border-radius:4px;padding:.12em .35em;background:var(--raised);font:.9em ui-monospace,SFMono-Regular,Menlo,monospace}.markdown-preview pre{overflow:auto;border:1px solid var(--line);border-radius:8px;padding:14px;background:var(--code)}.markdown-preview pre code{padding:0;background:transparent}.markdown-preview .empty-copy{padding:0;color:var(--soft)}.markdown-source-block{position:relative;margin:0 -8px;border-left:3px solid transparent;padding:1px 8px}.markdown-source-block.addition{border-left-color:var(--green);background:rgba(35,134,84,.28)}.markdown-source-block.deletion{border-left-color:var(--red);background:rgba(189,65,74,.25)}.markdown-source-block.tour-anchor{border-left-color:var(--accent2);background-image:linear-gradient(90deg,rgba(143,146,255,.28),rgba(143,146,255,.12));box-shadow:inset -2px 0 rgba(143,146,255,.25)}.markdown-source-block.tour-anchor-start{border-top:2px solid var(--accent2)}.markdown-source-block.tour-anchor-end{border-bottom:2px solid var(--accent2)}
.markdown-table-wrap{max-width:100%;margin:14px 0;overflow-x:auto}.rendered-markdown table{width:max-content;min-width:100%;border-spacing:0;border-collapse:collapse}.rendered-markdown th,.rendered-markdown td{border:1px solid var(--line);padding:7px 10px;vertical-align:top}.rendered-markdown th{background:var(--raised);font-weight:700}.rendered-markdown tr:nth-child(even) td{background:var(--item)}.rendered-markdown .align-center{text-align:center}.rendered-markdown .align-right{text-align:right}
.architecture-card .architecture-diagram svg{display:block;width:auto;max-width:100%!important;height:auto!important}.viewer-body .architecture-diagram svg{width:100%!important;max-width:100%!important;height:100%!important;max-height:100%!important}
html[data-diff-wrap="wrap"] .diff-hunk{overflow-x:hidden}html[data-diff-wrap="wrap"] .diff-row{width:100%;min-width:0;grid-template-columns:repeat(2,minmax(0,1fr))}html[data-diff-wrap="wrap"] .diff-side{grid-template-columns:45px 18px minmax(0,1fr) auto}html[data-diff-wrap="wrap"] .diff-side code{min-width:0;white-space:pre-wrap;overflow-wrap:anywhere}html[data-diff-wrap="wrap"] .file-diff.single-side .diff-row{grid-template-columns:minmax(0,1fr);min-width:0}html[data-diff-wrap="wrap"] .diff-toolbar span:last-child{font-size:0}html[data-diff-wrap="wrap"] .diff-toolbar span:last-child:after{content:"Split · Wrap";font-size:10px}
@media(max-width:1050px){.markdown-diff{grid-template-columns:minmax(0,1fr)}}
.focus-mode .file-panel{display:none}.focus-mode .workspace{grid-template-columns:minmax(0,1fr) 420px}.focus-mode .tabs{display:none}.focus-mode .shortcut-help-dialog{display:block}.focus-mode .topbar-actions>*:not(#focus-mode-toggle):not(#shortcuts-button){display:none}.focus-mode .topbar{grid-template-columns:minmax(0,1fr) auto}.shortcut-help-dialog{width:min(560px,calc(100vw - 30px));border:1px solid var(--line);border-radius:10px;padding:18px;color:var(--text);background:var(--panel)}.shortcut-help-dialog::backdrop{background:#000a}.shortcut-help-dialog h2{margin:4px 0 0;font-size:18px}.shortcut-help-dialog p{color:var(--soft);font-size:11px;line-height:1.5}.shortcut-table{width:100%;margin-top:18px;border-collapse:collapse;font-size:12px}.shortcut-table th,.shortcut-table td{border-bottom:1px solid var(--line);padding:10px 8px;text-align:left}.shortcut-table th{width:86px;color:var(--text)}kbd{display:inline-block;min-width:1.5em;border:1px solid #40516b;border-bottom-width:2px;border-radius:5px;padding:2px 6px;color:var(--text);background:var(--raised);font:700 11px ui-monospace,SFMono-Regular,Menlo,monospace;text-align:center}.shortcut-help-note{margin-bottom:0}.topbar-actions{display:flex;gap:6px;margin-left:auto}.topbar-actions button{border:1px solid var(--line);border-radius:7px;padding:6px 9px;color:var(--text);background:var(--raised);font-size:10px;cursor:pointer}.topbar-actions button[aria-pressed="true"]{border-color:var(--accent);box-shadow:0 0 0 2px #8f92ff33}
</style></head>
<body><header class="topbar"><strong class="brand">Code Review Tour</strong><span class="comparison">${escapeHtml(session.comparison.repositoryName)} · ${escapeHtml(session.comparison.base)} → ${escapeHtml(session.comparison.branch ?? session.comparison.head.slice(0, 8))}</span><strong class="tour-title">${escapeHtml(outline?.title ?? `Code review: ${session.comparison.repositoryName}`)}</strong></header><nav class="tabs" aria-label="Review views">${tabs}</nav><main class="workspace"><aside class="file-panel"><header class="panel-heading"><span class="eyebrow">Changed files</span><span class="count">${session.comparison.files.length}</span></header><div class="file-list">${fileButtons}</div></aside><section class="diff-panel"><section class="view" data-view-panel="diff"><header class="review-overview"><span class="eyebrow">Guided tour</span><h1>${escapeHtml(outline?.title ?? `Code review: ${session.comparison.repositoryName}`)}</h1><p>${escapeHtml(outline?.summary ?? "No guided tour was generated.")}</p>${pr ? `<details class="pr-description"><summary>Pull request description</summary>${pr}</details>` : ""}${architecture ? `<details class="architecture"><summary>Architecture</summary><section class="overview-section"><div class="diagram-grid">${architectureLegend}${architecture}</div></section></details>` : ""}</header><div class="diff-toolbar"><span id="visible-file"></span><span>Split · Scroll</span></div>${diffs}</section>${callFlows ? `<section class="view" data-view-panel="calls" hidden><section class="overview-section"><span class="eyebrow">Analysis</span><h2>Call flows</h2><div class="call-grid">${callFlows}</div></section></section>` : ""}${flows ? `<section class="view" data-view-panel="sequences" hidden><section class="overview-section"><span class="eyebrow">Analysis</span><h2>Sequence diagrams</h2><div class="diagram-grid">${flows}</div></section></section>` : ""}${includeFindings ? `<section class="view all-findings" data-view-panel="findings" hidden><h2>All findings</h2>${allFindings || '<p class="empty-copy">No evidence-backed findings were generated.</p>'}</section>` : ""}${comments ? `<section class="view comments" data-view-panel="feedback" hidden><h2>Reviewer feedback</h2>${comments}</section>` : ""}</section><aside class="agent-panel"><header class="agent-heading"><div><span class="eyebrow">Tour agent</span><br><strong>Static review</strong></div><span class="mode">read-only</span></header><div class="tour-progress"><span id="step-count"></span><progress id="progress" max="${stopNumber}" value="1"></progress></div><div class="tour-scroll">${stepPanels || '<p class="empty-copy">No tour stops were generated.</p>'}</div><footer class="tour-controls"><button id="previous" type="button">Previous</button><button id="next" class="next" type="button">Next</button></footer></aside></main><dialog id="architecture-viewer" class="architecture-viewer"><header class="viewer-header"><span class="eyebrow">Component diagram</span><strong id="architecture-viewer-title"></strong><button id="architecture-viewer-close" type="button">Close</button></header><div class="viewer-body">${architectureLegend}<div id="architecture-viewer-shell" class="diagram-shell">${diagramControls}<div id="architecture-viewer-diagram" class="mermaid architecture-diagram" tabindex="0"></div></div></div></dialog>
<script>(()=>{const steps=[...document.querySelectorAll('.tour-step')],files=[...document.querySelectorAll('[data-diff-file]')],fileButtons=[...document.querySelectorAll('[data-file]')],views=[...document.querySelectorAll('[data-view-panel]')],tabs=[...document.querySelectorAll('[data-view]')],viewer=document.getElementById('architecture-viewer');let current=0,drag=null;const showFile=path=>{files.forEach(node=>node.hidden=node.dataset.diffFile!==path);fileButtons.forEach(node=>node.classList.toggle('active',node.dataset.file===path));document.getElementById('visible-file').textContent=path||'No file selected'};const showView=name=>{views.forEach(node=>node.hidden=node.dataset.viewPanel!==name);tabs.forEach(node=>node.classList.toggle('active',node.dataset.view===name))};const applyDiagram=shell=>{const diagram=shell.querySelector('.architecture-diagram'),svg=diagram&&diagram.querySelector('svg'),scale=Number(shell.dataset.scale||1),x=Number(shell.dataset.x||0),y=Number(shell.dataset.y||0);if(svg)svg.style.transform='translate('+x+'px,'+y+'px) scale('+scale+')';const label=shell.querySelector('.diagram-zoom');if(label)label.textContent=Math.round(scale*100)+'%'};const changeDiagram=(shell,action)=>{let scale=Number(shell.dataset.scale||1),x=Number(shell.dataset.x||0),y=Number(shell.dataset.y||0);if(action==='zoom-in')scale=Math.min(3,scale+.25);if(action==='zoom-out')scale=Math.max(.5,scale-.25);if(action==='move-left')x-=40;if(action==='move-right')x+=40;if(action==='move-up')y-=40;if(action==='move-down')y+=40;if(action==='reset'){scale=1;x=0;y=0}shell.dataset.scale=String(scale);shell.dataset.x=String(x);shell.dataset.y=String(y);applyDiagram(shell)};const annotate=step=>{document.querySelectorAll('.tour-code-note').forEach(node=>node.remove());document.querySelectorAll('.tour-anchor,.tour-anchor-start,.tour-anchor-end').forEach(node=>node.classList.remove('tour-anchor','tour-anchor-start','tour-anchor-end'));steps.filter(candidate=>candidate.dataset.phase===step.dataset.phase).forEach(candidate=>{const rows=[...document.querySelectorAll('.diff-side[data-path="'+CSS.escape(candidate.dataset.path)+'"][data-side="'+candidate.dataset.side+'"]')].filter(node=>Number(node.dataset.line)>=Number(candidate.dataset.line)&&Number(node.dataset.line)<=Number(candidate.dataset.endLine)).map(node=>node.closest('.diff-row'));if(!rows.length)return;const index=Number(candidate.dataset.step),active=index===current,next=index===current+1;if(active){rows.forEach(node=>node.classList.add('tour-anchor'));rows[0].classList.add('tour-anchor-start');rows[rows.length-1].classList.add('tour-anchor-end')}const note=document.createElement('aside');note.className='tour-code-note'+(active?' active':next?' next':'');note.innerHTML='<span>'+(active?'Current stop':next?'Next stop':'Stop '+candidate.dataset.stopInPhase)+'</span><strong>'+candidate.querySelector('.step-card h3').textContent+'</strong><p>'+candidate.querySelector('.step-card .objective').textContent+'</p>';rows[0].insertAdjacentElement('beforebegin',note)});const target=document.querySelector('.tour-code-note.active')||document.querySelector('.tour-anchor');if(target)target.scrollIntoView({block:'center'})};const render=()=>{if(!steps.length)return;steps.forEach((node,index)=>node.hidden=index!==current);const step=steps[current],meta=step.querySelector('.step-meta');document.getElementById('step-count').textContent='Phase '+meta.dataset.phase+' of '+meta.dataset.phaseCount+': Stop '+meta.dataset.stop+' of '+meta.dataset.stopsInPhase+' (Step '+(current+1)+')';document.getElementById('progress').value=current+1;document.getElementById('previous').disabled=current===0;const next=document.getElementById('next');next.disabled=current===steps.length-1;next.textContent=current===steps.length-1?'Tour complete':'Next';showView('diff');showFile(step.dataset.path);annotate(step);document.querySelector('.tour-scroll').scrollTop=0};document.getElementById('previous').addEventListener('click',()=>{if(current>0){current--;render()}});document.getElementById('next').addEventListener('click',()=>{if(current<steps.length-1){current++;render()}});document.getElementById('architecture-viewer-close').addEventListener('click',()=>viewer.close());document.addEventListener('click',event=>{const file=event.target.closest('[data-file],[data-open-file]');if(file){showView('diff');showFile(file.dataset.file||file.dataset.openFile)}const tab=event.target.closest('[data-view]');if(tab)showView(tab.dataset.view);const action=event.target.closest('[data-diagram-action]');if(action)changeDiagram(action.closest('.diagram-shell'),action.dataset.diagramAction);const expand=event.target.closest('[data-diagram-expand]');if(expand){const source=document.querySelector('[data-diagram-key="'+expand.dataset.diagramExpand+'"] .architecture-diagram');document.getElementById('architecture-viewer-title').textContent=expand.closest('.diagram-card').querySelector('h3').textContent;document.getElementById('architecture-viewer-diagram').innerHTML=source.innerHTML;const shell=document.getElementById('architecture-viewer-shell');shell.dataset.scale='1';shell.dataset.x='0';shell.dataset.y='0';viewer.showModal();applyDiagram(shell)}});document.addEventListener('keydown',event=>{const diagram=event.target.closest('.architecture-diagram');if(!diagram)return;const actions={ArrowLeft:'move-left',ArrowRight:'move-right',ArrowUp:'move-up',ArrowDown:'move-down','+':'zoom-in','=':'zoom-in','-':'zoom-out','0':'reset'};if(actions[event.key]){event.preventDefault();changeDiagram(diagram.closest('.diagram-shell'),actions[event.key])}});document.addEventListener('pointerdown',event=>{const diagram=event.target.closest('.architecture-diagram');if(!diagram)return;drag={diagram,x:event.clientX,y:event.clientY};diagram.classList.add('dragging');diagram.setPointerCapture(event.pointerId)});document.addEventListener('pointermove',event=>{if(!drag)return;const shell=drag.diagram.closest('.diagram-shell');shell.dataset.x=String(Number(shell.dataset.x||0)+event.clientX-drag.x);shell.dataset.y=String(Number(shell.dataset.y||0)+event.clientY-drag.y);drag.x=event.clientX;drag.y=event.clientY;applyDiagram(shell)});document.addEventListener('pointerup',()=>{if(drag)drag.diagram.classList.remove('dragging');drag=null});render()})();</script>
<script>(()=>{document.addEventListener('click',event=>{const mode=event.target.closest('[data-call-mode]');if(mode){const card=mode.closest('.call-flow-card');card.querySelectorAll('[data-call-mode]').forEach(node=>node.classList.toggle('active',node===mode));card.querySelectorAll('[data-call-tree]').forEach(node=>node.hidden=node.dataset.callTree!==mode.dataset.callMode)}const link=event.target.closest('[data-call-path]');if(!link)return;document.querySelectorAll('[data-view-panel]').forEach(node=>node.hidden=node.dataset.viewPanel!=='diff');document.querySelectorAll('[data-view]').forEach(node=>node.classList.toggle('active',node.dataset.view==='diff'));document.querySelectorAll('[data-diff-file]').forEach(node=>node.hidden=node.dataset.diffFile!==link.dataset.callPath);document.querySelectorAll('[data-file]').forEach(node=>node.classList.toggle('active',node.dataset.file===link.dataset.callPath));requestAnimationFrame(()=>{const row=document.querySelector('.diff-side[data-path="'+CSS.escape(link.dataset.callPath)+'"][data-side="'+link.dataset.callSide+'"][data-line="'+link.dataset.callLine+'"]');if(row)row.scrollIntoView({block:'center'})})})})();</script>
<script>(()=>{document.addEventListener('click',event=>{const button=event.target.closest('[data-markdown-toggle]');if(!button)return;event.preventDefault();event.stopPropagation();const file=button.closest('.file-diff'),source=file.querySelector('.diff-source'),preview=file.querySelector('.markdown-diff'),showPreview=preview.hidden;source.hidden=showPreview;preview.hidden=!showPreview;button.textContent=showPreview?'Changes':'Preview'})})();</script>
<script>(()=>{const annotatePreview=()=>{const preview=document.querySelector('.markdown-diff:not([hidden])');if(!preview)return;document.querySelectorAll('.tour-code-note').forEach(node=>node.remove());document.querySelectorAll('.tour-anchor,.tour-anchor-start,.tour-anchor-end').forEach(node=>node.classList.remove('tour-anchor','tour-anchor-start','tour-anchor-end'));const active=document.querySelector('.tour-step:not([hidden])');if(!active)return;const candidates=[...document.querySelectorAll('.tour-step[data-phase="'+active.dataset.phase+'"]')];candidates.reverse().forEach(candidate=>{const blocks=[...preview.querySelectorAll('.markdown-source-block[data-markdown-path="'+CSS.escape(candidate.dataset.path)+'"][data-markdown-side="'+candidate.dataset.side+'"]')].filter(node=>Number(node.dataset.sourceEnd)>=Number(candidate.dataset.line)&&Number(node.dataset.sourceStart)<=Number(candidate.dataset.endLine));if(!blocks.length)return;const current=candidate===active,index=Number(candidate.dataset.step),next=index===Number(active.dataset.step)+1;if(current){blocks.forEach(node=>node.classList.add('tour-anchor'));blocks[0].classList.add('tour-anchor-start');blocks[blocks.length-1].classList.add('tour-anchor-end')}const note=document.createElement('aside');note.className='tour-code-note'+(current?' active':next?' next':'');note.innerHTML='<span>'+(current?'Current stop':next?'Next stop':'Stop '+candidate.dataset.stopInPhase)+'</span><strong>'+candidate.querySelector('.step-card h3').textContent+'</strong><p>'+candidate.querySelector('.step-card .objective').textContent+'</p>';blocks[0].insertAdjacentElement('beforebegin',note)});const target=preview.querySelector('.tour-code-note.active,.markdown-source-block.tour-anchor');if(target)target.scrollIntoView({block:'center'})};document.addEventListener('click',()=>requestAnimationFrame(annotatePreview))})();</script>
${architecture || flows || adaptive ? `<script>${String(mermaidScript)}</script><script>(async()=>{mermaid.initialize({startOnLoad:false,securityLevel:"strict",suppressErrorRendering:true,theme:"dark",deterministicIds:true,deterministicIDSeed:"review-tour-export",flowchart:{useMaxWidth:true},sequence:{useMaxWidth:true,wrap:true}});const diagrams=[...document.querySelectorAll(".mermaid")];for(let index=0;index<diagrams.length;index++){const node=diagrams[index],source=node.textContent;try{const result=await mermaid.render("review-tour-export-diagram-"+index,source);node.innerHTML=result.svg;const svg=node.querySelector("svg");if(svg){const viewBox=svg.getAttribute("viewBox")?.trim().split(/\\s+/).map(Number),naturalWidth=viewBox?.length===4&&Number.isFinite(viewBox[2])?Math.ceil(viewBox[2]):0;svg.setAttribute("aria-hidden","true");svg.removeAttribute("width");svg.removeAttribute("height");svg.style.width=naturalWidth?"min("+naturalWidth+"px, 100%)":"100%";svg.style.maxWidth="100%";svg.style.height="auto"}}catch{node.textContent="Diagram unavailable";node.classList.add("diagram-error")}}})();</script>` : ""}</body></html>`);
}

export function exportReview(session: ReviewSession, format: ExportFormat, options: HtmlExportOptions = {}): { content: string; contentType: string; extension: string } {
  return format === "markdown"
    ? { content: markdown(session), contentType: "text/markdown; charset=utf-8", extension: "md" }
    : { content: html(session, options), contentType: "text/html; charset=utf-8", extension: "html" };
}
