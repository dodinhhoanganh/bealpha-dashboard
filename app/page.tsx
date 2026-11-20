"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { UserSession } from "@/lib/types";
import { I18nProvider } from "@/lib/i18n/I18nProvider";
import { ToastProvider } from "@/components/ui/Toast";
import { useTheme } from "@/components/layout/ThemeProvider";
import Sidebar from "@/components/layout/Sidebar";
import TopBar from "@/components/layout/TopBar";
import { clearStreamTokenCache } from "@/lib/stream-url";
import { apiRequest, clearAccessToken, getCurrentUser } from "@/lib/api-client";
import { canAccessPanel } from "@/lib/ui-capabilities";
import { BrandProvider } from "@/components/layout/BrandProvider";

const PanelLoading = () => (
  <div className="flex h-full min-h-[320px] items-center justify-center">
    <div
      className="h-6 w-6 animate-spin rounded-full"
      style={{ borderBottom: "2px solid var(--text-tertiary)" }}
    />
  </div>
);

const DashboardPanel = dynamic(
  () => import("@/components/dashboard/DashboardPanel"),
  { loading: PanelLoading },
);
const ReleasesPanel = dynamic(
  () => import("@/components/releases/ReleasesPanel"),
  { loading: PanelLoading },
);
const VevoCatalogPanel = dynamic(
  () => import("@/components/vevo/VevoCatalogPanel"),
  { loading: PanelLoading },
);
const ChannelsPanel = dynamic(
  () => import("@/components/vevo/ChannelsPanel"),
  { loading: PanelLoading },
);
const AssetsPanel = dynamic(
  () => import("@/components/assets/AssetsPanel"),
  { loading: PanelLoading },
);
const LabelsPanel = dynamic(
  () => import("@/components/entities/LabelsPanel"),
  { loading: PanelLoading },
);
const ArtistsPanel = dynamic(
  () => import("@/components/entities/ArtistsPanel"),
  { loading: PanelLoading },
);
const AnalyticsPanel = dynamic(
  () => import("@/components/analytics/AnalyticsPanel"),
  { loading: PanelLoading },
);
const EarningsPanel = dynamic(
  () => import("@/components/analytics/EarningsPanel"),
  { loading: PanelLoading },
);
const DistributionPanel = dynamic(
  () => import("@/components/analytics/DistributionPanel"),
  { loading: PanelLoading },
);
const EntitiesPanel = dynamic(
  () => import("@/components/entities/EntitiesPanel"),
  { loading: PanelLoading },
);
const UsersPanel = dynamic(
  () => import("@/components/entities/UsersPanel"),
  { loading: PanelLoading },
);
const AuditLogPanel = dynamic(
  () => import("@/components/analytics/AuditLogPanel"),
  { loading: PanelLoading },
);
const CompositionsPanel = dynamic(
  () => import("@/components/releases/CompositionsPanel"),
  { loading: PanelLoading },
);
const PlaylistsPanel = dynamic(
  () => import("@/components/analytics/PlaylistsPanel"),
  { loading: PanelLoading },
);

type OpenEntityEventDetail = {
  type?: "ARTIST" | "RELEASE" | "ASSET" | "LABEL";
  id?: string;
  title?: string;
  replayed?: boolean;
};

const PANEL_BY_ENTITY_TYPE: Record<
  NonNullable<OpenEntityEventDetail["type"]>,
  string
> = {
  ARTIST: "artists",
  RELEASE: "releases",
  ASSET: "assets",
  LABEL: "labels",
};

const PANEL_TITLES: Record<string, string> = {
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

function isSupportedTheme(theme: unknown): theme is "light" | "dark" {
  return theme === "light" || theme === "dark";
}

export default function Home() {
  const router = useRouter();
  const [user, setUser] = useState<UserSession | null>(null);
  const [activePanel, setActivePanel] = useState("dashboard");
  const [pendingEntity, setPendingEntity] = useState<OpenEntityEventDetail | null>(null);
  const { setTheme } = useTheme();

  const navigateWorkbench = useCallback((destination: string, pushHistory = true) => {
    if (!user) return;
    let panel = destination;
    let entity: OpenEntityEventDetail | null = null;
    let canonicalUrl = destination === "dashboard" ? "/" : `/?panel=${encodeURIComponent(destination)}`;
    if (destination.startsWith("/")) {
      const url = new URL(destination, window.location.origin);
      panel = url.searchParams.get("panel") || "dashboard";
      const candidates = [
        ["releaseId", "RELEASE"], ["artistId", "ARTIST"], ["assetId", "ASSET"], ["labelId", "LABEL"],
      ] as const;
      for (const [key, type] of candidates) {
        const id = url.searchParams.get(key);
        if (id) { entity = { type, id, title: url.searchParams.get("title") || undefined }; break; }
      }
      canonicalUrl = `${url.pathname}${url.search}`;
    }
    if (panel === "catalog") panel = "releases";
    if (!canAccessPanel(user, panel)) panel = "dashboard";
    setActivePanel(panel);
    setPendingEntity(entity);
    if (pushHistory) window.history.pushState({}, "", panel === "dashboard" && !entity ? "/" : canonicalUrl);
  }, [user]);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const currentUser = await getCurrentUser();
        setUser(currentUser);
        if (isSupportedTheme(currentUser.theme)) {
          setTheme(currentUser.theme, false);
        }
      } catch (e) {
        console.error("Error fetching user:", e);
        router.push("/login");
      }
    };
    fetchUser();
  }, [router, setTheme]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<OpenEntityEventDetail>).detail ?? {};
      if (!detail.type || detail.replayed) return;
      const panel = PANEL_BY_ENTITY_TYPE[detail.type];
      const key = { RELEASE: "releaseId", ARTIST: "artistId", ASSET: "assetId", LABEL: "labelId" }[detail.type];
      const query = new URLSearchParams({ panel, ...(detail.id ? { [key]: detail.id } : {}), ...(detail.title ? { title: detail.title } : {}) });
      navigateWorkbench(`/?${query.toString()}`);
    };
    window.addEventListener("open-entity", handler);
    return () => window.removeEventListener("open-entity", handler);
  }, [navigateWorkbench]);

  useEffect(() => {
    if (!user) return;
    const restore = () => navigateWorkbench(`${window.location.pathname}${window.location.search}`, false);
    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [user, navigateWorkbench]);

  useEffect(() => {
    if (!pendingEntity?.type) return;
    const expectedPanel = PANEL_BY_ENTITY_TYPE[pendingEntity.type];
    if (activePanel !== expectedPanel) return;
    const frame = window.requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent("open-entity", { detail: { ...pendingEntity, replayed: true } }));
      setPendingEntity(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activePanel, pendingEntity]);

  useEffect(() => {
    if (user && !canAccessPanel(user, activePanel)) setActivePanel("dashboard");
  }, [activePanel, user]);

  const handleLogout = async () => {
    try {
      await apiRequest("/api/v1/auth/logout", { method: "POST" });
    } finally {
      clearAccessToken();
    }
    // Drop in-memory stream tokens — they're IP-bound HMACs, but on a shared
    // device the next signed-in user shouldn't inherit valid URLs for the
    // previous account's pre-release media.
    clearStreamTokenCache();
    router.push("/login");
  };

  if (!user) {
    return (
      <div
        className="min-h-[100dvh] flex items-center justify-center"
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
        return <DashboardPanel user={user} onNavigate={navigateWorkbench} />;
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
        return <DashboardPanel user={user} onNavigate={navigateWorkbench} />;
    }
  };

  return (
    <I18nProvider
      initialLanguage={user.language || "en"}
      initialCurrency={user.currency || "USD"}
    >
      <BrandProvider key={`${user.entityId}:${user.tenantId ?? "platform"}`}>
      <ToastProvider>
        <div
          className="workbench-shell min-h-[100dvh] h-[100dvh] flex overflow-hidden"
          style={{
            background: "var(--bg-primary)",
            color: "var(--text-primary)",
          }}
        >
          <Sidebar
            activePanel={activePanel}
            onNavigate={(panel) => {
              if (panel === "settings") {
                router.push("/settings");
              } else navigateWorkbench(panel);
            }}
            user={user}
            onLogout={handleLogout}
          />

          <main className="min-w-0 flex-1 flex flex-col overflow-hidden">
            <TopBar
              user={user}
              title={PANEL_TITLES[activePanel] || activePanel}
              onNavigate={(panel) => {
                navigateWorkbench(panel);
              }}
              activePanel={activePanel}
            />
            <div className="flex-1 overflow-y-auto overscroll-contain">{renderPanel()}</div>
          </main>
        </div>
      </ToastProvider>
      </BrandProvider>
    </I18nProvider>
  );
}
