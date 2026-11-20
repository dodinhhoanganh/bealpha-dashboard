import { z } from "zod";
export const MAX_ZIP_BYTES = 50 * 1024 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 10_000;
export const MAX_DDEX_XML_BYTES = 256 * 1024 * 1024;
export const MAX_ZIP_COMPRESSION_RATIO = 100;
export const MAX_MEDIA_PATH_LENGTH = 512;
export const mediaAssetTypeSchema = z.enum([
    "AUDIO",
    "VIDEO",
    "CANVAS",
    "MOTION",
    "SUBTITLE",
    "ARCHIVE",
    "IMAGE"
]);
export const safeFileNameSchema = z
    .string()
    .min(1)
    .max(255)
    .refine((value) => !/[\\/]/.test(value), "fileName must not contain a path");
export const uploadIntentRequestSchema = z
    .object({
    assetType: mediaAssetTypeSchema,
    fileName: safeFileNameSchema,
    contentType: z.string().min(1).max(255),
    sizeBytes: z.number().int().positive().max(MAX_ZIP_BYTES),
    sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    releaseId: z.string().min(1).max(128).optional(),
    trackId: z.string().min(1).max(128).optional()
})
    .strict();
export const uploadIntentResponseSchema = z
    .object({
    uploadId: z.string().min(1).max(128),
    method: z.enum(["PUT", "POST"]),
    url: z.string().url(),
    headers: z.record(z.string()),
    expiresAt: z.string().datetime({ offset: true }),
    maxBytes: z.number().int().positive().max(MAX_ZIP_BYTES)
})
    .strict();

export type UploadIntentRequest = z.infer<typeof uploadIntentRequestSchema>;
export type UploadIntentResponse = z.infer<typeof uploadIntentResponseSchema>;
