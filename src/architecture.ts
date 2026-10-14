import { normalizeElementSources } from "./briefing.ts";
import type { ReviewArchitecture } from "./types.ts";
import { validateMapNodeRoles } from "./map-node-roles.ts";

const HEADER = /^flowchart\s+LR$/;
const NODE = /^([A-Za-z][A-Za-z0-9_]*)\["([^"<>]+)"\](?:(?::){3}(new|touched|removed|external))?$/;
const LABELLED_EDGE = /^([A-Za-z][A-Za-z0-9_]*)\s+--\>\|([^|<>]+)\|\s+([A-Za-z][A-Za-z0-9_]*)$/;
const CLASS = /^class\s+([A-Za-z][A-Za-z0-9_]*(?:,[A-Za-z][A-Za-z0-9_]*)*)\s+(new|touched|removed|external)$/;
const CLASS_DEFS = new Set([
  "classDef new stroke:#2e7d32,stroke-width:3px",
  "classDef touched stroke:#f9a825,stroke-width:3px",
  "classDef removed stroke:#c62828,stroke-width:3px,stroke-dasharray:4 3",
  "classDef external stroke:#888888,stroke-dasharray:3 3",
]);

// Mermaid's flowchart lexer reserves these words even where our constrained
// grammar otherwise permits an identifier. Keeping this list here lets us
// reject new diagrams before they reach the browser renderer.
const MERMAID_RESERVED_IDS = new Set([
  "acctitle", "accdescr", "style", "default", "linkstyle", "interpolate",
  "classdef", "class", "href", "click", "graph", "flowchart", "subgraph",
  "end", "direction", "lr", "rl", "tb", "bt", "td", "br", "v",
]);

function reservedId(id: string): boolean {
  return MERMAID_RESERVED_IDS.has(id.toLowerCase());
}

/** Repair diagrams persisted by versions that allowed Mermaid keywords as IDs. */
export function normalizeReviewArchitectureMermaid(source: string): string {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const declared = new Set<string>();
  for (const line of lines) {
    const node = NODE.exec(line.trim());
    if (node) declared.add(node[1]!);
  }
  const replacements = new Map<string, string>();
  for (const id of declared) {
    if (!reservedId(id)) continue;
    let replacement = `${id}_component`;
    let suffix = 2;
    while (declared.has(replacement) || reservedId(replacement)) replacement = `${id}_component${suffix++}`;
    replacements.set(id, replacement);
    declared.add(replacement);
  }
  if (replacements.size === 0) return source.replaceAll("\r\n", "\n");
  return lines.map((rawLine) => {
    const line = rawLine.trim();
    const node = NODE.exec(line);
    if (node) return line.replace(node[1]!, replacements.get(node[1]!) ?? node[1]!);
    const edge = LABELLED_EDGE.exec(line);
    if (edge) return `${replacements.get(edge[1]!) ?? edge[1]!} -->|${edge[2]!}| ${replacements.get(edge[3]!) ?? edge[3]!}`;
    const classAssignment = CLASS.exec(line);
    if (classAssignment) {
      const ids = classAssignment[1]!.split(",").map((id) => replacements.get(id) ?? id);
      return `class ${ids.join(",")} ${classAssignment[2]!}`;
    }
    return line;
  }).join("\n");
}

export function validateReviewArchitecture(value: unknown): ReviewArchitecture {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Architecture must be an object.");
  const architecture = value as Record<string, unknown>;
  const allowed = ["title", "summary", "mermaid", "dependencyChanges", "affectedFiles", "outdated", "nodeRoles", "elementSources"];
  const unknown = Object.keys(architecture).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`Architecture contains an unsupported field: ${unknown}`);
  if (architecture.outdated !== undefined && typeof architecture.outdated !== "boolean") throw new Error("Architecture outdated must be a boolean.");
  const text = (field: string, max: number) => {
    const candidate = architecture[field];
    if (typeof candidate !== "string" || !candidate.trim() || candidate.length > max) throw new Error(`Architecture ${field} must be a non-empty string no longer than ${max} characters.`);
    return candidate.trim();
  };
  const title = text("title", 8_000);
  const summary = text("summary", 50_000);
  const mermaid = text("mermaid", 12_000).replaceAll("\r\n", "\n");
  if (mermaid.includes(";") || mermaid.includes("%%{")) throw new Error("Architecture contains unsupported Mermaid syntax.");
  const lines = mermaid.split("\n").map((line) => line.trim()).filter(Boolean);
  if (!HEADER.test(lines[0] ?? "")) throw new Error("Architecture must use a left-to-right Mermaid flowchart.");
  const nodes = new Set<string>();
  const styledNodes = new Set<string>();
  const referenced = new Set<string>();
  const classDefs = new Set<string>();
  let edgeCount = 0;
  for (const line of lines.slice(1)) {
    if (line.startsWith("%%")) continue;
    const node = NODE.exec(line);
    if (node) {
      if (reservedId(node[1]!)) throw new Error(`Architecture component id is reserved by Mermaid: ${node[1]}`);
      if (nodes.has(node[1]!)) throw new Error(`Architecture declares a component more than once: ${node[1]}`);
      nodes.add(node[1]!);
      if (node[3]) styledNodes.add(node[1]!);
      continue;
    }
    const edge = LABELLED_EDGE.exec(line);
    if (edge) { referenced.add(edge[1]!); referenced.add(edge[3]!); edgeCount += 1; continue; }
    const classAssignment = CLASS.exec(line);
    if (classAssignment) {
      for (const id of classAssignment[1]!.split(",")) styledNodes.add(id);
      continue;
    }
    if (CLASS_DEFS.has(line)) { classDefs.add(line); continue; }
    throw new Error(`Architecture contains unsupported Mermaid syntax: ${line}`);
  }
  if (nodes.size < 2 || nodes.size > 20 || edgeCount < 1 || edgeCount > 40) throw new Error("Architecture must contain 2-20 components and 1-40 labelled relationships.");
  if ([...referenced].some((id) => !nodes.has(id))) throw new Error("Architecture relationships must reference declared components.");
  if ([...styledNodes].some((id) => !nodes.has(id)) || styledNodes.size !== nodes.size) throw new Error("Every architecture component must be classified as new, touched, removed, or external.");
  if (classDefs.size !== CLASS_DEFS.size) throw new Error("Architecture must include the fixed change-overlay class definitions.");
  const dependencyChanges = architecture.dependencyChanges;
  if (!Array.isArray(dependencyChanges) || dependencyChanges.length > 20 || dependencyChanges.some((item) => typeof item !== "string" || !item.trim() || item.length > 2_000)) {
    throw new Error("Architecture dependencyChanges must contain at most 20 short descriptions.");
  }
  const affectedFiles = architecture.affectedFiles;
  if (!Array.isArray(affectedFiles) || affectedFiles.length === 0 || affectedFiles.length > 100 || affectedFiles.some((path) => typeof path !== "string" || !path.trim() || path.length > 4_096) || new Set(affectedFiles).size !== affectedFiles.length) {
    throw new Error("Architecture affectedFiles must contain 1-100 unique changed paths.");
  }
  const nodeRoles = validateMapNodeRoles(architecture.nodeRoles, nodes);
  return { title, summary, mermaid, ...(architecture.elementSources ? { elementSources: normalizeElementSources(architecture.elementSources) } : {}), ...(nodeRoles ? { nodeRoles } : {}), dependencyChanges: dependencyChanges.map((item) => item.trim()), affectedFiles: affectedFiles.map((path) => path.trim()), ...(architecture.outdated === true ? { outdated: true } : {}) };
}
