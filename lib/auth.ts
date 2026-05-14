import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { prisma } from "./prisma";

const jwtSecretValue = process.env.JWT_SECRET;
if (!jwtSecretValue && process.env.NODE_ENV === "production") {
  throw new Error(
    "[FATAL] JWT_SECRET environment variable is required in production!",
  );
}
// B10 fix: only allow dev fallback when NODE_ENV is explicitly 'development'
if (!jwtSecretValue && process.env.NODE_ENV !== "development") {
  throw new Error(
    "[FATAL] JWT_SECRET is not set! Set JWT_SECRET in your .env file. Only development mode allows fallback.",
  );
}
if (!jwtSecretValue) {
  console.error(
    "\x1b[31m[CRITICAL] JWT_SECRET is not set! Using insecure default. Set JWT_SECRET in your .env file!\x1b[0m",
  );
}
const JWT_SECRET = new TextEncoder().encode(
  jwtSecretValue || "bealpha-dev-only-secret-key",
);

// IP Intelligence — full geo + ISP data for risk-based auth
export interface IPIntelligence {
  city?: string;
  country?: string;
  countryCode?: string;
  lat?: number;
  lon?: number;
  isp?: string;
  org?: string;
  asn?: string;
  locationString?: string; // "Ho Chi Minh City, Vietnam"
}

export function isLocalIP(ip: string): boolean {
  if (
    !ip ||
    ip === "unknown" ||
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip.startsWith("192.168.") ||
    ip.startsWith("10.")
  ) {
    return true;
  }
  // RFC 1918: 172.16.0.0 – 172.31.255.255 only (not all 172.x.x.x)
  if (ip.startsWith("172.")) {
    const second = parseInt(ip.split(".")[1], 10);
    if (!isNaN(second) && second >= 16 && second <= 31) return true;
  }
  return false;
}

/**
 * Resolve public IPv4 when running behind NAT or on localhost.
 * Calls ipify.org to get the server's outbound public IP.
 * Cached for 5 minutes to avoid excessive external calls.
 * Falls back to the original IP if resolution fails.
 */
let _cachedPublicIp: { ip: string; expiresAt: number } | null = null;

export async function resolvePublicIP(rawIp: string): Promise<string> {
  if (!isLocalIP(rawIp)) return rawIp;

  // Return cached result if still valid
  if (_cachedPublicIp && Date.now() < _cachedPublicIp.expiresAt) {
    return _cachedPublicIp.ip;
  }

  try {
    const res = await fetch("https://api.ipify.org?format=json", {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.ip && /^\d+\.\d+\.\d+\.\d+$/.test(data.ip)) {
        _cachedPublicIp = { ip: data.ip, expiresAt: Date.now() + 5 * 60 * 1000 };
        return data.ip;
      }
    }
  } catch {
    // Fail silently — geo-lookup will just be skipped
  }
  return rawIp;
}

export async function getIPIntelligence(
  ip: string,
): Promise<IPIntelligence> {
  // Caller should have already resolved public IP via resolvePublicIP()
  if (isLocalIP(ip)) return {};

  // Prevent SSRF: sanitize IP to allow only valid IPv4/IPv6 characters
  const safeIp = ip.replace(/[^0-9a-fA-F.:]/g, "");

  try {
    // Security audit fix H4: Switched from HTTP ip-api.com to HTTPS ipwho.is
    // to prevent MITM interception of geolocation data used for impossible-travel detection.
    const res = await fetch(
      `https://ipwho.is/${safeIp}`,
      { signal: AbortSignal.timeout(3000) },
    );
    if (res.ok) {
      const data = await res.json();
      if (data.success !== false) {
        return {
          city: data.city || undefined,
          country: data.country || undefined,
          countryCode: data.country_code || undefined,
          lat: data.latitude ?? undefined,
          lon: data.longitude ?? undefined,
          isp: data.connection?.isp || undefined,
          org: data.connection?.org || undefined,
          asn: data.connection?.asn ? String(data.connection.asn) : undefined,
          locationString:
            data.city && data.country
              ? `${data.city}, ${data.country}`
              : undefined,
        };
      }
    }
  } catch {
    // Fail silently to not block login
  }
  return {};
}

// Backward-compatible wrapper
export async function getLocationFromIP(
  ip: string,
): Promise<string | undefined> {
  const intel = await getIPIntelligence(ip);
  return intel.locationString;
}

// Fix #11: GDPR Cookie Classification
// The `bealpha_token` session cookie and `hardwareId` device fingerprint cookie
// are classified as "strictly necessary for account security" under ePrivacy Directive.
// Legal basis: Legitimate interest for fraud prevention (GDPR Art. 6(1)(f)).
// These cookies are exempt from opt-in consent requirements.
// Flags: HttpOnly=true, Secure=true (prod), SameSite=Strict — set in setSessionCookie().
const COOKIE_NAME = "bealpha_token";

// B2B2B Entity Types
export const ENTITY_TYPES = {
  SUPER_ADMIN: "SUPER_ADMIN",
  SYSTEM_ADMIN: "SYSTEM_ADMIN",
  ORGANIZATION: "ORGANIZATION",
  SUB_ACCOUNT: "SUB_ACCOUNT",
} as const;

export type EntityTypeName = (typeof ENTITY_TYPES)[keyof typeof ENTITY_TYPES];

// Entity Roles (within an entity)
export const ENTITY_ROLES = {
  OWNER: "OWNER",
  ADMIN: "ADMIN",
  MEMBER: "MEMBER",
} as const;

export type EntityRoleName = (typeof ENTITY_ROLES)[keyof typeof ENTITY_ROLES];

// Legacy ROLES kept for backward compatibility with Role table + sidebar
export const ROLES = {
  ADMIN: "admin",
  MODERATOR: "moderator",
  SUPPORTER: "supporter",
  FINANCE: "finance",
} as const;

export type RoleName = (typeof ROLES)[keyof typeof ROLES];

// All permissions in the system
export const PERMISSIONS = {
  // Release permissions
  RELEASE_CREATE: "release.create",
  RELEASE_READ: "release.read",
  RELEASE_UPDATE: "release.update",
  RELEASE_DELETE: "release.delete",
  RELEASE_APPROVE: "release.approve",
  RELEASE_DENY: "release.deny",
  RELEASE_SUBMIT: "release.submit",

  // Artist permissions
  ARTIST_CREATE: "artist.create",
  ARTIST_READ: "artist.read",
  ARTIST_UPDATE: "artist.update",
  ARTIST_DELETE: "artist.delete",

  // Label permissions
  LABEL_CREATE: "label.create",
  LABEL_READ: "label.read",
  LABEL_UPDATE: "label.update",
  LABEL_DELETE: "label.delete",

  // Entity management
  ENTITY_CREATE: "entity.create",
  ENTITY_READ: "entity.read",
  ENTITY_UPDATE: "entity.update",
  ENTITY_DELETE: "entity.delete",
  ENTITY_INVITE: "entity.invite",

  // User permissions
  USER_CREATE: "user.create",
  USER_READ: "user.read",
  USER_UPDATE: "user.update",
  USER_DELETE: "user.delete",
  USER_BAN: "user.ban",

  // Finance permissions
  FINANCE_VIEW: "finance.view",
  FINANCE_EXPORT: "finance.export",
  FINANCE_PAYOUT: "finance.payout",

  // Ticket/Support permissions
  TICKET_VIEW: "ticket.view",
  TICKET_RESPOND: "ticket.respond",
  TICKET_CLOSE: "ticket.close",

  // Analytics permissions
  ANALYTICS_VIEW: "analytics.view",
  ANALYTICS_EXPORT: "analytics.export",

  // System permissions
  SYSTEM_SETTINGS: "system.settings",
  SYSTEM_LOGS: "system.logs",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// EntityType → Permissions mapping (replaces role-based permissions)
export const ENTITY_TYPE_PERMISSIONS: Record<EntityTypeName, Permission[]> = {
  [ENTITY_TYPES.SUPER_ADMIN]: Object.values(PERMISSIONS),
  [ENTITY_TYPES.SYSTEM_ADMIN]: Object.values(PERMISSIONS),
  [ENTITY_TYPES.ORGANIZATION]: [
    PERMISSIONS.RELEASE_CREATE, PERMISSIONS.RELEASE_READ, PERMISSIONS.RELEASE_UPDATE,
    PERMISSIONS.RELEASE_DELETE, PERMISSIONS.RELEASE_APPROVE, PERMISSIONS.RELEASE_DENY,
    PERMISSIONS.RELEASE_SUBMIT,
    PERMISSIONS.ARTIST_CREATE, PERMISSIONS.ARTIST_READ, PERMISSIONS.ARTIST_UPDATE, PERMISSIONS.ARTIST_DELETE,
    PERMISSIONS.LABEL_CREATE, PERMISSIONS.LABEL_READ, PERMISSIONS.LABEL_UPDATE, PERMISSIONS.LABEL_DELETE,
    PERMISSIONS.ENTITY_CREATE, PERMISSIONS.ENTITY_READ, PERMISSIONS.ENTITY_UPDATE, PERMISSIONS.ENTITY_INVITE,
    PERMISSIONS.USER_CREATE, PERMISSIONS.USER_READ, PERMISSIONS.USER_UPDATE,
    PERMISSIONS.ANALYTICS_VIEW, PERMISSIONS.ANALYTICS_EXPORT,
    PERMISSIONS.FINANCE_VIEW, PERMISSIONS.FINANCE_EXPORT,
    PERMISSIONS.TICKET_VIEW,
  ],
  [ENTITY_TYPES.SUB_ACCOUNT]: [
    PERMISSIONS.RELEASE_CREATE, PERMISSIONS.RELEASE_READ, PERMISSIONS.RELEASE_UPDATE,
    PERMISSIONS.RELEASE_DELETE, PERMISSIONS.RELEASE_SUBMIT,
    PERMISSIONS.ARTIST_READ, PERMISSIONS.LABEL_READ,
    PERMISSIONS.ANALYTICS_VIEW,
    PERMISSIONS.TICKET_VIEW,
  ],
};

// Staff role permissions (Moderator, Supporter, Finance — admin-created company-wide roles)
export const STAFF_ROLE_PERMISSIONS: Record<string, Permission[]> = {
  [ROLES.ADMIN]: Object.values(PERMISSIONS),
  [ROLES.MODERATOR]: [
    PERMISSIONS.RELEASE_READ, PERMISSIONS.RELEASE_APPROVE, PERMISSIONS.RELEASE_DENY,
    PERMISSIONS.ARTIST_READ, PERMISSIONS.LABEL_READ,
  ],
  [ROLES.SUPPORTER]: [
    PERMISSIONS.TICKET_VIEW, PERMISSIONS.TICKET_RESPOND, PERMISSIONS.TICKET_CLOSE,
    PERMISSIONS.USER_READ, PERMISSIONS.ARTIST_READ, PERMISSIONS.LABEL_READ, PERMISSIONS.RELEASE_READ,
  ],
  [ROLES.FINANCE]: [
    PERMISSIONS.FINANCE_VIEW, PERMISSIONS.FINANCE_EXPORT, PERMISSIONS.FINANCE_PAYOUT,
    PERMISSIONS.ANALYTICS_VIEW, PERMISSIONS.ANALYTICS_EXPORT,
    PERMISSIONS.LABEL_READ, PERMISSIONS.ARTIST_READ,
  ],
};

// Which entity types can create which child entity types
export const ALLOWED_CHILD_ENTITY_TYPES: Record<EntityTypeName, EntityTypeName[]> = {
  [ENTITY_TYPES.SUPER_ADMIN]: [ENTITY_TYPES.SYSTEM_ADMIN, ENTITY_TYPES.ORGANIZATION],
  [ENTITY_TYPES.SYSTEM_ADMIN]: [ENTITY_TYPES.ORGANIZATION],
  [ENTITY_TYPES.ORGANIZATION]: [ENTITY_TYPES.SUB_ACCOUNT],
  [ENTITY_TYPES.SUB_ACCOUNT]: [], // Cannot create children
};

/**
 * Check if an entity type can create a child of a given type.
 */
export function canCreateEntityType(parentType: EntityTypeName, childType: EntityTypeName): boolean {
  return (ALLOWED_CHILD_ENTITY_TYPES[parentType] || []).includes(childType);
}

export interface UserPayload {
  id: string;
  email: string;
  roles: string[];          // Legacy staff roles from Role table
  entityId: string;         // Primary entity ID
  entityType: EntityTypeName;
  entityRole: EntityRoleName;
  entityName: string;
  tenantId: string | null;  // Organization ID (null for sys admins)
  entityPath: string;       // Hierarchy path for scoping
  isBanned?: boolean;
  exp?: number;
  iat?: number;
  jti?: string;
}

export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== "string") {
    throw new Error("Password must be a string");
  }
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(
  password: string,
  hashedPassword: string,
): Promise<boolean> {
  if (typeof password !== "string" || typeof hashedPassword !== "string") {
    return false;
  }
  return bcrypt.compare(password, hashedPassword);
}

export async function createToken(
  payload: UserPayload,
  expiry: string | number | Date = "24h",
  reqContext?: {
    ip?: string;
    userAgent?: string;
    hardwareId?: string;
    deviceName?: string;
    deviceType?: string;
    location?: string;
    latitude?: number;
    longitude?: number;
    isp?: string;
    riskScore?: number;
    loginType?: string;
  },
): Promise<string> {
  const jti = crypto.randomUUID(); // Unique token ID

  const jwt = await new SignJWT({ ...payload, jti })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiry)
    .sign(JWT_SECRET);

  if (reqContext) {
    let expiresAtDate: Date;
    if (typeof expiry === "string") {
      // Very basic parser for expiry (e.g. '30d', '24h')
      const valueStr = expiry.replace(/[^0-9]/g, "");
      const value = valueStr ? parseInt(valueStr) : 24;
      const unit = expiry.replace(/[0-9]/g, "") || "h";
      const multiplier =
        unit === "d" ? 86400000 : unit === "h" ? 3600000 : 60000;
      expiresAtDate = new Date(Date.now() + value * multiplier);
    } else if (typeof expiry === "number") {
      expiresAtDate = new Date(Date.now() + expiry * 1000);
    } else {
      expiresAtDate = expiry;
    }

    try {
      await prisma.authToken.create({
        data: {
          tokenHash: jti,
          userId: payload.id,
          ipAddress: reqContext.ip,
          userAgent: reqContext.userAgent,
          hardwareId: reqContext.hardwareId,
          deviceName: reqContext.deviceName,
          deviceType: reqContext.deviceType,
          location: reqContext.location,
          latitude: reqContext.latitude,
          longitude: reqContext.longitude,
          isp: reqContext.isp,
          riskScore: reqContext.riskScore,
          loginType: reqContext.loginType,
          expiresAt: expiresAtDate,
        },
      });
    } catch (e) {
      console.error("Failed to store AuthToken", e);
    }
  }

  return jwt;
}

export async function verifyToken(token: string): Promise<UserPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as unknown as UserPayload;
  } catch {
    return null;
  }
}

export async function login(
  email: string,
  password: string,
): Promise<{ success: boolean; error?: string; user?: UserPayload }> {
  try {
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        roles: { include: { role: true } },
        entityRoles: {
          include: {
            entity: {
              select: { id: true, entityType: true, officialName: true, path: true, parentId: true },
            },
          },
          orderBy: { createdAt: "asc" },
          take: 1, // Primary entity
        },
      },
    });

    if (!user) {
      return { success: false, error: "Invalid email or password" };
    }

    if (!user.isActive) {
      return { success: false, error: "Account has been deactivated" };
    }

    if (user.isBanned) {
      return { success: false, error: "Account has been banned. Contact support for assistance." };
    }

    const isValid = await verifyPassword(password, user.password);
    if (!isValid) {
      return { success: false, error: "Invalid email or password" };
    }

    const primaryEntityRole = user.entityRoles[0];
    if (!primaryEntityRole) {
      return { success: false, error: "No entity assigned to this account" };
    }

    const entity = primaryEntityRole.entity;

    // Resolve tenantId
    let tenantId: string | null = null;
    if (entity.entityType === "ORGANIZATION") {
      tenantId = entity.id;
    } else if (entity.entityType === "SUB_ACCOUNT" && entity.parentId) {
      tenantId = entity.parentId;
    }

    const userPayload: UserPayload = {
      id: user.id,
      email: user.email,
      roles: user.roles.map((r) => r.role.name),
      entityId: entity.id,
      entityType: entity.entityType as EntityTypeName,
      entityRole: primaryEntityRole.role as EntityRoleName,
      entityName: entity.officialName,
      tenantId,
      entityPath: entity.path,
      isBanned: user.isBanned,
    };

    return { success: true, user: userPayload };
  } catch (error) {
    console.error("Login error:", error);
    return { success: false, error: "An error occurred" };
  }
}

export async function getSession(): Promise<UserPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;

  if (!token) return null;

  const payload = await verifyToken(token);
  if (!payload || !payload.jti) return null;

  // Verify in database for Stateful Session, and fetch user ban/lockout status
  const authToken = await prisma.authToken.findUnique({
    where: { tokenHash: payload.jti },
    include: {
      user: {
        select: { isActive: true, isBanned: true, lockoutUntil: true },
      },
    },
  });

  if (!authToken || !authToken.isValid || new Date() > authToken.expiresAt) {
    if (authToken && !authToken.isValid) {
      try {
        await clearSession();
      } catch {
        /* ignore during SSR */
      }
    }
    return null;
  }

  // System-wide security: Reject banned, inactive, or locked out users natively
  if (!authToken.user || !authToken.user.isActive || authToken.user.isBanned) {
    try {
      await clearSession();
    } catch {
      /* ignore */
    }
    return null;
  }

  if (
    authToken.user.lockoutUntil &&
    new Date(authToken.user.lockoutUntil) > new Date()
  ) {
    try {
      await clearSession();
    } catch {
      /* ignore */
    }
    return null;
  }

  // Theft Detection: Check Context (IP & UserAgent)
  const { headers } = await import("next/headers");
  const headersList = await headers();
  const currentIp =
    headersList.get("x-forwarded-for")?.split(",")[0].trim() ||
    headersList.get("x-real-ip") ||
    "unknown";
  const currentUserAgent = headersList.get("user-agent") || "unknown";

  // B7 fix: Compare UA browser family only (not exact string) to avoid false lockouts from auto-updates
  // Extract major browser identifier: "Chrome/126", "Firefox/128", "Safari/605" etc.
  function extractUaFamily(ua: string): string {
    const match = ua.match(/(Chrome|Firefox|Safari|Edg|OPR|Opera)\/([\d]+)/);
    return match ? `${match[1]}/${match[2]}` : ua.slice(0, 50);
  }

  if (
    authToken.userAgent &&
    currentUserAgent !== "unknown" &&
    process.env.NODE_ENV === "production"
  ) {
    const storedFamily = extractUaFamily(authToken.userAgent);
    const currentFamily = extractUaFamily(currentUserAgent);

    // Check IP match (ignore local IPs)
    const isLocalIp = isLocalIP(currentIp);
    const ipMismatch =
      !isLocalIp && authToken.ipAddress && authToken.ipAddress !== currentIp;
    const uaMismatch = storedFamily !== currentFamily;

    if (uaMismatch || ipMismatch) {
      const mismatchReason = uaMismatch
        ? "Browser Fingerprint Mismatch"
        : "IP Address Mismatch";
      console.error(
        `[SECURITY] Session Hijack Attempt! Reason: ${mismatchReason}. User ${payload.email} Token ${authToken.id}`,
      );

      // 1. Invalidate ALL user tokens
      await prisma.authToken.updateMany({
        where: { userId: payload.id, isValid: true },
        data: { isValid: false },
      });
      try {
        await clearSession();
      } catch {
        /* ignore during SSR */
      }

      // 2. Temporarily lock account
      const newLockout = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await prisma.user.update({
        where: { id: payload.id },
        data: { lockoutUntil: newLockout },
      });

      // 3. Notify user
      try {
        await prisma.notification.create({
          data: {
            userId: payload.id,
            type: "system",
            title: "Security Alert: Session Hijack Prevented",
            message: `We detected someone trying to use your session from a different ${uaMismatch ? "browser" : "IP address"}. For your security, your account has been temporarily locked. Please reset your password.`,
            link: "/settings/security",
          },
        });
      } catch {
        /* notification table may not exist */
      }

      // 4. Email security alert
      try {
        const { sendSecurityAlert } = await import("./email");
        await sendSecurityAlert(payload.email, {
          userAgent: currentUserAgent,
          ipAddress: currentIp,
          location: authToken.location || undefined,
          timestamp: new Date(),
          reason: "Session Hijack Attempt Detected",
        });
      } catch (e) {
        console.error("Security alert email failed:", e);
      }

      return null;
    }
  }

  // Throttle Last Used At updates to once every 10 minutes to reduce DB writes
  if (Date.now() - authToken.lastUsedAt.getTime() > 10 * 60 * 1000) {
    prisma.authToken
      .update({
        where: { id: authToken.id },
        data: {
          lastUsedAt: new Date(),
          // Only update IP if current is non-local — avoid overwriting public IP with ::1
          ...(currentIp && !isLocalIP(currentIp) ? { ipAddress: currentIp } : {}),
        },
      })
      .catch(() => {});
  }

  return payload;
}

/**
 * Get session with fresh data from DB (not cached JWT).
 * Auto-refreshes the session cookie if entity assignment has changed.
 */
export async function getFreshSession(): Promise<UserPayload | null> {
  const tokenSession = await getSession();
  if (!tokenSession) return null;

  const freshSession = await getUserWithRoles(tokenSession.id);
  if (!freshSession) return null;

  // Auto-refresh token if entity assignment changed
  if (freshSession.entityId !== tokenSession.entityId) {
    const isRememberMe = tokenSession.exp
      ? tokenSession.exp - Date.now() / 1000 > 86400 * 7
      : false;

    try {
      const newToken = await createToken(freshSession);
      await setSessionCookie(newToken, isRememberMe);
    } catch {
      // Non-critical â€” continue with fresh data even if cookie refresh fails
    }
  }

  return freshSession;
}

/**
 * Get session with ban/active check from DB.
 * Use this on mutation endpoints (POST/PATCH/DELETE) to ensure
 * banned or deactivated users can't perform actions with a stale JWT.
 */
export async function getSecureSession(): Promise<UserPayload | null> {
  // getSession now natively checks user ban and lockout status on every call
  return await getSession();
}

export async function setSessionCookie(
  token: string,
  rememberMe?: boolean,
): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: rememberMe ? 60 * 60 * 24 * 30 : 60 * 60 * 24 * 7, // 30 days or 7 days
    path: "/",
  });
}

export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

// Role checking utilities
export function hasRole(
  user: UserPayload | null,
  role: RoleName | string,
): boolean {
  if (!user) return false;
  return user.roles.includes(role);
}

export function hasAnyRole(
  user: UserPayload | null,
  roles: (RoleName | string)[],
): boolean {
  if (!user) return false;
  return roles.some((role) => user.roles.includes(role));
}

// Permission checking — combines entity type + staff role permissions
export function hasPermission(
  user: UserPayload | null,
  permission: Permission,
): boolean {
  if (!user) return false;

  const perms = new Set<string>();

  // Entity type permissions
  const entityPerms = ENTITY_TYPE_PERMISSIONS[user.entityType];
  if (entityPerms) entityPerms.forEach((p) => perms.add(p));

  // Staff role permissions (moderator, supporter, finance, admin)
  for (const roleName of user.roles) {
    const rolePerms = STAFF_ROLE_PERMISSIONS[roleName];
    if (rolePerms) rolePerms.forEach((p) => perms.add(p));
  }

  return perms.has(permission);
}

export function hasAnyPermission(
  user: UserPayload | null,
  permissions: Permission[],
): boolean {
  if (!user) return false;
  return permissions.some((perm) => hasPermission(user, perm));
}

export function hasAllPermissions(
  user: UserPayload | null,
  permissions: Permission[],
): boolean {
  if (!user) return false;
  return permissions.every((perm) => hasPermission(user, perm));
}

export function getUserPermissions(user: UserPayload | null): Permission[] {
  if (!user) return [];
  const perms = new Set<Permission>();
  const entityPerms = ENTITY_TYPE_PERMISSIONS[user.entityType];
  if (entityPerms) entityPerms.forEach((p) => perms.add(p));
  for (const roleName of user.roles) {
    const rolePerms = STAFF_ROLE_PERMISSIONS[roleName];
    if (rolePerms) rolePerms.forEach((p) => perms.add(p));
  }
  return Array.from(perms);
}

// Entity type shorthand checks
export function isAdmin(user: UserPayload | null): boolean {
  return hasRole(user, ROLES.ADMIN);
}

export function isSuperAdmin(user: UserPayload | null): boolean {
  if (!user) return false;
  return user.entityType === ENTITY_TYPES.SUPER_ADMIN;
}

export function isSystemAdmin(user: UserPayload | null): boolean {
  if (!user) return false;
  return user.entityType === ENTITY_TYPES.SYSTEM_ADMIN || user.entityType === ENTITY_TYPES.SUPER_ADMIN;
}

export function isOrganization(user: UserPayload | null): boolean {
  if (!user) return false;
  return user.entityType === ENTITY_TYPES.ORGANIZATION;
}

export function isSubAccount(user: UserPayload | null): boolean {
  if (!user) return false;
  return user.entityType === ENTITY_TYPES.SUB_ACCOUNT;
}

export function isModerator(user: UserPayload | null): boolean {
  return hasRole(user, ROLES.MODERATOR);
}

export function isSupporter(user: UserPayload | null): boolean {
  return hasRole(user, ROLES.SUPPORTER);
}

export function isFinance(user: UserPayload | null): boolean {
  return hasRole(user, ROLES.FINANCE);
}

// Get user from database with entity roles
export async function getUserWithRoles(
  userId: string,
): Promise<UserPayload | null> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        roles: { include: { role: true } },
        entityRoles: {
          include: {
            entity: {
              select: { id: true, entityType: true, officialName: true, path: true, parentId: true },
            },
          },
          orderBy: { createdAt: "asc" },
          take: 1,
        },
      },
    });

    if (!user || !user.isActive || user.isBanned) return null;

    const primaryEntityRole = user.entityRoles[0];
    if (!primaryEntityRole) return null;

    const entity = primaryEntityRole.entity;
    let tenantId: string | null = null;
    if (entity.entityType === "ORGANIZATION") tenantId = entity.id;
    else if (entity.entityType === "SUB_ACCOUNT" && entity.parentId) tenantId = entity.parentId;

    return {
      id: user.id,
      email: user.email,
      roles: user.roles.map((r) => r.role.name),
      entityId: entity.id,
      entityType: entity.entityType as EntityTypeName,
      entityRole: primaryEntityRole.role as EntityRoleName,
      entityName: entity.officialName,
      tenantId,
      entityPath: entity.path,
      isBanned: user.isBanned,
    };
  } catch (error) {
    console.error("Error getting user with roles:", error);
    return null;
  }
}


// ─── Backward-compatible shims ─────────────────────────
// These map old role-based checks to entity-based checks.
// @deprecated — Migrate callers to use isSystemAdmin / hasPermission.

/** @deprecated Use entityType checks or hasPermission instead */
export function isArtist(_user: UserPayload | null): boolean {
  return false; // No direct "artist" entity in B2B2B — artists are catalog items
}

/** @deprecated Use session.entityType === 'ORGANIZATION' instead */
export function isLabel(user: UserPayload | null): boolean {
  if (!user) return false;
  return user.entityType === "ORGANIZATION";
}

/** @deprecated Distributors are now ORGANIZATION entities */
export function isDistributor(user: UserPayload | null): boolean {
  if (!user) return false;
  return user.entityType === "ORGANIZATION";
}

/** @deprecated Entity hierarchy replaces role-based creation rules */
export function canCreateRole(_session: UserPayload, _roleName: string): boolean {
  return true; // Entity-level access control handles this now
}

/** @deprecated No longer needed — entity hierarchy handles child relationships */
export const ALLOWED_CHILD_ROLES: Record<string, string[]> = {};
