import { expect, test } from "bun:test";
import { inspectSequenceDiagram, normalizeSequenceDiagram, validateReviewFlow } from "../src/flows.ts";

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

test("repairs reserved sequence participant IDs without changing labels, prose, or controls", async () => {
  const source = `sequenceDiagram
  participant Screen as Preview screen
  participant Box as Image box
  Screen->>Box: render Box; safely
  activate Box
  Note over Box, Screen: Box label is unchanged
  alt image box is available
    Box-->>Screen: Box rendered
  else image box is unavailable
    Box--xScreen: Box missing
  end
  deactivate Box
  destroy Box`;
  const normalized = validateReviewFlow(flow(source)).mermaid;

  expect(normalized).toBe(`sequenceDiagram
  participant Screen as Preview screen
  participant Box_participant as Image box
  Screen->>Box_participant: render Box&#59; safely
  activate Box_participant
  Note over Box_participant, Screen: Box label is unchanged
  alt image box is available
    Box_participant-->>Screen: Box rendered
  else image box is unavailable
    Box_participant--xScreen: Box missing
  end
  deactivate Box_participant
  destroy Box_participant`);

  const moduleName = "mermaid";
  const mermaid = (await import(moduleName)).default;
  await expect(mermaid.parse(normalized)).resolves.toBeTruthy();
});

test("repairs reserved sequence IDs collision-free and idempotently", () => {
  const source = `sequenceDiagram
  participant Box as Image box
  participant Box_participant as Existing image box
  participant End
  Box->>Box_participant: Box is the source
  Note right of End: End is a participant
  End-->>Box: done
  end`;
  const normalized = normalizeSequenceDiagram(source);

  expect(normalized).toBe(`sequenceDiagram
  participant Box_participant2 as Image box
  participant Box_participant as Existing image box
  participant End_participant as End
  Box_participant2->>Box_participant: Box is the source
  Note right of End_participant: End is a participant
  End_participant-->>Box_participant2: done
  end`);
  expect(normalizeSequenceDiagram(normalized)).toBe(normalized);
});

test("avoids implicit actor references when selecting a repaired participant ID", () => {
  const normalized = normalizeSequenceDiagram(`sequenceDiagram
  participant Box
  Screen->>Box_participant: render an existing image
  Box->>Screen: render the new image`);

  expect(normalized).toBe(`sequenceDiagram
  participant Box_participant2 as Box
  Screen->>Box_participant: render an existing image
  Box_participant2->>Screen: render the new image`);
});

test("repairs reserved IDs declared by create participant", async () => {
  const source = `sequenceDiagram
  participant Screen as Preview screen
  create participant Box as Image box
  Screen->>Box: create image
  Note right of Box: Image box`;
  const normalized = validateReviewFlow(flow(source)).mermaid;

  expect(normalized).toContain("create participant Box_participant as Image box");
  expect(normalized).toContain("Screen->>Box_participant: create image");
  expect(normalized).toContain("Note right of Box_participant: Image box");

  const moduleName = "mermaid";
  const mermaid = (await import(moduleName)).default;
  await expect(mermaid.parse(normalized)).resolves.toBeTruthy();
});

test("preserves an unaliased create participant's visible label", () => {
  const normalized = normalizeSequenceDiagram(`sequenceDiagram
  create participant Box
  Screen->>Box: create image`);

  expect(normalized).toContain("create participant Box_participant as Box");
  expect(normalized).toContain("Screen->>Box_participant: create image");
});
