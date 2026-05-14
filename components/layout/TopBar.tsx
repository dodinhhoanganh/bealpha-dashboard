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
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useTheme } from "@/components/ThemeProvider";
import NotificationBell from "@/components/NotificationBell";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { useToast } from "@/components/Toast";

interface TopBarProps {
  title?: string;
  subtitle?: string;
  onNavigate: (panel: string) => void;
  activePanel?: string;
}

export default function TopBar({ title, subtitle, onNavigate, activePanel = "dashboard" }: TopBarProps) {
  const { theme, toggleTheme } = useTheme();
  const { t } = useI18n();
  const { showToast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const quickRef = useRef<HTMLDivElement>(null);
  
  // Search state
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchDropdownOpen, setSearchDropdownOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // Close quick actions on outside click
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

  // Debounced search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setSearchDropdownOpen(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        let scope = "ALL";
        if (activePanel === "artists") scope = "ARTIST";
        else if (activePanel === "releases") scope = "RELEASE";
        else if (activePanel === "assets") scope = "ASSET";
        else if (activePanel === "labels") scope = "LABEL";

        const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}&scope=${scope}`);
        if (res.ok) {
          const json = await res.json();
          setSearchResults(json.data || []);
          setSearchDropdownOpen(true);
        }
      } catch (err) {
        console.error("Search failed:", err);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, activePanel]);

  const handleResultClick = (item: any) => {
    setSearchDropdownOpen(false);
    setSearchQuery("");
    window.dispatchEvent(new CustomEvent("open-entity", { detail: { type: item.type, id: item.id, title: item.title } }));
  };

  const getSearchPlaceholder = () => {
    switch (activePanel) {
      case "artists": return t("artists.search", "Search artists...");
      case "releases": return t("releases.search", "Search releases...");
      case "assets": return t("assets.search", "Search assets...");
      case "labels": return t("labels.search", "Search labels...");
      default: return t("common.searchPlaceholder", "Search everything...");
    }
  };

  return (
    <header
      className="sticky top-0 z-30 flex items-center justify-between px-6 shrink-0 glass"
      style={{
        height: "var(--topbar-height)",
        borderBottom: "1px solid var(--border-primary)",
      }}
    >
      {/* Left — spacer */}
      <div className="flex-1" />

      {/* Right — Actions */}
      <div className="flex items-center gap-1.5">
        {/* Search input — pill shape */}
        <div
          ref={searchRef}
          className={`relative flex items-center transition-all duration-300 mr-3 ${searchFocused || searchDropdownOpen ? "w-[440px]" : "w-[320px]"}`}
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
            className="w-full pl-10 pr-4 py-2 rounded-full text-sm transition-all duration-200 focus:outline-none"
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
            }}
          />
          {searchQuery && (
            <button
              onClick={() => {
                 setSearchQuery("");
                 setSearchResults([]);
                 setSearchDropdownOpen(false);
              }}
              className="absolute right-3 text-[var(--text-disabled)] hover:text-[var(--text-secondary)] transition-colors"
            >
              ×
            </button>
          )}

          {/* Search Dropdown */}
          {searchDropdownOpen && searchQuery && (
            <div
              className="absolute right-0 top-full mt-2 w-full rounded-xl overflow-hidden"
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border-primary)",
                boxShadow: "var(--shadow-lg)",
                animation: "dropdownIn 0.15s ease-out",
                maxHeight: "400px",
                overflowY: "auto",
              }}
            >
              {isSearching ? (
                <div className="p-4 text-center text-sm" style={{ color: "var(--text-tertiary)" }}>
                  Searching...
                </div>
              ) : searchResults.length === 0 ? (
                <div className="p-4 text-center text-sm" style={{ color: "var(--text-tertiary)" }}>
                  No results found.
                </div>
              ) : (
                <div className="py-2">
                  {searchResults.map((item, idx) => (
                    <button
                      key={`${item.type}-${item.id}-${idx}`}
                      onClick={() => handleResultClick(item)}
                      className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-[var(--bg-surface-hover)] transition-colors"
                    >
                      <div className="w-8 h-8 rounded bg-[var(--bg-elevated)] flex-shrink-0 overflow-hidden flex items-center justify-center border border-[var(--border-subtle)]">
                        {item.image ? (
                          <img src={item.image} alt={item.title} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-[10px] font-bold text-[var(--text-secondary)]">{item.type[0]}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[var(--text-primary)] truncate">{item.title}</p>
                        <p className="text-[10px] text-[var(--text-tertiary)] truncate">{item.subtitle}</p>
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

        {/* Quick actions */}
        <div ref={quickRef} className="relative">
          <button
            onClick={() => setQuickActionsOpen(!quickActionsOpen)}
            className="w-9 h-9 flex items-center justify-center rounded-xl transition-all duration-200"
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
              className="absolute right-0 top-full mt-2 w-52 rounded-xl overflow-hidden"
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border-primary)",
                boxShadow: "var(--shadow-lg)",
                animation: "dropdownIn 0.15s ease-out",
              }}
            >
              <div className="p-1.5">
                <button
                  onClick={() => {
                    onNavigate("catalog");
                    setQuickActionsOpen(false);
                  }}
                  className="w-full flex items-center gap-3 px-3.5 py-2.5 text-sm rounded-lg transition-all duration-150"
                  style={{ color: "var(--text-secondary)" }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background =
                      "var(--bg-surface-hover)";
                    e.currentTarget.style.color = "var(--text-primary)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = "var(--text-secondary)";
                  }}
                >
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center"
                    style={{ background: "var(--accent-surface)" }}
                  >
                    <FontAwesomeIcon
                      icon={faCompactDisc}
                      className="w-3.5 h-3.5"
                      style={{ color: "var(--accent)" }}
                    />
                  </div>
                  {t("dashboard.newRelease", "New Release")}
                </button>
                <button
                  onClick={() => {
                    onNavigate("assets");
                    setQuickActionsOpen(false);
                  }}
                  className="w-full flex items-center gap-3 px-3.5 py-2.5 text-sm rounded-lg transition-all duration-150"
                  style={{ color: "var(--text-secondary)" }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background =
                      "var(--bg-surface-hover)";
                    e.currentTarget.style.color = "var(--text-primary)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = "var(--text-secondary)";
                  }}
                >
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center"
                    style={{ background: "var(--status-info-surface)" }}
                  >
                    <FontAwesomeIcon
                      icon={faCloudArrowUp}
                      className="w-3.5 h-3.5"
                      style={{ color: "var(--status-info)" }}
                    />
                  </div>
                  {t("assets.newAsset", "Upload Asset")}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="w-9 h-9 flex items-center justify-center rounded-xl transition-all duration-200"
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

        {/* Notifications */}
        <NotificationBell onNavigate={onNavigate} />
      </div>
    </header>
  );
}
