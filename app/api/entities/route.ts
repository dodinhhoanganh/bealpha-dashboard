import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSession,
  getSecureSession,
  hasPermission,
  PERMISSIONS,
  isSystemAdmin,
  canCreateEntityType,
  type EntityTypeName,
} from "@/lib/auth";
import {
  getAccessibleEntityIds,
  buildEntityPath,
} from "@/lib/entity-hierarchy";
import { createAuditLog } from "@/lib/audit";

/**
 * GET /api/entities — List entities accessible to the user
 *
 * Query params:
 *   - type: EntityType filter (ORGANIZATION, SUB_ACCOUNT, etc.)
 *   - search: name search
 *   - parentId: filter by parent
 *   - page, limit: pagination
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }
    if (!hasPermission(session, PERMISSIONS.ENTITY_READ)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const typeFilter = searchParams.get("type") as EntityTypeName | null;
    const search = searchParams.get("search");
    const parentId = searchParams.get("parentId");
    let page = parseInt(searchParams.get("page") || "1");
    if (isNaN(page) || page < 1) page = 1;
    let limit = parseInt(searchParams.get("limit") || "20");
    if (isNaN(limit) || limit < 1) limit = 20;
    limit = Math.min(limit, 100);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const whereClause: any = { isActive: true };

    // Scope to accessible entities
    if (!isSystemAdmin(session)) {
      const accessibleIds = await getAccessibleEntityIds(session.entityId);
      whereClause.id = { in: accessibleIds };
    }

    if (typeFilter) whereClause.entityType = typeFilter;
    if (parentId) whereClause.parentId = parentId;
    if (search) {
      whereClause.officialName = { contains: search, mode: "insensitive" };
    }

    const [entities, total] = await Promise.all([
      prisma.businessEntity.findMany({
        where: whereClause,
        include: {
          parent: { select: { id: true, officialName: true, entityType: true } },
          _count: { select: { children: true, userRoles: true, labels: true, artists: true, releases: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.businessEntity.count({ where: whereClause }),
    ]);

    return NextResponse.json({
      data: entities.map((e) => ({
        id: e.id,
        entityType: e.entityType,
        officialName: e.officialName,
        path: e.path,
        logoUrl: e.logoUrl,
        description: e.description,
        isActive: e.isActive,
        parentId: e.parentId,
        parent: e.parent,
        metadata: e.metadata,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
        _count: e._count,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("Error fetching entities:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_FETCH_ENTITIES" }, { status: 500 });
  }
}

/**
 * POST /api/entities — Create a new entity (child of caller's entity)
 *
 * Body: { officialName, entityType, parentId?, description?, logoUrl?, metadata? }
 *
 * Rules:
 *   - SYSTEM_ADMIN can create ORGANIZATION
 *   - ORGANIZATION can create SUB_ACCOUNT
 *   - SUB_ACCOUNT cannot create children
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSecureSession();
    if (!session) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }
    if (!hasPermission(session, PERMISSIONS.ENTITY_CREATE)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const body = await request.json();
    const {
      officialName,
      entityType,
      parentId,
      description,
      logoUrl,
      metadata,
    } = body;

    // Validate required fields
    if (!officialName || typeof officialName !== "string" || !officialName.trim()) {
      return NextResponse.json({ error: "ERROR_OFFICIAL_NAME_IS_REQUIRED" }, { status: 400 });
    }
    if (!entityType) {
      return NextResponse.json({ error: "ERROR_ENTITY_TYPE_IS_REQUIRED" }, { status: 400 });
    }

    const validEntityTypes = ["SUPER_ADMIN", "SYSTEM_ADMIN", "ORGANIZATION", "SUB_ACCOUNT"];
    if (!validEntityTypes.includes(entityType)) {
      return NextResponse.json(
        { error: `Invalid entity type. Must be one of: ${validEntityTypes.join(", ")}` },
        { status: 400 },
      );
    }

    // Determine the parent entity
    const effectiveParentId = parentId || session.entityId;

    // Fetch parent to validate hierarchy rules
    const parentEntity = await prisma.businessEntity.findUnique({
      where: { id: effectiveParentId },
      select: { id: true, entityType: true, path: true, isActive: true },
    });

    if (!parentEntity) {
      return NextResponse.json({ error: "ERROR_PARENT_ENTITY_NOT_FOUND" }, { status: 404 });
    }
    if (!parentEntity.isActive) {
      return NextResponse.json({ error: "ERROR_PARENT_ENTITY_IS_DEACTIVATED" }, { status: 400 });
    }

    // Check if the parent type can create this child type
    if (!canCreateEntityType(parentEntity.entityType as EntityTypeName, entityType as EntityTypeName)) {
      return NextResponse.json(
        { error: `Entity type "${parentEntity.entityType}" cannot create child of type "${entityType}"` },
        { status: 400 },
      );
    }

    // Verify the user has access to the parent entity
    if (!isSystemAdmin(session)) {
      const accessibleIds = await getAccessibleEntityIds(session.entityId);
      if (!accessibleIds.includes(effectiveParentId)) {
        return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
      }
    }

    // Check for duplicate name under same parent
    const existing = await prisma.businessEntity.findFirst({
      where: {
        parentId: effectiveParentId,
        entityType: entityType,
        officialName: officialName.trim(),
        isActive: true,
      },
    });
    if (existing) {
      return NextResponse.json(
        { error: `An entity named "${officialName.trim()}" already exists under this parent` },
        { status: 409 },
      );
    }

    // Create the entity with a temporary path, then update with real path
    const entity = await prisma.businessEntity.create({
      data: {
        officialName: officialName.trim(),
        entityType: entityType,
        parentId: effectiveParentId,
        description: description?.trim() || null,
        logoUrl: logoUrl && typeof logoUrl === "string" && /^(https?:\/\/|\/uploads\/)/i.test(logoUrl) ? logoUrl : null,
        metadata: metadata || null,
        path: "temp", // Will be updated immediately
      },
    });

    // Update path with the generated ID
    const realPath = buildEntityPath(parentEntity.path, entity.id);
    await prisma.businessEntity.update({
      where: { id: entity.id },
      data: { path: realPath },
    });

    // Audit log
    await createAuditLog({
      userId: session.id,
      action: "entity.create",
      entityType: "businessEntity",
      entityId: entity.id,
      newValue: { officialName: entity.officialName, entityType: entity.entityType, parentId: effectiveParentId },
    });

    return NextResponse.json(
      { ...entity, path: realPath },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creating entity:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_CREATE_ENTITY" }, { status: 500 });
  }
}
