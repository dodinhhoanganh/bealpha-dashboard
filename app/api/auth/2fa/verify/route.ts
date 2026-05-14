import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { createToken, setSessionCookie, type UserPayload, type EntityTypeName, type EntityRoleName } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { authenticator } from "otplib";
import bcrypt from "bcryptjs";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";

// Allow previous + current + next TOTP code (window=1)
authenticator.options = { window: 1 };

const TEMP_TOKEN_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "bealpha-dev-only-secret-key",
);

// Per-user 2FA attempt rate limiting (B6 fix: DB-backed instead of in-memory Map)
const MAX_2FA_ATTEMPTS = 5;
const TWO_FA_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

async function check2faRateLimit(userId: string): Promise<boolean> {
  // Count recent failed 2FA attempts by counting used=false codes created in the window
  // that have been "touched" (we track attempts via a dedicated counter on the user model)
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { failedLoginAttempts: true, lockoutUntil: true },
  });
  if (!user) return true; // Block unknown users

  // If currently locked out from 2FA brute force
  if (user.lockoutUntil && new Date(user.lockoutUntil) > new Date()) {
    return true;
  }

  return false;
}

async function increment2faAttempts(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { failedLoginAttempts: true },
  });
  const attempts = (user?.failedLoginAttempts || 0) + 1;
  const updateData: Record<string, unknown> = { failedLoginAttempts: attempts };
  if (attempts >= MAX_2FA_ATTEMPTS) {
    updateData.lockoutUntil = new Date(Date.now() + TWO_FA_WINDOW_MS);
  }
  await prisma.user.update({ where: { id: userId }, data: updateData });
  return attempts >= MAX_2FA_ATTEMPTS;
}

async function reset2faRateLimit(userId: string) {
  await prisma.user
    .update({
      where: { id: userId },
      data: { failedLoginAttempts: 0, lockoutUntil: null },
    })
    .catch(() => {});
}

export async function POST(request: NextRequest) {
  try {
    // Security audit fix H3: Rate limit auth endpoints (10 req/min per IP)
    const limited = rateLimit(request, RATE_LIMITS.AUTH);
    if (limited) return limited;

    const payload = await request.json();
    const tempToken = payload.tempToken;
    const code = payload.code;
    const method = payload.method;
    const rememberMe = Boolean(payload.rememberMe);
    const hardwareId = typeof payload.hardwareId === "string" ? payload.hardwareId.substring(0, 100) : undefined;
    const deviceName = typeof payload.deviceName === "string" ? payload.deviceName.substring(0, 100) : undefined;
    const deviceType = typeof payload.deviceType === "string" ? payload.deviceType.substring(0, 100) : undefined;

    if (
      typeof tempToken !== "string" ||
      typeof code !== "string" ||
      typeof method !== "string" ||
      code.length > 20
    ) {
      return NextResponse.json(
        { error: "ERROR_INVALID_OR_MISSING_PARAMETERS" },
        { status: 400 },
      );
    }

    // Verify temp token
    let userId: string;
    let allowedMethods: string[] = [];
    try {
      const { payload } = await jwtVerify(tempToken, TEMP_TOKEN_SECRET);
      if (payload.purpose !== "2fa") {
        throw new Error("Invalid token purpose");
      }
      userId = payload.userId as string;
      allowedMethods = (payload.allowedMethods as string[]) || [];
    } catch (err) {
      console.error(
        "2FA token verification failed:",
        err instanceof Error ? err.message : err,
      );
      return NextResponse.json(
        { error: "ERROR_INVALID_OR_EXPIRED_SESSION" },
        { status: 401 },
      );
    }

    // C1 fix: Enforce method is in the allowed list from login
    if (allowedMethods.length > 0 && !allowedMethods.includes(method)) {
      return NextResponse.json(
        { error: "ERROR_VERIFICATION_METHOD_NOT_ALLOWED_FOR_THIS_SES" },
        { status: 403 },
      );
    }

    // Per-user rate limit to prevent brute force (even with IP rotation)
    if (await check2faRateLimit(userId)) {
      return NextResponse.json(
        { error: "ERROR_TOO_MANY_VERIFICATION_ATTEMPTS_PLEASE_WAIT_A" },
        { status: 429 },
      );
    }

    // Get user with roles and entity assignments
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
        entityRoles: {
          include: {
            entity: true,
          },
          take: 1,
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: "ERROR_USER_NOT_FOUND" }, { status: 404 });
    }

    // Check account status
    if (!user.isActive) {
      return NextResponse.json(
        { error: "ERROR_ACCOUNT_IS_DEACTIVATED" },
        { status: 401 },
      );
    }

    if (user.isBanned) {
      return NextResponse.json(
        { error: "ERROR_ACCOUNT_IS_BANNED_CONTACT_SUPPORT_FOR_ASSIST" },
        { status: 401 },
      );
    }

    let isValid = false;

    if (method === "app") {
      // Verify TOTP code from authenticator app
      if (!user.twoFactorSecret) {
        return NextResponse.json(
          { error: "ERROR_AUTHENTICATOR_NOT_CONFIGURED" },
          { status: 400 },
        );
      }

      isValid = authenticator.verify({
        token: code,
        secret: user.twoFactorSecret,
      });

      // If TOTP fails, check if the code is a valid recovery code
      // We expect the user to input the backup code exactly as shown, but we clean it up just in case
      if (
        !isValid &&
        user.twoFactorRecoveryCodes &&
        user.twoFactorRecoveryCodes.length > 0
      ) {
        const formattedInputCode = code.replace(/[\s\-]+/g, "").toUpperCase();

        let matchedIndex = -1;
        for (let i = 0; i < user.twoFactorRecoveryCodes.length; i++) {
          const isMatch = await bcrypt.compare(
            formattedInputCode,
            user.twoFactorRecoveryCodes[i],
          );
          if (isMatch) {
            matchedIndex = i;
            break;
          }
        }

        if (matchedIndex !== -1) {
          isValid = true;
          // Consume (remove) the used recovery code
          const newCodes = [...user.twoFactorRecoveryCodes];
          newCodes.splice(matchedIndex, 1);
          await prisma.user.update({
            where: { id: user.id },
            data: { twoFactorRecoveryCodes: newCodes },
          });
        }
      }
    } else {
      // Verify code from database (email or phone)
      // C3 fix: Atomic update-and-check to prevent race condition
      const result = await prisma.twoFactorCode.updateMany({
        where: {
          userId,
          code,
          method,
          used: false,
          expiresAt: { gt: new Date() },
        },
        data: { used: true },
      });
      isValid = result.count > 0;
    }

    if (!isValid) {
      await increment2faAttempts(userId);
      return NextResponse.json(
        { error: "ERROR_INVALID_OR_EXPIRED_VERIFICATION_CODE" },
        { status: 401 },
      );
    }

    // Create session — match the full token structure from login route
    await reset2faRateLimit(userId);

    const primaryEntityRole = user.entityRoles[0];
    if (!primaryEntityRole) {
      return NextResponse.json({ error: "ERROR_NO_ENTITY_ASSIGNED" }, { status: 403 });
    }

    const entity = primaryEntityRole.entity;
    let tenantId: string | null = null;
    if (entity.entityType === "ORGANIZATION") {
      tenantId = entity.id;
    } else if (entity.entityType === "SUB_ACCOUNT" && entity.parentId) {
      tenantId = entity.parentId;
    }

    const userPayload: UserPayload = {
      id: user.id,
      email: user.email,
      roles: user.roles.map((ur: { role: { name: string } }) => ur.role.name),
      entityId: entity.id,
      entityType: entity.entityType as EntityTypeName,
      entityRole: primaryEntityRole.role as EntityRoleName,
      entityName: entity.officialName,
      tenantId,
      entityPath: entity.path,
      isBanned: false,
    };

    let ip =
      request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";
    
    // Prevent SSRF: sanitize IP
    ip = ip.replace(/[^0-9a-fA-F.:]/g, "");
    // Resolve to public IPv4 if running behind NAT/localhost
    const { getIPIntelligence, resolvePublicIP } = await import("@/lib/auth");
    ip = await resolvePublicIP(ip);
    const userAgent = request.headers.get("user-agent") || "unknown";
    const expiry = rememberMe ? "30d" : "24h";

    const ipIntel = await getIPIntelligence(ip);

    const token = await createToken(userPayload, expiry, {
      ip,
      userAgent,
      hardwareId,
      deviceName,
      deviceType,
      location: ipIntel.locationString,
      latitude: ipIntel.lat,
      longitude: ipIntel.lon,
      isp: ipIntel.isp,
      loginType: "new_device", // 2FA verify = always after step-up
    });

    // H1 fix: Use setSessionCookie for consistent cookie config
    await setSessionCookie(token, rememberMe);

    return NextResponse.json({
      success: true,
      user: {
        id: userPayload.id,
        email: userPayload.email,
        roles: userPayload.roles,
      },
    });
  } catch (error) {
    console.error("2FA verify error:", error);
    return NextResponse.json({ error: "ERROR_VERIFICATION_FAILED" }, { status: 500 });
  }
}
