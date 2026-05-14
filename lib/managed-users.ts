/**
 * @deprecated Use entity-hierarchy.ts instead.
 * This module is a B2B2B compatibility shim — legacy callers should migrate.
 */
import { getAccessibleEntityIds } from "./entity-hierarchy";
import { prisma } from "./prisma";

/**
 * @deprecated Use getAccessibleEntityIds from entity-hierarchy.ts
 * Returns user IDs within the entity hierarchy accessible by the given user.
 */
export async function getManagedUserIds(userId: string): Promise<string[]> {
  // Find user's primary entity
  const uer = await prisma.userEntityRole.findFirst({
    where: { userId },
    include: { entity: { select: { id: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (!uer) return [];

  const entityIds = await getAccessibleEntityIds(uer.entity.id);

  // Get all users in those entities
  const users = await prisma.userEntityRole.findMany({
    where: { entityId: { in: entityIds }, userId: { not: userId } },
    select: { userId: true },
  });

  return [...new Set(users.map((u) => u.userId))];
}

/**
 * @deprecated Use getAccessibleEntityIds from entity-hierarchy.ts
 */
export async function getChildUserIds(userId: string): Promise<string[]> {
  return getManagedUserIds(userId);
}
