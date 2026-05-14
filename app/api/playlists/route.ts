import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, getSecureSession, isAdmin } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }
    const { searchParams } = new URL(request.url);
    const platform = searchParams.get("platform");
    let limit = parseInt(searchParams.get("limit") || "50");
    if (isNaN(limit) || limit < 1) limit = Number("50");
    limit = Math.min(limit, 100);

    const playlists = await prisma.playlist.findMany({
      where: platform ? { platform } : undefined,
      include: {
        _count: {
          select: {
            tracks: true,
          },
        },
      },
      orderBy: { plays: "desc" },
      take: limit,
    });

    // Transform to match dashboard expected format
    const formattedPlaylists = playlists.map((playlist, index) => ({
      id: playlist.id,
      name: playlist.name,
      platform: playlist.platform,
      cover: playlist.coverUrl || null, // A7 fix: removed picsum.photos (leaked playlist IDs to third party)
      plays: playlist.plays,
      followers: playlist.followers,
      color: playlist.color || "#6b7280",
      trackCount: playlist._count.tracks,
    }));

    return NextResponse.json(formattedPlaylists);
  } catch (error) {
    console.error("Error fetching playlists:", error);
    return NextResponse.json(
      { error: "ERROR_FAILED_TO_FETCH_PLAYLISTS" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSecureSession();

    if (!session) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }

    if (!isAdmin(session)) {
      return NextResponse.json(
        { error: "ERROR_ONLY_ADMIN_CAN_CREATE_PLAYLISTS" },
        { status: 403 },
      );
    }

    const body = await request.json();

    // Validate required fields
    if (!body.name || !String(body.name).trim()) {
      return NextResponse.json(
        { error: "ERROR_PLAYLIST_NAME_IS_REQUIRED" },
        { status: 400 },
      );
    }
    if (!body.platform || !String(body.platform).trim()) {
      return NextResponse.json(
        { error: "ERROR_PLATFORM_IS_REQUIRED" },
        { status: 400 },
      );
    }

    const playlist = await prisma.playlist.create({
      data: {
        name: body.name,
        platform: body.platform,
        coverUrl: body.coverUrl && typeof body.coverUrl === "string" && /^(https?:\/\/|\/uploads\/)/i.test(body.coverUrl)
          ? body.coverUrl
          : null,
        followers: body.followers || 0,
        plays: body.plays || 0,
        color: body.color,
        externalId: body.externalId,
      },
    });

    return NextResponse.json(playlist, { status: 201 });
  } catch (error) {
    console.error("Error creating playlist:", error);
    return NextResponse.json(
      { error: "ERROR_FAILED_TO_CREATE_PLAYLIST" },
      { status: 500 },
    );
  }
}
