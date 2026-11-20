import { z } from "zod";
import { entityPathSchema, entityRoleSchema, platformRoleSchema, staffRoleSchema } from "./auth.js";
const identifierSchema = z.string().min(1).max(128);
export const emailSchema = z.string().trim().email().max(254).toLowerCase();
export const passwordSchema = z.string().min(8).max(128);
export const businessTitleSchema = z.string().trim().min(2).max(100);
export const strongPasswordSchema = z
    .string()
    .min(12)
    .max(128)
    .regex(/[a-z]/)
    .regex(/[A-Z]/)
    .regex(/[0-9]/)
    .regex(/[^A-Za-z0-9]/);
export const loginRequestSchema = z
    .object({
    email: emailSchema,
    password: passwordSchema,
    rememberMe: z.boolean().default(false),
    deviceName: z.string().trim().min(1).max(100).optional(),
    deviceType: z.enum(["desktop", "mobile", "tablet", "unknown"]).optional()
})
    .strict();
export const refreshRequestSchema = z.object({}).strict();
export const identityUserSchema = z
    .object({
    id: identifierSchema,
    email: emailSchema,
    name: z.string().max(100).nullable(),
    stageName: z.string().max(100).nullable(),
    entityId: identifierSchema,
    entityType: platformRoleSchema,
    entityRole: entityRoleSchema,
    entityName: z.string().min(1).max(255),
    entityPath: entityPathSchema,
    tenantId: identifierSchema.nullable(),
    staffRoles: z.array(staffRoleSchema).max(16),
    authzVersion: z.number().int().nonnegative()
})
    .strict();
export const loginResponseSchema = z
    .object({
    accessToken: z.string().min(1).max(8192),
    expiresIn: z.number().int().positive().max(3600),
    user: identityUserSchema
})
    .strict();
export const sessionSchema = z
    .object({
    id: identifierSchema,
    deviceName: z.string().max(100).nullable(),
    deviceType: z.string().max(30).nullable(),
    ipAddress: z.string().max(64).nullable(),
    userAgent: z.string().max(512).nullable(),
    createdAt: z.string().datetime({ offset: true }),
    lastUsedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    current: z.boolean()
})
    .strict();
export const membershipSnapshotSchema = z
    .object({
    id: identifierSchema,
    userId: identifierSchema,
    entityId: identifierSchema,
    entityType: platformRoleSchema,
    entityRole: entityRoleSchema,
    businessTitle: businessTitleSchema.nullable(),
    entityName: z.string().min(1).max(255),
    entityPath: entityPathSchema,
    tenantId: identifierSchema.nullable()
})
    .strict();
export const businessTierSchema = z.enum(["BEALPHA", "DISTRIBUTOR", "LABEL", "ARTIST"]);
export type BusinessTier = z.infer<typeof businessTierSchema>;

export const entitySnapshotSyncSchema = z
    .object({
    id: z.string().uuid(),
    entityType: platformRoleSchema,
    businessTier: businessTierSchema.nullable().optional(),
    name: z.string().trim().min(1).max(255),
    path: entityPathSchema,
    tenantId: z.string().uuid().nullable(),
    isActive: z.boolean(),
        version: z.number().int().positive()
    })
    .strict()
    .superRefine((snapshot, context) => {
    if (snapshot.businessTier != null) {
        const compatible = snapshot.entityType === "SYSTEM_ADMIN"
            ? snapshot.businessTier === "BEALPHA"
            : snapshot.entityType === "ORGANIZATION"
                ? snapshot.businessTier === "DISTRIBUTOR" || snapshot.businessTier === "LABEL"
                : snapshot.entityType === "SUB_ACCOUNT" && snapshot.businessTier === "ARTIST";
        if (!compatible) context.addIssue({ code: z.ZodIssueCode.custom, path: ["businessTier"], message: "Business tier does not match entity type" });
    }
    const validTenant = snapshot.entityType === "ORGANIZATION"
        ? snapshot.tenantId !== null
        : snapshot.entityType === "SUB_ACCOUNT"
            ? snapshot.tenantId !== null && (snapshot.tenantId !== snapshot.id || snapshot.businessTier === "ARTIST")
            : snapshot.tenantId === null;
    if (!validTenant) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["tenantId"],
            message: "Entity snapshot tenant does not match its hierarchy level"
        });
    }
});
export const invitationStatusSchema = z.enum([
    "PENDING",
    "ACCEPTED",
    "EXPIRED",
    "REVOKED"
]);
export const createInvitationRequestSchema = z
    .object({
    email: emailSchema,
    entityId: z.string().uuid(),
    role: entityRoleSchema.default("MEMBER"),
    businessTitle: businessTitleSchema.optional()
})
    .strict();
export const acceptInvitationRequestSchema = z
    .object({
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    name: z.string().trim().min(2).max(100).optional(),
    password: strongPasswordSchema.optional()
})
    .strict();
export const createManagedUserRequestSchema = z
    .object({
    email: emailSchema,
    password: strongPasswordSchema,
    name: z.string().trim().min(2).max(100),
    phone: z.string().trim().min(3).max(32).optional(),
    entityId: z.string().uuid(),
    entityRole: entityRoleSchema.default("MEMBER"),
    businessTitle: businessTitleSchema.optional(),
    staffRoles: z.array(staffRoleSchema).max(4).default([])
})
    .strict();
export const updateProfileRequestSchema = z
    .object({
    name: z.string().trim().min(2).max(100).optional(),
    stageName: z.string().trim().min(1).max(100).nullable().optional(),
    phone: z.string().trim().min(3).max(32).nullable().optional(),
    avatar: z
        .string()
        .url()
        .max(2048)
        .refine((value) => ["http:", "https:"].includes(new URL(value).protocol))
        .nullable()
        .optional(),
    language: z.string().trim().min(2).max(10).optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    theme: z.enum(["light", "dark", "system"]).optional(),
    notifyReleases: z.boolean().optional(),
    notifyRoyalties: z.boolean().optional(),
    notifyNews: z.boolean().optional(),
    notifyMarketing: z.boolean().optional()
})
    .strict();
export const updateManagedUserRequestSchema = z
    .object({
    email: emailSchema.optional(),
    name: z.string().trim().min(2).max(100).optional(),
    stageName: z.string().trim().min(1).max(100).nullable().optional(),
    phone: z.string().trim().min(3).max(32).nullable().optional(),
    avatar: z.string().url().max(2048).nullable().optional(),
    isActive: z.boolean().optional()
})
    .strict()
    .refine((value) => Object.keys(value).length > 0);
export const assignMembershipRequestSchema = z
    .object({
    userId: z.string().uuid(),
    role: entityRoleSchema.default("MEMBER")
})
    .strict();

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type IdentityUser = z.infer<typeof identityUserSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
export type IdentitySession = z.infer<typeof sessionSchema>;
export type MembershipSnapshot = z.infer<typeof membershipSnapshotSchema>;
export type EntitySnapshotSync = z.infer<typeof entitySnapshotSyncSchema>;
export type InvitationStatus = z.infer<typeof invitationStatusSchema>;
export type CreateInvitationRequest = z.infer<typeof createInvitationRequestSchema>;
export type AcceptInvitationRequest = z.infer<typeof acceptInvitationRequestSchema>;
export type CreateManagedUserRequest = z.infer<typeof createManagedUserRequestSchema>;
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;
export type UpdateManagedUserRequest = z.infer<typeof updateManagedUserRequestSchema>;
export type AssignMembershipRequest = z.infer<typeof assignMembershipRequestSchema>;
