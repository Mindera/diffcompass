import { expect, test } from "bun:test";
import { validateReviewArchitecture } from "../src/architecture.ts";

const valid = {
  title: "Component relationships",
  summary: "A new receipt formatter delegates to the changed cart totals.",
  mermaid: `flowchart LR
  caller["Checkout caller"]:::external
  receipt["Receipt formatter"]:::new
  cart["Cart totals"]:::touched
  caller -->|requests receipt from| receipt
  receipt -->|calculates amount with| cart
  classDef new stroke:#2e7d32,stroke-width:3px
  classDef touched stroke:#f9a825,stroke-width:3px
  classDef removed stroke:#c62828,stroke-width:3px,stroke-dasharray:4 3
  classDef external stroke:#888888,stroke-dasharray:3 3`,
  dependencyChanges: ["Added Receipt formatter → Cart totals: calculates amount with"],
  affectedFiles: ["src/cart.ts", "src/receipt.ts"],
};

test("accepts the constrained ACE-style component overlay", () => {
  expect(validateReviewArchitecture(valid)).toEqual(valid);
});

test("rejects unlabelled edges, undeclared nodes, active content, and unsupported styling", () => {
  for (const mermaid of [
    valid.mermaid.replace("-->|requests receipt from|", "-->"),
    valid.mermaid.replace("receipt -->|calculates amount with| cart", "receipt -->|calculates amount with| missing"),
    `${valid.mermaid}\n  click cart https://attacker.invalid`,
    `${valid.mermaid}\n  style cart fill:red`,
    valid.mermaid.replace("flowchart LR", "flowchart TD"),
  ]) expect(() => validateReviewArchitecture({ ...valid, mermaid })).toThrow();
});

test("requires bounded dependency descriptions and exact changed-file evidence", () => {
  expect(() => validateReviewArchitecture({ ...valid, dependencyChanges: [] })).not.toThrow();
  expect(() => validateReviewArchitecture({ ...valid, affectedFiles: [] })).toThrow("affectedFiles");
  expect(() => validateReviewArchitecture({ ...valid, unexpected: true })).toThrow("unsupported field");
});
