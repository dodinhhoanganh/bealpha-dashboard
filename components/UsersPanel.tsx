"use client";

import { useState, useEffect, useCallback } from "react";
import { UserSession } from "@/lib/types";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { translateApiError } from "@/lib/i18n/translateApiError";
import { useToast } from "@/components/Toast";
import Pagination from "@/components/Pagination";
import { TableSkeleton } from "@/components/Skeleton";
import ImageUpload from "@/components/ImageUpload";
import Modal from "@/components/Modal";
import {
  GroupIcon,
  PersonIcon,
  AddIcon,
  SearchIcon,
  EditIcon,
  DeleteIcon,
  ArrowBackIcon,
  CloseIcon,
  CheckCircleIcon,
  CancelIcon,
  KeyboardArrowDownIcon,
  FilterListIcon,
  SettingsIcon,
} from "@/components/Icon";

// ============ USERS COMPONENT ============
export default function UsersPanel({ user }: { user: UserSession }) {
  const { t } = useI18n(); // Auto-injected

  const [users, setUsers] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(20);
  const [editModal, setEditModal] = useState<{
    open: boolean;
    user: any | null;
  }>({ open: false, user: null });
  const [createModal, setCreateModal] = useState(false);
  const [editModalTab, setEditModalTab] = useState("profile");
  const [formData, setFormData] = useState({
    name: "",
    stageName: "",
    phone: "",
    avatar: "",
    email: "",
    password: "",
    roleId: "",
    isBanned: false,
    banReason: "",
    entityRole: "MEMBER",
    entityId: "",
    entityType: "",
  });
  const [createData, setCreateData] = useState({
    email: "",
    password: "",
    phone: "",
    name: "",
    roleId: "",
    // Entity linking
    entityMode: "new" as "new" | "existing", // "new" = create new entity, "existing" = link existing
    entityName: "",     // name for new entity
    entityId: "",       // ID of existing entity to link
  });
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState("");
  const [editError, setEditError] = useState("");
  // Entity lists for linking dropdowns
  const [distributors, setDistributors] = useState<any[]>([]);
  const [labels, setLabels] = useState<any[]>([]);
  const [artists, setArtists] = useState<any[]>([]);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      params.set("page", String(page));
      params.set("limit", String(limit));
      const res = await fetch(`/api/users?${params}`);
      if (res.ok) {
        const json = await res.json();
        setUsers(json.data || json);
        setTotal(json.total || 0);
        setTotalPages(json.totalPages || 1);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [search, page, limit]);

  const fetchRoles = async () => {
    try {
      const res = await fetch("/api/roles");
      if (res.ok) setRoles(await res.json());
    } catch (e) {
      console.error(e);
    }
  };

  const fetchEntities = async () => {
    try {
      const [distRes, labelRes, artistRes] = await Promise.all([
        fetch("/api/entities?type=ORGANIZATION&limit=200"),
        fetch("/api/labels?limit=200"),
        fetch("/api/artists?limit=200"),
      ]);
      if (distRes.ok) { const d = await distRes.json(); setDistributors(d.data || d || []); }
      if (labelRes.ok) { const d = await labelRes.json(); setLabels(d.data || d || []); }
      if (artistRes.ok) { const d = await artistRes.json(); setArtists(d.data || d || []); }
    } catch (e) {
      console.error(e);
    }
  };

  // Resolve selected role name from roleId
  const selectedRoleName = roles.find((r: any) => r.id === createData.roleId)?.name || "";

  useEffect(() => {
    fetchUsers();
    fetchRoles();
    fetchEntities();
  }, [fetchUsers]);

  const openEditModal = (u: any) => {
    setFormData({
      name: u.name || "",
      stageName: u.stageName || "",
      phone: u.phone || "",
      avatar: u.avatar || "",
      email: u.email || "",
      password: "",
      roleId: u.roles?.[0]?.id || "",
      isBanned: u.isBanned || false,
      banReason: u.banReason || "",
      entityRole: u.entities?.[0]?.role || "MEMBER",
      entityId: u.entities?.[0]?.entityId || "",
      entityType: u.entities?.[0]?.entityType || "",
    });
    setEditModalTab("profile");
    setEditModal({ open: true, user: u });
  };

  const handleSave = async () => {
    if (!editModal.user) return;
    setEditError("");

    // Validate email
    if (
      !formData.email.trim() ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)
    ) {
      setEditError("• Email is required and must be valid");
      return;
    }

    // Validate phone format if provided
    if (formData.phone && !/^\+?[0-9\s-]{7,20}$/.test(formData.phone)) {
      setEditError("• Phone number format is invalid");
      return;
    }

    // Validate password complexity if changing
    if (formData.password) {
      if (formData.password.length < 8) {
        setEditError("• Password must be at least 8 characters");
        return;
      }
      if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(formData.password)) {
        setEditError(
          "• Password must contain uppercase, lowercase, and a number",
        );
        return;
      }
    }

    setSaving(true);
    try {
      const payload: any = { ...formData };
      if (!payload.password) delete payload.password; // Don't send empty password
      if (payload.roleId) {
        payload.roles = [payload.roleId];
      }

      const res = await fetch(`/api/users/${editModal.user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setEditModal({ open: false, user: null });
        fetchUsers();
      } else {
        const data = await res.json();
        setEditError(translateApiError(data.error, t));
      }
    } catch (e) {
      console.error(e);
      setEditError("An error occurred");
    } finally {
      setSaving(false);
    }
  };

  const handleCreateUser = async () => {
    setCreateError("");
    const errors: string[] = [];

    if (!createData.name.trim() || createData.name.trim().length < 2)
      errors.push("• Name is required (min 2 characters)");
    if (!createData.email.trim()) errors.push("• Email is required");
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(createData.email))
      errors.push("• Email format is invalid");
    if (!createData.password.trim()) errors.push("• Password is required");
    else if (createData.password.length < 8)
      errors.push("• Password must be at least 8 characters");
    else if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(createData.password))
      errors.push("• Password must contain uppercase, lowercase, and a number");
    if (!createData.roleId)
      errors.push("• Role is required — every user must have an assigned role");
    if (createData.phone && !/^\+?[0-9\s-]{7,20}$/.test(createData.phone))
      errors.push("• Phone number format is invalid");

    // Validate entity linking
    const needsEntity = ["distributor", "label", "artist"].includes(selectedRoleName);
    if (needsEntity && createData.entityMode === "new" && !createData.entityName.trim()) {
      errors.push(`• ${selectedRoleName.charAt(0).toUpperCase() + selectedRoleName.slice(1)} name is required`);
    }
    if (needsEntity && createData.entityMode === "existing" && !createData.entityId) {
      errors.push(`• Please select an existing ${selectedRoleName} to link`);
    }

    if (errors.length > 0) {
      setCreateError(errors.join("\n"));
      return;
    }

    setSaving(true);
    try {
      // Build entity linking payload
      const payload: any = {
        email: createData.email,
        password: createData.password,
        name: createData.name,
        phone: createData.phone || undefined,
        roles: createData.roleId ? [createData.roleId] : [],
      };

      if (needsEntity) {
        if (createData.entityMode === "existing") {
          if (selectedRoleName === "distributor") payload.distributorId = createData.entityId;
          if (selectedRoleName === "label") payload.labelId = createData.entityId;
          if (selectedRoleName === "artist") payload.artistId = createData.entityId;
        } else {
          if (selectedRoleName === "distributor") payload.distributorData = { name: createData.entityName };
          if (selectedRoleName === "label") payload.labelData = { name: createData.entityName };
          if (selectedRoleName === "artist") payload.artistData = { name: createData.entityName };
        }
      }

      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setCreateModal(false);
        setCreateData({ email: "", password: "", phone: "", name: "", roleId: "", entityMode: "new", entityName: "", entityId: "" });
        setCreateError("");
        fetchUsers();
        fetchEntities();
      } else {
        const data = await res.json();
        setCreateError(translateApiError(data.error, t));
      }
    } catch (e) {
      console.error(e);
      setCreateError("An error occurred");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t("settings.confirmDeleteUser"))) return;
    try {
      await fetch(`/api/users/${id}`, { method: "DELETE" });
      fetchUsers();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="p-6">
      <Modal
        isOpen={editModal.open}
        onClose={() => {
          setEditModal({ open: false, user: null });
          setEditError("");
        }}
        title={t("users.editUser")}
      >
        <div className="flex border-b border-[var(--border-primary)] mb-4">
          <button
            onClick={() => setEditModalTab("profile")}
            className={`pb-2 px-4 text-sm font-medium border-b-2 transition-colors ${editModalTab === "profile" ? "border-[var(--accent)] text-[var(--accent-text)]" : "border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"}`}
          >
            {t("settings.profile")}
          </button>
          <button
            onClick={() => setEditModalTab("account")}
            className={`pb-2 px-4 text-sm font-medium border-b-2 transition-colors ${editModalTab === "account" ? "border-[var(--accent)] text-[var(--accent-text)]" : "border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"}`}
          >
            Account
          </button>
          <button
            onClick={() => setEditModalTab("security")}
            className={`pb-2 px-4 text-sm font-medium border-b-2 transition-colors ${editModalTab === "security" ? "border-[var(--accent)] text-[var(--accent-text)]" : "border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"}`}
          >
            {t("settings.security")}
          </button>
        </div>

        <div className="space-y-4">
          {editError && (
            <div className="p-3 bg-[var(--status-error-surface)] border border-red-500/30 rounded-lg text-[var(--status-error)] text-sm whitespace-pre-line">
              {editError}
            </div>
          )}

          {editModalTab === "profile" && (
            <>
              <div className="flex justify-center mb-4">
                <ImageUpload
                  currentUrl={formData.avatar}
                  onUpload={(url) => setFormData({ ...formData, avatar: url })}
                  type="avatars"
                  shape="circle"
                  entityName={formData.name || "User Avatar"}
                />
              </div>
              <div>
                <label className="block text-sm text-[var(--text-tertiary)] mb-1">
                  {t("form.fullName", "Full Name")}
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
                  {t("artists.stageName")}
                </label>
                <input
                  type="text"
                  value={formData.stageName}
                  onChange={(e) =>
                    setFormData({ ...formData, stageName: e.target.value })
                  }
                  className="w-full px-3 py-2  border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
              </div>
              <div>
                <label className="block text-sm text-[var(--text-tertiary)] mb-1">
                  {t("common.phone")}
                </label>
                <input
                  type="text"
                  value={formData.phone}
                  onChange={(e) =>
                    setFormData({ ...formData, phone: e.target.value })
                  }
                  className="w-full px-3 py-2  border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
              </div>
            </>
          )}

          {editModalTab === "account" && (
            <>
              <div>
                <label className="block text-sm text-[var(--text-tertiary)] mb-1">
                  {t("login.emailMethod")}
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) =>
                    setFormData({ ...formData, email: e.target.value })
                  }
                  className="w-full px-3 py-2  border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
              </div>
              <div>
                <label className="block text-sm text-[var(--text-tertiary)] mb-1">
                  {t("common.role")}
                </label>
                <select
                  value={formData.roleId}
                  onChange={(e) =>
                    setFormData({ ...formData, roleId: e.target.value })
                  }
                  className="w-full px-3 py-2 bg-[var(--bg-elevated)] border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                >
                  <option value="">{t("dashboard.selectRole")}</option>
                  {roles.map((r: any) => (
                    <option key={r.id} value={r.id}>
                      {r.displayName || r.name}
                    </option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-sm text-[var(--text-tertiary)] mb-1">
                  {t("users.assignedEntity", "Assigned Organization")}
                </label>
                <select
                  value={formData.entityId}
                  onChange={(e) => {
                     const val = e.target.value;
                     const type = distributors.some((d: any) => d.id === val) ? "ORGANIZATION" : labels.some((l: any) => l.id === val) ? "LABEL" : artists.some((a: any) => a.id === val) ? "SUB_ACCOUNT" : "";
                     setFormData({ ...formData, entityId: val, entityType: type });
                  }}
                  className="w-full px-3 py-2 bg-[var(--bg-elevated)] border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                >
                  <option value="">{t("users.noEntity", "No Organization")}</option>
                  <optgroup label="Distributors">
                     {distributors.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </optgroup>
                  <optgroup label="Labels">
                     {labels.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </optgroup>
                  <optgroup label="Artists (Sub-Accounts)">
                     {artists.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </optgroup>
                </select>
              </div>

              {formData.entityId && (
                <div>
                  <label className="block text-sm text-[var(--text-tertiary)] mb-1">
                    {t("users.entityRole", "Organization Role")}
                  </label>
                  <select
                    value={formData.entityRole}
                    onChange={(e) => setFormData({ ...formData, entityRole: e.target.value })}
                    className="w-full px-3 py-2 bg-[var(--bg-elevated)] border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  >
                    <option value="MEMBER">Member</option>
                    <option value="ADMIN">Admin</option>
                    <option value="OWNER">Owner</option>
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm text-[var(--text-tertiary)] mb-1">
                  {t("form.newPasswordLeaveBlankToKeepCurrent", "New Password (leave blank to keep current)")}
                </label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) =>
                    setFormData({ ...formData, password: e.target.value })
                  }
                  className="w-full px-3 py-2  border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  placeholder={t("form.placeholder.min8CharsUpperLowerNumber", "Min 8 chars, upper + lower + number")}
                />
              </div>
            </>
          )}

          {editModalTab === "security" && (
            <div className="space-y-4">
              <div
                className={`flex flex-col gap-3 p-4 border rounded-lg ${formData.isBanned ? "bg-[var(--status-error-surface)] border-red-500/30" : "bg-[var(--bg-elevated)] border-[var(--border-primary)]"}`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h4
                      className={`text-sm font-medium ${formData.isBanned ? "text-[var(--status-error)]" : "text-[var(--text-primary)]"}`}
                    >
                      {formData.isBanned ? "Account is Banned" : "Ban Account"}
                    </h4>
                    <p className="text-xs text-[var(--text-tertiary)] mt-1 max-w-[280px]">
                      {formData.isBanned
                        ? "This user cannot log in or access the system."
                        : "Prevent this user from logging in and accessing the system."}
                    </p>
                  </div>
                  <button
                    onClick={() =>
                      setFormData({
                        ...formData,
                        isBanned: !formData.isBanned,
                        banReason: formData.isBanned ? "" : formData.banReason,
                      })
                    }
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${formData.isBanned ? "bg-[var(--bg-elevated)] border border-[var(--border-primary)] text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]" : "bg-[var(--status-error)] text-white hover:bg-red-600"}`}
                  >
                    {formData.isBanned ? "Revoke Ban (Unban)" : "Ban User"}
                  </button>
                </div>

                {formData.isBanned && (
                  <div className="pt-3 border-t border-red-500/20 mt-1">
                    <label className="block text-sm text-[var(--status-error)] mb-1">
                      {t("form.reasonForBan", "Reason for Ban *")}
                    </label>
                    <textarea
                      value={formData.banReason}
                      onChange={(e) =>
                        setFormData({ ...formData, banReason: e.target.value })
                      }
                      rows={3}
                      className="w-full px-3 py-2 bg-transparent border border-red-500/30 rounded-lg text-red-200 placeholder-red-500/50 focus:outline-none focus:ring-2 focus:ring-red-500/50"
                      placeholder={t("form.placeholder.specifyWhyThisAccountWasBannedTheUserWillSeeThisMessage", "Specify why this account was banned. The user will see this message.")}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <button
              onClick={() => setEditModal({ open: false, user: null })}
              className="flex-1 px-4 py-2 hover:bg-[var(--bg-surface-hover)] rounded-lg text-sm font-medium transition-colors border border-[var(--border-primary)] text-[var(--text-primary)]"
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

      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-medium">{t("heading.userManagement", "User Management")}</h2>
        <button
          onClick={() => {
            setCreateData({ email: "", password: "", phone: "", name: "", roleId: "", entityMode: "new", entityName: "", entityId: "" });
            setCreateModal(true);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg text-sm font-medium transition-colors text-white"
        >
          <AddIcon size={18} />
          Add User
        </button>
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
          placeholder={t("users.searchPlaceholder")}
          className="w-full pl-10 pr-4 py-2 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-disabled)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
      </div>

      <Modal
        isOpen={createModal}
        onClose={() => {
          setCreateModal(false);
          setCreateError("");
        }}
        title={t("settings.addUser")}
      >
        <div className="space-y-4">
          {createError && (
            <div className="p-3 bg-[var(--status-error-surface)] border border-red-500/30 rounded-lg text-[var(--status-error)] text-sm whitespace-pre-line">
              {createError}
            </div>
          )}
          <div>
            <label className="block text-sm text-[var(--text-tertiary)] mb-1">{t("common.name")} *</label>
            <input type="text" value={createData.name} onChange={(e) => setCreateData({ ...createData, name: e.target.value })} className="w-full px-3 py-2 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" placeholder={t("form.placeholder.fullName", "Full name")} />
          </div>
          <div>
            <label className="block text-sm text-[var(--text-tertiary)] mb-1">{t("form.email", "Email *")}</label>
            <input type="email" value={createData.email} onChange={(e) => setCreateData({ ...createData, email: e.target.value })} className="w-full px-3 py-2 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" placeholder={t("form.placeholder.userExampleCom", "user@example.com")} />
          </div>
          <div>
            <label className="block text-sm text-[var(--text-tertiary)] mb-1">{t("form.password", "Password *")}</label>
            <input type="password" value={createData.password} onChange={(e) => setCreateData({ ...createData, password: e.target.value })} className="w-full px-3 py-2 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" placeholder={t("form.placeholder.min8CharsUpperLowerNumber", "Min 8 chars, upper + lower + number")} />
          </div>
          <div>
            <label className="block text-sm text-[var(--text-tertiary)] mb-1">{t("common.phone")}</label>
            <input type="text" value={createData.phone} onChange={(e) => setCreateData({ ...createData, phone: e.target.value })} className="w-full px-3 py-2 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" placeholder={t("form.placeholder.optional", "Optional")} />
          </div>
          <div>
            <label className="block text-sm text-[var(--text-tertiary)] mb-1">{t("form.role", "Role *")}</label>
            <select value={createData.roleId} onChange={(e) => setCreateData({ ...createData, roleId: e.target.value, entityMode: "new", entityName: "", entityId: "" })} className="w-full px-3 py-2 bg-[var(--bg-elevated)] border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]">
              <option value="">{t("dashboard.selectRole")}</option>
              {roles.map((r: any) => (
                <option key={r.id} value={r.id}>{r.displayName || r.name}</option>
              ))}
            </select>
          </div>
          {/* Entity Linking — shown for distributor/label/artist roles */}
          {["distributor", "label", "artist"].includes(selectedRoleName) && (
            <div className="p-4 border border-[var(--border-primary)] rounded-lg bg-[var(--bg-elevated)] space-y-3">
              <p className="text-sm font-medium text-[var(--text-primary)]">
                {t("users.linkEntity", "Link")} {selectedRoleName.charAt(0).toUpperCase() + selectedRoleName.slice(1)}
              </p>
              <div className="flex gap-2">
                <button onClick={() => setCreateData({ ...createData, entityMode: "existing", entityName: "" })} className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${createData.entityMode === "existing" ? "bg-[var(--accent)] text-white border-[var(--accent)]" : "bg-transparent text-[var(--text-secondary)] border-[var(--border-primary)] hover:bg-[var(--bg-surface-hover)]"}`}>
                  {t("users.linkExisting", "Link existing")}
                </button>
                <button onClick={() => setCreateData({ ...createData, entityMode: "new", entityId: "" })} className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${createData.entityMode === "new" ? "bg-[var(--accent)] text-white border-[var(--accent)]" : "bg-transparent text-[var(--text-secondary)] border-[var(--border-primary)] hover:bg-[var(--bg-surface-hover)]"}`}>
                  {t("users.createNew", "Create new")}
                </button>
              </div>
              {createData.entityMode === "existing" ? (
                <select value={createData.entityId} onChange={(e) => setCreateData({ ...createData, entityId: e.target.value })} className="w-full px-3 py-2 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]">
                  <option value="">{t("users.selectExisting", "Select existing")} {selectedRoleName}...</option>
                  {(selectedRoleName === "distributor" ? distributors : selectedRoleName === "label" ? labels : artists).map((ent: any) => (
                    <option key={ent.id} value={ent.id}>{ent.name}</option>
                  ))}
                </select>
              ) : (
                <input type="text" value={createData.entityName} onChange={(e) => setCreateData({ ...createData, entityName: e.target.value })} className="w-full px-3 py-2 border border-[var(--border-input)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" placeholder={`${selectedRoleName.charAt(0).toUpperCase() + selectedRoleName.slice(1)} name`} />
              )}
            </div>
          )}
          <div className="flex gap-3 pt-4">
            <button onClick={() => { setCreateModal(false); setCreateError(""); }} className="flex-1 px-4 py-2 hover:bg-[var(--bg-surface-hover)] rounded-lg text-sm font-medium transition-colors border border-[var(--border-primary)] text-[var(--text-primary)]">{t("common.cancel")}</button>
            <button onClick={handleCreateUser} disabled={saving} className="flex-1 px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg text-sm font-medium transition-colors disabled:opacity-50 text-white">{saving ? "Creating..." : t("settings.addUser", "Create User")}</button>
          </div>
        </div>
      </Modal>

      {loading ? (
        <TableSkeleton rows={5} cols={4} />
      ) : users.length === 0 ? (
        <div className="text-center py-12 text-[var(--text-disabled)]">
          <GroupIcon size={48} color="#525252" />
          <p className="mt-2">{t("users.noUsers")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[var(--text-tertiary)] text-sm border-b border-[var(--border-primary)]">
                <th className="pb-3 font-medium">{t("dashboard.user")}</th>
                <th className="pb-3 font-medium">{t("common.role")}</th>
                <th className="pb-3 font-medium">{t("users.linkedEntity", "Entity")}</th>
                <th className="pb-3 font-medium">{t("users.hierarchy", "Hierarchy")}</th>
                <th className="pb-3 font-medium">{t("common.status")}</th>
                <th className="pb-3 font-medium">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={u.id}
                  className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)]"
                >
                  <td className="py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-[var(--accent)] rounded-full flex items-center justify-center text-white font-medium overflow-hidden">
                        {u.avatar ? (
                          <img
                            src={u.avatar}
                            alt={u.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          u.name?.charAt(0) || u.email.charAt(0).toUpperCase()
                        )}
                      </div>
                      <div>
                        <p className="font-medium">
                          {u.name || u.email.split("@")[0]}
                        </p>
                        <p className="text-sm text-[var(--text-disabled)]">
                          {u.email}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="py-4">
                    <span className="px-2 py-1 bg-[var(--status-success-surface)] text-[var(--accent-text)] rounded text-sm">
                      {u.roles?.[0]?.name || u.roles?.[0] || "user"}
                    </span>
                  </td>
                  <td className="py-4">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-[var(--text-primary)]">
                        {u.entities?.[0]?.entityName || "—"}
                      </span>
                      {u.entities?.[0] && (
                        <span className="text-xs text-[var(--text-tertiary)]">
                          {u.entities[0].entityType === "SUB_ACCOUNT" ? "Artist" : 
                           u.entities[0].entityType === "LABEL" ? "Label" : "Distributor"}
                          {" • "} 
                          <span className={u.entities[0].role === "OWNER" || u.entities[0].role === "ADMIN" ? "text-[var(--accent-text)]" : ""}>
                            {u.entities[0].role}
                          </span>
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-4">
                    <div className="flex flex-col gap-1">
                      {u.parent && (
                        <span className="text-xs text-[var(--text-disabled)]">
                          ↑ {u.parent.name || u.parent.email}
                        </span>
                      )}
                      {(u.childCount > 0) && (
                        <span className="inline-flex items-center gap-1 text-xs text-[var(--accent-text)]">
                          ↓ {u.childCount} {t("users.children", "sub-accounts")}
                        </span>
                      )}
                      {!u.parent && !u.childCount && <span className="text-xs text-[var(--text-disabled)]">—</span>}
                    </div>
                  </td>
                  <td className="py-4">
                    <span
                      className={`px-2 py-1 rounded text-sm ${u.isActive ? "bg-[var(--status-success-surface)] text-[var(--accent-text)]" : "bg-[var(--status-error-surface)] text-[var(--status-error)]"}`}
                    >
                      {u.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="py-4">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openEditModal(u)}
                        className="p-2 hover: rounded-lg"
                      >
                        <EditIcon size={18} color="#a3a3a3" />
                      </button>
                      <button
                        onClick={() => handleDelete(u.id)}
                        className="p-2 hover:bg-[var(--status-error-surface)] rounded-lg"
                      >
                        <DeleteIcon size={18} color="#ef4444" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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

// ============ AUDIT LOG PANEL ============
