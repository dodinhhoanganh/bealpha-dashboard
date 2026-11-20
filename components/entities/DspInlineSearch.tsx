"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { apiRequest } from "@/lib/api-client";
import {
  SpotifyIcon,
  AppleIcon,
  PersonIcon,
  CheckIcon,
} from "@/components/ui/Icon";

interface DspArtist {
  id: string;
  name: string;
  popularity?: number;
  genres: string[];
  imageUrl: string;
  externalUrl: string;
  platform: "spotify" | "apple";
  matchScore?: number;
}

interface DspInlineSearchProps {
  platform: "spotify" | "apple";
  value: string;
  onChange: (val: string) => void;
  artistName: string;
  onImageUrl?: (url: string) => void;
  placeholder?: string;
}

export default function DspInlineSearch({
  platform,
  value,
  onChange,
  artistName,
  onImageUrl,
  placeholder,
}: DspInlineSearchProps) {
  const { t } = useI18n();
  const [results, setResults] = useState<DspArtist[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasSearchedRef = useRef(false);

  const Icon = platform === "spotify" ? SpotifyIcon : AppleIcon;
  const accentColor = platform === "spotify" ? "#1DB954" : "#fa243c";
  const label = platform === "spotify"
    ? t("form.spotifyID", "Spotify ID")
    : t("form.appleMusicID", "Apple Music ID");

  const runSearch = useCallback(
    async (q: string) => {
      if (q.length < 2) {
        setResults([]);
        setLoading(false);
        return;
      }
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      try {
        const data = await apiRequest<Record<"spotify" | "apple", DspArtist[]>>(
          `/api/v1/catalog/artists/search-dsp?q=${encodeURIComponent(q)}`,
          { signal: ctrl.signal },
        );
        const platformResults: DspArtist[] = data[platform] ?? [];
        setResults(platformResults);
      } catch (e: unknown) {
        if ((e as { name?: string })?.name === "AbortError") return;
        setResults([]);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    },
    [platform],
  );

  // Auto-search on focus using the artist name
  const handleFocus = useCallback(() => {
    setShowDropdown(true);
    // Search if we haven't searched yet, or if we have no results (retry)
    if (artistName.trim().length >= 2 && (!hasSearchedRef.current || results.length === 0)) {
      hasSearchedRef.current = true;
      runSearch(artistName.trim());
    }
  }, [artistName, runSearch, results.length]);

  // Reset search state when artist name changes
  useEffect(() => {
    hasSearchedRef.current = false;
  }, [artistName]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelect = (artist: DspArtist) => {
    onChange(artist.id);
    setSelectedId(artist.id);
    setShowDropdown(false);
    if (onImageUrl && artist.imageUrl) {
      onImageUrl(artist.imageUrl);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <label className="block text-sm text-[var(--text-tertiary)] mb-1">
        <span className="flex items-center gap-1.5">
          <Icon size={14} />
          {label}
        </span>
      </label>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setSelectedId(null);
        }}
        onFocus={handleFocus}
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
      />

      {/* Dropdown results */}
      {showDropdown && (results.length > 0 || loading || hasSearchedRef.current) && (
        <div
          className="absolute z-50 left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-lg border"
          style={{
            background: "var(--bg-surface)",
            borderColor: "var(--border-primary)",
            boxShadow: "var(--shadow-xl)",
          }}
        >
          {loading && results.length === 0 && (
            <div className="px-3 py-4 text-center">
              <div className="inline-flex items-center gap-2 text-xs" style={{ color: "var(--text-tertiary)" }}>
                <div
                  className="w-3.5 h-3.5 border-2 rounded-full animate-spin"
                  style={{ borderColor: "var(--border-subtle)", borderTopColor: accentColor }}
                />
                {t("dsp.searching", "Searching…")}
              </div>
            </div>
          )}
          {!loading && results.length === 0 && (
            <div className="px-3 py-3 text-center text-xs" style={{ color: "var(--text-tertiary)" }}>
              {t("dsp.noResults", "No results found")}
            </div>
          )}
          {results.map((artist) => {
            const isSelected = value === artist.id || selectedId === artist.id;
            return (
              <button
                key={artist.id}
                type="button"
                onClick={() => handleSelect(artist)}
                className="w-full flex items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-[var(--bg-elevated)]"
                style={{
                  background: isSelected ? "var(--bg-elevated)" : undefined,
                }}
              >
                {/* Avatar */}
                <div
                  className="w-9 h-9 rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center"
                  style={{ background: "var(--bg-elevated)" }}
                >
                  {artist.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={artist.imageUrl}
                      alt={artist.name}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <PersonIcon size={16} style={{ color: "var(--text-tertiary)" }} />
                  )}
                </div>
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div
                    className="text-sm font-medium truncate"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {artist.name}
                  </div>
                  <div
                    className="text-xs truncate"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    {artist.id}
                    {artist.genres?.length > 0 && ` · ${artist.genres.slice(0, 2).join(", ")}`}
                  </div>
                </div>
                {/* Selected check */}
                {isSelected && (
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: accentColor, color: "white" }}
                  >
                    <CheckIcon size={12} />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
