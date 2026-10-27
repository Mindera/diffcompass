// @ts-expect-error Bun embeds the shared native call-flow renderer.
import callTree from "../public/call-tree.js" with { type: "text" };
// @ts-expect-error Bun embeds the same call-flow styles.
import callTreeStyles from "../public/call-tree.css" with { type: "text" };
import { briefingDiagramHtml } from "./briefing-diagrams.ts";
import type { BriefingDocument } from "./briefing.ts";
import { briefingEvidenceText } from "./briefing-diff.ts";
// @ts-expect-error Bun embeds the same reader for offline review.
import reader from "../public/briefing.js" with { type: "text" };
// @ts-expect-error Bun embeds the shared reader styles.
import styles from "../public/briefing.css" with { type: "text" };
const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const fence = (text: string, language = "") => { const marker = "`".repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map(m => m[0].length + 1))); return `${marker}${language}\n${text}\n${marker}`; };
export function briefingMarkdown(document?: BriefingDocument): string {
  if (!document) return "";
  const lines = ["## Briefing", "", escape(document.title), "", `Saved snapshot: ${document.createdAt}${document.outdated ? " (outdated)" : ""}.`, ""];
  for (const s of document.sections) {
    lines.push(`### ${escape(s.title)}`, "");
    for (const b of s.blocks) {
      if (b.kind === "prose") lines.push(b.basis ? `*${b.basis === "stated" ? "Stated intent" : b.basis === "inferred" ? "Inference" : "Observed behavior"}*` : "", escape(b.text), "");
      if (b.kind === "example") lines.push("*Illustrative example*", fence(b.text, b.language), "");
      if (b.kind === "source") {
        const e = document.evidence.find(e => e.id === b.evidenceId);
        if (e) lines.push(`[${escape(e.path)}:${e.startLine}–${e.endLine} (${e.kind === "code" ? "diff" : e.side === "old" ? "before" : "after"})](#briefing-evidence-${e.id})`, "", e.available && (e.kind !== "code" || e.diff?.available) ? fence(briefingEvidenceText(e), e.kind === "code" ? "diff" : "") : escape(briefingEvidenceText(e)), "");
      }
      if (b.kind === "diagram") {
        const d = document.diagrams.find(d => d.id === b.diagramId); if (!d) continue;
        lines.push(`**${escape(d.title)}** (${d.family})`, "", d.mermaid ? fence(d.mermaid, "mermaid") : "", "");
        for (const e of d.elements) lines.push(`- ${escape(e.label)} (${escape(e.kind)}): ${e.evidenceIds.length ? e.evidenceIds.map(id => `[evidence](#briefing-evidence-${id})`).join(", ") : "no verified source binding"}`);
        lines.push("");
      }
    }
  }
  lines.push("### Briefing evidence", "");
  for (const e of document.evidence) lines.push(`<a id="briefing-evidence-${e.id}"></a>`, `**${escape(e.path)}:${e.startLine}–${e.endLine} (${e.side}; ${e.kind})**`, "", e.available && (e.kind !== "code" || e.diff?.available) ? fence(briefingEvidenceText(e), e.kind === "code" ? "diff" : "") : escape(briefingEvidenceText(e)), "");
  return lines.join("\n") + "\n";
}
export function withBriefingExport(html: string, document: BriefingDocument | undefined, comparison: { repositoryName: string; branch?: string }): string {
  if (!document) return html;
  const diagramHtml = JSON.stringify(Object.fromEntries(document.diagrams.flatMap(diagram => {
    const html = briefingDiagramHtml(diagram);
    return html ? [[diagram.id, html]] : [];
  }))).replace(/</g, "\\u003c");
  const snapshot = { ...document, diagrams: document.diagrams.map(({ archifyHtml: _html, ...diagram }) => diagram) };
  const data = JSON.stringify({ outline: { briefing: snapshot }, comparison }).replace(/</g, "\\u003c");
  const button = '<button id="export-briefing-tab" type="button">Briefing</button>';
  const body = `<style>${styles}\n${callTreeStyles}
#export-briefing{--border:var(--line);--muted:var(--soft);position:fixed;inset:98px 0 0;background:var(--bg,#f6f8fc);z-index:10;display:grid;grid-template-columns:200px minmax(0,1fr) 400px;color:var(--text,#172033)}#export-briefing[hidden]{display:none}#export-briefing.evidence-closed{grid-template-columns:200px minmax(0,1fr) 40px}#export-briefing-scroll{overflow:auto}#export-briefing-pane{background:var(--panel,#fff);border-left:1px solid var(--border,#ccd4e0)}#export-briefing [data-briefing-ask],#export-briefing [data-briefing-generate],#export-briefing [data-briefing-source]{display:none}#export-briefing-close{position:fixed;right:16px;bottom:16px;z-index:11}#export-briefing .text-button:not([data-briefing-section]){border:0;background:none;color:var(--accent);cursor:pointer;padding:4px}#export-briefing .briefing-canvas svg{max-height:none}@media(max-width:900px){#export-briefing{grid-template-columns:minmax(0,1fr) minmax(220px,40vw)}#export-briefing-outline{display:none}#export-briefing.evidence-closed{grid-template-columns:minmax(0,1fr) 40px}}
</style><section id="export-briefing" hidden aria-label="Saved Briefing"><aside id="export-briefing-outline" class="briefing-outline"></aside><div id="export-briefing-scroll"><article id="export-briefing-reader" class="briefing-view"></article></div><aside id="export-briefing-pane" class="briefing-inspector"></aside><div id="export-briefing-chips" hidden></div><button id="export-briefing-close" type="button">Close Briefing</button></section><script>${callTree}\n${reader}</script><script>
window.addEventListener('DOMContentLoaded',()=>{const get=id=>document.getElementById(id),panel=get('export-briefing');const diagrams=${diagramHtml};const reader=createBriefingReader({diagramHtml:(_document,diagram)=>diagrams[diagram.id],view:get('export-briefing-reader'),outline:get('export-briefing-outline'),pane:get('export-briefing-pane'),chips:get('export-briefing-chips'),openTools:()=>panel.classList.remove('evidence-closed'),closeTools:()=>panel.classList.add('evidence-closed'),toolsCollapsed:()=>panel.classList.contains('evidence-closed')});let rendered=false;get('export-briefing-tab').addEventListener('click',()=>{panel.hidden=false;reader.setActive(true);if(!rendered){reader.render(${data});rendered=true}});get('export-briefing-close').addEventListener('click',()=>{reader.setActive(false);panel.hidden=true;get('export-briefing-tab').focus()});document.querySelector('.tabs').addEventListener('click',event=>{if(event.target.closest('[data-view]')){panel.hidden=true;reader.setActive(false)}})});
</script>`;
  const page = html.replace(/(<nav class="tabs"[^>]*>)/, (_, opening: string) => opening + button);
  // Bundled Mermaid contains HTML strings, including closing body tags. Insert
  // at the actual final document boundary, never inside the bundled script.
  const boundary = page.lastIndexOf("</body>");
  return page.slice(0, boundary) + body + page.slice(boundary);
}
