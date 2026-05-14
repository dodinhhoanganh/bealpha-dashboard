import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, getSecureSession, hasPermission, PERMISSIONS, isAdmin } from "@/lib/auth";
import { canAccessRelease } from "@/app/api/releases/[id]/route";
import {
  generateERN,
  generateTakedownERN,
  validateERN,
  validateERNData,
} from "@/lib/ddex/ern-generator";

/**
 * POST /api/ddex/generate
 * Generate ERN XML for a release without creating a delivery record.
 * Useful for preview / download of raw XML.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSecureSession();
    if (!session) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }
    if (!hasPermission(session, PERMISSIONS.RELEASE_READ)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const body = await request.json();
    const { releaseId, messageType = "NewRelease" } = body;

    if (!releaseId) {
      return NextResponse.json(
        { error: "ERROR_RELEASEID_IS_REQUIRED" },
        { status: 400 },
      );
    }

    const release = await prisma.release.findUnique({
      where: { id: releaseId },
      include: {
        artist: true,
        label: true,
        tracks: {
          include: {
            artist: true,
            audioAsset: true,
            canvasAsset: true,
            motionAsset: true,
            composition: true,
            contributors: {
              include: { artist: true },
            },
          },
          orderBy: [{ discNumber: "asc" }, { trackNumber: "asc" }],
        },
        assets: true,
      },
    });

    if (!release) {
      return NextResponse.json({ error: "ERROR_RELEASE_NOT_FOUND" }, { status: 404 });
    }

    const hasAccess = await canAccessRelease(session, release.id);
    if (!hasAccess) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    if (messageType !== "Takedown") {
      const preCheck = validateERNData(release as any, release.tracks as any);
      if (!preCheck.valid) {
        return NextResponse.json(
          { error: "ERROR_DATA_VALIDATION_FAILED", details: preCheck.errors },
          { status: 400 },
        );
      }
    }

    let xml: string;
    if (messageType === "Takedown") {
      xml = generateTakedownERN(release as any);
    } else {
      xml = generateERN(
        release as any,
        release.tracks as any,
        release.assets as any,
      );
    }

    const validation = validateERN(xml);

    // B2B Tracability: Audit DDEX manifest generation
    await prisma.auditLog.create({
      data: {
        action: "GENERATE_DDEX",
        entityType: "Release",
        entityId: release.id,
        userId: session.id,
        newValue: {
          details: `Generated ${messageType} ERN for Release: ${release.title}`,
          validationValid: validation.valid,
          validationErrors: validation.errors.length,
          messageType,
          type: release.type,
        },
        ipAddress: request.headers.get("x-forwarded-for") || "unknown",
      },
    }).catch(e => console.error("Failed to write audit log for DDEX generation", e));

    return NextResponse.json({
      xml,
      validation,
      release: {
        id: release.id,
        title: release.title,
        ean: release.ean,
        status: release.status,
      },
    });
  } catch (error) {
    console.error("ERN generation error:", error);
    return NextResponse.json(
      { error: "ERROR_FAILED_TO_GENERATE_ERN_XML" },
      { status: 500 },
    );
  }
}
