import { z } from "zod";
// BeAlpha implements the current ERN 4.3 line (serialized as ERN 4.3.2).
// Older 4.2 payloads are rejected instead of being emitted with a 4.3 shape.
export const ddexErnVersionSchema = z.literal("4.3");
export const ddexMessageTypeSchema = z.enum([
    "NewReleaseMessage",
    "UpdateReleaseMessage",
    "TakedownMessage"
]);
export const deliveryRequestSchema = z
    .object({
    releaseId: z.string().min(1).max(128),
    dsp: z.string().min(1).max(64),
    ernVersion: ddexErnVersionSchema,
    messageType: ddexMessageTypeSchema,
    idempotencyKey: z.string().min(16).max(128)
})
    .strict();
export const deliverySnapshotRefSchema = z
    .object({
    snapshotId: z.string().min(1).max(128),
    releaseId: z.string().min(1).max(128),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    createdAt: z.string().datetime({ offset: true })
})
    .strict();
export const ddexAcknowledgementRequestSchema = z.object({
    fileName: z.string().min(1).max(500).regex(/^ACK_[A-Za-z0-9._-]+_\d{17}\.xml$/),
    xml: z.string().min(1).max(65536)
}).strict();

export type DeliveryRequest = z.infer<typeof deliveryRequestSchema>;
export type DeliverySnapshotRef = z.infer<typeof deliverySnapshotRefSchema>;
export type DdexAcknowledgementRequest = z.infer<typeof ddexAcknowledgementRequestSchema>;
