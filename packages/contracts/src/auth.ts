import { z } from "zod";
export const platformRoleSchema = z.enum([
    "SUPER_ADMIN",
    "SYSTEM_ADMIN",
    "ORGANIZATION",
    "SUB_ACCOUNT"
]);
export const IDENTITY_SESSION_KEY_PREFIX = "identity:session:";
export const IDENTITY_AUTHZ_KEY_PREFIX = "identity:authz-version:";
export function identitySessionKey(sessionId: string): string {
    return `${IDENTITY_SESSION_KEY_PREFIX}${sessionId}`;
}
export function identityAuthzVersionKey(userId: string): string {
    return `${IDENTITY_AUTHZ_KEY_PREFIX}${userId}`;
}
export const entityRoleSchema = z.enum(["OWNER", "ADMIN", "REVIEWER", "ACCOUNTANT", "MEMBER"]);
export const staffRoleSchema = z.enum([
    "admin",
    "moderator",
    "supporter",
    "finance"
]);
export const entityPathSchema = z
    .string()
    .min(1)
    .max(2048)
    .regex(/^(?:[A-Za-z0-9_]+|[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12})(?:\.(?:[A-Za-z0-9_]+|[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}))*$/);
const identifierSchema = z.string().min(1).max(128);
export const accessTokenClaimsSchema = z
    .object({
    sub: identifierSchema,
    sessionId: identifierSchema,
    entityId: identifierSchema,
    entityType: platformRoleSchema,
    entityRole: entityRoleSchema,
    tenantId: identifierSchema.optional(),
    entityPath: entityPathSchema.optional(),
    roles: z.array(platformRoleSchema).max(4),
    staffRoles: z.array(staffRoleSchema).max(16),
    authzVersion: z.number().int().nonnegative()
})
    .strict();
export const internalAuthContextSchema = z
    .object({
    v: z.literal(1),
    requestId: z.string().uuid(),
    authType: z.enum(["anonymous", "user", "service"]),
    actorId: identifierSchema.optional(),
    serviceId: identifierSchema.optional(),
    sessionId: identifierSchema.optional(),
    entityId: identifierSchema.optional(),
    entityType: platformRoleSchema.optional(),
    entityRole: entityRoleSchema.optional(),
    tenantId: identifierSchema.optional(),
    entityPath: entityPathSchema.optional(),
    roles: z.array(platformRoleSchema).max(4),
    staffRoles: z.array(staffRoleSchema).max(16),
    authzVersion: z.number().int().nonnegative().optional()
})
    .strict();

export type PlatformRole = z.infer<typeof platformRoleSchema>;
export type EntityRole = z.infer<typeof entityRoleSchema>;
export type StaffRole = z.infer<typeof staffRoleSchema>;
export type AccessTokenClaims = z.infer<typeof accessTokenClaimsSchema>;
export type InternalAuthContext = z.infer<typeof internalAuthContextSchema>;
