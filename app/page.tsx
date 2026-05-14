"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { COUNTRY_CODES } from "@/lib/country-codes";
import {
  LANGUAGES,
  ALBUM_PRICING_TIERS,
  TRACK_PRICING_TIERS,
} from "@/lib/languages";
import { MUSIC_GENRES, getAllSubgenres } from "@/lib/music-genres";
import { LocalizedInput, Localization } from "@/components/LocalizedInput";
import SearchableArtistSelect from "@/components/SearchableArtistSelect";
import SearchableLabelSelect from "@/components/SearchableLabelSelect";
import TrackForm from "@/components/TrackForm";
import AssetForm from "@/components/AssetForm";
import ImageUpload from "@/components/ImageUpload";
import ChannelsPanel from "@/components/ChannelsPanel";
import VevoCatalogPanel from "@/components/VevoCatalogPanel";
import CompositionsPanel from "@/components/CompositionsPanel";
import PlaylistsPanel from "@/components/PlaylistsPanel";
import { I18nProvider, useI18n } from "@/lib/i18n/I18nProvider";
import { translateApiError } from "@/lib/i18n/translateApiError";
import {
  AlbumIcon,
  AudioFileIcon,
  BusinessIcon,
  PersonIcon,
  BarChartIcon,
  AttachMoneyIcon,
  SettingsIcon,
  LogoutIcon,
  GroupIcon,
  AddIcon,
  SearchIcon,
  EditIcon,
  DeleteIcon,
  CheckCircleIcon,
  PendingIcon,
  CancelIcon,
  FilterListIcon,
  CloseIcon,
  PhotoCameraIcon,
  KeyboardArrowDownIcon,
  ArrowBackIcon,
  CloudUploadIcon,
  FileUploadIcon,
  FolderZipIcon,
  TableChartIcon,
  SwapHorizIcon,
  MenuIcon,
  SendIcon,
  RefreshIcon,
  DownloadIcon,
  VisibilityIcon,
  LocalShippingIcon,
  DashboardIcon,
  TrendingUpIcon,
  ScheduleIcon,
  MusicNoteIcon,
  QueueMusicIcon,
  PlayCircleOutlineIcon,
  HistoryIcon,
  HandWaveIcon,
  WarningIcon,
  CheckIcon,
  ArrowUpRightIcon,
  CircleIcon,
  XMarkIcon,
  TagIcon,
  LightbulbIcon,
  BoxArchiveIcon,
  ImageIcon,
  SpotifyIcon,
  AppleIcon,
} from "@/components/Icon";
import Pagination from "@/components/Pagination";
import { ToastProvider, useToast } from "@/components/Toast";
import { useUploadProgress } from "@/components/UploadProgress";
import { TableSkeleton, CardSkeleton } from "@/components/Skeleton";
import NotificationBell from "@/components/NotificationBell";
import { useTheme } from "@/components/ThemeProvider";
import Sidebar from "@/components/layout/Sidebar";
import TopBar from "@/components/layout/TopBar";
import SearchableEntitySelect from "@/components/SearchableEntitySelect";

const UPLOAD_SERVER = process.env.NEXT_PUBLIC_UPLOAD_URL || "";

// Types
interface UserSession {
  id: string;
  email: string;
  name?: string;
  stageName?: string;
  avatar?: string;
  phone?: string;
  roles: string[];
  permissions: string[];
  // B2B2B entity context
  entityId: string;
  entityType: string;
  entityRole: string;
  entityName: string;
  entityLogo?: string | null;
  entityPath: string;
  tenantId?: string | null;
  // Preferences
  language?: string;
  currency?: string;
  timezone?: string;
  theme?: string;
}

interface MenuItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  requiredPermissions?: string[];
  requiredRoles?: string[];
}

// (NavLabel and menuItems removed — sidebar uses its own nav list in Sidebar.tsx)

// ============ MODAL COMPONENT ============
function Modal({
  isOpen,
  onClose,
  title,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!isOpen) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ animation: "backdropIn 0.2s ease-out" }}
    >
      <div
        className="absolute inset-0"
        style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)" }}
        onClick={onClose}
      ></div>
      <div
        className="relative w-full max-w-md mx-4"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border-primary)",
          borderRadius: "var(--radius-2xl)",
          boxShadow: "var(--shadow-xl)",
          animation: "modalIn 0.25s cubic-bezier(0.2, 0, 0, 1)",
        }}
      >
        <div
          className="flex items-center justify-between px-6 py-5"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <h3
            className="text-lg font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            {title}
          </h3>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg transition-all duration-150"
            style={{ color: "var(--text-tertiary)" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--bg-elevated)";
              e.currentTarget.style.color = "var(--text-primary)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "var(--text-tertiary)";
            }}
          >
            <CloseIcon size={18} />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

// (Image upload UI extracted to components/ImageUpload.tsx)

// (UserProfileDropdown and hasAccess removed — sidebar handles its own UI in Sidebar.tsx)

// ============ DASHBOARD HOME COMPONENT ============
function DashboardPanel({
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

// ============ RELEASES COMPONENT ============
function ReleasesPanel({
  user,
  defaultMode = "AUDIO",
}: {
  user: UserSession;
  defaultMode?: "AUDIO" | "VIDEO";
}) {
  const { t } = useI18n(); // Auto-injected

  const [releases, setReleases] = useState<any[]>([]);
  const [artists, setArtists] = useState<{ id: string; name: string }[]>([]);
  const [labels, setLabels] = useState<{ id: string; name: string }[]>([]);
  const [entities, setEntities] = useState<{ id: string; officialName: string; entityType: string }[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(20);
  const [view, setView] = useState<"list" | "create" | "edit">("list");
  const [selectedRelease, setSelectedRelease] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState<"" | "xlsx" | "zip">("");
  const [showDdexPanel, setShowDdexPanel] = useState(false);
  const sheetInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const [dragState, setDragState] = useState<string | null>(null);
  const [missingFiles, setMissingFiles] = useState<
    Array<{ type: "audio" | "artwork"; filename: string; releaseTitle: string }>
  >([]);
  const [uploadingMissingFiles, setUploadingMissingFiles] = useState(false);
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);

  // DDEX Progress Modal state
  const [ddexProgress, setDdexProgress] = useState<{
    show: boolean;
    mode: "import" | "export" | "validate";
    phase:
      | "validating"
      | "uploading"
      | "importing"
      | "exporting"
      | "done"
      | "error";
    title: string;
    progress: number; // 0-100
    currentItem: string;
    items: Array<{
      name: string;
      status: "pending" | "processing" | "done" | "error";
      error?: string;
    }>;
    summary: string;
    errors: string[];
    validation?: {
      isDdexCompliant: boolean;
      totalColumns: number;
      totalRows: number;
      missingRequired: string[];
      missingRecommended: string[];
      presentDdexColumns: number;
      errors: string[];
    };
    zipInfo?: {
      audioFiles: number;
      artworkFiles: number;
      audioFileNames: string[];
      artworkFileNames: string[];
    } | null;
  }>({
    show: false,
    mode: "import",
    phase: "validating",
    title: "",
    progress: 0,
    currentItem: "",
    items: [],
    summary: "",
    errors: [],
  });

  // Multi-step wizard state
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState({
    // Step 1: Basics & Artwork
    coverUrl: "",
    motionUrl: "",
    tidalArtworkUrl: "",
    amazonArtworkUrl: "",
    releaseType: defaultMode, // AUDIO or VIDEO
    format: "SINGLE", // SINGLE, EP, ALBUM
    title: "",
    subtitle: "",
    titleLocalized: [] as Localization[],
    titleVersion: "",
    titleVersionNotes: "",
    releaseCode: "",
    upc: "",
    upcAutoGenerate: false,
    metaLanguage: "en",
    releaseNotes: "",
    primaryArtists: [] as string[],
    featuringArtists: [] as string[],
    remixer: "",
    producer: "",

    // Step 2: Details
    genre: "",
    subGenre: "",
    ownerId: "", // Distributor/Label Owner
    labelId: "",
    cLine: "",
    pLine: "",
    contractPeriod: {
      begins: "",
      ends: "", // date or 'perpetuity'
    },

    // Step 3: Tracks
    tracks: [] as Array<{
      audioAssetId: string;
      snippetStart: string;
      snippetEnd?: string;
      title: string;
      titleLocalized?: Localization[];
      version: string;
      audioLanguage: string;
      lyricsLanguage: string;
      explicitContent: "NONE" | "EXPLICIT" | "CLEAN";
      lyrics: string;
      primaryArtists: string[];
      featuringArtists: string[];
      remixer: string;
      composer: string; // Legacy
      producer: string;
      iswc?: string;
      splits?: Array<{
        name: string;
        role: "Author" | "Composer" | "Arranger" | "Translator";
        ipi: string;
        share: string;
        publisherName: string;
        publisherIpi: string;
        publisherShare: string;
      }>;
      contributors: {
        performers: Array<{ name: string; role: string; artistId?: string }>;
        studioPersonnel: Array<{
          name: string;
          role: string;
          artistId?: string;
        }>;
        labelPersonnel: Array<{
          name: string;
          role: string;
          artistId?: string;
        }>;
        compositional: Array<{ name: string; role: string; artistId?: string }>;
      };
      cLine: string;
      pLine: string;
      isrc: string;
      isrcAutoGenerate: boolean;
      ownership:
        | "ORIGINAL_MASTER"
        | "ACQUIRED"
        | "EXCLUSIVE_LICENSEE"
        | "NON_EXCLUSIVE_LICENSEE"
        | "NO_MASTER_RIGHTS";
      countryOfRecording: string;
      nationalityOfOwner: string;
      publishingObligation?: string;
      publisher?: string;
      vevoEndCredits?: boolean;
      vevoNoLetterboxing?: boolean;
      // Multimedia & Marketing
      canvasAssetId?: string;
      motionAssetId?: string;
      pitchingNote?: string;
      pitchingSpotifyData?: any;
      pitchingAmazonData?: any;
      pitchingTidalData?: any;
    }>,

    // Step 4: Scheduling & Pricing
    releaseDate: "",
    originalReleaseDate: "",
    releaseTime: "00:00",
    salesDate: "",
    salesTime: "00:00",
    preOrderType: "NO_PRE_ORDER", // IMMEDIATE, NO_PRE_ORDER, SPECIFIC_DATE
    preOrderDate: "",
    previewable: "NO",
    albumPricing: "Mid/Front",
    trackPricing: "Standard",
    territories: [] as string[], // All selected by default
    excludedTerritories: [] as string[],
    trackPublishingObligations: {} as Record<string, string>,
    trackPublishers: {} as Record<string, string>,
  });

  const canCreate = user.permissions.includes("release.create");
  const canUpdate = user.permissions.includes("release.update");
  const canDelete = user.permissions.includes("release.delete");
  const canApprove = user.permissions.includes("release.approve");

  const fetchReleases = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (statusFilter !== "all") params.set("status", statusFilter);
      params.set("type", defaultMode);
      params.set("page", String(page));
      params.set("limit", String(limit));
      const res = await fetch(`/api/releases?${params}`);
      if (res.ok) {
        const json = await res.json();
        setReleases(json.data || json);
        setTotal(json.total || 0);
        setTotalPages(json.totalPages || 1);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, page, limit]);

  const fetchArtists = useCallback(async () => {
    try {
      const res = await fetch("/api/artists?limit=200");
      if (res.ok) {
        const json = await res.json();
        setArtists(json.data || json);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const fetchLabels = useCallback(async () => {
    try {
      const res = await fetch("/api/labels");
      if (res.ok) {
        const json = await res.json();
        setLabels(json.data || json);
      }
    } catch (error) {
      console.error(error);
    }
  }, []);

  const fetchEntities = useCallback(async () => {
    try {
      const res = await fetch("/api/entities?limit=100");
      if (res.ok) {
        const json = await res.json();
        setEntities(json.data || json);
      }
    } catch (error) {
      console.error(error);
    }
  }, []);

  const fetchAssets = useCallback(async () => {
    try {
      const res = await fetch("/api/assets?type=AUDIO&limit=200");
      if (res.ok) {
        const json = await res.json();
        setAssets(json.data || json);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const handleCreateArtist = async (artist: {
    name: string;
    spotifyId?: string;
    appleMusicId?: string;
  }): Promise<string> => {
    try {
      const res = await fetch("/api/artists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(artist),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(
          errData.error || `Failed to create artist (${res.status})`,
        );
      }
      const newArtist = await res.json();
      await fetchArtists(); // Refresh artist list
      return newArtist.id;
    } catch (error) {
      console.error("Error creating artist:", error);
      throw error;
    }
  };

  const handleCreateLabel = async (name: string): Promise<string> => {
    try {
      const res = await fetch("/api/labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(
          errData.error || `Failed to create label (${res.status})`,
        );
      }
      const newLabel = await res.json();
      await fetchLabels(); // Refresh label list
      return newLabel.id;
    } catch (error) {
      console.error("Error creating label:", error);
      throw error;
    }
  };

  useEffect(() => {
    fetchReleases();
    fetchArtists();
    fetchLabels();
    fetchEntities();
    fetchAssets();
  }, [fetchReleases, fetchArtists, fetchLabels, fetchEntities, fetchAssets]);

  // Global search listener
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      if (e.detail.type === "RELEASE") {
        setSearch(e.detail.title);
        setPage(1);
      }
    };
    window.addEventListener("open-entity", handler as EventListener);
    return () => window.removeEventListener("open-entity", handler as EventListener);
  }, []);

  const handleApprove = async (id: string) => {
    await fetch(`/api/releases/${id}/approve`, { method: "POST" });
    fetchReleases();
  };

  const handleDeny = async (id: string) => {
    await fetch(`/api/releases/${id}/deny`, { method: "POST" });
    fetchReleases();
  };

  const handleDelete = async (id: string) => {
    const release = releases.find((r) => r.id === id);
    const trackCount = release?.trackCount || release?.tracks?.length || 0;
    const msg = t("releases.confirmDeleteRelease", `Are you sure you want to delete "${release?.title || "this release"}"?`) + `\n\n` + t("releases.deleteWillRemove", "This will also permanently delete:") + `\n- ${trackCount} ` + t("releases.tracksAndAudio", "track(s) and their audio files") + `\n- ` + t("releases.coverArt", "Cover art") + `\n- ` + t("releases.allDdexRecords", "All DDEX delivery records") + `\n\n` + t("releases.cannotBeUndone", "This action cannot be undone.");
    if (!confirm(msg)) return;
    try {
      const res = await fetch(`/api/releases/${id}`, { method: "DELETE" });
      if (res.ok) fetchReleases();
    } catch (e) {
      console.error(e);
    }
  };

  const openCreateForm = () => {
    // Initialize all territories as selected
    const allTerritories = COUNTRY_CODES.map((c) => c.code);
    setFormData({
      coverUrl: "",
      motionUrl: "",
      tidalArtworkUrl: "",
      amazonArtworkUrl: "",
      releaseType: defaultMode,
      format: "SINGLE",
      title: "",
      subtitle: "",
      titleLocalized: [] as Localization[],
      titleVersion: "",
      titleVersionNotes: "",
      releaseCode: "",
      upc: "",
      upcAutoGenerate: false,
      metaLanguage: "en",
      releaseNotes: "",
      primaryArtists: [],
      featuringArtists: [],
      remixer: "",
      producer: "",
      genre: MUSIC_GENRES[0].value,
      subGenre: "",
      ownerId: entities.length > 0 ? entities[0].id : "",
      labelId: labels.length > 0 ? labels[0].id : "",
      cLine: "",
      pLine: "",
      tracks: [] as any[],
      releaseDate: new Date().toISOString().split("T")[0],
      originalReleaseDate: new Date().toISOString().split("T")[0],
      releaseTime: "00:00",
      salesDate: new Date().toISOString().split("T")[0],
      salesTime: "00:00",
      preOrderType: "NO_PRE_ORDER",
      preOrderDate: "",
      previewable: "NO",
      albumPricing: "Mid/Front",
      trackPricing: "Standard",
      territories: allTerritories,
      excludedTerritories: [],
      trackPublishingObligations: {},
      trackPublishers: {},
      contractPeriod: { begins: "", ends: "" },
    });
    setCurrentStep(1);
    setFormError("");
    setView("create");
  };

  const openEditForm = (release: any) => {
    setSelectedRelease(release);
    setFormData({
      coverUrl: release.coverUrl || "",
      motionUrl: release.motionUrl || "",
      tidalArtworkUrl: release.tidalArtworkUrl || "",
      amazonArtworkUrl: release.amazonArtworkUrl || "",
      title: release.title || "",
      subtitle: release.subtitle || "",
      titleLocalized: Array.isArray(release.titleLocalized)
        ? release.titleLocalized
        : [],
      primaryArtists: release.artistId ? [release.artistId] : [], // Map artistId to primaryArtists array
      featuringArtists: [],
      format: release.format || "SINGLE",
      releaseDate: release.releaseDate
        ? new Date(release.releaseDate).toISOString().split("T")[0]
        : "",
      originalReleaseDate: release.originalReleaseDate
        ? new Date(release.originalReleaseDate).toISOString().split("T")[0]
        : "",
      upc: release.ean || "", // Map EAN to UPC
      upcAutoGenerate: false,
      releaseCode: release.catalogueNumber || "",
      genre: release.genre || "",
      subGenre: release.subGenre || "",
      ownerId: release.ownerId || "",
      pLine: release.pLine || "",
      cLine: release.cLine || "",
      // Initialize other fields with defaults or from release if available
      releaseType: release.type || defaultMode,
      titleVersion: "",
      titleVersionNotes: "",
      metaLanguage: release.metaLanguage || "en",
      releaseNotes: release.releaseNotes || "",
      remixer: "",
      producer: "",
      labelId: release.labelId || "",
      tracks: [] as any[], // Tracks would need to be fetched and mapped
      releaseTime: "00:00",
      salesDate: "",
      salesTime: "00:00",
      preOrderType: "NO_PRE_ORDER",
      preOrderDate: "",
      previewable: "NO",
      albumPricing: "Mid/Front",
      trackPricing: "Standard",
      territories: [],
      excludedTerritories: [],
      trackPublishingObligations: {},
      trackPublishers: {},
      contractPeriod: release.contractPeriod || { begins: "", ends: "" },
    });
    setFormError("");
    setView("edit");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Full validation across all steps
    const { errors, failedStep } = validateReleaseAll(formData);
    if (errors.length > 0) {
      setFormError(errors.join("\n"));
      if (view === "create" && failedStep > 0) setCurrentStep(failedStep);
      return;
    }

    setSaving(true);
    setFormError("");

    try {
      const url =
        view === "create"
          ? "/api/releases"
          : `/api/releases/${selectedRelease?.id}`;
      const method = view === "create" ? "POST" : "PATCH";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          releaseDate: new Date(formData.releaseDate).toISOString(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setFormError(translateApiError(data.error, t));
        setSaving(false);
        return;
      }

      setView("list");
      fetchReleases();
    } catch (e) {
      setFormError(t("common.errorOccurred", "An error occurred"));
    } finally {
      setSaving(false);
    }
  };

  const handleImportFile = async (
    e: React.ChangeEvent<HTMLInputElement> | File,
    forceFormat?: "zip" | "xlsx" | "csv" | "xml",
  ) => {
    const file = e instanceof File ? e : e.target.files?.[0];
    if (!file) return;

    // Auto-detect format from file extension
    const fileName = file.name.toLowerCase();
    let format: "xlsx" | "csv" | "xml" | "zip";

    if (fileName.endsWith(".zip")) {
      format = "zip";
    } else if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
      format = "xlsx";
    } else if (fileName.endsWith(".csv")) {
      format = "csv";
    } else if (fileName.endsWith(".xml")) {
      format = "xml";
    } else {
      setDdexProgress({
        show: true,
        mode: "import",
        phase: "error",
        title: t("ddex.invalidFile", "Invalid File"),
        progress: 0,
        currentItem: "",
        items: [],
        summary: "",
        errors: [
          t("ddex.invalidFileFormat", "Please upload a valid DDEX file (.zip, .xlsx, .xls, .csv, or .xml)"),
        ],
      });
      return;
    }

    // Phase 1: Validate DDEX compliance
    setDdexProgress({
      show: true,
      mode: "validate",
      phase: "validating",
      title: `Validating ${file.name}`,
      progress: 10,
      currentItem: "Checking DDEX compliance...",
      items: [{ name: "DDEX Validation", status: "processing" }],
      summary: "",
      errors: [],
    });

    const validateFormData = new FormData();
    validateFormData.append("file", file);
    validateFormData.append("format", format);
    validateFormData.append("validateOnly", "true");

    try {
      const vRes = await fetch("/api/releases/import", {
        method: "POST",
        body: validateFormData,
      });
      const vData = await vRes.json();

      if (!vRes.ok) {
        setDdexProgress((prev) => ({
          ...prev,
          phase: "error",
          progress: 100,
          currentItem: "",
          items: [
            { name: "DDEX Validation", status: "error", error: vData.error },
          ],
          errors: vData.validation?.errors || [
            vData.error || "Validation failed",
          ],
          validation: vData.validation,
        }));
        return;
      }

      const validation = vData.validation;
      if (!validation?.isDdexCompliant) {
        setDdexProgress((prev) => ({
          ...prev,
          phase: "error",
          progress: 100,
          currentItem: "",
          items: [
            {
              name: "DDEX Validation",
              status: "error",
              error: "ERROR_NOT_DDEX_COMPLIANT",
            },
          ],
          errors: validation?.errors || ["File is not DDEX-compliant"],
          validation,
        }));
        return;
      }

      // Validation passed — show results and confirm
      setDdexProgress((prev) => ({
        ...prev,
        phase: "validating",
        progress: 30,
        currentItem: "Validation passed — checking files...",
        items: [{ name: "DDEX Validation", status: "done" }],
        validation,
        zipInfo: vData.zipInfo,
      }));

      // Phase 2: Dry run — check for missing files
      setImporting(true);
      const dryFormData = new FormData();
      dryFormData.append("file", file);
      dryFormData.append("format", format);
      dryFormData.append("dryRun", "true");

      const dRes = await fetch("/api/releases/import", {
        method: "POST",
        body: dryFormData,
      });
      const dData = await dRes.json();

      if (!dRes.ok) {
        setDdexProgress((prev) => ({
          ...prev,
          phase: "error",
          progress: 100,
          currentItem: "",
          items: [
            { name: "DDEX Validation", status: "done" },
            { name: "File Check", status: "error", error: dData.error },
          ],
          errors: [dData.error || "Dry run failed"],
        }));
        setImporting(false);
        return;
      }

      if (dData.missingFiles && dData.missingFiles.length > 0) {
        setMissingFiles(dData.missingFiles);
        setPendingImportFile(file);
        setDdexProgress((prev) => ({ ...prev, show: false }));
        setImporting(false);
        return;
      }

      // Phase 3: Show summary and wait for confirmation
      const summary = dData.summary;
      const releaseItems: typeof ddexProgress.items = [
        { name: "DDEX Validation", status: "done" },
        { name: "File Check", status: "done" },
      ];

      // Build items for each release (we'll track them during import)
      // We don't know release names from dry run, so we'll build the list
      const warnings = dData.warnings || [];

      setDdexProgress((prev) => ({
        ...prev,
        phase: "done",
        progress: 50,
        title: `Ready to Import: ${file.name}`,
        currentItem: "",
        items: releaseItems,
        summary:
          `${summary?.releases || 0} release(s), ${summary?.tracks || 0} track(s)` +
          (summary?.zipAudioExtracted > 0
            ? `, ${summary.zipAudioExtracted} audio files from ZIP`
            : "") +
          (warnings.length > 0 ? `\n ${warnings.length} warning(s)` : ""),
        errors: warnings,
      }));

      // Store the file for actual import — user clicks "Proceed" button in modal
      setPendingImportFile(file);
    } catch (e) {
      console.error(e);
      setDdexProgress((prev) => ({
        ...prev,
        phase: "error",
        progress: 100,
        currentItem: "",
        errors: [
          "Connection error: " +
            (e instanceof Error ? e.message : "Unknown error"),
        ],
      }));
      setImporting(false);
    } finally {
      if (sheetInputRef.current) sheetInputRef.current.value = "";
      if (zipInputRef.current) zipInputRef.current.value = "";
    }
  };

  const handleDdexProceedImport = async () => {
    if (!pendingImportFile) return;
    await performImport(pendingImportFile);
    setPendingImportFile(null);
  };

  const performImport = async (file: File) => {
    // Auto-detect format from file extension
    const fileName = file.name.toLowerCase();
    let format: "xlsx" | "csv" | "xml" | "zip";

    if (fileName.endsWith(".zip")) {
      format = "zip";
    } else if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
      format = "xlsx";
    } else if (fileName.endsWith(".csv")) {
      format = "csv";
    } else if (fileName.endsWith(".xml")) {
      format = "xml";
    } else {
      setDdexProgress((prev) => ({
        ...prev,
        phase: "error",
        errors: [t("ddex.invalidFormat", "Invalid file format")],
      }));
      setImporting(false);
      return;
    }

    setImporting(true);
    setDdexProgress((prev) => ({
      ...prev,
      show: true,
      mode: "import",
      phase: "importing",
      title: `Importing ${file.name}`,
      progress: 0,
      currentItem: "Uploading and processing...",
      items: [{ name: "Upload file", status: "processing" }],
      summary: "",
      errors: [],
    }));

    const formData = new FormData();
    formData.append("file", file);
    formData.append("format", format);
    formData.append("dryRun", "false");

    try {
      // Use XMLHttpRequest for upload progress tracking
      const data: any = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/releases/import");

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const uploadPct = Math.round((e.loaded / e.total) * 40); // 0-40% for upload
            setDdexProgress((prev) => ({
              ...prev,
              progress: uploadPct,
              currentItem: `Uploading... ${Math.round((e.loaded / e.total) * 100)}%`,
            }));
          }
        };

        xhr.onload = () => {
          setDdexProgress((prev) => ({
            ...prev,
            progress: 50,
            currentItem: "Processing releases...",
            items: [
              { name: "Upload file", status: "done" },
              { name: "Processing", status: "processing" },
            ],
          }));
          try {
            const result = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve(result);
            } else {
              reject(new Error(result.error || "Import failed"));
            }
          } catch {
            reject(new Error("Failed to parse response"));
          }
        };

        xhr.onerror = () => reject(new Error("Network error"));
        xhr.send(formData);
      });

      const r = data.results || {};

      // Build per-item results
      const resultItems: typeof ddexProgress.items = [
        { name: "Upload file", status: "done" },
      ];

      if (r.releases?.created > 0)
        resultItems.push({
          name: `${r.releases.created} release(s) created`,
          status: "done",
        });
      if (r.tracks?.created > 0)
        resultItems.push({
          name: `${r.tracks.created} track(s) created`,
          status: "done",
        });
      if (r.assets?.created > 0)
        resultItems.push({
          name: `${r.assets.created} asset(s) created`,
          status: "done",
        });
      if (r.assets?.linked > 0)
        resultItems.push({
          name: `${r.assets.linked} asset(s) linked`,
          status: "done",
        });
      if (r.compositions?.created > 0)
        resultItems.push({
          name: `${r.compositions.created} composition(s) created`,
          status: "done",
        });
      if (r.artists?.created > 0)
        resultItems.push({
          name: `${r.artists.created} new artist(s)`,
          status: "done",
        });
      if (r.labels?.created > 0)
        resultItems.push({
          name: `${r.labels.created} new label(s)`,
          status: "done",
        });
      if (r.releases?.failed > 0)
        resultItems.push({
          name: `${r.releases.failed} release(s) failed`,
          status: "error",
        });
      if (r.tracks?.failed > 0)
        resultItems.push({
          name: `${r.tracks.failed} track(s) failed`,
          status: "error",
        });

      const hasErrors =
        (r.releases?.failed || 0) > 0 || (r.tracks?.failed || 0) > 0;

      setDdexProgress((prev) => ({
        ...prev,
        phase: "done",
        progress: 100,
        title: hasErrors ? "Import Completed with Errors" : "Import Complete",
        currentItem: "",
        items: resultItems,
        summary: data.message || "",
        errors: r.errors || [],
      }));

      fetchReleases();
      setMissingFiles([]);
      setPendingImportFile(null);
    } catch (e) {
      console.error(e);
      setDdexProgress((prev) => ({
        ...prev,
        phase: "error",
        progress: 100,
        currentItem: "",
        items: [
          {
            name: "Import",
            status: "error",
            error: e instanceof Error ? e.message : "Unknown error",
          },
        ],
        errors: [e instanceof Error ? e.message : "Import failed"],
      }));
    } finally {
      setImporting(false);
    }
  };

  const handleUploadMissingFile = async (missingFile: {
    type: "audio" | "artwork";
    filename: string;
  }) => {
    if (!currentFile) return;

    setUploadingMissingFiles(true);
    const formData = new FormData();
    formData.append("file", currentFile);

    try {
      const endpoint =
        missingFile.type === "audio" ? "/upload/audio" : "/upload/covers";
      const res = await fetch(`${UPLOAD_SERVER}${endpoint}`, {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        // Remove this file from missing list
        setMissingFiles((prev) =>
          prev.filter((f) => f.filename !== missingFile.filename),
        );
        setCurrentFile(null);

        // If no more missing files, proceed with import
        if (missingFiles.length === 1 && pendingImportFile) {
          await performImport(pendingImportFile);
        }
      } else {
        const data = await res.json();
        alert(t("settings.uploadFailed") + ": " + translateApiError(data.error, t));
      }
    } catch (e) {
      console.error(e);
      alert(
        "Upload failed: " + (e instanceof Error ? e.message : "Unknown error"),
      );
    } finally {
      setUploadingMissingFiles(false);
    }
  };

  // ============ RELEASE FORM VALIDATION ============
  const validateReleaseStep = (
    step: number,
    data: typeof formData,
  ): string[] => {
    const errors: string[] = [];

    const isValidEAN13 = (ean: string) => {
      if (!/^\d{12,13}$/.test(ean)) return false;
      const paddedEan = ean.padStart(13, "0");
      const digits = paddedEan.split("").map(Number);
      const sum =
        digits[0] +
        digits[2] +
        digits[4] +
        digits[6] +
        digits[8] +
        digits[10] +
        (digits[1] +
          digits[3] +
          digits[5] +
          digits[7] +
          digits[9] +
          digits[11]) *
          3;
      const checkDigit = (10 - (sum % 10)) % 10;
      return digits[12] === checkDigit;
    };

    if (step === 1) {
      if (!data.title.trim()) errors.push("• Product Name is required");
      if (!data.coverUrl)
        errors.push(
          "- Cover artwork is required — distributors and stores will reject releases without artwork",
        );
      if (data.primaryArtists.length === 0)
        errors.push("• At least one Primary Artist is required");
      if (!data.upc && !data.upcAutoGenerate)
        errors.push(
          "• UPC/EAN is required — check 'I don't have UPC' if you don't have one",
        );
      if (data.upc && !isValidEAN13(data.upc))
        errors.push("• UPC/EAN must be a valid 12 or 13 digit GS1 code (Check Digit mismatch)");

      if (data.releaseType === "VIDEO") {
        const bannedTerms = /explicit version|clean version|lyric video/i;
        if (bannedTerms.test(data.title)) errors.push("• VEVO Policy: 'Explicit Version', 'Clean Version', or 'Lyric Video' cannot be in the title");
        if (data.subtitle && bannedTerms.test(data.subtitle)) errors.push("• VEVO Policy: Banned terms in subtitle");
      }
    }

    if (step === 2) {
      if (!data.genre) errors.push("• Genre is required");
      if (!data.labelId) errors.push("• Imprint / Label is required");
      if (!data.cLine.trim())
        errors.push(
          "• © Line (Copyright) is required — e.g. '2026 Label Name'",
        );
      if (!data.pLine.trim())
        errors.push(
          "• ℗ Line (Phonogram) is required — e.g. '2026 Label Name'",
        );
    }

    if (step === 3) {
      if (data.tracks.length === 0) {
        errors.push("• At least one track is required");
      } else {
        data.tracks.forEach((track, i) => {
          const num = i + 1;
          if (!track.title.trim())
            errors.push(`• Track ${num}: Title is required`);
          if (!track.audioAssetId)
            errors.push(
              `• Track ${num}: ${data.releaseType === "VIDEO" ? "Video" : "Audio"} file is required — upload or select from library`,
            );
          // Only require Primary Artist and ISRC for Track 1
          if (i === 0) {
            if (track.primaryArtists.length === 0)
              errors.push(
                `• Track ${num}: At least one Primary Artist is required`,
              );
            if (!track.isrc && !track.isrcAutoGenerate)
              errors.push(
                `• Track ${num}: ISRC is required — check 'I don't have ISRC' if you don't have one`,
              );
            if (
              track.isrc &&
              !/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(track.isrc.toUpperCase())
            )
              errors.push(
                `• Track ${num}: ISRC format invalid (e.g. USRC12345678)`,
              );
          }

            // Video Constraints for VEVO
            if (data.releaseType === "VIDEO") {
              const bannedTerms = /explicit version|clean version|lyric video/i;
              if (bannedTerms.test(track.title)) errors.push(`• Track ${num}: VEVO Policy prohibits 'Explicit Version', 'Clean Version', or 'Lyric Video' in track titles`);
              if (!track.vevoEndCredits) errors.push(`• Track ${num}: Must confirm VEVO end credits policy`);
              if (!track.vevoNoLetterboxing) errors.push(`• Track ${num}: Must confirm VEVO letterboxing policy`);
            }
          });
        }
      // Format-specific validation
      if (data.format === "SINGLE" && data.tracks.length > 3) {
        errors.push("• Single format should have no more than 3 tracks");
      }
      if (data.format === "EP" && data.tracks.length > 6) {
        errors.push("• EP format should have no more than 6 tracks");
      }
    }

    if (step === 4) {
      if (!data.releaseDate) errors.push("• Release Date is required");
      if (!data.salesDate) errors.push("• Sales Start Date is required");
      if (
        data.releaseDate &&
        data.salesDate &&
        new Date(data.salesDate) > new Date(data.releaseDate)
      ) {
        errors.push("• Sales Start Date cannot be after Release Date");
      }
      if (data.preOrderType === "SPECIFIC_DATE" && !data.preOrderDate) {
        errors.push(
          "• Pre-order date is required when pre-order type is set to specific date",
        );
      }
      if (data.territories.length === 0) {
        errors.push(
          "• At least one territory must be selected for distribution",
        );
      }
    }

    return errors;
  };

  const validateReleaseAll = (
    data: typeof formData,
  ): { errors: string[]; failedStep: number } => {
    for (let step = 1; step <= 4; step++) {
      const errors = validateReleaseStep(step, data);
      if (errors.length > 0) return { errors, failedStep: step };
    }
    return { errors: [], failedStep: 0 };
  };

  // Create Form View (Multi-step Wizard)
  if (view === "create") {
    const totalSteps = 4;
    const stepTitles = [
      "Basics & Artwork",
      "Details",
      "Tracks",
      "Scheduling & Pricing",
    ];

    const nextStep = () => {
      // Validate current step before proceeding
      const errors = validateReleaseStep(currentStep, formData);
      if (errors.length > 0) {
        setFormError(errors.join("\n"));
        return;
      }
      setFormError("");
      if (currentStep < totalSteps) setCurrentStep(currentStep + 1);
    };

    const prevStep = () => {
      setFormError("");
      if (currentStep > 1) setCurrentStep(currentStep - 1);
    };

    return (
      <div className="p-6">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={() => setView("list")}
            className="p-2 hover: rounded-lg transition-colors"
          >
            <ArrowBackIcon size={24} />
          </button>
          <div>
            <h2 className="text-xl font-medium">{t("heading.createNewRelease", "Create New Release")}</h2>
            <p className="text-sm text-[var(--text-tertiary)] mt-1">
              Step {currentStep} of {totalSteps}: {stepTitles[currentStep - 1]}
            </p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mb-8 max-w-4xl">
          <div className="flex items-center gap-2">
            {[...Array(totalSteps)].map((_, i) => (
              <div key={i} className="flex-1">
                <div
                  className={`h-2 rounded-full transition-colors ${
                    i + 1 <= currentStep ? "bg-[var(--accent)]" : ""
                  }`}
                />
                <p
                  className={`text-xs mt-1 ${
                    i + 1 === currentStep
                      ? "text-[var(--text-primary)] font-medium"
                      : "text-[var(--text-disabled)]"
                  }`}
                >
                  {stepTitles[i]}
                </p>
              </div>
            ))}
          </div>
        </div>

        {formError && (
          <div className="mb-4 p-3 bg-[var(--status-error-surface)] border border-red-500/30 rounded-lg text-[var(--status-error)] text-sm max-w-4xl whitespace-pre-line">
            {formError}
          </div>
        )}

        <form className="max-w-4xl" onSubmit={handleSubmit}>
          {/* Step 1: Basics & Artwork */}
          {currentStep === 1 && (
            <div className="space-y-6">
              <h3 className="text-lg font-medium mb-4">{t("heading.basicsArtwork", "Basics & Artwork")}</h3>

              {/* Artwork & Top Fields Layout */}
              <div className="flex flex-col md:flex-row gap-6 mb-6">
                {/* Artwork Upload - Left Side */}
                <div className="flex-shrink-0">
                  <ImageUpload
                    currentUrl={formData.coverUrl}
                    onUpload={(url) =>
                      setFormData({ ...formData, coverUrl: url })
                    }
                    type="covers"
                    entityName={formData.title || "Draft Release"}
                    releaseTitle={formData.title || "Draft Release"}
                    labelName={
                      formData.labelId
                        ? labels.find((l: any) => l.id === formData.labelId)
                            ?.name || "Independent"
                        : "Independent"
                    }
                    artistName={
                      formData.primaryArtists?.[0]
                        ? artists.find(
                            (a: any) => a.id === formData.primaryArtists[0],
                          )?.name || "Unknown Artist"
                        : "Unknown Artist"
                    }
                  />

                  <details className="mt-4 group">
                    <summary className="text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer list-none flex items-center gap-2 select-none">
                      <span className="w-4 h-4 flex items-center justify-center transition-transform group-open:rotate-180">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                      </span>
                      Advanced DSP Artwork
                    </summary>
                    <div className="pt-4 space-y-4">
                      <div>
                        <label className="block text-xs text-[var(--text-tertiary)] mb-2">Apple Music Motion</label>
                        <ImageUpload
                          currentUrl={formData.motionUrl}
                          onUpload={(url) => setFormData({ ...formData, motionUrl: url })}
                          type="covers"
                          entityName="Apple Music Motion"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-[var(--text-tertiary)] mb-2">Tidal Focus Artwork</label>
                        <ImageUpload
                          currentUrl={formData.tidalArtworkUrl}
                          onUpload={(url) => setFormData({ ...formData, tidalArtworkUrl: url })}
                          type="covers"
                          entityName="Tidal Artwork"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-[var(--text-tertiary)] mb-2">Amazon Hi-Res Artwork</label>
                        <ImageUpload
                          currentUrl={formData.amazonArtworkUrl}
                          onUpload={(url) => setFormData({ ...formData, amazonArtworkUrl: url })}
                          type="covers"
                          entityName="Amazon Artwork"
                        />
                      </div>
                    </div>
                  </details>
                </div>

                {/* Top Fields - Right Side */}
                <div className="flex-1 grid grid-cols-1 gap-6">
                  {/* Release Type */}
                  {/* Release Type (Disabled/Hidden) */}
                  <div className="hidden">
                    <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                      {t("form.releaseType", "Release Type")}
                    </label>
                    <input
                      type="text"
                      value={formData.releaseType}
                      disabled
                      className="w-full px-4 py-3 bg-[var(--bg-secondary)] border border-[var(--border-input)] rounded-lg text-[var(--text-tertiary)] cursor-not-allowed"
                    />
                  </div>

                  {/* Format (for Audio only, forced to SINGLE for Video) */}
                  {formData.releaseType === "AUDIO" ? (
                    <div>
                      <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                        {t("form.format", "Format *")}
                      </label>
                      <select
                        value={formData.format}
                        onChange={(e) =>
                          setFormData({ ...formData, format: e.target.value })
                        }
                        className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                      >
                        <option value="SINGLE">{t("release.single", "Single")}</option>
                        <option value="EP">{t("release.ep", "EP")}</option>
                        <option value="ALBUM">{t("release.album", "Album")}</option>
                      </select>
                    </div>
                  ) : (
                    <div className="hidden">
                       <input type="hidden" value="SINGLE" />
                    </div>
                  )}

                  {/* Meta Language */}
                  <div>
                    <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                      {t("form.metaLanguage", "Meta Language *")}
                    </label>
                    <select
                      value={formData.metaLanguage}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          metaLanguage: e.target.value,
                        })
                      }
                      className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    >
                      {LANGUAGES.map((lang) => (
                        <option key={lang.code} value={lang.code}>
                          {lang.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Title */}
                <div className="md:col-span-2">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-[var(--text-tertiary)]">
                      {t("form.productName", "Product Name *")}
                    </label>
                  </div>
                  <input
                    type="text"
                    value={formData.title}
                    onChange={(e) =>
                      setFormData({ ...formData, title: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    placeholder={t("form.placeholder.releaseTitle", "Release title")}
                  />
                  <div className="mt-4">
                    <LocalizedInput
                      label={t("releases.localizedNames")}
                      value={formData.titleLocalized || []}
                      onChange={(val) =>
                        setFormData({ ...formData, titleLocalized: val })
                      }
                      placeholder={t("form.placeholder.eGJapaneseKorean", "e.g. Japanese, Korean")}
                    />
                  </div>
                </div>

                {/* Title Version */}
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.titleVersion", "Title Version")}
                  </label>
                  <input
                    type="text"
                    value={formData.titleVersion}
                    onChange={(e) =>
                      setFormData({ ...formData, titleVersion: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    placeholder={t("form.placeholder.eGDeluxeEdition", "e.g., Deluxe Edition")}
                  />
                </div>

                {/* Release Code */}
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.releaseCode", "Release Code")}
                  </label>
                  <input
                    type="text"
                    value={formData.releaseCode}
                    onChange={(e) =>
                      setFormData({ ...formData, releaseCode: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    placeholder={t("form.placeholder.eGReleaseCode", "e.g. Release Code")}
                  />
                </div>

                {/* UPC */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-[var(--text-tertiary)]">
                      {t("form.uPC", "UPC *")}
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.upcAutoGenerate}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            upcAutoGenerate: e.target.checked,
                            upc: e.target.checked ? "" : formData.upc,
                          })
                        }
                        className="w-4 h-4 text-[var(--accent)]"
                      />
                      <span className="text-sm text-[var(--text-tertiary)]">
                        I don't have UPC
                      </span>
                    </label>
                  </div>
                  <input
                    type="text"
                    value={formData.upc}
                    onChange={(e) =>
                      setFormData({ ...formData, upc: e.target.value })
                    }
                    disabled={formData.upcAutoGenerate}
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-50 disabled:cursor-not-allowed"
                    placeholder={t("form.placeholder.eGUPC", "e.g. UPC")}
                  />
                </div>

                {/* Primary Artist(s) */}
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.primaryArtistS", "Primary Artist(s) *")}
                  </label>
                  <div className="space-y-2">
                    {formData.primaryArtists.map((artistId, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <div className="flex-1">
                          <SearchableArtistSelect
                            value={artistId}
                            onChange={(newArtistId) => {
                              const newArtists = [...formData.primaryArtists];
                              newArtists[index] = newArtistId;
                              setFormData({
                                ...formData,
                                primaryArtists: newArtists,
                              });
                            }}
                            artists={artists}
                            onCreateArtist={handleCreateArtist}
                            placeholder={t("form.placeholder.searchOrCreateArtist", "Search or create artist")}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const newArtists = formData.primaryArtists.filter(
                              (_, i) => i !== index,
                            );
                            setFormData({
                              ...formData,
                              primaryArtists: newArtists,
                            });
                          }}
                          className="p-3 bg-[var(--status-error)]/20 hover:bg-[var(--status-error)]/30 rounded-lg text-[var(--status-error)] transition-colors"
                        >
                          <DeleteIcon size={20} />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        setFormData({
                          ...formData,
                          primaryArtists: [...formData.primaryArtists, ""],
                        })
                      }
                      className="flex items-center gap-2 px-4 py-2 bg-[var(--accent)]/20 hover:bg-[var(--accent)]/30 rounded-lg text-[var(--accent-text)] text-sm transition-colors"
                    >
                      <AddIcon size={18} />
                      Add Artist
                    </button>
                  </div>
                </div>

                {/* Featuring Artist(s) */}
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.featuringArtistS", "Featuring Artist(s)")}
                  </label>
                  <div className="space-y-2">
                    {formData.featuringArtists.map((artistId, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <div className="flex-1">
                          <SearchableArtistSelect
                            value={artistId}
                            onChange={(newArtistId) => {
                              const newArtists = [...formData.featuringArtists];
                              newArtists[index] = newArtistId;
                              setFormData({
                                ...formData,
                                featuringArtists: newArtists,
                              });
                            }}
                            artists={artists}
                            onCreateArtist={handleCreateArtist}
                            placeholder={t("form.placeholder.searchOrCreateArtist", "Search or create artist")}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const newArtists = formData.featuringArtists.filter(
                              (_, i) => i !== index,
                            );
                            setFormData({
                              ...formData,
                              featuringArtists: newArtists,
                            });
                          }}
                          className="p-3 bg-[var(--status-error)]/20 hover:bg-[var(--status-error)]/30 rounded-lg text-[var(--status-error)] transition-colors"
                        >
                          <DeleteIcon size={20} />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        setFormData({
                          ...formData,
                          featuringArtists: [...formData.featuringArtists, ""],
                        })
                      }
                      className="flex items-center gap-2 px-4 py-2 bg-[var(--accent)]/20 hover:bg-[var(--accent)]/30 rounded-lg text-[var(--accent-text)] text-sm transition-colors"
                    >
                      <AddIcon size={18} />
                      Add Featuring Artist
                    </button>
                  </div>
                </div>

                {/* Remixer */}
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.remixer", "Remixer")}
                  </label>
                  <input
                    type="text"
                    value={formData.remixer}
                    onChange={(e) =>
                      setFormData({ ...formData, remixer: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    placeholder={t("form.placeholder.remixerName", "Remixer name")}
                  />
                </div>

                {/* Producer */}
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.producer", "Producer")}
                  </label>
                  <input
                    type="text"
                    value={formData.producer}
                    onChange={(e) =>
                      setFormData({ ...formData, producer: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    placeholder={t("form.placeholder.producerName", "Producer name")}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Details */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <h3 className="text-lg font-medium mb-4">{t("heading.releaseDetails", "Release Details")}</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Distributor / Owner */}
                <div>
                  <SearchableEntitySelect
                    value={formData.ownerId}
                    onChange={(entityId) => setFormData({ ...formData, ownerId: entityId })}
                    entities={entities}
                    label={t("form.ownerDistributor", "Distributor / Owner *")}
                    placeholder={t("form.placeholder.selectOwner", "Select Distributor or Label")}
                  />
                  <p className="text-xs text-[var(--text-disabled)] mt-2">
                    Select the organization or sub-account that owns this release.
                  </p>
                </div>

                {/* Genre */}
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.genre", "Genre *")}
                  </label>
                  <select
                    value={formData.genre}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        genre: e.target.value,
                        subGenre: "",
                      })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  >
                    {MUSIC_GENRES.map((g) => (
                      <option key={g.value} value={g.value}>
                        {g.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Sub Genre */}
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.subGenre", "Sub-Genre")}
                  </label>
                  <select
                    value={formData.subGenre}
                    onChange={(e) =>
                      setFormData({ ...formData, subGenre: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={
                      !formData.genre ||
                      !MUSIC_GENRES.find((g) => g.value === formData.genre)
                        ?.subgenres
                    }
                  >
                    {formData.genre &&
                      MUSIC_GENRES.find(
                        (g) => g.value === formData.genre,
                      )?.subgenres?.map((sg) => (
                        <option key={sg} value={sg}>
                          {sg}
                        </option>
                      ))}
                  </select>
                </div>

                {/* Label (Imprint) */}
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.imprintLabel", "Imprint (Label) *")}
                  </label>
                  <SearchableLabelSelect
                    value={formData.labelId}
                    onChange={(labelId) =>
                      setFormData({ ...formData, labelId })
                    }
                    labels={labels}
                    onCreateLabel={handleCreateLabel}
                    placeholder={t("form.placeholder.selectImprint", "Select imprint")}
                  />
                </div>

                {/* Format (if not set in step 1) */}
                {!formData.format && (
                  <div>
                    <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                      {t("form.format", "Format *")}
                    </label>
                    <select
                      value={formData.format}
                      onChange={(e) =>
                        setFormData({ ...formData, format: e.target.value })
                      }
                      className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    >
                      <option value="SINGLE">{t("release.single", "Single")}</option>
                      <option value="EP">{t("release.ep", "EP")}</option>
                      <option value="ALBUM">{t("release.album", "Album")}</option>
                    </select>
                  </div>
                )}

                {/* C-Line */}
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.Line", "© Line *")}
                  </label>
                  <input
                    type="text"
                    value={formData.cLine}
                    onChange={(e) =>
                      setFormData({ ...formData, cLine: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    placeholder={t("form.placeholder.2026TheRebelsADivisionOfBeAlphaDistributedByADEDMusicGroupLLC", "2026 The Rebels, a division of beAlpha / Distributed by ADED Music Group LLC")}
                  />
                </div>

                {/* P-Line */}
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.Line", "℗ Line *")}
                  </label>
                  <input
                    type="text"
                    value={formData.pLine}
                    onChange={(e) =>
                      setFormData({ ...formData, pLine: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    placeholder={t("form.placeholder.2026LabelName", "℗ 2026 Label Name")}
                  />
                </div>

                {/* Contract Period */}
                <div className="md:col-span-2 p-4 border border-[var(--border-primary)] rounded-lg bg-[var(--bg-surface)] space-y-4">
                  <h4 className="text-sm font-medium text-[var(--text-primary)] mb-1">
                    Contract Period
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm text-[var(--text-tertiary)] mb-2">
                        {t("form.begins", "Begins *")}
                      </label>
                      <input
                        type="date"
                        value={formData.contractPeriod?.begins || ""}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            contractPeriod: {
                              ...formData.contractPeriod,
                              begins: e.target.value,
                            },
                          })
                        }
                        className="w-full px-4 py-2 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <label className="block text-sm text-[var(--text-tertiary)]">
                          {t("form.ends", "Ends *")}
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={
                              formData.contractPeriod?.ends === "perpetuity"
                            }
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                contractPeriod: {
                                  ...formData.contractPeriod,
                                  ends: e.target.checked ? "perpetuity" : "",
                                },
                              })
                            }
                            className="w-3.5 h-3.5 text-[var(--accent)]"
                          />
                          <span className="text-xs text-[var(--text-tertiary)]">
                            {t("releases.perpetuity")}
                          </span>
                        </label>
                      </div>
                      <input
                        type="date"
                        value={
                          formData.contractPeriod?.ends === "perpetuity"
                            ? ""
                            : formData.contractPeriod?.ends || ""
                        }
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            contractPeriod: {
                              ...formData.contractPeriod,
                              ends: e.target.value,
                            },
                          })
                        }
                        disabled={
                          formData.contractPeriod?.ends === "perpetuity"
                        }
                        className="w-full px-4 py-2 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Tracks */}
          {currentStep === 3 && (
            <div className="space-y-6">
              <h3 className="text-lg font-medium mb-4">
                {formData.releaseType === "VIDEO" ? "Video Asset & Details" : t("releases.tracks")}
              </h3>

              {/* Track Forms */}
              <div className="space-y-4">
                {formData.tracks.map((track, index) => (
                  <TrackForm
                    key={index}
                    track={track}
                    trackNumber={index + 1}
                    assets={assets}
                    artists={artists}
                    releaseId={selectedRelease?.id}
                    releaseType={formData.releaseType as "AUDIO" | "VIDEO"}
                    labelId={formData.labelId}
                    releaseTitle={formData.title}
                    releaseDate={formData.releaseDate}
                    onUpdate={(updatedTrack) => {
                      const newTracks = [...formData.tracks];
                      newTracks[index] = updatedTrack;
                      setFormData({ ...formData, tracks: newTracks });
                    }}
                    onDelete={() => {
                      const newTracks = formData.tracks.filter(
                        (_, i) => i !== index,
                      );
                      setFormData({ ...formData, tracks: newTracks });
                    }}
                    onCreateArtist={handleCreateArtist}
                    onAssetUploaded={(assetId, filename, duration) => {
                      // Refresh assets list
                      fetchAssets();
                    }}
                  />
                ))}
              </div>

              {/* Add Track Button */}
              <button
                type="button"
                onClick={() =>
                  setFormData({
                    ...formData,
                    tracks: [
                      ...formData.tracks,
                      {
                        audioAssetId: "",
                        snippetStart: "00:00:30",
                        snippetEnd: "00:01:30",
                        title: "",
                        version: "",
                        audioLanguage: "",
                        lyricsLanguage: "",
                        explicitContent: "NONE" as const,
                        lyrics: "",
                        vevoEndCredits: false,
                        vevoNoLetterboxing: false,
                        primaryArtists: [],
                        featuringArtists: [],
                        remixer: "",
                        composer: "",
                        producer: "",
                        iswc: "",
                        splits: [],
                        contributors: {
                          performers: [],
                          studioPersonnel: [],
                          labelPersonnel: [],
                          compositional: [],
                        },
                        cLine: formData.cLine || "",
                        pLine: formData.pLine || "",
                        isrc: "",
                        isrcAutoGenerate: false,
                        ownership: "ORIGINAL_MASTER" as const,
                        countryOfRecording: "",
                        nationalityOfOwner: "",
                      },
                    ],
                  })
                }
                className="flex items-center gap-2 px-4 py-3 bg-[var(--accent)]/20 hover:bg-[var(--accent)]/30 rounded-lg text-[var(--accent-text)] text-sm font-medium transition-colors w-full justify-center"
              >
                <AddIcon size={18} />
                {formData.releaseType === "VIDEO" ? "Add Video Track" : "Add Audio Track"}
              </button>
            </div>
          )}

          {/* Step 4: Scheduling & Pricing */}
          {currentStep === 4 && (
            <div className="space-y-6">
              <h3 className="text-lg font-medium mb-4">{t("heading.schedulingPricing", "Scheduling & Pricing")}</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Release Date & Time */}
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.releaseDate", "Release Date *")}
                  </label>
                  <input
                    type="date"
                    value={formData.releaseDate}
                    onChange={(e) =>
                      setFormData({ ...formData, releaseDate: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  />
                  <p className="text-xs text-[var(--text-disabled)] mt-2">
                    Digital Release Date
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.originalReleaseDate", "Original Release Date")}
                  </label>
                  <input
                    type="date"
                    value={formData.originalReleaseDate}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        originalReleaseDate: e.target.value,
                      })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  />
                  <p className="text-xs text-[var(--text-disabled)] mt-2">
                    If different from Digital Release Date
                  </p>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.releaseNotesPitchingNote", "Release Notes / Pitching Note")}
                  </label>
                  <textarea
                    value={formData.releaseNotes}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        releaseNotes: e.target.value,
                      })
                    }
                    rows={4}
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-none"
                    placeholder={t("form.placeholder.enterSpecialInstructionsAlbumLinerNotesOrSpotifyPitchDescriptionsHere", "Enter special instructions, album liner notes, or Spotify pitch descriptions here...")}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.releaseTime", "Release Time")}
                  </label>
                  <input
                    type="time"
                    value={formData.releaseTime}
                    onChange={(e) =>
                      setFormData({ ...formData, releaseTime: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  />
                </div>

                {/* Sales Date & Time */}
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.salesDate", "Sales Date *")}
                  </label>
                  <input
                    type="date"
                    value={formData.salesDate}
                    onChange={(e) =>
                      setFormData({ ...formData, salesDate: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.salesTime", "Sales Time")}
                  </label>
                  <input
                    type="time"
                    value={formData.salesTime}
                    onChange={(e) =>
                      setFormData({ ...formData, salesTime: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  />
                </div>

                {/* Pre-Order Info */}
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.preOrder", "Pre-Order")}
                  </label>
                  <select
                    value={formData.preOrderType}
                    onChange={(e) =>
                      setFormData({ ...formData, preOrderType: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  >
                    <option value="IMMEDIATE">{t("dashboard.immediate")}</option>
                    <option value="NO_PRE_ORDER">{t("dashboard.noPreOrder")}</option>
                    <option value="SPECIFIC_DATE">{t("dashboard.specificDate")}</option>
                  </select>
                </div>

                {/* Previewable (if pre-order) */}
                {formData.preOrderType !== "NO_PRE_ORDER" && (
                  <div>
                    <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                      {t("form.previewable", "Previewable")}
                    </label>
                    <div className="flex items-center gap-4 mt-3">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          value="YES"
                          checked={formData.previewable === "YES"}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              previewable: e.target.value,
                            })
                          }
                          className="w-4 h-4"
                        />
                        <span className="text-[var(--text-primary)]">{t("common.yes")}</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          value="NO"
                          checked={formData.previewable === "NO"}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              previewable: e.target.value,
                            })
                          }
                          className="w-4 h-4"
                        />
                        <span className="text-[var(--text-primary)]">{t("common.no")}</span>
                      </label>
                    </div>
                  </div>
                )}

                {/* Album Pricing */}
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.albumPricing", "Album Pricing")}
                  </label>
                  <select
                    value={formData.albumPricing}
                    onChange={(e) =>
                      setFormData({ ...formData, albumPricing: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  >
                    {ALBUM_PRICING_TIERS.map((tier) => (
                      <option key={tier} value={tier}>
                        {tier}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Track Pricing */}
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.trackPricing", "Track Pricing")}
                  </label>
                  <select
                    value={formData.trackPricing}
                    onChange={(e) =>
                      setFormData({ ...formData, trackPricing: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  >
                    {TRACK_PRICING_TIERS.map((tier) => (
                      <option key={tier} value={tier}>
                        {tier}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Territory Selection */}
              <div className="mt-6">
                <h4 className="text-sm font-medium text-[var(--text-tertiary)] mb-3">
                  Territory Restrictions
                </h4>
                <p className="text-xs text-[var(--text-disabled)] mb-3">
                  All territories selected by default. Uncheck to restrict.
                </p>
                <div className="max-h-60 overflow-y-auto border border-[var(--border-primary)] rounded-lg p-4 ">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {COUNTRY_CODES.map((country) => (
                      <label
                        key={country.code}
                        className="flex items-center gap-2 cursor-pointer text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={formData.territories.includes(country.code)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setFormData({
                                ...formData,
                                territories: [
                                  ...formData.territories,
                                  country.code,
                                ],
                              });
                            } else {
                              setFormData({
                                ...formData,
                                territories: formData.territories.filter(
                                  (t) => t !== country.code,
                                ),
                              });
                            }
                          }}
                          className="w-4 h-4"
                        />
                        <span className="text-[var(--text-primary)]">
                          {country.flag} {country.name}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {/* Publishing Obligations per Track */}
              {formData.tracks.length > 0 && (
                <div className="mt-6">
                  <h4 className="text-sm font-medium text-[var(--text-tertiary)] mb-3">
                    Publishing Obligations
                  </h4>
                  <div className="space-y-4">
                    {formData.tracks.map((track, index) => (
                      <div
                        key={index}
                        className="p-4 border border-[var(--border-input)] rounded-lg"
                      >
                        <div className="flex items-center gap-3 mb-3">
                          <span className="text-[var(--text-tertiary)] text-sm">
                            Track {index + 1}
                          </span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs text-[var(--text-disabled)] mb-2">
                              {t("form.publishingObligation", "Publishing Obligation")}
                            </label>
                            <select
                              value={track.publishingObligation}
                              onChange={(e) => {
                                const newTracks = [...formData.tracks];
                                newTracks[index] = {
                                  ...track,
                                  publishingObligation: e.target.value,
                                };
                                setFormData({ ...formData, tracks: newTracks });
                              }}
                              className="w-full px-3 py-2 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                            >
                              <option value="NO_PUBLISHING">
                                No Publishing
                              </option>
                              <option value="PARTIAL">
                                Partial Publishing
                              </option>
                              <option value="FULL">{t("dashboard.fullPublishing")}</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-[var(--text-disabled)] mb-2">
                              {t("form.publisher", "Publisher")}
                            </label>
                            <input
                              type="text"
                              value={track.publisher}
                              onChange={(e) => {
                                const newTracks = [...formData.tracks];
                                newTracks[index] = {
                                  ...track,
                                  publisher: e.target.value,
                                };
                                setFormData({ ...formData, tracks: newTracks });
                              }}
                              className="w-full px-3 py-2 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                              placeholder={t("form.placeholder.publisherName", "Publisher name")}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Navigation Buttons */}
          <div className="flex items-center justify-between mt-8 pt-6 border-t border-[var(--border-primary)]">
            <button
              type="button"
              onClick={prevStep}
              disabled={currentStep === 1}
              className="px-6 py-3  hover: rounded-lg text-[var(--text-primary)] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t("common.previous")}
            </button>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setView("list")}
                className="px-6 py-3 border border-[var(--border-primary)] hover: rounded-lg text-[var(--text-primary)] font-medium transition-colors"
              >
                {t("common.cancel")}
              </button>

              {currentStep < totalSteps ? (
                <button
                  type="button"
                  onClick={nextStep}
                  className="px-6 py-3 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg text-white font-medium transition-colors"
                >
                  Next Step
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-3 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg text-white font-medium transition-colors disabled:opacity-50"
                >
                  {saving ? "Creating..." : "Create Release"}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    );
  }

  // Edit Form View (full edit form with all fields)
  if (view === "edit") {
    return (
      <div className="p-6">
        {/* Header with Back button */}
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={() => setView("list")}
            className="p-2 hover: rounded-lg transition-colors"
          >
            <ArrowBackIcon size={24} />
          </button>
          <h2 className="text-xl font-medium">
            Edit: {selectedRelease?.title}
          </h2>
          {selectedRelease?.status && (
            <span
              className={`px-2 py-1 rounded text-xs font-medium ${
                selectedRelease.status === "APPROVED" ||
                selectedRelease.status === "RELEASED"
                  ? "bg-[var(--status-success-surface)] text-[var(--accent-text)]"
                  : selectedRelease.status === "PENDING"
                    ? "bg-[var(--status-warning-surface)] text-[var(--status-warning)]"
                    : selectedRelease.status === "DENIED"
                      ? "bg-[var(--status-error-surface)] text-[var(--status-error)]"
                      : "bg-[var(--bg-elevated)] text-[var(--text-tertiary)]"
              }`}
            >
              {selectedRelease.status}
            </span>
          )}
        </div>

        <form onSubmit={handleSubmit} className="max-w-4xl">
          {formError && (
            <div className="mb-4 p-3 bg-[var(--status-error-surface)] border border-red-500/30 rounded-lg text-[var(--status-error)] text-sm whitespace-pre-line">
              {formError}
            </div>
          )}

          <div className="space-y-8">
            {/* Section: Artwork & Basic Info */}
            <div
              style={{ background: "var(--bg-surface)" }}
              className="/50 border border-[var(--border-primary)] rounded-xl p-6"
            >
              <h3 className="text-lg font-medium mb-4 text-[var(--accent-text)]">
                {t("heading.artworkBasicInfo", "Artwork & Basic Info")}
              </h3>
              <div className="flex flex-col md:flex-row gap-6">
                <div className="flex-shrink-0">
                  <ImageUpload
                    currentUrl={formData.coverUrl}
                    onUpload={(url) =>
                      setFormData({ ...formData, coverUrl: url })
                    }
                    type="covers"
                    entityName={formData.title || "Draft Release"}
                    labelName={
                      labels.find((l: any) => l.id === formData.labelId)
                        ?.name || "Unknown Label"
                    }
                    artistName={
                      artists.find(
                        (a: any) => a.id === formData.primaryArtists[0],
                      )?.name || "Unknown Artist"
                    }
                    releaseTitle={formData.title || "Unknown Release"}
                  />
                </div>
                <div className="flex-1 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                      {t("form.title", "Title *")}
                    </label>
                    <input
                      type="text"
                      value={formData.title}
                      onChange={(e) =>
                        setFormData({ ...formData, title: e.target.value })
                      }
                      className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                      placeholder={t("form.placeholder.releaseTitle", "Release title")}
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                        {t("form.format", "Format *")}
                      </label>
                      <select
                        value={formData.format}
                        onChange={(e) =>
                          setFormData({ ...formData, format: e.target.value })
                        }
                        className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                      >
                        <option value="SINGLE">{t("release.single", "Single")}</option>
                        <option value="EP">{t("release.ep", "EP")}</option>
                        <option value="ALBUM">{t("release.album", "Album")}</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                        {t("form.uPCEAN", "UPC/EAN")}
                      </label>
                      <input
                        type="text"
                        value={formData.upc}
                        onChange={(e) =>
                          setFormData({ ...formData, upc: e.target.value })
                        }
                        className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                        placeholder={t("form.placeholder.autoGeneratedIfEmpty", "Auto-generated if empty")}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                      {t("form.metaLanguage", "Meta Language")}
                    </label>
                    <select
                      value={formData.metaLanguage}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          metaLanguage: e.target.value,
                        })
                      }
                      className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    >
                      {LANGUAGES.map((lang) => (
                        <option key={lang.code} value={lang.code}>
                          {lang.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {/* Section: Artists */}
            <div
              style={{ background: "var(--bg-surface)" }}
              className="/50 border border-[var(--border-primary)] rounded-xl p-6"
            >
              <h3 className="text-lg font-medium mb-4 text-[var(--accent-text)]">
                {t("artists.title")}
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.primaryArtistS", "Primary Artist(s) *")}
                  </label>
                  <div className="space-y-2">
                    {formData.primaryArtists.map((artistId, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <div className="flex-1">
                          <SearchableArtistSelect
                            value={artistId}
                            onChange={(newArtistId) => {
                              const newArtists = [...formData.primaryArtists];
                              newArtists[index] = newArtistId;
                              setFormData({
                                ...formData,
                                primaryArtists: newArtists,
                              });
                            }}
                            artists={artists}
                            onCreateArtist={handleCreateArtist}
                            placeholder={t("form.placeholder.searchOrCreateArtist", "Search or create artist")}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const newArtists = formData.primaryArtists.filter(
                              (_, i) => i !== index,
                            );
                            setFormData({
                              ...formData,
                              primaryArtists: newArtists,
                            });
                          }}
                          className="p-3 bg-[var(--status-error)]/20 hover:bg-[var(--status-error)]/30 rounded-lg text-[var(--status-error)] transition-colors"
                        >
                          <DeleteIcon size={20} />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        setFormData({
                          ...formData,
                          primaryArtists: [...formData.primaryArtists, ""],
                        })
                      }
                      className="flex items-center gap-2 px-4 py-2 bg-[var(--accent)]/20 hover:bg-[var(--accent)]/30 rounded-lg text-[var(--accent-text)] text-sm transition-colors"
                    >
                      <AddIcon size={18} />
                      Add Artist
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.featuringArtists", "Featuring Artists")}
                  </label>
                  <div className="space-y-2">
                    {formData.featuringArtists.map((artistId, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <div className="flex-1">
                          <SearchableArtistSelect
                            value={artistId}
                            onChange={(newArtistId) => {
                              const newArtists = [...formData.featuringArtists];
                              newArtists[index] = newArtistId;
                              setFormData({
                                ...formData,
                                featuringArtists: newArtists,
                              });
                            }}
                            artists={artists}
                            onCreateArtist={handleCreateArtist}
                            placeholder={t("form.placeholder.searchOrCreateArtist", "Search or create artist")}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const newArtists = formData.featuringArtists.filter(
                              (_, i) => i !== index,
                            );
                            setFormData({
                              ...formData,
                              featuringArtists: newArtists,
                            });
                          }}
                          className="p-3 bg-[var(--status-error)]/20 hover:bg-[var(--status-error)]/30 rounded-lg text-[var(--status-error)] transition-colors"
                        >
                          <DeleteIcon size={20} />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        setFormData({
                          ...formData,
                          featuringArtists: [...formData.featuringArtists, ""],
                        })
                      }
                      className="flex items-center gap-2 px-4 py-2 bg-[var(--accent)]/20 hover:bg-[var(--accent)]/30 rounded-lg text-[var(--accent-text)] text-sm transition-colors"
                    >
                      <AddIcon size={18} />
                      Add Featuring Artist
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                      {t("form.remixer", "Remixer")}
                    </label>
                    <input
                      type="text"
                      value={formData.remixer}
                      onChange={(e) =>
                        setFormData({ ...formData, remixer: e.target.value })
                      }
                      className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                      placeholder={t("form.placeholder.remixerName", "Remixer name")}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                      {t("form.producer", "Producer")}
                    </label>
                    <input
                      type="text"
                      value={formData.producer}
                      onChange={(e) =>
                        setFormData({ ...formData, producer: e.target.value })
                      }
                      className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                      placeholder={t("form.placeholder.producerName", "Producer name")}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Section: Details */}
            <div
              style={{ background: "var(--bg-surface)" }}
              className="/50 border border-[var(--border-primary)] rounded-xl p-6"
            >
              <h3 className="text-lg font-medium mb-4 text-[var(--accent-text)]">
                {t("heading.details", "Details")}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.genre", "Genre *")}
                  </label>
                  <select
                    value={formData.genre}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        genre: e.target.value,
                        subGenre: "",
                      })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  >
                    {MUSIC_GENRES.map((g) => (
                      <option key={g.value} value={g.value}>
                        {g.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.subGenre", "Sub-Genre")}
                  </label>
                  <select
                    value={formData.subGenre}
                    onChange={(e) =>
                      setFormData({ ...formData, subGenre: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    disabled={
                      !formData.genre ||
                      !MUSIC_GENRES.find((g) => g.value === formData.genre)
                        ?.subgenres
                    }
                  >
                    {formData.genre &&
                      MUSIC_GENRES.find(
                        (g) => g.value === formData.genre,
                      )?.subgenres?.map((sg) => (
                        <option key={sg} value={sg}>
                          {sg}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.imprintLabel", "Imprint (Label)")}
                  </label>
                  <SearchableLabelSelect
                    value={formData.labelId}
                    onChange={(labelId) =>
                      setFormData({ ...formData, labelId })
                    }
                    labels={labels}
                    onCreateLabel={handleCreateLabel}
                    placeholder={t("form.placeholder.selectImprint", "Select imprint")}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.catalogueNumber", "Catalogue Number")}
                  </label>
                  <input
                    type="text"
                    value={formData.releaseCode}
                    onChange={(e) =>
                      setFormData({ ...formData, releaseCode: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    placeholder={t("form.placeholder.catalogueNumber", "Catalogue number")}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.Line", "© Line")}
                  </label>
                  <input
                    type="text"
                    value={formData.cLine}
                    onChange={(e) =>
                      setFormData({ ...formData, cLine: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    placeholder={t("form.placeholder.2026LabelName", "2026 Label Name")}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.Line", "℗ Line")}
                  </label>
                  <input
                    type="text"
                    value={formData.pLine}
                    onChange={(e) =>
                      setFormData({ ...formData, pLine: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    placeholder={t("form.placeholder.2026LabelName", "℗ 2026 Label Name")}
                  />
                </div>
              </div>
            </div>

            {/* Section: Scheduling */}
            <div
              style={{ background: "var(--bg-surface)" }}
              className="/50 border border-[var(--border-primary)] rounded-xl p-6"
            >
              <h3 className="text-lg font-medium mb-4 text-[var(--accent-text)]">
                {t("heading.schedulingPricing", "Scheduling & Pricing")}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.releaseDate", "Release Date *")}
                  </label>
                  <input
                    type="date"
                    value={formData.releaseDate}
                    onChange={(e) =>
                      setFormData({ ...formData, releaseDate: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.originalReleaseDate", "Original Release Date")}
                  </label>
                  <input
                    type="date"
                    value={formData.originalReleaseDate}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        originalReleaseDate: e.target.value,
                      })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.releaseNotesPitchingNote", "Release Notes / Pitching Note")}
                  </label>
                  <textarea
                    value={formData.releaseNotes}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        releaseNotes: e.target.value,
                      })
                    }
                    rows={4}
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-none"
                    placeholder={t("form.placeholder.enterSpecialInstructionsAlbumLinerNotesOrSpotifyPitchDescriptionsHere", "Enter special instructions, album liner notes, or Spotify pitch descriptions here...")}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.releaseTime", "Release Time")}
                  </label>
                  <input
                    type="time"
                    value={formData.releaseTime}
                    onChange={(e) =>
                      setFormData({ ...formData, releaseTime: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.salesDate", "Sales Date")}
                  </label>
                  <input
                    type="date"
                    value={formData.salesDate}
                    onChange={(e) =>
                      setFormData({ ...formData, salesDate: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.albumPricing", "Album Pricing")}
                  </label>
                  <select
                    value={formData.albumPricing}
                    onChange={(e) =>
                      setFormData({ ...formData, albumPricing: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  >
                    {ALBUM_PRICING_TIERS.map((tier) => (
                      <option key={tier} value={tier}>
                        {tier}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.trackPricing", "Track Pricing")}
                  </label>
                  <select
                    value={formData.trackPricing}
                    onChange={(e) =>
                      setFormData({ ...formData, trackPricing: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  >
                    {TRACK_PRICING_TIERS.map((tier) => (
                      <option key={tier} value={tier}>
                        {tier}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Submit buttons */}
          <div className="flex items-center gap-3 mt-8 pt-6 border-t border-[var(--border-primary)]">
            <button
              type="button"
              onClick={() => setView("list")}
              className="px-6 py-3  hover: rounded-lg text-[var(--text-primary)] font-medium transition-colors"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-3 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg text-white font-medium transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    );
  }

  // List View
  return (
    <div className="p-6">
      {/* Missing Files Upload Modal */}
      <Modal
        isOpen={missingFiles.length > 0}
        onClose={() => {
          setMissingFiles([]);
          setPendingImportFile(null);
          setCurrentFile(null);
        }}
        title={t("upload.uploadMissingFiles")}
      >
        <div className="space-y-4">
          <p className="text-sm text-[var(--text-tertiary)]">
            The following files are referenced in your Excel but not found on
            the server. Please upload them to continue.
          </p>

          <div className="max-h-96 overflow-y-auto space-y-3">
            {missingFiles.map((file, index) => (
              <div
                key={index}
                className={`p-4 rounded-lg border transition-all ${dragState === `missing-file-${index}` ? "border-green-500 ring-2 ring-green-500/20" : "border-[var(--border-primary)]"}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragState(`missing-file-${index}`);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  setDragState(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragState(null);
                  const f = e.dataTransfer.files?.[0];
                  if (f) setCurrentFile(f);
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      {file.type === "audio" ? (
                        <AudioFileIcon size={18} color="#a855f7" />
                      ) : (
                        <PhotoCameraIcon size={18} color="#3b82f6" />
                      )}
                      <span className="text-sm font-medium text-[var(--text-primary)]">
                        {file.filename}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-disabled)]">
                      Release: {file.releaseTitle}
                    </p>
                    <p className="text-xs text-[var(--text-disabled)] mt-1">
                      Type: {file.type === "audio" ? "Audio File" : "Artwork"}
                    </p>
                  </div>

                  <div className="flex flex-col gap-2">
                    <input
                      type="file"
                      accept={file.type === "audio" ? "audio/*" : "image/*"}
                      onChange={(e) =>
                        setCurrentFile(e.target.files?.[0] || null)
                      }
                      className="text-xs"
                    />
                    <button
                      onClick={() => handleUploadMissingFile(file)}
                      disabled={!currentFile || uploadingMissingFiles}
                      className="px-3 py-1 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded text-xs font-medium transition-colors disabled:opacity-50 text-white"
                    >
                      {uploadingMissingFiles ? "Uploading..." : "Upload"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-[var(--border-input)]">
            <p className="text-sm text-[var(--text-tertiary)]">
              {missingFiles.length} file(s) remaining
            </p>
            <button
              onClick={() => {
                setMissingFiles([]);
                setPendingImportFile(null);
                setCurrentFile(null);
              }}
              className="px-4 py-2  hover: rounded-lg text-sm font-medium transition-colors"
            >
              {t("upload.cancelImport")}
            </button>
          </div>
        </div>
      </Modal>

      {/* ══════ DDEX Progress Modal ══════ */}
      <Modal
        isOpen={ddexProgress.show}
        onClose={() => {
          if (ddexProgress.phase === "done" || ddexProgress.phase === "error") {
            setDdexProgress((prev) => ({ ...prev, show: false }));
          }
        }}
        title={ddexProgress.title}
      >
        <div>
          {/* Progress Bar */}
          <div className="mb-4">
            <div className="h-2  rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  ddexProgress.phase === "error"
                    ? "bg-[var(--status-error)]"
                    : ddexProgress.phase === "done"
                      ? "bg-[#1DB954]"
                      : "bg-[#1DB954]"
                }`}
                style={{ width: `${ddexProgress.progress}%` }}
              />
            </div>
            {ddexProgress.currentItem && (
              <p className="text-xs text-[var(--text-tertiary)] mt-1.5">
                {ddexProgress.currentItem}
              </p>
            )}
          </div>

          {/* Validation Info */}
          {ddexProgress.validation && (
            <div
              className={`mb-4 p-3 rounded-lg border ${
                ddexProgress.validation.isDdexCompliant
                  ? "bg-green-900/20 border-green-800/50"
                  : "bg-red-900/20 border-red-800/50"
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={`text-sm font-medium ${ddexProgress.validation.isDdexCompliant ? "text-[var(--accent-text)]" : "text-[var(--status-error)]"}`}
                >
                  {ddexProgress.validation.isDdexCompliant ? (
                    <>
                      <CheckCircleIcon
                        size={16}
                        className="text-[var(--accent)] inline-block mr-1"
                      />{" "}
                      DDEX Compliant
                    </>
                  ) : (
                    <>
                      <CancelIcon
                        size={16}
                        className="text-[var(--status-error)] inline-block mr-1"
                      />{" "}
                      Not DDEX Compliant
                    </>
                  )}
                </span>
              </div>
              <div className="text-xs text-[var(--text-tertiary)] space-y-0.5">
                <div>
                  <BarChartIcon
                    size={16}
                    className="inline-block mr-1 text-[var(--text-tertiary)]"
                  />{" "}
                  {ddexProgress.validation.totalRows} row(s),{" "}
                  {ddexProgress.validation.totalColumns} column(s)
                </div>
                <div>
                  <TagIcon
                    size={16}
                    className="inline-block mr-1 text-[var(--status-info)]"
                  />{" "}
                  {ddexProgress.validation.presentDdexColumns} DDEX column(s)
                  recognized
                </div>
                {ddexProgress.validation.missingRequired.length > 0 && (
                  <div className="text-[var(--status-error)]">
                    <WarningIcon size={16} className="inline-block mr-1" />{" "}
                    Missing required:{" "}
                    {ddexProgress.validation.missingRequired.join(", ")}
                  </div>
                )}
                {ddexProgress.validation.missingRecommended.length > 0 && (
                  <div className="text-yellow-400">
                    <LightbulbIcon size={16} className="inline-block mr-1" />{" "}
                    Missing recommended:{" "}
                    {ddexProgress.validation.missingRecommended.join(", ")}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ZIP Info */}
          {ddexProgress.zipInfo && (
            <div className="mb-4 p-3 bg-cyan-900/20 border border-cyan-800/50 rounded-lg">
              <div className="text-xs text-[var(--text-tertiary)] space-y-0.5">
                <div>
                  <BoxArchiveIcon size={16} className="inline-block mr-1" /> ZIP
                  Package Contents:
                </div>
                <div className="ml-3">
                  <MusicNoteIcon
                    size={16}
                    className="inline-block mr-1 text-[var(--color-deezer)]"
                  />{" "}
                  {ddexProgress.zipInfo.audioFiles} audio file(s)
                </div>
                <div className="ml-3">
                  <ImageIcon
                    size={16}
                    className="inline-block mr-1 text-[var(--accent-text)]"
                  />{" "}
                  {ddexProgress.zipInfo.artworkFiles} artwork file(s)
                </div>
              </div>
            </div>
          )}

          {/* Item List */}
          {ddexProgress.items.length > 0 && (
            <div className="mb-4 space-y-1.5 max-h-48 overflow-y-auto">
              {ddexProgress.items.map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  {item.status === "done" ? (
                    <CheckIcon
                      size={12}
                      className="text-[var(--accent-text)]"
                    />
                  ) : item.status === "error" ? (
                    <XMarkIcon
                      size={12}
                      className="text-[var(--status-error)]"
                    />
                  ) : item.status === "processing" ? (
                    <RefreshIcon
                      size={12}
                      className="text-[var(--color-deezer)] animate-spin"
                    />
                  ) : (
                    <CircleIcon
                      size={12}
                      className="text-[var(--text-disabled)]"
                    />
                  )}
                  <span
                    className={`${
                      item.status === "error"
                        ? "text-[var(--status-error)]"
                        : item.status === "done"
                          ? "text-[var(--text-secondary)]"
                          : item.status === "processing"
                            ? "text-[var(--text-primary)]"
                            : "text-[var(--text-disabled)]"
                    }`}
                  >
                    {item.name}
                  </span>
                  {item.error && (
                    <span className="text-[var(--status-error)]/70 text-xs ml-auto truncate max-w-[200px]">
                      {item.error}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Summary */}
          {ddexProgress.summary && (
            <div className="mb-4 p-3  rounded-lg">
              <p className="text-sm text-[var(--text-secondary)] whitespace-pre-line">
                {ddexProgress.summary}
              </p>
            </div>
          )}

          {/* Errors */}
          {ddexProgress.errors.length > 0 && (
            <div className="mb-4 max-h-32 overflow-y-auto">
              <div className="text-xs font-medium text-[var(--status-error)] mb-1">
                {ddexProgress.phase === "error" ? "Errors:" : "Warnings:"}
              </div>
              {ddexProgress.errors.map((err, i) => (
                <div
                  key={i}
                  className="text-xs text-[var(--status-error)]/80 py-0.5 flex items-start gap-1"
                >
                  <span className="mt-0.5">•</span>
                  <span>{err}</span>
                </div>
              ))}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center gap-3 justify-end pt-3 border-t border-[var(--border-primary)]">
            {ddexProgress.phase === "done" &&
              ddexProgress.mode === "validate" &&
              pendingImportFile && (
                <>
                  <button
                    onClick={() => {
                      setDdexProgress((prev) => ({ ...prev, show: false }));
                      setPendingImportFile(null);
                    }}
                    className="px-4 py-2  hover: rounded-lg text-sm font-medium transition-colors"
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    onClick={handleDdexProceedImport}
                    className="px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg text-sm font-medium transition-colors flex items-center gap-2 text-white"
                  >
                    <FileUploadIcon size={16} />
                    Proceed with Import
                  </button>
                </>
              )}
            {ddexProgress.phase === "done" &&
              ddexProgress.mode !== "validate" && (
                <button
                  onClick={() =>
                    setDdexProgress((prev) => ({ ...prev, show: false }))
                  }
                  className="px-4 py-2  hover: rounded-lg text-sm font-medium transition-colors"
                >
                  Close
                </button>
              )}
            {ddexProgress.phase === "error" && (
              <button
                onClick={() =>
                  setDdexProgress((prev) => ({ ...prev, show: false }))
                }
                className="px-4 py-2  hover: rounded-lg text-sm font-medium transition-colors"
              >
                Close
              </button>
            )}
          </div>
        </div>
      </Modal>

      {/* Hidden file inputs */}
      <input
        ref={sheetInputRef}
        type="file"
        accept=".xlsx,.xls,.csv,.xml"
        onChange={handleImportFile}
        className="hidden"
      />
      <input
        ref={zipInputRef}
        type="file"
        accept=".zip"
        onChange={handleImportFile}
        className="hidden"
      />

      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-medium">{t("releases.title")}</h2>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowDdexPanel((prev) => !prev)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-medium transition-colors ${showDdexPanel ? "bg-[#1DB954] ring-2 ring-[#1ed760]" : "bg-[#1DB954] hover:brightness-110"}`}
          >
            <SwapHorizIcon size={18} />
            {t("releases.ddex")}
          </button>

          {canCreate && (
            <button
              onClick={openCreateForm}
              className="flex items-center gap-2 px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-lg text-sm font-medium transition-colors"
            >
              <AddIcon size={18} />
              {t("releases.newRelease")}
            </button>
          )}
        </div>
      </div>

      {/* DDEX Import / Export Panel */}
      {showDdexPanel && (
        <div className="mb-6 p-5 bg-[var(--bg-surface)] border border-[var(--border-primary)] shadow-sm rounded-xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <SwapHorizIcon size={18} color="#1DB954" />
              DDEX Import / Export
            </h3>
            <button
              onClick={() => setShowDdexPanel(false)}
              className="text-[var(--text-disabled)] hover:text-[var(--text-secondary)] transition-colors"
            >
              <CloseIcon size={16} />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* ── Import Section ── */}
            <div className="p-4 bg-[var(--bg-background)] rounded-lg border border-[var(--border-primary)]">
              <h4 className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <FileUploadIcon size={14} />
                {t("common.import")}
              </h4>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => sheetInputRef.current?.click()}
                  disabled={importing}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragState("ddex-sheet");
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    setDragState(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragState(null);
                    const f = e.dataTransfer.files?.[0];
                    if (f) handleImportFile(f);
                  }}
                  className={`flex items-center gap-3 w-full px-4 py-3 hover:bg-[var(--bg-surface-hover)] border rounded-lg text-sm transition-all disabled:opacity-50 group ${dragState === "ddex-sheet" ? "bg-[var(--bg-surface-hover)] border-green-500" : "bg-[var(--bg-surface)] border-[var(--border-primary)]"}`}
                >
                  <div className="w-8 h-8 rounded-lg bg-[var(--status-info)]/20 flex items-center justify-center group-hover:bg-[var(--status-info)]/30 transition-colors text-white">
                    <TableChartIcon size={16} color="#60a5fa" />
                  </div>
                  <div className="text-left flex-1">
                    <div className="font-medium text-[var(--text-primary)] text-sm">
                      {importing ? "Importing..." : "From Spreadsheet"}
                    </div>
                    <div className="text-[11px] text-[var(--text-disabled)]">
                      .xlsx, .xls, .csv, .xml
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => zipInputRef.current?.click()}
                  disabled={importing}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragState("ddex-zip");
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    setDragState(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragState(null);
                    const f = e.dataTransfer.files?.[0];
                    if (f) handleImportFile(f, "zip");
                  }}
                  className={`flex items-center gap-3 w-full px-4 py-3 hover:bg-[var(--bg-surface-hover)] border rounded-lg text-sm transition-all disabled:opacity-50 group ${dragState === "ddex-zip" ? "bg-[var(--bg-surface-hover)] border-green-500" : "bg-[var(--bg-surface)] border-[var(--border-primary)]"}`}
                >
                  <div className="w-8 h-8 rounded-lg bg-cyan-600/20 flex items-center justify-center group-hover:bg-cyan-600/30 transition-colors">
                    <FolderZipIcon size={16} color="#22d3ee" />
                  </div>
                  <div className="text-left flex-1">
                    <div className="font-medium text-[var(--text-primary)] text-sm">
                      {importing ? "Importing..." : "From ZIP Package"}
                    </div>
                    <div className="text-[11px] text-[var(--text-disabled)]">
                      {t("releases.spreadsheetAudioArtwork")}
                    </div>
                  </div>
                </button>
              </div>
            </div>

            {/* ── Export Section ── */}
            <div className="p-4 bg-[var(--bg-background)] rounded-lg border border-[var(--border-primary)]">
              <h4 className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <DownloadIcon size={14} />
                {t("common.export")}
              </h4>
              <div className="flex flex-col gap-2">
                <button
                  onClick={async () => {
                    setExporting("xlsx");
                    setDdexProgress({
                      show: true,
                      mode: "export",
                      phase: "exporting",
                      title: "Exporting DDEX Spreadsheet",
                      progress: 20,
                      currentItem: "Generating XLSX...",
                      items: [
                        { name: "Generate spreadsheet", status: "processing" },
                      ],
                      summary: "",
                      errors: [],
                    });
                    try {
                      const res = await fetch(
                        `/api/releases/export?format=xlsx`,
                      );
                      if (res.ok) {
                        setDdexProgress((prev) => ({
                          ...prev,
                          progress: 80,
                          currentItem: "Downloading...",
                          items: [
                            { name: "Generate spreadsheet", status: "done" },
                            { name: "Download", status: "processing" },
                          ],
                        }));
                        const blob = await res.blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `beAlpha_DDEX_${new Date().toISOString().split("T")[0]}.xlsx`;
                        document.body.appendChild(a);
                        a.click();
                        window.URL.revokeObjectURL(url);
                        document.body.removeChild(a);
                        setDdexProgress((prev) => ({
                          ...prev,
                          phase: "done",
                          progress: 100,
                          currentItem: "",
                          title: "Export Complete",
                          items: [
                            { name: "Generate spreadsheet", status: "done" },
                            { name: "Download", status: "done" },
                          ],
                          summary: "DDEX spreadsheet exported successfully.",
                        }));
                      } else {
                        setDdexProgress((prev) => ({
                          ...prev,
                          phase: "error",
                          progress: 100,
                          currentItem: "",
                          items: [
                            {
                              name: "Export",
                              status: "error",
                              error: "Server error",
                            },
                          ],
                          errors: ["Failed to export releases"],
                        }));
                      }
                    } catch (e) {
                      console.error(e);
                      setDdexProgress((prev) => ({
                        ...prev,
                        phase: "error",
                        progress: 100,
                        currentItem: "",
                        items: [{ name: "Export", status: "error" }],
                        errors: [
                          "Connection error: " +
                            (e instanceof Error ? e.message : "Unknown error"),
                        ],
                      }));
                    } finally {
                      setExporting("");
                    }
                  }}
                  disabled={exporting !== ""}
                  className="flex items-center gap-3 w-full px-4 py-3 bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-primary)] rounded-lg text-sm transition-all disabled:opacity-50 group"
                >
                  <div className="w-8 h-8 rounded-lg bg-[var(--status-info)]/20 flex items-center justify-center group-hover:bg-[var(--status-info)]/30 transition-colors text-white">
                    <TableChartIcon size={16} color="#60a5fa" />
                  </div>
                  <div className="text-left flex-1">
                    <div className="font-medium text-[var(--text-primary)] text-sm">
                      {exporting === "xlsx"
                        ? "Exporting..."
                        : "Spreadsheet (XLSX)"}
                    </div>
                    <div className="text-[11px] text-[var(--text-disabled)]">
                      {t("releases.spreadsheetOnly")}
                    </div>
                  </div>
                </button>

                <button
                  onClick={async () => {
                    setExporting("zip");
                    setDdexProgress({
                      show: true,
                      mode: "export",
                      phase: "exporting",
                      title: "Exporting DDEX ZIP Package",
                      progress: 10,
                      currentItem:
                        "Building package (spreadsheet + audio + artwork)...",
                      items: [
                        { name: "Generate spreadsheet", status: "processing" },
                        { name: "Collect artwork files", status: "pending" },
                        { name: "Collect audio files", status: "pending" },
                        { name: "Compress ZIP", status: "pending" },
                      ],
                      summary: "",
                      errors: [],
                    });

                    // Simulate progress steps since server does it all at once
                    const progressTimer = setInterval(() => {
                      setDdexProgress((prev) => {
                        if (prev.phase !== "exporting") return prev;
                        const newProgress = Math.min(prev.progress + 5, 85);
                        let step = 0;
                        if (newProgress >= 20) step = 1;
                        if (newProgress >= 40) step = 2;
                        if (newProgress >= 60) step = 3;
                        const items = [...prev.items];
                        for (let i = 0; i < items.length; i++) {
                          if (i < step)
                            items[i] = { ...items[i], status: "done" };
                          else if (i === step)
                            items[i] = { ...items[i], status: "processing" };
                          else items[i] = { ...items[i], status: "pending" };
                        }
                        return {
                          ...prev,
                          progress: newProgress,
                          items,
                          currentItem:
                            step === 0
                              ? "Generating spreadsheet..."
                              : step === 1
                                ? "Collecting artwork files..."
                                : step === 2
                                  ? "Collecting audio files..."
                                  : "Compressing ZIP...",
                        };
                      });
                    }, 800);

                    try {
                      const res = await fetch(
                        `/api/releases/export?format=zip`,
                      );
                      clearInterval(progressTimer);
                      if (res.ok) {
                        setDdexProgress((prev) => ({
                          ...prev,
                          progress: 90,
                          currentItem: "Downloading...",
                          items: [
                            ...prev.items.map((i) => ({
                              ...i,
                              status: "done" as const,
                            })),
                            { name: "Download", status: "processing" as const },
                          ],
                        }));
                        const blob = await res.blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `beAlpha_DDEX_${new Date().toISOString().split("T")[0]}.zip`;
                        document.body.appendChild(a);
                        a.click();
                        window.URL.revokeObjectURL(url);
                        document.body.removeChild(a);
                        const sizeMB = (blob.size / (1024 * 1024)).toFixed(1);
                        setDdexProgress((prev) => ({
                          ...prev,
                          phase: "done",
                          progress: 100,
                          currentItem: "",
                          title: "Export Complete",
                          items: prev.items.map((i) => ({
                            ...i,
                            status: "done" as const,
                          })),
                          summary: `ZIP package exported successfully (${sizeMB} MB).`,
                        }));
                      } else {
                        setDdexProgress((prev) => ({
                          ...prev,
                          phase: "error",
                          progress: 100,
                          currentItem: "",
                          items: prev.items.map((i) => ({
                            ...i,
                            status: "error" as const,
                          })),
                          errors: ["Failed to export ZIP package"],
                        }));
                      }
                    } catch (e) {
                      clearInterval(progressTimer);
                      console.error(e);
                      setDdexProgress((prev) => ({
                        ...prev,
                        phase: "error",
                        progress: 100,
                        currentItem: "",
                        items: prev.items.map((i) => ({
                          ...i,
                          status: "error" as const,
                        })),
                        errors: [
                          "Connection error: " +
                            (e instanceof Error ? e.message : "Unknown error"),
                        ],
                      }));
                    } finally {
                      setExporting("");
                    }
                  }}
                  disabled={exporting !== ""}
                  className="flex items-center gap-3 w-full px-4 py-3 bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-primary)] rounded-lg text-sm transition-all disabled:opacity-50 group"
                >
                  <div className="w-8 h-8 rounded-lg bg-cyan-600/20 flex items-center justify-center group-hover:bg-cyan-600/30 transition-colors">
                    <FolderZipIcon size={16} color="#22d3ee" />
                  </div>
                  <div className="text-left flex-1">
                    <div className="font-medium text-[var(--text-primary)] text-sm">
                      {exporting === "zip" ? "Exporting..." : "ZIP Package"}
                    </div>
                    <div className="text-[11px] text-[var(--text-disabled)]">
                      {t("releases.spreadsheetAudioArtwork")}
                    </div>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <SearchIcon
            size={20}
            color="#6b7280"
            className="absolute left-3 top-1/2 -translate-y-1/2"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={t("releases.searchPlaceholder")}
            className="w-full pl-10 pr-4 py-2 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-disabled)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
        </div>
        <div className="flex items-center gap-2">
          <FilterListIcon size={20} color="#6b7280" />
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          >
            <option value="all">{t("dashboard.allStatus")}</option>
            <option value="PENDING">{t("statuses.pending")}</option>
            <option value="APPROVED">{t("statuses.approved")}</option>
            <option value="DENIED">{t("dashboard.denied")}</option>
            <option value="SCHEDULED">{t("dashboard.scheduled")}</option>
            <option value="RELEASED">{t("dashboard.released")}</option>
          </select>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <TableSkeleton rows={6} cols={6} />
      ) : releases.length === 0 ? (
        <div className="text-center py-12 text-[var(--text-disabled)]">
          <AlbumIcon size={48} color="#525252" />
          <p className="mt-2">{t("releases.noReleases")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[var(--text-tertiary)] text-sm border-b border-[var(--border-primary)]">
                <th className="pb-3 font-medium">{t("dashboard.title")}</th>
                <th className="pb-3 font-medium">{t("releases.artist")}</th>
                <th className="pb-3 font-medium">{t("dashboard.type")}</th>
                <th className="pb-3 font-medium">{t("common.status")}</th>
                <th className="pb-3 font-medium">{t("releases.releaseDate")}</th>
                <th className="pb-3 font-medium">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {releases.map((release) => (
                <tr
                  key={release.id}
                  className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)]"
                >
                  <td className="py-4">
                    <div className="flex items-center gap-3">
                      {release.cover && !release.cover.includes("picsum") ? (
                        <img
                          src={release.cover}
                          alt={release.title}
                          className="w-10 h-10 rounded object-cover"
                        />
                      ) : (
                        <div className="w-10 h-10 bg-gradient-to-br from-[#1DB954] to-[#169c46] rounded flex items-center justify-center">
                          <span className="text-lg font-bold text-white">
                            {release.title?.charAt(0).toUpperCase()}
                          </span>
                        </div>
                      )}
                      <span className="font-medium">{release.title}</span>
                    </div>
                  </td>
                  <td className="py-4 text-[var(--text-secondary)]">
                    {release.artist || "-"}
                  </td>
                  <td className="py-4">
                    <span className="px-2 py-1  rounded text-sm capitalize">
                      {release.format?.toLowerCase() || "-"}
                    </span>
                  </td>
                  <td className="py-4">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded text-sm ${
                        release.status === "APPROVED" ||
                        release.status === "RELEASED"
                          ? "text-[var(--accent-text)] bg-[var(--status-success-surface)]"
                          : release.status === "PENDING" ||
                              release.status === "SCHEDULED"
                            ? "text-[var(--status-warning)] bg-[var(--status-warning-surface)]"
                            : release.status === "DENIED"
                              ? "text-[var(--status-error)] bg-[var(--status-error-surface)]"
                              : "text-[var(--text-tertiary)] bg-[var(--bg-elevated)]"
                      }`}
                    >
                      {(release.status === "APPROVED" ||
                        release.status === "RELEASED") && (
                        <CheckCircleIcon size={14} />
                      )}
                      {(release.status === "PENDING" ||
                        release.status === "SCHEDULED") && (
                        <PendingIcon size={14} />
                      )}
                      {release.status === "DENIED" && <CancelIcon size={14} />}
                      <span className="capitalize">
                        {release.status?.toLowerCase() || "pending"}
                      </span>
                    </span>
                  </td>
                  <td className="py-4 text-[var(--text-tertiary)]">
                    {release.releaseDate || "-"}
                  </td>
                  <td className="py-4">
                    <div className="flex items-center gap-1">
                      {canApprove && release.status === "PENDING" && (
                        <>
                          <button
                            onClick={() => handleApprove(release.id)}
                            className="p-2 hover:bg-[var(--status-success-surface)] rounded-lg"
                            title={t("common.approve")}
                          >
                            <CheckCircleIcon size={18} color="#22c55e" />
                          </button>
                          <button
                            onClick={() => handleDeny(release.id)}
                            className="p-2 hover:bg-[var(--status-error-surface)] rounded-lg"
                            title={t("common.deny")}
                          >
                            <CancelIcon size={18} color="#ef4444" />
                          </button>
                        </>
                      )}
                      {canUpdate && (
                        <button
                          onClick={() => openEditForm(release)}
                          className="p-2 hover: rounded-lg"
                          title={t("common.edit")}
                        >
                          <EditIcon size={18} color="#a3a3a3" />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={() => handleDelete(release.id)}
                          className="p-2 hover:bg-[var(--status-error-surface)] rounded-lg"
                          title={t("common.delete")}
                        >
                          <DeleteIcon size={18} color="#ef4444" />
                        </button>
                      )}
                    </div>
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

// ============ ASSETS COMPONENT ============
function AssetsPanel({ user }: { user: UserSession }) {
  const { t } = useI18n(); // Auto-injected

  const [assets, setAssets] = useState<any[]>([]);
  const [artists, setArtists] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(20);
  const [view, setView] = useState<"list" | "upload" | "edit">("list");
  const [selectedAsset, setSelectedAsset] = useState<any | null>(null);

  const canUpload = user.permissions.includes("release.create");
  const canDelete = user.permissions.includes("release.delete");

  const fetchAssets = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (typeFilter !== "all") params.set("type", typeFilter);
      if (search) params.set("search", search);
      params.set("page", String(page));
      params.set("limit", String(limit));
      const res = await fetch(`/api/assets?${params}`);
      if (res.ok) {
        const json = await res.json();
        setAssets(json.data || json);
        setTotal(json.total || 0);
        setTotalPages(json.totalPages || 1);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [typeFilter, search, page, limit]);

  const fetchArtists = useCallback(async () => {
    try {
      const res = await fetch("/api/artists?limit=200");
      if (res.ok) {
        const json = await res.json();
        setArtists(json.data || json);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const handleCreateArtist = async (artist: {
    name: string;
    spotifyId?: string;
    appleMusicId?: string;
  }): Promise<string> => {
    try {
      const res = await fetch("/api/artists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(artist),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(
          errData.error || `Failed to create artist (${res.status})`,
        );
      }
      const newArtist = await res.json();
      await fetchArtists();
      return newArtist.id;
    } catch (error) {
      console.error("Error creating artist:", error);
      throw error;
    }
  };

  useEffect(() => {
    fetchAssets();
    fetchArtists();
  }, [fetchAssets, fetchArtists]);

  // Global search listener
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      if (e.detail.type === "ASSET") {
        setSearch(e.detail.title);
        setPage(1);
      }
    };
    window.addEventListener("open-entity", handler as EventListener);
    return () => window.removeEventListener("open-entity", handler as EventListener);
  }, []);

  const handleDelete = async (id: string) => {
    const asset = assets.find((a) => a.id === id);
    const msg = `Are you sure you want to delete "${asset?.originalFileName || asset?.fileName || "this asset"}"?\n\n- Tracks using this audio file will be unlinked\n- The audio file will be permanently deleted\n\nThis action cannot be undone.`;
    if (!confirm(msg)) return;
    try {
      const res = await fetch(`/api/assets/${id}`, { method: "DELETE" });
      if (res.ok) fetchAssets();
    } catch (e) {
      console.error(e);
    }
  };

  const handleSubmitAsset = async (formData: any) => {
    try {
      const url =
        view === "upload" ? "/api/assets" : `/api/assets/${selectedAsset?.id}`;
      const method = view === "upload" ? "POST" : "PATCH";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(translateApiError(data.error, t));
      }

      setView("list");
      fetchAssets();
    } catch (error: any) {
      alert(error.message || "Failed to save asset");
    }
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return "-";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return "-";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Upload/Edit Form View
  if (view === "upload" || view === "edit") {
    return (
      <div className="p-6">
        {/* Header with Back button */}
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={() => setView("list")}
            className="p-2 hover: rounded-lg transition-colors"
          >
            <ArrowBackIcon size={24} />
          </button>
          <h2 className="text-xl font-medium">
            {view === "upload" ? "Upload Asset" : "Edit Asset"}
          </h2>
        </div>

        <div className="max-w-4xl">
          <AssetForm
            asset={view === "edit" ? selectedAsset : null}
            artists={artists}
            onSubmit={handleSubmitAsset}
            onCancel={() => setView("list")}
            onCreateArtist={handleCreateArtist}
          />
        </div>
      </div>
    );
  }

  // Assets now use server-side search
  const filteredAssets = assets;

  // List View
  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-medium">{t("assets.title")}</h2>
        {canUpload && (
          <button
            onClick={() => setView("upload")}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-lg text-sm font-medium transition-colors"
          >
            <CloudUploadIcon size={18} />
            {t("common.upload")}
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <SearchIcon
            size={20}
            color="#6b7280"
            className="absolute left-3 top-1/2 -translate-y-1/2"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={t("assets.searchPlaceholder")}
            className="w-full pl-10 pr-4 py-2 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-disabled)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
        </div>
        <div className="flex items-center gap-2">
          <FilterListIcon size={20} color="#6b7280" />
          <select
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          >
            <option value="all">{t("dashboard.allTypes")}</option>
            <option value="AUDIO">{t("dashboard.audio")}</option>
            <option value="VIDEO">{t("dashboard.video")}</option>
          </select>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <TableSkeleton rows={5} cols={7} />
      ) : filteredAssets.length === 0 ? (
        <div className="text-center py-12 text-[var(--text-disabled)]">
          <AudioFileIcon size={48} color="#525252" />
          <p className="mt-2">{t("assets.noAssets")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[var(--text-tertiary)] text-sm border-b border-[var(--border-primary)]">
                <th className="pb-3 font-medium">{t("assets.fileName")}</th>
                <th className="pb-3 font-medium">{t("dashboard.type")}</th>
                <th className="pb-3 font-medium">{t("dashboard.size")}</th>
                <th className="pb-3 font-medium">{t("assets.duration")}</th>
                <th className="pb-3 font-medium">{t("common.status")}</th>
                <th className="pb-3 font-medium">{t("dashboard.release")}</th>
                <th className="pb-3 font-medium">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {filteredAssets.map((asset) => (
                <tr
                  key={asset.id}
                  className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)]"
                >
                  <td className="py-4">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-10 h-10 rounded flex items-center justify-center ${
                          asset.type === "AUDIO"
                            ? "bg-purple-500/20"
                            : "bg-[var(--status-info-surface)]"
                        }`}
                      >
                        <AudioFileIcon
                          size={20}
                          color={asset.type === "AUDIO" ? "#a855f7" : "#3b82f6"}
                        />
                      </div>
                      <div>
                        <span className="font-medium block">
                          {asset.originalFileName || asset.fileName}
                        </span>
                        {asset.isrc && (
                          <span className="text-xs text-[var(--text-disabled)]">
                            {asset.isrc}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="py-4">
                    <span
                      className={`px-2 py-1 rounded text-sm ${
                        asset.type === "AUDIO"
                          ? "bg-[rgba(162,56,255,0.1)] text-[var(--color-deezer)]"
                          : "bg-[var(--status-info-surface)] text-[var(--status-info)]"
                      }`}
                    >
                      {asset.type}
                    </span>
                  </td>
                  <td className="py-4 text-[var(--text-tertiary)]">
                    {formatFileSize(asset.fileSize)}
                  </td>
                  <td className="py-4 text-[var(--text-tertiary)]">
                    {formatDuration(asset.duration)}
                  </td>
                  <td className="py-4">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded text-sm ${
                        asset.status === "READY"
                          ? "text-[var(--accent-text)] bg-[var(--status-success-surface)]"
                          : asset.status === "PROCESSING"
                            ? "text-[var(--status-warning)] bg-[var(--status-warning-surface)]"
                            : asset.status === "ERROR"
                              ? "text-[var(--status-error)] bg-[var(--status-error-surface)]"
                              : "text-[var(--text-tertiary)] bg-[var(--bg-elevated)]"
                      }`}
                    >
                      {asset.status === "READY" && (
                        <CheckCircleIcon size={14} />
                      )}
                      {asset.status === "PROCESSING" && (
                        <PendingIcon size={14} />
                      )}
                      {asset.status === "ERROR" && <CancelIcon size={14} />}
                      <span className="capitalize">
                        {asset.status?.toLowerCase() || "pending"}
                      </span>
                    </span>
                  </td>
                  <td className="py-4 text-[var(--text-tertiary)]">
                    {asset.release?.title || "-"}
                  </td>
                  <td className="py-4">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          setSelectedAsset(asset);
                          setView("edit");
                        }}
                        className="p-2 hover:bg-[var(--status-success-surface)] rounded-lg"
                        title={t("common.edit")}
                      >
                        <EditIcon size={18} color="#22c55e" />
                      </button>
                      {canDelete && (
                        <button
                          onClick={() => handleDelete(asset.id)}
                          className="p-2 hover:bg-[var(--status-error-surface)] rounded-lg"
                          title={t("common.delete")}
                        >
                          <DeleteIcon size={18} color="#ef4444" />
                        </button>
                      )}
                    </div>
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

// ============ LABELS COMPONENT ============
function LabelsPanel({ user }: { user: UserSession }) {
  const { t } = useI18n(); // Auto-injected

  const { uploadFile, downloadFile } = useUploadProgress();
  const [labels, setLabels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(20);
  const [editModal, setEditModal] = useState<{
    open: boolean;
    label: any | null;
  }>({ open: false, label: null });
  const [createModal, setCreateModal] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    logoUrl: "",
    dpid: "",
    ddexPartyName: "",
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [dragState, setDragState] = useState<string | null>(null);

  const canCreate = user.permissions.includes("label.create");
  const canUpdate = user.permissions.includes("label.update");
  const canDelete = user.permissions.includes("label.delete");

  const fetchLabels = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      params.set("page", String(page));
      params.set("limit", String(limit));
      const res = await fetch(`/api/labels?${params}`);
      if (res.ok) {
        const json = await res.json();
        setLabels(json.data || json);
        setTotal(json.total || 0);
        setTotalPages(json.totalPages || 1);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [search, page, limit]);

  useEffect(() => {
    fetchLabels();
  }, [fetchLabels]);

  // Global search listener
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      if (e.detail.type === "LABEL") {
        setSearch(e.detail.title);
        setPage(1);
      }
    };
    window.addEventListener("open-entity", handler as EventListener);
    return () => window.removeEventListener("open-entity", handler as EventListener);
  }, []);

  const openEditModal = (label: any) => {
    setFormData({
      name: label.name || "",
      description: label.description || "",
      logoUrl: label.logoUrl || "",
      dpid: label.dpid || "",
      ddexPartyName: label.ddexPartyName || "",
    });
    setEditModal({ open: true, label });
  };

  const validateLabelForm = (): string[] => {
    const errors: string[] = [];
    if (!formData.name.trim()) errors.push("• Label Name is required");
    if (formData.name.trim().length > 0 && formData.name.trim().length < 2)
      errors.push("• Label Name must be at least 2 characters");
    return errors;
  };

  const handleSave = async () => {
    if (!editModal.label) return;
    const errors = validateLabelForm();
    if (errors.length > 0) {
      setFormError(errors.join("\n"));
      return;
    }
    setFormError("");
    setSaving(true);
    try {
      const res = await fetch(`/api/labels/${editModal.label.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        setEditModal({ open: false, label: null });
        fetchLabels();
      } else {
        const data = await res.json();
        setFormError(translateApiError(data.error, t));
      }
    } catch (e) {
      console.error(e);
      setFormError("An error occurred");
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async () => {
    const errors = validateLabelForm();
    if (errors.length > 0) {
      setFormError(errors.join("\n"));
      return;
    }
    setFormError("");
    setSaving(true);
    try {
      const res = await fetch("/api/labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        setCreateModal(false);
        setFormData({
          name: "",
          description: "",
          logoUrl: "",
          dpid: "",
          ddexPartyName: "",
        });
        setFormError("");
        fetchLabels();
      } else {
        const data = await res.json();
        setFormError(translateApiError(data.error, t));
      }
    } catch (e) {
      console.error(e);
      setFormError("An error occurred");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const label = labels.find((l) => l.id === id);
    const msg = `Are you sure you want to delete "${label?.name || "this label"}"?\n\nThis will also permanently delete:\n- All artists under this label\n- All releases and tracks\n- All audio files and cover art\n\nThis action cannot be undone.`;
    if (!confirm(msg)) return;
    try {
      await fetch(`/api/labels/${id}`, { method: "DELETE" });
      fetchLabels();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="p-6">
      <Modal
        isOpen={editModal.open}
        onClose={() => {
          setEditModal({ open: false, label: null });
          setFormError("");
        }}
        title={t("labels.editLabel")}
      >
        <div className="space-y-4">
          {formError && (
            <div className="p-3 bg-[var(--status-error-surface)] border border-red-500/30 rounded-lg text-[var(--status-error)] text-sm whitespace-pre-line">
              {formError}
            </div>
          )}
          <div className="flex justify-center mb-4">
            <ImageUpload
              currentUrl={formData.logoUrl}
              onUpload={(url) => setFormData({ ...formData, logoUrl: url })}
              type="labels"
              entityName={formData.name || "Draft Label"}
              labelName={formData.name || "Draft Label"}
            />
          </div>
          <div>
            <label className="block text-sm text-[var(--text-tertiary)] mb-1">
              {t("labels.labelName")}
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              className="w-full px-3 py-2  border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>
          <div>
            <label className="block text-sm text-[var(--text-tertiary)] mb-1">
              {t("form.description", "Description")}
            </label>
            <textarea
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              rows={3}
              className="w-full px-3 py-2  border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-none"
            />
          </div>
          <div>
            <label className="block text-sm text-[var(--text-tertiary)] mb-1">
              DDEX Party Name{" "}
              <span className="text-[var(--text-disabled)] font-normal text-xs">
                (Fallback if empty)
              </span>
            </label>
            <input
              type="text"
              value={formData.ddexPartyName}
              onChange={(e) =>
                setFormData({ ...formData, ddexPartyName: e.target.value })
              }
              className="w-full px-3 py-2  border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              placeholder={t("form.placeholder.eGBeAlpha", "e.g. beAlpha")}
            />
          </div>
          <div>
            <label className="block text-sm text-[var(--text-tertiary)] mb-1">
              DDEX Party Identifier (DPID){" "}
              <span className="text-[var(--text-disabled)] font-normal text-xs">
                (Fallback if empty)
              </span>
            </label>
            <input
              type="text"
              value={formData.dpid}
              onChange={(e) =>
                setFormData({ ...formData, dpid: e.target.value })
              }
              className="w-full px-3 py-2  border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              placeholder={t("form.placeholder.eGPADPX", "e.g. PADPX...")}
            />
          </div>
          <div className="flex gap-3 pt-4">
            <button
              onClick={() => setEditModal({ open: false, label: null })}
              className="flex-1 px-4 py-2  hover: rounded-lg text-sm font-medium transition-colors"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg text-sm font-medium transition-colors disabled:opacity-50 text-white"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={createModal}
        onClose={() => {
          setCreateModal(false);
          setFormError("");
        }}
        title={t("common.addLabel")}
      >
        <div className="space-y-4">
          {formError && (
            <div className="p-3 bg-[var(--status-error-surface)] border border-red-500/30 rounded-lg text-[var(--status-error)] text-sm whitespace-pre-line">
              {formError}
            </div>
          )}
          <div className="flex justify-center mb-4">
            <ImageUpload
              currentUrl={formData.logoUrl}
              onUpload={(url) => setFormData({ ...formData, logoUrl: url })}
              type="labels"
              entityName={formData.name || "Draft Label"}
              labelName={formData.name || "Draft Label"}
            />
          </div>
          <div>
            <label className="block text-sm text-[var(--text-tertiary)] mb-1">
              {t("form.labelName", "Label Name *")}
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              className="w-full px-3 py-2  border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              placeholder={t("form.placeholder.enterLabelName", "Enter label name")}
            />
          </div>
          <div>
            <label className="block text-sm text-[var(--text-tertiary)] mb-1">
              {t("form.description", "Description")}
            </label>
            <textarea
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              rows={3}
              className="w-full px-3 py-2  border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-none"
              placeholder={t("form.placeholder.labelDescription", "Label description")}
            />
          </div>
          <div>
            <label className="block text-sm text-[var(--text-tertiary)] mb-1">
              DDEX Party Name{" "}
              <span className="text-[var(--text-disabled)] font-normal text-xs">
                (Fallback if empty)
              </span>
            </label>
            <input
              type="text"
              value={formData.ddexPartyName}
              onChange={(e) =>
                setFormData({ ...formData, ddexPartyName: e.target.value })
              }
              className="w-full px-3 py-2  border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              placeholder={t("form.placeholder.eGBeAlpha", "e.g. beAlpha")}
            />
          </div>
          <div>
            <label className="block text-sm text-[var(--text-tertiary)] mb-1">
              DDEX Party Identifier (DPID){" "}
              <span className="text-[var(--text-disabled)] font-normal text-xs">
                (Fallback if empty)
              </span>
            </label>
            <input
              type="text"
              value={formData.dpid}
              onChange={(e) =>
                setFormData({ ...formData, dpid: e.target.value })
              }
              className="w-full px-3 py-2  border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              placeholder={t("form.placeholder.eGPADPX", "e.g. PADPX...")}
            />
          </div>
          <div className="flex gap-3 pt-4">
            <button
              onClick={() => {
                setCreateModal(false);
                setFormError("");
              }}
              className="flex-1 px-4 py-2  hover: rounded-lg text-sm font-medium transition-colors"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={handleCreate}
              disabled={saving}
              className="flex-1 px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg text-sm font-medium transition-colors disabled:opacity-50 text-white"
            >
              {saving ? "Creating..." : "Create"}
            </button>
          </div>
        </div>
      </Modal>

      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-medium">{t("labels.title")}</h2>
        <div className="flex items-center gap-3">
          {canCreate && (
            <>
              <button
                onClick={() => {
                  setFormData({
                    name: "",
                    description: "",
                    logoUrl: "",
                    dpid: "",
                    ddexPartyName: "",
                  });
                  setCreateModal(true);
                }}
                className="flex items-center gap-2 px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg text-sm font-medium transition-colors text-white"
              >
                <AddIcon size={18} />
                Add Label
              </button>
            </>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-md mb-6">
        <SearchIcon
          size={20}
          color="#6b7280"
          className="absolute left-3 top-1/2 -translate-y-1/2"
        />
        <input
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder={t("labels.searchPlaceholder")}
          className="w-full pl-10 pr-4 py-2 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-disabled)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
      </div>

      {loading ? (
        <CardSkeleton count={6} />
      ) : labels.length === 0 ? (
        <div className="text-center py-12 text-[var(--text-disabled)]">
          <BusinessIcon size={48} color="#525252" />
          <p className="mt-2">{t("labels.noLabels")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {labels.map((label) => (
            <div
              key={label.id}
              style={{ background: "var(--bg-surface)" }}
              className=" rounded-lg border border-[var(--border-primary)] p-4"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-lg overflow-hidden bg-[var(--status-success-surface)] flex items-center justify-center">
                  {label.logoUrl ? (
                    <img
                      src={label.logoUrl}
                      alt={label.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <BusinessIcon size={20} color="#22c55e" />
                  )}
                </div>
                <div className="flex gap-1 items-center">
                  {(canUpdate || canDelete) && (
                    <>
                      {canUpdate && (
                        <button
                          onClick={() => openEditModal(label)}
                          title={t("labels.editLabel")}
                          className="p-1.5 hover:bg-[var(--bg-elevated)] rounded"
                        >
                          <EditIcon size={16} color="#a3a3a3" />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={() => handleDelete(label.id)}
                          title={t("common.deleteLabel")}
                          className="p-1.5 hover:bg-[var(--status-error-surface)] rounded"
                        >
                          <DeleteIcon size={16} color="#ef4444" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
              <h3 className="font-medium text-[var(--text-primary)]">
                {label.name}
              </h3>
              <p className="text-sm text-[var(--text-disabled)] mt-1">
                {label.artistCount || 0} artists • {label.releaseCount || 0}{" "}
                releases
              </p>
            </div>
          ))}
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

// ============ ARTISTS COMPONENT ============
function ArtistsPanel({ user }: { user: UserSession }) {
  const { t } = useI18n(); // Auto-injected

  const [artists, setArtists] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(20);
  const [editModal, setEditModal] = useState<{
    open: boolean;
    artist: any | null;
  }>({ open: false, artist: null });
  const [createModal, setCreateModal] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    isni: "",
    ipi: "",
    dpid: "",
    spotifyId: "",
    appleMusicId: "",
    vevoChannel: "",
    imageUrl: "",
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const canCreate = user.permissions.includes("artist.create");
  const canUpdate = user.permissions.includes("artist.update");
  const canDelete = user.permissions.includes("artist.delete");

  const fetchArtists = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      params.set("page", String(page));
      params.set("limit", String(limit));
      const res = await fetch(`/api/artists?${params}`);
      if (res.ok) {
        const json = await res.json();
        setArtists(json.data || json);
        setTotal(json.total || 0);
        setTotalPages(json.totalPages || 1);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [search, page, limit]);

  useEffect(() => {
    fetchArtists();
  }, [fetchArtists]);

  // Global search listener
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      if (e.detail.type === "ARTIST") {
        setSearch(e.detail.title);
        setPage(1);
      }
    };
    window.addEventListener("open-entity", handler as EventListener);
    return () => window.removeEventListener("open-entity", handler as EventListener);
  }, []);

  const openEditModal = (artist: any) => {
    setFormData({
      name: artist.name || "",
      isni: artist.isni || "",
      ipi: artist.ipi || "",
      dpid: artist.dpid || "",
      spotifyId: artist.spotifyId || "",
      appleMusicId: artist.appleMusicId || "",
      vevoChannel: artist.vevoChannel || "",
      imageUrl: artist.imageUrl || "",
    });
    setEditModal({ open: true, artist });
  };

  const validateArtistForm = (): string[] => {
    const errors: string[] = [];
    if (!formData.name.trim()) errors.push("• Artist Name is required");
    if (formData.name.trim().length > 0 && formData.name.trim().length < 2)
      errors.push("• Artist Name must be at least 2 characters");
      
    if (formData.vevoChannel) {
      if (!formData.vevoChannel.endsWith("VEVO")) {
        errors.push("• VEVO Channel must end with 'VEVO'");
      }
      if (formData.vevoChannel.length > 20) {
        errors.push("• VEVO Channel must not exceed 20 characters");
      }
    }
    return errors;
  };

  const handleSave = async () => {
    if (!editModal.artist) return;
    const errors = validateArtistForm();
    if (errors.length > 0) {
      setFormError(errors.join("\n"));
      return;
    }
    setFormError("");
    setSaving(true);
    try {
      const res = await fetch(`/api/artists/${editModal.artist.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        setEditModal({ open: false, artist: null });
        fetchArtists();
      } else {
        const data = await res.json();
        setFormError(translateApiError(data.error, t));
      }
    } catch (e) {
      console.error(e);
      setFormError("An error occurred");
    } finally {
      setSaving(false);
    }
  };

  const handleCreateArtist = async () => {
    const errors = validateArtistForm();
    if (errors.length > 0) {
      setFormError(errors.join("\n"));
      return;
    }
    setFormError("");
    setSaving(true);
    try {
      const res = await fetch("/api/artists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        setCreateModal(false);
        setFormData({
          name: "",
          isni: "",
          ipi: "",
          dpid: "",
          spotifyId: "",
          appleMusicId: "",
          vevoChannel: "",
          imageUrl: "",
        });
        setFormError("");
        fetchArtists();
      } else {
        const data = await res.json();
        setFormError(translateApiError(data.error, t));
      }
    } catch (e) {
      console.error(e);
      setFormError("An error occurred");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const artist = artists.find((a) => a.id === id);
    const msg = `Are you sure you want to delete "${artist?.name || "this artist"}"?\n\nThis will also permanently delete:\n- All releases by this artist\n• All tracks and audio files\n- All cover art and streaming data\n\nThis action cannot be undone.`;
    if (!confirm(msg)) return;
    try {
      await fetch(`/api/artists/${id}`, { method: "DELETE" });
      fetchArtists();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="p-6">
      <Modal
        isOpen={editModal.open}
        onClose={() => {
          setEditModal({ open: false, artist: null });
          setFormError("");
        }}
        title={t("artists.editArtist")}
      >
        <div className="space-y-4">
          {formError && (
            <div className="p-3 bg-[var(--status-error-surface)] border border-red-500/30 rounded-lg text-[var(--status-error)] text-sm whitespace-pre-line">
              {formError}
            </div>
          )}
          <div className="flex justify-center mb-4">
            <ImageUpload
              currentUrl={formData.imageUrl}
              onUpload={(url) => setFormData({ ...formData, imageUrl: url })}
              type="artists"
              shape="circle"
              entityName={formData.name || "Draft Artist"}
              artistName={formData.name || "Draft Artist"}
              labelName={
                editModal.open && editModal.artist
                  ? editModal.artist.labelName || "Independent"
                  : "Independent"
              }
            />
          </div>
          <div>
            <label className="block text-sm text-[var(--text-tertiary)] mb-1">
              {t("form.artistName", "Artist Name *")}
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              className="w-full px-3 py-2  border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>
          <div>
            <label className="block text-sm text-[var(--text-tertiary)] mb-1">
              {t("form.spotifyID", "Spotify ID")}
            </label>
            <input
              type="text"
              value={formData.spotifyId}
              onChange={(e) =>
                setFormData({ ...formData, spotifyId: e.target.value })
              }
              className="w-full px-3 py-2  border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>
          <div>
            <label className="block text-sm text-[var(--text-tertiary)] mb-1">
              {t("form.appleMusicID", "Apple Music ID")}
            </label>
            <input
              type="text"
              value={formData.appleMusicId}
              onChange={(e) =>
                setFormData({ ...formData, appleMusicId: e.target.value })
              }
              className="w-full px-3 py-2  border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>
          <div>
            <label className="block text-sm text-[var(--text-tertiary)] mb-1">
              VEVO Channel
              <span className="text-[var(--text-disabled)] text-xs ml-1">
                (Must end in VEVO, max 20 chars)
              </span>
            </label>
            <input
              type="text"
              value={formData.vevoChannel}
              onChange={(e) =>
                setFormData({ ...formData, vevoChannel: e.target.value })
              }
              placeholder={t("form.placeholder.eGArtistNameVEVO", "e.g. ArtistNameVEVO")}
              maxLength={20}
              className="w-full px-3 py-2 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>
          <div>
            <label className="block text-sm text-[var(--text-tertiary)] mb-1">
              ISNI{" "}
              <span className="text-[var(--text-disabled)] text-xs">
                (International Standard Name Identifier)
              </span>
            </label>
            <input
              type="text"
              value={formData.isni}
              onChange={(e) =>
                setFormData({ ...formData, isni: e.target.value })
              }
              placeholder={t("form.placeholder.eGISNI", "e.g. ISNI")}
              className="w-full px-3 py-2  border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>
          <div>
            <label className="block text-sm text-[var(--text-tertiary)] mb-1">
              IPI{" "}
              <span className="text-[var(--text-disabled)] text-xs">
                (Interested Party Information)
              </span>
            </label>
            <input
              type="text"
              value={formData.ipi || ""}
              onChange={(e) =>
                setFormData({ ...formData, ipi: e.target.value })
              }
              placeholder={t("form.placeholder.eG123456789", "e.g. 123456789")}
              className="w-full px-3 py-2  border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>
          <div>
            <label className="block text-sm text-[var(--text-tertiary)] mb-1">
              DPID{" "}
              <span className="text-[var(--text-disabled)] text-xs">
                (DDEX Party ID)
              </span>
            </label>
            <input
              type="text"
              value={formData.dpid}
              onChange={(e) =>
                setFormData({ ...formData, dpid: e.target.value })
              }
              placeholder={t("form.placeholder.eGDPID", "e.g. DPID")}
              className="w-full px-3 py-2  border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>
          <div className="flex gap-3 pt-4">
            <button
              onClick={() => setEditModal({ open: false, artist: null })}
              className="flex-1 px-4 py-2  hover: rounded-lg text-sm font-medium transition-colors"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg text-sm font-medium transition-colors disabled:opacity-50 text-white"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={createModal}
        onClose={() => {
          setCreateModal(false);
          setFormError("");
        }}
        title={t("common.addArtist")}
      >
        <div className="space-y-4">
          {formError && (
            <div className="p-3 bg-[var(--status-error-surface)] border border-red-500/30 rounded-lg text-[var(--status-error)] text-sm whitespace-pre-line">
              {formError}
            </div>
          )}
          <div className="flex justify-center mb-4">
            <ImageUpload
              currentUrl={formData.imageUrl}
              onUpload={(url) => setFormData({ ...formData, imageUrl: url })}
              type="artists"
              shape="circle"
              entityName={formData.name || "Draft Artist"}
              artistName={formData.name || "Draft Artist"}
              labelName="Independent" // Defaults to Independent for new artists, wait unless we know their label? The user is admin, so they could create an artist under any label, but the form doesn't have a label selector.
            />
          </div>
          <div>
            <label className="block text-sm text-[var(--text-tertiary)] mb-1">
              {t("form.artistName", "Artist Name *")}
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              className="w-full px-3 py-2  border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              placeholder={t("form.placeholder.enterArtistName", "Enter artist name")}
            />
          </div>
          <div>
            <label className="block text-sm text-[var(--text-tertiary)] mb-1">
              {t("form.spotifyID", "Spotify ID")}
            </label>
            <input
              type="text"
              value={formData.spotifyId}
              onChange={(e) =>
                setFormData({ ...formData, spotifyId: e.target.value })
              }
              className="w-full px-3 py-2  border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              placeholder={t("form.placeholder.eGSpotifyID", "e.g. Spotify ID")}
            />
          </div>
          <div>
            <label className="block text-sm text-[var(--text-tertiary)] mb-1">
              {t("form.appleMusicID", "Apple Music ID")}
            </label>
            <input
              type="text"
              value={formData.appleMusicId}
              onChange={(e) =>
                setFormData({ ...formData, appleMusicId: e.target.value })
              }
              className="w-full px-3 py-2  border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              placeholder={t("form.placeholder.eGAppleMusicID", "e.g. Apple Music ID")}
            />
          </div>
          <div>
            <label className="block text-sm text-[var(--text-tertiary)] mb-1">
              ISNI{" "}
              <span className="text-[var(--text-disabled)] text-xs">
                (International Standard Name Identifier)
              </span>
            </label>
            <input
              type="text"
              value={formData.isni}
              onChange={(e) =>
                setFormData({ ...formData, isni: e.target.value })
              }
              placeholder={t("form.placeholder.eGISNI", "e.g. ISNI")}
              className="w-full px-3 py-2  border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>
          <div>
            <label className="block text-sm text-[var(--text-tertiary)] mb-1">
              IPI{" "}
              <span className="text-[var(--text-disabled)] text-xs">
                (Interested Party Information)
              </span>
            </label>
            <input
              type="text"
              value={formData.ipi || ""}
              onChange={(e) =>
                setFormData({ ...formData, ipi: e.target.value })
              }
              placeholder={t("form.placeholder.eG123456789", "e.g. 123456789")}
              className="w-full px-3 py-2  border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>
          <div>
            <label className="block text-sm text-[var(--text-tertiary)] mb-1">
              DPID{" "}
              <span className="text-[var(--text-disabled)] text-xs">
                (DDEX Party ID)
              </span>
            </label>
            <input
              type="text"
              value={formData.dpid}
              onChange={(e) =>
                setFormData({ ...formData, dpid: e.target.value })
              }
              placeholder={t("form.placeholder.eGDPID", "e.g. DPID")}
              className="w-full px-3 py-2  border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>
          <div className="flex gap-3 pt-4">
            <button
              onClick={() => setCreateModal(false)}
              className="flex-1 px-4 py-2  hover: rounded-lg text-sm font-medium transition-colors"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={handleCreateArtist}
              disabled={saving}
              className="flex-1 px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg text-sm font-medium transition-colors disabled:opacity-50 text-white"
            >
              {saving ? "Creating..." : "Create"}
            </button>
          </div>
        </div>
      </Modal>

      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-medium">{t("artists.title")}</h2>
        {canCreate && (
          <button
            onClick={() => {
              setFormData({
                name: "",
                isni: "",
                ipi: "",
                dpid: "",
                spotifyId: "",
                appleMusicId: "",
                vevoChannel: "",
                imageUrl: "",
              });
              setCreateModal(true);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg text-sm font-medium transition-colors text-white"
          >
            <AddIcon size={18} />
            Add Artist
          </button>
        )}
      </div>

      {/* Search */}
      <div className="relative max-w-md mb-6">
        <SearchIcon
          size={20}
          color="#6b7280"
          className="absolute left-3 top-1/2 -translate-y-1/2"
        />
        <input
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder={t("artists.searchPlaceholder")}
          className="w-full pl-10 pr-4 py-2 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-disabled)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
      </div>

      {loading ? (
        <CardSkeleton count={6} />
      ) : artists.length === 0 ? (
        <div className="text-center py-12 text-[var(--text-disabled)]">
          <PersonIcon size={48} color="#525252" />
          <p className="mt-2">{t("artists.noArtists")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {artists.map((artist) => (
            <div
              key={artist.id}
              style={{ background: "var(--bg-surface)" }}
              className=" rounded-lg border border-[var(--border-primary)] p-4"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-full overflow-hidden bg-[var(--status-success-surface)] flex items-center justify-center">
                  {artist.imageUrl ? (
                    <img
                      src={artist.imageUrl}
                      alt={artist.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <PersonIcon size={20} color="#22c55e" />
                  )}
                </div>
                {(canUpdate || canDelete) && (
                  <div className="flex gap-1">
                    {canUpdate && (
                      <button
                        onClick={() => openEditModal(artist)}
                        className="p-1.5 hover: rounded"
                      >
                        <EditIcon size={16} color="#a3a3a3" />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        onClick={() => handleDelete(artist.id)}
                        className="p-1.5 hover:bg-[var(--status-error-surface)] rounded"
                      >
                        <DeleteIcon size={16} color="#ef4444" />
                      </button>
                    )}
                  </div>
                )}
              </div>
              <h3 className="font-medium text-[var(--text-primary)]">
                {artist.name}
              </h3>
              <p className="text-sm text-[var(--text-disabled)] mt-1">
                {artist.labelName || "Independent"}
              </p>
              {(artist.spotifyId || artist.appleMusicId) && (
                <div className="flex gap-2 mt-2">
                  {artist.spotifyId && (
                    <a
                      href={`https://open.spotify.com/artist/${artist.spotifyId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#1ed760] hover:opacity-80 transition-opacity cursor-pointer"
                      title={t("dashboard.viewOnSpotify")}
                    >
                      <SpotifyIcon size={20} />
                    </a>
                  )}
                  {artist.appleMusicId && (
                    <a
                      href={`https://music.apple.com/artist/${artist.appleMusicId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#fa243c] hover:opacity-80 transition-opacity cursor-pointer"
                      title={t("dashboard.viewOnAppleMusic")}
                    >
                      <AppleIcon size={20} />
                    </a>
                  )}
                </div>
              )}
            </div>
          ))}
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

// ============ ANALYTICS COMPONENT ============
function AnalyticsPanel() {
  const { t } = useI18n(); // Auto-injected

  const [analytics, setAnalytics] = useState<any>(null);
  const [streaming, setStreaming] = useState<any>(null);
  const [duration, setDuration] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const [analyticsRes, streamingRes, durationRes] = await Promise.all([
        fetch(`/api/analytics?days=${days}`),
        fetch(`/api/streaming?days=${days}`),
        fetch(`/api/analytics?type=duration&days=${days}`),
      ]);

      if (analyticsRes.ok) {
        const json = await analyticsRes.json();
        // Normalize new API shape: { data, summary } → legacy { daily, summary, skipRate }
        setAnalytics({
          daily: json.data || json.daily || [],
          summary: json.summary || { totalPlays: 0, totalSkips: 0, skipRatePercent: 0 },
          skipRate: json.summary ? [
            { name: "Completed", value: 100 - (json.summary.skipRatePercent || 0), color: "#e5e7eb" },
            { name: "Skipped", value: json.summary.skipRatePercent || 0, color: "#ef4444" },
          ] : [],
        });
      }
      if (streamingRes.ok) setStreaming(await streamingRes.json());
      if (durationRes.ok) {
        const dJson = await durationRes.json();
        setDuration(dJson.data || dJson || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [days]);

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
    .map((d: any) => ({
      date: d.period || new Date(d.date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      plays: d.plays || d.totalPlays || 0,
      skips: d.skips || d.totalSkips || 0,
      saves: d.saves || d.totalSaves || 0,
      shares: d.shares || d.totalShares || 0,
    }));

  const streamingDaily = (streaming?.daily || []).map((d: any) => ({
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
              No data available for the selected period
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
                  name: "Plays",
                  value: summary.totalPlays + streamingSummary.plays,
                  fill: "#22c55e",
                },
                {
                  name: "Skips",
                  value: summary.totalSkips + streamingSummary.skips,
                  fill: "#ef4444",
                },
                {
                  name: "Saves",
                  value: streamingSummary.saves,
                  fill: "#3b82f6",
                },
                {
                  name: "Shares",
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
                No duration data available
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ CHART COMPONENTS (using simple CSS bars as Recharts fallback) ============
function AnalyticsLineChart({ data }: { data: any[] }) {
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
            title={`${d.date}: ${d.plays} plays`}
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

function AnalyticsPieChart({ data }: { data: any[] }) {
  const { t } = useI18n(); // Auto-injected

  if (data.length === 0)
    return <div className="text-[var(--text-disabled)] text-sm">{t("common.noData")}</div>;
  const total = data.reduce((sum, d) => sum + d.value, 0) || 1;
  return (
    <div className="flex items-center gap-8">
      <div className="relative w-40 h-40">
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          {data
            .reduce((acc: any[], d, i) => {
              const pct = (d.value / total) * 100;
              const offset =
                acc.length > 0
                  ? acc[acc.length - 1].offset + acc[acc.length - 1].pct
                  : 0;
              acc.push({ ...d, pct, offset, i });
              return acc;
            }, [])
            .map((segment: any) => (
              <circle
                key={segment.i}
                cx="50"
                cy="50"
                r="40"
                fill="none"
                stroke={
                  segment.color || (segment.i === 0 ? "#22c55e" : "#ef4444")
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

function AnalyticsBarChart({ data }: { data: any[] }) {
  const { t } = useI18n(); // Auto-injected

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

function AnalyticsDurationChart({ data }: { data: any[] }) {
  const { t } = useI18n(); // Auto-injected

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
function EarningsPanel() {

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

// ============ DISTRIBUTION / DDEX COMPONENT ============
function DistributionPanel({ user }: { user: UserSession }) {
  const { t } = useI18n(); // Auto-injected

  const [tab, setTab] = useState<"queue" | "deliveries">("queue");
  const [releases, setReleases] = useState<any[]>([]);
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [dsps, setDsps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [delivering, setDelivering] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(20);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedDsps, setSelectedDsps] = useState<Record<string, string[]>>(
    {},
  );
  const [xmlPreview, setXmlPreview] = useState<{
    releaseTitle: string;
    xml: string;
  } | null>(null);
  const [deliveryDetail, setDeliveryDetail] = useState<any>(null);
  const { showToast } = useToast();

  // Fetch DSP list
  useEffect(() => {
    fetch("/api/ddex/deliver")
      .then((r) => r.json())
      .then((d) => setDsps(d.dsps || []))
      .catch(() => {});
  }, []);

  // Fetch releases ready for distribution
  const fetchReleases = useCallback(async () => {
    if (tab !== "queue") return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("status", "APPROVED");
      params.set("page", String(page));
      params.set("limit", String(limit));
      if (search) params.set("search", search);
      const res = await fetch(`/api/releases?${params}`);
      if (res.ok) {
        const json = await res.json();
        setReleases(json.data || []);
        setTotal(json.total || 0);
        setTotalPages(json.totalPages || 1);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [page, limit, search, tab]);

  // Fetch delivery history
  const fetchDeliveries = useCallback(async () => {
    if (tab !== "deliveries") return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", String(limit));
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (search) params.set("search", search);
      const res = await fetch(`/api/ddex/deliveries?${params}`);
      if (res.ok) {
        const json = await res.json();
        setDeliveries(json.data || []);
        setTotal(json.total || 0);
        setTotalPages(json.totalPages || 1);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [page, limit, statusFilter, search, tab]);

  useEffect(() => {
    if (tab === "queue") fetchReleases();
    else fetchDeliveries();
  }, [tab, fetchReleases, fetchDeliveries]);

  // Reset page when switching tabs
  useEffect(() => {
    setPage(1);
    setSearch("");
    setStatusFilter("all");
  }, [tab]);

  // Toggle DSP selection for a release
  const toggleDsp = (releaseId: string, dspId: string) => {
    setSelectedDsps((prev) => {
      const current = prev[releaseId] || [];
      if (current.includes(dspId)) {
        return { ...prev, [releaseId]: current.filter((d) => d !== dspId) };
      }
      return { ...prev, [releaseId]: [...current, dspId] };
    });
  };

  // Select all DSPs for a release
  const selectAllDsps = (releaseId: string) => {
    setSelectedDsps((prev) => ({
      ...prev,
      [releaseId]: dsps.map((d) => d.id),
    }));
  };

  // Preview ERN XML
  const handlePreviewXml = async (releaseId: string, releaseTitle: string) => {
    try {
      const res = await fetch("/api/ddex/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ releaseId }),
      });
      if (res.ok) {
        const data = await res.json();
        setXmlPreview({ releaseTitle, xml: data.xml });
      } else {
        showToast(t("toast.failedToGenerateXMLPreview", "Failed to generate XML preview"), "error");
      }
    } catch {
      showToast(t("toast.failedToGenerateXMLPreview", "Failed to generate XML preview"), "error");
    }
  };

  // Deliver release to selected DSPs
  const handleDeliver = async (releaseId: string) => {
    const dspIds = selectedDsps[releaseId];
    if (!dspIds || dspIds.length === 0) {
      showToast(t("toast.selectAtLeastOneDSP", "Select at least one DSP"), "warning");
      return;
    }
    setDelivering(releaseId);
    try {
      const res = await fetch("/api/ddex/deliver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ releaseId, dspIds, autoSend: true }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(t("toast.deliveredToDSPs", "Delivered to") + ` ${data.deliveries.length} DSP(s)`, "success");
        if (data.errors.length > 0) {
          showToast(`${t("common.warnings", "Warnings")}: ${data.errors.join(", ")}`, "warning");
        }
        setSelectedDsps((prev) => ({ ...prev, [releaseId]: [] }));
        fetchReleases();
      } else {
        showToast(translateApiError(data.error, t), "error");
      }
    } catch {
      showToast(t("toast.deliveryFailed", "Delivery failed"), "error");
    } finally {
      setDelivering(null);
    }
  };

  // Takedown
  const handleTakedown = async (releaseId: string) => {
    if (
      !confirm(
        t("toast.confirmTakedown", "Are you sure you want to send a takedown for this release to ALL DSPs?"),
      )
    )
      return;
    setDelivering(releaseId);
    try {
      const res = await fetch("/api/ddex/deliver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          releaseId,
          dspIds: dsps.map((d) => d.id),
          messageType: "Takedown",
          autoSend: true,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(t("toast.takedownSentToAllDSPs", "Takedown sent to all DSPs"), "success");
      } else {
        showToast(translateApiError(data.error, t), "error");
      }
    } catch {
      showToast(t("toast.takedownFailed", "Takedown failed"), "error");
    } finally {
      setDelivering(null);
    }
  };

  // Delivery actions (send, retry, confirm)
  const handleDeliveryAction = async (
    deliveryId: string,
    action: "send" | "retry" | "confirm",
  ) => {
    try {
      const res = await fetch(`/api/ddex/deliveries/${deliveryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        showToast(`${t("toast.delivery", "Delivery")} ${action} ${t("toast.successful", "successful")}`, "success");
        fetchDeliveries();
      } else {
        const data = await res.json();
        showToast(translateApiError(data.error, t), "error");
      }
    } catch {
      showToast(`${action} ${t("toast.failed", "failed")}`, "error");
    }
  };

  // View delivery detail (with XML)
  const handleViewDetail = async (deliveryId: string) => {
    try {
      const res = await fetch(`/api/ddex/deliveries/${deliveryId}`);
      if (res.ok) {
        const data = await res.json();
        setDeliveryDetail(data);
      }
    } catch {
      showToast(t("toast.failedToLoadDeliveryDetails", "Failed to load delivery details"), "error");
    }
  };

  // Download XML as file
  const downloadXml = (xml: string, filename: string) => {
    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const statusColor = (s: string) => {
    switch (s) {
      case "confirmed":
        return "text-[var(--accent-text)] bg-[var(--status-success-surface)]";
      case "sent":
        return "text-[var(--status-info)] bg-[var(--status-info-surface)]";
      case "pending":
        return "text-[var(--status-warning)] bg-[var(--status-warning-surface)]";
      case "failed":
        return "text-[var(--status-error)] bg-[var(--status-error-surface)]";
      default:
        return "text-[var(--text-tertiary)] bg-[var(--bg-elevated)]";
    }
  };

  const statusIcon = (s: string) => {
    switch (s) {
      case "confirmed":
        return <CheckCircleIcon size={14} />;
      case "sent":
        return <SendIcon size={14} />;
      case "pending":
        return <PendingIcon size={14} />;
      case "failed":
        return <CancelIcon size={14} />;
      default:
        return null;
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-medium">{t("heading.distributionDDEX", "Distribution (DDEX)")}</h2>
      </div>

      {/* Tab Switcher */}
      <div className="flex gap-1 mb-6 rounded-lg p-1 w-fit border border-[var(--border-primary)]">
        <button
          onClick={() => setTab("queue")}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === "queue" ? "bg-[var(--accent)] text-white" : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"}`}
        >
          Delivery Queue
        </button>
        <button
          onClick={() => setTab("deliveries")}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === "deliveries" ? "bg-[var(--accent)] text-white" : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"}`}
        >
          {t("distribution.deliveryHistory")}
        </button>
      </div>

      {/* Search + Filters */}
      <div className="flex items-center gap-4 mb-4 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <SearchIcon
            size={18}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-disabled)]"
          />
          <input
            type="text"
            placeholder={
              tab === "queue" ? "Search releases…" : "Search deliveries…"
            }
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full pl-9 pr-4 py-2 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
        </div>
        {tab === "deliveries" && (
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          >
            <option value="all">{t("dashboard.allStatus")}</option>
            <option value="pending">{t("statuses.pending")}</option>
            <option value="sent">{t("dashboard.sent")}</option>
            <option value="confirmed">{t("statuses.confirmed")}</option>
            <option value="failed">{t("statuses.failed")}</option>
          </select>
        )}
      </div>

      {/* =========== QUEUE TAB =========== */}
      {tab === "queue" &&
        (loading ? (
          <TableSkeleton rows={5} cols={5} />
        ) : releases.length === 0 ? (
          <div className="text-center py-16 text-[var(--text-disabled)]">
            <LocalShippingIcon size={48} color="#525252" />
            <p className="mt-2">{t("dashboard.noApprovedReleases")}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {releases.map((release) => {
              const selected = selectedDsps[release.id] || [];
              const isDelivering = delivering === release.id;
              return (
                <div
                  key={release.id}
                  style={{ background: "var(--bg-surface)" }}
                  className=" border border-[var(--border-primary)] rounded-xl p-5"
                >
                  <div className="flex items-start gap-4">
                    {/* Cover */}
                    {release.coverUrl ? (
                      <img
                        src={release.coverUrl}
                        alt=""
                        className="w-16 h-16 rounded-lg object-cover"
                      />
                    ) : (
                      <div className="w-16 h-16 rounded-lg  flex items-center justify-center">
                        <AlbumIcon size={28} color="#525252" />
                      </div>
                    )}

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-[var(--text-primary)] truncate">
                        {release.title}
                      </h3>
                      <p className="text-sm text-[var(--text-tertiary)]">
                        {release.artist?.name || "Unknown Artist"} •{" "}
                        {release.label?.name || "No Label"}
                      </p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-[var(--text-disabled)]">
                        {release.ean && <span>EAN: {release.ean}</span>}
                        <span>
                          {release.trackCount || release.tracks?.length || 0}{" "}
                          tracks
                        </span>
                        <span>{release.format}</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() =>
                          handlePreviewXml(release.id, release.title)
                        }
                        className="px-3 py-1.5 text-xs  hover: rounded-lg text-[var(--text-secondary)] transition-colors"
                        title={t("ddex.previewErnXml")}
                      >
                        <VisibilityIcon size={14} /> XML
                      </button>
                      <button
                        onClick={() => handleDeliver(release.id)}
                        disabled={isDelivering || selected.length === 0}
                        className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors flex items-center gap-1 ${
                          selected.length > 0 && !isDelivering
                            ? "bg-[var(--accent)] hover:brightness-110 text-white"
                            : " text-[var(--text-disabled)] cursor-not-allowed"
                        }`}
                      >
                        {isDelivering ? (
                          <span className="animate-spin rounded-full h-3 w-3 border-b-2 border-white inline-block"></span>
                        ) : (
                          <SendIcon size={14} />
                        )}
                        Deliver ({selected.length})
                      </button>
                    </div>
                  </div>

                  {/* DSP Selection Grid */}
                  <div className="mt-4 pt-4 border-t border-[var(--border-primary)]">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-[var(--text-tertiary)] font-medium">
                        Select DSPs:
                      </span>
                      <button
                        onClick={() => selectAllDsps(release.id)}
                        className="text-xs text-[var(--accent-text)] hover:text-[var(--accent-hover)]"
                      >
                        Select All
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {dsps.map((dsp) => (
                        <button
                          key={dsp.id}
                          onClick={() => toggleDsp(release.id, dsp.id)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                            selected.includes(dsp.id)
                              ? "bg-[var(--accent)]/20 border-green-500/50 text-[var(--accent-text)]"
                              : " border-[var(--border-primary)] text-[var(--text-tertiary)] hover:border-[var(--border-primary)]"
                          }`}
                        >
                          <span className="mr-1">{dsp.icon}</span> {dsp.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}

      {/* =========== DELIVERIES TAB =========== */}
      {tab === "deliveries" &&
        (loading ? (
          <TableSkeleton rows={6} cols={7} />
        ) : deliveries.length === 0 ? (
          <div className="text-center py-16 text-[var(--text-disabled)]">
            <SendIcon size={48} color="#525252" />
            <p className="mt-2">{t("dashboard.noDeliveriesFound")}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[var(--text-tertiary)] text-sm border-b border-[var(--border-primary)]">
                  <th className="pb-3 font-medium">{t("dashboard.release")}</th>
                  <th className="pb-3 font-medium">{t("dashboard.dsp")}</th>
                  <th className="pb-3 font-medium">{t("dashboard.type")}</th>
                  <th className="pb-3 font-medium">{t("common.status")}</th>
                  <th className="pb-3 font-medium">{t("dashboard.sent")}</th>
                  <th className="pb-3 font-medium">{t("statuses.confirmed")}</th>
                  <th className="pb-3 font-medium text-right">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr
                    key={d.id}
                    className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)]"
                  >
                    <td className="py-3">
                      <div>
                        <p className="font-medium text-[var(--text-primary)] text-sm truncate max-w-[200px]">
                          {d.release?.title || "—"}
                        </p>
                        <p className="text-xs text-[var(--text-disabled)]">
                          {d.release?.artist?.name}
                        </p>
                      </div>
                    </td>
                    <td className="py-3">
                      <span className="text-sm capitalize">
                        {dsps.find((x) => x.id === d.dspName)?.name ||
                          d.dspName}
                      </span>
                    </td>
                    <td className="py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs ${d.messageType === "Takedown" ? "bg-[var(--status-error-surface)] text-[var(--status-error)]" : "bg-[var(--status-info-surface)] text-[var(--status-info)]"}`}
                      >
                        {d.messageType}
                      </span>
                    </td>
                    <td className="py-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs ${statusColor(d.status)}`}
                      >
                        {statusIcon(d.status)}
                        <span className="capitalize">{d.status}</span>
                      </span>
                    </td>
                    <td className="py-3 text-sm text-[var(--text-tertiary)]">
                      {d.sentAt ? new Date(d.sentAt).toLocaleString() : "—"}
                    </td>
                    <td className="py-3 text-sm text-[var(--text-tertiary)]">
                      {d.confirmedAt
                        ? new Date(d.confirmedAt).toLocaleString()
                        : "—"}
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleViewDetail(d.id)}
                          className="p-1.5 hover: rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                          title={t("common.viewDetails")}
                        >
                          <VisibilityIcon size={16} />
                        </button>
                        {d.status === "pending" && (
                          <button
                            onClick={() => handleDeliveryAction(d.id, "send")}
                            className="p-1.5 hover: rounded-lg text-[var(--status-info)] hover:text-blue-300 transition-colors"
                            title={t("common.send")}
                          >
                            <SendIcon size={16} />
                          </button>
                        )}
                        {d.status === "failed" && (
                          <button
                            onClick={() => handleDeliveryAction(d.id, "retry")}
                            className="p-1.5 hover: rounded-lg text-[var(--status-warning)] hover:text-amber-300 transition-colors"
                            title={t("common.retry")}
                          >
                            <RefreshIcon size={16} />
                          </button>
                        )}
                        {d.status === "sent" && (
                          <button
                            onClick={() =>
                              handleDeliveryAction(d.id, "confirm")
                            }
                            className="p-1.5 hover: rounded-lg text-[var(--accent-text)] hover:text-[var(--accent-hover)] transition-colors"
                            title={t("common.confirm")}
                          >
                            <CheckCircleIcon size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

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

      {/* XML Preview Modal */}
      {xmlPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => setXmlPreview(null)}
          ></div>
          <div className="relative rounded-xl border border-[var(--border-primary)] w-full max-w-3xl mx-4 shadow-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-primary)] shrink-0">
              <h3 className="text-lg font-medium">
                ERN XML — {xmlPreview.releaseTitle}
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() =>
                    downloadXml(
                      xmlPreview.xml,
                      `ERN_${xmlPreview.releaseTitle.replace(/\s+/g, "_")}.xml`,
                    )
                  }
                  className="px-3 py-1.5 text-xs bg-[var(--accent)] hover:brightness-110 rounded-lg text-white font-medium flex items-center gap-1"
                >
                  <DownloadIcon size={14} /> {t("common.download")}
                </button>
                <button
                  onClick={() => setXmlPreview(null)}
                  className="p-1 hover: rounded-lg"
                >
                  <CloseIcon size={20} />
                </button>
              </div>
            </div>
            <div className="p-6 overflow-auto flex-1">
              <pre className="text-xs text-[var(--text-secondary)] font-mono whitespace-pre-wrap break-all bg-transparent rounded-lg p-4 border border-[var(--border-primary)]">
                {xmlPreview.xml}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Delivery Detail Modal */}
      {deliveryDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => setDeliveryDetail(null)}
          ></div>
          <div className="relative rounded-xl border border-[var(--border-primary)] w-full max-w-3xl mx-4 shadow-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-primary)] shrink-0">
              <div>
                <h3 className="text-lg font-medium">{t("heading.deliveryDetail", "Delivery Detail")}</h3>
                <p className="text-sm text-[var(--text-tertiary)] mt-0.5">
                  {deliveryDetail.release?.title} →{" "}
                  {dsps.find((x) => x.id === deliveryDetail.dspName)?.name ||
                    deliveryDetail.dspName}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {deliveryDetail.xmlContent && (
                  <button
                    onClick={() =>
                      downloadXml(
                        deliveryDetail.xmlContent,
                        `delivery_${deliveryDetail.id}.xml`,
                      )
                    }
                    className="px-3 py-1.5 text-xs bg-[var(--accent)] hover:brightness-110 rounded-lg text-white font-medium flex items-center gap-1"
                  >
                    <DownloadIcon size={14} /> Download XML
                  </button>
                )}
                <button
                  onClick={() => setDeliveryDetail(null)}
                  className="p-1 hover: rounded-lg"
                >
                  <CloseIcon size={20} />
                </button>
              </div>
            </div>
            <div className="p-6 overflow-auto flex-1 space-y-4">
              {/* Status Info */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-[var(--text-disabled)]">{t("common.status")}</p>
                  <span
                    className={`inline-flex items-center gap-1 mt-1 px-2 py-1 rounded text-xs ${statusColor(deliveryDetail.status)}`}
                  >
                    {statusIcon(deliveryDetail.status)}
                    <span className="capitalize">{deliveryDetail.status}</span>
                  </span>
                </div>
                <div>
                  <p className="text-xs text-[var(--text-disabled)]">{t("dashboard.type")}</p>
                  <p className="text-sm text-[var(--text-primary)] mt-1">
                    {deliveryDetail.messageType}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--text-disabled)]">
                    ERN Version
                  </p>
                  <p className="text-sm text-[var(--text-primary)] mt-1">
                    {deliveryDetail.ernVersion}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--text-disabled)]">
                    Batch ID
                  </p>
                  <p className="text-sm text-[var(--text-tertiary)] mt-1 font-mono text-xs truncate">
                    {deliveryDetail.batchId}
                  </p>
                </div>
              </div>

              {/* Timeline */}
              <div>
                <p className="text-xs text-[var(--text-disabled)] mb-2">
                  Timeline
                </p>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-[var(--accent)] text-white"></div>
                    <span className="text-[var(--text-tertiary)]">
                      Created:
                    </span>
                    <span className="text-[var(--text-primary)]">
                      {new Date(deliveryDetail.createdAt).toLocaleString()}
                    </span>
                  </div>
                  {deliveryDetail.sentAt && (
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-[var(--status-info)] text-white"></div>
                      <span className="text-[var(--text-tertiary)]">{t("dashboard.sent")}:</span>
                      <span className="text-[var(--text-primary)]">
                        {new Date(deliveryDetail.sentAt).toLocaleString()}
                      </span>
                    </div>
                  )}
                  {deliveryDetail.confirmedAt && (
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-[var(--accent)] text-white"></div>
                      <span className="text-[var(--text-tertiary)]">
                        Confirmed:
                      </span>
                      <span className="text-[var(--text-primary)]">
                        {new Date(deliveryDetail.confirmedAt).toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Error Log */}
              {deliveryDetail.errorLog && (
                <div>
                  <p className="text-xs text-[var(--status-error)] mb-1">
                    Error Log
                  </p>
                  <pre className="text-xs text-red-300 bg-[var(--status-error)]/5 border border-red-500/20 rounded-lg p-3 whitespace-pre-wrap">
                    {deliveryDetail.errorLog}
                  </pre>
                </div>
              )}

              {/* XML Content */}
              {deliveryDetail.xmlContent && (
                <div>
                  <p className="text-xs text-[var(--text-disabled)] mb-1">
                    XML Content
                  </p>
                  <pre className="text-xs text-[var(--text-secondary)] font-mono whitespace-pre-wrap break-all bg-[var(--bg-elevated)] rounded-lg p-4 border border-[var(--border-primary)] max-h-64 overflow-auto">
                    {deliveryDetail.xmlContent}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============ ENTITIES PANEL ============
function EntitiesPanel({ user }: { user: UserSession }) {
  const { t } = useI18n();
  const [entities, setEntities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [typeFilter, setTypeFilter] = useState("");
  const [createModal, setCreateModal] = useState(false);
  const [detailEntity, setDetailEntity] = useState<any>(null);
  const [isEditingDetail, setIsEditingDetail] = useState(false);
  const [editData, setEditData] = useState<any>(null);
  const [isInvitingDetail, setIsInvitingDetail] = useState(false);
  const [inviteModal, setInviteModal] = useState<{ open: boolean; entityId: string; entityName: string }>({ open: false, entityId: "", entityName: "" });
  const [createData, setCreateData] = useState({ officialName: "", entityType: "ORGANIZATION", category: "LABEL", description: "" });
  const [inviteData, setInviteData] = useState({ email: "", role: "MEMBER" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { showToast } = useToast();

  const fetchEntities = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (typeFilter) params.set("type", typeFilter);
      params.set("page", String(page));
      params.set("limit", "20");
      const res = await fetch(`/api/entities?${params}`);
      if (res.ok) {
        const json = await res.json();
        setEntities(json.data || []);
        setTotal(json.total || 0);
        setTotalPages(json.totalPages || 1);
      }
    } catch (e) {
      console.error("Error fetching entities:", e);
    } finally {
      setLoading(false);
    }
  }, [search, typeFilter, page]);

  useEffect(() => { fetchEntities(); }, [fetchEntities]);

  const handleCreate = async () => {
    if (!createData.officialName.trim()) { setError("Name is required"); return; }
    setSaving(true);
    setError("");
    try {
      const payload: any = { ...createData };
      if (payload.entityType === "ORGANIZATION") {
        payload.metadata = { category: payload.category };
      }
      delete payload.category;

      const res = await fetch("/api/entities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        showToast("Entity created successfully", "success");
        setCreateModal(false);
        setCreateData({ officialName: "", entityType: "ORGANIZATION", category: "LABEL", description: "" });
        fetchEntities();
      } else {
        const json = await res.json();
        setError(translateApiError(json.error || "Failed to create entity", t));
      }
    } catch { setError("Network error"); }
    finally { setSaving(false); }
  };

  const handleInvite = async (isInline = false) => {
    if (!inviteData.email.trim()) { setError("Email is required"); return; }
    setSaving(true);
    setError("");
    try {
      const targetEntityId = isInline ? detailEntity.id : inviteModal.entityId;
      const res = await fetch("/api/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...inviteData, entityId: targetEntityId }),
      });
      if (res.ok) {
        showToast(`Invitation sent to ${inviteData.email}`, "success");
        if (!isInline) {
           setInviteModal({ open: false, entityId: "", entityName: "" });
        } else {
           setIsInvitingDetail(false);
        }
        setInviteData({ email: "", role: "MEMBER" });
        if (detailEntity?.id === targetEntityId) fetchEntityDetail(detailEntity.id);
      } else {
        const json = await res.json();
        setError(translateApiError(json.error || "Failed to send invitation", t));
      }
    } catch { setError("Network error"); }
    finally { setSaving(false); }
  };

  const handleRevokeInvite = async (inviteId: string) => {
    if (!confirm("Are you sure you want to revoke this invitation?")) return;
    try {
      const res = await fetch(`/api/invitations/${inviteId}`, { method: "DELETE" });
      if (res.ok) {
        showToast("Invitation revoked successfully", "success");
        if (detailEntity) fetchEntityDetail(detailEntity.id);
      } else {
        const json = await res.json();
        showToast(translateApiError(json.error || "Failed to revoke invitation", t), "error");
      }
    } catch {
      showToast("Network error", "error");
    }
  };

  const fetchEntityDetail = async (id: string) => {
    try {
      const res = await fetch(`/api/entities/${id}`);
      if (res.ok) {
        const json = await res.json();
        setDetailEntity(json);
      }
    } catch (e) {
      console.error("Error fetching entity detail:", e);
    }
  };

  const [editModal, setEditModal] = useState<{ open: boolean; data: any }>({ open: false, data: null });

  const handleUpdate = async (isInline = false) => {
    const dataToUse = isInline ? editData : editModal.data;
    if (!dataToUse?.officialName?.trim()) { setError("Name is required"); return; }
    setSaving(true);
    setError("");
    try {
      const payload: any = { ...dataToUse };
      if (payload.entityType === "ORGANIZATION") {
        payload.metadata = { category: payload.category };
      }
      delete payload.category;

      const res = await fetch(`/api/entities/${payload.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        showToast("Entity updated successfully", "success");
        if (!isInline) {
            setEditModal({ open: false, data: null });
        } else {
            setIsEditingDetail(false);
        }
        fetchEntities();
        if (detailEntity?.id === payload.id) fetchEntityDetail(payload.id);
      } else {
        const json = await res.json();
        setError(translateApiError(json.error || "Failed to update entity", t));
      }
    } catch { setError("Network error"); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this entity? This will delete all associated data (cascading).")) return;
    try {
      const res = await fetch(`/api/entities/${id}`, { method: "DELETE" });
      if (res.ok) {
        showToast("Entity deleted successfully", "success");
        setDetailEntity(null);
        fetchEntities();
      } else {
        const json = await res.json();
        showToast(translateApiError(json.error || "Failed to delete entity", t), "error");
      }
    } catch (e) {
      showToast("Network error", "error");
    }
  };

  const entityTypeLabel = (type: string, category?: string) => {
    const map: Record<string, string> = {
      SUPER_ADMIN: "Super Admin",
      SYSTEM_ADMIN: "System Admin",
      ORGANIZATION: category ? (category.charAt(0).toUpperCase() + category.slice(1).toLowerCase()) : "Organization",
      SUB_ACCOUNT: "Sub-Account",
    };
    return map[type] || type;
  };

  const entityTypeColor = (type: string) => {
    const map: Record<string, string> = {
      SUPER_ADMIN: "var(--status-error)",
      SYSTEM_ADMIN: "var(--accent)",
      ORGANIZATION: "var(--status-success)",
      SUB_ACCOUNT: "var(--status-warning)",
    };
    return map[type] || "var(--text-secondary)";
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
            {t("entities.title", "Organizations & Entities")}
          </h2>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
            {t("entities.subtitle", "Manage your B2B2B hierarchy")} · {total} {t("entities.entities", "entities")}
          </p>
        </div>
        {user.permissions.includes("entity.create") && (
          <button
            onClick={() => setCreateModal(true)}
            className="px-4 py-2.5 rounded-xl text-sm font-medium text-white transition-all duration-200"
            style={{ background: "var(--accent)" }}
          >
            <AddIcon size={16} /> {t("entities.create", "Create Entity")}
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="flex-1 min-w-[200px]">
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder={t("entities.searchPlaceholder", "Search entities...")}
            className="w-full px-4 py-2.5 rounded-xl text-sm"
            style={{ background: "var(--bg-surface)", border: "1px solid var(--border-primary)", color: "var(--text-primary)" }}
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          className="px-4 py-2.5 rounded-xl text-sm"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--border-primary)", color: "var(--text-primary)" }}
        >
          <option value="">{t("entities.allTypes", "All Types")}</option>
          <option value="ORGANIZATION">{t("entities.organization", "Organization")}</option>
          <option value="SUB_ACCOUNT">{t("entities.subAccount", "Sub-Account")}</option>
          <option value="SYSTEM_ADMIN">{t("entities.systemAdmin", "System Admin")}</option>
        </select>
      </div>

      {/* Entity List */}
      {loading ? (
        <TableSkeleton rows={5} />
      ) : entities.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
            {t("entities.noEntities", "No entities found")}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {entities.map((entity) => (
            <div
              key={entity.id}
              className="rounded-xl p-4 transition-all duration-200 cursor-pointer"
              style={{ background: "var(--bg-surface)", border: "1px solid var(--border-primary)" }}
              onClick={() => fetchEntityDetail(entity.id)}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-primary)"; }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold"
                    style={{ background: "var(--bg-elevated)", color: entityTypeColor(entity.entityType) }}>
                    {entity.officialName?.charAt(0)?.toUpperCase() || "E"}
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                      {entity.officialName}
                    </h3>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                        style={{ background: "var(--bg-elevated)", color: entityTypeColor(entity.entityType) }}>
                        {entityTypeLabel(entity.entityType, (entity.metadata as any)?.category)}
                      </span>
                      {entity.parent && (
                        <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                          · {entity.parent.officialName}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-xs" style={{ color: "var(--text-tertiary)" }}>
                  <span>{entity._count?.userRoles || 0} members</span>
                  <span>{entity._count?.labels || 0} labels</span>
                  <span>{entity._count?.releases || 0} releases</span>
                  {user.permissions.includes("entity.invite") && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setInviteModal({ open: true, entityId: entity.id, entityName: entity.officialName }); }}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                      style={{ background: "var(--accent-surface)", color: "var(--accent-text)" }}
                    >
                      {t("entities.invite", "Invite")}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} total={total} limit={20} onPageChange={setPage} />
      )}

      {/* Create Entity Modal */}
      {createModal && (
        <Modal isOpen={createModal} onClose={() => { setCreateModal(false); setError(""); }} title={t("entities.createTitle", "Create New Entity")}>
          <div className="space-y-4">
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                {t("entities.name", "Official Name")}
              </label>
              <input
                type="text" value={createData.officialName}
                onChange={(e) => setCreateData({ ...createData, officialName: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl text-sm"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-primary)", color: "var(--text-primary)" }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                {t("entities.type", "Entity Type")}
              </label>
              <select
                value={createData.entityType}
                onChange={(e) => setCreateData({ ...createData, entityType: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl text-sm"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-primary)", color: "var(--text-primary)" }}
              >
                {user.entityType === "SYSTEM_ADMIN" || user.entityType === "SUPER_ADMIN" ? (
                  <option value="ORGANIZATION">Organization</option>
                ) : null}
                {user.entityType === "ORGANIZATION" ? (
                  <option value="SUB_ACCOUNT">Sub-Account</option>
                ) : null}
              </select>
            </div>
            {createData.entityType === "ORGANIZATION" && (
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                  {t("entities.category", "Category")}
                </label>
                <select
                  value={createData.category}
                  onChange={(e) => setCreateData({ ...createData, category: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl text-sm"
                  style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-primary)", color: "var(--text-primary)" }}
                >
                  <option value="DISTRIBUTOR">Distributor</option>
                  <option value="LABEL">Label</option>
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                {t("entities.description", "Description")}
              </label>
              <textarea
                value={createData.description}
                onChange={(e) => setCreateData({ ...createData, description: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl text-sm h-20 resize-none"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-primary)", color: "var(--text-primary)" }}
              />
            </div>
            <button onClick={handleCreate} disabled={saving}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
              style={{ background: saving ? "var(--text-disabled)" : "var(--accent)" }}>
              {saving ? t("common.saving", "Saving...") : t("entities.create", "Create Entity")}
            </button>
          </div>
        </Modal>
      )}

      {/* Edit Modal */}
      {editModal.open && editModal.data && (
        <Modal isOpen={editModal.open} onClose={() => { setEditModal({ open: false, data: null }); setError(""); }} title={t("common.edit", "Edit Entity")}>
          <div className="space-y-4">
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                {t("entities.name", "Official Name")}
              </label>
              <input
                type="text" value={editModal.data.officialName}
                onChange={(e) => setEditModal({ ...editModal, data: { ...editModal.data, officialName: e.target.value } })}
                className="w-full px-3 py-2.5 rounded-xl text-sm"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-primary)", color: "var(--text-primary)" }}
              />
            </div>
            {editModal.data.entityType === "ORGANIZATION" && (
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                  {t("entities.category", "Category")}
                </label>
                <select
                  value={editModal.data.category}
                  onChange={(e) => setEditModal({ ...editModal, data: { ...editModal.data, category: e.target.value } })}
                  className="w-full px-3 py-2.5 rounded-xl text-sm"
                  style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-primary)", color: "var(--text-primary)" }}
                >
                  <option value="DISTRIBUTOR">Distributor</option>
                  <option value="LABEL">Label</option>
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                {t("entities.description", "Description")}
              </label>
              <textarea
                value={editModal.data.description || ""}
                onChange={(e) => setEditModal({ ...editModal, data: { ...editModal.data, description: e.target.value } })}
                className="w-full px-3 py-2.5 rounded-xl text-sm h-20 resize-none"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-primary)", color: "var(--text-primary)" }}
              />
            </div>
            <button onClick={() => handleUpdate()} disabled={saving}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
              style={{ background: saving ? "var(--text-disabled)" : "var(--accent)" }}>
              {saving ? t("common.saving", "Saving...") : t("common.save", "Save Changes")}
            </button>
          </div>
        </Modal>
      )}

      {/* Invite Modal */}
      {inviteModal.open && (
        <Modal isOpen={inviteModal.open} onClose={() => { setInviteModal({ open: false, entityId: "", entityName: "" }); setError(""); }}
          title={`${t("entities.inviteTo", "Invite to")} ${inviteModal.entityName}`}>
          <div className="space-y-4">
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                {t("entities.inviteEmail", "Email Address")}
              </label>
              <input type="email" value={inviteData.email}
                onChange={(e) => setInviteData({ ...inviteData, email: e.target.value })}
                placeholder="user@example.com"
                className="w-full px-3 py-2.5 rounded-xl text-sm"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-primary)", color: "var(--text-primary)" }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                {t("entities.inviteRole", "Role")}
              </label>
              <select value={inviteData.role}
                onChange={(e) => setInviteData({ ...inviteData, role: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl text-sm"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-primary)", color: "var(--text-primary)" }}>
                <option value="MEMBER">Member</option>
                <option value="ADMIN">Admin</option>
                <option value="OWNER">Owner</option>
              </select>
            </div>
            <button onClick={handleInvite} disabled={saving}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
              style={{ background: saving ? "var(--text-disabled)" : "var(--accent)" }}>
              {saving ? t("common.sending", "Sending...") : t("entities.sendInvite", "Send Invitation")}
            </button>
          </div>
        </Modal>
      )}

      {/* Entity Detail Drawer */}
      {detailEntity && (
        <div className="fixed inset-0 z-50 flex justify-end" style={{ animation: "backdropIn 0.2s ease-out" }}>
          <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }} onClick={() => { setDetailEntity(null); setIsEditingDetail(false); setIsInvitingDetail(false); setError(""); }} />
          <div className="relative w-full max-w-lg h-full overflow-y-auto"
            style={{ background: "var(--bg-primary)", borderLeft: "1px solid var(--border-primary)", animation: "modalIn 0.25s cubic-bezier(0.2, 0, 0, 1)" }}>
            <div className="p-6 space-y-6">
              {/* Header */}
              {isEditingDetail ? (
                <div className="space-y-4 p-4 rounded-xl border border-[var(--border-primary)]" style={{ background: "var(--bg-surface)" }}>
                   <div className="flex items-center justify-between mb-2">
                     <h2 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>{t("common.edit", "Edit Entity")}</h2>
                     <button onClick={() => { setIsEditingDetail(false); setError(""); }} className="p-2 rounded-lg" style={{ color: "var(--text-tertiary)" }}>
                       <CloseIcon size={18} />
                     </button>
                   </div>
                   {error && <p className="text-sm text-red-500">{error}</p>}
                   <div>
                     <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>{t("entities.name", "Official Name")}</label>
                     <input type="text" value={editData?.officialName || ""} onChange={(e) => setEditData({ ...editData, officialName: e.target.value })}
                       className="w-full px-3 py-2.5 rounded-xl text-sm" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-primary)", color: "var(--text-primary)" }} />
                   </div>
                   {editData?.entityType === "ORGANIZATION" && (
                     <div>
                       <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>{t("entities.category", "Category")}</label>
                       <select value={editData?.category || "LABEL"} onChange={(e) => setEditData({ ...editData, category: e.target.value })}
                         className="w-full px-3 py-2.5 rounded-xl text-sm" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-primary)", color: "var(--text-primary)" }}>
                         <option value="DISTRIBUTOR">Distributor</option>
                         <option value="LABEL">Label</option>
                       </select>
                     </div>
                   )}
                   <div>
                     <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>{t("entities.description", "Description")}</label>
                     <textarea value={editData?.description || ""} onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                       className="w-full px-3 py-2.5 rounded-xl text-sm h-20 resize-none" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-primary)", color: "var(--text-primary)" }} />
                   </div>
                   <div className="flex gap-2 pt-2">
                     <button onClick={() => setIsEditingDetail(false)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all border border-[var(--border-primary)]" style={{ color: "var(--text-primary)" }}>{t("common.cancel", "Cancel")}</button>
                     <button onClick={() => handleUpdate(true)} disabled={saving} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-all" style={{ background: saving ? "var(--text-disabled)" : "var(--accent)" }}>
                       {saving ? t("common.saving", "Saving...") : t("common.apply", "Apply Changes")}
                     </button>
                   </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>{detailEntity.officialName}</h2>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full mt-1 inline-block"
                      style={{ background: "var(--bg-elevated)", color: entityTypeColor(detailEntity.entityType) }}>
                      {entityTypeLabel(detailEntity.entityType, (detailEntity.metadata as any)?.category)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {user.permissions.includes("entity.update") && (
                      <button
                        onClick={() => { setIsEditingDetail(true); setError(""); setEditData({ ...detailEntity, category: (detailEntity.metadata as any)?.category || "LABEL" }); }}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                        style={{ background: "var(--bg-surface)", border: "1px solid var(--border-primary)", color: "var(--text-primary)" }}
                      >
                        {t("common.edit", "Edit")}
                      </button>
                    )}
                    {(user.entityType === "SUPER_ADMIN" || user.entityType === "SYSTEM_ADMIN") && (
                      <button
                        onClick={() => { handleDelete(detailEntity.id); }}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                        style={{ background: "var(--status-error)", color: "white" }}
                      >
                        {t("common.delete", "Delete")}
                      </button>
                    )}
                    <button onClick={() => { setDetailEntity(null); setIsEditingDetail(false); setIsInvitingDetail(false); setError(""); }} className="p-2 rounded-lg" style={{ color: "var(--text-tertiary)" }}>
                      <CloseIcon size={18} />
                    </button>
                  </div>
                </div>
              )}

              {/* Stats */}
              {!isEditingDetail && (
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Members", value: detailEntity.userRoles?.length || 0 },
                    { label: "Children", value: detailEntity.children?.length || 0 },
                    { label: "Labels", value: detailEntity._count?.labels || 0 },
                    { label: "Releases", value: detailEntity._count?.releases || 0 },
                  ].map((stat) => (
                    <div key={stat.label} className="rounded-xl p-3" style={{ background: "var(--bg-surface)", border: "1px solid var(--border-primary)" }}>
                      <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>{stat.label}</p>
                      <p className="text-lg font-bold mt-0.5" style={{ color: "var(--text-primary)" }}>{stat.value}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Members */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Members</h3>
                  {user.permissions.includes("entity.invite") && !isInvitingDetail && (
                    <button onClick={() => { setIsInvitingDetail(true); setError(""); }}
                      className="text-xs font-medium px-3 py-1.5 rounded-lg" style={{ background: "var(--accent-surface)", color: "var(--accent-text)" }}>
                      + Invite
                    </button>
                  )}
                </div>
                
                {/* Inline Invite Form */}
                {isInvitingDetail && (
                   <div className="p-4 rounded-xl border border-[var(--border-primary)] mb-4" style={{ background: "var(--bg-surface)" }}>
                     <div className="flex items-center justify-between mb-3">
                       <h4 className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>{t("entities.inviteNewMember", "Invite New Member")}</h4>
                       <button onClick={() => { setIsInvitingDetail(false); setError(""); }} className="p-1 rounded text-[var(--text-tertiary)]"><CloseIcon size={14} /></button>
                     </div>
                     {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
                     <div className="space-y-3">
                       <div>
                         <label className="block text-xs mb-1" style={{ color: "var(--text-secondary)" }}>{t("entities.inviteEmail", "Email Address")}</label>
                         <input type="email" value={inviteData.email} onChange={(e) => setInviteData({ ...inviteData, email: e.target.value })}
                           placeholder="user@example.com" className="w-full px-3 py-2 rounded-lg text-xs" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-primary)", color: "var(--text-primary)" }} />
                       </div>
                       <div>
                         <label className="block text-xs mb-1" style={{ color: "var(--text-secondary)" }}>{t("entities.inviteRole", "Role")}</label>
                         <select value={inviteData.role} onChange={(e) => setInviteData({ ...inviteData, role: e.target.value })}
                           className="w-full px-3 py-2 rounded-lg text-xs" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-primary)", color: "var(--text-primary)" }}>
                           <option value="MEMBER">Member</option>
                           <option value="ADMIN">Admin</option>
                           <option value="OWNER">Owner</option>
                         </select>
                       </div>
                       <button onClick={() => handleInvite(true)} disabled={saving} className="w-full py-2 rounded-lg text-xs font-semibold text-white transition-all" style={{ background: saving ? "var(--text-disabled)" : "var(--accent)" }}>
                         {saving ? t("common.sending", "Sending...") : t("common.apply", "Apply")}
                       </button>
                     </div>
                   </div>
                )}
                
                <div className="space-y-2">
                  {detailEntity.userRoles?.map((ur: any) => (
                    <div key={ur.id} className="flex items-center justify-between py-2 px-3 rounded-lg"
                      style={{ background: "var(--bg-elevated)" }}>
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold"
                          style={{ background: "var(--bg-surface)", color: "var(--text-secondary)" }}>
                          {(ur.user?.name || ur.user?.email)?.[0]?.toUpperCase() || "?"}
                        </div>
                        <div>
                          <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>{ur.user?.name || ur.user?.email}</p>
                          <p className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>{ur.user?.email}</p>
                        </div>
                      </div>
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: "var(--bg-surface)", color: "var(--accent)" }}>
                        {ur.role}
                      </span>
                    </div>
                  ))}
                  {(!detailEntity.userRoles || detailEntity.userRoles.length === 0) && (
                    <p className="text-xs text-center py-4" style={{ color: "var(--text-tertiary)" }}>No members yet</p>
                  )}
                </div>
              </div>

              {/* Pending Invitations */}
              {detailEntity.invitations?.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-3 mt-6">
                    <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Pending Invitations</h3>
                  </div>
                  <div className="space-y-2">
                    {detailEntity.invitations.map((invite: any) => (
                      <div key={invite.id} className="flex items-center justify-between py-2 px-3 rounded-lg"
                        style={{ background: "var(--bg-elevated)" }}>
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold"
                            style={{ background: "var(--bg-surface)", color: "var(--text-secondary)" }}>
                            {invite.email[0].toUpperCase()}
                          </div>
                          <div>
                            <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>{invite.email}</p>
                            <p className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>Expires: {new Date(invite.expiresAt).toLocaleDateString()}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: "var(--bg-surface)", color: "var(--accent)" }}>
                            {invite.role}
                          </span>
                          {user.permissions.includes("entity.invite") && (
                            <button onClick={() => handleRevokeInvite(invite.id)} className="text-[10px] font-medium px-2 py-0.5 rounded-full hover:bg-red-500 hover:text-white transition-colors" style={{ color: "var(--status-error)", border: "1px solid var(--status-error)" }}>
                              Revoke
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Children */}
              {detailEntity.children?.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Child Entities</h3>
                  <div className="space-y-2">
                    {detailEntity.children.map((child: any) => (
                      <div key={child.id} className="flex items-center justify-between py-2 px-3 rounded-lg cursor-pointer"
                        style={{ background: "var(--bg-elevated)" }}
                        onClick={() => fetchEntityDetail(child.id)}>
                        <div>
                          <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>{child.officialName}</p>
                          <span className="text-[10px]" style={{ color: entityTypeColor(child.entityType) }}>{entityTypeLabel(child.entityType, (child.metadata as any)?.category)}</span>
                        </div>
                        <ArrowUpRightIcon size={14} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============ USERS COMPONENT ============
function UsersPanel({ user }: { user: UserSession }) {
  const { t } = useI18n(); // Auto-injected

  const [users, setUsers] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(20);
  const [editModal, setEditModal] = useState<{
    open: boolean;
    user: any | null;
  }>({ open: false, user: null });
  const [createModal, setCreateModal] = useState(false);
  const [editModalTab, setEditModalTab] = useState("profile");
  const [formData, setFormData] = useState({
    name: "",
    stageName: "",
    phone: "",
    avatar: "",
    email: "",
    password: "",
    roleId: "",
    isBanned: false,
    banReason: "",
    entityRole: "MEMBER",
    entityId: "",
    entityType: "",
  });
  const [createData, setCreateData] = useState({
    email: "",
    password: "",
    phone: "",
    name: "",
    roleId: "",
    // Entity linking
    entityMode: "new" as "new" | "existing", // "new" = create new entity, "existing" = link existing
    entityName: "",     // name for new entity
    entityId: "",       // ID of existing entity to link
  });
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState("");
  const [editError, setEditError] = useState("");
  // Entity lists for linking dropdowns
  const [distributors, setDistributors] = useState<any[]>([]);
  const [labels, setLabels] = useState<any[]>([]);
  const [artists, setArtists] = useState<any[]>([]);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      params.set("page", String(page));
      params.set("limit", String(limit));
      const res = await fetch(`/api/users?${params}`);
      if (res.ok) {
        const json = await res.json();
        setUsers(json.data || json);
        setTotal(json.total || 0);
        setTotalPages(json.totalPages || 1);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [search, page, limit]);

  const fetchRoles = async () => {
    try {
      const res = await fetch("/api/roles");
      if (res.ok) setRoles(await res.json());
    } catch (e) {
      console.error(e);
    }
  };

  const fetchEntities = async () => {
    try {
      const [distRes, labelRes, artistRes] = await Promise.all([
        fetch("/api/entities?type=ORGANIZATION&limit=200"),
        fetch("/api/labels?limit=200"),
        fetch("/api/artists?limit=200"),
      ]);
      if (distRes.ok) { const d = await distRes.json(); setDistributors(d.data || d || []); }
      if (labelRes.ok) { const d = await labelRes.json(); setLabels(d.data || d || []); }
      if (artistRes.ok) { const d = await artistRes.json(); setArtists(d.data || d || []); }
    } catch (e) {
      console.error(e);
    }
  };

  // Resolve selected role name from roleId
  const selectedRoleName = roles.find((r: any) => r.id === createData.roleId)?.name || "";

  useEffect(() => {
    fetchUsers();
    fetchRoles();
    fetchEntities();
  }, [fetchUsers]);

  const openEditModal = (u: any) => {
    setFormData({
      name: u.name || "",
      stageName: u.stageName || "",
      phone: u.phone || "",
      avatar: u.avatar || "",
      email: u.email || "",
      password: "",
      roleId: u.roles?.[0]?.id || "",
      isBanned: u.isBanned || false,
      banReason: u.banReason || "",
      entityRole: u.entities?.[0]?.role || "MEMBER",
      entityId: u.entities?.[0]?.entityId || "",
      entityType: u.entities?.[0]?.entityType || "",
    });
    setEditModalTab("profile");
    setEditModal({ open: true, user: u });
  };

  const handleSave = async () => {
    if (!editModal.user) return;
    setEditError("");

    // Validate email
    if (
      !formData.email.trim() ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)
    ) {
      setEditError("• Email is required and must be valid");
      return;
    }

    // Validate phone format if provided
    if (formData.phone && !/^\+?[0-9\s-]{7,20}$/.test(formData.phone)) {
      setEditError("• Phone number format is invalid");
      return;
    }

    // Validate password complexity if changing
    if (formData.password) {
      if (formData.password.length < 8) {
        setEditError("• Password must be at least 8 characters");
        return;
      }
      if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(formData.password)) {
        setEditError(
          "• Password must contain uppercase, lowercase, and a number",
        );
        return;
      }
    }

    setSaving(true);
    try {
      const payload: any = { ...formData };
      if (!payload.password) delete payload.password; // Don't send empty password
      if (payload.roleId) {
        payload.roles = [payload.roleId];
      }

      const res = await fetch(`/api/users/${editModal.user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setEditModal({ open: false, user: null });
        fetchUsers();
      } else {
        const data = await res.json();
        setEditError(translateApiError(data.error, t));
      }
    } catch (e) {
      console.error(e);
      setEditError("An error occurred");
    } finally {
      setSaving(false);
    }
  };

  const handleCreateUser = async () => {
    setCreateError("");
    const errors: string[] = [];

    if (!createData.name.trim() || createData.name.trim().length < 2)
      errors.push("• Name is required (min 2 characters)");
    if (!createData.email.trim()) errors.push("• Email is required");
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(createData.email))
      errors.push("• Email format is invalid");
    if (!createData.password.trim()) errors.push("• Password is required");
    else if (createData.password.length < 8)
      errors.push("• Password must be at least 8 characters");
    else if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(createData.password))
      errors.push("• Password must contain uppercase, lowercase, and a number");
    if (!createData.roleId)
      errors.push("• Role is required — every user must have an assigned role");
    if (createData.phone && !/^\+?[0-9\s-]{7,20}$/.test(createData.phone))
      errors.push("• Phone number format is invalid");

    // Validate entity linking
    const needsEntity = ["distributor", "label", "artist"].includes(selectedRoleName);
    if (needsEntity && createData.entityMode === "new" && !createData.entityName.trim()) {
      errors.push(`• ${selectedRoleName.charAt(0).toUpperCase() + selectedRoleName.slice(1)} name is required`);
    }
    if (needsEntity && createData.entityMode === "existing" && !createData.entityId) {
      errors.push(`• Please select an existing ${selectedRoleName} to link`);
    }

    if (errors.length > 0) {
      setCreateError(errors.join("\n"));
      return;
    }

    setSaving(true);
    try {
      // Build entity linking payload
      const payload: any = {
        email: createData.email,
        password: createData.password,
        name: createData.name,
        phone: createData.phone || undefined,
        roles: createData.roleId ? [createData.roleId] : [],
      };

      if (needsEntity) {
        if (createData.entityMode === "existing") {
          if (selectedRoleName === "distributor") payload.distributorId = createData.entityId;
          if (selectedRoleName === "label") payload.labelId = createData.entityId;
          if (selectedRoleName === "artist") payload.artistId = createData.entityId;
        } else {
          if (selectedRoleName === "distributor") payload.distributorData = { name: createData.entityName };
          if (selectedRoleName === "label") payload.labelData = { name: createData.entityName };
          if (selectedRoleName === "artist") payload.artistData = { name: createData.entityName };
        }
      }

      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setCreateModal(false);
        setCreateData({ email: "", password: "", phone: "", name: "", roleId: "", entityMode: "new", entityName: "", entityId: "" });
        setCreateError("");
        fetchUsers();
        fetchEntities();
      } else {
        const data = await res.json();
        setCreateError(translateApiError(data.error, t));
      }
    } catch (e) {
      console.error(e);
      setCreateError("An error occurred");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t("settings.confirmDeleteUser"))) return;
    try {
      await fetch(`/api/users/${id}`, { method: "DELETE" });
      fetchUsers();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="p-6">
      <Modal
        isOpen={editModal.open}
        onClose={() => {
          setEditModal({ open: false, user: null });
          setEditError("");
        }}
        title={t("users.editUser")}
      >
        <div className="flex border-b border-[var(--border-primary)] mb-4">
          <button
            onClick={() => setEditModalTab("profile")}
            className={`pb-2 px-4 text-sm font-medium border-b-2 transition-colors ${editModalTab === "profile" ? "border-[var(--accent)] text-[var(--accent-text)]" : "border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"}`}
          >
            {t("settings.profile")}
          </button>
          <button
            onClick={() => setEditModalTab("account")}
            className={`pb-2 px-4 text-sm font-medium border-b-2 transition-colors ${editModalTab === "account" ? "border-[var(--accent)] text-[var(--accent-text)]" : "border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"}`}
          >
            Account
          </button>
          <button
            onClick={() => setEditModalTab("security")}
            className={`pb-2 px-4 text-sm font-medium border-b-2 transition-colors ${editModalTab === "security" ? "border-[var(--accent)] text-[var(--accent-text)]" : "border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"}`}
          >
            {t("settings.security")}
          </button>
        </div>

        <div className="space-y-4">
          {editError && (
            <div className="p-3 bg-[var(--status-error-surface)] border border-red-500/30 rounded-lg text-[var(--status-error)] text-sm whitespace-pre-line">
              {editError}
            </div>
          )}

          {editModalTab === "profile" && (
            <>
              <div className="flex justify-center mb-4">
                <ImageUpload
                  currentUrl={formData.avatar}
                  onUpload={(url) => setFormData({ ...formData, avatar: url })}
                  type="avatars"
                  shape="circle"
                  entityName={formData.name || "User Avatar"}
                />
              </div>
              <div>
                <label className="block text-sm text-[var(--text-tertiary)] mb-1">
                  {t("form.fullName", "Full Name")}
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  className="w-full px-3 py-2  border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
              </div>
              <div>
                <label className="block text-sm text-[var(--text-tertiary)] mb-1">
                  {t("artists.stageName")}
                </label>
                <input
                  type="text"
                  value={formData.stageName}
                  onChange={(e) =>
                    setFormData({ ...formData, stageName: e.target.value })
                  }
                  className="w-full px-3 py-2  border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
              </div>
              <div>
                <label className="block text-sm text-[var(--text-tertiary)] mb-1">
                  {t("common.phone")}
                </label>
                <input
                  type="text"
                  value={formData.phone}
                  onChange={(e) =>
                    setFormData({ ...formData, phone: e.target.value })
                  }
                  className="w-full px-3 py-2  border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
              </div>
            </>
          )}

          {editModalTab === "account" && (
            <>
              <div>
                <label className="block text-sm text-[var(--text-tertiary)] mb-1">
                  {t("login.emailMethod")}
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) =>
                    setFormData({ ...formData, email: e.target.value })
                  }
                  className="w-full px-3 py-2  border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
              </div>
              <div>
                <label className="block text-sm text-[var(--text-tertiary)] mb-1">
                  {t("common.role")}
                </label>
                <select
                  value={formData.roleId}
                  onChange={(e) =>
                    setFormData({ ...formData, roleId: e.target.value })
                  }
                  className="w-full px-3 py-2 bg-[var(--bg-elevated)] border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                >
                  <option value="">{t("dashboard.selectRole")}</option>
                  {roles.map((r: any) => (
                    <option key={r.id} value={r.id}>
                      {r.displayName || r.name}
                    </option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-sm text-[var(--text-tertiary)] mb-1">
                  {t("users.assignedEntity", "Assigned Organization")}
                </label>
                <select
                  value={formData.entityId}
                  onChange={(e) => {
                     const val = e.target.value;
                     const type = distributors.some((d: any) => d.id === val) ? "ORGANIZATION" : labels.some((l: any) => l.id === val) ? "LABEL" : artists.some((a: any) => a.id === val) ? "SUB_ACCOUNT" : "";
                     setFormData({ ...formData, entityId: val, entityType: type });
                  }}
                  className="w-full px-3 py-2 bg-[var(--bg-elevated)] border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                >
                  <option value="">{t("users.noEntity", "No Organization")}</option>
                  <optgroup label="Distributors">
                     {distributors.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </optgroup>
                  <optgroup label="Labels">
                     {labels.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </optgroup>
                  <optgroup label="Artists (Sub-Accounts)">
                     {artists.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </optgroup>
                </select>
              </div>

              {formData.entityId && (
                <div>
                  <label className="block text-sm text-[var(--text-tertiary)] mb-1">
                    {t("users.entityRole", "Organization Role")}
                  </label>
                  <select
                    value={formData.entityRole}
                    onChange={(e) => setFormData({ ...formData, entityRole: e.target.value })}
                    className="w-full px-3 py-2 bg-[var(--bg-elevated)] border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  >
                    <option value="MEMBER">Member</option>
                    <option value="ADMIN">Admin</option>
                    <option value="OWNER">Owner</option>
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm text-[var(--text-tertiary)] mb-1">
                  {t("form.newPasswordLeaveBlankToKeepCurrent", "New Password (leave blank to keep current)")}
                </label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) =>
                    setFormData({ ...formData, password: e.target.value })
                  }
                  className="w-full px-3 py-2  border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  placeholder={t("form.placeholder.min8CharsUpperLowerNumber", "Min 8 chars, upper + lower + number")}
                />
              </div>
            </>
          )}

          {editModalTab === "security" && (
            <div className="space-y-4">
              <div
                className={`flex flex-col gap-3 p-4 border rounded-lg ${formData.isBanned ? "bg-[var(--status-error-surface)] border-red-500/30" : "bg-[var(--bg-elevated)] border-[var(--border-primary)]"}`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h4
                      className={`text-sm font-medium ${formData.isBanned ? "text-[var(--status-error)]" : "text-[var(--text-primary)]"}`}
                    >
                      {formData.isBanned ? "Account is Banned" : "Ban Account"}
                    </h4>
                    <p className="text-xs text-[var(--text-tertiary)] mt-1 max-w-[280px]">
                      {formData.isBanned
                        ? "This user cannot log in or access the system."
                        : "Prevent this user from logging in and accessing the system."}
                    </p>
                  </div>
                  <button
                    onClick={() =>
                      setFormData({
                        ...formData,
                        isBanned: !formData.isBanned,
                        banReason: formData.isBanned ? "" : formData.banReason,
                      })
                    }
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${formData.isBanned ? "bg-[var(--bg-elevated)] border border-[var(--border-primary)] text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]" : "bg-[var(--status-error)] text-white hover:bg-red-600"}`}
                  >
                    {formData.isBanned ? "Revoke Ban (Unban)" : "Ban User"}
                  </button>
                </div>

                {formData.isBanned && (
                  <div className="pt-3 border-t border-red-500/20 mt-1">
                    <label className="block text-sm text-[var(--status-error)] mb-1">
                      {t("form.reasonForBan", "Reason for Ban *")}
                    </label>
                    <textarea
                      value={formData.banReason}
                      onChange={(e) =>
                        setFormData({ ...formData, banReason: e.target.value })
                      }
                      rows={3}
                      className="w-full px-3 py-2 bg-transparent border border-red-500/30 rounded-lg text-red-200 placeholder-red-500/50 focus:outline-none focus:ring-2 focus:ring-red-500/50"
                      placeholder={t("form.placeholder.specifyWhyThisAccountWasBannedTheUserWillSeeThisMessage", "Specify why this account was banned. The user will see this message.")}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <button
              onClick={() => setEditModal({ open: false, user: null })}
              className="flex-1 px-4 py-2 hover:bg-[var(--bg-surface-hover)] rounded-lg text-sm font-medium transition-colors border border-[var(--border-primary)] text-[var(--text-primary)]"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg text-sm font-medium transition-colors disabled:opacity-50 text-white"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </Modal>

      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-medium">{t("heading.userManagement", "User Management")}</h2>
        <button
          onClick={() => {
            setCreateData({ email: "", password: "", phone: "", name: "", roleId: "", entityMode: "new", entityName: "", entityId: "" });
            setCreateModal(true);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg text-sm font-medium transition-colors text-white"
        >
          <AddIcon size={18} />
          Add User
        </button>
      </div>

      {/* Search */}
      <div className="relative max-w-md mb-6">
        <SearchIcon
          size={20}
          color="#6b7280"
          className="absolute left-3 top-1/2 -translate-y-1/2"
        />
        <input
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder={t("users.searchPlaceholder")}
          className="w-full pl-10 pr-4 py-2 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-disabled)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
      </div>

      <Modal
        isOpen={createModal}
        onClose={() => {
          setCreateModal(false);
          setCreateError("");
        }}
        title={t("settings.addUser")}
      >
        <div className="space-y-4">
          {createError && (
            <div className="p-3 bg-[var(--status-error-surface)] border border-red-500/30 rounded-lg text-[var(--status-error)] text-sm whitespace-pre-line">
              {createError}
            </div>
          )}
          <div>
            <label className="block text-sm text-[var(--text-tertiary)] mb-1">{t("common.name")} *</label>
            <input type="text" value={createData.name} onChange={(e) => setCreateData({ ...createData, name: e.target.value })} className="w-full px-3 py-2 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" placeholder={t("form.placeholder.fullName", "Full name")} />
          </div>
          <div>
            <label className="block text-sm text-[var(--text-tertiary)] mb-1">{t("form.email", "Email *")}</label>
            <input type="email" value={createData.email} onChange={(e) => setCreateData({ ...createData, email: e.target.value })} className="w-full px-3 py-2 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" placeholder={t("form.placeholder.userExampleCom", "user@example.com")} />
          </div>
          <div>
            <label className="block text-sm text-[var(--text-tertiary)] mb-1">{t("form.password", "Password *")}</label>
            <input type="password" value={createData.password} onChange={(e) => setCreateData({ ...createData, password: e.target.value })} className="w-full px-3 py-2 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" placeholder={t("form.placeholder.min8CharsUpperLowerNumber", "Min 8 chars, upper + lower + number")} />
          </div>
          <div>
            <label className="block text-sm text-[var(--text-tertiary)] mb-1">{t("common.phone")}</label>
            <input type="text" value={createData.phone} onChange={(e) => setCreateData({ ...createData, phone: e.target.value })} className="w-full px-3 py-2 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" placeholder={t("form.placeholder.optional", "Optional")} />
          </div>
          <div>
            <label className="block text-sm text-[var(--text-tertiary)] mb-1">{t("form.role", "Role *")}</label>
            <select value={createData.roleId} onChange={(e) => setCreateData({ ...createData, roleId: e.target.value, entityMode: "new", entityName: "", entityId: "" })} className="w-full px-3 py-2 bg-[var(--bg-elevated)] border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]">
              <option value="">{t("dashboard.selectRole")}</option>
              {roles.map((r: any) => (
                <option key={r.id} value={r.id}>{r.displayName || r.name}</option>
              ))}
            </select>
          </div>
          {/* Entity Linking — shown for distributor/label/artist roles */}
          {["distributor", "label", "artist"].includes(selectedRoleName) && (
            <div className="p-4 border border-[var(--border-primary)] rounded-lg bg-[var(--bg-elevated)] space-y-3">
              <p className="text-sm font-medium text-[var(--text-primary)]">
                {t("users.linkEntity", "Link")} {selectedRoleName.charAt(0).toUpperCase() + selectedRoleName.slice(1)}
              </p>
              <div className="flex gap-2">
                <button onClick={() => setCreateData({ ...createData, entityMode: "existing", entityName: "" })} className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${createData.entityMode === "existing" ? "bg-[var(--accent)] text-white border-[var(--accent)]" : "bg-transparent text-[var(--text-secondary)] border-[var(--border-primary)] hover:bg-[var(--bg-surface-hover)]"}`}>
                  {t("users.linkExisting", "Link existing")}
                </button>
                <button onClick={() => setCreateData({ ...createData, entityMode: "new", entityId: "" })} className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${createData.entityMode === "new" ? "bg-[var(--accent)] text-white border-[var(--accent)]" : "bg-transparent text-[var(--text-secondary)] border-[var(--border-primary)] hover:bg-[var(--bg-surface-hover)]"}`}>
                  {t("users.createNew", "Create new")}
                </button>
              </div>
              {createData.entityMode === "existing" ? (
                <select value={createData.entityId} onChange={(e) => setCreateData({ ...createData, entityId: e.target.value })} className="w-full px-3 py-2 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]">
                  <option value="">{t("users.selectExisting", "Select existing")} {selectedRoleName}...</option>
                  {(selectedRoleName === "distributor" ? distributors : selectedRoleName === "label" ? labels : artists).map((ent: any) => (
                    <option key={ent.id} value={ent.id}>{ent.name}</option>
                  ))}
                </select>
              ) : (
                <input type="text" value={createData.entityName} onChange={(e) => setCreateData({ ...createData, entityName: e.target.value })} className="w-full px-3 py-2 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" placeholder={`${selectedRoleName.charAt(0).toUpperCase() + selectedRoleName.slice(1)} name`} />
              )}
            </div>
          )}
          <div className="flex gap-3 pt-4">
            <button onClick={() => { setCreateModal(false); setCreateError(""); }} className="flex-1 px-4 py-2 hover:bg-[var(--bg-surface-hover)] rounded-lg text-sm font-medium transition-colors border border-[var(--border-primary)] text-[var(--text-primary)]">{t("common.cancel")}</button>
            <button onClick={handleCreateUser} disabled={saving} className="flex-1 px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg text-sm font-medium transition-colors disabled:opacity-50 text-white">{saving ? "Creating..." : t("settings.addUser", "Create User")}</button>
          </div>
        </div>
      </Modal>

      {loading ? (
        <TableSkeleton rows={5} cols={4} />
      ) : users.length === 0 ? (
        <div className="text-center py-12 text-[var(--text-disabled)]">
          <GroupIcon size={48} color="#525252" />
          <p className="mt-2">{t("users.noUsers")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[var(--text-tertiary)] text-sm border-b border-[var(--border-primary)]">
                <th className="pb-3 font-medium">{t("dashboard.user")}</th>
                <th className="pb-3 font-medium">{t("common.role")}</th>
                <th className="pb-3 font-medium">{t("users.linkedEntity", "Entity")}</th>
                <th className="pb-3 font-medium">{t("users.hierarchy", "Hierarchy")}</th>
                <th className="pb-3 font-medium">{t("common.status")}</th>
                <th className="pb-3 font-medium">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={u.id}
                  className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)]"
                >
                  <td className="py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-[var(--accent)] rounded-full flex items-center justify-center text-white font-medium overflow-hidden">
                        {u.avatar ? (
                          <img
                            src={u.avatar}
                            alt={u.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          u.name?.charAt(0) || u.email.charAt(0).toUpperCase()
                        )}
                      </div>
                      <div>
                        <p className="font-medium">
                          {u.name || u.email.split("@")[0]}
                        </p>
                        <p className="text-sm text-[var(--text-disabled)]">
                          {u.email}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="py-4">
                    <span className="px-2 py-1 bg-[var(--status-success-surface)] text-[var(--accent-text)] rounded text-sm">
                      {u.roles?.[0]?.name || u.roles?.[0] || "user"}
                    </span>
                  </td>
                  <td className="py-4">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-[var(--text-primary)]">
                        {u.entities?.[0]?.entityName || "—"}
                      </span>
                      {u.entities?.[0] && (
                        <span className="text-xs text-[var(--text-tertiary)]">
                          {u.entities[0].entityType === "SUB_ACCOUNT" ? "Artist" : 
                           u.entities[0].entityType === "LABEL" ? "Label" : "Distributor"}
                          {" • "} 
                          <span className={u.entities[0].role === "OWNER" || u.entities[0].role === "ADMIN" ? "text-[var(--accent-text)]" : ""}>
                            {u.entities[0].role}
                          </span>
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-4">
                    <div className="flex flex-col gap-1">
                      {u.parent && (
                        <span className="text-xs text-[var(--text-disabled)]">
                          ↑ {u.parent.name || u.parent.email}
                        </span>
                      )}
                      {(u.childCount > 0) && (
                        <span className="inline-flex items-center gap-1 text-xs text-[var(--accent-text)]">
                          ↓ {u.childCount} {t("users.children", "sub-accounts")}
                        </span>
                      )}
                      {!u.parent && !u.childCount && <span className="text-xs text-[var(--text-disabled)]">—</span>}
                    </div>
                  </td>
                  <td className="py-4">
                    <span
                      className={`px-2 py-1 rounded text-sm ${u.isActive ? "bg-[var(--status-success-surface)] text-[var(--accent-text)]" : "bg-[var(--status-error-surface)] text-[var(--status-error)]"}`}
                    >
                      {u.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="py-4">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openEditModal(u)}
                        className="p-2 hover: rounded-lg"
                      >
                        <EditIcon size={18} color="#a3a3a3" />
                      </button>
                      <button
                        onClick={() => handleDelete(u.id)}
                        className="p-2 hover:bg-[var(--status-error-surface)] rounded-lg"
                      >
                        <DeleteIcon size={18} color="#ef4444" />
                      </button>
                    </div>
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

// ============ AUDIT LOG PANEL ============
function AuditLogPanel() {
  const { t } = useI18n(); // Auto-injected

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [entityFilter, setEntityFilter] = useState("");
  const [availableActions, setAvailableActions] = useState<string[]>([]);
  const [availableEntities, setAvailableEntities] = useState<string[]>([]);
  const [selectedLog, setSelectedLog] = useState<any>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });
      if (search) params.set("search", search);
      if (actionFilter) params.set("action", actionFilter);
      if (entityFilter) params.set("entityType", entityFilter);
      const res = await fetch(`/api/audit-log?${params}`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.data || []);
        setTotal(data.total || 0);
        setTotalPages(data.totalPages || 1);
        if (data.filters) {
          setAvailableActions(data.filters.actions || []);
          setAvailableEntities(data.filters.entityTypes || []);
        }
      }
    } catch (e) {
      console.error("Failed to fetch audit logs:", e);
    }
    setLoading(false);
  }, [page, limit, search, actionFilter, entityFilter]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const formatDate = (d: string) => {
    const date = new Date(d);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const actionColor = (action: string) => {
    switch (action) {
      case "CREATE":
        return "bg-green-900/40 text-[var(--accent-text)]";
      case "UPDATE":
        return "bg-blue-900/40 text-[var(--status-info)]";
      case "DELETE":
        return "bg-red-900/40 text-[var(--status-error)]";
      case "LOGIN":
        return "bg-purple-900/40 text-[var(--color-deezer)]";
      case "LOGOUT":
        return "bg-yellow-900/40 text-yellow-400";
      default:
        return " text-[var(--text-tertiary)]";
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">
            {t("nav.auditLog")}
          </h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">
            Track all system activity and changes
          </p>
        </div>
        <button
          onClick={fetchLogs}
          className="flex items-center gap-2 px-4 py-2  hover: text-[var(--text-primary)] text-sm rounded-lg transition-colors"
        >
          <RefreshIcon size={18} /> {t("common.refresh")}
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <SearchIcon
            size={18}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-disabled)]"
          />
          <input
            type="text"
            placeholder={t("form.placeholder.searchEntityTypeEntityID", "Search entity type, entity ID...")}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full pl-9 pr-4 py-2 border border-[var(--border-input)] rounded-lg text-sm text-[var(--text-primary)] placeholder-[var(--text-disabled)] focus:outline-none focus:border-green-500"
          />
        </div>
        <select
          value={actionFilter}
          onChange={(e) => {
            setActionFilter(e.target.value);
            setPage(1);
          }}
          style={{ background: "var(--bg-surface)" }}
          className=" border border-[var(--border-input)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-green-500"
        >
          <option value="">{t("dashboard.allActions")}</option>
          {availableActions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select
          value={entityFilter}
          onChange={(e) => {
            setEntityFilter(e.target.value);
            setPage(1);
          }}
          style={{ background: "var(--bg-surface)" }}
          className=" border border-[var(--border-input)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-green-500"
        >
          <option value="">{t("dashboard.allEntities")}</option>
          {availableEntities.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <TableSkeleton rows={8} cols={5} />
      ) : logs.length === 0 ? (
        <div className="text-center py-16 text-[var(--text-disabled)]">
          <HistoryIcon size={48} className="mx-auto mb-3 opacity-50" />
          <p>{t("dashboard.noAuditLogEntries")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border-primary)]">
          <table className="w-full text-sm">
            <thead>
              <tr
                style={{ background: "var(--bg-surface)" }}
                className="/50 text-[var(--text-tertiary)] text-xs uppercase tracking-wider"
              >
                <th className="text-left px-4 py-3 font-medium">{t("dashboard.timestamp")}</th>
                <th className="text-left px-4 py-3 font-medium">{t("dashboard.action")}</th>
                <th className="text-left px-4 py-3 font-medium">{t("dashboard.entity")}</th>
                <th className="text-left px-4 py-3 font-medium">{t("dashboard.entityId")}</th>
                <th className="text-left px-4 py-3 font-medium">{t("dashboard.user")}</th>
                <th className="text-left px-4 py-3 font-medium">{t("dashboard.details")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-primary)]">
              {logs.map((log) => (
                <tr
                  key={log.id}
                  className="hover:bg-[var(--bg-surface-hover)] transition-colors"
                >
                  <td className="px-4 py-3 text-[var(--text-secondary)] whitespace-nowrap text-xs">
                    {formatDate(log.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${actionColor(log.action)}`}
                    >
                      {log.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[var(--text-primary)] font-medium">
                    {log.entityType}
                  </td>
                  <td
                    className="px-4 py-3 text-[var(--text-tertiary)] font-mono text-xs max-w-[120px] truncate"
                    title={log.entityId}
                  >
                    {log.entityId ? log.entityId.slice(0, 8) + "…" : "—"}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">
                    {log.user
                      ? log.user.name || log.user.email
                      : log.userId
                        ? "System"
                        : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {log.oldValue || log.newValue ? (
                      <button
                        onClick={() => setSelectedLog(log)}
                        className="px-3 py-1 bg-transparent hover:bg-[var(--bg-surface-hover)] border border-[var(--border-primary)] rounded text-xs font-medium transition-colors"
                      >
                        View Details
                      </button>
                    ) : (
                      <span className="text-[var(--text-disabled)] text-xs">
                        —
                      </span>
                    )}
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

      <Modal
        isOpen={!!selectedLog}
        onClose={() => setSelectedLog(null)}
        title={t("dashboard.auditLogDetails")}
      >
        {selectedLog && (
          <div className="space-y-4 max-h-[80vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="p-3 bg-[var(--bg-elevated)] rounded-lg border border-[var(--border-primary)]">
                <p className="text-xs text-[var(--text-tertiary)] mb-1">
                  Timestamp
                </p>
                <p className="text-sm">{formatDate(selectedLog.createdAt)}</p>
              </div>
              <div className="p-3 bg-[var(--bg-elevated)] rounded-lg border border-[var(--border-primary)]">
                <p className="text-xs text-[var(--text-tertiary)] mb-1">{t("dashboard.user")}</p>
                <p className="text-sm">
                  {selectedLog.user
                    ? selectedLog.user.name || selectedLog.user.email
                    : selectedLog.userId
                      ? "System"
                      : "—"}
                </p>
              </div>
              <div className="p-3 bg-[var(--bg-elevated)] rounded-lg border border-[var(--border-primary)]">
                <p className="text-xs text-[var(--text-tertiary)] mb-1">
                  Action
                </p>
                <p className="text-sm font-medium">
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-xs ${actionColor(selectedLog.action)}`}
                  >
                    {selectedLog.action}
                  </span>
                </p>
              </div>
              <div className="p-3 bg-[var(--bg-elevated)] rounded-lg border border-[var(--border-primary)]">
                <p className="text-xs text-[var(--text-tertiary)] mb-1">
                  Entity
                </p>
                <p className="text-sm">
                  {selectedLog.entityType} (
                  {selectedLog.entityId
                    ? selectedLog.entityId.slice(0, 8)
                    : "—"}
                  )
                </p>
              </div>
            </div>

            {selectedLog.oldValue && (
              <div>
                <p className="text-sm font-medium mb-2 text-[var(--text-secondary)]">
                  Old Value
                </p>
                <pre className="p-3 bg-[var(--bg-elevated)] rounded-lg border border-[var(--border-primary)] text-xs text-[var(--status-error)] overflow-x-auto">
                  {JSON.stringify(selectedLog.oldValue, null, 2)}
                </pre>
              </div>
            )}

            {selectedLog.newValue && (
              <div>
                <p className="text-sm font-medium mb-2 text-[var(--text-secondary)]">
                  New Value
                </p>
                <pre className="p-3 bg-[var(--bg-elevated)] rounded-lg border border-[var(--border-primary)] text-xs text-[var(--accent-text)] overflow-x-auto">
                  {JSON.stringify(selectedLog.newValue, null, 2)}
                </pre>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedLog(null)}
                className="px-4 py-2 bg-[var(--bg-elevated)] hover:bg-[var(--bg-surface-hover)] rounded-lg text-sm font-medium transition-colors border border-[var(--border-primary)]"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ============ MAIN APP ============
export default function Home() {
  const { t } = useI18n(); // Auto-injected

  const router = useRouter();
  const [user, setUser] = useState<UserSession | null>(null);
  const [activePanel, setActivePanel] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { setTheme } = useTheme();

  // Fetch user session
  useEffect(() => {
    const fetchUser = async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
          // Sync theme from account to local state without triggering another DB save
          if (
            data.user.theme &&
            (data.user.theme === "light" || data.user.theme === "dark")
          ) {
            setTheme(data.user.theme, false);
          }
        } else {
          router.push("/login");
        }
      } catch (e) {
        console.error("Error fetching user:", e);
        router.push("/login");
      }
    };
    fetchUser();
  }, [router, setTheme]);

  // Global Search Navigation
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const { type } = e.detail;
      if (type === "ARTIST") setActivePanel("artists");
      else if (type === "RELEASE") setActivePanel("releases");
      else if (type === "ASSET") setActivePanel("assets");
      else if (type === "LABEL") setActivePanel("labels");
    };
    window.addEventListener("open-entity", handler as EventListener);
    return () => window.removeEventListener("open-entity", handler as EventListener);
  }, []);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  };

  const isAdmin = user?.permissions?.includes("user.delete") || user?.entityType === "SYSTEM_ADMIN" || user?.entityType === "SUPER_ADMIN";
  const visibleMenuItems = menuItems.filter((item) => hasAccess(user, item));

  if (!user) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: "var(--bg-primary)" }}
      >
        <div
          className="animate-spin rounded-full h-6 w-6"
          style={{ borderBottom: "2px solid var(--text-tertiary)" }}
        ></div>
      </div>
    );
  }

  const renderPanel = () => {
    switch (activePanel) {
      case "dashboard":
        return <DashboardPanel user={user} onNavigate={setActivePanel} />;
      case "catalog":
      case "releases":
        return <ReleasesPanel user={user} defaultMode="AUDIO" />;
      case "vevo":
        return <VevoCatalogPanel user={user} />;
      case "channels":
        return <ChannelsPanel />;
      case "assets":
        return <AssetsPanel user={user} />;
      case "labels":
        return <LabelsPanel user={user} />;
      case "artists":
        return <ArtistsPanel user={user} />;
      case "analytics":
        return <AnalyticsPanel />;
      case "earnings":
        return <EarningsPanel />;
      case "distribution":
        return <DistributionPanel user={user} />;
      case "audit-log":
        return <AuditLogPanel />;
      case "users":
        return <UsersPanel user={user} />;
      case "entities":
        return <EntitiesPanel user={user} />;
      case "compositions":
        return <CompositionsPanel user={user} />;
      case "playlists":
        return <PlaylistsPanel user={user} />;
      default:
        return <ReleasesPanel user={user} />;
    }
  };

  const panelTitles: Record<string, string> = {
    dashboard: "Home",
    catalog: "Audio Catalog",
    releases: "Audio Catalog",
    vevo: "VEVO Catalog",
    channels: "Channels",
    assets: "Assets",
    labels: "Labels",
    artists: "Artists",
    analytics: "Analytics",
    earnings: "Earnings",
    entities: "Organizations",
    distribution: "Distribution",
    "audit-log": "Audit Log",
    users: "Users",
    compositions: "Compositions",
    playlists: "Playlists",
    settings: "Settings",
  };

  return (
    <I18nProvider
      initialLanguage={user.language || "en"}
      initialCurrency={user.currency || "USD"}
    >
      <ToastProvider>
        <div
          className="h-screen flex overflow-hidden"
          style={{
            background: "var(--bg-primary)",
            color: "var(--text-primary)",
          }}
        >
          {/* New Sidebar */}
          <Sidebar
            activePanel={activePanel}
            onNavigate={(panel) => {
              if (panel === "settings") {
                router.push("/settings");
              } else {
                setActivePanel(panel);
              }
            }}
            user={user}
            onLogout={handleLogout}
          />

          {/* Main Content */}
          <main className="flex-1 flex flex-col overflow-hidden">
            <TopBar
              title={panelTitles[activePanel] || activePanel}
              onNavigate={setActivePanel}
              activePanel={activePanel}
            />
            <div className="flex-1 overflow-y-auto">{renderPanel()}</div>
          </main>
        </div>
      </ToastProvider>
    </I18nProvider>
  );
}
