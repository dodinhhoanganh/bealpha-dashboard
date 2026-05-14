import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSession,
  getSecureSession,
  isAdmin,
  isSystemAdmin,
  hashPassword,
  hasPermission,
  PERMISSIONS,
} from "@/lib/auth";
import { getAccessibleEntityIds } from "@/lib/entity-hierarchy";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();

    if (!session || !hasPermission(session, PERMISSIONS.USER_READ)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search");
    const roleFilter = searchParams.get("role");
    const statusFilter = searchParams.get("status");
    let limit = parseInt(searchParams.get("limit") || "20");
    if (isNaN(limit) || limit < 1) limit = 20;
    limit = Math.min(limit, 100);
    let page = parseInt(searchParams.get("page") || "1");
    if (isNaN(page) || page < 1) page = 1;
    const sortBy = searchParams.get("sortBy") || "createdAt";
    const rawSortOrder = searchParams.get("sortOrder")?.toLowerCase();
    const sortOrder = (rawSortOrder === "asc" ? "asc" : "desc") as "asc" | "desc";

    // B2B2B scoping: users visible based on entity hierarchy
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let whereClause: any = {};

    if (isSystemAdmin(session)) {
      // System admins see all users (optionally filter by entityId)
      const filterEntityId = searchParams.get("entityId");
      if (filterEntityId) {
        whereClause.entityRoles = { some: { entityId: filterEntityId } };
      }
    } else {
      // Org/Sub-account: see users in their accessible entity hierarchy
      const accessibleEntityIds = await getAccessibleEntityIds(session.entityId);
      whereClause.entityRoles = {
        some: { entityId: { in: accessibleEntityIds } },
      };
    }

    // Apply filters (wrapped in AND to preserve entity scoping)
    if (search) {
      whereClause.AND = [
        {
          OR: [
            { email: { contains: search, mode: "insensitive" as const } },
            { name: { contains: search, mode: "insensitive" as const } },
            { phone: { contains: search } },
          ],
        },
      ];
    }
    if (roleFilter) {
      whereClause.roles = { some: { role: { name: roleFilter } } };
    }
    if (statusFilter === "active") {
      whereClause.isActive = true;
      whereClause.isBanned = false;
    }
    if (statusFilter === "inactive") whereClause.isActive = false;
    if (statusFilter === "banned") whereClause.isBanned = true;

    const total = await prisma.user.count({ where: whereClause });
    const totalPages = Math.ceil(total / limit);
    const skip = (page - 1) * limit;

    const validSortFields: Record<string, string> = {
      email: "email",
      name: "name",
      createdAt: "createdAt",
    };
    const orderField = validSortFields[sortBy] || "createdAt";

    const users = await prisma.user.findMany({
      where: whereClause,
      include: {
        roles: { include: { role: true } },
        entityRoles: {
          include: {
            entity: {
              select: { id: true, entityType: true, officialName: true },
            },
          },
        },
      },
      orderBy: { [orderField]: sortOrder },
      skip,
      take: limit,
    });

    const formattedUsers = users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      isActive: user.isActive,
      isBanned: user.isBanned,
      banReason: user.banReason,
      twoFactorEnabled: user.twoFactorEnabled,
      roles: user.roles.map((r) => ({
        id: r.role.id,
        name: r.role.name,
        displayName: r.role.displayName,
      })),
      entities: user.entityRoles.map((er) => ({
        entityId: er.entity.id,
        entityType: er.entity.entityType,
        entityName: er.entity.officialName,
        role: er.role,
      })),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    }));

    return NextResponse.json({ data: formattedUsers, total, page, limit, totalPages });
  } catch (error) {
    console.error("Error fetching users:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_LOAD_USERS" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSecureSession();

    if (!session || !hasPermission(session, PERMISSIONS.USER_CREATE)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const body = await request.json();
    const { email, password, phone, name, roles, entityId, entityRole } = body;

    // Validate inputs
    if (typeof email !== "string" || typeof password !== "string" || email.length > 100 || password.length > 100) {
      return NextResponse.json({ error: "ERROR_INVALID_EMAIL_OR_PASSWORD_FORMAT" }, { status: 400 });
    }

    if (roles !== undefined) {
      if (!Array.isArray(roles)) {
        return NextResponse.json({ error: "ERROR_ROLES_MUST_BE_AN_ARRAY_OF_IDS" }, { status: 400 });
      }
      
      // B2B2B Security: Check if user is trying to assign system roles
      if (roles.length > 0 && !isSystemAdmin(session)) {
        const dbRoles = await prisma.role.findMany({
          where: { id: { in: roles } },
          select: { isSystem: true, name: true }
        });
        const hasSystemRole = dbRoles.some((r) => r.isSystem);
        if (hasSystemRole) {
          return NextResponse.json({ error: "ERROR_NO_PERMISSION_TO_ASSIGN_SYSTEM_ROLES" }, { status: 403 });
        }
      }
    }

    const stripHtml = (s: string): string => s.replace(/<[^>]*>/g, "").trim();
    const sanitizedName = name && typeof name === "string" ? stripHtml(name) : "";

    if (sanitizedName.length < 2 || sanitizedName.length > 100) {
      return NextResponse.json({ error: "ERROR_NAME_MUST_BE_BETWEEN_2_AND_100_CHARACTERS" }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: "ERROR_PASSWORD_MUST_BE_AT_LEAST_8_CHARACTERS" }, { status: 400 });
    }
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
      return NextResponse.json({ error: "ERROR_PASSWORD_MUST_CONTAIN_UPPERCASE_LOWERCASE_AN" }, { status: 400 });
    }
    // Security audit S9: Require special character
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
      return NextResponse.json({ error: "ERROR_PASSWORD_MUST_CONTAIN_AT_LEAST_ONE_SPECIAL_CH" }, { status: 400 });
    }

    // Check duplicate email
    const existingUser = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (existingUser) {
      return NextResponse.json({ error: "ERROR_EMAIL_ALREADY_IN_USE" }, { status: 400 });
    }

    // B2B2B: Validate entity assignment
    // The target entity must be accessible by the creator
    const targetEntityId = entityId || session.entityId;
    const accessibleEntityIds = await getAccessibleEntityIds(session.entityId);
    if (!isSystemAdmin(session) && !accessibleEntityIds.includes(targetEntityId)) {
      return NextResponse.json({ error: "ERROR_CANNOT_CREATE_USER_IN_THIS_ENTITY" }, { status: 403 });
    }

    // Security audit S10: Prevent entityRole privilege escalation.
    // Non-system-admins cannot assign OWNER or ADMIN role to users they create.
    const allowedRoles = ["MEMBER"];
    if (isSystemAdmin(session) || session.entityRole === "OWNER") {
      allowedRoles.push("ADMIN", "OWNER");
    } else if (session.entityRole === "ADMIN") {
      allowedRoles.push("ADMIN");
    }
    const safeEntityRole = entityRole || "MEMBER";
    if (!allowedRoles.includes(safeEntityRole)) {
      return NextResponse.json({ error: "ERROR_CANNOT_ASSIGN_THIS_ENTITY_ROLE" }, { status: 403 });
    }

    // Enforce SUB_ACCOUNT 1-user limit
    const targetEntity = await prisma.businessEntity.findUnique({
      where: { id: targetEntityId },
      select: { entityType: true, _count: { select: { userRoles: true } } }
    });
    
    if (targetEntity?.entityType === "SUB_ACCOUNT" && targetEntity._count.userRoles >= 1) {
      return NextResponse.json({ error: "ERROR_SUBACCOUNT_SINGLE_USER_LIMIT" }, { status: 400 });
    }

    const hashedPassword = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        email: email.trim().toLowerCase(),
        password: hashedPassword,
        phone: phone ? stripHtml(phone) : null,
        name: sanitizedName,
        isActive: true,
        roles: {
          create: roles?.map((roleId: string) => ({ roleId })) || [],
        },
        entityRoles: {
          create: {
            entityId: targetEntityId,
            role: safeEntityRole,
          },
        },
      },
      include: {
        roles: { include: { role: true } },
        entityRoles: {
          include: {
            entity: {
              select: { id: true, entityType: true, officialName: true },
            },
          },
        },
      },
    });

    return NextResponse.json(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        isActive: user.isActive,
        isBanned: user.isBanned,
        roles: user.roles.map((r) => ({
          id: r.role.id,
          name: r.role.name,
          displayName: r.role.displayName,
        })),
        entities: user.entityRoles.map((er) => ({
          entityId: er.entity.id,
          entityType: er.entity.entityType,
          entityName: er.entity.officialName,
          role: er.role,
        })),
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creating user:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_CREATE_USER" }, { status: 500 });
  }
}
