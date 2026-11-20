import { randomUUID } from "node:crypto";

import type {
  EntityRole,
  IdentitySession,
  IdentityUser,
  InternalAuthContext,
  LoginRequest,
  StaffRole
} from "@bealpha/contracts";
import type {
  Prisma,
  SessionRevokeReason
} from "../src/generated/prisma-v2/client.js";
import bcrypt from "bcryptjs";
import { authenticator } from "otplib";
import {
  exportPKCS8,
  exportSPKI,
  generateKeyPair,
  jwtVerify,
  SignJWT
} from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildIdentityApp } from "../src/app.js";
import type { IdentityConfig } from "../src/config.js";
import { IdentityError } from "../src/errors.js";
import { IdentityService } from "../src/identity-service.js";
import { MemorySessionRegistry } from "../src/session-registry.js";
import type {
  AuthUserRecord,
  AcceptInvitationResult,
  CreateInvitationResult,
  CreateManagedUserResult,
  DeactivateUserResult,
  EntitySnapshotRecord,
  IdentityStore,
  IdentityUserView,
  InvitationAcceptancePreview,
  InvitationRecord,
  ManagedUserRecord,
  ManagedUserMutationResult,
  MembershipRoleChangeResult,
  NewOutboxEvent,
  NewSessionInput,
  PasswordChangeResult,
  PasswordResetRecipient,
  PasswordResetResult,
  RotateRefreshResult,
  TwoFactorChallengeRecord,
  TwoFactorStatus,
  UserBanChangeResult
} from "../src/store.js";
import { TokenService } from "../src/token-service.js";
import {
  IdentityOutboxRelay,
  SensitivePayloadCipher,
  type PendingOutboxEvent
} from "../src/outbox.js";

const accessKeys = await generateKeyPair("ES256", { extractable: true });
const contextKeys = await generateKeyPair("ES256", { extractable: true });

const config: IdentityConfig = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 4101,
  logLevel: "silent",
  trustProxyHops: 0,
  bodyLimitBytes: 16_384,
  databaseUrl: "postgresql://identity:test@localhost:5432/identity",
  dbPoolMax: 2,
  accessTokenPrivateKeyPem: await exportPKCS8(accessKeys.privateKey),
  accessTokenIssuer: "bealpha-identity",
  accessTokenAudience: "bealpha-api",
  accessTokenTtlSeconds: 900,
  gatewayContextPublicKeyPem: await exportSPKI(contextKeys.publicKey),
  gatewayContextIssuer: "bealpha-gateway",
  gatewayContextAudience: "bealpha-services",
  refreshCookieName: "bealpha_refresh",
  cookieSecure: false,
  refreshTtlSeconds: 604_800,
  rememberRefreshTtlSeconds: 2_592_000,
  bcryptCost: 10,
  maxLoginAttempts: 5,
  lockoutSeconds: 900,
  twoFactorChallengeTtlSeconds: 600,
  maxTwoFactorAttempts: 5,
  totpIssuer: "BeAlpha Test",
  totpWindow: 1,
  totpStepSeconds: 30,
  totpDigits: 6,
  passwordResetTtlSeconds: 1800,
  passwordResetCooldownSeconds: 60,
  outboxEncryptionKey: Buffer.alloc(32, 7),
  outboxPollIntervalMs: 1000,
  outboxBatchSize: 25,
  invitationTtlSeconds: 604800,
  invitationResendCooldownSeconds: 60,
  twoFactorEmailCodeTtlSeconds: 600,
  twoFactorEmailCooldownSeconds: 60,
  twoFactorEmailMaxSends: 5,
  twoFactorEmailRateWindowSeconds: 600
};

const user: IdentityUser = {
  id: "10000000-0000-4000-8000-000000000001",
  email: "user@example.com",
  name: "User",
  stageName: null,
  entityId: "20000000-0000-4000-8000-000000000001",
  entityType: "ORGANIZATION",
  entityRole: "OWNER",
  entityName: "Label",
  entityPath: "bealpha.group.label",
  tenantId: "20000000-0000-4000-8000-000000000001",
  staffRoles: ["admin"],
  authzVersion: 2
};

class FakeStore implements IdentityStore {
  loginRecord: AuthUserRecord | null = null;
  currentUser: IdentityUser | null = user;
  entityActive = true;
  createdSession?: NewSessionInput;
  rotateResult: RotateRefreshResult = { kind: "invalid" };
  failedAttempts = 0;
  clearedLogin = false;
  revoked: string[] = [];
  passwordHash: string | null = null;
  passwordChangeResult: PasswordChangeResult = {
    authzVersion: 3,
    revokedSessionIds: ["30000000-0000-4000-8000-000000000001"]
  };
  managedUser: ManagedUserRecord | null = null;
  membershipRoleResult: MembershipRoleChangeResult = {
    kind: "changed",
    authzVersion: 3,
    revokedSessionIds: ["target-session"]
  };
  changedMembershipRole?: EntityRole;
  membershipRoleExpectation?: Parameters<IdentityStore["changeMembershipRole"]>[2];
  changedBusinessTitle?: string | null;
  businessTitleExpectation?: Parameters<IdentityStore["updateMembershipBusinessTitle"]>[2];
  businessTitleUpdateResult = true;
  changedStaffRoles?: readonly StaffRole[];
  changedBan?: { banned: boolean; reason: string | null };
  banExpectation?: Parameters<IdentityStore["setBanState"]>[3];
  banResult?: UserBanChangeResult;
  twoFactorChallenge?: TwoFactorChallengeRecord;
  createdChallengeId = "40000000-0000-4000-8000-000000000001";
  consumedChallenge = false;
  consumedRecoveryHash?: string;
  twoFactorFailures = 0;
  totpStatus: TwoFactorStatus = {
    enabled: false,
    methods: [],
    email: user.email
  };
  finalizedTotp = false;
  disabledTotp = false;
  twoFactorMethodChange?: { method: "app" | "email"; enabled: boolean };
  preservedTwoFactorSession?: string;
  recoveryHashes: readonly string[] = [];
  passwordResetRecipient: PasswordResetRecipient | null = null;
  passwordResetOutbox?: NewOutboxEvent;
  passwordResetTokenHash?: string;
  passwordResetValid = false;
  passwordResetResult: PasswordResetResult = {
    userId: user.id,
    authzVersion: 4,
    revokedSessionIds: ["reset-session"]
  };
  consumedResetPasswordHash?: string;
  entitySnapshot: EntitySnapshotRecord | null = null;
  createdInvitationInput?: Parameters<IdentityStore["createInvitation"]>[0];
  createInvitationResult: CreateInvitationResult = { kind: "duplicate" };
  invitationRecord: InvitationRecord | null = null;
  invitationPreview: InvitationAcceptancePreview | null = null;
  acceptInvitationResult: AcceptInvitationResult = { kind: "invalid" };
  syncedEntitySnapshot = false;
  twoFactorEmailInput?: Parameters<IdentityStore["createTwoFactorEmailCode"]>[0];
  consumedEmailCodeHash?: string;
  finalizedEmailSetup = false;
  userView: IdentityUserView | null = null;
  createdManagedUserInput?: Parameters<IdentityStore["createManagedUser"]>[0];
  createManagedUserResult: CreateManagedUserResult = { kind: "duplicate" };
  deactivateUserResult: DeactivateUserResult = {
    kind: "changed",
    authzVersion: 6,
    revokedSessionIds: ["deactivated-session"]
  };
  deactivateExpectation?: Parameters<IdentityStore["deactivateUser"]>[1];
  managedMutationResult: ManagedUserMutationResult = { kind: "not_found" };
  reassignedMembership?: { userId: string; entityId: string; role: EntityRole };
  changedPasswordHash?: string;

  async findUserForLogin(): Promise<AuthUserRecord | null> {
    return this.loginRecord;
  }

  async findPasswordHash(): Promise<string | null> {
    return this.passwordHash;
  }

  async recordFailedLogin(): Promise<{ attempts: number; locked: boolean }> {
    this.failedAttempts += 1;
    return { attempts: this.failedAttempts, locked: false };
  }

  async clearFailedLogin(): Promise<void> {
    this.clearedLogin = true;
  }

  async createTwoFactorChallenge(
    userId: string,
    allowedMethods: readonly string[],
    rememberMe: boolean
  ): Promise<string> {
    this.twoFactorChallenge = {
      id: this.createdChallengeId,
      userId,
      identity: user,
      allowedMethods,
      rememberMe,
      attempts: 0,
      secret: null,
      recoveryCodeHashes: [],
      isActive: true,
      isBanned: false
    };
    return this.createdChallengeId;
  }

  async getTwoFactorChallenge(): Promise<TwoFactorChallengeRecord | null> {
    return this.twoFactorChallenge ?? null;
  }

  async recordTwoFactorFailure(): Promise<void> {
    this.twoFactorFailures += 1;
  }

  async consumeTwoFactorChallenge(): Promise<boolean> {
    if (this.consumedChallenge) return false;
    this.consumedChallenge = true;
    return true;
  }

  async consumeRecoveryCodeAndChallenge(
    _userId: string,
    _challengeId: string,
    recoveryCodeHash: string
  ): Promise<boolean> {
    if (this.consumedChallenge) return false;
    this.consumedChallenge = true;
    this.consumedRecoveryHash = recoveryCodeHash;
    return true;
  }

  async createTwoFactorEmailCode(
    input: Parameters<IdentityStore["createTwoFactorEmailCode"]>[0]
  ) {
    this.twoFactorEmailInput = input;
    return { kind: "created" } as const;
  }

  async consumeEmailCodeAndChallenge(
    _userId: string,
    _challengeId: string,
    codeHash: string
  ): Promise<boolean> {
    this.consumedEmailCodeHash = codeHash;
    if (this.consumedChallenge) return false;
    this.consumedChallenge = true;
    return true;
  }

  async finalizeEmailTwoFactorSetup(
    _userId: string,
    _challengeId: string,
    codeHash: string,
    preserveSessionId: string
  ): Promise<PasswordChangeResult | null> {
    this.consumedEmailCodeHash = codeHash;
    if (this.consumedChallenge) return null;
    this.consumedChallenge = true;
    this.finalizedEmailSetup = true;
    this.twoFactorMethodChange = { method: "email", enabled: true };
    this.preservedTwoFactorSession = preserveSessionId;
    return this.passwordChangeResult;
  }

  async createTotpSetup(
    userId: string,
    secret: string,
    _expiresAt: Date
  ): Promise<string> {
    this.twoFactorChallenge = {
      id: this.createdChallengeId,
      userId,
      identity: user,
      allowedMethods: ["setup:app"],
      rememberMe: false,
      attempts: 0,
      secret,
      recoveryCodeHashes: [],
      isActive: true,
      isBanned: false
    };
    return this.createdChallengeId;
  }

  async finalizeTotpSetup(
    _userId: string,
    _challengeId: string,
    recoveryCodeHashes: readonly string[],
    preserveSessionId: string
  ): Promise<PasswordChangeResult | null> {
    this.finalizedTotp = true;
    this.preservedTwoFactorSession = preserveSessionId;
    this.recoveryHashes = recoveryCodeHashes;
    return this.passwordChangeResult;
  }

  async getTwoFactorStatus(): Promise<TwoFactorStatus | null> {
    return this.totpStatus;
  }

  async setTwoFactorMethod(
    _userId: string,
    method: "app" | "email",
    enabled: boolean,
    preserveSessionId?: string
  ): Promise<PasswordChangeResult | null> {
    this.twoFactorMethodChange = { method, enabled };
    if (preserveSessionId !== undefined) this.preservedTwoFactorSession = preserveSessionId;
    return this.passwordChangeResult;
  }

  async disableTwoFactor(): Promise<PasswordChangeResult | null> {
    this.disabledTotp = true;
    return this.passwordChangeResult;
  }

  async createSession(input: NewSessionInput): Promise<void> {
    this.createdSession = input;
  }

  async rotateRefreshToken(): Promise<RotateRefreshResult> {
    return this.rotateResult;
  }

  async isEntityActive(): Promise<boolean> {
    return this.entityActive;
  }

  async getCurrentUser(): Promise<IdentityUser | null> {
    return this.currentUser;
  }

  async listSessions(
    _userId: string,
    currentSessionId: string
  ): Promise<IdentitySession[]> {
    return [
      {
        id: currentSessionId,
        deviceName: null,
        deviceType: null,
        ipAddress: null,
        userAgent: null,
        createdAt: "2026-07-10T00:00:00.000Z",
        lastUsedAt: "2026-07-10T00:00:00.000Z",
        expiresAt: "2026-07-11T00:00:00.000Z",
        current: true
      }
    ];
  }

  async revokeSession(
    _userId: string,
    sessionId: string,
    _reason: SessionRevokeReason
  ): Promise<boolean> {
    this.revoked.push(sessionId);
    return true;
  }

  async revokeAllSessions(): Promise<PasswordChangeResult> {
    return this.passwordChangeResult;
  }

  async changePassword(_userId: string, passwordHash: string): Promise<PasswordChangeResult> {
    this.changedPasswordHash = passwordHash;
    return this.passwordChangeResult;
  }

  async getUserForAdministration(): Promise<ManagedUserRecord | null> {
    return this.managedUser;
  }

  async setBanState(
    _userId: string,
    banned: boolean,
    reason: string | null,
    expected?: Parameters<IdentityStore["setBanState"]>[3]
  ): Promise<UserBanChangeResult> {
    this.banExpectation = expected;
    if (this.banResult) return this.banResult;
    this.changedBan = { banned, reason };
    return { kind: "changed", ...this.passwordChangeResult };
  }

  async replaceStaffRoles(
    _userId: string,
    roles: readonly StaffRole[]
  ): Promise<PasswordChangeResult | null> {
    this.changedStaffRoles = roles;
    return this.passwordChangeResult;
  }

  async changeMembershipRole(
    _userId: string,
    role: EntityRole,
    expected?: Parameters<IdentityStore["changeMembershipRole"]>[2]
  ): Promise<MembershipRoleChangeResult> {
    this.changedMembershipRole = role;
    this.membershipRoleExpectation = expected;
    return this.membershipRoleResult;
  }

  async updateMembershipBusinessTitle(
    _userId: string,
    businessTitle: string | null,
    expected?: Parameters<IdentityStore["updateMembershipBusinessTitle"]>[2]
  ): Promise<boolean> {
    this.businessTitleExpectation = expected;
    if (!this.businessTitleUpdateResult) return false;
    this.changedBusinessTitle = businessTitle;
    return true;
  }

  async findPasswordResetRecipient(): Promise<PasswordResetRecipient | null> {
    return this.passwordResetRecipient;
  }

  async createPasswordResetRequest(
    _email: string,
    tokenHash: string,
    _expiresAt: Date,
    _cooldownSince: Date,
    outbox: NewOutboxEvent
  ): Promise<boolean> {
    this.passwordResetTokenHash = tokenHash;
    this.passwordResetOutbox = outbox;
    return true;
  }

  async hasValidPasswordResetToken(): Promise<boolean> {
    return this.passwordResetValid;
  }

  async consumePasswordResetToken(
    _tokenHash: string,
    passwordHash: string
  ): Promise<PasswordResetResult | null> {
    this.consumedResetPasswordHash = passwordHash;
    return this.passwordResetValid ? this.passwordResetResult : null;
  }

  async upsertEntitySnapshot(): Promise<boolean> {
    this.syncedEntitySnapshot = true;
    return true;
  }

  async getEntitySnapshot(): Promise<EntitySnapshotRecord | null> {
    return this.entitySnapshot;
  }

  async createInvitation(
    input: Parameters<IdentityStore["createInvitation"]>[0]
  ): Promise<CreateInvitationResult> {
    this.createdInvitationInput = input;
    return this.createInvitationResult;
  }

  async listInvitations(): Promise<{
    invitations: InvitationRecord[];
    total: number;
  }> {
    return {
      invitations: this.invitationRecord ? [this.invitationRecord] : [],
      total: this.invitationRecord ? 1 : 0
    };
  }

  async getInvitation(): Promise<InvitationRecord | null> {
    return this.invitationRecord;
  }

  async revokeInvitation(): Promise<boolean> {
    return true;
  }

  async resendInvitation(): Promise<boolean> {
    return true;
  }

  async previewInvitation(): Promise<InvitationAcceptancePreview | null> {
    return this.invitationPreview;
  }

  async acceptInvitation(): Promise<AcceptInvitationResult> {
    return this.acceptInvitationResult;
  }

  async listUsers(): Promise<{ users: IdentityUserView[]; total: number }> {
    return { users: this.userView ? [this.userView] : [], total: this.userView ? 1 : 0 };
  }

  async getUserView(): Promise<IdentityUserView | null> {
    return this.userView;
  }

  async createManagedUser(
    input: Parameters<IdentityStore["createManagedUser"]>[0]
  ): Promise<CreateManagedUserResult> {
    this.createdManagedUserInput = input;
    return this.createManagedUserResult;
  }

  async updateProfile(
    _userId: string,
    input: Parameters<IdentityStore["updateProfile"]>[1]
  ): Promise<IdentityUserView | null> {
    if (!this.userView) return null;
    this.userView = {
      ...this.userView,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.stageName === undefined ? {} : { stageName: input.stageName }),
      ...(input.phone === undefined ? {} : { phone: input.phone }),
      ...(input.avatar === undefined ? {} : { avatar: input.avatar }),
      ...(input.language === undefined ? {} : { language: input.language }),
      ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
      ...(input.currency === undefined ? {} : { currency: input.currency }),
      ...(input.theme === undefined ? {} : { theme: input.theme })
    };
    return this.userView;
  }

  async deactivateUser(_userId: string, expected?: Parameters<IdentityStore["deactivateUser"]>[1]): Promise<DeactivateUserResult> {
    this.deactivateExpectation = expected;
    return this.deactivateUserResult;
  }

  async updateManagedUser(): Promise<ManagedUserMutationResult> {
    return this.managedMutationResult;
  }

  async assignMembership(): Promise<ManagedUserMutationResult> {
    return this.managedMutationResult;
  }

  async reassignMembership(
    userId: string,
    entity: EntitySnapshotRecord,
    role: EntityRole
  ): Promise<ManagedUserMutationResult> {
    this.reassignedMembership = { userId, entityId: entity.id, role };
    return this.managedMutationResult;
  }

  async removeMembership(): Promise<ManagedUserMutationResult> {
    return this.managedMutationResult;
  }

  async createSecurityEvent(_input: {
    userId?: string;
    type: string;
    severity?: string;
    ipAddress?: string;
    userAgent?: string;
    requestId?: string;
    metadata?: Prisma.InputJsonValue;
  }): Promise<void> {}
}

function loginInput(password: string): LoginRequest {
  return {
    email: user.email,
    password,
    rememberMe: false,
    deviceType: "desktop"
  };
}

async function createService(store: FakeStore, registry = new MemorySessionRegistry()) {
  const tokens = await TokenService.create(config);
  return {
    service: await IdentityService.create(config, store, registry, tokens),
    registry
  };
}

function currentUserContext(): InternalAuthContext {
  return {
    v: 1,
    requestId: randomUUID(),
    authType: "user",
    actorId: user.id,
    sessionId: "actor-session",
    entityId: user.entityId,
    entityType: user.entityType,
    entityRole: user.entityRole,
    tenantId: user.tenantId!,
    entityPath: user.entityPath,
    roles: [user.entityType],
    staffRoles: user.staffRoles,
    authzVersion: user.authzVersion
  };
}

function invitationRecord(overrides: Partial<InvitationRecord> = {}): InvitationRecord {
  return {
    id: "50000000-0000-4000-8000-000000000001",
    entityId: "20000000-0000-4000-8000-000000000002",
    entityType: "SUB_ACCOUNT",
    entityName: "Artist",
    entityPath: `${user.entityPath}.artist`,
    tenantId: user.tenantId,
    email: "artist@example.com",
    role: "MEMBER",
    businessTitle: null,
    status: "PENDING",
    invitedBy: user.id,
    expiresAt: new Date(Date.now() + 3600000),
    acceptedAt: null,
    createdAt: new Date(),
    ...overrides
  };
}

function identityUserView(overrides: Partial<IdentityUserView> = {}): IdentityUserView {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    stageName: user.stageName,
    phone: null,
    avatar: null,
    isActive: true,
    isBanned: false,
    banReason: null,
    twoFactorEnabled: false,
    language: "en",
    timezone: "Asia/Ho_Chi_Minh",
    currency: "USD",
    theme: "dark",
    notifyReleases: true,
    notifyRoyalties: true,
    notifyNews: true,
    notifyMarketing: false,
    authzVersion: user.authzVersion,
    membership: {
      entityId: user.entityId,
      entityType: user.entityType,
      entityRole: user.entityRole,
      businessTitle: null,
      entityName: user.entityName,
      entityPath: user.entityPath,
      tenantId: user.tenantId
    },
    staffRoles: user.staffRoles,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

describe("Identity session lifecycle", () => {
  it("issues ES256 access token and stores only refresh hash", async () => {
    const store = new FakeStore();
    const password = "correct-horse-battery-staple";
    store.loginRecord = {
      userId: user.id,
      identity: user,
      passwordHash: await bcrypt.hash(password, 10),
      isActive: true,
      isBanned: false,
      banReason: null,
      failedLoginAttempts: 0,
      lockoutUntil: null,
      twoFactorEnabled: false,
      twoFactorMethods: []
    };
    const { service, registry } = await createService(store);
    const issued = await service.login(loginInput(password), {
      requestId: randomUUID(),
      ipAddress: "127.0.0.1"
    });

    expect(store.createdSession).toBeDefined();
    expect(store.createdSession?.refreshTokenHash).toBe(
      TokenService.hashRefreshToken(issued.refreshToken)
    );
    expect(store.createdSession?.refreshTokenHash).not.toContain(issued.refreshToken);
    expect(registry.sessions.get(store.createdSession!.id)).toBe(user.id);

    const { payload, protectedHeader } = await jwtVerify(
      issued.response.accessToken,
      accessKeys.publicKey,
      { issuer: config.accessTokenIssuer, audience: config.accessTokenAudience }
    );
    expect(protectedHeader.alg).toBe("ES256");
    expect(payload.sub).toBe(user.id);
    expect(payload.sessionId).toBe(store.createdSession?.id);
    expect(payload.authzVersion).toBe(2);
  });

  it("does not issue a session for an inactive membership entity", async () => {
    const store = new FakeStore();
    const password = "correct-horse-battery-staple";
    store.loginRecord = {
      userId: user.id,
      identity: user,
      passwordHash: await bcrypt.hash(password, 10),
      isActive: true,
      isBanned: false,
      banReason: null,
      failedLoginAttempts: 0,
      lockoutUntil: null,
      twoFactorEnabled: false,
      twoFactorMethods: []
    };
    store.entityActive = false;
    const { service } = await createService(store);

    await expect(
      service.login(loginInput(password), { requestId: randomUUID() })
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(store.createdSession).toBeUndefined();
  });

  it("increments failed attempts and does not create a session", async () => {
    const store = new FakeStore();
    store.loginRecord = {
      userId: user.id,
      identity: user,
      passwordHash: await bcrypt.hash("right-password", 10),
      isActive: true,
      isBanned: false,
      banReason: null,
      failedLoginAttempts: 0,
      lockoutUntil: null,
      twoFactorEnabled: false,
      twoFactorMethods: []
    };
    const { service } = await createService(store);

    await expect(
      service.login(loginInput("wrong-password"), { requestId: randomUUID() })
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(store.failedAttempts).toBe(1);
    expect(store.createdSession).toBeUndefined();
  });

  it("fails closed instead of bypassing enabled 2FA", async () => {
    const store = new FakeStore();
    const password = "right-password";
    store.loginRecord = {
      userId: user.id,
      identity: user,
      passwordHash: await bcrypt.hash(password, 10),
      isActive: true,
      isBanned: false,
      banReason: null,
      failedLoginAttempts: 0,
      lockoutUntil: null,
      twoFactorEnabled: true,
      twoFactorMethods: ["app"]
    };
    const { service } = await createService(store);

    await expect(
      service.login(loginInput(password), { requestId: randomUUID() })
    ).rejects.toMatchObject({
      code: "TWO_FACTOR_REQUIRED",
      details: { challengeId: store.createdChallengeId, methods: ["app"] }
    });
    expect(store.createdSession).toBeUndefined();
  });

  it("consumes an opaque TOTP challenge before issuing a session", async () => {
    const store = new FakeStore();
    const secret = authenticator.generateSecret();
    store.twoFactorChallenge = {
      id: store.createdChallengeId,
      userId: user.id,
      identity: user,
      allowedMethods: ["app"],
      rememberMe: false,
      attempts: 0,
      secret,
      recoveryCodeHashes: [],
      isActive: true,
      isBanned: false
    };
    const { service } = await createService(store);

    const issued = await service.verifyTwoFactor(
      {
        challengeId: store.createdChallengeId,
        method: "app",
        code: authenticator.generate(secret),
        deviceType: "desktop"
      },
      { requestId: randomUUID() }
    );

    expect(store.consumedChallenge).toBe(true);
    expect(store.createdSession).toBeDefined();
    expect(issued.response.user.id).toBe(user.id);
  });

  it("counts invalid TOTP attempts without creating a session", async () => {
    const store = new FakeStore();
    store.twoFactorChallenge = {
      id: store.createdChallengeId,
      userId: user.id,
      identity: user,
      allowedMethods: ["app"],
      rememberMe: false,
      attempts: 0,
      secret: authenticator.generateSecret(),
      recoveryCodeHashes: [],
      isActive: true,
      isBanned: false
    };
    const { service } = await createService(store);

    const validCode = authenticator.generate(store.twoFactorChallenge.secret!);
    const invalidCode = `${validCode[0] === "0" ? "1" : "0"}${validCode.slice(1)}`;
    await expect(
      service.verifyTwoFactor(
        {
          challengeId: store.createdChallengeId,
          method: "app",
          code: invalidCode
        },
        { requestId: randomUUID() }
      )
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(store.twoFactorFailures).toBe(1);
    expect(store.createdSession).toBeUndefined();
  });

  it("atomically consumes one recovery code with the login challenge", async () => {
    const store = new FakeStore();
    const recoveryCode = "ABCDE-12345";
    const recoveryHash = await bcrypt.hash(recoveryCode, 10);
    store.twoFactorChallenge = {
      id: store.createdChallengeId,
      userId: user.id,
      identity: user,
      allowedMethods: ["app"],
      rememberMe: false,
      attempts: 0,
      secret: authenticator.generateSecret(),
      recoveryCodeHashes: [recoveryHash],
      isActive: true,
      isBanned: false
    };
    const { service } = await createService(store);

    await service.verifyTwoFactor(
      {
        challengeId: store.createdChallengeId,
        method: "recovery",
        code: recoveryCode
      },
      { requestId: randomUUID() }
    );

    expect(store.consumedRecoveryHash).toBe(recoveryHash);
    expect(store.createdSession).toBeDefined();
  });

  it("sends and consumes a keyed email 2FA code", async () => {
    const store = new FakeStore();
    store.twoFactorChallenge = {
      id: store.createdChallengeId,
      userId: user.id,
      identity: user,
      allowedMethods: ["email"],
      rememberMe: false,
      attempts: 0,
      secret: null,
      recoveryCodeHashes: [],
      isActive: true,
      isBanned: false
    };
    const { service } = await createService(store);

    const sent = await service.sendTwoFactorEmailCode(
      store.createdChallengeId,
      { requestId: randomUUID() }
    );
    const delivery = store.twoFactorEmailInput!;
    const payload = new SensitivePayloadCipher(config.outboxEncryptionKey).decrypt({
      ciphertext: delivery.outbox.payloadCiphertext,
      iv: delivery.outbox.payloadIv,
      authTag: delivery.outbox.payloadAuthTag
    });
    const code = payload.variables.code!;
    expect(sent.maskedContact).toContain("***@");
    expect(delivery.codeHash).toBe(
      new SensitivePayloadCipher(config.outboxEncryptionKey).blindIndex(
        `${store.createdChallengeId}:${code}`
      )
    );
    expect(delivery.outbox.payloadCiphertext).not.toContain(code);

    await service.verifyTwoFactor(
      {
        challengeId: store.createdChallengeId,
        method: "email",
        code
      },
      { requestId: randomUUID() }
    );
    expect(store.consumedEmailCodeHash).toBe(delivery.codeHash);
    expect(store.createdSession).toBeDefined();
  });

  it("enables TOTP from an expiring server-side setup challenge", async () => {
    const store = new FakeStore();
    const { service, registry } = await createService(store);
    registry.sessions.set(store.passwordChangeResult.revokedSessionIds[0]!, user.id);

    const setup = await service.beginTotpSetup({
      v: 1,
      requestId: randomUUID(),
      authType: "user",
      actorId: user.id,
      sessionId: "actor-session",
      entityId: user.entityId,
      entityType: user.entityType,
      entityRole: user.entityRole,
      tenantId: user.tenantId!,
      entityPath: user.entityPath,
      roles: [user.entityType],
      staffRoles: user.staffRoles,
      authzVersion: user.authzVersion
    });
    const recoveryCodes = await service.completeTotpSetup(
      {
        v: 1,
        requestId: randomUUID(),
        authType: "user",
        actorId: user.id,
        sessionId: "actor-session",
        entityId: user.entityId,
        entityType: user.entityType,
        entityRole: user.entityRole,
        tenantId: user.tenantId!,
        entityPath: user.entityPath,
        roles: [user.entityType],
        staffRoles: user.staffRoles,
        authzVersion: user.authzVersion
      },
      setup.challengeId,
      authenticator.generate(setup.secret),
      { requestId: randomUUID() }
    );

    expect(setup.otpauthUri).toContain("issuer=BeAlpha%20Test");
    expect(store.finalizedTotp).toBe(true);
    expect(recoveryCodes).toHaveLength(10);
    expect(store.recoveryHashes).toHaveLength(10);
    expect(store.recoveryHashes[0]).not.toContain(recoveryCodes[0]!);
    expect(registry.versions.get(user.id)).toBe(3);
  });

  it("requires password before disabling 2FA", async () => {
    const store = new FakeStore();
    store.passwordHash = await bcrypt.hash("correct-password", 10);
    const { service } = await createService(store);
    const context: InternalAuthContext = {
      v: 1,
      requestId: randomUUID(),
      authType: "user",
      actorId: user.id,
      sessionId: "actor-session",
      entityId: user.entityId,
      entityType: user.entityType,
      entityRole: user.entityRole,
      tenantId: user.tenantId!,
      entityPath: user.entityPath,
      roles: [user.entityType],
      staffRoles: user.staffRoles,
      authzVersion: user.authzVersion
    };

    await expect(
      service.disableTwoFactor(context, "wrong-password", {
        requestId: randomUUID()
      })
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(store.disabledTotp).toBe(false);
  });

  it("enables email 2FA only after OTP verification and preserves the current session", async () => {
    const store = new FakeStore();
    const { service } = await createService(store);
    const context: InternalAuthContext = {
      v: 1,
      requestId: randomUUID(),
      authType: "user",
      actorId: user.id,
      sessionId: "actor-session",
      entityId: user.entityId,
      entityType: user.entityType,
      entityRole: user.entityRole,
      tenantId: user.tenantId!,
      entityPath: user.entityPath,
      roles: [user.entityType],
      staffRoles: user.staffRoles,
      authzVersion: user.authzVersion
    };

    const setup = await service.beginEmailTwoFactorSetup(context, {
      requestId: randomUUID()
    });
    expect(store.twoFactorMethodChange).toBeUndefined();
    expect(setup.maskedContact).toContain("***@");
    expect(store.twoFactorChallenge?.allowedMethods).toContain("setup:email");

    const delivery = store.twoFactorEmailInput!;
    const payload = new SensitivePayloadCipher(config.outboxEncryptionKey).decrypt({
      ciphertext: delivery.outbox.payloadCiphertext,
      iv: delivery.outbox.payloadIv,
      authTag: delivery.outbox.payloadAuthTag
    });
    await service.completeEmailTwoFactorSetup(
      context,
      setup.challengeId,
      payload.variables.code!,
      { requestId: randomUUID() }
    );

    expect(store.twoFactorMethodChange).toEqual({ method: "email", enabled: true });
    expect(store.finalizedEmailSetup).toBe(true);
    expect(store.preservedTwoFactorSession).toBe("actor-session");
  });

  it("rejects replaying an email 2FA setup code", async () => {
    const store = new FakeStore();
    const { service } = await createService(store);
    const context: InternalAuthContext = {
      v: 1,
      requestId: randomUUID(),
      authType: "user",
      actorId: user.id,
      sessionId: "actor-session",
      entityId: user.entityId,
      entityType: user.entityType,
      entityRole: user.entityRole,
      tenantId: user.tenantId!,
      entityPath: user.entityPath,
      roles: [user.entityType],
      staffRoles: user.staffRoles,
      authzVersion: user.authzVersion
    };
    const setup = await service.beginEmailTwoFactorSetup(context, {
      requestId: randomUUID()
    });
    const delivery = store.twoFactorEmailInput!;
    const payload = new SensitivePayloadCipher(config.outboxEncryptionKey).decrypt({
      ciphertext: delivery.outbox.payloadCiphertext,
      iv: delivery.outbox.payloadIv,
      authTag: delivery.outbox.payloadAuthTag
    });

    await service.completeEmailTwoFactorSetup(
      context,
      setup.challengeId,
      payload.variables.code!,
      { requestId: randomUUID() }
    );
    await expect(
      service.completeEmailTwoFactorSetup(
        context,
        setup.challengeId,
        payload.variables.code!,
        { requestId: randomUUID() }
      )
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("requires password before disabling one 2FA method", async () => {
    const store = new FakeStore();
    store.passwordHash = await bcrypt.hash("correct-password", 10);
    const { service } = await createService(store);
    const context: InternalAuthContext = {
      v: 1,
      requestId: randomUUID(),
      authType: "user",
      actorId: user.id,
      sessionId: "actor-session",
      entityId: user.entityId,
      entityType: user.entityType,
      entityRole: user.entityRole,
      tenantId: user.tenantId!,
      entityPath: user.entityPath,
      roles: [user.entityType],
      staffRoles: user.staffRoles,
      authzVersion: user.authzVersion
    };

    await expect(
      service.disableTwoFactorMethod(context, "app", "wrong-password", {
        requestId: randomUUID()
      })
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(store.twoFactorMethodChange).toBeUndefined();
  });

  it("stores password-reset delivery payload encrypted and returns no token", async () => {
    const store = new FakeStore();
    store.passwordResetRecipient = { email: user.email, locale: "en" };
    const { service } = await createService(store);

    await expect(
      service.requestPasswordReset(user.email, { requestId: randomUUID() })
    ).resolves.toBeUndefined();

    expect(store.passwordResetOutbox).toBeDefined();
    const payload = new SensitivePayloadCipher(config.outboxEncryptionKey).decrypt({
      ciphertext: store.passwordResetOutbox!.payloadCiphertext,
      iv: store.passwordResetOutbox!.payloadIv,
      authTag: store.passwordResetOutbox!.payloadAuthTag
    });
    expect(payload.template).toBe("password-reset");
    expect(payload.recipient).toBe(user.email);
    expect(store.passwordResetTokenHash).toBe(
      TokenService.hashRefreshToken(payload.variables.token!)
    );
    expect(store.passwordResetOutbox!.payloadCiphertext).not.toContain(
      payload.variables.token!
    );
  });

  it("does not reveal whether a password-reset email exists", async () => {
    const store = new FakeStore();
    const { service } = await createService(store);

    await expect(
      service.requestPasswordReset("missing@example.com", {
        requestId: randomUUID()
      })
    ).resolves.toBeUndefined();
    expect(store.passwordResetOutbox).toBeUndefined();
  });

  it("consumes a valid reset token and invalidates every session", async () => {
    const store = new FakeStore();
    store.passwordResetValid = true;
    const registry = new MemorySessionRegistry();
    registry.sessions.set("reset-session", user.id);
    const { service } = await createService(store, registry);

    await service.confirmPasswordReset(
      "a".repeat(43),
      "Strong-password-123!",
      { requestId: randomUUID() }
    );

    expect(store.consumedResetPasswordHash).toBeDefined();
    expect(registry.sessions.has("reset-session")).toBe(false);
    expect(registry.versions.get(user.id)).toBe(4);
  });

  it("accepts entity projections only from catalog service context", async () => {
    const store = new FakeStore();
    const { service } = await createService(store);
    const snapshot = {
      id: "20000000-0000-4000-8000-000000000002",
      entityType: "SUB_ACCOUNT" as const,
      name: "Artist",
      path: `${user.entityPath}.artist`,
      tenantId: user.tenantId,
      isActive: true,
      version: 1
    };

    await expect(
      service.syncEntitySnapshot(currentUserContext(), snapshot)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      service.syncEntitySnapshot(
        {
          v: 1,
          requestId: randomUUID(),
          authType: "service",
          serviceId: "catalog",
          roles: [],
          staffRoles: []
        },
        snapshot
      )
    ).resolves.toBe(true);
    expect(store.syncedEntitySnapshot).toBe(true);
  });

  it("creates an in-scope invitation with encrypted delivery token", async () => {
    const store = new FakeStore();
    store.entitySnapshot = {
      id: "20000000-0000-4000-8000-000000000002",
      entityType: "SUB_ACCOUNT",
      name: "Artist",
      path: `${user.entityPath}.artist`,
      tenantId: user.tenantId,
      isActive: true,
      version: 1
    };
    const created = invitationRecord();
    store.createInvitationResult = { kind: "created", invitation: created };
    const { service } = await createService(store);

    await service.createInvitation(
      currentUserContext(),
      { email: created.email, entityId: created.entityId, role: "OWNER", businessTitle: "Artist" },
      { requestId: randomUUID() }
    );

    const input = store.createdInvitationInput!;
    const payload = new SensitivePayloadCipher(config.outboxEncryptionKey).decrypt({
      ciphertext: input.outbox.payloadCiphertext,
      iv: input.outbox.payloadIv,
      authTag: input.outbox.payloadAuthTag
    });
    expect(payload.template).toBe("identity-invitation");
    expect(input.tokenHash).toBe(
      TokenService.hashRefreshToken(payload.variables.token!)
    );
    expect(input.entity.path).toBe(`${user.entityPath}.artist`);
    expect(input.businessTitle).toBe("Artist");
  });

  it("allows scoped invitations for Artist team members", async () => {
    const store = new FakeStore();
    store.entitySnapshot = {
      id: "20000000-0000-4000-8000-000000000002",
      entityType: "SUB_ACCOUNT",
      name: "Customer",
      path: `${user.entityPath}.customer`,
      tenantId: user.tenantId,
      isActive: true,
      version: 1
    };
    store.createInvitationResult = { kind: "created", invitation: invitationRecord() };
    const { service } = await createService(store);

    await expect(service.createInvitation(
      currentUserContext(),
      { email: "customer@example.com", entityId: store.entitySnapshot.id, role: "MEMBER" },
      { requestId: randomUUID() }
    )).resolves.toBeDefined();
    expect(store.createdInvitationInput).toMatchObject({ role: "MEMBER" });
  });

  it("allows organization owners to invite team members after owner onboarding", async () => {
    const store = new FakeStore();
    store.entitySnapshot = {
      id: "20000000-0000-4000-8000-000000000004",
      entityType: "ORGANIZATION",
      name: "Child Organization",
      path: `${user.entityPath}.child-org`,
      tenantId: user.tenantId,
      isActive: true,
      version: 1
    };
    const invited = invitationRecord({
      entityId: store.entitySnapshot.id,
      entityType: "ORGANIZATION",
      entityName: store.entitySnapshot.name,
      entityPath: store.entitySnapshot.path,
      role: "MEMBER",
      businessTitle: "Label Manager"
    });
    store.createInvitationResult = { kind: "created", invitation: invited };
    const { service } = await createService(store);

    await expect(service.createInvitation(
      currentUserContext(),
      { email: "manager@example.com", entityId: store.entitySnapshot.id, role: "MEMBER", businessTitle: "Label Manager" },
      { requestId: randomUUID() }
    )).resolves.toMatchObject({ role: "MEMBER", businessTitle: "Label Manager" });
    expect(store.createdInvitationInput).toMatchObject({ role: "MEMBER", businessTitle: "Label Manager" });
  });

  it("rejects invitation creation for a sibling entity", async () => {
    const store = new FakeStore();
    store.entitySnapshot = {
      id: "20000000-0000-4000-8000-000000000003",
      entityType: "ORGANIZATION",
      name: "Sibling",
      path: "bealpha.group.sibling",
      tenantId: "20000000-0000-4000-8000-000000000003",
      isActive: true,
      version: 1
    };
    const { service } = await createService(store);

    await expect(
      service.createInvitation(
        currentUserContext(),
        {
          email: "sibling@example.com",
          entityId: store.entitySnapshot.id,
          role: "MEMBER"
        },
        { requestId: randomUUID() }
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(store.createdInvitationInput).toBeUndefined();
  });

  it("invalidates existing-user sessions after invitation acceptance", async () => {
    const store = new FakeStore();
    const invitation = invitationRecord();
    store.invitationPreview = { ...invitation, existingUser: true };
    store.acceptInvitationResult = {
      kind: "accepted",
      userId: user.id,
      newUser: false,
      authzVersion: 5,
      revokedSessionIds: ["invited-session"],
      invitation
    };
    const registry = new MemorySessionRegistry();
    registry.sessions.set("invited-session", user.id);
    const { service } = await createService(store, registry);

    await service.acceptInvitation(
      { token: "a".repeat(43) },
      { requestId: randomUUID() }
    );

    expect(registry.sessions.has("invited-session")).toBe(false);
    expect(registry.versions.get(user.id)).toBe(5);
  });

  it("updates only the current user's profile", async () => {
    const store = new FakeStore();
    store.userView = identityUserView();
    const { service } = await createService(store);

    const updated = await service.updateProfile(currentUserContext(), {
      name: "Updated Name",
      theme: "light"
    });

    expect(updated.id).toBe(user.id);
    expect(updated.name).toBe("Updated Name");
    expect(updated.theme).toBe("light");
  });

  it("creates a user from a server-resolved entity snapshot", async () => {
    const store = new FakeStore();
    store.entitySnapshot = {
      id: "20000000-0000-4000-8000-000000000002",
      entityType: "SUB_ACCOUNT",
      name: "Artist",
      path: `${user.entityPath}.artist`,
      tenantId: user.tenantId,
      isActive: true,
      version: 1
    };
    const created = identityUserView({
      id: "10000000-0000-4000-8000-000000000010",
      email: "new@example.com",
      membership: {
        entityId: store.entitySnapshot.id,
        entityType: store.entitySnapshot.entityType,
        entityRole: "OWNER",
        entityName: store.entitySnapshot.name,
        entityPath: store.entitySnapshot.path,
        tenantId: store.entitySnapshot.tenantId
      }
    });
    store.createManagedUserResult = { kind: "created", user: created };
    const { service } = await createService(store);

    await service.createManagedUser(currentUserContext(), {
      email: created.email,
      password: "Strong-password-123!",
      name: "New User",
      entityId: store.entitySnapshot.id,
      entityRole: "OWNER",
      businessTitle: "Artist",
      staffRoles: []
    });

    expect(store.createdManagedUserInput?.entity.path).toBe(
      `${user.entityPath}.artist`
    );
    expect(store.createdManagedUserInput?.passwordHash).not.toBe(
      "Strong-password-123!"
    );
    expect(store.createdManagedUserInput?.request.businessTitle).toBe("Artist");
  });

  it("prevents non-super-admin staff-role assignment", async () => {
    const store = new FakeStore();
    store.entitySnapshot = {
      id: user.entityId,
      entityType: user.entityType,
      name: user.entityName,
      path: user.entityPath,
      tenantId: user.tenantId,
      isActive: true,
      version: 1
    };
    const { service } = await createService(store);

    await expect(
      service.createManagedUser(currentUserContext(), {
        email: "staff@example.com",
        password: "Strong-password-123!",
        name: "Staff User",
        entityId: user.entityId,
        entityRole: "MEMBER",
        staffRoles: ["finance"]
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(store.createdManagedUserInput).toBeUndefined();
  });

  it("lets an organization owner create an entity-scoped accountant", async () => {
    const store = new FakeStore();
    store.entitySnapshot = {
      id: user.entityId,
      entityType: "ORGANIZATION",
      name: user.entityName,
      path: user.entityPath,
      tenantId: user.tenantId,
      isActive: true,
      version: 1
    };
    store.createManagedUserResult = {
      kind: "created",
      user: identityUserView({
        membership: {
          entityId: user.entityId,
          entityType: "ORGANIZATION",
          entityRole: "ACCOUNTANT",
          entityName: user.entityName,
          entityPath: user.entityPath,
          tenantId: user.tenantId
        }
      })
    };
    const { service } = await createService(store);

    await service.createManagedUser(currentUserContext(), {
      email: "accountant@example.com",
      password: "Strong-password-123!",
      name: "Accountant",
      entityId: user.entityId,
      entityRole: "ACCOUNTANT",
      staffRoles: []
    });

    expect(store.createdManagedUserInput?.request.entityRole).toBe("ACCOUNTANT");
    expect(store.createdManagedUserInput?.request.staffRoles).toEqual([]);
  });

  it("prevents staff roles on the single-user sub-account tier", async () => {
    const store = new FakeStore();
    store.currentUser = { ...user, entityType: "SUPER_ADMIN", entityPath: "bealpha" };
    store.entitySnapshot = {
      id: "20000000-0000-4000-8000-000000000099",
      entityType: "SUB_ACCOUNT",
      name: "Customer",
      path: "bealpha.group.label.customer",
      tenantId: user.tenantId,
      isActive: true,
      version: 1
    };
    const { service } = await createService(store);

    await expect(service.createManagedUser(currentUserContext(), {
      email: "customer@example.com",
      password: "Strong-password-123!",
      name: "Customer",
      entityId: store.entitySnapshot.id,
      entityRole: "OWNER",
      staffRoles: ["supporter"]
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(store.createdManagedUserInput).toBeUndefined();
  });

  it("prevents platform staff roles on organization accounts", async () => {
    const store = new FakeStore();
    store.currentUser = { ...user, entityType: "SUPER_ADMIN", entityPath: "bealpha" };
    store.entitySnapshot = {
      id: "20000000-0000-4000-8000-000000000100",
      entityType: "ORGANIZATION",
      name: "Customer Organization",
      path: "bealpha.customer",
      tenantId: "20000000-0000-4000-8000-000000000100",
      isActive: true,
      version: 1
    };
    const { service } = await createService(store);

    await expect(service.createManagedUser(currentUserContext(), {
      email: "customer-owner@example.com",
      password: "Strong-password-123!",
      name: "Customer Owner",
      entityId: store.entitySnapshot.id,
      entityRole: "OWNER",
      staffRoles: ["admin"]
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(store.createdManagedUserInput).toBeUndefined();
  });

  it("prevents creating another account in the SUPER_ADMIN entity", async () => {
    const store = new FakeStore();
    store.currentUser = { ...user, entityType: "SUPER_ADMIN", entityPath: "bealpha" };
    store.entitySnapshot = {
      id: "20000000-0000-4000-8000-000000000099",
      entityType: "SUPER_ADMIN",
      name: "BeAlpha",
      path: "bealpha",
      tenantId: null,
      isActive: true,
      version: 1
    };
    const { service } = await createService(store);

    await expect(service.createManagedUser(currentUserContext(), {
      email: "second-root@example.com",
      password: "Strong-password-123!",
      name: "Second Root",
      entityId: store.entitySnapshot.id,
      entityRole: "OWNER",
      staffRoles: ["admin"]
    })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(store.createdManagedUserInput).toBeUndefined();
  });

  it("deactivates an in-scope user and invalidates sessions", async () => {
    const store = new FakeStore();
    const targetId = "10000000-0000-4000-8000-000000000011";
    store.managedUser = {
      identity: { ...user, id: targetId, entityPath: `${user.entityPath}.artist` },
      isActive: true,
      isBanned: false,
      banReason: null
    };
    const registry = new MemorySessionRegistry();
    registry.sessions.set("deactivated-session", targetId);
    const { service } = await createService(store, registry);

    await service.deactivateUser(currentUserContext(), targetId, {
      requestId: randomUUID()
    });

    expect(registry.sessions.has("deactivated-session")).toBe(false);
    expect(registry.versions.get(targetId)).toBe(6);
    expect(store.deactivateExpectation).toEqual({ entityId: store.managedUser.identity!.entityId, entityRole: store.managedUser.identity!.entityRole });
  });

  it("returns 409 without registry mutation when deactivation target membership changed", async () => {
    const store = new FakeStore();
    const targetId = "10000000-0000-4000-8000-000000000011";
    store.managedUser = { identity: { ...user, id: targetId, entityRole: "MEMBER", entityPath: `${user.entityPath}.artist` }, isActive: true, isBanned: false, banReason: null };
    store.deactivateUserResult = { kind: "membership_conflict" };
    const registry = new MemorySessionRegistry();
    registry.sessions.set("deactivated-session", targetId);
    const { service } = await createService(store, registry);
    await expect(service.deactivateUser(currentUserContext(), targetId, { requestId: randomUUID() })).rejects.toMatchObject({ statusCode: 409, code: "CONFLICT" });
    expect(store.deactivateExpectation).toEqual({ entityId: user.entityId, entityRole: "MEMBER" });
    expect(registry.sessions.has("deactivated-session")).toBe(true);
    expect(registry.versions.has(targetId)).toBe(false);
  });

  it("allows only super admin to update global account fields", async () => {
    const store = new FakeStore();
    const target = identityUserView({
      id: "10000000-0000-4000-8000-000000000012",
      email: "target@example.com"
    });
    store.managedMutationResult = {
      kind: "changed",
      user: { ...target, email: "updated@example.com", authzVersion: 7 },
      authzVersion: 7,
      revokedSessionIds: ["global-update-session"]
    };
    const { service } = await createService(store);

    await expect(
      service.updateManagedUser(currentUserContext(), target.id, {
        email: "updated@example.com"
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    store.currentUser = {
      ...user,
      entityType: "SUPER_ADMIN",
      entityPath: "bealpha",
      entityName: "BeAlpha"
    };
    const updated = await service.updateManagedUser(
      currentUserContext(),
      target.id,
      { email: "updated@example.com" }
    );
    expect(updated.email).toBe("updated@example.com");
  });

  it("does not treat a root reviewer as the global super owner", async () => {
    const store = new FakeStore();
    store.currentUser = { ...user, entityType: "SUPER_ADMIN", entityRole: "REVIEWER", entityPath: "bealpha", entityName: "BeAlpha" };
    const targetId = "10000000-0000-4000-8000-000000000099";
    store.managedUser = {
      identity: { ...user, id: targetId, entityPath: "bealpha.group.label.artist" },
      isActive: true,
      isBanned: false,
      banReason: null
    };
    const { service } = await createService(store);

    await expect(service.deactivateUser(currentUserContext(), targetId, { requestId: randomUUID() })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("atomically reassigns membership through the store", async () => {
    const store = new FakeStore();
    const targetId = "10000000-0000-4000-8000-000000000014";
    store.currentUser = { ...user, entityType: "SUPER_ADMIN", entityPath: "bealpha" };
    store.entitySnapshot = {
      id: "20000000-0000-4000-8000-000000000014",
      entityType: "ORGANIZATION",
      name: "Target Label",
      path: "bealpha.target",
      tenantId: "20000000-0000-4000-8000-000000000014",
      isActive: true,
      version: 1
    };
    store.managedMutationResult = {
      kind: "changed",
      user: identityUserView({ id: targetId, authzVersion: 9 }),
      authzVersion: 9,
      revokedSessionIds: ["moved-session"]
    };
    const { service } = await createService(store);

    await service.reassignMembership(
      currentUserContext(),
      targetId,
      store.entitySnapshot.id,
      "ADMIN"
    );

    expect(store.reassignedMembership).toEqual({
      userId: targetId,
      entityId: store.entitySnapshot.id,
      role: "ADMIN"
    });
  });

  it("allows administrative reassignment into an Artist team", async () => {
    const store = new FakeStore();
    const targetId = "10000000-0000-4000-8000-000000000019";
    store.currentUser = { ...user, entityType: "SUPER_ADMIN", entityPath: "bealpha" };
    store.entitySnapshot = {
      id: "20000000-0000-4000-8000-000000000019",
      entityType: "SUB_ACCOUNT",
      name: "Client Account",
      path: "bealpha.customer.client",
      tenantId: "20000000-0000-4000-8000-000000000001",
      isActive: true,
      version: 1
    };
    store.managedMutationResult = { kind: "changed", user: identityUserView({ id: targetId, authzVersion: 9 }), authzVersion: 9, revokedSessionIds: [] };
    const { service } = await createService(store);

    await expect(service.reassignMembership(
      currentUserContext(),
      targetId,
      store.entitySnapshot.id,
      "MEMBER"
    )).resolves.toBeDefined();
    expect(store.reassignedMembership).toMatchObject({ role: "MEMBER", userId: targetId });
  });

  it("hashes admin-reset passwords before persistence", async () => {
    const store = new FakeStore();
    const targetId = "10000000-0000-4000-8000-000000000015";
    store.currentUser = { ...user, entityType: "SUPER_ADMIN", entityPath: "bealpha" };
    store.managedUser = {
      identity: { ...user, id: targetId },
      isActive: true,
      isBanned: false,
      banReason: null
    };
    const { service } = await createService(store);

    await service.resetManagedUserPassword(
      currentUserContext(),
      targetId,
      "Strong-password-456!",
      { requestId: randomUUID() }
    );

    expect(store.changedPasswordHash).not.toBe("Strong-password-456!");
    expect(await bcrypt.compare("Strong-password-456!", store.changedPasswordHash!)).toBe(true);
  });

  it("removes an in-scope membership and invalidates authorization", async () => {
    const store = new FakeStore();
    const targetId = "10000000-0000-4000-8000-000000000013";
    store.managedUser = {
      identity: {
        ...user,
        id: targetId,
        entityRole: "MEMBER",
        entityPath: `${user.entityPath}.artist`
      },
      isActive: true,
      isBanned: false,
      banReason: null
    };
    store.managedMutationResult = {
      kind: "changed",
      user: identityUserView({ id: targetId, membership: null, authzVersion: 8 }),
      authzVersion: 8,
      revokedSessionIds: ["membership-session"]
    };
    const registry = new MemorySessionRegistry();
    registry.sessions.set("membership-session", targetId);
    const { service } = await createService(store, registry);

    await service.removeMembership(
      currentUserContext(),
      user.entityId,
      targetId
    );
    expect(registry.sessions.has("membership-session")).toBe(false);
    expect(registry.versions.get(targetId)).toBe(8);
  });

  it("invalidates the full family when refresh reuse is reported", async () => {
    const store = new FakeStore();
    store.rotateResult = {
      kind: "reuse",
      userId: user.id,
      authzVersion: 3,
      sessionIds: ["session-old", "session-new"]
    };
    const { service, registry } = await createService(store);
    registry.sessions.set("session-old", user.id);
    registry.sessions.set("session-new", user.id);

    await expect(
      service.refresh("a".repeat(43), { requestId: randomUUID() })
    ).rejects.toMatchObject({ code: "REFRESH_REUSE_DETECTED" });
    expect(registry.sessions.size).toBe(0);
    expect(registry.versions.get(user.id)).toBe(3);
  });

  it("rejects refresh after the membership entity is deactivated", async () => {
    const store = new FakeStore();
    store.rotateResult = {
      kind: "rotated",
      user,
      previousSessionId: "session-old",
      sessionId: "session-new",
      expiresAt: new Date(Date.now() + 60_000)
    };
    store.entityActive = false;
    const registry = new MemorySessionRegistry();
    registry.sessions.set("session-old", user.id);
    registry.sessions.set("session-new", user.id);
    const { service } = await createService(store, registry);

    await expect(
      service.refresh("a".repeat(43), { requestId: randomUUID() })
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(store.revoked).toContain("session-new");
    expect(registry.sessions.has("session-old")).toBe(false);
    expect(registry.sessions.has("session-new")).toBe(false);
  });

  it("rejects stale authorization context", async () => {
    const store = new FakeStore();
    const { service } = await createService(store);
    const context: InternalAuthContext = {
      v: 1,
      requestId: randomUUID(),
      authType: "user",
      actorId: user.id,
      sessionId: "session-1",
      entityId: user.entityId,
      entityType: user.entityType,
      entityRole: user.entityRole,
      tenantId: user.tenantId!,
      entityPath: user.entityPath,
      roles: [user.entityType],
      staffRoles: user.staffRoles,
      authzVersion: 1
    };

    await expect(service.requireCurrentUser(context)).rejects.toMatchObject({
      code: "UNAUTHENTICATED"
    });
  });

  it("changes only in-scope membership roles and invalidates target sessions", async () => {
    const store = new FakeStore();
    const targetId = "10000000-0000-4000-8000-000000000002";
    store.managedUser = {
      identity: {
        ...user,
        id: targetId,
        email: "artist@example.com",
        entityId: "20000000-0000-4000-8000-000000000002",
        entityType: "ORGANIZATION",
        entityRole: "MEMBER",
        entityName: "Artist",
        entityPath: `${user.entityPath}.artist`,
        authzVersion: 2
      },
      isActive: true,
      isBanned: false,
      banReason: null
    };
    const registry = new MemorySessionRegistry();
    registry.sessions.set("target-session", targetId);
    const { service } = await createService(store, registry);
    const context: InternalAuthContext = {
      v: 1,
      requestId: randomUUID(),
      authType: "user",
      actorId: user.id,
      sessionId: "actor-session",
      entityId: user.entityId,
      entityType: user.entityType,
      entityRole: user.entityRole,
      tenantId: user.tenantId!,
      entityPath: user.entityPath,
      roles: [user.entityType],
      staffRoles: user.staffRoles,
      authzVersion: user.authzVersion
    };

    await service.changeUserMembershipRole(
      context,
      targetId,
      "ADMIN",
      { requestId: randomUUID() }
    );

    expect(store.changedMembershipRole).toBe("ADMIN");
    expect(store.membershipRoleExpectation).toEqual({ entityId: store.managedUser.identity!.entityId, entityRole: "MEMBER" });
    expect(registry.sessions.has("target-session")).toBe(false);
    expect(registry.versions.get(targetId)).toBe(3);
  });

  it("returns conflict without revoking sessions when authorization snapshot changed", async () => {
    const store = new FakeStore();
    const targetId = "10000000-0000-4000-8000-000000000088";
    store.managedUser = { identity: { ...user, id: targetId, entityRole: "MEMBER", entityPath: `${user.entityPath}.member` }, isActive: true, isBanned: false, banReason: null };
    store.membershipRoleResult = { kind: "membership_conflict" };
    const registry = new MemorySessionRegistry();
    registry.sessions.set("target-session", targetId);
    const { service } = await createService(store, registry);
    await expect(service.changeUserMembershipRole(currentUserContext(), targetId, "ADMIN", { requestId: randomUUID() })).rejects.toMatchObject({ statusCode: 409, code: "CONFLICT" });
    expect(store.membershipRoleExpectation).toEqual({ entityId: user.entityId, entityRole: "MEMBER" });
    expect(registry.sessions.get("target-session")).toBe(targetId);
  });

  it("allows scoped Artist members to hold non-owner roles", async () => {
    const store = new FakeStore();
    const targetId = "10000000-0000-4000-8000-000000000002";
    store.managedUser = {
      identity: {
        ...user,
        id: targetId,
        entityType: "SUB_ACCOUNT",
        entityRole: "OWNER",
        entityPath: `${user.entityPath}.customer`
      },
      isActive: true,
      isBanned: false,
      banReason: null
    };
    const { service } = await createService(store);

    await expect(
      service.changeUserMembershipRole(currentUserContext(), targetId, "MEMBER", {
        requestId: randomUUID()
      })
    ).resolves.toBeUndefined();
    expect(store.changedMembershipRole).toBe("MEMBER");
  });

  it("updates a business title separately from access permissions", async () => {
    const store = new FakeStore();
    const targetId = "10000000-0000-4000-8000-000000000012";
    store.managedUser = {
      identity: { ...user, id: targetId, entityRole: "MEMBER", entityPath: `${user.entityPath}.team` },
      isActive: true,
      isBanned: false,
      banReason: null
    };
    const { service } = await createService(store);

    await service.changeUserBusinessTitle(currentUserContext(), targetId, "Label Manager", { requestId: randomUUID() });

    expect(store.changedBusinessTitle).toBe("Label Manager");
    expect(store.businessTitleExpectation).toEqual({ entityId: user.entityId, entityRole: "MEMBER" });
    expect(store.changedMembershipRole).toBeUndefined();
  });

  it("rejects a title change after target membership changed", async () => {
    const store = new FakeStore();
    const targetId = "10000000-0000-4000-8000-000000000087";
    store.managedUser = { identity: { ...user, id: targetId, entityRole: "MEMBER", entityPath: `${user.entityPath}.team` }, isActive: true, isBanned: false, banReason: null };
    store.businessTitleUpdateResult = false;
    const { service } = await createService(store);
    await expect(service.changeUserBusinessTitle(currentUserContext(), targetId, "CFO", { requestId: randomUUID() })).rejects.toMatchObject({ statusCode: 409, code: "CONFLICT" });
    expect(store.businessTitleExpectation).toEqual({ entityId: user.entityId, entityRole: "MEMBER" });
    expect(store.changedBusinessTitle).toBeUndefined();
  });

  it.each(["last_owner", "membership_conflict", "account_disabled"] as const)("returns 409 for ban %s without revoking sessions", async kind => {
    const store = new FakeStore();
    const targetId = "10000000-0000-4000-8000-000000000087";
    store.managedUser = { identity: { ...user, id: targetId, entityRole: "MEMBER", entityPath: `${user.entityPath}.team` }, isActive: true, isBanned: false, banReason: null };
    store.banResult = { kind };
    const registry = new MemorySessionRegistry();
    registry.sessions.set("target-session", targetId);
    const { service } = await createService(store, registry);
    await expect(service.setUserBan(currentUserContext(), targetId, true, "reason", { requestId: randomUUID() })).rejects.toMatchObject({ statusCode: 409, code: "CONFLICT" });
    expect(store.banExpectation).toEqual({ entityId: user.entityId, entityRole: "MEMBER" });
    expect(store.changedBan).toBeUndefined();
    expect(registry.sessions.has("target-session")).toBe(true);
    expect(registry.versions.has(targetId)).toBe(false);
  });

  it("bans an authorized target and invalidates sessions only on success", async () => {
    const store = new FakeStore();
    const targetId = "10000000-0000-4000-8000-000000000087";
    store.managedUser = { identity: { ...user, id: targetId, entityRole: "MEMBER", entityPath: `${user.entityPath}.team` }, isActive: true, isBanned: false, banReason: null };
    const registry = new MemorySessionRegistry();
    store.passwordChangeResult = { authzVersion: 3, revokedSessionIds: ["target-session"] };
    registry.sessions.set("target-session", targetId);
    const { service } = await createService(store, registry);
    await service.setUserBan(currentUserContext(), targetId, true, "reason", { requestId: randomUUID() });
    expect(store.banExpectation).toEqual({ entityId: user.entityId, entityRole: "MEMBER" });
    expect(store.changedBan).toEqual({ banned: true, reason: "reason" });
    expect(registry.sessions.has("target-session")).toBe(false);
    expect(registry.versions.get(targetId)).toBe(3);
  });

  it("prevents an administrator from managing an owner", async () => {
    const store = new FakeStore();
    const targetId = "10000000-0000-4000-8000-000000000099";
    store.currentUser = { ...user, entityRole: "ADMIN" };
    store.managedUser = {
      identity: {
        ...user,
        id: targetId,
        entityRole: "OWNER",
        entityPath: `${user.entityPath}.child`
      },
      isActive: true,
      isBanned: false,
      banReason: null
    };
    const { service } = await createService(store);

    await expect(
      service.changeUserMembershipRole(currentUserContext(), targetId, "MEMBER", {
        requestId: randomUUID()
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      service.setUserBan(currentUserContext(), targetId, true, "policy", {
        requestId: randomUUID()
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      service.deactivateUser(currentUserContext(), targetId, {
        requestId: randomUUID()
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(store.changedMembershipRole).toBeUndefined();
    expect(store.changedBan).toBeUndefined();
  });

  it("rejects administration of sibling tenant users", async () => {
    const store = new FakeStore();
    const targetId = "10000000-0000-4000-8000-000000000003";
    store.managedUser = {
      identity: {
        ...user,
        id: targetId,
        entityPath: "bealpha.group.sibling"
      },
      isActive: true,
      isBanned: false,
      banReason: null
    };
    const { service } = await createService(store);
    const context: InternalAuthContext = {
      v: 1,
      requestId: randomUUID(),
      authType: "user",
      actorId: user.id,
      sessionId: "actor-session",
      entityId: user.entityId,
      entityType: user.entityType,
      entityRole: user.entityRole,
      tenantId: user.tenantId!,
      entityPath: user.entityPath,
      roles: [user.entityType],
      staffRoles: user.staffRoles,
      authzVersion: user.authzVersion
    };

    await expect(
      service.setUserBan(context, targetId, true, "abuse", {
        requestId: randomUUID()
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(store.changedBan).toBeUndefined();
  });
});

describe("Identity Gateway boundary", () => {
  const apps: Awaited<ReturnType<typeof buildIdentityApp>>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function signedContext(requestId: string) {
    return new SignJWT({
      v: 1,
      requestId,
      authType: "user",
      actorId: user.id,
      sessionId: "30000000-0000-4000-8000-000000000001",
      entityId: user.entityId,
      entityType: user.entityType,
      entityRole: user.entityRole,
      tenantId: user.tenantId,
      entityPath: user.entityPath,
      roles: [user.entityType],
      staffRoles: user.staffRoles,
      authzVersion: user.authzVersion
    })
      .setProtectedHeader({ alg: "ES256" })
      .setIssuer(config.gatewayContextIssuer)
      .setAudience(config.gatewayContextAudience)
      .setIssuedAt()
      .setExpirationTime("30s")
      .sign(contextKeys.privateKey);
  }

  it("requires signed context and matching request ID", async () => {
    const store = new FakeStore();
    const registry = new MemorySessionRegistry();
    const { service } = await createService(store, registry);
    const app = await buildIdentityApp({
      config,
      service,
      registry,
      logger: false
    });
    apps.push(app);

    const missing = await app.inject({ method: "GET", url: "/api/v1/auth/me" });
    expect(missing.statusCode).toBe(401);

    const requestId = randomUUID();
    const accepted = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: {
        "x-request-id": requestId,
        "x-bealpha-context": await signedContext(requestId)
      }
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().data.id).toBe(user.id);

    const mismatch = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: {
        "x-request-id": randomUUID(),
        "x-bealpha-context": await signedContext(requestId)
      }
    });
    expect(mismatch.statusCode).toBe(401);
  });

  it.each([
    { operation: "deactivate", scenario: "sibling", status: 403, code: "FORBIDDEN" },
    { operation: "deactivate", scenario: "stale", status: 409, code: "CONFLICT" },
    { operation: "ban", scenario: "sibling", status: 403, code: "FORBIDDEN" },
    { operation: "ban", scenario: "stale", status: 409, code: "CONFLICT" },
  ])("HTTP $operation rejects $scenario target with $status", async ({ operation, scenario, status, code }) => {
    const store = new FakeStore();
    const targetId = "10000000-0000-4000-8000-000000000011";
    store.managedUser = {
      identity: { ...user, id: targetId, entityRole: "MEMBER", entityPath: scenario === "sibling" ? "bealpha.group.sibling" : `${user.entityPath}.artist` },
      isActive: true, isBanned: false, banReason: null,
    };
    store.deactivateUserResult = { kind: "membership_conflict" };
    store.banResult = { kind: "membership_conflict" };
    const registry = new MemorySessionRegistry();
    registry.sessions.set("target-session", targetId);
    const { service } = await createService(store, registry);
    const app = await buildIdentityApp({ config, service, registry, logger: false });
    apps.push(app);
    const requestId = randomUUID();
    const headers = { "x-request-id": requestId, "x-bealpha-context": await signedContext(requestId) };
    const response = operation === "ban"
      ? await app.inject({ method: "PATCH", url: `/api/v1/identity/users/${targetId}/ban`, headers, payload: { banned: true, reason: "reason" } })
      : await app.inject({ method: "DELETE", url: `/api/v1/identity/users/${targetId}`, headers });
    expect(response.statusCode).toBe(status);
    expect(response.json()).toMatchObject({ data: null, error: { code }, requestId });
    expect(registry.sessions.has("target-session")).toBe(true);
    expect(registry.versions.has(targetId)).toBe(false);
    const captured = operation === "ban" ? store.banExpectation : store.deactivateExpectation;
    expect(captured).toEqual(scenario === "stale" ? { entityId: user.entityId, entityRole: "MEMBER" } : undefined);
  });
});

describe("Identity outbox", () => {
  it("publishes a versioned event then marks it delivered", async () => {
    const cipher = new SensitivePayloadCipher(config.outboxEncryptionKey);
    const encrypted = cipher.encrypt({
      channel: "email",
      template: "password-reset",
      recipient: user.email,
      locale: "en",
      variables: { token: "secret-reset-token" }
    });
    const pending: PendingOutboxEvent = {
      id: randomUUID(),
      eventId: randomUUID(),
      type: "notification.requested",
      requestId: randomUUID(),
      actorId: null,
      tenantId: null,
      entityPath: null,
      payloadCiphertext: encrypted.ciphertext,
      payloadIv: encrypted.iv,
      payloadAuthTag: encrypted.authTag,
      occurredAt: new Date("2026-07-10T00:00:00.000Z"),
      attempts: 0
    };
    const store = {
      listPendingOutbox: vi.fn(async () => [pending]),
      markOutboxPublished: vi.fn(async () => undefined),
      markOutboxFailed: vi.fn(async () => undefined)
    };
    const redis = {
      xadd: vi.fn(async (..._args: unknown[]) => "1-0"),
      disconnect: vi.fn()
    };
    const relay = new IdentityOutboxRelay(
      store,
      redis as never,
      cipher,
      1000,
      25
    );

    await relay.flush();

    expect(redis.xadd).toHaveBeenCalledOnce();
    const args = redis.xadd.mock.calls[0]!;
    const envelope = JSON.parse(args[args.length - 1] as string);
    expect(envelope.version).toBe(1);
    expect(envelope.eventId).toBe(pending.eventId);
    expect(envelope.payload.variables.token).toBe("secret-reset-token");
    expect(store.markOutboxPublished).toHaveBeenCalledWith(pending.id);
    expect(store.markOutboxFailed).not.toHaveBeenCalled();
  });
});
