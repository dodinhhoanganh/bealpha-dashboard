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

// B2B2B: Check if user can access this label via tenant
async function canAccessLabel(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  labelId: string,
): Promise<boolean> {
  if (isSystemAdmin(session)) return true;

  const label = await prisma.label.findUnique({
    where: { id: labelId },
    select: { tenantId: true },
  });
  if (!label) return false;

  if (session.tenantId === label.tenantId) return true;

  const accessibleEntityIds = await getAccessibleEntityIds(session.entityId);
  return accessibleEntityIds.includes(label.tenantId);
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    if (!hasPermission(session, PERMISSIONS.LABEL_READ)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const { id } = await params;
    if (!(await canAccessLabel(session, id))) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const label = await prisma.label.findUnique({
      where: { id },
      include: {
        artists: {
          select: { id: true, name: true, imageUrl: true, _count: { select: { releases: true } } },
          orderBy: { name: "asc" },
        },
        _count: { select: { artists: true, releases: true } },
      },
    });

    if (!label) return NextResponse.json({ error: "ERROR_LABEL_NOT_FOUND" }, { status: 404 });

    return NextResponse.json({
      id: label.id, name: label.name, description: label.description,
      dpid: label.dpid, logoUrl: label.logoUrl,
      artists: label.artists.map((a) => ({
        id: a.id, name: a.name, imageUrl: a.imageUrl || null, releaseCount: a._count.releases,
      })),
      artistCount: label._count.artists, releaseCount: label._count.releases,
      createdAt: label.createdAt, updatedAt: label.updatedAt,
    });
  } catch (error) {
    console.error("Error fetching label:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_FETCH_LABEL" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSecureSession();
    if (!session) return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    if (!hasPermission(session, PERMISSIONS.LABEL_UPDATE)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const { id } = await params;
    if (!(await canAccessLabel(session, id))) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const body = await request.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: Record<string, any> = {};

    if (body.name && typeof body.name === "string" && body.name.trim() !== "") updateData.name = body.name.trim();
    if (body.description !== undefined) {
      updateData.description = (typeof body.description === "string" ? body.description.trim() : String(body.description || "")) || null;
    }
    if (body.dpid !== undefined) updateData.dpid = (typeof body.dpid === "string" ? body.dpid.trim() : null) || null;
    if (body.ddexPartyName !== undefined) updateData.ddexPartyName = (typeof body.ddexPartyName === "string" ? body.ddexPartyName.trim() : null) || null;
    if (body.logoUrl !== undefined) {
      if (body.logoUrl && typeof body.logoUrl === "string") {
        updateData.logoUrl = /^(https?:\/\/|\/uploads\/)/i.test(body.logoUrl) ? body.logoUrl.trim() : null;
      } else {
        updateData.logoUrl = null;
      }
    }

    const label = await prisma.label.update({ where: { id }, data: updateData });

    await createAuditLog({
      userId: session.id, action: "label.update", entityType: "label", entityId: id, newValue: updateData,
    });

    return NextResponse.json(label);
  } catch (error) {
    console.error("Error updating label:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_UPDATE_LABEL" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSecureSession();
    if (!session || !hasPermission(session, PERMISSIONS.LABEL_DELETE)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const { id } = await params;
    if (!(await canAccessLabel(session, id))) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const label = await prisma.label.findUnique({
      where: { id },
      include: {
        artists: { select: { id: true } },
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

    if (!label) return NextResponse.json({ error: "ERROR_LABEL_NOT_FOUND" }, { status: 404 });

    const artistIds = label.artists.map((a) => a.id);
    const releaseIds = label.releases.map((r) => r.id);
    const filesToDelete: string[] = [];

    for (const release of label.releases) {
      if (release.coverUrl) filesToDelete.push(release.coverUrl);
      for (const track of release.tracks) {
        if (track.audioAsset?.fileUrl) filesToDelete.push(track.audioAsset.fileUrl);
        if (track.canvasAsset?.fileUrl) filesToDelete.push(track.canvasAsset.fileUrl);
        if (track.motionAsset?.fileUrl) filesToDelete.push(track.motionAsset.fileUrl);
        if (track.admAsset?.fileUrl) filesToDelete.push(track.admAsset.fileUrl);
      }
    }

    // Cascade releases from artists under this label
    if (artistIds.length > 0) {
      const artistReleases = await prisma.release.findMany({
        where: { artistId: { in: artistIds }, labelId: { not: id } },
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
      });
      for (const release of artistReleases) {
        releaseIds.push(release.id);
        if (release.coverUrl) filesToDelete.push(release.coverUrl);
        for (const track of release.tracks) {
          if (track.audioAsset?.fileUrl) filesToDelete.push(track.audioAsset.fileUrl);
          if (track.canvasAsset?.fileUrl) filesToDelete.push(track.canvasAsset.fileUrl);
          if (track.motionAsset?.fileUrl) filesToDelete.push(track.motionAsset.fileUrl);
          if (track.admAsset?.fileUrl) filesToDelete.push(track.admAsset.fileUrl);
        }
      }
    }

    await prisma.$transaction(async (tx) => {
      if (releaseIds.length > 0) {
        await tx.asset.updateMany({ where: { releaseId: { in: releaseIds } }, data: { releaseId: null } });
        await tx.track.deleteMany({ where: { releaseId: { in: releaseIds } } });
        await tx.ddexDelivery.deleteMany({ where: { releaseId: { in: releaseIds } } });
        await tx.release.deleteMany({ where: { id: { in: releaseIds } } });
      }
      await tx.ddexMessage.deleteMany({ where: { labelId: id } });
      if (artistIds.length > 0) await tx.artist.deleteMany({ where: { labelId: id } });
      await tx.label.delete({ where: { id } });
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
      userId: session.id, action: "label.delete", entityType: "label", entityId: id,
      oldValue: { name: label.name },
    });

    return NextResponse.json({ success: true, deletedArtists: artistIds.length, deletedReleases: releaseIds.length });
  } catch (error) {
    console.error("Error deleting label:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_DELETE_LABEL" }, { status: 500 });
  }
}
