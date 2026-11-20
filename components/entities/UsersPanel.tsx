/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V4 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import Modal from "@/components/ui/Modal";
import Pagination from "@/components/ui/Pagination";
import SecureImage from "@/components/ui/SecureImage";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { AddIcon, DeleteIcon, EditIcon, GroupIcon, SearchIcon } from "@/components/ui/Icon";
import { ApiClientError, apiRequest } from "@/lib/api-client";
import { entityTypeLabel, roleLabel, type EntityRole, type EntityType } from "@/lib/entity-management";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { translateApiError } from "@/lib/i18n/translateApiError";
import type { UserSession } from "@/lib/types";

type StaffRole = "admin" | "moderator" | "supporter" | "finance";

interface BusinessEntity {
  id: string;
  entityType: EntityType;
  officialName?: string;
  name?: string;
  isActive?: boolean;
}

interface Membership {
  entityId: string;
  entityType: EntityType;
  entityRole: EntityRole;
  businessTitle?: string | null;
  entityName: string;
  entityPath: string;
}

interface ManagedUser {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  avatar: string | null;
  isActive: boolean;
  isBanned: boolean;
  banReason: string | null;
  membership: Membership | null;
  staffRoles: StaffRole[];
}

interface UserListResponse {
  users: ManagedUser[];
  total: number;
}

const ENTITY_ROLES: readonly EntityRole[] = ["OWNER", "ADMIN", "REVIEWER", "ACCOUNTANT", "MEMBER"];
const ROLE_RANK: Record<EntityRole, number> = { OWNER: 3, ADMIN: 2, REVIEWER: 1, ACCOUNTANT: 1, MEMBER: 1 };
const EMPTY_CREATE_FORM = {
  email: "",
  password: "",
  phone: "",
  name: "",
  businessTitle: "",
  entityId: "",
  entityRole: "MEMBER" as EntityRole,
  staffRoles: [] as StaffRole[],
};
const inputClass = "w-full rounded-[var(--radius-input)] border border-[var(--border-input)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]";

function displayEntityName(entity: BusinessEntity): string {
  return entity.officialName || entity.name || entity.id;
}


export default function UsersPanel({ user }: { user: UserSession }) {
  const { t } = useI18n();
  const canManagePlatformStaff = user.entityType === "SUPER_ADMIN" && user.entityRole === "OWNER";
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [entities, setEntities] = useState<BusinessEntity[]>([]);
  const [staffRoleCatalog, setStaffRoleCatalog] = useState<StaffRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(20);
  const [saving, setSaving] = useState(false);
  const [createModal, setCreateModal] = useState(false);
  const [createData, setCreateData] = useState(EMPTY_CREATE_FORM);
  const [createError, setCreateError] = useState("");
  const [editModal, setEditModal] = useState<{ open: boolean; user: ManagedUser | null }>({ open: false, user: null });
  const [editData, setEditData] = useState({
    name: "",
    businessTitle: "",
    phone: "",
    email: "",
    password: "",
    entityId: "",
    entityRole: "MEMBER" as EntityRole,
    staffRoles: [] as StaffRole[],
    isBanned: false,
    banReason: "",
  });
  const [editError, setEditError] = useState("");

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(limit), offset: String((page - 1) * limit) });
      if (search.trim()) params.set("search", search.trim());
      const result = await apiRequest<UserListResponse>(`/api/v1/identity/users?${params}`);
      setUsers(result.users);
      setTotal(result.total);
      setTotalPages(Math.max(1, Math.ceil(result.total / limit)));
    } catch (error) {
      console.error("Error fetching users:", error);
    } finally {
      setLoading(false);
    }
  }, [limit, page, search]);

  useEffect(() => { void fetchUsers(); }, [fetchUsers]);

  useEffect(() => {
    let active = true;
    void apiRequest<BusinessEntity[]>("/api/v1/catalog/entities")
      .then((rows) => {
        if (active) setEntities(rows.filter((entity) => entity.entityType !== "SUPER_ADMIN" && entity.isActive !== false));
      })
      .catch((error) => console.error("Error fetching entities:", error));
    if (canManagePlatformStaff) {
      void apiRequest<{ staffRoles: StaffRole[] }>("/api/v1/identity/roles")
        .then((catalog) => { if (active) setStaffRoleCatalog(catalog.staffRoles); })
        .catch((error) => console.error("Error fetching platform roles:", error));
    }
    return () => { active = false; };
  }, [canManagePlatformStaff]);

  const selectedCreateEntity = useMemo(() => entities.find((entity) => entity.id === createData.entityId) ?? null, [createData.entityId, entities]);
  const selectedEditEntity = useMemo(() => entities.find((entity) => entity.id === editData.entityId) ?? null, [editData.entityId, entities]);
  const selectedEditEntityType = selectedEditEntity?.entityType ?? editModal.user?.membership?.entityType;
  const assignableEntityRoles = canManagePlatformStaff
    ? ENTITY_ROLES
    : ENTITY_ROLES.filter((role) => ROLE_RANK[role] <= ROLE_RANK[user.entityRole as EntityRole]);
  const canAssignCreateStaffRoles = canManagePlatformStaff && selectedCreateEntity?.entityType === "SYSTEM_ADMIN";
  const canAssignEditStaffRoles = canManagePlatformStaff && selectedEditEntityType === "SYSTEM_ADMIN";
  const staffRoleLabel = (role: StaffRole) => ({
    admin: t("users.platformAdmin", "Quản trị nền tảng"),
    moderator: t("users.platformModerator", "Kiểm duyệt hệ thống"),
    supporter: t("users.platformSupporter", "Hỗ trợ"),
    finance: t("users.platformFinance", "Tài chính"),
  })[role];

  const setCreateEntity = (entityId: string) => {
    const entity = entities.find((item) => item.id === entityId);
    setCreateData((current) => ({
      ...current,
      entityId,
      entityRole: current.entityRole,
      staffRoles: entity?.entityType === "SYSTEM_ADMIN" ? current.staffRoles : [],
    }));
  };

  const openEditModal = (target: ManagedUser) => {
    setEditData({
      name: target.name || "",
      businessTitle: target.membership?.businessTitle || "",
      phone: target.phone || "",
      email: target.email,
      password: "",
      entityId: target.membership?.entityId || "",
      entityRole: target.membership?.entityRole || "MEMBER",
      staffRoles: target.staffRoles,
      isBanned: target.isBanned,
      banReason: target.banReason || "",
    });
    setEditError("");
    setEditModal({ open: true, user: target });
  };

  const validateAccount = (data: { name: string; email: string; phone: string; password: string }, passwordRequired: boolean) => {
    const errors: string[] = [];
    if (data.name.trim().length < 2) errors.push(t("common.nameRequired", "Họ tên phải có ít nhất 2 ký tự"));
    if ("businessTitle" in data && typeof data.businessTitle === "string" && data.businessTitle.trim().length === 1) errors.push(t("users.jobTitleTooShort", "Chức danh cần ít nhất 2 ký tự"));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())) errors.push(t("common.emailRequiredValid", "Email không hợp lệ"));
    if (data.phone && !/^\+?[0-9\s-]{7,20}$/.test(data.phone)) errors.push(t("common.phoneFormatInvalid", "Số điện thoại không hợp lệ"));
    if (passwordRequired && !data.password) errors.push(t("common.passwordRequired", "Mật khẩu là bắt buộc"));
    if (data.password && (data.password.length < 12 || !/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])/.test(data.password))) {
      errors.push(t("common.passwordComplexity", "Mật khẩu cần ít nhất 12 ký tự, gồm chữ hoa, chữ thường, số và ký hiệu"));
    }
    return errors;
  };

  const handleCreateUser = async () => {
    const errors = validateAccount(createData, true);
    if (!selectedCreateEntity) errors.push(t("users.entityRequired", "Chọn tổ chức hoặc tài khoản khách hàng"));
    if (errors.length) { setCreateError(errors.join("\n")); return; }
    setSaving(true);
    setCreateError("");
    try {
      const entityRole: EntityRole = createData.entityRole;
      await apiRequest("/api/v1/identity/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: createData.email.trim(),
          password: createData.password,
          name: createData.name.trim(),
          ...(createData.businessTitle.trim() ? { businessTitle: createData.businessTitle.trim() } : {}),
          ...(createData.phone.trim() ? { phone: createData.phone.trim() } : {}),
          entityId: createData.entityId,
          entityRole,
          staffRoles: canAssignCreateStaffRoles ? createData.staffRoles : [],
        }),
      });
      setCreateModal(false);
      setCreateData(EMPTY_CREATE_FORM);
      await fetchUsers();
    } catch (error) {
      setCreateError(error instanceof ApiClientError ? translateApiError(error.code, t) : t("common.errorOccurred"));
    } finally { setSaving(false); }
  };

  const handleSave = async () => {
    const target = editModal.user;
    if (!target) return;
    const errors = canManagePlatformStaff ? validateAccount(editData, false) : [];
    if (!canManagePlatformStaff && editData.businessTitle.trim().length === 1) errors.push(t("users.jobTitleTooShort", "Chức danh cần ít nhất 2 ký tự"));
    if (!canManagePlatformStaff && editData.password && (editData.password.length < 12 || !/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])/.test(editData.password))) {
      errors.push(t("common.passwordComplexity", "Mật khẩu cần ít nhất 12 ký tự, gồm chữ hoa, chữ thường, số và ký hiệu"));
    }
    if (editData.isBanned && editData.banReason.trim().length < 3) errors.push(t("users.banReasonRequired", "Nhập lý do khóa tài khoản"));
    if (errors.length) { setEditError(errors.join("\n")); return; }
    setSaving(true);
    setEditError("");
    try {
      if (canManagePlatformStaff) {
        await apiRequest(`/api/v1/identity/users/${target.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: editData.email.trim(), name: editData.name.trim(), phone: editData.phone.trim() || null }),
        });
        await apiRequest(`/api/v1/identity/users/${target.id}/staff-roles`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roles: canAssignEditStaffRoles ? editData.staffRoles : [] }),
        });
      }
      const effectiveRole: EntityRole = editData.entityRole;
      if ((editData.businessTitle.trim() || null) !== (target.membership?.businessTitle || null)) {
        await apiRequest(`/api/v1/identity/users/${target.id}/business-title`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ businessTitle: editData.businessTitle.trim() || null }),
        });
      }
      if (canManagePlatformStaff && editData.entityId && editData.entityId !== target.membership?.entityId) {
        await apiRequest(`/api/v1/identity/users/${target.id}/membership`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entityId: editData.entityId, role: effectiveRole }),
        });
      } else if (target.membership && effectiveRole !== target.membership.entityRole) {
        await apiRequest(`/api/v1/identity/users/${target.id}/membership-role`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: effectiveRole }),
        });
      }
      if (editData.password) {
        await apiRequest(`/api/v1/identity/users/${target.id}/reset-password`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ newPassword: editData.password }),
        });
      }
      if (editData.isBanned !== target.isBanned) {
        await apiRequest(`/api/v1/identity/users/${target.id}/ban`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ banned: editData.isBanned, reason: editData.isBanned ? editData.banReason.trim() : null }),
        });
      }
      setEditModal({ open: false, user: null });
      await fetchUsers();
    } catch (error) {
      setEditError(error instanceof ApiClientError ? translateApiError(error.code, t) : t("common.errorOccurred"));
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t("settings.confirmDeleteUser"))) return;
    try { await apiRequest(`/api/v1/identity/users/${id}`, { method: "DELETE" }); await fetchUsers(); }
    catch (error) { console.error("Error deactivating user:", error); }
  };

  const toggleStaffRole = (mode: "create" | "edit", role: StaffRole) => {
    if (mode === "create") {
      setCreateData((current) => ({ ...current, staffRoles: current.staffRoles.includes(role) ? current.staffRoles.filter((item) => item !== role) : [...current.staffRoles, role] }));
    } else {
      setEditData((current) => ({ ...current, staffRoles: current.staffRoles.includes(role) ? current.staffRoles.filter((item) => item !== role) : [...current.staffRoles, role] }));
    }
  };

  const canManageTarget = (target: ManagedUser) => {
    if (canManagePlatformStaff) return true;
    if (!target.membership || !["OWNER", "ADMIN"].includes(user.entityRole)) return false;
    const actorRank = ROLE_RANK[user.entityRole as EntityRole];
    const targetRank = ROLE_RANK[target.membership.entityRole];
    return target.membership.entityPath === user.entityPath ? targetRank < actorRank : targetRank <= actorRank;
  };

  const renderEntityOptions = () => entities
    .map((entity) => <option key={entity.id} value={entity.id}>{displayEntityName(entity)} · {entityTypeLabel(entity.entityType, t)}</option>);
  const renderStaffRoles = (mode: "create" | "edit", selected: StaffRole[]) => (
    <fieldset className="space-y-2 border-t border-[var(--border-primary)] pt-4">
      <legend className="mb-1 text-sm font-medium text-[var(--text-primary)]">{t("users.platformAccess", "Quyền vận hành nền tảng")}</legend>
      <p className="text-xs text-[var(--text-tertiary)]">{t("users.platformAccessHelp", "Tách biệt với vai trò trong tổ chức; chỉ dành cho đội ngũ BeAlpha.")}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {staffRoleCatalog.map((role) => <label key={role} className="flex min-h-10 items-center gap-2 rounded-[var(--radius-input)] border border-[var(--border-primary)] px-3 text-sm text-[var(--text-secondary)]"><input type="checkbox" checked={selected.includes(role)} onChange={() => toggleStaffRole(mode, role)} />{staffRoleLabel(role)}</label>)}
      </div>
    </fieldset>
  );

  return (
    <div className="p-4 sm:p-6">
      <header className="mb-6 flex flex-col gap-4 border-b border-[var(--border-primary)] pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div><h2 className="text-xl font-semibold text-[var(--text-primary)]">{t("heading.userManagement", "Người dùng và quyền truy cập")}</h2><p className="mt-1 max-w-2xl text-sm text-[var(--text-tertiary)]">{canManagePlatformStaff ? t("users.managementHelp", "Assign each person to an organization. Manage the organization structure separately.") : t("users.teamManagementHelp", "Invite team members from the organization page. Manage their job titles and access here.")}</p></div>
        {canManagePlatformStaff && <button type="button" onClick={() => { setCreateData(EMPTY_CREATE_FORM); setCreateError(""); setCreateModal(true); }} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-[var(--radius-input)] bg-[var(--accent)] px-4 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"><AddIcon size={18} /> {t("users.addUser", "Thêm người dùng")}</button>}
      </header>
      <div className="relative mb-5 max-w-md text-[var(--text-tertiary)]">
        <SearchIcon size={18} color="currentColor" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" />
        <input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder={t("users.searchPlaceholder")} aria-label={t("users.searchPlaceholder")} className={`${inputClass} pl-10`} />
      </div>
      {loading ? <TableSkeleton rows={5} cols={canManagePlatformStaff ? 5 : 4} /> : users.length === 0 ? (
        <div className="flex flex-col items-center border-y border-[var(--border-primary)] py-12 text-[var(--text-disabled)]"><GroupIcon size={36} color="currentColor" /><p className="mt-3 text-sm">{t("users.noUsers")}</p></div>
      ) : (
        <div className="overflow-x-auto border-y border-[var(--border-primary)]"><table className="w-full min-w-[680px] text-left text-sm"><thead className="text-[var(--text-tertiary)]"><tr><th className="px-3 py-3 font-medium">{t("dashboard.user")}</th><th className="px-3 py-3 font-medium">{t("users.organizationAccess", "Quyền trong tổ chức")}</th>{canManagePlatformStaff && <th className="px-3 py-3 font-medium">{t("users.platformAccess", "Quyền nền tảng")}</th>}<th className="px-3 py-3 font-medium">{t("common.status")}</th><th className="px-3 py-3 text-right font-medium">{t("common.actions")}</th></tr></thead><tbody>
          {users.map((target) => <tr key={target.id} className="border-t border-[var(--border-subtle)] transition-colors hover:bg-[var(--bg-surface-hover)]">
            <td className="px-3 py-3"><div className="flex items-center gap-3"><div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--accent)] font-semibold text-white">{target.avatar ? <SecureImage src={target.avatar} alt="" className="size-full object-cover" /> : (target.name || target.email).charAt(0).toUpperCase()}</div><div className="min-w-0"><p className="truncate font-medium text-[var(--text-primary)]">{target.name || target.email.split("@")[0]}</p><p className="truncate text-xs text-[var(--text-tertiary)]">{target.email}</p></div></div></td>
            <td className="px-3 py-3">{target.membership ? <div><p className="font-medium text-[var(--text-primary)]">{target.membership.entityName}</p><p className="text-xs text-[var(--text-tertiary)]">{target.membership.businessTitle ? `${target.membership.businessTitle} · ` : ""}{roleLabel(target.membership.entityRole, t)}</p></div> : <span className="text-[var(--text-disabled)]">—</span>}</td>
            {canManagePlatformStaff && <td className="px-3 py-3 text-xs text-[var(--text-secondary)]">{target.staffRoles.length ? target.staffRoles.map(staffRoleLabel).join(", ") : "—"}</td>}
            <td className="px-3 py-3"><span className={`inline-flex rounded px-2 py-1 text-xs font-medium ${target.isActive && !target.isBanned ? "bg-[var(--status-success-surface)] text-[var(--status-success)]" : "bg-[var(--status-error-surface)] text-[var(--status-error)]"}`}>{target.isBanned ? t("users.banned", "Bị khóa") : target.isActive ? t("common.active", "Hoạt động") : t("common.inactive", "Ngừng hoạt động")}</span></td>
            <td className="px-3 py-3"><div className="flex justify-end gap-1">{canManageTarget(target) && <><button type="button" onClick={() => openEditModal(target)} aria-label={t("users.editUser")} className="flex size-10 items-center justify-center rounded-[var(--radius-input)] text-[var(--text-tertiary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"><EditIcon size={18} color="currentColor" /></button><button type="button" onClick={() => void handleDelete(target.id)} aria-label={t("settings.confirmDeleteUser")} className="flex size-10 items-center justify-center rounded-[var(--radius-input)] text-[var(--status-error)] hover:bg-[var(--status-error-surface)]"><DeleteIcon size={18} color="currentColor" /></button></>}</div></td>
          </tr>)}
        </tbody></table></div>
      )}
      <Pagination page={page} totalPages={totalPages} total={total} limit={limit} onPageChange={setPage} onLimitChange={(nextLimit) => { setLimit(nextLimit); setPage(1); }} />

      <Modal isOpen={createModal} onClose={() => { setCreateModal(false); setCreateError(""); }} title={t("settings.addUser")}>
        <div className="space-y-4">
          {createError && <div role="alert" className="whitespace-pre-line rounded-[var(--radius-input)] border border-[var(--status-error)] bg-[var(--status-error-surface)] p-3 text-sm text-[var(--status-error)]">{createError}</div>}
          <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2 text-sm text-[var(--text-secondary)]">{t("common.name")} *<input autoFocus value={createData.name} onChange={(event) => setCreateData((current) => ({ ...current, name: event.target.value }))} className={inputClass} /></label><label className="space-y-2 text-sm text-[var(--text-secondary)]">{t("common.phone")}<input value={createData.phone} onChange={(event) => setCreateData((current) => ({ ...current, phone: event.target.value }))} className={inputClass} /></label></div>
          <label className="block space-y-2 text-sm text-[var(--text-secondary)]">{t("form.email", "Email")} *<input type="email" value={createData.email} onChange={(event) => setCreateData((current) => ({ ...current, email: event.target.value }))} className={inputClass} /></label>
          <label className="block space-y-2 text-sm text-[var(--text-secondary)]">{t("users.jobTitle", "Chức danh")}<input value={createData.businessTitle} maxLength={100} onChange={(event) => setCreateData((current) => ({ ...current, businessTitle: event.target.value }))} placeholder={t("users.jobTitlePlaceholder", "Ví dụ: CEO, Đồng sáng lập, Quản lý hãng đĩa")} className={inputClass} /></label>
          <label className="block space-y-2 text-sm text-[var(--text-secondary)]">{t("form.password", "Mật khẩu")} *<input type="password" value={createData.password} onChange={(event) => setCreateData((current) => ({ ...current, password: event.target.value }))} className={inputClass} /><span className="block text-xs text-[var(--text-tertiary)]">{t("users.passwordHelp", "Tối thiểu 12 ký tự, gồm chữ hoa, chữ thường, số và ký hiệu.")}</span></label>
          <fieldset className="space-y-3 border-t border-[var(--border-primary)] pt-4"><legend className="text-sm font-medium text-[var(--text-primary)]">{t("users.organizationAccess", "Quyền trong tổ chức")}</legend>
            <label className="block space-y-2 text-sm text-[var(--text-secondary)]">{t("users.assignedEntity", "Đơn vị")} *<select value={createData.entityId} onChange={(event) => setCreateEntity(event.target.value)} className={inputClass}><option value="">{t("users.selectEntity", "Chọn đơn vị hiện hữu")}</option>{renderEntityOptions()}</select></label>
            <label className="block space-y-2 text-sm text-[var(--text-secondary)]">{t("users.entityRole", "Access level")} *<select value={createData.entityRole} onChange={(event) => setCreateData((current) => ({ ...current, entityRole: event.target.value as EntityRole }))} className={inputClass}>{assignableEntityRoles.map((role) => <option key={role} value={role}>{roleLabel(role, t)}</option>)}</select></label>
          </fieldset>
          {canAssignCreateStaffRoles && renderStaffRoles("create", createData.staffRoles)}
          <div className="flex gap-3 pt-2"><button type="button" onClick={() => setCreateModal(false)} className="min-h-10 flex-1 rounded-[var(--radius-input)] border border-[var(--border-primary)] px-4 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]">{t("common.cancel")}</button><button type="button" onClick={() => void handleCreateUser()} disabled={saving} className="min-h-10 flex-1 rounded-[var(--radius-input)] bg-[var(--accent)] px-4 text-sm font-semibold text-white hover:bg-[var(--accent-hover)] disabled:opacity-50">{saving ? t("common.creating", "Đang tạo…") : t("settings.addUser", "Tạo người dùng")}</button></div>
        </div>
      </Modal>

      <Modal isOpen={editModal.open} onClose={() => { setEditModal({ open: false, user: null }); setEditError(""); }} title={t("users.editUser")}>
        <div className="space-y-4">
          {editError && <div role="alert" className="whitespace-pre-line rounded-[var(--radius-input)] border border-[var(--status-error)] bg-[var(--status-error-surface)] p-3 text-sm text-[var(--status-error)]">{editError}</div>}
          {canManagePlatformStaff ? <><div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2 text-sm text-[var(--text-secondary)]">{t("common.name")} *<input value={editData.name} onChange={(event) => setEditData((current) => ({ ...current, name: event.target.value }))} className={inputClass} /></label><label className="space-y-2 text-sm text-[var(--text-secondary)]">{t("common.phone")}<input value={editData.phone} onChange={(event) => setEditData((current) => ({ ...current, phone: event.target.value }))} className={inputClass} /></label></div><label className="block space-y-2 text-sm text-[var(--text-secondary)]">{t("form.email", "Email")} *<input type="email" value={editData.email} onChange={(event) => setEditData((current) => ({ ...current, email: event.target.value }))} className={inputClass} /></label></> : <div className="rounded-[var(--radius-input)] border border-[var(--border-primary)] p-3"><p className="font-medium text-[var(--text-primary)]">{editModal.user?.name || editModal.user?.email}</p><p className="text-sm text-[var(--text-tertiary)]">{editModal.user?.email}</p></div>}
          <label className="block space-y-2 text-sm text-[var(--text-secondary)]">{t("users.jobTitle", "Chức danh")}<input value={editData.businessTitle} maxLength={100} onChange={(event) => setEditData((current) => ({ ...current, businessTitle: event.target.value }))} placeholder={t("users.jobTitlePlaceholder", "Ví dụ: CEO, Đồng sáng lập, Quản lý hãng đĩa")} className={inputClass} /></label>
          <fieldset className="space-y-3 border-t border-[var(--border-primary)] pt-4"><legend className="text-sm font-medium text-[var(--text-primary)]">{t("users.organizationAccess", "Quyền trong tổ chức")}</legend>
            {canManagePlatformStaff ? <label className="block space-y-2 text-sm text-[var(--text-secondary)]">{t("users.assignedEntity", "Đơn vị")}<select value={editData.entityId} onChange={(event) => { const entity = entities.find((item) => item.id === event.target.value); setEditData((current) => ({ ...current, entityId: event.target.value, entityRole: current.entityRole, staffRoles: entity?.entityType === "SYSTEM_ADMIN" ? current.staffRoles : [] })); }} className={inputClass}>{renderEntityOptions()}</select></label> : <p className="text-sm text-[var(--text-secondary)]">{editModal.user?.membership?.entityName || "—"}</p>}
            <label className="block space-y-2 text-sm text-[var(--text-secondary)]">{t("users.entityRole", "Access level")}<select value={editData.entityRole} onChange={(event) => setEditData((current) => ({ ...current, entityRole: event.target.value as EntityRole }))} className={inputClass}>{assignableEntityRoles.map((role) => <option key={role} value={role}>{roleLabel(role, t)}</option>)}</select></label>
          </fieldset>
            {canAssignEditStaffRoles && renderStaffRoles("edit", editData.staffRoles)}
          <label className="block space-y-2 border-t border-[var(--border-primary)] pt-4 text-sm text-[var(--text-secondary)]">{t("form.newPasswordLeaveBlankToKeepCurrent", "Mật khẩu mới (bỏ trống để giữ nguyên)")}<input type="password" value={editData.password} onChange={(event) => setEditData((current) => ({ ...current, password: event.target.value }))} className={inputClass} /></label>
          <div className="space-y-3 border-t border-[var(--border-primary)] pt-4"><label className="flex min-h-10 items-center justify-between gap-3 text-sm text-[var(--text-primary)]"><span>{t("users.banAccount", "Khóa tài khoản")}</span><input type="checkbox" checked={editData.isBanned} onChange={(event) => setEditData((current) => ({ ...current, isBanned: event.target.checked, banReason: event.target.checked ? current.banReason : "" }))} /></label>{editData.isBanned && <label className="block space-y-2 text-sm text-[var(--text-secondary)]">{t("form.reasonForBan", "Lý do khóa")} *<textarea rows={3} value={editData.banReason} onChange={(event) => setEditData((current) => ({ ...current, banReason: event.target.value }))} className={inputClass} /></label>}</div>
          <div className="flex gap-3 pt-2"><button type="button" onClick={() => setEditModal({ open: false, user: null })} className="min-h-10 flex-1 rounded-[var(--radius-input)] border border-[var(--border-primary)] px-4 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]">{t("common.cancel")}</button><button type="button" onClick={() => void handleSave()} disabled={saving} className="min-h-10 flex-1 rounded-[var(--radius-input)] bg-[var(--accent)] px-4 text-sm font-semibold text-white hover:bg-[var(--accent-hover)] disabled:opacity-50">{saving ? t("common.saving") : t("common.save")}</button></div>
        </div>
      </Modal>
    </div>
  );
}
