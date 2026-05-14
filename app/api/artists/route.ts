import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSession,
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

    if (!hasPermission(session, PERMISSIONS.ARTIST_READ)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const labelId = searchParams.get("labelId");
    const search = searchParams.get("search");
    let limit = parseInt(searchParams.get("limit") || "20");
    if (isNaN(limit) || limit < 1) limit = 20;
    limit = Math.min(limit, 100);
    let page = parseInt(searchParams.get("page") || "1");
    if (isNaN(page) || page < 1) page = 1;
    const sortBy = searchParams.get("sortBy") || "name";
    const sortOrder = (searchParams.get("sortOrder") || "asc") as "asc" | "desc";

    // B2B2B scoping: filter by tenant
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let whereClause: any = {};

    if (isSystemAdmin(session)) {
      // System admins see all artists (optionally filtered by tenantId query param)
      const filterTenantId = searchParams.get("tenantId");
      if (filterTenantId) whereClause.tenantId = filterTenantId;
    } else if (session.tenantId) {
      if (session.entityType === "SUB_ACCOUNT") {
        whereClause.tenantId = session.tenantId;
      } else {
        // Organization: see artists across entity hierarchy
        const accessibleIds = await getAccessibleEntityIds(session.entityId);
        whereClause.tenantId = { in: accessibleIds };
      }
    } else {
      return NextResponse.json([]);
    }

    if (labelId) whereClause.labelId = labelId;
    if (search) whereClause.name = { contains: search, mode: "insensitive" };

    const validSortFields: Record<string, string> = {
      name: "name",
      createdAt: "createdAt",
    };
    const orderField = validSortFields[sortBy] || "name";

    const total = await prisma.artist.count({ where: whereClause });
    const totalPages = Math.ceil(total / limit);
    const skip = (page - 1) * limit;

    const artists = await prisma.artist.findMany({
      where: whereClause,
      include: {
        label: { select: { id: true, name: true } },
        _count: { select: { releases: true, tracks: true } },
      },
      orderBy: { [orderField]: sortOrder },
      skip,
      take: limit,
    });

    const formattedArtists = artists.map((artist) => ({
      id: artist.id,
      name: artist.name,
      isni: artist.isni,
      ipi: artist.ipi,
      dpid: artist.dpid,
      spotifyId: artist.spotifyId,
      appleMusicId: artist.appleMusicId,
      vevoChannel: artist.vevoChannel,
      imageUrl: artist.imageUrl || null,
      label: artist.label,
      labelName: artist.label?.name || "Independent",
      releaseCount: artist._count.releases,
      trackCount: artist._count.tracks,
      createdAt: artist.createdAt,
    }));

    return NextResponse.json({ data: formattedArtists, total, page, limit, totalPages });
  } catch (error) {
    console.error("Error fetching artists:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_FETCH_ARTISTS" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }

    if (!hasPermission(session, PERMISSIONS.ARTIST_CREATE)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const body = await request.json();

    if (!body.name || body.name.trim() === "") {
      return NextResponse.json({ error: "ERROR_ARTIST_NAME_IS_REQUIRED" }, { status: 400 });
    }

    // Resolve tenant for this user
    const tenantId = session.tenantId || (isSystemAdmin(session) ? body.tenantId : null);
    if (!tenantId) {
      return NextResponse.json({ error: "ERROR_NO_TENANT_CONTEXT" }, { status: 400 });
    }

    // Validate label belongs to tenant
    let labelId = body.labelId || null;
    if (labelId) {
      const label = await prisma.label.findFirst({
        where: { id: labelId, tenantId },
      });
      if (!label) {
        return NextResponse.json(
          { error: "ERROR_CANNOT_ASSIGN_TO_A_LABEL_YOU_DO_NOT_MANAGE" },
          { status: 403 },
        );
      }
    }

    // Validate imageUrl scheme
    const imageUrl = body.imageUrl && typeof body.imageUrl === "string"
      ? (/^(https?:\/\/|\/uploads\/)/i.test(body.imageUrl) ? body.imageUrl : null)
      : null;

    const artist = await prisma.artist.create({
      data: {
        tenantId,
        name: body.name.trim(),
        isni: body.isni || null,
        ipi: body.ipi || null,
        dpid: body.dpid || null,
        labelId,
        spotifyId: body.spotifyId || null,
        appleMusicId: body.appleMusicId || null,
        vevoChannel: body.vevoChannel || null,
        imageUrl,
      },
      include: { label: true },
    });

    return NextResponse.json(artist, { status: 201 });
  } catch (error) {
    console.error("Error creating artist:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_CREATE_ARTIST" }, { status: 500 });
  }
}
