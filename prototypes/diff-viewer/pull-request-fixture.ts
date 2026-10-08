import type { PullRequestContext } from "../../src/types.ts";
import { files, locate } from "./fixtures.mjs";

// Synthetic, opt-in review data. No GitHub client or real remote is involved.
export function pullRequestFixture(repo: string, base: string, head: string): PullRequestContext {
  const file = files[0]!;
  const message = (id: string, author: string, body: string) => ({
    id, author: `${author} (fixture)`, body, url: `https://example.invalid/comments/${id}`,
  });
  return {
    repository: "fixture/checkout", number: 42, url: "https://example.invalid/fixture/pull/42",
    title: "[Fixture] Percentage discounts and receipt formatting",
    body: "Synthetic PR comments for the diff viewer comparison. No GitHub connection.",
    author: "Sam (fixture)", baseRefName: "main", baseRefOid: base,
    headRefName: "fixture/percentage-discounts", headRefOid: head,
    sourceRepositoryRoot: repo, workspaceRoot: repo, refNamespace: "refs/diffcompass/fixture-pr",
    state: "OPEN", commits: [], checks: [], threadsTruncated: false,
    updatedAt: new Date().toISOString(),
    threads: [
      { id: "fixture-pr-before", path: file.path, side: "old", line: locate(file.old, "return amount -"), resolved: false,
        comments: [
          message("fixture-pr-before-1", "Alex", "This subtracts a fixed amount. Should a 20% discount instead multiply the total by 0.8?"),
          message("fixture-pr-before-2", "Sam", "Yes. The replacement below uses a percentage; please check the new calculation."),
        ] },
      { id: "fixture-pr-after", path: file.path, side: "new", line: locate(file.new, "return amount *"), resolved: false,
        comments: [
          message("fixture-pr-after-1", "Priya", "Could we add tests for 0%, 100%, and an out-of-range percentage?"),
          message("fixture-pr-after-2", "Sam", "Agreed. The clamp handles the bounds, but those cases should be explicit in tests."),
        ] },
      { id: "fixture-pr-resolved", path: file.path, side: "new", line: locate(file.new, "amount.toFixed(2)"), resolved: true,
        comments: [
          message("fixture-pr-resolved-1", "Alex", "Please format the displayed receipt total with two decimal places."),
          message("fixture-pr-resolved-2", "Sam", "Updated the receipt formatting. Resolving this thread."),
        ] },
    ],
  };
}
