/**
 * Sub-account "artist" sessions identify their catalog by joining on
 * `Artist.name`. Without an additional tenant filter, the name match collapses
 * artists across tenants — two labels each having an artist called "John
 * Smith" would see each other's tracks/releases/assets.
 *
 * `Artist.(tenantId, name)` is uniquely indexed, so adding tenantId restores
 * the one-row-per-tenant property of the join.
 *
 * Returns `null` when the session has no tenant context (e.g. SYS_ADMIN);
 * callers should treat null as "do not add the artist clause".
 */
export function artistMatchForSubAccount(session: {
  entityName: string;
  tenantId: string | null;
}): { name: string; tenantId: string } | null {
  if (!session.tenantId || !session.entityName) return null;
  return { name: session.entityName, tenantId: session.tenantId };
}
