import type { ReviewFlow } from "./types.ts";

const DECLARATION = /^(?:participant|actor)\s+([A-Za-z0-9_.-]+)(?:\s+as\s+.+)?$/i;
const MESSAGE = /^([A-Za-z0-9_.-]+?)\s*(?:-{1,2}(?:>>|>|x|\)))\s*([A-Za-z0-9_.-]+)\s*:\s*.+$/;
const NOTE = /^note\s+(?:left of|right of|over)\s+([A-Za-z0-9_.-]+)(?:\s*,\s*([A-Za-z0-9_.-]+))?\s*:\s*.+$/i;
const CONTROL = /^(?:autonumber|activate\s+\S+|deactivate\s+\S+|(?:alt|else|loop|opt|par|and|critical|option|break|rect|box)\b.*|end|create\s+(?:participant|actor)\b.*|destroy\s+\S+)$/i;

// Mermaid's sequence lexer treats these words as syntax before it gets a
// chance to recognize an actor reference. They are fine in a participant
// declaration, but fail when used later in a message or note (for example,
// `participant Box as Image box` followed by `Screen->>Box`).
const MERMAID_SEQUENCE_RESERVED_IDS = new Set([
  "box", "participant", "actor", "create", "destroy", "as",
  "loop", "rect", "opt", "alt", "else", "par", "par_over", "and",
  "critical", "option", "break", "end", "links", "link", "properties",
  "details", "over", "note", "activate", "deactivate", "sequencediagram",
  "autonumber", "off",
]);

const DECLARATION_REFERENCE = /^(\s*(?:participant|actor)\s+)([A-Za-z0-9_.-]+)(\s+as\s+.+)?(\s*)$/i;
const CREATE_DECLARATION_REFERENCE = /^(\s*create\s+(?:participant|actor)\s+)([A-Za-z0-9_.-]+)(\s+as\s+.+)?(\s*)$/i;
const MESSAGE_REFERENCE = /^(\s*)([A-Za-z0-9_.-]+?)(\s*(?:-{1,2}(?:>>|>|x|\)))\s*)([A-Za-z0-9_.-]+)(\s*:\s*.+)$/;
const NOTE_REFERENCE = /^(\s*note\s+(?:left of|right of|over)\s+)([A-Za-z0-9_.-]+)(?:(\s*,\s*)([A-Za-z0-9_.-]+))?(\s*:\s*.+)$/i;
const ACTOR_CONTROL_REFERENCE = /^(\s*(?:activate|deactivate|destroy)\s+)([A-Za-z0-9_.-]+)(\s*)$/i;

function sequenceReservedId(id: string): boolean {
  return MERMAID_SEQUENCE_RESERVED_IDS.has(id.toLowerCase());
}

function declaredSequenceParticipant(line: string): string | undefined {
  return DECLARATION_REFERENCE.exec(line)?.[2] ?? CREATE_DECLARATION_REFERENCE.exec(line)?.[2];
}

export interface SequenceSyntax {
  actors: string[];
  unsupported: string[];
}

export function normalizeSequenceDiagram(source: string): string {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const participantIds = new Set<string>();
  const identifiers = new Set<string>();
  for (const line of lines) {
    const id = declaredSequenceParticipant(line);
    if (id) participantIds.add(id);

    const message = MESSAGE_REFERENCE.exec(line);
    if (message) {
      identifiers.add(message[2]!.toLowerCase());
      identifiers.add(message[4]!.toLowerCase());
    }
    const note = NOTE_REFERENCE.exec(line);
    if (note) {
      identifiers.add(note[2]!.toLowerCase());
      if (note[4]) identifiers.add(note[4].toLowerCase());
    }
    const actorControl = ACTOR_CONTROL_REFERENCE.exec(line);
    if (actorControl) identifiers.add(actorControl[2]!.toLowerCase());
  }
  for (const id of participantIds) identifiers.add(id.toLowerCase());

  const replacements = new Map<string, string>();
  for (const id of participantIds) {
    if (!sequenceReservedId(id)) continue;
    let replacement = `${id}_participant`;
    let suffix = 2;
    while (identifiers.has(replacement.toLowerCase()) || sequenceReservedId(replacement)) {
      replacement = `${id}_participant${suffix++}`;
    }
    replacements.set(id, replacement);
    identifiers.add(replacement.toLowerCase());
  }

  const replaceId = (id: string): string => replacements.get(id) ?? id;
  return lines.map((line) => {
    const declaration = DECLARATION_REFERENCE.exec(line) ?? CREATE_DECLARATION_REFERENCE.exec(line);
    let repaired = line;
    if (declaration && replacements.has(declaration[2]!)) {
      const id = declaration[2]!;
      repaired = `${declaration[1]!}${replaceId(id)}${declaration[3] ?? ` as ${id}`}${declaration[4]!}`;
    } else {
      const message = MESSAGE_REFERENCE.exec(line);
      if (message) {
        repaired = `${message[1]!}${replaceId(message[2]!)}${message[3]!}${replaceId(message[4]!)}${message[5]!}`;
      } else {
        const note = NOTE_REFERENCE.exec(line);
        if (note) {
          repaired = `${note[1]!}${replaceId(note[2]!)}${note[3] ?? ""}${note[4] ? replaceId(note[4]) : ""}${note[5]!}`;
        } else {
          const actorControl = ACTOR_CONTROL_REFERENCE.exec(line);
          if (actorControl) repaired = `${actorControl[1]!}${replaceId(actorControl[2]!)}${actorControl[3]!}`;
        }
      }
    }

    const colon = repaired.indexOf(":");
    if (colon < 0) return repaired;
    return `${repaired.slice(0, colon + 1)}${repaired.slice(colon + 1).replaceAll(";", "&#59;")}`;
  }).join("\n");
}

export function inspectSequenceDiagram(source: string): SequenceSyntax {
  const actors = new Set<string>();
  const unsupported: string[] = [];
  const lines = source.split("\n");
  if (!/^\s*sequenceDiagram\s*$/.test(lines[0] ?? "")) return { actors: [], unsupported: [lines[0] ?? ""] };
  for (const rawLine of lines.slice(1)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("%%{")) { unsupported.push(line); continue; }
    if (line.startsWith("%%")) continue;
    const declaration = DECLARATION.exec(line);
    if (declaration) { actors.add(declaration[1]!); continue; }
    const message = MESSAGE.exec(line);
    if (message) { actors.add(message[1]!); actors.add(message[2]!); continue; }
    const note = NOTE.exec(line);
    if (note) { actors.add(note[1]!); if (note[2]) actors.add(note[2]); continue; }
    if (CONTROL.test(line)) continue;
    unsupported.push(line);
  }
  return { actors: [...actors], unsupported };
}

export function validateReviewFlow(value: unknown): ReviewFlow {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Flow must be an object.");
  const flow = value as Record<string, unknown>;
  const allowed = ["id", "title", "summary", "mermaid", "provenance", "blastRadiusSize", "affectedFiles", "outdated"];
  const unknown = Object.keys(flow).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`Flow contains an unsupported field: ${unknown}`);
  if (flow.outdated !== undefined && typeof flow.outdated !== "boolean") throw new Error("Flow outdated must be a boolean.");
  const bounded = (field: string, max: number) => {
    const candidate = flow[field];
    if (typeof candidate !== "string" || !candidate.trim() || candidate.length > max) throw new Error(`Flow ${field} must be a non-empty string no longer than ${max} characters.`);
    return candidate.trim();
  };
  const id = bounded("id", 128);
  const title = bounded("title", 8_000);
  const summary = bounded("summary", 50_000);
  const mermaid = normalizeSequenceDiagram(bounded("mermaid", 12_000).replaceAll("\r\n", "\n"));
  const provenance = String(flow.provenance);
  if (!["verified", "partial", "unverified"].includes(provenance)) throw new Error("Flow provenance must be verified, partial, or unverified.");
  const affectedFiles = flow.affectedFiles === undefined ? [] : flow.affectedFiles;
  if (!Array.isArray(affectedFiles) || affectedFiles.length > 100 || affectedFiles.some((path) => typeof path !== "string" || !path.trim() || path.length > 4_096) || new Set(affectedFiles).size !== affectedFiles.length) {
    throw new Error("Flow affectedFiles must contain at most 100 unique changed paths.");
  }
  if (flow.blastRadiusSize !== undefined && (!Number.isInteger(flow.blastRadiusSize) || Number(flow.blastRadiusSize) < 0 || Number(flow.blastRadiusSize) > 100_000)) {
    throw new Error("Flow blastRadiusSize must be an integer between 0 and 100000.");
  }
  if (flow.blastRadiusSize === undefined && affectedFiles.length === 0) throw new Error("Flow must declare at least one affected file.");
  const syntax = inspectSequenceDiagram(mermaid);
  if (syntax.unsupported.length > 0) throw new Error(`Flow contains unsupported Mermaid syntax: ${syntax.unsupported[0]}`);
  if (syntax.actors.length === 0 || syntax.actors.length > 12) throw new Error("Flow must reference between 1 and 12 participants.");
  return { id, title, summary, mermaid, provenance: provenance as ReviewFlow["provenance"], blastRadiusSize: affectedFiles.length || Number(flow.blastRadiusSize), affectedFiles: affectedFiles.map((path) => path.trim()), ...(flow.outdated === true ? { outdated: true } : {}) };
}
