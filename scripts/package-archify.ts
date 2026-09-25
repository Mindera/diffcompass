/** Build-time only. End-user installations never fetch or install a renderer. */
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const revision = "9e35d2b0b39b155553ba9fcfe0b4f2a5198dd993";
const sha256 = "24b38bf7ea6de8d2d77d32c1a7320caa34846b83e96da393ebe2a66015a2fb1b";
const destination = process.argv[2];
if (!destination) throw new Error("Usage: bun scripts/package-archify.ts <new destination directory>");
const archive = process.env.CODE_REVIEW_TOUR_ARCHIFY_SOURCE_ARCHIVE;
const bytes = archive ? await readFile(archive) : new Uint8Array(await (async () => {
  const response = await fetch(`https://codeload.github.com/tt-a1i/archify/tar.gz/${revision}`);
  if (!response.ok) throw new Error(`Archify download failed: ${response.status}`);
  return response.arrayBuffer();
})());
if (createHash("sha256").update(bytes).digest("hex") !== sha256) throw new Error("Archify archive checksum mismatch");
const temporary = await mkdtemp(join(tmpdir(), "crt-archify-package-"));
try {
  const tarball = join(temporary, "source.tar.gz");
  await writeFile(tarball, bytes);
  const extraction = Bun.spawn(["tar", "-xzf", tarball, "-C", temporary], { stdout: "inherit", stderr: "inherit" });
  if (await extraction.exited !== 0) throw new Error("Archify extraction failed");
  const source = join(temporary, `archify-${revision}`, "archify");
  const target = resolve(destination);
  // Refuse to mix pinned files with a previous renderer version.
  await mkdir(target);
  for (const entry of ["bin", "renderers", "assets", "schemas", "delta", "LICENSE", "THIRD_PARTY_NOTICES.md", "package.json"]) {
    await cp(join(source, entry), join(target, entry), { recursive: true });
  }
  await mkdir(join(target, "scripts"));
  await cp(new URL("./archify-ajv-LICENSE.txt", import.meta.url), join(target, "Ajv-LICENSE.txt"));
  await cp(join(source, "scripts/check-render-output.mjs"), join(target, "scripts/check-render-output.mjs"));
  // Optional logo artwork has separate licenses; our code-derived maps do not use it.
  await writeFile(join(target, "renderers/shared/generated-brand-marks.mjs"), "// Code Review Tour distribution: optional third-party logos omitted.\nexport const BRAND_MARKS = Object.freeze([]);\n");
  await writeFile(join(target, "BUNDLE.json"), JSON.stringify({ repository: "https://github.com/tt-a1i/archify", revision, sha256, modifications: ["Optional brand-mark catalog omitted"], runtime: "Code Review Tour embedded Bun runtime" }, null, 2) + "\n");
  console.log(`Packaged Archify ${revision} in ${target}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
