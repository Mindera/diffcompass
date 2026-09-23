#!/usr/bin/env bun
import { join } from "node:path";
import { prepareTestFixture } from "../src/test-fixture.ts";

const args = process.argv.slice(2);
const prepareOnly = args.includes("--prepare-only");
const fixtureRootIndex = args.indexOf("--fixture-root");
const fixtureRoot = fixtureRootIndex === -1 ? undefined : args[fixtureRootIndex + 1];
if (fixtureRootIndex !== -1 && (!fixtureRoot || fixtureRoot.startsWith("--"))) throw new Error("--fixture-root needs a directory path.");
const forwarded = args.filter((arg, index) => arg !== "--reset" && arg !== "--prepare-only" && (fixtureRootIndex === -1 || (index !== fixtureRootIndex && index !== fixtureRootIndex + 1)));
const fixture = await prepareTestFixture({ root: fixtureRoot, reset: true });

console.log(`Created fresh test fixture: ${fixture.root}`);
console.log(`Repository: ${fixture.repository}`);
console.log(`Persisted session: ${fixture.stateFile}`);
if (prepareOnly) process.exit(0);

const child = Bun.spawn([
  process.execPath,
  "run",
  join(import.meta.dir, "..", "src", "cli.ts"),
  "--resume",
  fixture.stateFile,
  "--start-tour",
  ...forwarded,
], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
process.exit(await child.exited);
