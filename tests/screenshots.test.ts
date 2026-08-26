import { afterEach, expect, test } from "bun:test";
import { access, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importReviewScreenshots } from "../src/screenshots.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

test("screenshot imports are session-owned and a failed batch leaves no partial copies", async () => {
  const directory = await mkdtemp(join(tmpdir(), "review-tour-screenshots-"));
  directories.push(directory);
  const valid = join(directory, "built.png");
  const invalid = join(directory, "not-an-image.txt");
  const stateFile = join(directory, "session.json");
  await writeFile(valid, Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0]));
  await writeFile(invalid, "plain text");

  await expect(importReviewScreenshots([valid, invalid], stateFile)).rejects.toThrow("Unsupported screenshot format");
  expect(await readdir(`${stateFile}.assets/screenshots`)).toEqual([]);

  const imported = await importReviewScreenshots([valid], stateFile);
  expect(imported).toHaveLength(1);
  expect(imported[0]).toMatchObject({ name: "built.png", mimeType: "image/png", size: 9 });
  await expect(access(join(`${stateFile}.assets/screenshots`, imported[0]!.fileName))).resolves.toBeNull();
});
