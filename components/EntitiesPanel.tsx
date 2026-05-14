"use client";

import { useState, useEffect, useCallback } from "react";
import { UserSession } from "@/lib/types";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { translateApiError } from "@/lib/i18n/translateApiError";
import { useToast } from "@/components/Toast";
import { useUploadProgress } from "@/components/UploadProgress";
import ImageUpload from "@/components/ImageUpload";
import Pagination from "@/components/Pagination";
import { TableSkeleton } from "@/components/Skeleton";
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
  GroupIcon,
  SettingsIcon,
  KeyboardArrowDownIcon,
  ArrowUpRightIcon,
} from "@/components/Icon";

const UPLOAD_SERVER = process.env.NEXT_PUBLIC_UPLOAD_URL || "";

// ============ ENTITIES PANEL ============
export default function EntitiesPanel({ user }: { user: UserSession }) {
  const { t } = useI18n();
  const [entities, setEntities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [typeFilter, setTypeFilter] = useState("");
  const [createModal, setCreateModal] = useState(false);
  const [detailEntity, setDetailEntity] = useState<any>(null);
  const [isEditingDetail, setIsEditingDetail] = useState(false);
  const [editData, setEditData] = useState<any>(null);
  const [isInvitingDetail, setIsInvitingDetail] = useState(false);
  const [inviteModal, setInviteModal] = useState<{ open: boolean; entityId: string; entityName: string }>({ open: false, entityId: "", entityName: "" });
  const [createData, setCreateData] = useState({ officialName: "", entityType: "ORGANIZATION", category: "LABEL", description: "" });
  const [inviteData, setInviteData] = useState({ email: "", role: "MEMBER" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { showToast } = useToast();

  const fetchEntities = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (typeFilter) params.set("type", typeFilter);
      params.set("page", String(page));
      params.set("limit", "20");
      const res = await fetch(`/api/entities?${params}`);
      if (res.ok) {
        const json = await res.json();
        setEntities(json.data || []);
        setTotal(json.total || 0);
        setTotalPages(json.totalPages || 1);
      }
    } catch (e) {
      console.error("Error fetching entities:", e);
    } finally {
      setLoading(false);
    }
  }, [search, typeFilter, page]);

  useEffect(() => { fetchEntities(); }, [fetchEntities]);

  const handleCreate = async () => {
    if (!createData.officialName.trim()) { setError("Name is required"); return; }
    setSaving(true);
    setError("");
    try {
      const payload: any = { ...createData };
      if (payload.entityType === "ORGANIZATION") {
        payload.metadata = { category: payload.category };
      }
      delete payload.category;

      const res = await fetch("/api/entities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        showToast("Entity created successfully", "success");
        setCreateModal(false);
        setCreateData({ officialName: "", entityType: "ORGANIZATION", category: "LABEL", description: "" });
        fetchEntities();
      } else {
        const json = await res.json();
        setError(translateApiError(json.error || "Failed to create entity", t));
      }
    } catch { setError("Network error"); }
    finally { setSaving(false); }
  };

  const handleInvite = async (isInline = false) => {
    if (!inviteData.email.trim()) { setError("Email is required"); return; }
    setSaving(true);
    setError("");
    try {
      const targetEntityId = isInline ? detailEntity.id : inviteModal.entityId;
      const res = await fetch("/api/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...inviteData, entityId: targetEntityId }),
      });
      if (res.ok) {
        showToast(`Invitation sent to ${inviteData.email}`, "success");
        if (!isInline) {
           setInviteModal({ open: false, entityId: "", entityName: "" });
        } else {
           setIsInvitingDetail(false);
        }
        setInviteData({ email: "", role: "MEMBER" });
        if (detailEntity?.id === targetEntityId) fetchEntityDetail(detailEntity.id);
      } else {
        const json = await res.json();
        setError(translateApiError(json.error || "Failed to send invitation", t));
      }
    } catch { setError("Network error"); }
    finally { setSaving(false); }
  };

  const handleRevokeInvite = async (inviteId: string) => {
    if (!confirm("Are you sure you want to revoke this invitation?")) return;
    try {
      const res = await fetch(`/api/invitations/${inviteId}`, { method: "DELETE" });
      if (res.ok) {
        showToast("Invitation revoked successfully", "success");
        if (detailEntity) fetchEntityDetail(detailEntity.id);
      } else {
        const json = await res.json();
        showToast(translateApiError(json.error || "Failed to revoke invitation", t), "error");
      }
    } catch {
      showToast("Network error", "error");
    }
  };

  const fetchEntityDetail = async (id: string) => {
    try {
      const res = await fetch(`/api/entities/${id}`);
      if (res.ok) {
        const json = await res.json();
        setDetailEntity(json);
      }
    } catch (e) {
      console.error("Error fetching entity detail:", e);
    }
  };

  const [editModal, setEditModal] = useState<{ open: boolean; data: any }>({ open: false, data: null });

  const handleUpdate = async (isInline = false) => {
    const dataToUse = isInline ? editData : editModal.data;
    if (!dataToUse?.officialName?.trim()) { setError("Name is required"); return; }
    setSaving(true);
    setError("");
    try {
      const payload: any = { ...dataToUse };
      if (payload.entityType === "ORGANIZATION") {
        payload.metadata = { category: payload.category };
      }
      delete payload.category;

      const res = await fetch(`/api/entities/${payload.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        showToast("Entity updated successfully", "success");
        if (!isInline) {
            setEditModal({ open: false, data: null });
        } else {
            setIsEditingDetail(false);
        }
        fetchEntities();
        if (detailEntity?.id === payload.id) fetchEntityDetail(payload.id);
      } else {
        const json = await res.json();
        setError(translateApiError(json.error || "Failed to update entity", t));
      }
    } catch { setError("Network error"); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this entity? This will delete all associated data (cascading).")) return;
    try {
      const res = await fetch(`/api/entities/${id}`, { method: "DELETE" });
      if (res.ok) {
        showToast("Entity deleted successfully", "success");
        setDetailEntity(null);
        fetchEntities();
      } else {
        const json = await res.json();
        showToast(translateApiError(json.error || "Failed to delete entity", t), "error");
      }
    } catch (e) {
      showToast("Network error", "error");
    }
  };

  const entityTypeLabel = (type: string, category?: string) => {
    const map: Record<string, string> = {
      SUPER_ADMIN: "Super Admin",
      SYSTEM_ADMIN: "System Admin",
      ORGANIZATION: category ? (category.charAt(0).toUpperCase() + category.slice(1).toLowerCase()) : "Organization",
      SUB_ACCOUNT: "Sub-Account",
    };
    return map[type] || type;
  };

  const entityTypeColor = (type: string) => {
    const map: Record<string, string> = {
      SUPER_ADMIN: "var(--status-error)",
      SYSTEM_ADMIN: "var(--accent)",
      ORGANIZATION: "var(--status-success)",
      SUB_ACCOUNT: "var(--status-warning)",
    };
    return map[type] || "var(--text-secondary)";
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
            {t("entities.title", "Organizations & Entities")}
          </h2>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
            {t("entities.subtitle", "Manage your B2B2B hierarchy")} · {total} {t("entities.entities", "entities")}
          </p>
        </div>
        {user.permissions.includes("entity.create") && (
          <button
            onClick={() => setCreateModal(true)}
            className="px-4 py-2.5 rounded-xl text-sm font-medium text-white transition-all duration-200"
            style={{ background: "var(--accent)" }}
          >
            <AddIcon size={16} /> {t("entities.create", "Create Entity")}
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="flex-1 min-w-[200px]">
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder={t("entities.searchPlaceholder", "Search entities...")}
            className="w-full px-4 py-2.5 rounded-xl text-sm"
            style={{ background: "var(--bg-surface)", border: "1px solid var(--border-primary)", color: "var(--text-primary)" }}
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          className="px-4 py-2.5 rounded-xl text-sm"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--border-primary)", color: "var(--text-primary)" }}
        >
          <option value="">{t("entities.allTypes", "All Types")}</option>
          <option value="ORGANIZATION">{t("entities.organization", "Organization")}</option>
          <option value="SUB_ACCOUNT">{t("entities.subAccount", "Sub-Account")}</option>
          <option value="SYSTEM_ADMIN">{t("entities.systemAdmin", "System Admin")}</option>
        </select>
      </div>

      {/* Entity List */}
      {loading ? (
        <TableSkeleton rows={5} />
      ) : entities.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
            {t("entities.noEntities", "No entities found")}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {entities.map((entity) => (
            <div
              key={entity.id}
              className="rounded-xl p-4 transition-all duration-200 cursor-pointer"
              style={{ background: "var(--bg-surface)", border: "1px solid var(--border-primary)" }}
              onClick={() => fetchEntityDetail(entity.id)}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-primary)"; }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold"
                    style={{ background: "var(--bg-elevated)", color: entityTypeColor(entity.entityType) }}>
                    {entity.officialName?.charAt(0)?.toUpperCase() || "E"}
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                      {entity.officialName}
                    </h3>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                        style={{ background: "var(--bg-elevated)", color: entityTypeColor(entity.entityType) }}>
                        {entityTypeLabel(entity.entityType, (entity.metadata as any)?.category)}
                      </span>
                      {entity.parent && (
                        <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                          · {entity.parent.officialName}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-xs" style={{ color: "var(--text-tertiary)" }}>
                  <span>{entity._count?.userRoles || 0} members</span>
                  <span>{entity._count?.labels || 0} labels</span>
                  <span>{entity._count?.releases || 0} releases</span>
                  {user.permissions.includes("entity.invite") && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setInviteModal({ open: true, entityId: entity.id, entityName: entity.officialName }); }}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                      style={{ background: "var(--accent-surface)", color: "var(--accent-text)" }}
                    >
                      {t("entities.invite", "Invite")}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} total={total} limit={20} onPageChange={setPage} />
      )}

      {/* Create Entity Modal */}
      {createModal && (
        <Modal isOpen={createModal} onClose={() => { setCreateModal(false); setError(""); }} title={t("entities.createTitle", "Create New Entity")}>
          <div className="space-y-4">
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                {t("entities.name", "Official Name")}
              </label>
              <input
                type="text" value={createData.officialName}
                onChange={(e) => setCreateData({ ...createData, officialName: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl text-sm"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-primary)", color: "var(--text-primary)" }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                {t("entities.type", "Entity Type")}
              </label>
              <select
                value={createData.entityType}
                onChange={(e) => setCreateData({ ...createData, entityType: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl text-sm"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-primary)", color: "var(--text-primary)" }}
              >
                {user.entityType === "SYSTEM_ADMIN" || user.entityType === "SUPER_ADMIN" ? (
                  <option value="ORGANIZATION">Organization</option>
                ) : null}
                {user.entityType === "ORGANIZATION" ? (
                  <option value="SUB_ACCOUNT">Sub-Account</option>
                ) : null}
              </select>
            </div>
            {createData.entityType === "ORGANIZATION" && (
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                  {t("entities.category", "Category")}
                </label>
                <select
                  value={createData.category}
                  onChange={(e) => setCreateData({ ...createData, category: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl text-sm"
                  style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-primary)", color: "var(--text-primary)" }}
                >
                  <option value="DISTRIBUTOR">Distributor</option>
                  <option value="LABEL">Label</option>
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                {t("entities.description", "Description")}
              </label>
              <textarea
                value={createData.description}
                onChange={(e) => setCreateData({ ...createData, description: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl text-sm h-20 resize-none"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-primary)", color: "var(--text-primary)" }}
              />
            </div>
            <button onClick={handleCreate} disabled={saving}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
              style={{ background: saving ? "var(--text-disabled)" : "var(--accent)" }}>
              {saving ? t("common.saving", "Saving...") : t("entities.create", "Create Entity")}
            </button>
          </div>
        </Modal>
      )}

      {/* Edit Modal */}
      {editModal.open && editModal.data && (
        <Modal isOpen={editModal.open} onClose={() => { setEditModal({ open: false, data: null }); setError(""); }} title={t("common.edit", "Edit Entity")}>
          <div className="space-y-4">
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                {t("entities.name", "Official Name")}
              </label>
              <input
                type="text" value={editModal.data.officialName}
                onChange={(e) => setEditModal({ ...editModal, data: { ...editModal.data, officialName: e.target.value } })}
                className="w-full px-3 py-2.5 rounded-xl text-sm"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-primary)", color: "var(--text-primary)" }}
              />
            </div>
            {editModal.data.entityType === "ORGANIZATION" && (
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                  {t("entities.category", "Category")}
                </label>
                <select
                  value={editModal.data.category}
                  onChange={(e) => setEditModal({ ...editModal, data: { ...editModal.data, category: e.target.value } })}
                  className="w-full px-3 py-2.5 rounded-xl text-sm"
                  style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-primary)", color: "var(--text-primary)" }}
                >
                  <option value="DISTRIBUTOR">Distributor</option>
                  <option value="LABEL">Label</option>
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                {t("entities.description", "Description")}
              </label>
              <textarea
                value={editModal.data.description || ""}
                onChange={(e) => setEditModal({ ...editModal, data: { ...editModal.data, description: e.target.value } })}
                className="w-full px-3 py-2.5 rounded-xl text-sm h-20 resize-none"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-primary)", color: "var(--text-primary)" }}
              />
            </div>
            <button onClick={() => handleUpdate()} disabled={saving}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
              style={{ background: saving ? "var(--text-disabled)" : "var(--accent)" }}>
              {saving ? t("common.saving", "Saving...") : t("common.save", "Save Changes")}
            </button>
          </div>
        </Modal>
      )}

      {/* Invite Modal */}
      {inviteModal.open && (
        <Modal isOpen={inviteModal.open} onClose={() => { setInviteModal({ open: false, entityId: "", entityName: "" }); setError(""); }}
          title={`${t("entities.inviteTo", "Invite to")} ${inviteModal.entityName}`}>
          <div className="space-y-4">
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                {t("entities.inviteEmail", "Email Address")}
              </label>
              <input type="email" value={inviteData.email}
                onChange={(e) => setInviteData({ ...inviteData, email: e.target.value })}
                placeholder="user@example.com"
                className="w-full px-3 py-2.5 rounded-xl text-sm"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-primary)", color: "var(--text-primary)" }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                {t("entities.inviteRole", "Role")}
              </label>
              <select value={inviteData.role}
                onChange={(e) => setInviteData({ ...inviteData, role: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl text-sm"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-primary)", color: "var(--text-primary)" }}>
                <option value="MEMBER">Member</option>
                <option value="ADMIN">Admin</option>
                <option value="OWNER">Owner</option>
              </select>
            </div>
            <button onClick={handleInvite} disabled={saving}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
              style={{ background: saving ? "var(--text-disabled)" : "var(--accent)" }}>
              {saving ? t("common.sending", "Sending...") : t("entities.sendInvite", "Send Invitation")}
            </button>
          </div>
        </Modal>
      )}

      {/* Entity Detail Drawer */}
      {detailEntity && (
        <div className="fixed inset-0 z-50 flex justify-end" style={{ animation: "backdropIn 0.2s ease-out" }}>
          <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }} onClick={() => { setDetailEntity(null); setIsEditingDetail(false); setIsInvitingDetail(false); setError(""); }} />
          <div className="relative w-full max-w-lg h-full overflow-y-auto"
            style={{ background: "var(--bg-primary)", borderLeft: "1px solid var(--border-primary)", animation: "modalIn 0.25s cubic-bezier(0.2, 0, 0, 1)" }}>
            <div className="p-6 space-y-6">
              {/* Header */}
              {isEditingDetail ? (
                <div className="space-y-4 p-4 rounded-xl border border-[var(--border-primary)]" style={{ background: "var(--bg-surface)" }}>
                   <div className="flex items-center justify-between mb-2">
                     <h2 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>{t("common.edit", "Edit Entity")}</h2>
                     <button onClick={() => { setIsEditingDetail(false); setError(""); }} className="p-2 rounded-lg" style={{ color: "var(--text-tertiary)" }}>
                       <CloseIcon size={18} />
                     </button>
                   </div>
                   {error && <p className="text-sm text-red-500">{error}</p>}
                   <div>
                     <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>{t("entities.name", "Official Name")}</label>
                     <input type="text" value={editData?.officialName || ""} onChange={(e) => setEditData({ ...editData, officialName: e.target.value })}
                       className="w-full px-3 py-2.5 rounded-xl text-sm" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-primary)", color: "var(--text-primary)" }} />
                   </div>
                   {editData?.entityType === "ORGANIZATION" && (
                     <div>
                       <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>{t("entities.category", "Category")}</label>
                       <select value={editData?.category || "LABEL"} onChange={(e) => setEditData({ ...editData, category: e.target.value })}
                         className="w-full px-3 py-2.5 rounded-xl text-sm" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-primary)", color: "var(--text-primary)" }}>
                         <option value="DISTRIBUTOR">Distributor</option>
                         <option value="LABEL">Label</option>
                       </select>
                     </div>
                   )}
                   <div>
                     <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>{t("entities.description", "Description")}</label>
                     <textarea value={editData?.description || ""} onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                       className="w-full px-3 py-2.5 rounded-xl text-sm h-20 resize-none" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-primary)", color: "var(--text-primary)" }} />
                   </div>
                   <div className="flex gap-2 pt-2">
                     <button onClick={() => setIsEditingDetail(false)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all border border-[var(--border-primary)]" style={{ color: "var(--text-primary)" }}>{t("common.cancel", "Cancel")}</button>
                     <button onClick={() => handleUpdate(true)} disabled={saving} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-all" style={{ background: saving ? "var(--text-disabled)" : "var(--accent)" }}>
                       {saving ? t("common.saving", "Saving...") : t("common.apply", "Apply Changes")}
                     </button>
                   </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>{detailEntity.officialName}</h2>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full mt-1 inline-block"
                      style={{ background: "var(--bg-elevated)", color: entityTypeColor(detailEntity.entityType) }}>
                      {entityTypeLabel(detailEntity.entityType, (detailEntity.metadata as any)?.category)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {user.permissions.includes("entity.update") && (
                      <button
                        onClick={() => { setIsEditingDetail(true); setError(""); setEditData({ ...detailEntity, category: (detailEntity.metadata as any)?.category || "LABEL" }); }}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                        style={{ background: "var(--bg-surface)", border: "1px solid var(--border-primary)", color: "var(--text-primary)" }}
                      >
                        {t("common.edit", "Edit")}
                      </button>
                    )}
                    {(user.entityType === "SUPER_ADMIN" || user.entityType === "SYSTEM_ADMIN") && (
                      <button
                        onClick={() => { handleDelete(detailEntity.id); }}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                        style={{ background: "var(--status-error)", color: "white" }}
                      >
                        {t("common.delete", "Delete")}
                      </button>
                    )}
                    <button onClick={() => { setDetailEntity(null); setIsEditingDetail(false); setIsInvitingDetail(false); setError(""); }} className="p-2 rounded-lg" style={{ color: "var(--text-tertiary)" }}>
                      <CloseIcon size={18} />
                    </button>
                  </div>
                </div>
              )}

              {/* Stats */}
              {!isEditingDetail && (
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Members", value: detailEntity.userRoles?.length || 0 },
                    { label: "Children", value: detailEntity.children?.length || 0 },
                    { label: "Labels", value: detailEntity._count?.labels || 0 },
                    { label: "Releases", value: detailEntity._count?.releases || 0 },
                  ].map((stat) => (
                    <div key={stat.label} className="rounded-xl p-3" style={{ background: "var(--bg-surface)", border: "1px solid var(--border-primary)" }}>
                      <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>{stat.label}</p>
                      <p className="text-lg font-bold mt-0.5" style={{ color: "var(--text-primary)" }}>{stat.value}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Members */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Members</h3>
                  {user.permissions.includes("entity.invite") && !isInvitingDetail && (
                    <button onClick={() => { setIsInvitingDetail(true); setError(""); }}
                      className="text-xs font-medium px-3 py-1.5 rounded-lg" style={{ background: "var(--accent-surface)", color: "var(--accent-text)" }}>
                      + Invite
                    </button>
                  )}
                </div>
                
                {/* Inline Invite Form */}
                {isInvitingDetail && (
                   <div className="p-4 rounded-xl border border-[var(--border-primary)] mb-4" style={{ background: "var(--bg-surface)" }}>
                     <div className="flex items-center justify-between mb-3">
                       <h4 className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>{t("entities.inviteNewMember", "Invite New Member")}</h4>
                       <button onClick={() => { setIsInvitingDetail(false); setError(""); }} className="p-1 rounded text-[var(--text-tertiary)]"><CloseIcon size={14} /></button>
                     </div>
                     {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
                     <div className="space-y-3">
                       <div>
                         <label className="block text-xs mb-1" style={{ color: "var(--text-secondary)" }}>{t("entities.inviteEmail", "Email Address")}</label>
                         <input type="email" value={inviteData.email} onChange={(e) => setInviteData({ ...inviteData, email: e.target.value })}
                           placeholder="user@example.com" className="w-full px-3 py-2 rounded-lg text-xs" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-primary)", color: "var(--text-primary)" }} />
                       </div>
                       <div>
                         <label className="block text-xs mb-1" style={{ color: "var(--text-secondary)" }}>{t("entities.inviteRole", "Role")}</label>
                         <select value={inviteData.role} onChange={(e) => setInviteData({ ...inviteData, role: e.target.value })}
                           className="w-full px-3 py-2 rounded-lg text-xs" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-primary)", color: "var(--text-primary)" }}>
                           <option value="MEMBER">Member</option>
                           <option value="ADMIN">Admin</option>
                           <option value="OWNER">Owner</option>
                         </select>
                       </div>
                       <button onClick={() => handleInvite(true)} disabled={saving} className="w-full py-2 rounded-lg text-xs font-semibold text-white transition-all" style={{ background: saving ? "var(--text-disabled)" : "var(--accent)" }}>
                         {saving ? t("common.sending", "Sending...") : t("common.apply", "Apply")}
                       </button>
                     </div>
                   </div>
                )}
                
                <div className="space-y-2">
                  {detailEntity.userRoles?.map((ur: any) => (
                    <div key={ur.id} className="flex items-center justify-between py-2 px-3 rounded-lg"
                      style={{ background: "var(--bg-elevated)" }}>
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold"
                          style={{ background: "var(--bg-surface)", color: "var(--text-secondary)" }}>
                          {(ur.user?.name || ur.user?.email)?.[0]?.toUpperCase() || "?"}
                        </div>
                        <div>
                          <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>{ur.user?.name || ur.user?.email}</p>
                          <p className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>{ur.user?.email}</p>
                        </div>
                      </div>
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: "var(--bg-surface)", color: "var(--accent)" }}>
                        {ur.role}
                      </span>
                    </div>
                  ))}
                  {(!detailEntity.userRoles || detailEntity.userRoles.length === 0) && (
                    <p className="text-xs text-center py-4" style={{ color: "var(--text-tertiary)" }}>No members yet</p>
                  )}
                </div>
              </div>

              {/* Pending Invitations */}
              {detailEntity.invitations?.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-3 mt-6">
                    <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Pending Invitations</h3>
                  </div>
                  <div className="space-y-2">
                    {detailEntity.invitations.map((invite: any) => (
                      <div key={invite.id} className="flex items-center justify-between py-2 px-3 rounded-lg"
                        style={{ background: "var(--bg-elevated)" }}>
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold"
                            style={{ background: "var(--bg-surface)", color: "var(--text-secondary)" }}>
                            {invite.email[0].toUpperCase()}
                          </div>
                          <div>
                            <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>{invite.email}</p>
                            <p className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>Expires: {new Date(invite.expiresAt).toLocaleDateString()}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: "var(--bg-surface)", color: "var(--accent)" }}>
                            {invite.role}
                          </span>
                          {user.permissions.includes("entity.invite") && (
                            <button onClick={() => handleRevokeInvite(invite.id)} className="text-[10px] font-medium px-2 py-0.5 rounded-full hover:bg-red-500 hover:text-white transition-colors" style={{ color: "var(--status-error)", border: "1px solid var(--status-error)" }}>
                              Revoke
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Children */}
              {detailEntity.children?.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Child Entities</h3>
                  <div className="space-y-2">
                    {detailEntity.children.map((child: any) => (
                      <div key={child.id} className="flex items-center justify-between py-2 px-3 rounded-lg cursor-pointer"
                        style={{ background: "var(--bg-elevated)" }}
                        onClick={() => fetchEntityDetail(child.id)}>
                        <div>
                          <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>{child.officialName}</p>
                          <span className="text-[10px]" style={{ color: entityTypeColor(child.entityType) }}>{entityTypeLabel(child.entityType, (child.metadata as any)?.category)}</span>
                        </div>
                        <ArrowUpRightIcon size={14} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

