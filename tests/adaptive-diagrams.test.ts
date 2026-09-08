import { expect, test } from "bun:test";
import { validateReviewAdaptiveDiagram } from "../src/adaptive-diagrams.ts";

const base = {
  title: "Supported view",
  summary: "A grounded view.",
  evidence: ["src/order.ts records the lifecycle."],
  materiallyImprovesUnderstanding: "This view makes the lifecycle explicit.",
  affectedFiles: ["src/order.ts"],
};

test("accepts bounded state-machine diagrams", () => {
  expect(validateReviewAdaptiveDiagram({
    ...base,
    kind: "state-machine",
    mermaid: "stateDiagram-v2\n  [*] --> pending\n  pending --> complete : saved\n  complete --> [*]",
  })).toMatchObject({ kind: "state-machine", title: "Supported view" });
});

test("accepts bounded ER diagrams with declared entities", () => {
  expect(validateReviewAdaptiveDiagram({
    ...base,
    kind: "data-model",
    mermaid: "erDiagram\n  ORDER {\n    string id PK\n  }\n  ITEM {\n    number quantity\n  }\n  ORDER ||--|{ ITEM : contains",
  })).toMatchObject({ kind: "data-model" });
});

test("rejects unsafe or unsupported Mermaid instead of passing it to the renderer", () => {
  expect(() => validateReviewAdaptiveDiagram({
    ...base,
    kind: "state-machine",
    mermaid: "stateDiagram-v2\n  [*] --> pending\n  click pending call malicious()",
  })).toThrow("unsupported Mermaid syntax");
  expect(() => validateReviewAdaptiveDiagram({
    ...base,
    kind: "data-model",
    mermaid: "erDiagram\n  ORDER ||--o{ ITEM : contains",
  })).toThrow("declared entities");
});

test("enforces evidence and benefit metadata", () => {
  expect(() => validateReviewAdaptiveDiagram({
    ...base,
    kind: "state-machine",
    evidence: [],
    mermaid: "stateDiagram-v2\n  [*] --> pending\n  pending --> complete",
  })).toThrow("evidence");
});
