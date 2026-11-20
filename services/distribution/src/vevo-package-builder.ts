import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { DistributionConfig } from "./config.js";
import { runZip } from "./package-builder.js";
import { decryptGrantToken } from "./grant-crypto.js";

interface ManualPackageAsset { assetId: string; tokenCiphertext: string; expiresAt: Date; sizeBytes: bigint; sha256: string; fileName: string; }
interface ManualPackageSubmission { id: string; isrc: string; manifestXml: string; manifestFileName: string; assets: ManualPackageAsset[]; }

export async function openDeliveryMediaBody(config: DistributionConfig, asset: { assetId: string; tokenCiphertext: string; expiresAt: Date; sizeBytes: bigint }): Promise<Readable> {
  if (asset.expiresAt <= new Date()) throw new Error("VEVO_MEDIA_GRANT_EXPIRED");
  const token = decryptGrantToken(asset.tokenCiphertext, config.deliveryGrantEncryptionKey);
  const response = await fetch(`${config.mediaServiceUrl}/media-stream/${encodeURIComponent(asset.assetId)}`, { headers: { authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!response.ok || !response.body) throw new Error(`VEVO_MEDIA_STREAM_${response.status}`);
  const length = response.headers.get("content-length"); if (length !== null && BigInt(length) !== asset.sizeBytes) throw new Error("VEVO_MEDIA_SIZE_MISMATCH");
  return Readable.fromWeb(response.body as never);
}

async function fileSha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), new Writable({ write(chunk: Buffer, _encoding, callback) { hash.update(chunk); callback(); } }));
  return hash.digest("hex");
}

export async function buildVevoManualPackage(submission: ManualPackageSubmission, config: DistributionConfig, zipper: typeof runZip = runZip) {
  if (submission.assets.length + 2 > config.packageMaxEntries) throw new Error("VEVO_PACKAGE_TOO_MANY_ENTRIES");
  const totalBytes = BigInt(Buffer.byteLength(submission.manifestXml)) + submission.assets.reduce((total, asset) => total + asset.sizeBytes, 0n);
  if (totalBytes > BigInt(config.packageMaxBytes)) throw new Error("VEVO_PACKAGE_TOO_LARGE");
  const root = path.resolve(config.packageRoot, "vevo", submission.id); const staging = path.join(root, "staging");
  await rm(root, { recursive: true, force: true }); await mkdir(path.join(staging, "resources"), { recursive: true });
  const entries: string[] = [];
  for (const asset of submission.assets) {
    const relative = asset.fileName.replaceAll("\\", "/");
    if (!/^resources\/[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(relative)) throw new Error("VEVO_PACKAGE_PATH_INVALID");
    const outputPath = path.resolve(staging, relative); if (!outputPath.startsWith(`${staging}${path.sep}`)) throw new Error("VEVO_PACKAGE_PATH_INVALID");
    const body = await openDeliveryMediaBody(config, asset); let received = 0n; const hash = createHash("sha256");
    const verifier = new Transform({ transform(chunk: Buffer, _encoding, callback) { received += BigInt(chunk.length); hash.update(chunk); if (received > asset.sizeBytes) return callback(new Error("VEVO_MEDIA_SIZE_MISMATCH")); callback(null, chunk); } });
    await pipeline(body, verifier, createWriteStream(outputPath, { flags: "wx" }));
    if (received !== asset.sizeBytes) throw new Error("VEVO_MEDIA_SIZE_MISMATCH");
    if (hash.digest("hex") !== asset.sha256) throw new Error("VEVO_MEDIA_CHECKSUM_MISMATCH");
    entries.push(relative);
  }
  await writeFile(path.join(staging, submission.manifestFileName), submission.manifestXml, { encoding: "utf8", flag: "wx" }); entries.push(submission.manifestFileName);
  await writeFile(path.join(staging, "delivery.complete"), "", { flag: "wx" }); entries.push("delivery.complete");
  const outputPath = path.join(root, `${submission.id}.zip`); await zipper(staging, outputPath, entries);
  const info = await stat(outputPath); if (!info.isFile() || info.size > config.packageMaxBytes) throw new Error("VEVO_PACKAGE_TOO_LARGE");
  return { packagePath: outputPath, packageFileName: `${submission.isrc}_VEVO_manual_delivery.zip`, packageSizeBytes: BigInt(info.size), packageSha256: await fileSha256(outputPath), packageExpiresAt: new Date(Date.now() + config.exportRetentionSeconds * 1000) };
}
