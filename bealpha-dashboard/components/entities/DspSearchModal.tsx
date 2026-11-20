"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import {
  SearchIcon,
  CloseIcon,
  SpotifyIcon,
  AppleIcon,
  ArrowUpRightIcon,
  CheckIcon,
  PersonIcon,
} from "@/components/ui/Icon";
import { apiRequest } from "@/lib/api-client";

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

interface DspSelection {
  spotifyId?: string;
  appleMusicId?: string;
  imageUrl?: string;
  genres?: string[];
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onApply: (selection: DspSelection) => void;
  initialQuery?: string;
}

const DEBOUNCE_MS = 450;

export default function DspSearchModal({ isOpen, onClose, onApply, initialQuery = "" }: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState(initialQuery);
  const [loading, setLoading] = useState(false);
  const [spotify, setSpotify] = useState<DspArtist[]>([]);
  const [apple, setApple] = useState<DspArtist[]>([]);
  const [errors, setErrors] = useState<{ spotify: string | null; apple: string | null }>({
    spotify: null,
    apple: null,
  });
  const [selectedSpotify, setSelectedSpotify] = useState<DspArtist | null>(null);
  const [selectedApple, setSelectedApple] = useState<DspArtist | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (isOpen) setQuery(initialQuery);
  }, [isOpen, initialQuery]);

  const runSearch = useCallback(async (q: string) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    try {
      const data = await apiRequest<any>(`/api/v1/catalog/artists/search-dsp?q=${encodeURIComponent(q)}`, {
        signal: ctrl.signal,
      });
      setSpotify(data.spotify ?? []);
      setApple(data.apple ?? []);
      setErrors(data.errors ?? { spotify: null, apple: null });
    } catch (e: unknown) {
      if ((e as { name?: string })?.name === "AbortError") return;
      setSpotify([]);
      setApple([]);
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSpotify([]);
      setApple([]);
      setLoading(false);
      return;
    }
    const handle = setTimeout(() => runSearch(trimmed), DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query, isOpen, runSearch]);

  useEffect(() => {
    if (!isOpen) {
      abortRef.current?.abort();
      setSelectedSpotify(null);
      setSelectedApple(null);
      setSpotify([]);
      setApple([]);
      setQuery("");
    }
  }, [isOpen]);

  const handleApply = () => {
    if (!selectedSpotify && !selectedApple) return;
    const imageUrl = selectedSpotify?.imageUrl || selectedApple?.imageUrl || undefined;
    const genres = Array.from(
      new Set([...(selectedSpotify?.genres ?? []), ...(selectedApple?.genres ?? [])]),
    );
    onApply({
      spotifyId: selectedSpotify?.id,
      appleMusicId: selectedApple?.id,
      imageUrl,
      genres: genres.length ? genres : undefined,
    });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      style={{ animation: "backdropIn 0.2s ease-out" }}
    >
      <div
        className="absolute inset-0"
        style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)" }}
        onClick={onClose}
      />
      <div
        className="relative w-full max-w-5xl mx-4 max-h-[90vh] flex flex-col"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border-primary)",
          borderRadius: "var(--radius-2xl)",
          boxShadow: "var(--shadow-xl)",
          animation: "modalIn 0.25s cubic-bezier(0.2, 0, 0, 1)",
        }}
      >
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <h3 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
            {t("dsp.searchTitle", "Find artist on Spotify & Apple Music")}
          </h3>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg"
            style={{ color: "var(--text-tertiary)" }}
          >
            <CloseIcon size={18} />
          </button>
        </div>

        <div className="px-6 py-4" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          <div className="relative">
            <SearchIcon
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: "var(--text-tertiary)" }}
            />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("dsp.searchPlaceholder", "Type an artist name…")}
              className="w-full pl-10 pr-3 py-2 border rounded-lg focus:outline-none focus:ring-2"
              style={{
                background: "var(--bg-elevated)",
                borderColor: "var(--border-input)",
                color: "var(--text-primary)",
              }}
            />
          </div>
          {loading && (
            <p className="text-xs mt-2" style={{ color: "var(--text-tertiary)" }}>
              {t("dsp.searching", "Searching…")}
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <PlatformColumn
            platform="spotify"
            label={t("dsp.spotify", "Spotify")}
            results={spotify}
            error={errors.spotify}
            selected={selectedSpotify}
            onSelect={setSelectedSpotify}
            query={query}
            loading={loading}
          />
          <PlatformColumn
            platform="apple"
            label={t("dsp.appleMusic", "Apple Music")}
            results={apple}
            error={errors.apple}
            selected={selectedApple}
            onSelect={setSelectedApple}
            query={query}
            loading={loading}
          />
        </div>

        <div
          className="px-6 py-4 flex items-center justify-between"
          style={{ borderTop: "1px solid var(--border-subtle)" }}
        >
          <div className="text-xs flex items-center gap-3" style={{ color: "var(--text-tertiary)" }}>
            <span className="flex items-center gap-1">
              <SpotifyIcon size={14} />
              {selectedSpotify ? selectedSpotify.name : t("dsp.noneSelected", "None")}
            </span>
            <span className="flex items-center gap-1">
              <AppleIcon size={14} />
              {selectedApple ? selectedApple.name : t("dsp.noneSelected", "None")}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm"
              style={{
                background: "var(--bg-elevated)",
                color: "var(--text-secondary)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              {t("common.cancel", "Cancel")}
            </button>
            <button
              onClick={handleApply}
              disabled={!selectedSpotify && !selectedApple}
              className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: "var(--accent)", color: "white" }}
            >
              {t("dsp.applySelection", "Apply selection")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlatformColumn({
  platform,
  label,
  results,
  error,
  selected,
  onSelect,
  query,
  loading,
}: {
  platform: "spotify" | "apple";
  label: string;
  results: DspArtist[];
  error: string | null;
  selected: DspArtist | null;
  onSelect: (a: DspArtist | null) => void;
  query: string;
  loading: boolean;
}) {
  const { t } = useI18n();
  const Icon = platform === "spotify" ? SpotifyIcon : AppleIcon;
  const ringColor = platform === "spotify" ? "rgb(34, 197, 94)" : "rgb(239, 68, 68)";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Icon size={18} />
        <h4 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {label}
        </h4>
        <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>
          {results.length}
        </span>
      </div>

      {error && (
        <div
          className="text-xs px-3 py-2 rounded"
          style={{ background: "rgba(239,68,68,0.1)", color: "rgb(239,68,68)" }}
        >
          {error}
        </div>
      )}

      {!loading && !error && query.trim().length >= 2 && results.length === 0 && (
        <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
          {t("dsp.noResults", "No matches.")}
        </p>
      )}

      {loading && results.length === 0 && (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="aspect-square rounded-lg animate-pulse"
              style={{ background: "var(--bg-elevated)" }}
            />
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {results.map((a) => {
          const isSelected = selected?.id === a.id;
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => onSelect(isSelected ? null : a)}
              className="text-left rounded-lg overflow-hidden transition-all relative"
              style={{
                background: "var(--bg-elevated)",
                border: "1px solid var(--border-subtle)",
                boxShadow: isSelected ? `0 0 0 3px ${ringColor}` : "none",
              }}
            >
              <div
                className="aspect-square w-full relative"
                style={{ background: "var(--bg-surface)" }}
              >
                {a.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={a.imageUrl}
                    alt={a.name}
                    className="absolute inset-0 w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <PersonIcon size={32} style={{ color: "var(--text-tertiary)" }} />
                  </div>
                )}
                {isSelected && (
                  <div
                    className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center"
                    style={{ background: ringColor, color: "white" }}
                  >
                    <CheckIcon size={14} />
                  </div>
                )}
              </div>
              <div className="p-2">
                <div
                  className="text-xs font-medium truncate"
                  style={{ color: "var(--text-primary)" }}
                  title={a.name}
                >
                  {a.name}
                </div>
                {a.genres?.length > 0 && (
                  <div
                    className="text-[10px] truncate"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    {a.genres.slice(0, 2).join(" · ")}
                  </div>
                )}
                {typeof a.popularity === "number" && a.popularity > 0 && (
                  <div className="mt-1.5">
                    <div
                      className="h-1 rounded-full overflow-hidden"
                      style={{ background: "var(--bg-surface)" }}
                    >
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${a.popularity}%`,
                          background: ringColor,
                        }}
                      />
                    </div>
                    <div
                      className="text-[10px] mt-0.5"
                      style={{ color: "var(--text-tertiary)" }}
                    >
                      {a.popularity}/100
                    </div>
                  </div>
                )}
                <a
                  href={a.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="mt-1.5 text-[10px] flex items-center gap-1 hover:underline"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  {t("dsp.verify", "Verify")}
                  <ArrowUpRightIcon size={10} />
                </a>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
