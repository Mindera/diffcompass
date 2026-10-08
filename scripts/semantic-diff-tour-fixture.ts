/** Isolated UI fixture with scripted replies, not a model-quality evaluation. */
import { appendFile } from "node:fs/promises";
import { prepareTestFixture } from "../src/test-fixture.ts";
import { loadPersistedSession, savePersistedSession } from "../src/store.ts";
import { ReviewSession } from "../src/session.ts";
import { startServer } from "../src/server.ts";

const port = Number(process.env.TOUR_SYNTAX_PORT ?? 48768);
const root = process.env.TOUR_SYNTAX_ROOT ?? `/tmp/diffcompass-tour-syntax-fixture-${port}`;
const fixture = await prepareTestFixture({ root, reset: false });
const saved = await loadPersistedSession(fixture.stateFile);
// The general fixture defaults to Codex. This harness must never launch a model.
saved.selection = { ...saved.selection, adapterId: "attached", modelId: "current-session" };
saved.bridgeToken = crypto.randomUUID();
delete saved.agentContinuation;
saved.bridgePrompts = [];
saved.bridgeSequence = 0;
saved.outline!.title = "Tour syntax evidence fixture — scripted replies";
for (const step of saved.outline!.phases.flatMap((phase) => phase.steps)) delete step.explanation;
saved.currentStepIndex = 0;
saved.preferences!.prefetchSteps = 1;
await savePersistedSession(fixture.stateFile, saved);
const session = await ReviewSession.create(fixture.repository, undefined, { resume: true, stateFile: fixture.stateFile, agentAdapters: [], attached: true });
const bridge = session.bridge!;
const responses: Record<string, string> = {
  "extract-subtotal": "`subtotal` is a new function that adds each item's price multiplied by its quantity. The total calculation now has a named helper. Check that an empty item list produces the expected zero subtotal.\n\nSelect Next when ready.",
  "apply-discount": "`total` now accepts an optional `discount`. It calculates the subtotal and returns that amount when no discount is supplied. Otherwise, it subtracts the amount multiplied by `discount.percentage`.\n\nCheck that callers use fractions, such as 0.2 for 20%, and that omitting the discount keeps the expected total. Select Next when ready.",
  "format-receipt": "The new `receipt` function passes its items and optional discount to `total`, then formats the amount with two decimal places. This turns the calculation into receipt text.\n\nCheck the expected rounding and the displayed result when no discount is provided. Select Next when ready.",
  "document-fixture": "The README now describes which review features this fixture exercises. This stop is explained from its saved text diff because Markdown has no supported declaration parser.\n\nCheck that the description matches the fixture's intended use. Select Next when ready.",
};
async function respond() {
  let sequence = saved.bridgeSequence ?? 0;
  while (true) {
    for (const event of await bridge.eventsAfter(sequence, 30_000)) {
      sequence = event.sequence;
      if (event.type !== "agent.prompt" || event.kind !== "tour.explanation") continue;
      const evidence = JSON.parse(event.prompt.split("<tour-syntax-evidence>\n")[1]!.split("\n</tour-syntax-evidence>")[0]!);
      const step = session.outline!.phases.flatMap((phase) => phase.steps).find((step) => event.prompt.includes(`: ${step.title}\nAnchor:`));
      if (!step || !responses[step.id]) throw new Error("Unexpected fixture stop");
      if (step.id === "apply-discount" && !evidence.changes.some((change: any) => change.name === "total" && change.inputs?.added.some((input: any) => input.name === "discount" && input.optional))) throw new Error("Missing captured optional-input evidence");
      if (step.id === "document-fixture" && evidence.status !== "unsupported") throw new Error("Expected explicit Markdown fallback");
      await appendFile(`${root}/tour-evidence.jsonl`, JSON.stringify({ step: step.id, evidence }) + "\n");
      await bridge.respond(event.id, responses[step.id]!);
      await bridge.ack(event.id);
      console.log(`Prepared ${step.id}: ${evidence.status}, ${evidence.changes.length} included declarations`);
    }
  }
}
void respond().catch((error) => { console.error(error); process.exitCode = 1; });
await session.startTour();
startServer(session, port, fixture.root, true);
console.log(`Scripted tour fixture ready: http://127.0.0.1:${port}`);
