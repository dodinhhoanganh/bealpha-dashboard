import type {
  EntityRole as ContractEntityRole,
  EntitySnapshotSync,
  CreateManagedUserRequest,
  IdentitySession,
  IdentityUser,
  InvitationStatus,
  UpdateProfileRequest,
  UpdateManagedUserRequest,
  PlatformRole,
  StaffRole
} from "@bealpha/contracts";
import type { PendingOutboxEvent } from "./outbox.js";
import {
  Prisma,
  type PrismaClient,
  type SessionRevokeReason
} from "./generated/prisma-v2/client.js";

const authUserArgs = {
  include: {
    membership: true,
    staffRoles: true
  }
} satisfies Prisma.UserDefaultArgs;

type PrismaAuthUser = Prisma.UserGetPayload<typeof authUserArgs>;

export interface AuthUserRecord {
  userId: string;
  identity: IdentityUser | null;
  passwordHash: string;
  isActive: boolean;
  isBanned: boolean;
  banReason: string | null;
  failedLoginAttempts: number;
  lockoutUntil: Date | null;
  twoFactorEnabled: boolean;
  twoFactorMethods: readonly string[];
}

export interface TwoFactorChallengeRecord {
  id: string;
  userId: string;
  identity: IdentityUser | null;
  allowedMethods: readonly string[];
  rememberMe: boolean;
  attempts: number;
  secret: string | null;
  recoveryCodeHashes: readonly string[];
  isActive: boolean;
  isBanned: boolean;
}

export interface NewSessionInput {
  id: string;
  userId: string;
  familyId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  ipAddress?: string;
  userAgent?: string;
  deviceName?: string;
  deviceType?: string;
}

export type RotateRefreshResult =
  | {
      kind: "rotated";
      user: IdentityUser;
      previousSessionId: string;
      sessionId: string;
      expiresAt: Date;
    }
  | {
      kind: "reuse";
      userId: string;
      authzVersion: number;
      sessionIds: string[];
    }
  | { kind: "invalid" };

export interface PasswordChangeResult {
  authzVersion: number;
  revokedSessionIds: string[];
}

export interface PasswordResetResult extends PasswordChangeResult {
  userId: string;
}

export interface ManagedUserRecord {
  identity: IdentityUser | null;
  isActive: boolean;
  isBanned: boolean;
  banReason: string | null;
}

export interface IdentityUserView {
  id: string;
  email: string;
  name: string | null;
  stageName: string | null;
  phone: string | null;
  avatar: string | null;
  isActive: boolean;
  isBanned: boolean;
  banReason: string | null;
  twoFactorEnabled: boolean;
  language: string;
  timezone: string;
  currency: string;
  theme: string;
  notifyReleases: boolean;
  notifyRoyalties: boolean;
  notifyNews: boolean;
  notifyMarketing: boolean;
  authzVersion: number;
  membership: {
    entityId: string;
    entityType: PlatformRole;
    entityRole: ContractEntityRole;
    businessTitle?: string | null;
    entityName: string;
    entityPath: string;
    tenantId: string | null;
  } | null;
  staffRoles: StaffRole[];
  createdAt: Date;
  updatedAt: Date;
}

export type CreateManagedUserResult =
  | { kind: "created"; user: IdentityUserView }
  | { kind: "duplicate" | "inactive_entity" | "subaccount_full" | "owner_required" };

export type DeactivateUserResult =
  | ({ kind: "changed" } & PasswordChangeResult)
  | { kind: "not_found" }
  | { kind: "membership_conflict" }
  | { kind: "last_owner" };

export type ManagedUserMutationResult =
  | ({ kind: "changed"; user: IdentityUserView } & PasswordChangeResult)
  | {
      kind:
        | "not_found"
        | "last_owner"
        | "duplicate_email"
        | "membership_conflict"
        | "subaccount_full"
        | "inactive_entity";
    };

export type MembershipRoleChangeResult =
  | ({ kind: "changed" } & PasswordChangeResult)
  | { kind: "last_owner" }
  | { kind: "membership_conflict" }
  | { kind: "not_found" };

export interface MembershipRoleExpectation {
  entityId: string;
  entityRole: ContractEntityRole;
}

export type UserBanChangeResult =
  | ({ kind: "changed" } & PasswordChangeResult)
  | { kind: "last_owner" | "membership_conflict" | "account_disabled" | "not_found" };

export interface TwoFactorStatus {
  enabled: boolean;
  methods: readonly string[];
  email: string;
}

export interface NewOutboxEvent {
  eventId: string;
  type: "notification.requested";
  requestId: string;
  actorId?: string;
  tenantId?: string;
  entityPath?: string;
  payloadCiphertext: string;
  payloadIv: string;
  payloadAuthTag: string;
}

export interface PasswordResetRecipient {
  email: string;
  locale: string;
}

export interface EntitySnapshotRecord {
  id: string;
  entityType: PlatformRole;
  name: string;
  path: string;
  tenantId: string | null;
  isActive: boolean;
  version: number;
}

export interface EntityAuthorizationState {
  userId: string;
  authzVersion: number;
  sessionIds: string[];
}

export interface InvitationRecord {
  id: string;
  entityId: string;
  entityType: PlatformRole;
  entityName: string;
  entityPath: string;
  tenantId: string | null;
  email: string;
  role: ContractEntityRole;
  businessTitle: string | null;
  status: InvitationStatus;
  invitedBy: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
}

export type CreateInvitationResult =
  | { kind: "created"; invitation: InvitationRecord }
  | {
      kind:
        | "duplicate"
        | "already_member"
        | "membership_conflict"
        | "subaccount_full"
        | "owner_required"
        | "inactive_entity";
    };

export interface InvitationAcceptancePreview extends InvitationRecord {
  existingUser: boolean;
}

export type AcceptInvitationResult =
  | {
      kind: "accepted";
      userId: string;
      newUser: boolean;
      authzVersion?: number;
      revokedSessionIds: string[];
      invitation: InvitationRecord;
    }
  | {
      kind:
        | "invalid"
        | "expired"
        | "already_processed"
        | "membership_conflict"
        | "subaccount_full"
        | "owner_required"
        | "password_required"
        | "account_disabled";
    };

export type SendTwoFactorEmailResult =
  | { kind: "created" }
  | { kind: "invalid" | "cooldown" | "limit" };

export interface IdentityStore {
  findUserForLogin(email: string): Promise<AuthUserRecord | null>;
  findPasswordHash(userId: string): Promise<string | null>;
  recordFailedLogin(
    userId: string,
    maxAttempts: number,
    lockoutUntil: Date
  ): Promise<{ attempts: number; locked: boolean }>;
  clearFailedLogin(userId: string): Promise<void>;
  createTwoFactorChallenge(
    userId: string,
    allowedMethods: readonly string[],
    rememberMe: boolean,
    expiresAt: Date
  ): Promise<string>;
  getTwoFactorChallenge(id: string): Promise<TwoFactorChallengeRecord | null>;
  recordTwoFactorFailure(id: string, maxAttempts: number): Promise<void>;
  consumeTwoFactorChallenge(id: string): Promise<boolean>;
  consumeRecoveryCodeAndChallenge(
    userId: string,
    challengeId: string,
    recoveryCodeHash: string
  ): Promise<boolean>;
  createTwoFactorEmailCode(input: {
    challengeId: string;
    codeHash: string;
    expiresAt: Date;
    cooldownSince: Date;
    windowSince: Date;
    maxSends: number;
    outbox: NewOutboxEvent;
  }): Promise<SendTwoFactorEmailResult>;
  consumeEmailCodeAndChallenge(
    userId: string,
    challengeId: string,
    codeHash: string
  ): Promise<boolean>;
  finalizeEmailTwoFactorSetup(
    userId: string,
    challengeId: string,
    codeHash: string,
    preserveSessionId: string
  ): Promise<PasswordChangeResult | null>;
  createTotpSetup(userId: string, secret: string, expiresAt: Date): Promise<string>;
  finalizeTotpSetup(
    userId: string,
    challengeId: string,
    recoveryCodeHashes: readonly string[],
    preserveSessionId: string
  ): Promise<PasswordChangeResult | null>;
  getTwoFactorStatus(userId: string): Promise<TwoFactorStatus | null>;
  setTwoFactorMethod(
    userId: string,
    method: "app" | "email",
    enabled: boolean,
    preserveSessionId?: string
  ): Promise<PasswordChangeResult | null>;
  disableTwoFactor(userId: string): Promise<PasswordChangeResult | null>;
  createSession(input: NewSessionInput): Promise<void>;
  rotateRefreshToken(
    oldRefreshTokenHash: string,
    next: Omit<NewSessionInput, "userId" | "familyId">
  ): Promise<RotateRefreshResult>;
  /** Returns false when the membership entity is missing or inactive. */
  isEntityActive?(entityId: string): Promise<boolean>;
  getCurrentUser(userId: string, sessionId: string): Promise<IdentityUser | null>;
  listSessions(userId: string, currentSessionId: string): Promise<IdentitySession[]>;
  revokeSession(
    userId: string,
    sessionId: string,
    reason: SessionRevokeReason
  ): Promise<boolean>;
  revokeAllSessions(
    userId: string,
    reason: SessionRevokeReason
  ): Promise<PasswordChangeResult>;
  changePassword(
    userId: string,
    passwordHash: string
  ): Promise<PasswordChangeResult>;
  getUserForAdministration(userId: string): Promise<ManagedUserRecord | null>;
  setBanState(
    userId: string,
    banned: boolean,
    reason: string | null,
    expected?: MembershipRoleExpectation
  ): Promise<UserBanChangeResult>;
  replaceStaffRoles(
    userId: string,
    roles: readonly StaffRole[]
  ): Promise<PasswordChangeResult | null>;
  changeMembershipRole(
    userId: string,
    role: ContractEntityRole,
    expected?: MembershipRoleExpectation
  ): Promise<MembershipRoleChangeResult>;
  updateMembershipBusinessTitle(
    userId: string,
    businessTitle: string | null,
    expected?: MembershipRoleExpectation
  ): Promise<boolean>;
  createPasswordResetRequest(
    email: string,
    tokenHash: string,
    expiresAt: Date,
    cooldownSince: Date,
    outbox: NewOutboxEvent
  ): Promise<boolean>;
  findPasswordResetRecipient(email: string): Promise<PasswordResetRecipient | null>;
  consumePasswordResetToken(
    tokenHash: string,
    passwordHash: string
  ): Promise<PasswordResetResult | null>;
  hasValidPasswordResetToken(tokenHash: string): Promise<boolean>;
  upsertEntitySnapshot(snapshot: EntitySnapshotSync): Promise<boolean>;
  /**
   * Invalidates users attached to an inactive entity subtree and returns the
   * resulting authorization state so the session registry can be repaired.
   * This is optional for lightweight stores used by isolated tests/tools.
   */
  invalidateEntityAuthorization?(
    snapshot: EntitySnapshotSync,
    applied: boolean
  ): Promise<readonly EntityAuthorizationState[]>;
  getEntitySnapshot(id: string): Promise<EntitySnapshotRecord | null>;
  createInvitation(input: {
    entity: EntitySnapshotRecord;
    email: string;
    role: ContractEntityRole;
    businessTitle?: string;
    tokenHash: string;
    invitedBy: string;
    expiresAt: Date;
    outbox: NewOutboxEvent;
  }): Promise<CreateInvitationResult>;
  listInvitations(input: {
    actorPath: string;
    status?: InvitationStatus;
    entityId?: string;
    limit: number;
    offset: number;
  }): Promise<{ invitations: InvitationRecord[]; total: number }>;
  getInvitation(id: string): Promise<InvitationRecord | null>;
  revokeInvitation(id: string): Promise<boolean>;
  resendInvitation(input: {
    id: string;
    tokenHash: string;
    expiresAt: Date;
    cooldownSince: Date;
    outbox: NewOutboxEvent;
  }): Promise<boolean>;
  previewInvitation(tokenHash: string): Promise<InvitationAcceptancePreview | null>;
  acceptInvitation(
    tokenHash: string,
    newUser?: { name: string; passwordHash: string }
  ): Promise<AcceptInvitationResult>;
  listUsers(input: {
    actorPath: string;
    entityId?: string;
    search?: string;
    active?: boolean;
    limit: number;
    offset: number;
  }): Promise<{ users: IdentityUserView[]; total: number }>;
  getUserView(userId: string): Promise<IdentityUserView | null>;
  createManagedUser(input: {
    request: CreateManagedUserRequest;
    entity: EntitySnapshotRecord;
    passwordHash: string;
  }): Promise<CreateManagedUserResult>;
  updateProfile(
    userId: string,
    input: UpdateProfileRequest
  ): Promise<IdentityUserView | null>;
  deactivateUser(userId: string, expected?: MembershipRoleExpectation): Promise<DeactivateUserResult>;
  updateManagedUser(
    userId: string,
    input: UpdateManagedUserRequest
  ): Promise<ManagedUserMutationResult>;
  assignMembership(
    userId: string,
    entity: EntitySnapshotRecord,
    role: ContractEntityRole
  ): Promise<ManagedUserMutationResult>;
  reassignMembership(
    userId: string,
    entity: EntitySnapshotRecord,
    role: ContractEntityRole
  ): Promise<ManagedUserMutationResult>;
  removeMembership(
    userId: string,
    entityId: string
  ): Promise<ManagedUserMutationResult>;
  createSecurityEvent(input: {
    userId?: string;
    type: string;
    severity?: string;
    ipAddress?: string;
    userAgent?: string;
    requestId?: string;
    metadata?: Prisma.InputJsonValue;
  }): Promise<void>;
}

function toIdentityUser(user: PrismaAuthUser): IdentityUser | null {
  const membership = user.membership;
  if (!membership) {
    return null;
  }
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    stageName: user.stageName,
    entityId: membership.entityId,
    entityType: membership.entityType as PlatformRole,
    entityRole: membership.entityRole as ContractEntityRole,
    entityName: membership.entityName,
    entityPath: membership.entityPath,
    tenantId: membership.tenantId,
    staffRoles: user.staffRoles.map((assignment) => assignment.role as StaffRole),
    authzVersion: user.authzVersion
  };
}

function toAuthUserRecord(user: PrismaAuthUser): AuthUserRecord {
  return {
    userId: user.id,
    identity: toIdentityUser(user),
    passwordHash: user.passwordHash,
    isActive: user.isActive,
    isBanned: user.isBanned,
    banReason: user.banReason,
    failedLoginAttempts: user.failedLoginAttempts,
    lockoutUntil: user.lockoutUntil,
    twoFactorEnabled: user.twoFactorEnabled,
    twoFactorMethods: user.twoFactorMethods
  };
}

function toInvitationRecord(invitation: {
  id: string;
  entityId: string;
  entityType: string;
  entityName: string;
  entityPath: string;
  tenantId: string | null;
  email: string;
  role: string;
  businessTitle: string | null;
  status: string;
  invitedBy: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
}): InvitationRecord {
  return {
    ...invitation,
    entityType: invitation.entityType as PlatformRole,
    role: invitation.role as ContractEntityRole,
    status: invitation.status as InvitationStatus
  };
}

function toIdentityUserView(user: PrismaAuthUser): IdentityUserView {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    stageName: user.stageName,
    phone: user.phone,
    avatar: user.avatar,
    isActive: user.isActive,
    isBanned: user.isBanned,
    banReason: user.banReason,
    twoFactorEnabled: user.twoFactorEnabled,
    language: user.language,
    timezone: user.timezone,
    currency: user.currency,
    theme: user.theme,
    notifyReleases: user.notifyReleases,
    notifyRoyalties: user.notifyRoyalties,
    notifyNews: user.notifyNews,
    notifyMarketing: user.notifyMarketing,
    authzVersion: user.authzVersion,
    membership: user.membership
      ? {
          entityId: user.membership.entityId,
          entityType: user.membership.entityType as PlatformRole,
          entityRole: user.membership.entityRole as ContractEntityRole,
          businessTitle: user.membership.businessTitle,
          entityName: user.membership.entityName,
          entityPath: user.membership.entityPath,
          tenantId: user.membership.tenantId
        }
      : null,
    staffRoles: user.staffRoles.map((assignment) => assignment.role as StaffRole),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

export class PrismaIdentityStore implements IdentityStore {
  constructor(private readonly prisma: PrismaClient) {}

  async findUserForLogin(email: string): Promise<AuthUserRecord | null> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      ...authUserArgs
    });
    return user ? toAuthUserRecord(user) : null;
  }

  async isEntityActive(entityId: string): Promise<boolean> {
    const entity = await this.prisma.entitySnapshot.findUnique({
      where: { id: entityId },
      select: { path: true, isActive: true }
    });
    if (!entity?.isActive) return false;

    // A child membership is only active while every projected ancestor is
    // active. Entity snapshots are denormalized, so checking the child row
    // alone would let a descendant sign in after its parent was disabled.
    const segments = entity.path.split(".");
    const ancestorPaths = segments.map((_, index) => segments.slice(0, index + 1).join("."));
    const ancestors = await this.prisma.entitySnapshot.findMany({
      where: { path: { in: ancestorPaths } },
      select: { isActive: true }
    });
    return ancestors.every((ancestor) => ancestor.isActive);
  }

  async recordFailedLogin(
    userId: string,
    maxAttempts: number,
    lockoutUntil: Date
  ): Promise<{ attempts: number; locked: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: { failedLoginAttempts: { increment: 1 } },
        select: { failedLoginAttempts: true }
      });
      const locked = updated.failedLoginAttempts >= maxAttempts;
      if (locked) {
        await tx.user.update({
          where: { id: userId },
          data: { lockoutUntil }
        });
      }
      return { attempts: updated.failedLoginAttempts, locked };
    });
  }

  async clearFailedLogin(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: 0, lockoutUntil: null }
    });
  }

  async createTwoFactorChallenge(
    userId: string,
    allowedMethods: readonly string[],
    rememberMe: boolean,
    expiresAt: Date
  ): Promise<string> {
    const challenge = await this.prisma.twoFactorChallenge.create({
      data: { userId, allowedMethods: [...allowedMethods], rememberMe, expiresAt },
      select: { id: true }
    });
    return challenge.id;
  }

  async getTwoFactorChallenge(
    id: string
  ): Promise<TwoFactorChallengeRecord | null> {
    const challenge = await this.prisma.twoFactorChallenge.findFirst({
      where: { id, consumedAt: null, expiresAt: { gt: new Date() } },
      include: { user: authUserArgs }
    });
    if (!challenge) return null;
    return {
      id: challenge.id,
      userId: challenge.userId,
      identity: toIdentityUser(challenge.user),
      allowedMethods: challenge.allowedMethods,
      rememberMe: challenge.rememberMe,
      attempts: challenge.attempts,
      secret: challenge.secret ?? challenge.user.twoFactorSecret,
      recoveryCodeHashes: challenge.user.twoFactorRecoveryCodes,
      isActive: challenge.user.isActive,
      isBanned: challenge.user.isBanned
    };
  }

  async recordTwoFactorFailure(id: string, maxAttempts: number): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const challenge = await tx.twoFactorChallenge.update({
        where: { id },
        data: { attempts: { increment: 1 } },
        select: { attempts: true }
      });
      if (challenge.attempts >= maxAttempts) {
        await tx.twoFactorChallenge.update({
          where: { id },
          data: { consumedAt: new Date() }
        });
      }
    });
  }

  async consumeTwoFactorChallenge(id: string): Promise<boolean> {
    const result = await this.prisma.twoFactorChallenge.updateMany({
      where: { id, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() }
    });
    return result.count === 1;
  }

  async consumeRecoveryCodeAndChallenge(
    userId: string,
    challengeId: string,
    recoveryCodeHash: string
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const challenge = await tx.twoFactorChallenge.updateMany({
        where: {
          id: challengeId,
          userId,
          consumedAt: null,
          expiresAt: { gt: new Date() }
        },
        data: { consumedAt: new Date() }
      });
      if (challenge.count !== 1) return false;
      const consumed = await tx.$executeRaw`
        UPDATE "users"
        SET "two_factor_recovery_codes" = array_remove("two_factor_recovery_codes", ${recoveryCodeHash})
        WHERE "id" = ${userId}::uuid
          AND ${recoveryCodeHash} = ANY("two_factor_recovery_codes")
      `;
      if (consumed !== 1) {
        throw new Error("Recovery code was already consumed");
      }
      return true;
    }).catch(() => false);
  }

  async createTwoFactorEmailCode(input: {
    challengeId: string;
    codeHash: string;
    expiresAt: Date;
    cooldownSince: Date;
    windowSince: Date;
    maxSends: number;
    outbox: NewOutboxEvent;
  }): Promise<SendTwoFactorEmailResult> {
    return this.prisma.$transaction(async (tx) => {
      const challenge = await tx.twoFactorChallenge.findFirst({
        where: {
          id: input.challengeId,
          consumedAt: null,
          expiresAt: { gt: new Date() },
          allowedMethods: { has: "email" },
          user: { isActive: true, isBanned: false }
        },
        select: { userId: true }
      });
      if (!challenge) return { kind: "invalid" } as const;
      const recent = await tx.twoFactorCode.findFirst({
        where: {
          userId: challenge.userId,
          method: "email",
          createdAt: { gte: input.cooldownSince }
        },
        select: { id: true }
      });
      if (recent) return { kind: "cooldown" } as const;
      const sentInWindow = await tx.twoFactorCode.count({
        where: {
          userId: challenge.userId,
          method: "email",
          createdAt: { gte: input.windowSince }
        }
      });
      if (sentInWindow >= input.maxSends) return { kind: "limit" } as const;
      await tx.twoFactorCode.updateMany({
        where: {
          userId: challenge.userId,
          method: "email",
          consumedAt: null
        },
        data: { consumedAt: new Date() }
      });
      await tx.twoFactorCode.create({
        data: {
          userId: challenge.userId,
          codeHash: input.codeHash,
          method: "email",
          expiresAt: input.expiresAt
        }
      });
      await tx.outboxEvent.create({
        data: {
          eventId: input.outbox.eventId,
          type: input.outbox.type,
          requestId: input.outbox.requestId,
          payloadCiphertext: input.outbox.payloadCiphertext,
          payloadIv: input.outbox.payloadIv,
          payloadAuthTag: input.outbox.payloadAuthTag
        }
      });
      return { kind: "created" } as const;
    });
  }

  async consumeEmailCodeAndChallenge(
    userId: string,
    challengeId: string,
    codeHash: string
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const code = await tx.twoFactorCode.updateMany({
        where: {
          userId,
          codeHash,
          method: "email",
          consumedAt: null,
          expiresAt: { gt: new Date() }
        },
        data: { consumedAt: new Date() }
      });
      if (code.count !== 1) return false;
      const challenge = await tx.twoFactorChallenge.updateMany({
        where: {
          id: challengeId,
          userId,
          consumedAt: null,
          expiresAt: { gt: new Date() }
        },
        data: { consumedAt: new Date() }
      });
      if (challenge.count !== 1) {
        throw new Error("Two-factor challenge already consumed");
      }
      return true;
    }).catch(() => false);
  }

  async finalizeEmailTwoFactorSetup(
    userId: string,
    challengeId: string,
    codeHash: string,
    preserveSessionId: string
  ): Promise<PasswordChangeResult | null> {
    return this.prisma.$transaction(async (tx) => {
      const challenge = await tx.twoFactorChallenge.findFirst({
        where: {
          id: challengeId,
          userId,
          consumedAt: null,
          expiresAt: { gt: new Date() },
          allowedMethods: { has: "setup:email" }
        },
        select: { id: true }
      });
      if (!challenge) return null;

      const claimedCode = await tx.twoFactorCode.updateMany({
        where: {
          userId,
          codeHash,
          method: "email",
          consumedAt: null,
          expiresAt: { gt: new Date() }
        },
        data: { consumedAt: new Date() }
      });
      if (claimedCode.count !== 1) return null;

      const claimedChallenge = await tx.twoFactorChallenge.updateMany({
        where: { id: challengeId, userId, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date() }
      });
      if (claimedChallenge.count !== 1) return null;

      const existing = await tx.user.findUnique({
        where: { id: userId },
        select: { twoFactorMethods: true }
      });
      if (!existing) return null;
      const sessions = await tx.session.findMany({
        where: { userId, revokedAt: null, id: { not: preserveSessionId } },
        select: { id: true }
      });
      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          twoFactorEnabled: true,
          twoFactorMethods: [...new Set([...existing.twoFactorMethods, "email"])]
        },
        select: { authzVersion: true }
      });
      await tx.session.updateMany({
        where: { userId, revokedAt: null, id: { not: preserveSessionId } },
        data: { revokedAt: new Date(), revokeReason: "REVOKED_BY_USER" }
      });
      return {
        authzVersion: updated.authzVersion,
        revokedSessionIds: sessions.map((session) => session.id)
      };
    });
  }

  async createTotpSetup(
    userId: string,
    secret: string,
    expiresAt: Date
  ): Promise<string> {
    const challenge = await this.prisma.twoFactorChallenge.create({
      data: {
        userId,
        allowedMethods: ["setup:app"],
        secret,
        expiresAt
      },
      select: { id: true }
    });
    return challenge.id;
  }

  async finalizeTotpSetup(
    userId: string,
    challengeId: string,
    recoveryCodeHashes: readonly string[],
    preserveSessionId: string
  ): Promise<PasswordChangeResult | null> {
    return this.prisma.$transaction(async (tx) => {
      const challenge = await tx.twoFactorChallenge.findFirst({
        where: {
          id: challengeId,
          userId,
          consumedAt: null,
          expiresAt: { gt: new Date() },
          allowedMethods: { has: "setup:app" },
          secret: { not: null }
        }
      });
      if (!challenge?.secret) return null;
      const claimed = await tx.twoFactorChallenge.updateMany({
        where: { id: challengeId, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date() }
      });
      if (claimed.count !== 1) return null;
      const sessions = await tx.session.findMany({
        where: { userId, revokedAt: null, id: { not: preserveSessionId } },
        select: { id: true }
      });
      const existing = await tx.user.findUnique({
        where: { id: userId },
        select: { twoFactorMethods: true }
      });
      if (!existing) return null;
      const methods = [...new Set([...existing.twoFactorMethods, "app"])];
      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          twoFactorEnabled: true,
          twoFactorMethods: methods,
          twoFactorSecret: challenge.secret,
          twoFactorRecoveryCodes: [...recoveryCodeHashes]
        },
        select: { authzVersion: true }
      });
      await tx.session.updateMany({
        where: { userId, revokedAt: null, id: { not: preserveSessionId } },
        data: { revokedAt: new Date(), revokeReason: "REVOKED_BY_USER" }
      });
      return {
        authzVersion: updated.authzVersion,
        revokedSessionIds: sessions.map((session) => session.id)
      };
    });
  }

  async getTwoFactorStatus(userId: string): Promise<TwoFactorStatus | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorEnabled: true, twoFactorMethods: true, email: true }
    });
    return user
      ? { enabled: user.twoFactorEnabled, methods: user.twoFactorMethods, email: user.email }
      : null;
  }

  async setTwoFactorMethod(
    userId: string,
    method: "app" | "email",
    enabled: boolean,
    preserveSessionId?: string
  ): Promise<PasswordChangeResult | null> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({
        where: { id: userId },
        select: { twoFactorMethods: true }
      });
      if (!existing) return null;
      const methods = enabled
        ? [...new Set([...existing.twoFactorMethods, method])]
        : existing.twoFactorMethods.filter((item) => item !== method);
      const sessions = await tx.session.findMany({
        where: {
          userId,
          revokedAt: null,
          ...(enabled && preserveSessionId ? { id: { not: preserveSessionId } } : {})
        },
        select: { id: true }
      });
      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          twoFactorEnabled: methods.length > 0,
          twoFactorMethods: methods,
          ...(!enabled && method === "app"
            ? { twoFactorSecret: null, twoFactorRecoveryCodes: [] }
            : {}),
          ...(!enabled ? { authzVersion: { increment: 1 } } : {})
        },
        select: { authzVersion: true }
      });
      await tx.session.updateMany({
        where: {
          userId,
          revokedAt: null,
          ...(enabled && preserveSessionId ? { id: { not: preserveSessionId } } : {})
        },
        data: { revokedAt: new Date(), revokeReason: "REVOKED_BY_USER" }
      });
      return {
        authzVersion: updated.authzVersion,
        revokedSessionIds: sessions.map((session) => session.id)
      };
    });
  }

  async disableTwoFactor(userId: string): Promise<PasswordChangeResult | null> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true }
      });
      if (!existing) return null;
      const sessions = await tx.session.findMany({
        where: { userId, revokedAt: null },
        select: { id: true }
      });
      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          twoFactorEnabled: false,
          twoFactorMethods: [],
          twoFactorSecret: null,
          twoFactorRecoveryCodes: [],
          authzVersion: { increment: 1 }
        },
        select: { authzVersion: true }
      });
      await tx.twoFactorChallenge.updateMany({
        where: { userId, consumedAt: null },
        data: { consumedAt: new Date() }
      });
      await tx.twoFactorCode.updateMany({
        where: { userId, consumedAt: null },
        data: { consumedAt: new Date() }
      });
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: "REVOKED_BY_USER" }
      });
      return {
        authzVersion: updated.authzVersion,
        revokedSessionIds: sessions.map((session) => session.id)
      };
    });
  }

  async createSession(input: NewSessionInput): Promise<void> {
    await this.prisma.session.create({ data: input });
  }

  async rotateRefreshToken(
    oldRefreshTokenHash: string,
    next: Omit<NewSessionInput, "userId" | "familyId">
  ): Promise<RotateRefreshResult> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.session.findUnique({
        where: { refreshTokenHash: oldRefreshTokenHash },
        include: { user: authUserArgs }
      });
      if (!existing) {
        return { kind: "invalid" } as const;
      }

      const revokeFamilyForReuse = async (): Promise<RotateRefreshResult> => {
        const family = await tx.session.findMany({
          where: { familyId: existing.familyId },
          select: { id: true }
        });
        await tx.session.updateMany({
          where: { familyId: existing.familyId, revokedAt: null },
          data: { revokedAt: new Date(), revokeReason: "REFRESH_REUSE" }
        });
        const user = await tx.user.update({
          where: { id: existing.userId },
          data: { authzVersion: { increment: 1 } },
          select: { authzVersion: true }
        });
        return {
          kind: "reuse",
          userId: existing.userId,
          authzVersion: user.authzVersion,
          sessionIds: family.map((session) => session.id)
        };
      };

      if (existing.revokedAt || existing.replacedById) {
        return existing.revokeReason === "ROTATED" || existing.replacedById
          ? revokeFamilyForReuse()
          : ({ kind: "invalid" } as const);
      }
      if (existing.expiresAt <= new Date()) {
        return { kind: "invalid" } as const;
      }

      const claimed = await tx.session.updateMany({
        where: {
          id: existing.id,
          revokedAt: null,
          replacedById: null,
          expiresAt: { gt: new Date() }
        },
        data: { revokedAt: new Date(), revokeReason: "ROTATED" }
      });
      if (claimed.count !== 1) {
        return revokeFamilyForReuse();
      }

      const identity = toIdentityUser(existing.user);
      if (!identity || !existing.user.isActive || existing.user.isBanned) {
        return { kind: "invalid" } as const;
      }

      await tx.session.create({
        data: {
          ...next,
          userId: existing.userId,
          familyId: existing.familyId,
          expiresAt: existing.expiresAt
        }
      });
      await tx.session.update({
        where: { id: existing.id },
        data: { replacedById: next.id }
      });

      return {
        kind: "rotated",
        user: identity,
        previousSessionId: existing.id,
        sessionId: next.id,
        expiresAt: existing.expiresAt
      };
    });
  }

  async findPasswordHash(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true, isActive: true, isBanned: true }
    });
    return user?.isActive && !user.isBanned ? user.passwordHash : null;
  }

  async getCurrentUser(
    userId: string,
    sessionId: string
  ): Promise<IdentityUser | null> {
    const session = await this.prisma.session.findFirst({
      where: {
        id: sessionId,
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: { isActive: true, isBanned: false }
      },
      include: { user: authUserArgs }
    });
    if (!session) {
      return null;
    }
    if (Date.now() - session.lastUsedAt.getTime() > 10 * 60 * 1000) {
      void this.prisma.session
        .update({ where: { id: session.id }, data: { lastUsedAt: new Date() } })
        .catch(() => undefined);
    }
    return toIdentityUser(session.user);
  }

  async listSessions(
    userId: string,
    currentSessionId: string
  ): Promise<IdentitySession[]> {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: "desc" }
    });
    return sessions.map((session) => ({
      id: session.id,
      deviceName: session.deviceName,
      deviceType: session.deviceType,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      createdAt: session.createdAt.toISOString(),
      lastUsedAt: session.lastUsedAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      current: session.id === currentSessionId
    }));
  }

  async revokeSession(
    userId: string,
    sessionId: string,
    reason: SessionRevokeReason
  ): Promise<boolean> {
    const result = await this.prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason }
    });
    return result.count === 1;
  }

  async revokeAllSessions(
    userId: string,
    reason: SessionRevokeReason
  ): Promise<PasswordChangeResult> {
    return this.prisma.$transaction(async (tx) => {
      const sessions = await tx.session.findMany({
        where: { userId, revokedAt: null },
        select: { id: true }
      });
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: reason }
      });
      const user = await tx.user.update({
        where: { id: userId },
        data: { authzVersion: { increment: 1 } },
        select: { authzVersion: true }
      });
      return {
        authzVersion: user.authzVersion,
        revokedSessionIds: sessions.map((session) => session.id)
      };
    });
  }

  async changePassword(
    userId: string,
    passwordHash: string
  ): Promise<PasswordChangeResult> {
    return this.prisma.$transaction(async (tx) => {
      const sessions = await tx.session.findMany({
        where: { userId, revokedAt: null },
        select: { id: true }
      });
      const user = await tx.user.update({
        where: { id: userId },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          authzVersion: { increment: 1 },
          failedLoginAttempts: 0,
          lockoutUntil: null
        },
        select: { authzVersion: true }
      });
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: "PASSWORD_CHANGED" }
      });
      return {
        authzVersion: user.authzVersion,
        revokedSessionIds: sessions.map((session) => session.id)
      };
    });
  }

  async getUserForAdministration(
    userId: string
  ): Promise<ManagedUserRecord | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      ...authUserArgs
    });
    return user
      ? {
          identity: toIdentityUser(user),
          isActive: user.isActive,
          isBanned: user.isBanned,
          banReason: user.banReason
        }
      : null;
  }

  async setBanState(
    userId: string,
    banned: boolean,
    reason: string | null,
    expected?: MembershipRoleExpectation
  ): Promise<UserBanChangeResult> {
    return this.prisma.$transaction(async (tx) => {
      const initial = await tx.user.findUnique({
        where: { id: userId },
        include: { membership: true }
      });
      if (!initial) return { kind: "not_found" } as const;
      if (expected && (initial.membership?.entityId !== expected.entityId || initial.membership.entityRole !== expected.entityRole)) {
        return { kind: "membership_conflict" } as const;
      }
      if (initial.membership) {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtextextended(${initial.membership.entityId}::text, 0))
        `;
      }
      const existing = await tx.user.findUnique({ where: { id: userId }, include: { membership: true } });
      if (!existing) return { kind: "not_found" } as const;
      if (existing.membership?.entityId !== initial.membership?.entityId ||
          existing.membership?.entityRole !== initial.membership?.entityRole) {
        return { kind: "membership_conflict" } as const;
      }
      if (!existing.isActive) return { kind: "account_disabled" } as const;
      if (banned && !existing.isBanned && existing.membership?.entityRole === "OWNER") {
        const otherOwners = await tx.membership.count({
          where: {
            entityId: existing.membership.entityId,
            entityRole: "OWNER",
            userId: { not: userId },
            user: { isActive: true, isBanned: false }
          }
        });
        if (otherOwners === 0) return { kind: "last_owner" } as const;
      }

      const sessions = banned
        ? await tx.session.findMany({
            where: { userId, revokedAt: null },
            select: { id: true }
          })
        : [];
      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          isBanned: banned,
          banReason: banned ? reason : null,
          authzVersion: { increment: 1 }
        },
        select: { authzVersion: true }
      });
      if (banned) {
        await tx.session.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date(), revokeReason: "ACCOUNT_DISABLED" }
        });
      }
      return {
        kind: "changed",
        authzVersion: updated.authzVersion,
        revokedSessionIds: sessions.map((session) => session.id)
      } as const;
    });
  }

  async replaceStaffRoles(
    userId: string,
    roles: readonly StaffRole[]
  ): Promise<PasswordChangeResult | null> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true }
      });
      if (!existing) return null;
      const sessions = await tx.session.findMany({
        where: { userId, revokedAt: null },
        select: { id: true }
      });
      await tx.userStaffRole.deleteMany({ where: { userId } });
      if (roles.length > 0) {
        await tx.userStaffRole.createMany({
          data: roles.map((role) => ({ userId, role }))
        });
      }
      const updated = await tx.user.update({
        where: { id: userId },
        data: { authzVersion: { increment: 1 } },
        select: { authzVersion: true }
      });
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: "REVOKED_BY_ADMIN" }
      });
      return {
        authzVersion: updated.authzVersion,
        revokedSessionIds: sessions.map((session) => session.id)
      };
    });
  }

  async changeMembershipRole(
    userId: string,
    role: ContractEntityRole,
    expected?: MembershipRoleExpectation
  ): Promise<MembershipRoleChangeResult> {
    return this.prisma.$transaction(async (tx) => {
      const initial = await tx.membership.findUnique({ where: { userId } });
      if (!initial) return { kind: "not_found" } as const;
      if (expected && (initial.entityId !== expected.entityId || initial.entityRole !== expected.entityRole)) return { kind: "membership_conflict" } as const;
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${initial.entityId}::text, 0))
      `;
      const membership = await tx.membership.findUnique({ where: { userId } });
      if (!membership) return { kind: "not_found" } as const;
      if (membership.entityId !== initial.entityId || (expected && membership.entityRole !== expected.entityRole)) return { kind: "membership_conflict" } as const;
      if (membership.entityRole === "OWNER" && role !== "OWNER") {
        const ownerCount = await tx.membership.count({
          where: { entityId: membership.entityId, entityRole: "OWNER", user: { isActive: true, isBanned: false } }
        });
        if (ownerCount <= 1) return { kind: "last_owner" } as const;
      }
      const sessions = await tx.session.findMany({
        where: { userId, revokedAt: null },
        select: { id: true }
      });
      await tx.membership.update({ where: { userId }, data: { entityRole: role } });
      const updated = await tx.user.update({
        where: { id: userId },
        data: { authzVersion: { increment: 1 } },
        select: { authzVersion: true }
      });
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: "REVOKED_BY_ADMIN" }
      });
      return {
        kind: "changed",
        authzVersion: updated.authzVersion,
        revokedSessionIds: sessions.map((session) => session.id)
      };
    });
  }

  async updateMembershipBusinessTitle(
    userId: string,
    businessTitle: string | null,
    expected?: MembershipRoleExpectation
  ): Promise<boolean> {
    const result = await this.prisma.membership.updateMany({
      where: { userId, ...(expected === undefined ? {} : { entityId: expected.entityId, entityRole: expected.entityRole }) },
      data: { businessTitle }
    });
    return result.count === 1;
  }

  async createPasswordResetRequest(
    email: string,
    tokenHash: string,
    expiresAt: Date,
    cooldownSince: Date,
    outbox: NewOutboxEvent
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { email },
        select: { id: true, isActive: true, isBanned: true }
      });
      if (!user?.isActive || user.isBanned) return false;
      const recent = await tx.passwordResetToken.findFirst({
        where: { userId: user.id, createdAt: { gte: cooldownSince } },
        select: { id: true }
      });
      if (recent) return true;
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: new Date() }
      });
      await tx.passwordResetToken.create({
        data: { userId: user.id, tokenHash, expiresAt }
      });
      await tx.outboxEvent.create({
        data: {
          eventId: outbox.eventId,
          type: outbox.type,
          requestId: outbox.requestId,
          ...(outbox.actorId === undefined ? {} : { actorId: outbox.actorId }),
          ...(outbox.tenantId === undefined ? {} : { tenantId: outbox.tenantId }),
          ...(outbox.entityPath === undefined
            ? {}
            : { entityPath: outbox.entityPath }),
          payloadCiphertext: outbox.payloadCiphertext,
          payloadIv: outbox.payloadIv,
          payloadAuthTag: outbox.payloadAuthTag
        }
      });
      return true;
    });
  }

  async findPasswordResetRecipient(
    email: string
  ): Promise<PasswordResetRecipient | null> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { email: true, language: true, isActive: true, isBanned: true }
    });
    return user?.isActive && !user.isBanned
      ? { email: user.email, locale: user.language }
      : null;
  }

  async consumePasswordResetToken(
    tokenHash: string,
    passwordHash: string
  ): Promise<PasswordResetResult | null> {
    return this.prisma.$transaction(async (tx) => {
      const token = await tx.passwordResetToken.findUnique({
        where: { tokenHash },
        include: { user: { select: { isActive: true, isBanned: true } } }
      });
      if (
        !token ||
        token.consumedAt ||
        token.expiresAt <= new Date() ||
        !token.user.isActive ||
        token.user.isBanned
      ) {
        return null;
      }
      const claimed = await tx.passwordResetToken.updateMany({
        where: {
          id: token.id,
          consumedAt: null,
          expiresAt: { gt: new Date() }
        },
        data: { consumedAt: new Date() }
      });
      if (claimed.count !== 1) return null;
      const sessions = await tx.session.findMany({
        where: { userId: token.userId, revokedAt: null },
        select: { id: true }
      });
      const user = await tx.user.update({
        where: { id: token.userId },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          authzVersion: { increment: 1 },
          failedLoginAttempts: 0,
          lockoutUntil: null
        },
        select: { authzVersion: true }
      });
      await tx.passwordResetToken.updateMany({
        where: { userId: token.userId, consumedAt: null },
        data: { consumedAt: new Date() }
      });
      await tx.session.updateMany({
        where: { userId: token.userId, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: "PASSWORD_CHANGED" }
      });
      return {
        userId: token.userId,
        authzVersion: user.authzVersion,
        revokedSessionIds: sessions.map((session) => session.id)
      };
    });
  }

  async hasValidPasswordResetToken(tokenHash: string): Promise<boolean> {
    const token = await this.prisma.passwordResetToken.findFirst({
      where: {
        tokenHash,
        consumedAt: null,
        expiresAt: { gt: new Date() },
        user: { isActive: true, isBanned: false }
      },
      select: { id: true }
    });
    return token !== null;
  }

  async upsertEntitySnapshot(snapshot: EntitySnapshotSync): Promise<boolean> {
    const data = {
      entityType: snapshot.entityType,
      ...(snapshot.businessTier === undefined ? {} : { businessTier: snapshot.businessTier }),
      name: snapshot.name,
      path: snapshot.path,
      tenantId: snapshot.tenantId,
      isActive: snapshot.isActive,
      version: snapshot.version
    };
    const updated = await this.prisma.entitySnapshot.updateMany({
      where: { id: snapshot.id, version: { lt: snapshot.version } },
      data
    });
    if (updated.count > 0) return true;

    const current = await this.prisma.entitySnapshot.findUnique({
      where: { id: snapshot.id },
      select: { version: true }
    });
    if (current) return false;

    try {
      await this.prisma.entitySnapshot.create({
        data: { id: snapshot.id, ...data }
      });
      return true;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
        throw error;
      }
      const raced = await this.prisma.entitySnapshot.updateMany({
        where: { id: snapshot.id, version: { lt: snapshot.version } },
        data
      });
      return raced.count > 0;
    }
  }

  async invalidateEntityAuthorization(
    snapshot: EntitySnapshotSync,
    applied: boolean
  ): Promise<readonly EntityAuthorizationState[]> {
    // Reactivation does not restore old bearer tokens. A fresh login creates a
    // new session and uses the current authorization version.
    if (snapshot.isActive) return [];

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.entitySnapshot.findUnique({
        where: { id: snapshot.id },
        select: { path: true, isActive: true }
      });
      if (!current || current.isActive) return [];

      const memberships = await tx.membership.findMany({
        where: {
          OR: [
            { entityId: snapshot.id },
            { entityPath: current.path },
            { entityPath: { startsWith: `${current.path}.` } }
          ]
        },
        select: { userId: true }
      });
      const userIds = [...new Set(memberships.map(({ userId }) => userId))];
      if (userIds.length === 0) return [];

      const activeSessions = await tx.session.findMany({
        where: { userId: { in: userIds }, revokedAt: null },
        select: { id: true, userId: true }
      });

      // Only the transition that first invalidates live sessions increments
      // authzVersion. A retried projection can still revoke a newly-created
      // session and repair Redis without repeatedly incrementing the version.
      if (applied && activeSessions.length > 0) {
        await tx.user.updateMany({
          where: { id: { in: userIds } },
          data: { authzVersion: { increment: 1 } }
        });
      }
      if (activeSessions.length > 0) {
        await tx.session.updateMany({
          where: { id: { in: activeSessions.map(({ id }) => id) }, revokedAt: null },
          data: { revokedAt: new Date(), revokeReason: "ACCOUNT_DISABLED" }
        });
      }

      const users = await tx.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, authzVersion: true }
      });
      const sessionsByUser = new Map<string, string[]>();
      for (const session of activeSessions) {
        const ids = sessionsByUser.get(session.userId) ?? [];
        ids.push(session.id);
        sessionsByUser.set(session.userId, ids);
      }
      return users.map(user => ({
        userId: user.id,
        authzVersion: user.authzVersion,
        sessionIds: sessionsByUser.get(user.id) ?? []
      }));
    });
  }

  async getEntitySnapshot(id: string): Promise<EntitySnapshotRecord | null> {
    const entity = await this.prisma.entitySnapshot.findUnique({ where: { id } });
    return entity
      ? {
          id: entity.id,
          entityType: entity.entityType as PlatformRole,
          name: entity.name,
          path: entity.path,
          tenantId: entity.tenantId,
          isActive: entity.isActive,
          version: entity.version
        }
      : null;
  }

  async createInvitation(input: {
    entity: EntitySnapshotRecord;
    email: string;
    role: ContractEntityRole;
    businessTitle?: string;
    tokenHash: string;
    invitedBy: string;
    expiresAt: Date;
    outbox: NewOutboxEvent;
  }): Promise<CreateInvitationResult> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${input.entity.id}::text, 0))
      `;
      const entity = await tx.entitySnapshot.findUnique({
        where: { id: input.entity.id }
      });
      if (!entity?.isActive) return { kind: "inactive_entity" } as const;
      const existingUser = await tx.user.findUnique({
        where: { email: input.email },
        select: { membership: { select: { entityId: true } } }
      });
      if (existingUser?.membership?.entityId === entity.id) {
        return { kind: "already_member" } as const;
      }
      if (existingUser?.membership) {
        return { kind: "membership_conflict" } as const;
      }
      const duplicate = await tx.invitation.findFirst({
        where: { entityId: entity.id, email: input.email, status: "PENDING" },
        select: { id: true }
      });
      if (duplicate) return { kind: "duplicate" } as const;

      if ((entity.entityType === "ORGANIZATION" || entity.entityType === "SUB_ACCOUNT") && input.role !== "OWNER") {
        const [owners, pendingOwners] = await Promise.all([
          tx.membership.count({ where: { entityId: entity.id, entityRole: "OWNER" } }),
          tx.invitation.count({ where: { entityId: entity.id, role: "OWNER", status: "PENDING" } })
        ]);
        if (owners + pendingOwners === 0) return { kind: "owner_required" } as const;
      }
      const invitation = await tx.invitation.create({
        data: {
          entityId: entity.id,
          entityType: entity.entityType,
          entityName: entity.name,
          entityPath: entity.path,
          tenantId: entity.tenantId,
          email: input.email,
          role: input.role,
          ...(input.businessTitle === undefined ? {} : { businessTitle: input.businessTitle }),
          tokenHash: input.tokenHash,
          invitedBy: input.invitedBy,
          expiresAt: input.expiresAt
        }
      });
      await tx.outboxEvent.create({
        data: {
          eventId: input.outbox.eventId,
          type: input.outbox.type,
          requestId: input.outbox.requestId,
          actorId: input.invitedBy,
          tenantId: entity.tenantId,
          entityPath: entity.path,
          payloadCiphertext: input.outbox.payloadCiphertext,
          payloadIv: input.outbox.payloadIv,
          payloadAuthTag: input.outbox.payloadAuthTag
        }
      });
      return { kind: "created", invitation: toInvitationRecord(invitation) };
    });
  }

  async listInvitations(input: {
    actorPath: string;
    status?: InvitationStatus;
    entityId?: string;
    limit: number;
    offset: number;
  }): Promise<{ invitations: InvitationRecord[]; total: number }> {
    const where = {
      OR: [
        { entityPath: input.actorPath },
        { entityPath: { startsWith: `${input.actorPath}.` } }
      ],
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.entityId === undefined ? {} : { entityId: input.entityId })
    } satisfies Prisma.InvitationWhereInput;
    const [invitations, total] = await Promise.all([
      this.prisma.invitation.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: input.limit,
        skip: input.offset
      }),
      this.prisma.invitation.count({ where })
    ]);
    return { invitations: invitations.map(toInvitationRecord), total };
  }

  async getInvitation(id: string): Promise<InvitationRecord | null> {
    const invitation = await this.prisma.invitation.findUnique({ where: { id } });
    return invitation ? toInvitationRecord(invitation) : null;
  }

  async revokeInvitation(id: string): Promise<boolean> {
    const result = await this.prisma.invitation.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "REVOKED" }
    });
    return result.count === 1;
  }

  async resendInvitation(input: {
    id: string;
    tokenHash: string;
    expiresAt: Date;
    cooldownSince: Date;
    outbox: NewOutboxEvent;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const invitation = await tx.invitation.findFirst({
        where: {
          id: input.id,
          status: "PENDING",
          lastSentAt: { lte: input.cooldownSince }
        }
      });
      if (!invitation) return false;
      await tx.invitation.update({
        where: { id: invitation.id },
        data: {
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
          lastSentAt: new Date()
        }
      });
      await tx.outboxEvent.create({
        data: {
          eventId: input.outbox.eventId,
          type: input.outbox.type,
          requestId: input.outbox.requestId,
          actorId: invitation.invitedBy,
          tenantId: invitation.tenantId,
          entityPath: invitation.entityPath,
          payloadCiphertext: input.outbox.payloadCiphertext,
          payloadIv: input.outbox.payloadIv,
          payloadAuthTag: input.outbox.payloadAuthTag
        }
      });
      return true;
    });
  }

  async previewInvitation(
    tokenHash: string
  ): Promise<InvitationAcceptancePreview | null> {
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash }
    });
    if (!invitation) return null;
    const existingUser = await this.prisma.user.findUnique({
      where: { email: invitation.email },
      select: { id: true }
    });
    return { ...toInvitationRecord(invitation), existingUser: !!existingUser };
  }

  async acceptInvitation(
    tokenHash: string,
    newUser?: { name: string; passwordHash: string }
  ): Promise<AcceptInvitationResult> {
    return this.prisma.$transaction(async (tx) => {
      const initial = await tx.invitation.findUnique({ where: { tokenHash } });
      if (!initial) return { kind: "invalid" } as const;
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${initial.entityId}::text, 0))
      `;
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${initial.email}::text, 1))
      `;
      const invitation = await tx.invitation.findUnique({ where: { id: initial.id } });
      if (!invitation || invitation.status !== "PENDING") {
        return { kind: "already_processed" } as const;
      }
      if (invitation.expiresAt <= new Date()) {
        await tx.invitation.update({
          where: { id: invitation.id },
          data: { status: "EXPIRED" }
        });
        return { kind: "expired" } as const;
      }
      const entity = await tx.entitySnapshot.findUnique({
        where: { id: invitation.entityId }
      });
      if (!entity?.isActive) return { kind: "invalid" } as const;
      let user = await tx.user.findUnique({
        where: { email: invitation.email },
        include: { membership: true }
      });
      if (user && (!user.isActive || user.isBanned)) {
        return { kind: "account_disabled" } as const;
      }
      if (user?.membership) {
        if (user.membership.entityId !== invitation.entityId) {
          return { kind: "membership_conflict" } as const;
        }
        await tx.invitation.update({
          where: { id: invitation.id },
          data: { status: "ACCEPTED", acceptedAt: new Date() }
        });
        return {
          kind: "accepted",
          userId: user.id,
          newUser: false,
          revokedSessionIds: [],
          invitation: toInvitationRecord(invitation)
        } as const;
      }

      if ((entity.entityType === "ORGANIZATION" || entity.entityType === "SUB_ACCOUNT") && invitation.role !== "OWNER") {
        const owners = await tx.membership.count({
          where: { entityId: entity.id, entityRole: "OWNER" }
        });
        if (owners === 0) return { kind: "owner_required" } as const;
      }
      if (!user && !newUser) return { kind: "password_required" } as const;
      const claimed = await tx.invitation.updateMany({
        where: {
          id: invitation.id,
          status: "PENDING",
          expiresAt: { gt: new Date() }
        },
        data: { status: "ACCEPTED", acceptedAt: new Date() }
      });
      if (claimed.count !== 1) return { kind: "already_processed" } as const;
      const newAccount = !user;
      user ??= await tx.user.create({
        data: {
          email: invitation.email,
          name: newUser!.name,
          passwordHash: newUser!.passwordHash
        },
        include: { membership: true }
      });
      await tx.membership.create({
        data: {
          userId: user.id,
          entityId: invitation.entityId,
          entityType: invitation.entityType,
          entityRole: invitation.role,
          businessTitle: invitation.businessTitle,
          entityName: invitation.entityName,
          entityPath: invitation.entityPath,
          tenantId: invitation.tenantId
        }
      });
      if (newAccount) {
        return {
          kind: "accepted",
          userId: user.id,
          newUser: true,
          authzVersion: user.authzVersion,
          revokedSessionIds: [],
          invitation: toInvitationRecord(invitation)
        } as const;
      }
      const sessions = await tx.session.findMany({
        where: { userId: user.id, revokedAt: null },
        select: { id: true }
      });
      const updated = await tx.user.update({
        where: { id: user.id },
        data: { authzVersion: { increment: 1 } },
        select: { authzVersion: true }
      });
      await tx.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: "REVOKED_BY_ADMIN" }
      });
      return {
        kind: "accepted",
        userId: user.id,
        newUser: false,
        authzVersion: updated.authzVersion,
        revokedSessionIds: sessions.map((session) => session.id),
        invitation: toInvitationRecord(invitation)
      } as const;
    });
  }

  async listUsers(input: {
    actorPath: string;
    entityId?: string;
    search?: string;
    active?: boolean;
    limit: number;
    offset: number;
  }): Promise<{ users: IdentityUserView[]; total: number }> {
    const where = {
      membership: {
        is: {
          AND: [
            {
              OR: [
                { entityPath: input.actorPath },
                { entityPath: { startsWith: `${input.actorPath}.` } }
              ]
            },
            ...(input.entityId === undefined ? [] : [{ entityId: input.entityId }])
          ]
        }
      },
      ...(input.active === undefined ? {} : { isActive: input.active }),
      ...(input.search === undefined
        ? {}
        : {
            OR: [
              { email: { contains: input.search, mode: "insensitive" as const } },
              { name: { contains: input.search, mode: "insensitive" as const } },
              { stageName: { contains: input.search, mode: "insensitive" as const } }
            ]
          })
    } satisfies Prisma.UserWhereInput;
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        ...authUserArgs,
        orderBy: { createdAt: "desc" },
        take: input.limit,
        skip: input.offset
      }),
      this.prisma.user.count({ where })
    ]);
    return { users: users.map(toIdentityUserView), total };
  }

  async getUserView(userId: string): Promise<IdentityUserView | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      ...authUserArgs
    });
    return user ? toIdentityUserView(user) : null;
  }

  async createManagedUser(input: {
    request: CreateManagedUserRequest;
    entity: EntitySnapshotRecord;
    passwordHash: string;
  }): Promise<CreateManagedUserResult> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${input.entity.id}::text, 0))
      `;
      const entity = await tx.entitySnapshot.findUnique({
        where: { id: input.entity.id }
      });
      if (!entity?.isActive) return { kind: "inactive_entity" } as const;
      const duplicate = await tx.user.findUnique({
        where: { email: input.request.email },
        select: { id: true }
      });
      if (duplicate) return { kind: "duplicate" } as const;

      if ((entity.entityType === "ORGANIZATION" || entity.entityType === "SUB_ACCOUNT") && input.request.entityRole !== "OWNER") {
        const owners = await tx.membership.count({ where: { entityId: entity.id, entityRole: "OWNER" } });
        if (owners === 0) return { kind: "owner_required" } as const;
      }
      const user = await tx.user.create({
        data: {
          email: input.request.email,
          passwordHash: input.passwordHash,
          name: input.request.name,
          ...(input.request.phone === undefined ? {} : { phone: input.request.phone }),
          membership: {
            create: {
              entityId: entity.id,
              entityType: entity.entityType,
              entityRole: input.request.entityRole,
              ...(input.request.businessTitle === undefined ? {} : { businessTitle: input.request.businessTitle }),
              entityName: entity.name,
              entityPath: entity.path,
              tenantId: entity.tenantId
            }
          },
          ...(input.request.staffRoles.length === 0
            ? {}
            : {
                staffRoles: {
                  create: input.request.staffRoles.map((role) => ({ role }))
                }
              })
        },
        ...authUserArgs
      });
      return { kind: "created", user: toIdentityUserView(user) };
    });
  }

  async updateProfile(
    userId: string,
    input: UpdateProfileRequest
  ): Promise<IdentityUserView | null> {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true }
    });
    if (!existing) return null;
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.stageName === undefined ? {} : { stageName: input.stageName }),
        ...(input.phone === undefined ? {} : { phone: input.phone }),
        ...(input.avatar === undefined ? {} : { avatar: input.avatar }),
        ...(input.language === undefined ? {} : { language: input.language }),
        ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
        ...(input.currency === undefined ? {} : { currency: input.currency }),
        ...(input.theme === undefined ? {} : { theme: input.theme }),
        ...(input.notifyReleases === undefined ? {} : { notifyReleases: input.notifyReleases }),
        ...(input.notifyRoyalties === undefined ? {} : { notifyRoyalties: input.notifyRoyalties }),
        ...(input.notifyNews === undefined ? {} : { notifyNews: input.notifyNews }),
        ...(input.notifyMarketing === undefined ? {} : { notifyMarketing: input.notifyMarketing })
      },
      ...authUserArgs
    });
    return toIdentityUserView(user);
  }

  async deactivateUser(userId: string, expected?: MembershipRoleExpectation): Promise<DeactivateUserResult> {
    return this.prisma.$transaction(async (tx) => {
      const initial = await tx.user.findUnique({
        where: { id: userId },
        include: { membership: true }
      });
      if (!initial) return { kind: "not_found" } as const;
      if (expected && (initial.membership?.entityId !== expected.entityId || initial.membership.entityRole !== expected.entityRole)) {
        return { kind: "membership_conflict" } as const;
      }
      if (initial.membership) {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtextextended(${initial.membership.entityId}::text, 0))
        `;
      }
      const user = await tx.user.findUnique({ where: { id: userId }, include: { membership: true } });
      if (!user) return { kind: "not_found" } as const;
      if (user.membership?.entityId !== initial.membership?.entityId || user.membership?.entityRole !== initial.membership?.entityRole) {
        return { kind: "membership_conflict" } as const;
      }
      if (user.membership?.entityRole === "OWNER") {
        const owners = await tx.membership.count({
          where: {
            entityId: user.membership.entityId,
            entityRole: "OWNER",
            user: { isActive: true, isBanned: false }
          }
        });
        if (owners <= 1) return { kind: "last_owner" } as const;
      }
      const sessions = await tx.session.findMany({
        where: { userId, revokedAt: null },
        select: { id: true }
      });
      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          isActive: false,
          authzVersion: { increment: 1 }
        },
        select: { authzVersion: true }
      });
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: "ACCOUNT_DISABLED" }
      });
      return {
        kind: "changed",
        authzVersion: updated.authzVersion,
        revokedSessionIds: sessions.map((session) => session.id)
      } as const;
    });
  }

  async updateManagedUser(
    userId: string,
    input: UpdateManagedUserRequest
  ): Promise<ManagedUserMutationResult> {
    return this.prisma.$transaction(async (tx) => {
      if (input.email) {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtextextended(${input.email}::text, 2))
        `;
      }
      let existing = await tx.user.findUnique({
        where: { id: userId },
        include: { membership: true }
      });
      if (!existing) return { kind: "not_found" } as const;
      if (input.isActive === false && existing.membership) {
        const initialMembership = existing.membership;
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtextextended(${initialMembership.entityId}::text, 0))
        `;
        existing = await tx.user.findUnique({ where: { id: userId }, include: { membership: true } });
        if (!existing) return { kind: "not_found" } as const;
        if (existing.membership?.entityId !== initialMembership.entityId || existing.membership.entityRole !== initialMembership.entityRole) {
          return { kind: "membership_conflict" } as const;
        }
      }
      if (input.email && input.email !== existing.email) {
        const duplicate = await tx.user.findUnique({
          where: { email: input.email },
          select: { id: true }
        });
        if (duplicate) return { kind: "duplicate_email" } as const;
      }
      if (input.isActive === false && existing.membership?.entityRole === "OWNER") {
        const owners = await tx.membership.count({
          where: {
            entityId: existing.membership.entityId,
            entityRole: "OWNER",
            user: { isActive: true, isBanned: false }
          }
        });
        if (owners <= 1) return { kind: "last_owner" } as const;
      }
      const sessions = await tx.session.findMany({
        where: { userId, revokedAt: null },
        select: { id: true }
      });
      await tx.user.update({
        where: { id: userId },
        data: {
          ...(input.email === undefined ? {} : { email: input.email }),
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.stageName === undefined ? {} : { stageName: input.stageName }),
          ...(input.phone === undefined ? {} : { phone: input.phone }),
          ...(input.avatar === undefined ? {} : { avatar: input.avatar }),
          ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
          authzVersion: { increment: 1 }
        }
      });
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: {
          revokedAt: new Date(),
          revokeReason:
            input.isActive === false ? "ACCOUNT_DISABLED" : "REVOKED_BY_ADMIN"
        }
      });
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        ...authUserArgs
      });
      return {
        kind: "changed",
        user: toIdentityUserView(user),
        authzVersion: user.authzVersion,
        revokedSessionIds: sessions.map((session) => session.id)
      } as const;
    });
  }

  async assignMembership(
    userId: string,
    entity: EntitySnapshotRecord,
    role: ContractEntityRole
  ): Promise<ManagedUserMutationResult> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${entity.id}::text, 0))
      `;
      const [currentEntity, user] = await Promise.all([
        tx.entitySnapshot.findUnique({ where: { id: entity.id } }),
        tx.user.findUnique({ where: { id: userId }, include: { membership: true } })
      ]);
      if (!user) return { kind: "not_found" } as const;
      if (!currentEntity?.isActive) return { kind: "inactive_entity" } as const;
      if (user.membership) return { kind: "membership_conflict" } as const;

      const sessions = await tx.session.findMany({
        where: { userId, revokedAt: null },
        select: { id: true }
      });
      await tx.membership.create({
        data: {
          userId,
          entityId: currentEntity.id,
          entityType: currentEntity.entityType,
          entityRole: role,
          entityName: currentEntity.name,
          entityPath: currentEntity.path,
          tenantId: currentEntity.tenantId
        }
      });
      await tx.user.update({
        where: { id: userId },
        data: { authzVersion: { increment: 1 } }
      });
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: "REVOKED_BY_ADMIN" }
      });
      const updated = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        ...authUserArgs
      });
      return {
        kind: "changed",
        user: toIdentityUserView(updated),
        authzVersion: updated.authzVersion,
        revokedSessionIds: sessions.map((session) => session.id)
      } as const;
    });
  }

  async reassignMembership(
    userId: string,
    entity: EntitySnapshotRecord,
    role: ContractEntityRole
  ): Promise<ManagedUserMutationResult> {
    return this.prisma.$transaction(async (tx) => {
      const initial = await tx.user.findUnique({
        where: { id: userId },
        select: { membership: { select: { entityId: true } } }
      });
      if (!initial) return { kind: "not_found" } as const;
      const entityIds = [...new Set([entity.id, ...(initial.membership ? [initial.membership.entityId] : [])])].sort();
      for (const entityId of entityIds) {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtextextended(${entityId}::text, 0))
        `;
      }
      const [currentEntity, user] = await Promise.all([
        tx.entitySnapshot.findUnique({ where: { id: entity.id } }),
        tx.user.findUnique({ where: { id: userId }, include: { membership: true } })
      ]);
      if (!user) return { kind: "not_found" } as const;
      if (!currentEntity?.isActive) return { kind: "inactive_entity" } as const;
      if (user.membership?.entityId !== initial.membership?.entityId) return { kind: "membership_conflict" } as const;
      if (
        user.membership?.entityRole === "OWNER" &&
        (user.membership.entityId !== currentEntity.id || role !== "OWNER")
      ) {
        const owners = await tx.membership.count({
          where: { entityId: user.membership.entityId, entityRole: "OWNER", user: { isActive: true, isBanned: false } }
        });
        if (owners <= 1) return { kind: "last_owner" } as const;
      }

      const sessions = await tx.session.findMany({
        where: { userId, revokedAt: null },
        select: { id: true }
      });
      await tx.membership.upsert({
        where: { userId },
        create: {
          userId,
          entityId: currentEntity.id,
          entityType: currentEntity.entityType,
          entityRole: role,
          entityName: currentEntity.name,
          entityPath: currentEntity.path,
          tenantId: currentEntity.tenantId
        },
        update: {
          entityId: currentEntity.id,
          entityType: currentEntity.entityType,
          entityRole: role,
          entityName: currentEntity.name,
          entityPath: currentEntity.path,
          tenantId: currentEntity.tenantId
        }
      });
      await tx.user.update({
        where: { id: userId },
        data: { authzVersion: { increment: 1 } }
      });
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: "REVOKED_BY_ADMIN" }
      });
      const updated = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        ...authUserArgs
      });
      return {
        kind: "changed",
        user: toIdentityUserView(updated),
        authzVersion: updated.authzVersion,
        revokedSessionIds: sessions.map((session) => session.id)
      } as const;
    });
  }

  async removeMembership(
    userId: string,
    entityId: string
  ): Promise<ManagedUserMutationResult> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${entityId}::text, 0))
      `;
      const user = await tx.user.findUnique({
        where: { id: userId },
        include: { membership: true }
      });
      if (!user?.membership || user.membership.entityId !== entityId) {
        return { kind: "not_found" } as const;
      }
      if (user.membership.entityRole === "OWNER") {
        const owners = await tx.membership.count({
          where: { entityId, entityRole: "OWNER", user: { isActive: true, isBanned: false } }
        });
        if (owners <= 1) return { kind: "last_owner" } as const;
      }
      const sessions = await tx.session.findMany({
        where: { userId, revokedAt: null },
        select: { id: true }
      });
      await tx.membership.delete({ where: { userId } });
      await tx.user.update({
        where: { id: userId },
        data: { authzVersion: { increment: 1 } }
      });
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: "REVOKED_BY_ADMIN" }
      });
      const updated = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        ...authUserArgs
      });
      return {
        kind: "changed",
        user: toIdentityUserView(updated),
        authzVersion: updated.authzVersion,
        revokedSessionIds: sessions.map((session) => session.id)
      } as const;
    });
  }

  async listPendingOutbox(limit: number): Promise<PendingOutboxEvent[]> {
    const events = await this.prisma.outboxEvent.findMany({
      where: { publishedAt: null, nextAttemptAt: { lte: new Date() } },
      orderBy: { occurredAt: "asc" },
      take: limit
    });
    return events.map((event) => ({
      id: event.id,
      eventId: event.eventId,
      type: "notification.requested",
      requestId: event.requestId,
      actorId: event.actorId,
      tenantId: event.tenantId,
      entityPath: event.entityPath,
      payloadCiphertext: event.payloadCiphertext,
      payloadIv: event.payloadIv,
      payloadAuthTag: event.payloadAuthTag,
      occurredAt: event.occurredAt,
      attempts: event.attempts
    }));
  }

  async markOutboxPublished(id: string): Promise<void> {
    await this.prisma.outboxEvent.update({
      where: { id },
      data: { publishedAt: new Date(), lastError: null }
    });
  }

  async markOutboxFailed(
    id: string,
    error: string,
    nextAttemptAt: Date
  ): Promise<void> {
    await this.prisma.outboxEvent.update({
      where: { id },
      data: {
        attempts: { increment: 1 },
        lastError: error,
        nextAttemptAt
      }
    });
  }

  async createSecurityEvent(input: {
    userId?: string;
    type: string;
    severity?: string;
    ipAddress?: string;
    userAgent?: string;
    requestId?: string;
    metadata?: Prisma.InputJsonValue;
  }): Promise<void> {
    await this.prisma.securityEvent.create({
      data: {
        type: input.type,
        ...(input.userId === undefined ? {} : { userId: input.userId }),
        ...(input.severity === undefined ? {} : { severity: input.severity }),
        ...(input.ipAddress === undefined ? {} : { ipAddress: input.ipAddress }),
        ...(input.userAgent === undefined ? {} : { userAgent: input.userAgent }),
        ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
        ...(input.metadata === undefined ? {} : { metadata: input.metadata })
      }
    });
  }
}
