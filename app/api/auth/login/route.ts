import { NextRequest, NextResponse } from "next/server";
import { verifyPassword, createToken, setSessionCookie } from "@/lib/auth";
import { SignJWT } from "jose";
import { prisma } from "@/lib/prisma";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";

const TEMP_TOKEN_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "bealpha-dev-only-secret-key",
);

// Helper: parse comma-separated methods string to array
function parseMethods(method: string | null): string[] {
  if (!method) return [];
  return method
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
}

export async function POST(request: NextRequest) {
  try {
    // Security audit fix H3: Rate limit auth endpoints (10 req/min per IP)
    const limited = rateLimit(request, RATE_LIMITS.AUTH);
    if (limited) return limited;

    const { email, password, rememberMe, hardwareId, deviceName, deviceType } =
      await request.json();

    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      email.length > 100 ||
      password.length > 100
    ) {
      return NextResponse.json(
        { error: "ERROR_INVALID_EMAIL_OR_PASSWORD_FORMAT" },
        { status: 400 },
      );
    }

    // Find user with roles
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
      },
    });

    if (!user) {
      // Mitigate timing attacks for user enumeration
      await verifyPassword(password, "$2b$12$K0jN.aYjN.aYjN.aYjN.aYjN.aYjN.aYjN.aYjN.aYjN.aYjN.aY").catch(() => {});
      return NextResponse.json(
        { error: "ERROR_INVALID_EMAIL_OR_PASSWORD" },
        { status: 401 },
      );
    }

    if (user.isBanned) {
      return NextResponse.json(
        {
          error: `Account is banned. Reason: ${user.banReason || "Violating terms of service"}`,
        },
        { status: 403 },
      );
    }

    if (!user.isActive) {
      return NextResponse.json(
        { error: "ERROR_ACCOUNT_IS_DEACTIVATED" },
        { status: 401 },
      );
    }

    // Check account lockout
    if (user.lockoutUntil && new Date(user.lockoutUntil) > new Date()) {
      const remainingMs = new Date(user.lockoutUntil).getTime() - Date.now();
      const remainingMin = Math.ceil(remainingMs / 60000);
      return NextResponse.json(
        {
          error: `Account temporarily locked. Try again in ${remainingMin} minute(s).`,
        },
        { status: 429 },
      );
    }

    const isValid = await verifyPassword(password, user.password);
    if (!isValid) {
      // Track failed login attempts
      const attempts = (user.failedLoginAttempts || 0) + 1;
      const MAX_ATTEMPTS = 5;
      const LOCKOUT_MINUTES = 15;

      const updateData: Record<string, unknown> = {
        failedLoginAttempts: attempts,
      };
      if (attempts >= MAX_ATTEMPTS) {
        updateData.lockoutUntil = new Date(
          Date.now() + LOCKOUT_MINUTES * 60 * 1000,
        );
        // Don't reset counter here — only reset on successful login
        // This prevents infinite retry cycles (5 tries → wait → 5 tries → ...)
      }

      await prisma.user.update({ where: { id: user.id }, data: updateData });

      if (attempts >= MAX_ATTEMPTS) {
        return NextResponse.json(
          {
            error: `Too many failed attempts. Account locked for ${LOCKOUT_MINUTES} minutes.`,
          },
          { status: 429 },
        );
      }

      return NextResponse.json(
        { error: "ERROR_INVALID_EMAIL_OR_PASSWORD" },
        { status: 401 },
      );
    }

    // Reset failed login attempts on successful login
    if (user.failedLoginAttempts > 0 || user.lockoutUntil) {
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockoutUntil: null },
      });
    }

    // Fetch entity assignment
    const primaryEntityRole = await prisma.userEntityRole.findFirst({
      where: { userId: user.id },
      include: {
        entity: {
          select: { id: true, entityType: true, officialName: true, path: true, parentId: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    if (!primaryEntityRole) {
      return NextResponse.json({ error: "ERROR_NO_ENTITY_ASSIGNED" }, { status: 403 });
    }

    const entity = primaryEntityRole.entity;
    let tenantId: string | null = null;
    if (entity.entityType === "ORGANIZATION") tenantId = entity.id;
    else if (entity.entityType === "SUB_ACCOUNT" && entity.parentId) tenantId = entity.parentId;

    const userPayload = {
      id: user.id,
      email: user.email,
      roles: user.roles.map((ur) => ur.role.name),
      isBanned: user.isBanned as false,
      entityId: entity.id,
      entityType: entity.entityType as any,
      entityRole: primaryEntityRole.role as any,
      entityName: entity.officialName,
      tenantId,
      entityPath: entity.path,
    };

    // ==========================================
    // Risk-Based Authentication Engine
    // ==========================================
    let ip =
      request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";

    // Prevent SSRF: sanitize IP to allow only valid IPv4/IPv6 characters
    ip = ip.replace(/[^0-9a-fA-F.:]/g, "");
    // Resolve to public IPv4 if running behind NAT/localhost
    const { getIPIntelligence, resolvePublicIP } = await import("@/lib/auth");
    ip = await resolvePublicIP(ip);
    const userAgent = request.headers.get("user-agent") || "unknown";
    const lang = user.language || "en";

    // Get full IP intelligence (geo + ISP)
    const ipIntel = await getIPIntelligence(ip);

    const { isLocalIP } = await import("@/lib/auth");
    const isLocalIp = ip === "unknown" || isLocalIP(ip);

    // Risk assessment (production only)
    let riskScore = 0;
    let loginType = "normal";
    let riskDecision: "allow" | "step_up" | "block" = "allow";

    if (process.env.NODE_ENV === "production") {
      const {
        calculateRiskScore,
        getRiskDecision,
        classifyLoginType,
        checkImpossibleTravel,
      } = await import("@/lib/security");

      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      // Factor 1: Known Device (Hardware ID within 30d)
      const safeHardwareId = typeof hardwareId === "string" ? hardwareId.substring(0, 100) : undefined;
      const safeDeviceName = typeof deviceName === "string" ? deviceName.substring(0, 100) : undefined;
      const safeDeviceType = typeof deviceType === "string" ? deviceType.substring(0, 100) : undefined;

      const knownDevice = safeHardwareId
        ? await prisma.authToken.findFirst({
            where: {
              userId: user.id,
              hardwareId: safeHardwareId,
              lastUsedAt: { gte: thirtyDaysAgo },
            },
          })
        : null;

      // Factor 2: Known IP (within 30d)
      const knownIp = await prisma.authToken.findFirst({
        where: {
          userId: user.id,
          ipAddress: ip,
          lastUsedAt: { gte: thirtyDaysAgo },
        },
      });

      // Factor 3: Known Location (same city within 30d)
      const knownLocation = ipIntel.city
        ? await prisma.authToken.findFirst({
            where: {
              userId: user.id,
              location: { contains: ipIntel.city },
              lastUsedAt: { gte: thirtyDaysAgo },
            },
          })
        : null;

      // Factor 4: Impossible Travel (Haversine geo-velocity)
      let impossibleTravel = false;
      const lastToken = await prisma.authToken.findFirst({
        where: { userId: user.id, isValid: true },
        orderBy: { lastUsedAt: "desc" },
        select: { latitude: true, longitude: true, lastUsedAt: true },
      });

      if (
        lastToken?.latitude != null &&
        lastToken?.longitude != null &&
        ipIntel.lat != null &&
        ipIntel.lon != null
      ) {
        const travelResult = checkImpossibleTravel(
          ipIntel.lat,
          ipIntel.lon,
          new Date(),
          Number(lastToken.latitude),
          Number(lastToken.longitude),
          lastToken.lastUsedAt,
        );
        impossibleTravel = travelResult.impossible;
        if (impossibleTravel) {
          console.warn(
            `[SECURITY] Impossible travel detected for ${user.email}: ${travelResult.distance}km in ${travelResult.timeDeltaHours.toFixed(1)}h (${travelResult.velocity} km/h)`,
          );
        }
      }

      // Factor 5: Time since last login
      const lastLogin = await prisma.authToken.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      const daysSinceLastLogin = lastLogin
        ? (Date.now() - lastLogin.createdAt.getTime()) / (1000 * 60 * 60 * 24)
        : 999;

      // Calculate weighted risk score
      const factors = {
        isKnownDevice: !!knownDevice,
        isKnownIP: !!knownIp,
        isKnownLocation: !!knownLocation,
        impossibleTravel,
        timeSinceLastLoginDays: daysSinceLastLogin,
        deviceFingerprintMatch: !!knownDevice,
      };

      riskScore = calculateRiskScore(factors);
      riskDecision = getRiskDecision(riskScore);
      loginType = classifyLoginType(factors);
    }

    // ── Decision: BLOCK (score 71-100) ──
    if (riskDecision === "block") {
      // Lock account for 24 hours
      await prisma.user.update({
        where: { id: user.id },
        data: { lockoutUntil: new Date(Date.now() + 24 * 60 * 60 * 1000) },
      });

      // Invalidate all sessions
      await prisma.authToken.updateMany({
        where: { userId: user.id, isValid: true },
        data: { isValid: false },
      });

      // Send security alert email
      try {
        const { sendSecurityAlert } = await import("@/lib/email");
        await sendSecurityAlert(
          user.email,
          {
            userAgent,
            ipAddress: ip,
            location: ipIntel.locationString,
            timestamp: new Date(),
            reason:
              loginType === "impossible_travel"
                ? "Impossible Travel Detected"
                : "High-Risk Login Blocked",
          },
          lang,
        );
      } catch (e) {
        console.error("Security alert email failed:", e);
      }

      // Notification
      prisma.notification
        .create({
          data: {
            userId: user.id,
            type: "system",
            title: "Security Alert: Login Blocked",
            message: `A high-risk login attempt was blocked from ${ipIntel.locationString || ip}. Your account has been temporarily locked for your security.`,
            link: "/settings/security",
          },
        })
        .catch(() => {});

      return NextResponse.json(
        {
          error: "ERROR_LOGIN_BLOCKED_DUE_TO_SUSPICIOUS_ACTIVITY_CHE",
        },
        { status: 403 },
      );
    }

    // ── Decision: STEP_UP (score 31-70) → Force 2FA ──
    if (riskDecision === "step_up") {
      const tempToken = await new SignJWT({
        userId: user.id,
        purpose: "2fa",
        allowedMethods: ["email"],
      })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("10m")
        .sign(TEMP_TOKEN_SECRET);

      const { randomInt } = await import("crypto");
      const code = randomInt(100000, 1000000).toString();

      await prisma.twoFactorCode.create({
        data: {
          userId: user.id,
          code,
          method: "email",
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });

      try {
        const { sendTwoFactorCode } = await import("@/lib/email");
        await sendTwoFactorCode(user.email, code, "login", lang);
      } catch {
        if (process.env.NODE_ENV !== "production") {
          console.warn(
            `\n [DEV] SMTP failed — 2FA code for ${user.email}: ${code}\n`,
          );
        }
      }

      return NextResponse.json({
        twoFactorRequired: true,
        methods: ["email"],
        isNewLocation: true,
        tempToken,
      });
    }

    // ── Decision: ALLOW (score 0-30) ──
    // But still check if user has 2FA enabled voluntarily
    if (user.twoFactorEnabled && user.twoFactorMethod) {
      const configuredMethods = parseMethods(user.twoFactorMethod);
      const validMethods: string[] = [];

      for (const m of configuredMethods) {
        if (m === "app" && user.twoFactorSecret) validMethods.push("app");
        else if (m === "email") validMethods.push("email");
      }

      if (validMethods.length === 0 && user.email) {
        validMethods.push("email");
      }

      const tempToken = await new SignJWT({
        userId: user.id,
        purpose: "2fa",
        allowedMethods: validMethods,
      })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("10m")
        .sign(TEMP_TOKEN_SECRET);

      return NextResponse.json({
        twoFactorRequired: true,
        methods: validMethods,
        tempToken,
      });
    }

    // No 2FA required — create session with full geo context
    const expiry = rememberMe ? "30d" : "24h";

    const token = await createToken(userPayload, expiry, {
      ip,
      userAgent,
      hardwareId: typeof hardwareId === "string" ? hardwareId.substring(0, 100) : undefined,
      deviceName: typeof deviceName === "string" ? deviceName.substring(0, 100) : undefined,
      deviceType: typeof deviceType === "string" ? deviceType.substring(0, 100) : undefined,
      location: ipIntel.locationString,
      latitude: ipIntel.lat,
      longitude: ipIntel.lon,
      isp: ipIntel.isp,
      riskScore,
      loginType,
    });

    await setSessionCookie(token, rememberMe);

    // Send new login email if this is a new device/location (even if allowed)
    if (loginType !== "normal" && process.env.NODE_ENV === "production") {
      try {
        const { sendSuspiciousLoginAlert } = await import("@/lib/email");
        await sendSuspiciousLoginAlert(
          user.email,
          {
            userAgent,
            ipAddress: ip,
            location: ipIntel.locationString,
            timestamp: new Date(),
            reason: "New sign-in detected",
          },
          lang,
        );
      } catch (e) {
        console.error("Suspicious login alert failed:", e);
      }
    }

    return NextResponse.json({
      success: true,
      user: {
        id: userPayload.id,
        email: userPayload.email,
        roles: userPayload.roles,
      },
    });
  } catch (error) {
    console.error("Login API error:", error);
    return NextResponse.json({ error: "ERROR_AN_ERROR_OCCURRED" }, { status: 500 });
  }
}
