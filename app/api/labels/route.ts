import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSession,
  getSecureSession,
  hasPermission,
  PERMISSIONS,
  isSystemAdmin,
} from "@/lib/auth";
import { getAccessibleEntityIds } from "@/lib/entity-hierarchy";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }

    if (!hasPermission(session, PERMISSIONS.LABEL_READ)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search");
    let limit = parseInt(searchParams.get("limit") || "20");
    if (isNaN(limit) || limit < 1) limit = 20;
    limit = Math.min(limit, 100);
    let page = parseInt(searchParams.get("page") || "1");
    if (isNaN(page) || page < 1) page = 1;
    const sortBy = searchParams.get("sortBy") || "name";
    const sortOrder = (searchParams.get("sortOrder") || "asc") as "asc" | "desc";

    // B2B2B scoping by tenant
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let whereClause: any = {};

    if (isSystemAdmin(session)) {
      const filterTenantId = searchParams.get("tenantId");
      if (filterTenantId) whereClause.tenantId = filterTenantId;
    } else if (session.tenantId) {
      if (session.entityType === "SUB_ACCOUNT") {
        whereClause.tenantId = session.tenantId;
      } else {
        // Organization: see labels across entity hierarchy
        const accessibleIds = await getAccessibleEntityIds(session.entityId);
        whereClause.tenantId = { in: accessibleIds };
      }
    } else {
      return NextResponse.json([]);
    }

    if (search) {
      whereClause.name = { contains: search, mode: "insensitive" };
    }

    const total = await prisma.label.count({ where: whereClause });
    const totalPages = Math.ceil(total / limit);
    const skip = (page - 1) * limit;

    const validSortFields: Record<string, string> = {
      name: "name",
      createdAt: "createdAt",
    };
    const orderField = validSortFields[sortBy] || "name";

    const labels = await prisma.label.findMany({
      where: whereClause,
      include: {
        _count: { select: { artists: true, releases: true } },
      },
      orderBy: { [orderField]: sortOrder },
      skip,
      take: limit,
    });

    const formattedLabels = labels.map((label) => ({
      id: label.id,
      name: label.name,
      description: label.description,
      dpid: label.dpid,
      ddexPartyName: label.ddexPartyName,
      logoUrl: label.logoUrl,
      artistCount: label._count.artists,
      releaseCount: label._count.releases,
      createdAt: label.createdAt,
    }));

    return NextResponse.json({ data: formattedLabels, total, page, limit, totalPages });
  } catch (error) {
    console.error("Error fetching labels:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_FETCH_LABELS" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSecureSession();

    if (!session) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }

    if (!hasPermission(session, PERMISSIONS.LABEL_CREATE)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const body = await request.json();

    if (!body.name || body.name.trim() === "") {
      return NextResponse.json({ error: "ERROR_LABEL_NAME_IS_REQUIRED" }, { status: 400 });
    }

    // Resolve tenant
    const tenantId = session.tenantId || (isSystemAdmin(session) ? body.tenantId : null);
    if (!tenantId) {
      return NextResponse.json({ error: "ERROR_NO_TENANT_CONTEXT" }, { status: 400 });
    }

    const label = await prisma.label.create({
      data: {
        tenantId,
        name: body.name.trim(),
        description: body.description || null,
        dpid: body.dpid?.trim() || null,
        ddexPartyName: body.ddexPartyName?.trim() || null,
        logoUrl: body.logoUrl && typeof body.logoUrl === "string" && /^(https?:\/\/|\/uploads\/)/i.test(body.logoUrl)
          ? body.logoUrl
          : null,
      },
    });

    return NextResponse.json(label, { status: 201 });
  } catch (error) {
    console.error("Error creating label:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_CREATE_LABEL" }, { status: 500 });
  }
}
