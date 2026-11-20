import type { UserSession } from "@/lib/types";

export type ManualPackageStatus = "pending" | "processing" | "ready" | "failed" | "expired";

export interface ManualPackage {
  id: string;
  kind: "AUDIO_DDEX" | "VIDEO_VEVO";
  releaseId: string;
  releaseTitle: string;
  status: ManualPackageStatus;
  targets: string[];
  checksum: string | null;
  expiresAt: string | null;
  downloadUrl: string | null;
  error: string | null;
  fileName: string | null;
  sizeBytes: string | null;
  createdAt: string;
  updatedAt: string;
  retryable: boolean;
}

export interface DdexExportJob {
  id: string;
  releaseId?: string;
  releaseTitle?: string;
  targetDsps?: string[];
  format: string;
  status: string;
  fileName?: string | null;
  sizeBytes?: string | null;
  sha256?: string | null;
  error?: string | null;
  expiresAt?: string | null;
  downloadUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface VevoSubmission {
  id: string;
  releaseId: string;
  isrc?: string;
  status: string;
  packageFileName?: string | null;
  packageSizeBytes?: string | null;
  packageSha256?: string | null;
  packageExpiresAt?: string | null;
  downloadUrl?: string;
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
}

function isExpired(expiresAt: string | null | undefined, now: number): boolean {
  return Boolean(expiresAt && new Date(expiresAt).getTime() <= now);
}

function audioStatus(job: DdexExportJob, now: number): ManualPackageStatus {
  if (job.status.toLowerCase() === "failed") return "failed";
  if (job.status.toLowerCase() === "complete") {
    return isExpired(job.expiresAt, now) || !job.downloadUrl ? "expired" : "ready";
  }
  return job.status.toLowerCase() === "running" ? "processing" : "pending";
}

function videoStatus(submission: VevoSubmission, now: number): ManualPackageStatus {
  const status = submission.status.toUpperCase();
  if (status === "FAILED") return "failed";
  if (status === "READY_FOR_MANUAL_DELIVERY") {
    return isExpired(submission.packageExpiresAt, now) || !submission.downloadUrl
      ? "expired"
      : "ready";
  }
  return status === "PENDING" ? "pending" : "processing";
}

export function canManageManualPackages(
  user: Pick<UserSession, "entityType" | "entityRole">,
): boolean {
  return user.entityType === "SUPER_ADMIN" && user.entityRole === "OWNER";
}

export function buildManualPackages(
  exports: DdexExportJob[],
  vevoSubmissions: VevoSubmission[],
  releaseTitles: ReadonlyMap<string, string>,
  now = Date.now(),
): ManualPackage[] {
  const audio = exports
    .filter((job): job is DdexExportJob & { releaseId: string } => Boolean(job.releaseId))
    .map((job): ManualPackage => ({
      id: job.id,
      kind: "AUDIO_DDEX",
      releaseId: job.releaseId,
      releaseTitle: job.releaseTitle || releaseTitles.get(job.releaseId) || job.releaseId,
      status: audioStatus(job, now),
      targets: job.targetDsps?.length ? job.targetDsps : ["Manual DSP delivery"],
      checksum: job.sha256 ?? null,
      expiresAt: job.expiresAt ?? null,
      downloadUrl: job.downloadUrl ?? null,
      error: job.error ?? null,
      fileName: job.fileName ?? null,
      sizeBytes: job.sizeBytes ?? null,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      retryable: job.status.toLowerCase() === "failed",
    }));

  const video = vevoSubmissions.map((submission): ManualPackage => ({
    id: submission.id,
    kind: "VIDEO_VEVO",
    releaseId: submission.releaseId,
    releaseTitle: releaseTitles.get(submission.releaseId) || submission.isrc || submission.releaseId,
    status: videoStatus(submission, now),
    targets: ["VEVO"],
    checksum: submission.packageSha256 ?? null,
    expiresAt: submission.packageExpiresAt ?? null,
    downloadUrl: submission.downloadUrl ?? null,
    error: submission.lastError ?? null,
    fileName: submission.packageFileName ?? null,
    sizeBytes: submission.packageSizeBytes ?? null,
    createdAt: submission.createdAt,
    updatedAt: submission.updatedAt,
    retryable: submission.status.toUpperCase() === "FAILED",
  }));

  return [...audio, ...video].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
}
