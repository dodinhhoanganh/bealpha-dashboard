import { NextRequest, NextResponse } from "next/server";
import { getSecureSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * DELETE /api/auth/sessions/[id]
 * Kill a specific session by AuthToken ID.
 * Users can only kill their own sessions.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSecureSession();
    if (!session) {
      return NextResponse.json({ error: "ERROR_UNAUTHORIZED" }, { status: 401 });
    }

    const { id: tokenId } = await params;

    if (!tokenId) {
      return NextResponse.json(
        { error: "ERROR_SESSION_ID_IS_REQUIRED" },
        { status: 400 },
      );
    }

    // Find the token and verify ownership
    const token = await prisma.authToken.findUnique({
      where: { id: tokenId },
      select: { userId: true, tokenHash: true, isValid: true },
    });

    if (!token) {
      return NextResponse.json(
        { error: "ERROR_SESSION_NOT_FOUND" },
        { status: 404 },
      );
    }

    // Ensure user can only kill their own sessions
    if (token.userId !== session.id) {
      return NextResponse.json({ error: "ERROR_FORBIDDEN" }, { status: 403 });
    }

    // Prevent killing current session (use logout instead)
    if (token.tokenHash === session.jti) {
      return NextResponse.json(
        { error: "ERROR_CANNOT_KILL_CURRENT_SESSION_USE_LOGOUT_INSTE" },
        { status: 400 },
      );
    }

    // Invalidate the session
    await prisma.authToken.update({
      where: { id: tokenId },
      data: { isValid: false },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Kill session error:", error);
    return NextResponse.json(
      { error: "ERROR_FAILED_TO_KILL_SESSION" },
      { status: 500 },
    );
  }
}
