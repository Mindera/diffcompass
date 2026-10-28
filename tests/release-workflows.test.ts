import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

type WorkflowStep = { uses?: string; with?: Record<string, string> };
type Workflow = { jobs: Record<string, { steps?: WorkflowStep[] }> };

async function readWorkflow(name: string): Promise<Workflow> {
  const text = await readFile(join(root, ".github/workflows", name), "utf8");
  return Bun.YAML.parse(text) as Workflow;
}

async function releaseFiles(): Promise<string[]> {
  const workflow = await readWorkflow("release.yml");
  const step = workflow.jobs.release?.steps?.find((candidate) => candidate.uses?.startsWith("softprops/action-gh-release"));
  return (step?.with?.files ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

test("the release job uploads both installers as assets", async () => {
  const files = await releaseFiles();
  expect(files).toContain("dist/release/install.sh");
  expect(files).toContain("dist/release/install.ps1");
});

test("the release build stages both installers and lists them in checksums.txt", async () => {
  const script = await readFile(join(root, "scripts/build-release.sh"), "utf8");
  expect(script).toContain('cp scripts/install.sh scripts/install.ps1 "$release_root/"');
  expect(script).toContain("./install.sh ./install.ps1 > checksums.txt");
});
