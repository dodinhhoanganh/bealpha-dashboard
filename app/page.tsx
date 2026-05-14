"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { UserSession } from "@/lib/types";
import { I18nProvider, useI18n } from "@/lib/i18n/I18nProvider";
import { ToastProvider } from "@/components/Toast";
import { useTheme } from "@/components/ThemeProvider";
import Sidebar from "@/components/layout/Sidebar";
import TopBar from "@/components/layout/TopBar";

// Panel components
import DashboardPanel from "@/components/DashboardPanel";
import ReleasesPanel from "@/components/ReleasesPanel";
import VevoCatalogPanel from "@/components/VevoCatalogPanel";
import ChannelsPanel from "@/components/ChannelsPanel";
import AssetsPanel from "@/components/AssetsPanel";
import LabelsPanel from "@/components/LabelsPanel";
import ArtistsPanel from "@/components/ArtistsPanel";
import AnalyticsPanel from "@/components/AnalyticsPanel";
import EarningsPanel from "@/components/EarningsPanel";
import DistributionPanel from "@/components/DistributionPanel";
import EntitiesPanel from "@/components/EntitiesPanel";
import UsersPanel from "@/components/UsersPanel";
import AuditLogPanel from "@/components/AuditLogPanel";
import CompositionsPanel from "@/components/CompositionsPanel";
import PlaylistsPanel from "@/components/PlaylistsPanel";

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
          {/* Sidebar */}
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
