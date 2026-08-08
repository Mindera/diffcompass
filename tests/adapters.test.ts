import { expect, test } from "bun:test";
import { parseCodexModelList } from "../src/adapters.ts";

test("parses the visible Codex model catalog and effort metadata", () => {
  const output = [
    JSON.stringify({ id: 1, result: { userAgent: "test" } }),
    JSON.stringify({ id: 2, result: { data: [
      {
        id: "gpt-example",
        displayName: "GPT Example",
        isDefault: true,
        hidden: false,
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: [
          { reasoningEffort: "low", description: "Fast" },
          { reasoningEffort: "ultra", description: "Deep" },
        ],
      },
      { id: "hidden-example", hidden: true },
    ] } }),
  ].join("\n");

  expect(parseCodexModelList(output)).toEqual([{
    id: "gpt-example",
    label: "GPT Example",
    isDefault: true,
    defaultReasoningEffort: "medium",
    reasoningEfforts: ["low", "ultra"],
  }]);
});

test("ignores notifications and malformed JSON while waiting for model/list", () => {
  expect(parseCodexModelList('not-json\n{"method":"status/changed","params":{}}')).toEqual([]);
});
