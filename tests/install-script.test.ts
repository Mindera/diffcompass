import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, readlink, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const repositoryRoot = join(import.meta.dir, "..");
const releaseBase = "https://github.com/Mindera/diffcompass/releases/download";
const latestUrl = "https://github.com/Mindera/diffcompass/releases/latest";
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
if (url === ${JSON.stringify(latestUrl)} && process.env.FAKE_LATEST_FAIL === "1") {
  console.error("curl: (22) The requested URL returned error: 404");
  process.exit(22);
}
if (url === ${JSON.stringify(latestUrl)} && args.includes("--write-out")) {
  process.stdout.write(args.includes("--location") ? (process.env.FAKE_LATEST_URL ?? "") : url);
  process.exit(0);
}
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
exit 99
`);
  await chmod(join(root, "bin", "gh"), 0o700);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

type Defect = "wrong-hash" | "other-file" | "no-archive";

async function release(tag: string, defect?: Defect) {
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
  if (defect === "no-archive") await rm(archive);
  const listed = defect === "other-file" ? "other.tar.gz" : `${name}.tar.gz`;
  const listedHash = defect === "wrong-hash" ? "0".repeat(64) : hash;
  await writeFile(join(directory, "checksums.txt"), `${listedHash}  ./${listed}\n`);
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
      FAKE_LATEST_URL: "https://github.com/Mindera/diffcompass/releases/tag/v9.9.9",
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
  await release("v9.9.9");
  await release("v9.9.8");
  await release("v9.9.7", "wrong-hash");
  await release("v9.9.6", "other-file");
  await release("v9.9.5", "no-archive");
}

async function expectNoGh() {
  expect(await stat(join(root, "gh.log")).catch(() => null)).toBeNull();
}

async function exists(path: string) {
  return (await stat(path).catch(() => null)) !== null;
}

skipOnWindows("--version accepts a tag with the leading v", async () => {
  await stageReleases();
  const result = await run(["--version", "v9.9.8"]);
  expect(result.stderr).toBe("");
  await expectNoGh();
  expect(result.code).toBe(0);
  expect(requestedUrls(result.curl)).toEqual(expectedUrls("v9.9.8"));
  expect(await readlink(join(root, "install", "current"))).toBe(join(root, "install", "9.9.8"));
}, 20000);

skipOnWindows("--version accepts a tag without the leading v", async () => {
  await stageReleases();
  const result = await run(["--version", "9.9.8"]);
  expect(result.stderr).toBe("");
  await expectNoGh();
  expect(result.code).toBe(0);
  expect(requestedUrls(result.curl)).toEqual(expectedUrls("v9.9.8"));
  expect(await readlink(join(root, "install", "current"))).toBe(join(root, "install", "9.9.8"));
}, 20000);

skipOnWindows("DIFFCOMPASS_VERSION is normalised the same way", async () => {
  await stageReleases();
  const result = await run([], { DIFFCOMPASS_VERSION: "9.9.8" });
  expect(result.stderr).toBe("");
  await expectNoGh();
  expect(result.code).toBe(0);
  expect(requestedUrls(result.curl)).toEqual(expectedUrls("v9.9.8"));
  expect(await readlink(join(root, "install", "current"))).toBe(join(root, "install", "9.9.8"));
}, 20000);

skipOnWindows("the --version flag wins over DIFFCOMPASS_VERSION", async () => {
  await stageReleases();
  const result = await run(["--version", "v9.9.8"], { DIFFCOMPASS_VERSION: "v9.9.7" });
  await expectNoGh();
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
    await expectNoGh();
  }
}, 20000);

skipOnWindows("--version with a malformed tag is rejected before any request", async () => {
  await stageReleases();
  const result = await run(["--version", "9.9"]);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("Unsupported DiffCompass version: v9.9");
  expect(result.curl).toEqual([]);
  await expectNoGh();
}, 20000);

const latestRequest = [latestUrl, ...expectedUrls("v9.9.9")];

skipOnWindows("no version resolves the latest tag from the releases/latest redirect", async () => {
  await stageReleases();
  const result = await run([]);
  expect(result.stderr).toBe("");
  expect(result.code).toBe(0);
  expect(requestedUrls(result.curl)).toEqual(latestRequest);
  expect(result.curl[0]).toContain("--write-out");
  expect(await readlink(join(root, "install", "current"))).toBe(join(root, "install", "9.9.9"));
  await expectNoGh();
}, 20000);

skipOnWindows("DIFFCOMPASS_VERSION=latest resolves the latest tag the same way", async () => {
  await stageReleases();
  const result = await run([], { DIFFCOMPASS_VERSION: "latest" });
  expect(result.stderr).toBe("");
  expect(result.code).toBe(0);
  expect(requestedUrls(result.curl)).toEqual(latestRequest);
  expect(result.curl[0]).toContain("--write-out");
  expect(await readlink(join(root, "install", "current"))).toBe(join(root, "install", "9.9.9"));
  await expectNoGh();
}, 20000);

skipOnWindows("a latest redirect that does not name a tag is rejected without installing", async () => {
  await stageReleases();
  const result = await run([], { FAKE_LATEST_URL: "https://github.com/Mindera/diffcompass/releases" });
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("Could not resolve the latest DiffCompass release");
  expect(requestedUrls(result.curl)).toEqual([latestUrl]);
  expect(await exists(join(root, "install", "9.9.9"))).toBe(false);
  expect(await exists(join(root, "install", "current"))).toBe(false);
  await expectNoGh();
}, 20000);

skipOnWindows("a failed download or checksum leaves the current install and command untouched", async () => {
  await stageReleases();
  const first = await run(["--version", "v9.9.8"]);
  expect(first.code).toBe(0);
  const cases: [string, string][] = [
    ["v9.9.7", "Checksum verification failed"],
    ["v9.9.6", "No checksum found"],
    ["v9.9.5", "returned error: 404"],
  ];
  for (const [tag, message] of cases) {
    const result = await run(["--version", tag]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain(message);
    expect(await readlink(join(root, "install", "current"))).toBe(join(root, "install", "9.9.8"));
    expect(await readlink(join(root, "links", "diffcompass"))).toBe(join(root, "install", "current", "bin", "diffcompass"));
    expect(await exists(join(root, "install", tag.replace(/^v/, "")))).toBe(false);
    const command = Bun.spawn([join(root, "links", "diffcompass")], { stdout: "pipe", stderr: "pipe" });
    const [output, commandCode] = await Promise.all([new Response(command.stdout).text(), command.exited]);
    expect(output).toBe("9.9.8\n");
    expect(commandCode).toBe(0);
  }
  await expectNoGh();
}, 20000);

skipOnWindows("a failed latest lookup aborts without installing", async () => {
  await stageReleases();
  const first = await run(["--version", "v9.9.8"]);
  expect(first.code).toBe(0);
  const result = await run([], { FAKE_LATEST_FAIL: "1" });
  expect(result.code).not.toBe(0);
  expect(requestedUrls(result.curl.slice(first.curl.length))).toEqual([latestUrl]);
  expect(await readlink(join(root, "install", "current"))).toBe(join(root, "install", "9.9.8"));
  expect(await exists(join(root, "install", "9.9.9"))).toBe(false);
  await expectNoGh();
}, 20000);

skipOnWindows("DIFFCOMPASS_ARCHIVE installs the local archive without any request", async () => {
  await stageReleases();
  const archive = join(root, "releases", "v9.9.8", `diffcompass-v9.9.8-${platform}-${architecture}.tar.gz`);
  const result = await run(["--version", "v9.9.9"], { DIFFCOMPASS_ARCHIVE: archive });
  expect(result.code).toBe(0);
  expect(result.curl).toEqual([]);
  expect(await readlink(join(root, "install", "current"))).toBe(join(root, "install", "9.9.8"));
  await expectNoGh();
}, 20000);

test("the installer never calls gh and says nothing about private access", async () => {
  const text = await readFile(join(repositoryRoot, "scripts", "install.sh"), "utf8");
  expect(text).not.toMatch(/(^|[\s;&|(])gh\s/m);
  expect(text).not.toMatch(/private/i);
});
