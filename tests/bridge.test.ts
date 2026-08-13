import { expect, test } from "bun:test";
import { AttachedAgentBridge } from "../src/bridge.ts";

const comment = {
  id: "comment-1",
  path: "src/example.ts",
  side: "new" as const,
  line: 7,
  body: "Handle the empty case.",
  lineContent: "const value = input();",
  status: "active" as const,
  createdAt: "2026-08-08T00:00:00.000Z",
  updatedAt: "2026-08-08T00:00:00.000Z",
};

async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  const result = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (result instanceof Error) return result;
  throw new Error("Expected promise to reject with an Error");
}

test("delivers an attached-agent prompt and resolves its response", async () => {
  const bridge = new AttachedAgentBridge();
  const response = bridge.send("Explain the change", "tour.explanation");
  const events = await bridge.eventsAfter(0);

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    sequence: 1,
    type: "agent.prompt",
    kind: "tour.explanation",
    prompt: "Explain the change",
  });

  await bridge.respond(events[0]!.id, "It changes the state transition.");
  expect(await response).toBe("It changes the state transition.");
});

test("reports whether an attached prompt is waiting, claimed, or making visible progress", async () => {
  const bridge = new AttachedAgentBridge();
  const updates: Array<{ status: string; message: string }> = [];
  const answer = bridge.send("Explain the change", "tour.explanation", undefined, (update) => updates.push(update));
  const [event] = await bridge.eventsAfter(0, 1_000, undefined, true);

  expect(updates.map((update) => update.status)).toEqual(["waiting", "running"]);
  expect(updates.at(-1)?.message).toContain("claimed");
  bridge.reportProgress(event!.id, event!.leaseId!, "Checking the changed call path.");
  expect(updates.at(-1)?.message).toBe("Checking the changed call path.");

  await bridge.respond(event!.id, "The explanation.", event!.leaseId);
  await expect(answer).resolves.toBe("The explanation.");
  expect(updates.at(-1)?.message).toContain("returned a response");
});

test("automatically continues an abandoned attached prompt with a local fallback", async () => {
  const bridge = new AttachedAgentBridge();
  const updates: string[] = [];
  bridge.setFallback({
    async send(prompt, kind) {
      expect(prompt).toBe("Explain the abandoned change");
      expect(kind).toBe("tour.explanation");
      return "Recovered explanation";
    },
  }, 15);
  const answer = bridge.send("Explain the abandoned change", "tour.explanation", undefined, (update) => updates.push(update.message));
  const [claimed] = await bridge.eventsAfter(0, 0, undefined, true);

  await expect(answer).resolves.toBe("Recovered explanation");
  expect(updates.some((message) => message.includes("fallback agent"))).toBe(true);
  await expect(bridge.respond(claimed!.id, "Late attached answer", claimed!.leaseId)).rejects.toThrow(/fallback|different response/);
  expect(await bridge.eventsAfter(0)).toEqual([]);
});

test("attached progress heartbeats postpone automatic fallback", async () => {
  const bridge = new AttachedAgentBridge();
  let fallbackCalls = 0;
  bridge.setFallback({
    async send() {
      fallbackCalls += 1;
      return "Fallback";
    },
  }, 25);
  const answer = bridge.send("Long inspection", "tour.explanation");
  const [claimed] = await bridge.eventsAfter(0, 0, undefined, true);

  await Bun.sleep(15);
  bridge.reportProgress(claimed!.id, claimed!.leaseId!, "Still checking the call path.");
  await Bun.sleep(15);
  expect(fallbackCalls).toBe(0);
  await bridge.respond(claimed!.id, "Attached answer", claimed!.leaseId);

  await expect(answer).resolves.toBe("Attached answer");
  expect(fallbackCalls).toBe(0);
});

test("rejects progress for an unowned or completed attached prompt", async () => {
  const bridge = new AttachedAgentBridge();
  const answer = bridge.send("Explain the change", "tour.explanation");
  const [unclaimed] = await bridge.eventsAfter(0);
  expect(() => bridge.reportProgress(unclaimed!.id, "made-up", "Working")).toThrow("Claim this bridge prompt");
  const [event] = await bridge.eventsAfter(0, 1_000, undefined, true);
  expect(() => bridge.reportProgress(event!.id, "wrong", "Working")).toThrow("leased");
  await bridge.respond(event!.id, "Done", event!.leaseId);
  await answer;
  expect(() => bridge.reportProgress(event!.id, event!.leaseId!, "Too late")).toThrow("no longer active");
});

test("accepts an identical replayed response but rejects a conflicting replay", async () => {
  const bridge = new AttachedAgentBridge();
  const answer = bridge.send("Explain the change", "tour.explanation");
  const [event] = await bridge.eventsAfter(0);

  await bridge.respond(event!.id, "The explanation.");
  await bridge.respond(event!.id, "The explanation.");
  await expect(answer).resolves.toBe("The explanation.");
  await expect(bridge.respond(event!.id, "A different explanation.")).rejects.toThrow("different response");
});

test("terminal comment payloads are detached from input and returned event copies", async () => {
  const bridge = new AttachedAgentBridge();
  const source = [structuredClone(comment)];
  const closed = bridge.close("feedback", source);
  source[0].body = "mutated caller input";
  closed.comments[0]!.body = "mutated returned event";

  const [firstRead] = await bridge.eventsAfter(0);
  (firstRead as { comments: typeof source }).comments[0]!.body = "mutated event read";
  const [secondRead] = await bridge.eventsAfter(0);
  expect((secondRead as { comments: typeof source }).comments[0]!.body).toBe("Handle the empty case.");
});

test("long polling wakes when the review closes with feedback", async () => {
  const bridge = new AttachedAgentBridge();
  const waiting = bridge.eventsAfter(0, 1_000);
  bridge.close("feedback", [comment]);

  expect(await waiting).toEqual([expect.objectContaining({
    sequence: 1,
    type: "review.closed",
    outcome: "feedback",
    comments: [expect.objectContaining({ body: "Handle the empty case." })],
  })]);
  expect(bridge.isAuthorized(bridge.token)).toBe(true);
  expect(bridge.isAuthorized("wrong-token")).toBe(false);
});

test("closing cancels an unanswered prompt and prevents further prompts", async () => {
  const bridge = new AttachedAgentBridge();
  const answer = bridge.send("Explain the change", "tour.explanation");

  bridge.close("cancelled", []);

  expect((await rejectionOf(answer)).message).toContain("review closed before the attached agent answered");
  expect((await rejectionOf(bridge.send("Try again", "review.question"))).message).toContain("The review is closed");
});

test("the same close outcome is idempotent, while a conflicting outcome is rejected", async () => {
  const bridge = new AttachedAgentBridge();
  const first = bridge.close("feedback", [comment]);
  const repeated = bridge.close("feedback", []);

  expect(repeated).toEqual(first);
  expect(await bridge.eventsAfter(0)).toEqual([first]);
  expect(() => bridge.close("accepted", [])).toThrow("already closed as feedback");
});

test("events must be answered before acknowledgement and are removed once acknowledged", async () => {
  const bridge = new AttachedAgentBridge();
  const answer = bridge.send("Explain the change", "tour.explanation");
  const [event] = await bridge.eventsAfter(0);

  await expect(bridge.ack(event!.id)).rejects.toThrow("Answer the prompt before acknowledging it");
  await bridge.respond(event!.id, "The change is intentional.");
  await expect(answer).resolves.toBe("The change is intentional.");

  await bridge.ack(event!.id);
  expect(await bridge.eventsAfter(0)).toEqual([]);
  await expect(bridge.ack(event!.id)).resolves.toBeUndefined();
  expect(await bridge.eventsAfter(0)).toEqual([]);
});

test("terminal acknowledgement resolves only after the closing event is acknowledged", async () => {
  const bridge = new AttachedAgentBridge();
  const closed = bridge.close("accepted", []);
  let acknowledged = false;
  void bridge.terminalAcknowledged.then(() => {
    acknowledged = true;
  });

  await Promise.resolve();
  expect(acknowledged).toBe(false);

  await bridge.ack(closed.id);
  await bridge.terminalAcknowledged;
  expect(acknowledged).toBe(true);
});

test("an aborted long poll resolves without waiting for its timeout", async () => {
  const bridge = new AttachedAgentBridge();
  const controller = new AbortController();
  const waiting = bridge.eventsAfter(0, 5_000, controller.signal);

  controller.abort();

  expect(await waiting).toEqual([]);
});

test("persists a prompt sequence before exposing the event", async () => {
  const bridge = new AttachedAgentBridge();
  let release!: () => void;
  const checkpoint = new Promise<void>((resolve) => { release = resolve; });
  bridge.setPersistence(() => checkpoint);

  const answer = bridge.send("Explain safely", "tour.explanation");
  expect(bridge.currentSequence).toBe(1);
  expect(await bridge.eventsAfter(0)).toEqual([]);

  release();
  const [event] = await bridge.eventsAfter(0, 1_000);
  expect(event?.sequence).toBe(1);
  await bridge.respond(event!.id, "Done");
  await expect(answer).resolves.toBe("Done");
});

test("rehydrates an unanswered prompt beyond the saved cursor and reuses its durable response", async () => {
  const original = new AttachedAgentBridge("token");
  const waiting = original.send("Durable prompt", "tour.explanation");
  const [originalEvent] = await original.eventsAfter(0);
  const restored = new AttachedAgentBridge("token", original.currentSequence, undefined, original.persistedPrompts);
  const [replayed] = await restored.eventsAfter(originalEvent!.sequence);
  expect(replayed).toMatchObject(originalEvent!);

  await restored.respond(replayed!.id, "Durable answer");
  await expect(restored.send("Durable prompt", "tour.explanation")).resolves.toBe("Durable answer");
  original.dispose();
  await expect(waiting).rejects.toThrow("server stopped");
});

test("replays an unacknowledged durable terminal event even past the caller cursor", async () => {
  const original = new AttachedAgentBridge("token", 4);
  const closed = original.close("feedback", [comment]);
  const restored = new AttachedAgentBridge("token", closed.sequence, { ...closed, acknowledged: false });

  expect(await restored.eventsAfter(closed.sequence)).toEqual([closed]);
  await restored.ack(closed.id);
  expect(await restored.eventsAfter(closed.sequence)).toEqual([]);
});

test("leases each event to only one concurrent polling worker", async () => {
  const bridge = new AttachedAgentBridge();
  const answer = bridge.send("Explain once", "tour.explanation");
  const first = bridge.eventsAfter(0, 1_000, undefined, true);
  const second = bridge.eventsAfter(0, 20, undefined, true);
  const batches = await Promise.all([first, second]);

  expect(batches.filter((batch) => batch.length === 1)).toHaveLength(1);
  expect(batches.filter((batch) => batch.length === 0)).toHaveLength(1);
  const event = batches.flat()[0]!;
  await bridge.respond(event.id, "Only once", event.leaseId);
  await expect(answer).resolves.toBe("Only once");
});

test("restores lease ownership so a second worker cannot claim or answer after restart", async () => {
  const original = new AttachedAgentBridge("token");
  const waiting = original.send("Owned prompt", "review.question");
  const [claimed] = await original.eventsAfter(0, 0, undefined, true);
  const restored = new AttachedAgentBridge("token", original.currentSequence, undefined, original.persistedPrompts, original.persistedLeases);

  expect(await restored.eventsAfter(0, 0, undefined, true)).toEqual([]);
  await expect(restored.respond(claimed!.id, "wrong", "wrong-lease")).rejects.toThrow("leased");
  await restored.respond(claimed!.id, "owned", claimed!.leaseId);
  await expect(restored.send("Owned prompt", "review.question")).resolves.toBe("owned");
  original.dispose();
  await expect(waiting).rejects.toThrow("server stopped");
});

test("acknowledging a committed prompt checkpoints neither its record nor a dangling lease", async () => {
  const bridge = new AttachedAgentBridge();
  let checkpoint = { prompts: bridge.persistedPrompts, leases: bridge.persistedLeases };
  bridge.setPersistence(async () => {
    checkpoint = { prompts: bridge.persistedPrompts, leases: bridge.persistedLeases };
  });
  const answer = bridge.send("Commit", "tour.explanation");
  const [event] = await bridge.eventsAfter(0, 1_000, undefined, true);
  await bridge.respond(event!.id, "Committed", event!.leaseId);
  bridge.prepareCommitResponses();
  await bridge.ack(event!.id, event!.leaseId);

  expect(await answer).toBe("Committed");
  expect(checkpoint).toEqual({ prompts: [], leases: [] });
});

test("an expired restored lease rejects its old worker until the event is reclaimed", async () => {
  const original = new AttachedAgentBridge("token");
  const waiting = original.send("Expired owner", "review.question");
  const [oldClaim] = await original.eventsAfter(0, 0, undefined, true);
  const expired = original.persistedLeases.map((lease) => ({ ...lease, expiresAt: Date.now() - 1 }));
  const restored = new AttachedAgentBridge("token", original.currentSequence, undefined, original.persistedPrompts, expired);

  await expect(restored.respond(oldClaim!.id, "old", oldClaim!.leaseId)).rejects.toThrow("expired worker");
  const [newClaim] = await restored.eventsAfter(0, 0, undefined, true);
  expect(newClaim!.leaseId).not.toBe(oldClaim!.leaseId);
  await restored.respond(newClaim!.id, "new", newClaim!.leaseId);
  await expect(restored.send("Expired owner", "review.question")).resolves.toBe("new");
  original.dispose();
  await expect(waiting).rejects.toThrow("server stopped");
});
