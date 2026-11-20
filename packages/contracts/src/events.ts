import { z } from "zod";
import { entityPathSchema } from "./auth.js";
export const EVENT_VERSION = 1;
export const eventTypeSchema = z.enum([
    "catalog.release.submitted",
    "catalog.release.approved",
    "catalog.release.rejected",
    "catalog.entity.created",
    "catalog.entity.updated",
    "catalog.tenant-brand.updated",
    "catalog.track.scope-upserted",
    "catalog.track.scope-deleted",
    "identity.authorization.changed",
    "identity.session.revoked",
    "media.asset.uploaded",
    "distribution.snapshot.requested",
    "distribution.delivery.requested",
    "distribution.delivery.updated",
    "finance.report.ingested",
    "notification.requested"
]);
export const notificationRequestPayloadSchema = z
    .object({
    channel: z.literal("email"),
    template: z.enum([
        "password-reset",
        "identity-invitation",
        "two-factor-code"
    ]),
    recipient: z.string().trim().email().max(254).toLowerCase(),
    locale: z.string().min(2).max(10),
    variables: z.record(z.string(), z.string().max(4096))
})
    .strict();
export const catalogReleaseRejectedPayloadSchema = z.object({
    releaseId: z.string().uuid(),
    ownerId: z.string().uuid(),
    tenantId: z.string().uuid(),
    oldStatus: z.string().min(1).max(64),
    status: z.enum(["ORG_REJECTED", "SYS_REJECTED", "SUPER_REJECTED"]),
    rejectedByTier: z.enum(["ORGANIZATION", "SYSTEM_ADMIN", "SUPER_ADMIN"]),
    recipientEntityPath: entityPathSchema,
    reason: z.string().trim().min(3).max(1000)
}).strict();
export const catalogReleaseSubmittedPayloadSchema = z.object({
    releaseId: z.string().uuid(),
    oldStatus: z.enum(["DRAFT", "ORG_REJECTED", "SYS_REJECTED", "SUPER_REJECTED"]),
    status: z.enum(["PENDING_ORG_APPROVAL", "PENDING_SYS_APPROVAL"]),
    recipientEntityPath: entityPathSchema
}).strict();
export const catalogReleaseApprovedPayloadSchema = z.object({
    releaseId: z.string().uuid(),
    releaseType: z.enum(["AUDIO", "VIDEO"]),
    tenantId: z.string().uuid(),
    approverEntityId: z.string().uuid(),
    oldStatus: z.enum(["PENDING_ORG_APPROVAL", "PENDING_SYS_APPROVAL", "PENDING_SUPER_APPROVAL"]),
    status: z.enum(["PENDING_SYS_APPROVAL", "PENDING_SUPER_APPROVAL", "APPROVED"]),
    recipientEntityPath: entityPathSchema
}).strict().refine(payload => ({
    PENDING_ORG_APPROVAL: "PENDING_SYS_APPROVAL",
    PENDING_SYS_APPROVAL: "PENDING_SUPER_APPROVAL",
    PENDING_SUPER_APPROVAL: "APPROVED"
}[payload.oldStatus] === payload.status), {
    message: "Release approval must advance exactly one tier",
    path: ["status"]
});
const identifierSchema = z.string().min(1).max(128);
export function eventEnvelopeSchema<T extends z.ZodTypeAny>(payloadSchema: T) {
    return z
        .object({
        version: z.literal(EVENT_VERSION),
        eventId: z.string().uuid(),
        type: eventTypeSchema,
        occurredAt: z.string().datetime({ offset: true }),
        requestId: z.string().uuid(),
        actorId: identifierSchema.optional(),
        tenantId: identifierSchema.optional(),
        entityPath: entityPathSchema.optional(),
        payload: payloadSchema
    })
        .strict();
}

export type EventType = z.infer<typeof eventTypeSchema>;
export type NotificationRequestPayload = z.infer<typeof notificationRequestPayloadSchema>;
export type CatalogReleaseRejectedPayload = z.infer<typeof catalogReleaseRejectedPayloadSchema>;
export type CatalogReleaseSubmittedPayload = z.infer<typeof catalogReleaseSubmittedPayloadSchema>;
export type CatalogReleaseApprovedPayload = z.infer<typeof catalogReleaseApprovedPayloadSchema>;

export interface EventEnvelope<T> {
    version: typeof EVENT_VERSION;
    eventId: string;
    type: EventType;
    occurredAt: string;
    requestId: string;
    actorId?: string;
    tenantId?: string;
    entityPath?: string;
    payload: T;
}
