import { execFile } from "node:child_process";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

export function previewStorageKey(storageKey: string): string {
  const normalized = storageKey.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new Error("STORAGE_PATH_INVALID");
  }
  return path.posix.join(path.posix.dirname(normalized), "preview.mp3");
}

export async function createAudioPreview(source: string, destination: string): Promise<void> {
  const existing = await stat(destination).catch(() => null);
  if (existing?.isFile() && existing.size > 0) return;
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp`;
  await rm(temporary, { force: true });
  try {
    await execute("ffmpeg", [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      source,
      "-map",
      "0:a:0",
      "-vn",
      "-codec:a",
      "libmp3lame",
      "-b:a",
      "128k",
      "-ac",
      "2",
      "-ar",
      "44100",
      "-f",
      "mp3",
      "-y",
      temporary,
    ], { timeout: 30 * 60 * 1000, maxBuffer: 1024 * 1024, windowsHide: true });
    const output = await stat(temporary);
    if (!output.isFile() || output.size === 0) throw new Error("AUDIO_PREVIEW_EMPTY");
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}
