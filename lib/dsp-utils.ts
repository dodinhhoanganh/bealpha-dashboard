/**
 * DSP Utility Functions — Regex-based ID extraction from URLs/URIs
 *
 * Supports:
 * - Spotify Web URLs: https://open.spotify.com/artist/23Gbd21nBxC1kCtcG2Cd0C?si=...
 * - Spotify App URIs: spotify:artist:23Gbd21nBxC1kCtcG2Cd0C
 * - Apple Music URLs: https://music.apple.com/us/artist/taylor-swift/159260351
 * - iTunes URLs: https://itunes.apple.com/fr/artist/name/159260351
 * - Apple Music URLs without slug: https://music.apple.com/gb/artist/159260351
 */

/**
 * Extract Spotify Artist ID from a URL or URI string.
 *
 * Regex handles:
 * - https://open.spotify.com/artist/{id}?si=... (web URL with tracking params)
 * - spotify:artist:{id} (app URI)
 *
 * Spotify IDs are Base-62 strings, 22 characters long.
 * The [a-zA-Z0-9]+ capturing group stops at ? or / boundaries,
 * automatically stripping tracking parameters.
 */
export function extractSpotifyArtistId(input: string): string | null {
  if (!input || typeof input !== "string") return null;
  const trimmed = input.trim();

  // Direct ID check — if it looks like a raw 22-char Base-62 ID
  if (/^[a-zA-Z0-9]{22}$/.test(trimmed)) {
    return trimmed;
  }

  const regex = /(?:https?:\/\/open\.spotify\.com\/artist\/|spotify:artist:)([a-zA-Z0-9]+)/;
  const match = trimmed.match(regex);
  return match ? match[1] : null;
}

/**
 * Extract Apple Music Artist ID from a URL string.
 *
 * Regex handles all URL variants:
 * - https://music.apple.com/us/artist/taylor-swift/159260351 (with country + slug)
 * - https://music.apple.com/gb/artist/159260351 (with country, no slug)
 * - https://itunes.apple.com/fr/artist/name/159260351 (legacy iTunes)
 * - URLs with ?amgArtistId=123456789 (AMG parameter)
 *
 * Apple Music IDs are numeric integers.
 * Non-capturing groups skip country code and slug segments.
 */
export function extractAppleMusicArtistId(input: string): string | null {
  if (!input || typeof input !== "string") return null;
  const trimmed = input.trim();

  // Direct numeric ID check
  if (/^\d{4,15}$/.test(trimmed)) {
    return trimmed;
  }

  const regex = /(?:https?:\/\/(?:music|itunes)\.apple\.com\/(?:[a-z]{2}\/)?artist\/(?:[^\/]+\/)?|amgArtistId=)(\d+)/;
  const match = trimmed.match(regex);
  return match ? match[1] : null;
}

/**
 * Detect which DSP platform an input string belongs to and extract the ID.
 * Useful for paste-to-detect workflows.
 *
 * @returns { platform, id } or null if not recognized
 */
export function detectDspFromInput(input: string): {
  platform: "spotify" | "apple";
  id: string;
} | null {
  if (!input || typeof input !== "string") return null;

  const spotifyId = extractSpotifyArtistId(input);
  if (spotifyId) return { platform: "spotify", id: spotifyId };

  const appleId = extractAppleMusicArtistId(input);
  if (appleId) return { platform: "apple", id: appleId };

  return null;
}

/**
 * Normalize Apple CDN artwork URL to a specific resolution.
 * Apple artwork URLs end with patterns like 100x100bb.jpg
 * This replaces the dimensions to get higher quality images.
 */
export function normalizeAppleArtwork(url: string, size = 600): string {
  if (!url) return "";
  return url.replace(/\d+x\d+bb/, `${size}x${size}bb`);
}

/**
 * Build the canonical external URL for a Spotify artist.
 */
export function spotifyArtistUrl(id: string): string {
  return `https://open.spotify.com/artist/${id}`;
}

/**
 * Build the canonical external URL for an Apple Music artist.
 */
export function appleMusicArtistUrl(id: string): string {
  return `https://music.apple.com/artist/${id}`;
}
