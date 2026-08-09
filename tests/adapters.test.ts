import { expect, test } from "bun:test";
import { parseCodexModelList, parseCopilotModelList } from "../src/adapters.ts";

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

test("parses Copilot models from the installed CLI help catalog", () => {
  const models = parseCopilotModelList(`GitHub Copilot CLI

Supported models:
  auto                  Choose an available model automatically
  claude-sonnet-4.6     General-purpose coding
  gpt-5.4               Complex reasoning

Tool availability values:
  view                   Read files
`);

  expect(models.map(({ id, isDefault }) => ({ id, isDefault }))).toEqual([
    { id: "auto", isDefault: true },
    { id: "claude-sonnet-4.6", isDefault: false },
    { id: "gpt-5.4", isDefault: false },
  ]);
  expect(models[0]?.reasoningEfforts).toEqual(["low", "medium", "high", "xhigh", "max"]);
});

test("does not mistake arbitrary help flags for Copilot models", () => {
  expect(parseCopilotModelList("Options:\n  --model MODEL\n  --allow-all")).toEqual([]);
});
