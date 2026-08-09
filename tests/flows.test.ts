import { expect, test } from "bun:test";
import { inspectSequenceDiagram, validateReviewFlow } from "../src/flows.ts";

const flow = (mermaid: string) => ({
  id: "checkout",
  title: "Checkout",
  summary: "A grounded checkout flow.",
  mermaid,
  provenance: "verified" as const,
  blastRadiusSize: 4,
});

test("accepts the documented extended Mermaid sequence syntax", () => {
  const mermaid = `sequenceDiagram
  autonumber
  actor User
  participant API as HTTP API
  User->>API: Submit
  activate API
  Note right of API: Validate input
  alt accepted
    API-->>User: 202
  else rejected
    API--xUser: error
  end
  deactivate API`;
  expect(validateReviewFlow(flow(mermaid)).mermaid).toBe(mermaid);
  expect(inspectSequenceDiagram(mermaid)).toMatchObject({ actors: ["User", "API"], unsupported: [] });
});

test("rejects non-sequence, active-content, unknown, oversized, and over-wide diagrams", () => {
  for (const mermaid of [
    "graph TD\n  A-->B",
    "sequenceDiagram\n  click A https://attacker.invalid",
    "sequenceDiagram\n  %%{init: {securityLevel: 'loose'}}%%\n  A->>B: hello",
    "sequenceDiagram\n  A:::danger->>B: hello",
    `sequenceDiagram\n  A->>B: ${"x".repeat(12_100)}`,
    `sequenceDiagram\n${Array.from({ length: 13 }, (_, index) => `  A${index}->>A${(index + 1) % 13}: next`).join("\n")}`,
  ]) {
    expect(() => validateReviewFlow(flow(mermaid))).toThrow();
  }
});

test("rejects extra fields and bounded metadata violations", () => {
  expect(() => validateReviewFlow({ ...flow("sequenceDiagram\n  A->>B: ok"), extra: true })).toThrow("unsupported field");
  expect(() => validateReviewFlow({ ...flow("sequenceDiagram\n  A->>B: ok"), blastRadiusSize: -1 })).toThrow("blastRadiusSize");
  expect(() => validateReviewFlow({ ...flow("sequenceDiagram\n  A->>B: ok"), provenance: "guessed" })).toThrow("provenance");
});

test("normalizes semicolons in message text and derives impact from exact changed files", () => {
  expect(validateReviewFlow({
    ...flow("sequenceDiagram\n  A->>B: returns; failures are logged"),
    blastRadiusSize: undefined,
    affectedFiles: ["src/startup.ts", "src/logging.ts"],
  })).toMatchObject({
    mermaid: "sequenceDiagram\n  A->>B: returns&#59; failures are logged",
    blastRadiusSize: 2,
    affectedFiles: ["src/startup.ts", "src/logging.ts"],
  });
});

test("normalized message text is accepted by the bundled Mermaid parser", async () => {
  const moduleName = "mermaid";
  const mermaid = (await import(moduleName)).default;
  const normalized = validateReviewFlow({
    ...flow("sequenceDiagram\n  A-->>B: returns; failures are logged"),
    affectedFiles: ["src/startup.ts"],
  }).mermaid;
  await expect(mermaid.parse(normalized)).resolves.toBeTruthy();
});
