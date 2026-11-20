import { ApiClientError, apiRequest, captureAuthSession } from "@/lib/api-client";

interface ExportJob {
  id: string;
  status: "pending" | "running" | "complete" | "failed";
  downloadUrl?: string;
  error?: string | null;
}

function delay(milliseconds: number) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export async function fetchCatalogExport(format: "xlsx" | "zip"): Promise<Response> {
  const session = captureAuthSession();
  let job = await apiRequest<ExportJob>("/api/v1/distribution/exports", {
    signal: session.signal,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ format }),
  });
  session.requireCurrent();
  const deadline = Date.now() + 4 * 60 * 60 * 1000;
  while (job.status === "pending" || job.status === "running") {
    if (Date.now() >= deadline) throw new ApiClientError(504, "EXPORT_TIMEOUT", "Catalog export timed out");
    await delay(1500);
    session.requireCurrent();
    job = await apiRequest<ExportJob>(`/api/v1/distribution/exports/${job.id}`, { signal: session.signal });
    session.requireCurrent();
  }
  if (job.status !== "complete" || !job.downloadUrl) {
    throw new ApiClientError(500, "EXPORT_FAILED", job.error || "Catalog export failed");
  }
  const response = await fetch(job.downloadUrl, { credentials: "include", signal: session.signal }).catch(error => {
    session.requireCurrent();
    throw error;
  });
  session.requireCurrent();
  return response;
}
