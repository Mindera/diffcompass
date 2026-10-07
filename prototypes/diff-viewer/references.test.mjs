import { expect, test } from "bun:test";
import { referencePresentation, configureReferenceActions } from "./annotations.mjs";

test("name search never claims symbol-accurate or historical references", () => {
  const view = referencePresentation({ source: "repository-search", sourceLabel: "Repository search", notice: "Bounded search.", truncated: true }, { side: "old" });
  expect(view.heading).toBe("Possible references — name matches");
  expect(view.definitions).toBe("Possible definitions");
  expect(view.status).toContain("Current workspace");
  expect(view.status).toContain("not the original revision");
  expect(view.status).toContain("unrelated symbols");
  expect(view.status).toContain("truncated");
  expect(view.status).toContain("Bounded search.");
});
test("indexed candidates remain distinguished from language-server references", () => {
  expect(referencePresentation({ source: "codegraph", sourceLabel: "CodeGraph", notice: "Index may be stale." }, {}).heading).toBe("Indexed reference candidates");
  const view = referencePresentation({ source: "language-server", sourceLabel: "Language server", notice: "Workspace references." }, {});
  expect(view.heading).toBe("References");
  expect(view.status).toContain("Language server");
  expect(view.status).not.toContain("not the original revision");
});
test("unknown providers degrade to candidates, not precise references", () => {
  const view = referencePresentation({ source: "future", sourceLabel: "Future", notice: "" }, {});
  expect(view.heading).toBe("Reference candidates");
  expect(view.definitions).toBe("Possible definitions");
  expect(view.kind).toBe("candidate");
});
test("one custom references command preserves native definition, hover and other settings", () => {
  const defaults = () => ({ modeConfiguration: { references: true, definitions: true, hovers: true, completionItems: false }, setModeConfiguration(value) { this.modeConfiguration = value; } });
  const typescriptDefaults = defaults(), javascriptDefaults = defaults();
  configureReferenceActions({ languages: { typescript: { typescriptDefaults, javascriptDefaults } } });
  for (const value of [typescriptDefaults, javascriptDefaults]) expect(value.modeConfiguration).toEqual({ references: false, definitions: true, hovers: true, completionItems: false });
});
