import { expect, test } from "bun:test";
import { files, locate } from "./fixtures.mjs";
import { pullRequestFixture } from "./pull-request-fixture.ts";

test("sample PR threads use the fixture's exact Before/After source lines", () => {
  const pr = pullRequestFixture("/tmp/example", "a".repeat(40), "b".repeat(40));
  expect(pr.threads.map(t => [t.side, t.line, t.resolved])).toEqual([
    ["old", locate(files[0].old, "return amount -"), false],
    ["new", locate(files[0].new, "return amount *"), false],
    ["new", locate(files[0].new, "amount.toFixed(2)"), true],
  ]);
  expect(pr.threads.every(t => t.path === files[0].path && t.comments.length === 2)).toBe(true);
});
test("sample identity cannot link to a real repository or comment", () => {
  const pr = pullRequestFixture("/tmp/example", "a".repeat(40), "b".repeat(40));
  expect(new URL(pr.url).hostname).toBe("example.invalid");
  expect(pr.threads.every(t => t.comments.every(c => new URL(c.url).hostname === "example.invalid" && c.author.includes("(fixture)")))).toBe(true);
  const ids = pr.threads.flatMap(t => [t.id, ...t.comments.map(c => c.id)]);
  expect(new Set(ids).size).toBe(ids.length);
  expect(pr.baseRefOid).toBe("a".repeat(40));
  expect(pr.headRefOid).toBe("b".repeat(40));
});
test("sample PR snapshots are independent across launches", () => {
  const first = pullRequestFixture("/tmp/a", "a".repeat(40), "b".repeat(40));
  first.threads[0]!.resolved = true;
  const second = pullRequestFixture("/tmp/b", "a".repeat(40), "b".repeat(40));
  expect(second.threads[0]!.resolved).toBe(false);
  expect(second.workspaceRoot).toBe("/tmp/b");
});
