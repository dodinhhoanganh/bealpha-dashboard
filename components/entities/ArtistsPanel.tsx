"use client";

import { useState, useEffect, useCallback } from "react";
import type { UserSession } from "@/lib/types";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { translateApiError } from "@/lib/i18n/translateApiError";
import ImageUpload from "@/components/ui/ImageUpload";
import SecureImage from "@/components/ui/SecureImage";
import Pagination from "@/components/ui/Pagination";
import { CardSkeleton } from "@/components/ui/Skeleton";
import Modal from "@/components/ui/Modal";
import {
  PersonIcon,
  AddIcon,
  SearchIcon,
  EditIcon,
  DeleteIcon,
  SpotifyIcon,
  AppleIcon,
} from "@/components/ui/Icon";
import {
  extractSpotifyArtistId,
  extractAppleMusicArtistId,
} from "@/lib/dsp-utils";
import { canManageCatalogRecord } from "@/lib/ui-capabilities";
import DspInlineSearch from "@/components/entities/DspInlineSearch";

import { ApiClientError, apiRequest } from "@/lib/api-client";

export interface ArtistSummary {
  id: string;
  name: string;
  isni?: string | null;
  ipi?: string | null;
  dpid?: string | null;
  spotifyId?: string | null;
  appleMusicId?: string | null;
  vevoChannel?: string | null;
  imageUrl?: string | null;
  labelName?: string | null;
}

// ============ ARTISTS COMPONENT ============
export default function ArtistsPanel({ user }: { user: UserSession }) {
  const { t } = useI18n(); // Auto-injected

  const [artists, setArtists] = useState<ArtistSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(20);
  const [editModal, setEditModal] = useState<{
    open: boolean;
    artist: ArtistSummary | null;
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


  const handleSpotifyIdChange = (raw: string) => {
    const extracted = extractSpotifyArtistId(raw);
    setFormData((prev) => ({ ...prev, spotifyId: extracted ?? raw }));
  };

  const handleAppleMusicIdChange = (raw: string) => {
    const extracted = extractAppleMusicArtistId(raw);
    setFormData((prev) => ({ ...prev, appleMusicId: extracted ?? raw }));
  };



  const canCreate = canManageCatalogRecord(user, "artist", "create");
  const canUpdate = canManageCatalogRecord(user, "artist", "update");
  const canDelete = canManageCatalogRecord(user, "artist", "delete");

  const fetchArtists = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await apiRequest<ArtistSummary[]>("/api/v1/catalog/artists");
      const query = search.trim().toLowerCase();
      const filtered = query
        ? rows.filter((artist) => artist.name.toLowerCase().includes(query))
        : rows;
      const pages = Math.max(1, Math.ceil(filtered.length / limit));
      setArtists(filtered.slice((page - 1) * limit, page * limit));
      setTotal(filtered.length);
      setTotalPages(pages);
    } catch (e) {
      console.error("Failed to load artists", e);
      setArtists([]);
      setTotal(0);
      setTotalPages(1);
      setError(e instanceof Error ? e.message : t("common.errorOccurred", "Something went wrong."));
    } finally {
      setLoading(false);
    }
  }, [limit, page, search, t]);

  useEffect(() => {
    void fetchArtists();
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

  const openEditModal = (artist: ArtistSummary) => {
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
    if (!formData.name.trim()) errors.push(`• ${t("common.artistNameRequired")}`);
    if (formData.name.trim().length > 0 && formData.name.trim().length < 2)
      errors.push(`• ${t("common.artistNameMin2")}`);
      
    if (formData.vevoChannel) {
      if (!/^[A-Za-z0-9]{1,16}VEVO$/.test(formData.vevoChannel)) {
        errors.push(`• ${t("common.vevoMustEndVEVO")} (${t("common.lettersAndNumbersOnly", "letters and numbers only")})`);
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
      await apiRequest(`/api/v1/catalog/artists/${editModal.artist.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          isni: formData.isni || null,
          ipi: formData.ipi || null,
          dpid: formData.dpid || null,
          spotifyId: formData.spotifyId || null,
          appleMusicId: formData.appleMusicId || null,
          vevoChannel: formData.vevoChannel || null,
          imageUrl: formData.imageUrl || null,
        }),
      });
      setEditModal({ open: false, artist: null });
      fetchArtists();
    } catch (e) {
      console.error(e);
      setFormError(e instanceof ApiClientError ? translateApiError(e.code, t) : t("common.errorOccurred"));
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
      await apiRequest("/api/v1/catalog/artists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          ...(formData.isni ? { isni: formData.isni } : {}),
          ...(formData.ipi ? { ipi: formData.ipi } : {}),
          ...(formData.dpid ? { dpid: formData.dpid } : {}),
          ...(formData.spotifyId ? { spotifyId: formData.spotifyId } : {}),
          ...(formData.appleMusicId ? { appleMusicId: formData.appleMusicId } : {}),
          ...(formData.vevoChannel ? { vevoChannel: formData.vevoChannel } : {}),
          ...(formData.imageUrl ? { imageUrl: formData.imageUrl } : {}),
        }),
      });
      setCreateModal(false);
      setFormData({ name: "", isni: "", ipi: "", dpid: "", spotifyId: "", appleMusicId: "", vevoChannel: "", imageUrl: "" });
      setFormError("");
      fetchArtists();
    } catch (e) {
      console.error(e);
      setFormError(e instanceof ApiClientError ? translateApiError(e.code, t) : t("common.errorOccurred"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const artist = artists.find((a) => a.id === id);
    const msg = `${t("common.confirmDeleteArtist")} "${artist?.name || ""}"

${t("common.deleteWillRemove")}
${t("label.deleteWarning")}

${t("common.cannotBeUndone")}`;
    if (!confirm(msg)) return;
    try {
      await apiRequest(`/api/v1/catalog/artists/${id}`, { method: "DELETE" });
      void fetchArtists();
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : t("common.errorOccurred", "Something went wrong."));
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
              entityName={formData.name || t("common.draftArtist", "Draft Artist")}
              artistName={formData.name || t("common.draftArtist", "Draft Artist")}
              labelName={
                editModal.open && editModal.artist
                  ? editModal.artist.labelName || t("common.independent", "Independent")
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
          <DspInlineSearch
            platform="spotify"
            value={formData.spotifyId}
            onChange={(val) => handleSpotifyIdChange(val)}
            artistName={formData.name}
            onImageUrl={(url) => {
              if (!formData.imageUrl) setFormData((prev) => ({ ...prev, imageUrl: url }));
            }}
            placeholder={t("form.placeholder.spotifyPaste", "ID, URL, or spotify:artist:… URI")}
          />
          <DspInlineSearch
            platform="apple"
            value={formData.appleMusicId}
            onChange={(val) => handleAppleMusicIdChange(val)}
            artistName={formData.name}
            onImageUrl={(url) => {
              if (!formData.imageUrl) setFormData((prev) => ({ ...prev, imageUrl: url }));
            }}
            placeholder={t("form.placeholder.applePaste", "ID or music.apple.com/…/artist/…/ID URL")}
          />
          <div>
            <label className="block text-sm text-[var(--text-tertiary)] mb-1">
              {t("ui.artistsPanel.vevoChannel", "VEVO Channel")}
              <span className="text-[var(--text-disabled)] text-xs ml-1">
              {t("ui.artistsPanel.mustEndInVEVOMax20Chars", "(Must end in VEVO, max 20 chars)")}
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
                {t("ui.page.internationalStandardNameIdentifier", "(International Standard Name Identifier)")}
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
                {t("ui.page.interestedPartyInformation", "(Interested Party Information)")}
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
                {t("ui.page.ddexPartyID", "(DDEX Party ID)")}
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
              {saving ? t("common.saving") : t("common.save")}
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
              entityName={formData.name || t("common.draftArtist", "Draft Artist")}
              artistName={formData.name || t("common.draftArtist", "Draft Artist")}
              labelName={t("common.independent", "Independent")}
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
          <DspInlineSearch
            platform="spotify"
            value={formData.spotifyId}
            onChange={(val) => handleSpotifyIdChange(val)}
            artistName={formData.name}
            onImageUrl={(url) => {
              if (!formData.imageUrl) setFormData((prev) => ({ ...prev, imageUrl: url }));
            }}
            placeholder={t("form.placeholder.spotifyPaste", "ID, URL, or spotify:artist:… URI")}
          />
          <DspInlineSearch
            platform="apple"
            value={formData.appleMusicId}
            onChange={(val) => handleAppleMusicIdChange(val)}
            artistName={formData.name}
            onImageUrl={(url) => {
              if (!formData.imageUrl) setFormData((prev) => ({ ...prev, imageUrl: url }));
            }}
            placeholder={t("form.placeholder.applePaste", "ID or music.apple.com/…/artist/…/ID URL")}
          />
          <div>
            <label className="block text-sm text-[var(--text-tertiary)] mb-1">
              ISNI{" "}
              <span className="text-[var(--text-disabled)] text-xs">
                {t("ui.page.internationalStandardNameIdentifier", "(International Standard Name Identifier)")}
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
                {t("ui.page.interestedPartyInformation", "(Interested Party Information)")}
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
                {t("ui.page.ddexPartyID", "(DDEX Party ID)")}
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
              {saving ? t("common.creating") : t("common.create")}
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
            {t("common.addArtist")}
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
      ) : error ? (
        <div role="alert" className="border-y border-[var(--border-primary)] py-10 text-center text-sm text-[var(--status-error)]">
          <p>{error}</p>
          <button type="button" onClick={() => void fetchArtists()} className="mt-3 underline underline-offset-2">
            {t("common.retry", "Retry")}
          </button>
        </div>
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
                    <SecureImage
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
                {artist.labelName || t("common.independent")}
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
