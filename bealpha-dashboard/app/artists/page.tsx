"use client";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { translateApiError } from "@/lib/i18n/translateApiError";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ApiClientError, apiRequest, getCurrentUser } from "@/lib/api-client";
import SecureImage from "@/components/ui/SecureImage";
import { mediaAssetId } from "@/lib/stream-url";
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
} from "@/components/ui/Icon";

interface Label {
  id: string;
  name: string;
}

interface Artist {
  id: string;
  name: string;
  bio?: string | null;
  isni?: string | null;
  ipi?: string | null;
  dpid?: string | null;
  imageUrl?: string | null;
  label?: Label | null;
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
        const user = await getCurrentUser();
        {
          const userPerms = user.permissions || [];
          const roles = user.roles || [];

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
      const [artistRows, labelRows] = await Promise.all([
        apiRequest<Artist[]>("/api/v1/catalog/artists"),
        apiRequest<Label[]>("/api/v1/catalog/labels"),
      ]);
      const query = search.trim().toLowerCase();
      setArtists(artistRows.filter((artist) =>
        (!query || artist.name.toLowerCase().includes(query)) &&
        (!labelFilter || artist.label?.id === labelFilter),
      ));
      setLabels(labelRows);
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
      errors.push(t("common.artistNameRequired"));
    } else if (formData.name.trim().length < 2) {
      errors.push(t("common.artistNameMin2"));
    }
    if (
      (permissions.isAdmin || permissions.isDistributor) &&
      !formData.labelId
    ) {
      errors.push(
        t("artist.labelRequired", "Label is required - every artist must be associated with a label"),
      );
    }
    if (formData.imageUrl && !(/^https?:\/\/.+/.test(formData.imageUrl) || mediaAssetId(formData.imageUrl))) {
      errors.push(
        t("artist.invalidImageUrl", "Image URL must be a valid URL starting with http:// or https://"),
      );
    }
    if (errors.length > 0) {
      setFormError(errors.join("\n"));
      return;
    }

    setSaving(true);

    try {
      const path =
        modalMode === "create"
          ? "/api/v1/catalog/artists"
          : `/api/v1/catalog/artists/${selectedArtist?.id}`;

      const method = modalMode === "create" ? "POST" : "PATCH";

      await apiRequest(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          bio: formData.bio || (modalMode === "edit" ? null : undefined),
          isni: formData.isni || (modalMode === "edit" ? null : undefined),
          ipi: formData.ipi || (modalMode === "edit" ? null : undefined),
          dpid: formData.dpid || (modalMode === "edit" ? null : undefined),
          imageUrl: formData.imageUrl || (modalMode === "edit" ? null : undefined),
          labelId: formData.labelId || (modalMode === "edit" ? null : undefined),
        }),
      });

      setShowModal(false);
      fetchData();
    } catch (error) {
      setFormError(error instanceof ApiClientError ? translateApiError(error.code, t) : t("common.errorOccurred"));
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
      await apiRequest(`/api/v1/catalog/artists/${artistId}`, {
        method: "DELETE",
      });
      setDeleteConfirm(null);
      setDeleteInfo(null);
      fetchData();
    } catch (error) {
      alert(error instanceof ApiClientError ? translateApiError(error.code, t) : t("common.errorOccurred"));
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
              {t("common.addArtist")}
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
                ? t("artist.notSetUp", "Your profile is not set up yet.")
                : t("artists.noArtists")}
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
                    <SecureImage
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
                      {artist.releaseCount} {t("nav.releases", "releases")}
                    </span>
                    <span className="flex items-center gap-1">
                      <MusicNoteIcon size={14} />
                      {artist.trackCount} {t("nav.tracks", "tracks")}
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
                {modalMode === "create" ? t("common.addArtist") : t("artists.editArtist")}
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
                  {t("form.artistName", "Artist Name *")}
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
                  {t("form.bio", "Bio")}
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
                  {t("form.imageUrl", "Image URL")}
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
                    {t("ui.page.internationalStandardNameIdentifier", "(International Standard Name Identifier)")}
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
                    {t("ui.page.interestedPartyInformation", "(Interested Party Information)")}
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
                    {t("ui.page.ddexPartyID", "(DDEX Party ID)")}
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
                    {t("nav.labels", "Label")} *
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
                    ? t("common.saving")
                    : modalMode === "create"
                      ? t("common.create")
                      : t("common.save")}
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
              {t("common.confirmDeleteArtist")}?
            </h3>
            <p className="text-[var(--text-secondary)] text-sm mb-3">
              {t("common.confirmDeleteArtist")}{" "}
              <strong className="text-[var(--text-primary)]">
                {deleteInfo?.name}
              </strong>
              ? {t("common.cannotBeUndone")}
            </p>
            {deleteInfo &&
              (deleteInfo.releaseCount > 0 || deleteInfo.trackCount > 0) && (
                <div className="p-3 bg-[var(--status-error-surface)] border border-red-500/20 rounded-lg mb-4">
                  <p className="text-xs text-[var(--status-error)] font-medium mb-2">
                    {t("common.deleteWillRemove")}
                  </p>
                  <ul className="text-xs text-red-300 space-y-1">
                    {deleteInfo.releaseCount > 0 && (
                      <li>• {deleteInfo.releaseCount} {t("releases.releases_count", "release(s)")}</li>
                    )}
                    {deleteInfo.trackCount > 0 && (
                      <li>
                        • {deleteInfo.trackCount} {t("releases.tracksAndAudio", "track(s) and their audio files")}
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
                {deleteLoading ? t("common.loading") : t("common.delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
