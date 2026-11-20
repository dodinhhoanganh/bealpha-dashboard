import {
  acceptInvitationRequestSchema,
  assignMembershipRequestSchema,
  businessTitleSchema,
  createManagedUserRequestSchema,
  createInvitationRequestSchema,
  entityRoleSchema,
  entitySnapshotSyncSchema,
  emailSchema,
  loginRequestSchema,
  passwordSchema,
  refreshRequestSchema,
  staffRoleSchema,
  invitationStatusSchema,
  updateManagedUserRequestSchema,
  updateProfileRequestSchema
} from "@bealpha/contracts";
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";
import { z } from "zod";

import type { IdentityConfig } from "./config.js";
import { IdentityService } from "./identity-service.js";
import { sendFailure, successEnvelope } from "./response.js";
import type { IdentityUserView } from "./store.js";

const changePasswordSchema = z
  .object({
    currentPassword: passwordSchema,
    newPassword: z
      .string()
      .min(12)
      .max(128)
      .regex(/[a-z]/)
      .regex(/[A-Z]/)
      .regex(/[0-9]/)
      .regex(/[^A-Za-z0-9]/)
  })
  .strict();

const sessionIdSchema = z.string().uuid();
const userIdSchema = z.string().uuid();
const banUserSchema = z
  .object({
    banned: z.boolean(),
    reason: z.string().trim().min(3).max(500).nullable().optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.banned && !value.reason) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "Ban reason is required"
      });
    }
  });
const staffRolesSchema = z
  .object({ roles: z.array(staffRoleSchema).max(4) })
  .strict();
const membershipRoleSchema = z.object({ role: entityRoleSchema }).strict();
const membershipBusinessTitleSchema = z.object({ businessTitle: businessTitleSchema.nullable() }).strict();
const membershipAssignmentSchema = z.object({ entityId: z.string().uuid(), role: entityRoleSchema }).strict();
const resetManagedPasswordSchema = z.object({ newPassword: z.string().min(12).max(128).regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/).regex(/[^A-Za-z0-9]/) }).strict();
const verifyTwoFactorSchema = z.discriminatedUnion("method", [
  z.object({
    challengeId: z.string().uuid(),
    method: z.literal("app"),
    code: z.string().regex(/^\d{6}$/),
    deviceName: z.string().trim().min(1).max(100).optional(),
    deviceType: z.enum(["desktop", "mobile", "tablet", "unknown"]).optional()
  }).strict(),
  z.object({
    challengeId: z.string().uuid(),
    method: z.literal("email"),
    code: z.string().regex(/^\d{6}$/),
    deviceName: z.string().trim().min(1).max(100).optional(),
    deviceType: z.enum(["desktop", "mobile", "tablet", "unknown"]).optional()
  }).strict(),
  z.object({
    challengeId: z.string().uuid(),
    method: z.literal("recovery"),
    code: z.string().trim().regex(/^[A-Fa-f0-9]{5}-?[A-Fa-f0-9]{5}$/),
    deviceName: z.string().trim().min(1).max(100).optional(),
    deviceType: z.enum(["desktop", "mobile", "tablet", "unknown"]).optional()
  }).strict()
]);
const verifyTotpSetupSchema = z
  .object({
    challengeId: z.string().uuid(),
    code: z.string().regex(/^\d{6}$/)
  })
  .strict();
const verifyEmailSetupSchema = verifyTotpSetupSchema;
const disableTwoFactorSchema = z.object({ password: passwordSchema }).strict();
const twoFactorMethodSchema = z.enum(["app", "email"]);
const sendTwoFactorEmailSchema = z
  .object({ challengeId: z.string().uuid(), method: z.literal("email") })
  .strict();
const invitationTokenSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
const invitationListSchema = z
  .object({
    status: invitationStatusSchema.optional(),
    entityId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).max(10000).default(0)
  })
  .strict();
const userListSchema = z
  .object({
    entityId: z.string().uuid().optional(),
    search: z.string().trim().min(1).max(100).optional(),
    active: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).max(10000).default(0)
  })
  .strict();
const requestPasswordResetSchema = z.object({ email: emailSchema }).strict();
const confirmPasswordResetSchema = z
  .object({
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    newPassword: z
      .string()
      .min(12)
      .max(128)
      .regex(/[a-z]/)
      .regex(/[A-Z]/)
      .regex(/[0-9]/)
      .regex(/[^A-Za-z0-9]/)
  })
  .strict();

function metadata(request: FastifyRequest) {
  const userAgent = request.headers["user-agent"];
  return {
    requestId: request.id,
    ipAddress: request.ip,
    ...(userAgent === undefined ? {} : { userAgent })
  };
}

function setRefreshCookie(
  reply: FastifyReply,
  config: IdentityConfig,
  token: string,
  expiresAt: Date
): void {
  reply.setCookie(config.refreshCookieName, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "strict",
    path: "/api/v1/auth",
    expires: expiresAt
  });
}

function clearRefreshCookie(
  reply: FastifyReply,
  config: IdentityConfig
): void {
  reply.clearCookie(config.refreshCookieName, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "strict",
    path: "/api/v1/auth"
  });
}

function serializeUser(user: IdentityUserView) {
  return {
    ...user,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString()
  };
}

export function registerIdentityRoutes(
  app: FastifyInstance,
  config: IdentityConfig,
  service: IdentityService
): void {
  app.post("/api/v1/auth/login", async (request, reply) => {
    const input = loginRequestSchema.parse(request.body);
    const issued = await service.login(input, metadata(request));
    setRefreshCookie(reply, config, issued.refreshToken, issued.refreshExpiresAt);
    return successEnvelope(request.id, issued.response);
  });

  app.post("/api/v1/auth/refresh", async (request, reply) => {
    refreshRequestSchema.parse(request.body ?? {});
    const issued = await service.refresh(
      request.cookies[config.refreshCookieName],
      metadata(request)
    );
    setRefreshCookie(reply, config, issued.refreshToken, issued.refreshExpiresAt);
    return successEnvelope(request.id, issued.response);
  });

  app.post("/api/v1/auth/2fa/verify", async (request, reply) => {
    const input = verifyTwoFactorSchema.parse(request.body);
    const issued = await service.verifyTwoFactor(input, metadata(request));
    setRefreshCookie(reply, config, issued.refreshToken, issued.refreshExpiresAt);
    return successEnvelope(request.id, issued.response);
  });

  app.post("/api/v1/auth/2fa/send", async (request) => {
    const input = sendTwoFactorEmailSchema.parse(request.body);
    const result = await service.sendTwoFactorEmailCode(
      input.challengeId,
      metadata(request)
    );
    return successEnvelope(request.id, result);
  });

  app.post("/api/v1/auth/password-reset/request", async (request) => {
    const input = requestPasswordResetSchema.parse(request.body);
    await service.requestPasswordReset(input.email, metadata(request));
    return successEnvelope(request.id, { success: true });
  });

  app.post("/api/v1/auth/password-reset/confirm", async (request, reply) => {
    const input = confirmPasswordResetSchema.parse(request.body);
    await service.confirmPasswordReset(
      input.token,
      input.newPassword,
      metadata(request)
    );
    clearRefreshCookie(reply, config);
    return successEnvelope(request.id, { success: true });
  });

  app.post("/api/v1/auth/invitations/validate", async (request) => {
    const input = invitationTokenSchema.parse(request.body);
    const invitation = await service.previewInvitation(input.token);
    return successEnvelope(request.id, invitation);
  });

  app.post("/api/v1/auth/invitations/accept", async (request) => {
    const input = acceptInvitationRequestSchema.parse(request.body);
    const result = await service.acceptInvitation(input, metadata(request));
    return successEnvelope(request.id, result);
  });

  app.get("/api/v1/auth/2fa", async (request) => {
    const status = await service.getTwoFactorStatus(request.authContext!);
    return successEnvelope(request.id, status);
  });

  app.post("/api/v1/auth/2fa/setup", async (request) => {
    z.object({}).strict().parse(request.body ?? {});
    const setup = await service.beginTotpSetup(request.authContext!);
    return successEnvelope(request.id, setup);
  });

  app.post("/api/v1/auth/2fa/setup/verify", async (request) => {
    const input = verifyTotpSetupSchema.parse(request.body);
    const recoveryCodes = await service.completeTotpSetup(
      request.authContext!,
      input.challengeId,
      input.code,
      metadata(request)
    );
    return successEnvelope(request.id, {
      success: true,
      recoveryCodes,
      reauthenticationRequired: false
    });
  });

  app.delete("/api/v1/auth/2fa", async (request, reply) => {
    const input = disableTwoFactorSchema.parse(request.body);
    await service.disableTwoFactor(
      request.authContext!,
      input.password,
      metadata(request)
    );
    clearRefreshCookie(reply, config);
    return successEnvelope(request.id, {
      success: true,
      reauthenticationRequired: true
    });
  });

  app.post("/api/v1/auth/2fa/email/setup", async (request) => {
    z.object({}).strict().parse(request.body ?? {});
    const setup = await service.beginEmailTwoFactorSetup(
      request.authContext!,
      metadata(request)
    );
    return successEnvelope(request.id, setup);
  });

  app.post("/api/v1/auth/2fa/email/setup/verify", async (request) => {
    const input = verifyEmailSetupSchema.parse(request.body);
    await service.completeEmailTwoFactorSetup(
      request.authContext!,
      input.challengeId,
      input.code,
      metadata(request)
    );
    return successEnvelope(request.id, {
      success: true,
      reauthenticationRequired: false
    });
  });

  app.delete<{ Params: { method: string } }>(
    "/api/v1/auth/2fa/methods/:method",
    async (request, reply) => {
      const method = twoFactorMethodSchema.parse(request.params.method);
      const input = disableTwoFactorSchema.parse(request.body);
      await service.disableTwoFactorMethod(
        request.authContext!,
        method,
        input.password,
        metadata(request)
      );
      clearRefreshCookie(reply, config);
      return successEnvelope(request.id, {
        success: true,
        reauthenticationRequired: true
      });
    }
  );

  app.post("/api/v1/auth/logout", async (request, reply) => {
    await service.logout(request.authContext!);
    clearRefreshCookie(reply, config);
    return successEnvelope(request.id, { success: true });
  });

  app.get("/api/v1/auth/me", async (request) => {
    const user = await service.requireCurrentUser(request.authContext!);
    return successEnvelope(request.id, user);
  });

  app.get("/api/v1/auth/profile", async (request) => {
    const profile = await service.getProfile(request.authContext!);
    return successEnvelope(request.id, serializeUser(profile));
  });

  app.patch("/api/v1/auth/profile", async (request) => {
    const input = updateProfileRequestSchema.parse(request.body);
    const profile = await service.updateProfile(request.authContext!, input);
    return successEnvelope(request.id, serializeUser(profile));
  });

  app.post("/api/v1/auth/change-password", async (request, reply) => {
    const input = changePasswordSchema.parse(request.body);
    await service.changePassword(
      request.authContext!,
      input.currentPassword,
      input.newPassword
    );
    clearRefreshCookie(reply, config);
    return successEnvelope(request.id, { success: true, reauthenticationRequired: true });
  });

  app.get("/api/v1/auth/sessions", async (request) => {
    const sessions = await service.listSessions(request.authContext!);
    return successEnvelope(request.id, sessions);
  });

  app.post("/api/v1/auth/sessions/revoke-all", async (request, reply) => {
    await service.revokeAllSessions(request.authContext!);
    clearRefreshCookie(reply, config);
    return successEnvelope(request.id, { success: true, reauthenticationRequired: true });
  });

  app.delete<{ Params: { id: string } }>(
    "/api/v1/auth/sessions/:id",
    async (request, reply) => {
      const sessionId = sessionIdSchema.parse(request.params.id);
      const revoked = await service.revokeSession(request.authContext!, sessionId);
      if (!revoked) {
        return sendFailure(
          reply,
          404,
          request.id,
          "NOT_FOUND",
          "Session not found"
        );
      }
      if (sessionId === request.authContext?.sessionId) {
        clearRefreshCookie(reply, config);
      }
      return successEnvelope(request.id, { success: true });
    }
  );

  app.put<{ Params: { id: string } }>(
    "/api/v1/identity/users/:id/membership",
    async (request) => {
      const input = membershipAssignmentSchema.parse(request.body);
      const user = await service.reassignMembership(
        request.authContext!,
        userIdSchema.parse(request.params.id),
        input.entityId,
        input.role
      );
      return successEnvelope(request.id, serializeUser(user));
    }
  );

  app.post<{ Params: { id: string } }>(
    "/api/v1/identity/users/:id/reset-password",
    async (request) => {
      const input = resetManagedPasswordSchema.parse(request.body);
      await service.resetManagedUserPassword(
        request.authContext!,
        userIdSchema.parse(request.params.id),
        input.newPassword,
        metadata(request)
      );
      return successEnvelope(request.id, { success: true });
    }
  );

  app.patch<{ Params: { id: string } }>(
    "/api/v1/identity/users/:id/ban",
    async (request) => {
      const targetUserId = userIdSchema.parse(request.params.id);
      const input = banUserSchema.parse(request.body);
      await service.setUserBan(
        request.authContext!,
        targetUserId,
        input.banned,
        input.reason ?? null,
        metadata(request)
      );
      return successEnvelope(request.id, { success: true });
    }
  );

  app.patch<{ Params: { id: string } }>(
    "/api/v1/identity/users/:id/business-title",
    async (request) => {
      const targetUserId = userIdSchema.parse(request.params.id);
      const input = membershipBusinessTitleSchema.parse(request.body);
      await service.changeUserBusinessTitle(
        request.authContext!,
        targetUserId,
        input.businessTitle,
        metadata(request)
      );
      return successEnvelope(request.id, { success: true });
    }
  );

  app.put<{ Params: { id: string } }>(
    "/api/v1/identity/users/:id/staff-roles",
    async (request) => {
      const targetUserId = userIdSchema.parse(request.params.id);
      const input = staffRolesSchema.parse(request.body);
      await service.replaceUserStaffRoles(
        request.authContext!,
        targetUserId,
        input.roles,
        metadata(request)
      );
      return successEnvelope(request.id, { success: true });
    }
  );

  app.patch<{ Params: { id: string } }>(
    "/api/v1/identity/users/:id/membership-role",
    async (request) => {
      const targetUserId = userIdSchema.parse(request.params.id);
      const input = membershipRoleSchema.parse(request.body);
      await service.changeUserMembershipRole(
        request.authContext!,
        targetUserId,
        input.role,
        metadata(request)
      );
      return successEnvelope(request.id, { success: true });
    }
  );

  app.put("/api/v1/identity/internal/entity-snapshots", async (request) => {
    const snapshot = entitySnapshotSyncSchema.parse(request.body);
    const updated = await service.syncEntitySnapshot(request.authContext!, snapshot);
    return successEnvelope(request.id, { updated });
  });

  app.get("/api/v1/identity/roles", async (request) => {
    await service.requireCurrentUser(request.authContext!);
    return successEnvelope(request.id, service.getRoleCatalog());
  });

  app.get("/api/v1/identity/users", async (request) => {
    const query = userListSchema.parse(request.query);
    const result = await service.listUsers(request.authContext!, {
      limit: query.limit,
      offset: query.offset,
      ...(query.entityId === undefined ? {} : { entityId: query.entityId }),
      ...(query.search === undefined ? {} : { search: query.search }),
      ...(query.active === undefined ? {} : { active: query.active })
    });
    return successEnvelope(request.id, {
      users: result.users.map(serializeUser),
      total: result.total,
      limit: query.limit,
      offset: query.offset
    });
  });

  app.post("/api/v1/identity/users", async (request, reply) => {
    const input = createManagedUserRequestSchema.parse(request.body);
    const user = await service.createManagedUser(request.authContext!, input);
    reply.code(201);
    return successEnvelope(request.id, serializeUser(user));
  });

  app.get<{ Params: { id: string } }>(
    "/api/v1/identity/users/:id",
    async (request) => {
      const user = await service.getUser(
        request.authContext!,
        userIdSchema.parse(request.params.id)
      );
      return successEnvelope(request.id, serializeUser(user));
    }
  );

  app.patch<{ Params: { id: string } }>(
    "/api/v1/identity/users/:id",
    async (request) => {
      const input = updateManagedUserRequestSchema.parse(request.body);
      const user = await service.updateManagedUser(
        request.authContext!,
        userIdSchema.parse(request.params.id),
        input
      );
      return successEnvelope(request.id, serializeUser(user));
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/api/v1/identity/users/:id",
    async (request) => {
      await service.deactivateUser(
        request.authContext!,
        userIdSchema.parse(request.params.id),
        metadata(request)
      );
      return successEnvelope(request.id, { success: true });
    }
  );

  app.post<{ Params: { entityId: string } }>(
    "/api/v1/identity/entities/:entityId/members",
    async (request) => {
      const input = assignMembershipRequestSchema.parse(request.body);
      const user = await service.assignMembership(
        request.authContext!,
        userIdSchema.parse(request.params.entityId),
        input.userId,
        input.role
      );
      return successEnvelope(request.id, serializeUser(user));
    }
  );

  app.delete<{ Params: { entityId: string; userId: string } }>(
    "/api/v1/identity/entities/:entityId/members/:userId",
    async (request) => {
      await service.removeMembership(
        request.authContext!,
        userIdSchema.parse(request.params.entityId),
        userIdSchema.parse(request.params.userId)
      );
      return successEnvelope(request.id, { success: true });
    }
  );

  app.get("/api/v1/identity/invitations", async (request) => {
    const query = invitationListSchema.parse(request.query);
    const result = await service.listInvitations(request.authContext!, {
      limit: query.limit,
      offset: query.offset,
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.entityId === undefined ? {} : { entityId: query.entityId })
    });
    return successEnvelope(request.id, {
      invitations: result.invitations.map((invitation) => ({
        ...invitation,
        expiresAt: invitation.expiresAt.toISOString(),
        acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
        createdAt: invitation.createdAt.toISOString()
      })),
      total: result.total,
      limit: query.limit,
      offset: query.offset
    });
  });

  app.post("/api/v1/identity/invitations", async (request, reply) => {
    const input = createInvitationRequestSchema.parse(request.body);
    const invitation = await service.createInvitation(
      request.authContext!,
      input,
      metadata(request)
    );
    reply.code(201);
    return successEnvelope(request.id, {
      ...invitation,
      expiresAt: invitation.expiresAt.toISOString(),
      acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
      createdAt: invitation.createdAt.toISOString()
    });
  });

  app.delete<{ Params: { id: string } }>(
    "/api/v1/identity/invitations/:id",
    async (request) => {
      await service.revokeInvitation(
        request.authContext!,
        userIdSchema.parse(request.params.id)
      );
      return successEnvelope(request.id, { success: true });
    }
  );

  app.post<{ Params: { id: string } }>(
    "/api/v1/identity/invitations/:id/resend",
    async (request) => {
      z.object({}).strict().parse(request.body ?? {});
      await service.resendInvitation(
        request.authContext!,
        userIdSchema.parse(request.params.id),
        metadata(request)
      );
      return successEnvelope(request.id, { success: true });
    }
  );
}
