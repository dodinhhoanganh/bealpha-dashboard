"use client";

import { useState, useEffect } from "react";
import { UserSession } from "@/lib/types";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { useToast } from "@/components/Toast";
import {
  AlbumIcon,
  AudioFileIcon,
  BusinessIcon,
  PersonIcon,
  BarChartIcon,
  AttachMoneyIcon,
  SettingsIcon,
  GroupIcon,
  AddIcon,
  CloudUploadIcon,
  MusicNoteIcon,
  QueueMusicIcon,
  ScheduleIcon,
  WarningIcon,
  CheckIcon,
  ArrowUpRightIcon,
  CircleIcon,
  XMarkIcon,
  LocalShippingIcon,
} from "@/components/Icon";

// ============ DASHBOARD HOME COMPONENT ============
export default function DashboardPanel({
  user,
  onNavigate,
}: {
  user: UserSession;
  onNavigate: (panel: string) => void;
}) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const { showToast } = useToast();
  const { t, formatMoney, language } = useI18n();

  useEffect(() => {
    const fetchDashboard = async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/dashboard");
        if (res.ok) {
          setData(await res.json());
        } else {
          showToast(t("toast.failedToLoadDashboard", "Failed to load dashboard"), "error");
        }
      } catch {
        showToast(t("toast.failedToLoadDashboard", "Failed to load dashboard"), "error");
      } finally {
        setLoading(false);
      }
    };
    fetchDashboard();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const formatNumber = (n?: number | null) => {
    if (typeof n !== "number" || isNaN(n)) return "0";
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toLocaleString();
  };

  const isAdmin = user?.roles?.includes("admin");

  const now = new Date();
  const greeting =
    now.getHours() < 12
      ? t("dashboard.greeting.morning")
      : now.getHours() < 18
        ? t("dashboard.greeting.afternoon")
        : t("dashboard.greeting.evening");
  const localeMap: Record<string, string> = {
    en: "en-US",
    vi: "vi-VN",
    ja: "ja-JP",
    ko: "ko-KR",
    zh: "zh-CN",
    fr: "fr-FR",
    es: "es-ES",
    de: "de-DE",
    pt: "pt-BR",
    th: "th-TH",
  };
  const dateStr = now.toLocaleDateString(localeMap[language] || "en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  if (loading) {
    return (
      <div className="p-8">
        <div className="mb-8">
          <div
            className="h-7 w-64 rounded animate-pulse mb-2"
            style={{ background: "var(--bg-elevated)" }}
          ></div>
          <div
            className="h-4 w-48 rounded animate-pulse"
            style={{ background: "var(--bg-elevated)" }}
          ></div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="rounded-lg p-5"
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border-primary)",
              }}
            >
              <div
                className="h-4 w-20 rounded animate-pulse mb-3"
                style={{ background: "var(--bg-elevated)" }}
              ></div>
              <div
                className="h-8 w-16 rounded animate-pulse"
                style={{ background: "var(--bg-elevated)" }}
              ></div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="rounded-lg p-5 h-64"
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border-primary)",
              }}
            >
              <div
                className="h-4 w-32 rounded animate-pulse mb-4"
                style={{ background: "var(--bg-elevated)" }}
              ></div>
              <div
                className="h-40 rounded animate-pulse"
                style={{ background: "var(--bg-elevated)" }}
              ></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const catalog = data?.catalog || {};
  const weeklyStats = data?.weeklyStats || {};
  const finance = data?.finance || {};
  const dailyTrend = data?.dailyTrend || [];
  const recentReleases = data?.recentReleases || [];
  const pendingApprovals = data?.pendingApprovals || [];
  const recentActivity = data?.recentActivity || [];
  const deliverySummary = data?.deliverySummary || {};
  const topPlaylists = data?.topPlaylists || [];

  const statusColor = (s: string) => {
    switch (s) {
      case "RELEASED":
        return "text-[var(--accent-text)] bg-[var(--status-success-surface)]";
      case "APPROVED":
        return "text-[var(--status-info)] bg-[var(--status-info-surface)]";
      case "PENDING":
        return "text-[var(--status-warning)] bg-[var(--status-warning-surface)]";
      case "REJECTED":
        return "text-[var(--status-error)] bg-[var(--status-error-surface)]";
      case "DRAFT":
        return "text-[var(--text-tertiary)] bg-[var(--bg-elevated)]";
      default:
        return "text-[var(--text-tertiary)] bg-[var(--bg-elevated)]";
    }
  };

  const actionLabel = (action: string) => {
    const map: Record<string, string> = {
      create: t("activity.created"),
      update: t("activity.updated"),
      delete: t("activity.deleted"),
      approve: t("activity.approved"),
      reject: t("activity.rejected"),
      login: t("activity.loggedIn"),
      upload: t("activity.uploaded"),
      status_change: t("activity.statusChange"),
    };
    return map[action] || action;
  };

  const entityIcon = (type: string) => {
    switch (type) {
      case "release":
        return <AlbumIcon size={16} />;
      case "track":
        return <MusicNoteIcon size={16} />;
      case "artist":
        return <PersonIcon size={16} />;
      case "label":
        return <BusinessIcon size={16} />;
      case "asset":
        return <AudioFileIcon size={16} />;
      case "user":
        return <GroupIcon size={16} />;
      default:
        return <SettingsIcon size={16} />;
    }
  };

  const timeAgo = (dateStr: string) => {
    const diff = now.getTime() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t("time.justNow");
    if (mins < 60) return t("time.minutesAgo").replace("{n}", String(mins));
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return t("time.hoursAgo").replace("{n}", String(hrs));
    const days = Math.floor(hrs / 24);
    if (days < 7) return t("time.daysAgo").replace("{n}", String(days));
    return new Date(dateStr).toLocaleDateString();
  };

  return (
    <div className="p-8">
      {/* Welcome Header */}
      <div className="mb-8">
        <h1
          className="text-2xl font-medium"
          style={{ color: "var(--text-primary)" }}
        >
          {greeting}, {user.name || user.stageName || user.email.split("@")[0]}
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-tertiary)" }}>
          {dateStr}
        </p>
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-3 mb-8">
        <button
          onClick={() => onNavigate("catalog")}
          className="btn-primary flex items-center gap-2 text-sm"
        >
          <AddIcon size={16} /> {t("dashboard.newRelease")}
        </button>
        <button
          onClick={() => onNavigate("assets")}
          className="btn-secondary flex items-center gap-2 text-sm"
        >
          <CloudUploadIcon size={16} /> {t("dashboard.uploadAsset")}
        </button>
        {isAdmin && catalog.pendingReleases > 0 && (
          <button
            onClick={() => onNavigate("catalog")}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
            style={{
              background: "var(--status-warning-surface)",
              color: "var(--status-warning)",
              border: "1px solid var(--status-warning-surface)",
            }}
          >
            {catalog.pendingReleases} {t("dashboard.pendingReview")}
          </button>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div
          onClick={() => onNavigate("catalog")}
          className="rounded-md p-5 cursor-pointer transition-colors"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-primary)",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.borderColor = "var(--text-tertiary)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.borderColor = "var(--border-primary)")
          }
        >
          <p
            className="text-xs font-semibold uppercase tracking-wider mb-2"
            style={{ color: "var(--text-tertiary)" }}
          >
            {t("dashboard.releases")}
          </p>
          <p
            className="text-3xl font-medium tracking-tight"
            style={{ color: "var(--text-primary)" }}
          >
            {formatNumber(catalog.totalReleases || 0)}
          </p>
          <p className="text-xs mt-2" style={{ color: "var(--text-tertiary)" }}>
            {catalog.upcomingReleases || 0} {t("dashboard.upcoming")}
          </p>
        </div>

        <div
          onClick={() => onNavigate("artists")}
          className="rounded-md p-5 cursor-pointer transition-colors"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-primary)",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.borderColor = "var(--text-tertiary)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.borderColor = "var(--border-primary)")
          }
        >
          <p
            className="text-xs font-semibold uppercase tracking-wider mb-2"
            style={{ color: "var(--text-tertiary)" }}
          >
            {t("dashboard.artists")}
          </p>
          <p
            className="text-3xl font-medium tracking-tight"
            style={{ color: "var(--text-primary)" }}
          >
            {formatNumber(catalog.totalArtists || 0)}
          </p>
          <p className="text-xs mt-2" style={{ color: "var(--text-tertiary)" }}>
            {catalog.totalLabels || 0} {t("dashboard.labelsCount")}
          </p>
        </div>

        <div
          onClick={() => onNavigate("analytics")}
          className="rounded-md p-5 cursor-pointer transition-colors"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-primary)",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.borderColor = "var(--text-tertiary)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.borderColor = "var(--border-primary)")
          }
        >
          <p
            className="text-xs font-semibold uppercase tracking-wider mb-2"
            style={{ color: "var(--text-tertiary)" }}
          >
            {t("dashboard.weeklyPlays")}
          </p>
          <p
            className="text-3xl font-medium tracking-tight"
            style={{ color: "var(--text-primary)" }}
          >
            {formatNumber(weeklyStats.plays || 0)}
          </p>
          <p className="text-xs mt-2" style={{ color: "var(--text-tertiary)" }}>
            {weeklyStats.saves || 0} {t("dashboard.savesThisWeek")}
          </p>
        </div>

        <div
          onClick={() => onNavigate("earnings")}
          className="rounded-md p-5 cursor-pointer transition-colors"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-primary)",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.borderColor = "var(--text-tertiary)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.borderColor = "var(--border-primary)")
          }
        >
          <p
            className="text-xs font-semibold uppercase tracking-wider mb-2"
            style={{ color: "var(--text-tertiary)" }}
          >
            {t("dashboard.totalRevenue")}
          </p>
          <p
            className="text-3xl font-medium tracking-tight"
            style={{ color: "var(--status-success)" }}
          >
            {formatMoney(finance.totalRoyalties || 0)}
          </p>
          <p className="text-xs mt-2" style={{ color: "var(--text-tertiary)" }}>
            {finance.pendingReports || 0} {t("dashboard.pendingReports")}
          </p>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Plays Trend — Last 30 Days */}
        <div
          style={{ background: "var(--bg-surface)" }}
          className="border border-[var(--border-primary)] rounded-md p-5"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
              {t("dashboard.playsTrend")}
            </h3>
            <button
              onClick={() => onNavigate("analytics")}
              className="text-xs font-medium text-[var(--accent-text)] hover:text-[var(--accent-hover)] uppercase tracking-wider"
            >
              {t("common.viewAll")} →
            </button>
          </div>
          <div className="h-48">
            {dailyTrend.length > 0 ? (
              <DashboardMiniChart data={dailyTrend} />
            ) : (
              <div className="h-full flex items-center justify-center text-[var(--text-disabled)] text-sm">
                <div className="text-center">
                  <BarChartIcon size={32} color="#525252" />
                  <p className="mt-1">{t("dashboard.noStreamingData")}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Revenue by Platform */}
        <div
          style={{ background: "var(--bg-surface)" }}
          className="border border-[var(--border-primary)] rounded-md p-5"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
              {t("dashboard.revenueOverview")}
            </h3>
            <button
              onClick={() => onNavigate("earnings")}
              className="text-xs font-medium text-[var(--accent-text)] hover:text-[var(--accent-hover)] uppercase tracking-wider"
            >
              {t("common.viewAll")} →
            </button>
          </div>
          {(finance.recentReports || []).length > 0 ? (
            <div className="space-y-3">
              {(finance.recentReports || [])
                .slice(0, 4)
                .map((r: any, i: number) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-2 border-b border-[var(--border-subtle)] last:border-0"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${
                          r.platform === "spotify"
                            ? "bg-[var(--status-success-surface)] text-[var(--accent-text)]"
                            : r.platform === "apple"
                              ? "bg-[rgba(252,60,68,0.1)] text-[var(--color-apple)]"
                              : r.platform === "youtube"
                                ? "bg-[var(--status-error-surface)] text-[var(--status-error)]"
                                : r.platform === "amazon"
                                  ? "bg-[var(--status-warning-surface)] text-[var(--status-warning)]"
                                  : "bg-[var(--bg-elevated)] text-[var(--text-tertiary)]"
                        }`}
                      >
                        <AttachMoneyIcon size={16} />
                      </span>
                      <div>
                        <p className="text-sm font-medium text-[var(--text-primary)] capitalize">
                          {r.platform || "Unknown"}
                        </p>
                        <p className="text-xs text-[var(--text-disabled)]">
                          {r.period}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-[var(--accent-text)]">
                        {formatMoney(r.totalRevenue || 0)}
                      </p>
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded capitalize ${
                          r.status === "paid"
                            ? "text-[var(--accent-text)] bg-[var(--status-success-surface)]"
                            : r.status === "processed"
                              ? "text-[var(--status-info)] bg-[var(--status-info-surface)]"
                              : "text-[var(--status-warning)] bg-[var(--status-warning-surface)]"
                        }`}
                      >
                        {r.status}
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          ) : (
            <div className="h-48 flex items-center justify-center text-[var(--text-disabled)] text-sm">
              <div className="text-center">
                <AttachMoneyIcon size={32} color="#525252" />
                <p className="mt-1">{t("dashboard.noRevenueReports")}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Second Row: Recent Releases + Pending Approvals */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Recent Releases */}
        <div
          style={{ background: "var(--bg-surface)" }}
          className="border border-[var(--border-primary)] rounded-md p-5"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
              {t("dashboard.recentReleases")}
            </h3>
            <button
              onClick={() => onNavigate("products")}
              className="text-xs font-medium text-[var(--accent-text)] hover:text-[var(--accent-hover)] uppercase tracking-wider"
            >
              {t("common.viewAll")} →
            </button>
          </div>
          {recentReleases.length > 0 ? (
            <div className="space-y-3">
              {recentReleases.map((r: any) => (
                <div
                  key={r.id}
                  className="flex items-center gap-3 py-2 border-b border-[var(--border-subtle)] last:border-0"
                >
                  {r.coverUrl ? (
                    <img
                      src={r.coverUrl}
                      alt=""
                      className="w-10 h-10 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-lg  flex items-center justify-center">
                      <AlbumIcon size={18} color="#525252" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                      {r.title}
                    </p>
                    <p className="text-xs text-[var(--text-disabled)]">
                      {r.artist?.name || "Unknown"} • {r.format}
                    </p>
                  </div>
                  <span
                    className={`text-xs px-2 py-1 rounded ${statusColor(r.status)}`}
                  >
                    {r.status}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center text-[var(--text-disabled)] text-sm">
              <AlbumIcon size={32} color="#525252" />
              <p className="mt-1">{t("dashboard.noReleases")}</p>
            </div>
          )}
        </div>

        {/* Pending Approvals (admin) / Top Playlists (other) */}
        <div
          style={{ background: "var(--bg-surface)" }}
          className="border border-[var(--border-primary)] rounded-md p-5"
        >
          {isAdmin && pendingApprovals.length > 0 ? (
            <>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--status-warning)]">
                  <WarningIcon
                    size={16}
                    className="inline-block mr-1 -mt-0.5"
                  />{" "}
                  {t("dashboard.pendingApprovals")}
                </h3>
                <span className="text-xs font-medium bg-[var(--status-warning-surface)] text-[var(--status-warning)] px-2 py-0.5 rounded-full">
                  {pendingApprovals.length}
                </span>
              </div>
              <div className="space-y-3">
                {pendingApprovals.map((r: any) => (
                  <div
                    key={r.id}
                    className="flex items-center gap-3 py-2 border-b border-[var(--border-subtle)] last:border-0"
                  >
                    {r.coverUrl ? (
                      <img
                        src={r.coverUrl}
                        alt=""
                        className="w-10 h-10 rounded-lg object-cover"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-lg  flex items-center justify-center">
                        <AlbumIcon size={18} color="#525252" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                        {r.title}
                      </p>
                      <p className="text-xs text-[var(--text-disabled)]">
                        {r.artist?.name || "Unknown"} •{" "}
                        {r.label?.name || "No label"}
                      </p>
                    </div>
                    <span className="text-xs text-[var(--status-warning)] bg-[var(--status-warning-surface)] px-2 py-1 rounded">
                      {t("common.review")}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                  {t("dashboard.topPlaylists")}
                </h3>
              </div>
              {topPlaylists.length > 0 ? (
                <div className="space-y-3">
                  {topPlaylists.map((p: any, i: number) => (
                    <div
                      key={p.id}
                      className="flex items-center gap-3 py-2 border-b border-[var(--border-subtle)] last:border-0"
                    >
                      <span className="text-lg font-bold text-[var(--text-disabled)] w-6 text-center">
                        {i + 1}
                      </span>
                      <div className="w-8 h-8 rounded-lg  flex items-center justify-center">
                        <QueueMusicIcon size={16} color="#6b7280" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                          {p.name}
                        </p>
                        <p className="text-xs text-[var(--text-disabled)] capitalize">
                          {p.platform}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-[var(--text-primary)]">
                          {formatNumber(p.plays)}
                        </p>
                        <p className="text-xs text-[var(--text-disabled)]">
                          {t("dashboard.plays")}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center text-[var(--text-disabled)] text-sm">
                  <QueueMusicIcon size={32} color="#525252" />
                  <p className="mt-1">{t("dashboard.noPlaylistData")}</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Third Row: Delivery Stats + Activity Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* DDEX Delivery Stats */}
        <div
          style={{ background: "var(--bg-surface)" }}
          className="border border-[var(--border-primary)] rounded-md p-5"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
              {t("dashboard.distributionStatus")}
            </h3>
            <button
              onClick={() => onNavigate("distribution")}
              className="text-xs font-medium text-[var(--accent-text)] hover:text-[var(--accent-hover)] uppercase tracking-wider"
            >
              {t("common.viewAll")} →
            </button>
          </div>
          {deliverySummary.total > 0 ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className=" rounded-lg p-3">
                  <p className="text-xs text-[var(--text-disabled)]">
                    {t("dashboard.totalDeliveries")}
                  </p>
                  <p className="text-xl font-bold text-[var(--text-primary)] mt-1">
                    {deliverySummary.total}
                  </p>
                </div>
                <div className=" rounded-lg p-3">
                  <p className="text-xs text-[var(--text-disabled)]">
                    {t("dashboard.confirmed")}
                  </p>
                  <p className="text-xl font-bold text-[var(--accent-text)] mt-1">
                    {deliverySummary.confirmed}
                  </p>
                </div>
              </div>
              {/* Status bar */}
              <div>
                <div className="flex h-3 rounded-full overflow-hidden ">
                  {deliverySummary.confirmed > 0 && (
                    <div
                      className="bg-[var(--accent)] text-white"
                      style={{
                        width: `${(deliverySummary.confirmed / deliverySummary.total) * 100}%`,
                      }}
                    />
                  )}
                  {deliverySummary.sent > 0 && (
                    <div
                      className="bg-[var(--status-info)] text-white"
                      style={{
                        width: `${(deliverySummary.sent / deliverySummary.total) * 100}%`,
                      }}
                    />
                  )}
                  {deliverySummary.pending > 0 && (
                    <div
                      className="bg-amber-500"
                      style={{
                        width: `${(deliverySummary.pending / deliverySummary.total) * 100}%`,
                      }}
                    />
                  )}
                  {deliverySummary.failed > 0 && (
                    <div
                      className="bg-[var(--status-error)]"
                      style={{
                        width: `${(deliverySummary.failed / deliverySummary.total) * 100}%`,
                      }}
                    />
                  )}
                </div>
                <div className="flex justify-between mt-2 text-xs">
                  <span className="text-[var(--accent-text)]">
                    <CheckIcon size={14} className="inline-block mr-1" />{" "}
                    {deliverySummary.confirmed}
                  </span>
                  <span className="text-[var(--status-info)]">
                    <ArrowUpRightIcon size={14} className="inline-block mr-1" />{" "}
                    {deliverySummary.sent}
                  </span>
                  <span className="text-[var(--status-warning)]">
                    <CircleIcon size={14} className="inline-block mr-1" />{" "}
                    {deliverySummary.pending}
                  </span>
                  <span className="text-[var(--status-error)]">
                    <XMarkIcon size={14} className="inline-block mr-1" />{" "}
                    {deliverySummary.failed}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-[var(--text-disabled)] text-sm">
              <LocalShippingIcon size={32} color="#525252" />
              <p className="mt-1">{t("dashboard.noDeliveries")}</p>
              <button
                onClick={() => onNavigate("distribution")}
                className="mt-2 text-xs text-[var(--accent-text)] hover:text-[var(--accent-hover)]"
              >
                {t("dashboard.startDistributing")} →
              </button>
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div
          style={{ background: "var(--bg-surface)" }}
          className="border border-[var(--border-primary)] rounded-md p-5"
        >
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-4">
            {t("dashboard.recentActivity")}
          </h3>
          {recentActivity.length > 0 ? (
            <div className="space-y-1">
              {recentActivity.map((a: any) => (
                <div
                  key={a.id}
                  className="flex items-center gap-3 py-2 border-b border-[var(--border-primary)]/30 last:border-0"
                >
                  <div className="w-8 h-8 rounded-lg  flex items-center justify-center text-[var(--text-tertiary)]">
                    {entityIcon(a.entityType)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[var(--text-primary)]">
                      <span className="text-[var(--text-tertiary)]">
                        {actionLabel(a.action)}
                      </span>{" "}
                      <span className="capitalize">{a.entityType}</span>
                    </p>
                    <p className="text-xs text-[var(--text-disabled)]">
                      {timeAgo(a.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center text-[var(--text-disabled)] text-sm">
              <ScheduleIcon size={32} color="#525252" />
              <p className="mt-1">{t("dashboard.noActivity")}</p>
            </div>
          )}
        </div>
      </div>

      <CatalogFooter
        catalog={catalog}
        topPlaylists={topPlaylists}
        onNavigate={onNavigate}
        formatNumber={formatNumber}
      />
    </div>
  );
}

// Catalog footer uses useI18n for translated labels
function CatalogFooter({
  catalog,
  topPlaylists,
  onNavigate,
  formatNumber,
}: {
  catalog: any;
  topPlaylists: any[];
  onNavigate: (panel: string) => void;
  formatNumber: (n: number) => string;
}) {
  const { t } = useI18n();
  const items = [
    {
      label: t("dashboard.tracks"),
      value: catalog.totalTracks || 0,
      panel: "products",
    },
    {
      label: t("nav.assets"),
      value: catalog.totalAssets || 0,
      panel: "assets",
    },
    {
      label: t("nav.labels"),
      value: catalog.totalLabels || 0,
      panel: "labels",
    },
    {
      label: t("nav.artists"),
      value: catalog.totalArtists || 0,
      panel: "artists",
    },
    {
      label: t("dashboard.playlists"),
      value: topPlaylists.length,
      panel: "analytics",
    },
  ];
  return (
    <div className="mt-8 grid grid-cols-2 md:grid-cols-5 gap-3">
      {items.map((item, i) => (
        <button
          key={i}
          onClick={() => onNavigate(item.panel)}
          className="rounded-md p-3 flex items-center gap-3 transition-colors text-left"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "var(--bg-surface-hover)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "var(--bg-surface)")
          }
        >
          <div>
            <p
              className="text-lg font-medium"
              style={{ color: "var(--text-primary)" }}
            >
              {formatNumber(item.value)}
            </p>
            <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
              {item.label}
            </p>
          </div>
        </button>
      ))}
    </div>
  );
}

// Mini sparkline chart for dashboard
function DashboardMiniChart({ data }: { data: any[] }) {
  const { t } = useI18n(); // Auto-injected

  const maxVal = Math.max(...data.map((d) => d.plays), 1);
  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 flex items-end gap-[2px]">
        {data.map((d, i) => (
          <div
            key={i}
            className="flex-1 rounded-t transition-colors min-h-[2px] cursor-pointer"
            style={{
              height: `${Math.max((d.plays / maxVal) * 100, 1)}%`,
              background: "var(--text-tertiary)",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "var(--text-secondary)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "var(--text-tertiary)")
            }
            title={`${d.date}: ${d.plays.toLocaleString()} plays`}
          />
        ))}
      </div>
      <div className="flex justify-between mt-2 px-1">
        {data.length > 0 && (
          <>
            <span
              className="text-[10px]"
              style={{ color: "var(--text-tertiary)" }}
            >
              {data[0]?.date}
            </span>
            <span
              className="text-[10px]"
              style={{ color: "var(--text-tertiary)" }}
            >
              {data[data.length - 1]?.date}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
