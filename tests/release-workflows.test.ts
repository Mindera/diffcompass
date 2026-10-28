import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

type WorkflowStep = { uses?: string; with?: Record<string, unknown>; shell?: string; run?: string };
type WorkflowJob = { needs?: string | string[]; strategy?: { matrix?: { os?: string[] } }; steps?: WorkflowStep[] };
type Workflow = { jobs: Record<string, WorkflowJob> };

async function readWorkflow(name: string): Promise<Workflow> {
  const text = await readFile(join(root, ".github/workflows", name), "utf8");
  return Bun.YAML.parse(text) as Workflow;
}

async function releaseFiles(): Promise<string[]> {
  const workflow = await readWorkflow("release.yml");
  const step = workflow.jobs.release?.steps?.find((candidate) => candidate.uses?.startsWith("softprops/action-gh-release"));
  const files = step?.with?.files;
  return (typeof files === "string" ? files : "")
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

test("a final job installs the published release on all three platforms", async () => {
  const workflow = await readWorkflow("release.yml");
  const job = workflow.jobs["verify-published"];
  expect(job).toBeDefined();
  expect([job.needs].flat()).toEqual(["release"]);
  expect(job.strategy?.matrix?.os).toEqual(["ubuntu-latest", "macos-latest", "windows-latest"]);
  const steps = job.steps ?? [];
  for (const step of steps) {
    expect(["bash", "powershell"]).toContain(step.shell ?? "");
    expect(step.run ?? "").not.toMatch(/\|\s*(bash|sh)\b/);
  }
  const bash = steps.filter((step) => step.shell === "bash").map((step) => step.run ?? "");
  const powershell = steps.filter((step) => step.shell === "powershell").map((step) => step.run ?? "");
  expect(bash.some((run) => run.includes('--version "$TAG"'))).toBe(true);
  expect(bash.some((run) => run.includes("latest/download/install.sh"))).toBe(true);
  expect(powershell.some((run) => run.includes("-Version $env:TAG"))).toBe(true);
  expect(powershell.some((run) => run.includes("latest/download/install.ps1"))).toBe(true);
  expect(powershell.some((run) => run.includes("| iex"))).toBe(true);
});
