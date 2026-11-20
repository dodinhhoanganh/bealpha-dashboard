import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { DistributionConfig } from "./config.js";
import { catalogSnapshotSchema, coverAssetId, coverResourceFileName, resourceFileName } from "./ern.js";
import { decryptGrantToken } from "./grant-crypto.js";

export interface PackageDelivery {
  id: string;
  createdAt: Date;
  messageType: string;
  snapshot: { ernXml: string; payload: unknown; createdAt: Date };
  assetGrants: Array<{ assetId: string; tokenCiphertext: string; expiresAt: Date; fileName: string; contentType: string; sizeBytes: bigint; sha256?: string }>;
}

export interface DeliveryPackageArtifact {
  rootPath: string;
  folderName: string;
  messageFileName: string;
  entries: string[];
}

export function runZip(cwd: string, outputPath: string, entries: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("zip", ["-0", "-q", outputPath, "-@"], { cwd, stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
    let stderr = ""; const timer = setTimeout(() => { child.kill(); reject(new Error("DELIVERY_ZIP_TIMEOUT")); }, 60 * 60 * 1000);
    child.stderr.on("data", chunk => { if (stderr.length < 8192) stderr += chunk.toString(); });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`DELIVERY_ZIP_FAILED: ${stderr.slice(0, 1000)}`)); });
    child.stdin.end(`${entries.join("\n")}\n`);
  });
}

function choreographyTimestamp(value: Date) {
  if (Number.isNaN(value.getTime())) throw new Error("DELIVERY_SNAPSHOT_TIMESTAMP_INVALID");
  return value.toISOString().replace(/[-:TZ.]/g, "").slice(0, 17);
}

export async function buildDeliveryPackage(delivery: PackageDelivery, config: DistributionConfig, priority: "P" | "N" | "L" = "N"): Promise<DeliveryPackageArtifact> {
  const snapshot = catalogSnapshotSchema.parse(delivery.snapshot.payload);
  const includeResources = delivery.messageType !== "TakedownMessage";
  if ((includeResources ? snapshot.tracks.length + (snapshot.coverUrl ? 1 : 0) : 0) + 1 > config.packageMaxEntries) throw new Error("DELIVERY_PACKAGE_TOO_MANY_ENTRIES");
  const resources: Array<{ grant: PackageDelivery["assetGrants"][number]; fileName: string }> = [];
  let declaredBytes = BigInt(Buffer.byteLength(delivery.snapshot.ernXml));
  if (includeResources) {
    for (const [index, track] of snapshot.tracks.entries()) {
      if (!track.audioAssetId) throw new Error("DELIVERY_ASSET_MISSING");
      const grant = delivery.assetGrants.find(item => item.assetId === track.audioAssetId);
      if (!grant) throw new Error("DELIVERY_GRANT_MISSING");
      declaredBytes += grant.sizeBytes;
      resources.push({ grant, fileName: resourceFileName(snapshot, index, grant) });
    }
    if (snapshot.coverUrl) {
      const id = coverAssetId(snapshot.coverUrl);
      const grant = delivery.assetGrants.find(item => item.assetId === id);
      if (!grant) throw new Error("DELIVERY_GRANT_MISSING");
      declaredBytes += grant.sizeBytes;
      resources.push({ grant, fileName: coverResourceFileName(snapshot, grant) });
    }
  }
  if (declaredBytes > BigInt(config.packageMaxBytes)) throw new Error("DELIVERY_PACKAGE_TOO_LARGE");
  const folderName = `${priority}_${snapshot.ean}_${choreographyTimestamp(new Date(delivery.createdAt))}`;
  const root = path.resolve(config.packageRoot, delivery.id);
  const staging = path.join(root, folderName);
  await rm(root, { recursive: true, force: true });
  await mkdir(path.join(staging, "resources"), { recursive: true });
  await mkdir(path.join(staging, "acknowledgements"), { recursive: true });
  let totalBytes = Buffer.byteLength(delivery.snapshot.ernXml); const entries: string[] = [];
  for (const { grant, fileName } of resources) {
    if (grant.expiresAt <= new Date()) throw new Error("DELIVERY_GRANT_EXPIRED");
    if (!grant.sha256) throw new Error("DELIVERY_MEDIA_CHECKSUM_MISSING");
    const token = decryptGrantToken(grant.tokenCiphertext, config.deliveryGrantEncryptionKey);
    const response = await fetch(`${config.mediaServiceUrl}/media-stream/${encodeURIComponent(grant.assetId)}`, { headers: { authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(60 * 60 * 1000) });
    if (!response.ok || !response.body) throw new Error(`DELIVERY_MEDIA_FETCH_FAILED_${response.status}`);
    const declared = Number(response.headers.get("content-length")); if (!Number.isSafeInteger(declared) || declared <= 0 || BigInt(declared) !== grant.sizeBytes || totalBytes + declared > config.packageMaxBytes) throw new Error("DELIVERY_PACKAGE_TOO_LARGE");
    const name = `resources/${fileName}`;
    let received = 0; const hash = createHash("sha256"); const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) { received += chunk.length; hash.update(chunk); if (received > declared) return callback(new Error("DELIVERY_MEDIA_SIZE_MISMATCH")); callback(null, chunk); } });
    await pipeline(Readable.fromWeb(response.body as never), meter, createWriteStream(path.join(staging, ...name.split("/")), { flags: "wx" }));
    if (received !== declared) throw new Error("DELIVERY_MEDIA_SIZE_MISMATCH"); totalBytes += received; entries.push(name);
    if (hash.digest("hex") !== grant.sha256) throw new Error("DELIVERY_MEDIA_CHECKSUM_MISMATCH");
  }
  const messageFileName = `${snapshot.ean}.xml`;
  await writeFile(path.join(staging, messageFileName), delivery.snapshot.ernXml, { encoding: "utf8", flag: "wx" });
  entries.push(messageFileName);
  return { rootPath: staging, folderName, messageFileName, entries };
}
