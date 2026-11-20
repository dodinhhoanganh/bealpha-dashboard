import { constants } from "node:fs";
import { open, realpath, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { DistributionError } from "./errors.js";

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/** Resolve aliases, validate the opened file, then stream that same descriptor. */
export async function openPackageDownload(
  packageRoot: string,
  filePath: string,
  expectedBytes: bigint,
  unavailableMessage: string,
) {
  let file: FileHandle | undefined;
  try {
    const root = path.resolve(packageRoot);
    const candidate = path.resolve(filePath);
    if (!inside(root, candidate)) throw new Error("PACKAGE_PATH_OUTSIDE_ROOT");
    const [resolvedRoot, resolvedFile] = await Promise.all([realpath(root), realpath(candidate)]);
    if (!inside(resolvedRoot, resolvedFile)) throw new Error("PACKAGE_PATH_OUTSIDE_ROOT");
    file = await open(resolvedFile, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const info = await file.stat();
    if (!info.isFile() || BigInt(info.size) !== expectedBytes) throw new Error("PACKAGE_FILE_UNAVAILABLE");
    return { stream: file.createReadStream(), sizeBytes: info.size };
  } catch {
    await file?.close().catch(() => undefined);
    throw new DistributionError(404, "NOT_FOUND", unavailableMessage);
  }
}
