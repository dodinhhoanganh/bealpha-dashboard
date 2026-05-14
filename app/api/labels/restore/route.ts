import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  getSecureSession,
  isSystemAdmin,
} from "@/lib/auth";

export const maxDuration = 300; // Allows up to 5 minutes of execution

export async function POST(request: NextRequest) {
  try {
    const session = await getSecureSession();
    if (!session)
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });

    // Only Admin or Distributor can restore Labels
    if (!isSystemAdmin(session)) {
      return NextResponse.json(
        { error: "ERROR_ONLY_ADMINISTRATORS_AND_DISTRIBUTORS_CAN_RES" },
        { status: 403 },
      );
    }

    const body = await request.json();
    const { metadata, strategy } = body;

    if (!metadata || !strategy) {
      return NextResponse.json(
        { error: "ERROR_MISSING_METADATA_OR_STRATEGY" },
        { status: 400 },
      );
    }

    if (strategy !== "merge" && strategy !== "new") {
      return NextResponse.json(
        { error: "ERROR_INVALID_RESTORE_STRATEGY" },
        { status: 400 },
      );
    }

    // Wrap the restore operation in a transaction
    await prisma.$transaction(async (tx) => {
      let targetLabelId = metadata.id;

      if (strategy === "new") {
        // Create everything as new IDs to completely duplicate the label
        const newLabel = await tx.label.create({
          data: {
            name: metadata.name + " (Restored)",
            description: metadata.description,
            dpid: metadata.dpid,
            logoUrl: metadata.logoUrl,
            tenantId: session.entityId || session.tenantId || "",
          },
        });
        targetLabelId = newLabel.id;
      } else {
        // Strategy "merge": Check if label exists, if not create it
        const existingLabel = await tx.label.findUnique({
          where: { id: metadata.id },
        });
        if (!existingLabel) {
          await tx.label.create({
            data: {
              id: metadata.id,
              name: metadata.name,
              description: metadata.description,
              dpid: metadata.dpid,
              logoUrl: metadata.logoUrl,
              tenantId: session.entityId || session.tenantId || "",
              createdAt: new Date(metadata.createdAt),
            },
          });
        }
      }

      // Restore Artists
      const artistIdMap = new Map<string, string>(); // old ID -> new ID

      for (const artist of metadata.artists || []) {
        if (strategy === "new") {
          const newArtist = await tx.artist.create({
            data: {
              name: artist.name,
              labelId: targetLabelId,
              isni: artist.isni,
              ipi: artist.ipi,
              dpid: artist.dpid,
              imageUrl: artist.imageUrl,
              spotifyId: artist.spotifyId,
              appleMusicId: artist.appleMusicId,
              tenantId: session.entityId || session.tenantId || "",
            },
          });
          artistIdMap.set(artist.id, newArtist.id);
        } else {
          // Merge: Check by ID or ISNI/IPI/SpotifyID? Let's check by ID.
          let existingArtist = await tx.artist.findUnique({
            where: { id: artist.id },
          });
          if (!existingArtist && artist.spotifyId) {
            existingArtist = await tx.artist.findFirst({
              where: { spotifyId: artist.spotifyId, labelId: targetLabelId },
            });
          }

          if (!existingArtist) {
            existingArtist = await tx.artist.create({
              data: {
                id: artist.id,
                name: artist.name,
                labelId: targetLabelId,
                isni: artist.isni,
                ipi: artist.ipi,
                dpid: artist.dpid,
                imageUrl: artist.imageUrl,
                spotifyId: artist.spotifyId,
                appleMusicId: artist.appleMusicId,
                tenantId: session.entityId || session.tenantId || "",
                createdAt: new Date(artist.createdAt),
              },
            });
          } else {
            // Link to the target label if not already
            if (existingArtist.labelId !== targetLabelId) {
              await tx.artist.update({
                where: { id: existingArtist.id },
                data: { labelId: targetLabelId },
              });
            }
          }
          artistIdMap.set(artist.id, existingArtist.id);
        }
      }

      // Restore Releases
      const releaseIdMap = new Map<string, string>();

      for (const release of metadata.releases || []) {
        if (strategy === "new") {
          const newRelease = await tx.release.create({
            data: {
              title: release.title,
              titleLocalized: release.titleLocalized,
              subtitle: release.subtitle,
              subtitleLocalized: release.subtitleLocalized,
              type: release.type,
              format: release.format,
              genre: release.genre,
              subGenre: release.subGenre,
              releaseDate: new Date(release.releaseDate),
              originalReleaseDate: release.originalReleaseDate
                ? new Date(release.originalReleaseDate)
                : null,
              metaLanguage: release.metaLanguage,
              parentalWarningType: release.parentalWarningType,
              artistId: release.artistId
                ? artistIdMap.get(release.artistId) || null
                : null,
              displayArtist: release.displayArtist,
              displayArtistLocalized: release.displayArtistLocalized,
              remixer: release.remixer,
              producer: release.producer,
              labelId: targetLabelId,
              pLine: release.pLine,
              cLine: release.cLine,
              pLineYear: release.pLineYear,
              cLineYear: release.cLineYear,
              coverUrl: release.coverUrl,
              coverImageFileName: release.coverImageFileName,
              status: "DRAFT",
              tenantId: session.entityId || session.tenantId || "",
              ownerId: session.id,
            },
          });
          releaseIdMap.set(release.id, newRelease.id);
        } else {
          // Merge: Check by EAN or ID
          let existingRelease = await tx.release.findUnique({
            where: { id: release.id },
          });
          if (!existingRelease && release.ean) {
            existingRelease = await tx.release.findUnique({
              where: { ean: release.ean },
            });
          }

          if (!existingRelease) {
            existingRelease = await tx.release.create({
              data: {
                id: release.id,
                title: release.title,
                titleLocalized: release.titleLocalized,
                subtitle: release.subtitle,
                subtitleLocalized: release.subtitleLocalized,
                ean: release.ean,
                grid: release.grid,
                catalogueNumber: release.catalogueNumber,
                type: release.type,
                format: release.format,
                genre: release.genre,
                subGenre: release.subGenre,
                releaseDate: new Date(release.releaseDate),
                originalReleaseDate: release.originalReleaseDate ? new Date(release.originalReleaseDate) : null,
                metaLanguage: release.metaLanguage,
                parentalWarningType: release.parentalWarningType,
                artistId: release.artistId ? artistIdMap.get(release.artistId) || release.artistId : null,
                displayArtist: release.displayArtist,
                displayArtistLocalized: release.displayArtistLocalized,
                remixer: release.remixer,
                producer: release.producer,
                labelId: targetLabelId,
                pLine: release.pLine,
                cLine: release.cLine,
                pLineYear: release.pLineYear,
                cLineYear: release.cLineYear,
                coverUrl: release.coverUrl,
                coverImageFileName: release.coverImageFileName,
                status: release.status || "DRAFT",
                tenantId: session.entityId || session.tenantId || "",
                ownerId: session.id,
                createdAt: new Date(release.createdAt),
              },
            });
          }
          releaseIdMap.set(release.id, existingRelease.id);
        }

        // Restore Tracks for this Release
        for (const track of release.tracks || []) {
          let targetTrackId = null;

          if (strategy === "new") {
            const newTrack = await tx.track.create({
              data: {
                releaseId: releaseIdMap.get(release.id)!,
                title: track.title,
                titleLocalized: track.titleLocalized,
                subtitle: track.subtitle || track.version,
                subtitleLocalized:
                  track.subtitleLocalized || track.versionLocalized,
                displayArtist: track.displayArtist,
                displayArtistLocalized: track.displayArtistLocalized,
                artistId: track.artistId
                  ? artistIdMap.get(track.artistId) || null
                  : null,
                discNumber: track.discNumber,
                trackNumber: track.trackNumber,
                genre: track.genre,
                // subGenre: track.subGenre, // Track model does not have subGenre
                audioLanguage: track.audioLanguage,
                parentalWarningType: track.parentalWarningType,
                isrc: null, // Clear ISRC if new
              },
            });
            targetTrackId = newTrack.id;
          } else {
            // Merge
            let existingTrack = await tx.track.findUnique({
              where: { id: track.id },
            });
            if (!existingTrack && track.isrc) {
              existingTrack = await tx.track.findUnique({
                where: { isrc: track.isrc },
              });
            }

            if (!existingTrack) {
              existingTrack = await tx.track.create({
                data: {
                  id: track.id,
                  releaseId: releaseIdMap.get(release.id)!,
                  title: track.title,
                  titleLocalized: track.titleLocalized,
                  subtitle: track.subtitle || track.version,
                  subtitleLocalized:
                    track.subtitleLocalized || track.versionLocalized,
                  displayArtist: track.displayArtist,
                  displayArtistLocalized: track.displayArtistLocalized,
                  artistId: track.artistId
                    ? artistIdMap.get(track.artistId) || track.artistId
                    : null,
                  discNumber: track.discNumber,
                  trackNumber: track.trackNumber,
                  genre: track.genre,
                  audioLanguage: track.audioLanguage,
                  parentalWarningType: track.parentalWarningType,
                  isrc: track.isrc,
                  createdAt: new Date(track.createdAt),
                },
              });
            }
            targetTrackId = existingTrack.id;
          }

          // Restore AudioAsset
          if (track.audioAsset) {
            const asset = track.audioAsset;
            const existingTrackWithAsset = await tx.track.findUnique({
              where: { id: targetTrackId },
              select: { audioAssetId: true },
            });

            if (!existingTrackWithAsset?.audioAssetId) {
              const newAsset = await tx.asset.create({
                data: {
                  id: strategy === "merge" ? asset.id : undefined,
                  releaseId: releaseIdMap.get(release.id)!,
                  type: asset.type,
                  fileName: asset.fileName,
                  originalFileName: asset.originalFileName,
                  fileUrl: asset.fileUrl,
                  fileSize: asset.fileSize ? BigInt(asset.fileSize) : null,
                  mimeType: asset.mimeType,
                  duration: asset.duration,
                  width: asset.width,
                  height: asset.height,
                },
              });
              await tx.track.update({
                where: { id: targetTrackId },
                data: { audioAssetId: newAsset.id },
              });
            }
          }

          // Restore Composition & Contributors
          // To keep it simple, if "new" strategy, we create them. If merge and they don't exist, we create them.
          if (track.composition) {
            const existingTrackWithComp = await tx.track.findUnique({
              where: { id: targetTrackId },
              select: { compositionId: true },
            });
            if (!existingTrackWithComp?.compositionId) {
              const newComp = await tx.composition.create({
                data: {
                  id: strategy === "merge" ? track.composition.id : undefined,
                  title: track.composition.title,
                  iswc: track.composition.iswc,
                },
              });
              await tx.track.update({
                where: { id: targetTrackId },
                data: { compositionId: newComp.id },
              });
            }
          }

          if (track.contributors && track.contributors.length > 0) {
            // Clean up old contributors for this track if merging
            if (strategy === "merge") {
              await tx.trackContributor.deleteMany({
                where: { trackId: targetTrackId },
              });
            }

            const contributorData = track.contributors.map((c: any) => ({
              id: strategy === "merge" ? c.id : undefined,
              trackId: targetTrackId,
              artistId: c.artistId
                ? artistIdMap.get(c.artistId) || c.artistId
                : null,
              name: c.name,
              role: c.role || c.primaryRole || "MainArtist",
              share: c.share ? new Prisma.Decimal(c.share) : null,
            }));

            await tx.trackContributor.createMany({
              data: contributorData,
              skipDuplicates: true,
            });
          }
        } // End Track Restore
      } // End Release Restore
    });

    return NextResponse.json({
      success: true,
      message: "Label restored successfully",
    });
  } catch (error) {
    console.error("Restore failed:", error);
    return NextResponse.json(
      { error: "ERROR_FAILED_TO_RESTORE_DATABASE_RECORDS" },
      { status: 500 },
    );
  }
}
