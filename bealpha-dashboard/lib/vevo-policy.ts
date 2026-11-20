const VEVO_VIDEO_EXTENSIONS = new Set([".mp4", ".mov"]);
const VEVO_VIDEO_MIME_TYPES = new Set(["video/mp4", "video/quicktime"]);

export const VEVO_VIDEO_ACCEPT = ".mp4,.mov,video/mp4,video/quicktime";

export function isAcceptedVevoVideoFile(fileName: string, mimeType: string): boolean {
  const extension = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  return VEVO_VIDEO_EXTENSIONS.has(extension) && VEVO_VIDEO_MIME_TYPES.has(mimeType.toLowerCase());
}

const APPROVABLE_RELEASE_STATUSES = new Set(["PENDING_ORG_APPROVAL", "PENDING_SYS_APPROVAL", "PENDING_SUPER_APPROVAL"]);
const IDENTIFIER_LOCKED_STATUSES = new Set(["LOCKED_FOR_DELIVERY", "DELIVERED", "RELEASED", "TAKEDOWN"]);

export function canApproveVevoRelease(status: string): boolean {
  return APPROVABLE_RELEASE_STATUSES.has(status);
}

export function canCreateVevoSubmission(entityType: string, entityRole: string, releaseStatus: string, hasActiveSubmission: boolean): boolean {
  return entityType === "SUPER_ADMIN" && entityRole === "OWNER" && !hasActiveSubmission && ["APPROVED", "LOCKED_FOR_DELIVERY"].includes(releaseStatus);
}

export function isReleaseIdentifierLocked(status?: string): boolean {
  return Boolean(status && IDENTIFIER_LOCKED_STATUSES.has(status));
}
