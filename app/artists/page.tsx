"use client";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { translateApiError } from "@/lib/i18n/translateApiError";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  PersonAddIcon,
  EditIcon,
  DeleteIcon,
  SearchIcon,
  ArrowBackIcon,
  CloseIcon,
  AlbumIcon,
  MusicNoteIcon,
  WarningIcon,
} from "@/components/Icon";

interface Label {
  id: string;
  name: string;
}

interface Artist {
  id: string;
  name: string;
  bio?: string;
  isni?: string;
  ipi?: string;
  dpid?: string;
  imageUrl?: string;
  label?: Label;
  labelName: string;
  releaseCount: number;
  trackCount: number;
  createdAt: string;
}

interface UserPermissions {
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  isAdmin: boolean;
  isLabel: boolean;
  isDistributor: boolean;
  isArtist: boolean;
}

export default function ArtistsPage() {
  const { t } = useI18n(); // Auto-injected

  const router = useRouter();
  const [artists, setArtists] = useState<Artist[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [labelFilter, setLabelFilter] = useState("");
  const [permissions, setPermissions] = useState<UserPermissions>({
    canCreate: false,
    canUpdate: false,
    canDelete: false,
    isAdmin: false,
    isLabel: false,
    isDistributor: false,
    isArtist: false,
  });

  // Modal states
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [selectedArtist, setSelectedArtist] = useState<Artist | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    bio: "",
    isni: "",
    ipi: "",
    dpid: "",
    imageUrl: "",
    labelId: "",
  });
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleteInfo, setDeleteInfo] = useState<{
    name: string;
    releaseCount: number;
    trackCount: number;
  } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Fetch user permissions
  useEffect(() => {
    async function checkPermissions() {
      try {
        const res = await fetch("/api/auth/me");
        if (res.ok) {
          const data = await res.json();
          const userPerms = data.user.permissions || [];
          const roles = data.user.roles || [];

          setPermissions({
            canCreate: userPerms.includes("artist.create"),
            canUpdate: userPerms.includes("artist.update"),
            canDelete: userPerms.includes("artist.delete"),
            isAdmin: roles.includes("admin"),
            isLabel: roles.includes("label"),
            isDistributor: roles.includes("distributor"),
            isArtist: roles.includes("artist"),
          });
        }
      } catch (error) {
        console.error("Error checking permissions:", error);
      }
    }
    checkPermissions();
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (labelFilter) params.set("labelId", labelFilter);

      const [artistsRes, labelsRes] = await Promise.all([
        fetch(`/api/artists?${params}`),
        fetch("/api/labels"),
      ]);

      if (artistsRes.ok) {
        const artistsData = await artistsRes.json();
        setArtists(artistsData.data || artistsData);
      }
      if (labelsRes.ok) {
        const labelsData = await labelsRes.json();
        setLabels(labelsData.data || labelsData);
      }
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  }, [search, labelFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openCreateModal = () => {
    setModalMode("create");
    setSelectedArtist(null);
    setFormData({
      name: "",
      bio: "",
      isni: "",
      ipi: "",
      dpid: "",
      imageUrl: "",
      labelId: labels.length > 0 ? labels[0].id : "",
    });
    setFormError("");
    setShowModal(true);
  };

  const openEditModal = (artist: Artist) => {
    setModalMode("edit");
    setSelectedArtist(artist);
    setFormData({
      name: artist.name,
      bio: artist.bio || "",
      isni: artist.isni || "",
      ipi: artist.ipi || "",
      dpid: artist.dpid || "",
      imageUrl: artist.imageUrl || "",
      labelId: artist.label?.id || "",
    });
    setFormError("");
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    // Validation
    const errors: string[] = [];
    if (!formData.name.trim()) {
      errors.push("Artist Name is required");
    } else if (formData.name.trim().length < 2) {
      errors.push("Artist Name must be at least 2 characters");
    }
    if (
      (permissions.isAdmin || permissions.isDistributor) &&
      !formData.labelId
    ) {
      errors.push(
        "Label is required - every artist must be associated with a label",
      );
    }
    if (formData.imageUrl && !/^https?:\/\/.+/.test(formData.imageUrl)) {
      errors.push(
        "Image URL must be a valid URL starting with http:// or https://",
      );
    }
    if (errors.length > 0) {
      setFormError(errors.join("\n"));
      return;
    }

    setSaving(true);

    try {
      const url =
        modalMode === "create"
          ? "/api/artists"
          : `/api/artists/${selectedArtist?.id}`;

      const method = modalMode === "create" ? "POST" : "PATCH";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          bio: formData.bio || null,
          isni: formData.isni || null,
          ipi: formData.ipi || null,
          dpid: formData.dpid || null,
          imageUrl: formData.imageUrl || null,
          labelId: formData.labelId || null,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setFormError(translateApiError(data.error, t));
        setSaving(false);
        return;
      }

      setShowModal(false);
      fetchData();
    } catch {
      setFormError("An error occurred");
    } finally {
      setSaving(false);
    }
  };

  const openDeleteConfirm = (artist: Artist) => {
    setDeleteConfirm(artist.id);
    setDeleteInfo({
      name: artist.name,
      releaseCount: artist.releaseCount,
      trackCount: artist.trackCount,
    });
  };

  const handleDelete = async (artistId: string) => {
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/artists/${artistId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        setDeleteConfirm(null);
        setDeleteInfo(null);
        fetchData();
      } else {
        const data = await res.json();
        alert(translateApiError(data.error, t));
      }
    } catch (error) {
      console.error("Error deleting artist:", error);
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {/* Header */}
      <header className="bg-[var(--bg-surface)] border-b border-[var(--border-primary)]">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/")}
              className="p-2 hover:bg-[var(--bg-elevated)] rounded transition-colors"
            >
              <ArrowBackIcon size={20} color="#d1d5db" />
            </button>
            <h1 className="text-xl font-medium">{t("artist.management", "Artist Management")}</h1>
          </div>
          {permissions.canCreate && (
            <button
              onClick={openCreateModal}
              className="flex items-center gap-2 px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg transition-colors text-sm font-medium text-white"
            >
              <PersonAddIcon size={18} />
              Add Artist
            </button>
          )}
        </div>
      </header>

      {/* Filters */}
      <div className="bg-[var(--bg-surface)] border-b border-[var(--border-primary)] px-6 py-4">
        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <SearchIcon
              size={20}
              color="#64748b"
              className="absolute left-3 top-1/2 -translate-y-1/2"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("artists.searchPlaceholder")}
              className="w-full pl-10 pr-4 py-2 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-disabled)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>
          {(permissions.isAdmin || permissions.isDistributor) && (
            <select
              value={labelFilter}
              onChange={(e) => setLabelFilter(e.target.value)}
              className="px-4 py-2 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            >
              <option value="">{t("label.all", "All Labels")}</option>
              {labels.map((label) => (
                <option key={label.id} value={label.id}>
                  {label.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Artists Grid */}
      <div className="p-6">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500"></div>
            <span className="ml-3 text-[var(--text-secondary)]">
              {t("common.loading")}
            </span>
          </div>
        ) : artists.length === 0 ? (
          <div className="text-center py-12 text-[var(--text-tertiary)]">
            {permissions.isArtist
              ? "Your profile is not set up yet."
              : "No artists found"}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {artists.map((artist) => (
              <div
                key={artist.id}
                className="bg-transparent rounded-lg border border-[var(--border-input)] overflow-hidden hover:border-[var(--border-input)] transition-colors"
              >
                {/* Artist Image */}
                <div className="aspect-square bg-transparent relative">
                  {artist.imageUrl ? (
                    <img
                      src={artist.imageUrl}
                      alt={artist.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#1DB954] to-[#169c46]">
                      <span className="text-6xl font-bold text-white">
                        {artist.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                  {/* Actions overlay */}
                  {(permissions.canUpdate || permissions.canDelete) && (
                    <div className="absolute top-2 right-2 flex gap-1">
                      {permissions.canUpdate && (
                        <button
                          onClick={() => openEditModal(artist)}
                          className="p-2 bg-[var(--bg-surface)]/80 hover:bg-[var(--bg-elevated)] rounded-lg transition-colors"
                          title={t("common.edit", "Edit")}
                        >
                          <EditIcon size={16} color="#94a3b8" />
                        </button>
                      )}
                      {permissions.canDelete && (
                        <button
                          onClick={() => openDeleteConfirm(artist)}
                          className="p-2 bg-[var(--bg-surface)]/80 hover:bg-[var(--status-error-surface)] rounded-lg transition-colors"
                          title={t("common.delete")}
                        >
                          <DeleteIcon size={16} color="#ef4444" />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Artist Info */}
                <div className="p-4">
                  <h3 className="font-medium text-[var(--text-primary)] truncate">
                    {artist.name}
                  </h3>
                  <p className="text-sm text-[var(--text-secondary)] mt-1">
                    {artist.labelName}
                  </p>

                  <div className="flex items-center gap-4 mt-3 text-xs text-[var(--text-tertiary)]">
                    <span className="flex items-center gap-1">
                      <AlbumIcon size={14} />
                      {artist.releaseCount} releases
                    </span>
                    <span className="flex items-center gap-1">
                      <MusicNoteIcon size={14} />
                      {artist.trackCount} tracks
                    </span>
                  </div>

                  {artist.bio && (
                    <p className="text-xs text-[var(--text-tertiary)] mt-2 line-clamp-2">
                      {artist.bio}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div
            className="bg-[var(--bg-surface)] rounded-xl border border-[var(--border-primary)] w-full max-w-md mx-4 shadow-2xl"
            style={{ backgroundColor: "var(--bg-surface)" }}
          >
            <div className="flex items-center justify-between p-6 border-b border-[var(--border-primary)]">
              <h2 className="text-lg font-medium">
                {modalMode === "create" ? "Add Artist" : "Edit Artist"}
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="p-1 hover:bg-[var(--bg-elevated)] rounded transition-colors"
              >
                <CloseIcon size={20} color="#94a3b8" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {formError && (
                <div className="p-3 rounded-lg bg-[var(--status-error-surface)] border border-red-500/50 text-[var(--status-error)] text-sm whitespace-pre-line">
                  {formError}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                  Artist Name *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  required
                  className="w-full px-4 py-2 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                  Bio
                </label>
                <textarea
                  value={formData.bio}
                  onChange={(e) =>
                    setFormData({ ...formData, bio: e.target.value })
                  }
                  rows={3}
                  className="w-full px-4 py-2 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-disabled)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                  Image URL
                </label>
                <input
                  type="url"
                  value={formData.imageUrl}
                  onChange={(e) =>
                    setFormData({ ...formData, imageUrl: e.target.value })
                  }
                  placeholder={t("placeholder.url", "Enter full profile URL")}
                  className="w-full px-4 py-2 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-disabled)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                  ISNI{" "}
                  <span className="text-slate-600 font-normal">
                    (International Standard Name Identifier)
                  </span>
                </label>
                <input
                  type="text"
                  value={formData.isni}
                  onChange={(e) =>
                    setFormData({ ...formData, isni: e.target.value })
                  }
                  placeholder={t("placeholder.isni", "e.g. ISNI")}
                  className="w-full px-4 py-2 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-disabled)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                  IPI{" "}
                  <span className="text-slate-600 font-normal">
                    (Interested Party Information)
                  </span>
                </label>
                <input
                  type="text"
                  value={formData.ipi}
                  onChange={(e) =>
                    setFormData({ ...formData, ipi: e.target.value })
                  }
                  placeholder={t("placeholder.phone", "e.g. 00123456789")}
                  className="w-full px-4 py-2 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-disabled)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                  DPID{" "}
                  <span className="text-slate-600 font-normal">
                    (DDEX Party ID)
                  </span>
                </label>
                <input
                  type="text"
                  value={formData.dpid}
                  onChange={(e) =>
                    setFormData({ ...formData, dpid: e.target.value })
                  }
                  placeholder={t("common.optional", "Optional")}
                  className="w-full px-4 py-2 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-disabled)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
              </div>

              {/* Only show label selector for admin/distributor */}
              {(permissions.isAdmin || permissions.isDistributor) && (
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                    Label *
                  </label>
                  <select
                    value={formData.labelId}
                    onChange={(e) =>
                      setFormData({ ...formData, labelId: e.target.value })
                    }
                    required
                    className="w-full px-4 py-2 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  >
                    <option value="">{t("placeholder.selectLabel", "Select a label...")}</option>
                    {labels.map((label) => (
                      <option key={label.id} value={label.id}>
                        {label.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 bg-transparent hover:bg-slate-700 rounded-lg transition-colors text-sm"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 rounded-lg transition-colors text-sm font-medium text-white"
                >
                  {saving
                    ? "Saving..."
                    : modalMode === "create"
                      ? "Create"
                      : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div
            className="bg-transparent rounded-xl border border-[var(--border-input)] w-full max-w-md mx-4 p-6 shadow-2xl"
            style={{ backgroundColor: "var(--bg-surface)" }}
          >
            <h3 className="text-lg font-medium mb-2 text-[var(--status-error)] whitespace-nowrap">
              <WarningIcon size={18} className="inline-block mr-1 -mt-1" />{" "}
              Delete Artist?
            </h3>
            <p className="text-[var(--text-secondary)] text-sm mb-3">
              Are you sure you want to delete{" "}
              <strong className="text-[var(--text-primary)]">
                {deleteInfo?.name}
              </strong>
              ? This action cannot be undone.
            </p>
            {deleteInfo &&
              (deleteInfo.releaseCount > 0 || deleteInfo.trackCount > 0) && (
                <div className="p-3 bg-[var(--status-error-surface)] border border-red-500/20 rounded-lg mb-4">
                  <p className="text-xs text-[var(--status-error)] font-medium mb-2">
                    The following will also be permanently deleted:
                  </p>
                  <ul className="text-xs text-red-300 space-y-1">
                    {deleteInfo.releaseCount > 0 && (
                      <li>• {deleteInfo.releaseCount} release(s)</li>
                    )}
                    {deleteInfo.trackCount > 0 && (
                      <li>
                        • {deleteInfo.trackCount} track(s) and their audio files
                      </li>
                    )}
                    <li>{t("artist.deleteWarning", "- All associated cover art and streaming data")}</li>
                  </ul>
                </div>
              )}
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setDeleteConfirm(null);
                  setDeleteInfo(null);
                }}
                className="px-4 py-2 bg-[var(--bg-elevated)] hover:bg-slate-700 rounded-lg transition-colors text-sm"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                disabled={deleteLoading}
                className="px-4 py-2 bg-[var(--status-error)] hover:brightness-110 rounded-lg transition-all text-sm font-medium disabled:opacity-50"
              >
                {deleteLoading ? "Deleting..." : "Delete Everything"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
