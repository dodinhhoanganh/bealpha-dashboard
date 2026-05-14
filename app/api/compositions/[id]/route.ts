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

// Check if user has access to composition via entity hierarchy
async function hasCompositionAccess(
  session: Awaited<ReturnType<typeof getSession>>,
  compositionId: string,
): Promise<boolean> {
  if (!session) return false;
  if (isSystemAdmin(session) || session.roles.includes("moderator") || session.roles.includes("finance")) return true;

  let whereClause: Record<string, unknown> = {};
  if (session.entityType === "SUB_ACCOUNT") {
    if (session.roles.includes("artist")) {
      whereClause = {
        tracks: {
          some: {
            release: {
              OR: [
                { ownerId: session.entityId },
                { artist: { name: session.entityName } }
              ]
            }
          }
        }
      };
    } else {
      whereClause = { tracks: { some: { release: { ownerId: session.entityId } } } };
    }
  } else {
    const accessibleIds = await getAccessibleEntityIds(session.entityId);
    whereClause = { tracks: { some: { release: { tenantId: { in: accessibleIds } } } } };
  }

  const composition = await prisma.composition.findFirst({
    where: {
      id: compositionId,
      ...whereClause
    },
  });

  return !!composition;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = await getSession();

    if (!session) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }

    if (!hasPermission(session, PERMISSIONS.RELEASE_READ)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const hasAccess = await hasCompositionAccess(session, id);
    if (!hasAccess) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const composition = await prisma.composition.findUnique({
      where: { id },
      include: {
        tracks: {
          select: { id: true, title: true, isrc: true, artist: { select: { id: true, name: true } } },
        },
      },
    });

    if (!composition) {
      return NextResponse.json(
        { error: "ERROR_COMPOSITION_NOT_FOUND" },
        { status: 404 },
      );
    }

    return NextResponse.json(composition);
  } catch (error) {
    console.error("Error fetching composition:", error);
    return NextResponse.json(
      { error: "ERROR_FAILED_TO_FETCH_COMPOSITION" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = await getSecureSession();

    if (!session) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }

    if (!hasPermission(session, PERMISSIONS.RELEASE_UPDATE)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const hasAccess = await hasCompositionAccess(session, id);
    if (!hasAccess) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const existingComp = await prisma.composition.findUnique({
      where: { id },
      include: {
        tracks: {
          include: { release: { select: { status: true } } },
        },
      },
    });

    if (!existingComp) {
      return NextResponse.json(
        { error: "ERROR_COMPOSITION_NOT_FOUND" },
        { status: 404 },
      );
    }

    const protectedEditStatuses = ["APPROVED", "SCHEDULED", "DELIVERED", "RELEASED", "TAKEDOWN", "PENDING_SYS_APPROVAL"];
    const lockedRelease = existingComp.tracks.find(
      (t) => t.release && protectedEditStatuses.includes(t.release.status)
    )?.release;

    const canBypassLock = isSystemAdmin(session) || session.roles.includes("moderator");

    if (!canBypassLock && lockedRelease) {
      return NextResponse.json(
        {
          error: `Cannot edit a composition linked to a release with status "${lockedRelease.status}". Contact admin for changes.`,
        },
        { status: 400 },
      );
    }

    const body = await request.json();

    // Validate title if provided
    if (body.title !== undefined && body.title.trim() === "") {
      return NextResponse.json(
        { error: "ERROR_TITLE_CANNOT_BE_EMPTY" },
        { status: 400 },
      );
    }

    // Validate authors if provided
    if (body.authors !== undefined && body.authors !== null) {
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


    const updateData: Record<string, unknown> = {};

    // Basic info
    if (body.title !== undefined) updateData.title = body.title.trim();
    if (body.titleLocalized !== undefined)
      updateData.titleLocalized = body.titleLocalized;
    if (body.subtitle !== undefined) updateData.subtitle = body.subtitle;
    if (body.subtitleLocalized !== undefined)
      updateData.subtitleLocalized = body.subtitleLocalized;
    if (body.alternativeTitle !== undefined)
      updateData.alternativeTitle = body.alternativeTitle;
    if (body.alternativeTitleLocalized !== undefined)
      updateData.alternativeTitleLocalized = body.alternativeTitleLocalized;

    // Identification
    if (body.iswc !== undefined) updateData.iswc = body.iswc;
    if (body.catalogueNumber !== undefined)
      updateData.catalogueNumber = body.catalogueNumber;

    // Details
    if (body.genre !== undefined) updateData.genre = body.genre;
    if (body.lyricsLanguages !== undefined)
      updateData.lyricsLanguages = body.lyricsLanguages;
    if (body.lyricsFileName !== undefined)
      updateData.lyricsFileName = body.lyricsFileName;
    if (body.creationDate !== undefined) {
      updateData.creationDate = body.creationDate
        ? new Date(body.creationDate)
        : null;
    }

    // Territories
    if (body.territories !== undefined)
      updateData.territories = body.territories;
    if (body.excludingTerritories !== undefined)
      updateData.excludingTerritories = body.excludingTerritories;

    // Contract
    if (body.contractPeriodBegins !== undefined) {
      updateData.contractPeriodBegins = body.contractPeriodBegins
        ? new Date(body.contractPeriodBegins)
        : null;
    }
    if (body.contractPeriodEnds !== undefined) {
      updateData.contractPeriodEnds = body.contractPeriodEnds
        ? new Date(body.contractPeriodEnds)
        : null;
    }
    if (body.contractNumber !== undefined)
      updateData.contractNumber = body.contractNumber;

    // Authors
    if (body.authors !== undefined) updateData.authors = body.authors;

    const composition = await prisma.composition.update({
      where: { id },
      data: updateData,
      include: {
        tracks: { select: { id: true, title: true, isrc: true } },
      },
    });

    return NextResponse.json(composition);
  } catch (error) {
    console.error("Error updating composition:", error);
    return NextResponse.json(
      { error: "ERROR_FAILED_TO_UPDATE_COMPOSITION" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = await getSecureSession();

    if (!session) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }

    if (!hasPermission(session, PERMISSIONS.RELEASE_DELETE)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const hasAccess = await hasCompositionAccess(session, id);
    if (!hasAccess) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const existingComp = await prisma.composition.findUnique({
      where: { id },
      include: {
        tracks: {
          include: { release: { select: { status: true } } },
        },
      },
    });

    if (!existingComp) {
      return NextResponse.json(
        { error: "ERROR_COMPOSITION_NOT_FOUND" },
        { status: 404 },
      );
    }

    const protectedEditStatuses = ["APPROVED", "SCHEDULED", "DELIVERED", "RELEASED", "TAKEDOWN", "PENDING_SYS_APPROVAL"];
    const lockedRelease = existingComp.tracks.find(
      (t) => t.release && protectedEditStatuses.includes(t.release.status)
    )?.release;

    const canBypassLock = isSystemAdmin(session) || session.roles.includes("moderator");

    if (!canBypassLock && lockedRelease) {
      return NextResponse.json(
        {
          error: `Cannot delete a composition linked to a release with status "${lockedRelease.status}". Contact admin for changes.`,
        },
        { status: 400 },
      );
    }

    // Count linked tracks for response info
    const linkedTracks = await prisma.track.count({
      where: { compositionId: id },
    });

    await prisma.$transaction(async (tx) => {
      // Unlink tracks that reference this composition
      if (linkedTracks > 0) {
        await tx.track.updateMany({
          where: { compositionId: id },
          data: { compositionId: null },
        });
      }

      // Delete the composition
      await tx.composition.delete({
        where: { id },
      });
    });

    return NextResponse.json({
      success: true,
      unlinkedTracks: linkedTracks,
    });
  } catch (error) {
    console.error("Error deleting composition:", error);
    return NextResponse.json(
      { error: "ERROR_FAILED_TO_DELETE_COMPOSITION" },
      { status: 500 },
    );
  }
}
