import { buildBriefing, validBriefingDocument, type BriefingDocument, type BriefingProposal, type NarrativeBlock, type NarrativeSection } from "../../src/briefing.ts";
import { validateReviewArchitecture } from "../../src/architecture.ts";
import { loadCapturedSource } from "../../src/diff-sources.ts";
import { loadComparisonBetweenTrees } from "../../src/git.ts";
import type { GitComparison, SequenceSourceAnchor, TourOutline } from "../../src/types.ts";

export const approaches = [
  { id: "linear", label: "Current approach", description: "Read the implementation in a deliberate order.", question: "Can you explain what changed after one pass?" },
  { id: "outcome", label: "Outcome first", description: "Start with the human need, then earn the explanation with code.", question: "Is the purpose clear before the implementation gets detailed?" },
  { id: "trace", label: "Follow a scenario", description: "Trace one request through the system, including what can go wrong.", question: "Can you predict what happens when the happy path breaks?" },
  { id: "decisions", label: "Design decisions", description: "Explore the boundaries, guarantees, and costs of the design.", question: "Could you explain why these pieces belong together?" },
] as const;
export type Approach = typeof approaches[number]["id"];
export interface Scenario { id: string; label: string; summary: string; steps: Array<{ label: string; value: string; evidenceId: string }>; outcome: string }
export interface ReadingCase {
  id: string; title: string; description: string; base: string; head: string; files: number;
  documents: Record<Approach, BriefingDocument>; scenarios: Scenario[];
}
type Evidence = SequenceSourceAnchor & { id: string };
const p = (id: string, text: string, basis: "observed" | "stated" | "inferred" = "observed"): NarrativeBlock => ({ id, kind: "prose", text, basis });
const code = (id: string, evidenceId: string): NarrativeBlock => ({ id, kind: "source", evidenceId });
const diagram = (id: string, diagramId = "architecture-journey"): NarrativeBlock => ({ id, kind: "diagram", diagramId });
const example = (id: string, text: string): NarrativeBlock => ({ id, kind: "example", text });
const section = (id: string, title: string, ...blocks: NarrativeBlock[]): NarrativeSection => ({ id, title, blocks });
const changeClasses = '\nclassDef new stroke:#2e7d32,stroke-width:3px\nclassDef touched stroke:#f9a825,stroke-width:3px\nclassDef removed stroke:#c62828,stroke-width:3px,stroke-dasharray:4 3\nclassDef external stroke:#888888,stroke-dasharray:3 3';

async function comparison(repository: string, base: string, head: string) {
  return loadComparisonBetweenTrees(repository, { base, mergeBase: base, head, sourceTree: head, repositoryName: "diffcompass", branch: head.slice(0, 7) });
}
async function excerpt(comparison: GitComparison, id: string, path: string, startLine: number, endLine: number, side: "old" | "new" = "new"): Promise<Evidence> {
  const source = await loadCapturedSource(comparison, side, path);
  return { id, path, side, startLine, endLine, quote: source.text.split(/\r?\n/).slice(startLine - 1, endLine).join("\n") };
}
function outline(title: string): TourOutline { return { title, summary: title, phases: [], callFlows: [], flows: [], findings: [] }; }
async function documents(comparison: GitComparison, source: TourOutline, evidence: Evidence[], stories: Record<Approach, { title: string; sections: NarrativeSection[] }>): Promise<Record<Approach, BriefingDocument>> {
  if (source.architecture) source.architecture = validateReviewArchitecture(source.architecture);
  const entries = [];
  for (const [approach, story] of Object.entries(stories)) {
    const prefix = `${comparison.head.slice(0, 7)}-${approach}`;
    const proposal: BriefingProposal = { ...story, evidence, sections: story.sections.map(s => ({ ...s, id: `${prefix}-section-${s.id}`, blocks: s.blocks.map(b => ({ ...b, id: `${prefix}-block-${b.id}` })) })) };
    const document = await buildBriefing(comparison, source, JSON.stringify({ source: "Pinned repository history", head: comparison.head }), proposal);
    // Authored experiments must fail visibly if a historical citation drifts.
    if (document.mode !== "authored" || !validBriefingDocument(document) || document.evidence.some(e => !e.available)) throw new Error(`Invalid captured evidence for ${comparison.head} / ${approach}`);
    for (const block of proposal.sections.flatMap(s => s.blocks)) {
      if (block.kind !== "diagram") continue;
      const rendered = document.diagrams.find(d => d.id === block.diagramId);
      if (!rendered || rendered.elements.some(e => !e.evidenceIds.length)) throw new Error(`Missing diagram or element evidence for ${block.diagramId} / ${approach}`);
    }
    entries.push([approach, document]);
  }
  return Object.fromEntries(entries) as Record<Approach, BriefingDocument>;
}

async function publication(repository: string): Promise<ReadingCase> {
  const base = "57bf907396a585496b565ab0fed65db1013f72be", head = "27b7e445048b9f64db797602159c8c49c74f8d8e";
  const captured = await comparison(repository, base, head);
  const evidence = await Promise.all([
    excerpt(captured, "contract", "README.md", 461, 472),
    excerpt(captured, "queue", "src/session.ts", 458, 468),
    excerpt(captured, "selection", "src/session.ts", 2584, 2591),
    excerpt(captured, "intent", "src/session.ts", 2592, 2604),
    excerpt(captured, "head", "src/github.ts", 387, 393),
    excerpt(captured, "retry", "src/github.ts", 394, 407),
    excerpt(captured, "neutral", "src/github.ts", 408, 417),
    excerpt(captured, "review-event", "src/github.ts", 408, 411),
    excerpt(captured, "receipt", "src/github.ts", 417, 419),
    excerpt(captured, "before", "src/github.ts", 400, 403, "old"),
    excerpt(captured, "recovery-test", "tests/github-suggestions.test.ts", 306, 320),
  ]);
  const e = (id: string) => evidence.find(e => e.id === id)!;
  const source = outline("Publish suggestions while keeping the review open");
  source.architecture = {
    title: "A local draft becomes a durable intent before it reaches GitHub",
    summary: "The session owns selection and persistence; the provider owns the final head check and external review.",
    mermaid: 'flowchart LR\n draft["Local suggestions"]:::touched\n session["Review session"]:::touched\n store["Session storage"]:::touched\n github["GitHub review"]:::external\n draft -->|confirm selection| session\n session -->|save intent and receipt| store\n session -->|publish selected batch| github' + changeClasses,
    affectedFiles: ["src/session.ts", "src/github.ts"], dependencyChanges: [],
    elementSources: [
      { elementId: "draft", anchors: [e("queue")] }, { elementId: "session", anchors: [e("selection")] }, { elementId: "store", anchors: [e("intent")] }, { elementId: "github", anchors: [e("neutral")] },
      // Exact relationship IDs from the production renderer IR for this map.
      { elementId: "architecture-draft-confirm-selection-sessi-15f5o6n", anchors: [e("selection")] },
      { elementId: "architecture-session-save-intent-and-recei-13v1l7b", anchors: [e("intent")] },
      { elementId: "architecture-session-publish-selected-batc-1hdvsrp", anchors: [e("neutral")] },
    ],
  };
  source.flows = [{
    id: "publication", title: "Normal publication: persist, verify, send, record", summary: "The local intent is saved before the network operation.", provenance: "verified", blastRadiusSize: 2, affectedFiles: ["src/session.ts", "src/github.ts"],
    mermaid: 'sequenceDiagram\n participant S as Review session\n participant D as Session storage\n participant G as GitHub\n S->>D: Save pending intent\n S->>G: Check current PR head\n S->>G: Search reviews for intent marker\n S->>G: Create COMMENT review if absent\n G-->>S: Review identifier\n S->>D: Save publication receipt',
    messageSources: [
      { message: 1, label: "Save pending intent", anchors: [e("intent")] },
      { message: 2, label: "Check current PR head", anchors: [e("head")] },
      { message: 3, label: "Search reviews for intent marker", anchors: [e("retry")] },
      { message: 4, label: "Create COMMENT review if absent", anchors: [e("neutral")] },
      { message: 5, label: "Review identifier", anchors: [e("receipt")] },
      { message: 6, label: "Save publication receipt", anchors: [e("intent")] },
    ],
  }];
  const need = "A reviewer should be able to send proposed replacements to the PR author while keeping the review open. The documented contract adds a neutral COMMENT review: only selected queued suggestions are submitted, and ordinary comments stay drafted.";
  const guarantee = "Publishing is separate from applying a replacement locally and from approving or requesting changes. The author receives suggestions that GitHub can apply; this operation does not edit, commit, or push the reviewed source.";
  const recovery = "A timeout does not tell the client whether GitHub accepted the review. The saved intent ID becomes a marker in the remote review body. Retrying searches every page for that marker and returns the earlier receipt when it finds one.";
  const limits = "The same pending selection must be retried; a different batch is rejected until that attempt is resolved. A changed PR head also stops publication. Marker reconciliation handles the lost-response path shown here; it is not a server-enforced exactly-once guarantee for arbitrary concurrent clients.";
  const stories: Record<Approach, { title: string; sections: NarrativeSection[] }> = {
    linear: { title: "From local suggestion to GitHub review", sections: [
      section("draft", "Queue the replacement", p("need", need, "stated"), p("queue-text", "Queueing captures the replacement, selected range, and PR head in a local comment. It persists that draft before returning control."), code("queue-code", "queue")),
      section("publish", "Separate the draft from publication", p("boundary", guarantee, "stated"), diagram("architecture"), p("intent-text", "The session validates the selected batch, saves a pending publication intent, calls GitHub, and then saves the receipt."), code("intent-code", "intent")),
      section("recover", "Recover an uncertain result", p("retry-text", recovery), code("retry-code", "retry"), p("limits", limits)),
    ] },
    outcome: { title: "Send useful feedback without ending the review", sections: [
      section("promise", "The outcome the reviewer needs", p("promise", need, "stated"), p("promise-boundary", guarantee, "stated"), p("old-context", "Previously, this publication path selected APPROVE or REQUEST_CHANGES. The new branch adds COMMENT without changing those two decisions:"), code("before-code", "before"), code("neutral-code", "review-event")),
      section("system", "Three responsibilities make that possible", p("system-text", "The draft remembers what was proposed. The session freezes the chosen batch and persists its intent. The GitHub boundary checks the current head and submits the review. Storage connects those responsibilities across a retry."), diagram("architecture"), code("intent-code", "intent")),
      section("uncertainty", "The outcome must survive a lost response", p("uncertain-text", recovery), code("retry-code", "retry"), p("proof-text", "The regression below models GitHub accepting the request and the response being lost. A resumed session recovers the review beyond the first hundred entries, with only one POST recorded by the test."), code("test-code", "recovery-test")),
      section("boundary", "Where the promise stops", p("limits", limits)),
    ] },
    trace: { title: "Follow a suggestion across the network boundary", sections: [
      section("confirm", "1. Freeze what the reviewer confirmed", p("need", need, "stated"), p("selection-text", "The confirmed comment IDs must still match the queued selection. This catches a changed batch before an external review is sent."), code("selection-code", "selection")),
      section("save", "2. Leave a recovery point before sending", p("intent-text", "The session reuses a pending intent or creates one, saves it locally, and only then invokes publication. The receipt is saved after GitHub returns."), code("intent-code", "intent"), p("sequence-text", "A normal attempt crosses the storage boundary before the network boundary. The order is the important part of this flow:"), diagram("sequence", "sequence-publication")),
      section("send", "3. Recheck the destination and send a neutral review", p("head-text", "Confirmation is not the last check: the provider reloads the PR and compares its head. When the source still matches and the marker is absent, it sends COMMENT with the saved commit ID."), code("head-code", "head"), code("neutral-code", "neutral")),
      section("retry", "4. A lost response takes a different route", p("recovery", recovery), code("retry-code", "retry"), p("proof", "The saved regression test exercises this recovery after a session restart, including a matching review beyond the first page."), code("test-code", "recovery-test"), p("limits", limits)),
    ] },
    decisions: { title: "Three boundaries behind reliable suggestion publication", sections: [
      section("meaning", "Should sending suggestions also decide the review?", p("need", need, "stated"), code("neutral-code", "review-event"), p("meaning", "The COMMENT branch makes publication and the review decision independent operations. The existing approval and change-request paths remain available."), p("meaning-cost", "This separation gives reviewers finer control, but it also requires the UI to distinguish a published suggestion batch from a completed review.", "inferred")),
      section("ownership", "What must be saved before crossing the network?", p("ownership", "Persist the exact batch and its intent before attempting the external write. The local store can then distinguish an unstarted batch from an attempt whose outcome is uncertain."), diagram("architecture"), code("intent-code", "intent"), p("tradeoff", "A durable intent adds state and recovery work. That cost buys a stable identity for retrying the same operation after a restart.", "inferred")),
      section("identity", "What makes a retry the same operation?", p("recovery", recovery), code("retry-code", "retry"), p("constraint", "Selection identity and source identity matter alongside the marker. The session rejects a changed batch; the provider rejects a changed PR head."), code("head-code", "head"), p("limits", limits)),
    ] },
  };
  return { id: "publication", title: "GitHub suggestions", description: "Draft selection, durable intent, an external write, and recovery after uncertainty.", base, head, files: captured.files.length, documents: await documents(captured, source, evidence, stories), scenarios: [
    { id: "normal", label: "Normal send", summary: "The confirmed source and selection still match, and GitHub has no review with this intent marker.", steps: [{ label: "Persist", value: "Pending intent saved", evidenceId: "intent" }, { label: "Send", value: "COMMENT review created", evidenceId: "neutral" }, { label: "Record", value: "Receipt saved locally", evidenceId: "intent" }], outcome: "The suggestions are published. The local review remains open." },
    { id: "lost", label: "Response lost", summary: "GitHub accepted the first POST, but the client did not receive its response. The session resumes with the same pending intent.", steps: [{ label: "Resume", value: "Reuse the intent ID", evidenceId: "intent" }, { label: "Find", value: "Search all review pages", evidenceId: "retry" }, { label: "Recover", value: "Return the existing receipt", evidenceId: "recovery-test" }], outcome: "The tested retry recovers the first review instead of sending another POST." },
    { id: "head", label: "PR changed", summary: "The reviewer confirmed one commit, but the provider loads a newer head before publication.", steps: [{ label: "Load", value: "Read the current PR", evidenceId: "head" }, { label: "Compare", value: "Head IDs differ", evidenceId: "head" }, { label: "Stop", value: "Require a refresh", evidenceId: "head" }], outcome: "This attempt sends no review against the changed head." },
  ] };
}

async function checkpoints(repository: string): Promise<ReadingCase> {
  const base = "8f84166b380a648c14682b818867f377ab0c97b0", head = "740badad9fa7801952e4d91fe0ce5bbb21d975bd";
  const captured = await comparison(repository, base, head);
  const evidence = await Promise.all([
    excerpt(captured, "capture", "src/session.ts", 507, 519),
    excerpt(captured, "retain", "src/git.ts", 55, 61),
    excerpt(captured, "compare", "src/session.ts", 390, 406),
    excerpt(captured, "baselines", "src/session.ts", 418, 438),
    excerpt(captured, "classify", "src/revision.ts", 9, 17),
    excerpt(captured, "reviewed", "src/session.ts", 441, 447),
    excerpt(captured, "stale", "src/session.ts", 448, 463),
    excerpt(captured, "test", "tests/revision-aware.test.ts", 72, 85),
  ]);
  const e = (id: string) => evidence.find(e => e.id === id)!;
  const source = outline("Re-review the revision without losing earlier work");
  source.architecture = {
    title: "Two comparisons answer two different review questions",
    summary: "The full change compares base to current; the review delta compares checkpoint to current.",
    mermaid: 'flowchart LR\n base["Original base"]:::external\n current["Current source"]:::external\n saved["Reviewed checkpoint"]:::new\n base -->|full change| current\n base -->|earlier full change| saved\n saved -->|since last review| current' + changeClasses,
    dependencyChanges: [], affectedFiles: ["src/session.ts", "src/revision.ts", "src/git.ts"],
    elementSources: [
      { elementId: "base", anchors: [e("capture")] }, { elementId: "saved", anchors: [e("capture"), e("retain")] }, { elementId: "current", anchors: [e("compare"), e("reviewed")] },
      { elementId: "architecture-base-full-change-current-0-3vdig9", anchors: [e("compare")] },
      { elementId: "architecture-base-earlier-full-change-save-9s6cb3", anchors: [e("baselines")] },
      { elementId: "architecture-saved-since-last-review-curre-19gz86a", anchors: [e("baselines")] },
    ],
  };
  source.flows = [{ id: "revision", title: "Refresh derives new review state from a saved tree", summary: "Captured source determines the delta and retained review state.", provenance: "verified", blastRadiusSize: 3, affectedFiles: ["src/session.ts", "src/revision.ts", "src/git.ts"],
    mermaid: 'sequenceDiagram\n participant R as Review session\n participant G as Git trees\n participant V as Review state\n R->>G: Save checkpoint tree reference\n R->>G: Compare checkpoint with current source\n G-->>R: Paths changed since checkpoint\n R->>V: Retain unchanged reviewed paths\n R->>V: Mark affected explanations outdated',
    messageSources: [{ message: 1, label: "Save checkpoint tree reference", anchors: [e("retain")] }, { message: 2, label: "Compare checkpoint with current source", anchors: [e("compare")] }, { message: 4, label: "Retain unchanged reviewed paths", anchors: [e("reviewed")] }, { message: 5, label: "Mark affected explanations outdated", anchors: [e("stale")] }],
  }];
  const need = "After a reviewer has checked a change, a new revision should make the new work visible without discarding confidence in files that stayed the same. This change saves a source checkpoint and derives the next review from it.";
  const distinction = "The original base answers “what is in this whole change?” The checkpoint answers “what has changed since I reviewed it?” Those are different comparisons, even when they share the same current source.";
  const retained = "Review state is retained only for a checkpoint-reviewed path that still belongs to the current full change and has not changed since that checkpoint. Changed files reopen; unchanged files keep their reviewed state.";
  const caveat = "This is file-level continuity, not proof that a function still behaves the same. “Resolved” means a path left the full change, not that a finding was fixed. If the selected checkpoint comparison cannot be loaded, this version falls back to the full comparison.";
  const stories: Record<Approach, { title: string; sections: NarrativeSection[] }> = {
    linear: { title: "Capture, compare, and carry review state forward", sections: [
      section("checkpoint", "Save the reviewed source", p("need", need), p("capture", "A checkpoint records the exact source tree, its base, and reviewed paths. A private Git reference keeps the tree reachable."), code("capture-code", "capture"), code("retain-code", "retain")),
      section("compare", "Compare against the right baseline", p("distinction", distinction), diagram("architecture"), code("compare-code", "compare")),
      section("state", "Carry forward only unchanged review state", p("retained", retained), code("reviewed-code", "reviewed"), p("stale-text", "The same delta also marks affected tour steps, findings, and diagrams outdated. Comments keep an independent source-content check."), code("stale-code", "stale"), p("caveat", caveat)),
    ] },
    outcome: { title: "Return to a review without starting over", sections: [
      section("promise", "Make the next pass smaller and trustworthy", p("promise", need), example("outcome", "First pass: a.ts and b.ts reviewed\nNext revision: a.ts changes; c.ts is added\nNext pass: review a.ts and c.ts; retain b.ts"), p("test-intro", "The committed test makes that user-visible outcome concrete. After refresh, only b.ts remains reviewed; the “since last review” view contains a.ts and c.ts."), code("test-code", "test")),
      section("model", "Remember the source, not just a list of checked files", p("distinction", distinction), diagram("architecture"), p("capture", "The checkpoint binds those earlier decisions to a source tree. Its private Git reference keeps that exact tree available after the working copy moves on."), code("capture-code", "capture"), code("retain-code", "retain")),
      section("trust", "Keep confidence only where the source stayed put", p("retained", retained), code("reviewed-code", "reviewed"), p("stale", "Affected explanations remain available but are marked outdated. The new revision does not silently inherit old evidence as current."), code("stale-code", "stale")),
      section("boundary", "What this confidence does—and does not—mean", p("caveat", caveat)),
    ] },
    trace: { title: "Follow one review into its next revision", sections: [
      section("save", "1. Capture the first pass", p("need", need), p("capture", "The reviewer has checked a.ts and b.ts. The checkpoint saves their reviewed state with the exact source tree before later edits arrive."), code("capture-code", "capture")),
      section("delta", "2. Give the new source a second baseline", p("distinction", distinction), diagram("architecture"), code("compare-code", "compare")),
      section("classify", "3. Decide which work is new", p("classify", "In this example, a.ts changed again, b.ts stayed the same, and c.ts is new. Classification uses membership in the earlier change, current change, and checkpoint delta."), code("classify-code", "classify"), p("retained", retained), code("reviewed-code", "reviewed")),
      section("finish", "4. Preserve context without presenting it as current", p("stale", "A changed path invalidates its associated tour and diagram explanations. Comment anchors are checked against current line content. The UI can retain the history while distinguishing it from fresh evidence."), code("stale-code", "stale"), p("caveat", caveat)),
    ] },
    decisions: { title: "What makes earlier review work safe to reuse?", sections: [
      section("identity", "What does “reviewed” need to remember?", p("need", need), p("identity", "A filename alone cannot identify the code a person reviewed. The checkpoint records both the source tree and the reviewed paths, and keeps that tree reachable through Git."), code("capture-code", "capture"), code("retain-code", "retain"), p("cost", "This trades a little repository and session state for a reproducible reference point. A timestamp or a checked-file list would not preserve the actual bytes.", "inferred")),
      section("baselines", "Why keep both the full change and the review delta?", p("distinction", distinction), diagram("architecture"), code("compare-code", "compare"), p("tradeoff", "Keeping both views lets a reviewer focus on new work without losing the original scope. The design must also keep clear which baseline a count or classification uses.", "inferred")),
      section("confidence", "How much confidence should survive a refresh?", p("retained", retained), code("reviewed-code", "reviewed"), p("conservative", "Reopening an entire changed file can ask a reviewer to revisit unaffected code. It also avoids assuming that a line-level match proves a file's behavior is unchanged.", "inferred"), p("stale", "Saved explanations follow the same conservative boundary: a changed dependency marks the corresponding diagram outdated."), code("stale-code", "stale"), p("caveat", caveat)),
    ] },
  };
  return { id: "checkpoints", title: "Review checkpoints", description: "Immutable source, two baselines, retained review state, and stale evidence.", base, head, files: captured.files.length, documents: await documents(captured, source, evidence, stories), scenarios: [
    { id: "changed", label: "A new revision", summary: "The first pass reviewed a.ts and b.ts. The next revision edits a.ts and adds c.ts.", steps: [{ label: "Compare", value: "Delta: a.ts and c.ts", evidenceId: "compare" }, { label: "Retain", value: "b.ts stays reviewed", evidenceId: "reviewed" }, { label: "Revisit", value: "a.ts and c.ts need review", evidenceId: "classify" }], outcome: "Review the new work while preserving the unchanged first-pass decision." },
    { id: "resolved", label: "A path leaves the change", summary: "A path belonged to the earlier full change but no longer differs from the original base.", steps: [{ label: "Compare", value: "Absent from current change", evidenceId: "classify" }, { label: "Classify", value: "Label the path resolved", evidenceId: "classify" }, { label: "Retain", value: "Remove it from reviewed paths", evidenceId: "reviewed" }], outcome: "“Resolved” describes the diff relationship; it does not certify a bug fix." },
    { id: "missing", label: "Checkpoint unavailable", summary: "The selected checkpoint cannot produce a comparison, or no checkpoint was selected.", steps: [{ label: "Select", value: "Try the checkpoint view", evidenceId: "compare" }, { label: "Fallback", value: "Return the full comparison", evidenceId: "compare" }, { label: "Read", value: "Original base → current", evidenceId: "compare" }], outcome: "This version still shows the full change instead of failing the review view." },
  ] };
}

export async function buildReadingCases(repository: string): Promise<ReadingCase[]> {
  return [await publication(repository), await checkpoints(repository)];
}
