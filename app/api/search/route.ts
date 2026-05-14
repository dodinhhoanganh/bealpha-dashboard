import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, hasPermission, PERMISSIONS, isSystemAdmin } from "@/lib/auth";
import { getAccessibleEntityIds } from "@/lib/entity-hierarchy";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q")?.trim() || "";
    const scope = searchParams.get("scope") || "ALL";

    if (!q) return NextResponse.json({ data: [] });

    // B2B2B Scoping for Artists, Releases, Labels (which have tenantId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let tenantWhere: any = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let assetWhere: any = {};

    if (!isSystemAdmin(session)) {
      if (session.entityType === "SUB_ACCOUNT") {
        tenantWhere = { tenantId: session.tenantId };
        
        if (session.roles.includes("artist")) {
          assetWhere = {
            release: {
              OR: [
                { ownerId: session.entityId },
                { artist: { name: session.entityName } }
              ]
            }
          };
        } else {
          assetWhere = { release: { ownerId: session.entityId } };
        }
      } else {
        const accessibleIds = await getAccessibleEntityIds(session.entityId);
        tenantWhere = { tenantId: { in: accessibleIds } };
        assetWhere = { release: { tenantId: { in: accessibleIds } } };
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results: any[] = [];
    const limit = scope === "ALL" ? 4 : 10; // Top 10 for specific, or Top 4 for each if ALL

    const fetchPromises = [];

    // 1. ARTISTS
    if (scope === "ALL" || scope === "ARTIST") {
      if (hasPermission(session, PERMISSIONS.ARTIST_READ)) {
        fetchPromises.push(
          prisma.artist.findMany({
            where: { ...tenantWhere, name: { contains: q, mode: "insensitive" } },
            take: limit,
            select: { id: true, name: true, imageUrl: true }
          }).then(artists => {
            artists.forEach(a => results.push({ id: a.id, type: "ARTIST", title: a.name, subtitle: "Artist", image: a.imageUrl }));
          })
        );
      }
    }

    // 2. RELEASES
    if (scope === "ALL" || scope === "RELEASE") {
      if (hasPermission(session, PERMISSIONS.RELEASE_READ)) {
        fetchPromises.push(
          prisma.release.findMany({
            where: { 
              ...tenantWhere, 
              OR: [
                { title: { contains: q, mode: "insensitive" } },
                { ean: { contains: q, mode: "insensitive" } },
                { grid: { contains: q, mode: "insensitive" } }
              ]
            },
            take: limit,
            select: { id: true, title: true, ean: true, coverUrl: true, displayArtist: true }
          }).then(releases => {
            releases.forEach(r => results.push({ id: r.id, type: "RELEASE", title: r.title, subtitle: r.displayArtist || (r.ean ? `UPC: ${r.ean}` : "Release"), image: r.coverUrl }));
          })
        );
      }
    }

    // 3. ASSETS
    if (scope === "ALL" || scope === "ASSET") {
      if (hasPermission(session, PERMISSIONS.RELEASE_READ)) {
        fetchPromises.push(
          prisma.asset.findMany({
            where: { 
              ...assetWhere, 
              OR: [
                { fileName: { contains: q, mode: "insensitive" } },
                { originalFileName: { contains: q, mode: "insensitive" } },
                { isrc: { contains: q, mode: "insensitive" } }
              ]
            },
            take: limit,
            select: { id: true, fileName: true, type: true, isrc: true }
          }).then(assets => {
            assets.forEach(a => results.push({ id: a.id, type: "ASSET", title: a.fileName, subtitle: a.isrc ? `ISRC: ${a.isrc}` : a.type, image: null }));
          })
        );
      }
    }

    // 4. LABELS
    if (scope === "ALL" || scope === "LABEL") {
      if (hasPermission(session, PERMISSIONS.LABEL_READ)) {
        fetchPromises.push(
          prisma.label.findMany({
            where: { ...tenantWhere, name: { contains: q, mode: "insensitive" } },
            take: limit,
            select: { id: true, name: true, logoUrl: true }
          }).then(labels => {
            labels.forEach(l => results.push({ id: l.id, type: "LABEL", title: l.name, subtitle: "Label", image: l.logoUrl }));
          })
        );
      }
    }

    await Promise.all(fetchPromises);

    // Sort or just return
    return NextResponse.json({ data: results.slice(0, 10) });

  } catch (error) {
    console.error("Search Error:", error);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
