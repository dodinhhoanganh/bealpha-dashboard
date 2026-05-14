import { NextRequest, NextResponse } from "next/server";
import { getSecureSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSecureSession();
    if (!session) {
      return NextResponse.json({ error: "ERROR_UNAUTHORIZED" }, { status: 401 });
    }

    const { id } = await params;

    // Check if token belongs to user
    const token = await prisma.authToken.findUnique({
      where: { id },
    });

    if (!token) {
      return NextResponse.json({ error: "ERROR_SESSION_NOT_FOUND" }, { status: 404 });
    }

    if (token.userId !== session.id) {
      return NextResponse.json({ error: "ERROR_FORBIDDEN" }, { status: 403 });
    }

    // Invalidate the token
    await prisma.authToken.update({
      where: { id },
      data: { isValid: false },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error revoking session:", error);
    return NextResponse.json(
      { error: "ERROR_INTERNAL_SERVER_ERROR" },
      { status: 500 },
    );
  }
}
