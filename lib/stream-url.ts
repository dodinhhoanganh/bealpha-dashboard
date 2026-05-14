/**
 * Signed Stream URL Utility
 * 
 * Generates signed streaming URLs that prevent IDM (Internet Download Manager)
 * from hijacking media links. URLs are signed with HMAC-SHA256 tokens that:
 *   - Expire after 30 minutes (configurable on server)
 *   - Are bound to the requester's IP address
 *   - Encode the target path inside the token (no path guessing)
 * 
 * Usage:
 *   const url = await getSignedStreamUrl('audio', 'label/release/track/hls/playlist.m3u8');
 *   // Returns: https://upload-server/stream/audio/label/release/track/hls/playlist.m3u8?s=<signed_token>
 */

const UPLOAD_SERVER = process.env.NEXT_PUBLIC_UPLOAD_URL || "";

interface SignedResult {
  path: string;
  token: string;
  expiresAt: number;
  error?: string;
}

interface SignResponse {
  signed: SignedResult[];
}

// Cache signed tokens to avoid excessive API calls
// Key: "type:path", Value: { token, expiresAt }
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

// Buffer time: refresh token 2 minutes before expiry
const REFRESH_BUFFER_SEC = 120;

/**
 * Get a signed stream URL for a media file.
 * @param type - Stream type: 'audio', 'video', or 'canvas'
 * @param subPath - Path relative to uploads/ (e.g., "audio/label/release/track/hls/playlist.m3u8")
 * @returns Full signed URL ready for playback
 */
export async function getSignedStreamUrl(
  type: "audio" | "video" | "canvas",
  subPath: string
): Promise<string> {
  if (!subPath) return "";
  
  const cacheKey = `${type}:${subPath}`;
  const cached = tokenCache.get(cacheKey);
  const now = Math.floor(Date.now() / 1000);

  // Return cached token if still valid (with buffer)
  if (cached && cached.expiresAt > now + REFRESH_BUFFER_SEC) {
    return buildSignedUrl(type, subPath, cached.token);
  }

  // Request new signed token from server
  try {
    const response = await fetch("/api/stream/sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths: [`${type}/${subPath}`] }),
    });

    if (!response.ok) {
      console.warn("[StreamURL] Failed to sign URL, falling back to unsigned");
      return `${UPLOAD_SERVER}/stream/${type}/${subPath}`;
    }

    const data: SignResponse = await response.json();
    const signed = data.signed?.[0];

    if (signed?.token) {
      tokenCache.set(cacheKey, {
        token: signed.token,
        expiresAt: signed.expiresAt,
      });
      return buildSignedUrl(type, subPath, signed.token);
    }
  } catch (err) {
    console.warn("[StreamURL] Sign request failed:", err);
  }

  // Fallback: unsigned URL (will work in development with referer auth)
  return `${UPLOAD_SERVER}/stream/${type}/${subPath}`;
}

/**
 * Batch sign multiple stream URLs in one request.
 * More efficient than individual calls when loading a tracklist.
 */
export async function batchSignStreamUrls(
  urls: Array<{ type: "audio" | "video" | "canvas"; subPath: string }>
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const toSign: string[] = [];
  const now = Math.floor(Date.now() / 1000);

  // Check cache first
  for (const { type, subPath } of urls) {
    const cacheKey = `${type}:${subPath}`;
    const cached = tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > now + REFRESH_BUFFER_SEC) {
      result.set(cacheKey, buildSignedUrl(type, subPath, cached.token));
    } else {
      toSign.push(`${type}/${subPath}`);
    }
  }

  if (toSign.length === 0) return result;

  try {
    const response = await fetch("/api/stream/sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths: toSign }),
    });

    if (response.ok) {
      const data: SignResponse = await response.json();
      for (const signed of data.signed || []) {
        if (signed.token && signed.path) {
          const [type, ...rest] = signed.path.split("/");
          const subPath = rest.join("/");
          const cacheKey = `${type}:${subPath}`;
          tokenCache.set(cacheKey, {
            token: signed.token,
            expiresAt: signed.expiresAt,
          });
          result.set(
            cacheKey,
            buildSignedUrl(type as "audio" | "video" | "canvas", subPath, signed.token)
          );
        }
      }
    }
  } catch (err) {
    console.warn("[StreamURL] Batch sign failed:", err);
  }

  // Fill in any still-missing with unsigned fallback
  for (const { type, subPath } of urls) {
    const cacheKey = `${type}:${subPath}`;
    if (!result.has(cacheKey)) {
      result.set(cacheKey, `${UPLOAD_SERVER}/stream/${type}/${subPath}`);
    }
  }

  return result;
}

/**
 * Extract the sub-path from a full upload URL for use with stream signing.
 * Converts: "https://server/uploads/audio/label/release/track/file.wav"
 * To: "audio/label/release/track/file.wav"
 */
export function extractStreamSubPath(fileUrl: string): string {
  if (!fileUrl) return "";
  const marker = "/uploads/";
  const idx = fileUrl.indexOf(marker);
  if (idx !== -1) {
    return fileUrl.substring(idx + marker.length);
  }
  return fileUrl;
}

/**
 * Build the full signed URL from components.
 */
function buildSignedUrl(
  type: "audio" | "video" | "canvas",
  subPath: string,
  token: string
): string {
  return `${UPLOAD_SERVER}/stream/${type}/${subPath}?s=${encodeURIComponent(token)}`;
}

/**
 * Clear all cached tokens (e.g., on logout).
 */
export function clearStreamTokenCache(): void {
  tokenCache.clear();
}
