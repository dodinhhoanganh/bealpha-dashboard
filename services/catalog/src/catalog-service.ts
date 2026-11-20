import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { normalizeTenantHostname, type BusinessTier, type InternalAuthContext, type TenantBrandUpdate } from "@bealpha/contracts";
import type { CatalogDatabase } from "./database.js";
import { CatalogError } from "./errors.js";
import { Prisma, type ReleaseStatus } from "./generated/prisma-v2/client.js";
import {
  createTenantDomainChallenge,
  defaultTenantDomainDependencies,
  dnsRecordsContainChallenge,
  type TenantDomainDependencies
} from "./tenant-domain.js";

function platformBrand(tenantId: string) {
  return {
    tenantId,
    displayName: "BeAlpha Music",
    logoAssetId: null,
    logoUrl: null,
    accentColor: "#111111",
    accentTextColor: "#FFFFFF",
    supportEmail: null,
    supportUrl: null,
    defaultLocale: "en",
    version: 1
  };
}

type Context = InternalAuthContext & {
  actorId: string;
  entityId: string;
  entityPath: string;
  entityType: "SUPER_ADMIN" | "SYSTEM_ADMIN" | "ORGANIZATION" | "SUB_ACCOUNT";
};

const lockedStatuses = new Set([
  "LOCKED_FOR_DELIVERY",
  "DELIVERED",
  "RELEASED",
  "TAKEDOWN"
]);

const editableStatuses = new Set<ReleaseStatus>([
  "DRAFT",
  "ORG_REJECTED",
  "SYS_REJECTED",
  "SUPER_REJECTED"
]);

function requireEditableRelease(status: ReleaseStatus): void {
  if (!editableStatuses.has(status)) {
    throw new CatalogError(409, "WORKFLOW_LOCKED", "Release cannot be edited while approval or delivery is in progress");
  }
}

function resetRejectedStatus(status: ReleaseStatus) {
  return status === "DRAFT" ? {} : { status: "DRAFT" as const };
}

function requireContext(context: InternalAuthContext): Context {
  if (
    context.authType !== "user" ||
    !context.actorId ||
    !context.entityId ||
    !context.entityPath ||
    !context.entityType
  ) {
    throw new CatalogError(
      403,
      "FORBIDDEN",
      "Catalog access requires an entity membership"
    );
  }
  return context as Context;
}

function requireManager(actor: Context): void {
  if (!actor.entityRole || !["OWNER", "ADMIN"].includes(actor.entityRole)) {
    throw new CatalogError(403, "FORBIDDEN", "Entity manager role required");
  }
}

function requireCompositionManager(actor: Context): void {
  requireManager(actor);
  if (actor.entityType === "SUB_ACCOUNT") {
    throw new CatalogError(403, "FORBIDDEN", "Sub-accounts cannot manage compositions");
  }
}

function requireReviewer(actor: Context): void {
  if (!actor.entityRole || !["OWNER", "ADMIN", "REVIEWER"].includes(actor.entityRole)) {
    throw new CatalogError(403, "FORBIDDEN", "Release reviewer role required");
  }
}

// Content operators (MEMBER) may prepare and submit drafts, while REVIEWER and
// ACCOUNTANT memberships are intentionally read/review-only.  Keep this check
// at the service boundary so UI capability decisions cannot become the only
// authorization layer.
function requireReleaseEditor(actor: Context): void {
  if (actor.entityType === "SUB_ACCOUNT") {
    if (actor.entityRole !== "OWNER") {
      throw new CatalogError(403, "FORBIDDEN", "Sub-account owner role required");
    }
    return;
  }
  if (!actor.entityRole || !["OWNER", "ADMIN", "MEMBER"].includes(actor.entityRole)) {
    throw new CatalogError(403, "FORBIDDEN", "Release editor role required");
  }
}

function requireReleaseSubmitter(actor: Context): void {
  requireReleaseEditor(actor);
}

function requireReleaseDeleter(actor: Context): void {
  if (actor.entityType === "SUB_ACCOUNT") {
    if (actor.entityRole !== "OWNER") {
      throw new CatalogError(403, "FORBIDDEN", "Sub-account owner role required");
    }
    return;
  }
  if (!actor.entityRole || !["OWNER", "ADMIN"].includes(actor.entityRole)) {
    throw new CatalogError(403, "FORBIDDEN", "Release administrator role required");
  }
}

function requireSuperAdmin(actor: Context): void {
  if (actor.entityType !== "SUPER_ADMIN") {
    throw new CatalogError(403, "FORBIDDEN", "Super admin access required");
  }
}

function requireOrganizationOwner(actor: Context): void {
  if (actor.entityType !== "ORGANIZATION" || actor.entityRole !== "OWNER") {
    throw new CatalogError(403, "FORBIDDEN", "Organization owner role required");
  }
}

// Catalog records belong to the root organization tenant. Nested organizations
// keep their own entity id as the owner, but must never create a second tenant
// by using that id for tenant-owned records.
function catalogTenantId(actor: Context): string {
  if (actor.entityType === "ORGANIZATION" || actor.entityType === "SUB_ACCOUNT") {
    return actor.tenantId ?? actor.entityId;
  }
  if (actor.tenantId) return actor.tenantId;
  throw new CatalogError(403, "FORBIDDEN", "Organization tenant scope required");
}

function requireRootTenantOwner(actor: Context): string {
  requireOrganizationOwner(actor);
  const tenantId = catalogTenantId(actor);
  if (actor.entityId !== tenantId) {
    throw new CatalogError(403, "FORBIDDEN", "Root organization owner role required");
  }
  return tenantId;
}

function allowedPath(path: string, scope: string): boolean {
  return path === scope || path.startsWith(`${scope}.`);
}

function parentPath(path: string): string {
  const parts = path.split(".");
  return parts.length > 1 ? parts.slice(0, -1).join(".") : path;
}

function organizationReviewPath(release: {
  tenant: { path: string };
  owner?: { path: string; entityType?: string } | null;
}): string {
  if (!release.owner) return release.tenant.path;
  return release.owner.entityType === "SUB_ACCOUNT"
    ? parentPath(release.owner.path)
    : release.owner.path;
}

function pathScope(path: string) {
  return { OR: [{ path }, { path: { startsWith: `${path}.` } }] };
}

function pathPrefixes(path: string): string[] {
  const segments = path.split(".");
  return segments.map((_, index) => segments.slice(0, index + 1).join("."));
}

export interface TrackDraftInput {
  id?: string;
  title: string;
  isrc?: string;
  trackNumber?: number;
  discNumber?: number;
  duration?: number;
  artistId?: string;
  audioAssetId?: string;
  videoAssetId?: string;
  thumbnailAssetId?: string;
  captionAssetId?: string;
  captionLanguage?: string;
  canvasAssetId?: string;
  motionAssetId?: string;
  admAssetId?: string;
  compositionId?: string;
  recordingLabelShare?: string;
  metadata?: Prisma.InputJsonObject;
}

export interface ReleaseDraftInput {
  title: string;
  ean?: string;
  type?: "AUDIO" | "VIDEO";
  format?: "SINGLE" | "EP" | "ALBUM" | "COMPILATION";
  genre?: string;
  releaseDate: Date;
  displayArtist?: string;
  coverUrl?: string;
  artistId?: string;
  labelId?: string;
  metadata?: Prisma.InputJsonObject;
  tracks: TrackDraftInput[];
}

export class CatalogService {
  constructor(
    private readonly database: CatalogDatabase,
    private readonly tenantDomains: TenantDomainDependencies = defaultTenantDomainDependencies
  ) {}

  private async withEvent<T>(
    context: InternalAuthContext,
    type: string,
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
    payload: (result: T) => Prisma.InputJsonObject
  ): Promise<T> {
    const actor = requireContext(context);
    return this.database.prisma.$transaction(async transaction => {
      const result = await operation(transaction);
      await transaction.outboxEvent.create({
        data: {
          eventId: randomUUID(),
          version: 1,
          type,
          requestId: context.requestId,
          actorId: actor.actorId,
          tenantId: actor.tenantId,
          entityPath: actor.entityPath,
          payload: payload(result)
        }
      });
      return result;
    });
  }

  private async entity(entityId: string) {
    const entity = await this.database.prisma.businessEntity.findUnique({
      where: { id: entityId },
      select: { id: true, parentId: true, path: true, entityType: true, isActive: true }
    });
    if (!entity || !entity.isActive) {
      throw new CatalogError(404, "NOT_FOUND", "Catalog resource not found");
    }
    return entity;
  }

  private async tenantRootId(path: string): Promise<string | null> {
    const prefixes = pathPrefixes(path);
    const organizations = await this.database.prisma.businessEntity.findMany({
      where: {
        entityType: { in: ["ORGANIZATION", "SUB_ACCOUNT"] },
        path: { in: prefixes }
      },
      select: { id: true, path: true }
    });
    const root = organizations.reduce<(typeof organizations)[number] | null>((earliest, organization) => {
      if (!earliest) return organization;
      return prefixes.indexOf(organization.path) < prefixes.indexOf(earliest.path)
        ? organization
        : earliest;
    }, null);
    return root?.id ?? null;
  }

  async listPlaylists(context: InternalAuthContext) {
    const actor = requireContext(context);
    requireSuperAdmin(actor);
    return this.database.prisma.playlist.findMany({
      include: { _count: { select: { tracks: true } } },
      orderBy: [{ plays: "desc" }, { id: "asc" }],
      take: 100
    });
  }

  async getTrackAnalyticsScope(context: InternalAuthContext, trackId: string) {
    const track = await this.database.prisma.track.findUnique({ where: { id: trackId }, include: { release: { include: { owner: true, tenant: true } } } });
    if (!track) throw new CatalogError(404, "NOT_FOUND", "Track not found");
    await this.releaseForAccess(context, track.releaseId);
    return { trackId: track.id, trackTitle: track.title, tenantId: track.release.tenantId, entityPath: track.release.owner.path };
  }

  async createPlaylist(context: InternalAuthContext, input: { name: string; platform: string; coverUrl?: string; followers?: number; plays?: number; color?: string; externalId?: string }) {
    const actor = requireContext(context);
    requireSuperAdmin(actor);
    return this.withEvent(
      context,
      "catalog.playlist.created",
      transaction => transaction.playlist.create({ data: input }),
      result => ({ playlistId: result.id, platform: result.platform })
    );
  }

  async assertScope(context: InternalAuthContext, entityId: string) {
    const actor = requireContext(context);
    const target = await this.entity(entityId);
    const signedTenant = actor.tenantId === target.id;
    if (!signedTenant && !allowedPath(target.path, actor.entityPath)) {
      throw new CatalogError(404, "NOT_FOUND", "Catalog resource not found");
    }
    return actor;
  }

  private async assertReferenceTenant(
    model: "label" | "artist" | "composition",
    id: string,
    tenantId: string
  ): Promise<void> {
    const result = model === "label"
      ? await this.database.prisma.label.findUnique({ where: { id }, select: { tenantId: true } })
      : model === "artist"
        ? await this.database.prisma.artist.findUnique({ where: { id }, select: { tenantId: true } })
        : await this.database.prisma.composition.findUnique({ where: { id }, select: { tenantId: true } });
    if (!result || result.tenantId !== tenantId) {
      throw new CatalogError(404, "NOT_FOUND", "Catalog resource not found");
    }
  }

  private async hasSubAccountLabelAccess(actor: Context, labelId: string): Promise<boolean> {
    if (actor.entityType !== "SUB_ACCOUNT" || !actor.tenantId) return true;
    return (await this.database.prisma.subAccountLabelAccess.count({
      where: { tenantId: actor.tenantId, subAccountId: actor.entityId, labelId }
    })) > 0;
  }

  private subAccountReleaseScope(actor: Context): Prisma.ReleaseWhereInput {
    const grant = { some: { tenantId: actor.tenantId!, subAccountId: actor.entityId } };
    const assignedArtist = { label: { subAccountAccess: grant } };
    return {
      ownerId: actor.entityId,
      tenantId: actor.tenantId!,
      label: { subAccountAccess: grant },
      AND: [
        { OR: [{ artistId: null }, { artist: assignedArtist }] },
        { tracks: { every: { OR: [{ artistId: null }, { artist: assignedArtist }] } } }
      ]
    };
  }

  private async assertReferenceAccess(
    context: InternalAuthContext,
    model: "label" | "artist" | "composition",
    id: string,
    tenantId: string
  ): Promise<void> {
    const actor = requireContext(context);
    if (model === "composition") {
      const composition = await this.database.prisma.composition.findUnique({
        where: { id },
        include: {
          tenant: { select: { path: true, isActive: true } },
          owner: { select: { path: true } }
        }
      });
      const ownerPath = composition?.owner?.path ?? composition?.tenant.path;
      const accessible = composition &&
        composition.tenantId === tenantId &&
        composition.tenant.isActive &&
        (
          composition.ownerId === actor.entityId ||
          (actor.entityType === "ORGANIZATION" && !!ownerPath && allowedPath(ownerPath, actor.entityPath)) ||
          (!["SUB_ACCOUNT", "ORGANIZATION"].includes(actor.entityType) && allowedPath(composition.tenant.path, actor.entityPath))
        );
      if (!accessible) {
        throw new CatalogError(404, "NOT_FOUND", "Catalog resource not found");
      }
      return;
    }
    if (model === "label") {
      await this.assertReferenceTenant(model, id, tenantId);
      if (!(await this.hasSubAccountLabelAccess(actor, id))) {
        throw new CatalogError(404, "NOT_FOUND", "Catalog resource not found");
      }
      return;
    }
    const artist = await this.database.prisma.artist.findUnique({
      where: { id },
      select: { tenantId: true, labelId: true }
    });
    if (!artist || artist.tenantId !== tenantId || (actor.entityType === "SUB_ACCOUNT" && (!artist.labelId || !(await this.hasSubAccountLabelAccess(actor, artist.labelId))))) {
      throw new CatalogError(404, "NOT_FOUND", "Catalog resource not found");
    }
  }

  private async releaseForAccess(context: InternalAuthContext, id: string) {
    const actor = requireContext(context);
    const release = await this.database.prisma.release.findUnique({
      where: { id },
      include: { tenant: { select: { path: true, isActive: true } }, owner: { select: { path: true, entityType: true } } }
    });
    if (!release?.tenant.isActive) {
      throw new CatalogError(404, "NOT_FOUND", "Catalog resource not found");
    }
    const ownerAccess = release?.ownerId === actor.entityId;
    const ownerPath = release?.owner?.path ?? release?.tenant.path;
    const subtreeAccess = release?.tenant.isActive && (
      actor.entityType === "ORGANIZATION"
        ? release.tenantId === catalogTenantId(actor) && !!ownerPath && allowedPath(ownerPath, actor.entityPath)
        : actor.entityType === "SUPER_ADMIN" || (actor.entityType === "SYSTEM_ADMIN" && allowedPath(release.tenant.path, actor.entityPath))
    );
    const assignedLabelAccess = release && actor.entityType === "SUB_ACCOUNT" && ownerAccess && !!release.labelId
      ? await this.hasSubAccountLabelAccess(actor, release.labelId)
      : false;
    if (!release || (!subtreeAccess && !assignedLabelAccess)) {
      throw new CatalogError(404, "NOT_FOUND", "Catalog resource not found");
    }
    if (actor.entityType === "SUB_ACCOUNT") {
      if (release.artistId) await this.assertReferenceAccess(context, "artist", release.artistId, release.tenantId);
      const trackArtists = await this.database.prisma.track.findMany({
        where: { releaseId: release.id, artistId: { not: null } },
        select: { artistId: true }
      });
      for (const track of trackArtists) {
        if (track.artistId) await this.assertReferenceAccess(context, "artist", track.artistId, release.tenantId);
      }
    }
    return release;
  }

  async listEntities(context: InternalAuthContext) {
    const actor = requireContext(context);
    const entities = await this.database.prisma.businessEntity.findMany({
      where: { isActive: true, ...pathScope(actor.entityPath) },
      include: {
        _count: { select: { children: true, labels: true, releases: true } }
      },
      orderBy: { path: "asc" },
      take: 500
    });
    const cache = new Map(entities.map(entity => [entity.id, entity]));
    const result = [];
    for (const entity of entities) {
      result.push({ ...entity, businessLevel: await this.businessLevel(entity.id, cache) });
    }
    return result;
  }

  // Levels describe businesses, not users or catalog labels/artists. The
  // singleton platform owner is outside the four-level business hierarchy.
  private async businessLevel(
    id: string,
    cache = new Map<string, { id: string; parentId: string | null; entityType: string; isActive: boolean; businessTier?: string | null }>()
  ): Promise<number | null> {
    const nodes: Array<{ entityType: string; businessTier?: string | null }> = [];
    const visited = new Set<string>();
    let currentId: string | null = id;
    while (currentId !== null) {
      if (visited.has(currentId) || visited.size >= 5) return null;
      visited.add(currentId);
      let current = cache.get(currentId);
      if (!current) {
        current = await this.database.prisma.businessEntity.findUnique({
          where: { id: currentId },
          select: { id: true, parentId: true, entityType: true, isActive: true, businessTier: true }
        }) ?? undefined;
        if (current) cache.set(currentId, current);
      }
      if (!current?.isActive) return null;
      nodes.unshift(current);
      currentId = current.parentId;
    }
    if (nodes[0]?.entityType !== "SUPER_ADMIN" || nodes[0].businessTier != null) return null;
    let rank = 0;
    for (const node of nodes.slice(1)) {
      // Legacy NULLs retain deterministic classification; explicit tiers never
      // fall back to depth if corrupt or incompatible with the entity type.
      const tier = node.businessTier ?? (
        node.entityType === "SYSTEM_ADMIN" ? "BEALPHA"
          : node.entityType === "SUB_ACCOUNT" && (rank === 2 || rank === 3) ? "ARTIST"
            : node.entityType === "ORGANIZATION" && rank === 1 ? "DISTRIBUTOR"
              : node.entityType === "ORGANIZATION" && rank === 2 ? "LABEL" : null
      );
      const next = tier === "BEALPHA" && node.entityType === "SYSTEM_ADMIN" ? 1
        : tier === "DISTRIBUTOR" && node.entityType === "ORGANIZATION" ? 2
          : tier === "LABEL" && node.entityType === "ORGANIZATION" ? 3
            : tier === "ARTIST" && node.entityType === "SUB_ACCOUNT" ? 4 : null;
      if (next === null || next <= rank || (rank === 0 && next !== 1)) return null;
      rank = next;
    }
    return rank;
  }

  async createEntity(
    context: InternalAuthContext,
    input: {
      parentId: string;
      entityType: "SYSTEM_ADMIN" | "ORGANIZATION" | "SUB_ACCOUNT";
      businessTier?: BusinessTier;
      officialName: string;
      description?: string;
      metadata?: Record<string, string>;
    }
  ) {
    const actor = requireContext(context);
    requireManager(actor);
    const parent = await this.entity(input.parentId);
    if (!allowedPath(parent.path, actor.entityPath)) {
      throw new CatalogError(404, "NOT_FOUND", "Catalog resource not found");
    }
    const level = await this.businessLevel(parent.id);
    const businessTier = input.businessTier ?? (
      input.entityType === "SYSTEM_ADMIN" ? "BEALPHA"
        : input.entityType === "SUB_ACCOUNT" ? "ARTIST"
          : level === 1 ? "DISTRIBUTOR" : "LABEL"
    );
    const childLevel = businessTier === "BEALPHA" && input.entityType === "SYSTEM_ADMIN" ? 1
      : businessTier === "DISTRIBUTOR" && input.entityType === "ORGANIZATION" ? 2
        : businessTier === "LABEL" && input.entityType === "ORGANIZATION" ? 3
          : businessTier === "ARTIST" && input.entityType === "SUB_ACCOUNT" ? 4 : null;
    if (level === null || childLevel === null || childLevel <= level || (level === 0 && childLevel !== 1)) {
      throw new CatalogError(409, "INVALID_ENTITY_TREE", "Create only a lower business tier under an authorized parent");
    }
    const id = randomUUID();
    const tenantId = childLevel > 1 && parent.entityType === "SYSTEM_ADMIN"
      ? id
      : input.entityType === "ORGANIZATION" || input.entityType === "SUB_ACCOUNT"
        ? await this.tenantRootId(parent.path)
        : null;
    if ((input.entityType === "ORGANIZATION" || input.entityType === "SUB_ACCOUNT") && !tenantId) {
      throw new CatalogError(409, "INVALID_ENTITY_TREE", "Organization tenant root not found");
    }
    const created = await this.withEvent(
      context,
      "catalog.entity.created",
      transaction => transaction.businessEntity.create({
        data: {
          id,
          parentId: parent.id,
          entityType: input.entityType,
          businessTier,
          officialName: input.officialName,
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
          path: `${parent.path}.e_${id.replaceAll("-", "_")}`
        }
      }),
      result => ({
        id: result.id,
        entityType: result.entityType,
        ...(result.businessTier === undefined ? {} : { businessTier: result.businessTier }),
        name: result.officialName,
        path: result.path,
        tenantId: result.entityType === "ORGANIZATION" || result.entityType === "SUB_ACCOUNT"
          ? tenantId
          : null,
        isActive: result.isActive,
        version: result.version
      })
    );
    return { ...created, entityId: created.id };
  }

  async updateEntity(
    context: InternalAuthContext,
    id: string,
    input: { officialName?: string; description?: string | null; metadata?: Record<string, string> | null; isActive?: boolean }
  ) {
    const actor = requireContext(context);
    const target = await this.entity(id);
    if (!allowedPath(target.path, actor.entityPath)) {
      throw new CatalogError(404, "NOT_FOUND", "Catalog resource not found");
    }
    requireManager(actor);
    const tenantId = target.entityType === "ORGANIZATION" || target.entityType === "SUB_ACCOUNT"
      ? await this.tenantRootId(target.path)
      : null;
    if ((target.entityType === "ORGANIZATION" || target.entityType === "SUB_ACCOUNT") && !tenantId) {
      throw new CatalogError(409, "INVALID_ENTITY_TREE", "Organization tenant root not found");
    }
    const { metadata, ...rest } = input;
    const data = {
      ...rest,
      ...(metadata === undefined
        ? {}
        : { metadata: metadata === null ? Prisma.DbNull : metadata })
    };
    return this.withEvent(
      context,
      "catalog.entity.updated",
      transaction => transaction.businessEntity.update({
        where: { id },
        data: { ...data, version: { increment: 1 } }
      }),
      result => ({
        id: result.id,
        entityType: result.entityType,
        ...(result.businessTier === undefined ? {} : { businessTier: result.businessTier }),
        name: result.officialName,
        path: result.path,
        tenantId: result.entityType === "ORGANIZATION" || result.entityType === "SUB_ACCOUNT"
          ? tenantId
          : null,
        isActive: result.isActive,
        version: result.version
      })
    );
  }

  async listLabels(context: InternalAuthContext) {
    const actor = requireContext(context);
    const where = actor.entityType === "SUB_ACCOUNT" && actor.tenantId
      ? { tenantId: actor.tenantId, subAccountAccess: { some: { subAccountId: actor.entityId, tenantId: actor.tenantId } } }
      : actor.entityType === "ORGANIZATION"
        ? { tenantId: catalogTenantId(actor) }
        : { tenant: pathScope(actor.entityPath) };
    const labels = await this.database.prisma.label.findMany({
      where,
      include: { _count: { select: { artists: true, releases: true } } },
      orderBy: { name: "asc" },
      take: 100
    });
    return labels.map(({ _count, ...label }) => ({
      ...label,
      artistCount: _count.artists,
      releaseCount: _count.releases
    }));
  }

  async listSubAccountLabelAccess(context: InternalAuthContext, subAccountId: string) {
    const actor = requireContext(context);
    requireManager(actor);
    if (actor.entityType !== "ORGANIZATION") throw new CatalogError(403, "FORBIDDEN", "Organization manager required");
    const target = await this.entity(subAccountId);
    if (target.entityType !== "SUB_ACCOUNT" || target.parentId !== actor.entityId) throw new CatalogError(404, "NOT_FOUND", "Catalog resource not found");
    const tenantId = catalogTenantId(actor);
    const grants = await this.database.prisma.subAccountLabelAccess.findMany({
      where: { tenantId, subAccountId },
      select: { labelId: true },
      orderBy: { createdAt: "asc" }
    });
    return { subAccountId, labelIds: grants.map(grant => grant.labelId) };
  }

  async replaceSubAccountLabelAccess(context: InternalAuthContext, subAccountId: string, requestedLabelIds: string[]) {
    const actor = requireContext(context);
    requireManager(actor);
    if (actor.entityType !== "ORGANIZATION") throw new CatalogError(403, "FORBIDDEN", "Organization manager required");
    const target = await this.entity(subAccountId);
    if (target.entityType !== "SUB_ACCOUNT" || target.parentId !== actor.entityId) throw new CatalogError(404, "NOT_FOUND", "Catalog resource not found");
    const tenantId = catalogTenantId(actor);
    const labelIds = [...new Set(requestedLabelIds)];
    const labels = labelIds.length === 0 ? [] : await this.database.prisma.label.findMany({
      where: { id: { in: labelIds }, tenantId },
      select: { id: true, tenantId: true }
    });
    if (labels.length !== labelIds.length) throw new CatalogError(404, "NOT_FOUND", "Catalog resource not found");
    return this.withEvent(
      context,
      "catalog.sub-account-label-access.replaced",
      async transaction => {
        await transaction.subAccountLabelAccess.deleteMany({ where: { tenantId, subAccountId } });
        if (labelIds.length > 0) {
          await transaction.subAccountLabelAccess.createMany({ data: labelIds.map(labelId => ({ tenantId, subAccountId, labelId })) });
        }
        return { subAccountId, labelIds };
      },
      result => ({ tenantId, subAccountId: result.subAccountId, labelIds: result.labelIds })
    );
  }

  async createLabel(
    context: InternalAuthContext,
    input: {
      name: string;
      tenantId?: string;
      description?: string;
      dpid?: string;
      ddexPartyName?: string;
      logoUrl?: string;
    }
  ) {
    const actor = requireContext(context);
    requireManager(actor);
    if (actor.entityType === "SUB_ACCOUNT") {
      throw new CatalogError(403, "FORBIDDEN", "Sub-accounts cannot create labels");
    }
    const tenantId = input.tenantId ?? (actor.entityType === "SUPER_ADMIN" ? undefined : catalogTenantId(actor));
    if (!tenantId) throw new CatalogError(400, "VALIDATION_ERROR", "Organization tenant is required");
    if (actor.entityType === "ORGANIZATION" && tenantId !== catalogTenantId(actor)) {
      throw new CatalogError(404, "NOT_FOUND", "Catalog resource not found");
    }
    const tenant = await this.entity(tenantId);
    const tenantInActorScope = actor.entityType === "ORGANIZATION"
      ? tenantId === catalogTenantId(actor)
      : allowedPath(tenant.path, actor.entityPath);
    if (tenant.entityType !== "ORGANIZATION" || !tenant.isActive || !tenantInActorScope) {
      throw new CatalogError(404, "NOT_FOUND", "Catalog resource not found");
    }
    const { tenantId: _requestedTenantId, ...labelInput } = input;
    return this.withEvent(context, "catalog.label.created", transaction => transaction.label.create({ data: { tenantId, ...labelInput } }), result => ({ labelId: result.id, tenantId: result.tenantId }));
  }

  async getLabel(context: InternalAuthContext, id: string) {
    const actor = requireContext(context);
    const label = await this.database.prisma.label.findUnique({
      where: { id },
      include: { tenant: { select: { path: true } } }
    });
    const accessible = label && (
      (actor.entityType === "SUB_ACCOUNT" && label.tenantId === actor.tenantId && await this.hasSubAccountLabelAccess(actor, label.id)) ||
      (actor.entityType === "ORGANIZATION" && label.tenantId === catalogTenantId(actor)) ||
      (!["SUB_ACCOUNT", "ORGANIZATION"].includes(actor.entityType) && allowedPath(label.tenant.path, actor.entityPath))
    );
    if (!accessible) throw new CatalogError(404, "NOT_FOUND", "Catalog resource not found");
    return label;
  }

  async updateLabel(context: InternalAuthContext, id: string, input: { name?: string; description?: string | null; dpid?: string | null; ddexPartyName?: string | null; logoUrl?: string | null }) {
    const actor = requireContext(context);
    requireManager(actor);
    await this.getLabel(context, id);
    if (actor.entityType === "SUB_ACCOUNT") throw new CatalogError(403, "FORBIDDEN", "Sub-accounts cannot update labels");
    return this.withEvent(context, "catalog.label.updated", transaction => transaction.label.update({ where: { id }, data: input }), result => ({ labelId: result.id, tenantId: result.tenantId }));
  }

  async deleteLabel(context: InternalAuthContext, id: string) {
    const actor = requireContext(context);
    requireManager(actor);
    await this.getLabel(context, id);
    if (actor.entityType === "SUB_ACCOUNT") throw new CatalogError(403, "FORBIDDEN", "Sub-accounts cannot delete labels");
    await this.withEvent(context, "catalog.label.deleted", transaction => transaction.label.delete({ where: { id } }), result => ({ labelId: result.id, tenantId: result.tenantId }));
  }

  async listArtists(context: InternalAuthContext) {
    const actor = requireContext(context);
    const where = actor.entityType === "SUB_ACCOUNT" && actor.tenantId
      ? { tenantId: actor.tenantId, label: { subAccountAccess: { some: { subAccountId: actor.entityId, tenantId: actor.tenantId } } } }
      : actor.entityType === "ORGANIZATION"
        ? { tenantId: catalogTenantId(actor) }
        : { tenant: pathScope(actor.entityPath) };
    const artists = await this.database.prisma.artist.findMany({
      where,
      include: {
        label: { select: { id: true, name: true } },
        _count: { select: { releases: true, tracks: true } }
      },
      orderBy: { name: "asc" },
      take: 100
    });
    return artists.map(({ _count, ...artist }) => ({
      ...artist,
      labelName: artist.label?.name ?? "",
      releaseCount: _count.releases,
      trackCount: _count.tracks
    }));
  }

  async createArtist(
    context: InternalAuthContext,
    input: {
      name: string;
      bio?: string;
      spotifyId?: string;
      appleMusicId?: string;
      vevoChannel?: string;
      vevoBio?: string;
      vevoBannerUrl?: string;
      labelId?: string;
      isni?: string;
      ipi?: string;
      dpid?: string;
      imageUrl?: string;
    }
  ) {
    const actor = requireContext(context);
    requireManager(actor);
    if (actor.entityType !== "ORGANIZATION") {
      throw new CatalogError(403, "FORBIDDEN", "Organization managers create artists");
    }
    if (input.labelId) {
      await this.assertReferenceTenant("label", input.labelId, catalogTenantId(actor));
    }
    const tenantId = catalogTenantId(actor);
    return this.withEvent(context, "catalog.artist.created", transaction => transaction.artist.create({ data: { tenantId, ...input } }), result => ({ artistId: result.id, tenantId: result.tenantId }));
  }

  async getArtist(context: InternalAuthContext, id: string) {
    const actor = requireContext(context);
    const artist = await this.database.prisma.artist.findUnique({ where: { id }, include: { tenant: { select: { path: true } } } });
    const accessible = artist && (
      (actor.entityType === "SUB_ACCOUNT" && artist.tenantId === actor.tenantId && !!artist.labelId && await this.hasSubAccountLabelAccess(actor, artist.labelId)) ||
      (actor.entityType === "ORGANIZATION" && artist.tenantId === catalogTenantId(actor)) ||
      (!["SUB_ACCOUNT", "ORGANIZATION"].includes(actor.entityType) && allowedPath(artist.tenant.path, actor.entityPath))
    );
    if (!accessible) throw new CatalogError(404, "NOT_FOUND", "Catalog resource not found");
    return artist;
  }

  async updateArtist(context: InternalAuthContext, id: string, input: { name?: string; bio?: string | null; spotifyId?: string | null; appleMusicId?: string | null; vevoChannel?: string | null; vevoBio?: string | null; vevoBannerUrl?: string | null; labelId?: string | null; isni?: string | null; ipi?: string | null; dpid?: string | null; imageUrl?: string | null }) {
    const actor = requireContext(context);
    requireManager(actor);
    const artist = await this.getArtist(context, id);
    if (actor.entityType === "SUB_ACCOUNT") throw new CatalogError(403, "FORBIDDEN", "Sub-accounts cannot update artists");
    if (input.labelId) await this.assertReferenceTenant("label", input.labelId, artist.tenantId);
    return this.withEvent(context, "catalog.artist.updated", transaction => transaction.artist.update({ where: { id }, data: input }), result => ({ artistId: result.id, tenantId: result.tenantId }));
  }

  async deleteArtist(context: InternalAuthContext, id: string) {
    const actor = requireContext(context);
    requireManager(actor);
    await this.getArtist(context, id);
    if (actor.entityType === "SUB_ACCOUNT") throw new CatalogError(403, "FORBIDDEN", "Sub-accounts cannot delete artists");
    await this.withEvent(context, "catalog.artist.deleted", transaction => transaction.artist.delete({ where: { id } }), result => ({ artistId: result.id, tenantId: result.tenantId }));
  }

  async listReleases(context: InternalAuthContext, filter: { entityId?: string; status?: ReleaseStatus; limit?: number; workQueue?: boolean } = {}) {
    const actor = requireContext(context);
    let scope: Prisma.ReleaseWhereInput;
    if (filter.entityId) {
      const target = await this.entity(filter.entityId);
      const targetIsActor = target.id === actor.entityId;
      const targetIsRootTenant = actor.tenantId !== undefined && target.id === actor.tenantId;
      const targetIsDescendant = allowedPath(target.path, actor.entityPath);

      // A tenant claim identifies the catalog boundary, not the actor's
      // organization subtree. Never let a nested organization or sub-account
      // turn a root-tenant filter into an unrestricted release query.
      if (actor.entityType === "SUB_ACCOUNT") {
        if (!targetIsActor && !targetIsRootTenant) {
          throw new CatalogError(404, "NOT_FOUND", "Catalog resource not found");
        }
        scope = this.subAccountReleaseScope(actor);
      } else if (targetIsActor || targetIsRootTenant) {
        scope = actor.entityType === "ORGANIZATION"
          ? { tenantId: catalogTenantId(actor), owner: pathScope(actor.entityPath) }
          : actor.entityType === "SYSTEM_ADMIN" || actor.entityType === "SUPER_ADMIN"
            ? { tenant: pathScope(actor.entityPath) }
            : { tenantId: catalogTenantId(actor), owner: pathScope(actor.entityPath) };
      } else {
        if (!targetIsDescendant) throw new CatalogError(404, "NOT_FOUND", "Catalog resource not found");
        scope = target.entityType === "SUB_ACCOUNT"
          ? { ownerId: target.id }
          : target.entityType === "ORGANIZATION"
            ? { tenantId: await this.tenantRootId(target.path) ?? target.id, owner: pathScope(target.path) }
            : { tenant: pathScope(target.path) };
      }
    } else {
      scope = actor.entityType === "SUB_ACCOUNT" && actor.tenantId
        ? this.subAccountReleaseScope(actor)
        : actor.entityType === "ORGANIZATION"
          ? { tenantId: catalogTenantId(actor), owner: pathScope(actor.entityPath) }
          : { tenant: pathScope(actor.entityPath) };
    }
    let where: Prisma.ReleaseWhereInput = { ...scope, ...(filter.status ? { status: filter.status } : {}) };
    if (filter.workQueue) {
      const work: Prisma.ReleaseWhereInput[] = [];
      const role = actor.entityRole ?? "";
      if (actor.entityType === "SUB_ACCOUNT" ? role === "OWNER" : ["OWNER", "ADMIN", "MEMBER"].includes(role)) {
        work.push({ status: { in: [...editableStatuses] } });
      }
      if (["OWNER", "ADMIN", "REVIEWER"].includes(role)) {
        if (actor.entityType === "ORGANIZATION") {
          work.push({
            status: "PENDING_ORG_APPROVAL",
            OR: [
              { ownerId: actor.entityId },
              { owner: { entityType: "SUB_ACCOUNT", parentId: actor.entityId } }
            ]
          });
        } else if (actor.entityType === "SYSTEM_ADMIN") {
          work.push({ status: "PENDING_SYS_APPROVAL" });
        } else if (actor.entityType === "SUPER_ADMIN") {
          work.push({ status: "PENDING_SUPER_APPROVAL" });
        }
      }
      // Intersect, never replace, the existing tenant/branch restrictions.
      // Apply before LIMIT so unrelated recent releases cannot hide work.
      where = { AND: [where, { OR: work }] };
    }
    return this.database.prisma.release.findMany({
      where,
      include: { tracks: true, artist: true, label: true },
      orderBy: { createdAt: "desc" },
      take: filter.limit ?? 100
    });
  }

  async createRelease(
    context: InternalAuthContext,
    input: {
      title: string;
      ean?: string;
      type?: "AUDIO" | "VIDEO";
      format?: "SINGLE" | "EP" | "ALBUM" | "COMPILATION";
      genre?: string;
      releaseDate: Date;
      displayArtist?: string;
      coverUrl?: string;
      artistId?: string;
      labelId?: string;
    }
  ) {
    const actor = requireContext(context);
    requireReleaseEditor(actor);
    const tenantId = catalogTenantId(actor);
    await this.assertScope(context, tenantId);
    if (input.artistId) {
      await this.assertReferenceAccess(context, "artist", input.artistId, tenantId);
    }
    if (input.labelId) {
      await this.assertReferenceAccess(context, "label", input.labelId, tenantId);
    } else if (actor.entityType === "SUB_ACCOUNT") {
      throw new CatalogError(404, "NOT_FOUND", "An assigned label is required");
    }
    return this.withEvent(context, "catalog.release.created", transaction => transaction.release.create({ data: { ...input, tenantId, ownerId: actor.entityId } }), result => ({ releaseId: result.id, tenantId: result.tenantId, ownerId: result.ownerId }));
  }

  private async validateDraftReferences(context: InternalAuthContext, tenantId: string, input: ReleaseDraftInput): Promise<void> {
    const actor = requireContext(context);
    const artistIds = new Set(input.tracks.map(track => track.artistId).filter((id): id is string => Boolean(id)));
    if (input.artistId) artistIds.add(input.artistId);
    for (const artistId of artistIds) await this.assertReferenceAccess(context, "artist", artistId, tenantId);
    if (input.labelId) await this.assertReferenceAccess(context, "label", input.labelId, tenantId);
    else if (actor.entityType === "SUB_ACCOUNT") throw new CatalogError(404, "NOT_FOUND", "An assigned label is required");
    const compositionIds = new Set(input.tracks.map(track => track.compositionId).filter((id): id is string => Boolean(id)));
    for (const compositionId of compositionIds) await this.assertReferenceAccess(context, "composition", compositionId, tenantId);
  }

  async createReleaseDraft(context: InternalAuthContext, input: ReleaseDraftInput) {
    const actor = requireContext(context);
    requireReleaseEditor(actor);
    const tenantId = catalogTenantId(actor);
    await this.assertScope(context, tenantId);
    await this.validateDraftReferences(context, tenantId, input);
    const { tracks, ...release } = input;
    return this.withEvent(
      context,
      "catalog.release.created",
      transaction => transaction.release.create({
        data: {
          ...release,
          tenantId,
          ownerId: actor.entityId,
          tracks: { create: tracks.map(({ id: _id, ...track }) => track) },
        },
        include: { tracks: { orderBy: [{ discNumber: "asc" }, { trackNumber: "asc" }] } },
      }),
      result => ({ releaseId: result.id, tenantId: result.tenantId, ownerId: result.ownerId }),
    );
  }

  async updateReleaseDraft(context: InternalAuthContext, id: string, input: ReleaseDraftInput) {
    const actor = requireContext(context);
    requireReleaseEditor(actor);
    const current = await this.releaseForAccess(context, id);
    requireEditableRelease(current.status);
    await this.validateDraftReferences(context, current.tenantId, input);
    const existingTracks = await this.database.prisma.track.findMany({ where: { releaseId: id }, select: { id: true } });
    const existingIds = new Set(existingTracks.map(track => track.id));
    const suppliedIds = input.tracks.map(track => track.id).filter((trackId): trackId is string => Boolean(trackId));
    if (suppliedIds.some(trackId => !existingIds.has(trackId))) throw new CatalogError(404, "NOT_FOUND", "Track is outside release scope");
    const { tracks, ...release } = input;
    return this.withEvent(
      context,
      "catalog.release.updated",
      async transaction => {
        await transaction.release.update({ where: { id }, data: { ...release, ...resetRejectedStatus(current.status) } });
        await transaction.track.deleteMany({ where: { releaseId: id, ...(suppliedIds.length > 0 ? { id: { notIn: suppliedIds } } : {}) } });
        for (const track of tracks) {
          const { id: trackId, ...data } = track;
          if (trackId) await transaction.track.update({ where: { id: trackId }, data });
          else await transaction.track.create({ data: { releaseId: id, ...data } });
        }
        return transaction.release.findUniqueOrThrow({ where: { id }, include: { tracks: { orderBy: [{ discNumber: "asc" }, { trackNumber: "asc" }] } } });
      },
      result => ({ releaseId: result.id, tenantId: result.tenantId, status: result.status }),
    );
  }

  async getRelease(context: InternalAuthContext, id: string) {
    return this.releaseForAccess(context, id);
  }

  async getDistributionSnapshot(context: InternalAuthContext, id: string) {
    await this.releaseForAccess(context, id);
    const release = await this.database.prisma.release.findUnique({
      where: { id },
      include: {
        artist: true,
        label: true,
        owner: { select: { path: true } },
        tracks: {
          include: { artist: true, composition: true },
          orderBy: [{ discNumber: "asc" }, { trackNumber: "asc" }]
        }
      }
    });
    if (!release) throw new CatalogError(404, "NOT_FOUND", "Catalog resource not found");
    return release;
  }

  async getExportSnapshot(context: InternalAuthContext, releaseId?: string) {
    const actor = requireContext(context);
    if (releaseId) return [await this.getDistributionSnapshot(context, releaseId)];
    const scope = actor.entityType === "SUB_ACCOUNT" && actor.tenantId
      ? this.subAccountReleaseScope(actor)
      : actor.entityType === "ORGANIZATION"
        ? { tenantId: catalogTenantId(actor), owner: pathScope(actor.entityPath) }
        : { tenant: pathScope(actor.entityPath) };
    const releases = await this.database.prisma.release.findMany({
      where: scope,
      include: {
        artist: true,
        label: true,
        tracks: {
          include: { artist: true, composition: true },
          orderBy: [{ discNumber: "asc" }, { trackNumber: "asc" }],
        },
      },
      orderBy: { createdAt: "desc" },
      take: 10000,
    });
    const trackCount = releases.reduce((sum, release) => sum + release.tracks.length, 0);
    if (trackCount > 10000) {
      throw new CatalogError(413, "EXPORT_TOO_LARGE", "Catalog export exceeds 10000 tracks");
    }
    return releases;
  }

  async updateRelease(
    context: InternalAuthContext,
    id: string,
    input: {
      title?: string;
      ean?: string | null;
      genre?: string | null;
      releaseDate?: Date;
      displayArtist?: string | null;
      coverUrl?: string | null;
      artistId?: string | null;
      labelId?: string | null;
    }
  ) {
    const actor = requireContext(context);
    requireReleaseEditor(actor);
    const release = await this.releaseForAccess(context, id);
    if (
      lockedStatuses.has(release.status) &&
      input.ean !== undefined &&
      input.ean !== release.ean
    ) {
      throw new CatalogError(
        409,
        "IDENTIFIER_LOCKED",
        "UPC/EAN is immutable after delivery lock"
      );
    }
    requireEditableRelease(release.status);
    if (input.artistId) {
      await this.assertReferenceAccess(context, "artist", input.artistId, release.tenantId);
    }
    if (input.labelId) {
      await this.assertReferenceAccess(context, "label", input.labelId, release.tenantId);
    } else if (input.labelId === null && actor.entityType === "SUB_ACCOUNT") {
      throw new CatalogError(404, "NOT_FOUND", "An assigned label is required");
    }
    return this.withEvent(context, "catalog.release.updated", transaction => transaction.release.update({ where: { id }, data: { ...input, ...resetRejectedStatus(release.status) } }), result => ({ releaseId: result.id, tenantId: result.tenantId, status: result.status }));
  }

  async deleteRelease(context: InternalAuthContext, id: string) {
    const actor = requireContext(context);
    requireReleaseDeleter(actor);
    const release = await this.releaseForAccess(context, id);
    requireEditableRelease(release.status);
    await this.withEvent(context, "catalog.release.deleted", transaction => transaction.release.delete({ where: { id } }), result => ({ releaseId: result.id, tenantId: result.tenantId }));
  }

  async submitRelease(context: InternalAuthContext, id: string, options: { vevoValidated?: boolean; expectedUpdatedAt?: Date; targetDsps?: string[] } = {}) {
    const actor = requireContext(context);
    requireReleaseSubmitter(actor);
    const release = await this.releaseForAccess(context, id);
    if (actor.entityType === "SUB_ACCOUNT" && release.ownerId !== actor.entityId) {
      throw new CatalogError(403, "FORBIDDEN", "Release is outside owner scope");
    }
    if (!["DRAFT", "ORG_REJECTED", "SYS_REJECTED", "SUPER_REJECTED"].includes(release.status)) {
      throw new CatalogError(409, "INVALID_WORKFLOW_STATE", "Release cannot be submitted from current status");
    }
    if (release.type === "VIDEO" && options.vevoValidated !== true) {
      throw new CatalogError(409, "VEVO_VALIDATION_REQUIRED", "VEVO readiness validation is required before submission");
    }
    if (release.type === "VIDEO" && (!options.expectedUpdatedAt || release.updatedAt.getTime() !== options.expectedUpdatedAt.getTime())) {
      throw new CatalogError(409, "RELEASE_CHANGED_REVALIDATE", "Release changed during VEVO validation; validate and submit again");
    }
    const trackCount = await this.database.prisma.track.count({ where: { releaseId: id } });
    if (trackCount === 0) throw new CatalogError(409, "RELEASE_INCOMPLETE", "Release has no tracks");
    if (!release.coverUrl) throw new CatalogError(409, "RELEASE_INCOMPLETE", "Release cover art is required");
    const targetDsps = [...new Set(options.targetDsps ?? [])];
    if (targetDsps.length === 0) throw new CatalogError(400, "DSP_SELECTION_REQUIRED", "Select at least one DSP before submitting for review");
    if (release.type === "AUDIO") {
      const snapshot = await this.database.prisma.release.findUnique({
        where: { id },
        select: {
          ean: true,
          format: true,
          genre: true,
          displayArtist: true,
          metadata: true,
          label: { select: { name: true } },
          tracks: {
            select: { isrc: true, duration: true, audioAssetId: true, discNumber: true, trackNumber: true },
            orderBy: [{ discNumber: "asc" }, { trackNumber: "asc" }]
          }
        }
      });
      if (!snapshot) throw new CatalogError(404, "NOT_FOUND", "Catalog resource not found");
      const metadata = snapshot.metadata && typeof snapshot.metadata === "object" && !Array.isArray(snapshot.metadata)
        ? snapshot.metadata as Prisma.JsonObject
        : {};
      const incompleteRelease = !snapshot.ean || !snapshot.genre?.trim() || !snapshot.displayArtist?.trim() || !snapshot.label?.name.trim()
        || typeof metadata.cLine !== "string" || !metadata.cLine.trim()
        || typeof metadata.pLine !== "string" || !metadata.pLine.trim();
      const assetIds = new Set<string>();
      const isrcs = new Set<string>();
      const positions = new Set<string>();
      const incompleteTracks = snapshot.tracks.some(track => {
        const position = `${track.discNumber}:${track.trackNumber}`;
        const invalid = !track.isrc || !track.audioAssetId || !track.duration || track.duration <= 0
          || isrcs.has(track.isrc) || assetIds.has(track.audioAssetId) || positions.has(position);
        if (track.isrc) isrcs.add(track.isrc);
        if (track.audioAssetId) assetIds.add(track.audioAssetId);
        positions.add(position);
        return invalid;
      });
      if (incompleteRelease || incompleteTracks || (snapshot.format === "SINGLE" && snapshot.tracks.length !== 1)) {
        throw new CatalogError(409, "DDEX_RELEASE_INCOMPLETE", "Complete UPC/EAN, artist, genre, label, C/P lines, and unique ISRC/audio/track metadata before review");
      }
    }
    const existingMetadata = release.metadata && typeof release.metadata === "object" && !Array.isArray(release.metadata)
      ? release.metadata as Prisma.JsonObject
      : {};
    const nextStatus = release.owner?.entityType === "SUB_ACCOUNT" && release.ownerId === release.tenantId
      ? "PENDING_SYS_APPROVAL"
      : "PENDING_ORG_APPROVAL";
    const now = new Date();
    return this.withEvent(
      context,
      "catalog.release.submitted",
      async transaction => {
        const data = { status: nextStatus, metadata: { ...existingMetadata, targetDsps }, ...(release.upcLockedAt ? {} : { upcLockedAt: now }) } as const;
        const updated = release.type === "VIDEO"
          ? await (async () => {
            const changed = await transaction.release.updateMany({ where: { id, updatedAt: options.expectedUpdatedAt }, data });
            if (changed.count !== 1) throw new CatalogError(409, "RELEASE_CHANGED_REVALIDATE", "Release changed during VEVO validation; validate and submit again");
            return transaction.release.findUniqueOrThrow({ where: { id } });
          })()
          : await transaction.release.update({ where: { id }, data });
        await transaction.track.updateMany({
          where: { releaseId: id, isrcLockedAt: null },
          data: { isrcLockedAt: now }
        });
        return updated;
      },
      result => ({ releaseId: result.id, oldStatus: release.status, status: result.status, recipientEntityPath: organizationReviewPath(release) })
    );
  }

  async approveRelease(context: InternalAuthContext, id: string) {
    const actor = requireContext(context);
    requireReviewer(actor);
    const release = await this.releaseForAccess(context, id);
    if (release.status === "APPROVED" && actor.entityType === "SUPER_ADMIN" && actor.entityRole === "OWNER") return release;
    if (!["ORGANIZATION", "SYSTEM_ADMIN", "SUPER_ADMIN"].includes(actor.entityType)) {
      throw new CatalogError(403, "FORBIDDEN", "Approval role required");
    }
    let status: "PENDING_SYS_APPROVAL" | "PENDING_SUPER_APPROVAL" | "APPROVED";
    if (release.status === "PENDING_ORG_APPROVAL" && actor.entityType === "ORGANIZATION") {
      if (actor.entityPath !== organizationReviewPath(release)) {
        throw new CatalogError(403, "FORBIDDEN", "Release belongs to another organization review queue");
      }
      status = "PENDING_SYS_APPROVAL";
    } else if (release.status === "PENDING_SYS_APPROVAL" && actor.entityType === "SYSTEM_ADMIN") {
      status = "PENDING_SUPER_APPROVAL";
    } else if (release.status === "PENDING_SUPER_APPROVAL" && actor.entityType === "SUPER_ADMIN") {
      status = "APPROVED";
    } else {
      throw new CatalogError(409, "INVALID_WORKFLOW_STATE", "Release is not pending approval at actor tier");
    }
    return this.withEvent(
      context,
      "catalog.release.approved",
      transaction => transaction.release.update({ where: { id }, data: { status } }),
      result => ({
        releaseId: result.id,
        releaseType: result.type,
        tenantId: result.tenantId,
        approverEntityId: actor.entityId,
        oldStatus: release.status,
        status: result.status,
        recipientEntityPath: result.status === "PENDING_SYS_APPROVAL"
          ? parentPath(release.tenant.path)
          : result.status === "PENDING_SUPER_APPROVAL"
            ? parentPath(actor.entityPath)
            : release.owner?.path ?? release.tenant.path
      })
    );
  }

  async lockReleaseForDelivery(context: InternalAuthContext, id: string) {
    const actor = requireContext(context);
    requireManager(actor);
    if (actor.entityType !== "SUPER_ADMIN" || actor.entityRole !== "OWNER") {
      throw new CatalogError(403, "FORBIDDEN", "BeAlpha owner role required for delivery lock");
    }
    const release = await this.releaseForAccess(context, id);
    if (release.status === "LOCKED_FOR_DELIVERY") return release;
    if (release.status !== "APPROVED") {
      throw new CatalogError(409, "INVALID_WORKFLOW_STATE", "Release must be approved before delivery lock");
    }
    return this.withEvent(
      context,
      "catalog.release.locked-for-delivery",
      transaction => transaction.release.update({ where: { id }, data: { status: "LOCKED_FOR_DELIVERY" } }),
      result => ({ releaseId: result.id, oldStatus: release.status, status: result.status })
    );
  }

  async denyRelease(context: InternalAuthContext, id: string, reason: string) {
    const actor = requireContext(context);
    requireReviewer(actor);
    const rejectionReason = reason.trim();
    if (rejectionReason.length < 3 || rejectionReason.length > 1000) {
      throw new CatalogError(400, "VALIDATION_ERROR", "A rejection reason is required");
    }
    const release = await this.releaseForAccess(context, id);
    if (!["PENDING_ORG_APPROVAL", "PENDING_SYS_APPROVAL", "PENDING_SUPER_APPROVAL", "SCHEDULED"].includes(release.status)) {
      throw new CatalogError(409, "INVALID_WORKFLOW_STATE", "Release cannot be denied from current status");
    }
    const status = release.status === "PENDING_ORG_APPROVAL" && actor.entityType === "ORGANIZATION"
      ? actor.entityPath === organizationReviewPath(release) ? "ORG_REJECTED" : null
      : release.status === "PENDING_SYS_APPROVAL" && actor.entityType === "SYSTEM_ADMIN"
        ? "SYS_REJECTED"
        : release.status === "PENDING_SUPER_APPROVAL" && actor.entityType === "SUPER_ADMIN"
          ? "SUPER_REJECTED"
          : null;
    if (!status) throw new CatalogError(403, "FORBIDDEN", "Release can only be denied at the actor review tier");
    const recipientEntityPath = actor.entityType === "ORGANIZATION"
      ? release.owner.path
      : actor.entityType === "SYSTEM_ADMIN"
        ? release.tenant.path
        : release.tenant.path.split(".").slice(0, -1).join(".");
    return this.withEvent(
      context,
      "catalog.release.rejected",
      transaction => transaction.release.update({
        where: { id },
        data: {
          status,
          lastRejectionReason: rejectionReason,
          lastRejectedByTier: actor.entityType,
          lastRejectedAt: new Date()
        }
      }),
      result => ({
        releaseId: result.id,
        ownerId: release.ownerId,
        tenantId: release.tenantId,
        oldStatus: release.status,
        status: result.status,
        rejectedByTier: actor.entityType,
        recipientEntityPath,
        reason: rejectionReason
      })
    );
  }

  async createTrack(
    context: InternalAuthContext,
    releaseId: string,
    input: {
      title: string;
      isrc?: string;
      trackNumber?: number;
      discNumber?: number;
      duration?: number;
      artistId?: string;
      audioAssetId?: string;
      videoAssetId?: string;
      thumbnailAssetId?: string;
      captionAssetId?: string;
      captionLanguage?: string;
      canvasAssetId?: string;
      motionAssetId?: string;
      admAssetId?: string;
      compositionId?: string;
      recordingLabelShare?: string;
    }
  ) {
    const actor = requireContext(context);
    requireReleaseEditor(actor);
    const release = await this.releaseForAccess(context, releaseId);
    requireEditableRelease(release.status);
    if (input.artistId) {
      await this.assertReferenceAccess(context, "artist", input.artistId, release.tenantId);
    }
    if (input.compositionId) {
      await this.assertReferenceAccess(context, "composition", input.compositionId, release.tenantId);
    }
    return this.withEvent(context, "catalog.track.scope-upserted", async transaction => {
      if (release.status !== "DRAFT") await transaction.release.update({ where: { id: releaseId }, data: { status: "DRAFT" } });
      return transaction.track.create({ data: { releaseId, ...input } });
    }, result => ({ trackId: result.id, releaseId: result.releaseId, isrc: result.isrc, tenantId: release.tenantId, entityPath: release.owner.path }));
  }

  async updateTrack(
    context: InternalAuthContext,
    id: string,
    input: {
      title?: string;
      isrc?: string | null;
      trackNumber?: number;
      discNumber?: number;
      duration?: number | null;
      artistId?: string | null;
      audioAssetId?: string | null;
      videoAssetId?: string | null;
      thumbnailAssetId?: string | null;
      captionAssetId?: string | null;
      captionLanguage?: string | null;
      canvasAssetId?: string | null;
      motionAssetId?: string | null;
      admAssetId?: string | null;
      compositionId?: string | null;
      recordingLabelShare?: string | null;
    }
  ) {
    const actor = requireContext(context);
    requireReleaseEditor(actor);
    const track = await this.database.prisma.track.findUnique({
      where: { id },
      include: { release: true }
    });
    if (!track) {
      throw new CatalogError(404, "NOT_FOUND", "Catalog resource not found");
    }
    const release = await this.releaseForAccess(context, track.releaseId);
    if (
      lockedStatuses.has(track.release.status) &&
      input.isrc !== undefined &&
      input.isrc !== track.isrc
    ) {
      throw new CatalogError(
        409,
        "IDENTIFIER_LOCKED",
        "ISRC is immutable after delivery lock"
      );
    }
    requireEditableRelease(release.status);
    if (input.artistId) {
      await this.assertReferenceAccess(context, "artist", input.artistId, track.release.tenantId);
    }
    if (input.compositionId) {
      await this.assertReferenceAccess(context, "composition", input.compositionId, track.release.tenantId);
    }
    return this.withEvent(context, "catalog.track.scope-upserted", async transaction => {
      if (release.status !== "DRAFT") await transaction.release.update({ where: { id: release.id }, data: { status: "DRAFT" } });
      return transaction.track.update({ where: { id }, data: input });
    }, result => ({ trackId: result.id, releaseId: result.releaseId, isrc: result.isrc, tenantId: release.tenantId, entityPath: release.owner.path }));
  }

  async getTrack(context: InternalAuthContext, id: string) {
    const track = await this.database.prisma.track.findUnique({ where: { id }, include: { release: true } });
    if (!track) throw new CatalogError(404, "NOT_FOUND", "Catalog resource not found");
    await this.releaseForAccess(context, track.releaseId);
    return track;
  }

  async deleteTrack(context: InternalAuthContext, id: string) {
    const actor = requireContext(context);
    requireReleaseDeleter(actor);
    const track = await this.getTrack(context, id);
    requireEditableRelease(track.release.status);
    await this.withEvent(context, "catalog.track.scope-deleted", async transaction => {
      if (track.release.status !== "DRAFT") await transaction.release.update({ where: { id: track.releaseId }, data: { status: "DRAFT" } });
      return transaction.track.delete({ where: { id } });
    }, result => ({ trackId: result.id, releaseId: result.releaseId, isrc: result.isrc }));
  }

  async listCompositions(context: InternalAuthContext) {
    const actor = requireContext(context);
    const where = actor.entityType === "SUB_ACCOUNT"
      ? { ownerId: actor.entityId }
      : actor.entityType === "ORGANIZATION"
        ? { tenantId: catalogTenantId(actor), owner: pathScope(actor.entityPath) }
        : { tenant: pathScope(actor.entityPath) };
    const compositions = await this.database.prisma.composition.findMany({
      where,
      include: { _count: { select: { tracks: true } } },
      orderBy: { title: "asc" },
      take: 100
    });
    return compositions.map(({ _count, ...composition }) => ({
      ...composition,
      trackCount: _count.tracks
    }));
  }

  async createComposition(context: InternalAuthContext, input: { title: string; subtitle?: string; alternativeTitle?: string; iswc?: string; catalogueNumber?: string; genre?: string; creationDate?: Date; lyricsLanguages?: string; territories?: string; excludingTerritories?: string; contractPeriodBegins?: Date; contractPeriodEnds?: Date; contractNumber?: string; authors?: Array<{ name: string; role: string; shareBasisPoints?: number }> }) {
    const actor = requireContext(context);
    requireCompositionManager(actor);
    const tenantId = catalogTenantId(actor);
    await this.assertScope(context, tenantId);
    return this.withEvent(context, "catalog.composition.created", transaction => transaction.composition.create({ data: { ...input, tenantId, ownerId: actor.entityId } }), result => ({ compositionId: result.id, tenantId: result.tenantId, ownerId: result.ownerId }));
  }

  async getComposition(context: InternalAuthContext, id: string) {
    const actor = requireContext(context);
    const composition = await this.database.prisma.composition.findUnique({
      where: { id },
      include: { tenant: { select: { path: true } }, owner: { select: { path: true } } }
    });
    const ownerPath = composition?.owner?.path ?? composition?.tenant.path;
    const accessible = composition && (
      composition.ownerId === actor.entityId ||
      (actor.entityType === "ORGANIZATION" && composition.tenantId === catalogTenantId(actor) && !!ownerPath && allowedPath(ownerPath, actor.entityPath)) ||
      (!["SUB_ACCOUNT", "ORGANIZATION"].includes(actor.entityType) && allowedPath(composition.tenant.path, actor.entityPath))
    );
    if (!accessible) throw new CatalogError(404, "NOT_FOUND", "Catalog resource not found");
    return composition;
  }

  async updateComposition(context: InternalAuthContext, id: string, input: { title?: string; subtitle?: string | null; alternativeTitle?: string | null; iswc?: string | null; catalogueNumber?: string | null; genre?: string | null; creationDate?: Date | null; lyricsLanguages?: string | null; territories?: string; excludingTerritories?: string | null; contractPeriodBegins?: Date | null; contractPeriodEnds?: Date | null; contractNumber?: string | null; authors?: Array<{ name: string; role: string; shareBasisPoints?: number }> | null }) {
    const actor = requireContext(context);
    requireCompositionManager(actor);
    await this.getComposition(context, id);
    const { authors, ...fields } = input;
    return this.withEvent(
      context,
      "catalog.composition.updated",
      transaction => transaction.composition.update({
        where: { id },
        data: {
          ...fields,
          ...(authors === undefined
            ? {}
            : { authors: authors === null ? Prisma.JsonNull : authors })
        }
      }),
      result => ({ compositionId: result.id, tenantId: result.tenantId })
    );
  }

  async deleteComposition(context: InternalAuthContext, id: string) {
    const actor = requireContext(context);
    requireCompositionManager(actor);
    await this.getComposition(context, id);
    await this.withEvent(context, "catalog.composition.deleted", transaction => transaction.composition.delete({ where: { id } }), result => ({ compositionId: result.id, tenantId: result.tenantId }));
  }

  async getTenantBrand(context: InternalAuthContext) {
    const actor = requireContext(context);
    if (actor.entityType === "SUPER_ADMIN" || actor.entityType === "SYSTEM_ADMIN") {
      return platformBrand(actor.entityId);
    }
    const tenantId = catalogTenantId(actor);
    if (!tenantId) throw new CatalogError(403, "FORBIDDEN", "Tenant brand requires organization scope");
    const [profile, tenant] = await Promise.all([
      this.database.prisma.tenantBrandProfile.findUnique({ where: { tenantId } }),
      this.database.prisma.businessEntity.findUnique({ where: { id: tenantId }, select: { officialName: true, entityType: true, isActive: true } })
    ]);
    if (!tenant || tenant.entityType !== "ORGANIZATION" || !tenant.isActive) {
      throw new CatalogError(404, "NOT_FOUND", "Tenant brand not found");
    }
    const brand = profile ?? {
      tenantId,
      displayName: tenant.officialName,
      logoAssetId: null,
      accentColor: "#111111",
      accentTextColor: "#FFFFFF",
      supportEmail: null,
      supportUrl: null,
      defaultLocale: "en",
      version: 1
    };
    return { ...brand, logoUrl: brand.logoAssetId ? `/media-public/${brand.logoAssetId}` : null };
  }

  async updateTenantBrand(context: InternalAuthContext, input: TenantBrandUpdate) {
    const actor = requireContext(context);
    const tenantId = requireRootTenantOwner(actor);
    const tenant = await this.database.prisma.businessEntity.findUnique({ where: { id: tenantId }, select: { entityType: true, isActive: true } });
    if (!tenant || tenant.entityType !== "ORGANIZATION" || !tenant.isActive) {
      throw new CatalogError(404, "NOT_FOUND", "Tenant brand not found");
    }
    const { expectedVersion, logoAssetId = null, supportEmail = null, supportUrl = null, ...required } = input;
    await this.withEvent(
      context,
      "catalog.tenant-brand.updated",
      async transaction => {
        const updated = await transaction.tenantBrandProfile.updateMany({
          where: { tenantId, version: expectedVersion },
          data: { ...required, logoAssetId, supportEmail, supportUrl, updatedById: actor.actorId, version: { increment: 1 } }
        });
        if (updated.count === 1) return transaction.tenantBrandProfile.findUniqueOrThrow({ where: { tenantId } });
        if (expectedVersion !== 1) throw new CatalogError(409, "VERSION_CONFLICT", "Tenant brand changed; reload before saving");
        try {
          return await transaction.tenantBrandProfile.create({
            data: { tenantId, ...required, logoAssetId, supportEmail, supportUrl, updatedById: actor.actorId, version: 2 }
          });
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            throw new CatalogError(409, "VERSION_CONFLICT", "Tenant brand changed; reload before saving");
          }
          throw error;
        }
      },
      result => ({ tenantId: result.tenantId, version: result.version })
    );
    return this.getTenantBrand(context);
  }

  async listTenantDomains(context: InternalAuthContext) {
    const actor = requireContext(context);
    const tenantId = requireRootTenantOwner(actor);
    return this.database.prisma.tenantDomain.findMany({
      where: { tenantId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });
  }

  async createTenantDomain(context: InternalAuthContext, input: { hostname: string }) {
    const actor = requireContext(context);
    const tenantId = requireRootTenantOwner(actor);
    const tenant = await this.database.prisma.businessEntity.findUnique({ where: { id: tenantId }, select: { entityType: true, isActive: true } });
    if (!tenant || tenant.entityType !== "ORGANIZATION" || !tenant.isActive) throw new CatalogError(404, "NOT_FOUND", "Organization not found");
    const hostname = normalizeTenantHostname(input.hostname);
    const challenge = createTenantDomainChallenge(hostname);
    try {
      const domain = await this.withEvent(
        context,
        "catalog.tenant-domain.created",
        transaction => transaction.tenantDomain.create({
          data: {
            tenantId,
            hostname,
            verificationTokenHash: challenge.tokenHash,
            updatedById: actor.actorId
          }
        }),
        result => ({ domainId: result.id, tenantId: result.tenantId, hostname: result.hostname, status: result.status, version: result.version })
      );
      return { domain, verification: challenge.verification };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new CatalogError(409, "DOMAIN_CONFLICT", "Hostname is already registered");
      }
      throw error;
    }
  }

  async verifyTenantDomain(context: InternalAuthContext, id: string, expectedVersion: number) {
    const actor = requireContext(context);
    const tenantId = requireRootTenantOwner(actor);
    const domain = await this.database.prisma.tenantDomain.findFirst({ where: { id, tenantId } });
    if (!domain) throw new CatalogError(404, "NOT_FOUND", "Tenant domain not found");
    if (domain.version !== expectedVersion) throw new CatalogError(409, "VERSION_CONFLICT", "Tenant domain changed; reload before retrying");
    if (domain.status === "VERIFIED") return domain;
    let records: string[][];
    try {
      records = await this.tenantDomains.resolveTxt(`_bealpha-verification.${domain.hostname}`);
    } catch {
      records = [];
    }
    const checkedAt = new Date();
    if (!dnsRecordsContainChallenge(records, domain.verificationTokenHash)) {
      await this.database.prisma.tenantDomain.updateMany({ where: { id, tenantId, version: expectedVersion }, data: { lastCheckedAt: checkedAt } });
      throw new CatalogError(409, "DOMAIN_NOT_VERIFIED", "Required DNS TXT challenge was not found");
    }
    await this.tenantDomains.invalidate(domain.hostname);
    await this.withEvent(
      context,
      "catalog.tenant-domain.verified",
      async transaction => {
        const result = await transaction.tenantDomain.updateMany({
          where: { id, tenantId, version: expectedVersion, status: "PENDING" },
          data: { status: "VERIFIED", verifiedAt: checkedAt, lastCheckedAt: checkedAt, updatedById: actor.actorId, version: { increment: 1 } }
        });
        if (result.count !== 1) throw new CatalogError(409, "VERSION_CONFLICT", "Tenant domain changed; reload before retrying");
        return result;
      },
      result => ({ domainId: id, tenantId, hostname: domain.hostname, version: expectedVersion + 1, updated: result.count })
    );
    await this.tenantDomains.invalidate(domain.hostname);
    return this.database.prisma.tenantDomain.findUniqueOrThrow({ where: { id } });
  }

  async deleteTenantDomain(context: InternalAuthContext, id: string, expectedVersion: number) {
    const actor = requireContext(context);
    const tenantId = requireRootTenantOwner(actor);
    const domain = await this.database.prisma.tenantDomain.findFirst({ where: { id, tenantId } });
    if (!domain) throw new CatalogError(404, "NOT_FOUND", "Tenant domain not found");
    if (domain.version !== expectedVersion) throw new CatalogError(409, "VERSION_CONFLICT", "Tenant domain changed; reload before deleting");
    await this.tenantDomains.invalidate(domain.hostname);
    await this.withEvent(
      context,
      "catalog.tenant-domain.deleted",
      async transaction => {
        const result = await transaction.tenantDomain.deleteMany({ where: { id, tenantId, version: expectedVersion } });
        if (result.count !== 1) throw new CatalogError(409, "VERSION_CONFLICT", "Tenant domain changed; reload before deleting");
        return result;
      },
      result => ({ domainId: id, tenantId, hostname: domain.hostname, deleted: result.count })
    );
    await this.tenantDomains.invalidate(domain.hostname);
  }

  async resolveTenantDomain(hostnameInput: string) {
    const hostname = normalizeTenantHostname(hostnameInput);
    const domain = await this.database.prisma.tenantDomain.findFirst({
      where: { hostname, status: "VERIFIED", tenant: { entityType: "ORGANIZATION", isActive: true } },
      select: { tenantId: true, hostname: true, version: true }
    });
    if (!domain) throw new CatalogError(404, "NOT_FOUND", "Verified tenant domain not found");
    return domain;
  }

  async resolvePublicTenantBrand(hostnameInput: string) {
    const requestHostname = hostnameInput.trim().toLowerCase().replace(/\.$/, "");
    if (requestHostname === "localhost" || isIP(requestHostname) !== 0) {
      return platformBrand("00000000-0000-4000-8000-000000000000");
    }
    const hostname = normalizeTenantHostname(hostnameInput);
    const domain = await this.database.prisma.tenantDomain.findFirst({
      where: { hostname, status: "VERIFIED", tenant: { entityType: "ORGANIZATION", isActive: true } },
      select: {
        tenantId: true,
        tenant: {
          select: {
            officialName: true,
            brandProfile: {
              select: { displayName: true, logoAssetId: true, accentColor: true, accentTextColor: true, supportEmail: true, supportUrl: true, defaultLocale: true, version: true }
            }
          }
        }
      }
    });
    if (!domain) throw new CatalogError(404, "NOT_FOUND", "Verified tenant domain not found");
    const profile = domain.tenant.brandProfile;
    const brand = profile ?? {
      displayName: domain.tenant.officialName,
      logoAssetId: null,
      accentColor: "#111111",
      accentTextColor: "#FFFFFF",
      supportEmail: null,
      supportUrl: null,
      defaultLocale: "en",
      version: 1
    };
    return { tenantId: domain.tenantId, ...brand, logoUrl: brand.logoAssetId ? `/media-public/${brand.logoAssetId}` : null };
  }
}
