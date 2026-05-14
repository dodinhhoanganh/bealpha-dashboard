import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSession,
  getSecureSession,
  hasPermission,
  PERMISSIONS,
  isSystemAdmin,
} from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }

    if (!hasPermission(session, PERMISSIONS.RELEASE_READ)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search");
    let limit = parseInt(searchParams.get("limit") || "20");
    if (isNaN(limit) || limit < 1) limit = Number("20");
    limit = Math.min(limit, 100);
    let page = parseInt(searchParams.get("page") || "1");
    if (isNaN(page) || page < 1) page = 1;
    const sortBy = searchParams.get("sortBy") || "createdAt";
    const sortOrder = (searchParams.get("sortOrder") || "desc") as
      | "asc"
      | "desc";

    // Build where clause based on role and ownership
    let whereClause: Record<string, unknown> = {};

    if (isSystemAdmin(session) || session.roles.includes("moderator") || session.roles.includes("finance")) {
      // See all compositions
    } else if (session.tenantId) {
      if (session.entityType === "SUB_ACCOUNT") {
        if (session.roles.includes("artist")) {
          whereClause.tracks = {
            some: {
              release: {
                OR: [
                  { ownerId: session.entityId },
                  { artist: { name: session.entityName } }
                ]
              }
            }
          };
        } else {
          whereClause.tracks = { some: { release: { ownerId: session.entityId } } };
        }
      } else {
        // Organization: see compositions across entity hierarchy
        const { getAccessibleEntityIds } = await import("@/lib/entity-hierarchy");
        const accessibleIds = await getAccessibleEntityIds(session.entityId);
        whereClause.tracks = { some: { release: { tenantId: { in: accessibleIds } } } };
      }
    } else {
      return NextResponse.json({ data: [], total: 0, page: 1, limit, totalPages: 0 });
    }

    // Apply search filter
    if (search) {
      whereClause.title = { contains: search, mode: "insensitive" };
    }

    // Pagination
    const total = await prisma.composition.count({ where: whereClause });
    const totalPages = Math.ceil(total / limit);
    const skip = (page - 1) * limit;

    const validSortFields: Record<string, string> = {
      title: "title",
      createdAt: "createdAt",
    };
    const orderField = validSortFields[sortBy] || "createdAt";

    const compositions = await prisma.composition.findMany({
      where: whereClause,
      include: {
        tracks: {
          select: { id: true, title: true, isrc: true },
        },
      },
      orderBy: { [orderField]: sortOrder },
      skip,
      take: limit,
    });

    return NextResponse.json({
      data: compositions,
      total,
      page,
      limit,
      totalPages,
    });
  } catch (error) {
    console.error("Error fetching compositions:", error);
    return NextResponse.json(
      { error: "ERROR_FAILED_TO_FETCH_COMPOSITIONS" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSecureSession();

    if (!session) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }

    if (!hasPermission(session, PERMISSIONS.RELEASE_CREATE)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const body = await request.json();

    if (!body.title || body.title.trim() === "") {
      return NextResponse.json(
        { error: "ERROR_COMPOSITION_TITLE_IS_REQUIRED" },
        { status: 400 },
      );
    }

    // Validate authors structure if provided (DDEX Rules 0-4)
    if (body.authors) {
      if (!Array.isArray(body.authors)) {
        return NextResponse.json(
          { error: "ERROR_AUTHORS_MUST_BE_AN_ARRAY" },
          { status: 400 },
        );
      }

      const VALID_ROLES = [
        "Author",
        "Composer",
        "Arranger",
        "Adapter",
        "Translator",
        "Lyricist",
      ];

      // Validate each author has required fields
      for (const author of body.authors) {
        if (!author.name || !author.role) {
          return NextResponse.json(
            { error: "ERROR_EACH_AUTHOR_MUST_HAVE_NAME_AND_ROLE" },
            { status: 400 },
          );
        }
        // Rule 1: validate role against allowed values
        if (!VALID_ROLES.includes(author.role)) {
          return NextResponse.json(
            {
              error: `Invalid role "${author.role}" for "${author.name}". Allowed: ${VALID_ROLES.join(", ")}`,
            },
            { status: 400 },
          );
        }
        // Rule 2: no zero shares
        if (author.share !== undefined && Number(author.share) === 0) {
          return NextResponse.json(
            { error: `Share for "${author.name}" cannot be 0%` },
            { status: 400 },
          );
        }
        // Validate share range
        if (
          author.share !== undefined &&
          (author.share < 0 || author.share > 100)
        ) {
          return NextResponse.json(
            { error: "ERROR_AUTHOR_SHARE_MUST_BE_BETWEEN_0_AND_100" },
            { status: 400 },
          );
        }
      }

      // Apply default equal split if no shares specified
      const hasAnyShare = body.authors.some(
        (a: { share?: number }) => a.share !== undefined && a.share !== null,
      );
      if (!hasAnyShare && body.authors.length > 0) {
        const equalShare = Math.round((100 / body.authors.length) * 100) / 100;
        body.authors = body.authors.map((a: Record<string, unknown>) => ({
          ...a,
          share: equalShare,
        }));
      }

      // Rule 0: total shares must equal exactly 100% (hard error)
      const totalShare = body.authors.reduce(
        (sum: number, a: { share?: number }) => sum + (a.share || 0),
        0,
      );
      if (Math.abs(totalShare - 100) > 0.01) {
        return NextResponse.json(
          {
            error: `Total author shares must equal exactly 100% (current: ${totalShare}%)`,
          },
          { status: 400 },
        );
      }
    }

    const composition = await prisma.composition.create({
      data: {
        // Basic info
        title: body.title.trim(),
        titleLocalized: body.titleLocalized,
        subtitle: body.subtitle,
        subtitleLocalized: body.subtitleLocalized,
        alternativeTitle: body.alternativeTitle,
        alternativeTitleLocalized: body.alternativeTitleLocalized,
        // Identification
        iswc: body.iswc,
        catalogueNumber: body.catalogueNumber,
        // Details
        genre: body.genre,
        creationDate: body.creationDate ? new Date(body.creationDate) : null,
        lyricsLanguages: body.lyricsLanguages,
        lyricsFileName: body.lyricsFileName,
        // Territories
        territories: body.territories || "WORLDWIDE",
        excludingTerritories: body.excludingTerritories,
        // Contract
        contractPeriodBegins: body.contractPeriodBegins
          ? new Date(body.contractPeriodBegins)
          : null,
        contractPeriodEnds: body.contractPeriodEnds
          ? new Date(body.contractPeriodEnds)
          : null,
        contractNumber: body.contractNumber,
        // Authors (JSON)
        authors: body.authors || null,
      },
    });

    return NextResponse.json(composition, { status: 201 });
  } catch (error) {
    console.error("Error creating composition:", error);
    return NextResponse.json(
      { error: "ERROR_FAILED_TO_CREATE_COMPOSITION" },
      { status: 500 },
    );
  }
}
