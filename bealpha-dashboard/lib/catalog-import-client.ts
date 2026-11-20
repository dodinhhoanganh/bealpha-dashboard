import { apiRequest, captureAuthSession } from "@/lib/api-client";
import { uploadMediaDirect } from "@/lib/media-upload-client";

interface MediaAssetStatus {
  status: "PENDING" | "PROCESSING" | "READY" | "ERROR" | "ARCHIVED";
  processingError?: string | null;
}

interface CatalogImport {
  id: string;
  status: "PENDING" | "PROCESSING" | "COMPLETE" | "FAILED";
  releaseCount: number;
  trackCount: number;
  lastError?: string | null;
}

const POLL_MS = 1000;
const MAX_WAIT_MS = 30 * 60 * 1000;

async function waitFor<T>(load: () => Promise<T>, done: (value: T) => boolean, session: ReturnType<typeof captureAuthSession>): Promise<T> {
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    session.requireCurrent();
    const value = await load();
    session.requireCurrent();
    if (done(value)) return value;
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
  }
  session.requireCurrent();
  throw new Error("ERROR_CATALOG_IMPORT_TIMEOUT");
}

export async function importCatalogDirect(file: File, format: "XML" | "ZIP" | "CSV" | "XLSX", onProgress?: (percent: number) => void): Promise<CatalogImport> {
  const session = captureAuthSession();
  const uploaded = await uploadMediaDirect("ARCHIVE", file, {}, onProgress);
  session.requireCurrent();
  const assetId = String(uploaded.assetId ?? "");
  if (!assetId) throw new Error("ERROR_MEDIA_ASSET_ID_MISSING");
  const asset = await waitFor(
    () => apiRequest<MediaAssetStatus>(`/api/v1/media/assets/${assetId}`, { signal: session.signal }),
    value => value.status === "READY" || value.status === "ERROR",
    session,
  );
  if (asset.status !== "READY") throw new Error(asset.processingError || "ERROR_MEDIA_ARCHIVE_INVALID");
  const created = await apiRequest<{ id: string }>("/api/v1/catalog/imports", { method: "POST", signal: session.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assetId, format }) });
  session.requireCurrent();
  const result = await waitFor(
    () => apiRequest<CatalogImport>(`/api/v1/catalog/imports/${created.id}`, { signal: session.signal }),
    value => value.status === "COMPLETE" || value.status === "FAILED",
    session,
  );
  if (result.status !== "COMPLETE") throw new Error(result.lastError || "ERROR_CATALOG_IMPORT_FAILED");
  return result;
}
