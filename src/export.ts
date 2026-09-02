import type { ReviewSession } from "./session.ts";
import type { DiffFile, DiffRow, ReviewArchitecture, ReviewFinding } from "./types.ts";
// @ts-expect-error Bun's text loader embeds Mermaid in the self-contained HTML export.
import mermaidScript from "mermaid/dist/mermaid.min.js" with { type: "text" };

export type ExportFormat = "markdown" | "html";
export interface HtmlExportOptions {
  includeFindings?: boolean;
  includeCallFlows?: boolean;
  includeDiagrams?: boolean;
}

function markdownFence(language: string, content: string): string {
  const longest = Math.max(2, ...[...content.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(longest + 1);
  return `${fence}${language}\n${content}\n${fence}`;
}

function markdownText(value: unknown): string {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function markdownArchitecture(label: string, architecture: ReviewArchitecture): string[] {
  return [`### ${label}: ${markdownText(architecture.title)}`, "", markdownText(architecture.summary), "", "Relationship changes:", "", ...architecture.dependencyChanges.map((change) => `- ${markdownText(change)}`), "", "Affected changed files:", "", ...architecture.affectedFiles.map((path) => `- ${markdownText(path)}`), "", markdownFence("mermaid", architecture.mermaid), ""];
}

function markdown(session: ReviewSession): string {
  const outline = session.outline;
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
      lines.push(`### ${finding.priority}: ${markdownText(finding.category)} at ${markdownText(finding.path)}:${finding.line}`, "", `Scope: ${markdownText(finding.phaseId ?? "unscoped")}${finding.stepId ? ` / ${markdownText(finding.stepId)}` : ""}; status: ${finding.status}; severity: ${finding.severity}; confidence: ${finding.confidence}`, "", markdownText(finding.message), "", `Evidence: ${markdownText(finding.evidence)}`, "");
    }
  }
  if (session.comments.length) {
    lines.push("## Reviewer feedback", "");
    for (const comment of session.comments) {
      lines.push(`### ${markdownText(comment.path)}:${comment.line} (${comment.side})`, "", `Status: ${comment.status}`, "", markdownText(comment.body), "");
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

function inlineHtml(value: unknown): string {
  const code: string[] = [];
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, (_match, content: string) => `\u0000${code.push(content) - 1}\u0000`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\u0000(\d+)\u0000/g, (_match, index: string) => `<code>${code[Number(index)]}</code>`);
}

function renderedMarkdown(value: unknown): string {
  const output: string[] = [];
  let list: "ul" | "ol" | null = null;
  let fence: string[] | null = null;
  const closeList = () => { if (list) output.push(`</${list}>`); list = null; };
  for (const line of String(value).split("\n")) {
    if (/^\s*```/.test(line)) {
      closeList();
      if (fence) { output.push(`<pre><code>${escapeHtml(fence.join("\n"))}</code></pre>`); fence = null; } else fence = [];
      continue;
    }
    if (fence) { fence.push(line); continue; }
    const heading = /^\s*(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) { closeList(); const level = Math.min(6, heading[1].length + 2); output.push(`<h${level}>${inlineHtml(heading[2])}</h${level}>`); continue; }
    const unordered = /^\s*[-*]\s+(.+)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (unordered || ordered) {
      const next = unordered ? "ul" : "ol";
      if (list !== next) { closeList(); list = next; output.push(`<${next}>`); }
      output.push(`<li>${inlineHtml((unordered ?? ordered)![1])}</li>`);
      continue;
    }
    closeList();
    if (line.trim()) output.push(`<p>${inlineHtml(line.trim())}</p>`);
  }
  closeList();
  if (fence) output.push(`<pre><code>${escapeHtml(fence.join("\n"))}</code></pre>`);
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

function diffSide(file: DiffFile, row: DiffRow | null, side: "old" | "new", findings: ReviewFinding[], session: ReviewSession): string {
  if (!row) return '<div class="diff-side empty-line" aria-hidden="true"></div>';
  const line = side === "old" ? row.oldLine : row.newLine;
  const visibleKind = row.kind === "context" || row.kind === "meta" || (side === "old" ? row.kind === "deletion" : row.kind === "addition");
  if (!visibleKind) return '<div class="diff-side empty-line" aria-hidden="true"></div>';
  const marker = row.kind === "addition" ? "+" : row.kind === "deletion" ? "−" : "";
  const lineFindings = line === null ? [] : findings.filter((finding) => finding.path === file.path && finding.side === side && finding.line === line);
  const lineComments = line === null ? [] : session.comments.filter((comment) => comment.path === file.path && comment.side === side && comment.line === line);
  const badges = [...lineFindings.map((finding) => `<span class="line-badge finding-badge" title="${escapeHtml(finding.message)}">${finding.priority}</span>`), ...lineComments.map((comment) => `<span class="line-badge comment-badge" title="${escapeHtml(comment.body)}">Comment</span>`)].join("");
  return `<div class="diff-side ${row.kind}" data-path="${escapeHtml(file.path)}" data-side="${side}" data-line="${line ?? ""}"><span class="line-number">${line ?? ""}</span><span class="line-marker">${marker}</span><code>${escapeHtml(row.content)}</code>${badges}</div>`;
}

function fileDiff(file: DiffFile, findings: ReviewFinding[], session: ReviewSession): string {
  const hunks = file.hunks.map((hunk) => `<div class="diff-hunk"><div class="hunk-heading">${escapeHtml(hunk.header)}</div>${splitRows(hunk.rows).map(([oldRow, newRow]) => `<div class="diff-row">${diffSide(file, oldRow, "old", findings, session)}${diffSide(file, newRow, "new", findings, session)}</div>`).join("")}</div>`).join("");
  return `<details class="file-diff" open><summary><span>${escapeHtml(file.status)}</span><strong>${escapeHtml(file.path)}</strong><small>+${file.additions} −${file.deletions}</small></summary>${hunks || '<p class="empty-copy">No textual diff is available for this file.</p>'}</details>`;
}

function html(session: ReviewSession, options: HtmlExportOptions): string {
  const outline = session.outline;
  const includeFindings = options.includeFindings !== false;
  const includeCallFlows = options.includeCallFlows !== false;
  const includeDiagrams = options.includeDiagrams !== false;
  const findings = includeFindings ? outline?.findings ?? [] : [];
  const filesByPath = new Map(session.comparison.files.map((file) => [file.path, file]));
  let stopNumber = 0;
  const findingCard = (finding: ReviewFinding) => `<article class="finding ${finding.priority.toLowerCase()}"><header><span>${finding.priority}</span><strong>${escapeHtml(finding.category)} · ${escapeHtml(finding.severity)}</strong></header><code>${escapeHtml(finding.path)}:${finding.line}</code><p>${inlineHtml(finding.message)}</p><details><summary>Evidence · ${escapeHtml(finding.confidence)} confidence</summary><p>${inlineHtml(finding.evidence)}</p></details></article>`;
  const architectureLegend = '<div class="architecture-legend" aria-label="Diagram colour legend"><span><i class="new"></i>New</span><span><i class="changed"></i>Changed</span><span><i class="removed"></i>Removed</span><span><i class="external"></i>Outside this change</span></div>';
  const architectureSection = (label: string, architecture: ReviewArchitecture) => `<article class="diagram-card"><span class="eyebrow">${escapeHtml(label)}</span><h3>${escapeHtml(architecture.title)}</h3><p>${escapeHtml(architecture.summary)}</p><div class="mermaid">${escapeHtml(architecture.mermaid)}</div><h4>Relationship changes</h4><ul>${architecture.dependencyChanges.map((change) => `<li>${escapeHtml(change)}</li>`).join("")}</ul></article>`;
  const architecture = includeDiagrams ? [outline?.behaviorArchitecture ? architectureSection(`${outline.behaviorArchitectureStatus === "proposed" ? "Proposed" : "Implemented"} behaviour`, outline.behaviorArchitecture) : "", outline?.architecture ? architectureSection("Implementation journey", outline.architecture) : ""].join("") : "";
  const stepPanels = outline?.phases.flatMap((phase, phaseIndex) => {
    const phaseFindings = findings.filter((finding) => finding.phaseId === phase.id && !finding.stepId);
    return phase.steps.map((step, stepInPhase) => {
      stopNumber += 1;
      const scoped = findings.filter((finding) => finding.stepId === step.id);
      return `<section class="tour-step" data-step="${stopNumber - 1}" data-path="${escapeHtml(step.anchor.path)}" data-side="${step.anchor.side}" data-line="${step.anchor.startLine}" hidden><section class="phase-card"><div class="anchor">Phase ${phaseIndex + 1}</div><h3>${escapeHtml(phase.title)}</h3><p class="objective">${escapeHtml(phase.summary)}</p><details class="phase-files"><summary><span>Files in this phase</span><span>${phase.fileChanges.length}</span></summary><div>${phase.fileChanges.map((change) => { const file = filesByPath.get(change.path); return `<button type="button" data-open-file="${escapeHtml(change.path)}"><span><strong>${escapeHtml(change.path)}</strong><small>${escapeHtml(change.summary)}</small></span>${file ? `<span class="file-stats"><b>+${file.additions}</b> <i>−${file.deletions}</i></span>` : ""}</button>`; }).join("")}</div></details>${phaseFindings.length ? `<details class="phase-findings"><summary><span>Phase findings</span><span>${phaseFindings.length}</span></summary>${phaseFindings.map(findingCard).join("")}</details>` : ""}</section><article class="step-card"><code class="anchor">${escapeHtml(step.anchor.path)}:${step.anchor.startLine}-${step.anchor.endLine}</code><h3>${escapeHtml(step.title)}</h3><p class="objective">${escapeHtml(step.objective)}</p><div class="prose">${renderedMarkdown(step.explanation ?? "Explanation unavailable.")}</div></article>${scoped.length ? `<section class="finding-drawer"><div class="drawer-heading"><div><span class="eyebrow">Agent analysis</span><h3>Current stop findings</h3></div><span>${scoped.length}</span></div>${scoped.map(findingCard).join("")}</section>` : ""}<span class="step-meta" data-phase="${phaseIndex + 1}" data-phase-count="${outline.phases.length}" data-stop="${stepInPhase + 1}" data-stops-in-phase="${phase.steps.length}"></span></section>`;
    });
  }).join("") ?? "";
  const flows = includeDiagrams ? outline?.flows.map((flow) => `<article class="diagram-card"><span class="eyebrow">${escapeHtml(flow.provenance)} · affects ${flow.affectedFiles?.length || flow.blastRadiusSize}</span><h3>${escapeHtml(flow.title)}</h3><p>${escapeHtml(flow.summary)}</p><div class="mermaid">${escapeHtml(flow.mermaid)}</div></article>`).join("") ?? "" : "";
  const callFlows = includeCallFlows ? outline?.callFlows?.map((flow) => { const nodes = new Map(flow.nodes.map((node) => [node.id, node])); return `<article class="call-flow"><span class="eyebrow">${escapeHtml(flow.provenance)}</span><h3>${escapeHtml(flow.title)}</h3><p>${escapeHtml(flow.summary)}</p><p><strong>Entry point:</strong> <code>${escapeHtml(nodes.get(flow.entrypointNodeId)?.label ?? flow.entrypointNodeId)}</code></p><ol>${flow.edges.map((edge) => `<li class="${edge.change}"><span>${edge.change === "added" ? "+" : edge.change === "removed" ? "−" : "→"}</span><code>${escapeHtml(nodes.get(edge.from)?.label ?? edge.from)}</code> → <code>${escapeHtml(nodes.get(edge.to)?.label ?? edge.to)}</code>${edge.label ? ` <small>${escapeHtml(edge.label)}</small>` : ""}</li>`).join("")}</ol></article>`; }).join("") ?? "" : "";
  const comments = session.comments.map((comment) => `<article class="comment"><code>${escapeHtml(comment.path)}:${comment.line} · ${comment.side}</code><p>${inlineHtml(comment.body)}</p><span>${escapeHtml(comment.status)}</span></article>`).join("");
  const pr = session.pullRequest ? `<section class="pr-description"><span class="eyebrow">Pull request #${session.pullRequest.number} · ${escapeHtml(session.pullRequest.author)}</span><h2>${escapeHtml(session.pullRequest.title)}</h2><div class="prose">${renderedMarkdown(session.pullRequest.body || "No pull request description was provided.")}</div></section>` : "";
  const fileButtons = session.comparison.files.map((file) => `<button type="button" class="file-button" data-file="${escapeHtml(file.path)}"><span class="status ${escapeHtml(file.status)}">${escapeHtml(file.status.slice(0, 1).toUpperCase())}</span><span><strong>${escapeHtml(file.path)}</strong><small>${escapeHtml(file.status)}</small></span><span class="file-stats"><b>+${file.additions}</b> <i>−${file.deletions}</i></span></button>`).join("");
  const diffs = session.comparison.files.map((file) => `<section class="exported-diff" data-diff-file="${escapeHtml(file.path)}" hidden>${fileDiff(file, findings, session)}</section>`).join("");
  const allFindings = findings.map(findingCard).join("");
  const tabs = [`<button type="button" data-view="diff" class="active">Diff <span>${session.comparison.files.length}</span></button>`, callFlows ? `<button type="button" data-view="calls">Call flows <span>${outline?.callFlows?.length ?? 0}</span></button>` : "", flows ? `<button type="button" data-view="sequences">Sequences <span>${outline?.flows.length ?? 0}</span></button>` : "", includeFindings ? `<button type="button" data-view="findings">Findings <span>${findings.length}</span></button>` : "", comments ? `<button type="button" data-view="feedback">Feedback <span>${session.comments.length}</span></button>` : ""].join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(outline?.title ?? "Code review tour")}</title>
<style>
:root{color-scheme:dark;--bg:#080d14;--panel:#0d141e;--raised:#121b27;--item:#101a27;--line:#223044;--soft:#8794a7;--text:#e5ebf4;--accent:#8f92ff;--accent2:#aa9fff;--green:#44d18e;--red:#ff7781;--amber:#f5b85c;--code:#0a111a;font-family:Inter,ui-sans-serif,system-ui,sans-serif}*{box-sizing:border-box}html,body{height:100%;margin:0;overflow:hidden}body{display:grid;grid-template-rows:auto auto minmax(0,1fr);background:var(--bg);color:var(--text);line-height:1.5}button{font:inherit;color:inherit}.topbar{display:flex;align-items:center;gap:18px;height:58px;padding:0 18px;border-bottom:1px solid var(--line);background:#0a1018}.brand{font-weight:850}.comparison{overflow:hidden;color:var(--soft);font:11px ui-monospace,SFMono-Regular,Menlo,monospace;text-overflow:ellipsis;white-space:nowrap}.tour-title{margin-left:auto;overflow:hidden;font-size:12px;text-overflow:ellipsis;white-space:nowrap}.tabs{display:flex;gap:3px;height:42px;padding:5px 14px;border-bottom:1px solid var(--line);background:var(--panel)}.tabs button{border:0;border-radius:6px;padding:0 11px;color:var(--soft);background:transparent;font-size:11px;cursor:pointer}.tabs button.active{color:var(--text);background:var(--raised)}.tabs span,.count{margin-left:5px;border-radius:999px;padding:1px 5px;background:var(--item);color:var(--soft);font-size:9px}.workspace{display:grid;grid-template-columns:250px minmax(0,1fr) 420px;min-height:0}.file-panel,.agent-panel{min-width:0;min-height:0;background:var(--panel)}.file-panel{border-right:1px solid var(--line);overflow:auto}.panel-heading,.agent-heading{display:flex;align-items:center;justify-content:space-between;height:58px;padding:0 14px;border-bottom:1px solid var(--line)}.eyebrow{color:var(--soft);font-size:9px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.file-list{padding:8px}.file-button,.phase-files button{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:7px;width:100%;border:1px solid transparent;border-radius:7px;padding:7px;color:var(--soft);background:transparent;text-align:left;cursor:pointer}.file-button:hover,.file-button.active,.phase-files button:hover{border-color:var(--line);color:var(--text);background:var(--raised)}.file-button strong,.file-button small,.phase-files strong,.phase-files small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.file-button strong,.phase-files strong{font:10px ui-monospace,SFMono-Regular,Menlo,monospace}.file-button small,.phase-files small{font-size:9px}.status{display:grid;width:18px;height:18px;border-radius:4px;place-items:center;background:var(--item);color:var(--accent);font-size:9px;font-weight:900}.file-stats{white-space:nowrap;font-size:9px}.file-stats b{color:var(--green)}.file-stats i{color:var(--red);font-style:normal}.diff-panel{min-width:0;min-height:0;overflow:auto;background:var(--code)}.view{min-height:100%;padding-bottom:38px}.view[hidden],.tour-step[hidden],.exported-diff[hidden]{display:none}.review-overview{padding:18px 20px;border-bottom:1px solid var(--line);background:var(--panel)}.review-overview h1{margin:4px 0;font-size:20px}.review-overview>p{margin:0;color:var(--soft);font-size:11px}.architecture,.pr-description{margin-top:11px;border-top:1px solid var(--line);padding-top:9px}.architecture summary,.pr-description summary{color:var(--soft);cursor:pointer;font-size:11px;font-weight:700}.overview-section{max-width:1050px;margin:0 auto;padding:24px}.overview-section>h2{font-size:15px}.diagram-grid,.call-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.diagram-card,.call-flow{min-width:0;border:1px solid var(--line);border-radius:10px;padding:14px;background:var(--panel)}.diagram-card h3,.call-flow h3{margin:4px 0;font-size:14px}.diagram-card p,.call-flow p{color:var(--soft);font-size:11px}.architecture-legend{display:flex;grid-column:1/-1;flex-wrap:wrap;gap:8px 16px;margin-bottom:2px;color:#aab5c5;font-size:10px}.architecture-legend span{display:flex;align-items:center;gap:6px}.architecture-legend i{width:17px;height:11px;border:3px solid #888;border-radius:2px}.architecture-legend .new{border-color:#2e7d32}.architecture-legend .changed{border-color:#f9a825}.architecture-legend .removed{border-color:#c62828;border-style:dashed}.architecture-legend .external{border-width:1px;border-style:dashed}.mermaid{display:grid;min-height:190px;margin-top:12px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:12px;place-items:center;background:var(--code)}.mermaid svg{max-width:100%;height:auto}.diff-toolbar{position:sticky;top:0;z-index:2;display:flex;justify-content:space-between;padding:9px 14px;border-bottom:1px solid var(--line);background:#0d141eee;color:var(--soft);font-size:10px;backdrop-filter:blur(12px)}.file-diff{margin:14px;overflow:hidden;border:1px solid var(--line);border-radius:9px;background:var(--code)}.file-diff>summary{display:flex;gap:10px;align-items:center;padding:10px 12px;background:var(--raised);cursor:pointer}.file-diff>summary span{color:var(--accent);font-size:9px;text-transform:uppercase}.file-diff>summary small{margin-left:auto;color:var(--soft)}.diff-hunk{overflow-x:auto}.hunk-heading{position:sticky;left:0;padding:5px 12px;color:#92a6c6;background:#121e2d;font:11px ui-monospace,SFMono-Regular,Menlo,monospace}.diff-row{display:grid;grid-template-columns:minmax(430px,1fr) minmax(430px,1fr);min-width:860px}.diff-side{display:grid;grid-template-columns:45px 18px minmax(max-content,1fr) auto;min-width:0;border-bottom:1px solid rgba(80,100,125,.18);font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}.diff-side:first-child{border-right:1px solid var(--line)}.diff-side code{display:block;padding:2px 7px;white-space:pre}.diff-side.addition{background:rgba(35,134,84,.28)}.diff-side.deletion{background:rgba(189,65,74,.25)}.diff-side.current{box-shadow:inset 3px 0 var(--accent),inset 0 0 0 1px rgba(143,146,255,.42)}.empty-line{min-height:20px;background:#09121d}.line-number,.line-marker{padding:2px 5px;color:#66758a;text-align:right}.line-badge{align-self:center;margin-right:4px;border-radius:4px;padding:1px 4px;font:700 8px system-ui}.finding-badge{background:var(--amber);color:#171007}.comment-badge{background:var(--accent);color:#fff}.agent-panel{display:grid;grid-template-rows:58px auto minmax(0,1fr) auto;border-left:1px solid var(--line)}.agent-heading strong{font-size:12px}.mode{border:1px solid var(--line);border-radius:999px;padding:3px 7px;color:var(--soft);font-size:9px}.tour-progress{padding:10px 14px;border-bottom:1px solid var(--line);color:var(--soft);font-size:10px}.tour-progress progress{display:block;width:100%;height:3px;margin-top:7px;border:0;accent-color:var(--accent)}.tour-scroll{min-height:0;overflow:auto;padding:14px 16px}.phase-card{margin-bottom:14px;border:1px solid var(--line);border-radius:9px;padding:12px;background:var(--item)}.phase-card h3,.step-card h3{margin:5px 0;font-size:15px}.anchor{display:inline-block;max-width:100%;overflow-wrap:anywhere;color:var(--accent2);font:10px ui-monospace,SFMono-Regular,Menlo,monospace}.objective{color:#aab6c6;font-size:11px}.phase-files,.phase-findings{margin-top:10px;border-top:1px solid var(--line);padding-top:9px}.phase-files summary,.phase-findings summary{display:flex;justify-content:space-between;color:#aab5c5;cursor:pointer;font-size:10px;font-weight:700;text-transform:uppercase}.phase-files>div{display:grid;gap:4px;margin-top:7px}.step-card{border-top:1px solid var(--line);padding-top:12px}.prose{font-size:11px;line-height:1.52}.prose p{margin:0 0 9px}.prose code{border-radius:4px;padding:1px 4px;background:#1a2635}.prose pre{overflow:auto;border:1px solid var(--line);border-radius:7px;padding:9px;background:var(--code)}.finding-drawer{margin-top:20px;border-top:1px solid var(--line);padding-top:14px}.drawer-heading{display:flex;align-items:center;justify-content:space-between}.drawer-heading h3{margin:4px 0;font-size:13px}.finding,.comment{margin:8px 0;border:1px solid var(--line);border-left:3px solid var(--amber);border-radius:8px;padding:9px 10px;background:var(--item);font-size:10px}.finding.p0,.finding.p1{border-left-color:var(--red)}.finding header{display:flex;gap:7px;align-items:center}.finding header span{border-radius:4px;padding:2px 5px;background:#2a3240;font-weight:900}.finding>code{display:block;margin:6px 0;color:var(--accent2)}.finding p,.comment p{margin:6px 0;color:#cbd5e3}.finding details{color:var(--soft)}.tour-controls{display:flex;gap:8px;justify-content:flex-end;padding:12px 14px;border-top:1px solid var(--line)}.tour-controls button{border:1px solid var(--line);border-radius:7px;padding:7px 13px;background:var(--raised);font-size:11px;cursor:pointer}.tour-controls button:disabled{opacity:.4;cursor:default}.tour-controls .next{background:var(--accent);color:#101325;font-weight:800}.call-flow ol{padding-left:20px}.call-flow li{margin:6px 0;font-size:11px}.call-flow li.added>span{color:var(--green)}.call-flow li.removed>span{color:var(--red)}.comments,.all-findings{max-width:900px;margin:auto;padding:24px}.comments h2,.all-findings h2{font-size:15px}.empty-copy{padding:14px;color:var(--soft)}@media(max-width:1050px){.workspace{grid-template-columns:190px minmax(0,1fr) 350px}.diagram-grid{grid-template-columns:1fr}}@media(max-width:760px){html,body{height:auto;overflow:auto}.workspace{display:block}.file-panel{display:none}.diff-panel{min-height:55vh}.agent-panel{min-height:70vh;border:1px solid var(--line)}.topbar{height:auto;min-height:58px}.tour-title{display:none}.diagram-grid{grid-template-columns:1fr}}
</style></head>
<body><header class="topbar"><strong class="brand">Code Review Tour</strong><span class="comparison">${escapeHtml(session.comparison.repositoryName)} · ${escapeHtml(session.comparison.base)} → ${escapeHtml(session.comparison.branch ?? session.comparison.head.slice(0, 8))}</span><strong class="tour-title">${escapeHtml(outline?.title ?? `Code review: ${session.comparison.repositoryName}`)}</strong></header><nav class="tabs" aria-label="Review views">${tabs}</nav><main class="workspace"><aside class="file-panel"><header class="panel-heading"><span class="eyebrow">Changed files</span><span class="count">${session.comparison.files.length}</span></header><div class="file-list">${fileButtons}</div></aside><section class="diff-panel"><section class="view" data-view-panel="diff"><header class="review-overview"><span class="eyebrow">Guided tour</span><h1>${escapeHtml(outline?.title ?? `Code review: ${session.comparison.repositoryName}`)}</h1><p>${escapeHtml(outline?.summary ?? "No guided tour was generated.")}</p>${pr ? `<details class="pr-description"><summary>Pull request description</summary>${pr}</details>` : ""}${architecture ? `<details class="architecture"><summary>Architecture</summary><section class="overview-section"><div class="diagram-grid">${architectureLegend}${architecture}</div></section></details>` : ""}</header><div class="diff-toolbar"><span id="visible-file"></span><span>Split · Scroll</span></div>${diffs}</section>${callFlows ? `<section class="view" data-view-panel="calls" hidden><section class="overview-section"><span class="eyebrow">Analysis</span><h2>Call flows</h2><div class="call-grid">${callFlows}</div></section></section>` : ""}${flows ? `<section class="view" data-view-panel="sequences" hidden><section class="overview-section"><span class="eyebrow">Analysis</span><h2>Sequence diagrams</h2><div class="diagram-grid">${flows}</div></section></section>` : ""}${includeFindings ? `<section class="view all-findings" data-view-panel="findings" hidden><h2>All findings</h2>${allFindings || '<p class="empty-copy">No evidence-backed findings were generated.</p>'}</section>` : ""}${comments ? `<section class="view comments" data-view-panel="feedback" hidden><h2>Reviewer feedback</h2>${comments}</section>` : ""}</section><aside class="agent-panel"><header class="agent-heading"><div><span class="eyebrow">Tour agent</span><br><strong>Static review</strong></div><span class="mode">read-only</span></header><div class="tour-progress"><span id="step-count"></span><progress id="progress" max="${stopNumber}" value="1"></progress></div><div class="tour-scroll">${stepPanels || '<p class="empty-copy">No tour stops were generated.</p>'}</div><footer class="tour-controls"><button id="previous" type="button">Previous</button><button id="next" class="next" type="button">Next</button></footer></aside></main>
<script>(()=>{const steps=[...document.querySelectorAll('.tour-step')],files=[...document.querySelectorAll('[data-diff-file]')],fileButtons=[...document.querySelectorAll('[data-file]')],views=[...document.querySelectorAll('[data-view-panel]')],tabs=[...document.querySelectorAll('[data-view]')];let current=0;const showFile=path=>{files.forEach(node=>node.hidden=node.dataset.diffFile!==path);fileButtons.forEach(node=>node.classList.toggle('active',node.dataset.file===path));document.getElementById('visible-file').textContent=path||'No file selected'};const showView=name=>{views.forEach(node=>node.hidden=node.dataset.viewPanel!==name);tabs.forEach(node=>node.classList.toggle('active',node.dataset.view===name))};const render=()=>{if(!steps.length)return;steps.forEach((node,index)=>node.hidden=index!==current);const step=steps[current],meta=step.querySelector('.step-meta');document.getElementById('step-count').textContent='Phase '+meta.dataset.phase+' of '+meta.dataset.phaseCount+': Stop '+meta.dataset.stop+' of '+meta.dataset.stopsInPhase+' (Step '+(current+1)+')';document.getElementById('progress').value=current+1;document.getElementById('previous').disabled=current===0;const next=document.getElementById('next');next.disabled=current===steps.length-1;next.textContent=current===steps.length-1?'Tour complete':'Next';showView('diff');showFile(step.dataset.path);document.querySelectorAll('.diff-side.current').forEach(node=>node.classList.remove('current'));const anchor=document.querySelector('.diff-side[data-path="'+CSS.escape(step.dataset.path)+'"][data-side="'+step.dataset.side+'"][data-line="'+step.dataset.line+'"]');if(anchor){anchor.classList.add('current');anchor.scrollIntoView({block:'center'})}document.querySelector('.tour-scroll').scrollTop=0};document.getElementById('previous').addEventListener('click',()=>{if(current>0){current--;render()}});document.getElementById('next').addEventListener('click',()=>{if(current<steps.length-1){current++;render()}});document.addEventListener('click',event=>{const file=event.target.closest('[data-file],[data-open-file]');if(file){showView('diff');showFile(file.dataset.file||file.dataset.openFile)}const tab=event.target.closest('[data-view]');if(tab)showView(tab.dataset.view)});render()})();</script>
${architecture || flows ? `<script>${String(mermaidScript)}</script><script>mermaid.initialize({startOnLoad:false,securityLevel:"strict",theme:"dark",flowchart:{useMaxWidth:true},sequence:{useMaxWidth:true,wrap:true}});mermaid.run({querySelector:".mermaid"}).catch(()=>document.querySelectorAll(".mermaid").forEach(node=>node.classList.add("diagram-error")));</script>` : ""}</body></html>`;
}

export function exportReview(session: ReviewSession, format: ExportFormat, options: HtmlExportOptions = {}): { content: string; contentType: string; extension: string } {
  return format === "markdown"
    ? { content: markdown(session), contentType: "text/markdown; charset=utf-8", extension: "md" }
    : { content: html(session, options), contentType: "text/html; charset=utf-8", extension: "html" };
}
