import { expect, test } from "bun:test";
import {
  enumValue,
  exactKeys,
  finitePositiveInteger,
  HttpError,
  parseAgentSelection,
  parseOutcome,
  readJsonObject,
  requiredString,
} from "../src/validation.ts";

function expectHttpError(action: () => unknown, status: number, message: string) {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(status);
    expect((error as Error).message).toContain(message);
    return;
  }
  throw new Error("Expected an HttpError");
}

test("readJsonObject requires JSON objects and enforces the byte limit", async () => {
  await expect(readJsonObject(new Request("http://tour.test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ answer: 42 }),
  }))).resolves.toEqual({ answer: 42 });

  await expect(readJsonObject(new Request("http://tour.test", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "{}",
  }))).rejects.toMatchObject({ status: 415 });

  await expect(readJsonObject(new Request("http://tour.test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "[]",
  }))).rejects.toMatchObject({ status: 422 });

  await expect(readJsonObject(new Request("http://tour.test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"body":"too long"}',
  }), 8)).rejects.toMatchObject({ status: 413 });
});

test("selection parsing rejects unknown fields and unsupported reasoning", () => {
  expect(parseAgentSelection({ adapterId: "codex", modelId: "gpt-test", reasoningEffort: "high" })).toEqual({
    adapterId: "codex",
    modelId: "gpt-test",
    reasoningEffort: "high",
  });
  expectHttpError(() => parseAgentSelection({ adapterId: "codex", unexpected: true }), 422, "Unexpected field");
  expectHttpError(() => parseAgentSelection({ reasoningEffort: "turbo" }), 422, "reasoningEffort");
});

test("primitive validation has strict runtime semantics", () => {
  expect(requiredString("  useful text  ", "body", 100)).toBe("useful text");
  expectHttpError(() => requiredString("   ", "body", 100), 422, "cannot be empty");
  expectHttpError(() => finitePositiveInteger(0, "line"), 422, "positive integer");
  expectHttpError(() => finitePositiveInteger(1.5, "line"), 422, "positive integer");
  expect(enumValue("new", "side", ["old", "new"] as const)).toBe("new");
  expectHttpError(() => enumValue("future", "side", ["old", "new"] as const), 422, "side must be one of");
  expectHttpError(() => exactKeys({ okay: true, extra: true }, ["okay"]), 422, "Unexpected field");
  expect(parseOutcome("feedback")).toBe("feedback");
  expectHttpError(() => parseOutcome("ship-it"), 422, "outcome");
});
