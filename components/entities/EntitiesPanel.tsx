"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { UserSession } from "@/lib/types";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { translateApiError } from "@/lib/i18n/translateApiError";
import { useToast } from "@/components/ui/Toast";
import Modal from "@/components/ui/Modal";
import EntityTreeView, { type EntityNode } from "@/components/entities/EntityTreeView";
import {
  AddIcon,
  CloseIcon,
  ArrowUpRightIcon,
} from "@/components/ui/Icon";

import { ApiClientError, apiRequest } from "@/lib/api-client";
import {
  childEntityOptions,
  entityTypeLabel as managementEntityTypeLabel,
  roleLabel,
  type EntityType,
  type EntityRole,
} from "@/lib/entity-management";

interface EntityMember {
  id: string;
  email: string;
  name?: string | null;
  membership?: { id?: string; entityRole?: EntityRole; businessTitle?: string | null } | null;
}

interface PendingInvitation {
  id: string;
  email: string;
  role: EntityRole;
  businessTitle?: string | null;
  expiresAt: string;
}

interface CatalogEntity extends EntityNode {
  description?: string | null;
  _count?: { children?: number; userRoles?: number; labels?: number; releases?: number };
}

interface EntityDetail extends CatalogEntity {
  children: CatalogEntity[];
  userRoles: Array<{ id: string; role: EntityRole; user: EntityMember }>;
  invitations: PendingInvitation[];
}

interface LabelOption {
  id: string;
  name: string;
}

interface LabelAccess {
  subAccountId: string;
  labelIds: string[];
}

const ACCESS_LEVELS: readonly EntityRole[] = ["OWNER", "ADMIN", "REVIEWER", "ACCOUNTANT", "MEMBER"];
const ACCESS_RANK: Record<EntityRole, number> = { OWNER: 3, ADMIN: 2, REVIEWER: 1, ACCOUNTANT: 1, MEMBER: 1 };

type EditableEntity = Pick<CatalogEntity, "id" | "officialName" | "description" | "entityType" | "path" | "parentId">;

export default function EntitiesPanel({ user }: { user: UserSession }) {
  const { t } = useI18n();
  const [allEntities, setAllEntities] = useState<CatalogEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [createModal, setCreateModal] = useState(false);
  const [detailEntity, setDetailEntity] = useState<EntityDetail | null>(null);
  const [isEditingDetail, setIsEditingDetail] = useState(false);
  const [editData, setEditData] = useState<EditableEntity | null>(null);
  const [isInvitingDetail, setIsInvitingDetail] = useState(false);
  const initialChildOption = childEntityOptions(user.entityType as EntityType, t)[0];
  const initialChildType = initialChildOption?.type ?? "SUB_ACCOUNT";
  const initialChildTier = initialChildOption?.businessTier ?? "ARTIST";
  const [createParentId, setCreateParentId] = useState(user.entityId);
  const [createData, setCreateData] = useState({ officialName: "", entityType: initialChildType, businessTier: initialChildTier, description: "" });
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteBusinessTitle, setInviteBusinessTitle] = useState("");
  const [inviteRole, setInviteRole] = useState<EntityRole>("MEMBER");
  const [availableLabels, setAvailableLabels] = useState<LabelOption[]>([]);
  const [assignedLabelIds, setAssignedLabelIds] = useState<string[]>([]);
  const [labelAccessLoading, setLabelAccessLoading] = useState(false);
  const detailRequest = useRef(0);
  const [labelAccessReady, setLabelAccessReady] = useState(false);
  const [labelAccessDirty, setLabelAccessDirty] = useState(false);
  const [labelAccessError, setLabelAccessError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { showToast } = useToast();

  const canManageLabelAccess = (entity: CatalogEntity) =>
    user.entityType === "ORGANIZATION" &&
    user.permissions.includes("entity.update") &&
    entity.entityType === "SUB_ACCOUNT" &&
    entity.parentId === user.entityId;

  const fetchEntities = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await apiRequest<CatalogEntity[]>("/api/v1/catalog/entities");
      setAllEntities(rows);
      setTotal(rows.length);
    } catch (e) {
      console.error("Error fetching entities:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchEntities(); }, [fetchEntities]);

  const handleCreate = async () => {
    if (!createData.officialName.trim()) { setError(t("entities.nameRequired")); return; }
    setSaving(true);
    setError("");
    try {
      await apiRequest("/api/v1/catalog/entities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentId: createParentId,
          entityType: createData.entityType,
          businessTier: createData.businessTier,
          officialName: createData.officialName,
          ...(createData.description ? { description: createData.description } : {}),
        }),
      });
      showToast(t("entities.createdSuccess"), "success");
      setCreateModal(false);
      setCreateParentId(user.entityId);
      setCreateData({ officialName: "", entityType: initialChildType, businessTier: initialChildTier, description: "" });
      fetchEntities();
    } catch (error) { setError(error instanceof ApiClientError ? translateApiError(error.code, t) : t("entities.networkError")); }
    finally { setSaving(false); }
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim()) { setError(t("entities.emailRequired")); return; }
    if (inviteBusinessTitle.trim().length < 2) { setError(t("entities.jobTitleRequired", "Enter a job title")); return; }
    if (!detailEntity) return;
    if (canManageLabelAccess(detailEntity) && (!labelAccessReady || labelAccessDirty || assignedLabelIds.length === 0)) {
      setError(t("entities.assignLabelBeforeInvite", "Save at least one assigned label before inviting the account owner"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const targetEntityId = detailEntity.id;
      const ownerOnboarding = (
        !detailEntity.userRoles.some((membership) => membership.role === "OWNER") &&
        !detailEntity.invitations.some((invitation) => invitation.role === "OWNER")
      );
      await apiRequest("/api/v1/identity/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          role: ownerOnboarding ? "OWNER" : inviteRole,
          businessTitle: inviteBusinessTitle.trim(),
          entityId: targetEntityId,
        }),
      });
      showToast(`${t("entities.invitationSentTo")} ${inviteEmail.trim()}`, "success");
      setIsInvitingDetail(false);
      setInviteEmail("");
      setInviteBusinessTitle("");
      if (detailEntity?.id === targetEntityId) fetchEntityDetail(detailEntity.id);
    } catch (error) { setError(error instanceof ApiClientError ? translateApiError(error.code, t) : t("entities.networkError")); }
    finally { setSaving(false); }
  };

  const handleRevokeInvite = async (inviteId: string) => {
    if (!confirm(t("entities.confirmRevokeInvite"))) return;
    try {
      await apiRequest(`/api/v1/identity/invitations/${inviteId}`, { method: "DELETE" });
      showToast(t("entities.invitationRevoked"), "success");
      if (detailEntity) fetchEntityDetail(detailEntity.id);
    } catch {
      showToast(t("entities.networkError"), "error");
    }
  };

  const fetchEntityDetail = async (id: string) => {
    const request = ++detailRequest.current;
    setIsEditingDetail(false);
    setIsInvitingDetail(false);
    setLabelAccessReady(false);
    setError("");
    try {
      const [entityRows, usersResult, invitationsResult] = await Promise.all([
        apiRequest<CatalogEntity[]>("/api/v1/catalog/entities"),
        apiRequest<{ users: EntityMember[]; total: number }>(`/api/v1/identity/users?entityId=${encodeURIComponent(id)}&limit=100&offset=0`),
        apiRequest<{ invitations: PendingInvitation[] }>(`/api/v1/identity/invitations?entityId=${encodeURIComponent(id)}&status=PENDING&limit=100&offset=0`),
      ]);
      if (request !== detailRequest.current) return;
      const entity = entityRows.find((item) => item.id === id);
      if (!entity) return;
      setDetailEntity({
        ...entity,
        children: entityRows.filter((item) => item.parentId === id),
        userRoles: usersResult.users.map((member) => ({
          id: member.membership?.id ?? member.id,
          role: member.membership?.entityRole ?? "MEMBER",
          user: member,
        })),
        invitations: invitationsResult.invitations,
        _count: { ...entity._count, userRoles: usersResult.total },
      });
      setAvailableLabels([]);
      setAssignedLabelIds([]);
      setLabelAccessDirty(false);
      setLabelAccessError("");
      if (canManageLabelAccess(entity)) {
        setLabelAccessLoading(true);
        try {
          const [labels, access] = await Promise.all([
            apiRequest<LabelOption[]>("/api/v1/catalog/labels"),
            apiRequest<LabelAccess>(`/api/v1/catalog/entities/${encodeURIComponent(id)}/label-access`),
          ]);
          if (request !== detailRequest.current) return;
          setLabelAccessReady(true);
          setAvailableLabels(labels);
          setAssignedLabelIds(access.labelIds);
        } catch (labelError) {
          if (request !== detailRequest.current) return;
          setLabelAccessError(labelError instanceof ApiClientError
            ? translateApiError(labelError.code, t)
            : t("entities.labelAccessLoadFailed", "Could not load label access"));
        } finally {
          if (request === detailRequest.current) setLabelAccessLoading(false);
        }
      } else {
        setLabelAccessLoading(false);
      }
    } catch (error) {
      if (request === detailRequest.current) showToast(error instanceof ApiClientError ? translateApiError(error.code, t) : t("entities.networkError"), "error");
    }
  };

  const handleSaveLabelAccess = async () => {
    if (!detailEntity || !canManageLabelAccess(detailEntity) || !labelAccessReady) return;
    const request = detailRequest.current;
    setSaving(true);
    setLabelAccessError("");
    try {
      const access = await apiRequest<LabelAccess>(`/api/v1/catalog/entities/${encodeURIComponent(detailEntity.id)}/label-access`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labelIds: assignedLabelIds }),
      });
      if (request !== detailRequest.current) return;
      setAssignedLabelIds(access.labelIds);
      setLabelAccessDirty(false);
      showToast(t("entities.labelAccessSaved", "Label access updated"), "success");
    } catch (saveError) {
      if (request !== detailRequest.current) return;
      setLabelAccessError(saveError instanceof ApiClientError
        ? translateApiError(saveError.code, t)
        : t("entities.labelAccessSaveFailed", "Could not update label access"));
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    const dataToUse = editData;
    if (!dataToUse?.officialName?.trim()) { setError(t("entities.nameRequired")); return; }
    setSaving(true);
    setError("");
    try {
      await apiRequest(`/api/v1/catalog/entities/${dataToUse.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          officialName: dataToUse.officialName,
          description: dataToUse.description || null,
        }),
      });
      showToast(t("entities.updatedSuccess"), "success");
      setIsEditingDetail(false);
      fetchEntities();
      if (detailEntity?.id === dataToUse.id) fetchEntityDetail(dataToUse.id);
    } catch (error) { setError(error instanceof ApiClientError ? translateApiError(error.code, t) : t("entities.networkError")); }
    finally { setSaving(false); }
  };

  const ownerOnboarding = detailEntity ? (
    !detailEntity.userRoles.some((membership) => membership.role === "OWNER") &&
    !detailEntity.invitations.some((invitation) => invitation.role === "OWNER")
  ) : true;
  const assignableInviteRoles = user.entityType === "SUPER_ADMIN" && user.entityRole === "OWNER"
    ? ACCESS_LEVELS
    : ACCESS_LEVELS.filter((role) => ACCESS_RANK[role] <= ACCESS_RANK[user.entityRole as EntityRole]);

  const handleDelete = async (id: string) => {
    if (!confirm(t("entities.confirmDelete"))) return;
    try {
      await apiRequest(`/api/v1/catalog/entities/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: false }),
      });
      showToast(t("entities.deletedSuccess"), "success");
      detailRequest.current++; setDetailEntity(null);
      fetchEntities();
    } catch {
      showToast(t("entities.networkError"), "error");
    }
  };

  const parentCandidates = [
    {
      id: user.entityId,
      officialName: user.entityName,
      entityType: user.entityType,
      path: user.entityPath,
      businessLevel: allEntities.find((entity) => entity.id === user.entityId)?.businessLevel,
    },
    ...allEntities.filter((entity) => entity.id !== user.entityId),
  ].filter((entity) => childEntityOptions(entity.entityType as EntityType, t, entity.businessLevel).length > 0);
  const selectedParent = parentCandidates.find((entity) => entity.id === createParentId) ?? parentCandidates[0];
  const createOptions = selectedParent
    ? childEntityOptions(selectedParent.entityType as EntityType, t, selectedParent.businessLevel)
    : [];

  const openCreateModal = (parent?: EntityNode) => {
    const nextParent = parent && childEntityOptions(parent.entityType as EntityType, t, parent.businessLevel).length > 0
      ? parent
      : parentCandidates.find((entity) => entity.id === user.entityId) ?? parentCandidates[0];
    if (!nextParent) return;
    const nextOption = childEntityOptions(nextParent.entityType as EntityType, t, nextParent.businessLevel)[0];
    if (!nextOption) return;
    setCreateParentId(nextParent.id);
    setCreateData({ officialName: "", entityType: nextOption.type, businessTier: nextOption.businessTier, description: "" });
    setError("");
    setCreateModal(true);
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
    <div className="min-w-0 space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
            {t("entities.title", "Cấu trúc tổ chức")}
          </h2>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
            {t("entities.subtitle", "Quản lý tổ chức, đơn vị trực thuộc và tài khoản khách hàng trong một cây thống nhất")} · {total} {t("entities.entities", "đơn vị")}
          </p>
        </div>
        {user.permissions.includes("entity.create") && parentCandidates.length > 0 && (
          <button
            onClick={() => openCreateModal()}
            className="inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-[var(--radius-input)] px-4 text-sm font-semibold text-[var(--accent-contrast)] focus-visible:outline-2 focus-visible:outline-[var(--color-focus)]"
            style={{ background: "var(--accent)" }}
          >
            <AddIcon size={16} /> {t("entities.create", "Tạo cấp trực thuộc")}
          </button>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl p-4" style={{ background: "var(--bg-surface)", border: "1px solid var(--border-primary)" }}>
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{t("entities.structureMeaning", "Cấu trúc tổ chức")}</p>
          <p className="mt-1 text-xs leading-5" style={{ color: "var(--text-secondary)" }}>{t("entities.structureMeaningHelp", "Mỗi tổ chức khách hàng có dữ liệu hãng đĩa, nghệ sĩ và bản phát hành riêng. Tổ chức trực thuộc có thể tiếp tục tạo nhiều cấp; tài khoản trực thuộc luôn là cấp cuối.")}</p>
        </div>
        <div className="rounded-xl p-4" style={{ background: "var(--bg-surface)", border: "1px solid var(--border-primary)" }}>
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{t("entities.memberMeaning", "Người dùng & quyền truy cập")}</p>
          <p className="mt-1 text-xs leading-5" style={{ color: "var(--text-secondary)" }}>{t("entities.memberMeaningHelp", "CEO, đồng sáng lập hay phó giám đốc là chức danh con người. Quyền hệ thống được gán riêng: chủ sở hữu, quản trị, duyệt nội dung, kế toán hoặc thành viên.")}</p>
        </div>
      </div>

      <EntityTreeView
        entities={allEntities}
        loading={loading}
        selectedId={detailEntity?.id ?? null}
        onSelect={fetchEntityDetail}
        onCreateChild={user.permissions.includes("entity.create") ? (entity) => openCreateModal(entity) : undefined}
      />

      {/* Create Entity Modal */}
      {createModal && (
        <Modal isOpen={createModal} onClose={() => { setCreateModal(false); setError(""); }} title={t("entities.createTitle", "Create Direct Unit")}>
          <div className="space-y-4">
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div>
              <label htmlFor="organization-name" className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                {t("entities.name", "Official Name")}
              </label>
              <input
                id="organization-name" type="text" value={createData.officialName} autoFocus
                onChange={(e) => setCreateData({ ...createData, officialName: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl text-sm"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-primary)", color: "var(--text-primary)" }}
              />
            </div>
            <div className="rounded-xl p-3" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-primary)" }}>
              <label htmlFor="managing-organization" className="text-[11px] font-medium" style={{ color: "var(--text-tertiary)" }}>{t("entities.parent", "Trực thuộc")}</label>
              <select
                id="managing-organization"
                value={createParentId}
                onChange={(event) => {
                  const parent = parentCandidates.find((item) => item.id === event.target.value);
                  const nextOption = parent ? childEntityOptions(parent.entityType as EntityType, t, parent.businessLevel)[0] : undefined;
                  if (parent && nextOption) {
                    setCreateParentId(parent.id);
                    setCreateData({ ...createData, entityType: nextOption.type, businessTier: nextOption.businessTier });
                  }
                }}
                className="mt-1 w-full bg-transparent text-sm font-semibold outline-none"
                style={{ color: "var(--text-primary)" }}
              >
                {parentCandidates.map((parent) => (
                  <option key={parent.id} value={parent.id}>{parent.officialName} · {managementEntityTypeLabel(parent.entityType as EntityType, t, parent.businessLevel)}</option>
                ))}
              </select>
              <p className="mt-2 text-xs" style={{ color: "var(--text-secondary)" }}>{selectedParent?.officialName} → {createOptions.find((option) => option.businessTier === createData.businessTier)?.label}</p>
            </div>
            {createOptions.length > 1 && (
              <fieldset>
                <legend className="block text-xs font-medium mb-2" style={{ color: "var(--text-secondary)" }}>{t("entities.type", "Loại cấp trực thuộc")}</legend>
                <div className="grid gap-2">
                  {createOptions.map((option) => {
                    const selected = createData.businessTier === option.businessTier;
                    return (
                      <button key={option.businessTier} type="button" aria-pressed={selected} onClick={() => setCreateData({ ...createData, entityType: option.type, businessTier: option.businessTier })}
                        className="rounded-xl p-3 text-left transition-colors"
                        style={{ background: selected ? "var(--accent-surface)" : "var(--bg-elevated)", border: `1px solid ${selected ? "var(--accent)" : "var(--border-primary)"}` }}>
                        <span className="block text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{option.label}</span>
                        <span className="mt-1 block text-xs" style={{ color: "var(--text-secondary)" }}>{option.description}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            )}
            <div>
              <label htmlFor="organization-description" className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                {t("entities.description", "Description")}
              </label>
              <textarea
                id="organization-description"
                value={createData.description}
                onChange={(e) => setCreateData({ ...createData, description: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl text-sm h-20 resize-none"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-primary)", color: "var(--text-primary)" }}
              />
            </div>
            <button onClick={handleCreate} disabled={saving}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
              style={{ background: saving ? "var(--text-disabled)" : "var(--accent)" }}>
              {saving ? t("common.saving", "Saving...") : t("entities.create", "Create Direct Unit")}
            </button>
          </div>
        </Modal>
      )}

      {/* Entity Detail Drawer */}
      {detailEntity && (
        <div className="fixed inset-0 z-50 flex justify-end" style={{ animation: "backdropIn 0.2s ease-out" }}>
          <div className="absolute inset-0" style={{ background: "var(--color-overlay)" }} onClick={() => { detailRequest.current++; setDetailEntity(null); setIsEditingDetail(false); setIsInvitingDetail(false); setError(""); }} />
          <div className="relative w-full max-w-lg h-full overflow-y-auto"
            style={{ background: "var(--bg-primary)", borderLeft: "1px solid var(--border-primary)", animation: "modalIn 0.25s cubic-bezier(0.2, 0, 0, 1)" }}>
            <div className="min-w-0 space-y-6 p-4 sm:p-6">
              {/* Header */}
              {isEditingDetail ? (
                <div className="space-y-4 p-4 rounded-xl border border-[var(--border-primary)]" style={{ background: "var(--bg-surface)" }}>
                   <div className="flex items-center justify-between mb-2">
                     <h2 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>{t("common.edit", "Edit unit")}</h2>
                     <button onClick={() => { setIsEditingDetail(false); setError(""); }} className="p-2 rounded-lg" style={{ color: "var(--text-tertiary)" }}>
                       <CloseIcon size={18} />
                     </button>
                   </div>
                   {error && <p className="text-sm text-red-500">{error}</p>}
                   <div>
                     <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>{t("entities.name", "Official Name")}</label>
                     <input type="text" value={editData?.officialName || ""} onChange={(e) => setEditData((current) => current ? { ...current, officialName: e.target.value } : current)}
                       className="w-full px-3 py-2.5 rounded-xl text-sm" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-primary)", color: "var(--text-primary)" }} />
                   </div>
                   <div>
                     <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>{t("entities.description", "Description")}</label>
                     <textarea value={editData?.description || ""} onChange={(e) => setEditData((current) => current ? { ...current, description: e.target.value } : current)}
                       className="w-full px-3 py-2.5 rounded-xl text-sm h-20 resize-none" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-primary)", color: "var(--text-primary)" }} />
                   </div>
                   <div className="flex gap-2 pt-2">
                     <button onClick={() => setIsEditingDetail(false)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all border border-[var(--border-primary)]" style={{ color: "var(--text-primary)" }}>{t("common.cancel", "Cancel")}</button>
                     <button onClick={handleUpdate} disabled={saving} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-all" style={{ background: saving ? "var(--text-disabled)" : "var(--accent)" }}>
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
                      {managementEntityTypeLabel(detailEntity.entityType as EntityType, t, detailEntity.businessLevel)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {user.permissions.includes("entity.update") && (
                      <button
                        onClick={() => { setIsEditingDetail(true); setError(""); setEditData({ ...detailEntity }); }}
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
                    <button onClick={() => { detailRequest.current++; setDetailEntity(null); setIsEditingDetail(false); setIsInvitingDetail(false); setError(""); }} className="p-2 rounded-lg" style={{ color: "var(--text-tertiary)" }}>
                      <CloseIcon size={18} />
                    </button>
                  </div>
                </div>
              )}

              {canManageLabelAccess(detailEntity) && (
                <section className="rounded-xl border p-4" style={{ background: "var(--bg-surface)", borderColor: "var(--border-primary)" }}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{t("entities.assignedLabels", "Assigned labels")}</h3>
                      <p className="mt-1 text-xs leading-5" style={{ color: "var(--text-secondary)" }}>{t("entities.assignedLabelsHelp", "This client account can create releases only for the selected labels.")}</p>
                    </div>
                    <button type="button" onClick={handleSaveLabelAccess} disabled={saving || labelAccessLoading || !labelAccessReady || !labelAccessDirty}
                      className="shrink-0 rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                      style={{ background: "var(--accent)" }}>
                      {saving ? t("common.saving", "Saving...") : t("common.save", "Save")}
                    </button>
                  </div>
                  {labelAccessError && <p role="alert" className="mt-3 text-xs" style={{ color: "var(--status-error)" }}>{labelAccessError}</p>}
                  {labelAccessLoading ? (
                    <p className="mt-3 text-xs" style={{ color: "var(--text-secondary)" }}>{t("common.loading", "Loading...")}</p>
                  ) : availableLabels.length === 0 ? (
                    <p className="mt-3 rounded-lg border p-3 text-xs leading-5" style={{ borderColor: "var(--border-primary)", color: "var(--text-secondary)" }}>
                      {t("entities.noLabelsToAssign", "Create a label before setting up this client account.")}
                    </p>
                  ) : (
                    <fieldset className="mt-3 grid gap-2 sm:grid-cols-2">
                      <legend className="sr-only">{t("entities.assignedLabels", "Assigned labels")}</legend>
                      {availableLabels.map((label) => {
                        const checked = assignedLabelIds.includes(label.id);
                        return (
                          <label key={label.id} className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-xs"
                            style={{ borderColor: checked ? "var(--accent)" : "var(--border-primary)", background: checked ? "var(--accent-surface)" : "var(--bg-elevated)", color: "var(--text-primary)" }}>
                            <input type="checkbox" checked={checked} disabled={saving || !labelAccessReady} onChange={() => {
                              setAssignedLabelIds((current) => checked ? current.filter((id) => id !== label.id) : [...current, label.id]);
                              setLabelAccessDirty(true);
                            }} className="h-4 w-4 accent-[var(--accent)]" />
                            <span className="truncate font-medium">{label.name}</span>
                          </label>
                        );
                      })}
                    </fieldset>
                  )}
                  {!labelAccessLoading && availableLabels.length > 0 && (labelAccessDirty || assignedLabelIds.length === 0) && (
                    <p className="mt-3 text-xs leading-5" style={{ color: "var(--status-warning)" }}>{t("entities.assignLabelBeforeInvite", "Save at least one assigned label before inviting the account owner")}</p>
                  )}
                </section>
              )}

              {/* Members */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{t("entities.members", "Members")}</h3>
                  {user.permissions.includes("entity.invite") && !isInvitingDetail && (
                    <button onClick={() => { setInviteEmail(""); setInviteBusinessTitle(""); setInviteRole(ownerOnboarding ? "OWNER" : "MEMBER"); setIsInvitingDetail(true); setError(""); }}
                      className="text-xs font-medium px-3 py-1.5 rounded-lg" style={{ background: "var(--accent-surface)", color: "var(--accent-text)" }}>
                      + {t("common.invite", "Invite")}
                    </button>
                  )}
                </div>
                
                {/* Inline Invite Form */}
                {isInvitingDetail && (
                   <div className="p-4 rounded-xl border border-[var(--border-primary)] mb-4" style={{ background: "var(--bg-surface)" }}>
                     <div className="flex items-center justify-between mb-3">
                       <h4 className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>{t("entities.inviteNewMember", "Invite New Member")}</h4>
                       <button onClick={() => { setInviteEmail(""); setInviteBusinessTitle(""); setIsInvitingDetail(false); setError(""); }} className="p-1 rounded text-[var(--text-tertiary)]"><CloseIcon size={14} /></button>
                     </div>
                     {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
                     <div className="space-y-3">
                       <div>
                         <label htmlFor="organization-invite-email" className="block text-xs mb-1" style={{ color: "var(--text-secondary)" }}>{t("entities.inviteEmail", "Email Address")}</label>
                         <input id="organization-invite-email" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)}
                           placeholder="user@example.com" className="w-full px-3 py-2 rounded-lg text-xs" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-primary)", color: "var(--text-primary)" }} />
                       </div>
                       <div>
                         <label htmlFor="organization-invite-title" className="block text-xs mb-1" style={{ color: "var(--text-secondary)" }}>{t("users.jobTitle", "Job title")}</label>
                         <input id="organization-invite-title" value={inviteBusinessTitle} maxLength={100} onChange={(e) => setInviteBusinessTitle(e.target.value)}
                           placeholder={detailEntity.entityType === "SUB_ACCOUNT" ? t("users.clientAccountTitlePlaceholder", "e.g. Artist, Producer or Manager") : t("users.jobTitlePlaceholder", "e.g. Owner, CEO or Label Manager")} className="w-full px-3 py-2 rounded-lg text-xs" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-primary)", color: "var(--text-primary)" }} />
                       </div>
                       {ownerOnboarding ? (
                         <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-3">
                           <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{t("entities.inviteRole", "Access level")}</p>
                           <p className="mt-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{roleLabel("OWNER", t)}</p>
                           <p className="mt-1 text-xs leading-5" style={{ color: "var(--text-tertiary)" }}>
                             {t("entities.organizationOwnerInviteHelp", "Add the organization owner first. They can then invite their team.")}
                           </p>
                         </div>
                       ) : (
                         <label className="block text-xs" style={{ color: "var(--text-secondary)" }}>{t("entities.inviteRole", "Access level")}
                           <select aria-label={t("entities.inviteRole", "Access level")} value={inviteRole} onChange={(event) => setInviteRole(event.target.value as EntityRole)} className="mt-1 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-primary)]">
                             {assignableInviteRoles.map((role) => <option key={role} value={role}>{roleLabel(role, t)}</option>)}
                           </select>
                           <span className="mt-1 block leading-5 text-[var(--text-tertiary)]">{t("entities.teamInviteHelp", "Choose what this team member can do. Their job title is shown separately.")}</span>
                         </label>
                       )}
                       <button onClick={handleInvite} disabled={saving || (canManageLabelAccess(detailEntity) && (!labelAccessReady || labelAccessDirty || assignedLabelIds.length === 0))} className="w-full py-2 rounded-lg text-xs font-semibold text-white transition-all" style={{ background: saving ? "var(--text-disabled)" : "var(--accent)" }}>
                         {saving ? t("common.sending", "Sending...") : t("entities.sendInvite", "Send Invitation")}
                       </button>
                     </div>
                   </div>
                )}
                
                <div className="space-y-2">
                  {detailEntity.userRoles?.map((ur) => (
                    <div key={ur.id} className="flex items-center justify-between py-2 px-3 rounded-lg"
                      style={{ background: "var(--bg-elevated)" }}>
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold"
                          style={{ background: "var(--bg-surface)", color: "var(--text-secondary)" }}>
                          {(ur.user?.name || ur.user?.email)?.[0]?.toUpperCase() || "?"}
                        </div>
                        <div>
                          <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>{ur.user?.name || ur.user?.email}</p>
                          {ur.user?.membership?.businessTitle && <p className="text-[10px]" style={{ color: "var(--text-secondary)" }}>{ur.user.membership.businessTitle}</p>}
                          <p className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>{ur.user?.email}</p>
                        </div>
                      </div>
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: "var(--bg-surface)", color: "var(--accent)" }}>
                        {roleLabel(ur.role as EntityRole, t)}
                      </span>
                    </div>
                  ))}
                  {(!detailEntity.userRoles || detailEntity.userRoles.length === 0) && (
                    <p className="text-xs text-center py-4" style={{ color: "var(--text-tertiary)" }}>{t("entities.noMembersYet", "No members yet")}</p>
                  )}
                </div>
              </div>

              {/* Pending Invitations */}
              {detailEntity.invitations?.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-3 mt-6">
                    <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{t("entities.pendingInvitations")}</h3>
                  </div>
                  <div className="space-y-2">
                    {detailEntity.invitations.map((invite) => (
                      <div key={invite.id} className="flex items-center justify-between py-2 px-3 rounded-lg"
                        style={{ background: "var(--bg-elevated)" }}>
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold"
                            style={{ background: "var(--bg-surface)", color: "var(--text-secondary)" }}>
                            {invite.email[0].toUpperCase()}
                          </div>
                          <div>
                            <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>{invite.email}</p>
                            <p className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>{invite.businessTitle ? `${invite.businessTitle} · ` : ""}{t("entities.expires")} {new Date(invite.expiresAt).toLocaleDateString()}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: "var(--bg-surface)", color: "var(--accent)" }}>
                            {roleLabel(invite.role as EntityRole, t)}
                          </span>
                          {user.permissions.includes("entity.invite") && (
                            <button onClick={() => handleRevokeInvite(invite.id)} className="text-[10px] font-medium px-2 py-0.5 rounded-full hover:bg-red-500 hover:text-white transition-colors" style={{ color: "var(--status-error)", border: "1px solid var(--status-error)" }}>
                              {t("entities.revoke")}
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
                  <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>{t("entities.childEntities")}</h3>
                  <div className="space-y-2">
                    {detailEntity.children.map((child) => (
                      <div key={child.id} className="flex items-center justify-between py-2 px-3 rounded-lg cursor-pointer"
                        style={{ background: "var(--bg-elevated)" }}
                        onClick={() => fetchEntityDetail(child.id)}>
                        <div>
                          <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>{child.officialName}</p>
                          <span className="text-[10px]" style={{ color: entityTypeColor(child.entityType) }}>{managementEntityTypeLabel(child.entityType as EntityType, t, child.businessLevel)}</span>
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
