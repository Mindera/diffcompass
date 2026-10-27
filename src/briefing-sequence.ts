import { ArchifyRenderer } from "./archify.ts";
import { withArchifyEmbedAdapter } from "./archify-embed.ts";
import type { BriefingDiagram, BriefingDocument } from "./briefing.ts";
import type { ArchifyArtifact } from "./types.ts";

export const BRIEFING_SEQUENCE_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; worker-src blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

/** Keep the rendered viewer with the saved story, even if its tour is regenerated. */
export async function captureBriefingSequences(document: BriefingDocument, artifacts: ArchifyArtifact[] = [], renderer: Pick<ArchifyRenderer, "renderSequenceSnapshot"> | null | undefined = ArchifyRenderer.fromEnvironment()): Promise<void> {
  for (const diagram of document.diagrams) {
    if (diagram.family !== "sequence" || diagram.archifyHtml) continue;
    const artifact = artifacts.find(item => item.id === diagram.id && item.type === "sequence" && JSON.stringify(item.ir) === JSON.stringify(diagram.ir));
    if (artifact?.html) diagram.archifyHtml = artifact.html;
    else if (renderer) {
      try { diagram.archifyHtml = await renderer.renderSequenceSnapshot(diagram.id, diagram.title, diagram.ir); }
      catch { /* Saved message identities and diff evidence remain available. */ }
    }
  }
}

export function briefingSequenceHtml(diagram: BriefingDiagram): string | undefined {
  if (diagram.family !== "sequence" || !diagram.archifyHtml) return undefined;
  const html = withArchifyEmbedAdapter(diagram.archifyHtml, "sequence", undefined, false, undefined, undefined, { ir: diagram.ir, externalInspector: true });
  // srcdoc exports need the same network isolation as the live iframe route.
  return html.replace(/<head\b[^>]*>/i, opening => `${opening}<meta http-equiv="Content-Security-Policy" content="${BRIEFING_SEQUENCE_CSP}">`);
}
