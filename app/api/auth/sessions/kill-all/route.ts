import { NextResponse } from "next/server";
import { getSecureSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/auth/sessions/kill-all
 * Invalidate ALL sessions except the current one.
 * "Sign out everywhere else" — like Google/Facebook.
 */
export async function POST() {
  try {
    const session = await getSecureSession();
    if (!session) {
      return NextResponse.json({ error: "ERROR_UNAUTHORIZED" }, { status: 401 });
    }

    const currentJti = session.jti;

    // Invalidate all tokens EXCEPT the current session
    const result = await prisma.authToken.updateMany({
      where: {
        userId: session.id,
        isValid: true,
        tokenHash: { not: currentJti },
      },
      data: { isValid: false },
    });

    // Create an in-app notification
    await prisma.notification
      .create({
        data: {
          userId: session.id,
          type: "system",
          title: "All Other Sessions Signed Out",
          message: `You signed out of ${result.count} other session(s). Only your current session remains active.`,
          link: "/settings/security",
        },
      })
      .catch(() => {});

    return NextResponse.json({
      success: true,
      killedCount: result.count,
    });
  } catch (error) {
    console.error("Kill all sessions error:", error);
    return NextResponse.json(
      { error: "ERROR_FAILED_TO_SIGN_OUT_OTHER_SESSIONS" },
      { status: 500 },
    );
  }
}
