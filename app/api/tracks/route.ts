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

// B2B2B: Check if user has access to attach an asset
async function validateAssetAccess(
  session: Awaited<ReturnType<typeof getSession>>,
  assetId: string,
  releaseTenantId: string
): Promise<boolean> {
  if (!session) return false;
  if (isSystemAdmin(session)) return true;
  
  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    select: { release: { select: { tenantId: true } } }
  });
  
  if (!asset) return false;
  if (!asset.release) return true; // Unlinked asset is safe to attach
  
  if (asset.release.tenantId === releaseTenantId) return true;
  
  const accessibleIds = await getAccessibleEntityIds(session.entityId);
  return accessibleIds.includes(asset.release.tenantId);
}

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
    const releaseId = searchParams.get("releaseId");
    const artistId = searchParams.get("artistId");
    const search = searchParams.get("search");
    let limit = parseInt(searchParams.get("limit") || "20");
    if (isNaN(limit) || limit < 1) limit = 20;
    limit = Math.min(limit, 100);
    let page = parseInt(searchParams.get("page") || "1");
    if (isNaN(page) || page < 1) page = 1;
    const sortBy = searchParams.get("sortBy") || "createdAt";
    const sortOrder = (searchParams.get("sortOrder") || "desc") as "asc" | "desc";

    // B2B2B scoping: tracks belong to releases which belong to tenants
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let whereClause: any = {};

    if (isSystemAdmin(session)) {
      // System admins see all
    } else if (session.tenantId) {
      // Sub-account: see tracks from own releases OR releases tagging them (if artist)
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
        // Organization: see tracks across entity hierarchy
        const accessibleIds = await getAccessibleEntityIds(session.entityId);
        whereClause.release = { tenantId: { in: accessibleIds } };
      }
    } else {
      return NextResponse.json([]);
    }

    if (releaseId) whereClause.releaseId = releaseId;
    if (artistId) whereClause.artistId = artistId;
    if (search) whereClause.title = { contains: search, mode: "insensitive" };

    const total = await prisma.track.count({ where: whereClause });
    const totalPages = Math.ceil(total / limit);
    const skip = (page - 1) * limit;

    const validSortFields: Record<string, string> = {
      title: "title",
      trackNumber: "trackNumber",
      createdAt: "createdAt",
    };
    const orderField = validSortFields[sortBy];
    const orderBy = orderField
      ? { [orderField]: sortOrder }
      : [
          { release: { releaseDate: "desc" as const } },
          { trackNumber: "asc" as const },
        ];

    const tracks = await prisma.track.findMany({
      where: whereClause,
      include: {
        release: { select: { id: true, title: true, coverUrl: true } },
        artist: { select: { id: true, name: true } },
        audioAsset: { select: { id: true, fileName: true, fileUrl: true, duration: true, isrc: true } },
        canvasAsset: { select: { id: true, fileName: true, fileUrl: true, duration: true } },
        motionAsset: { select: { id: true, fileName: true, fileUrl: true, duration: true } },
        admAsset: { select: { id: true, fileName: true, fileUrl: true, duration: true, bitDepth: true, sampleRate: true, codec: true } },
        composition: { select: { id: true, title: true, iswc: true } },
        _count: { select: { streamingMetrics: true } },
        contributors: { select: { id: true, artistId: true, name: true, role: true, share: true } },
      },
      orderBy,
      skip,
      take: limit,
    });

    const formattedTracks = tracks.map((track) => ({
      id: track.id,
      title: track.title,
      titleLocalized: track.titleLocalized,
      subtitle: track.subtitle,
      isrc: track.isrc,
      catalogueNumber: track.catalogueNumber,
      trackNumber: track.trackNumber,
      discNumber: track.discNumber,
      duration: track.duration,
      genre: track.genre,
      parentalWarningType: track.parentalWarningType,
      audioLanguage: track.audioLanguage,
      displayArtist: track.displayArtist,
      artist: track.artist?.name || track.displayArtist || "Unknown Artist",
      artistId: track.artistId,
      release: track.release?.title || "Unknown Release",
      releaseId: track.releaseId,
      coverUrl: track.release?.coverUrl || null,
      audioAsset: track.audioAsset,
      canvasAssetId: track.canvasAssetId,
      motionAssetId: track.motionAssetId,
      canvasAsset: track.canvasAsset || null,
      motionAsset: track.motionAsset || null,
      admAssetId: track.admAssetId,
      admAsset: track.admAsset || null,
      masteringEngineerEmail: track.masteringEngineerEmail,
      composition: track.composition,
      contributors: track.contributors,
      recordingLabel: track.recordingLabel,
      territories: track.territories,
      excludingTerritories: track.excludingTerritories,
      pitchingNote: track.pitchingNote,
      pitchingSpotifyData: track.pitchingSpotifyData,
      pitchingAmazonData: track.pitchingAmazonData,
      pitchingTidalData: track.pitchingTidalData,
      creationDate: track.creationDate,
      countryOfCreation: track.countryOfCreation,
      hasMetrics: track._count.streamingMetrics > 0,
    }));

    return NextResponse.json({ data: formattedTracks, total, page, limit, totalPages });
  } catch (error) {
    console.error("Error fetching tracks:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_FETCH_TRACKS" }, { status: 500 });
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
      return NextResponse.json({ error: "ERROR_TRACK_TITLE_IS_REQUIRED" }, { status: 400 });
    }
    if (!body.releaseId) {
      return NextResponse.json({ error: "ERROR_RELEASE_ID_IS_REQUIRED" }, { status: 400 });
    }

    // Verify release exists and user has access via tenant
    const release = await prisma.release.findUnique({
      where: { id: body.releaseId },
      select: { id: true, tenantId: true, ownerId: true },
    });

    if (!release) {
      return NextResponse.json({ error: "ERROR_RELEASE_NOT_FOUND" }, { status: 404 });
    }

    // Tenant check via entity hierarchy
    if (!isSystemAdmin(session)) {
      const accessibleIds = await getAccessibleEntityIds(session.entityId);
      if (!accessibleIds.includes(release.tenantId)) {
        return NextResponse.json({ error: "ERROR_ACCESS_DENIED_TO_THIS_RELEASE" }, { status: 403 });
      }
    }

    // Validate artist belongs to same tenant
    if (body.artistId) {
      const artist = await prisma.artist.findFirst({
        where: { id: body.artistId, tenantId: release.tenantId },
      });
      if (!artist) {
        return NextResponse.json({ error: "ERROR_CANNOT_ASSIGN_TRACK_TO_AN_ARTIST_YOU_DO_NOT" }, { status: 403 });
      }
    }

    // Validate asset references against tenant bounds
    const assetsToValidate = [body.audioAssetId, body.canvasAssetId, body.motionAssetId, body.admAssetId].filter(Boolean);
    for (const assetId of assetsToValidate) {
      if (assetId) {
        const hasAccess = await validateAssetAccess(session, assetId, release.tenantId);
        if (!hasAccess) {
          return NextResponse.json({ error: `ERROR_CANNOT_ASSIGN_ASSET_YOU_DO_NOT_OWN: ${assetId}` }, { status: 403 });
        }
      }
    }

    const track = await prisma.track.create({
      data: {
        title: body.title.trim(),
        titleLocalized: body.titleLocalized,
        subtitle: body.subtitle,
        subtitleLocalized: body.subtitleLocalized,
        alternativeTitle: body.alternativeTitle,
        alternativeTitleLocalized: body.alternativeTitleLocalized,
        isrc: body.isrc,
        catalogueNumber: body.catalogueNumber,
        trackNumber: body.trackNumber || 1,
        discNumber: body.discNumber || 1,
        duration: body.duration,
        genre: body.genre,
        parentalWarningType: body.parentalWarningType || "NotExplicit",
        audioLanguage: body.audioLanguage || "en",
        creationDate: body.creationDate ? new Date(body.creationDate) : null,
        countryOfCreation: body.countryOfCreation,
        displayArtist: body.displayArtist,
        displayArtistLocalized: body.displayArtistLocalized,
        releaseId: body.releaseId,
        artistId: body.artistId,
        audioAssetId: body.audioAssetId,
        compositionId: body.compositionId,
        recordingLabel: body.recordingLabel,
        recordingLabelLocalized: body.recordingLabelLocalized,
        recordingLabelShare: body.recordingLabelShare,
        territories: body.territories || "WORLDWIDE",
        excludingTerritories: body.excludingTerritories,
        contractPeriodBegins: body.contractPeriodBegins ? new Date(body.contractPeriodBegins) : null,
        contractPeriodEnds: body.contractPeriodEnds ? new Date(body.contractPeriodEnds) : null,
        contractNumber: body.contractNumber,
        snippetStart: body.snippetStart,
        snippetEnd: body.snippetEnd,
        canvasAssetId: body.canvasAssetId || null,
        motionAssetId: body.motionAssetId || null,
        admAssetId: body.admAssetId || null,
        masteringEngineerEmail: body.masteringEngineerEmail || null,
        pitchingNote: body.pitchingNote || null,
        pitchingSpotifyData: body.pitchingSpotifyData || undefined,
        pitchingAmazonData: body.pitchingAmazonData || undefined,
        pitchingTidalData: body.pitchingTidalData || undefined,
      },
    });

    // Create Track Contributors
    const trackContributorsData: any[] = [];

    if (body.featuredArtists && Array.isArray(body.featuredArtists)) {
      for (const aId of body.featuredArtists) {
        if (aId) trackContributorsData.push({ trackId: track.id, artistId: aId, role: "FeaturedArtist" });
      }
    }
    if (body.primaryArtists && Array.isArray(body.primaryArtists)) {
      for (const aId of body.primaryArtists) {
        if (aId) trackContributorsData.push({ trackId: track.id, artistId: aId, role: "MainArtist" });
      }
    }
    if (body.contributors) {
      const processContributors = (list: any[], defaultRole?: string) => {
        if (!Array.isArray(list)) return;
        for (const c of list) {
          if (c.artistId || c.name) {
            trackContributorsData.push({
              trackId: track.id,
              artistId: c.artistId || null,
              name: c.name || null,
              role: c.role || defaultRole || "UnknownRole",
            });
          }
        }
      };
      processContributors(body.contributors.performers);
      processContributors(body.contributors.studioPersonnel);
      processContributors(body.contributors.labelPersonnel);
      processContributors(body.contributors.compositional);
    }

    if (trackContributorsData.length > 0) {
      await prisma.trackContributor.createMany({ data: trackContributorsData, skipDuplicates: true });
    }

    const completedTrack = await prisma.track.findUnique({
      where: { id: track.id },
      include: {
        release: { select: { id: true, title: true } },
        artist: { select: { id: true, name: true } },
        audioAsset: { select: { id: true, fileName: true } },
        composition: { select: { id: true, title: true } },
        contributors: true,
      },
    });

    return NextResponse.json(completedTrack, { status: 201 });
  } catch (error) {
    console.error("Error creating track:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_CREATE_TRACK" }, { status: 500 });
  }
}
