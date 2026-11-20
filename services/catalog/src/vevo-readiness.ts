import {
  VEVO_VIDEO_PROFILE_VERSION,
  vevoSubmissionMetadataSchema,
  type VevoSubmissionMetadata,
} from "@bealpha/contracts";
import { CatalogError } from "./errors.js";

type JsonRecord = Record<string, unknown>;

export interface VevoMediaAssetEvidence {
  id: string;
  type: string;
  status: string;
  qcProfileVersion?: string | null;
  qcResult?: unknown;
}

export interface VevoReleaseReadinessInput {
  type: string;
  format: string;
  title: string;
  genre?: string | null;
  releaseDate: Date;
  metadata?: unknown;
  artist?: { name: string; vevoChannel?: string | null } | null;
  label?: { name: string } | null;
  tracks: Array<{
    title: string;
    isrc?: string | null;
    videoAssetId?: string | null;
    thumbnailAssetId?: string | null;
    captionAssetId?: string | null;
    captionLanguage?: string | null;
    metadata?: unknown;
  }>;
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function qcPassed(asset: VevoMediaAssetEvidence): boolean {
  const result = record(asset.qcResult);
  return asset.type === "VIDEO" &&
    asset.status === "READY" &&
    asset.qcProfileVersion === VEVO_VIDEO_PROFILE_VERSION &&
    result.compliant === true;
}

function incomplete(message: string): never {
  throw new CatalogError(409, "VEVO_RELEASE_INCOMPLETE", message);
}

/**
 * Builds the normalized VEVO feed metadata and verifies all referenced assets.
 * It is called before a VIDEO release enters the approval workflow, so later
 * delivery never relies on browser-only validation or stale QC evidence.
 */
export async function assertVevoReleaseReady(
  release: VevoReleaseReadinessInput,
  assetLookup: (assetId: string) => Promise<VevoMediaAssetEvidence | null>,
): Promise<VevoSubmissionMetadata | null> {
  if (release.type !== "VIDEO") return null;
  if (release.format !== "SINGLE" || release.tracks.length !== 1) {
    incomplete("A VEVO feed submission must contain exactly one video track");
  }
  if (!release.genre || !release.label?.name || !release.artist?.name || !release.artist.vevoChannel) {
    incomplete("VEVO genre, label, main artist and approved channel are required");
  }

  const track = release.tracks[0]!;
  const releaseMetadata = record(release.metadata);
  const trackMetadata = record(track.metadata);
  if (trackMetadata.vevoNoSlatesOrTitleCards !== true || trackMetadata.vevoNoLetterboxing !== true) {
    incomplete("VEVO no-slate/title-card and no-letterboxing attestations are required");
  }
  const parsed = vevoSubmissionMetadataSchema.safeParse({
    purpose: "INSERT",
    isrc: track.isrc,
    title: track.title,
    label: release.label.name,
    genres: [release.genre],
    mainArtists: [release.artist.name],
    youtubeChannelName: release.artist.vevoChannel,
    startDateTime: release.releaseDate.toISOString(),
    territories: stringArray(releaseMetadata.territories),
    videoAssetId: track.videoAssetId ?? undefined,
    thumbnailAssetId: track.thumbnailAssetId ?? undefined,
    captionAssetId: track.captionAssetId ?? undefined,
    captionLanguage: track.captionLanguage ?? undefined,
    madeForKids: optionalBoolean(trackMetadata.madeForKids ?? releaseMetadata.madeForKids),
    youtubeUnlisted: optionalBoolean(trackMetadata.youtubeUnlisted ?? releaseMetadata.youtubeUnlisted),
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.join(".") || "metadata";
    incomplete(`VEVO field is missing or invalid: ${field}`);
  }

  const metadata = parsed.data;
  const video = await assetLookup(metadata.videoAssetId!);
  if (!video || video.id !== metadata.videoAssetId || !qcPassed(video)) {
    incomplete("Video master requires current, passing VEVO technical QC");
  }

  const optionalAssets: Array<[string | undefined, string]> = [
    [metadata.thumbnailAssetId, "IMAGE"],
    [metadata.captionAssetId, "SUBTITLE"],
  ];
  for (const [assetId, expectedType] of optionalAssets) {
    if (!assetId) continue;
    const asset = await assetLookup(assetId);
    if (!asset || asset.id !== assetId || asset.type !== expectedType || asset.status !== "READY") {
      incomplete(`VEVO ${expectedType.toLowerCase()} asset is unavailable or not ready`);
    }
  }

  return metadata;
}
