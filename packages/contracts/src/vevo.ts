import { z } from "zod";
import { isrcSchema } from "./catalog.js";

export const VEVO_VIDEO_PROFILE_VERSION = "2025-07-21" as const;

export const vevoVideoProfileSchema = z.enum([
  "HD_LANDSCAPE",
  "HD_VERTICAL",
  "UHD_2K",
  "UHD_4K",
]);

export const vevoChannelNameSchema = z
  .string()
  .trim()
  .min(5)
  .max(20)
  .regex(/^[A-Za-z0-9]{1,16}VEVO$/);

export const vevoSubmissionPurposeSchema = z.enum(["INSERT", "UPDATE", "DELETE"]);
export const vevoSubmissionStatusSchema = z.enum(["PENDING", "PROCESSING", "SENT_AWAITING_ACK", "CONFIRMED", "FAILED", "READY_FOR_MANUAL_DELIVERY"]);
export const vevoSubmissionRequestSchema = z.object({
  releaseId: z.string().uuid(),
  idempotencyKey: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/),
}).strict();

export const vevoSubmissionMetadataSchema = z
  .object({
    purpose: vevoSubmissionPurposeSchema,
    isrc: isrcSchema,
    title: z.string().trim().min(1).max(500),
    label: z.string().trim().min(1).max(255),
    genres: z.array(z.string().trim().min(1).max(100)).min(1).max(10),
    mainArtists: z.array(z.string().trim().min(1).max(255)).min(1).max(25),
    youtubeChannelName: vevoChannelNameSchema,
    startDateTime: z.string().datetime({ offset: true }),
    territories: z.array(z.string().regex(/^[A-Z]{2}$/)).min(1).max(250),
    videoAssetId: z.string().uuid().optional(),
    thumbnailAssetId: z.string().uuid().optional(),
    captionAssetId: z.string().uuid().optional(),
    captionLanguage: z.string().regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/).max(35).optional(),
    madeForKids: z.boolean().optional(),
    youtubeUnlisted: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.purpose === "INSERT" && !value.videoAssetId) {
      context.addIssue({ code: "custom", path: ["videoAssetId"], message: "VideoAsset is required for INSERT" });
    }
    if (Boolean(value.captionAssetId) !== Boolean(value.captionLanguage)) {
      context.addIssue({ code: "custom", path: ["captionLanguage"], message: "Caption asset and language must be provided together" });
    }
  });

export const vevoReceiptFileNameSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^(success|failure)-[A-Z]{2}[A-Z0-9]{3}\d{7}\.json$/);

export const vevoAcknowledgementSchema = z
  .object({
    isrc: isrcSchema,
    outcome: z.enum(["SUCCESS", "FAILURE"]),
    receiptKey: z.string().min(1).max(1024),
    receiptSha256: z.string().regex(/^[a-f0-9]{64}$/),
    receivedAt: z.string().datetime({ offset: true }),
    diagnostic: z.string().trim().max(1000).optional(),
  })
  .strict();

export type VevoVideoProfile = z.infer<typeof vevoVideoProfileSchema>;
export type VevoSubmissionPurpose = z.infer<typeof vevoSubmissionPurposeSchema>;
export type VevoSubmissionStatus = z.infer<typeof vevoSubmissionStatusSchema>;
export type VevoSubmissionRequest = z.infer<typeof vevoSubmissionRequestSchema>;
export type VevoSubmissionMetadata = z.infer<typeof vevoSubmissionMetadataSchema>;
export type VevoAcknowledgement = z.infer<typeof vevoAcknowledgementSchema>;
