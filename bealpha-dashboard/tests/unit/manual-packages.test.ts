import {
  buildManualPackages,
  canManageManualPackages,
  type DdexExportJob,
  type VevoSubmission,
} from "@/lib/manual-packages";

const now = Date.parse("2026-08-22T10:00:00.000Z");

describe("manual package workbench", () => {
  it("reserves package custody for the BeAlpha SUPER_ADMIN owner", () => {
    expect(canManageManualPackages({ entityType: "SUPER_ADMIN", entityRole: "OWNER" } as never)).toBe(true);
    expect(canManageManualPackages({ entityType: "SUPER_ADMIN", entityRole: "ADMIN" } as never)).toBe(false);
    expect(canManageManualPackages({ entityType: "SYSTEM_ADMIN", entityRole: "OWNER" } as never)).toBe(false);
  });

  it("shows only automatic release-bound DDEX jobs and maps ready package evidence", () => {
    const jobs: DdexExportJob[] = [
      {
        id: "ddex-1", releaseId: "release-1", releaseTitle: "Approved album",
        targetDsps: ["spotify", "apple"], format: "zip", status: "complete",
        fileName: "release-1.zip", sizeBytes: "2048", sha256: "a".repeat(64),
        expiresAt: "2026-08-23T10:00:00.000Z", downloadUrl: "/distribution-export/ddex-1?token=signed",
        createdAt: "2026-08-22T09:00:00.000Z", updatedAt: "2026-08-22T09:05:00.000Z",
      },
      { id: "bulk-export", format: "xlsx", status: "complete", createdAt: "2026-08-22T09:30:00.000Z", updatedAt: "2026-08-22T09:31:00.000Z" },
    ];
    const result = buildManualPackages(jobs, [], new Map(), now);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: "AUDIO_DDEX", releaseId: "release-1", status: "ready", targets: ["spotify", "apple"], checksum: "a".repeat(64) });
  });

  it("marks expired links and failed VEVO packages without exposing stale downloads", () => {
    const exports: DdexExportJob[] = [{
      id: "expired-ddex", releaseId: "release-1", format: "zip", status: "complete",
      expiresAt: "2026-08-22T09:00:00.000Z", downloadUrl: "/stale",
      createdAt: "2026-08-22T08:00:00.000Z", updatedAt: "2026-08-22T08:00:00.000Z",
    }];
    const vevo: VevoSubmission[] = [{
      id: "vevo-1", releaseId: "release-2", status: "FAILED", lastError: "QC package build failed",
      createdAt: "2026-08-22T09:30:00.000Z", updatedAt: "2026-08-22T09:40:00.000Z",
    }];
    const result = buildManualPackages(exports, vevo, new Map([["release-2", "Official video"]]), now);
    expect(result.find((item) => item.id === "expired-ddex")?.status).toBe("expired");
    expect(result.find((item) => item.id === "vevo-1")).toMatchObject({ releaseTitle: "Official video", status: "failed", retryable: true, error: "QC package build failed" });
  });

  it("marks a failed automatic DDEX preparation as retryable", () => {
    const jobs: DdexExportJob[] = [{
      id: "failed-ddex", releaseId: "release-1", releaseTitle: "Retry album", format: "zip", status: "failed",
      error: "DDEX_PREPARATION_FAILED: MEDIA_GRANT_PREPARATION_FAILED",
      createdAt: "2026-08-22T08:00:00.000Z", updatedAt: "2026-08-22T08:01:00.000Z",
    }];
    expect(buildManualPackages(jobs, [], new Map(), now)[0]).toMatchObject({ status: "failed", retryable: true });
  });
});
