import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSession,
  getSecureSession,
  hasPermission,
  PERMISSIONS,
  isSystemAdmin,
} from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";
import { deleteFileFromServer } from "@/lib/upload";
import { getAccessibleEntityIds } from "@/lib/entity-hierarchy";
import { NotificationService } from "@/lib/services/notification.service";
import { getUploadApiKey } from "@/lib/upload";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// B2B2B: Check if the user can access this release
export async function canAccessRelease(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  releaseId: string,
): Promise<boolean> {
  if (isSystemAdmin(session)) return true;
  if (session.roles.includes("moderator") || session.roles.includes("supporter") || session.roles.includes("finance")) {
    return true;
  }

  const release = await prisma.release.findUnique({
    where: { id: releaseId },
    select: { tenantId: true, ownerId: true, artist: { select: { name: true } } },
  });
  if (!release) return false;

  if (session.entityType === "SUB_ACCOUNT") {
    if (release.ownerId === session.entityId) return true;
    if (session.roles.includes("artist") && release.artist?.name === session.entityName) return true;
    return false;
  }

  const accessibleEntityIds = await getAccessibleEntityIds(session.entityId);
  return accessibleEntityIds.includes(release.tenantId);
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    if (!hasPermission(session, PERMISSIONS.RELEASE_READ)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const { id } = await params;

    const release = await prisma.release.findUnique({
      where: { id },
      include: {
        artist: { select: { id: true, name: true, imageUrl: true, spotifyId: true, appleMusicId: true } },
        label: { select: { id: true, name: true, logoUrl: true } },
        tracks: {
          include: {
            audioAsset: { select: { id: true, fileName: true, fileUrl: true, duration: true, sampleRate: true, bitRate: true, channels: true, codec: true, fileSize: true, status: true } },
            composition: { select: { id: true, title: true, iswc: true, authors: true } },
            artist: { select: { id: true, name: true } },
          },
          orderBy: [{ discNumber: "asc" }, { trackNumber: "asc" }],
        },
        assets: { select: { id: true, type: true, fileName: true, fileUrl: true, fileSize: true, duration: true, status: true } },
      },
    });

    if (!release) return NextResponse.json({ error: "ERROR_RELEASE_NOT_FOUND" }, { status: 404 });

    if (!(await canAccessRelease(session, id))) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    return NextResponse.json(release);
  } catch (error) {
    console.error("Error fetching release:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_FETCH_RELEASE" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSecureSession();
    if (!session) return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    if (!hasPermission(session, PERMISSIONS.RELEASE_UPDATE)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const { id } = await params;
    const existing = await prisma.release.findUnique({
      where: { id },
      include: { artist: { select: { id: true, name: true } }, label: { select: { id: true, name: true } } },
    });

    if (!existing) return NextResponse.json({ error: "ERROR_RELEASE_NOT_FOUND" }, { status: 404 });
    if (!(await canAccessRelease(session, id))) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const canBypassLock = isSystemAdmin(session) || session.roles.includes("moderator");
    const protectedEditStatuses = ["APPROVED", "SCHEDULED", "DELIVERED", "RELEASED", "TAKEDOWN", "PENDING_SYS_APPROVAL"];
    if (!canBypassLock && protectedEditStatuses.includes(existing.status)) {
      return NextResponse.json({ error: `Cannot edit a release with status "${existing.status}". Contact admin for changes.` }, { status: 400 });
    }

    const body = await request.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: Record<string, any> = {};

    if (body.title !== undefined) {
      if (!String(body.title).trim()) return NextResponse.json({ error: "ERROR_RELEASE_TITLE_CANNOT_BE_EMPTY" }, { status: 400 });
      updateData.title = String(body.title).trim();
    }
    if (body.titleLocalized !== undefined) updateData.titleLocalized = body.titleLocalized;
    if (body.subtitle !== undefined) updateData.subtitle = body.subtitle;
    if (body.subtitleLocalized !== undefined) updateData.subtitleLocalized = body.subtitleLocalized;
    if (body.ean !== undefined) updateData.ean = body.ean;
    if (body.upc !== undefined) updateData.ean = body.upc;
    if (body.grid !== undefined) updateData.grid = body.grid;
    if (body.catalogueNumber !== undefined) updateData.catalogueNumber = body.catalogueNumber;
    if (body.type !== undefined) updateData.type = body.type;
    if (body.format !== undefined) updateData.format = body.format;
    if (body.genre !== undefined) updateData.genre = body.genre;
    if (body.subGenre !== undefined) updateData.subGenre = body.subGenre;
    if (body.releaseDate !== undefined) {
      const d = new Date(body.releaseDate);
      if (isNaN(d.getTime())) return NextResponse.json({ error: "ERROR_INVALID_RELEASE_DATE" }, { status: 400 });
      updateData.releaseDate = d;
    }
    if (body.originalReleaseDate !== undefined) {
      const d = new Date(body.originalReleaseDate);
      if (isNaN(d.getTime())) return NextResponse.json({ error: "ERROR_INVALID_ORIGINAL_RELEASE_DATE" }, { status: 400 });
      updateData.originalReleaseDate = d;
    }
    if (body.metaLanguage !== undefined) updateData.metaLanguage = body.metaLanguage;

    // Artist/Label — validate same tenant
    if (body.artistId !== undefined) {
      if (body.artistId !== null) {
        const artist = await prisma.artist.findFirst({
          where: { id: body.artistId, tenantId: existing.tenantId },
        });
        if (!artist) return NextResponse.json({ error: "ERROR_CANNOT_ASSIGN_TO_AN_ARTIST_YOU_DO_NOT_MANAGE" }, { status: 403 });
        
        // Enforce: Artist sub-account MUST tag themselves
        if (session.entityType === "SUB_ACCOUNT" && session.roles.includes("artist")) {
          const isTagged = artist.name === session.entityName;
          
          if (!isTagged) {
            return NextResponse.json(
              { error: "ERROR_ARTIST_ACCOUNT_MUST_INCLUDE_THEMSELVES_IN_RELEASE" },
              { status: 403 }
            );
          }
        }
      }
      updateData.artistId = body.artistId;
    }
    if (body.displayArtist !== undefined) updateData.displayArtist = body.displayArtist;
    if (body.displayArtistLocalized !== undefined) updateData.displayArtistLocalized = body.displayArtistLocalized;

    if (body.labelId !== undefined) {
      if (body.labelId !== null) {
        const label = await prisma.label.findFirst({
          where: { id: body.labelId, tenantId: existing.tenantId },
        });
        if (!label) return NextResponse.json({ error: "ERROR_CANNOT_ASSIGN_TO_A_LABEL_YOU_DO_NOT_MANAGE" }, { status: 403 });
      }
      updateData.labelId = body.labelId;
    }

    if (body.remixer !== undefined) updateData.remixer = body.remixer;
    if (body.producer !== undefined) updateData.producer = body.producer;
    if (body.pLine !== undefined) updateData.pLine = body.pLine;
    if (body.cLine !== undefined) updateData.cLine = body.cLine;
    if (body.pLineYear !== undefined) updateData.pLineYear = body.pLineYear;
    if (body.cLineYear !== undefined) updateData.cLineYear = body.cLineYear;

    if (body.coverUrl !== undefined) {
      updateData.coverUrl = body.coverUrl && typeof body.coverUrl === "string" && /^(https?:\/\/|\/uploads\/)/i.test(body.coverUrl)
        ? body.coverUrl : null;
    }
    if (body.coverImageFileName !== undefined) updateData.coverImageFileName = body.coverImageFileName;
    if (body.territories !== undefined) updateData.territories = body.territories;
    if (body.excludingTerritories !== undefined) {
      updateData.excludingTerritories = Array.isArray(body.excludingTerritories) ? body.excludingTerritories.join(",") : body.excludingTerritories;
    }
    if (body.outlets !== undefined) updateData.outlets = body.outlets;

    if (body.status !== undefined) {
      if (!isSystemAdmin(session) && !session.roles.includes("moderator")) {
        return NextResponse.json({ error: "ERROR_ONLY_ADMIN_MODERATOR_CAN_CHANGE_RELEASE_STAT" }, { status: 403 });
      }
      updateData.status = body.status;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "ERROR_NO_FIELDS_TO_UPDATE" }, { status: 400 });
    }

    const updated = await prisma.release.update({
      where: { id }, data: updateData,
      include: { artist: { select: { id: true, name: true } }, label: { select: { id: true, name: true } }, _count: { select: { tracks: true } } },
    });

    await createAuditLog({
      userId: session.id, action: "release.update", entityType: "release", entityId: id,
      oldValue: { title: existing.title, status: existing.status, artistId: existing.artistId, labelId: existing.labelId },
      newValue: updateData,
    });

    if (existing.status !== "DELIVERED" && updated.status === "DELIVERED") {
      await NotificationService.notifyReleaseDelivered(updated.id).catch(console.error);
    }

    // BUG-4 fix: Only trigger finalize when file-related fields changed
    const hasFileChanges = (
      (updateData.coverUrl && String(updateData.coverUrl).includes("/uploads/temp/"))
    );
    if (hasFileChanges) {
      const UPLOAD_SERVER = process.env.UPLOAD_SERVER_URL || "http://localhost:3001";
      try {
        const finalizeRes = await fetch(`${UPLOAD_SERVER}/upload/finalize-release`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", "x-api-key": getUploadApiKey() },
          body: JSON.stringify({ releaseId: updated.id }),
        });
        if (!finalizeRes.ok) {
          const errorData = await finalizeRes.json().catch(() => ({}));
          console.error("Finalize-release warning:", errorData.error);
        }
      } catch (err: any) {
        // Non-blocking: metadata update succeeded, log finalize failure
        console.error("Failed to trigger finalize-release (non-blocking):", err.message);
      }
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating release:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_UPDATE_RELEASE" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSecureSession();
    if (!session || !hasPermission(session, PERMISSIONS.RELEASE_DELETE)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const { id } = await params;
    const existing = await prisma.release.findUnique({
      where: { id },
      include: {
        _count: { select: { tracks: true } },
        artist: { select: { name: true } },
        // BUG-7 fix: Include all asset types for cleanup
        tracks: {
          select: {
            audioAsset: { select: { fileUrl: true } },
            canvasAsset: { select: { fileUrl: true } },
            motionAsset: { select: { fileUrl: true } },
            admAsset: { select: { fileUrl: true } },
          },
        },
      },
    });

    if (!existing) return NextResponse.json({ error: "ERROR_RELEASE_NOT_FOUND" }, { status: 404 });
    if (!(await canAccessRelease(session, id))) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const canBypassLock = isSystemAdmin(session) || session.roles.includes("moderator");
    const protectedStatuses = ["APPROVED", "SCHEDULED", "DELIVERED", "RELEASED", "TAKEDOWN"];
    if (!canBypassLock && protectedStatuses.includes(existing.status)) {
      return NextResponse.json({ error: "ERROR_CANNOT_DELETE_A_RELEASED_PRODUCT_REQUEST_A_T" }, { status: 400 });
    }

    const filesToDelete: string[] = [];
    if (existing.coverUrl) filesToDelete.push(existing.coverUrl);
    for (const track of existing.tracks) {
      if (track.audioAsset?.fileUrl) filesToDelete.push(track.audioAsset.fileUrl);
      if (track.canvasAsset?.fileUrl) filesToDelete.push(track.canvasAsset.fileUrl);
      if (track.motionAsset?.fileUrl) filesToDelete.push(track.motionAsset.fileUrl);
      if (track.admAsset?.fileUrl) filesToDelete.push(track.admAsset.fileUrl);
    }
    for (const fileUrl of filesToDelete) await deleteFileFromServer(fileUrl);

    await prisma.$transaction(async (tx) => {
      await tx.asset.updateMany({ where: { releaseId: id }, data: { releaseId: null } });
      await tx.track.deleteMany({ where: { releaseId: id } });
      await tx.release.delete({ where: { id } });
    });

    await createAuditLog({
      userId: session.id, action: "release.delete", entityType: "release", entityId: id,
      oldValue: { title: existing.title, status: existing.status, artist: existing.artist?.name, trackCount: existing._count.tracks },
    });

    return NextResponse.json({ success: true, message: `Release "${existing.title}" and ${existing._count.tracks} track(s) deleted` });
  } catch (error) {
    console.error("Error deleting release:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_DELETE_RELEASE" }, { status: 500 });
  }
}
