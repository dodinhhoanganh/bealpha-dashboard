import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSession,
  getSecureSession,
  hasPermission,
  PERMISSIONS,
  isSystemAdmin,
} from "@/lib/auth";
import { getUploadApiKey } from "@/lib/upload";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// B2B2B: Check if user can access this asset via release tenant hierarchy
async function canAccessAsset(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  assetId: string,
): Promise<boolean> {
  if (isSystemAdmin(session) || session.roles.includes("moderator")) return true;

  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    select: { 
      release: { 
        select: { 
          tenantId: true, 
          ownerId: true,
          artist: { select: { name: true } }
        } 
      } 
    },
  });
  // BUG-5 fix: Allow access to unlinked assets (temp uploads not yet assigned to a release)
  if (!asset) return false;
  if (!asset.release) return true; // Unlinked/temp asset — accessible to any authenticated user

  if (!session.entityId) return false;
  
  if (session.entityType === "SUB_ACCOUNT") {
    if (asset.release.ownerId === session.entityId) return true;
    if (session.roles.includes("artist") && asset.release.artist?.name === session.entityName) return true;
    return false;
  }

  const { getAccessibleEntityIds } = await import("@/lib/entity-hierarchy");
  const accessibleIds = await getAccessibleEntityIds(session.entityId);
  return accessibleIds.includes(asset.release.tenantId);
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    if (!hasPermission(session, PERMISSIONS.RELEASE_READ)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const { id } = await params;
    if (!(await canAccessAsset(session, id))) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const asset = await prisma.asset.findUnique({
      where: { id },
      include: {
        release: { select: { id: true, title: true, ean: true } },
        tracks: { select: { id: true, title: true, isrc: true, trackNumber: true } },
      },
    });

    if (!asset) return NextResponse.json({ error: "ERROR_ASSET_NOT_FOUND" }, { status: 404 });

    return NextResponse.json({
      ...asset,
      fileSize: asset.fileSize ? Number(asset.fileSize) : null,
      frameRate: asset.frameRate ? Number(asset.frameRate) : null,
    });
  } catch (error) {
    console.error("Error fetching asset:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_FETCH_ASSET" }, { status: 500 });
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
    if (!(await canAccessAsset(session, id))) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const existingAsset = await prisma.asset.findUnique({
      where: { id },
      include: { release: { select: { status: true } } },
    });
    if (!existingAsset) return NextResponse.json({ error: "ERROR_ASSET_NOT_FOUND" }, { status: 404 });

    const protectedEditStatuses = ["APPROVED", "SCHEDULED", "DELIVERED", "RELEASED", "TAKEDOWN", "PENDING_SYS_APPROVAL"];
    const canBypassLock = isSystemAdmin(session) || session.roles.includes("moderator");

    if (
      !canBypassLock &&
      existingAsset.release &&
      protectedEditStatuses.includes(existingAsset.release.status)
    ) {
      return NextResponse.json(
        { error: `Cannot edit an asset linked to a release with status "${existingAsset.release.status}". Contact admin for changes.` },
        { status: 400 },
      );
    }

    const body = await request.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: Record<string, any> = {};

    if (body.fileName !== undefined) updateData.fileName = body.fileName;
    if (body.originalFileName !== undefined) updateData.originalFileName = body.originalFileName;
    if (body.fileUrl !== undefined) {
      updateData.fileUrl = body.fileUrl && typeof body.fileUrl === "string" && /^(https?:\/\/|\/uploads\/)/i.test(body.fileUrl) ? body.fileUrl : null;
    }
    if (body.fileSize !== undefined) updateData.fileSize = body.fileSize ? BigInt(body.fileSize) : null;
    if (body.mimeType !== undefined) updateData.mimeType = body.mimeType;
    if (body.duration !== undefined) updateData.duration = body.duration;
    if (body.sampleRate !== undefined) updateData.sampleRate = body.sampleRate;
    if (body.bitRate !== undefined) updateData.bitRate = body.bitRate;
    if (body.channels !== undefined) updateData.channels = body.channels;
    if (body.bitDepth !== undefined) updateData.bitDepth = body.bitDepth;
    if (body.codec !== undefined) updateData.codec = body.codec;
    if (body.width !== undefined) updateData.width = body.width;
    if (body.height !== undefined) updateData.height = body.height;
    if (body.frameRate !== undefined) updateData.frameRate = body.frameRate;
    if (body.videoCodec !== undefined) updateData.videoCodec = body.videoCodec;
    if (body.audioCodec !== undefined) updateData.audioCodec = body.audioCodec;
    if (body.isrc !== undefined) updateData.isrc = body.isrc;
    if (body.resourceReference !== undefined) updateData.resourceReference = body.resourceReference;
    if (body.status !== undefined) updateData.status = body.status;
    if (body.processingError !== undefined) updateData.processingError = body.processingError;
    if (body.processedAt !== undefined) updateData.processedAt = new Date(body.processedAt);

    const asset = await prisma.asset.update({
      where: { id }, data: updateData,
      include: { release: true },
    });

    return NextResponse.json({
      ...asset,
      fileSize: asset.fileSize ? Number(asset.fileSize) : null,
      frameRate: asset.frameRate ? Number(asset.frameRate) : null,
    });
  } catch (error) {
    console.error("Error updating asset:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_UPDATE_ASSET" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSecureSession();
    if (!session || !hasPermission(session, PERMISSIONS.RELEASE_DELETE)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const { id } = await params;
    if (!(await canAccessAsset(session, id))) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const asset = await prisma.asset.findUnique({
      where: { id },
      include: { tracks: { select: { id: true } }, release: { select: { status: true } } },
    });

    if (!asset) return NextResponse.json({ error: "ERROR_ASSET_NOT_FOUND" }, { status: 404 });

    const protectedEditStatuses = ["APPROVED", "SCHEDULED", "DELIVERED", "RELEASED", "TAKEDOWN", "PENDING_SYS_APPROVAL"];
    const canBypassLock = isSystemAdmin(session) || session.roles.includes("moderator");

    if (
      !canBypassLock &&
      asset.release &&
      protectedEditStatuses.includes(asset.release.status)
    ) {
      return NextResponse.json(
        { error: `Cannot delete an asset linked to a release with status "${asset.release.status}". Contact admin for changes.` },
        { status: 400 },
      );
    }

    const linkedTrackCount = asset.tracks.length;
    await prisma.$transaction(async (tx) => {
      if (linkedTrackCount > 0) {
        // Unlink all asset type references (audio, canvas, motion, ADM)
        await tx.track.updateMany({ where: { audioAssetId: id }, data: { audioAssetId: null } });
        await tx.track.updateMany({ where: { canvasAssetId: id }, data: { canvasAssetId: null } });
        await tx.track.updateMany({ where: { motionAssetId: id }, data: { motionAssetId: null } });
        await tx.track.updateMany({ where: { admAssetId: id }, data: { admAssetId: null } });
      }
      await tx.asset.delete({ where: { id } });
    });

    // File cleanup
    if (asset.fileUrl) {
      try {
        const UPLOAD_SERVER = process.env.UPLOAD_SERVER_URL || "http://localhost:3001";
        const idx = asset.fileUrl.indexOf("/uploads/");
        if (idx !== -1) {
          const subPath = asset.fileUrl.substring(idx + "/uploads/".length);
          if (subPath && !/\.\.|[^a-zA-Z0-9_\-.\/%  ]/.test(subPath)) {
            fetch(`${UPLOAD_SERVER}/file/${subPath}`, {
              method: "DELETE", headers: { "x-api-key": getUploadApiKey() },
            }).catch(() => {});
          }
        }
      } catch { /* ignore */ }
    }

    return NextResponse.json({ success: true, unlinkedTracks: linkedTrackCount });
  } catch (error) {
    console.error("Error deleting asset:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_DELETE_ASSET" }, { status: 500 });
  }
}
