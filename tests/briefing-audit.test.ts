import { expect, test } from "bun:test";
import { TourAgent } from "../src/agent.ts";
import { BriefingAuditValidationError, parseBriefingAudit } from "../src/briefing-audit.ts";
import type { BriefingDocument, BriefingProposal } from "../src/briefing.ts";
import { DEFAULT_REVIEW_POLICY } from "../src/config.ts";
import type { GitComparison, ReviewFlow, TourOutline } from "../src/types.ts";

const comparison = {
  repositoryRoot: "/tmp/briefing-audit", repositoryName: "audit", patch: "+const rows = await repository.fetch();\n+return summarize(rows);",
  base: "main", mergeBase: "captured-base", head: "captured-head", sourceTree: "captured-tree", repositoryFiles: ["summary.ts"],
  files: [{ path: "summary.ts", oldPath: "summary.ts", hunks: [{ rows: [
    { kind: "addition", newLine: 1, oldLine: null, content: "const rows = await repository.fetch();" },
    { kind: "addition", newLine: 2, oldLine: null, content: "return summarize(rows);" },
  ] }] }],
} as GitComparison;
const anchor = (line: number) => ({ path: "summary.ts", side: "new" as const, startLine: line, endLine: line, quote: comparison.files[0]!.hunks[0]!.rows[line - 1]!.content });
const incomplete: ReviewFlow = {
  id: "summary", title: "Return a summary of fetched rows", summary: "A successful fetch supplies the summary.", provenance: "partial", affectedFiles: ["summary.ts"], blastRadiusSize: 1,
  mermaid: "sequenceDiagram\n participant C as Caller\n participant S as Summary\n participant R as Repository\n C->>S: Request summary\n S->>R: Fetch rows\n S-->>C: Return summary",
};
const repaired: ReviewFlow = {
  ...incomplete,
  mermaid: incomplete.mermaid.replace(" S-->>C: Return summary", " R-->>S: Return rows\n S->>S: Summarize rows\n S-->>C: Return summary"),
  messageSources: [
    { message: 2, label: "Fetch rows", anchors: [anchor(1)] },
    { message: 3, label: "Return rows", anchors: [anchor(1)] },
    { message: 4, label: "Summarize rows", anchors: [anchor(2)] },
    { message: 5, label: "Return summary", anchors: [anchor(2)] },
  ],
};
const proposal: BriefingProposal = {
  title: incomplete.title,
  sections: [{ id: "summary", title: "Fetch, then summarize", blocks: [
    { id: "explanation", kind: "prose", text: "The successful fetch supplies rows used to calculate the summary.", basis: "observed" },
    { id: "sequence", kind: "diagram", diagramId: "sequence-summary" },
  ] }],
};
const revisedDecision = { flowId: "summary", disposition: "revised", reason: "summary.ts:1 returns rows consumed by summarize at line 2.", flow: repaired };
const audit = (decisions: unknown[] = [revisedDecision], briefingProposal: BriefingProposal = proposal) => JSON.stringify({ decisions, briefingProposal });
const outline = (): TourOutline => ({
  title: proposal.title, summary: "Fetch rows and calculate a summary.", flows: [incomplete], callFlows: [], findings: [],
  structuralBlastRadii: [], structuralAnalysisOmissionReason: "No declarations in this fixture.", briefingProposal: proposal,
  phases: [{ id: "summary", title: "Summarize fetched rows", summary: "The fetched rows supply the calculation.", fileChanges: [{ path: "summary.ts", summary: "Calculates a summary from fetched rows." }],
    steps: [{ id: "fetch", title: "Fetch rows", objective: "Fetched rows feed the summary.", anchor: { path: "summary.ts", side: "new", startLine: 1, endLine: 2 } }] }],
});
const selection = { adapterId: "attached" as const, modelId: "current-session", includeArchitecture: false, includeFindings: false, includeAdaptiveDiagrams: false, includeDryRuns: false };

test("a review repairs the missing result and calculation while retaining unrelated flows", () => {
  const other = { ...incomplete, id: "other" };
  const result = parseBriefingAudit(audit(), proposal, [incomplete, other], comparison);
  expect(result.flows[0]!.mermaid).toBe(repaired.mermaid);
  expect(result.flows[0]!.messageSources).toEqual(repaired.messageSources);
  expect(result.flows[1]).toBe(other);
  expect(incomplete.mermaid).not.toContain("Return rows");
});

test("review decisions cannot skip sequences, introduce diagrams, or hide invalid bindings", () => {
  const invalid = [
    audit([]),
    audit([{ ...revisedDecision, flowId: "unknown" }]),
    audit([revisedDecision, revisedDecision]),
    audit([{ ...revisedDecision, reason: " " }]),
    audit([{ ...revisedDecision, disposition: "kept" }]),
    audit([{ ...revisedDecision, flow: { ...repaired, id: "replacement-id" } }]),
    audit([{ ...revisedDecision, flow: { ...repaired, messageSources: [{ message: 3, label: "Return rows", anchors: [{ ...anchor(1), quote: "invented();" }] }] } }]),
    audit([{ ...revisedDecision, flow: { ...repaired, messageSources: [{ message: 2, label: "Return rows", anchors: [anchor(1)] }] } }]),
    audit(undefined, { ...proposal, sections: [{ id: "s", title: "Other", blocks: [{ id: "b", kind: "diagram", diagramId: "sequence-other" }] }] }),
    audit(undefined, { ...proposal, diagramSources: [{ diagramId: "sequence-summary", elementId: "obsolete", anchors: [anchor(1)] }] }),
  ];
  for (const response of invalid) expect(() => parseBriefingAudit(response, proposal, [incomplete], comparison)).toThrow(BriefingAuditValidationError);
});

test("unsupported sequences must be removed from both the flow set and the story", () => {
  const decision = { flowId: "summary", disposition: "omitted", reason: "The source of the result cannot be established." };
  expect(() => parseBriefingAudit(audit([decision]), proposal, [incomplete], comparison)).toThrow("omitted or unreviewed");
  const proseOnly: BriefingProposal = { ...proposal, sections: [{ ...proposal.sections[0]!, blocks: [proposal.sections[0]!.blocks[0]!] }] };
  const result = parseBriefingAudit(audit([decision], proseOnly), proposal, [incomplete], comparison);
  expect(result.flows).toEqual([]);
  expect(result.proposal).toEqual(proseOnly);
});

test("an event-only sequence can be kept without manufacturing a return", () => {
  const event = { ...incomplete, mermaid: "sequenceDiagram\n participant P as Publisher\n participant S as Subscriber\n P-)S: Publish update" };
  const result = parseBriefingAudit(audit([{ flowId: "summary", disposition: "kept", reason: "The scoped scenario ends with event delivery; no response is consumed." }]), proposal, [event], comparison);
  expect(result.flows[0]).toBe(event);
});

test("initial briefing generation waits for a separate review and repairs invalid review evidence", async () => {
  const prompts: string[] = [];
  const agent = new TourAgent(comparison.repositoryRoot, selection, { async send(prompt) {
    prompts.push(prompt);
    if (prompts.length === 1) return { message: JSON.stringify(outline()), receipt: "generation" };
    if (prompts.length === 2) return audit([{ ...revisedDecision, flow: { ...repaired, messageSources: [{ message: 3, label: "Return rows", anchors: [{ ...anchor(1), quote: "wrong" }] }] } }]);
    return { message: audit(), receipt: "review" };
  } });
  const result = await agent.createOutline(comparison, DEFAULT_REVIEW_POLICY);
  expect(prompts).toHaveLength(3);
  expect(prompts[1]).toContain("reviewing the causal completeness");
  expect(prompts[1]).toContain("captured-tree");
  expect(prompts[2]).toContain("source quote does not match summary.ts:1");
  expect(result.value.flows[0]!.mermaid).toBe(repaired.mermaid);
  expect(result.receipts).toEqual(["generation", "review"]);
});

test("Briefing regeneration reviews sequences without changing the tour's flows", async () => {
  const original = outline(), prompts: string[] = [];
  const agent = new TourAgent(comparison.repositoryRoot, selection, { async send(prompt) {
    prompts.push(prompt);
    return prompts.length === 1 ? JSON.stringify(proposal) : audit();
  } });
  const result = await agent.regenerateBriefing(comparison, original, { diagrams: [] } as unknown as BriefingDocument, "");
  expect(prompts).toHaveLength(2);
  expect(result.value.flows[0]!.mermaid).toBe(repaired.mermaid);
  expect(original.flows[0]!.mermaid).toBe(incomplete.mermaid);
});

test("a failed review does not return the unchecked briefing after retries", async () => {
  let requests = 0;
  const agent = new TourAgent(comparison.repositoryRoot, selection, { async send() {
    return ++requests === 1 ? JSON.stringify(outline()) : audit([]);
  } });
  await expect(agent.createOutline(comparison, DEFAULT_REVIEW_POLICY)).rejects.toThrow(BriefingAuditValidationError);
  expect(requests).toBe(4);
});
