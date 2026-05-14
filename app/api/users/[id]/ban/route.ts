import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, getSecureSession, isAdmin } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";
interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST - Ban a user
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const session = await getSecureSession();

    if (!session || !isAdmin(session)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    // Prevent self-ban
    if (session.id === id) {
      return NextResponse.json(
        { error: "ERROR_CANNOT_BAN_YOURSELF" },
        { status: 400 },
      );
    }

    const body = await request.json();
    let reason = typeof body.reason === "string" ? body.reason : undefined;

    if (reason) {
      reason = reason.replace(/<[^>]*>/g, "").trim();
    }

    const user = await prisma.user.update({
      where: { id },
      data: {
        isBanned: true,
        banReason: reason || null,
      },
    });

    await createAuditLog({
      userId: session.id,
      action: "user.ban",
      entityType: "user",
      entityId: id,
      newValue: { isBanned: true, banReason: reason || null },
    });

    return NextResponse.json({
      success: true,
      message: `User ${user.email} has been banned`,
      user: {
        id: user.id,
        email: user.email,
        isBanned: user.isBanned,
        banReason: user.banReason,
      },
    });
  } catch (error) {
    console.error("Error banning user:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_BAN_USER" }, { status: 500 });
  }
}

// DELETE - Unban a user
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const session = await getSecureSession();

    if (!session || !isAdmin(session)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const user = await prisma.user.update({
      where: { id },
      data: {
        isBanned: false,
        banReason: null,
      },
    });

    await createAuditLog({
      userId: session.id,
      action: "user.unban",
      entityType: "user",
      entityId: id,
      newValue: { isBanned: false, banReason: null },
    });

    return NextResponse.json({
      success: true,
      message: `User ${user.email} has been unbanned`,
      user: {
        id: user.id,
        email: user.email,
        isBanned: user.isBanned,
      },
    });
  } catch (error) {
    console.error("Error unbanning user:", error);
    return NextResponse.json(
      { error: "ERROR_FAILED_TO_UNBAN_USER" },
      { status: 500 },
    );
  }
}
