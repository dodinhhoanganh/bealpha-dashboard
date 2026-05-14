/**
 * DDEX Delivery Service
 *
 * Handles the delivery pipeline: generate XML → store → mark status.
 * In production, this would include SFTP/S3 upload to DSPs.
 */

import { prisma } from "@/lib/prisma";
import {
  generateERN,
  generateTakedownERN,
  validateERN,
  validateERNData,
} from "./ern-generator";
import type { ERNOptions } from "./ern-generator";

// Supported DSPs
export const DSP_LIST = [
  { id: "spotify", name: "Spotify", icon: "🟢" },
  { id: "apple_music", name: "Apple Music", icon: "" },
  { id: "amazon_music", name: "Amazon Music", icon: "" },
  { id: "youtube_music", name: "YouTube Music", icon: "▶" },
  { id: "tidal", name: "TIDAL", icon: "" },
  { id: "deezer", name: "Deezer", icon: "" },
  { id: "tiktok", name: "TikTok / CapCut", icon: "" },
  { id: "facebook", name: "Facebook / Instagram", icon: "" },
  { id: "soundcloud", name: "SoundCloud", icon: "" },
  { id: "pandora", name: "Pandora", icon: "" },
] as const;

export type DspId = (typeof DSP_LIST)[number]["id"];

// DSP-specific recipient IDs (placeholder DPID values)
const DSP_RECIPIENT_MAP: Record<string, { id: string; name: string }> = {
  spotify: { id: "PADPIDA2014040101W", name: "Spotify AB" },
  apple_music: { id: "PADPIDA2014040101X", name: "Apple Inc." },
  amazon_music: { id: "PADPIDA2014040101Y", name: "Amazon.com" },
  youtube_music: { id: "PADPIDA2014040101Z", name: "Google LLC" },
  tidal: { id: "PADPIDA2015010101T", name: "TIDAL Music AS" },
  deezer: { id: "PADPIDA2015010101D", name: "Deezer SA" },
  tiktok: { id: "PADPIDA2020010101K", name: "ByteDance Ltd." },
  facebook: { id: "PADPIDA2015010101F", name: "Meta Platforms Inc." },
  soundcloud: { id: "PADPIDA2015010101S", name: "SoundCloud Ltd." },
  pandora: { id: "PADPIDA2015010101P", name: "Pandora Media" },
};

/**
 * Fetch full release data with all relations for ERN generation
 */
async function getFullRelease(releaseId: string) {
  const release = await prisma.release.findUnique({
    where: { id: releaseId },
    include: {
      artist: true,
      label: true,
      tracks: {
        include: {
          artist: true,
          audioAsset: true,
          canvasAsset: true,
          motionAsset: true,
          composition: true,
          contributors: {
            include: { artist: true },
          },
        },
        orderBy: [{ discNumber: "asc" }, { trackNumber: "asc" }],
      },
      assets: true,
    },
  });
  return release;
}

/**
 * Create delivery records for a release to selected DSPs
 */
export async function createDeliveries(
  releaseId: string,
  dspIds: string[],
  messageType: "NewRelease" | "Update" | "Takedown" = "NewRelease",
): Promise<{ deliveries: any[]; errors: string[] }> {
  const errors: string[] = [];
  const release = await getFullRelease(releaseId);

  if (!release) {
    return { deliveries: [], errors: ["Release not found"] };
  }

  if (
    messageType !== "Takedown" &&
    release.status !== "APPROVED" &&
    release.status !== "RELEASED"
  ) {
    return {
      deliveries: [],
      errors: [
        `Release must be APPROVED or RELEASED. Current status: ${release.status}`,
      ],
    };
  }

  const batchId = `BATCH-${Date.now()}`;
  const deliveries: any[] = [];

  for (const dspId of dspIds) {
    const recipient = DSP_RECIPIENT_MAP[dspId];
    if (!recipient) {
      errors.push(`Unknown DSP: ${dspId}`);
      continue;
    }

    try {
      const ernOptions: Partial<ERNOptions> = {
        recipientId: recipient.id,
        recipientName: recipient.name,
        onBehalfOfName: release.label?.name,
      };

      if (messageType !== "Takedown") {
        const preCheck = validateERNData(release as any, release.tracks as any);
        if (!preCheck.valid) {
          errors.push(
            `Data validation failed for ${dspId}: ${preCheck.errors.join("; ")}`,
          );
          continue;
        }
      }

      let xmlContent: string;
      if (messageType === "Takedown") {
        xmlContent = generateTakedownERN(release as any, ernOptions);
      } else {
        xmlContent = generateERN(
          release as any,
          release.tracks as any,
          release.assets as any,
          ernOptions,
        );
      }

      // Validate
      const validation = validateERN(xmlContent);
      if (!validation.valid) {
        errors.push(
          `Validation failed for ${dspId}: ${validation.errors.join(", ")}`,
        );
        continue;
      }

      // Create delivery record
      const delivery = await prisma.ddexDelivery.create({
        data: {
          releaseId,
          dspName: dspId,
          messageType,
          ernVersion: "4.3",
          xmlContent,
          batchId,
          status: "pending",
        },
        include: {
          release: {
            select: { id: true, title: true, ean: true },
          },
        },
      });

      deliveries.push(delivery);
    } catch (error) {
      errors.push(
        `Failed to generate for ${dspId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return { deliveries, errors };
}

/**
 * Send delivery to a DSP via SFTP/S3 staging directory.
 *
 * Delivery workflow per VEVO Feed Delivery spec (https://support.vevo.com/hc/en-us/articles/8624200408731):
 *
 * DDEX Submissions:
 * 1. Create unique folder per-submission (e.g. {DPID}_{ISRC}_{timestamp}/)
 * 2. Upload ALL media assets FIRST (video + thumbnail + captions → resources/)
 * 3. Upload manifest.xml LAST — this triggers ingestion (no BatchComplete_ needed!)
 *
 * IMPORTANT: "BatchComplete" files are NOT supported for DDEX submissions.
 * Do NOT send a delivery.complete file. Processing starts when manifest is uploaded.
 *
 * Response receipt (asynchronous — checked every few minutes):
 * - success-{ISRC}.json → successfully ingested
 * - failure-{ISRC}.json → failed (may contain failure cause)
 * - Absence of success file = unsuccessful ingestion
 */
export async function sendDelivery(
  deliveryId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const delivery = await prisma.ddexDelivery.findUnique({
      where: { id: deliveryId },
      include: {
        release: {
          select: { id: true, title: true, ean: true, coverUrl: true },
        },
      },
    });

    if (!delivery) {
      return { success: false, error: "Delivery not found" };
    }

    if (delivery.status === "confirmed") {
      return { success: false, error: "Delivery already confirmed" };
    }

    // Production: S3 upload to vevo-ingestion bucket
    // Upload structure per VEVO spec:
    //   s3://vevo-ingestion/feed/{org}/{ISRC}_{timestamp}/resources/  ← assets first
    //   s3://vevo-ingestion/feed/{org}/{ISRC}_{timestamp}/manifest.xml ← last (triggers ingestion)
    //
    // NOTE: No BatchComplete_ file for DDEX! Manifest upload = start signal.

    const timestamp = Date.now();
    const batchDir = delivery.batchId || `${delivery.dspName}_${timestamp}`;
    const stagingManifest = {
      batchDir,
      uploadOrder: [
        // 1. Upload assets first
        { step: "assets", path: `${batchDir}/resources/`, status: "pending" },
        // 2. Upload manifest LAST (triggers VEVO ingestion)
        { step: "manifest", path: `${batchDir}/manifest.xml`, status: "pending" },
      ],
      // Receipt check paths (VEVO creates these asynchronously)
      receiptPaths: {
        success: `${batchDir}/success-${delivery.releaseId}.json`,
        failure: `${batchDir}/failure-${delivery.releaseId}.json`,
      },
    };

    // Mark as sent with staging metadata
    await prisma.ddexDelivery.update({
      where: { id: deliveryId },
      data: {
        status: "sent",
        sentAt: new Date(),
        errorLog: null,
        // Store staging info for polling worker
        metadata: JSON.stringify({
          stagingManifest,
          sentAt: new Date().toISOString(),
          timeoutAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(), // 48h timeout
        }),
      },
    });

    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    await prisma.ddexDelivery.update({
      where: { id: deliveryId },
      data: {
        status: "failed",
        errorLog: errorMsg,
      },
    });

    return { success: false, error: errorMsg };
  }
}

/**
 * Poll for VEVO ingestion feedback (spec §6.2).
 *
 * VEVO drops JSON files into the submission directory:
 *   - success-{ISRC}.json → delivery confirmed
 *   - failure-{ISRC}.json → delivery rejected with error codes
 *   - No response after 48h → Unknown Fatal Error
 *
 * This function should be called by a cron job / polling worker.
 */
export async function pollDeliveryStatus(): Promise<{
  processed: number;
  timedOut: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let processed = 0;
  let timedOut = 0;

  // Find all deliveries in "sent" status
  const pendingDeliveries = await prisma.ddexDelivery.findMany({
    where: { status: "sent" },
    include: {
      release: {
        select: { id: true, title: true },
      },
    },
  });

  for (const delivery of pendingDeliveries) {
    try {
      let meta: any = {};
      try {
        meta = delivery.metadata ? JSON.parse(delivery.metadata as string) : {};
      } catch { /* ignore parse errors */ }

      const timeoutAt = meta.timeoutAt ? new Date(meta.timeoutAt) : null;

      // Production: Check SFTP/S3 directory for response files
      // s3://vevo-ingestion/{batchDir}/success-{ISRC}.json
      // s3://vevo-ingestion/{batchDir}/failure-{ISRC}.json
      //
      // For now, check timeout threshold (spec §6.2):
      // If 48h have passed with no feedback → Unknown Fatal Error
      if (timeoutAt && new Date() > timeoutAt) {
        await prisma.ddexDelivery.update({
          where: { id: delivery.id },
          data: {
            status: "failed",
            errorLog: "VEVO Timeout: No feedback received within 48 hours. " +
              "This indicates a fatal XML parsing error or incomplete batch transfer. " +
              "Please verify batch structure and re-submit.",
          },
        });
        timedOut++;
        continue;
      }

      // Production would check for success/failure JSON here:
      // const successFile = await checkS3File(`${batchDir}/success-${isrc}.json`);
      // const failureFile = await checkS3File(`${batchDir}/failure-${isrc}.json`);
      //
      // if (successFile) {
      //   await confirmDelivery(delivery.id);
      //   processed++;
      // } else if (failureFile) {
      //   const errorData = JSON.parse(failureFile);
      //   await prisma.ddexDelivery.update({
      //     where: { id: delivery.id },
      //     data: { status: "failed", errorLog: JSON.stringify(errorData) },
      //   });
      //   processed++;
      // }

    } catch (error) {
      errors.push(
        `Failed to poll delivery ${delivery.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return { processed, timedOut, errors };
}

/**
 * Confirm a delivery (manually or via webhook from DSP)
 */
export async function confirmDelivery(deliveryId: string): Promise<boolean> {
  try {
    await prisma.ddexDelivery.update({
      where: { id: deliveryId },
      data: {
        status: "confirmed",
        confirmedAt: new Date(),
      },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Retry a failed delivery
 */
export async function retryDelivery(
  deliveryId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await prisma.ddexDelivery.update({
      where: { id: deliveryId },
      data: {
        status: "pending",
        errorLog: null,
        sentAt: null,
      },
    });

    return sendDelivery(deliveryId);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Get delivery stats for a release
 */
export async function getDeliveryStats(releaseId: string) {
  const deliveries = await prisma.ddexDelivery.findMany({
    where: { releaseId },
    select: { status: true, dspName: true },
  });

  return {
    total: deliveries.length,
    pending: deliveries.filter((d) => d.status === "pending").length,
    sent: deliveries.filter((d) => d.status === "sent").length,
    confirmed: deliveries.filter((d) => d.status === "confirmed").length,
    failed: deliveries.filter((d) => d.status === "failed").length,
    dsps: [...new Set(deliveries.map((d) => d.dspName))],
  };
}
