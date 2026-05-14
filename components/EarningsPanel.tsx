"use client";

import { useState, useEffect, useCallback } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { useToast } from "@/components/Toast";
import Pagination from "@/components/Pagination";
import { AnalyticsBarChart } from "@/components/AnalyticsPanel";
import {
  AttachMoneyIcon,
  DownloadIcon,
  FilterListIcon,
  SearchIcon,
  BarChartIcon,
  TrendingUpIcon,
  KeyboardArrowDownIcon,
  CheckCircleIcon,
  PendingIcon,
  ScheduleIcon,
  SpotifyIcon,
  AppleIcon,
} from "@/components/Icon";

export default function EarningsPanel() {

  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [platformFilter, setPlatformFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(20);
  const { t, formatMoney } = useI18n();

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (platformFilter !== "all") params.set("platform", platformFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      params.set("page", String(page));
      params.set("limit", String(limit));
      const res = await fetch(`/api/royalties?${params}`);
      if (res.ok) {
        const json = await res.json();
        setReports(json.data || json);
        setTotal(json.total || 0);
        setTotalPages(json.totalPages || 1);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [platformFilter, statusFilter, page, limit]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const totalRevenue = reports.reduce(
    (sum, r) => sum + (r.totalRevenue || 0),
    0,
  );
  const totalPlays = reports.reduce((sum, r) => sum + (r.totalPlays || 0), 0);
  const platforms = [
    ...new Set(reports.map((r) => r.platform).filter(Boolean)),
  ];

  // Group revenue by platform for chart
  const revenueByPlatform = platforms.map((p) => ({
    name: p,
    value: reports
      .filter((r) => r.platform === p)
      .reduce((sum, r) => sum + (r.totalRevenue || 0), 0),
    fill:
      p === "spotify"
        ? "#1DB954"
        : p === "apple"
          ? "#fc3c44"
          : p === "amazon"
            ? "#ff9900"
            : p === "youtube"
              ? "#ff0000"
              : "#6b7280",
  }));

  // Group revenue by period for timeline
  const revenueByPeriod: Record<string, number> = {};
  reports.forEach((r) => {
    const period = r.period || "Unknown";
    revenueByPeriod[period] =
      (revenueByPeriod[period] || 0) + (r.totalRevenue || 0);
  });
  const periodData = Object.entries(revenueByPeriod)
    .map(([period, revenue]) => ({ period, revenue }))
    .sort((a, b) => a.period.localeCompare(b.period));

  return (
    <div className="p-6">
      <h2 className="text-xl font-medium mb-6">{t("earnings.title")}</h2>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div
          style={{ background: "var(--bg-surface)" }}
          className=" border border-[var(--border-primary)] rounded-xl p-5"
        >
          <p className="text-[var(--text-tertiary)] text-sm">
            {t("earnings.totalRevenue")}
          </p>
          <p className="text-3xl font-bold text-[var(--accent-text)] mt-1">
            {formatMoney(totalRevenue)}
          </p>
          <p className="text-xs text-[var(--text-disabled)] mt-1">
            {reports.length} {t("earnings.reports_count")}
          </p>
        </div>
        <div
          style={{ background: "var(--bg-surface)" }}
          className=" border border-[var(--border-primary)] rounded-xl p-5"
        >
          <p className="text-[var(--text-tertiary)] text-sm">
            {t("earnings.totalPlays")}
          </p>
          <p className="text-3xl font-bold text-[var(--text-primary)] mt-1">
            {totalPlays.toLocaleString()}
          </p>
          <p className="text-xs text-[var(--text-disabled)] mt-1">
            {t("earnings.acrossAllPlatforms")}
          </p>
        </div>
        <div
          style={{ background: "var(--bg-surface)" }}
          className=" border border-[var(--border-primary)] rounded-xl p-5"
        >
          <p className="text-[var(--text-tertiary)] text-sm">
            {t("earnings.avgRevenuePerPlay")}
          </p>
          <p className="text-3xl font-bold text-[var(--status-warning)] mt-1">
            {formatMoney(totalPlays > 0 ? totalRevenue / totalPlays : 0)}
          </p>
          <p className="text-xs text-[var(--text-disabled)] mt-1">
            {t("earnings.perStream")}
          </p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Revenue by Platform */}
        <div
          style={{ background: "var(--bg-surface)" }}
          className=" border border-[var(--border-primary)] rounded-xl p-5"
        >
          <h3 className="text-sm font-medium text-[var(--text-tertiary)] mb-4">
            {t("earnings.revenueByPlatform")}
          </h3>
          <div className="h-52">
            {revenueByPlatform.length > 0 ? (
              <AnalyticsBarChart
                data={revenueByPlatform.map((d) => ({
                  ...d,
                  value: parseFloat(d.value.toFixed(2)),
                }))}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-[var(--text-disabled)] text-sm">
                {t("earnings.noRevenueData")}
              </div>
            )}
          </div>
        </div>

        {/* Revenue Over Time */}
        <div
          style={{ background: "var(--bg-surface)" }}
          className=" border border-[var(--border-primary)] rounded-xl p-5"
        >
          <h3 className="text-sm font-medium text-[var(--text-tertiary)] mb-4">
            {t("earnings.revenueByPeriod")}
          </h3>
          <div className="h-52">
            {periodData.length > 0 ? (
              <div className="h-full flex flex-col">
                <div className="flex-1 flex items-end gap-2 px-2">
                  {periodData.map((d, i) => {
                    const maxRev = Math.max(
                      ...periodData.map((p) => p.revenue),
                      1,
                    );
                    return (
                      <div
                        key={i}
                        className="flex-1 flex flex-col items-center justify-end"
                        title={`${d.period}: ${formatMoney(d.revenue)}`}
                      >
                        <span className="text-[10px] text-[var(--text-tertiary)] mb-1">
                          {formatMoney(d.revenue)}
                        </span>
                        <div
                          className="w-full bg-[var(--accent)]/80 rounded-t hover:bg-green-400 transition-colors min-h-[4px] text-white"
                          style={{
                            height: `${Math.max((d.revenue / maxRev) * 100, 2)}%`,
                          }}
                        />
                        <span className="text-[10px] text-[var(--text-disabled)] mt-2 truncate w-full text-center">
                          {d.period}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-[var(--text-disabled)] text-sm">
                {t("earnings.noPeriodData")}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <FilterListIcon size={20} color="#6b7280" />
          <select
            value={platformFilter}
            onChange={(e) => setPlatformFilter(e.target.value)}
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
          onChange={(e) => setStatusFilter(e.target.value)}
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
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500"></div>
        </div>
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
                    {formatMoney(report.totalRevenue || 0)} {report.currency}
                  </td>
                  <td className="py-4 text-[var(--text-secondary)]">
                    {report.totalPlays?.toLocaleString()}
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

