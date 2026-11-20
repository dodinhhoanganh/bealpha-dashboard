import { randomBytes, randomInt, randomUUID } from "node:crypto";

import type {
  AcceptInvitationRequest,
  CreateInvitationRequest,
  CreateManagedUserRequest,
  EntityRole,
  EntitySnapshotSync,
  IdentitySession,
  IdentityUser,
  InternalAuthContext,
  LoginRequest,
  LoginResponse,
  StaffRole,
  InvitationStatus,
  UpdateManagedUserRequest,
  UpdateProfileRequest
} from "@bealpha/contracts";
import bcrypt from "bcryptjs";
import { authenticator } from "otplib";

import type { IdentityConfig } from "./config.js";
import { IdentityError } from "./errors.js";
import { SensitivePayloadCipher } from "./outbox.js";
import type { SessionRegistry } from "./session-registry.js";
import type {
  IdentityStore,
  NewSessionInput,
  TwoFactorChallengeRecord
} from "./store.js";
import { TokenService } from "./token-service.js";

export interface RequestMetadata {
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface IssuedSession {
  response: LoginResponse;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export interface TwoFactorVerifyInput {
  challengeId: string;
  method: "app" | "email" | "recovery";
  code: string;
  deviceName?: string | undefined;
  deviceType?: "desktop" | "mobile" | "tablet" | "unknown" | undefined;
}

interface SessionPreferences {
  rememberMe: boolean;
  deviceName?: string | undefined;
  deviceType?: "desktop" | "mobile" | "tablet" | "unknown" | undefined;
}

function isSuperOwner(actor: Pick<IdentityUser, "entityType" | "entityRole">): boolean {
  return actor.entityType === "SUPER_ADMIN" && actor.entityRole === "OWNER";
}

function sessionInput(
  userId: string,
  familyId: string,
  refreshTokenHash: string,
  expiresAt: Date,
  input: SessionPreferences,
  metadata: RequestMetadata
): NewSessionInput {
  return {
    id: randomUUID(),
    userId,
    familyId,
    refreshTokenHash,
    expiresAt,
    ...(metadata.ipAddress === undefined
      ? {}
      : { ipAddress: metadata.ipAddress.slice(0, 64) }),
    ...(metadata.userAgent === undefined
      ? {}
      : { userAgent: metadata.userAgent.slice(0, 512) }),
    ...(input.deviceName === undefined ? {} : { deviceName: input.deviceName }),
    ...(input.deviceType === undefined ? {} : { deviceType: input.deviceType })
  };
}

export class IdentityService {
  private constructor(
    private readonly config: IdentityConfig,
    private readonly store: IdentityStore,
    private readonly registry: SessionRegistry,
    private readonly tokens: TokenService,
    private readonly dummyPasswordHash: string,
    private readonly outboxCipher: SensitivePayloadCipher
  ) {}

  static async create(
    config: IdentityConfig,
    store: IdentityStore,
    registry: SessionRegistry,
    tokens?: TokenService
  ): Promise<IdentityService> {
    authenticator.options = {
      window: config.totpWindow,
      step: config.totpStepSeconds,
      digits: config.totpDigits
    };
    return new IdentityService(
      config,
      store,
      registry,
      tokens ?? (await TokenService.create(config)),
      await bcrypt.hash("invalid-password-timing-pad", config.bcryptCost),
      new SensitivePayloadCipher(config.outboxEncryptionKey)
    );
  }

  async login(
    input: LoginRequest,
    metadata: RequestMetadata
  ): Promise<IssuedSession> {
    const record = await this.store.findUserForLogin(input.email);
    if (!record) {
      await bcrypt.compare(input.password, this.dummyPasswordHash);
      throw new IdentityError(401, "UNAUTHENTICATED", "Invalid email or password");
    }
    if (record.isBanned) {
      throw new IdentityError(403, "ACCOUNT_BANNED", "Account is banned");
    }
    if (!record.isActive) {
      throw new IdentityError(401, "UNAUTHENTICATED", "Invalid email or password");
    }
    if (record.lockoutUntil && record.lockoutUntil > new Date()) {
      throw new IdentityError(429, "ACCOUNT_LOCKED", "Account is temporarily locked", {
        retryAfterSeconds: Math.ceil(
          (record.lockoutUntil.getTime() - Date.now()) / 1000
        )
      });
    }

    const valid = await bcrypt.compare(input.password, record.passwordHash);
    if (!valid) {
      const failure = await this.store.recordFailedLogin(
        record.userId,
        this.config.maxLoginAttempts,
        new Date(Date.now() + this.config.lockoutSeconds * 1000)
      );
      throw new IdentityError(
        failure.locked ? 429 : 401,
        failure.locked ? "ACCOUNT_LOCKED" : "UNAUTHENTICATED",
        failure.locked ? "Account is temporarily locked" : "Invalid email or password"
      );
    }

    const user = record.identity;
    if (!user) {
      throw new IdentityError(403, "FORBIDDEN", "No entity membership assigned");
    }
    await this.store.clearFailedLogin(record.userId);

    if (record.twoFactorEnabled) {
      const methods = record.twoFactorMethods.filter(
        (method) => method === "app" || method === "email"
      );
      if (methods.length === 0) {
        throw new IdentityError(
          409,
          "CONFLICT",
          "Configured two-factor method is not available"
        );
      }
      const challengeId = await this.store.createTwoFactorChallenge(
        user.id,
        methods,
        input.rememberMe,
        new Date(Date.now() + this.config.twoFactorChallengeTtlSeconds * 1000)
      );
      throw new IdentityError(
        409,
        "TWO_FACTOR_REQUIRED",
        "Two-factor verification required",
        { challengeId, methods }
      );
    }

    const issued = await this.issueSession(user, input, metadata);
    void this.audit({
      ...metadata,
      userId: user.id,
      type: "identity.login.succeeded"
    });

    return issued;
  }

  async verifyTwoFactor(
    input: TwoFactorVerifyInput,
    metadata: RequestMetadata
  ): Promise<IssuedSession> {
    const challenge = await this.store.getTwoFactorChallenge(input.challengeId);
    if (
      !challenge ||
      challenge.attempts >= this.config.maxTwoFactorAttempts ||
      !challenge.isActive ||
      challenge.isBanned ||
      !challenge.identity
    ) {
      throw new IdentityError(401, "UNAUTHENTICATED", "Invalid or expired challenge");
    }
    if (input.method === "email") {
      if (!challenge.allowedMethods.includes("email")) {
        throw new IdentityError(403, "FORBIDDEN", "Verification method not allowed");
      }
      const consumed = await this.store.consumeEmailCodeAndChallenge(
        challenge.userId,
        challenge.id,
        this.outboxCipher.blindIndex(`${challenge.id}:${input.code}`)
      );
      if (!consumed) {
        await this.store.recordTwoFactorFailure(
          challenge.id,
          this.config.maxTwoFactorAttempts
        );
        throw new IdentityError(401, "UNAUTHENTICATED", "Invalid verification code");
      }
      return this.finishTwoFactorLogin(challenge, input, metadata);
    }
    if (!challenge.allowedMethods.includes("app") || !challenge.secret) {
      throw new IdentityError(403, "FORBIDDEN", "Verification method not allowed");
    }
    let valid = false;
    let matchedRecoveryHash: string | undefined;
    if (input.method === "app") {
      valid = /^\d{6}$/.test(input.code) && authenticator.verify({
        token: input.code,
        secret: challenge.secret
      });
    } else {
      const compact = input.code.replace(/[\s-]/g, "").toUpperCase();
      const formatted = compact.length === 10
        ? `${compact.slice(0, 5)}-${compact.slice(5)}`
        : compact;
      for (const hash of challenge.recoveryCodeHashes) {
        const matches = await bcrypt.compare(formatted, hash);
        if (matches && matchedRecoveryHash === undefined) matchedRecoveryHash = hash;
      }
      valid = matchedRecoveryHash !== undefined;
    }
    if (!valid) {
      await this.store.recordTwoFactorFailure(
        challenge.id,
        this.config.maxTwoFactorAttempts
      );
      throw new IdentityError(401, "UNAUTHENTICATED", "Invalid verification code");
    }
    const consumed = input.method === "recovery"
      ? await this.store.consumeRecoveryCodeAndChallenge(
          challenge.userId,
          challenge.id,
          matchedRecoveryHash!
        )
      : await this.store.consumeTwoFactorChallenge(challenge.id);
    if (!consumed) {
      throw new IdentityError(401, "UNAUTHENTICATED", "Challenge already consumed");
    }
    return this.finishTwoFactorLogin(challenge, input, metadata);
  }

  async sendTwoFactorEmailCode(
    challengeId: string,
    metadata: RequestMetadata
  ): Promise<{ maskedContact: string }> {
    const challenge = await this.store.getTwoFactorChallenge(challengeId);
    if (
      !challenge ||
      !challenge.identity ||
      !challenge.allowedMethods.includes("email") ||
      !challenge.isActive ||
      challenge.isBanned
    ) {
      throw new IdentityError(401, "UNAUTHENTICATED", "Invalid or expired challenge");
    }
    const code = randomInt(100000, 1000000).toString();
    const expiresAt = new Date(
      Date.now() + this.config.twoFactorEmailCodeTtlSeconds * 1000
    );
    const encrypted = this.outboxCipher.encrypt({
      channel: "email",
      template: "two-factor-code",
      recipient: challenge.identity.email,
      locale: "en",
      variables: { code, expiresAt: expiresAt.toISOString() }
    });
    const result = await this.store.createTwoFactorEmailCode({
      challengeId: challenge.id,
      codeHash: this.outboxCipher.blindIndex(`${challenge.id}:${code}`),
      expiresAt,
      cooldownSince: new Date(
        Date.now() - this.config.twoFactorEmailCooldownSeconds * 1000
      ),
      windowSince: new Date(
        Date.now() - this.config.twoFactorEmailRateWindowSeconds * 1000
      ),
      maxSends: this.config.twoFactorEmailMaxSends,
      outbox: {
        eventId: randomUUID(),
        type: "notification.requested",
        requestId: metadata.requestId,
        payloadCiphertext: encrypted.ciphertext,
        payloadIv: encrypted.iv,
        payloadAuthTag: encrypted.authTag
      }
    });
    if (result.kind === "invalid") {
      throw new IdentityError(401, "UNAUTHENTICATED", "Invalid or expired challenge");
    }
    if (result.kind !== "created") {
      throw new IdentityError(429, "RATE_LIMITED", "Verification code recently sent");
    }
    const [local, domain] = challenge.identity.email.split("@");
    const maskedLocal = local!.length <= 2 ? `${local![0]}***` : `${local!.slice(0, 2)}***`;
    return { maskedContact: `${maskedLocal}@${domain}` };
  }

  async getTwoFactorStatus(context: InternalAuthContext) {
    const user = await this.requireCurrentUser(context);
    const status = await this.store.getTwoFactorStatus(user.id);
    if (!status) throw new IdentityError(404, "NOT_FOUND", "User not found");
    return status;
  }

  async beginTotpSetup(context: InternalAuthContext): Promise<{
    challengeId: string;
    secret: string;
    otpauthUri: string;
    expiresIn: number;
  }> {
    const user = await this.requireCurrentUser(context);
    const secret = authenticator.generateSecret();
    const challengeId = await this.store.createTotpSetup(
      user.id,
      secret,
      new Date(Date.now() + this.config.twoFactorChallengeTtlSeconds * 1000)
    );
    return {
      challengeId,
      secret,
      otpauthUri: authenticator.keyuri(user.email, this.config.totpIssuer, secret),
      expiresIn: this.config.twoFactorChallengeTtlSeconds
    };
  }

  async completeTotpSetup(
    context: InternalAuthContext,
    challengeId: string,
    code: string,
    metadata: RequestMetadata
  ): Promise<string[]> {
    const user = await this.requireCurrentUser(context);
    const challenge = await this.store.getTwoFactorChallenge(challengeId);
    if (
      !challenge ||
      challenge.userId !== user.id ||
      !challenge.allowedMethods.includes("setup:app") ||
      !challenge.secret
    ) {
      throw new IdentityError(401, "UNAUTHENTICATED", "Invalid or expired setup");
    }
    if (!authenticator.verify({ token: code, secret: challenge.secret })) {
      await this.store.recordTwoFactorFailure(
        challenge.id,
        this.config.maxTwoFactorAttempts
      );
      throw new IdentityError(401, "UNAUTHENTICATED", "Invalid verification code");
    }
    const recoveryCodes = Array.from({ length: 10 }, () => {
      const raw = randomBytes(5).toString("hex").toUpperCase();
      return `${raw.slice(0, 5)}-${raw.slice(5)}`;
    });
    const recoveryCodeHashes = await Promise.all(
      recoveryCodes.map((recoveryCode) =>
        bcrypt.hash(recoveryCode, this.config.bcryptCost)
      )
    );
    const result = await this.store.finalizeTotpSetup(
      user.id,
      challenge.id,
      recoveryCodeHashes,
      context.sessionId!
    );
    if (!result) {
      throw new IdentityError(401, "UNAUTHENTICATED", "Setup already consumed");
    }
    await this.applyAuthorizationChange(user.id, result);
    void this.audit({
      ...metadata,
      userId: user.id,
      type: "identity.2fa.enabled",
      severity: "warning"
    });
    return recoveryCodes;
  }

  async disableTwoFactor(
    context: InternalAuthContext,
    password: string,
    metadata: RequestMetadata
  ): Promise<void> {
    const user = await this.requireCurrentUser(context);
    const passwordHash = await this.store.findPasswordHash(user.id);
    if (!passwordHash || !(await bcrypt.compare(password, passwordHash))) {
      throw new IdentityError(401, "UNAUTHENTICATED", "Password is incorrect");
    }
    const result = await this.store.disableTwoFactor(user.id);
    if (!result) throw new IdentityError(404, "NOT_FOUND", "User not found");
    await this.applyAuthorizationChange(user.id, result);
    void this.audit({
      ...metadata,
      userId: user.id,
      type: "identity.2fa.disabled",
      severity: "warning"
    });
  }

  async beginEmailTwoFactorSetup(
    context: InternalAuthContext,
    metadata: RequestMetadata
  ): Promise<{ challengeId: string; maskedContact: string; expiresIn: number }> {
    const user = await this.requireCurrentUser(context);
    const challengeId = await this.store.createTwoFactorChallenge(
      user.id,
      ["email", "setup:email"],
      false,
      new Date(Date.now() + this.config.twoFactorChallengeTtlSeconds * 1000)
    );
    const delivery = await this.sendTwoFactorEmailCode(challengeId, metadata);
    return {
      challengeId,
      maskedContact: delivery.maskedContact,
      expiresIn: this.config.twoFactorEmailCodeTtlSeconds
    };
  }

  async completeEmailTwoFactorSetup(
    context: InternalAuthContext,
    challengeId: string,
    code: string,
    metadata: RequestMetadata
  ): Promise<void> {
    const user = await this.requireCurrentUser(context);
    const challenge = await this.store.getTwoFactorChallenge(challengeId);
    if (
      !challenge ||
      challenge.userId !== user.id ||
      !challenge.allowedMethods.includes("setup:email")
    ) {
      throw new IdentityError(401, "UNAUTHENTICATED", "Invalid or expired setup");
    }
    const codeHash = this.outboxCipher.blindIndex(`${challenge.id}:${code}`);
    const result = await this.store.finalizeEmailTwoFactorSetup(
      user.id,
      challenge.id,
      codeHash,
      context.sessionId!
    );
    if (!result) {
      await this.store.recordTwoFactorFailure(
        challenge.id,
        this.config.maxTwoFactorAttempts
      );
      throw new IdentityError(401, "UNAUTHENTICATED", "Invalid verification code");
    }
    await this.applyAuthorizationChange(user.id, result);
    void this.audit({
      ...metadata,
      userId: user.id,
      type: "identity.2fa.email_verified",
      severity: "warning"
    });
  }

  async disableTwoFactorMethod(
    context: InternalAuthContext,
    method: "app" | "email",
    password: string,
    metadata: RequestMetadata
  ): Promise<void> {
    const user = await this.requireCurrentUser(context);
    const passwordHash = await this.store.findPasswordHash(user.id);
    if (!passwordHash || !(await bcrypt.compare(password, passwordHash))) {
      throw new IdentityError(401, "UNAUTHENTICATED", "Password is incorrect");
    }
    const result = await this.store.setTwoFactorMethod(user.id, method, false);
    if (!result) throw new IdentityError(404, "NOT_FOUND", "User not found");
    await this.applyAuthorizationChange(user.id, result);
    void this.audit({
      ...metadata,
      userId: user.id,
      type: `identity.2fa.${method}_disabled`,
      severity: "warning"
    });
  }

  async requestPasswordReset(
    email: string,
    metadata: RequestMetadata
  ): Promise<void> {
    const recipient = await this.store.findPasswordResetRecipient(email);
    await bcrypt.compare("reset-timing-pad", this.dummyPasswordHash);
    if (!recipient) {
      return;
    }
    const rawToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(
      Date.now() + this.config.passwordResetTtlSeconds * 1000
    );
    const encrypted = this.outboxCipher.encrypt({
      channel: "email",
      template: "password-reset",
      recipient: recipient.email,
      locale: recipient.locale,
      variables: {
        token: rawToken,
        expiresAt: expiresAt.toISOString()
      }
    });
    const created = await this.store.createPasswordResetRequest(
      recipient.email,
      TokenService.hashRefreshToken(rawToken),
      expiresAt,
      new Date(Date.now() - this.config.passwordResetCooldownSeconds * 1000),
      {
        eventId: randomUUID(),
        type: "notification.requested",
        requestId: metadata.requestId,
        payloadCiphertext: encrypted.ciphertext,
        payloadIv: encrypted.iv,
        payloadAuthTag: encrypted.authTag
      }
    );
    if (created) {
      void this.audit({
        ...metadata,
        type: "identity.password_reset.requested"
      });
    }
  }

  async confirmPasswordReset(
    rawToken: string,
    nextPassword: string,
    metadata: RequestMetadata
  ): Promise<void> {
    const tokenHash = TokenService.hashRefreshToken(rawToken);
    if (!(await this.store.hasValidPasswordResetToken(tokenHash))) {
      throw new IdentityError(401, "UNAUTHENTICATED", "Invalid or expired reset token");
    }
    const passwordHash = await bcrypt.hash(nextPassword, this.config.bcryptCost);
    const result = await this.store.consumePasswordResetToken(
      tokenHash,
      passwordHash
    );
    if (!result) {
      throw new IdentityError(401, "UNAUTHENTICATED", "Invalid or expired reset token");
    }
    await this.applyAuthorizationChange(result.userId, result);
    void this.audit({
      ...metadata,
      userId: result.userId,
      type: "identity.password_reset.completed",
      severity: "warning"
    });
  }

  async syncEntitySnapshot(
    context: InternalAuthContext,
    snapshot: EntitySnapshotSync
  ): Promise<boolean> {
    if (context.authType !== "service" || context.serviceId !== "catalog") {
      throw new IdentityError(403, "FORBIDDEN", "Catalog service context required");
    }
    const updated = await this.store.upsertEntitySnapshot(snapshot);
    const invalidate = this.store.invalidateEntityAuthorization;
    if (invalidate) {
      const states = await invalidate.call(this.store, snapshot, updated);
      for (const state of states) {
        await this.registry.deactivateMany(state.sessionIds);
        await this.registry.syncAuthorization(state.userId, state.authzVersion);
      }
    }
    return updated;
  }

  async createInvitation(
    context: InternalAuthContext,
    input: CreateInvitationRequest,
    metadata: RequestMetadata
  ) {
    const actor = await this.requireCurrentUser(context);
    if (actor.entityRole !== "OWNER" && actor.entityRole !== "ADMIN") {
      throw new IdentityError(403, "FORBIDDEN", "Entity administrator required");
    }
    const entity = await this.store.getEntitySnapshot(input.entityId);
    if (!entity?.isActive) {
      throw new IdentityError(404, "NOT_FOUND", "Entity not found");
    }
    if (entity.entityType === "SUPER_ADMIN") {
      throw new IdentityError(409, "CONFLICT", "The SUPER_ADMIN account is a singleton");
    }
    if (
      !isSuperOwner(actor) &&
      !this.pathInScope(actor.entityPath, entity.path)
    ) {
      throw new IdentityError(403, "FORBIDDEN", "Entity is outside actor scope");
    }
    const roleRank: Record<EntityRole, number> = { OWNER: 3, ADMIN: 2, REVIEWER: 1, ACCOUNTANT: 1, MEMBER: 1 };
    if (
      !isSuperOwner(actor) &&
      roleRank[input.role] > roleRank[actor.entityRole]
    ) {
      throw new IdentityError(403, "FORBIDDEN", "Cannot grant role above your own");
    }
    const rawToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + this.config.invitationTtlSeconds * 1000);
    const encrypted = this.invitationNotification(
      input.email,
      rawToken,
      entity.name,
      input.role,
      expiresAt
    );
    const result = await this.store.createInvitation({
      entity,
      email: input.email,
      role: input.role,
      ...(input.businessTitle === undefined ? {} : { businessTitle: input.businessTitle }),
      tokenHash: TokenService.hashRefreshToken(rawToken),
      invitedBy: actor.id,
      expiresAt,
      outbox: {
        eventId: randomUUID(),
        type: "notification.requested",
        requestId: metadata.requestId,
        actorId: actor.id,
        ...(entity.tenantId === null ? {} : { tenantId: entity.tenantId }),
        entityPath: entity.path,
        payloadCiphertext: encrypted.ciphertext,
        payloadIv: encrypted.iv,
        payloadAuthTag: encrypted.authTag
      }
    });
    if (result.kind !== "created") {
      const messages = {
        duplicate: "Pending invitation already exists",
        already_member: "User is already an entity member",
        membership_conflict: "User already belongs to another entity",
        subaccount_full: "Sub-account already has a member or pending invitation",
        owner_required: "Invite an organization owner before adding team members",
        inactive_entity: "Entity is inactive"
      } as const;
      throw new IdentityError(409, "CONFLICT", messages[result.kind]);
    }
    return result.invitation;
  }

  async listInvitations(
    context: InternalAuthContext,
    input: {
      status?: InvitationStatus;
      entityId?: string;
      limit: number;
      offset: number;
    }
  ) {
    const actor = await this.requireCurrentUser(context);
    if (actor.entityRole !== "OWNER" && actor.entityRole !== "ADMIN") {
      throw new IdentityError(403, "FORBIDDEN", "Entity administrator required");
    }
    if (input.entityId) {
      const entity = await this.store.getEntitySnapshot(input.entityId);
      if (
        !entity ||
        (!isSuperOwner(actor) &&
          !this.pathInScope(actor.entityPath, entity.path))
      ) {
        throw new IdentityError(403, "FORBIDDEN", "Entity is outside actor scope");
      }
    }
    return this.store.listInvitations({
      actorPath: actor.entityPath,
      ...input
    });
  }

  async revokeInvitation(
    context: InternalAuthContext,
    invitationId: string
  ): Promise<void> {
    const actor = await this.requireCurrentUser(context);
    const invitation = await this.requireScopedInvitation(actor, invitationId);
    if (invitation.status !== "PENDING") {
      throw new IdentityError(409, "CONFLICT", "Invitation is not pending");
    }
    if (!(await this.store.revokeInvitation(invitation.id))) {
      throw new IdentityError(409, "CONFLICT", "Invitation state changed");
    }
  }

  async resendInvitation(
    context: InternalAuthContext,
    invitationId: string,
    metadata: RequestMetadata
  ): Promise<void> {
    const actor = await this.requireCurrentUser(context);
    const invitation = await this.requireScopedInvitation(actor, invitationId);
    if (invitation.status !== "PENDING") {
      throw new IdentityError(409, "CONFLICT", "Invitation is not pending");
    }
    const rawToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + this.config.invitationTtlSeconds * 1000);
    const encrypted = this.invitationNotification(
      invitation.email,
      rawToken,
      invitation.entityName,
      invitation.role,
      expiresAt
    );
    const updated = await this.store.resendInvitation({
      id: invitation.id,
      tokenHash: TokenService.hashRefreshToken(rawToken),
      expiresAt,
      cooldownSince: new Date(
        Date.now() - this.config.invitationResendCooldownSeconds * 1000
      ),
      outbox: {
        eventId: randomUUID(),
        type: "notification.requested",
        requestId: metadata.requestId,
        actorId: actor.id,
        ...(invitation.tenantId === null
          ? {}
          : { tenantId: invitation.tenantId }),
        entityPath: invitation.entityPath,
        payloadCiphertext: encrypted.ciphertext,
        payloadIv: encrypted.iv,
        payloadAuthTag: encrypted.authTag
      }
    });
    if (!updated) {
      throw new IdentityError(409, "CONFLICT", "Invitation resend is rate limited");
    }
  }

  async previewInvitation(rawToken: string) {
    const invitation = await this.store.previewInvitation(
      TokenService.hashRefreshToken(rawToken)
    );
    if (!invitation) throw new IdentityError(404, "NOT_FOUND", "Invitation not found");
    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      businessTitle: invitation.businessTitle,
      status: invitation.status,
      expiresAt: invitation.expiresAt.toISOString(),
      expired: invitation.expiresAt <= new Date(),
      existingUser: invitation.existingUser,
      entity: {
        id: invitation.entityId,
        type: invitation.entityType,
        name: invitation.entityName
      }
    };
  }

  async acceptInvitation(
    input: AcceptInvitationRequest,
    metadata: RequestMetadata
  ) {
    const tokenHash = TokenService.hashRefreshToken(input.token);
    const preview = await this.store.previewInvitation(tokenHash);
    if (!preview) throw new IdentityError(404, "NOT_FOUND", "Invitation not found");
    if (preview.status !== "PENDING" || preview.expiresAt <= new Date()) {
      throw new IdentityError(409, "CONFLICT", "Invitation is not active");
    }
    let newUser: { name: string; passwordHash: string } | undefined;
    if (!preview.existingUser) {
      if (!input.password) {
        throw new IdentityError(400, "VALIDATION_ERROR", "Password is required");
      }
      newUser = {
        name: input.name ?? preview.email.split("@")[0]!.slice(0, 100),
        passwordHash: await bcrypt.hash(input.password, this.config.bcryptCost)
      };
    }
    const result = await this.store.acceptInvitation(tokenHash, newUser);
    if (result.kind !== "accepted") {
      const status = result.kind === "invalid" ? 404 : 409;
      throw new IdentityError(status, status === 404 ? "NOT_FOUND" : "CONFLICT", {
        invalid: "Invitation not found",
        expired: "Invitation has expired",
        already_processed: "Invitation was already processed",
        membership_conflict: "User already belongs to another entity",
        subaccount_full: "Sub-account already has a member",
        owner_required: "The organization owner must accept their invitation first",
        password_required: "Password is required",
        account_disabled: "Account is disabled"
      }[result.kind]);
    }
    if (result.authzVersion !== undefined) {
      await this.applyAuthorizationChange(result.userId, {
        authzVersion: result.authzVersion,
        revokedSessionIds: result.revokedSessionIds
      });
    }
    void this.audit({
      ...metadata,
      userId: result.userId,
      type: "identity.invitation.accepted"
    });
    return {
      success: true,
      existingUser: !result.newUser,
      entityId: result.invitation.entityId,
      role: result.invitation.role
    };
  }

  async getProfile(context: InternalAuthContext) {
    const user = await this.requireCurrentUser(context);
    const profile = await this.store.getUserView(user.id);
    if (!profile) throw new IdentityError(404, "NOT_FOUND", "User not found");
    return profile;
  }

  async updateProfile(
    context: InternalAuthContext,
    input: UpdateProfileRequest
  ) {
    const user = await this.requireCurrentUser(context);
    const profile = await this.store.updateProfile(user.id, input);
    if (!profile) throw new IdentityError(404, "NOT_FOUND", "User not found");
    return profile;
  }

  async listUsers(
    context: InternalAuthContext,
    input: {
      entityId?: string;
      search?: string;
      active?: boolean;
      limit: number;
      offset: number;
    }
  ) {
    const actor = await this.requireCurrentUser(context);
    if (actor.entityRole !== "OWNER" && actor.entityRole !== "ADMIN") {
      throw new IdentityError(403, "FORBIDDEN", "Entity administrator required");
    }
    if (input.entityId) {
      const entity = await this.store.getEntitySnapshot(input.entityId);
      if (
        !entity ||
        (!isSuperOwner(actor) &&
          !this.pathInScope(actor.entityPath, entity.path))
      ) {
        throw new IdentityError(403, "FORBIDDEN", "Entity is outside actor scope");
      }
    }
    return this.store.listUsers({ actorPath: actor.entityPath, ...input });
  }

  async getUser(context: InternalAuthContext, userId: string) {
    const actor = await this.requireCurrentUser(context);
    if (actor.id !== userId) {
      await this.requireManageableTarget(actor, userId);
    }
    const target = await this.store.getUserView(userId);
    if (!target) throw new IdentityError(404, "NOT_FOUND", "User not found");
    return target;
  }

  async createManagedUser(
    context: InternalAuthContext,
    input: CreateManagedUserRequest
  ) {
    const actor = await this.requireCurrentUser(context);
    if (actor.entityRole !== "OWNER" && actor.entityRole !== "ADMIN") {
      throw new IdentityError(403, "FORBIDDEN", "Entity administrator required");
    }
    const entity = await this.store.getEntitySnapshot(input.entityId);
    if (!entity?.isActive) throw new IdentityError(404, "NOT_FOUND", "Entity not found");
    if (entity.entityType === "SUPER_ADMIN") {
      throw new IdentityError(409, "CONFLICT", "The SUPER_ADMIN account is a singleton");
    }
    if (
      !isSuperOwner(actor) &&
      !this.pathInScope(actor.entityPath, entity.path)
    ) {
      throw new IdentityError(403, "FORBIDDEN", "Entity is outside actor scope");
    }
    const roleRank: Record<EntityRole, number> = { OWNER: 3, ADMIN: 2, REVIEWER: 1, ACCOUNTANT: 1, MEMBER: 1 };
    if (
      !isSuperOwner(actor) &&
      roleRank[input.entityRole] > roleRank[actor.entityRole]
    ) {
      throw new IdentityError(403, "FORBIDDEN", "Cannot grant role above your own");
    }
    if (input.staffRoles.length > 0 && !isSuperOwner(actor)) {
      throw new IdentityError(403, "FORBIDDEN", "Super admin required for staff roles");
    }
    if (input.staffRoles.length > 0 && entity.entityType !== "SYSTEM_ADMIN") {
      throw new IdentityError(403, "FORBIDDEN", "Platform staff roles require a platform administration entity");
    }
    const result = await this.store.createManagedUser({
      request: input,
      entity,
      passwordHash: await bcrypt.hash(input.password, this.config.bcryptCost)
    });
    if (result.kind !== "created") {
      throw new IdentityError(409, "CONFLICT", {
        duplicate: "Email is already registered",
        inactive_entity: "Entity is inactive",
        subaccount_full: "Sub-account already has a member",
        owner_required: "Create an organization owner before adding team members"
      }[result.kind]);
    }
    return result.user;
  }

  async deactivateUser(
    context: InternalAuthContext,
    userId: string,
    metadata: RequestMetadata
  ): Promise<void> {
    const actor = await this.requireCurrentUser(context);
    if (actor.id === userId) {
      throw new IdentityError(400, "VALIDATION_ERROR", "Cannot deactivate yourself");
    }
    const target = await this.requireManageableTarget(actor, userId);
    const result = await this.store.deactivateUser(userId, target.identity ? {
      entityId: target.identity.entityId,
      entityRole: target.identity.entityRole
    } : undefined);
    if (result.kind === "not_found") {
      throw new IdentityError(404, "NOT_FOUND", "User not found");
    }
    if (result.kind === "last_owner") {
      throw new IdentityError(409, "CONFLICT", "Cannot deactivate the last owner");
    }
    if (result.kind === "membership_conflict") {
      throw new IdentityError(409, "CONFLICT", "Membership changed during authorization; reload and retry");
    }
    await this.applyAuthorizationChange(userId, result);
    void this.audit({
      ...metadata,
      userId,
      type: "identity.user.deactivated",
      severity: "warning"
    });
  }

  getRoleCatalog() {
    return {
      entityRoles: ["OWNER", "ADMIN", "REVIEWER", "ACCOUNTANT", "MEMBER"] as const,
      staffRoles: ["admin", "moderator", "supporter", "finance"] as const
    };
  }

  async updateManagedUser(
    context: InternalAuthContext,
    userId: string,
    input: UpdateManagedUserRequest
  ) {
    const actor = await this.requireCurrentUser(context);
    if (!isSuperOwner(actor)) {
      throw new IdentityError(403, "FORBIDDEN", "Super admin access required");
    }
    if (actor.id === userId && input.isActive === false) {
      throw new IdentityError(400, "VALIDATION_ERROR", "Cannot deactivate yourself");
    }
    const result = await this.store.updateManagedUser(userId, input);
    if (result.kind !== "changed") {
      const code = result.kind === "not_found" ? "NOT_FOUND" : "CONFLICT";
      throw new IdentityError(code === "NOT_FOUND" ? 404 : 409, code, {
        not_found: "User not found",
        last_owner: "Cannot deactivate the last owner",
        duplicate_email: "Email is already registered",
        membership_conflict: "Membership conflict",
        subaccount_full: "Sub-account already has a member",
        inactive_entity: "Entity is inactive"
      }[result.kind]);
    }
    await this.applyAuthorizationChange(userId, result);
    return result.user;
  }

  async assignMembership(
    context: InternalAuthContext,
    entityId: string,
    userId: string,
    role: EntityRole
  ) {
    const actor = await this.requireCurrentUser(context);
    if (!isSuperOwner(actor)) {
      throw new IdentityError(
        403,
        "FORBIDDEN",
        "Direct membership assignment requires super admin; use invitation flow"
      );
    }
    const entity = await this.store.getEntitySnapshot(entityId);
    if (!entity?.isActive) throw new IdentityError(404, "NOT_FOUND", "Entity not found");
    if (entity.entityType === "SUPER_ADMIN") throw new IdentityError(409, "CONFLICT", "The SUPER_ADMIN account is a singleton");
    const result = await this.store.assignMembership(userId, entity, role);
    if (result.kind !== "changed") {
      const code = result.kind === "not_found" ? "NOT_FOUND" : "CONFLICT";
      throw new IdentityError(code === "NOT_FOUND" ? 404 : 409, code, {
        not_found: "User not found",
        membership_conflict: "User already has a membership",
        subaccount_full: "Sub-account already has a member",
        inactive_entity: "Entity is inactive",
        last_owner: "Last owner conflict",
        duplicate_email: "Email conflict"
      }[result.kind]);
    }
    await this.applyAuthorizationChange(userId, result);
    return result.user;
  }

  async reassignMembership(
    context: InternalAuthContext,
    userId: string,
    entityId: string,
    role: EntityRole
  ) {
    const actor = await this.requireCurrentUser(context);
    if (!isSuperOwner(actor)) {
      throw new IdentityError(403, "FORBIDDEN", "Super admin access required");
    }
    if (actor.id === userId) {
      throw new IdentityError(400, "VALIDATION_ERROR", "Cannot move your own membership");
    }
    const entity = await this.store.getEntitySnapshot(entityId);
    if (!entity?.isActive) throw new IdentityError(404, "NOT_FOUND", "Entity not found");
    if (entity.entityType === "SUPER_ADMIN") throw new IdentityError(409, "CONFLICT", "The SUPER_ADMIN account is a singleton");
    const result = await this.store.reassignMembership(userId, entity, role);
    if (result.kind !== "changed") {
      const code = result.kind === "not_found" ? "NOT_FOUND" : "CONFLICT";
      throw new IdentityError(code === "NOT_FOUND" ? 404 : 409, code, {
        not_found: "User not found",
        last_owner: "Cannot move the last owner",
        subaccount_full: "Sub-account already has a member",
        inactive_entity: "Entity is inactive",
        membership_conflict: "Membership conflict",
        duplicate_email: "Email conflict"
      }[result.kind]);
    }
    await this.applyAuthorizationChange(userId, result);
    return result.user;
  }

  async resetManagedUserPassword(
    context: InternalAuthContext,
    userId: string,
    password: string,
    metadata: RequestMetadata
  ): Promise<void> {
    const actor = await this.requireCurrentUser(context);
    if (!isSuperOwner(actor)) {
      throw new IdentityError(403, "FORBIDDEN", "Super admin access required");
    }
    if (actor.id === userId) {
      throw new IdentityError(400, "VALIDATION_ERROR", "Use change-password for your own account");
    }
    await this.requireManageableTarget(actor, userId);
    const result = await this.store.changePassword(
      userId,
      await bcrypt.hash(password, this.config.bcryptCost)
    );
    await this.applyAuthorizationChange(userId, result);
    void this.audit({
      ...metadata,
      userId,
      type: "identity.user.password_reset_by_admin",
      severity: "warning"
    });
  }

  async removeMembership(
    context: InternalAuthContext,
    entityId: string,
    userId: string
  ): Promise<void> {
    const actor = await this.requireCurrentUser(context);
    if (actor.id === userId) {
      throw new IdentityError(400, "VALIDATION_ERROR", "Cannot remove yourself");
    }
    const target = await this.requireManageableTarget(actor, userId);
    if (!target.identity || target.identity.entityId !== entityId) {
      throw new IdentityError(404, "NOT_FOUND", "Membership not found");
    }
    const roleRank: Record<EntityRole, number> = { OWNER: 3, ADMIN: 2, REVIEWER: 1, ACCOUNTANT: 1, MEMBER: 1 };
    if (
      !isSuperOwner(actor) &&
      roleRank[target.identity.entityRole] > roleRank[actor.entityRole]
    ) {
      throw new IdentityError(403, "FORBIDDEN", "Cannot remove role above your own");
    }
    const result = await this.store.removeMembership(userId, entityId);
    if (result.kind === "not_found") {
      throw new IdentityError(404, "NOT_FOUND", "Membership not found");
    }
    if (result.kind !== "changed") {
      throw new IdentityError(409, "CONFLICT", "Cannot remove the last owner");
    }
    await this.applyAuthorizationChange(userId, result);
  }

  async refresh(
    rawRefreshToken: string | undefined,
    metadata: RequestMetadata
  ): Promise<IssuedSession> {
    if (
      !rawRefreshToken ||
      rawRefreshToken.length < 32 ||
      rawRefreshToken.length > 128 ||
      !/^[A-Za-z0-9_-]+$/.test(rawRefreshToken)
    ) {
      throw new IdentityError(401, "UNAUTHENTICATED", "Refresh token required");
    }

    const nextRefresh = this.tokens.createRefreshToken();
    const nextSessionId = randomUUID();
    const result = await this.store.rotateRefreshToken(
      TokenService.hashRefreshToken(rawRefreshToken),
      {
        id: nextSessionId,
        refreshTokenHash: nextRefresh.hash,
        expiresAt: new Date(Date.now() + this.config.refreshTtlSeconds * 1000),
        ...(metadata.ipAddress === undefined
          ? {}
          : { ipAddress: metadata.ipAddress.slice(0, 64) }),
        ...(metadata.userAgent === undefined
          ? {}
          : { userAgent: metadata.userAgent.slice(0, 512) })
      }
    );

    if (result.kind === "reuse") {
      await this.registry.deactivateMany(result.sessionIds);
      await this.registry.syncAuthorization(result.userId, result.authzVersion);
      void this.audit({
        ...metadata,
        userId: result.userId,
        type: "identity.refresh.reuse_detected",
        severity: "critical"
      });
      throw new IdentityError(
        401,
        "REFRESH_REUSE_DETECTED",
        "Refresh token reuse detected"
      );
    }
    if (result.kind === "invalid") {
      throw new IdentityError(401, "UNAUTHENTICATED", "Invalid refresh token");
    }

    const isEntityActive = this.store.isEntityActive;
    if (isEntityActive && !(await isEntityActive.call(this.store, result.user.entityId))) {
      await this.store.revokeSession(
        result.user.id,
        result.sessionId,
        "ACCOUNT_DISABLED"
      );
      await this.registry.deactivateMany([
        result.previousSessionId,
        result.sessionId
      ]);
      throw new IdentityError(401, "UNAUTHENTICATED", "Entity membership is inactive");
    }

    await this.registry.deactivate(result.previousSessionId);
    await this.registry.activate(
      result.sessionId,
      result.user.id,
      result.user.authzVersion,
      result.expiresAt
    );
    const accessToken = await this.tokens.issueAccessToken(
      result.user,
      result.sessionId
    );
    return {
      response: {
        accessToken,
        expiresIn: this.config.accessTokenTtlSeconds,
        user: result.user
      },
      refreshToken: nextRefresh.raw,
      refreshExpiresAt: result.expiresAt
    };
  }

  async requireCurrentUser(context: InternalAuthContext): Promise<IdentityUser> {
    if (
      context.authType !== "user" ||
      !context.actorId ||
      !context.sessionId ||
      context.authzVersion === undefined
    ) {
      throw new IdentityError(401, "UNAUTHENTICATED", "User session required");
    }
    const user = await this.store.getCurrentUser(context.actorId, context.sessionId);
    if (!user || user.authzVersion !== context.authzVersion) {
      throw new IdentityError(401, "UNAUTHENTICATED", "Session is no longer valid");
    }
    return user;
  }

  async logout(context: InternalAuthContext): Promise<void> {
    const user = await this.requireCurrentUser(context);
    await this.store.revokeSession(user.id, context.sessionId!, "LOGOUT");
    await this.registry.deactivate(context.sessionId!);
  }

  async listSessions(context: InternalAuthContext): Promise<IdentitySession[]> {
    const user = await this.requireCurrentUser(context);
    return this.store.listSessions(user.id, context.sessionId!);
  }

  async revokeSession(
    context: InternalAuthContext,
    sessionId: string
  ): Promise<boolean> {
    const user = await this.requireCurrentUser(context);
    const revoked = await this.store.revokeSession(
      user.id,
      sessionId,
      "REVOKED_BY_USER"
    );
    if (revoked) {
      await this.registry.deactivate(sessionId);
    }
    return revoked;
  }

  async revokeAllSessions(context: InternalAuthContext): Promise<void> {
    const user = await this.requireCurrentUser(context);
    const result = await this.store.revokeAllSessions(user.id, "REVOKED_BY_USER");
    await this.registry.deactivateMany(result.revokedSessionIds);
    await this.registry.syncAuthorization(user.id, result.authzVersion);
  }

  async changePassword(
    context: InternalAuthContext,
    currentPassword: string,
    nextPassword: string
  ): Promise<void> {
    const user = await this.requireCurrentUser(context);
    const passwordHash = await this.store.findPasswordHash(user.id);
    if (!passwordHash || !(await bcrypt.compare(currentPassword, passwordHash))) {
      throw new IdentityError(401, "UNAUTHENTICATED", "Current password is incorrect");
    }
    if (await bcrypt.compare(nextPassword, passwordHash)) {
      throw new IdentityError(
        400,
        "VALIDATION_ERROR",
        "New password must differ from current password"
      );
    }
    const nextHash = await bcrypt.hash(nextPassword, this.config.bcryptCost);
    const result = await this.store.changePassword(user.id, nextHash);
    await this.registry.deactivateMany(result.revokedSessionIds);
    await this.registry.syncAuthorization(user.id, result.authzVersion);
  }

  async setUserBan(
    context: InternalAuthContext,
    targetUserId: string,
    banned: boolean,
    reason: string | null,
    metadata: RequestMetadata
  ): Promise<void> {
    const actor = await this.requireCurrentUser(context);
    if (actor.id === targetUserId) {
      throw new IdentityError(400, "VALIDATION_ERROR", "Cannot ban your own account");
    }
    const target = await this.requireManageableTarget(actor, targetUserId);
    if (!target.isActive) {
      throw new IdentityError(409, "CONFLICT", "Account is disabled");
    }
    const result = await this.store.setBanState(targetUserId, banned, reason, target.identity ? {
      entityId: target.identity.entityId,
      entityRole: target.identity.entityRole
    } : undefined);
    if (result.kind === "not_found") throw new IdentityError(404, "NOT_FOUND", "User not found");
    if (result.kind !== "changed") {
      throw new IdentityError(409, "CONFLICT", {
        last_owner: "Cannot ban the last active entity owner",
        membership_conflict: "Membership changed during authorization; reload and retry",
        account_disabled: "Account is disabled"
      }[result.kind]);
    }
    await this.applyAuthorizationChange(targetUserId, result);
    void this.audit({
      ...metadata,
      userId: targetUserId,
      type: banned ? "identity.user.banned" : "identity.user.unbanned",
      severity: banned ? "warning" : "info"
    });
  }

  async replaceUserStaffRoles(
    context: InternalAuthContext,
    targetUserId: string,
    roles: readonly StaffRole[],
    metadata: RequestMetadata
  ): Promise<void> {
    const actor = await this.requireCurrentUser(context);
    if (!isSuperOwner(actor)) {
      throw new IdentityError(403, "FORBIDDEN", "Super admin access required");
    }
    const target = await this.store.getUserForAdministration(targetUserId);
    if (!target) throw new IdentityError(404, "NOT_FOUND", "User not found");
    if (
      roles.length > 0 &&
      target.identity?.entityType !== "SYSTEM_ADMIN" &&
      target.identity?.entityType !== "SUPER_ADMIN"
    ) {
      throw new IdentityError(403, "FORBIDDEN", "Platform staff roles require a platform administration entity");
    }
    if (actor.id === targetUserId && !roles.includes("admin")) {
      throw new IdentityError(
        400,
        "VALIDATION_ERROR",
        "Cannot remove your own admin role"
      );
    }
    const result = await this.store.replaceStaffRoles(targetUserId, roles);
    if (!result) throw new IdentityError(404, "NOT_FOUND", "User not found");
    await this.applyAuthorizationChange(targetUserId, result);
    void this.audit({
      ...metadata,
      userId: targetUserId,
      type: "identity.staff_roles.changed",
      severity: "warning"
    });
  }

  async changeUserMembershipRole(
    context: InternalAuthContext,
    targetUserId: string,
    role: EntityRole,
    metadata: RequestMetadata
  ): Promise<void> {
    const actor = await this.requireCurrentUser(context);
    const target = await this.requireManageableTarget(actor, targetUserId);
    if (!target.identity) {
      throw new IdentityError(409, "CONFLICT", "User has no membership");
    }
    const roleRank: Record<EntityRole, number> = { OWNER: 3, ADMIN: 2, REVIEWER: 1, ACCOUNTANT: 1, MEMBER: 1 };
    if (
      !isSuperOwner(actor) &&
      roleRank[role] > roleRank[actor.entityRole]
    ) {
      throw new IdentityError(403, "FORBIDDEN", "Cannot grant role above your own");
    }
    const result = await this.store.changeMembershipRole(targetUserId, role, {
      entityId: target.identity.entityId,
      entityRole: target.identity.entityRole
    });
    if (result.kind === "not_found") {
      throw new IdentityError(404, "NOT_FOUND", "Membership not found");
    }
    if (result.kind === "membership_conflict") {
      throw new IdentityError(409, "CONFLICT", "Membership changed during authorization; reload and retry");
    }
    if (result.kind === "last_owner") {
      throw new IdentityError(
        409,
        "CONFLICT",
        "Cannot demote the last entity owner"
      );
    }
    await this.applyAuthorizationChange(targetUserId, result);
    void this.audit({
      ...metadata,
      userId: targetUserId,
      type: "identity.membership_role.changed",
      severity: "warning"
    });
  }

  async changeUserBusinessTitle(
    context: InternalAuthContext,
    targetUserId: string,
    businessTitle: string | null,
    metadata: RequestMetadata
  ): Promise<void> {
    const actor = await this.requireCurrentUser(context);
    const target = await this.requireManageableTarget(actor, targetUserId);
    if (!target.identity) throw new IdentityError(404, "NOT_FOUND", "Membership not found");
    if (!(await this.store.updateMembershipBusinessTitle(targetUserId, businessTitle, {
      entityId: target.identity.entityId,
      entityRole: target.identity.entityRole
    }))) {
      throw new IdentityError(409, "CONFLICT", "Membership changed during authorization; reload and retry");
    }
    void this.audit({
      ...metadata,
      userId: targetUserId,
      type: "identity.membership_business_title.changed"
    });
  }

  private async requireManageableTarget(actor: IdentityUser, targetUserId: string) {
    const target = await this.store.getUserForAdministration(targetUserId);
    if (!target) throw new IdentityError(404, "NOT_FOUND", "User not found");
    if (isSuperOwner(actor)) return target;
    const canAdminister = actor.entityRole === "OWNER" || actor.entityRole === "ADMIN";
    const actorPath = actor.entityPath;
    const targetPath = target.identity?.entityPath;
    const inScope =
      !!actorPath &&
      !!targetPath &&
      (targetPath === actorPath || targetPath.startsWith(`${actorPath}.`));
    if (!canAdminister || !inScope) {
      throw new IdentityError(403, "FORBIDDEN", "User is outside actor scope");
    }
    const roleRank: Record<EntityRole, number> = {
      OWNER: 3,
      ADMIN: 2,
      REVIEWER: 1,
      ACCOUNTANT: 1,
      MEMBER: 1
    };
    if (
      target.identity &&
      (targetPath === actorPath
        ? roleRank[target.identity.entityRole] >= roleRank[actor.entityRole]
        : roleRank[target.identity.entityRole] > roleRank[actor.entityRole])
    ) {
      throw new IdentityError(403, "FORBIDDEN", "Only a higher role can manage this account");
    }
    return target;
  }

  private pathInScope(actorPath: string, targetPath: string): boolean {
    return targetPath === actorPath || targetPath.startsWith(`${actorPath}.`);
  }

  private async requireScopedInvitation(
    actor: IdentityUser,
    invitationId: string
  ) {
    if (actor.entityRole !== "OWNER" && actor.entityRole !== "ADMIN") {
      throw new IdentityError(403, "FORBIDDEN", "Entity administrator required");
    }
    const invitation = await this.store.getInvitation(invitationId);
    if (!invitation) throw new IdentityError(404, "NOT_FOUND", "Invitation not found");
    if (
      !isSuperOwner(actor) &&
      !this.pathInScope(actor.entityPath, invitation.entityPath)
    ) {
      throw new IdentityError(403, "FORBIDDEN", "Invitation is outside actor scope");
    }
    return invitation;
  }

  private invitationNotification(
    recipient: string,
    token: string,
    entityName: string,
    role: EntityRole,
    expiresAt: Date
  ) {
    return this.outboxCipher.encrypt({
      channel: "email",
      template: "identity-invitation",
      recipient,
      locale: "en",
      variables: {
        token,
        entityName,
        role,
        expiresAt: expiresAt.toISOString()
      }
    });
  }

  private async applyAuthorizationChange(
    userId: string,
    result: { authzVersion: number; revokedSessionIds: readonly string[] }
  ): Promise<void> {
    await this.registry.deactivateMany(result.revokedSessionIds);
    await this.registry.syncAuthorization(userId, result.authzVersion);
  }

  private async finishTwoFactorLogin(
    challenge: TwoFactorChallengeRecord,
    input: TwoFactorVerifyInput,
    metadata: RequestMetadata
  ): Promise<IssuedSession> {
    if (!challenge.identity) {
      throw new IdentityError(401, "UNAUTHENTICATED", "Invalid challenge identity");
    }
    const issued = await this.issueSession(
      challenge.identity,
      {
        rememberMe: challenge.rememberMe,
        ...(input.deviceName === undefined ? {} : { deviceName: input.deviceName }),
        ...(input.deviceType === undefined ? {} : { deviceType: input.deviceType })
      },
      metadata
    );
    void this.audit({
      ...metadata,
      userId: challenge.userId,
      type: "identity.login.2fa_succeeded"
    });
    return issued;
  }

  private async issueSession(
    user: IdentityUser,
    input: SessionPreferences,
    metadata: RequestMetadata
  ): Promise<IssuedSession> {
    const isEntityActive = this.store.isEntityActive;
    if (isEntityActive && !(await isEntityActive.call(this.store, user.entityId))) {
      throw new IdentityError(401, "UNAUTHENTICATED", "Entity membership is inactive");
    }
    const refresh = this.tokens.createRefreshToken();
    const refreshTtl = input.rememberMe
      ? this.config.rememberRefreshTtlSeconds
      : this.config.refreshTtlSeconds;
    const refreshExpiresAt = new Date(Date.now() + refreshTtl * 1000);
    const session = sessionInput(
      user.id,
      randomUUID(),
      refresh.hash,
      refreshExpiresAt,
      input,
      metadata
    );
    await this.store.createSession(session);
    await this.registry.activate(
      session.id,
      user.id,
      user.authzVersion,
      refreshExpiresAt
    );
    return {
      response: {
        accessToken: await this.tokens.issueAccessToken(user, session.id),
        expiresIn: this.config.accessTokenTtlSeconds,
        user
      },
      refreshToken: refresh.raw,
      refreshExpiresAt
    };
  }

  private async audit(input: RequestMetadata & {
    userId?: string;
    type: string;
    severity?: string;
  }): Promise<void> {
    await this.store
      .createSecurityEvent({
        type: input.type,
        ...(input.userId === undefined ? {} : { userId: input.userId }),
        ...(input.severity === undefined ? {} : { severity: input.severity }),
        ...(input.ipAddress === undefined ? {} : { ipAddress: input.ipAddress }),
        ...(input.userAgent === undefined ? {} : { userAgent: input.userAgent }),
        requestId: input.requestId
      })
      .catch(() => undefined);
  }
}
