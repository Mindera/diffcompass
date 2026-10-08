import type { PersistedReviewSession } from "../src/types.ts";

// Opt-in, fresh-fixture coverage. Never replace a saved reviewer's tour.
export function addBeforeTourExamples(saved: PersistedReviewSession) {
  const phase = saved.outline!.phases[0]!;
  phase.steps.unshift(
    { id: "before-removed", title: "Inspect the original function name", objective: "Before line 6 stays on the removed row in Unified.", anchor: { path: "src/cart.ts", side: "old", startLine: 6, endLine: 6 }, explanation: "The original total declaration is replaced by subtotal. This stop targets only the removed declaration, not its replacement." },
    { id: "before-mixed", title: "Read the original calculation", objective: "Follow a Before range across removed and unchanged rows.", anchor: { path: "src/cart.ts", side: "old", startLine: 6, endLine: 8 }, explanation: "The declaration changed, but the reduction and closing brace survive. Their Unified display positions differ from their Before source coordinates." },
    { id: "before-unchanged", title: "Keep the original arithmetic", objective: "Before line 7 maps to the unchanged reduction, not After line 7.", anchor: { path: "src/cart.ts", side: "old", startLine: 7, endLine: 7 }, explanation: "This is unchanged original source. The tour anchor must remain Before even though Unified draws it in the modified editor." },
    { id: "before-context", title: "Inspect previously hidden original context", objective: "Reveal Before line 50 inside the long unchanged gap.", anchor: { path: "src/context-example.ts", side: "old", startLine: 50, endLine: 52 }, explanation: "Navigation should reveal this original context and scroll to its banner without an inner scrollbar or a renderer switch." },
    { id: "before-context-removed", title: "Inspect the earlier return value", objective: "Return from the long context stop to removed Before line 43.", anchor: { path: "src/context-example.ts", side: "old", startLine: 43, endLine: 43 }, explanation: "Before truncation was introduced, this helper returned the full trimmed string." },
  );
  if (!phase.fileChanges.some(file => file.path === "src/context-example.ts")) phase.fileChanges.push({ path: "src/context-example.ts", summary: "Before-side stops inside and beside collapsible context." });
  saved.currentStepIndex = 0;
  saved.preferences = { ...saved.preferences!, diffLayout: "unified" };
}
