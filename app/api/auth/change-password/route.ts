import { NextRequest, NextResponse } from "next/server";
import { getSecureSession, verifyPassword, hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  try {
    // Security audit S8: Rate limit password change (10 req/min per IP)
    const limited = rateLimit(request, RATE_LIMITS.AUTH);
    if (limited) return limited;

    // B9 fix: use getSecureSession for stateful token check + theft detection
    const payload = await getSecureSession();
    if (!payload) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }

    const { currentPassword, newPassword } = await request.json();

    if (
      typeof currentPassword !== "string" ||
      typeof newPassword !== "string" ||
      currentPassword.length > 100 ||
      newPassword.length > 100
    ) {
      return NextResponse.json(
        { error: "ERROR_INVALID_PASSWORD_FORMAT" },
        { status: 400 },
      );
    }

    if (newPassword.length < 8) {
      return NextResponse.json(
        { error: "ERROR_NEW_PASSWORD_MUST_BE_AT_LEAST_8_CHARACTERS" },
        { status: 400 },
      );
    }

    // Server-side password complexity
    if (!/[A-Z]/.test(newPassword)) {
      return NextResponse.json(
        { error: "ERROR_PASSWORD_MUST_CONTAIN_AT_LEAST_ONE_UPPERCASE" },
        { status: 400 },
      );
    }
    if (!/[a-z]/.test(newPassword)) {
      return NextResponse.json(
        { error: "ERROR_PASSWORD_MUST_CONTAIN_AT_LEAST_ONE_LOWERCASE" },
        { status: 400 },
      );
    }
    if (!/[0-9]/.test(newPassword)) {
      return NextResponse.json(
        { error: "ERROR_PASSWORD_MUST_CONTAIN_AT_LEAST_ONE_NUMBER" },
        { status: 400 },
      );
    }
    // Security audit S9: Require at least one special character
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(newPassword)) {
      return NextResponse.json(
        { error: "ERROR_PASSWORD_MUST_CONTAIN_AT_LEAST_ONE_SPECIAL_CH" },
        { status: 400 },
      );
    }

    // Get user
    const user = await prisma.user.findUnique({
      where: { id: payload.id as string },
    });

    if (!user) {
      return NextResponse.json({ error: "ERROR_USER_NOT_FOUND" }, { status: 404 });
    }

    // D8 fix: Rate limit password verification
    if (user.lockoutUntil && new Date(user.lockoutUntil) > new Date()) {
      return NextResponse.json(
        { error: "ERROR_ACCOUNT_TEMPORARILY_LOCKED_DUE_TO_TOO_MANY_F" },
        { status: 429 },
      );
    }

    const isValid = await verifyPassword(currentPassword, user.password);
    if (!isValid) {
      // D8 fix: Increment failed attempts
      const newAttempts = (user.failedLoginAttempts || 0) + 1;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: newAttempts,
          lockoutUntil:
            newAttempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null,
        },
      });

      return NextResponse.json(
        { error: "ERROR_CURRENT_PASSWORD_IS_INCORRECT" },
        { status: 400 },
      );
    }

    const hashedPassword = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        failedLoginAttempts: 0,
        lockoutUntil: null,
        updatedAt: new Date(),
      },
    });

    // Invalidate all other sessions for security
    if (payload.jti) {
      await prisma.authToken.updateMany({
        where: {
          userId: user.id,
          tokenHash: { not: payload.jti },
          isValid: true,
        },
        data: { isValid: false },
      });
    }

    return NextResponse.json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error) {
    console.error("Change password error:", error);
    return NextResponse.json({ error: "ERROR_AN_ERROR_OCCURRED" }, { status: 500 });
  }
}
