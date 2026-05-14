"use client";

import { useState, useEffect, useRef } from "react";
import {
  faHouse,
  faCompactDisc,
  faFileAudio,
  faChartLine,
  faWallet,
  faTruckFast,
  faClipboardList,
  faUsers,
  faGear,
  faRightFromBracket,
  faBars,
  faChevronLeft,
  faBuilding,
  faMicrophone,
  faVideo,
  faFilm,
  faSitemap,
  faUserPen,
  faList,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useTheme } from "@/components/ThemeProvider";
import { useI18n } from "@/lib/i18n/I18nProvider";

interface SidebarProps {
  activePanel: string;
  onNavigate: (panel: string) => void;
  user: {
    id: string;
    email: string;
    name?: string;
    stageName?: string;
    avatar?: string;
    roles: string[];
    permissions: string[];
    entityId: string;
    entityType: string;
    entityRole: string;
    entityName: string;
    entityLogo?: string | null;
  } | null;
  onLogout: () => void;
}

interface NavItem {
  id: string;
  label: string;
  icon: typeof faHouse;
  group: string;
  requiredPermissions?: string[];
}

const navItems: NavItem[] = [
  // Music
  { id: "dashboard", label: "nav.dashboard", icon: faHouse, group: "MUSIC" },
  {
    id: "releases",
    label: "nav.releases",
    icon: faCompactDisc,
    group: "MUSIC",
    requiredPermissions: ["release.read"],
  },
  {
    id: "assets",
    label: "nav.assets",
    icon: faFileAudio,
    group: "MUSIC",
    requiredPermissions: ["release.read"],
  },
  {
    id: "artists",
    label: "nav.artists",
    icon: faMicrophone,
    group: "MUSIC",
    requiredPermissions: ["artist.read"],
  },
  {
    id: "labels",
    label: "nav.labels",
    icon: faBuilding,
    group: "MUSIC",
    requiredPermissions: ["label.read"],
  },
  {
    id: "vevo",
    label: "nav.vevo",
    icon: faFilm,
    group: "MUSIC",
    requiredPermissions: ["release.read"],
  },
  {
    id: "channels",
    label: "nav.channels",
    icon: faVideo,
    group: "MUSIC",
    requiredPermissions: ["label.read"],
  },
  {
    id: "compositions",
    label: "nav.compositions",
    icon: faUserPen,
    group: "MUSIC",
    requiredPermissions: ["release.read"],
  },
  {
    id: "playlists",
    label: "nav.playlists",
    icon: faList,
    group: "MUSIC",
    requiredPermissions: ["release.read"],
  },
  // Analytics
  { id: "analytics", label: "nav.analytics", icon: faChartLine, group: "INSIGHTS" },
  {
    id: "earnings",
    label: "nav.earnings",
    icon: faWallet,
    group: "INSIGHTS",
    requiredPermissions: ["finance.view"],
  },
  // Operations
  {
    id: "entities",
    label: "nav.entities",
    icon: faSitemap,
    group: "OPERATIONS",
    requiredPermissions: ["entity.read"],
  },
  {
    id: "distribution",
    label: "nav.distribution",
    icon: faTruckFast,
    group: "OPERATIONS",
    requiredPermissions: ["release.read"],
  },
  {
    id: "audit-log",
    label: "nav.auditLog",
    icon: faClipboardList,
    group: "OPERATIONS",
    requiredPermissions: ["entity.read"],
  },
  {
    id: "users",
    label: "nav.users",
    icon: faUsers,
    group: "OPERATIONS",
    requiredPermissions: ["user.read"],
  },
];

function hasAccess(user: SidebarProps["user"], item: NavItem): boolean {
  if (!user) return false;
  if (item.requiredPermissions?.length) {
    if (item.requiredPermissions.includes("admin")) {
      if (!user.roles?.includes("system_admin")) return false;
    } else if (!item.requiredPermissions.some((p) => user.permissions.includes(p))) {
      return false;
    }
  }
  return true;
}

export default function Sidebar({
  activePanel,
  onNavigate,
  user,
  onLogout,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const { theme } = useTheme();
  const { t } = useI18n();

  // Persist collapse state
  useEffect(() => {
    const saved = localStorage.getItem("sidebar_collapsed");
    if (saved === "true") setCollapsed(true);
  }, []);

  useEffect(() => {
    localStorage.setItem("sidebar_collapsed", String(collapsed));
  }, [collapsed]);

  // Close mobile sidebar on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        mobileOpen &&
        sidebarRef.current &&
        !sidebarRef.current.contains(e.target as Node)
      ) {
        setMobileOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [mobileOpen]);

  // Group nav items
  const groups = ["MUSIC", "INSIGHTS", "OPERATIONS"];
  const filteredItems = navItems.filter((item) => hasAccess(user, item));

  const displayName =
    user?.name || user?.stageName || user?.email?.split("@")[0] || "User";
  const initials = displayName.charAt(0).toUpperCase();
  const entityLabel = user?.entityName || user?.entityType || "User";
  const roleLabel = user?.entityRole?.toLowerCase() || "member";

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed top-3 left-3 z-50 p-2.5 rounded-xl md:hidden transition-colors"
        style={{
          background: "var(--bg-elevated)",
          color: "var(--text-secondary)",
        }}
      >
        <FontAwesomeIcon icon={faBars} className="w-5 h-5" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 md:hidden"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        ref={sidebarRef}
        className={`
          fixed top-0 left-0 h-screen z-50 flex flex-col
          transition-all duration-300 ease-in-out
          ${mobileOpen ? "translate-x-0" : "-translate-x-full"}
          md:translate-x-0 md:relative md:z-auto
        `}
        style={{
          width: collapsed
            ? "var(--sidebar-collapsed-width)"
            : "var(--sidebar-width)",
          background: "var(--bg-sidebar)",
          borderRight: "1px solid var(--border-primary)",
        }}
      >
        {/* Logo area */}
        <div
          className="flex items-center justify-between px-4 shrink-0"
          style={{
            height: "var(--topbar-height)",
            borderBottom: "1px solid var(--border-primary)",
          }}
        >
          {!collapsed && (
            <div className="flex items-center overflow-hidden w-[160px] h-14 relative">
              <img
                src={
                  theme === "dark"
                    ? "/Logo (White, Transparent).png"
                    : "/Logo (Black, Transparent).png"
                }
                alt="BeAlpha Logo"
                className="absolute w-[140px] h-[140px] max-w-none left-[-15px] top-1/2 -translate-y-1/2"
              />
            </div>
          )}
          <button
            onClick={() => {
              setCollapsed(!collapsed);
              setMobileOpen(false);
            }}
            className="p-2 rounded-lg transition-all duration-200"
            style={{ color: "var(--text-tertiary)" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--bg-elevated)";
              e.currentTarget.style.color = "var(--text-primary)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "var(--text-tertiary)";
            }}
            title={collapsed ? t("sidebar.expandSidebar", "Expand sidebar") : t("sidebar.collapseSidebar", "Collapse sidebar")}
          >
            <FontAwesomeIcon
              icon={collapsed ? faBars : faChevronLeft}
              className="w-3.5 h-3.5"
            />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4 px-2.5">
          {groups.map((group) => {
            const groupItems = filteredItems.filter((i) => i.group === group);
            if (groupItems.length === 0) return null;
            return (
              <div key={group} className="mb-1">
                {!collapsed && (
                  <p
                    className="px-3 pt-4 pb-2 text-[10px] font-semibold uppercase tracking-[0.12em]"
                    style={{ color: "var(--text-disabled)" }}
                  >
                    {t(`nav.groups.${group}`, group)}
                  </p>
                )}
                {collapsed && (
                  <div
                    className="my-3 mx-3"
                    style={{ borderTop: "1px solid var(--border-primary)" }}
                  />
                )}
                <div className="space-y-0.5">
                  {groupItems.map((item) => {
                    const isActive = activePanel === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => {
                          onNavigate(item.id);
                          setMobileOpen(false);
                        }}
                        className={`
                          w-full flex items-center gap-3 transition-all duration-200 group
                          ${collapsed ? "justify-center px-0 py-2.5 rounded-xl" : "px-3 py-2.5 rounded-xl"}
                        `}
                        style={{
                          background: isActive
                            ? "var(--accent-surface)"
                            : "transparent",
                          color: isActive
                            ? "var(--accent-text)"
                            : "var(--text-tertiary)",
                          fontWeight: isActive ? 600 : 450,
                          fontSize: 13,
                        }}
                        onMouseEnter={(e) => {
                          if (!isActive) {
                            e.currentTarget.style.background =
                              "var(--bg-surface-hover)";
                            e.currentTarget.style.color = "var(--text-primary)";
                          }
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = isActive
                            ? "var(--accent-surface)"
                            : "transparent";
                          e.currentTarget.style.color = isActive
                            ? "var(--accent-text)"
                            : "var(--text-tertiary)";
                        }}
                        title={collapsed ? t(item.label) : undefined}
                      >
                        <div
                          className={`flex items-center justify-center ${collapsed ? "w-8 h-8" : "w-7 h-7"} rounded-lg transition-colors duration-200 shrink-0`}
                          style={{
                            background: isActive
                              ? "var(--accent)"
                              : "transparent",
                            color: isActive ? "#FFFFFF" : "inherit",
                          }}
                        >
                          <FontAwesomeIcon
                            icon={item.icon}
                            className={
                              isActive && !collapsed ? "w-3 h-3" : "w-3.5 h-3.5"
                            }
                          />
                        </div>
                        {!collapsed && <span>{t(item.label)}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* Bottom section */}
        <div
          className="shrink-0 px-2.5 pb-3 pt-2"
          style={{ borderTop: "1px solid var(--border-primary)" }}
        >
          {/* Settings */}
          <button
            onClick={() => {
              onNavigate("settings");
              setMobileOpen(false);
            }}
            className={`
              w-full flex items-center gap-3 rounded-xl transition-all duration-200 mt-1
              ${collapsed ? "justify-center px-0 py-2.5" : "px-3 py-2.5"}
            `}
            style={{
              background:
                activePanel === "settings"
                  ? "var(--accent-surface)"
                  : "transparent",
              color:
                activePanel === "settings"
                  ? "var(--accent-text)"
                  : "var(--text-tertiary)",
              fontSize: 13,
            }}
            onMouseEnter={(e) => {
              if (activePanel !== "settings") {
                e.currentTarget.style.background = "var(--bg-surface-hover)";
                e.currentTarget.style.color = "var(--text-primary)";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background =
                activePanel === "settings"
                  ? "var(--accent-surface)"
                  : "transparent";
              e.currentTarget.style.color =
                activePanel === "settings"
                  ? "var(--accent-text)"
                  : "var(--text-tertiary)";
            }}
            title={collapsed ? t("nav.settings", "Settings") : undefined}
          >
            <div
              className={`flex items-center justify-center ${collapsed ? "w-8 h-8" : "w-7 h-7"} rounded-lg shrink-0`}
              style={{
                background:
                  activePanel === "settings" ? "var(--accent)" : "transparent",
                color: activePanel === "settings" ? "#FFFFFF" : "inherit",
              }}
            >
              <FontAwesomeIcon icon={faGear} className="w-3.5 h-3.5" />
            </div>
            {!collapsed && <span>{t("nav.settings", "Settings")}</span>}
          </button>

          {/* User profile */}
          <div
            className={`
              flex items-center gap-3 rounded-xl mt-1.5 cursor-default
              ${collapsed ? "justify-center px-0 py-2.5" : "px-3 py-3"}
            `}
          >
            {/* Avatar with accent ring */}
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 overflow-hidden"
              style={{
                background: "var(--bg-elevated)",
                color: "var(--text-secondary)",
                boxShadow:
                  "0 0 0 2px var(--bg-sidebar), 0 0 0 3.5px var(--accent-surface-hover)",
              }}
            >
              {user?.avatar ? (
                <img
                  src={user.avatar}
                  alt={displayName}
                  className="w-full h-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p
                  className="text-[13px] font-medium truncate"
                  style={{ color: "var(--text-primary)" }}
                >
                  {displayName}
                </p>
                <p
                  className="text-[11px] capitalize"
                  style={{ color: "var(--text-disabled)" }}
                >
                  {entityLabel} · {roleLabel}
                </p>
              </div>
            )}
            {!collapsed && (
              <button
                onClick={onLogout}
                className="p-1.5 rounded-lg transition-all duration-200 shrink-0"
                style={{ color: "var(--text-disabled)" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background =
                    "var(--status-error-surface)";
                  e.currentTarget.style.color = "var(--status-error)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "var(--text-disabled)";
                }}
                title={t("auth.logout", "Sign out")}
              >
                <FontAwesomeIcon
                  icon={faRightFromBracket}
                  className="w-3.5 h-3.5"
                />
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
