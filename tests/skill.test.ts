import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

test("the attached-agent skill distinguishes continuous watch from bounded polling", async () => {
  const skill = await readFile(join(root, "skills/code-review-tour/SKILL.md"), "utf8");
  expect(skill).toContain("`bridge watch` blocks until an event exists");
  expect(skill).toContain("bounds one internal HTTP long poll, not the lifetime of the command");
  expect(skill).toContain("MUST NOT wrap `bridge watch` in its own timeout");
  expect(skill).toContain("use `bridge next`");
  expect(skill).toContain("If the host cannot keep an unbounded child process alive");
});

test("the attached-agent skill documents authoritative event and anchor shapes", async () => {
  const skill = await readFile(join(root, "skills/code-review-tour/SKILL.md"), "utf8");
  expect(skill).toContain("event's own JSON and complete prompt in full");
  expect(skill).toContain("{ path, side, startLine, endLine }");
  expect(skill).toContain("not `{ path, side, line }`");
  expect(skill).toContain("macOS does not provide `setsid`");
});

test("the attached-agent skill scopes preview redirects and media evidence", async () => {
  const skill = await readFile(join(root, "skills/code-review-tour/SKILL.md"), "utf8");
  expect(skill).toContain("Add `--preview-redirect` only when the host exposes the server through a preview");
  expect(skill).toContain("unrelated to the attached bridge token");
  expect(skill).toContain("separate `--media` argument");
  expect(skill).toContain("`--attached --open` also implies `--start-tour`");
  expect(skill).toContain("preparation failure leaves the server running without opening an empty tour");
});
