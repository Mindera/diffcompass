import { expect, test } from "bun:test";

const source = await Bun.file(new URL("../public/monaco/bootstrap.mjs", import.meta.url)).text();

test("a late bootstrap failure reaches its original mount, not a replacement for the same file", async () => {
  const oldFailures: string[] = [], newFailures: string[] = [];
  const oldHost = { failed: (message: string) => oldFailures.push(message) };
  const newHost = { failed: (message: string) => newFailures.push(message) };
  let activeHost = oldHost;
  let reject!: (error: Error) => void;
  const loading = new Promise((_, fail) => { reject = fail; });
  const frame = { parent: { diffCompassProductionHost: {
    forFile: () => activeHost,
    failed: (message: string) => activeHost.failed(message),
  } } };
  const status = { textContent: "" };
  const run = new Function("window", "document", "location", "load", source.replace('import("./app.mjs")', "load()"));
  run(frame, { getElementById: () => status }, { search: "?production=1&embedded=1&file=cart.ts" }, () => loading);
  activeHost = newHost;
  reject(new Error("Delayed module failure"));
  await loading.catch(() => {});
  await Promise.resolve();
  expect(oldFailures).toEqual(["Monaco could not load: Delayed module failure"]);
  expect(newFailures).toEqual([]);
});
