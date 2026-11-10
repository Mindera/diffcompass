import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProcess } from "../src/process.ts";

test("CLI media defaults, flag/config precedence and resume preserve imported evidence", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "diffcompass-media-cli-")));
  const repository = join(root, "repo"), stateRoot = join(root, "state");
  const sessions = join(stateRoot, "diffcompass", "sessions");
  const children: ReturnType<typeof Bun.spawn>[] = [];
  async function start(args: string[]) {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "../src/cli.ts"), "--repo", repository, "--base", "HEAD", "--attached", "--no-findings", ...args], {
      cwd: repository, env: { ...process.env, XDG_STATE_HOME: stateRoot }, stdout: "ignore", stderr: "ignore",
    });
    children.push(child);
    const deadline = Date.now() + 10_000;
    while (child.exitCode === null && Date.now() < deadline) {
      for (const name of (await readdir(sessions).catch(() => [])).filter(name => name.endsWith(".json"))) {
        const path = join(sessions, name);
        const lock = await readFile(`${path}.lock`, "utf8").then(JSON.parse).catch(() => null);
        if (lock?.pid !== child.pid || !lock.reviewUrl) continue;
        const state = JSON.parse(await readFile(path, "utf8"));
        const response = await fetch(`${new URL(lock.reviewUrl).origin}/api/session`, { headers: { "x-diffcompass-token": state.browserToken } });
        expect(response.status).toBe(200);
        return { path, snapshot: await response.json(), stop: async () => {
          child.kill();
          const timer = setTimeout(() => child.kill("SIGKILL"), 2_000);
          try { await child.exited; } finally { clearTimeout(timer); }
        } };
      }
      await Bun.sleep(20);
    }
    throw Error("Media CLI fixture did not start");
  }
  const config = (enabled: boolean) => writeFile(join(repository, ".diffcompass.json"), JSON.stringify({ media: { includeChangedImages: enabled } }));
  try {
    await mkdir(repository);
    for (const args of [["init", "-b", "main"], ["config", "user.name", "Media test"], ["config", "user.email", "media@example.invalid"]]) await runProcess(["git", ...args], repository);
    await writeFile(join(repository, "app.ts"), "const version = 1;\n");
    await runProcess(["git", "add", "."], repository);
    await runProcess(["git", "commit", "-m", "Initial"], repository);
    await writeFile(join(repository, "app.ts"), "const version = 2;\n");
    const media = join(root, "qa.png");
    await writeFile(media, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
    const original = await start(["--media", media]);
    expect(original.snapshot.mediaIncludeChangedImages).toBe(false);
    expect(original.snapshot.screenshots).toHaveLength(1);
    await original.stop();
    await config(true);
    const resumed = await start(["--resume", original.path]);
    expect(resumed.snapshot.mediaIncludeChangedImages).toBe(false); // Saved choice wins over changed config.
    expect(resumed.snapshot.screenshots).toEqual(original.snapshot.screenshots);
    await resumed.stop();
    await config(false);
    const enabled = await start(["--resume", original.path, "--media-include-changed-images"]);
    expect(enabled.snapshot.mediaIncludeChangedImages).toBe(true); // Explicit flag wins.
    expect(enabled.snapshot.screenshots).toEqual(original.snapshot.screenshots);
    await enabled.stop();
    const enabledResume = await start(["--resume", original.path]);
    expect(enabledResume.snapshot.mediaIncludeChangedImages).toBe(true);
    await enabledResume.stop();
    await config(true);
    const configured = await start([]);
    expect(configured.snapshot.mediaIncludeChangedImages).toBe(true);
    expect(configured.snapshot.screenshots).toEqual([]);
    await configured.stop();
    const help = await runProcess([process.execPath, join(import.meta.dir, "../src/cli.ts"), "pr", "123", "--media-include-changed-images", "--help"], repository);
    expect(help.stdout).toContain("--media-include-changed-images");
  } finally {
    for (const child of children) if (child.exitCode === null) { child.kill("SIGKILL"); await child.exited; }
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
