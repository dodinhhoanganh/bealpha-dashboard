import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

/**
 * Federated Artist Search — queries Spotify + iTunes in parallel
 * GET /api/artists/search-dsp?q=artist_name
 *
 * Returns normalized results from both platforms in a single response.
 * Uses Promise.allSettled for resilience — one platform failing doesn't block the other.
 */

interface NormalizedArtist {
  id: string;
  name: string;
  popularity?: number;
  genres: string[];
  imageUrl: string;
  externalUrl: string;
  platform: "spotify" | "apple";
}

function normalizeAppleArtwork(url: string, size = 600): string {
  if (!url) return "";
  return url.replace(/\d+x\d+bb/, `${size}x${size}bb`);
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }

    const q = request.nextUrl.searchParams.get("q");
    if (!q || !q.trim()) {
      return NextResponse.json({ error: "ERROR_QUERY_REQUIRED" }, { status: 400 });
    }

    const query = q.trim();

    // Parallel fetch — both APIs simultaneously via Promise.allSettled
    const [spotifyResult, appleResult] = await Promise.allSettled([
      fetchSpotify(query),
      fetchApple(query),
    ]);

    const spotify: NormalizedArtist[] =
      spotifyResult.status === "fulfilled" ? spotifyResult.value : [];
    const apple: NormalizedArtist[] =
      appleResult.status === "fulfilled" ? appleResult.value : [];

    // Sort: exact name matches first, then partial matches
    const queryLower = query.toLowerCase();
    const sortByRelevance = (a: NormalizedArtist, b: NormalizedArtist) => {
      const aExact = a.name.toLowerCase() === queryLower ? 0 : 1;
      const bExact = b.name.toLowerCase() === queryLower ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      // Then by popularity (Spotify) or name similarity
      return (b.popularity || 0) - (a.popularity || 0);
    };

    spotify.sort(sortByRelevance);
    apple.sort(sortByRelevance);

    return NextResponse.json({
      query,
      spotify,
      apple,
      errors: {
        spotify: spotifyResult.status === "rejected" ? spotifyResult.reason?.message : null,
        apple: appleResult.status === "rejected" ? appleResult.reason?.message : null,
      },
    });
  } catch (error) {
    console.error("Federated search error:", error);
    return NextResponse.json({ error: "ERROR_SEARCH_FAILED" }, { status: 500 });
  }
}

// Spotify token cache (shared with the search route via module scope)
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
let spotifyToken: string | null = null;
let spotifyTokenExpiry = 0;

async function getSpotifyToken(): Promise<string | null> {
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) return null;
  if (spotifyToken && Date.now() < spotifyTokenExpiry) return spotifyToken;

  const authString = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${authString}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) return null;
  const data = await res.json();
  spotifyToken = data.access_token;
  spotifyTokenExpiry = Date.now() + data.expires_in * 1000 - 60000;
  return spotifyToken;
}

async function fetchSpotify(query: string): Promise<NormalizedArtist[]> {
  const token = await getSpotifyToken();
  if (!token) return []; // Credentials not configured — graceful empty

  const res = await fetch(
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=artist&limit=10`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!res.ok) return [];

  const data = await res.json();
  const items = data.artists?.items || [];

  return items.map((item: any) => ({
    id: item.id,
    name: item.name,
    popularity: item.popularity || 0,
    genres: item.genres || [],
    imageUrl: item.images?.[0]?.url || item.images?.[1]?.url || "",
    externalUrl: item.external_urls?.spotify || `https://open.spotify.com/artist/${item.id}`,
    platform: "spotify" as const,
  }));
}

async function fetchApple(query: string): Promise<NormalizedArtist[]> {
  // Call iTunes Search API directly (no auth needed, avoids internal routing overhead)
  const itunesUrl = new URL("https://itunes.apple.com/search");
  itunesUrl.searchParams.set("term", query);
  itunesUrl.searchParams.set("media", "music");
  itunesUrl.searchParams.set("entity", "musicArtist");
  itunesUrl.searchParams.set("attribute", "artistTerm");
  itunesUrl.searchParams.set("limit", "10");

  const res = await fetch(itunesUrl.toString(), {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) return [];

  const data = await res.json();
  const results = data.results || [];

  // Deduplicate by artistId
  const seen = new Set<string>();
  return results
    .filter((item: any) => {
      const id = String(item.artistId);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map((item: any) => ({
      id: String(item.artistId),
      name: item.artistName,
      genres: item.primaryGenreName ? [item.primaryGenreName] : [],
      imageUrl: normalizeAppleArtwork(item.artworkUrl100 || item.artworkUrl60 || "", 600),
      externalUrl: item.artistLinkUrl || `https://music.apple.com/artist/${item.artistId}`,
      platform: "apple" as const,
    }));
}
