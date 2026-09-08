import type { AgentSelection, ReasoningEffort, ReviewOutcome } from "./types.ts";

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

type JsonObject = Record<string, unknown>;

export async function readJsonObject(request: Request, maxBytes = 64 * 1024): Promise<JsonObject> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new HttpError(415, "Content-Type must be application/json.");
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new HttpError(413, "Request body is too large.");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new HttpError(413, "Request body is too large.");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new HttpError(400, "Request body must contain valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(422, "Request body must be a JSON object.");
  return value as JsonObject;
}

export function exactKeys(value: JsonObject, allowed: string[]): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) throw new HttpError(422, `Unexpected field: ${unexpected[0]}`);
}

export function requiredString(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string") throw new HttpError(422, `${name} must be a string.`);
  const trimmed = value.trim();
  if (!trimmed) throw new HttpError(422, `${name} cannot be empty.`);
  if (trimmed.length > maxLength) throw new HttpError(422, `${name} is too long.`);
  return trimmed;
}

export function optionalString(value: unknown, name: string, maxLength: number): string | undefined {
  return value === undefined ? undefined : requiredString(value, name, maxLength);
}

export function finitePositiveInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new HttpError(422, `${name} must be a positive integer.`);
  }
  return value;
}

export function enumValue<const T extends string>(value: unknown, name: string, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new HttpError(422, `${name} must be one of: ${allowed.join(", ")}.`);
  }
  return value as T;
}

export function parseAgentSelection(value: JsonObject): Partial<AgentSelection> {
  exactKeys(value, ["adapterId", "modelId", "reasoningEffort", "includeArchitecture", "includeCallFlows", "includeFlows", "includeFindings", "includeAdaptiveDiagrams"]);
  const efforts: ReasoningEffort[] = ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
  if (value.includeArchitecture !== undefined && typeof value.includeArchitecture !== "boolean") throw new HttpError(422, "includeArchitecture must be a boolean.");
  if (value.includeCallFlows !== undefined && typeof value.includeCallFlows !== "boolean") throw new HttpError(422, "includeCallFlows must be a boolean.");
  if (value.includeFlows !== undefined && typeof value.includeFlows !== "boolean") throw new HttpError(422, "includeFlows must be a boolean.");
  if (value.includeFindings !== undefined && typeof value.includeFindings !== "boolean") throw new HttpError(422, "includeFindings must be a boolean.");
  if (value.includeAdaptiveDiagrams !== undefined && typeof value.includeAdaptiveDiagrams !== "boolean") throw new HttpError(422, "includeAdaptiveDiagrams must be a boolean.");
  return {
    adapterId: optionalString(value.adapterId, "adapterId", 64),
    modelId: optionalString(value.modelId, "modelId", 128),
    reasoningEffort: value.reasoningEffort === undefined
      ? undefined
      : enumValue(value.reasoningEffort, "reasoningEffort", efforts),
    includeArchitecture: value.includeArchitecture as boolean | undefined,
    includeCallFlows: value.includeCallFlows as boolean | undefined,
    includeFlows: value.includeFlows as boolean | undefined,
    includeFindings: value.includeFindings as boolean | undefined,
    includeAdaptiveDiagrams: value.includeAdaptiveDiagrams as boolean | undefined,
  };
}

export function parseOutcome(value: unknown): ReviewOutcome {
  return enumValue(value, "outcome", ["accepted", "feedback", "cancelled"]);
}
