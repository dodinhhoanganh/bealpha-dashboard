import { z } from "zod";

export function hasValidGtinCheckDigit(value: string): boolean {
    if (!/^\d{12,14}$/.test(value)) return false;
    const digits = [...value].map(Number);
    const checkDigit = digits.pop();
    const sum = digits.reverse().reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
    return checkDigit === (10 - (sum % 10)) % 10;
}

export const upcEanSchema = z.string().regex(/^\d{12,14}$/).refine(hasValidGtinCheckDigit, "Invalid GTIN check digit");
export const isrcSchema = z.string().regex(/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/);
export const basisPointsSchema = z.number().int().min(0).max(10_000);
export const releaseStatusSchema = z.enum([
    "DRAFT",
    "PENDING_ORG_APPROVAL",
    "ORG_REJECTED",
    "PENDING_SYS_APPROVAL",
    "SYS_REJECTED",
    "PENDING_SUPER_APPROVAL",
    "SUPER_REJECTED",
    "APPROVED",
    "SCHEDULED",
    "LOCKED_FOR_DELIVERY",
    "DELIVERED",
    "RELEASED",
    "TAKEDOWN"
]);
export const releaseIdentifierSchema = z
    .object({
    releaseId: z.string().min(1).max(128),
    upcEan: upcEanSchema,
    status: releaseStatusSchema
})
    .strict();
export const trackIdentifierSchema = z
    .object({
    trackId: z.string().min(1).max(128),
    isrc: isrcSchema,
    identifiersLocked: z.boolean()
})
    .strict();
export const royaltySplitSchema = z
    .object({
    partyId: z.string().min(1).max(128),
    basisPoints: basisPointsSchema
})
    .strict();
export const catalogImportRequestSchema = z
    .object({
    assetId: z.string().uuid(),
    format: z.enum(["XML", "ZIP", "CSV", "XLSX"])
})
    .strict();
export const catalogImportStatusSchema = z.enum([
    "PENDING",
    "PROCESSING",
    "COMPLETE",
    "FAILED"
]);
export const subAccountLabelAccessSchema = z.object({
    subAccountId: z.string().uuid(),
    labelIds: z.array(z.string().uuid()).max(1000)
}).strict();

export type ReleaseStatus = z.infer<typeof releaseStatusSchema>;
export type ReleaseIdentifier = z.infer<typeof releaseIdentifierSchema>;
export type TrackIdentifier = z.infer<typeof trackIdentifierSchema>;
export type RoyaltySplit = z.infer<typeof royaltySplitSchema>;
export type CatalogImportRequest = z.infer<typeof catalogImportRequestSchema>;
export type CatalogImportStatus = z.infer<typeof catalogImportStatusSchema>;
export type SubAccountLabelAccess = z.infer<typeof subAccountLabelAccessSchema>;
