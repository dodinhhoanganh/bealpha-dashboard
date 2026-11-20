import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import {
  vevoAcknowledgementSchema,
  vevoSubmissionMetadataSchema,
  type VevoAcknowledgement,
  type VevoSubmissionMetadata,
} from "@bealpha/contracts";

const VEVO_MAX_VIDEO_BYTES = 128n * 1024n * 1024n * 1024n;
const VEVO_MAX_RECEIPT_BYTES = 64 * 1024;

export type VevoFeedAssetRole = "VIDEO" | "IMAGE" | "CAPTION";

export interface VevoFeedObject {
  fileName: string;
  contentType: string;
  sizeBytes: bigint;
  sha256: string;
  openBody(): Promise<Readable>;
}

export interface VevoFeedAsset extends VevoFeedObject {
  assetId: string;
  role: VevoFeedAssetRole;
}

export interface VevoFeedSubmission {
  submissionId: string;
  metadata: VevoSubmissionMetadata;
  assets: VevoFeedAsset[];
  manifest: VevoFeedObject;
}

export interface VevoObjectStore {
  putObject(input: { key: string; contentType: string; sizeBytes: bigint; sha256: string; body: Readable }): Promise<void>;
  getObject(key: string, maxBytes: number): Promise<Uint8Array | null>;
}

export interface VevoSubmittedFeed {
  submissionId: string;
  submissionPrefix: string;
  manifestKey: string;
  assetKeys: string[];
  state: "SENT_AWAITING_ACK";
}

export interface VevoDeliveryTransition {
  status: "CONFIRMED" | "FAILED";
  confirmedAt: Date | null;
  lastError: string | null;
}

function xml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&apos;");
}

export function buildVevoManifest(metadataInput: VevoSubmissionMetadata, fileNames: Partial<Record<VevoFeedAssetRole, string>>): string {
  const metadata = vevoSubmissionMetadataSchema.parse(metadataInput);
  if (metadata.purpose === "INSERT" && !fileNames.VIDEO) throw new Error("VEVO_VIDEO_FILE_MISSING");
  if (Boolean(metadata.thumbnailAssetId) !== Boolean(fileNames.IMAGE) || Boolean(metadata.captionAssetId) !== Boolean(fileNames.CAPTION)) throw new Error("VEVO_OPTIONAL_ASSET_MISMATCH");
  // Public VEVOXML profile: https://support.vevo.com/hc/article_attachments/8680900818971
  const purpose = { INSERT: "Insert", UPDATE: "Update", DELETE: "Delete" }[metadata.purpose];
  const territories = metadata.territories.join(" ");
  const assets = [
    fileNames.VIDEO ? `<Url>file://${xml(fileNames.VIDEO)}</Url>` : "",
    fileNames.IMAGE ? `<ThumbnailUrl>file://${xml(fileNames.IMAGE)}</ThumbnailUrl>` : "",
    fileNames.CAPTION ? `<ClosedCaptionUrl>file://${xml(fileNames.CAPTION)}</ClosedCaptionUrl><ClosedCaptionLanguage>${xml(metadata.captionLanguage!)}</ClosedCaptionLanguage>` : "",
  ].join("");
  return `<?xml version="1.0" encoding="UTF-8"?><video version="1.0">${assets}<Username>${xml(metadata.youtubeChannelName)}</Username><ContentCategory>Music</ContentCategory><VideoTitle>${xml(metadata.title)}</VideoTitle><Action>${purpose}</Action><VideoISRC>${metadata.isrc}</VideoISRC><Label>${xml(metadata.label)}</Label><RepetoireOwner>${xml(metadata.label)}</RepetoireOwner><Artists>${metadata.mainArtists.map(value => `<Artist>${xml(value)}</Artist>`).join("")}</Artists>${metadata.genres.map(value => `<Genre>${xml(value)}</Genre>`).join("")}<StartTime>${xml(metadata.startDateTime)}</StartTime><Policies><policy Rule="Share" Include="Include">${territories}</policy><policy Rule="Block" Include="Exclude">${territories}</policy></Policies>${metadata.madeForKids !== undefined ? `<MadeForKids>${metadata.madeForKids ? "True" : "False"}</MadeForKids>` : ""}${metadata.youtubeUnlisted !== undefined ? `<YouTubeUnlisted>${metadata.youtubeUnlisted ? "True" : "False"}</YouTubeUnlisted>` : ""}</video>`;
}

function safeRelativeKey(value: string): boolean {
  return value.length > 0 && value.length <= 500 &&
    !value.startsWith("/") && !value.includes("\\") &&
    value.split("/").every(segment => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(segment) && segment !== "..") &&
    !value.toLowerCase().startsWith("success-") && !value.toLowerCase().startsWith("failure-");
}

function safePrefix(value: string): boolean {
  return value.length > 0 && value.length <= 500 &&
    value.split("/").every(segment => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(segment) && segment !== "..");
}

function validateObject(value: VevoFeedObject): void {
  if (!safeRelativeKey(value.fileName)) throw new Error("VEVO_OBJECT_KEY_INVALID");
  if (!value.contentType || value.contentType.length > 255) throw new Error("VEVO_CONTENT_TYPE_INVALID");
  if (value.sizeBytes <= 0n) throw new Error("VEVO_OBJECT_SIZE_INVALID");
  if (!/^[a-f0-9]{64}$/.test(value.sha256)) throw new Error("VEVO_OBJECT_CHECKSUM_INVALID");
}

function receiptSha256(body: Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}

function parseReceiptJson(body: Uint8Array): Record<string, unknown> | null {
  if (body.length === 0 || body.length > VEVO_MAX_RECEIPT_BYTES) return null;
  try {
    const value = JSON.parse(Buffer.from(body).toString("utf8")) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function diagnostic(receipt: Record<string, unknown> | null): string | undefined {
  if (!receipt) return undefined;
  for (const key of ["error", "message", "reason", "cause"]) {
    const value = receipt[key];
    if (typeof value !== "string") continue;
    const safe = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 1000);
    if (safe) return safe;
  }
  return undefined;
}

export class UnconfiguredVevoFeedAdapter {
  async submit(): Promise<never> {
    throw new Error("VEVO_PARTNER_ADAPTER_NOT_CONFIGURED");
  }

  async pollAcknowledgement(): Promise<never> {
    throw new Error("VEVO_PARTNER_ADAPTER_NOT_CONFIGURED");
  }
}

/**
 * VEVO's public feed contract is ordering-sensitive: all media objects are
 * committed first and the XML manifest is committed last as the ingest signal.
 * This adapter intentionally never treats upload completion as partner acceptance.
 */
export class VevoFeedAdapter {
  private readonly prefix: string;

  constructor(private readonly objectStore: VevoObjectStore, prefix: string) {
    this.prefix = prefix.replace(/^\/+|\/+$/g, "");
    if (!safePrefix(this.prefix)) throw new Error("VEVO_FEED_PREFIX_INVALID");
  }

  async submit(input: VevoFeedSubmission): Promise<VevoSubmittedFeed> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.submissionId)) {
      throw new Error("VEVO_SUBMISSION_ID_INVALID");
    }
    const metadata = vevoSubmissionMetadataSchema.parse(input.metadata);
    validateObject(input.manifest);
    if (!/\.xml$/i.test(input.manifest.fileName)) throw new Error("VEVO_MANIFEST_TYPE_INVALID");
    input.assets.forEach(validateObject);
    if (new Set([input.manifest.fileName, ...input.assets.map(asset => asset.fileName)]).size !== input.assets.length + 1) {
      throw new Error("VEVO_OBJECT_KEY_DUPLICATE");
    }

    const videoAssets = input.assets.filter(asset => asset.role === "VIDEO");
    if (metadata.purpose === "INSERT" && (videoAssets.length !== 1 || videoAssets[0]?.assetId !== metadata.videoAssetId)) {
      throw new Error("VEVO_VIDEO_ASSET_MISMATCH");
    }
    if (videoAssets.some(asset => asset.sizeBytes > VEVO_MAX_VIDEO_BYTES)) {
      throw new Error("VEVO_VIDEO_FILE_TOO_LARGE");
    }

    const submissionPrefix = `${this.prefix}/${input.submissionId}`;
    const assetKeys: string[] = [];
    for (const asset of input.assets) {
      const key = `${submissionPrefix}/${asset.fileName}`;
      await this.objectStore.putObject({
        key,
        contentType: asset.contentType,
        sizeBytes: asset.sizeBytes,
        sha256: asset.sha256,
        body: await asset.openBody(),
      });
      assetKeys.push(key);
    }

    const manifestKey = `${submissionPrefix}/${input.manifest.fileName}`;
    await this.objectStore.putObject({
      key: manifestKey,
      contentType: input.manifest.contentType,
      sizeBytes: input.manifest.sizeBytes,
      sha256: input.manifest.sha256,
      body: await input.manifest.openBody(),
    });
    return { submissionId: input.submissionId, submissionPrefix, manifestKey, assetKeys, state: "SENT_AWAITING_ACK" };
  }

  async pollAcknowledgement(submission: VevoSubmittedFeed, isrc: string, receivedAt = new Date()): Promise<VevoAcknowledgement | null> {
    const successKey = `${submission.submissionPrefix}/success-${isrc}.json`;
    const failureKey = `${submission.submissionPrefix}/failure-${isrc}.json`;
    const [successBody, failureBody] = await Promise.all([
      this.objectStore.getObject(successKey, VEVO_MAX_RECEIPT_BYTES),
      this.objectStore.getObject(failureKey, VEVO_MAX_RECEIPT_BYTES),
    ]);
    if (successBody && failureBody) throw new Error("VEVO_RECEIPT_CONFLICT");
    if (!successBody && !failureBody) return null;

    if (failureBody) {
      return vevoAcknowledgementSchema.parse({
        isrc,
        outcome: "FAILURE",
        receiptKey: failureKey,
        receiptSha256: receiptSha256(failureBody),
        receivedAt: receivedAt.toISOString(),
        diagnostic: diagnostic(parseReceiptJson(failureBody)),
      });
    }

    const parsed = parseReceiptJson(successBody!);
    if (!parsed) throw new Error("VEVO_SUCCESS_RECEIPT_INVALID");
    return vevoAcknowledgementSchema.parse({
      isrc,
      outcome: "SUCCESS",
      receiptKey: successKey,
      receiptSha256: receiptSha256(successBody!),
      receivedAt: receivedAt.toISOString(),
    });
  }
}

export function applyVevoAcknowledgement(currentStatus: string, acknowledgement: VevoAcknowledgement): VevoDeliveryTransition {
  if (currentStatus !== "SENT") throw new Error("VEVO_ACK_STATE_INVALID");
  const receivedAt = new Date(acknowledgement.receivedAt);
  return acknowledgement.outcome === "SUCCESS"
    ? { status: "CONFIRMED", confirmedAt: receivedAt, lastError: null }
    : { status: "FAILED", confirmedAt: null, lastError: acknowledgement.diagnostic ?? "VEVO_INGEST_FAILED" };
}
