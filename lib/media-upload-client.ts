import { apiRequest, captureAuthSession } from "@/lib/api-client";

export type MediaAssetType = "AUDIO" | "VIDEO" | "CANVAS" | "MOTION" | "ARCHIVE" | "IMAGE";

interface UploadIntent {
  url: string;
  headers: Record<string, string>;
}

interface UploadedAsset {
  id: string;
  fileName: string;
  storageKey: string;
  fileSize: string;
  mimeType: string;
  status: string;
  durationSeconds?: number | null;
  sampleRate?: number | null;
  bitRate?: number | null;
  channels?: number | null;
  bitDepth?: number | null;
  codec?: string | null;
}

function validUuid(value: string | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

export async function uploadMediaDirect(
  assetType: MediaAssetType,
  file: File,
  extraData: Record<string, string>,
  onProgress?: (percent: number) => void,
  onXhr?: (xhr: XMLHttpRequest) => void,
): Promise<Record<string, unknown>> {
  const session = captureAuthSession();
  const intent = await apiRequest<UploadIntent>("/api/v1/media/upload-intents", {
    signal: session.signal,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      assetType,
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      ...(validUuid(extraData.releaseId) ? { releaseId: extraData.releaseId } : {}),
      ...(validUuid(extraData.trackId) ? { trackId: extraData.trackId } : {}),
    }),
  });
  session.requireCurrent();

  let detachSessionAbort = () => {};
  const asset = await new Promise<UploadedAsset>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    onXhr?.(xhr);
    session.requireCurrent();
    xhr.open("PUT", intent.url, true);
    for (const [name, value] of Object.entries(intent.headers)) {
      if (name.toLowerCase() !== "content-length") xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (event) => {
      if (!session.signal.aborted && event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onerror = () => reject(new Error("ERROR_MEDIA_UPLOAD_NETWORK"));
    xhr.onabort = () => reject(new Error("ERROR_MEDIA_UPLOAD_ABORTED"));
    xhr.onload = () => {
      try { session.requireCurrent(); } catch (error) { reject(error); return; }
      try {
        const envelope = JSON.parse(xhr.responseText);
        if (xhr.status < 200 || xhr.status >= 300 || envelope.error) {
          reject(new Error(envelope.error?.code || "ERROR_MEDIA_UPLOAD_FAILED"));
          return;
        }
        resolve(envelope.data as UploadedAsset);
      } catch {
        reject(new Error("ERROR_INVALID_MEDIA_UPLOAD_RESPONSE"));
      }
    };
    const abortSession = () => {
      try { session.requireCurrent(); } catch (error) { reject(error); }
      xhr.abort();
    };
    session.signal.addEventListener("abort", abortSession, { once: true });
    detachSessionAbort = () => session.signal.removeEventListener("abort", abortSession);
    session.requireCurrent();
    xhr.send(file);
  }).finally(() => detachSessionAbort());
  session.requireCurrent();

  const reference = `media-asset:${asset.id}`;

  return {
    id: asset.id,
    assetId: asset.id,
    filename: asset.fileName,
    originalName: asset.fileName,
    storagePath: asset.storageKey,
    size: Number(asset.fileSize),
    mimetype: asset.mimeType,
    status: asset.status,
    duration: asset.durationSeconds ?? 0,
    sampleRate: asset.sampleRate ?? undefined,
    bitRate: asset.bitRate ?? undefined,
    channels: asset.channels ?? undefined,
    bitDepth: asset.bitDepth ?? undefined,
    codec: asset.codec ?? undefined,
    reference,
    url: assetType === "IMAGE" ? reference : undefined,
  };
}
