import { ArchifyRenderer } from "./archify.ts";
import { withArchifyEmbedAdapter } from "./archify-embed.ts";
import type { BriefingDiagram, BriefingDocument } from "./briefing.ts";
import type { ArchifyArtifact, ArchifyDiagramType } from "./types.ts";
// @ts-expect-error Bun embeds the same selection bridge in live/offline frames.
import inspector from "../public/briefing-diagram.js" with { type: "text" };

export const BRIEFING_DIAGRAM_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; worker-src blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

/** Keep the rendered viewer with the saved story, even if its tour is regenerated. */
export async function captureBriefingDiagrams(document: BriefingDocument, artifacts: ArchifyArtifact[] = [], renderer: Pick<ArchifyRenderer, "renderSnapshot"> | null | undefined = ArchifyRenderer.fromEnvironment()): Promise<void> {
  for (const diagram of document.diagrams) {
    const type = archifyType(diagram);
    if (!type || diagram.archifyHtml) continue;
    const artifact = artifacts.find(item => item.id === diagram.id && item.type === type && JSON.stringify(item.ir) === JSON.stringify(diagram.ir));
    if (artifact?.html) diagram.archifyHtml = artifact.html;
    else if (renderer) {
      try {
        const rendered = await renderer.renderSnapshot(diagram.id, diagram.title, type, diagram.ir);
        diagram.archifyHtml = rendered.html;
        diagram.ir = rendered.ir;
      } catch { /* Saved element identities and diff evidence remain available. */ }
    }
  }
}

function archifyType(diagram: BriefingDiagram): ArchifyDiagramType | undefined {
  if (diagram.family === "call-flow") return undefined;
  return diagram.family === "domain" ? "architecture" : diagram.family === "data-model" ? "dataflow" : diagram.family;
}

export function briefingDiagramHtml(diagram: BriefingDiagram): string | undefined {
  const type = archifyType(diagram);
  if (!type || !diagram.archifyHtml) return undefined;
  let html = withArchifyEmbedAdapter(diagram.archifyHtml, type, diagram.domainDetails, diagram.family === "domain", diagram.nodeRoles, undefined, { ir: diagram.ir, externalInspector: true });
  if (type !== "sequence") {
    const elements = JSON.stringify(diagram.elements.map(({ id, kind }) => ({ id, kind }))).replace(/</g, "\\u003c");
    const bridge = `<script data-diffcompass-briefing-inspector>${inspector}\nwindow.installBriefingDiagram(${elements});</script>`;
    const boundary = html.lastIndexOf("</body>");
    html = html.slice(0, boundary) + bridge + html.slice(boundary);
  }
  // srcdoc exports need the same network isolation as the live iframe route.
  return html.replace(/<head\b[^>]*>/i, opening => `${opening}<meta http-equiv="Content-Security-Policy" content="${BRIEFING_DIAGRAM_CSP}">`);
}
