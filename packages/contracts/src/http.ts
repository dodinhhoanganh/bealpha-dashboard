import { z } from "zod";
export const API_VERSION = "v1";
export const REQUEST_ID_HEADER = "x-request-id";
export const INTERNAL_CONTEXT_HEADER = "x-bealpha-context";
export const apiErrorCodeSchema = z.enum([
    "UNAUTHENTICATED",
    "FORBIDDEN",
    "NOT_FOUND",
    "METHOD_NOT_ALLOWED",
    "CONFLICT",
    "ACCOUNT_BANNED",
    "ACCOUNT_LOCKED",
    "TWO_FACTOR_REQUIRED",
    "REFRESH_REUSE_DETECTED",
    "VALIDATION_ERROR",
    "PAYLOAD_TOO_LARGE",
    "RATE_LIMITED",
    "UPSTREAM_UNAVAILABLE",
    "INTERNAL_ERROR",
    "VERSION_CONFLICT",
    "DOMAIN_CONFLICT",
    "DOMAIN_NOT_VERIFIED",
    "TENANT_DOMAIN_MISMATCH",
    "UNRECOGNIZED_TENANT_DOMAIN"
]);
export const apiErrorSchema = z
    .object({
    code: apiErrorCodeSchema,
    message: z.string().min(1).max(512),
    details: z.unknown().optional()
})
    .strict();
export const requestIdSchema = z.string().uuid();
export function apiSuccessSchema<T extends z.ZodTypeAny>(dataSchema: T) {
    return z
        .object({
        data: dataSchema,
        error: z.null(),
        requestId: requestIdSchema
    })
        .strict();
}
export const apiFailureSchema = z
    .object({
    data: z.null(),
    error: apiErrorSchema,
    requestId: requestIdSchema
})
    .strict();
export function apiEnvelopeSchema<T extends z.ZodTypeAny>(dataSchema: T) {
    return z.union([apiSuccessSchema(dataSchema), apiFailureSchema]);
}

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export interface ApiSuccess<T> {
    data: T;
    error: null;
    requestId: string;
}

export interface ApiFailure {
    data: null;
    error: {
        code: ApiErrorCode;
        message: string;
        details?: unknown;
    };
    requestId: string;
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;
