import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";

/**
 * POST /api/invitations/accept — Accept an invitation by token
 *
 * Body: { token, name?, password? }
 *
 * Flow:
 *   1. Validate the token is still PENDING and not expired
 *   2. If user exists (by email) → add to entity
 *   3. If user doesn't exist → create account + add to entity
 *   4. Mark invitation as ACCEPTED
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, name, password } = body;

    if (!token || typeof token !== "string") {
      return NextResponse.json({ error: "ERROR_INVITATION_TOKEN_IS_REQUIRED" }, { status: 400 });
    }

    // Find the invitation
    const invitation = await prisma.invitation.findUnique({
      where: { token },
      include: {
        entity: { select: { id: true, officialName: true, entityType: true, isActive: true } },
      },
    });

    if (!invitation) {
      return NextResponse.json({ error: "ERROR_INVITATION_NOT_FOUND" }, { status: 404 });
    }

    if (invitation.status !== "PENDING") {
      return NextResponse.json(
        { error: `This invitation has already been ${invitation.status.toLowerCase()}` },
        { status: 400 },
      );
    }

    if (invitation.expiresAt < new Date()) {
      // Mark as expired
      await prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: "EXPIRED" },
      });
      return NextResponse.json({ error: "ERROR_INVITATION_HAS_EXPIRED" }, { status: 400 });
    }

    if (!invitation.entity.isActive) {
      return NextResponse.json({ error: "ERROR_ENTITY_IS_NO_LONGER_ACTIVE" }, { status: 400 });
    }

    // Check if user already exists
    let user = await prisma.user.findUnique({
      where: { email: invitation.email },
      select: { id: true, email: true, isActive: true, isBanned: true },
    });

    if (user) {
      // Existing user — validate account status
      if (!user.isActive) {
        return NextResponse.json({ error: "ERROR_ACCOUNT_IS_DEACTIVATED" }, { status: 400 });
      }
      if (user.isBanned) {
        return NextResponse.json({ error: "ERROR_ACCOUNT_IS_BANNED" }, { status: 400 });
      }

      // Check if already a member
      const existingRole = await prisma.userEntityRole.findUnique({
        where: { userId_entityId: { userId: user.id, entityId: invitation.entityId } },
      });
      if (existingRole) {
        // Mark invitation as accepted since user is already a member
        await prisma.invitation.update({
          where: { id: invitation.id },
          data: { status: "ACCEPTED", acceptedAt: new Date() },
        });
        return NextResponse.json({
          success: true,
          message: "You are already a member of this entity",
          isExistingUser: true,
        });
      }
    } else {
      // New user — must provide password
      if (!password || typeof password !== "string" || password.length < 8) {
        return NextResponse.json(
          { error: "ERROR_PASSWORD_IS_REQUIRED_MIN_8_CHARACTERS" },
          { status: 400 },
        );
      }

      const hashedPassword = await hashPassword(password);

      user = await prisma.user.create({
        data: {
          email: invitation.email,
          name: name?.trim() || invitation.email.split("@")[0],
          password: hashedPassword,
          isActive: true,
          isBanned: false,
        },
        select: { id: true, email: true, isActive: true, isBanned: true },
      });
    }

    // Add user to the entity with the invited role
    await prisma.userEntityRole.create({
      data: {
        userId: user.id,
        entityId: invitation.entityId,
        role: invitation.role,
      },
    });

    // Mark invitation as accepted
    await prisma.invitation.update({
      where: { id: invitation.id },
      data: { status: "ACCEPTED", acceptedAt: new Date() },
    });

    // Audit log
    await createAuditLog({
      userId: user.id,
      action: "invitation.accept",
      entityType: "invitation",
      entityId: invitation.id,
      newValue: {
        email: invitation.email,
        entityId: invitation.entityId,
        role: invitation.role,
        entityName: invitation.entity.officialName,
      },
    });

    // Notify the inviter
    try {
      await prisma.notification.create({
        data: {
          userId: invitation.invitedBy,
          type: "invitation_accepted",
          title: "Invitation Accepted",
          message: `${user.email} has accepted your invitation to join "${invitation.entity.officialName}"`,
          link: `/entities/${invitation.entityId}`,
        },
      });
    } catch {
      // Non-critical
    }

    return NextResponse.json({
      success: true,
      message: `Welcome to ${invitation.entity.officialName}!`,
      entity: {
        id: invitation.entity.id,
        officialName: invitation.entity.officialName,
        entityType: invitation.entity.entityType,
      },
      role: invitation.role,
      isExistingUser: !!user,
    });
  } catch (error) {
    console.error("Error accepting invitation:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_ACCEPT_INVITATION" }, { status: 500 });
  }
}

/**
 * GET /api/invitations/accept?token=xxx — Validate an invitation token (for UI)
 *
 * Returns invitation details without accepting it.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");

    if (!token) {
      return NextResponse.json({ error: "ERROR_TOKEN_IS_REQUIRED" }, { status: 400 });
    }

    const invitation = await prisma.invitation.findUnique({
      where: { token },
      include: {
        entity: { select: { id: true, officialName: true, entityType: true, logoUrl: true, isActive: true } },
        inviter: { select: { email: true, name: true } },
      },
    });

    if (!invitation) {
      return NextResponse.json({ error: "ERROR_INVITATION_NOT_FOUND" }, { status: 404 });
    }

    // Check if email already has an account
    const existingUser = await prisma.user.findUnique({
      where: { email: invitation.email },
      select: { id: true },
    });

    return NextResponse.json({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      isExpired: invitation.expiresAt < new Date(),
      entity: invitation.entity,
      inviter: invitation.inviter,
      hasExistingAccount: !!existingUser,
    });
  } catch (error) {
    console.error("Error validating invitation:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_VALIDATE_INVITATION" }, { status: 500 });
  }
}
