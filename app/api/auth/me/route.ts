import { NextRequest, NextResponse } from "next/server";
import { getSecureSession, getUserPermissions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const session = await getSecureSession();

    if (!session) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }

    // Fetch fresh user data with entity roles
    const user = await prisma.user.findUnique({
      where: { id: session.id as string },
      include: {
        roles: { include: { role: true } },
        entityRoles: {
          include: {
            entity: {
              select: {
                id: true,
                entityType: true,
                officialName: true,
                path: true,
                parentId: true,
                logoUrl: true,
              },
            },
          },
          orderBy: { createdAt: "asc" },
          take: 1,
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: "ERROR_USER_NOT_FOUND" }, { status: 404 });
    }

    const roles = user.roles.map((ur) => ur.role.name);
    const primaryEntityRole = user.entityRoles[0];

    if (!primaryEntityRole) {
      return NextResponse.json({ error: "ERROR_NO_ENTITY_ASSIGNED" }, { status: 403 });
    }

    const entity = primaryEntityRole.entity;

    // Resolve tenantId
    let tenantId: string | null = null;
    if (entity.entityType === "ORGANIZATION") {
      tenantId = entity.id;
    } else if (entity.entityType === "SUB_ACCOUNT" && entity.parentId) {
      tenantId = entity.parentId;
    }

    const permissions = getUserPermissions({
      id: user.id,
      email: user.email,
      roles,
      entityId: entity.id,
      entityType: entity.entityType as any,
      entityRole: primaryEntityRole.role as any,
      entityName: entity.officialName,
      tenantId,
      entityPath: entity.path,
    });

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        stageName: user.stageName,
        phone: user.phone,
        avatar: user.avatar,
        roles,
        permissions,
        // B2B2B entity context
        entityId: entity.id,
        entityType: entity.entityType,
        entityRole: primaryEntityRole.role,
        entityName: entity.officialName,
        entityLogo: entity.logoUrl,
        entityPath: entity.path,
        tenantId,
        // Security
        twoFactorEnabled: user.twoFactorEnabled,
        twoFactorMethod: user.twoFactorMethod,
        isBanned: user.isBanned,
        // Preferences
        language: user.language,
        timezone: user.timezone,
        currency: user.currency,
        theme: user.theme,
        notifyReleases: user.notifyReleases,
        notifyRoyalties: user.notifyRoyalties,
        notifyNews: user.notifyNews,
        notifyMarketing: user.notifyMarketing,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error("Get profile error:", error);
    return NextResponse.json({ error: "ERROR_AN_ERROR_OCCURRED" }, { status: 500 });
  }
}
