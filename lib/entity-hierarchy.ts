import { prisma } from "./prisma";

/**
 * Entity Hierarchy utilities for B2B2B multi-tenancy.
 * Uses path-based (simulated ltree) queries for efficient hierarchy traversal.
 * Path format: "root.{uuid_short}.{uuid_short}.{uuid_short}"
 */

/**
 * Generate a short slug from UUID for path segments.
 * Uses first 8 chars of UUID (collision-safe within a hierarchy).
 */
export function uuidToSlug(uuid: string): string {
  return uuid.replace(/-/g, "").slice(0, 8);
}

/**
 * Build path for a new entity given its parent's path.
 */
export function buildEntityPath(parentPath: string | null, entityId: string): string {
  const slug = uuidToSlug(entityId);
  if (!parentPath) return slug; // Root entity
  return `${parentPath}.${slug}`;
}

/**
 * Check if `ancestorPath` is an ancestor of `descendantPath`.
 */
export function isAncestorOf(ancestorPath: string, descendantPath: string): boolean {
  return descendantPath.startsWith(ancestorPath + ".") || descendantPath === ancestorPath;
}

/**
 * Get the depth of an entity path (0 = root).
 */
export function getPathDepth(path: string): number {
  return path.split(".").length - 1;
}

/**
 * Get all descendant entity IDs using path prefix query.
 * Much more efficient than recursive traversal.
 */
export async function getDescendantEntityIds(entityPath: string): Promise<string[]> {
  const descendants = await prisma.businessEntity.findMany({
    where: {
      path: { startsWith: entityPath + "." },
      isActive: true,
    },
    select: { id: true },
  });
  return descendants.map((e) => e.id);
}

/**
 * Get all entity IDs that a user has access to (their entity + all descendants).
 */
export async function getAccessibleEntityIds(entityId: string): Promise<string[]> {
  const entity = await prisma.businessEntity.findUnique({
    where: { id: entityId },
    select: { path: true },
  });
  if (!entity) return [];

  const descendantIds = await getDescendantEntityIds(entity.path);
  return [entityId, ...descendantIds];
}

/**
 * Resolve the tenant (ORGANIZATION) ID for any entity in the hierarchy.
 * - ORGANIZATION → returns itself
 * - SUB_ACCOUNT → returns parent ORGANIZATION
 * - SYSTEM_ADMIN / SUPER_ADMIN → returns null (system level)
 */
export async function resolveTenantId(entityId: string): Promise<string | null> {
  const entity = await prisma.businessEntity.findUnique({
    where: { id: entityId },
    select: { id: true, entityType: true, parentId: true },
  });
  if (!entity) return null;

  if (entity.entityType === "ORGANIZATION") return entity.id;
  if (entity.entityType === "SUB_ACCOUNT" && entity.parentId) {
    // Parent should be ORGANIZATION
    return entity.parentId;
  }
  // SYSTEM_ADMIN / SUPER_ADMIN
  return null;
}

/**
 * Get the full ancestor chain of an entity (from root to self).
 */
export async function getAncestorChain(entityId: string): Promise<Array<{ id: string; officialName: string; entityType: string }>> {
  const entity = await prisma.businessEntity.findUnique({
    where: { id: entityId },
    select: { path: true },
  });
  if (!entity) return [];

  const slugs = entity.path.split(".");

  // Build all possible path prefixes to query directly (O(depth) instead of O(N))
  const pathPrefixes: string[] = [];
  let currentPath = "";
  for (const slug of slugs) {
    currentPath = currentPath ? `${currentPath}.${slug}` : slug;
    pathPrefixes.push(currentPath);
  }

  const ancestors = await prisma.businessEntity.findMany({
    where: { path: { in: pathPrefixes }, isActive: true },
    select: { id: true, officialName: true, entityType: true, path: true },
  });

  // Sort by path length to maintain root→leaf order
  ancestors.sort((a, b) => a.path.length - b.path.length);

  return ancestors.map((e) => ({ id: e.id, officialName: e.officialName, entityType: e.entityType }));
}

/**
 * Get user's primary entity (first entity role, typically the one they belong to).
 */
export async function getUserPrimaryEntity(userId: string) {
  const uer = await prisma.userEntityRole.findFirst({
    where: { userId },
    include: {
      entity: {
        select: {
          id: true,
          entityType: true,
          officialName: true,
          path: true,
          logoUrl: true,
          parentId: true,
        },
      },
    },
    orderBy: { createdAt: "asc" }, // First assigned = primary
  });
  return uer ? { ...uer.entity, role: uer.role } : null;
}

/**
 * Check if user has access to a specific entity (is member of entity or ancestor).
 */
export async function userHasAccessToEntity(userId: string, targetEntityId: string): Promise<boolean> {
  // Get all entities the user belongs to
  const userEntities = await prisma.userEntityRole.findMany({
    where: { userId },
    include: { entity: { select: { path: true } } },
  });

  // Get target entity path
  const target = await prisma.businessEntity.findUnique({
    where: { id: targetEntityId },
    select: { path: true },
  });
  if (!target) return false;

  // User has access if any of their entities is an ancestor of (or equal to) target
  return userEntities.some((ue) => isAncestorOf(ue.entity.path, target.path));
}
