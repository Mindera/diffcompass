import { createHash } from "node:crypto";
import { ReviewError } from "./errors.ts";
import type { CallFlow, DryRunDetail, DryRunFlowKind, DryRunMapLink, DryRunPlan, DryRunScenario, DryRunSourceAnchor, DryRunStep, DryRunTrace, DryRunValueChange, GitComparison, TourOutline } from "./types.ts";

const MAX_SCENARIOS_PER_FLOW = 8;
const MAX_STEPS = 80;
const MAX_COMPACT_STEPS = 8;
const MAX_DETAILED_STEPS = 24;
const MAX_TRACE_BYTES = 768 * 1024;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: string[], name: string): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected) throw new ReviewError(`${name} contains an unsupported field: ${unexpected}`);
}

function text(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new ReviewError(`${name} must be a non-empty string no longer than ${max} characters.`);
  return value.trim();
}

function optionalText(value: unknown, name: string, max: number): string | undefined {
  return value === undefined ? undefined : text(value, name, max);
}

function jsonValue(value: unknown, name: string, depth = 0): unknown {
  if (depth > 8) throw new ReviewError(`${name} is nested too deeply.`);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ReviewError(`${name} must contain JSON-compatible numbers.`);
    return value;
  }
  if (typeof value === "string") {
    if (value.length > 16_000) throw new ReviewError(`${name} contains an overlong string.`);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 100) throw new ReviewError(`${name} contains too many values.`);
    return value.map((item, index) => jsonValue(item, `${name}[${index}]`, depth + 1));
  }
  if (!record(value)) throw new ReviewError(`${name} must contain JSON values.`);
  const keys = Object.keys(value);
  if (keys.length > 100) throw new ReviewError(`${name} contains too many keys.`);
  const normalized: Record<string, unknown> = {};
  for (const key of keys) {
    if (!key || key.length > 256) throw new ReviewError(`${name} contains an invalid key.`);
    normalized[key] = jsonValue(value[key], `${name}.${key}`, depth + 1);
  }
  return normalized;
}

function jsonRecord(value: unknown, name: string): Record<string, unknown> {
  if (!record(value)) throw new ReviewError(`${name} must be a JSON object.`);
  const normalized = jsonValue(value, name);
  if (!record(normalized)) throw new ReviewError(`${name} must be a JSON object.`);
  if (new TextEncoder().encode(JSON.stringify(normalized)).byteLength > 64 * 1024) throw new ReviewError(`${name} is too large.`);
  return normalized;
}

function stringList(value: unknown, name: string, max = 20, itemMax = 2_000): string[] {
  if (!Array.isArray(value) || value.length > max) throw new ReviewError(`${name} must contain at most ${max} entries.`);
  const normalized = value.map((item, index) => text(item, `${name}[${index}]`, itemMax));
  if (new Set(normalized).size !== normalized.length) throw new ReviewError(`${name} must not contain duplicates.`);
  return normalized;
}

export function comparisonFingerprint(comparison: GitComparison): string {
  return createHash("sha256")
    .update(JSON.stringify({ base: comparison.base, mergeBase: comparison.mergeBase, head: comparison.head, patch: comparison.patch }))
    .digest("hex");
}

function callFlow(outline: Pick<TourOutline, "callFlows">, id: string): CallFlow | undefined {
  return outline.callFlows.find((flow) => flow.id === id);
}

/** Use this composite identity at every boundary; ids are only unique within a kind. */
export function dryRunPlanIdentity(flowKind: DryRunFlowKind, flowId: string): string {
  return `${flowKind}:${flowId}`;
}

export function dryRunPlanFor(outline: Pick<TourOutline, "dryRunPlans">, flowKind: DryRunFlowKind, flowId: string): DryRunPlan | undefined {
  return outline.dryRunPlans?.find((plan) => plan.flowKind === flowKind && plan.flowId === flowId);
}

export function dryRunFlowFingerprint(outline: Pick<TourOutline, "dryRunPlans">, flowKind: DryRunFlowKind, flowId: string): string {
  const plan = dryRunPlanFor(outline, flowKind, flowId);
  if (!plan) throw new ReviewError("The selected execution flow is no longer available in this review.");
  // Scenario edits have their own fingerprint. This captures only the behavior evidence snapshot.
  const { scenarios: _scenarios, ...flow } = plan;
  return createHash("sha256").update(JSON.stringify(flow)).digest("hex");
}

export function dryRunScenarioFingerprint(scenario: DryRunScenario): string {
  return createHash("sha256")
    .update(JSON.stringify({ id: scenario.id, inputs: scenario.inputs, mocks: scenario.mocks, assumptions: scenario.assumptions, description: scenario.description }))
    .digest("hex");
}

export function validateDryRunScenario(value: unknown, name = "scenario"): DryRunScenario {
  if (!record(value)) throw new ReviewError(`${name} must be an object.`);
  exactKeys(value, ["id", "title", "reason", "source", "description", "inputs", "mocks", "assumptions", "updatedAt"], name);
  const source = String(value.source);
  if (!["test", "example", "invented", "reviewer"].includes(source)) throw new ReviewError(`${name}.source must say whether the sample comes from a test, example, invention, or reviewer.`);
  const updatedAt = value.updatedAt === undefined ? undefined : text(value.updatedAt, `${name}.updatedAt`, 64);
  return {
    id: text(value.id, `${name}.id`, 128),
    title: text(value.title, `${name}.title`, 500),
    reason: text(value.reason, `${name}.reason`, 2_000),
    source: source as DryRunScenario["source"],
    ...(value.description === undefined ? {} : { description: optionalText(value.description, `${name}.description`, 4_000) }),
    inputs: jsonRecord(value.inputs, `${name}.inputs`),
    mocks: jsonRecord(value.mocks, `${name}.mocks`),
    assumptions: stringList(value.assumptions, `${name}.assumptions`),
    ...(updatedAt ? { updatedAt } : {}),
  };
}

export function validateDryRunPlans(value: unknown, outline: Pick<TourOutline, "callFlows" | "flows">, comparison: GitComparison, options: { suggested?: boolean } = {}): DryRunPlan[] {
  if (!Array.isArray(value) || value.length > 16) throw new ReviewError("Dry-run plans must contain at most 16 flows.");
  const identities = new Set<string>();
  return value.map((candidate, index) => {
    if (!record(candidate)) throw new ReviewError(`dryRunPlans[${index}] must be an object.`);
    exactKeys(candidate, ["flowId", "flowKind", "title", "summary", "source", "callFlowId", "sequenceFlowId", "scenarios"], `dryRunPlans[${index}]`);
    const flowId = text(candidate.flowId, `dryRunPlans[${index}].flowId`, 128);
    const flowKind = String(candidate.flowKind) as DryRunFlowKind;
    if (flowKind !== "behavior") throw new ReviewError(`dryRunPlans[${index}].flowKind must be behavior.`);
    const identity = dryRunPlanIdentity(flowKind, flowId);
    if (identities.has(identity)) throw new ReviewError("Dry-run flow identities must be unique.");
    identities.add(identity);
    if (!record(candidate.source)) throw new ReviewError(`dryRunPlans[${index}].source must describe bounded code evidence.`);
    exactKeys(candidate.source, ["anchors"], `dryRunPlans[${index}].source`);
    if (!Array.isArray(candidate.source.anchors) || candidate.source.anchors.length === 0 || candidate.source.anchors.length > 20) {
      throw new ReviewError(`dryRunPlans[${index}].source.anchors must contain between 1 and 20 source ranges.`);
    }
    const source = { anchors: candidate.source.anchors.map((anchor, anchorIndex) => validateSource(anchor, comparison, `dryRunPlans[${index}].source.anchors[${anchorIndex}]`)) };
    const callFlowId = candidate.callFlowId === undefined ? undefined : text(candidate.callFlowId, `dryRunPlans[${index}].callFlowId`, 128);
    const sequenceFlowId = candidate.sequenceFlowId === undefined ? undefined : text(candidate.sequenceFlowId, `dryRunPlans[${index}].sequenceFlowId`, 128);
    if (callFlowId && !callFlow(outline, callFlowId)) throw new ReviewError(`dryRunPlans[${index}].callFlowId must reference current call-flow evidence.`);
    if (sequenceFlowId && !outline.flows.some((flow) => flow.id === sequenceFlowId)) throw new ReviewError(`dryRunPlans[${index}].sequenceFlowId must reference a current sequence flow.`);
    if (!Array.isArray(candidate.scenarios) || candidate.scenarios.length > MAX_SCENARIOS_PER_FLOW || (options.suggested && (candidate.scenarios.length < 2 || candidate.scenarios.length > 3))) {
      throw new ReviewError(options.suggested ? "Each generated dry-run flow must suggest two or three scenarios." : `Each dry-run flow may contain at most ${MAX_SCENARIOS_PER_FLOW} scenarios.`);
    }
    const scenarios = candidate.scenarios.map((scenario, scenarioIndex) => validateDryRunScenario(scenario, `dryRunPlans[${index}].scenarios[${scenarioIndex}]`));
    if (new Set(scenarios.map((scenario) => scenario.id)).size !== scenarios.length) throw new ReviewError("Scenario ids must be unique within a flow.");
    return {
      flowId,
      flowKind,
      title: text(candidate.title, `dryRunPlans[${index}].title`, 500),
      summary: text(candidate.summary, `dryRunPlans[${index}].summary`, 4_000),
      source,
      ...(callFlowId ? { callFlowId } : {}),
      ...(sequenceFlowId ? { sequenceFlowId } : {}),
      scenarios,
    };
  });
}

function validateSource(value: unknown, comparison: GitComparison, name: string): DryRunSourceAnchor {
  if (!record(value)) throw new ReviewError(`${name} must be a source location.`);
  exactKeys(value, ["path", "side", "startLine", "endLine", "changed"], name);
  const path = text(value.path, `${name}.path`, 4_096);
  if (!comparison.repositoryFiles.includes(path)) throw new ReviewError(`${name}.path must reference a repository file in this comparison.`);
  if (value.side !== "new") throw new ReviewError(`${name}.side must be new; dry runs simulate the reviewed implementation.`);
  if (!Number.isInteger(value.startLine) || !Number.isInteger(value.endLine) || Number(value.startLine) < 1 || Number(value.endLine) < Number(value.startLine) || Number(value.endLine) - Number(value.startLine) > 100) {
    throw new ReviewError(`${name} must have an ordered source range of at most 101 lines.`);
  }
  if (typeof value.changed !== "boolean") throw new ReviewError(`${name}.changed must be a boolean.`);
  const changed = comparison.files.some((file) => file.path === path && file.hunks.some((hunk) => hunk.rows.some((row) => row.kind === "addition" && row.newLine !== null && row.newLine >= Number(value.startLine) && row.newLine <= Number(value.endLine))));
  if (changed !== value.changed) throw new ReviewError(`${name}.changed does not match the reviewed diff.`);
  return { path, side: "new", startLine: Number(value.startLine), endLine: Number(value.endLine), changed };
}

function validateMapLink(value: unknown, outline: Pick<TourOutline, "callFlows">, name: string): DryRunMapLink | undefined {
  if (value === undefined) return undefined;
  if (!record(value)) throw new ReviewError(`${name} must be an object.`);
  exactKeys(value, ["callFlowId", "nodeId", "edgeId"], name);
  const callFlowId = text(value.callFlowId, `${name}.callFlowId`, 128);
  const flow = callFlow(outline, callFlowId);
  if (!flow) throw new ReviewError(`${name}.callFlowId must reference the current call-flow evidence.`);
  const nodeId = value.nodeId === undefined ? undefined : text(value.nodeId, `${name}.nodeId`, 128);
  const edgeId = value.edgeId === undefined ? undefined : text(value.edgeId, `${name}.edgeId`, 128);
  if (nodeId && !flow.nodes.some((node) => node.id === nodeId)) throw new ReviewError(`${name}.nodeId is not in the linked call flow.`);
  if (edgeId && !flow.edges.some((edge) => edge.id === edgeId)) throw new ReviewError(`${name}.edgeId is not in the linked call flow.`);
  return { callFlowId, ...(nodeId ? { nodeId } : {}), ...(edgeId ? { edgeId } : {}) };
}

function validateValueChanges(value: unknown, name: string): DryRunValueChange[] {
  if (!Array.isArray(value) || value.length > 30) throw new ReviewError(`${name} must contain at most 30 value changes.`);
  return value.map((candidate, index) => {
    if (!record(candidate)) throw new ReviewError(`${name}[${index}] must be an object.`);
    exactKeys(candidate, ["name", "before", "after", "note"], `${name}[${index}]`);
    if (candidate.before === undefined && candidate.after === undefined && candidate.note === undefined) throw new ReviewError(`${name}[${index}] must describe a value or note.`);
    return {
      name: text(candidate.name, `${name}[${index}].name`, 256),
      ...(candidate.before === undefined ? {} : { before: jsonValue(candidate.before, `${name}[${index}].before`) }),
      ...(candidate.after === undefined ? {} : { after: jsonValue(candidate.after, `${name}[${index}].after`) }),
      ...(candidate.note === undefined ? {} : { note: text(candidate.note, `${name}[${index}].note`, 1_000) }),
    };
  });
}

function validateStep(value: unknown, comparison: GitComparison, outline: Pick<TourOutline, "callFlows">, index: number): DryRunStep {
  if (!record(value)) throw new ReviewError(`steps[${index}] must be an object.`);
  exactKeys(value, ["id", "order", "kind", "title", "explanation", "source", "function", "arguments", "locals", "valueChanges", "assumption", "mapLink"], `steps[${index}]`);
  const kind = String(value.kind) as DryRunStep["kind"];
  if (!["entry", "calculation", "branch", "call", "mock", "return", "unresolved"].includes(kind)) throw new ReviewError(`steps[${index}].kind is invalid.`);
  if (!Number.isInteger(value.order) || Number(value.order) !== index + 1) throw new ReviewError(`steps[${index}].order must follow the execution order.`);
  const mapLink = validateMapLink(value.mapLink, outline, `steps[${index}].mapLink`);
  return {
    id: text(value.id, `steps[${index}].id`, 128),
    order: Number(value.order),
    kind,
    title: text(value.title, `steps[${index}].title`, 500),
    explanation: text(value.explanation, `steps[${index}].explanation`, 8_000),
    source: validateSource(value.source, comparison, `steps[${index}].source`),
    function: text(value.function, `steps[${index}].function`, 500),
    ...(value.arguments === undefined ? {} : { arguments: jsonRecord(value.arguments, `steps[${index}].arguments`) }),
    ...(value.locals === undefined ? {} : { locals: jsonRecord(value.locals, `steps[${index}].locals`) }),
    valueChanges: validateValueChanges(value.valueChanges, `steps[${index}].valueChanges`),
    ...(value.assumption === undefined ? {} : { assumption: text(value.assumption, `steps[${index}].assumption`, 2_000) }),
    ...(mapLink ? { mapLink } : {}),
  };
}

export function validateDryRunTrace(value: unknown, comparison: GitComparison, outline: Pick<TourOutline, "callFlows" | "flows" | "dryRunPlans">): DryRunTrace {
  if (!record(value)) throw new ReviewError("Dry-run trace must be an object.");
  exactKeys(value, ["id", "comparison", "flowId", "flowKind", "flowFingerprint", "detail", "scenario", "assumptions", "steps", "outcome", "preparedAt", "stale"], "Dry-run trace");
  if (!record(value.comparison)) throw new ReviewError("Dry-run trace comparison must be an object.");
  exactKeys(value.comparison, ["base", "mergeBase", "head", "fingerprint"], "Dry-run trace comparison");
  const fingerprint = comparisonFingerprint(comparison);
  if (value.comparison.base !== comparison.base || value.comparison.mergeBase !== comparison.mergeBase || value.comparison.head !== comparison.head || value.comparison.fingerprint !== fingerprint) {
    throw new ReviewError("Dry-run trace was generated for a different comparison.");
  }
  const flowId = text(value.flowId, "Dry-run trace flowId", 128);
  const flowKind = String(value.flowKind) as DryRunFlowKind;
  if (flowKind !== "behavior" || !dryRunPlanFor(outline, flowKind, flowId)) throw new ReviewError("Dry-run trace must reference a current dry-run behavior.");
  const flowFingerprint = dryRunFlowFingerprint(outline, flowKind, flowId);
  if (value.flowFingerprint !== flowFingerprint) throw new ReviewError("Dry-run trace does not match the selected flow snapshot.");
  const detail: DryRunDetail | undefined = value.detail === undefined ? undefined : String(value.detail) as DryRunDetail;
  if (detail !== undefined && detail !== "compact" && detail !== "detailed") throw new ReviewError("Dry-run trace detail must be compact or detailed.");
  const scenario = validateDryRunScenario(value.scenario, "Dry-run trace scenario");
  const maxSteps = detail === "compact" ? MAX_COMPACT_STEPS : detail === "detailed" ? MAX_DETAILED_STEPS : MAX_STEPS;
  if (!Array.isArray(value.steps) || value.steps.length === 0 || value.steps.length > maxSteps) throw new ReviewError(`A ${detail ?? "legacy"} dry-run trace must contain between 1 and ${maxSteps} steps.`);
  const steps = value.steps.map((step, index) => validateStep(step, comparison, outline, index));
  if (new Set(steps.map((step) => step.id)).size !== steps.length) throw new ReviewError("Dry-run trace step ids must be unique.");
  if (!record(value.outcome)) throw new ReviewError("Dry-run trace outcome must be an object.");
  exactKeys(value.outcome, ["summary", "value"], "Dry-run trace outcome");
  const trace: DryRunTrace = {
    id: text(value.id, "Dry-run trace id", 128),
    comparison: { base: comparison.base, mergeBase: comparison.mergeBase, head: comparison.head, fingerprint },
    flowId,
    flowKind,
    flowFingerprint,
    ...(detail ? { detail } : {}),
    scenario,
    assumptions: stringList(value.assumptions, "Dry-run trace assumptions"),
    steps,
    outcome: { summary: text(value.outcome.summary, "Dry-run trace outcome summary", 8_000), ...(value.outcome.value === undefined ? {} : { value: jsonValue(value.outcome.value, "Dry-run trace outcome value") }) },
    preparedAt: text(value.preparedAt, "Dry-run trace preparedAt", 64),
    ...(value.stale === true ? { stale: true } : {}),
  };
  if (new TextEncoder().encode(JSON.stringify(trace)).byteLength > MAX_TRACE_BYTES) throw new ReviewError("Dry-run trace exceeds the 768 KiB safety limit.");
  return trace;
}

/** Normalizes the smaller agent contract while the session owns trace identity and timestamp. */
export function validateGeneratedDryRun(
  value: unknown,
  comparison: GitComparison,
  outline: Pick<TourOutline, "callFlows" | "flows" | "dryRunPlans">,
  flowId: string,
  flowKind: DryRunFlowKind,
  scenario: DryRunScenario,
  detail: DryRunDetail = "compact",
): DryRunTrace {
  if (!record(value)) throw new ReviewError("The agent did not return a dry-run trace object.");
  exactKeys(value, ["assumptions", "steps", "outcome"], "Dry-run agent response");
  return validateDryRunTrace({
    id: crypto.randomUUID(),
    comparison: { base: comparison.base, mergeBase: comparison.mergeBase, head: comparison.head, fingerprint: comparisonFingerprint(comparison) },
    flowId,
    flowKind,
    flowFingerprint: dryRunFlowFingerprint(outline, flowKind, flowId),
    detail,
    scenario,
    assumptions: value.assumptions,
    steps: value.steps,
    outcome: value.outcome,
    preparedAt: new Date().toISOString(),
  }, comparison, outline);
}

/** Source anchors may point to unchanged code, so verify their actual target lines before display. */
export async function validateTraceSourceAnchors(trace: DryRunTrace, readSource: (path: string) => Promise<string>): Promise<void> {
  const bounds = new Map<string, number>();
  for (const step of trace.steps) {
    if (!bounds.has(step.source.path)) {
      const content = await readSource(step.source.path);
      bounds.set(step.source.path, content.replaceAll("\r\n", "\n").split("\n").length);
    }
    if (step.source.endLine > bounds.get(step.source.path)!) {
      throw new ReviewError(`Dry-run step ${step.order} references a line that is not present in ${step.source.path}.`);
    }
  }
}

/** Validate plan evidence against real new-side source before persisting or using it. */
export async function validateDryRunPlanSourceAnchors(plans: DryRunPlan[], readSource: (path: string) => Promise<string>): Promise<void> {
  const bounds = new Map<string, number>();
  for (const plan of plans) {
    for (const anchor of plan.source.anchors) {
      if (!bounds.has(anchor.path)) {
        const content = await readSource(anchor.path);
        bounds.set(anchor.path, content.replaceAll("\r\n", "\n").split("\n").length);
      }
      if (anchor.endLine > bounds.get(anchor.path)!) {
        throw new ReviewError(`Dry-run flow ${plan.flowId} references a line that is not present in ${anchor.path}.`);
      }
    }
  }
}

export function traceIsStale(trace: DryRunTrace, comparison: GitComparison, outline: Pick<TourOutline, "dryRunPlans">): boolean {
  if (trace.stale || trace.comparison.fingerprint !== comparisonFingerprint(comparison)) return true;
  try {
    const plan = dryRunPlanFor(outline, trace.flowKind, trace.flowId);
    const scenario = plan?.scenarios.find((candidate) => candidate.id === trace.scenario.id);
    return !scenario ||
      trace.flowFingerprint !== dryRunFlowFingerprint(outline, trace.flowKind, trace.flowId) ||
      dryRunScenarioFingerprint(scenario) !== dryRunScenarioFingerprint(trace.scenario);
  } catch {
    return true;
  }
}
