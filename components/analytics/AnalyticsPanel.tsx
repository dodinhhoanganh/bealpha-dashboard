"use client";

import { useState, useEffect, useCallback } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { apiRequest } from "@/lib/api-client";

interface DailyMetric {
  period?: string;
  date?: string;
  plays?: number;
  totalPlays?: number;
  skips?: number;
  totalSkips?: number;
  saves?: number;
  totalSaves?: number;
  shares?: number;
  totalShares?: number;
}

interface AnalyticsSummary {
  totalPlays: number;
  totalSkips: number;
  totalSaves?: number;
  totalShares?: number;
  skipRatePercent: number;
}

interface AnalyticsResponse {
  data?: DailyMetric[];
  summary?: AnalyticsSummary;
}

interface StreamingMetric {
  date: string;
  plays: number;
  skips: number;
  saves: number;
  shares: number;
}

interface StreamingResponse {
  daily?: StreamingMetric[];
  summary?: {
    plays: number;
    skips: number;
    saves: number;
    shares: number;
    skipRate: number;
  };
}

interface DurationBucket {
  range: string;
  count: number;
}

interface AnalyticsView {
  daily: DailyMetric[];
  summary: AnalyticsSummary;
  skipRate: PieDatum[];
}

interface LineDatum {
  date: string;
  plays: number;
  skips: number;
  saves: number;
  shares: number;
}

interface PieDatum {
  name: string;
  value: number;
  color: string;
}

interface PieSegment extends PieDatum {
  pct: number;
  offset: number;
  index: number;
}

interface BarDatum {
  name: string;
  value: number;
  fill: string;
}

// ============ ANALYTICS COMPONENT ============
export default function AnalyticsPanel() {
  const { t } = useI18n(); // Auto-injected

  const [analytics, setAnalytics] = useState<AnalyticsView | null>(null);
  const [streaming, setStreaming] = useState<StreamingResponse | null>(null);
  const [duration, setDuration] = useState<DurationBucket[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const [analyticsData, streamingData, durationData] = await Promise.all([
        apiRequest<AnalyticsResponse>(`/api/v1/analytics/summary?days=${days}`),
        apiRequest<StreamingResponse>(`/api/v1/analytics/streaming?days=${days}`),
        apiRequest<{ data?: DurationBucket[] }>(`/api/v1/analytics/duration?days=${days}`),
      ]);
      setAnalytics({
        daily: analyticsData.data || [],
        summary: analyticsData.summary || { totalPlays: 0, totalSkips: 0, skipRatePercent: 0 },
        skipRate: analyticsData.summary ? [
          { name: t("analytics.completed", "Completed"), value: 100 - (analyticsData.summary.skipRatePercent || 0), color: "#e5e7eb" },
          { name: t("analytics.skipped", "Skipped"), value: analyticsData.summary.skipRatePercent || 0, color: "#ef4444" },
        ] : [],
      });
      setStreaming(streamingData);
      setDuration(durationData.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [days, t]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  const formatNumber = (n?: number | null) => {
    if (typeof n !== "number" || isNaN(n)) return "0";
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toLocaleString();
  };

  if (loading) {
    return (
      <div className="p-6">
        <h2 className="text-xl font-medium mb-6">{t("analytics.title")}</h2>
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500"></div>
        </div>
      </div>
    );
  }

  const dailyData = (analytics?.daily || [])
    .map((d): LineDatum => ({
      date: d.period || new Date(d.date ?? "").toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      plays: d.plays || d.totalPlays || 0,
      skips: d.skips || d.totalSkips || 0,
      saves: d.saves || d.totalSaves || 0,
      shares: d.shares || d.totalShares || 0,
    }));

  const streamingDaily = (streaming?.daily || []).map((d): LineDatum => ({
    date: d.date,
    plays: d.plays || 0,
    skips: d.skips || 0,
    saves: d.saves || 0,
    shares: d.shares || 0,
  }));

  const summary = analytics?.summary || {
    totalPlays: 0,
    totalSkips: 0,
    skipRatePercent: 0,
  };
  const streamingSummary = streaming?.summary || {
    plays: 0,
    skips: 0,
    saves: 0,
    shares: 0,
    skipRate: 0,
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-medium">{t("analytics.title")}</h2>
        <select
          value={days}
          onChange={(e) => setDays(parseInt(e.target.value))}
          className="px-3 py-2 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        >
          <option value={7}>{t("dashboard.last7Days")}</option>
          <option value={30}>{t("dashboard.last30Days")}</option>
          <option value={90}>{t("dashboard.last90Days")}</option>
          <option value={365}>{t("dashboard.lastYear")}</option>
        </select>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div
          style={{ background: "var(--bg-surface)" }}
          className=" border border-[var(--border-primary)] rounded-xl p-4"
        >
          <p className="text-[var(--text-tertiary)] text-sm">{t("earnings.totalPlays")}</p>
          <p className="text-2xl font-bold text-[var(--text-primary)] mt-1">
            {formatNumber(summary.totalPlays + streamingSummary.plays)}
          </p>
        </div>
        <div
          style={{ background: "var(--bg-surface)" }}
          className=" border border-[var(--border-primary)] rounded-xl p-4"
        >
          <p className="text-[var(--text-tertiary)] text-sm">{t("dashboard.totalSkips")}</p>
          <p className="text-2xl font-bold text-[var(--status-error)] mt-1">
            {formatNumber(summary.totalSkips + streamingSummary.skips)}
          </p>
        </div>
        <div
          style={{ background: "var(--bg-surface)" }}
          className=" border border-[var(--border-primary)] rounded-xl p-4"
        >
          <p className="text-[var(--text-tertiary)] text-sm">{t("dashboard.skipRate")}</p>
          <p className="text-2xl font-bold text-[var(--status-warning)] mt-1">
            {summary.skipRatePercent || streamingSummary.skipRate}%
          </p>
        </div>
        <div
          style={{ background: "var(--bg-surface)" }}
          className=" border border-[var(--border-primary)] rounded-xl p-4"
        >
          <p className="text-[var(--text-tertiary)] text-sm">{t("dashboard.totalSaves")}</p>
          <p className="text-2xl font-bold text-[var(--accent-text)] mt-1">
            {formatNumber(streamingSummary.saves)}
          </p>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Plays Over Time - Line Chart */}
        <div
          style={{ background: "var(--bg-surface)" }}
          className=" border border-[var(--border-primary)] rounded-xl p-5"
        >
          <h3 className="text-sm font-medium text-[var(--text-tertiary)] mb-4">
            {t("heading.playsOverTime", "Plays Over Time")}
          </h3>
          {dailyData.length > 0 || streamingDaily.length > 0 ? (
            <div className="h-64">
              <AnalyticsLineChart
                data={dailyData.length > 0 ? dailyData : streamingDaily}
              />
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center text-[var(--text-disabled)] text-sm">
              {t("analytics.noDataPeriod", "No data available for the selected period")}
            </div>
          )}
        </div>

        {/* Skip Rate - Donut */}
        <div
          style={{ background: "var(--bg-surface)" }}
          className=" border border-[var(--border-primary)] rounded-xl p-5"
        >
          <h3 className="text-sm font-medium text-[var(--text-tertiary)] mb-4">
            {t("heading.skipRateDistribution", "Skip Rate Distribution")}
          </h3>
          <div className="h-64 flex items-center justify-center">
            <AnalyticsPieChart data={analytics?.skipRate || []} />
          </div>
        </div>

        {/* Streaming Engagement - Bar Chart */}
        <div
          style={{ background: "var(--bg-surface)" }}
          className=" border border-[var(--border-primary)] rounded-xl p-5"
        >
          <h3 className="text-sm font-medium text-[var(--text-tertiary)] mb-4">
            {t("heading.engagementMetrics", "Engagement Metrics")}
          </h3>
          <div className="h-64">
            <AnalyticsBarChart
              data={[
                {
                  name: t("analytics.plays", "Plays"),
                  value: summary.totalPlays + streamingSummary.plays,
                  fill: "#22c55e",
                },
                {
                  name: t("analytics.skips", "Skips"),
                  value: summary.totalSkips + streamingSummary.skips,
                  fill: "#ef4444",
                },
                {
                  name: t("analytics.saves", "Saves"),
                  value: streamingSummary.saves,
                  fill: "#3b82f6",
                },
                {
                  name: t("analytics.shares", "Shares"),
                  value: streamingSummary.shares,
                  fill: "#a855f7",
                },
              ]}
            />
          </div>
        </div>

        {/* Play Duration Buckets */}
        <div
          style={{ background: "var(--bg-surface)" }}
          className=" border border-[var(--border-primary)] rounded-xl p-5"
        >
          <h3 className="text-sm font-medium text-[var(--text-tertiary)] mb-4">
            {t("heading.playDurationDistribution", "Play Duration Distribution")}
          </h3>
          <div className="h-64">
            {duration.length > 0 ? (
              <AnalyticsDurationChart data={duration} />
            ) : (
              <div className="h-full flex items-center justify-center text-[var(--text-disabled)] text-sm">
                {t("analytics.noDurationData", "No duration data available")}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ CHART COMPONENTS (using simple CSS bars as Recharts fallback) ============
function AnalyticsLineChart({ data }: { data: LineDatum[] }) {
  const { t } = useI18n(); // Auto-injected

  if (data.length === 0)
    return (
      <div className="h-full flex items-center justify-center text-[var(--text-disabled)] text-sm">
        {t("common.noData")}
      </div>
    );
  const maxVal = Math.max(...data.map((d) => d.plays), 1);
  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 flex items-end gap-1">
        {data.map((d, i) => (
          <div
            key={i}
            className="flex-1 flex flex-col items-center justify-end gap-1"
            title={`${d.date}: ${d.plays} ${t("dashboard.plays", "plays")}`}
          >
            <div
              className="w-full bg-[var(--accent)]/80 rounded-t hover:bg-green-400 transition-colors min-h-[2px] text-white"
              style={{ height: `${(d.plays / maxVal) * 100}%` }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-1 mt-2 overflow-hidden">
        {data
          .filter((_, i) => i % Math.max(1, Math.floor(data.length / 6)) === 0)
          .map((d, i) => (
            <span
              key={i}
              className="flex-1 text-[10px] text-[var(--text-disabled)] text-center truncate"
            >
              {d.date}
            </span>
          ))}
      </div>
    </div>
  );
}

function AnalyticsPieChart({ data }: { data: PieDatum[] }) {
  const { t } = useI18n(); // Auto-injected

  if (data.length === 0)
    return <div className="text-[var(--text-disabled)] text-sm">{t("common.noData")}</div>;
  const total = data.reduce((sum, d) => sum + d.value, 0) || 1;
  return (
    <div className="flex items-center gap-8">
      <div className="relative w-40 h-40">
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          {data
            .reduce<PieSegment[]>((acc, d, index) => {
              const pct = (d.value / total) * 100;
              const offset =
                acc.length > 0
                  ? acc[acc.length - 1].offset + acc[acc.length - 1].pct
                  : 0;
              acc.push({ ...d, pct, offset, index });
              return acc;
            }, [])
            .map((segment) => (
              <circle
                key={segment.index}
                cx="50"
                cy="50"
                r="40"
                fill="none"
                stroke={
                  segment.color || (segment.index === 0 ? "#22c55e" : "#ef4444")
                }
                strokeWidth="20"
                strokeDasharray={`${segment.pct * 2.51} ${251.2 - segment.pct * 2.51}`}
                strokeDashoffset={`${-segment.offset * 2.51}`}
              />
            ))}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-lg font-bold text-[var(--text-primary)]">
            {data[0]?.value || 0}%
          </span>
        </div>
      </div>
      <div className="space-y-2">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: d.color || "#22c55e" }}
            />
            <span className="text-sm text-[var(--text-secondary)]">
              {d.name}: {d.value}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AnalyticsBarChart({ data }: { data: BarDatum[] }) {
  const maxVal = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 flex items-end gap-4 px-4">
        {data.map((d, i) => (
          <div
            key={i}
            className="flex-1 flex flex-col items-center justify-end"
          >
            <span className="text-xs text-[var(--text-tertiary)] mb-1">
              {d.value > 0 ? d.value.toLocaleString() : "0"}
            </span>
            <div
              className="w-full rounded-t min-h-[4px] transition-all hover:opacity-80"
              style={{
                height: `${Math.max((d.value / maxVal) * 100, 2)}%`,
                backgroundColor: d.fill,
              }}
            />
            <span className="text-xs text-[var(--text-tertiary)] mt-2">
              {d.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AnalyticsDurationChart({ data }: { data: DurationBucket[] }) {
  const maxVal = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 flex items-end gap-3 px-2">
        {data.map((d, i) => (
          <div
            key={i}
            className="flex-1 flex flex-col items-center justify-end"
          >
            <span className="text-xs text-[var(--text-tertiary)] mb-1">
              {d.count}
            </span>
            <div
              className="w-full bg-[var(--status-info)]/80 rounded-t hover:bg-blue-400 transition-colors min-h-[4px] text-white"
              style={{ height: `${Math.max((d.count / maxVal) * 100, 2)}%` }}
            />
            <span className="text-[10px] text-[var(--text-disabled)] mt-2 text-center">
              {d.range}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============ EARNINGS COMPONENT ============
