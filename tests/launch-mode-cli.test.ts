import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProcess } from "../src/process.ts";
import { ReviewSession } from "../src/session.ts";
import { loadPersistedSession, savePersistedSession } from "../src/store.ts";

const cli = join(import.meta.dir, "../src/cli.ts");
const selection = { adapterId: "attached" as const, modelId: "current-session", includeArchitecture: false, includeCallFlows: false, includeFlows: false, includeAdaptiveDiagrams: false, includeDryRuns: false, includeArchify: false, includeFindings: false };
const phases = [{ id: "value", title: "Change value", summary: "The result becomes two.", fileChanges: [{ path: "app.ts", summary: "Changes the exported value from one to two. Consumers receive two." }], steps: [{ id: "value-step", title: "Return two", objective: "The exported value becomes two.", anchor: { path: "app.ts", side: "new", startLine: 1, endLine: 1 } }] }];
const analysis = { title: "Return two", summary: "Consumers receive two instead of one.", phases: [], flows: [], callFlows: [], findings: [], structuralBlastRadii: [], structuralAnalysisOmissionReason: "No callable declarations changed." };
const proposal = { title: "Return two", sections: [{ id: "outcome", title: "The value becomes two", blocks: [{ id: "text", kind: "prose", text: "Consumers now receive two.", basis: "observed" }] }], evidence: [] };

test.skipIf(process.platform === "win32")("real CLI modes control bridge work, browser readiness, and resume without launching a desktop browser", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "diffcompass-launch-modes-")));
  const repository = join(root, "repo"), stateRoot = join(root, "state"), bin = join(root, "bin"), opened = join(root, "opened");
  const sessions = join(stateRoot, "diffcompass", "sessions");
  const children: ReturnType<typeof Bun.spawn>[] = [];
  async function until<T>(get: () => Promise<T | undefined>): Promise<T> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) { const value = await get(); if (value !== undefined) return value; await Bun.sleep(20); }
    throw Error("Launch-mode fixture did not reach the expected state");
  }
  async function start(args: string[]) {
    await rm(opened, { force: true });
    const child = Bun.spawn([process.execPath, cli, "--repo", repository, "--base", "HEAD", "--attached", "--open", ...args], {
      cwd: repository, env: { ...process.env, XDG_STATE_HOME: stateRoot, PATH: `${bin}:${process.env.PATH}`, DIFFCOMPASS_TEST_OPENED: opened }, stdout: "ignore", stderr: "ignore",
    });
    children.push(child);
    return until(async () => {
      for (const name of (await readdir(sessions).catch(() => [])).filter(name => name.endsWith(".json"))) {
        const path = join(sessions, name);
        const lock = await readFile(`${path}.lock`, "utf8").then(JSON.parse).catch(() => null);
        if (lock?.pid !== child.pid || !lock.reviewUrl) continue;
        const saved = await loadPersistedSession(path), origin = new URL(lock.reviewUrl).origin;
        async function api(route: string, bridge = false, body?: object) {
          const response = await fetch(`${origin}${route}`, { method: body ? "POST" : "GET", headers: { "x-diffcompass-token": bridge ? saved.bridgeToken! : saved.browserToken, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
          expect(response.status).toBe(200);
          return response.json();
        }
        return { path, api, stop: async () => { child.kill(); await child.exited; } };
      }
    });
  }
  try {
    await mkdir(repository); await mkdir(bin); await mkdir(sessions, { recursive: true });
    for (const name of ["open", "xdg-open"]) {
      await writeFile(join(bin, name), '#!/bin/sh\nprintf opened > "$DIFFCOMPASS_TEST_OPENED"\n'); await chmod(join(bin, name), 0o755);
    }
    for (const args of [["init", "-b", "main"], ["config", "user.email", "test@example.invalid"], ["config", "user.name", "Test"]]) await runProcess(["git", ...args], repository);
    await writeFile(join(repository, "app.ts"), "export const value = 1;\n");
    await runProcess(["git", "add", "."], repository); await runProcess(["git", "commit", "-m", "Initial"], repository);
    await writeFile(join(repository, "app.ts"), "export const value = 2;\n");
    const plain = await start(["--mode", "changes"]);
    await until(async () => await readFile(opened, "utf8").catch(() => undefined));
    expect((await plain.api("/api/session")).outline).toBeUndefined();
    expect((await plain.api("/api/bridge/events", true)).events).toEqual([]);
    await plain.stop();
    const resumedPlain = await start(["--resume", plain.path]);
    expect((await resumedPlain.api("/api/session")).launchMode).toBe("changes");
    expect((await resumedPlain.api("/api/bridge/events", true)).events).toEqual([]);
    await resumedPlain.stop();

    for (const mode of ["briefing", "tour"] as const) {
      // Seed only agent options, never generated content; production CLI owns all generation.
      const path = join(sessions, `${crypto.randomUUID()}.json`);
      const seed = await ReviewSession.create(repository, "HEAD", { attached: true, stateFile: path, agentAdapters: [], diffPreferenceDirectory: sessions });
      await seed.dispose();
      const saved = await loadPersistedSession(path); saved.selection = selection; await savePersistedSession(path, saved);
      const review = await start(["--resume", path, "--mode", mode]);
      let after = 0;
      const prompts: string[] = [];
      async function replyUntil(predicate: (snapshot: any) => boolean) {
        await until(async () => {
          const { events } = await review.api(`/api/bridge/events?after=${after}`, true);
          for (const event of events) {
            after = Math.max(after, event.sequence);
            if (event.type !== "agent.prompt") continue;
            prompts.push(event.prompt);
            const message = event.prompt.includes("Prepare shared change analysis") ? JSON.stringify(analysis)
              : event.prompt.includes("Return only the briefingProposal") ? JSON.stringify(proposal)
              : event.prompt.includes("Prepare tour steps from") ? JSON.stringify({ phases })
              : "The exported value is two.";
            await review.api("/api/bridge/respond", true, { eventId: event.id, leaseId: event.leaseId, message });
          }
          const snapshot = await review.api("/api/session");
          return predicate(snapshot) ? snapshot : undefined;
        });
      }
      expect(await readFile(opened, "utf8").catch(() => undefined)).toBeUndefined();
      await replyUntil(s => s.outline?.preparation?.briefing === "ready" && (mode === "briefing" || s.outline.preparation.steps === "ready"));
      await until(async () => await readFile(opened, "utf8").catch(() => undefined));
      expect(prompts.some(p => p.includes("Prepare tour steps from"))).toBe(mode === "tour");
      const snapshot = await review.api("/api/session");
      expect(snapshot.launchMode).toBe(mode);
      expect(snapshot.outline.preparation.steps).toBe(mode === "tour" ? "ready" : "disabled");
      expect((await loadPersistedSession(path)).launchMode).toBe(mode);
      await review.stop();
      const resumed = await start(["--resume", path]);
      await until(async () => await readFile(opened, "utf8").catch(() => undefined));
      expect((await resumed.api("/api/session")).launchMode).toBe(mode);
      const { events } = await resumed.api(`/api/bridge/events?after=${after}`, true);
      expect(events.filter((e: any) => e.type === "agent.prompt")).toEqual([]);
      await resumed.stop();
    }
  } finally {
    for (const child of children) { if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; }
    await rm(root, { recursive: true, force: true });
  }
}, 40_000);

test("CLI rejects invalid and conflicting modes before starting local or PR reviews", async () => {
  for (const prefix of [[], ["pr", "123"]]) for (const args of [["--mode", "invalid"], ["--mode", "briefing", "--start-tour"], ["--start-tour", "--mode", "changes"], ["--mode", "briefing", "--mode", "tour"]]) {
    const result = await runProcess([process.execPath, cli, ...prefix, ...args], import.meta.dir, [0, 1]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("--mode");
  }
});
