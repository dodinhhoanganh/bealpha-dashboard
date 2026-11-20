import { describe, expect, it } from "vitest";

import {
  MAX_ZIP_BYTES,
  MAX_ZIP_ENTRIES,
  accessTokenClaimsSchema,
  catalogReleaseApprovedPayloadSchema,
  catalogReleaseSubmittedPayloadSchema,
  createInvitationRequestSchema,
  createManagedUserRequestSchema,
  entitySnapshotSyncSchema,
  entityRoleSchema,
  financeImportIntentRequestSchema,
  internalAuthContextSchema,
  notificationBulkActionSchema,
  normalizeTenantHostname,
  royaltySplitSchema,
  subAccountLabelAccessSchema,
  tenantBrandUpdateSchema,
  tenantDomainCreateSchema,
  upcEanSchema,
  vevoChannelNameSchema,
  vevoReceiptFileNameSchema,
  vevoSubmissionMetadataSchema
} from "../src/index.js";

describe("shared contract invariants", () => {
  it("accepts direct Artist submissions for BeAlpha QC but never skips to final approval", () => {
    const payload = { releaseId: "33333333-3333-4333-8333-333333333333", oldStatus: "DRAFT", recipientEntityPath: "root.system" };
    expect(catalogReleaseSubmittedPayloadSchema.safeParse({ ...payload, status: "PENDING_SYS_APPROVAL" }).success).toBe(true);
    for (const status of ["PENDING_SUPER_APPROVAL", "APPROVED", "DELIVERED"]) {
      expect(catalogReleaseSubmittedPayloadSchema.safeParse({ ...payload, status }).success).toBe(false);
    }
  });

  it("requires an explicit compatible Artist tier for a self-tenant snapshot", () => {
    const id = "33333333-3333-4333-8333-333333333333";
    const snapshot = { id, entityType: "SUB_ACCOUNT", name: "Artist workspace", path: "root.ops.artist", tenantId: id, isActive: true, version: 1 };
    expect(entitySnapshotSyncSchema.safeParse({ ...snapshot, businessTier: "ARTIST" }).success).toBe(true);
    for (const businessTier of [undefined, null, "BEALPHA", "DISTRIBUTOR", "LABEL", "ADMIN"]) {
      expect(entitySnapshotSyncSchema.safeParse({ ...snapshot, businessTier }).success).toBe(false);
    }
    expect(entitySnapshotSyncSchema.safeParse({ ...snapshot, businessTier: "ARTIST", tenantId: null }).success).toBe(false);
  });

  it("keeps semantic tiers compatible with entity types and legacy snapshots", () => {
    const id = "33333333-3333-4333-8333-333333333333";
    const base = { id, name: "Workspace", path: "root.ops.unit", tenantId: id, isActive: true, version: 1 };
    for (const businessTier of [undefined, null, "DISTRIBUTOR", "LABEL"]) {
      expect(entitySnapshotSyncSchema.safeParse({ ...base, entityType: "ORGANIZATION", businessTier }).success).toBe(true);
    }
    expect(entitySnapshotSyncSchema.safeParse({ ...base, entityType: "ORGANIZATION", businessTier: "ARTIST" }).success).toBe(false);
    expect(entitySnapshotSyncSchema.safeParse({ ...base, entityType: "SYSTEM_ADMIN", businessTier: "BEALPHA", tenantId: null }).success).toBe(true);
    expect(entitySnapshotSyncSchema.safeParse({ ...base, entityType: "SUPER_ADMIN", businessTier: "BEALPHA", tenantId: null }).success).toBe(false);
  });

  it("accepts UUID labels in canonical entity paths without relaxing path delimiters", () => {
    const rootEntityId = "e0000000-0000-0000-0000-000000000001";
    const childEntityId = "33333333-3333-4333-8333-333333333333";
    const claims = {
      sub: "a0000000-0000-0000-0000-000000000001",
      sessionId: "11111111-1111-4111-8111-111111111111",
      entityId: rootEntityId,
      entityType: "SUPER_ADMIN",
      entityRole: "OWNER",
      roles: ["SUPER_ADMIN"],
      staffRoles: ["admin"],
      authzVersion: 1
    };

    expect(accessTokenClaimsSchema.safeParse({
      ...claims,
      entityPath: rootEntityId
    }).success).toBe(true);
    expect(accessTokenClaimsSchema.safeParse({
      ...claims,
      entityPath: `${rootEntityId}.${childEntityId}`
    }).success).toBe(true);
    expect(accessTokenClaimsSchema.safeParse({
      ...claims,
      entityPath: `${rootEntityId}..${childEntityId}`
    }).success).toBe(false);
    expect(accessTokenClaimsSchema.safeParse({
      ...claims,
      entityPath: `${rootEntityId}/${childEntityId}`
    }).success).toBe(false);
  });

  it("keeps archive limits bounded", () => {
    expect(MAX_ZIP_BYTES).toBe(50 * 1024 * 1024 * 1024);
    expect(MAX_ZIP_ENTRIES).toBe(10_000);
  });

  it("rejects floating-point royalty shares", () => {
    expect(royaltySplitSchema.safeParse({ partyId: "party", basisPoints: 1.5 }).success).toBe(false);
  });

  it("rejects UPC/EAN values with an invalid GTIN check digit", () => {
    expect(upcEanSchema.safeParse("123456789012").success).toBe(true);
    expect(upcEanSchema.safeParse("123456789013").success).toBe(false);
  });

  it("rejects client-injected notification ownership", () => {
    expect(notificationBulkActionSchema.safeParse({ all: true, userId: "user" }).success).toBe(false);
  });

  it("keeps release workflow notifications bound to one approval tier", () => {
    const releaseId = "11111111-1111-4111-8111-111111111111";
    const approverEntityId = "22222222-2222-4222-8222-222222222222";
    expect(catalogReleaseSubmittedPayloadSchema.safeParse({
      releaseId,
      oldStatus: "SYS_REJECTED",
      status: "PENDING_ORG_APPROVAL",
      recipientEntityPath: "root.system.org"
    }).success).toBe(true);
    expect(catalogReleaseSubmittedPayloadSchema.safeParse({
      releaseId,
      oldStatus: "SYS_REJECTED",
      status: "PENDING_SYS_APPROVAL",
      recipientEntityPath: "root.system"
    }).success).toBe(true);
    expect(catalogReleaseApprovedPayloadSchema.safeParse({
      releaseId,
      releaseType: "AUDIO",
      tenantId: releaseId,
      approverEntityId,
      oldStatus: "PENDING_SYS_APPROVAL",
      status: "PENDING_SUPER_APPROVAL",
      recipientEntityPath: "root"
    }).success).toBe(true);
    expect(catalogReleaseApprovedPayloadSchema.safeParse({
      releaseId,
      releaseType: "AUDIO",
      tenantId: releaseId,
      approverEntityId,
      oldStatus: "PENDING_ORG_APPROVAL",
      status: "APPROVED",
      recipientEntityPath: "root"
    }).success).toBe(false);
  });

  it("rejects oversized finance imports", () => {
    const result = financeImportIntentRequestSchema.safeParse({
      platform: "spotify",
      period: "2026-07",
      currency: "USD",
      fileName: "report.csv",
      contentType: "text/csv",
      sizeBytes: MAX_ZIP_BYTES + 1,
      sha256: "a".repeat(64)
    });
    expect(result.success).toBe(false);
  });

  it("requires a valid signed-context shape", () => {
    expect(internalAuthContextSchema.safeParse({ roles: [], staffRoles: [] }).success).toBe(false);
  });

  it("supports an entity-scoped accountant without granting platform staff access", () => {
    expect(entityRoleSchema.safeParse("ACCOUNTANT").success).toBe(true);
    expect(entityRoleSchema.safeParse("REVIEWER").success).toBe(true);
    expect(entityRoleSchema.safeParse("FINANCE_ADMIN").success).toBe(false);
  });

  it("keeps job titles separate from access levels", () => {
    const entityId = "33333333-3333-4333-8333-333333333333";
    expect(createInvitationRequestSchema.parse({
      email: "owner@example.com",
      entityId,
      role: "OWNER",
      businessTitle: "  Label Director  "
    }).businessTitle).toBe("Label Director");
    expect(createManagedUserRequestSchema.safeParse({
      email: "reviewer@example.com",
      password: "Strong-password-123!",
      name: "Release Reviewer",
      entityId,
      entityRole: "REVIEWER",
      businessTitle: "x",
      staffRoles: []
    }).success).toBe(false);
  });

  it("binds entity snapshots to the canonical tenant level", () => {
    const organizationId = "33333333-3333-4333-8333-333333333333";
    const base = {
      id: organizationId,
      name: "Acme Records",
      path: "root.system.acme",
      isActive: true,
      version: 1
    };

    expect(entitySnapshotSyncSchema.safeParse({
      ...base,
      entityType: "ORGANIZATION",
      tenantId: organizationId
    }).success).toBe(true);
    expect(entitySnapshotSyncSchema.safeParse({
      ...base,
      id: "55555555-5555-4555-8555-555555555555",
      entityType: "ORGANIZATION",
      tenantId: organizationId
    }).success).toBe(true);
    expect(entitySnapshotSyncSchema.safeParse({
      ...base,
      entityType: "ORGANIZATION",
      tenantId: null
    }).success).toBe(false);
    expect(entitySnapshotSyncSchema.safeParse({
      ...base,
      entityType: "SYSTEM_ADMIN",
      tenantId: organizationId
    }).success).toBe(false);
    expect(entitySnapshotSyncSchema.safeParse({
      ...base,
      id: "22222222-2222-4222-8222-222222222222",
      entityType: "SUB_ACCOUNT",
      tenantId: organizationId
    }).success).toBe(true);
    expect(entitySnapshotSyncSchema.safeParse({
      ...base,
      id: "22222222-2222-4222-8222-222222222222",
      entityType: "SUB_ACCOUNT",
      tenantId: null
    }).success).toBe(false);
  });

  it("accepts only bounded UUID label assignments", () => {
    expect(subAccountLabelAccessSchema.safeParse({
      subAccountId: "22222222-2222-4222-8222-222222222222",
      labelIds: ["88888888-8888-4888-8888-888888888888"]
    }).success).toBe(true);
    expect(subAccountLabelAccessSchema.safeParse({ subAccountId: "bad", labelIds: [] }).success).toBe(false);
  });

  it("requires safe high-contrast white-label tokens", () => {
    const base = { displayName: "Acme Records", accentColor: "#111111", accentTextColor: "#FFFFFF", defaultLocale: "en", expectedVersion: 1 };
    expect(tenantBrandUpdateSchema.safeParse(base).success).toBe(true);
    expect(tenantBrandUpdateSchema.safeParse({ ...base, accentColor: "#FFFFFF" }).success).toBe(false);
    expect(tenantBrandUpdateSchema.safeParse({ ...base, supportUrl: "http://example.com" }).success).toBe(false);
    expect(tenantBrandUpdateSchema.safeParse({ ...base, customCss: "body{}" }).success).toBe(false);
  });

  it("normalizes IDN tenant domains and rejects ports, paths, IPs and single labels", () => {
    expect(normalizeTenantHostname("MÜSIC.Example.com.")).toBe("xn--msic-0ra.example.com");
    expect(tenantDomainCreateSchema.parse({ hostname: "Music.Example.com." }).hostname).toBe("music.example.com");
    for (const hostname of ["example.com:443", "example.com/path", "127.0.0.1", "localhost"]) {
      expect(tenantDomainCreateSchema.safeParse({ hostname }).success).toBe(false);
    }
  });

  it("enforces public VEVO channel-name and receipt correlation rules", () => {
    expect(vevoChannelNameSchema.safeParse("Artist123VEVO").success).toBe(true);
    expect(vevoChannelNameSchema.safeParse("Artist Name VEVO").success).toBe(false);
    expect(vevoChannelNameSchema.safeParse("ABCDEFGHIJKLMNOPQVEVO").success).toBe(false);
    expect(vevoReceiptFileNameSchema.safeParse("success-USABC2600001.json").success).toBe(true);
    expect(vevoReceiptFileNameSchema.safeParse("success-../../secret.json").success).toBe(false);
  });

  it("requires INSERT video assets and paired caption language", () => {
    const base = {
      purpose: "INSERT",
      isrc: "USABC2600001",
      title: "Video",
      label: "Label",
      genres: ["Pop"],
      mainArtists: ["Artist"],
      youtubeChannelName: "ArtistVEVO",
      startDateTime: "2026-08-30T00:00:00Z",
      territories: ["US"],
    };
    expect(vevoSubmissionMetadataSchema.safeParse(base).success).toBe(false);
    expect(vevoSubmissionMetadataSchema.safeParse({ ...base, videoAssetId: "55555555-5555-4555-8555-555555555555" }).success).toBe(true);
    expect(vevoSubmissionMetadataSchema.safeParse({ ...base, videoAssetId: "55555555-5555-4555-8555-555555555555", captionAssetId: "66666666-6666-4666-8666-666666666666" }).success).toBe(false);
  });
});
