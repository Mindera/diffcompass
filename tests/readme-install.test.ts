import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

const root = join(import.meta.dir, "..");

async function readme(): Promise<string> {
  return readFile(join(root, "README.md"), "utf8");
}

async function installSection(): Promise<string> {
  const text = await readme();
  const start = text.indexOf("## Install");
  const end = text.indexOf("\n## Run");
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return text.slice(start, end);
}

async function releaseFiles(): Promise<string[]> {
  const text = await readFile(join(root, ".github/workflows/release.yml"), "utf8");
  const workflow = Bun.YAML.parse(text) as {
    jobs: Record<string, { steps?: { uses?: string; with?: { files?: unknown } }[] }>;
  };
  const step = workflow.jobs.release?.steps?.find((candidate) => candidate.uses?.startsWith("softprops/action-gh-release"));
  const files = step?.with?.files;
  return (typeof files === "string" ? files : "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

test("the README documents the gh-free install one-liners and variants", async () => {
  const text = await readme();
  for (const snippet of [
    "curl -fsSL https://github.com/Mindera/diffcompass/releases/latest/download/install.sh | bash",
    "irm https://github.com/Mindera/diffcompass/releases/latest/download/install.ps1 | iex",
    'powershell -c "irm https://github.com/Mindera/diffcompass/releases/latest/download/install.ps1 | iex"',
    "bash -s -- --version vX.Y.Z",
    "bash -s -- --minimal",
    "-Version vX.Y.Z",
    "-Minimal",
    "v2.2.4 or earlier",
  ]) {
    expect(text).toContain(snippet);
  }
});

test("the install section has no private-repository or gh sign-in steps", async () => {
  const section = await installSection();
  for (const pattern of [/private/i, /request access/i, /gh auth/, /gh api/, /gh repo view/, /vnd\.github\.raw/]) {
    expect(section).not.toMatch(pattern);
  }
});

test("every latest-download link in the README names a published release asset", async () => {
  const text = await readme();
  const names = [...text.matchAll(/releases\/latest\/download\/([^\s)"'`]+)/g)].map((match) => match[1] ?? "");
  expect(names.length).toBeGreaterThan(0);
  const published = (await releaseFiles()).map((file) => basename(file));
  for (const name of names) {
    expect(published).toContain(name);
  }
});
