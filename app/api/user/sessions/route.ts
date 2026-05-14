import { NextResponse } from "next/server";
import { getSecureSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const session = await getSecureSession();
    if (!session) {
      return NextResponse.json({ error: "ERROR_UNAUTHORIZED" }, { status: 401 });
    }

    const authTokens = await prisma.authToken.findMany({
      where: {
        userId: session.id,
        isValid: true,
        expiresAt: { gt: new Date() },
      },
      orderBy: { lastUsedAt: "desc" },
      select: {
        id: true,
        ipAddress: true,
        userAgent: true,
        deviceName: true,
        deviceType: true,
        location: true,
        createdAt: true,
        lastUsedAt: true,
        tokenHash: true, // We need to know if it's the current session
      },
    });

    // We shouldn't send the full tokenHash to the client for security,
    // but we can map it to identify the "current" session
    const currentJti = session.jti;

    const safeTokens = authTokens.map((token) => {
      const isCurrent = token.tokenHash === currentJti;
      const { tokenHash, ...safeData } = token;
      return { ...safeData, isCurrent };
    });

    return NextResponse.json({ sessions: safeTokens });
  } catch (error) {
    console.error("Error fetching sessions:", error);
    return NextResponse.json(
      { error: "ERROR_INTERNAL_SERVER_ERROR" },
      { status: 500 },
    );
  }
}
