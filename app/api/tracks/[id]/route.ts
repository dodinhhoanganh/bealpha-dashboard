import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deleteFileFromServer } from "@/lib/upload";
import {
  getSession,
  getSecureSession,
  hasPermission,
  PERMISSIONS,
  isSystemAdmin,
} from "@/lib/auth";
import { getAccessibleEntityIds } from "@/lib/entity-hierarchy";

// B2B2B: Check if user has access to attach an asset
async function validateAssetAccess(
  session: Awaited<ReturnType<typeof getSession>>,
  assetId: string,
  releaseTenantId: string | null | undefined
): Promise<boolean> {
  if (!session) return false;
  if (isSystemAdmin(session)) return true;
  
  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    select: { release: { select: { tenantId: true } } }
  });
  
  if (!asset) return false;
  if (!asset.release) return true; // Unlinked asset is safe to attach
  
  if (releaseTenantId && asset.release.tenantId === releaseTenantId) return true;
  
  const accessibleIds = await getAccessibleEntityIds(session.entityId);
  return accessibleIds.includes(asset.release.tenantId);
}

// B2B2B: Check if user has access to track via entity hierarchy
async function hasTrackAccess(
  session: Awaited<ReturnType<typeof getSession>>,
  trackId: string,
): Promise<boolean> {
  if (!session) return false;

  if (
    isSystemAdmin(session) ||
    session.roles.includes("moderator") ||
    session.roles.includes("finance")
  ) {
    return true;
  }

  if (!session.entityId) return false;

  let releaseScope: Record<string, unknown> = {};

  if (session.entityType === "SUB_ACCOUNT") {
    if (session.roles.includes("artist")) {
      releaseScope = {
        OR: [
          { ownerId: session.entityId },
          { artist: { name: session.entityName } }
        ]
      };
    } else {
      releaseScope = { ownerId: session.entityId };
    }
  } else {
    const accessibleIds = await getAccessibleEntityIds(session.entityId);
    releaseScope = { tenantId: { in: accessibleIds } };
  }

  const track = await prisma.track.findFirst({
    where: { id: trackId, release: releaseScope },
  });

  return !!track;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    if (!hasPermission(session, PERMISSIONS.RELEASE_READ)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    if (!(await hasTrackAccess(session, id))) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const track = await prisma.track.findUnique({
      where: { id },
      include: {
        release: { select: { id: true, title: true, ean: true, coverUrl: true } },
        artist: { select: { id: true, name: true } },
        audioAsset: true,
        composition: true,
        streamingMetrics: { take: 5, orderBy: { date: "desc" } },
      },
    });

    if (!track) return NextResponse.json({ error: "ERROR_TRACK_NOT_FOUND" }, { status: 404 });
    return NextResponse.json(track);
  } catch (error) {
    console.error("Error fetching track:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_FETCH_TRACK" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = await getSecureSession();
    if (!session) return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    if (!hasPermission(session, PERMISSIONS.RELEASE_UPDATE)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    if (!(await hasTrackAccess(session, id))) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const existingTrack = await prisma.track.findUnique({
      where: { id },
      include: { release: { select: { status: true, tenantId: true } } },
    });

    if (!existingTrack) return NextResponse.json({ error: "ERROR_TRACK_NOT_FOUND" }, { status: 404 });

    const protectedEditStatuses = ["APPROVED", "SCHEDULED", "DELIVERED", "RELEASED", "TAKEDOWN", "PENDING_SYS_APPROVAL"];
    const canBypassLock = isSystemAdmin(session) || session.roles.includes("moderator");

    if (
      !canBypassLock &&
      existingTrack.release &&
      protectedEditStatuses.includes(existingTrack.release.status)
    ) {
      return NextResponse.json(
        { error: `Cannot edit a track linked to a release with status "${existingTrack.release.status}". Contact admin for changes.` },
        { status: 400 },
      );
    }

    const body = await request.json();

    if (body.title !== undefined && (typeof body.title !== "string" || body.title.trim() === "")) {
      return NextResponse.json({ error: "ERROR_TITLE_CANNOT_BE_EMPTY" }, { status: 400 });
    }
    if (body.featuredArtists !== undefined && body.featuredArtists !== null && !Array.isArray(body.featuredArtists)) {
      return NextResponse.json({ error: "ERROR_FEATURED_ARTISTS_MUST_BE_AN_ARRAY" }, { status: 400 });
    }
    if (body.contributors !== undefined && body.contributors !== null && !Array.isArray(body.contributors)) {
      return NextResponse.json({ error: "ERROR_CONTRIBUTORS_MUST_BE_AN_ARRAY" }, { status: 400 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: Record<string, any> = {};

    // Basic info
    if (body.title !== undefined) updateData.title = String(body.title).trim();
    if (body.titleLocalized !== undefined) updateData.titleLocalized = body.titleLocalized;
    if (body.subtitle !== undefined) updateData.subtitle = body.subtitle;
    if (body.subtitleLocalized !== undefined) updateData.subtitleLocalized = body.subtitleLocalized;
    if (body.alternativeTitle !== undefined) updateData.alternativeTitle = body.alternativeTitle;
    if (body.alternativeTitleLocalized !== undefined) updateData.alternativeTitleLocalized = body.alternativeTitleLocalized;

    // Identification
    if (body.isrc !== undefined) updateData.isrc = body.isrc;
    if (body.catalogueNumber !== undefined) updateData.catalogueNumber = body.catalogueNumber;
    if (body.trackNumber !== undefined) updateData.trackNumber = body.trackNumber;
    if (body.discNumber !== undefined) updateData.discNumber = body.discNumber;

    // Details
    if (body.duration !== undefined) updateData.duration = body.duration;
    if (body.genre !== undefined) updateData.genre = body.genre;
    if (body.parentalWarningType !== undefined) {
      const validWarningTypes = ["Explicit", "Edited", "NotExplicit", "Unknown"];
      if (!validWarningTypes.includes(body.parentalWarningType)) {
        return NextResponse.json({ error: `Invalid parentalWarningType. Allowed: ${validWarningTypes.join(", ")}` }, { status: 400 });
      }
      updateData.parentalWarningType = body.parentalWarningType;
    }
    // BUG-12 fix: Removed 'explicitLyrics' — not a Track schema field
    if (body.creationDate !== undefined) updateData.creationDate = body.creationDate ? new Date(body.creationDate) : null;
    if (body.countryOfCreation !== undefined) updateData.countryOfCreation = body.countryOfCreation;
    if (body.audioLanguage !== undefined) updateData.audioLanguage = body.audioLanguage;

    // Display info
    if (body.displayArtist !== undefined) updateData.displayArtist = body.displayArtist;
    if (body.displayArtistLocalized !== undefined) updateData.displayArtistLocalized = body.displayArtistLocalized;

    // Relations — validate artist belongs to same tenant
    if (body.artistId !== undefined) {
      if (body.artistId !== null) {
        const tenantId = existingTrack.release?.tenantId;
        const artist = await prisma.artist.findFirst({
          where: { id: body.artistId, tenantId: tenantId || undefined },
        });
        if (!artist) {
          return NextResponse.json({ error: "ERROR_CANNOT_ASSIGN_TRACK_TO_AN_ARTIST_YOU_DO_NOT" }, { status: 403 });
        }
      }
      updateData.artistId = body.artistId;
    }

    if (body.audioAssetId !== undefined) updateData.audioAssetId = body.audioAssetId;
    if (body.compositionId !== undefined) updateData.compositionId = body.compositionId;
    if (body.canvasAssetId !== undefined) updateData.canvasAssetId = body.canvasAssetId === "" ? null : body.canvasAssetId;
    if (body.motionAssetId !== undefined) updateData.motionAssetId = body.motionAssetId === "" ? null : body.motionAssetId;
    if (body.admAssetId !== undefined) updateData.admAssetId = body.admAssetId === "" ? null : body.admAssetId;
    if (body.masteringEngineerEmail !== undefined) updateData.masteringEngineerEmail = body.masteringEngineerEmail || null;

    // Validate asset references against tenant bounds
    const assetsToValidate = [updateData.audioAssetId, updateData.canvasAssetId, updateData.motionAssetId, updateData.admAssetId].filter(a => a && typeof a === "string");
    for (const assetId of assetsToValidate) {
      if (assetId) {
        const hasAccess = await validateAssetAccess(session, assetId, existingTrack.release?.tenantId);
        if (!hasAccess) {
          return NextResponse.json({ error: `ERROR_CANNOT_ASSIGN_ASSET_YOU_DO_NOT_OWN: ${assetId}` }, { status: 403 });
        }
      }
    }

    // BUG-11 fix: Contributors are managed via TrackContributor relational table,
    // not stored directly on the Track model. Handle separately if needed.
    // Removed: featuredArtists, contributors — these are NOT Track schema columns

    // Recording label info (these ARE valid Track columns)
    if (body.recordingLabel !== undefined) updateData.recordingLabel = body.recordingLabel;
    if (body.recordingLabelLocalized !== undefined) updateData.recordingLabelLocalized = body.recordingLabelLocalized;
    if (body.recordingLabelShare !== undefined) updateData.recordingLabelShare = body.recordingLabelShare;

    // Territories
    if (body.territories !== undefined) updateData.territories = body.territories;
    if (body.excludingTerritories !== undefined) updateData.excludingTerritories = body.excludingTerritories;

    // Contract
    if (body.contractPeriodBegins !== undefined) updateData.contractPeriodBegins = body.contractPeriodBegins ? new Date(body.contractPeriodBegins) : null;
    if (body.contractPeriodEnds !== undefined) updateData.contractPeriodEnds = body.contractPeriodEnds ? new Date(body.contractPeriodEnds) : null;
    if (body.contractNumber !== undefined) updateData.contractNumber = body.contractNumber;

    // Snippet
    if (body.snippetStart !== undefined) updateData.snippetStart = body.snippetStart;
    if (body.snippetEnd !== undefined) updateData.snippetEnd = body.snippetEnd;

    // Pitching
    if (body.pitchingNote !== undefined) updateData.pitchingNote = body.pitchingNote;
    if (body.pitchingAmazonData !== undefined) updateData.pitchingAmazonData = body.pitchingAmazonData;
    if (body.pitchingSpotifyData !== undefined) updateData.pitchingSpotifyData = body.pitchingSpotifyData;
    if (body.pitchingTidalData !== undefined) updateData.pitchingTidalData = body.pitchingTidalData;

    const track = await prisma.track.update({
      where: { id },
      data: updateData,
      include: {
        release: { select: { id: true, title: true } },
        artist: { select: { id: true, name: true } },
        audioAsset: { select: { id: true, fileName: true } },
        canvasAsset: { select: { id: true, fileName: true } },
        motionAsset: { select: { id: true, fileName: true } },
        admAsset: { select: { id: true, fileName: true, bitDepth: true, sampleRate: true, codec: true } },
        composition: { select: { id: true, title: true } },
      },
    });

    return NextResponse.json(track);
  } catch (error) {
    console.error("Error updating track:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_UPDATE_TRACK" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = await getSecureSession();
    if (!session) return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    if (!hasPermission(session, PERMISSIONS.RELEASE_DELETE)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    if (!(await hasTrackAccess(session, id))) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const trackWithAsset = await prisma.track.findUnique({
      where: { id },
      select: {
        // BUG-6 fix: Include all asset types for cleanup
        audioAsset: { select: { id: true, fileUrl: true } },
        canvasAsset: { select: { id: true, fileUrl: true } },
        motionAsset: { select: { id: true, fileUrl: true } },
        admAsset: { select: { id: true, fileUrl: true } },
        release: { select: { status: true } },
      },
    });

    if (!trackWithAsset) return NextResponse.json({ error: "ERROR_TRACK_NOT_FOUND" }, { status: 404 });

    const protectedEditStatuses = ["APPROVED", "SCHEDULED", "DELIVERED", "RELEASED", "TAKEDOWN", "PENDING_SYS_APPROVAL"];
    const canBypassLock = isSystemAdmin(session) || session.roles.includes("moderator");

    if (
      !canBypassLock &&
      trackWithAsset.release &&
      protectedEditStatuses.includes(trackWithAsset.release.status)
    ) {
      return NextResponse.json(
        { error: `Cannot delete a track linked to a release with status "${trackWithAsset.release.status}". Contact admin for changes.` },
        { status: 400 },
      );
    }

    // Clean up all associated asset files
    if (trackWithAsset.audioAsset?.fileUrl) await deleteFileFromServer(trackWithAsset.audioAsset.fileUrl);
    if (trackWithAsset.canvasAsset?.fileUrl) await deleteFileFromServer(trackWithAsset.canvasAsset.fileUrl);
    if (trackWithAsset.motionAsset?.fileUrl) await deleteFileFromServer(trackWithAsset.motionAsset.fileUrl);
    if (trackWithAsset.admAsset?.fileUrl) await deleteFileFromServer(trackWithAsset.admAsset.fileUrl);

    await prisma.track.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting track:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_DELETE_TRACK" }, { status: 500 });
  }
}
