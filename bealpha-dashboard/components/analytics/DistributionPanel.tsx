"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { UserSession } from "@/lib/types";
import { apiRequest } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { useToast } from "@/components/ui/Toast";
import Pagination from "@/components/ui/Pagination";
import { TableSkeleton } from "@/components/ui/Skeleton";
import {
  buildManualPackages,
  canManageManualPackages,
  type DdexExportJob,
  type ManualPackage,
  type ManualPackageStatus,
  type VevoSubmission,
} from "@/lib/manual-packages";
import {
  AudioFileIcon,
  CancelIcon,
  CheckCircleIcon,
  DownloadIcon,
  FolderZipIcon,
  PendingIcon,
  RefreshIcon,
  SearchIcon,
  WarningIcon,
} from "@/components/ui/Icon";

type KindFilter = "all" | ManualPackage["kind"];
const STATUS_STYLE: Record<ManualPackageStatus, string> = {
  pending: "bg-[var(--status-warning-surface)] text-[var(--status-warning)]",
  processing: "bg-[var(--status-info-surface)] text-[var(--status-info)]",
  ready: "bg-[var(--status-success-surface)] text-[var(--status-success)]",
  failed: "bg-[var(--status-error-surface)] text-[var(--status-error)]",
  expired: "bg-[var(--bg-elevated)] text-[var(--text-tertiary)]",
};

function StatusIcon({ status }: { status: ManualPackageStatus }) {
  if (status === "ready") return <CheckCircleIcon size={14} />;
  if (status === "failed" || status === "expired") return <CancelIcon size={14} />;
  return <PendingIcon size={14} />;
}

function formatBytes(value: string | null): string {
  if (!value || !/^\d+$/.test(value)) return "—";
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export default function DistributionPanel({ user }: { user: UserSession }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const allowed = canManageManualPackages(user);
  const [packages, setPackages] = useState<ManualPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | ManualPackageStatus>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);

  const loadPackages = useCallback(async (quiet = false) => {
    if (!allowed) { setLoading(false); return; }
    if (quiet) setRefreshing(true); else setLoading(true);
    setError("");
    try {
      const [exports, submissions, releases] = await Promise.all([
        apiRequest<DdexExportJob[]>("/api/v1/distribution/exports"),
        apiRequest<VevoSubmission[]>("/api/v1/distribution/vevo/submissions"),
        apiRequest<Array<{ id: string; title?: string }>>("/api/v1/catalog/releases"),
      ]);
      setPackages(buildManualPackages(
        exports,
        submissions,
        new Map(releases.map((release) => [release.id, release.title || release.id])),
      ));
    } catch {
      setError(t("distribution.manualPackagesLoadFailed", "Manual packages could not be loaded."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [allowed, t]);

  useEffect(() => { void loadPackages(); }, [loadPackages]);
  useEffect(() => {
    if (!packages.some((item) => item.status === "pending" || item.status === "processing")) return;
    const timer = window.setTimeout(() => void loadPackages(true), 5000);
    return () => window.clearTimeout(timer);
  }, [packages, loadPackages]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return packages.filter((item) =>
      (kindFilter === "all" || item.kind === kindFilter) &&
      (statusFilter === "all" || item.status === statusFilter) &&
      (!query || [item.releaseTitle, item.fileName, item.releaseId, ...item.targets]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(query))),
    );
  }, [kindFilter, packages, search, statusFilter]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / limit));
  const visible = filtered.slice((page - 1) * limit, page * limit);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  const retryPackage = async (item: ManualPackage) => {
    if (!allowed || !item.retryable) return;
    setRetryingId(item.id);
    try {
      if (item.kind === "AUDIO_DDEX") {
        await apiRequest(`/api/v1/distribution/exports/${item.id}/retry`, { method: "POST" });
      } else {
        await apiRequest("/api/v1/distribution/vevo/submissions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            releaseId: item.releaseId,
            idempotencyKey: `vevo:${item.releaseId}:retry:${item.id}:${item.updatedAt}`,
          }),
        });
      }
      showToast(t("distribution.packageRetryStarted", "Package preparation restarted."), "success");
      await loadPackages(true);
    } catch {
      showToast(t("distribution.packageRetryFailed", "Package retry failed."), "error");
    } finally {
      setRetryingId(null);
    }
  };

  if (!allowed) {
    return (
      <div className="p-6">
        <div role="alert" className="workbench-panel mx-auto max-w-2xl p-6 text-center">
          <WarningIcon size={28} className="mx-auto text-[var(--status-warning)]" />
          <h2 className="mt-3 text-lg font-semibold text-[var(--text-primary)]">{t("errors.forbidden.title", "Access forbidden")}</h2>
          <p className="mt-2 text-sm text-[var(--text-tertiary)]">
            {t("distribution.manualCustodianOnly", "Only the BeAlpha SUPER_ADMIN owner can manage manual delivery packages.")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">{t("distribution.manualPackages", "Manual delivery packages")}</h2>
          <p className="mt-1 max-w-3xl text-sm text-[var(--text-tertiary)]">
            {t("distribution.manualPackagesHint", "Final approval prepares DDEX or VEVO ZIP files here. Download and deliver them manually; this screen never sends files to a DSP or VEVO.")}
          </p>
        </div>
        <button type="button" onClick={() => void loadPackages(true)} disabled={refreshing}
          className="workbench-action workbench-action-secondary min-h-10 gap-2 disabled:cursor-not-allowed disabled:opacity-50">
          <RefreshIcon size={16} className={refreshing ? "animate-spin" : undefined} /> {t("common.refresh", "Refresh")}
        </button>
      </div>

      <div className="mb-5 rounded-[var(--radius-card)] border border-[var(--status-info)]/25 bg-[var(--status-info-surface)] p-4 text-sm text-[var(--text-secondary)]">
        <strong className="text-[var(--text-primary)]">{t("distribution.manualOnly", "Manual handoff only.")}</strong>{" "}
        {t("distribution.manualOnlyDetail", "Automated DSP and VEVO delivery is disabled. Signed package links are private and expire at the time shown.")}
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 sm:max-w-md">
          <SearchIcon size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-disabled)]" />
          <input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }}
            placeholder={t("distribution.searchPackages", "Search release, DSP, ISRC, or filename…")}
            aria-label={t("distribution.searchPackages", "Search manual packages")}
            className="min-h-10 w-full rounded-[var(--radius-input)] border border-[var(--border-input)] bg-[var(--bg-surface)] pl-9 pr-3 text-sm text-[var(--text-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]" />
        </div>
        <select value={kindFilter} onChange={(event) => { setKindFilter(event.target.value as KindFilter); setPage(1); }}
          aria-label={t("distribution.packageType", "Package type")}
          className="min-h-10 rounded-[var(--radius-input)] border border-[var(--border-input)] bg-[var(--bg-surface)] px-3 text-sm text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]">
          <option value="all">{t("distribution.allPackageTypes", "All package types")}</option>
          <option value="AUDIO_DDEX">{t("distribution.audioDdex", "Audio · DDEX ERN")}</option>
          <option value="VIDEO_VEVO">{t("distribution.videoVevo", "Video · VEVO")}</option>
        </select>
        <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as "all" | ManualPackageStatus); setPage(1); }}
          aria-label={t("common.status", "Status")}
          className="min-h-10 rounded-[var(--radius-input)] border border-[var(--border-input)] bg-[var(--bg-surface)] px-3 text-sm text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]">
          <option value="all">{t("dashboard.allStatus", "All statuses")}</option>
          <option value="pending">{t("statuses.pending", "Pending")}</option>
          <option value="processing">{t("common.processing", "Processing")}</option>
          <option value="ready">{t("distribution.readyToDownload", "Ready")}</option>
          <option value="failed">{t("statuses.failed", "Failed")}</option>
          <option value="expired">{t("distribution.expired", "Expired")}</option>
        </select>
      </div>

      {error && <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-input)] border border-[var(--status-error)]/35 bg-[var(--status-error-surface)] px-4 py-3 text-sm text-[var(--status-error)]">
        <span>{error}</span><button type="button" onClick={() => void loadPackages()} className="font-semibold underline underline-offset-2">{t("common.retry", "Retry")}</button>
      </div>}

      {loading ? (
        <div role="status" aria-label={t("common.loading", "Loading manual packages")}><TableSkeleton rows={6} cols={6} /></div>
      ) : visible.length === 0 ? (
        <div className="workbench-panel py-16 text-center text-[var(--text-tertiary)]">
          <FolderZipIcon size={38} className="mx-auto text-[var(--text-disabled)]" />
          <p className="mt-3 text-sm font-medium text-[var(--text-primary)]">{t("distribution.noManualPackages", "No manual packages match this view.")}</p>
          <p className="mt-1 text-xs">{t("distribution.packageAppearsAfterApproval", "A package appears after BeAlpha final approval and background preparation.")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((item) => <article key={`${item.kind}-${item.id}`} className="workbench-panel p-4 sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
              <div className="flex min-w-0 flex-1 gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
                  {item.kind === "AUDIO_DDEX" ? <AudioFileIcon size={18} /> : <FolderZipIcon size={18} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">{item.releaseTitle}</h3>
                    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${STATUS_STYLE[item.status]}`}>
                      <StatusIcon status={item.status} />{t(`distribution.packageStatus.${item.status}`, item.status.charAt(0).toUpperCase() + item.status.slice(1))}
                    </span>
                    <span className="rounded-md bg-[var(--bg-elevated)] px-2 py-1 text-[10px] font-semibold text-[var(--text-tertiary)]">{item.kind === "AUDIO_DDEX" ? "DDEX ERN 4.3.2" : "VEVO"}</span>
                  </div>
                  <p className="mt-1 truncate text-xs text-[var(--text-disabled)]">{item.fileName || item.releaseId}</p>
                  {item.error && <p className="mt-2 text-xs text-[var(--status-error)]">{item.error}</p>}
                </div>
              </div>
              <dl className="grid min-w-0 grid-cols-2 gap-x-5 gap-y-3 text-xs sm:grid-cols-4 lg:w-[52%]">
                <div><dt className="text-[var(--text-disabled)]">{t("distribution.targets", "Targets")}</dt><dd className="mt-1 break-words text-[var(--text-secondary)]">{item.targets.join(", ")}</dd></div>
                <div><dt className="text-[var(--text-disabled)]">{t("common.size", "Size")}</dt><dd className="mt-1 text-[var(--text-secondary)]">{formatBytes(item.sizeBytes)}</dd></div>
                <div><dt className="text-[var(--text-disabled)]">SHA-256</dt><dd className="mt-1 font-mono text-[var(--text-secondary)]" title={item.checksum ?? undefined}>{item.checksum ? `${item.checksum.slice(0, 12)}…` : "—"}</dd></div>
                <div><dt className="text-[var(--text-disabled)]">{t("distribution.expires", "Expires")}</dt><dd className="mt-1 text-[var(--text-secondary)]">{item.expiresAt ? new Date(item.expiresAt).toLocaleString() : "—"}</dd></div>
              </dl>
              <div className="flex shrink-0 gap-2 lg:justify-end">
                {item.status === "ready" && item.downloadUrl && <a href={item.downloadUrl}
                  className="workbench-action min-h-10 gap-2 bg-[var(--accent)] text-[var(--accent-contrast)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
                  aria-label={`${t("common.download", "Download")} ${item.releaseTitle}`}><DownloadIcon size={16} />{t("common.download", "Download")}</a>}
                {item.retryable && <button type="button" onClick={() => void retryPackage(item)} disabled={retryingId === item.id}
                  className="workbench-action workbench-action-secondary min-h-10 gap-2 disabled:cursor-not-allowed disabled:opacity-50">
                  <RefreshIcon size={16} className={retryingId === item.id ? "animate-spin" : undefined} />{t("common.retry", "Retry")}
                </button>}
              </div>
            </div>
          </article>)}
        </div>
      )}
      <Pagination page={page} totalPages={totalPages} total={filtered.length} limit={limit}
        onPageChange={setPage} onLimitChange={(next) => { setLimit(next); setPage(1); }} />
    </div>
  );
}
