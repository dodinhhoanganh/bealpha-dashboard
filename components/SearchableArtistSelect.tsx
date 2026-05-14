"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import {
  detectDspFromInput,
  spotifyArtistUrl,
  appleMusicArtistUrl,
} from "@/lib/dsp-utils";

import {
  SearchIcon,
  AddIcon,
  CloseIcon,
  MusicNoteIcon,
} from "@/components/Icon";

interface Artist {
  id: string;
  name: string;
  spotifyId?: string;
  appleMusicId?: string;
}

interface DspArtist {
  id: string;
  name: string;
  popularity?: number;
  genres: string[];
  imageUrl: string;
  externalUrl: string;
  platform: "spotify" | "apple";
}

interface SearchableArtistSelectProps {
  value: string;
  onChange: (artistId: string) => void;
  artists: Artist[];
  onCreateArtist: (artist: {
    name: string;
    spotifyId?: string;
    appleMusicId?: string;
  }) => Promise<string>;
  placeholder?: string;
}

export default function SearchableArtistSelect({
  value,
  onChange,
  artists,
  onCreateArtist,
  placeholder = "Search artist...",
}: SearchableArtistSelectProps) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [modalSearchTerm, setModalSearchTerm] = useState("");

  // DSP search results
  const [spotifyResults, setSpotifyResults] = useState<DspArtist[]>([]);
  const [appleResults, setAppleResults] = useState<DspArtist[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // URL paste detection
  const [pasteInput, setPasteInput] = useState("");
  const [detectedDsp, setDetectedDsp] = useState<{
    platform: "spotify" | "apple";
    id: string;
  } | null>(null);

  // Selection state — can select BOTH platforms independently
  const [selectedSpotify, setSelectedSpotify] = useState<DspArtist | null>(null);
  const [selectedApple, setSelectedApple] = useState<DspArtist | null>(null);

  const [isCreating, setIsCreating] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const selectedArtistData = artists.find((a) => a.id === value);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Filter artists based on search
  const filteredArtists = artists.filter((a) =>
    a.name.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  // Debounced parallel DSP search
  const searchDsp = useCallback(async (term: string) => {
    if (!term.trim() || term.trim().length < 2) return;
    setIsSearching(true);
    setHasSearched(true);
    try {
      const res = await fetch(
        `/api/artists/search-dsp?q=${encodeURIComponent(term.trim())}`,
      );
      if (res.ok) {
        const data = await res.json();
        setSpotifyResults(data.spotify || []);
        setAppleResults(data.apple || []);
      }
    } catch (error) {
      console.error("DSP search error:", error);
    } finally {
      setIsSearching(false);
    }
  }, []);

  // Handle search with debounce
  const handleModalSearchChange = (value: string) => {
    setModalSearchTerm(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      searchDsp(value);
    }, 500);
  };

  // Handle URL paste detection
  const handlePasteInput = (value: string) => {
    setPasteInput(value);
    const detected = detectDspFromInput(value);
    setDetectedDsp(detected);
  };

  // Reset modal state
  const resetModal = () => {
    setShowCreateModal(false);
    setModalSearchTerm("");
    setSpotifyResults([]);
    setAppleResults([]);
    setSelectedSpotify(null);
    setSelectedApple(null);
    setPasteInput("");
    setDetectedDsp(null);
    setHasSearched(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
  };

  const handleCreateArtist = async () => {
    if (!modalSearchTerm.trim()) {
      alert(t("error.artistNameIsRequired", "Artist name is required"));
      return;
    }
    if (modalSearchTerm.trim().length < 2) {
      alert(t("error.artistNameMustBeAtLeast2Characters", "Artist name must be at least 2 characters"));
      return;
    }
    setIsCreating(true);
    try {
      let spotifyId: string | undefined;
      let appleMusicId: string | undefined;

      // From card selection
      if (selectedSpotify) spotifyId = selectedSpotify.id;
      if (selectedApple) appleMusicId = selectedApple.id;

      // From URL paste (override if not already set)
      if (detectedDsp) {
        if (detectedDsp.platform === "spotify" && !spotifyId) {
          spotifyId = detectedDsp.id;
        } else if (detectedDsp.platform === "apple" && !appleMusicId) {
          appleMusicId = detectedDsp.id;
        }
      }

      const newArtistId = await onCreateArtist({
        name: modalSearchTerm.trim(),
        spotifyId,
        appleMusicId,
      });

      onChange(newArtistId);
      resetModal();
      setIsOpen(false);
    } catch (error) {
      console.error("Error creating artist:", error);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <>
      <div ref={wrapperRef} className="relative">
        <div
          className="w-full px-4 py-3 bg-[var(--bg-surface)] border border-[var(--border-primary)] rounded-lg text-[var(--text-primary)] cursor-pointer flex items-center justify-between"
          onClick={() => setIsOpen(!isOpen)}
        >
          <span
            className={selectedArtistData ? "" : "text-[var(--text-disabled)]"}
          >
            {selectedArtistData?.name || placeholder}
          </span>
          <SearchIcon size={20} color="#737373" />
        </div>

        {isOpen && (
          <div className="absolute z-50 w-full mt-1 bg-[var(--bg-surface)] border border-[var(--border-primary)] rounded-lg shadow-lg max-h-80 overflow-hidden flex flex-col">
            {/* Search Input */}
            <div className="p-2 border-b border-[var(--border-primary)]">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={t("form.placeholder.enterArtistName", "Enter artist name")}
                className="w-full px-3 py-2 bg-transparent border border-[var(--border-input)] rounded-md text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                autoFocus
              />
            </div>

            {/* Results */}
            <div className="overflow-y-auto flex-1">
              {filteredArtists.length > 0 &&
                filteredArtists.map((artist) => (
                  <div
                    key={artist.id}
                    onClick={() => {
                      onChange(artist.id);
                      setIsOpen(false);
                      setSearchTerm("");
                    }}
                    className="px-4 py-3 hover:bg-[var(--bg-surface-hover)] cursor-pointer border-b border-[var(--border-subtle)] last:border-0"
                  >
                    <div className="font-medium">{artist.name}</div>
                    {(artist.spotifyId || artist.appleMusicId) && (
                      <div className="text-xs text-[var(--text-disabled)] mt-1 flex items-center gap-2">
                        {artist.spotifyId && (
                          <span className="inline-flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-[#1DB954]" />
                            Spotify
                          </span>
                        )}
                        {artist.appleMusicId && (
                          <span className="inline-flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-[#FC3C44]" />
                            Apple Music
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ))}

              {/* Create New Option */}
              <div
                onClick={() => {
                  setModalSearchTerm(searchTerm);
                  if (searchTerm.trim().length >= 2) {
                    searchDsp(searchTerm);
                  }
                  setShowCreateModal(true);
                  setIsOpen(false);
                }}
                className="px-4 py-3 hover:bg-[var(--accent)]/20 cursor-pointer border-t border-[var(--border-input)] text-[var(--accent-text)] flex items-center gap-2"
              >
                <AddIcon size={18} />
                <span className="text-sm font-medium">
                  {searchTerm
                    ? `${t("button.createNewArtist", "Create New Artist")} "${searchTerm}"`
                    : t("button.createNewArtist", "Create New Artist")}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ===== CREATE ARTIST MODAL ===== */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <div className="bg-[var(--bg-surface)] rounded-xl w-full max-w-2xl border border-[var(--border-primary)] max-h-[90vh] flex flex-col shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-[var(--border-primary)]">
              <h3 className="text-lg font-semibold">{t("heading.addNewArtist", "Add New Artist")}</h3>
              <button onClick={resetModal} className="p-1.5 hover:bg-[var(--bg-elevated)] rounded-lg transition-colors">
                <CloseIcon size={20} />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Artist Name + Search */}
              <div>
                <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                  {t("form.artistName", "Artist Name")}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={modalSearchTerm}
                    onChange={(e) => handleModalSearchChange(e.target.value)}
                    className="flex-1 px-3 py-2.5 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    placeholder={t("form.placeholder.enterArtistName", "Enter artist name")}
                    autoFocus
                  />
                  <button
                    onClick={() => searchDsp(modalSearchTerm)}
                    disabled={isSearching || !modalSearchTerm.trim()}
                    className="px-4 py-2.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:bg-[var(--bg-elevated)] disabled:text-[var(--text-disabled)] text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    {isSearching ? "..." : t("common.search", "Search")}
                  </button>
                </div>
                <p className="text-xs text-[var(--text-disabled)] mt-1.5">
                  {t("form.hint.dspSearch", "Search will query Spotify and Apple Music simultaneously")}
                </p>
              </div>

              {/* URL Paste — for manual ID extraction */}
              <div>
                <label className="block text-sm font-medium text-[var(--text-tertiary)] mb-2">
                  {t("form.pasteUrl", "Or paste Spotify/Apple Music URL")}
                </label>
                <input
                  type="text"
                  value={pasteInput}
                  onChange={(e) => handlePasteInput(e.target.value)}
                  className="w-full px-3 py-2.5 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] text-sm"
                  placeholder="https://open.spotify.com/artist/... or https://music.apple.com/..."
                />
                {detectedDsp && (
                  <div className="mt-2 p-2.5 rounded-lg bg-[var(--status-success-surface)] border border-green-500/30">
                    <span className="text-sm text-[var(--accent-text)] flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${detectedDsp.platform === "spotify" ? "bg-[#1DB954]" : "bg-[#FC3C44]"}`} />
                      {detectedDsp.platform === "spotify" ? "Spotify" : "Apple Music"} ID: <code className="font-mono bg-black/20 px-1.5 py-0.5 rounded text-xs">{detectedDsp.id}</code>
                    </span>
                  </div>
                )}
              </div>

              {/* DSP Results — Dual Panel */}
              {hasSearched && (
                <div className="space-y-4">
                  {/* Spotify Results */}
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="w-3 h-3 rounded-full bg-[#1DB954]" />
                      <span className="text-sm font-medium">Spotify</span>
                      <span className="text-xs text-[var(--text-disabled)]">({spotifyResults.length} {t("common.results", "results")})</span>
                    </div>
                    {spotifyResults.length > 0 ? (
                      <div className="space-y-1.5 max-h-48 overflow-y-auto">
                        {spotifyResults.map((artist) => (
                          <div
                            key={artist.id}
                            onClick={() => setSelectedSpotify(selectedSpotify?.id === artist.id ? null : artist)}
                            className={`p-3 border rounded-lg cursor-pointer transition-all ${
                              selectedSpotify?.id === artist.id
                                ? "border-[#1DB954] bg-[#1DB954]/10 ring-2 ring-[#1DB954]/30"
                                : "border-[var(--border-primary)] hover:border-[var(--border-primary)] hover:bg-[var(--bg-surface-hover)]"
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              {artist.imageUrl ? (
                                <img src={artist.imageUrl} alt={artist.name} className="w-11 h-11 rounded-full object-cover flex-shrink-0" />
                              ) : (
                                <div className="w-11 h-11 rounded-full bg-[var(--bg-elevated)] flex items-center justify-center flex-shrink-0">
                                  <MusicNoteIcon size={18} color="#737373" />
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm truncate">{artist.name}</div>
                                <div className="text-xs text-[var(--text-disabled)] truncate">
                                  {artist.popularity ? `${t("common.popularity", "Popularity")}: ${artist.popularity}` : ""}
                                  {artist.genres.length > 0 ? ` • ${artist.genres.slice(0, 2).join(", ")}` : ""}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <a
                                  href={artist.externalUrl || spotifyArtistUrl(artist.id)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-[#1DB954] hover:underline"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {t("button.verify", "Verify")} ↗
                                </a>
                                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                                  selectedSpotify?.id === artist.id ? "border-[#1DB954]" : "border-[var(--border-primary)]"
                                }`}>
                                  {selectedSpotify?.id === artist.id && (
                                    <div className="w-3 h-3 rounded-full bg-[#1DB954]" />
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-[var(--text-disabled)] py-2">
                        {isSearching ? t("common.searching", "Searching...") : t("common.noResults", "No results found")}
                      </p>
                    )}
                  </div>

                  {/* Apple Music Results */}
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="w-3 h-3 rounded-full bg-[#FC3C44]" />
                      <span className="text-sm font-medium">Apple Music</span>
                      <span className="text-xs text-[var(--text-disabled)]">({appleResults.length} {t("common.results", "results")})</span>
                    </div>
                    {appleResults.length > 0 ? (
                      <div className="space-y-1.5 max-h-48 overflow-y-auto">
                        {appleResults.map((artist) => (
                          <div
                            key={artist.id}
                            onClick={() => setSelectedApple(selectedApple?.id === artist.id ? null : artist)}
                            className={`p-3 border rounded-lg cursor-pointer transition-all ${
                              selectedApple?.id === artist.id
                                ? "border-[#FC3C44] bg-[#FC3C44]/10 ring-2 ring-[#FC3C44]/30"
                                : "border-[var(--border-primary)] hover:border-[var(--border-primary)] hover:bg-[var(--bg-surface-hover)]"
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              {artist.imageUrl ? (
                                <img src={artist.imageUrl} alt={artist.name} className="w-11 h-11 rounded-full object-cover flex-shrink-0" />
                              ) : (
                                <div className="w-11 h-11 rounded-full bg-[var(--bg-elevated)] flex items-center justify-center flex-shrink-0">
                                  <MusicNoteIcon size={18} color="#737373" />
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm truncate">{artist.name}</div>
                                <div className="text-xs text-[var(--text-disabled)] truncate">
                                  {artist.genres.length > 0 ? artist.genres.join(", ") : "Music"}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <a
                                  href={artist.externalUrl || appleMusicArtistUrl(artist.id)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-[#FC3C44] hover:underline"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {t("button.verify", "Verify")} ↗
                                </a>
                                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                                  selectedApple?.id === artist.id ? "border-[#FC3C44]" : "border-[var(--border-primary)]"
                                }`}>
                                  {selectedApple?.id === artist.id && (
                                    <div className="w-3 h-3 rounded-full bg-[#FC3C44]" />
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-[var(--text-disabled)] py-2">
                        {isSearching ? t("common.searching", "Searching...") : t("common.noResults", "No results found")}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Selection Summary */}
              {(selectedSpotify || selectedApple || detectedDsp) && (
                <div className="p-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-primary)]">
                  <p className="text-xs font-medium text-[var(--text-tertiary)] mb-2">
                    {t("form.linkedProfiles", "Linked Profiles")}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {(selectedSpotify || detectedDsp?.platform === "spotify") && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#1DB954]/15 text-xs font-medium text-[#1DB954]">
                        <span className="w-2 h-2 rounded-full bg-[#1DB954]" />
                        Spotify: {selectedSpotify?.name || detectedDsp?.id}
                      </span>
                    )}
                    {(selectedApple || detectedDsp?.platform === "apple") && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#FC3C44]/15 text-xs font-medium text-[#FC3C44]">
                        <span className="w-2 h-2 rounded-full bg-[#FC3C44]" />
                        Apple: {selectedApple?.name || detectedDsp?.id}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-5 border-t border-[var(--border-primary)] flex items-center justify-between">
              <button
                onClick={resetModal}
                className="px-5 py-2.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] rounded-lg transition-colors text-sm font-medium"
              >
                {t("common.cancel", "Cancel")}
              </button>
              <button
                onClick={handleCreateArtist}
                disabled={isCreating || !modalSearchTerm.trim() || modalSearchTerm.trim().length < 2}
                className="px-6 py-2.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:bg-[var(--bg-elevated)] disabled:text-[var(--text-disabled)] text-white rounded-lg font-medium transition-colors text-sm"
              >
                {isCreating ? t("common.adding", "Adding...") : t("heading.addNewArtist", "Add Artist")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
