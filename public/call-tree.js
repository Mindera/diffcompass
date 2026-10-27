// Shared native call-flow tree for Diagrams, Briefing and offline review.
window.renderCallTree = function (flow, mode) {
  const escapeHtml = value => String(value ?? "").replace(/[&<>"\']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "\'": "&#39;" }[c]));
  const nodes = new Map(flow.nodes.map((node) => [node.id, node]));
  const visibleNode = (node) => Boolean(node) && (mode === "before" ? node.change !== "added" : mode === "after" ? node.change !== "removed" : true);
  const edges = flow.edges.filter((edge) => (mode === "before" ? edge.change !== "added" : mode === "after" ? edge.change !== "removed" : true) && visibleNode(nodes.get(edge.from)) && visibleNode(nodes.get(edge.to)));
  const children = new Map();
  for (const edge of edges) children.set(edge.from, [...(children.get(edge.from) ?? []), edge]);
  let renderBudget = 240;
  const renderBranch = (nodeId, ancestry = new Set(), depth = 0) => {
    if (renderBudget <= 0) return '<span class="call-tree-limit">More branches omitted</span>';
    renderBudget -= 1;
    const node = nodes.get(nodeId);
    if (!node || !visibleNode(node)) return "";
    const location = mode === "before" ? node.oldLocation : mode === "after" ? node.newLocation : node.newLocation ?? node.oldLocation;
    const recursive = ancestry.has(nodeId);
    const nextAncestry = new Set(ancestry).add(nodeId);
    const branches = recursive || depth >= 12 ? "" : (children.get(nodeId) ?? []).map((edge) => {
      const child = nodes.get(edge.to);
      const evidence = mode === "before" ? edge.oldCallSite : mode === "after" ? edge.newCallSite : edge.change === "removed" ? edge.oldCallSite : edge.newCallSite ?? edge.oldCallSite;
      return `<li class="call-edge ${edge.change}" data-edge-id="${escapeHtml(edge.id)}"><div class="call-edge-row"><span class="call-edge-mark" aria-label="${escapeHtml(edge.change)}">${edge.change === "added" ? "+" : edge.change === "removed" ? "−" : "→"}</span>${evidence ? `<button class="call-edge-link" type="button" data-call-path="${escapeHtml(evidence.path)}" data-call-side="${evidence.side}" data-call-line="${evidence.line}" title="Open call site ${escapeHtml(`${evidence.path}:${evidence.line}`)}">${escapeHtml(edge.label || "calls")}</button>` : `<span>${escapeHtml(edge.label || "calls")}</span>`}<span class="call-arrow">→</span><span class="call-child-label">${escapeHtml(child?.label ?? edge.to)}</span></div>${renderBranch(edge.to, nextAncestry, depth + 1)}</li>`;
    }).join("");
    return `<div data-node-id="${escapeHtml(node.id)}" class="call-node ${node.change}${nodeId === flow.entrypointNodeId ? " entrypoint" : ""}"><div class="call-node-row"><span class="call-kind">${escapeHtml(node.kind)}</span>${location ? `<button type="button" class="call-node-link" data-call-path="${escapeHtml(location.path)}" data-call-side="${location.side}" data-call-line="${location.line}">${escapeHtml(node.label)}</button>` : `<strong>${escapeHtml(node.label)}</strong>`}${recursive ? '<span class="call-cycle">recursive</span>' : ""}</div>${branches ? `<ul>${branches}</ul>` : ""}</div>`;
  };
  const tree = renderBranch(flow.entrypointNodeId);
  if (tree) return tree;
  const entrypoint = nodes.get(flow.entrypointNodeId);
  if (mode === "before" && entrypoint?.change === "added") return '<p class="call-tree-empty">This entrypoint did not exist before the change.</p>';
  if (mode === "after" && entrypoint?.change === "removed") return '<p class="call-tree-empty">This entrypoint no longer exists after the change.</p>';
  return '<p class="call-tree-empty">No calls are available in this view.</p>';
};
