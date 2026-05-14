"use client";

import { useState, useEffect, useCallback } from "react";
import { UserSession } from "@/lib/types";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { translateApiError } from "@/lib/i18n/translateApiError";
import { useToast } from "@/components/Toast";
import { useUploadProgress } from "@/components/UploadProgress";
import ImageUpload from "@/components/ImageUpload";
import Pagination from "@/components/Pagination";
import { TableSkeleton, CardSkeleton } from "@/components/Skeleton";
import Modal from "@/components/Modal";
import {
  BusinessIcon,
  AddIcon,
  SearchIcon,
  EditIcon,
  DeleteIcon,
  ArrowBackIcon,
  PhotoCameraIcon,
  CloseIcon,
} from "@/components/Icon";

const UPLOAD_SERVER = process.env.NEXT_PUBLIC_UPLOAD_URL || "";

// ============ LABELS COMPONENT ============
export default function LabelsPanel({ user }: { user: UserSession }) {
  const { t } = useI18n(); // Auto-injected

  const { uploadFile, downloadFile } = useUploadProgress();
  const [labels, setLabels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(20);
  const [editModal, setEditModal] = useState<{
    open: boolean;
    label: any | null;
  }>({ open: false, label: null });
  const [createModal, setCreateModal] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    logoUrl: "",
    dpid: "",
    ddexPartyName: "",
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [dragState, setDragState] = useState<string | null>(null);

  const canCreate = user.permissions.includes("label.create");
  const canUpdate = user.permissions.includes("label.update");
  const canDelete = user.permissions.includes("label.delete");

  const fetchLabels = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      params.set("page", String(page));
      params.set("limit", String(limit));
      const res = await fetch(`/api/labels?${params}`);
      if (res.ok) {
        const json = await res.json();
        setLabels(json.data || json);
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
    fetchLabels();
  }, [fetchLabels]);

  // Global search listener
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      if (e.detail.type === "LABEL") {
        setSearch(e.detail.title);
        setPage(1);
      }
    };
    window.addEventListener("open-entity", handler as EventListener);
    return () => window.removeEventListener("open-entity", handler as EventListener);
  }, []);

  const openEditModal = (label: any) => {
    setFormData({
      name: label.name || "",
      description: label.description || "",
      logoUrl: label.logoUrl || "",
      dpid: label.dpid || "",
      ddexPartyName: label.ddexPartyName || "",
    });
    setEditModal({ open: true, label });
  };

  const validateLabelForm = (): string[] => {
    const errors: string[] = [];
    if (!formData.name.trim()) errors.push("• Label Name is required");
    if (formData.name.trim().length > 0 && formData.name.trim().length < 2)
      errors.push("• Label Name must be at least 2 characters");
    return errors;
  };

  const handleSave = async () => {
    if (!editModal.label) return;
    const errors = validateLabelForm();
    if (errors.length > 0) {
      setFormError(errors.join("\n"));
      return;
    }
    setFormError("");
    setSaving(true);
    try {
      const res = await fetch(`/api/labels/${editModal.label.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        setEditModal({ open: false, label: null });
        fetchLabels();
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

  const handleCreate = async () => {
    const errors = validateLabelForm();
    if (errors.length > 0) {
      setFormError(errors.join("\n"));
      return;
    }
    setFormError("");
    setSaving(true);
    try {
      const res = await fetch("/api/labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        setCreateModal(false);
        setFormData({
          name: "",
          description: "",
          logoUrl: "",
          dpid: "",
          ddexPartyName: "",
        });
        setFormError("");
        fetchLabels();
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
    const label = labels.find((l) => l.id === id);
    const msg = `Are you sure you want to delete "${label?.name || "this label"}"?\n\nThis will also permanently delete:\n- All artists under this label\n- All releases and tracks\n- All audio files and cover art\n\nThis action cannot be undone.`;
    if (!confirm(msg)) return;
    try {
      await fetch(`/api/labels/${id}`, { method: "DELETE" });
      fetchLabels();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="p-6">
      <Modal
        isOpen={editModal.open}
        onClose={() => {
          setEditModal({ open: false, label: null });
          setFormError("");
        }}
        title={t("labels.editLabel")}
      >
        <div className="space-y-4">
          {formError && (
            <div className="p-3 bg-[var(--status-error-surface)] border border-red-500/30 rounded-lg text-[var(--status-error)] text-sm whitespace-pre-line">
              {formError}
            </div>
          )}
          <div className="flex justify-center mb-4">
            <ImageUpload
              currentUrl={formData.logoUrl}
              onUpload={(url) => setFormData({ ...formData, logoUrl: url })}
              type="labels"
              entityName={formData.name || "Draft Label"}
              labelName={formData.name || "Draft Label"}
            />
          </div>
          <div>
            <label className="block text-sm text-[var(--text-tertiary)] mb-1">
              {t("labels.labelName")}
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
              {t("form.description", "Description")}
            </label>
            <textarea
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              rows={3}
              className="w-full px-3 py-2  border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-none"
            />
          </div>
          <div>
            <label className="block text-sm text-[var(--text-tertiary)] mb-1">
              DDEX Party Name{" "}
              <span className="text-[var(--text-disabled)] font-normal text-xs">
                (Fallback if empty)
              </span>
            </label>
            <input
              type="text"
              value={formData.ddexPartyName}
              onChange={(e) =>
                setFormData({ ...formData, ddexPartyName: e.target.value })
              }
              className="w-full px-3 py-2  border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              placeholder={t("form.placeholder.eGBeAlpha", "e.g. beAlpha")}
            />
          </div>
          <div>
            <label className="block text-sm text-[var(--text-tertiary)] mb-1">
              DDEX Party Identifier (DPID){" "}
              <span className="text-[var(--text-disabled)] font-normal text-xs">
                (Fallback if empty)
              </span>
            </label>
            <input
              type="text"
              value={formData.dpid}
              onChange={(e) =>
                setFormData({ ...formData, dpid: e.target.value })
              }
              className="w-full px-3 py-2  border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              placeholder={t("form.placeholder.eGPADPX", "e.g. PADPX...")}
            />
          </div>
          <div className="flex gap-3 pt-4">
            <button
              onClick={() => setEditModal({ open: false, label: null })}
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
        title={t("common.addLabel")}
      >
        <div className="space-y-4">
          {formError && (
            <div className="p-3 bg-[var(--status-error-surface)] border border-red-500/30 rounded-lg text-[var(--status-error)] text-sm whitespace-pre-line">
              {formError}
            </div>
          )}
          <div className="flex justify-center mb-4">
            <ImageUpload
              currentUrl={formData.logoUrl}
              onUpload={(url) => setFormData({ ...formData, logoUrl: url })}
              type="labels"
              entityName={formData.name || "Draft Label"}
              labelName={formData.name || "Draft Label"}
            />
          </div>
          <div>
            <label className="block text-sm text-[var(--text-tertiary)] mb-1">
              {t("form.labelName", "Label Name *")}
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              className="w-full px-3 py-2  border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              placeholder={t("form.placeholder.enterLabelName", "Enter label name")}
            />
          </div>
          <div>
            <label className="block text-sm text-[var(--text-tertiary)] mb-1">
              {t("form.description", "Description")}
            </label>
            <textarea
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              rows={3}
              className="w-full px-3 py-2  border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-none"
              placeholder={t("form.placeholder.labelDescription", "Label description")}
            />
          </div>
          <div>
            <label className="block text-sm text-[var(--text-tertiary)] mb-1">
              DDEX Party Name{" "}
              <span className="text-[var(--text-disabled)] font-normal text-xs">
                (Fallback if empty)
              </span>
            </label>
            <input
              type="text"
              value={formData.ddexPartyName}
              onChange={(e) =>
                setFormData({ ...formData, ddexPartyName: e.target.value })
              }
              className="w-full px-3 py-2  border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              placeholder={t("form.placeholder.eGBeAlpha", "e.g. beAlpha")}
            />
          </div>
          <div>
            <label className="block text-sm text-[var(--text-tertiary)] mb-1">
              DDEX Party Identifier (DPID){" "}
              <span className="text-[var(--text-disabled)] font-normal text-xs">
                (Fallback if empty)
              </span>
            </label>
            <input
              type="text"
              value={formData.dpid}
              onChange={(e) =>
                setFormData({ ...formData, dpid: e.target.value })
              }
              className="w-full px-3 py-2  border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              placeholder={t("form.placeholder.eGPADPX", "e.g. PADPX...")}
            />
          </div>
          <div className="flex gap-3 pt-4">
            <button
              onClick={() => {
                setCreateModal(false);
                setFormError("");
              }}
              className="flex-1 px-4 py-2  hover: rounded-lg text-sm font-medium transition-colors"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={handleCreate}
              disabled={saving}
              className="flex-1 px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg text-sm font-medium transition-colors disabled:opacity-50 text-white"
            >
              {saving ? "Creating..." : "Create"}
            </button>
          </div>
        </div>
      </Modal>

      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-medium">{t("labels.title")}</h2>
        <div className="flex items-center gap-3">
          {canCreate && (
            <>
              <button
                onClick={() => {
                  setFormData({
                    name: "",
                    description: "",
                    logoUrl: "",
                    dpid: "",
                    ddexPartyName: "",
                  });
                  setCreateModal(true);
                }}
                className="flex items-center gap-2 px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg text-sm font-medium transition-colors text-white"
              >
                <AddIcon size={18} />
                Add Label
              </button>
            </>
          )}
        </div>
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
          placeholder={t("labels.searchPlaceholder")}
          className="w-full pl-10 pr-4 py-2 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-disabled)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
      </div>

      {loading ? (
        <CardSkeleton count={6} />
      ) : labels.length === 0 ? (
        <div className="text-center py-12 text-[var(--text-disabled)]">
          <BusinessIcon size={48} color="#525252" />
          <p className="mt-2">{t("labels.noLabels")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {labels.map((label) => (
            <div
              key={label.id}
              style={{ background: "var(--bg-surface)" }}
              className=" rounded-lg border border-[var(--border-primary)] p-4"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-lg overflow-hidden bg-[var(--status-success-surface)] flex items-center justify-center">
                  {label.logoUrl ? (
                    <img
                      src={label.logoUrl}
                      alt={label.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <BusinessIcon size={20} color="#22c55e" />
                  )}
                </div>
                <div className="flex gap-1 items-center">
                  {(canUpdate || canDelete) && (
                    <>
                      {canUpdate && (
                        <button
                          onClick={() => openEditModal(label)}
                          title={t("labels.editLabel")}
                          className="p-1.5 hover:bg-[var(--bg-elevated)] rounded"
                        >
                          <EditIcon size={16} color="#a3a3a3" />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={() => handleDelete(label.id)}
                          title={t("common.deleteLabel")}
                          className="p-1.5 hover:bg-[var(--status-error-surface)] rounded"
                        >
                          <DeleteIcon size={16} color="#ef4444" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
              <h3 className="font-medium text-[var(--text-primary)]">
                {label.name}
              </h3>
              <p className="text-sm text-[var(--text-disabled)] mt-1">
                {label.artistCount || 0} artists • {label.releaseCount || 0}{" "}
                releases
              </p>
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

