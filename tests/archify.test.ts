import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm, symlink, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArchifyRenderer, archifyCandidates, type ArchifyCommandRunner } from "../src/archify.ts";
import type { TourOutline } from "../src/types.ts";

test("discovers bundled Archify relative to the real executable, including install symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "archify-package-test-"));
  try {
    const executable = join(root, "version", "bin", "diffcompass");
    const directory = join(root, "version", "share", "diffcompass", "archify");
    await mkdir(join(root, "version", "bin"), { recursive: true });
    await writeFile(executable, "fixture");
    expect(ArchifyRenderer.bundledDirectory(executable)).toBeUndefined();
    await mkdir(join(directory, "bin"), { recursive: true });
    await writeFile(join(directory, "bin", "archify.mjs"), "fixture");
    expect(ArchifyRenderer.bundledDirectory(executable)).toBe(await realpath(directory));
    if (process.platform !== "win32") {
      const link = join(root, "command");
      await symlink(executable, link);
      expect(ArchifyRenderer.bundledDirectory(link)).toBe(await realpath(directory));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

const outline: TourOutline = {
  title: "Checkout review",
  summary: "A changed receipt formatter calls the cart total service.",
  behaviorArchitectureStatus: "implemented",
  behaviorArchitecture: {
    title: "Checkout behaviour",
    summary: "A caller requests a receipt from the changed formatter.",
    mermaid: `flowchart LR
  caller["Checkout caller"]:::external
  receipt["Receipt formatter"]:::new
  cart["Cart totals"]:::touched
  caller -->|requests receipt| receipt
  receipt -->|calculates total| cart
  classDef new stroke:#2e7d32,stroke-width:3px
  classDef touched stroke:#f9a825,stroke-width:3px
  classDef removed stroke:#c62828,stroke-width:3px,stroke-dasharray:4 3
  classDef external stroke:#888888,stroke-dasharray:3 3`,
    dependencyChanges: ["Added Receipt formatter → Cart totals: calculates total"],
    affectedFiles: ["src/receipt.ts"],
  },
  phases: [{ id: "receipt", title: "Receipt", summary: "Build the receipt.", fileChanges: [{ path: "src/receipt.ts", summary: "Formats the receipt." }], steps: [{ id: "format", title: "Format", objective: "Format the receipt.", anchor: { path: "src/receipt.ts", side: "new", startLine: 1, endLine: 1 } }] }],
  callFlows: [{
    id: "receipt-flow", title: "Receipt call path", summary: "The formatter invokes the total service.", entrypointNodeId: "formatter", provenance: "verified", affectedFiles: ["src/receipt.ts"],
    nodes: [{ id: "formatter", label: "ReceiptFormatter", kind: "function", change: "added", newLocation: { path: "src/receipt.ts", side: "new", line: 1 } }, { id: "totals", label: "CartTotals", kind: "method", change: "modified", newLocation: { path: "src/receipt.ts", side: "new", line: 2 } }],
    edges: [{ id: "format-total", from: "formatter", to: "totals", label: "calculates total", change: "added", newCallSite: { path: "src/receipt.ts", side: "new", line: 2 } }],
  }],
  structuralBlastRadii: [{
    id: "receipt-formatter-reach",
    symbol: { id: "src/receipt.ts:new:1:ReceiptFormatter", symbol: "ReceiptFormatter", kind: "function", location: { path: "src/receipt.ts", side: "new", line: 1 } },
    provider: "repository-search", confidence: "low", provenance: "partial", summary: "Static caller reach only; not proof of runtime impact.",
    nodes: [
      { id: "src/receipt.ts:new:1:ReceiptFormatter", symbol: "ReceiptFormatter", kind: "function", location: { path: "src/receipt.ts", side: "new", line: 1 } },
      { id: "src/receipt.ts:new:2:checkout", symbol: "checkout", kind: "function", location: { path: "src/receipt.ts", side: "new", line: 2 } },
    ],
    edges: [{ id: "checkout-receipt", from: "src/receipt.ts:new:2:checkout", to: "src/receipt.ts:new:1:ReceiptFormatter", relationship: "calls" }],
    directCallerIds: ["src/receipt.ts:new:2:checkout"], reportedDirectCallerCount: 1, reportedReachableNodeCount: 1, reportedImpactedFileCount: 1,
    coverage: { state: "partial", reportedCounts: "lower-bound", omissionReason: "Repository search is bounded." },
    impactedFiles: ["src/receipt.ts"],
    testEvidence: { state: "not-assessed", checkedSources: [], relevantTests: [] },
    nearbyTestGaps: [],
  }],
  flows: [{ id: "receipt-sequence", title: "Receipt request", summary: "A caller requests a receipt and receives a result.", mermaid: "sequenceDiagram\n  participant Caller\n  participant Formatter\n  Caller->>Formatter: request receipt\n  Formatter-->>Caller: return receipt", provenance: "verified", blastRadiusSize: 1, affectedFiles: ["src/receipt.ts"] }],
  stateDiagram: { kind: "state-machine", title: "Receipt lifecycle", summary: "A receipt is prepared and completed.", mermaid: "stateDiagram-v2\n  [*] --> pending\n  pending --> complete : formatted\n  complete --> [*]", evidence: ["src/receipt.ts formats the receipt."], materiallyImprovesUnderstanding: "States make terminal handling explicit.", affectedFiles: ["src/receipt.ts"] },
  dataModel: { kind: "data-model", title: "Receipt records", summary: "Receipt records contain their line items.", mermaid: "erDiagram\n  RECEIPT {\n    string id PK\n  }\n  ITEM {\n    string receiptId FK\n  }\n  RECEIPT ||--|{ ITEM : contains", evidence: ["src/receipt.ts persists receipt records."], materiallyImprovesUnderstanding: "The relationship is material to the changed record shape.", affectedFiles: ["src/receipt.ts"] },
  findings: [],
};

test("derives bounded, typed Archify IR with component-level Before, Delta, and After states", () => {
  const candidates = archifyCandidates(outline);
  expect(candidates.map((candidate) => candidate.type)).toEqual(["architecture", "sequence", "dataflow", "lifecycle"]);
  const architecture = candidates.find((candidate) => candidate.type === "architecture")!;
  expect(architecture.ir).toMatchObject({ schema_version: 1, diagram_type: "architecture" });
  expect("baselineIr" in architecture).toBe(false);
  expect((architecture.ir.meta as { legend?: { mode?: string }; views?: unknown }).legend?.mode).toBe("hidden");
  expect((architecture.ir.meta as { views?: unknown }).views).toBeUndefined();
  expect((architecture.ir.connections as Array<{ id: string; from: string; to: string; label: string }>)[0]).toMatchObject({ from: "caller", to: "receipt", label: "requests receipt" });
  const afterComponents = architecture.ir.components as Array<{ id: string; col: number; sublabel: string }>;
  expect(afterComponents.find((component) => component.id === "receipt")?.sublabel).toBe("Added in this change");
  const before = architecture.comparison?.before as { components: Array<{ id: string; col: number }> } | undefined;
  const delta = architecture.comparison?.delta as { components: Array<{ id: string; type: string; label: string; row: number; col: number; sublabel: string }>; connections: unknown[] } | undefined;
  expect(before?.components.map((component) => component.id)).toEqual(["caller", "cart"]);
  // Existing components retain their source columns across states; the wholly
  // new formatter does not get a synthetic Before node.
  expect(before?.components.find((component) => component.id === "cart")?.col).toBe(2);
  expect(delta?.components.map(({ id, sublabel }) => ({ id, sublabel }))).toEqual([
    { id: "caller", sublabel: "Unchanged context" },
    { id: "receipt", sublabel: "+ Added" },
    { id: "cart", sublabel: "~ Changed" },
  ]);
  expect(delta?.connections).toHaveLength(2);
  expect(delta?.connections[1]).toMatchObject({ label: "+ calculates total" });
  expect(candidates.some((candidate) => candidate.type === "workflow")).toBe(false);
  const sequence = candidates.find((candidate) => candidate.type === "sequence")!;
  expect(sequence.ir).toMatchObject({ schema_version: 1, diagram_type: "sequence" });
  const messages = sequence.ir.messages as Array<{ label: string; variant?: string; y: number }>;
  expect(messages.map((message) => message.label)).toEqual(["request receipt", "return receipt"]);
  expect(messages[1]?.variant).toBe("return");
  expect(messages[1]?.y - messages[0]!.y).toBe(56);
  expect((sequence.ir.meta as { column_fit?: unknown; views?: unknown }).column_fit).toBe("spread");
  expect((sequence.ir.meta as { views?: unknown }).views).toBeUndefined();
  expect(candidates.find((candidate) => candidate.type === "dataflow")?.ir).toMatchObject({ schema_version: 1, diagram_type: "dataflow" });
  expect(candidates.some((candidate) => candidate.id.startsWith("structural-"))).toBe(false);
});

test("shows additions in Delta without manufacturing a Before component", () => {
  const addedOnly = structuredClone(outline);
  addedOnly.behaviorArchitecture!.mermaid = `flowchart LR
  receipt["Receipt formatter"]:::new
  classDef new stroke:#2e7d32,stroke-width:3px`;

  const architecture = archifyCandidates(addedOnly).find((candidate) => candidate.id === "architecture-behavior")!;
  expect((architecture.ir.components as Array<{ id: string }>).map((component) => component.id)).toEqual(["receipt"]);
  expect(architecture.comparison?.before).toBeUndefined();
  expect(architecture.comparison?.delta?.components).toMatchObject([{ id: "receipt", sublabel: "+ Added" }]);
});

test("does not flatten unsupported branches into an Archify workflow or sequence story", () => {
  const branched = structuredClone(outline);
  branched.callFlows[0]!.nodes.push({ id: "fallback", label: "Fallback", kind: "branch", change: "unchanged" });
  branched.callFlows[0]!.edges.push({ id: "fallback-edge", from: "formatter", to: "fallback", label: "on failure", change: "unchanged" });
  branched.flows[0]!.mermaid = "sequenceDiagram\n  participant Caller\n  participant Formatter\n  alt cached\n    Caller->>Formatter: request receipt\n  else fresh\n    Caller->>Formatter: request receipt\n  end";

  const candidates = archifyCandidates(branched);
  expect(candidates.some((candidate) => candidate.id === "workflow-receipt-flow")).toBe(false);
  expect(candidates.some((candidate) => candidate.id === "sequence-receipt-sequence")).toBe(false);
});

test("Delta retains removed components and relationships without leaking them into After", () => {
  const changed = structuredClone(outline);
  changed.behaviorArchitecture!.mermaid += '\n  legacy["Old formatter"]:::removed\n  caller -->|uses old formatter| legacy';
  changed.behaviorArchitecture!.dependencyChanges.push("Removed Checkout caller → Old formatter: uses old formatter");
  const candidate = archifyCandidates(changed).find((entry) => entry.id === "architecture-behavior")!;
  const components = (document: Record<string, unknown> | undefined) => document?.components as Array<{ id: string; sublabel: string }>;
  expect(components(candidate.comparison?.before).some((node) => node.id === "legacy")).toBe(true);
  expect(components(candidate.comparison?.delta).find((node) => node.id === "legacy")?.sublabel).toBe("− Removed");
  expect(components(candidate.ir).some((node) => node.id === "legacy")).toBe(false);
  expect(candidate.comparison?.delta?.connections).toEqual(expect.arrayContaining([expect.objectContaining({ to: "legacy", label: "− uses old formatter" })]));
  expect(candidate.ir.connections).not.toEqual(expect.arrayContaining([expect.objectContaining({ to: "legacy" })]));
});

test("uses the supported compact spread layout for meaningful sequence labels and leaves over-wide timelines native", () => {
  const labelled = structuredClone(outline);
  labelled.flows[0]!.mermaid = "sequenceDiagram\n  participant UI as Checkout UI\n  participant R as Receipt formatter\n  participant C as Cart totals\n  UI->>R: receipt(items, discount)\n  R->>C: total(items, discount)\n  C-->>R: discounted amount\n  R-->>UI: formatted total";
  const sequence = archifyCandidates(labelled).find((candidate) => candidate.id === "sequence-receipt-sequence");
  expect(sequence?.ir.meta).toMatchObject({ column_fit: "spread" });
  expect((sequence?.ir.participants as Array<{ label: string }>).map((participant) => participant.label)).toEqual(["Checkout UI", "Receipt formatter", "Cart totals"]);

  labelled.flows[0]!.mermaid = "sequenceDiagram\n  participant A as A participant label that is intentionally too long for a compact map\n  participant B\n  A->>B: request";
  expect(archifyCandidates(labelled).some((candidate) => candidate.id === "sequence-receipt-sequence")).toBe(false);
});

test("keeps authored relationship identities stable when unrelated components are reordered", () => {
  const reordered = structuredClone(outline);
  reordered.behaviorArchitecture!.mermaid = `flowchart LR
  cart["Cart totals"]:::touched
  caller["Checkout caller"]:::external
  receipt["Receipt formatter"]:::new
  caller -->|requests receipt| receipt
  receipt -->|calculates total| cart
  classDef new stroke:#2e7d32,stroke-width:3px
  classDef touched stroke:#f9a825,stroke-width:3px
  classDef removed stroke:#c62828,stroke-width:3px,stroke-dasharray:4 3
  classDef external stroke:#888888,stroke-dasharray:3 3`;

  const original = archifyCandidates(outline).find((candidate) => candidate.id === "architecture-behavior")!;
  const candidate = archifyCandidates(reordered).find((item) => item.id === "architecture-behavior")!;
  const edgeId = (document: typeof original.ir, from: string, to: string) => (document.connections as Array<{ from: string; to: string; id: string }>).find((edge) => edge.from === from && edge.to === to)?.id;
  expect(edgeId(candidate.ir, "caller", "receipt")).toBe(edgeId(original.ir, "caller", "receipt"));
  expect(edgeId(candidate.ir, "receipt", "cart")).toBe(edgeId(original.ir, "receipt", "cart"));
});

test("keeps a last validated Archify artifact if regenerated delivery fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "archify-renderer-test-"));
  await mkdir(join(root, "bin"));
  await writeFile(join(root, "bin", "archify.mjs"), "// fixture\n");
  let fail = false;
  const runner: ArchifyCommandRunner = async (command, _cwd, env) => {
    expect(command[0]).toBe(process.execPath);
    expect(env.BUN_BE_BUN).toBe("1");
    if (fail && command.includes("deliver")) throw new Error("layout/collision: candidate rejected");
    const output = command.find((part) => part.endsWith("artifact.html"));
    if (output) await writeFile(output, "<!doctype html><title>validated</title><script>window.ready=true</script>");
    return { stdout: '{"ok":true}', stderr: "" };
  };
  const renderer = new ArchifyRenderer(root, { runner, now: () => new Date("2026-09-18T12:00:00.000Z") });
  const initial = await renderer.render(outline);
  expect(initial.failures).toEqual([]);
  expect(initial.artifacts).toHaveLength(4);
  expect(initial.artifacts[0]?.html).toContain("validated");
  expect(initial.artifacts[0]?.comparison?.before?.html).toContain("validated");
  expect(initial.artifacts[0]?.comparison?.delta?.html).toContain("validated");

  fail = true;
  const retried = await renderer.render(outline, initial.artifacts);
  expect(retried.artifacts.map((artifact) => artifact.id)).toEqual(initial.artifacts.map((artifact) => artifact.id));
  expect(retried.failures).toHaveLength(4);
  expect(retried.failures.every((failure) => failure.preservedLastValid)).toBe(true);
  expect(retried.failures.every((failure) => failure.message.includes("could not be prepared") && !failure.message.includes("candidate.json"))).toBe(true);
});

test("renders generated IR through an explicitly supplied official Archify checkout", async () => {
  const directory = process.env.ARCHIFY_OFFICIAL_DIR;
  if (!directory) return;
  const rendered = await new ArchifyRenderer(directory).render(outline);
  expect(rendered.failures).toEqual([]);
  expect(rendered.artifacts).toHaveLength(4);
  expect(rendered.artifacts.every((artifact) => artifact.html.includes("<html"))).toBe(true);
  const architecture = rendered.artifacts.find((artifact) => artifact.id === "architecture-behavior");
  expect(architecture?.comparison?.before?.html).toContain("<html");
  expect(architecture?.comparison?.delta?.html).toContain("<html");
}, 30_000);

const lifecycleCases = [
  { name: "branching retry and three cancellation exits", body: `[*] --> Pending
Pending --> Formatting : start
Pending --> Cancelled : cancel
Formatting --> Ready : succeed
Formatting --> Failed : fail
Formatting --> Cancelled : cancel
Failed --> Formatting : retry
Failed --> Cancelled : cancel
Ready --> [*]
Cancelled --> [*]` },
  { name: "more than five states", body: `[*] --> A
A --> B : first
B --> C : second
C --> D : third
D --> E : fourth
E --> F : fifth
F --> G : sixth
G --> H : seventh
H --> [*]` },
  { name: "reconverging branches", body: `[*] --> Open
Open --> Left : choose left
Open --> Right : choose right
Left --> Joined : finish left
Right --> Joined : finish right
Joined --> [*]` },
  { name: "self loops, parallel events and multiple starts", body: `[*] --> Idle
[*] --> Busy
Idle --> Idle : wait
Idle --> Busy : start
Idle --> Busy : resume
Busy --> Idle : pause
Busy --> Done : finish
Done --> [*]` },
  { name: "wide names and event labels", body: `[*] --> AwaitingReceiptFormatting
AwaitingReceiptFormatting --> ProcessingReceiptRequest : start formatting receipt
ProcessingReceiptRequest --> ReceiptFormattingCompleted : finish receipt formatting
ReceiptFormattingCompleted --> [*]` },
  { name: "more terminal states than outcome columns", body: `[*] --> Working
Working --> A : first
Working --> B : second
Working --> C : third
Working --> D : fourth
A --> [*]
B --> [*]
C --> [*]
D --> [*]` },
];
function lifecycleOutline(body: string): TourOutline {
  return { ...structuredClone(outline), behaviorArchitecture: undefined, architecture: undefined, domainModels: [], flows: [], dataModel: undefined, stateDiagram: { ...outline.stateDiagram!, mermaid: `stateDiagram-v2\n${body}` } };
}

// Run the same collision gates used by production when a local renderer is
// explicitly supplied. No checkout, download or weakened quality profile.
const lifecycleDirectory = process.env.ARCHIFY_OFFICIAL_DIR ?? process.env.DIFFCOMPASS_ARCHIFY_DIR;
for (const example of lifecycleCases) test.skipIf(!lifecycleDirectory)(`validates lifecycle geometry: ${example.name}`, async () => {
  const input = lifecycleOutline(example.body);
  const original = structuredClone(input);
  const result = await new ArchifyRenderer(lifecycleDirectory!).render(input, []);
  expect(result.failures).toEqual([]);
  expect(result.artifacts).toHaveLength(1);
  const artifact = result.artifacts[0]!;
  const states = artifact.ir.states as Array<{id: string; label: string; sublabel?: string; type: string}>;
  const transitions = artifact.ir.transitions as Array<{from: string; to: string; label?: string}>;
  const arrows = example.body.split("\n").map(line => /^(\[\*\]|\w+) --> (\[\*\]|\w+)(?: : (.+))?$/.exec(line)!);
  expect(transitions.map(edge => [edge.from, edge.to, edge.label])).toEqual(arrows.filter(a => a[1] !== "[*]" && a[2] !== "[*]").map(a => [a[1], a[2], a[3]]));
  expect(states.map(state => state.id).sort()).toEqual([...new Set(arrows.flatMap(a => [a[1]!, a[2]!]).filter(id => id !== "[*]"))].sort());
  expect(states.filter(state => state.sublabel?.includes("Initial state")).map(state => state.id).sort()).toEqual(arrows.filter(a => a[1] === "[*]").map(a => a[2]).sort());
  expect(states.filter(state => state.sublabel?.includes("Terminal exit")).map(state => state.id).sort()).toEqual(arrows.filter(a => a[2] === "[*]").map(a => a[1]).sort());
  expect(states.some(state => state.type === "success")).toBe(false);
  expect(artifact.html).toContain("data-composition-points");
  const receipt = JSON.parse(artifact.validationReceipt.split("\n\n")[0]!);
  expect(receipt.ok).toBe(true);
  expect(receipt.composition.summary.errors).toBe(0);
  if (example === lifecycleCases[0]) expect(receipt.composition.summary.warnings).toBe(0);
  expect(input).toEqual(original);
}, 30_000);

test("retains lifecycle boundaries regardless of arrow order and keeps richer boundary semantics native", () => {
  const input = lifecycleOutline("Done --> [*]\nActive --> Done : finish\n[*] --> Active\nActive --> Active : wait");
  const candidate = archifyCandidates(input).find(item => item.type === "lifecycle")!;
  expect(candidate.ir.states).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "Active", initial: true, terminal: false }),
    expect.objectContaining({ id: "Done", initial: false, terminal: true }),
  ]));
  for (const body of ["[*] --> A : begin\nA --> B", "[*] --> A\nA --> B\nB --> [*] : finish", "[*] --> A\nA --> B\nB --> [*]\nB --> A : again"]) {
    const native = lifecycleOutline(body);
    expect(archifyCandidates(native).some(item => item.type === "lifecycle")).toBe(false);
    expect(native.stateDiagram!.mermaid).toBe(`stateDiagram-v2\n${body}`);
  }
});

test("lifecycle layout failure retains the native graph and the previous validated artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "archify-lifecycle-failure-"));
  try {
    await mkdir(join(root, "bin"));
    await writeFile(join(root, "bin", "archify.mjs"), "// fixture\n");
    let calls = 0;
    const runner: ArchifyCommandRunner = async command => {
      calls++;
      const output = command.find(part => part.endsWith("artifact.html"));
      if (output) await writeFile(output, "<!doctype html><html>validated</html>");
      return { stdout: '{"ok":true}', stderr: "" };
    };
    const renderer = new ArchifyRenderer(root, {runner});
    const initial = await renderer.render(lifecycleOutline(lifecycleCases[0]!.body), []);
    expect(initial.failures).toEqual([]);
    const wide = "A".repeat(100);
    const input = lifecycleOutline(`[*] --> ${wide}\n${wide} --> Done : finish\nDone --> [*]`);
    const original = structuredClone(input.stateDiagram);
    calls = 0;
    const failed = await renderer.render(input, initial.artifacts);
    expect(failed.artifacts).toEqual(initial.artifacts);
    expect(failed.failures).toEqual([expect.objectContaining({id:"lifecycle-state-machine",preservedLastValid:true})]);
    expect(calls).toBe(0);
    expect(input.stateDiagram).toEqual(original);
  } finally { await rm(root, { recursive: true, force: true }); }
});
