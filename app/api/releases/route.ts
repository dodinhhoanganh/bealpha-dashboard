import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSession,
  getSecureSession,
  hasPermission,
  PERMISSIONS,
  isSystemAdmin,
} from "@/lib/auth";
import { NotificationService } from "@/lib/services/notification.service";
import { getUploadApiKey } from "@/lib/upload";

import { getAccessibleEntityIds } from "@/lib/entity-hierarchy";

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
    const status = searchParams.get("status");
    let limit = parseInt(searchParams.get("limit") || "20");
    if (isNaN(limit) || limit < 1) limit = 20;
    limit = Math.min(limit, 100);
    let page = parseInt(searchParams.get("page") || "1");
    if (isNaN(page) || page < 1) page = 1;
    const search = searchParams.get("search");
    const sortBy = searchParams.get("sortBy") || "releaseDate";
    const sortOrder = (searchParams.get("sortOrder") || "desc") as "asc" | "desc";
    const upcoming = searchParams.get("upcoming") === "true";
    const type = searchParams.get("type");

    const now = new Date();

    // B2B2B scoping
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let whereClause: any = {};

    if (isSystemAdmin(session)) {
      // System admins see all releases (optional tenantId filter)
      const filterTenantId = searchParams.get("tenantId");
      if (filterTenantId) whereClause.tenantId = filterTenantId;
    } else if (session.tenantId) {
      // Sub-account: see only own entity's releases OR releases tagging them (if artist)
      if (session.entityType === "SUB_ACCOUNT") {
        if (session.roles.includes("artist")) {
          whereClause.OR = [
            { ownerId: session.entityId },
            { artist: { name: session.entityName } }
          ];
        } else {
          whereClause.ownerId = session.entityId;
        }
      } else {
        const accessibleIds = await getAccessibleEntityIds(session.entityId);
        whereClause.tenantId = { in: accessibleIds };
      }
    } else {
      return NextResponse.json([]);
    }

    // Staff role overrides: moderator/supporter see all within their tenant scope
    // BUG-8 fix: Merge scope instead of replacing entire whereClause (which discarded filters)
    // Security audit fix H5: Sub-accounts with staff roles use OR to expand, not delete ownerId
    if (session.roles.includes("moderator") || session.roles.includes("supporter")) {
      if (session.tenantId) {
        if (session.entityType === "SUB_ACCOUNT") {
          // Sub-account with staff role: see own releases + all tenant releases via OR
          whereClause.OR = [
            { ownerId: session.entityId },
            { tenantId: session.tenantId },
          ];
          // Remove the flat ownerId filter since we now use OR
          delete whereClause.ownerId;
        } else {
          // Organization with staff role: already hierarchy-scoped, no change needed
          if (!whereClause.tenantId?.in) {
            const accessibleIds = await getAccessibleEntityIds(session.entityId);
            whereClause.tenantId = { in: accessibleIds };
          }
        }
      }
      // System admins with staff roles already have no tenant filter above
    }

    // Apply filters
    if (status) whereClause.status = status;
    if (search) whereClause.title = { contains: search, mode: "insensitive" };
    if (upcoming) {
      whereClause.releaseDate = { gte: now };
    } else if (searchParams.has("upcoming")) {
      whereClause.releaseDate = { lt: now };
    }
    if (type === "AUDIO" || type === "VIDEO") whereClause.type = type;

    const validSortFields: Record<string, string> = {
      releaseDate: "releaseDate",
      title: "title",
      status: "status",
      createdAt: "createdAt",
    };
    const orderField = validSortFields[sortBy] || "releaseDate";

    const total = await prisma.release.count({ where: whereClause });
    const totalPages = Math.ceil(total / limit);
    const skip = (page - 1) * limit;

    const releases = await prisma.release.findMany({
      where: whereClause,
      include: {
        artist: { select: { id: true, name: true } },
        label: { select: { id: true, name: true } },
        _count: { select: { tracks: true } },
      },
      orderBy: { [orderField]: upcoming ? "asc" : sortOrder },
      skip,
      take: limit,
    });

    const formattedReleases = releases.map((release) => ({
      id: release.id,
      title: release.title,
      artist: release.artist?.name || "Unknown Artist",
      artistId: release.artistId,
      label: release.label?.name || "Unknown Label",
      labelId: release.labelId,
      project: release.title,
      format: release.format,
      releaseDate: release.releaseDate.toLocaleDateString("en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }),
      cover: release.coverUrl || null,
      status: release.status,
      trackCount: release._count.tracks,
    }));

    return NextResponse.json({ data: formattedReleases, total, page, limit, totalPages });
  } catch (error) {
    console.error("Error fetching releases:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_FETCH_RELEASES" }, { status: 500 });
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

    if (!body.title || !String(body.title).trim()) {
      return NextResponse.json({ error: "ERROR_RELEASE_TITLE_IS_REQUIRED" }, { status: 400 });
    }

    // B2B2B: resolve tenant + owner
    const tenantId = session.tenantId || (isSystemAdmin(session) ? body.tenantId : null);
    if (!tenantId) {
      return NextResponse.json({ error: "ERROR_NO_TENANT_CONTEXT" }, { status: 400 });
    }
    
    let ownerId = session.entityId;
    if (session.entityType !== "SUB_ACCOUNT" && body.ownerId) {
      if (isSystemAdmin(session)) {
        ownerId = body.ownerId;
      } else {
        const accessibleIds = await getAccessibleEntityIds(session.entityId);
        if (accessibleIds.includes(body.ownerId)) {
          ownerId = body.ownerId;
        }
      }
    }

    // Validate artist belongs to tenant
    let artistId = body.artistId;
    if (!artistId && body.primaryArtists && body.primaryArtists.length > 0) {
      artistId = body.primaryArtists[0];
    }

    if (artistId) {
      const artist = await prisma.artist.findFirst({
        where: { id: artistId, tenantId },
        select: { id: true, labelId: true, name: true },
      });
      if (!artist) {
        return NextResponse.json(
          { error: "ERROR_ARTIST_NOT_FOUND_OR_NOT_MANAGED_BY_YOU" },
          { status: 403 },
        );
      }

      // Enforce: Artist sub-account MUST tag themselves
      if (session.entityType === "SUB_ACCOUNT" && session.roles.includes("artist")) {
        let isTagged = artist.name === session.entityName;
        
        // If primary artist isn't them, check other primary artists AND featuring artists
        if (!isTagged) {
          const checkArtistIds = [
            ...(body.primaryArtists || []),
            ...(body.featuringArtists || [])
          ].filter(Boolean);

          if (checkArtistIds.length > 0) {
            const allArtists = await prisma.artist.findMany({
              where: { id: { in: checkArtistIds }, tenantId },
              select: { name: true }
            });
            isTagged = allArtists.some((a: { name: string }) => a.name === session.entityName);
          }
        }

        if (!isTagged) {
          return NextResponse.json(
            { error: "ERROR_ARTIST_ACCOUNT_MUST_INCLUDE_THEMSELVES_IN_RELEASE" },
            { status: 403 }
          );
        }
      }
    }

    // Validate label belongs to tenant
    let labelId = body.labelId;
    if (labelId) {
      const label = await prisma.label.findFirst({
        where: { id: labelId, tenantId },
      });
      if (!label) {
        return NextResponse.json(
          { error: "ERROR_CANNOT_ASSIGN_TO_A_LABEL_YOU_DO_NOT_MANAGE" },
          { status: 403 },
        );
      }
    }

    // Validate dates
    if (!body.releaseDate || isNaN(new Date(body.releaseDate).getTime())) {
      return NextResponse.json({ error: "ERROR_INVALID_OR_MISSING_RELEASE_DATE" }, { status: 400 });
    }
    if (body.originalReleaseDate && isNaN(new Date(body.originalReleaseDate).getTime())) {
      return NextResponse.json({ error: "ERROR_INVALID_ORIGINAL_RELEASE_DATE" }, { status: 400 });
    }

    const release = await prisma.$transaction(async (tx) => {
      const newRelease = await tx.release.create({
        data: {
          title: body.title,
          subtitle: body.titleVersion,
          type: body.releaseType === "VIDEO" ? "VIDEO" : "AUDIO",

          artistId,
          labelId,

          format: body.format || "SINGLE",
          releaseDate: new Date(body.releaseDate),
          originalReleaseDate: body.originalReleaseDate
            ? new Date(body.originalReleaseDate)
            : new Date(body.releaseDate),

          genre: body.genre,
          subGenre: body.subGenre,
          metaLanguage: body.metaLanguage || "en",
          parentalWarningType:
            body.parentalWarningType ||
            (() => {
              if (!body.tracks || !Array.isArray(body.tracks)) return "NotExplicit";
              const hasExplicit = body.tracks.some((t: any) => t.explicitContent === "EXPLICIT");
              const hasClean = body.tracks.some((t: any) => t.explicitContent === "CLEAN");
              if (hasExplicit) return "Explicit";
              if (hasClean) return "Edited";
              return "NotExplicit";
            })(),

          remixer: body.remixer,
          producer: body.producer,
          cLine: body.cLine,
          pLine: body.pLine,
          cLineYear: new Date().getFullYear(),
          pLineYear: new Date().getFullYear(),
          ean: body.upc || body.ean,
          grid: body.grid,
          catalogueNumber: body.releaseCode || body.catalogueNumber,

          coverUrl: body.coverUrl && typeof body.coverUrl === "string" && /^(https?:\/\/|\/uploads\/)/i.test(body.coverUrl)
            ? body.coverUrl : null,

          status: "DRAFT",
          tenantId,
          ownerId,

          excludingTerritories: body.excludedTerritories
            ? body.excludedTerritories.join(",")
            : null,
        },
      });

      // Create Tracks
      if (body.tracks && Array.isArray(body.tracks)) {
        for (let i = 0; i < body.tracks.length; i++) {
          const trackData = body.tracks[i];

          // Validate audio asset belongs to same release/tenant
          if (trackData.audioAssetId && !isSystemAdmin(session)) {
            const asset = await tx.asset.findFirst({
              where: {
                id: trackData.audioAssetId,
                release: { tenantId },
              },
            });
            // If asset has no release yet, allow it
            if (asset === null) {
              const unlinkedAsset = await tx.asset.findUnique({
                where: { id: trackData.audioAssetId },
              });
              if (!unlinkedAsset) {
                throw new Error(`Audio asset for track "${trackData.title}" not found`);
              }
            }
          }

          const newTrack = await tx.track.create({
            data: {
              releaseId: newRelease.id,
              trackNumber: i + 1,
              title: trackData.title,
              subtitle: trackData.version,
              audioAssetId: trackData.audioAssetId || null,
              isrc: trackData.isrc,
              parentalWarningType:
                trackData.explicitContent === "EXPLICIT"
                  ? "Explicit"
                  : trackData.explicitContent === "CLEAN"
                    ? "Edited"
                    : "NotExplicit",
              lyricsLanguage: trackData.lyricsLanguage,
              audioLanguage: trackData.audioLanguage || "en",
              lyrics: trackData.lyrics,
              snippetStart: trackData.snippetStart
                ? (() => {
                    const p = String(trackData.snippetStart).split(":").map(Number);
                    if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
                    if (p.length === 2) return p[0] * 60 + p[1];
                    return parseInt(trackData.snippetStart) || 30;
                  })()
                : 30,
              canvasAssetId: trackData.canvasAssetId || null,
              motionAssetId: trackData.motionAssetId || null,
              pitchingNote: trackData.pitchingNote || null,
              pitchingSpotifyData: trackData.pitchingSpotifyData || undefined,
              pitchingAmazonData: trackData.pitchingAmazonData || undefined,
              pitchingTidalData: trackData.pitchingTidalData || undefined,
            },
          });

          // Create Track Contributors
          const trackContributorsData: any[] = [];

          if (trackData.featuringArtists && Array.isArray(trackData.featuringArtists)) {
            for (const aId of trackData.featuringArtists) {
              if (aId) trackContributorsData.push({ trackId: newTrack.id, artistId: aId, role: "FeaturedArtist" });
            }
          }
          if (trackData.primaryArtists && Array.isArray(trackData.primaryArtists)) {
            for (const aId of trackData.primaryArtists) {
              if (aId) trackContributorsData.push({ trackId: newTrack.id, artistId: aId, role: "MainArtist" });
            }
          }
          if (trackData.contributors) {
            const processContributors = (list: any[], defaultRole?: string) => {
              if (!Array.isArray(list)) return;
              for (const c of list) {
                if (c.artistId || c.name) {
                  trackContributorsData.push({
                    trackId: newTrack.id,
                    artistId: c.artistId || null,
                    name: c.name || null,
                    role: c.role || defaultRole || "UnknownRole",
                  });
                }
              }
            };
            processContributors(trackData.contributors.performers);
            processContributors(trackData.contributors.studioPersonnel);
            processContributors(trackData.contributors.labelPersonnel);
            processContributors(trackData.contributors.compositional);
          }

          if (trackContributorsData.length > 0) {
            await tx.trackContributor.createMany({ data: trackContributorsData, skipDuplicates: true });
          }

          if (trackData.audioAssetId) {
            await tx.asset.update({
              where: { id: trackData.audioAssetId },
              data: { releaseId: newRelease.id },
            });
          }
        }
      }

      return newRelease;
    });

    // Notify
    await NotificationService.notifyReleaseCreated(release.id, session.id).catch(console.error);

    // Trigger finalize-release on Upload Server
    const UPLOAD_SERVER = process.env.UPLOAD_SERVER_URL || "http://localhost:3001";
    try {
      const finalizeRes = await fetch(`${UPLOAD_SERVER}/upload/finalize-release`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": getUploadApiKey(),
        },
        body: JSON.stringify({ releaseId: release.id }),
      });
      if (!finalizeRes.ok) {
        const errorData = await finalizeRes.json().catch(() => ({}));
        throw new Error(errorData.error || `Upload server returned ${finalizeRes.status}`);
      }
    } catch (err: any) {
      console.error("Failed to trigger finalize-release:", err);
      return NextResponse.json(
        { error: "ERROR_RELEASE_SAVED_BUT_FILE_FINALIZATION_FAILED_P" },
        { status: 500 },
      );
    }

    return NextResponse.json(release, { status: 201 });
  } catch (error) {
    console.error("Error creating release:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_CREATE_RELEASE" }, { status: 500 });
  }
}
