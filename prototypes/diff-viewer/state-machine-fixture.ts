import {ArchifyRenderer} from "../../src/archify.ts";
import type {ReviewAdaptiveDiagram, TourOutline} from "../../src/types.ts";

// A real, captured source change for the full-product fixture. It is a small
// standalone job controller, not a claim that receipt() itself is asynchronous.
export const stateMachineFile = {
  path: "src/receipt-job.ts",
  before: `export type State = "Pending" | "Formatting" | "Ready";
export type Event = "start" | "succeed";
export const initialState: State = "Pending";

export const transitions: Record<State, Partial<Record<Event, State>>> = {
  Pending: { start: "Formatting" },
  Formatting: { succeed: "Ready" },
  Ready: {},
};

export function transition(state: State, event: Event): State {
  return transitions[state][event] ?? state;
}
`,
  after: `export type State = "Pending" | "Formatting" | "Failed" | "Ready" | "Cancelled";
export type Event = "start" | "succeed" | "fail" | "retry" | "cancel";
export const initialState: State = "Pending";

// Cancellation and success are terminal. Failure can be retried or cancelled.
export const transitions: Record<State, Partial<Record<Event, State>>> = {
  Pending: { start: "Formatting", cancel: "Cancelled" },
  Formatting: { succeed: "Ready", fail: "Failed", cancel: "Cancelled" },
  Failed: { retry: "Formatting", cancel: "Cancelled" },
  Ready: {},
  Cancelled: {},
};

// Events unsupported in the current state leave it unchanged.
export function transition(state: State, event: Event): State {
  return transitions[state][event] ?? state;
}
`,
};

export const stateMachineDiagram: ReviewAdaptiveDiagram = {
  kind: "state-machine",
  title: "Receipt job: retry or cancel",
  summary: "A synthetic receipt-job controller starts Pending. Formatting can succeed, fail, or be cancelled; a Failed job can retry. Ready and Cancelled are terminal.",
  mermaid: `stateDiagram-v2
  [*] --> Pending
  Pending --> Formatting : start
  Pending --> Cancelled : cancel
  Formatting --> Ready : succeed
  Formatting --> Failed : fail
  Formatting --> Cancelled : cancel
  Failed --> Formatting : retry
  Failed --> Cancelled : cancel
  Ready --> [*]
  Cancelled --> [*]`,
  evidence: [
    "src/receipt-job.ts:3 initializes the job to Pending.",
    "src/receipt-job.ts:6-12 defines every event-labelled transition, including the Failed to Formatting retry and all three cancellation paths.",
    "src/receipt-job.ts:15-17 ignores unsupported events; the empty Ready and Cancelled rows make both terminal. Unchanged-state events are omitted from the diagram.",
    "This is a standalone synthetic controller fixture, not a runtime trace or an async implementation of receipt().",
  ],
  materiallyImprovesUnderstanding: "The new failure/retry loop and cancellation exits are easier to inspect as a state machine than as a call sequence. The diagram shows the updated controller, not a before/after overlay.",
  affectedFiles: [stateMachineFile.path],
};

export async function installStateMachineExample(outline: TourOutline, renderer: ArchifyRenderer | null = ArchifyRenderer.fromEnvironment() ?? null): Promise<void> {
  outline.stateDiagram = structuredClone(stateMachineDiagram);
  // Discard the unrelated old linear example before rendering this graph.
  // The evidence-backed Mermaid stays saved for genuine renderer failures.
  outline.archifyArtifacts = outline.archifyArtifacts?.filter(artifact=>artifact.id!=="lifecycle-state-machine");
  outline.archifyFailures = outline.archifyFailures?.filter(failure=>failure.id!=="lifecycle-state-machine");
  if (renderer) {
    const rendered = await renderer.render(outline, [], new Set(["lifecycle-state-machine"]));
    outline.archifyArtifacts = [...(outline.archifyArtifacts ?? []), ...rendered.artifacts];
    outline.archifyFailures = [...(outline.archifyFailures ?? []), ...rendered.failures];
  }
  const phase = outline.phases.find(phase=>phase.id==="presentation")!;
  if (!phase.fileChanges.some(file=>file.path===stateMachineFile.path)) {
    phase.fileChanges.push({path:stateMachineFile.path,summary:"Adds failure, retry, cancellation and terminal-state handling to a synthetic receipt-job controller. Inspect its state machine under Maps → Data & lifecycle."});
  }
}
