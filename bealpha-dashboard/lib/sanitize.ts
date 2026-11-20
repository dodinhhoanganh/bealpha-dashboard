/**
 * Input Sanitization Utilities
 *
 * Input sanitization helpers for preventing XSS when displaying
 * user-controlled text in browser UI.
 */

// ── HTML Sanitization ────────────────────────────────────
const HTML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#x27;",
  "/": "&#x2F;",
  "`": "&#96;",
};

/**
 * Escape HTML entities to prevent XSS when rendering user input.
 */
export function escapeHtml(str: string): string {
  return str.replace(/[&<>"'`/]/g, (char) => HTML_ENTITIES[char] || char);
}

/**
 * Strip all HTML tags from a string.
 */
export function stripHtml(str: string): string {
  return str.replace(/<[^>]*>/g, "").trim();
}

// ── General Sanitization ─────────────────────────────────

/**
 * Sanitize a string input: trim, strip null bytes, limit length.
 */
export function sanitizeString(
  input: unknown,
  maxLength: number = 1000,
): string {
  if (typeof input !== "string") return "";
  return input
    .trim()
    .replace(/\0/g, "") // Remove null bytes
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "") // Remove control chars (keep \n, \r, \t)
    .slice(0, maxLength);
}

/**
 * Sanitize an email address.
 */
export function sanitizeEmail(input: unknown): string {
  const str = sanitizeString(input, 254);
  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(str) ? str.toLowerCase() : "";
}

/**
 * Sanitize a URL. Only allow http(s) protocols.
 */
export function sanitizeUrl(input: unknown): string {
  const str = sanitizeString(input, 2048);
  if (!str) return "";
  try {
    const url = new URL(str);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

/**
 * Sanitize a UUID string.
 */
export function sanitizeUuid(input: unknown): string {
  const str = sanitizeString(input, 36);
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str) ? str : "";
}

/**
 * Sanitize numeric input. Returns the number or a default.
 */
export function sanitizeNumber(
  input: unknown,
  min: number = 0,
  max: number = Number.MAX_SAFE_INTEGER,
  defaultValue: number = 0,
): number {
  const num = typeof input === "string" ? parseInt(input, 10) : Number(input);
  if (isNaN(num)) return defaultValue;
  return Math.max(min, Math.min(max, num));
}

/**
 * Sanitize pagination parameters.
 */
export function sanitizePagination(params: {
  page?: unknown;
  limit?: unknown;
}): { page: number; limit: number } {
  return {
    page: sanitizeNumber(params.page, 1, 10000, 1),
    limit: sanitizeNumber(params.limit, 1, 100, 20),
  };
}

/**
 * Deep sanitize an object — strip HTML from all string values.
 */
export function sanitizeObject<T extends Record<string, unknown>>(obj: T): T {
  const result = { ...obj };
  for (const key of Object.keys(result)) {
    const value = result[key];
    if (typeof value === "string") {
      (result as Record<string, unknown>)[key] = sanitizeString(
        stripHtml(value),
      );
    } else if (Array.isArray(value)) {
      // SEC-10 fix: Sanitize array elements (strings and nested objects)
      (result as Record<string, unknown>)[key] = value.map((item) => {
        if (typeof item === "string") return sanitizeString(stripHtml(item));
        if (item && typeof item === "object" && !Array.isArray(item)) {
          return sanitizeObject(item as Record<string, unknown>);
        }
        return item;
      });
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      (result as Record<string, unknown>)[key] = sanitizeObject(
        value as Record<string, unknown>,
      );
    }
  }
  return result;
}

/**
 * Validate and sanitize a search query.
 * Removes special characters that could affect database queries.
 */
export function sanitizeSearchQuery(
  input: unknown,
  maxLength: number = 200,
): string {
  const str = sanitizeString(input, maxLength);
  // Remove characters that could break LIKE queries or regex
  return str.replace(/[%_\\[\]{}()|*+?^$]/g, "");
}
