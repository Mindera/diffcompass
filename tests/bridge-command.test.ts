import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBridgeCommand } from "../src/bridge-command.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

test("bridge watch ignores empty polls and returns the first real event", async () => {
  const directory = await mkdtemp(join(tmpdir(), "review-tour-bridge-watch-"));
  directories.push(directory);
  const tokenFile = join(directory, "token");
  await writeFile(tokenFile, "secret-token\n", { mode: 0o600 });
  let requests = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      requests += 1;
      expect(request.headers.get("x-review-tour-token")).toBe("secret-token");
      const url = new URL(request.url);
      expect(url.searchParams.get("after")).toBe("7");
      expect(url.searchParams.get("waitMs")).toBe("1");
      return Response.json(requests === 1 ? { events: [] } : { events: [{ id: "ready" }] });
    },
  });
  const messages: string[] = [];
  const original = console.log;
  console.log = (message?: unknown) => { messages.push(String(message)); };
  try {
    expect(await runBridgeCommand([
      "watch", "--url", server.url.toString(), "--token-file", tokenFile,
      "--after", "7", "--wait-ms", "1",
    ])).toBe(0);
  } finally {
    console.log = original;
    server.stop(true);
  }
  expect(requests).toBe(2);
  expect(JSON.parse(messages.join("\n"))).toEqual({ events: [{ id: "ready" }] });
});
