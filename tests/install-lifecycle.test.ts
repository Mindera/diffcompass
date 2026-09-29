import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLifecycleCommand } from "../src/install-lifecycle.ts";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "diffcompass-install-"));
  roots.push(root);
  const installRoot = join(root, "install");
  const binRoot = join(root, "bin");
  const env = {
    HOME: root,
    DIFFCOMPASS_INSTALL_ROOT: installRoot,
    DIFFCOMPASS_BIN_ROOT: binRoot,
    DIFFCOMPASS_CODEX_SKILL_ROOT: join(root, "codex"),
    DIFFCOMPASS_CLAUDE_SKILL_ROOT: join(root, "claude"),
    DIFFCOMPASS_GEMINI_SKILL_ROOT: join(root, "gemini"),
    DIFFCOMPASS_COPILOT_SKILL_ROOT: join(root, "copilot"),
    DIFFCOMPASS_STATE_ROOT: join(root, "state"),
  };
  for (const version of ["0.8.0", "0.9.0"]) {
    await mkdir(join(installRoot, version, "bin"), { recursive: true });
    await writeFile(join(installRoot, version, "bin", "diffcompass"), version);
  }
  await mkdir(binRoot, { recursive: true });
  await symlink(join(installRoot, "0.9.0"), join(installRoot, "current"));
  await symlink(join(installRoot, "current", "bin", "diffcompass"), join(binRoot, "diffcompass"));
  await writeFile(join(installRoot, "history.json"), '["0.8.0","0.9.0"]\n');
  for (const skillRoot of [env.DIFFCOMPASS_CODEX_SKILL_ROOT, env.DIFFCOMPASS_CLAUDE_SKILL_ROOT]) {
    await mkdir(skillRoot, { recursive: true });
    await symlink(join(installRoot, "current", "share", "diffcompass", "skills", "diffcompass"), join(skillRoot, "diffcompass"));
  }
  await mkdir(env.DIFFCOMPASS_STATE_ROOT, { recursive: true });
  await writeFile(join(env.DIFFCOMPASS_STATE_ROOT, "session.json"), "{}");
  return { root, installRoot, binRoot, env };
}

describe("install lifecycle", () => {
  test("rollback switches only installer-managed pointers", async () => {
    const { installRoot, binRoot, env } = await fixture();
    expect(await runLifecycleCommand("rollback", [], { env, platform: "linux" })).toContain("0.8.0");
    expect(await readlink(join(installRoot, "current"))).toBe(join(installRoot, "0.8.0"));
    expect(await readFile(join(binRoot, "diffcompass"), "utf8")).toBe("0.8.0");
  });

  test("uninstall previews by default and preserves state", async () => {
    const { installRoot, env } = await fixture();
    const preview = await runLifecycleCommand("uninstall", [], { env, platform: "linux" });
    expect(preview).toContain("Repeat with --yes");
    expect(await readFile(join(installRoot, "history.json"), "utf8")).toContain("0.9.0");
    await runLifecycleCommand("uninstall", ["--yes"], { env, platform: "linux" });
    expect(await Bun.file(join(env.DIFFCOMPASS_STATE_ROOT, "session.json")).exists()).toBe(true);
  });

  test("purge removes review state and unmanaged skills are preserved", async () => {
    const { root, env } = await fixture();
    const unmanaged = join(root, "gemini", "diffcompass");
    await mkdir(unmanaged, { recursive: true });
    await writeFile(join(unmanaged, "SKILL.md"), "mine");
    await runLifecycleCommand("uninstall", ["--yes", "--purge"], { env, platform: "linux" });
    expect(await Bun.file(join(unmanaged, "SKILL.md")).text()).toBe("mine");
    expect(await Bun.file(join(env.DIFFCOMPASS_STATE_ROOT, "session.json")).exists()).toBe(false);
  });

  test("update delegates to the bundled installer and validates options", async () => {
    const { root, env } = await fixture();
    const installer = join(root, "install.sh");
    await writeFile(installer, "#!/bin/sh\n");
    const updateEnv = { ...env, DIFFCOMPASS_INSTALLER: installer };
    let command: string[] = [];
    await runLifecycleCommand("update", ["--version", "v1.0.0", "--minimal"], { env: updateEnv, platform: "linux", spawn: async (value) => { command = value; return 0; } });
    expect(command).toEqual(["bash", installer, "--minimal"]);
    await writeFile(join(env.DIFFCOMPASS_INSTALL_ROOT, "install-mode"), "minimal\n");
    command = [];
    await runLifecycleCommand("update", [], { env: updateEnv, platform: "linux", spawn: async (value) => { command = value; return 0; } });
    expect(command).toEqual(["bash", installer, "--minimal"]);
    await expect(runLifecycleCommand("update", ["--wat"], { env: updateEnv, platform: "linux", spawn: async () => 0 })).rejects.toThrow("Unknown update option");
  });

  test("Windows rollback changes the version pointer without overwriting a running executable", async () => {
    const { installRoot, env } = await fixture();
    await writeFile(join(installRoot, "0.8.0", "bin", "diffcompass.exe"), "old");
    await writeFile(join(installRoot, "0.9.0", "bin", "diffcompass.exe"), "new");
    await writeFile(join(installRoot, "current-version"), "0.9.0\n");
    expect(await runLifecycleCommand("rollback", ["--to", "0.8.0"], { env, platform: "win32" })).toContain("0.8.0");
    expect((await readFile(join(installRoot, "current-version"), "utf8")).trim()).toBe("0.8.0");
  });

  test("uninstall refuses a directory without installer ownership metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "diffcompass-unmanaged-"));
    roots.push(root);
    await expect(runLifecycleCommand("uninstall", ["--yes"], {
      env: { HOME: root, DIFFCOMPASS_INSTALL_ROOT: join(root, "unmanaged") },
      platform: "linux",
    })).rejects.toThrow("ownership metadata");
  });
});
