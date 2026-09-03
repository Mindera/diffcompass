import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

test("the attached-agent skill defaults to bounded polling and scopes continuous watch to persistent hosts", async () => {
  const skill = await readFile(join(root, "skills/code-review-tour/SKILL.md"), "utf8");
  expect(skill).toContain("Poll for work with one bounded");
  expect(skill).toContain("Do not put repeated polls in one long-running Bash loop");
  expect(skill).toContain("invoke `bridge next` again immediately");
  expect(skill).toContain("It blocks until an event exists");
  expect(skill).toContain("bounds one internal HTTP long poll");
  expect(skill).toContain("not the lifetime of the command");
  expect(skill).toContain("Never run it through a shell tool with a command");
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

test("the attached-agent skill keeps reviewer conversations concise, contextual, and scoped", async () => {
  const skill = await readFile(join(root, "skills/code-review-tour/SKILL.md"), "utf8");
  expect(skill).toContain("Lead with the direct answer and default to a concise response");
  expect(skill).toContain("preceding reviewer conversation");
  expect(skill).toContain("Once the reviewer clarifies the intended scope, follow that clarification");
  expect(skill).toContain("without substituting a preferred implementation or relitigating the choice");
  expect(skill).toContain("Do not narrate tool limitations or offer unrelated follow-up work");
});

test("the attached-agent skill resolves feedback without inventing edits or unrelated fixes", async () => {
  const skill = await readFile(join(root, "skills/code-review-tour/SKILL.md"), "utf8");
  expect(skill).toContain("comments` together as concerns to resolve");
  expect(skill).toContain("For an investigative question, verify the concern");
  expect(skill).toContain("For a pure clarification, report the answer without inventing an edit");
  expect(skill).toContain("Every repository change after review closure must be directly required");
  expect(skill).toContain("report independently discovered issues separately");
});
