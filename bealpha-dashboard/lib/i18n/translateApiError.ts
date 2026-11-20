/**
 * Translates API error codes into user-facing localized messages.
 * 
 * API routes return standardized ERROR_* codes.
 * This utility maps them to human-readable messages using the i18n dictionary.
 * 
 * Usage:
 *   const message = translateApiError(data.error, t);
 */

type TranslateFunction = (key: string, fallback?: string) => string;

/**
 * Translate an API error code to a user-facing message.
 * Falls back to a formatted version of the error code if no translation exists.
 */
export function translateApiError(
  errorCode: string | undefined,
  t: TranslateFunction,
): string {
  if (!errorCode) return t("common.errors", "An error occurred.");

  // Try to find a translation for this error code
  const translated = t(`apiErrors.${errorCode}`, "");
  if (translated) return translated;

  // Fallback: convert ERROR_CODE_FORMAT to readable text
  // e.g. "ERROR_RELEASE_NOT_FOUND" → "Release not found"
  return errorCode
    .replace(/^ERROR_/, "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}
