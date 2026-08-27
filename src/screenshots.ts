import { copyFile, lstat, mkdir, readFile, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ReviewScreenshot } from "./types.ts";

const MAX_SCREENSHOTS = 12;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

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
  if (header.slice(4, 8) === "ftyp") return { mimeType: "video/mp4", extension: "mp4" };
  return undefined;
}

export function screenshotAssetDirectory(stateFile: string): string {
  return `${stateFile}.assets/screenshots`;
}

export function screenshotAssetPath(stateFile: string, screenshot: ReviewScreenshot): string {
  return join(screenshotAssetDirectory(stateFile), screenshot.fileName);
}

export async function importReviewScreenshots(paths: string[], stateFile: string, existing: ReviewScreenshot[] = []): Promise<ReviewScreenshot[]> {
  if (existing.length + paths.length > MAX_SCREENSHOTS) throw new Error(`A review can contain at most ${MAX_SCREENSHOTS} media files.`);
  if (paths.length === 0) return existing;
  const directory = screenshotAssetDirectory(stateFile);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const imported = [...existing];
  const copied: string[] = [];
  try {
    for (const source of paths) {
      const metadata = await lstat(source);
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`Media must be a regular file: ${source}`);
      const signature = new Uint8Array(await readFile(source)).slice(0, 16);
      const format = detectRasterImage(signature);
      if (!format) throw new Error(`Unsupported media format (use PNG, JPEG, GIF, WebP, or MP4): ${source}`);
      const maximum = format.mimeType === "video/mp4" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
      if (metadata.size <= 0 || metadata.size > maximum) throw new Error(`Media exceeds its size limit (${format.mimeType === "video/mp4" ? "100 MiB" : "15 MiB"}): ${source}`);
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
