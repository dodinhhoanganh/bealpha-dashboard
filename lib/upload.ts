const UPLOAD_SERVER = process.env.UPLOAD_SERVER_URL || "http://localhost:3001";
const UPLOAD_API_KEY = process.env.UPLOAD_API_KEY;

/**
 * Security audit fix H6: Get UPLOAD_API_KEY safely.
 * Throws in production if not configured instead of silently using empty string.
 */
export function getUploadApiKey(): string {
  if (!UPLOAD_API_KEY) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("[FATAL] UPLOAD_API_KEY is not configured in production!");
    }
    console.warn("[WARNING] UPLOAD_API_KEY is not set — using empty string (dev only)");
    return "";
  }
  return UPLOAD_API_KEY;
}

/**
 * Parses a full URL to extract the subPath and calls the Upload Server's DELETE endpoint.
 * Throws an error if the upload server fails to delete the file, allowing the caller to block.
 */
export async function deleteFileFromServer(fileUrl: string | null | undefined): Promise<boolean> {
  if (!fileUrl) return true; // Nothing to delete

  const apiKey = getUploadApiKey();

  try {
    // Only process URLs that point to our uploads path
    if (!fileUrl.includes("/uploads/")) {
      return true; // External URL or already handled
    }

    // M3 fix: Handle both absolute URLs and relative /uploads/ paths
    let pathname: string;
    try {
      const urlObj = new URL(fileUrl);
      pathname = urlObj.pathname;
    } catch {
      // Relative path like "/uploads/audio/file.wav" — use directly
      pathname = fileUrl;
    }

    // Extract everything after /uploads/ as the subPath
    const parts = pathname.split("/uploads/");
    if (parts.length < 2) return true;
    
    const subPath = parts[1];
    if (!subPath) return true;

    // Call Upload Server to delete
    const res = await fetch(`${UPLOAD_SERVER}/file/${subPath}`, {
      method: "DELETE",
      headers: {
        "x-api-key": apiKey,
      },
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Upload server returned ${res.status}: ${errorText}`);
    }

    return true;
  } catch (error) {
    console.error(`[deleteFileFromServer] Failed to delete ${fileUrl}:`, error);
    throw error; // Throw so that callers can block database deletion
  }
}

/**
 * Non-blocking file cleanup helper for use in DELETE handlers.
 * Sends delete request to upload server but does not throw on failure.
 */
export async function deleteFileNonBlocking(fileUrl: string): Promise<void> {
  try {
    const apiKey = getUploadApiKey();
    const idx = fileUrl.indexOf("/uploads/");
    if (idx === -1) return;
    let subPath = fileUrl.substring(idx + "/uploads/".length);
    // SEC-9 fix: Decode URL-encoded characters before checking for traversal
    try { subPath = decodeURIComponent(subPath); } catch { /* invalid encoding, reject */ return; }
    // Block path traversal (.. anywhere) and null bytes
    if (!subPath || /\.\./.test(subPath) || /\0/.test(subPath)) return;
    // Only allow safe filename characters: alphanumeric, -, _, ., /
    if (!/^[a-zA-Z0-9\-_./]+$/.test(subPath)) return;
    
    fetch(`${UPLOAD_SERVER}/file/${encodeURIComponent(subPath)}`, {
      method: "DELETE",
      headers: { "x-api-key": apiKey },
    }).catch(() => {});
  } catch { /* ignore */ }
}

