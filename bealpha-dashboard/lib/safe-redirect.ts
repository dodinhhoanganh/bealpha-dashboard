/**
 * Validate that `value` is a same-origin path safe to use as a redirect target.
 *
 * Open-redirect rejects: schemes (`https://evil`), scheme-relative URLs
 * (`//evil.com`), backslash variants (`/\evil.com`), and empty values.
 *
 * Accepts only paths that begin with a single `/` and continue with a path
 * character. Query strings and fragments are allowed.
 */
export function isSafeRedirectPath(value: string | null | undefined): value is string {
  if (!value || typeof value !== "string") return false;
  if (value.length > 2048) return false;
  if (!value.startsWith("/")) return false;
  if (value.startsWith("//")) return false;
  if (value.startsWith("/\\")) return false;
  // Reject anything that looks like an absolute URL after normalising backslashes.
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
  return true;
}

export function sanitizeRedirectPath(
  value: string | null | undefined,
  fallback = "/",
): string {
  return isSafeRedirectPath(value) ? value : fallback;
}
