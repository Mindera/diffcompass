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
  return `<div class="diff-side ${row.kind}"><span class="line-number">${line ?? ""}</span><span class="line-marker">${marker}</span><code>${escapeHtml(row.content)}</code>${badges}</div>`;
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
  const architectureSection = (label: string, architecture: ReviewArchitecture) => `<article class="diagram-card"><span class="eyebrow">${escapeHtml(label)}</span><h3>${escapeHtml(architecture.title)}</h3><p>${escapeHtml(architecture.summary)}</p><div class="mermaid">${escapeHtml(architecture.mermaid)}</div><h4>Relationship changes</h4><ul>${architecture.dependencyChanges.map((change) => `<li>${escapeHtml(change)}</li>`).join("")}</ul></article>`;
  const architecture = includeDiagrams ? [outline?.behaviorArchitecture ? architectureSection(`${outline.behaviorArchitectureStatus === "proposed" ? "Proposed" : "Implemented"} behaviour`, outline.behaviorArchitecture) : "", outline?.architecture ? architectureSection("Implementation journey", outline.architecture) : ""].join("") : "";
  const phases = outline?.phases.map((phase, phaseIndex) => {
    const phaseFindings = findings.filter((finding) => finding.phaseId === phase.id && !finding.stepId);
    const steps = phase.steps.map((step) => {
      stopNumber += 1;
      const scoped = findings.filter((finding) => finding.stepId === step.id);
      return `<article class="stop" id="stop-${stopNumber}"><div class="stop-number">Stop ${stopNumber}</div><h3>${escapeHtml(step.title)}</h3><p class="objective">${escapeHtml(step.objective)}</p><code class="anchor">${escapeHtml(step.anchor.path)}:${step.anchor.startLine}-${step.anchor.endLine} · ${step.anchor.side}</code><div class="prose">${renderedMarkdown(step.explanation ?? "Explanation unavailable.")}</div>${scoped.length ? `<div class="scoped-findings"><h4>Findings at this stop</h4>${scoped.map(findingCard).join("")}</div>` : ""}</article>`;
    }).join("");
    const diffs = [...new Set(phase.fileChanges.map((file) => file.path))].map((path) => filesByPath.get(path)).filter((file): file is DiffFile => Boolean(file)).map((file) => fileDiff(file, findings, session)).join("");
    return `<section class="phase" id="phase-${phaseIndex + 1}"><header class="phase-heading"><span>Phase ${phaseIndex + 1}</span><h2>${escapeHtml(phase.title)}</h2><p>${escapeHtml(phase.summary)}</p></header><details class="phase-files"><summary>${phase.fileChanges.length} file${phase.fileChanges.length === 1 ? "" : "s"} in this phase</summary><ul>${phase.fileChanges.map((file) => `<li><code>${escapeHtml(file.path)}</code><span>${escapeHtml(file.summary)}</span></li>`).join("")}</ul></details>${phaseFindings.length ? `<div class="phase-findings"><h3>Phase findings</h3>${phaseFindings.map(findingCard).join("")}</div>` : ""}<div class="stops">${steps}</div>${diffs ? `<div class="phase-diffs"><h3>Changes in this phase</h3>${diffs}</div>` : ""}</section>`;
  }).join("") ?? "";
  const flows = includeDiagrams ? outline?.flows.map((flow) => `<article class="diagram-card"><span class="eyebrow">${escapeHtml(flow.provenance)} · affects ${flow.affectedFiles?.length || flow.blastRadiusSize}</span><h3>${escapeHtml(flow.title)}</h3><p>${escapeHtml(flow.summary)}</p><div class="mermaid">${escapeHtml(flow.mermaid)}</div></article>`).join("") ?? "" : "";
  const callFlows = includeCallFlows ? outline?.callFlows?.map((flow) => { const nodes = new Map(flow.nodes.map((node) => [node.id, node])); return `<article class="call-flow"><span class="eyebrow">${escapeHtml(flow.provenance)}</span><h3>${escapeHtml(flow.title)}</h3><p>${escapeHtml(flow.summary)}</p><p><strong>Entry point:</strong> <code>${escapeHtml(nodes.get(flow.entrypointNodeId)?.label ?? flow.entrypointNodeId)}</code></p><ol>${flow.edges.map((edge) => `<li class="${edge.change}"><span>${edge.change === "added" ? "+" : edge.change === "removed" ? "−" : "→"}</span><code>${escapeHtml(nodes.get(edge.from)?.label ?? edge.from)}</code> → <code>${escapeHtml(nodes.get(edge.to)?.label ?? edge.to)}</code>${edge.label ? ` <small>${escapeHtml(edge.label)}</small>` : ""}</li>`).join("")}</ol></article>`; }).join("") ?? "" : "";
  const comments = session.comments.map((comment) => `<article class="comment"><code>${escapeHtml(comment.path)}:${comment.line} · ${comment.side}</code><p>${inlineHtml(comment.body)}</p><span>${escapeHtml(comment.status)}</span></article>`).join("");
  const unscopedFindings = findings.filter((finding) => !finding.phaseId && !finding.stepId);
  const pr = session.pullRequest ? `<section class="pr-description"><span class="eyebrow">Pull request #${session.pullRequest.number} · ${escapeHtml(session.pullRequest.author)}</span><h2>${escapeHtml(session.pullRequest.title)}</h2><div class="prose">${renderedMarkdown(session.pullRequest.body || "No pull request description was provided.")}</div></section>` : "";
  const nav = outline?.phases.map((phase, index) => `<a href="#phase-${index + 1}"><span>${index + 1}</span>${escapeHtml(phase.title)}</a>`).join("") ?? "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(outline?.title ?? "Code review tour")}</title>
<style>
:root{color-scheme:dark;--bg:#080e17;--panel:#0e1724;--raised:#121e2d;--line:#26364b;--soft:#91a0b5;--text:#e8edf5;--accent:#9b8cff;--green:#43d99a;--red:#ff7381;--amber:#f6bd55;--code:#07101a;font-family:Inter,ui-sans-serif,system-ui,sans-serif}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--text);line-height:1.55}body>header,.content{width:min(1440px,calc(100% - 40px));margin:auto}body>header{padding:54px 0 30px}h1{max-width:980px;margin:.25rem 0;font-size:clamp(2rem,5vw,4.3rem);line-height:1.02;letter-spacing:-.045em}h2,h3,h4,p{margin-top:0}.eyebrow,.stop-number,.phase-heading>span{color:var(--accent);font-size:.72rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.summary{max-width:850px;color:var(--soft);font-size:1.08rem}.meta{color:var(--soft);font:12px ui-monospace,SFMono-Regular,Menlo,monospace}.phase-nav{position:sticky;top:0;z-index:10;display:flex;gap:8px;padding:12px 20px;overflow:auto;border-block:1px solid var(--line);background:#080e17ee;backdrop-filter:blur(14px)}.phase-nav a{display:flex;align-items:center;gap:7px;border:1px solid var(--line);border-radius:999px;padding:6px 10px;color:var(--soft);font-size:.78rem;text-decoration:none;white-space:nowrap}.phase-nav a:hover{color:var(--text);border-color:var(--accent)}.phase-nav span{color:var(--accent)}.content{padding:24px 0 80px}.pr-description,.overview-section,.phase{margin:0 0 28px;border:1px solid var(--line);border-radius:16px;background:var(--panel)}.pr-description,.overview-section{padding:24px}.pr-description h2{margin:.35rem 0 1rem}.diagram-grid,.call-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,480px),1fr));gap:14px}.diagram-card,.call-flow{min-width:0;border:1px solid var(--line);border-radius:12px;padding:17px;background:var(--raised)}.diagram-card h3,.call-flow h3{margin:.3rem 0 .45rem}.mermaid{display:grid;min-height:220px;margin-top:14px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:14px;place-items:center;background:var(--code)}.mermaid svg{max-width:100%;height:auto}.phase{overflow:hidden}.phase-heading{padding:25px 25px 18px}.phase-heading h2{margin:.3rem 0;font-size:1.65rem}.phase-heading p{max-width:850px;margin:0;color:var(--soft)}.phase-files{border-block:1px solid var(--line);padding:12px 25px}.phase-files summary,.file-diff summary{cursor:pointer}.phase-files ul{display:grid;gap:8px;padding:0;list-style:none}.phase-files li{display:grid;grid-template-columns:minmax(220px,.6fr) 1fr;gap:14px}.phase-files li span{color:var(--soft)}.stops{display:grid;gap:14px;padding:22px}.stop{border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:12px;padding:20px;background:var(--raised)}.stop h3{margin:.2rem 0 .35rem;font-size:1.25rem}.objective{color:var(--soft)}code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.anchor{display:inline-block;margin-bottom:16px;color:var(--accent)}.prose p{margin:0 0 .8rem}.prose code{border-radius:5px;padding:2px 5px;background:#243146}.prose pre{overflow:auto;border:1px solid var(--line);border-radius:8px;padding:12px;background:var(--code)}.prose li{margin:.25rem 0}.phase-findings,.scoped-findings,.phase-diffs{padding:0 22px 22px}.finding,.comment{margin:9px 0;border:1px solid var(--line);border-left:4px solid var(--amber);border-radius:10px;padding:13px;background:var(--raised)}.finding.p0,.finding.p1{border-left-color:var(--red)}.finding header{display:flex;gap:9px;align-items:center}.finding header span{border-radius:5px;padding:2px 6px;background:#2b3546;font-weight:900}.finding>code{display:block;margin:7px 0;color:var(--accent)}.finding details{color:var(--soft)}.comment{border-left-color:var(--accent)}.comment span{color:var(--soft);font-size:.75rem}.file-diff{margin:12px 0;overflow:hidden;border:1px solid var(--line);border-radius:11px;background:var(--code)}.file-diff>summary{display:flex;gap:10px;align-items:center;padding:11px 14px;background:var(--raised)}.file-diff>summary span{color:var(--accent);font-size:.7rem;text-transform:uppercase}.file-diff>summary small{margin-left:auto;color:var(--soft)}.diff-hunk{overflow-x:auto}.hunk-heading{position:sticky;left:0;padding:5px 12px;color:#9db3d1;background:#142236;font:12px ui-monospace,SFMono-Regular,Menlo,monospace}.diff-row{display:grid;grid-template-columns:minmax(520px,1fr) minmax(520px,1fr);min-width:1040px}.diff-side{display:grid;grid-template-columns:52px 20px minmax(max-content,1fr) auto;min-width:0;border-bottom:1px solid #172231;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}.diff-side:first-child{border-right:1px solid var(--line)}.diff-side code{display:block;padding:2px 8px;white-space:pre}.diff-side.addition{background:#12372e}.diff-side.deletion{background:#3b2027}.empty-line{min-height:22px;background:#09121d}.line-number,.line-marker{padding:2px 7px;color:#718198;text-align:right}.line-marker{padding-inline:3px}.line-badge{align-self:center;margin-right:5px;border-radius:4px;padding:1px 4px;font:700 9px system-ui}.finding-badge{background:var(--amber);color:#171007}.comment-badge{background:var(--accent);color:#fff}.call-flow ol{padding-left:22px}.call-flow li{margin:7px 0}.call-flow li.added>span{color:var(--green)}.call-flow li.removed>span{color:var(--red)}.call-flow small{color:var(--soft)}.empty-copy{padding:14px;color:var(--soft)}@media(max-width:760px){body>header,.content{width:min(100% - 20px,1440px)}.phase-files li{grid-template-columns:1fr}}
</style></head>
<body><header><span class="eyebrow">Code Review Tour · static export</span><h1>${escapeHtml(outline?.title ?? `Code review: ${session.comparison.repositoryName}`)}</h1><p class="summary">${escapeHtml(outline?.summary ?? "No guided tour was generated.")}</p><p class="meta">${escapeHtml(session.comparison.repositoryName)} · ${escapeHtml(session.comparison.base)} → ${escapeHtml(session.comparison.branch ?? session.comparison.head.slice(0, 8))} · ${session.comparison.files.length} changed files · ${stopNumber} stops · ${session.status}</p></header>
${nav ? `<nav class="phase-nav" aria-label="Tour phases">${nav}</nav>` : ""}<main class="content">${pr}${architecture ? `<section class="overview-section"><span class="eyebrow">Components</span><h2>How the change fits together</h2><div class="diagram-grid">${architecture}</div></section>` : ""}${phases}${callFlows ? `<section class="overview-section"><span class="eyebrow">Analysis</span><h2>Call flows</h2><div class="call-grid">${callFlows}</div></section>` : ""}${flows ? `<section class="overview-section"><span class="eyebrow">Analysis</span><h2>Sequence diagrams</h2><div class="diagram-grid">${flows}</div></section>` : ""}${unscopedFindings.length ? `<section class="overview-section"><h2>Other findings</h2>${unscopedFindings.map(findingCard).join("")}</section>` : ""}${comments ? `<section class="overview-section"><h2>Reviewer feedback</h2>${comments}</section>` : ""}</main>
${architecture || flows ? `<script>${String(mermaidScript)}</script><script>mermaid.initialize({startOnLoad:false,securityLevel:"strict",theme:matchMedia("(prefers-color-scheme:light)").matches?"default":"dark",flowchart:{useMaxWidth:true},sequence:{useMaxWidth:true,wrap:true}});mermaid.run({querySelector:".mermaid"}).catch(()=>document.querySelectorAll(".mermaid").forEach(node=>node.classList.add("diagram-error")));</script>` : ""}</body></html>`;
}

export function exportReview(session: ReviewSession, format: ExportFormat, options: HtmlExportOptions = {}): { content: string; contentType: string; extension: string } {
  return format === "markdown"
    ? { content: markdown(session), contentType: "text/markdown; charset=utf-8", extension: "md" }
    : { content: html(session, options), contentType: "text/html; charset=utf-8", extension: "html" };
}
