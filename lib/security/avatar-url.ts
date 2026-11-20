export function normalizeAvatarUploadUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;

  let path = value.trim();
  if (!path || path.length > 2000) return null;

  try {
    path = new URL(path).pathname;
  } catch {
    // Accept relative upload paths below.
  }

  path = path.split("?")[0].split("#")[0];

  const marker = "/uploads/avatars/";
  const markerIndex = path.indexOf(marker);
  if (markerIndex === -1) return null;

  const subPath = path.slice(markerIndex + marker.length);
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

export function isSafeAvatarUploadUrl(value: unknown): boolean {
  return normalizeAvatarUploadUrl(value) !== null;
}
