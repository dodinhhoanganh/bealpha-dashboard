import { NextResponse } from "next/server";
import { getSecureSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseDeviceFromUA } from "@/lib/security";

/**
 * GET /api/auth/sessions
 * List all active sessions for the current user.
 * Returns device info, location, IP, last activity, and login type.
 */
export async function GET() {
  try {
    const session = await getSecureSession();
    if (!session) {
      return NextResponse.json({ error: "ERROR_UNAUTHORIZED" }, { status: 401 });
    }

    const tokens = await prisma.authToken.findMany({
      where: {
        userId: session.id,
        isValid: true,
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        ipAddress: true,
        userAgent: true,
        deviceName: true,
        deviceType: true,
        location: true,
        isp: true,
        riskScore: true,
        loginType: true,
        createdAt: true,
        lastUsedAt: true,
        tokenHash: true,
      },
      orderBy: { lastUsedAt: "desc" },
    });

    // Mark which session is the current one
    const currentJti = session.jti;

    const sessions = tokens.map((t) => ({
      id: t.id,
      isCurrent: t.tokenHash === currentJti,
      device: t.deviceName || parseDeviceFromUA(t.userAgent || ""),
      deviceType: t.deviceType || "unknown",
      ipAddress: t.ipAddress || "unknown",
      location: t.location || "Unknown",
      isp: t.isp || undefined,
      riskScore: t.riskScore,
      loginType: t.loginType || "normal",
      createdAt: t.createdAt,
      lastUsedAt: t.lastUsedAt,
    }));

    return NextResponse.json({ sessions });
  } catch (error) {
    console.error("Sessions list error:", error);
    return NextResponse.json(
      { error: "ERROR_FAILED_TO_FETCH_SESSIONS" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/auth/sessions
 * Revoke a specific session by token ID.
 * Users can only revoke their own sessions (not the current one).
 */
export async function DELETE(request: Request) {
  try {
    const session = await getSecureSession();
    if (!session) {
      return NextResponse.json({ error: "ERROR_UNAUTHORIZED" }, { status: 401 });
    }

    const body = await request.json();
    const tokenId = body?.tokenId;
    if (!tokenId || typeof tokenId !== "string") {
      return NextResponse.json({ error: "ERROR_TOKEN_ID_REQUIRED" }, { status: 400 });
    }

    // Find the token and verify ownership
    const token = await prisma.authToken.findUnique({
      where: { id: tokenId },
      select: { id: true, userId: true, tokenHash: true, isValid: true },
    });

    if (!token || token.userId !== session.id) {
      return NextResponse.json({ error: "ERROR_SESSION_NOT_FOUND" }, { status: 404 });
    }

    // Prevent revoking current session
    if (token.tokenHash === session.jti) {
      return NextResponse.json({ error: "ERROR_CANNOT_REVOKE_CURRENT_SESSION" }, { status: 400 });
    }

    // Already revoked
    if (!token.isValid) {
      return NextResponse.json({ error: "ERROR_SESSION_ALREADY_REVOKED" }, { status: 400 });
    }

    // Revoke the session
    await prisma.authToken.update({
      where: { id: tokenId },
      data: { isValid: false },
    });

    return NextResponse.json({ success: true, message: "Session revoked successfully" });
  } catch (error) {
    console.error("Session revoke error:", error);
    return NextResponse.json(
      { error: "ERROR_FAILED_TO_REVOKE_SESSION" },
      { status: 500 },
    );
  }
}
