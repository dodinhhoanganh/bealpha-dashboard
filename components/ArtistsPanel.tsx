"use client";

import { useState, useEffect, useCallback } from "react";
import { UserSession } from "@/lib/types";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { translateApiError } from "@/lib/i18n/translateApiError";
import { useToast } from "@/components/Toast";
import { useUploadProgress } from "@/components/UploadProgress";
import ImageUpload from "@/components/ImageUpload";
import SearchableLabelSelect from "@/components/SearchableLabelSelect";
import Pagination from "@/components/Pagination";
import { TableSkeleton, CardSkeleton } from "@/components/Skeleton";
import Modal from "@/components/Modal";
import {
  PersonIcon,
  AddIcon,
  SearchIcon,
  EditIcon,
  DeleteIcon,
  ArrowBackIcon,
  PhotoCameraIcon,
  CloseIcon,
  SpotifyIcon,
  AppleIcon,
} from "@/components/Icon";

const UPLOAD_SERVER = process.env.NEXT_PUBLIC_UPLOAD_URL || "";

// ============ ARTISTS COMPONENT ============
export default function ArtistsPanel({ user }: { user: UserSession }) {
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

