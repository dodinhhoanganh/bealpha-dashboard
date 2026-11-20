const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_EXTERNAL_URL_CHARS = 2000;

export function normalizeExternalHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_EXTERNAL_URL_CHARS) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.username = "";
    url.password = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeUploadUrlForWrite(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let pathname = value.trim();
  if (!pathname) return null;

  try {
    pathname = new URL(pathname).pathname;
  } catch {
    // Relative paths are accepted below.
  }

  pathname = pathname.split("?")[0].split("#")[0];
  const marker = "/uploads/";
  const markerIndex = pathname.indexOf(marker);
  if (markerIndex === -1) return null;

  const subPath = pathname.slice(markerIndex + marker.length);
  if (!subPath) return null;

  let decodedSubPath: string;
  try {
    decodedSubPath = decodeURIComponent(subPath);
  } catch {
    return null;
  }

  if (
    !decodedSubPath ||
    decodedSubPath.includes("\0") ||
    decodedSubPath.includes("\\") ||
    decodedSubPath.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    return null;
  }

  if (/[?#\u0000-\u001f\u007f]/.test(subPath)) return null;
  return `${marker}${subPath}`;
}

export function getTenantScopedUploadUrlTenantId(normalizedUrl: string): string | null {
  const segments = normalizedUrl.replace(/^\/+/, "").replace(/^uploads\//, "").split("/");
  if (segments.length >= 4 && UUID_RE.test(segments[0])) return segments[0];
  return null;
}

export function isUploadUrlAllowedForTenants(normalizedUrl: string, allowedTenantIds: string[]): boolean {
  const tenantId = getTenantScopedUploadUrlTenantId(normalizedUrl);
  return !tenantId || allowedTenantIds.includes(tenantId);
}
