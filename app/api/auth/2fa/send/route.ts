import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma";

const TEMP_TOKEN_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "bealpha-dev-only-secret-key",
);

import { randomInt } from "crypto";

// Generate a random 6-digit code (B5 fix: cryptographically secure)
function generateCode(): string {
  return randomInt(100000, 1000000).toString();
}

// Mask email: jo***@example.com
function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (name.length <= 2) {
    return `${name[0]}***@${domain}`;
  }
  return `${name.slice(0, 2)}***@${domain}`;
}

// Mask phone: ***-***-1234
function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `***-***-${digits.slice(-4)}`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const tempToken = typeof body.tempToken === "string" ? body.tempToken : undefined;
    const method = typeof body.method === "string" ? body.method : undefined;

    if (!tempToken || !method) {
      return NextResponse.json(
        { error: "ERROR_MISSING_OR_INVALID_REQUIRED_FIELDS" },
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
        "2FA send token verification failed:",
        err instanceof Error ? err.message : err,
      );
      return NextResponse.json(
        { error: "ERROR_INVALID_OR_EXPIRED_SESSION" },
        { status: 401 },
      );
    }

    // D5 fix: Enforce method is in the allowed list from login
    if (allowedMethods.length > 0 && !allowedMethods.includes(method)) {
      return NextResponse.json(
        { error: "ERROR_VERIFICATION_METHOD_NOT_ALLOWED_FOR_THIS_SES" },
        { status: 403 },
      );
    }

    // Get user
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return NextResponse.json({ error: "ERROR_USER_NOT_FOUND" }, { status: 404 });
    }

    // Rate limit: max 5 codes per 10-minute window per user
    const recentCodes = await prisma.twoFactorCode.count({
      where: {
        userId,
        createdAt: { gt: new Date(Date.now() - 10 * 60 * 1000) },
      },
    });
    if (recentCodes >= 5) {
      return NextResponse.json(
        { error: "ERROR_TOO_MANY_CODE_REQUESTS_PLEASE_WAIT_BEFORE_TR" },
        { status: 429 },
      );
    }

    // Validate method
    if (method !== "email") {
      return NextResponse.json(
        { error: "ERROR_INVALID_VERIFICATION_METHOD" },
        { status: 400 },
      );
    }

    // Generate code
    const code = generateCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Clean up expired codes
    await prisma.twoFactorCode.deleteMany({
      where: {
        userId,
        expiresAt: { lt: new Date() },
      },
    });

    // Save code to database
    const savedCode = await prisma.twoFactorCode.create({
      data: {
        userId,
        code,
        method,
        expiresAt,
      },
    });

    let maskedContact = "";

    // Send code based on method
    if (method === "email") {
      maskedContact = maskEmail(user.email);
      const { sendTwoFactorCode } = await import("@/lib/email");
      const lang = user.language || "en";
      const result = await sendTwoFactorCode(user.email, code, "login", lang);
      if (!result.success) {
        if (process.env.NODE_ENV !== "production") {
          // Dev mode: SMTP may be rate-limited or unavailable
          // Log code to terminal so developer can still login
          console.warn(
            `\n [DEV] SMTP failed — 2FA code for ${user.email}: ${code}\n`,
          );
        } else {
          // Production: delete orphan code and return error
          await prisma.twoFactorCode
            .delete({ where: { id: savedCode.id } })
            .catch(() => {});
          console.error("Failed to send 2FA email:", result.error);
          return NextResponse.json(
            { error: "ERROR_FAILED_TO_SEND_VERIFICATION_CODE_PLEASE_TRY" },
            { status: 500 },
          );
        }
      }
    }

    return NextResponse.json({
      success: true,
      maskedContact,
    });
  } catch (error) {
    console.error("2FA send error:", error);
    return NextResponse.json(
      { error: "ERROR_FAILED_TO_SEND_VERIFICATION_CODE" },
      { status: 500 },
    );
  }
}
