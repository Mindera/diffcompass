import { createHash } from "node:crypto";

// Version-guarded compatibility seam, pinned to the installed Monaco 0.55.1
// artifact. Expose its existing DOM -> original-source mapping, not a second
// text/row matcher. Never modify node_modules or silently patch a new version.
export const deletedSourceAsset = "vs/editor.api-CalNCsUg.js";
export const deletedSourceHash = "c10d0058fe0ee5d2c46c3b6cbb28474407be5d45ada35973f3230561f82c4de5";
const marker = 'function c1e(o){const{domNode:e,renderLinesResult:t,diffEntry:i,originalModel:n,clipboardService:s}=o,r=new V;';
const layoutMarker = 'L.push({afterLineNumber:se.modifiedRange.startLineNumber-1,domNode:ye,heightInPx:Ot.heightInLines*B,';
const paddingMarker = 'heightInPx:se.modifiedHeightInPx,marginDomNode:de,';
const hoverMarker = 'k_e((_,b)=>i.createInstance(ob,_,{instantHover:b},{}))';
const markdownMarker = 'g.setDefaultCodeBlockRenderer(i.createInstance(bB))';
const tokensMarker = '()=>w.model.original.tokenization.backgroundTokenizationState===2';
export function withDeletedSourceBridge(source) {
  if (createHash("sha256").update(source).digest("hex") !== deletedSourceHash || [marker, layoutMarker, paddingMarker, hoverMarker, markdownMarker, tokensMarker].some(marker => source.split(marker).length !== 2)) {
    throw new Error("Deleted-source adapter requires the exact pinned Monaco 0.55.1 asset; revalidate before upgrading.");
  }
  const patched = source.replace(layoutMarker, 'const reviewHeight=Pe.diffCompassLayoutDeleted?.({node:ye,margin:bt,counts:Ot.viewLineCounts,start:se.originalRange.startLineNumber,lineHeight:B})||0;L.push({afterLineNumber:se.modifiedRange.startLineNumber-1,domNode:ye,heightInPx:Ot.heightInLines*B+reviewHeight,')
    .replace(paddingMarker, 'heightInPx:se.modifiedHeightInPx,ordinal:100002,marginDomNode:de,')
    // StandaloneCodeEditor registers these GLOBAL helpers with its diff's
    // short-lived child InstantiationService. Later editors can use them after
    // that file is evicted. Bind global helpers to the initialized standalone
    // service instead (the same root used by create/createDiffEditor).
    .replace(hoverMarker, 'k_e((_,b)=>Ee.initialize({}).createInstance(ob,_,{instantHover:b},{}))')
    .replace(markdownMarker, 'g.setDefaultCodeBlockRenderer(Ee.initialize({}).createInstance(bB))')
    // Unified deleted rows cache rendered token class IDs. The native boolean
    // completion observable suppresses later completed->completed events (theme
    // changes and lazy tokenizer registration), leaving stale colors/plain text.
    // Token events may also precede the final completion-state notification.
    // Repaint on each token event through Monaco's existing zone lifecycle,
    // rather than relying on that separate completion state to change in time.
    .replace(tokensMarker, '()=>({})');
  return patched.replace(marker, marker + `
    const reviewMapping = {
      model: n, startLineNumber: i.original.startLineNumber,
      endLineNumberExclusive: i.original.endLineNumberExclusive,
      position(node, offset) {
        if (!e.contains(node) || n.isDisposed()) return null;
        const element = node.nodeType === 3 ? node.parentElement : node;
        const p = t.getModelPositionAt(element, offset);
        return p ? { lineNumber: p.lineNumber + i.original.startLineNumber - 1, column: p.column } : null;
      }
    };
    e.diffCompassDeletedSource = reviewMapping;
    r.add({ dispose() { if (e.diffCompassDeletedSource === reviewMapping) delete e.diffCompassDeletedSource; } });
  `);
}
