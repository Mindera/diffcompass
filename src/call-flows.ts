import type { CallFlow, CallFlowEdge, CallFlowLocation, CallFlowNode, GitComparison } from "./types.ts";

function boundedString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${field} must be a non-empty string no longer than ${max} characters.`);
  return value.trim();
}

function location(value: unknown, field: string, comparison: GitComparison, requireChangedRow = false): CallFlowLocation {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be a source location.`);
  const candidate = value as Record<string, unknown>;
  const unknown = Object.keys(candidate).find((key) => !["path", "side", "line"].includes(key));
  if (unknown) throw new Error(`${field} contains an unsupported field: ${unknown}`);
  const path = boundedString(candidate.path, `${field}.path`, 4_096);
  if (!comparison.repositoryFiles.includes(path) && !comparison.files.some((file) => file.path === path || file.oldPath === path)) throw new Error(`${field}.path must reference a repository file.`);
  if (!comparison.files.some((file) => file.path === path || file.oldPath === path)) throw new Error(`${field}.path must reference a changed file so its evidence can be reviewed.`);
  if (!['old', 'new'].includes(String(candidate.side))) throw new Error(`${field}.side must be old or new.`);
  if (!Number.isInteger(candidate.line) || Number(candidate.line) < 1 || Number(candidate.line) > 10_000_000) throw new Error(`${field}.line must be a positive integer.`);
  if (requireChangedRow) {
    const side = candidate.side as CallFlowLocation["side"];
    const line = Number(candidate.line);
    const supported = comparison.files.some((file) => (file.path === path || file.oldPath === path) && file.hunks.some((hunk) => hunk.rows.some((row) =>
      side === "old" ? row.kind === "deletion" && row.oldLine === line : row.kind === "addition" && row.newLine === line,
    )));
    if (!supported) throw new Error(`${field} must point to an added or removed diff row.`);
  }
  return { path, side: candidate.side as CallFlowLocation["side"], line: Number(candidate.line) };
}

function optionalLocation(value: unknown, field: string, comparison: GitComparison, requireChangedRow = false): CallFlowLocation | undefined {
  return value === undefined ? undefined : location(value, field, comparison, requireChangedRow);
}

function validateNode(value: unknown, comparison: GitComparison): CallFlowNode {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Call-flow node must be an object.");
  const node = value as Record<string, unknown>;
  const unknown = Object.keys(node).find((key) => !["id", "label", "kind", "change", "oldLocation", "newLocation"].includes(key));
  if (unknown) throw new Error(`Call-flow node contains an unsupported field: ${unknown}`);
  const kind = String(node.kind);
  if (!["function", "method", "constructor", "component", "branch", "external"].includes(kind)) throw new Error("Call-flow node kind is invalid.");
  const change = String(node.change);
  if (!["added", "removed", "unchanged", "modified"].includes(change)) throw new Error("Call-flow node change is invalid.");
  const oldLocation = optionalLocation(node.oldLocation, "oldLocation", comparison);
  const newLocation = optionalLocation(node.newLocation, "newLocation", comparison);
  if (change === "added" && !newLocation) throw new Error("An added call-flow node needs a new location.");
  if (change === "removed" && !oldLocation) throw new Error("A removed call-flow node needs an old location.");
  if (change === "added" && oldLocation) throw new Error("An added call-flow node cannot have an old location.");
  if (change === "removed" && newLocation) throw new Error("A removed call-flow node cannot have a new location.");
  if ((oldLocation && oldLocation.side !== "old") || (newLocation && newLocation.side !== "new")) throw new Error("Call-flow node locations must use their matching old or new side.");
  if (kind !== "external" && !oldLocation && !newLocation) throw new Error("A repository call-flow node needs a source location.");
  return {
    id: boundedString(node.id, "Call-flow node id", 128),
    label: boundedString(node.label, "Call-flow node label", 1_000),
    kind: kind as CallFlowNode["kind"],
    change: change as CallFlowNode["change"],
    oldLocation,
    newLocation,
  };
}

function validateEdge(value: unknown, nodeIds: Set<string>, comparison: GitComparison): CallFlowEdge {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Call-flow edge must be an object.");
  const edge = value as Record<string, unknown>;
  const unknown = Object.keys(edge).find((key) => !["id", "from", "to", "label", "change", "oldCallSite", "newCallSite"].includes(key));
  if (unknown) throw new Error(`Call-flow edge contains an unsupported field: ${unknown}`);
  const from = boundedString(edge.from, "Call-flow edge from", 128);
  const to = boundedString(edge.to, "Call-flow edge to", 128);
  if (!nodeIds.has(from) || !nodeIds.has(to)) throw new Error("Every call-flow edge must connect declared nodes.");
  const change = String(edge.change);
  if (!["added", "removed", "unchanged"].includes(change)) throw new Error("Call-flow edge change is invalid.");
  // Unchanged calls provide context; only changed calls require changed rows.
  const oldCallSite = optionalLocation(edge.oldCallSite, "oldCallSite", comparison, change !== "unchanged");
  const newCallSite = optionalLocation(edge.newCallSite, "newCallSite", comparison, change !== "unchanged");
  if (change === "added" && !newCallSite) throw new Error("An added call edge needs a new call-site anchor.");
  if (change === "removed" && !oldCallSite) throw new Error("A removed call edge needs an old call-site anchor.");
  if (change === "added" && oldCallSite) throw new Error("An added call edge cannot have an old call-site anchor.");
  if (change === "removed" && newCallSite) throw new Error("A removed call edge cannot have a new call-site anchor.");
  if ((oldCallSite && oldCallSite.side !== "old") || (newCallSite && newCallSite.side !== "new")) throw new Error("Call-site anchors must use their matching old or new side.");
  return {
    id: boundedString(edge.id, "Call-flow edge id", 128),
    from,
    to,
    label: edge.label === undefined ? undefined : boundedString(edge.label, "Call-flow edge label", 1_000),
    change: change as CallFlowEdge["change"],
    oldCallSite,
    newCallSite,
  };
}

export function validateCallFlow(value: unknown, comparison: GitComparison): CallFlow {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Call flow must be an object.");
  const flow = value as Record<string, unknown>;
  const unknown = Object.keys(flow).find((key) => !["id", "title", "summary", "entrypointNodeId", "provenance", "nodes", "edges", "affectedFiles", "outdated"].includes(key));
  if (unknown) throw new Error(`Call flow contains an unsupported field: ${unknown}`);
  if (flow.outdated !== undefined && typeof flow.outdated !== "boolean") throw new Error("Call-flow outdated must be a boolean.");
  if (!Array.isArray(flow.nodes) || flow.nodes.length < 2 || flow.nodes.length > 80) throw new Error("Call flow must contain between 2 and 80 nodes.");
  const nodes = flow.nodes.map((node) => validateNode(node, comparison));
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (nodeIds.size !== nodes.length) throw new Error("Call-flow node ids must be unique.");
  const entrypointNodeId = boundedString(flow.entrypointNodeId, "Call-flow entrypoint", 128);
  if (!nodeIds.has(entrypointNodeId)) throw new Error("Call-flow entrypoint must reference a declared node.");
  if (!Array.isArray(flow.edges) || flow.edges.length < 1 || flow.edges.length > 160) throw new Error("Call flow must contain between 1 and 160 edges.");
  const edges = flow.edges.map((edge) => validateEdge(edge, nodeIds, comparison));
  if (new Set(edges.map((edge) => edge.id)).size !== edges.length) throw new Error("Call-flow edge ids must be unique.");
  if (!edges.some((edge) => edge.change !== "unchanged")) throw new Error("Call flow must contain an added or removed call edge.");
  const reachable = new Set([entrypointNodeId]);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const edge of edges) {
      if (reachable.has(edge.from) && !reachable.has(edge.to)) {
        reachable.add(edge.to);
        expanded = true;
      }
    }
  }
  if (reachable.size !== nodes.length) throw new Error("Every call-flow node must be reachable from its entrypoint.");
  const provenance = String(flow.provenance);
  if (!['verified', 'partial', 'unverified'].includes(provenance)) throw new Error("Call-flow provenance must be verified, partial, or unverified.");
  const affectedFiles = [...new Set(edges.filter((edge) => edge.change !== "unchanged").flatMap((edge) => [edge.oldCallSite?.path, edge.newCallSite?.path]).filter((path): path is string => Boolean(path)))];
  if (affectedFiles.length === 0) throw new Error("Call flow must contain at least one changed call edge with diff evidence.");
  if (flow.affectedFiles !== undefined && (!Array.isArray(flow.affectedFiles) || flow.affectedFiles.some((path) => typeof path !== "string") || new Set(flow.affectedFiles).size !== flow.affectedFiles.length || flow.affectedFiles.length !== affectedFiles.length || flow.affectedFiles.some((path) => !affectedFiles.includes(path)))) {
    throw new Error("Call-flow affectedFiles must exactly match its changed call-site evidence.");
  }
  return {
    id: boundedString(flow.id, "Call-flow id", 128),
    title: boundedString(flow.title, "Call-flow title", 8_000),
    summary: boundedString(flow.summary, "Call-flow summary", 50_000),
    entrypointNodeId,
    provenance: provenance as CallFlow["provenance"],
    nodes,
    edges,
    affectedFiles,
    ...(flow.outdated === true ? { outdated: true } : {}),
  };
}

export function validateCallFlows(value: unknown, comparison: GitComparison): CallFlow[] {
  if (!Array.isArray(value) || value.length > 8) throw new Error("Call flows must contain at most 8 entrypoints.");
  const flows = value.map((flow) => validateCallFlow(flow, comparison));
  if (new Set(flows.map((flow) => flow.id)).size !== flows.length) throw new Error("Call-flow ids must be unique.");
  return flows;
}
