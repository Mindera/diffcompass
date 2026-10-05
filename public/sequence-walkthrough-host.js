// Revalidate saved excerpts without replacing the iframe/camera. A revision
// refresh discards prior lookup candidates; the frame queues fresh candidates
// only after evidence revalidation succeeds.
// The frame supplies bounded identities, never trusted paths or line ranges.
// Revalidate a grouped action against the freshly loaded server evidence.
export function sequenceSourceSelection(anchors, anchorIndex, anchorIndices) {
  const validIndex = index => Number.isInteger(index) && index >= 0 && index < 8;
  if (!Array.isArray(anchors) || !validIndex(anchorIndex) || !anchors[anchorIndex]) return null;
  const indices = anchorIndices === undefined ? [anchorIndex] : anchorIndices;
  if (!Array.isArray(indices) || !indices.length || indices.length > 8 || indices.some(index => !validIndex(index) || !anchors[index]) || new Set(indices).size !== indices.length || !indices.includes(anchorIndex)) return null;
  const anchor = anchors[anchorIndex], selected = indices.map(index => anchors[index]);
  if (selected.length > 1) {
    if (selected.some(item => item.definition || item.path !== anchor.path || item.side !== anchor.side || !Number.isSafeInteger(item.startLine) || !Number.isSafeInteger(item.endLine) || item.startLine < 1 || item.endLine < item.startLine)) return null;
    const ordered = [...selected].sort((a, b) => a.startLine - b.startLine);
    if (ordered[0].startLine !== anchor.startLine) return null;
    let endLine = anchor.startLine - 1;
    for (const item of ordered) {
      if (item.startLine > endLine + 1) return null;
      endLine = Math.max(endLine, item.endLine);
    }
    if (endLine - anchor.startLine >= 20) return null;
  }
  return { anchor, anchors: selected };
}

export function sequenceEvidenceRevision(session, artifact) {
  const comparison = session.comparison;
  const flow = session.outline?.flows?.find(flow => artifact.id === `sequence-${flow.id}`);
  // Immutable source trees let unrelated comments/answers preserve the pane's
  // DOM and focus. Legacy comparisons without a tree refresh conservatively.
  return JSON.stringify([comparison.mergeBase, comparison.head, comparison.sourceTree ?? session.revision,
    artifact.renderedAt, flow?.outdated, flow?.mermaid, flow?.messageSources]);
}

export function refreshSequenceEvidence(frame, revision, load) {
  if (frame._sequenceEvidenceRevision === revision) return;
  const hadRevision = frame._sequenceEvidenceRevision !== undefined;
  frame._sequenceEvidenceRevision = revision;
  const request = (frame._sequenceEvidenceRequest || 0) + 1;
  frame._sequenceEvidenceRequest = request;
  const send = data => frame.contentWindow?.postMessage({ type: 'diffcompass-sequence-evidence', ...data }, '*');
  if (hadRevision) send({ sources: {}, notice: 'Review changed. Revalidating source evidence…' });
  Promise.resolve().then(load).then(sources => {
    if (frame.isConnected && frame._sequenceEvidenceRequest === request) send({ sources });
  }, () => {
    if (frame.isConnected && frame._sequenceEvidenceRequest === request) {
      send({ sources: {}, notice: 'Source evidence could not be refreshed. Reopen this map to retry.' });
      delete frame._sequenceEvidenceRevision;
    }
  });
}
