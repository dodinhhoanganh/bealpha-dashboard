import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSession,
  getSecureSession,
  hasPermission,
  hashPassword,
  isAdmin,
  isSystemAdmin,
  PERMISSIONS,
} from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";
import { deleteFileFromServer } from "@/lib/upload";
import { getAccessibleEntityIds } from "@/lib/entity-hierarchy";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    const { id } = await params;

    if (!session || !hasPermission(session, PERMISSIONS.USER_READ)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    // B2B2B access check
    if (!isSystemAdmin(session) && session.id !== id) {
      const accessibleEntityIds = await getAccessibleEntityIds(session.entityId);
      const targetEntityRoles = await prisma.userEntityRole.findMany({
        where: { userId: id },
        select: { entityId: true },
      });
      const hasAccess = targetEntityRoles.some((er) => accessibleEntityIds.includes(er.entityId));
      if (!hasAccess) {
        return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
      }
    }

    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        roles: { include: { role: true } },
        entityRoles: {
          include: {
            entity: {
              select: { id: true, entityType: true, officialName: true, logoUrl: true },
            },
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: "ERROR_USER_NOT_FOUND" }, { status: 404 });
    }

    return NextResponse.json({
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      avatar: user.avatar,
      isActive: user.isActive,
      isBanned: user.isBanned,
      banReason: user.banReason,
      twoFactorEnabled: user.twoFactorEnabled,
      twoFactorMethod: user.twoFactorMethod,
      roles: user.roles.map((r) => ({
        id: r.role.id,
        name: r.role.name,
        displayName: r.role.displayName,
      })),
      entities: user.entityRoles.map((er) => ({
        entityId: er.entity.id,
        entityType: er.entity.entityType,
        entityName: er.entity.officialName,
        entityLogo: er.entity.logoUrl,
        role: er.role,
      })),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
  } catch (error) {
    console.error("Error fetching user:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_LOAD_USER" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSecureSession();
    const { id } = await params;

    if (!session || !hasPermission(session, PERMISSIONS.USER_UPDATE)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    // B2B2B access check
    if (!isSystemAdmin(session) && session.id !== id) {
      const accessibleEntityIds = await getAccessibleEntityIds(session.entityId);
      const targetEntityRoles = await prisma.userEntityRole.findMany({
        where: { userId: id },
        select: { entityId: true },
      });
      const hasAccess = targetEntityRoles.some((er) => accessibleEntityIds.includes(er.entityId));
      if (!hasAccess) {
        return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
      }
    }

    const body = await request.json();
    const { email, password, phone, name, avatar, isActive, roles, isBanned, banReason, entityId, entityRole } = body;

    // Security: Filter out global profile properties for non-system admins
    let safeEmail = email;
    let safePassword = password;
    let safePhone = phone;
    let safeName = name;
    let safeAvatar = avatar;
    let safeIsActive = isActive;
    let safeRoles = roles;
    let safeIsBanned = isBanned;
    let safeBanReason = banReason;
    // Security audit S10b: Entity assignment changes require elevated permissions
    let safeEntityId = entityId;
    let safeEntityRole = entityRole;

    if (!isSystemAdmin(session)) {
      safeEmail = undefined;
      safePassword = undefined;
      safePhone = undefined;
      safeName = undefined;
      safeAvatar = undefined;
      safeIsActive = undefined;
      safeRoles = undefined;
      safeIsBanned = undefined;
      safeBanReason = undefined;
      // S10b: Non-system-admins can only reassign entities if they are OWNER/ADMIN of current entity
      if (session.entityRole !== "OWNER" && session.entityRole !== "ADMIN") {
        safeEntityId = undefined;
        safeEntityRole = undefined;
      }
    }

    // Validate email uniqueness
    if (safeEmail !== undefined) {
      const emailTrimmed = String(safeEmail).trim().toLowerCase();
      if (!emailTrimmed) {
        return NextResponse.json({ error: "ERROR_EMAIL_CANNOT_BE_EMPTY" }, { status: 400 });
      }
      const existingUser = await prisma.user.findFirst({
        where: { email: emailTrimmed, id: { not: id } },
        select: { id: true },
      });
      if (existingUser) {
        return NextResponse.json({ error: "ERROR_EMAIL_IS_ALREADY_IN_USE_BY_ANOTHER_ACCOUNT" }, { status: 409 });
      }
    }

    // Validate password
    if (safePassword !== undefined) {
      if (typeof safePassword !== "string" || safePassword.length > 100) {
        return NextResponse.json({ error: "ERROR_PASSWORD_MUST_BE_A_STRING_UNDER_100_CHARACTE" }, { status: 400 });
      }
      if (safePassword.length < 8) {
        return NextResponse.json({ error: "ERROR_PASSWORD_MUST_BE_AT_LEAST_8_CHARACTERS" }, { status: 400 });
      }
      if (!/[A-Z]/.test(safePassword) || !/[a-z]/.test(safePassword) || !/[0-9]/.test(safePassword)) {
        return NextResponse.json({ error: "ERROR_PASSWORD_MUST_CONTAIN_UPPERCASE_LOWERCASE_AN" }, { status: 400 });
      }
      // Security audit S9: Special character requirement
      if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(safePassword)) {
        return NextResponse.json({ error: "ERROR_PASSWORD_MUST_CONTAIN_AT_LEAST_ONE_SPECIAL_CH" }, { status: 400 });
      }
    }

    if (safeIsBanned !== undefined && !hasPermission(session, PERMISSIONS.USER_BAN)) {
      return NextResponse.json({ error: "ERROR_NO_PERMISSION_TO_BAN_USERS" }, { status: 403 });
    }

    if (safeRoles !== undefined) {
      if (!Array.isArray(safeRoles)) {
        return NextResponse.json({ error: "ERROR_ROLES_MUST_BE_AN_ARRAY_OF_IDS" }, { status: 400 });
      }
      
      // B2B2B Security: Check if user is trying to assign system roles
      if (safeRoles.length > 0 && !isSystemAdmin(session)) {
        const dbRoles = await prisma.role.findMany({
          where: { id: { in: safeRoles } },
          select: { isSystem: true, name: true }
        });
        const hasSystemRole = dbRoles.some((r) => r.isSystem);
        if (hasSystemRole) {
          return NextResponse.json({ error: "ERROR_NO_PERMISSION_TO_ASSIGN_SYSTEM_ROLES" }, { status: 403 });
        }
      }
    }

    if (safeIsBanned && session.id === id) {
      return NextResponse.json({ error: "ERROR_CANNOT_BAN_YOURSELF" }, { status: 400 });
    }

    const stripHtml = (s: string | undefined | null): string | undefined | null => {
      if (typeof s !== "string") return s;
      return s.replace(/<[^>]*>/g, "").trim();
    };

    const secureUrl = (url: string | undefined | null): string | undefined | null => {
      if (!url || typeof url !== "string") return url;
      if (!/^(https?:\/\/|\/uploads\/)/i.test(url)) return null;
      return url;
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: Record<string, any> = {};

    if (safeEmail !== undefined) {
      updateData.email = String(safeEmail).trim().toLowerCase();
    }
    if (safePhone !== undefined) updateData.phone = stripHtml(safePhone) || null;
    if (safeName !== undefined) {
      const sanitizedName = stripHtml(safeName);
      if (!sanitizedName || sanitizedName.length < 2 || sanitizedName.length > 100) {
        return NextResponse.json({ error: "ERROR_NAME_MUST_BE_BETWEEN_2_AND_100_CHARACTERS" }, { status: 400 });
      }
      updateData.name = sanitizedName;
    }

    if (safeAvatar !== undefined) {
      const existingUser = await prisma.user.findUnique({
        where: { id },
        select: { avatar: true },
      });
      if (existingUser?.avatar && existingUser.avatar !== safeAvatar) {
        await deleteFileFromServer(existingUser.avatar);
      }
      updateData.avatar = secureUrl(safeAvatar) || null;
    }

    if (safeIsActive !== undefined) {
      updateData.isActive = safeIsActive;
    }

    if (safePassword) {
      updateData.password = await hashPassword(safePassword);
    }

    if (safeIsBanned !== undefined) {
      updateData.isBanned = safeIsBanned;
      updateData.banReason = safeIsBanned ? safeBanReason || null : null;
    }

      const updatedUser = await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id }, data: updateData });
        
        if (safeRoles !== undefined) {
          await tx.userRole.deleteMany({ where: { userId: id } });
          if (safeRoles.length > 0) {
            await tx.userRole.createMany({
              data: safeRoles.map((roleId: string) => ({ userId: id, roleId })),
            });
          }
        }
        
        // Handle B2B2B Entity Assignment / Role update
        if (safeEntityId !== undefined || safeEntityRole !== undefined) {
          // Identify which userEntityRole we are authorized to update
          let currentEntityRole;
          const accessibleIds = !isSystemAdmin(session) ? await getAccessibleEntityIds(session.entityId) : [];

          if (!isSystemAdmin(session)) {
            // Find the role within our accessible hierarchy to update
            currentEntityRole = await tx.userEntityRole.findFirst({
              where: { userId: id, entityId: { in: accessibleIds } },
              orderBy: { createdAt: "asc" }
            });
          } else {
            // System Admins can update any role, default to first if none specified
            currentEntityRole = await tx.userEntityRole.findFirst({
              where: { userId: id, ...(safeEntityId && { entityId: safeEntityId }) },
              orderBy: { createdAt: "asc" }
            });
          }
          
          const newEntityId = safeEntityId !== undefined ? safeEntityId : currentEntityRole?.entityId;
          const newRole = safeEntityRole !== undefined ? safeEntityRole : (currentEntityRole?.role || "MEMBER");
          
          if (newEntityId) {
             // Check access to target entity
             if (!isSystemAdmin(session)) {
                if (!accessibleIds.includes(newEntityId)) {
                   throw new Error("ERROR_CANNOT_ASSIGN_USER_TO_UNAUTHORIZED_ENTITY");
                }
             }
             
             if (currentEntityRole) {
               await tx.userEntityRole.update({
                 where: { id: currentEntityRole.id },
                 data: { entityId: newEntityId, role: newRole }
               });
             } else {
               await tx.userEntityRole.create({
                 data: { userId: id, entityId: newEntityId, role: newRole }
               });
             }
          } else if (currentEntityRole && safeEntityId === "") {
             // User requested to remove from organization
             if (!isSystemAdmin(session)) {
                 throw new Error("ERROR_ONLY_SYSTEM_ADMIN_CAN_REMOVE_USER_FROM_ORGANIZATION");
             }
             await tx.userEntityRole.delete({ where: { id: currentEntityRole.id } });
          }
        }

        return tx.user.findUnique({
          where: { id },
          include: { 
            roles: { include: { role: true } },
            entityRoles: { include: { entity: { select: { id: true, entityType: true, officialName: true } } } }
          },
        });
      });

      await createAuditLog({
        userId: session.id,
        action: "user.update",
        entityType: "user",
        entityId: id,
        newValue: updateData,
      });

      return NextResponse.json({
        id: updatedUser!.id,
        email: updatedUser!.email,
        phone: updatedUser!.phone,
        isActive: updatedUser!.isActive,
        isBanned: updatedUser!.isBanned,
        banReason: updatedUser!.banReason,
        roles: updatedUser!.roles.map((r) => ({
          id: r.role.id,
          name: r.role.name,
          displayName: r.role.displayName,
        })),
        entities: updatedUser!.entityRoles.map((er) => ({
          entityId: er.entity.id,
          entityType: er.entity.entityType,
          entityName: er.entity.officialName,
          role: er.role,
        })),
      });

  } catch (error: any) {
    if (error.message === "ERROR_CANNOT_ASSIGN_USER_TO_UNAUTHORIZED_ENTITY" || error.message === "ERROR_ONLY_SYSTEM_ADMIN_CAN_REMOVE_USER_FROM_ORGANIZATION") {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error("Error updating user:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_UPDATE_USER" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSecureSession();
    const { id } = await params;

    if (!session || !hasPermission(session, PERMISSIONS.USER_DELETE)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    // B2B2B access check
    if (!isSystemAdmin(session)) {
      const accessibleEntityIds = await getAccessibleEntityIds(session.entityId);
      const targetEntityRoles = await prisma.userEntityRole.findMany({
        where: { userId: id },
        select: { entityId: true },
      });
      const hasAccess = targetEntityRoles.some((er) => accessibleEntityIds.includes(er.entityId));
      if (!hasAccess) {
        return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
      }
    }

    if (session.id === id) {
      return NextResponse.json({ error: "ERROR_CANNOT_DELETE_YOUR_OWN_ACCOUNT" }, { status: 400 });
    }

    const targetUser = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, avatar: true },
    });

    if (!targetUser) {
      return NextResponse.json({ error: "ERROR_USER_NOT_FOUND" }, { status: 404 });
    }

    if (targetUser.avatar) {
      await deleteFileFromServer(targetUser.avatar);
    }

    // Delete user — cascades handle UserRole, UserEntityRole, Notification cleanup
    await prisma.user.delete({ where: { id } });

    await createAuditLog({
      userId: session.id,
      action: "user.delete",
      entityType: "user",
      entityId: id,
      oldValue: { email: targetUser.email },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting user:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_DELETE_USER" }, { status: 500 });
  }
}
