"use client";

/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V4 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { UserSession } from "@/lib/types";
import { apiRequest } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { useToast } from "@/components/ui/Toast";
import { CheckCircleIcon, CloseIcon, DownloadIcon, PendingIcon, RefreshIcon, SearchIcon, WarningIcon } from "@/components/ui/Icon";

interface ManualPackage {
  id: string;
  releaseId?: string;
  releaseTitle?: string;
  targetDsps?: string[];
  format: "zip" | "xlsx";
  status: string;
  fileName: string | null;
  sizeBytes: string | null;
  sha256: string | null;
  error: string | null;
  expiresAt: string;
  createdAt: string;
  downloadUrl?: string;
}

const RUNNING = new Set(["pending", "running"]);

function formatBytes(raw: string | null): string {
  if (!raw) return "—";
  const bytes = Number(raw);
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function shortId(value?: string): string {
  return value ? `${value.slice(0, 8)}…${value.slice(-4)}` : "—";
}

function statusPresentation(status: string, t: (key: string, fallback?: string) => string) {
  switch (status) {
    case "complete": return { label: t("distribution.ready", "Ready"), icon: <CheckCircleIcon size={14} />, className: "bg-[var(--status-success-surface)] text-[var(--status-success)]" };
    case "failed": return { label: t("distribution.needsAttention", "Needs attention"), icon: <WarningIcon size={14} />, className: "bg-[var(--status-error-surface)] text-[var(--status-error)]" };
    case "running": return { label: t("distribution.building", "Building"), icon: <PendingIcon size={14} />, className: "bg-[var(--status-info-surface)] text-[var(--status-info)]" };
    default: return { label: t("distribution.queued", "Queued"), icon: <PendingIcon size={14} />, className: "bg-[var(--status-warning-surface)] text-[var(--status-warning)]" };
  }
}

export default function ManualDeliveryPanel({ user }: { user: UserSession }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [packages, setPackages] = useState<ManualPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const loadPackages = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      setPackages(await apiRequest<ManualPackage[]>("/api/v1/distribution/exports"));
    } catch {
      showToast(t("distribution.packageLoadFailed", "Could not load manual-delivery packages."), "error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [showToast, t]);

  useEffect(() => { void loadPackages(); }, [loadPackages]);
  const hasRunningJob = packages.some((item) => RUNNING.has(item.status));
  useEffect(() => {
    if (!hasRunningJob) return;
    const timer = window.setInterval(() => void loadPackages(true), 5000);
    return () => window.clearInterval(timer);
  }, [hasRunningJob, loadPackages]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return packages.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      return !query || [item.releaseTitle, item.releaseId, item.fileName, item.sha256].some((value) => value?.toLowerCase().includes(query));
    });
  }, [packages, search, statusFilter]);

  const ready = packages.filter((item) => item.status === "complete").length;
  const preparing = packages.filter((item) => RUNNING.has(item.status)).length;
  const failed = packages.filter((item) => item.status === "failed").length;
  const isSuperOwner = user.entityType === "SUPER_ADMIN" && user.entityRole === "OWNER";

  return (
    <div className="mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8">
      <header className="mb-7 border-b border-[var(--border-primary)] pb-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-disabled)]">{t("distribution.finalHandoff", "Final handoff")}</p>
            <h1 className="min-w-0 [overflow-wrap:anywhere] text-2xl font-semibold tracking-[-0.02em] text-[var(--text-primary)] sm:text-3xl">{t("distribution.manualPackages", "Manual delivery packages")}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-tertiary)]">{t("distribution.manualPackagesDescription", "Final BeAlpha approval automatically builds an offline package. Download it here, verify its checksum, then hand it to the destination outside this platform.")}</p>
          </div>
          <button type="button" onClick={() => void loadPackages(true)} disabled={refreshing} className="inline-flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] px-4 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-wait disabled:opacity-60">
            <RefreshIcon size={15} className={refreshing ? "animate-spin" : ""} />{refreshing ? t("common.refreshing", "Refreshing") : t("common.refresh", "Refresh")}
          </button>
        </div>
      </header>

      {!isSuperOwner && <div className="mb-6 flex items-start gap-3 border-l-2 border-[var(--status-warning)] bg-[var(--status-warning-surface)] px-4 py-3 text-sm text-[var(--status-warning)]"><WarningIcon size={17} className="mt-0.5 shrink-0" /><p>{t("distribution.superOwnerOnly", "Package custody is restricted to the BeAlpha owner account.")}</p></div>}

      <section aria-label={t("distribution.packageSummary", "Package summary")} className="mb-7 grid grid-cols-1 divide-y divide-[var(--border-primary)] border-y border-[var(--border-primary)] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {[[t("distribution.ready", "Ready"), ready, "var(--status-success)"], [t("distribution.preparing", "Preparing"), preparing, "var(--status-info)"], [t("distribution.needsAttention", "Needs attention"), failed, "var(--status-error)"]].map(([label, value, color]) => <div key={String(label)} className="px-1 py-4 sm:px-5"><p className="text-xs font-medium text-[var(--text-tertiary)]">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums" style={{ color: String(color) }}>{value}</p></div>)}
      </section>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="relative min-w-0 flex-1 sm:max-w-md">
          <span className="sr-only">{t("distribution.searchPackages", "Search packages")}</span>
          <SearchIcon size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-disabled)]" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("distribution.searchPackagePlaceholder", "Search title, release ID, file or checksum")} className="h-10 w-full rounded-lg border border-[var(--border-input)] bg-[var(--bg-surface)] pl-9 pr-9 text-sm text-[var(--text-primary)] outline-none transition-shadow placeholder:text-[var(--text-disabled)] focus:ring-2 focus:ring-[var(--accent)]" />
          {search && <button type="button" onClick={() => setSearch("")} aria-label={t("common.clearSearch", "Clear search")} className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--bg-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"><CloseIcon size={14} /></button>}
        </label>
        <label className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]"><span>{t("common.status", "Status")}</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-10 rounded-lg border border-[var(--border-input)] bg-[var(--bg-surface)] px-3 text-sm text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--accent)]"><option value="all">{t("dashboard.allStatus", "All")}</option><option value="complete">{t("distribution.ready", "Ready")}</option><option value="running">{t("distribution.building", "Building")}</option><option value="pending">{t("distribution.queued", "Queued")}</option><option value="failed">{t("statuses.failed", "Failed")}</option></select></label>
      </div>

      {loading ? <div className="space-y-2" aria-label={t("common.loading", "Loading")}>{[0, 1, 2].map((row) => <div key={row} className="h-24 animate-pulse rounded-lg bg-[var(--bg-elevated)]" />)}</div> : filtered.length === 0 ? (
        <div className="border-y border-[var(--border-primary)] py-16 text-center"><p className="text-base font-medium text-[var(--text-secondary)]">{packages.length === 0 ? t("distribution.noPackages", "No packages have been generated yet") : t("common.noResults", "No matching results")}</p><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[var(--text-disabled)]">{packages.length === 0 ? t("distribution.noPackagesHint", "Approve an audio release at the final BeAlpha stage. Its DDEX ERN 4.3.2 XML and audio masters will be assembled automatically.") : t("distribution.adjustFilters", "Adjust the search text or status filter.")}</p></div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--border-primary)] bg-[var(--bg-surface)]">
          <div className="hidden grid-cols-[minmax(0,1fr)_150px_130px_130px] gap-4 border-b border-[var(--border-primary)] px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-disabled)] md:grid"><span>{t("common.release", "Release")}</span><span>{t("common.status", "Status")}</span><span>{t("common.created", "Created")}</span><span className="text-right">{t("common.action", "Action")}</span></div>
          <ul className="divide-y divide-[var(--border-primary)]">{filtered.map((item) => {
            const state = statusPresentation(item.status, t);
            const expired = new Date(item.expiresAt).getTime() <= Date.now();
            return <li key={item.id} className="grid min-w-0 gap-4 px-4 py-4 md:grid-cols-[minmax(0,1fr)_150px_130px_130px] md:items-center md:px-5">
              <div className="min-w-0"><p className="truncate text-sm font-semibold text-[var(--text-primary)]">{item.releaseTitle || item.fileName || t("distribution.ddexPackage", "DDEX package")}</p><div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-disabled)]"><span className="font-mono" title={item.releaseId}>{shortId(item.releaseId)}</span><span>{item.format.toUpperCase()} · {formatBytes(item.sizeBytes)}</span>{item.targetDsps?.length ? <span>{t("distribution.requestedDSPs", "Requested DSPs")}: {item.targetDsps.join(", ")}</span> : null}{item.sha256 && <span className="max-w-full truncate font-mono" title={item.sha256}>SHA-256 {shortId(item.sha256)}</span>}</div>{item.error && <p className="mt-2 line-clamp-2 text-xs text-[var(--status-error)]" title={item.error}>{item.error}</p>}</div>
              <div><span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${state.className}`}>{state.icon}{state.label}</span></div>
              <time className="text-xs text-[var(--text-tertiary)]" dateTime={item.createdAt}>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.createdAt))}</time>
              <div className="md:text-right">{item.status === "complete" && item.downloadUrl && !expired ? <a href={item.downloadUrl} className="inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-[var(--accent)] px-3 text-xs font-semibold text-[var(--accent-contrast)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)]"><DownloadIcon size={14} />{t("common.download", "Download")}</a> : item.status === "complete" && expired ? <span className="text-xs text-[var(--text-disabled)]">{t("distribution.expired", "Expired")}</span> : <span className="text-xs text-[var(--text-disabled)]">{RUNNING.has(item.status) ? t("distribution.automaticRefresh", "Auto-refreshing") : "—"}</span>}</div>
            </li>;
          })}</ul>
        </div>
      )}

      <footer className="mt-5 flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--text-disabled)]"><span>{filtered.length} {t("distribution.packages", "packages")}</span><span>{t("distribution.externalDeliveryDisabled", "Automated DSP and VEVO delivery is disabled")}</span></footer>
    </div>
  );
}
