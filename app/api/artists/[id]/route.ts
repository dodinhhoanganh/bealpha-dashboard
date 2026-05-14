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
import { createAuditLog } from "@/lib/audit";
import { getUploadApiKey } from "@/lib/upload";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// B2B2B: Check if user can access this artist via tenant
async function canAccessArtist(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  artistId: string,
): Promise<boolean> {
  if (isSystemAdmin(session)) return true;

  const artist = await prisma.artist.findUnique({
    where: { id: artistId },
    select: { tenantId: true },
  });
  if (!artist) return false;

  if (session.tenantId === artist.tenantId) return true;

  const accessibleEntityIds = await getAccessibleEntityIds(session.entityId);
  return accessibleEntityIds.includes(artist.tenantId);
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    if (!hasPermission(session, PERMISSIONS.ARTIST_READ)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const { id } = await params;
    if (!(await canAccessArtist(session, id))) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const artist = await prisma.artist.findUnique({
      where: { id },
      include: {
        label: { select: { id: true, name: true } },
        releases: {
          take: 10,
          orderBy: { releaseDate: "desc" },
          select: { id: true, title: true, format: true, status: true, releaseDate: true, coverUrl: true },
        },
        _count: { select: { releases: true, tracks: true } },
      },
    });

    if (!artist) return NextResponse.json({ error: "ERROR_ARTIST_NOT_FOUND" }, { status: 404 });

    return NextResponse.json({
      id: artist.id, name: artist.name, isni: artist.isni, ipi: artist.ipi,
      dpid: artist.dpid, spotifyId: artist.spotifyId, appleMusicId: artist.appleMusicId,
      imageUrl: artist.imageUrl || null, label: artist.label,
      releases: artist.releases, releaseCount: artist._count.releases,
      trackCount: artist._count.tracks, createdAt: artist.createdAt, updatedAt: artist.updatedAt,
    });
  } catch (error) {
    console.error("Error fetching artist:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_FETCH_ARTIST" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSecureSession();
    if (!session) return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    if (!hasPermission(session, PERMISSIONS.ARTIST_UPDATE)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const { id } = await params;
    if (!(await canAccessArtist(session, id))) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const body = await request.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: Record<string, any> = {};

    const secureUrl = (url: unknown): string | null => {
      if (!url || typeof url !== "string") return null;
      return /^(https?:\/\/|\/uploads\/)/i.test(url) ? url : null;
    };

    if (body.name) updateData.name = body.name;
    if (body.isni !== undefined) updateData.isni = body.isni;
    if (body.ipi !== undefined) updateData.ipi = body.ipi;
    if (body.dpid !== undefined) updateData.dpid = body.dpid;
    if (body.spotifyId !== undefined) updateData.spotifyId = body.spotifyId;
    if (body.appleMusicId !== undefined) updateData.appleMusicId = body.appleMusicId;
    if (body.vevoChannel !== undefined) updateData.vevoChannel = body.vevoChannel;
    if (body.imageUrl !== undefined) updateData.imageUrl = secureUrl(body.imageUrl);

    // Label assignment: validate label belongs to same tenant
    if (body.labelId !== undefined) {
      if (body.labelId) {
        const artist = await prisma.artist.findUnique({ where: { id }, select: { tenantId: true } });
        const label = await prisma.label.findFirst({
          where: { id: body.labelId, tenantId: artist?.tenantId },
        });
        if (!label) {
          return NextResponse.json({ error: "ERROR_CANNOT_ASSIGN_TO_A_LABEL_YOU_DO_NOT_MANAGE" }, { status: 403 });
        }
      }
      updateData.labelId = body.labelId;
    }

    const artist = await prisma.artist.update({
      where: { id },
      data: updateData,
      include: { label: true },
    });

    await createAuditLog({
      userId: session.id, action: "artist.update", entityType: "artist", entityId: id, newValue: updateData,
    });

    return NextResponse.json(artist);
  } catch (error) {
    console.error("Error updating artist:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_UPDATE_ARTIST" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSecureSession();
    if (!session || !hasPermission(session, PERMISSIONS.ARTIST_DELETE)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const { id } = await params;
    if (!(await canAccessArtist(session, id))) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const artist = await prisma.artist.findUnique({
      where: { id },
      include: {
        releases: {
          select: {
            id: true,
            coverUrl: true,
            tracks: {
              select: {
                id: true,
                audioAsset: { select: { fileUrl: true } },
                canvasAsset: { select: { fileUrl: true } },
                motionAsset: { select: { fileUrl: true } },
                admAsset: { select: { fileUrl: true } },
              },
            },
          },
        },
      },
    });

    if (!artist) return NextResponse.json({ error: "ERROR_ARTIST_NOT_FOUND" }, { status: 404 });

    const releaseIds = artist.releases.map((r) => r.id);

    // Collect files for cleanup
    const filesToDelete: string[] = [];
    for (const release of artist.releases) {
      if (release.coverUrl) filesToDelete.push(release.coverUrl);
      for (const track of release.tracks) {
        if (track.audioAsset?.fileUrl) filesToDelete.push(track.audioAsset.fileUrl);
        if (track.canvasAsset?.fileUrl) filesToDelete.push(track.canvasAsset.fileUrl);
        if (track.motionAsset?.fileUrl) filesToDelete.push(track.motionAsset.fileUrl);
        if (track.admAsset?.fileUrl) filesToDelete.push(track.admAsset.fileUrl);
      }
    }

    await prisma.$transaction(async (tx) => {
      if (releaseIds.length > 0) {
        await tx.asset.updateMany({ where: { releaseId: { in: releaseIds } }, data: { releaseId: null } });
        await tx.track.deleteMany({ where: { releaseId: { in: releaseIds } } });
        await tx.ddexDelivery.deleteMany({ where: { releaseId: { in: releaseIds } } });
        await tx.release.deleteMany({ where: { id: { in: releaseIds } } });
      }
      await tx.artist.delete({ where: { id } });
    });

    // File cleanup (non-blocking)
    const UPLOAD_SERVER = process.env.UPLOAD_SERVER_URL || "http://localhost:3001";
    const isSafePath = (p: string) => p && !/\.\.|[^a-zA-Z0-9_\-.\/%  ]/.test(p);
    for (const fileUrl of filesToDelete) {
      try {
        const idx = fileUrl.indexOf("/uploads/");
        if (idx !== -1) {
          const subPath = fileUrl.substring(idx + "/uploads/".length);
          if (isSafePath(subPath)) {
            fetch(`${UPLOAD_SERVER}/file/${subPath}`, {
              method: "DELETE", headers: { "x-api-key": getUploadApiKey() },
            }).catch(() => {});
          }
        }
      } catch { /* ignore */ }
    }

    await createAuditLog({
      userId: session.id, action: "artist.delete", entityType: "artist", entityId: id,
      oldValue: { name: artist.name },
    });

    return NextResponse.json({ success: true, deletedReleases: releaseIds.length });
  } catch (error) {
    console.error("Error deleting artist:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_DELETE_ARTIST" }, { status: 500 });
  }
}
