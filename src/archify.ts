import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { runProcess } from "./process.ts";
import { layoutArchitecture } from "./architecture-layout.ts";
import { layoutLifecycle } from "./lifecycle-layout.ts";
import type { ArchifyArtifact, ArchifyDiagramType, ArchifyFailure, ArchifyJson, ReviewAdaptiveDiagram, ReviewArchitecture, ReviewFlow, TourOutline } from "./types.ts";

const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;
const MAX_RECEIPT_LENGTH = 32_000;
const MAX_ARTIFACTS = 12;

type ArchifyDocument = { [key: string]: ArchifyJson };

interface ArchifyCandidate {
  nodeRoles?: ArchifyArtifact["nodeRoles"];
  purpose?: "domain-model";
  domainDetails?: ArchifyArtifact["domainDetails"];
  id: string;
  type: ArchifyDiagramType;
  title: string;
  evidence: string[];
  affectedFiles: string[];
  ir: ArchifyDocument;
  comparison?: {
    before?: ArchifyDocument;
    delta?: ArchifyDocument;
  };
}

export interface ArchifyCommandRunner {
  (command: string[], cwd: string, env: Record<string, string | undefined>): Promise<{ stdout: string; stderr: string }>;
}

export interface ArchifyRendererOptions {
  /** An explicit local Archify skill checkout. It is never downloaded by DiffCompass. */
  directory?: string;
  runner?: ArchifyCommandRunner;
  now?: () => Date;
}

function safeId(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return /^[A-Za-z]/.test(normalized) ? normalized.slice(0, 48) : `diagram-${normalized.slice(0, 40) || "item"}`;
}

function rendererCodeType(external = false): "backend" | "external" {
  // Architecture, workflow, and sequence schemas require a renderer type, but
  // the tour evidence does not establish deployment or ownership categories
  // from a label. Keep the required generic code type private to the renderer
  // (the generated legend is hidden) and use `external` only when the source
  // model explicitly says so.
  return external ? "external" : "backend";
}

function evidence(affectedFiles: string[], summary: string): string[] {
  return [summary, ...affectedFiles.map((path) => `Changed repository evidence: ${path}`)].slice(0, 8);
}

function stableSuffix(value: string): string {
  let hash = 2_166_136_261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16_777_619);
  return (hash >>> 0).toString(36);
}

function architectureParts(architecture: ReviewArchitecture) {
  const nodes = new Map<string, { id: string; label: string; change: string }>();
  const edges: Array<{ from: string; to: string; label: string }> = [];
  for (const raw of architecture.mermaid.split("\n")) {
    const line = raw.trim();
    const node = /^([A-Za-z][A-Za-z0-9_]*)\["([^"<>]+)"\]:::(new|touched|removed|external)$/.exec(line);
    if (node) {
      nodes.set(node[1]!, { id: safeId(node[1]!), label: node[2]!, change: node[3]! });
      continue;
    }
    const edge = /^([A-Za-z][A-Za-z0-9_]*)\s+-->\|([^|<>]+)\|\s+([A-Za-z][A-Za-z0-9_]*)$/.exec(line);
    if (edge) edges.push({ from: edge[1]!, to: edge[3]!, label: edge[2]!.trim() });
  }
  return { nodes, edges };
}

function stableRelationshipId(scope: string, value: string): string {
  return `${safeId(`${scope}-${value}`).slice(0, 42)}-${stableSuffix(`${scope}:${value}`)}`;
}

/** Matches Archify's CJK-aware label estimate closely enough to decide whether
 * its compact spread sequence layout is viable before asking the renderer. */
function sequenceTextUnits(value: string): number {
  return Array.from(value).reduce((units, character) => units + (/^[\u3000-\u9fff\uf900-\ufaff\uff01-\uff60\uffe0-\uffe6]$/u.test(character) ? 2 : 1), 0);
}

type ArchitectureSnapshot = "before" | "after" | "delta";

function relationshipChange(architecture: ReviewArchitecture, from: string, to: string, label: string): "added" | "removed" | "changed" | "unchanged" {
  for (const change of architecture.dependencyChanges) {
    const match = /^(Added|Removed|Changed)\s+(.+?)\s+(?:→|->)\s+(.+?)(?:\s*:\s*(.+?))?\.?$/i.exec(change.trim());
    if (!match) continue;
    const action = match[1]!.toLowerCase() as "added" | "removed" | "changed";
    const changedLabel = match[4]?.trim();
    if (match[2]!.trim() === from && match[3]!.trim() === to && (!changedLabel || changedLabel === label)) return action;
  }
  return "unchanged";
}

function architectureSnapshot(architecture: ReviewArchitecture, mode: ArchitectureSnapshot): ArchifyDocument | undefined {
  const { nodes, edges } = architectureParts(architecture);
  const keep = [...nodes.entries()]
    .map(([sourceId, node], index) => ({ sourceId, node, index }))
    .filter(({ node }) => mode === "before" ? node.change !== "new" : mode === "after" ? node.change !== "removed" : true);
  if (keep.length === 0) return undefined;
  const allowed = new Set(keep.map(({ sourceId }) => sourceId));
  const relationOccurrences = new Map<string, number>();
  const sourceColumns = Math.min(4, Math.max(1, nodes.size));
  const stateTitle = mode === "before" ? "Before" : mode === "after" ? "After" : "Delta";
  const nodeSublabel = (change: string) => {
    if (mode === "before") return change === "removed" ? "Present before this change" : change === "touched" ? "Before this review" : "Context only";
    if (mode === "delta") return change === "new" ? "+ Added" : change === "removed" ? "− Removed" : change === "touched" ? "~ Changed" : "Unchanged context";
    return change === "new" ? "Added in this change" : change === "touched" ? "Changed in this review" : "Context only";
  };
  return {
    schema_version: 1,
    diagram_type: "architecture",
    meta: {
      title: `${architecture.title} — ${stateTitle}`,
      quality_profile: "standard",
      locale: "en",
      // The Mermaid classes establish only review existence/change state, not
      // system topology classifications. Hide the renderer-required type key.
      legend: { mode: "hidden" },
    },
    // Preserve the source-column position across Before/Delta/After. A new
    // component has no Before node, rather than shifting existing components
    // and suggesting that it previously occupied a different role.
    layout: { mode: "grid", origin: [40, 40], cols: sourceColumns, gapX: 120, gapY: 60, cellW: 144, cellH: 60 },
    components: keep.map(({ node, index }) => ({
      id: node.id,
      type: rendererCodeType(),
      label: node.label,
      sublabel: nodeSublabel(node.change),
      row: Math.floor(index / sourceColumns),
      col: index % sourceColumns,
    })),
    connections: edges
      .filter((edge) => {
        if (!allowed.has(edge.from) || !allowed.has(edge.to)) return false;
        const change = relationshipChange(architecture, nodes.get(edge.from)!.label, nodes.get(edge.to)!.label, edge.label);
        if (mode === "before") return change !== "added" && change !== "changed";
        if (mode === "after") return change !== "removed";
        // Show the union of changes and surrounding connections in Delta.
        return true;
      })
      .map((edge) => {
        const signature = `${edge.from}:${edge.label}:${edge.to}`;
        const change = nodes.get(edge.from)!.change === "new" || nodes.get(edge.to)!.change === "new" ? "added"
          : nodes.get(edge.from)!.change === "removed" || nodes.get(edge.to)!.change === "removed" ? "removed"
          : relationshipChange(architecture, nodes.get(edge.from)!.label, nodes.get(edge.to)!.label, edge.label);
        const prefix = mode === "delta" ? ({ added: "+ ", removed: "− ", changed: "~ ", unchanged: "" })[change] : "";
        const occurrence = relationOccurrences.get(signature) ?? 0;
        relationOccurrences.set(signature, occurrence + 1);
        return {
          id: stableRelationshipId("architecture", `${signature}:${occurrence}`),
          from: nodes.get(edge.from)!.id,
          to: nodes.get(edge.to)!.id,
          label: `${prefix}${edge.label}`,
          // The source relation text is material review evidence. The
          // renderer's diagnosed below-edge placement keeps it rather than
          // deleting it to make a compact grid validate.
          labelDy: 54,
          route: "auto",
        };
      }),
  };
}

function architectureCandidate(id: string, architecture: ReviewArchitecture): ArchifyCandidate | undefined {
  const after = architectureSnapshot(architecture, "after");
  if (!after) return undefined;
  const before = architectureSnapshot(architecture, "before");
  const delta = architectureSnapshot(architecture, "delta");
  return {
    id,
    type: "architecture",
    title: architecture.title,
    nodeRoles: architecture.nodeRoles && Object.fromEntries(Object.entries(architecture.nodeRoles).map(([id, role]) => [safeId(id), role])),
    evidence: [...evidence(architecture.affectedFiles, architecture.summary), ...architecture.dependencyChanges].slice(0, 8),
    affectedFiles: architecture.affectedFiles,
    ir: after,
    comparison: before || delta ? { ...(before ? { before } : {}), ...(delta ? { delta } : {}) } : undefined,
  };
}


export function sequenceCandidate(flow: ReviewFlow): ArchifyCandidate | undefined {
  const affectedFiles = flow.affectedFiles ?? [];
  const labels = new Map<string, string>();
  const messages: Array<{ from: string; to: string; label: string; variant?: "return" }> = [];
  for (const raw of flow.mermaid.split("\n")) {
    const line = raw.trim();
    // The target IR has no equivalent for Mermaid's conditional, parallel, or
    // looping fragments. Leaving the native Mermaid available is more honest
    // than flattening those branches into a chronological-looking story.
    if (/^(?:alt|else|opt|loop|par|and|critical|option|break|rect|end)\b/i.test(line)) return undefined;
    const participant = /^(?:participant|actor)\s+([A-Za-z0-9_.-]+)(?:\s+as\s+(.+))?$/i.exec(line);
    if (participant) { labels.set(participant[1]!, participant[2]?.trim() || participant[1]!); continue; }
    const message = /^([A-Za-z0-9_.-]+?)\s*(-{1,2}(?:>>|>|x|\)))\s*([A-Za-z0-9_.-]+)\s*:\s*(.+)$/.exec(line);
    if (message) {
      labels.set(message[1]!, labels.get(message[1]!) ?? message[1]!);
      labels.set(message[3]!, labels.get(message[3]!) ?? message[3]!);
      messages.push({ from: message[1]!, to: message[3]!, label: message[4]!.trim(), ...(message[2]!.startsWith("--") ? { variant: "return" as const } : {}) });
    }
  }
  const participants = [...labels.entries()].slice(0, 12);
  // A sequence is only a useful compact companion when every authored
  // participant can remain visible and legible. Do not drop participants or
  // messages simply to force a validation pass; the native Mermaid view keeps
  // richer sequences intact.
  const participantWidth = Math.max(86, ...participants.map(([, label]) => Math.ceil(sequenceTextUnits(label) * 6.8 + 20)));
  if (participants.length < 2 || labels.size !== participants.length || messages.length === 0 || messages.length > 40 || participantWidth > 480) return undefined;
  const ids = new Map(participants.map(([id]) => [id, safeId(`${flow.id}-${id}`)]));
  const available = new Set(ids.keys());
  const usableMessages = messages.filter((message) => available.has(message.from) && available.has(message.to)).slice(0, 40);
  if (usableMessages.length === 0) return undefined;
  return {
    id: `sequence-${flow.id}`,
    type: "sequence",
    nodeRoles: flow.nodeRoles && Object.fromEntries(Object.entries(flow.nodeRoles).filter(([id]) => ids.has(id)).map(([id, role]) => [ids.get(id)!, role])),
    title: flow.title,
    evidence: evidence(affectedFiles, flow.summary),
    affectedFiles,
    ir: {
      schema_version: 1,
      diagram_type: "sequence",
      // Spread is the renderer-supported way to preserve meaningful labels in
      // its compact 920px sequence canvas. It preserves participant and event
      // order; unlike guided views it does not invent an execution story.
      meta: { title: flow.title, quality_profile: "standard", locale: "en", column_fit: "spread", viewBox: [Math.max(920, 124 + (participantWidth + 24) * participants.length), Math.max(480, 292 + (usableMessages.length - 1) * 56)], legend: { mode: "hidden" } },
      participants: participants.map(([id, label]) => ({ id: ids.get(id)!, type: rendererCodeType(), label })),
      // Mermaid's message order is the only ordering fact we have. Preserve
      // it directly and do not attach a guided view that claims an execution
      // narrative beyond those authored messages.
      messages: usableMessages.map((message, index) => ({ id: stableRelationshipId(`sequence-${flow.id}`, `${index}:${message.from}:${message.label}:${message.to}`), from: ids.get(message.from)!, to: ids.get(message.to)!, y: 168 + index * 56, label: message.label, ...(message.variant ? { variant: message.variant } : {}) })),
    },
  };
}

function lifecycleCandidate(diagram: ReviewAdaptiveDiagram): ArchifyCandidate | undefined {
  if (diagram.kind !== "state-machine") return undefined;
  let states = new Map<string, { id: string; label: string; initial: boolean; terminal: boolean; boundary?: "initial" | "final" }>();
  const transitions: Array<{ from: string; to: string; label?: string }> = [];
  for (const raw of diagram.mermaid.split("\n").slice(1)) {
    const match = /^(\[\*\]|[A-Za-z][A-Za-z0-9_]*)\s+-->\s+(\[\*\]|[A-Za-z][A-Za-z0-9_]*)(?:\s*:\s*(.+))?$/.exec(raw.trim());
    if (!raw.trim()) continue;
    if (!match || (match[1] === "[*]" && match[2] === "[*]")) return undefined;
    for (const id of [match[1]!, match[2]!]) if (id !== "[*]" && !states.has(id)) states.set(id, { id: safeId(id), label: id, initial: false, terminal: false });
    transitions.push({ from: match[1]!, to: match[2]!, ...(match[3] ? { label: match[3]!.trim() } : {}) });
    if (match[1] === "[*]" && match[2] !== "[*]") states.get(match[2]!)!.initial = true;
    if (match[2] === "[*]" && match[1] !== "[*]") states.get(match[1]!)!.terminal = true;
  }
  if (states.size < 2 || new Set([...states.values()].map(state => state.id)).size !== states.size) return undefined;
  // Simple unlabelled boundaries can remain annotations. Event-labelled
  // boundaries and states that can both exit and continue need real arrows:
  // represent Mermaid's initial/final pseudostates explicitly in that case.
  const explicitBoundaries = transitions.some(edge => edge.label && (edge.from === "[*]" || edge.to === "[*]"))
    || transitions.some(edge => edge.to !== "[*]" && states.get(edge.from)?.terminal);
  let edges = transitions;
  if (explicitBoundaries) {
    const initial = [...states.values()].some(state => state.initial);
    const final = [...states.values()].some(state => state.terminal);
    for (const state of states.values()) { state.initial = false; state.terminal = false; }
    // Hyphens cannot occur in the accepted Mermaid state identifiers, so
    // these reserved IDs cannot collide with a user-authored state.
    if (initial) states = new Map([["lifecycle-initial", { id: "lifecycle-initial", label: "Start", initial: true, terminal: false, boundary: "initial" }], ...states]);
    if (final) states.set("lifecycle-final", { id: "lifecycle-final", label: "End", initial: false, terminal: true, boundary: "final" });
    edges = transitions.map(edge => ({ ...edge, from: edge.from === "[*]" ? "lifecycle-initial" : edge.from, to: edge.to === "[*]" ? "lifecycle-final" : edge.to }));
  } else {
    edges = transitions.filter(edge => edge.from !== "[*]" && edge.to !== "[*]");
  }
  if (edges.length === 0) return undefined;
  return {
    id: "lifecycle-state-machine",
    type: "lifecycle",
    title: diagram.title,
    evidence: diagram.evidence,
    affectedFiles: diagram.affectedFiles,
    ir: {
      schema_version: 1,
      diagram_type: "lifecycle",
      meta: { title: diagram.title, quality_profile: "standard", locale: "en", legend: { mode: "hidden" } },
      states: [...states.values()],
      transitions: edges.map((transition, index) => ({ id: stableRelationshipId("lifecycle", `${index}:${transition.from}:${transition.label ?? ""}:${transition.to}`), from: states.get(transition.from)!.id, to: states.get(transition.to)!.id, ...(transition.label ? { label: transition.label } : {}) })),
    },
  };
}

function dataflowCandidate(diagram: ReviewAdaptiveDiagram): ArchifyCandidate | undefined {
  if (diagram.kind !== "data-model") return undefined;
  const entities = new Set<string>();
  const relations: Array<{ from: string; to: string; label?: string }> = [];
  for (const raw of diagram.mermaid.split("\n").slice(1)) {
    const line = raw.trim();
    const entity = /^([A-Z][A-Z0-9_]*)\s*\{$/.exec(line);
    if (entity) { entities.add(entity[1]!); continue; }
    const relation = /^([A-Z][A-Z0-9_]*)\s+(?:\|\||o\||\|o|\|\{|}\||o\{|}o)\-\-(?:\|\||o\||\|o|\|\{|}\||o\{|}o)\s+([A-Z][A-Z0-9_]*)(?:\s*:\s*(.+))?$/.exec(line);
    if (relation) relations.push({ from: relation[1]!, to: relation[2]!, ...(relation[3] ? { label: relation[3]!.trim() } : {}) });
  }
  if (entities.size < 2 || entities.size > 5 || relations.length === 0) return undefined;
  const sources = new Set(relations.map((relation) => relation.from));
  const targets = new Set(relations.map((relation) => relation.to));
  const stage = new Map<string, number>();
  for (const entity of entities) stage.set(entity, sources.has(entity) && !targets.has(entity) ? 0 : 1);
  if (![...stage.values()].includes(0)) stage.set([...entities][0]!, 0);
  const ids = new Map([...entities].map((entity) => [entity, safeId(`data-${entity}`)]));
  return {
    id: "dataflow-data-model",
    type: "dataflow",
    title: `${diagram.title} data relationships`,
    evidence: diagram.evidence,
    affectedFiles: diagram.affectedFiles,
    ir: {
      schema_version: 1,
      diagram_type: "dataflow",
      meta: { title: `${diagram.title} data relationships`, quality_profile: "standard", locale: "en", viewBox: [448, Math.max(360, 266 + (entities.size - 1) * 114)], legend: { mode: "hidden" } },
      stages: [{ label: "Source relationships" }, { label: "Related data" }],
      nodes: [...entities].map((entity, index) => ({ id: ids.get(entity)!, type: "database", label: entity, stage: stage.get(entity)!, row: index, width: Math.max(96, Math.min(136, entity.length * 7 + 26)), height: 48 })),
      // An ER relation is retained as an authored data relationship, not
      // promoted to a runtime transfer or a pipeline execution claim.
      flows: relations.map((relation, index) => ({ id: stableRelationshipId("dataflow", `${index}:${relation.from}:${relation.label ?? ""}:${relation.to}`), from: ids.get(relation.from)!, to: ids.get(relation.to)!, label: relation.label ?? "relationship", variant: "dashed", route: "auto" })),
    },
  };
}

/** Builds only views for which the already-validated tour has bounded evidence. */
function domainCandidate(model: import("./domain-context.ts").DomainModel, models: import("./domain-context.ts").DomainModel[]): ArchifyCandidate {
  const conceptContext = (concept: import("./domain-context.ts").DomainConcept) => concept.source.path === model.path ? model.context : models.find(item => item.path === concept.source.path)?.context ?? concept.source.path.replace(/\/CONTEXT\.md$/, "");
  return {
    id: `domain-${model.id}`, type: "architecture", purpose: "domain-model", title: model.context,
    evidence: [`Domain vocabulary from ${model.path}. This is a documented model, not a runtime dependency graph.`, "Code changes do not imply changes to domain definitions."],
    affectedFiles: [...new Set(model.bindings.map(binding => binding.sourcePath))],
    domainDetails: Object.fromEntries(model.concepts.map(concept => [concept.id, {...concept, context:conceptContext(concept)}])),
    ir: {
      schema_version: 1, diagram_type: "architecture",
      meta: {title: model.context, quality_profile: "standard", locale:"en", legend:{mode:"hidden"}},
      layout: {mode:"grid",origin:[40,40],cols:3,gapX:140,gapY:100,cellW:160,cellH:60},
      components: model.concepts.map((concept,index) => ({id:concept.id,type:"backend",label:concept.term,...(concept.source.path !== model.path ? {sublabel:conceptContext(concept)} : {}),...(model.bindings.some(binding => binding.conceptId === concept.id) ? {sublabel:"Used by reviewed code"} : {}),row:Math.floor(index/3),col:index%3})),
      connections: model.relationships.map((edge,index) => ({id:`domain-edge-${index}`,from:edge.from,to:edge.to,label:edge.label,labelDy:54,route:"auto"})),
    },
  };
}

export function archifyCandidates(outline: TourOutline): ArchifyCandidate[] {
  return [
    ...(outline.domainModels ?? []).map(model => domainCandidate(model, outline.domainModels ?? [])),
    outline.behaviorArchitecture ? architectureCandidate("architecture-behavior", outline.behaviorArchitecture) : undefined,
    outline.architecture ? architectureCandidate("architecture-journey", outline.architecture) : undefined,
    ...outline.flows.map(sequenceCandidate),
    outline.dataModel ? dataflowCandidate(outline.dataModel) : undefined,
    outline.stateDiagram ? lifecycleCandidate(outline.stateDiagram) : undefined,
  ].filter((candidate): candidate is ArchifyCandidate => Boolean(candidate)).slice(0, MAX_ARTIFACTS).map(candidate => {
    if (candidate.purpose) return candidate;
    const details: NonNullable<ArchifyArtifact['domainDetails']> = {};
    const ambiguous = new Set<string>();
    for (const model of outline.domainModels ?? []) for (const binding of model.bindings) {
      if (binding.mapId !== candidate.id || !candidate.affectedFiles.includes(binding.sourcePath)) continue;
      const concept = model.concepts.find(item => item.id === binding.conceptId);
      if (concept) {
        if (details[binding.nodeId] && (details[binding.nodeId]!.source.path !== concept.source.path || details[binding.nodeId]!.id !== concept.id)) ambiguous.add(binding.nodeId);
        details[binding.nodeId] = { ...concept, context: model.context };
      }
    }
    for (const node of ambiguous) delete details[node];
    return { ...candidate, ...(Object.keys(details).length ? {domainDetails:details} : {}) };
  });
}

async function defaultRunner(command: string[], cwd: string, env: Record<string, string | undefined>) {
  // Archify places its machine-readable diagnostics on stdout. Keep that
  // receipt when validation fails instead of reducing it to an empty stderr.
  const result = await runProcess(command, cwd, [0, 1], { timeoutMs: 45_000, env });
  if (result.exitCode !== 0) throw new Error(compactReceipt(result.stdout, result.stderr) || `Archify validation failed with exit code ${result.exitCode}.`);
  return { stdout: result.stdout, stderr: result.stderr };
}

function compactReceipt(stdout: string, stderr: string): string {
  const receipt = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n").trim();
  return receipt.length > MAX_RECEIPT_LENGTH ? `${receipt.slice(0, MAX_RECEIPT_LENGTH)}\n[receipt truncated]` : receipt;
}

function reviewerFailureMessage(type: ArchifyDiagramType, error?: unknown): string {
  const label: Record<ArchifyDiagramType, string> = {
    architecture: "architecture",
    workflow: "workflow",
    sequence: "sequence",
    dataflow: "data-flow",
    lifecycle: "lifecycle",
  };
  // Renderer output can contain absolute temporary paths and JSON diagnostics.
  // Those are useful only while developing the adapter, never in a reviewer
  // surface or export. The native source diagram is still available.
  const detail = error instanceof Error ? error.message : "";
  const reason = /spans 0px|Self-call/.test(detail) ? " A self-call could not be drawn correctly."
    : /wider than|overlaps|edge-through-node|endpoint-side-direction|orthogonal-arrows|layout\/constraint/.test(detail) ? " Labels or connections could not be laid out without collisions."
    : /ENOENT|unavailable|absolute path/.test(detail) ? " The local renderer could not be started."
    : /timed out/.test(detail) ? " Drawing the map took too long."
    : "";
  return `The ${label[type]} map could not be prepared from the saved review evidence.${reason}`;
}

export class ArchifyRenderer {
  private readonly runner: ArchifyCommandRunner;
  private readonly now: () => Date;

  constructor(private readonly directory: string, options: ArchifyRendererOptions = {}) {
    this.runner = options.runner ?? defaultRunner;
    this.now = options.now ?? (() => new Date());
  }

  static fromEnvironment(env: Record<string, string | undefined> = globalThis.process.env): ArchifyRenderer | undefined {
    const directory = env.DIFFCOMPASS_ARCHIFY_DIR?.trim() || ArchifyRenderer.bundledDirectory();
    return directory ? new ArchifyRenderer(directory) : undefined;
  }

  static bundledDirectory(executable = process.execPath): string | undefined {
    const directory = resolve(dirname(realpathSync(executable)), "../share/diffcompass/archify");
    return existsSync(join(directory, "bin/archify.mjs")) ? directory : undefined;
  }

  private async cli(): Promise<string> {
    if (!isAbsolute(this.directory)) throw new Error("DIFFCOMPASS_ARCHIFY_DIR must be an absolute path to an installed Archify skill.");
    const root = resolve(this.directory);
    const script = join(root, "bin", "archify.mjs");
    const [rootMetadata, scriptMetadata] = await Promise.all([lstat(root), lstat(script)]);
    if (!rootMetadata.isDirectory() || !scriptMetadata.isFile()) throw new Error("Archify is unavailable: expected bin/archify.mjs in DIFFCOMPASS_ARCHIFY_DIR.");
    return script;
  }

  async render(outline: TourOutline, previous: ArchifyArtifact[] = [], onlyIds?: ReadonlySet<string>): Promise<{ artifacts: ArchifyArtifact[]; failures: ArchifyFailure[] }> {
    const candidates = archifyCandidates(outline).filter(candidate => !onlyIds || onlyIds.has(candidate.id));
    if (candidates.length === 0) return { artifacts: [], failures: [] };
    const prior = new Map(previous.map((artifact) => [artifact.id, artifact]));
    const artifacts: ArchifyArtifact[] = [];
    const failures: ArchifyFailure[] = [];
    let cli: string;
    try {
      cli = await this.cli();
    } catch (error) {
      for (const candidate of candidates) {
        const lastValid = prior.get(candidate.id);
        if (lastValid) artifacts.push(lastValid);
        failures.push({ id: candidate.id, type: candidate.type, message: reviewerFailureMessage(candidate.type, error), preservedLastValid: Boolean(lastValid) });
      }
      return { artifacts, failures };
    }
    for (const candidate of candidates) {
      try {
        artifacts.push(await this.renderCandidate(cli, candidate));
      } catch (error) {
        const lastValid = prior.get(candidate.id);
        if (lastValid) artifacts.push(lastValid);
        failures.push({ id: candidate.id, type: candidate.type, message: reviewerFailureMessage(candidate.type, error), preservedLastValid: Boolean(lastValid) });
      }
    }
    return { artifacts, failures };
  }

  private async renderCandidate(cli: string, candidate: ArchifyCandidate): Promise<ArchifyArtifact> {
    const directory = await mkdtemp(join(tmpdir(), "diffcompass-archify-"));
    const env = { ARCHIFY_UPDATE_CHECK_DISABLED: "1" };
    try {
      if (candidate.type === "architecture") {
        await layoutArchitecture([candidate.ir, candidate.comparison?.before, candidate.comparison?.delta].filter((document): document is ArchifyDocument => Boolean(document)));
      }
      if (candidate.type === "lifecycle") {
        const { viewBox, ...layout } = layoutLifecycle(candidate.ir.states as Parameters<typeof layoutLifecycle>[0], candidate.ir.transitions as Parameters<typeof layoutLifecycle>[1]);
        Object.assign(candidate.ir, layout);
        (candidate.ir.meta as ArchifyDocument).viewBox = viewBox!;
      }
      const after = await this.renderDocument(cli, candidate.type, candidate.ir, directory, env);
      const comparison: NonNullable<ArchifyArtifact["comparison"]> = {};
      // Each comparison state is a complete, separately validated Archify
      // document. If a supplemental view cannot be rendered, keep the
      // validated After map instead of presenting a partial or invented view.
      if (candidate.comparison?.before) {
        try { comparison.before = await this.renderDocument(cli, candidate.type, candidate.comparison.before, directory, env); } catch { /* After remains available. */ }
      }
      if (candidate.comparison?.delta) {
        try { comparison.delta = await this.renderDocument(cli, candidate.type, candidate.comparison.delta, directory, env); } catch { /* Before/After remain available. */ }
      }
      return {
        id: candidate.id,
        purpose: candidate.purpose,
        domainDetails: candidate.domainDetails,
        nodeRoles: candidate.nodeRoles,
        type: candidate.type,
        title: candidate.title,
        ir: after.ir,
        html: after.html,
        evidence: candidate.evidence,
        affectedFiles: candidate.affectedFiles,
        ...(Object.keys(comparison).length ? { comparison } : {}),
        view: comparison.before ? (comparison.delta ? "before-delta-after" : "before-after") : "single",
        validationReceipt: after.validationReceipt,
        renderedAt: this.now().toISOString(),
      };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private async renderDocument(cli: string, type: ArchifyDiagramType, ir: ArchifyDocument, directory: string, env: Record<string, string | undefined>): Promise<{ ir: ArchifyDocument; html: string; validationReceipt: string }> {
    const input = join(directory, "candidate.json");
    const output = join(directory, "artifact.html");
    await writeFile(input, `${JSON.stringify(ir, null, 2)}\n`, "utf8");
    // The compiled executable contains Bun itself. This also propagates to
    // Archify's renderer/checker subprocesses via process.execPath.
    const runtimeEnv = { ...env, BUN_BE_BUN: "1" };
    const validation = await this.runner([process.execPath, cli, "validate", type, input, "--quality", "standard", "--json"], directory, runtimeEnv);
    const delivered = await this.runner([process.execPath, cli, "deliver", type, input, output, "--quality", "standard", "--json"], directory, runtimeEnv);
    const html = await readFile(output, "utf8");
    if (!html.trim() || new TextEncoder().encode(html).byteLength > MAX_ARTIFACT_BYTES) throw new Error("Archify produced no displayable artifact or exceeded the 5 MiB artifact limit.");
    return { ir, html, validationReceipt: compactReceipt(`${validation.stdout}\n${delivered.stdout}`, `${validation.stderr}\n${delivered.stderr}`) };
  }
}
