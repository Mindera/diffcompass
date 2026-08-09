import type { ReviewSession } from "./session.ts";

export type ExportFormat = "markdown" | "html";

function markdownFence(language: string, content: string): string {
  const longest = Math.max(2, ...[...content.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(longest + 1);
  return `${fence}${language}\n${content}\n${fence}`;
}

function markdownText(value: unknown): string {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
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
  if (outline?.flows.length) {
    lines.push("## Flows", "");
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

function html(session: ReviewSession): string {
  const outline = session.outline;
  let stopNumber = 0;
  const steps = outline?.phases.map((phase, phaseIndex) => `<section><h3>Phase ${phaseIndex + 1}: ${escapeHtml(phase.title)}</h3><p>${escapeHtml(phase.summary)}</p><ul>${phase.fileChanges.map((file) => `<li><code>${escapeHtml(file.path)}</code> — ${escapeHtml(file.summary)}</li>`).join("")}</ul>${phase.steps.map((step) => { stopNumber += 1; return `<section><h4>Stop ${stopNumber}: ${escapeHtml(step.title)}</h4><code>${escapeHtml(step.anchor.path)}:${step.anchor.startLine}-${step.anchor.endLine} (${step.anchor.side})</code><p>${escapeHtml(step.objective)}</p>${step.explanation ? `<div class="prose">${escapeHtml(step.explanation)}</div>` : ""}</section>`; }).join("")}</section>`).join("") ?? "";
  const flows = outline?.flows.map((flow) => `<section><h3>${escapeHtml(flow.title)}</h3><p class="meta">${flow.provenance}; affects ${flow.affectedFiles?.length || flow.blastRadiusSize} changed files</p><p>${escapeHtml(flow.summary)}</p><h4>Affected changed files</h4>${flow.affectedFiles?.length ? `<ul>${flow.affectedFiles.map((path) => `<li><code>${escapeHtml(path)}</code></li>`).join("")}</ul>` : "<p>Exact affected files were not captured for this saved tour.</p>"}<pre><code>${escapeHtml(flow.mermaid)}</code></pre></section>`).join("") ?? "";
  const findings = outline?.findings.map((finding) => `<section class="finding"><h3>${finding.priority}: ${escapeHtml(finding.category)} at ${escapeHtml(finding.path)}:${finding.line}</h3><p class="meta">Scope: ${escapeHtml(finding.phaseId ?? "unscoped")}${finding.stepId ? ` / ${escapeHtml(finding.stepId)}` : ""}; status: ${finding.status}; severity: ${finding.severity}; confidence: ${finding.confidence}</p><p>${escapeHtml(finding.message)}</p><p><strong>Evidence:</strong> ${escapeHtml(finding.evidence)}</p></section>`).join("") ?? "";
  const comments = session.comments.map((comment) => `<section class="comment"><h3>${escapeHtml(comment.path)}:${comment.line} (${comment.side})</h3><p class="meta">Status: ${comment.status}</p><p>${escapeHtml(comment.body)}</p></section>`).join("");
  const files = session.comparison.files.map((file) => `<li><code>${escapeHtml(file.path)}</code> (${file.status}, +${file.additions}/-${file.deletions})${session.reviewedFiles.has(file.path) ? " — reviewed" : ""}</li>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(outline?.title ?? "Code review tour")}</title>
<style>:root{color-scheme:light dark;font-family:ui-sans-serif,system-ui,sans-serif}body{max-width:980px;margin:0 auto;padding:40px 24px;line-height:1.55}h1{font-size:2rem}h2{margin-top:2.5rem;border-bottom:1px solid #8885;padding-bottom:.35rem}h3{margin-bottom:.35rem}section{margin:1.4rem 0}code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}pre{overflow:auto;padding:16px;border:1px solid #8885;border-radius:8px;background:#8881;white-space:pre}.meta{color:#777;font-size:.9rem}.prose{white-space:pre-wrap}.finding{border-left:4px solid #d97706;padding-left:14px}.comment{border-left:4px solid #6366f1;padding-left:14px}</style></head>
<body><header><h1>${escapeHtml(outline?.title ?? `Code review: ${session.comparison.repositoryName}`)}</h1><p>${escapeHtml(outline?.summary ?? "No guided tour was generated.")}</p><p class="meta">Repository: ${escapeHtml(session.comparison.repositoryName)} · Base: ${escapeHtml(session.comparison.base)} · Merge base: ${escapeHtml(session.comparison.mergeBase)} · Head: ${escapeHtml(session.comparison.head)} · Status: ${session.status}</p></header>
${steps ? `<h2>Tour</h2>${steps}` : ""}${flows ? `<h2>Flows</h2>${flows}` : ""}${findings ? `<h2>Findings</h2>${findings}` : ""}${comments ? `<h2>Reviewer feedback</h2>${comments}` : ""}
<h2>Changed files</h2><ul>${files}</ul><h2>Diff</h2><pre><code>${escapeHtml(session.comparison.patch)}</code></pre></body></html>`;
}

export function exportReview(session: ReviewSession, format: ExportFormat): { content: string; contentType: string; extension: string } {
  return format === "markdown"
    ? { content: markdown(session), contentType: "text/markdown; charset=utf-8", extension: "md" }
    : { content: html(session), contentType: "text/html; charset=utf-8", extension: "html" };
}
