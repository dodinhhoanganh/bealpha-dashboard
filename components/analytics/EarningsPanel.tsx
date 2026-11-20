"use client";

import { useState, useEffect, useCallback } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import Pagination from "@/components/ui/Pagination";
import { apiRequest } from "@/lib/api-client";
import {
  AttachMoneyIcon,
  FilterListIcon,
  CheckCircleIcon,
  PendingIcon,
} from "@/components/ui/Icon";

interface FinanceReport {
  id: string;
  period: string;
  platform: string;
  currency: string;
  totalRevenue: string;
  totalPlays: string;
  lineItemCount: number;
  status: string;
  receivedAt: string;
}

export function buildEarningsQueries(platform: string, status: string): {
  reports: string;
  summary: string;
} {
  const summaryParams = new URLSearchParams();
  const reportParams = new URLSearchParams();
  if (platform !== "all") {
    summaryParams.set("platform", platform);
    reportParams.set("platform", platform);
  }
  if (status !== "all") {
    summaryParams.set("status", status);
    reportParams.set("status", status);
  }
  reportParams.set("limit", "100");
  return {
    reports: reportParams.toString(),
    summary: summaryParams.toString(),
  };
}

export default function EarningsPanel() {

  const [reports, setReports] = useState<FinanceReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [platformFilter, setPlatformFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(20);
  const [summary, setSummary] = useState<Array<{ currency: string; totalRevenue: string; totalPlays: string; reportCount: number }>>([]);
  const [error, setError] = useState("");
  const { t } = useI18n();

  const fetchReports = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // The reports endpoint supports pagination; the summary endpoint has a
      // deliberately strict query schema and must not receive limit/cursor.
      const queries = buildEarningsQueries(platformFilter, statusFilter);
      const [rows, aggregate] = await Promise.all([
        apiRequest<FinanceReport[]>(`/api/v1/finance/reports?${queries.reports}`),
        apiRequest<{ currencies: Array<{ currency: string; totalRevenue: string; totalPlays: string; reportCount: number }> }>(`/api/v1/finance/summary${queries.summary ? `?${queries.summary}` : ""}`),
      ]);
      setReports(rows.slice((page - 1) * limit, page * limit));
      setSummary(aggregate.currencies);
      setTotal(rows.length);
      setTotalPages(Math.max(1, Math.ceil(rows.length / limit)));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.errorOccurred", "Something went wrong."));
    } finally {
      setLoading(false);
    }
  }, [platformFilter, statusFilter, page, limit, t]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const formatDecimal = (value: string) => {
    const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
    if (!match) return value;
    const integer = match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const fraction = (match[3] ?? "").replace(/0+$/, "");
    return `${match[1]}${integer}${fraction ? `.${fraction}` : ""}`;
  };
  const formatPlays = (value: string) => { try { return BigInt(value).toLocaleString(); } catch { return value; } };

  return (
    <div className="p-6">
      <h2 className="text-xl font-medium mb-6">{t("earnings.title")}</h2>

      <section aria-label={t("earnings.summary", "Financial summary")} className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {summary.length === 0 ? <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-surface)] p-5 text-sm text-[var(--text-tertiary)]">{t("earnings.noRevenueData")}</div> : summary.map((item) => (
          <article key={item.currency} className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-surface)] p-5">
            <div className="flex items-center justify-between gap-4"><p className="text-sm text-[var(--text-tertiary)]">{t("earnings.totalRevenue")}</p><span className="rounded-full bg-[var(--bg-elevated)] px-2 py-1 text-xs font-semibold text-[var(--text-secondary)]">{item.currency}</span></div>
            <p className="mt-2 break-all font-mono text-2xl font-semibold tabular-nums text-[var(--accent-text)]" title={`${item.totalRevenue} ${item.currency}`}>{formatDecimal(item.totalRevenue)} {item.currency}</p>
            <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-[var(--border-subtle)] pt-3 text-xs"><div><dt className="text-[var(--text-disabled)]">{t("earnings.totalPlays")}</dt><dd className="mt-1 font-medium tabular-nums text-[var(--text-primary)]">{formatPlays(item.totalPlays)}</dd></div><div><dt className="text-[var(--text-disabled)]">{t("earnings.reports_count")}</dt><dd className="mt-1 font-medium tabular-nums text-[var(--text-primary)]">{item.reportCount}</dd></div></dl>
          </article>
        ))}
      </section>

      {/* Filters */}
      <div className="flex items-center gap-4 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <FilterListIcon size={20} color="#6b7280" />
          <select
            value={platformFilter}
            onChange={(e) => {
              setPlatformFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          >
            <option value="all">{t("earnings.allPlatforms")}</option>
            <option value="spotify">{t("dashboard.spotify")}</option>
            <option value="apple">{t("dashboard.appleMusic")}</option>
            <option value="amazon">{t("dashboard.amazonMusic")}</option>
            <option value="youtube">{t("dashboard.youtubeMusic")}</option>
            <option value="tidal">{t("dashboard.tidal")}</option>
            <option value="deezer">{t("dashboard.deezer")}</option>
          </select>
        </div>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="px-3 py-2 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        >
          <option value="all">{t("earnings.allStatuses")}</option>
          <option value="pending">{t("statuses.pending")}</option>
          <option value="processed">{t("dashboard.processed")}</option>
          <option value="paid">{t("dashboard.paid")}</option>
        </select>
      </div>

      {/* Reports Table */}
      {loading ? (
        <div role="status" aria-label={t("common.loading", "Loading")} className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500"></div>
        </div>
      ) : error ? (
        <div role="alert" className="border-y border-[var(--border-primary)] py-10 text-center text-sm text-[var(--status-error)]">{error}<button type="button" onClick={() => void fetchReports()} className="ml-3 underline underline-offset-2">{t("common.retry", "Retry")}</button></div>
      ) : reports.length === 0 ? (
        <div className="text-center py-12 text-[var(--text-disabled)]">
          <AttachMoneyIcon size={48} color="#525252" />
          <p className="mt-2">{t("dashboard.noRevenueReports")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[var(--text-tertiary)] text-sm border-b border-[var(--border-primary)]">
                <th className="pb-3 font-medium">{t("earnings.period")}</th>
                <th className="pb-3 font-medium">{t("earnings.platform")}</th>
                <th className="pb-3 font-medium">
                  {t("earnings.totalRevenue")}
                </th>
                <th className="pb-3 font-medium">{t("analytics.plays")}</th>
                <th className="pb-3 font-medium">{t("dashboard.lineItems")}</th>
                <th className="pb-3 font-medium">{t("common.status")}</th>
                <th className="pb-3 font-medium">{t("dashboard.received")}</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <tr
                  key={report.id}
                  className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)]"
                >
                  <td className="py-4 font-medium">{report.period}</td>
                  <td className="py-4">
                    <span
                      className={`px-2 py-1 rounded text-sm ${
                        report.platform === "spotify"
                          ? "bg-[var(--status-success-surface)] text-[var(--accent-text)]"
                          : report.platform === "apple"
                            ? "bg-[rgba(252,60,68,0.1)] text-[var(--color-apple)]"
                            : report.platform === "youtube"
                              ? "bg-[var(--status-error-surface)] text-[var(--status-error)]"
                              : "bg-[var(--bg-elevated)] text-[var(--text-tertiary)]"
                      }`}
                    >
                      {report.platform || "-"}
                    </span>
                  </td>
                  <td className="py-4 text-[var(--accent-text)] font-medium">
                    <span className="font-mono tabular-nums" title={`${report.totalRevenue} ${report.currency}`}>{formatDecimal(report.totalRevenue || "0")} {report.currency}</span>
                  </td>
                  <td className="py-4 text-[var(--text-secondary)]">
                    {formatPlays(report.totalPlays || "0")}
                  </td>
                  <td className="py-4 text-[var(--text-tertiary)]">
                    {report.lineItemCount}
                  </td>
                  <td className="py-4">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded text-sm ${
                        report.status === "paid"
                          ? "text-[var(--accent-text)] bg-[var(--status-success-surface)]"
                          : report.status === "processed"
                            ? "text-[var(--status-info)] bg-[var(--status-info-surface)]"
                            : "text-[var(--status-warning)] bg-[var(--status-warning-surface)]"
                      }`}
                    >
                      {report.status === "paid" && (
                        <CheckCircleIcon size={14} />
                      )}
                      {report.status === "processed" && (
                        <CheckCircleIcon size={14} />
                      )}
                      {report.status === "pending" && <PendingIcon size={14} />}
                      <span className="capitalize">{report.status}</span>
                    </span>
                  </td>
                  <td className="py-4 text-[var(--text-tertiary)]">
                    {report.receivedAt
                      ? new Date(report.receivedAt).toLocaleDateString()
                      : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        limit={limit}
        onPageChange={(p) => setPage(p)}
        onLimitChange={(l) => {
          setLimit(l);
          setPage(1);
        }}
      />
    </div>
  );
}
