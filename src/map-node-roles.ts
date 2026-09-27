/** Technical roles are independent of domain vocabulary and renderer colours. */
export const MAP_NODE_ROLES = [
  "Person", "Agent", "Agent skill", "Script", "Function", "Service", "UI element",
  "Template", "File", "Data store", "External system", "Feature", "Screen",
  "UI component", "ViewModel", "Use case", "Domain model", "UI model",
  "Repository", "Data source", "Mapper", "API endpoint", "Test",
] as const;
export type MapNodeRole = { type: typeof MAP_NODE_ROLES[number]; evidence: string };
export type MapNodeRoles = Record<string, MapNodeRole>;

export function validateMapNodeRoles(value: unknown, ids?: Set<string>): MapNodeRoles | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 80) throw new Error("nodeRoles must be a map of at most 80 node ids.");
  const result: MapNodeRoles = {};
  for (const [id, entry] of Object.entries(value)) {
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(id) || ["__proto__", "constructor", "prototype"].includes(id) || (ids && !ids.has(id))) throw new Error(`Unknown nodeRoles id: ${id}`);
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Each node role requires type and evidence.");
    const role = entry as Record<string, unknown>;
    if (Object.keys(role).some(key => key !== "type" && key !== "evidence") || !MAP_NODE_ROLES.includes(role.type as MapNodeRole["type"]) || typeof role.evidence !== "string" || !role.evidence.trim() || role.evidence.length > 2000) throw new Error("Node role requires a supported type and a short source-grounded explanation.");
    result[id] = { type: role.type as MapNodeRole["type"], evidence: role.evidence.trim() };
  }
  return result;
}

export const MAP_NODE_ROLE_PROMPT = `For architecture and sequence diagrams, include optional nodeRoles keyed by the exact Mermaid node/participant id: {"A":{"type":"Script","evidence":"tools/assemble.py:42 defines the CLI entry point that assembles the page"}}. Use the most specific evidenced role from: ${MAP_NODE_ROLES.join(", ")}. Inspect the referenced implementation or documentation: a name suffix alone is not evidence. Distinguish an agent from the skill it uses, and a repository implementation from a Git repository. A file containing agent instructions is an Agent skill when that role is established. Keep actual node names unchanged and domain vocabulary separate. Omit unknown roles instead of guessing. Evidence must explain the classification and cite the inspected source (path and line when applicable).`;

/** Assign display kinds before Archify initializes its passport, finder and lens. */
export function applyMapNodeRoles(html: string, roles?: MapNodeRoles, domainModel = false): string {
  const valid = validateMapNodeRoles(roles) ?? {};
  return html.replace(/<g\b[^>]*\bdata-node-id="([^"]+)"[^>]*>/g, (tag, id: string) => {
    const role = valid[id];
    if (role) return tag.replace(/data-node-kind="[^"]*"/, `data-node-kind="review-${role.type.toLowerCase().replaceAll(" ", "-")}"`);
    if (!domainModel) return tag.replace(/data-node-kind="(?:backend|external)"/, 'data-node-kind="review-unspecified"');
    return tag;
  });
}
