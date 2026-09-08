import type { ReviewAdaptiveDiagram } from "./types.ts";

const STATE_HEADER = "stateDiagram-v2";
const STATE_ID = /^[A-Za-z][A-Za-z0-9_]*$/;
const STATE_TRANSITION = /^(\[\*\]|[A-Za-z][A-Za-z0-9_]*)\s+-->\s+(\[\*\]|[A-Za-z][A-Za-z0-9_]*)(?:\s*:\s*([A-Za-z0-9 .,/_()'!?+\-]{1,160}))?$/;
const ER_HEADER = "erDiagram";
const ER_ENTITY = /^[A-Z][A-Z0-9_]*$/;
const ER_RELATIONSHIP = /^([A-Z][A-Z0-9_]*)\s+(\|\||o\||\|o|\|\{|\}\||o\{|\}o)\-\-(\|\||o\||\|o|\|\{|\}\||o\{|\}o)\s+([A-Z][A-Z0-9_]*)(?:\s*:\s*([A-Za-z0-9 .,/_()'!?+\-]{1,160}))?$/;
const ER_ATTRIBUTE = /^[A-Za-z][A-Za-z0-9_]*(?:\s+[A-Za-z][A-Za-z0-9_]*)?(?:\s+(?:PK|FK|UK))?$/;

function text(value: Record<string, unknown>, field: string, max: number): string {
  const candidate = value[field];
  if (typeof candidate !== "string" || !candidate.trim() || candidate.length > max) {
    throw new Error(`Adaptive diagram ${field} must be a non-empty string no longer than ${max} characters.`);
  }
  return candidate.trim();
}

function common(value: Record<string, unknown>) {
  const allowed = ["kind", "title", "summary", "mermaid", "evidence", "materiallyImprovesUnderstanding", "affectedFiles"];
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`Adaptive diagram contains an unsupported field: ${unknown}`);
  const kind = value.kind;
  if (kind !== "state-machine" && kind !== "data-model") throw new Error("Adaptive diagram kind must be state-machine or data-model.");
  const evidence = value.evidence;
  if (!Array.isArray(evidence) || evidence.length < 1 || evidence.length > 8 || evidence.some((item) => typeof item !== "string" || !item.trim() || item.length > 2_000)) {
    throw new Error("Adaptive diagram evidence must contain 1-8 concise repository-backed observations.");
  }
  const affectedFiles = value.affectedFiles;
  if (!Array.isArray(affectedFiles) || affectedFiles.length < 1 || affectedFiles.length > 100 || affectedFiles.some((path) => typeof path !== "string" || !path.trim() || path.length > 4_096) || new Set(affectedFiles).size !== affectedFiles.length) {
    throw new Error("Adaptive diagram affectedFiles must contain 1-100 unique changed paths.");
  }
  return {
    kind,
    title: text(value, "title", 8_000),
    summary: text(value, "summary", 50_000),
    mermaid: text(value, "mermaid", 16_000).replaceAll("\r\n", "\n"),
    evidence: evidence.map((item) => item.trim()),
    materiallyImprovesUnderstanding: text(value, "materiallyImprovesUnderstanding", 2_000),
    affectedFiles: affectedFiles.map((path) => path.trim()),
  } satisfies ReviewAdaptiveDiagram;
}

function validateStateMermaid(source: string): void {
  const lines = source.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines[0] !== STATE_HEADER) throw new Error("State-machine diagrams must use stateDiagram-v2.");
  const states = new Set<string>();
  let transitions = 0;
  let starts = 0;
  for (const line of lines.slice(1)) {
    const match = STATE_TRANSITION.exec(line);
    if (!match) throw new Error(`State-machine diagram contains unsupported Mermaid syntax: ${line}`);
    for (const endpoint of [match[1], match[2]]) {
      if (endpoint === "[*]") continue;
      if (!STATE_ID.test(endpoint!)) throw new Error(`State-machine diagram contains an unsafe state id: ${endpoint}`);
      states.add(endpoint!);
    }
    if (match[1] === "[*]") starts += 1;
    transitions += 1;
  }
  if (states.size < 2 || states.size > 20 || transitions < 1 || transitions > 40 || starts < 1) {
    throw new Error("State-machine diagrams must contain 2-20 states, 1-40 transitions, and an initial state.");
  }
}

function validateDataModelMermaid(source: string): void {
  const lines = source.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines[0] !== ER_HEADER) throw new Error("Data-model diagrams must use erDiagram.");
  const entities = new Set<string>();
  const relationships: Array<[string, string]> = [];
  let attributes = 0;
  let current: string | undefined;
  for (const line of lines.slice(1)) {
    if (line === "}") {
      if (!current) throw new Error("Data-model diagram closes an entity that was not opened.");
      current = undefined;
      continue;
    }
    if (current) {
      if (!ER_ATTRIBUTE.test(line)) throw new Error(`Data-model diagram contains unsupported attribute syntax: ${line}`);
      attributes += 1;
      if (attributes > 100) throw new Error("Data-model diagrams may contain at most 100 attributes.");
      continue;
    }
    if (line.endsWith("{")) {
      const entity = line.slice(0, -1).trim();
      if (!ER_ENTITY.test(entity) || entities.has(entity)) throw new Error(`Data-model diagram contains an invalid or duplicate entity: ${entity}`);
      entities.add(entity);
      current = entity;
      continue;
    }
    const relationship = ER_RELATIONSHIP.exec(line);
    if (!relationship) throw new Error(`Data-model diagram contains unsupported Mermaid syntax: ${line}`);
    relationships.push([relationship[1]!, relationship[4]!]);
    if (relationships.length > 40) throw new Error("Data-model diagrams may contain at most 40 relationships.");
  }
  if (current) throw new Error("Data-model diagram must close every entity block.");
  if (entities.size < 2 || entities.size > 20 || relationships.length < 1 || relationships.some(([from, to]) => !entities.has(from) || !entities.has(to))) {
    throw new Error("Data-model diagrams must contain 2-20 declared entities and 1-40 relationships between them.");
  }
}

export function validateReviewAdaptiveDiagram(value: unknown): ReviewAdaptiveDiagram {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Adaptive diagram must be an object.");
  const diagram = common(value as Record<string, unknown>);
  if (diagram.kind === "state-machine") validateStateMermaid(diagram.mermaid);
  else validateDataModelMermaid(diagram.mermaid);
  return diagram;
}

export function normalizeReviewAdaptiveDiagram(value: Record<string, unknown>): void {
  if (typeof value.mermaid === "string") value.mermaid = value.mermaid.replaceAll("\r\n", "\n");
}
