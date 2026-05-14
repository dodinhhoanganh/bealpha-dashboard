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
    if (!session) return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    if (!hasPermission(session, PERMISSIONS.RELEASE_READ)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type");
    const releaseId = searchParams.get("releaseId");
    const status = searchParams.get("status");
    const search = searchParams.get("search");
    let limit = parseInt(searchParams.get("limit") || "20");
    if (isNaN(limit) || limit < 1) limit = 20;
    limit = Math.min(limit, 100);
    let page = parseInt(searchParams.get("page") || "1");
    if (isNaN(page) || page < 1) page = 1;
    const sortBy = searchParams.get("sortBy") || "createdAt";
    const sortOrder = (searchParams.get("sortOrder") || "desc") as "asc" | "desc";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let whereClause: any = {};

    if (isSystemAdmin(session) || session.roles.includes("moderator")) {
      // See all assets
    } else if (session.tenantId) {
      if (session.entityType === "SUB_ACCOUNT") {
        if (session.roles.includes("artist")) {
          whereClause.release = {
            OR: [
              { ownerId: session.entityId },
              { artist: { name: session.entityName } }
            ]
          };
        } else {
          whereClause.release = { ownerId: session.entityId };
        }
      } else {
        const accessibleIds = await getAccessibleEntityIds(session.entityId);
        whereClause.release = { tenantId: { in: accessibleIds } };
      }
    } else {
      return NextResponse.json({ data: [], total: 0, page: 1, limit, totalPages: 0 });
    }

    if (type) whereClause.type = type;
    if (releaseId) whereClause.releaseId = releaseId;
    if (status) whereClause.status = status;
    if (search) whereClause.fileName = { contains: search, mode: "insensitive" };

    const total = await prisma.asset.count({ where: whereClause });
    const totalPages = Math.ceil(total / limit);
    const skip = (page - 1) * limit;

    const validSortFields: Record<string, string> = { createdAt: "createdAt", fileName: "fileName", type: "type" };
    const orderField = validSortFields[sortBy] || "createdAt";

    const assets = await prisma.asset.findMany({
      where: whereClause,
      include: {
        release: { select: { id: true, title: true } },
        tracks: { select: { id: true, title: true, isrc: true } },
      },
      orderBy: { [orderField]: sortOrder },
      skip,
      take: limit,
    });

    const formattedAssets = assets.map((asset) => ({
      id: asset.id, type: asset.type, fileName: asset.fileName, originalFileName: asset.originalFileName,
      fileUrl: asset.fileUrl, fileSize: asset.fileSize ? Number(asset.fileSize) : null, mimeType: asset.mimeType,
      duration: asset.duration, sampleRate: asset.sampleRate, bitRate: asset.bitRate, channels: asset.channels, bitDepth: asset.bitDepth, codec: asset.codec,
      width: asset.width, height: asset.height,
      frameRate: asset.frameRate ? Number(asset.frameRate) : null,
      videoCodec: asset.videoCodec, audioCodec: asset.audioCodec,
      isrc: asset.isrc, resourceReference: asset.resourceReference,
      release: asset.release, tracks: asset.tracks,
      status: asset.status, processingError: asset.processingError,
      uploadedAt: asset.uploadedAt, processedAt: asset.processedAt, createdAt: asset.createdAt,
    }));

    return NextResponse.json({ data: formattedAssets, total, page, limit, totalPages });
  } catch (error) {
    console.error("Error fetching assets:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_FETCH_ASSETS" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSecureSession();
    if (!session) return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    if (!hasPermission(session, PERMISSIONS.RELEASE_CREATE)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const body = await request.json();
    if (!body.fileName || !body.fileUrl) {
      return NextResponse.json({ error: "ERROR_FILENAME_AND_FILEURL_ARE_REQUIRED" }, { status: 400 });
    }
    if (typeof body.fileUrl !== "string" || !/^(https?:\/\/|\/uploads\/)/i.test(body.fileUrl)) {
      return NextResponse.json({ error: "ERROR_FILEURL_MUST_BE_A_VALID_HTTP_URL_OR_UPLOADS" }, { status: 400 });
    }

    // Validate release access
    if (body.releaseId) {
      const { canAccessRelease } = await import("@/app/api/releases/[id]/route");
      const hasAccess = await canAccessRelease(session, body.releaseId);
      if (!hasAccess) {
        return NextResponse.json({ error: "ERROR_RELEASE_NOT_FOUND_OR_ACCESS_DENIED" }, { status: 403 });
      }
    }

    const asset = await prisma.asset.create({
      data: {
        type: body.type || "AUDIO",
        fileName: body.fileName,
        originalFileName: body.originalFileName,
        fileUrl: body.fileUrl,
        fileSize: body.fileSize ? BigInt(body.fileSize) : null,
        mimeType: body.mimeType,
        duration: body.duration,
        sampleRate: body.sampleRate, bitRate: body.bitRate, channels: body.channels, bitDepth: body.bitDepth, codec: body.codec,
        width: body.width, height: body.height, frameRate: body.frameRate,
        videoCodec: body.videoCodec, audioCodec: body.audioCodec,
        isrc: body.isrc, resourceReference: body.resourceReference,
        releaseId: body.releaseId,
        status: "PENDING",
      },
      include: { release: true },
    });

    return NextResponse.json({ ...asset, fileSize: asset.fileSize ? Number(asset.fileSize) : null }, { status: 201 });
  } catch (error) {
    console.error("Error creating asset:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_CREATE_ASSET" }, { status: 500 });
  }
}
