#!/usr/bin/env bun
import { join } from "node:path";
import { prepareTestFixture } from "../src/test-fixture.ts";

const args = process.argv.slice(2);
const prepareOnly = args.includes("--prepare-only");
const forwarded = args.filter((arg) => arg !== "--reset" && arg !== "--prepare-only");
const fixture = await prepareTestFixture({ reset: true });

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
  ...forwarded,
], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
process.exit(await child.exited);
