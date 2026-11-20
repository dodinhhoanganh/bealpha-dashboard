"use client";

import { useState, useRef, useEffect } from "react";
import {
  faMagnifyingGlass,
  faSun,
  faMoon,
  faPlus,
  faCompactDisc,
  faCloudArrowUp,
} from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useTheme } from "@/components/layout/ThemeProvider";
import NotificationBell from "@/components/ui/NotificationBell";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { searchAcrossServices } from "@/lib/global-search";
import SecureImage from "@/components/ui/SecureImage";
import type { UserSession } from "@/lib/types";

interface TopBarProps {
  title?: string;
  subtitle?: string;
  onNavigate: (panel: string) => void;
  activePanel?: string;
  user: UserSession;
}

interface SearchResult {
  id: string;
  type: string;
  title: string;
  subtitle?: string;
  image?: string;
}

interface QuickAction {
  panel: string;
  label: string;
  icon: IconDefinition;
  iconBackground: string;
  iconColor: string;
}

const SEARCH_SCOPES: Record<string, string> = {
  artists: "ARTIST",
  releases: "RELEASE",
  assets: "ASSET",
  labels: "LABEL",
};

const SEARCH_PLACEHOLDERS: Record<string, { key: string; fallback: string }> = {
  artists: { key: "artists.search", fallback: "Search artists..." },
  releases: { key: "releases.search", fallback: "Search releases..." },
  assets: { key: "assets.search", fallback: "Search assets..." },
  labels: { key: "labels.search", fallback: "Search labels..." },
};

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function isSafeThumbnailUrl(value: string): boolean {
  if (value.startsWith("media-asset:")) return true;
  if (value.startsWith("/uploads/") || value.startsWith("/api/")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function SearchResultThumbnail({ item }: { item: SearchResult }) {
  if (!item.image || !isSafeThumbnailUrl(item.image)) {
    return (
      <span className="text-[10px] font-bold text-[var(--text-secondary)]">
        {item.type.charAt(0) || "?"}
      </span>
    );
  }

  return (
    <SecureImage
      src={item.image}
      alt={item.title}
      className="block h-full w-full object-cover"
      loading="lazy"
    />
  );
}

function QuickActionButton({
  action,
  onSelect,
}: {
  action: QuickAction;
  onSelect: (panel: string) => void;
}) {
  return (
    <button
      onClick={() => onSelect(action.panel)}
      className="workbench-nav-item w-full flex items-center gap-3 px-3.5 py-2.5 text-sm rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
    >
      <div
        className="w-7 h-7 rounded-md flex items-center justify-center"
        style={{ background: action.iconBackground }}
      >
        <FontAwesomeIcon
          icon={action.icon}
          className="w-3.5 h-3.5"
          style={{ color: action.iconColor }}
        />
      </div>
      {action.label}
    </button>
  );
}

export default function TopBar({ title, subtitle, onNavigate, activePanel = "dashboard", user }: TopBarProps) {
  const { theme, toggleTheme } = useTheme();
  const { t } = useI18n();
  const [searchQuery, setSearchQuery] = useState("");
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const quickRef = useRef<HTMLDivElement>(null);
  
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchDropdownOpen, setSearchDropdownOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const quickActions: QuickAction[] = user.permissions.includes("release.create") ? [
    {
      panel: "catalog",
      label: t("dashboard.newRelease", "New Release"),
      icon: faCompactDisc,
      iconBackground: "var(--accent-surface)",
      iconColor: "var(--accent)",
    },
    {
      panel: "assets",
      label: t("assets.newAsset", "Upload Asset"),
      icon: faCloudArrowUp,
      iconBackground: "var(--status-info-surface)",
      iconColor: "var(--status-info)",
    },
  ] : [];

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (quickRef.current && !quickRef.current.contains(e.target as Node)) {
        setQuickActionsOpen(false);
      }
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      setSearchDropdownOpen(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        setSearchResults(await searchAcrossServices(query, SEARCH_SCOPES[activePanel] ?? "ALL", controller.signal));
        setSearchDropdownOpen(true);
      } catch (error) {
        if (!isAbortError(error)) {
          setSearchResults([]);
          setSearchDropdownOpen(true);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsSearching(false);
        }
      }
    }, 300);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [searchQuery, activePanel]);

  const handleResultClick = (item: SearchResult) => {
    setSearchDropdownOpen(false);
    setSearchQuery("");
    const panel = { RELEASE: "releases", ARTIST: "artists", ASSET: "assets", LABEL: "labels" }[item.type];
    const key = { RELEASE: "releaseId", ARTIST: "artistId", ASSET: "assetId", LABEL: "labelId" }[item.type];
    if (panel && key) {
      const query = new URLSearchParams({ panel, [key]: item.id, title: item.title });
      onNavigate(`/?${query.toString()}`);
    }
  };

  const getSearchPlaceholder = () => {
    const placeholder = SEARCH_PLACEHOLDERS[activePanel];
    return placeholder
      ? t(placeholder.key, placeholder.fallback)
      : t("common.searchPlaceholder", "Search everything...");
  };

  const handleQuickAction = (panel: string) => {
    onNavigate(panel);
    setQuickActionsOpen(false);
  };

  return (
    <header
      className="workbench-commandbar sticky top-0 z-30 flex items-center justify-between pl-16 pr-3 sm:px-5 shrink-0"
      style={{
        height: "var(--topbar-height)",
      }}
    >
      <div className="min-w-0 flex-1">
        {title && (
          <h1 className="truncate text-sm font-semibold tracking-[-0.015em] text-[var(--text-primary)]">
            {title}
          </h1>
        )}
        {subtitle && (
          <p className="truncate text-xs text-[var(--text-tertiary)]">
            {subtitle}
          </p>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <div
          ref={searchRef}
          className="relative hidden w-[320px] items-center sm:flex lg:w-[440px] mr-3"
        >
          <FontAwesomeIcon
            icon={faMagnifyingGlass}
            className={`absolute left-3.5 w-3.5 h-3.5 transition-colors duration-200 ${isSearching ? "animate-pulse" : ""}`}
            style={{
              color: searchFocused ? "var(--accent)" : "var(--text-disabled)",
            }}
          />
          <input
            type="text"
            placeholder={getSearchPlaceholder()}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => {
              setSearchFocused(true);
              if (searchResults.length > 0) setSearchDropdownOpen(true);
            }}
            onBlur={() => setSearchFocused(false)}
            className="w-full pl-10 pr-9 py-2 rounded-lg text-sm focus:outline-none"
            style={{
              background: searchFocused
                ? "var(--bg-surface)"
                : "var(--bg-surface-hover)",
              border: searchFocused
                ? "1px solid var(--accent)"
                : "1px solid var(--border-input)",
              color: "var(--text-primary)",
              boxShadow: searchFocused
                ? "0 0 0 3px var(--accent-surface)"
                : "none",
              transition: "background var(--transition-fast), border-color var(--transition-fast), box-shadow var(--transition-fast)",
            }}
          />
          {searchQuery && (
            <button
              onClick={() => {
                 setSearchQuery("");
                 setSearchResults([]);
                 setSearchDropdownOpen(false);
              }}
              className="absolute right-3 flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-disabled)] hover:text-[var(--text-secondary)]"
              aria-label={t("common.clear", "Clear search")}
            >
              ×
            </button>
          )}

          {searchDropdownOpen && searchQuery && (
            <div
              className="workbench-panel absolute right-0 top-full mt-2 w-full overflow-hidden"
              style={{
                background: "var(--bg-surface)",
                boxShadow: "var(--shadow-lg)",
                animation: "dropdownIn var(--dur-short) var(--ease-out)",
                maxHeight: "400px",
                overflowY: "auto",
              }}
            >
              {isSearching ? (
                <div className="p-4 text-center text-sm" style={{ color: "var(--text-tertiary)" }}>
                  {t("common.searching", "Searching...")}
                </div>
              ) : searchResults.length === 0 ? (
                <div className="p-4 text-center text-sm" style={{ color: "var(--text-tertiary)" }}>
                  {t("ui.topBar.noResultsFound", "No results found.")}
                </div>
              ) : (
                <div className="py-2">
                  {searchResults.map((item) => (
                    <button
                      key={`${item.type}-${item.id}`}
                      onClick={() => handleResultClick(item)}
                      className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-[var(--bg-surface-hover)] transition-colors"
                    >
                      <div className="w-8 h-8 rounded bg-[var(--bg-elevated)] flex-shrink-0 overflow-hidden flex items-center justify-center border border-[var(--border-subtle)]">
                        <SearchResultThumbnail item={item} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[var(--text-primary)] truncate">{item.title}</p>
                        <p className="text-[10px] text-[var(--text-tertiary)] truncate">{item.subtitle ?? ""}</p>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
                        {item.type}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {quickActions.length > 0 && <div ref={quickRef} className="relative">
          <button
            onClick={() => setQuickActionsOpen(!quickActionsOpen)}
            className="w-9 h-9 flex items-center justify-center rounded-lg"
            style={{
              color: quickActionsOpen
                ? "var(--accent-text)"
                : "var(--text-secondary)",
              background: quickActionsOpen
                ? "var(--accent-surface)"
                : "transparent",
            }}
            onMouseEnter={(e) => {
              if (!quickActionsOpen) {
                e.currentTarget.style.background = "var(--bg-surface-hover)";
                e.currentTarget.style.color = "var(--text-primary)";
              }
            }}
            onMouseLeave={(e) => {
              if (!quickActionsOpen) {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "var(--text-secondary)";
              }
            }}
            title={t("dashboard.quickActions", "Quick actions")}
          >
            <FontAwesomeIcon icon={faPlus} className="w-3.5 h-3.5" />
          </button>
          {quickActionsOpen && (
            <div
              className="workbench-panel absolute right-0 top-full mt-2 w-52 overflow-hidden"
              style={{
                background: "var(--bg-surface)",
                boxShadow: "var(--shadow-lg)",
                animation: "dropdownIn var(--dur-short) var(--ease-out)",
              }}
            >
              <div className="p-1.5">
                {quickActions.map((action) => (
                  <QuickActionButton
                    key={action.panel}
                    action={action}
                    onSelect={handleQuickAction}
                  />
                ))}
              </div>
            </div>
          )}
        </div>}

        <button
          onClick={toggleTheme}
          className="w-9 h-9 flex items-center justify-center rounded-lg"
          style={{ color: "var(--text-secondary)" }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--bg-surface-hover)";
            e.currentTarget.style.color = "var(--text-primary)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--text-secondary)";
          }}
          title={
            theme === "dark" ? t("settings.lightMode", "Switch to light mode") : t("settings.darkMode", "Switch to dark mode")
          }
        >
          <FontAwesomeIcon
            icon={theme === "dark" ? faSun : faMoon}
            className="w-3.5 h-3.5"
          />
        </button>

        <NotificationBell onNavigate={onNavigate} />
      </div>
    </header>
  );
}
