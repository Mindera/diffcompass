import { copyFile, lstat, mkdir, readFile, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ReviewScreenshot } from "./types.ts";

const MAX_SCREENSHOTS = 12;
const MAX_SCREENSHOT_BYTES = 15 * 1024 * 1024;

function detectRasterImage(bytes: Uint8Array): { mimeType: ReviewScreenshot["mimeType"]; extension: string } | undefined {
  if (bytes.length >= 8 && bytes.slice(0, 8).every((byte, index) => byte === [137, 80, 78, 71, 13, 10, 26, 10][index])) {
    return { mimeType: "image/png", extension: "png" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }
  const header = new TextDecoder().decode(bytes.slice(0, 12));
  if (header.startsWith("GIF87a") || header.startsWith("GIF89a")) return { mimeType: "image/gif", extension: "gif" };
  if (header.startsWith("RIFF") && header.slice(8, 12) === "WEBP") return { mimeType: "image/webp", extension: "webp" };
  return undefined;
}

export function screenshotAssetDirectory(stateFile: string): string {
  return `${stateFile}.assets/screenshots`;
}

export function screenshotAssetPath(stateFile: string, screenshot: ReviewScreenshot): string {
  return join(screenshotAssetDirectory(stateFile), screenshot.fileName);
}

export async function importReviewScreenshots(paths: string[], stateFile: string, existing: ReviewScreenshot[] = []): Promise<ReviewScreenshot[]> {
  if (existing.length + paths.length > MAX_SCREENSHOTS) throw new Error(`A review can contain at most ${MAX_SCREENSHOTS} screenshots.`);
  if (paths.length === 0) return existing;
  const directory = screenshotAssetDirectory(stateFile);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const imported = [...existing];
  const copied: string[] = [];
  try {
    for (const source of paths) {
      const metadata = await lstat(source);
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`Screenshot must be a regular file: ${source}`);
      if (metadata.size <= 0 || metadata.size > MAX_SCREENSHOT_BYTES) throw new Error(`Screenshot must be between 1 byte and 15 MiB: ${source}`);
      const signature = new Uint8Array(await readFile(source)).slice(0, 16);
      const format = detectRasterImage(signature);
      if (!format) throw new Error(`Unsupported screenshot format (use PNG, JPEG, GIF, or WebP): ${source}`);
      const id = crypto.randomUUID();
      const fileName = `${id}.${format.extension}`;
      const destination = join(directory, fileName);
      await copyFile(source, destination);
      copied.push(destination);
      imported.push({ id, name: basename(source), mimeType: format.mimeType, size: metadata.size, fileName });
    }
  } catch (error) {
    await Promise.all(copied.map((path) => unlink(path).catch(() => undefined)));
    throw error;
  }
  return imported;
}
