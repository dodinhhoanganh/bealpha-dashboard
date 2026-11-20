"use client";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { translateApiError } from "@/lib/i18n/translateApiError";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ApiClientError, apiRequest, getCurrentUser } from "@/lib/api-client";
import {
  AddIcon,
  EditIcon,
  DeleteIcon,
  SearchIcon,
  ArrowBackIcon,
  CloseIcon,
  PeopleIcon,
  AlbumIcon,
  WarningIcon,
} from "@/components/ui/Icon";

interface Label {
  id: string;
  name: string;
  dpid?: string | null;
  artistCount: number;
  releaseCount: number;
  createdAt: string;
}

interface UserPermissions {
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  isAdmin: boolean;
  isLabel: boolean;
  isDistributor: boolean;
}

export default function LabelsPage() {
  const { t } = useI18n(); // Auto-injected

  const router = useRouter();
  const [labels, setLabels] = useState<Label[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [permissions, setPermissions] = useState<UserPermissions>({
    canCreate: false,
    canUpdate: false,
    canDelete: false,
    isAdmin: false,
    isLabel: false,
    isDistributor: false,
  });

  // Modal states
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [selectedLabel, setSelectedLabel] = useState<Label | null>(null);
  const [formData, setFormData] = useState({ name: "", dpid: "" });
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleteInfo, setDeleteInfo] = useState<{
    name: string;
    artistCount: number;
    releaseCount: number;
  } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Fetch user permissions
  useEffect(() => {
    async function checkPermissions() {
      try {
        const user = await getCurrentUser();
        const userPerms = user.permissions || [];
        const roles = user.roles || [];

        setPermissions({
          canCreate: userPerms.includes("label.create"),
          canUpdate: userPerms.includes("label.update"),
          canDelete: userPerms.includes("label.delete"),
          isAdmin: roles.includes("admin"),
          isLabel: roles.includes("label"),
          isDistributor: roles.includes("distributor"),
        });
      } catch (error) {
        console.error("Error checking permissions:", error);
        router.push("/login");
      }
    }
    checkPermissions();
  }, [router]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiRequest<Label[]>("/api/v1/catalog/labels");
      const query = search.trim().toLowerCase();
      setLabels(query ? result.filter((label) => label.name.toLowerCase().includes(query)) : result);
    } catch (error) {
      console.error("Error fetching labels:", error);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openCreateModal = () => {
    setModalMode("create");
    setSelectedLabel(null);
    setFormData({ name: "", dpid: "" });
    setFormError("");
    setShowModal(true);
  };

  const openEditModal = (label: Label) => {
    setModalMode("edit");
    setSelectedLabel(label);
    setFormData({ name: label.name, dpid: label.dpid || "" });
    setFormError("");
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    // Validation
    const errors: string[] = [];
    if (!formData.name.trim()) {
      errors.push(t("common.labelNameRequired"));
    } else if (formData.name.trim().length < 2) {
      errors.push(t("common.labelNameMin2"));
    }
    if (errors.length > 0) {
      setFormError(errors.join("\n"));
      return;
    }

    setSaving(true);

    try {
      const path =
        modalMode === "create"
          ? "/api/v1/catalog/labels"
          : `/api/v1/catalog/labels/${selectedLabel?.id}`;

      const method = modalMode === "create" ? "POST" : "PATCH";

      await apiRequest(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          dpid: formData.dpid || (modalMode === "edit" ? null : undefined),
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

  const openDeleteConfirm = async (label: Label) => {
    setDeleteConfirm(label.id);
    setDeleteInfo({
      name: label.name,
      artistCount: label.artistCount,
      releaseCount: label.releaseCount,
    });
  };

  const handleDelete = async (labelId: string) => {
    setDeleteLoading(true);
    try {
      await apiRequest(`/api/v1/catalog/labels/${labelId}`, {
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
            <h1 className="text-xl font-medium">{t("label.management", "Label Management")}</h1>
          </div>
          {permissions.canCreate && (
            <button
              onClick={openCreateModal}
              className="flex items-center gap-2 px-4 py-2 bg-[var(--status-info)] hover:brightness-110 rounded-lg transition-all text-sm font-medium text-white"
            >
              <AddIcon size={18} />
              {t("common.addLabel")}
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
              placeholder={t("labels.searchPlaceholder")}
              className="w-full pl-10 pr-4 py-2 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-disabled)] focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Labels Table */}
      <div className="p-6">
        <div className="bg-transparent rounded-lg border border-[var(--border-input)] overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
              <span className="ml-3 text-[var(--text-secondary)]">
                {t("common.loading")}
              </span>
            </div>
          ) : labels.length === 0 ? (
            <div className="text-center py-12 text-[var(--text-tertiary)]">
              {permissions.isLabel
                ? t("label.notSetUp", "Your label is not set up yet.")
                : t("labels.noLabels")}
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border-primary)]">
                  <th className="text-left py-4 px-6 text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider">
                    {t("labels.labelName")}
                  </th>
                  <th className="text-left py-4 px-6 text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider">
                    {t("artists.title")}
                  </th>
                  <th className="text-left py-4 px-6 text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider">
                    {t("labels.releases")}
                  </th>
                  <th className="text-left py-4 px-6 text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider">
                    {t("activity.created")}
                  </th>
                  {(permissions.canUpdate || permissions.canDelete) && (
                    <th className="text-right py-4 px-6 text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider">
                      {t("common.actions")}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {labels.map((label) => (
                  <tr
                    key={label.id}
                    className="border-b border-[var(--border-primary)] hover:bg-transparent/50 transition-colors cursor-pointer"
                    onClick={() => router.push(`/labels/${label.id}`)}
                  >
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-gradient-to-br from-[#1DB954] to-[#169c46]">
                          <span className="text-lg font-bold text-white">
                            {label.name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <span className="font-medium text-[var(--text-primary)]">
                          {label.name}
                        </span>
                      </div>
                    </td>
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-2 text-[var(--text-secondary)]">
                        <PeopleIcon size={16} />
                        <span>{label.artistCount}</span>
                      </div>
                    </td>
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-2 text-[var(--text-secondary)]">
                        <AlbumIcon size={16} />
                        <span>{label.releaseCount}</span>
                      </div>
                    </td>
                    <td className="py-4 px-6 text-[var(--text-secondary)] text-sm">
                      {new Date(label.createdAt).toLocaleDateString("en-US")}
                    </td>
                    {(permissions.canUpdate || permissions.canDelete) && (
                      <td className="py-4 px-6">
                        <div
                          className="flex items-center justify-end gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {permissions.canUpdate && (
                            <button
                              onClick={() => openEditModal(label)}
                              className="p-2 hover:bg-slate-700 rounded transition-colors"
                              title={t("common.edit", "Edit")}
                            >
                              <EditIcon size={18} color="#94a3b8" />
                            </button>
                          )}
                          {permissions.canDelete && (
                            <button
                              onClick={() => openDeleteConfirm(label)}
                              className="p-2 hover:bg-[var(--status-error-surface)] rounded transition-colors"
                              title={t("common.delete")}
                            >
                              <DeleteIcon size={18} color="#ef4444" />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
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
                {modalMode === "create" ? t("common.addLabel") : t("labels.editLabel")}
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
                  {t("form.labelName", "Label Name *")}
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  required
                  className="w-full px-4 py-2 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                  {t("settings.dpidLabel", "DPID (DDEX Party Identifier)")}
                </label>
                <input
                  type="text"
                  value={formData.dpid}
                  onChange={(e) =>
                    setFormData({ ...formData, dpid: e.target.value })
                  }
                  placeholder={t("placeholder.dpid", "e.g. PADPIDA2014021301U")}
                  className="w-full px-4 py-2 bg-transparent border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-disabled)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-[var(--text-tertiary)] mt-1">
                  {t("label.dpidHint", "Used for DDEX deliveries. Obtain from DDEX at ddex.net")}
                </p>
              </div>

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
                  className="px-4 py-2 bg-[var(--status-info)] hover:brightness-110 disabled:opacity-50 rounded-lg transition-all text-sm font-medium text-white"
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
              {t("common.confirmDeleteLabel")}?
            </h3>
            <p className="text-[var(--text-secondary)] text-sm mb-3">
              {t("common.confirmDeleteLabel")}{" "}
              <strong className="text-[var(--text-primary)]">
                {deleteInfo?.name}
              </strong>
              ? {t("common.cannotBeUndone")}
            </p>
            {deleteInfo &&
              (deleteInfo.artistCount > 0 || deleteInfo.releaseCount > 0) && (
                <div className="p-3 bg-[var(--status-error-surface)] border border-red-500/20 rounded-lg mb-4">
                  <p className="text-xs text-[var(--status-error)] font-medium mb-2">
                    {t("common.deleteWillRemove")}
                  </p>
                  <ul className="text-xs text-red-300 space-y-1">
                    {deleteInfo.artistCount > 0 && (
                      <li>
                        • {deleteInfo.artistCount} {t("ui.page.artistSUnderThisLabel", "artist(s) under this label")}
                      </li>
                    )}
                    {deleteInfo.releaseCount > 0 && (
                      <li>
                        • {deleteInfo.releaseCount} {t("ui.page.releaseSAndAllTheirTracks", "release(s) and all their tracks")}
                      </li>
                    )}
                    <li>{t("label.deleteWarning", "- All associated audio files and cover art")}</li>
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
