import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const repositoryRoot = join(import.meta.dir, "..");
const releaseBase = "https://github.com/Mindera/diffcompass/releases/download";
const platform = process.platform === "darwin" ? "darwin" : "linux";
const architecture = process.arch === "arm64" ? "arm64" : "x64";
const skipOnWindows = test.skipIf(process.platform === "win32");

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "diffcompass-install-test-"));
  for (const directory of ["bin", "releases", "install", "links", "skills"]) await mkdir(join(root, directory));
  await writeFile(join(root, "bin", "curl"), `#!${process.execPath}
import { appendFileSync, copyFileSync, existsSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_CURL_LOG, JSON.stringify(args) + "\\n");
const url = args.find((argument) => argument.startsWith("https://")) ?? "";
const target = args[args.indexOf("--output") + 1];
const prefix = ${JSON.stringify(`${releaseBase}/`)};
if (url.startsWith(prefix) && target) {
  const source = process.env.FAKE_RELEASES + "/" + url.slice(prefix.length);
  if (existsSync(source)) {
    copyFileSync(source, target);
    process.exit(0);
  }
}
console.error("curl: (22) The requested URL returned error: 404");
process.exit(22);
`);
  await chmod(join(root, "bin", "curl"), 0o700);
  await writeFile(join(root, "bin", "gh"), `#!/bin/sh
echo "$@" >> "$FAKE_GH_LOG"
exit 1
`);
  await chmod(join(root, "bin", "gh"), 0o700);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function release(tag: string) {
  const name = `diffcompass-${tag}-${platform}-${architecture}`;
  const staging = join(root, "staging", tag);
  await mkdir(join(staging, name, "bin"), { recursive: true });
  await mkdir(join(staging, name, "share", "diffcompass"), { recursive: true });
  await writeFile(join(staging, name, "bin", "diffcompass"), `#!/bin/sh\necho ${tag.replace(/^v/, "")}\n`);
  await chmod(join(staging, name, "bin", "diffcompass"), 0o755);
  await writeFile(join(staging, name, "share", "diffcompass", "install.sh"), "#!/bin/sh\n");
  const directory = join(root, "releases", tag);
  await mkdir(directory, { recursive: true });
  const archive = join(directory, `${name}.tar.gz`);
  const tar = Bun.spawn(["tar", "-czf", archive, "-C", staging, name], {
    env: { ...process.env, COPYFILE_DISABLE: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await tar.exited).toBe(0);
  const hash = new Bun.CryptoHasher("sha256").update(await Bun.file(archive).bytes()).digest("hex");
  await writeFile(join(directory, "checksums.txt"), `${hash}  ./${name}.tar.gz\n`);
}

async function run(args: string[], env: Record<string, string> = {}) {
  const child = Bun.spawn(["bash", "scripts/install.sh", "--minimal", ...args], {
    cwd: repositoryRoot,
    env: {
      PATH: `${join(root, "bin")}:${process.env.PATH}`,
      TMPDIR: process.env.TMPDIR ?? "/tmp",
      HOME: root,
      DIFFCOMPASS_INSTALL_ROOT: join(root, "install"),
      DIFFCOMPASS_BIN_ROOT: join(root, "links"),
      DIFFCOMPASS_CODEX_SKILL_ROOT: join(root, "skills", "codex"),
      DIFFCOMPASS_CLAUDE_SKILL_ROOT: join(root, "skills", "claude"),
      DIFFCOMPASS_GEMINI_SKILL_ROOT: join(root, "skills", "gemini"),
      DIFFCOMPASS_COPILOT_SKILL_ROOT: join(root, "skills", "copilot"),
      FAKE_RELEASES: join(root, "releases"),
      FAKE_CURL_LOG: join(root, "curl.log"),
      FAKE_GH_LOG: join(root, "gh.log"),
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  const log = await readFile(join(root, "curl.log"), "utf8").catch(() => "");
  const curl = log.split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);
  return { code, stdout, stderr, curl };
}

function requestedUrls(curl: string[][]) {
  return curl.map((args) => args.find((argument) => argument.startsWith("https://")));
}

function expectedUrls(tag: string) {
  return [`${releaseBase}/${tag}/diffcompass-${tag}-${platform}-${architecture}.tar.gz`, `${releaseBase}/${tag}/checksums.txt`];
}

async function stageReleases() {
  await release("v9.9.8");
  await release("v9.9.7");
}

skipOnWindows("--version accepts a tag with the leading v", async () => {
  await stageReleases();
  const result = await run(["--version", "v9.9.8"]);
  expect(result.stderr).toBe("");
  expect(result.code).toBe(0);
  expect(requestedUrls(result.curl)).toEqual(expectedUrls("v9.9.8"));
  expect(await readlink(join(root, "install", "current"))).toBe(join(root, "install", "9.9.8"));
}, 20000);

skipOnWindows("--version accepts a tag without the leading v", async () => {
  await stageReleases();
  const result = await run(["--version", "9.9.8"]);
  expect(result.stderr).toBe("");
  expect(result.code).toBe(0);
  expect(requestedUrls(result.curl)).toEqual(expectedUrls("v9.9.8"));
  expect(await readlink(join(root, "install", "current"))).toBe(join(root, "install", "9.9.8"));
}, 20000);

skipOnWindows("DIFFCOMPASS_VERSION is normalised the same way", async () => {
  await stageReleases();
  const result = await run([], { DIFFCOMPASS_VERSION: "9.9.8" });
  expect(result.stderr).toBe("");
  expect(result.code).toBe(0);
  expect(requestedUrls(result.curl)).toEqual(expectedUrls("v9.9.8"));
  expect(await readlink(join(root, "install", "current"))).toBe(join(root, "install", "9.9.8"));
}, 20000);

skipOnWindows("the --version flag wins over DIFFCOMPASS_VERSION", async () => {
  await stageReleases();
  const result = await run(["--version", "v9.9.8"], { DIFFCOMPASS_VERSION: "v9.9.7" });
  expect(result.code).toBe(0);
  expect(requestedUrls(result.curl)).toEqual(expectedUrls("v9.9.8"));
  expect(await readlink(join(root, "install", "current"))).toBe(join(root, "install", "9.9.8"));
}, 20000);

skipOnWindows("--version without a value is rejected before any request", async () => {
  await stageReleases();
  for (const args of [["--version"], ["--version", "--minimal"]]) {
    const result = await run(args);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("--version requires a value");
    expect(result.curl).toEqual([]);
  }
}, 20000);

skipOnWindows("--version with a malformed tag is rejected before any request", async () => {
  await stageReleases();
  const result = await run(["--version", "9.9"]);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("Unsupported DiffCompass version: v9.9");
  expect(result.curl).toEqual([]);
}, 20000);
