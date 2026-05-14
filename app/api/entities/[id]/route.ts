import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSecureSession, hasPermission, PERMISSIONS, isSystemAdmin } from "@/lib/auth";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSecureSession();
    if (!session || !hasPermission(session, PERMISSIONS.ENTITY_READ)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const { id } = await params;

    const entity = await prisma.businessEntity.findUnique({
      where: { id },
      include: {
        parent: { select: { id: true, officialName: true } },
        children: { select: { id: true, officialName: true, entityType: true, metadata: true } },
        userRoles: {
          include: { user: { select: { id: true, name: true, email: true, avatar: true } } }
        },
        invitations: {
          where: { status: "PENDING" },
          select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
          orderBy: { createdAt: "desc" }
        },
        _count: { select: { labels: true, releases: true, children: true } },
      },
    });

    if (!entity) {
      return NextResponse.json({ error: "ERROR_ENTITY_NOT_FOUND" }, { status: 404 });
    }

    // Security check: If not system admin, ensure the user has access to this entity's branch
    if (!isSystemAdmin(session)) {
      const { getAccessibleEntityIds } = await import("@/lib/entity-hierarchy");
      const accessibleIds = await getAccessibleEntityIds(session.entityId);
      if (!accessibleIds.includes(entity.id)) {
        return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
      }
    }

    return NextResponse.json(entity);
  } catch (error) {
    console.error("Error fetching entity:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_FETCH_ENTITY" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSecureSession();
    if (!session || !hasPermission(session, PERMISSIONS.ENTITY_UPDATE)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const { officialName, description, logoUrl, metadata } = body;

    // Security check: ensure the user is authorized to edit this entity
    if (!isSystemAdmin(session)) {
      const { getAccessibleEntityIds } = await import("@/lib/entity-hierarchy");
      const accessibleIds = await getAccessibleEntityIds(session.entityId);
      if (!accessibleIds.includes(id)) {
        return NextResponse.json({ error: "ERROR_ACCESS_DENIED_TO_UPDATE_ENTITY" }, { status: 403 });
      }
    }

    const updatedEntity = await prisma.businessEntity.update({
      where: { id },
      data: {
        officialName,
        description,
        logoUrl,
        metadata,
      },
    });

    return NextResponse.json({ data: updatedEntity });
  } catch (error) {
    console.error("Error updating entity:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_UPDATE_ENTITY" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSecureSession();
    if (!session || !isSystemAdmin(session)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED_ONLY_SYSTEM_ADMIN_CAN_DELETE" }, { status: 403 });
    }

    const { id } = await params;

    // Prevent deleting the system root entity
    const targetEntity = await prisma.businessEntity.findUnique({ where: { id } });
    if (!targetEntity) {
      return NextResponse.json({ error: "ERROR_ENTITY_NOT_FOUND" }, { status: 404 });
    }
    if (targetEntity.entityType === "SUPER_ADMIN" || targetEntity.entityType === "SYSTEM_ADMIN") {
      return NextResponse.json({ error: "ERROR_CANNOT_DELETE_SYSTEM_ROOT" }, { status: 400 });
    }

    // Prisma will cascade delete where onDelete: Cascade is configured.
    // If not, it will throw an error, which we catch.
    await prisma.businessEntity.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting entity:", error);
    return NextResponse.json({ error: "ERROR_DELETE_RESTRICTED_BY_CHILD_DATA" }, { status: 400 });
  }
}
