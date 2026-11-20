/**
 * External platform URL utilities.
 *
 * Extracts external artist IDs from supported web URLs and app URIs.
 */

/**
 * Extract an artist ID from a supported URL or URI string.
 *
 * The external ID is a Base-62 string, 22 characters long.
 * The [a-zA-Z0-9]+ capturing group stops at ? or / boundaries,
 * automatically stripping tracking parameters.
 */
export function extractSpotifyArtistId(input: string): string | null {
  if (!input || typeof input !== "string") return null;
  const trimmed = input.trim();

  // Accept raw 22-character external IDs.
  if (/^[a-zA-Z0-9]{22}$/.test(trimmed)) {
    return trimmed;
  }

  const regex = /(?:https?:\/\/open\.spotify\.com\/artist\/|spotify:artist:)([a-zA-Z0-9]+)/;
  const match = trimmed.match(regex);
  return match ? match[1] : null;
}

/**
 * Extract a numeric artist ID from a supported catalog URL.
 *
 * The external ID is a numeric integer.
 * Non-capturing groups skip country code and slug segments.
 */
export function extractAppleMusicArtistId(input: string): string | null {
  if (!input || typeof input !== "string") return null;
  const trimmed = input.trim();

  // Accept raw numeric external IDs.
  if (/^\d{4,15}$/.test(trimmed)) {
    return trimmed;
  }

  const regex = /(?:https?:\/\/(?:music|itunes)\.apple\.com\/(?:[a-z]{2}\/)?artist\/(?:[^\/]+\/)?|amgArtistId=)(\d+)/;
  const match = trimmed.match(regex);
  return match ? match[1] : null;
}

/**
 * Detect which supported platform an input string belongs to and extract the ID.
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
 * Normalize artwork CDN URLs to a specific resolution.
 * Artwork URLs may end with patterns like 100x100bb.jpg.
 * This replaces the dimensions to get higher quality images.
 */
export function normalizeAppleArtwork(url: string, size = 600): string {
  if (!url) return "";
  return url.replace(/\d+x\d+bb/, `${size}x${size}bb`);
}

/**
 * Build the canonical external URL for a platform artist.
 */
export function spotifyArtistUrl(id: string): string {
  return `https://open.spotify.com/artist/${id}`;
}

/**
 * Build the canonical external URL for a platform artist.
 */
export function appleMusicArtistUrl(id: string): string {
  return `https://music.apple.com/artist/${id}`;
}
