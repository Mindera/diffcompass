import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
function declaration(name: string) {
  const start = app.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Missing ${name}`);
  return app.slice(start, app.indexOf("\n}", start) + 2);
}
function navigation(outline: object) {
  const context = {
    state: { session: { outline } },
    componentArchitectureEntries: () => [], legacySequenceFlows: () => [], adaptiveEntries: () => [],
  };
  return runInNewContext(`${["savedCallFlows", "archifyArtifacts", "understandMapViews"].map(declaration).join("\n")}
    ({ flows: savedCallFlows(), artifacts: archifyArtifacts(), views: understandMapViews() })`, context);
}

test("all-converted and mixed saved reviews retain every native call flow", () => {
  for (const ids of [["linear"], ["linear", "branched"]]) {
    const result = navigation({
      callFlows: ids.map(id => ({ id })),
      archifyArtifacts: [{ id: "workflow-linear", type: "workflow" }],
    });
    expect(result.flows.map((flow: { id: string }) => flow.id)).toEqual(ids);
    expect(result.views).toEqual([{ id: "call-flows", label: "Call flows" }]);
    expect(result.artifacts).toEqual([]);
  }
});

test("saved workflow artifacts cannot create an empty call-flow option", () => {
  const result = navigation({ callFlows: [], archifyArtifacts: [{ id: "workflow-old", type: "workflow" }] });
  expect(result.views).toEqual([{ id: "archify", label: "Overview" }]);
});

test("architecture and sequence maps remain beside complete call flows", () => {
  const artifacts = [{ id: "architecture-main", type: "architecture" }, { id: "sequence-main", type: "sequence" }];
  const result = navigation({ callFlows: [{ id: "stale", outdated: true }], archifyArtifacts: [...artifacts, { id: "workflow-stale", type: "workflow" }] });
  expect(result.artifacts).toEqual(artifacts);
  expect(result.views.map((view: { id: string }) => view.id)).toEqual(["archify", "call-flows"]);
  expect(result.flows).toHaveLength(1);
});

test("briefing targets open and scroll to the native flow without resetting its mode", () => {
  const opened: string[] = [];
  const selected: string[] = [];
  const modes = new Map([["target", "before"]]);
  const context = {
    state: { session: { outline: { callFlows: [{ id: "target" }] } }, callFlowModes: modes },
    openMaps: (view: string) => opened.push(view), toast: (message: string) => opened.push(message),
    CSS: { escape: (id: string) => id }, window: { requestAnimationFrame: (callback: () => void) => callback() },
    document: { querySelector: (selector: string) => ({ scrollIntoView: () => selected.push(selector) }) },
  };
  runInNewContext(`${declaration("savedCallFlows")}\n${declaration("openCallFlow")}\nopenCallFlow("target"); openCallFlow("missing");`, context);
  expect(opened).toEqual(["call-flows", "This call flow is no longer available."]);
  expect(selected).toEqual(['[data-call-flow-id="target"]']);
  expect(modes.get("target")).toBe("before");
  expect(app).toContain("openCallFlow(target.dataset.attentionId)");
  expect(declaration("renderCallFlows")).not.toContain('state.activeTab = "diff"');
});
