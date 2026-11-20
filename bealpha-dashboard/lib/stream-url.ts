import { apiRequest, captureAuthSession } from "@/lib/api-client";

export type StreamType = "audio" | "video" | "canvas" | "image";

interface StreamGrant {
  url: string;
  expiresAt: string;
}

const ASSET_REFERENCE = /^media-asset:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const REFRESH_BUFFER_SECONDS = 10;
const grantCache = new Map<string, { url: string; expiresAt: number }>();
let cacheSignal: AbortSignal | null = null;
let cacheRevision = 0;

export function mediaAssetId(reference: string): string | null {
  return ASSET_REFERENCE.exec(reference)?.[1] ?? null;
}

export async function getSignedStreamUrl(type: StreamType, reference: string): Promise<string> {
  const id = mediaAssetId(reference);
  if (!id) throw new Error("Unsupported media source format");
  const session = captureAuthSession();
  session.requireCurrent();
  if (cacheSignal !== session.signal) {
    clearStreamTokenCache();
    cacheSignal = session.signal;
    cacheSignal.addEventListener("abort", clearStreamTokenCache, { once: true });
  }
  const revision = cacheRevision;
  const cacheKey = `${type}:${id}`;
  const cached = grantCache.get(cacheKey);
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt > now + REFRESH_BUFFER_SECONDS) return cached.url;

  const grant = await apiRequest<StreamGrant>(
    `/api/v1/media/assets/${id}/stream-grants`,
    { method: "POST", signal: session.signal },
  );
  session.requireCurrent();
  const expiresAt = Math.floor(new Date(grant.expiresAt).getTime() / 1000);
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) throw new Error("Invalid media grant expiry");
  if (revision === cacheRevision && cacheSignal === session.signal) {
    grantCache.set(cacheKey, { url: grant.url, expiresAt });
  }
  return grant.url;
}

export async function batchSignStreamUrls(
  references: Array<{ type: StreamType; subPath: string }>,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  await Promise.all(references.map(async ({ type, subPath }) => {
    const key = `${type}:${subPath}`;
    try {
      result.set(key, await getSignedStreamUrl(type, subPath));
    } catch {
      // Missing entries signal grant failure to callers.
    }
  }));
  return result;
}

export function extractStreamSubPath(fileUrl: string): string {
  return extractSafeStreamSubPath(fileUrl);
}

export function extractSafeStreamSubPath(fileUrl: string): string {
  return mediaAssetId(fileUrl) ? fileUrl : "";
}

export async function resolveMediaReference(type: StreamType, reference: string): Promise<string> {
  return mediaAssetId(reference) ? getSignedStreamUrl(type, reference) : reference;
}

export function clearStreamTokenCache(): void {
  cacheSignal?.removeEventListener("abort", clearStreamTokenCache);
  cacheSignal = null;
  cacheRevision += 1;
  grantCache.clear();
}
