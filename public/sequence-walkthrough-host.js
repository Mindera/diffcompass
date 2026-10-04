// Revalidate saved excerpts without replacing the iframe/camera. A revision
// refresh never performs definition lookup and discards prior lookup candidates.
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
