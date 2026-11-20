"use client";

import { useCallback, useEffect, useState } from "react";
import { UserSession } from "@/lib/types";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { translateApiError } from "@/lib/i18n/translateApiError";
import ImageUpload from "@/components/ui/ImageUpload";
import SecureImage from "@/components/ui/SecureImage";
import Pagination from "@/components/ui/Pagination";
import { CardSkeleton } from "@/components/ui/Skeleton";
import Modal from "@/components/ui/Modal";
import { AddIcon, BusinessIcon, DeleteIcon, EditIcon, SearchIcon } from "@/components/ui/Icon";
import { ApiClientError, apiRequest } from "@/lib/api-client";
import { canManageCatalogRecord } from "@/lib/ui-capabilities";

export type LabelSummary = {
  id: string;
  name: string;
  description?: string | null;
  logoUrl?: string | null;
  dpid?: string | null;
  ddexPartyName?: string | null;
  artistCount?: number;
  releaseCount?: number;
};

export function totalLabelReleaseCount(labels: readonly LabelSummary[]): number {
  return labels.reduce((sum, label) => sum + (label.releaseCount ?? 0), 0);
}

type FormData = {
  name: string;
  description: string;
  logoUrl: string;
  dpid: string;
  ddexPartyName: string;
};

const emptyFormData: FormData = {
  name: "",
  description: "",
  logoUrl: "",
  dpid: "",
  ddexPartyName: "",
};

export default function LabelsPanel({ user }: { user: UserSession }) {
  const { t } = useI18n();
  const [labels, setLabels] = useState<LabelSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [catalogReleaseTotal, setCatalogReleaseTotal] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [limit, setLimit] = useState(20);
  const [editModal, setEditModal] = useState<{ open: boolean; label: LabelSummary | null }>({ open: false, label: null });
  const [createModal, setCreateModal] = useState(false);
  const [formData, setFormData] = useState<FormData>(emptyFormData);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const canCreate = canManageCatalogRecord(user, "label", "create");
  const canUpdate = canManageCatalogRecord(user, "label", "update");
  const canDelete = canManageCatalogRecord(user, "label", "delete");

  const openLabelCreate = () => {
    setFormData(emptyFormData);
    setFormError("");
    setCreateModal(true);
  };

  const fetchLabels = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const rows = await apiRequest<LabelSummary[]>("/api/v1/catalog/labels");
      const query = search.trim().toLowerCase();
      const filtered = query ? rows.filter((label) => label.name.toLowerCase().includes(query)) : rows;
      setLabels(filtered.slice((page - 1) * limit, page * limit));
      setTotal(filtered.length);
      setCatalogReleaseTotal(totalLabelReleaseCount(filtered));
      setTotalPages(Math.max(1, Math.ceil(filtered.length / limit)));
    } catch (e) {
      console.error(e);
      setLabels([]);
      setTotal(0);
      setCatalogReleaseTotal(0);
      setTotalPages(1);
      setLoadError(e instanceof ApiClientError ? translateApiError(e.code, t) : t("common.errorOccurred"));
    } finally {
      setLoading(false);
    }
  }, [search, page, limit, t]);

  useEffect(() => { fetchLabels(); }, [fetchLabels]);

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

  const openEditModal = (label: LabelSummary) => {
    setFormData({
      name: label.name || "",
      description: label.description || "",
      logoUrl: label.logoUrl || "",
      dpid: label.dpid || "",
      ddexPartyName: label.ddexPartyName || "",
    });
    setFormError("");
    setEditModal({ open: true, label });
  };

  const validateForm = (): string[] => {
    const errors: string[] = [];
    if (!formData.name.trim()) errors.push(`• ${t("common.labelNameRequired")}`);
    if (formData.name.trim().length > 0 && formData.name.trim().length < 2) errors.push(`• ${t("common.labelNameMin2")}`);
    return errors;
  };

  const handleSave = async () => {
    if (!editModal.label) return;
    const errors = validateForm();
    if (errors.length) return setFormError(errors.join("\n"));
    setSaving(true);
    setFormError("");
    try {
      await apiRequest(`/api/v1/catalog/labels/${editModal.label.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          description: formData.description || null,
          logoUrl: formData.logoUrl || null,
          dpid: formData.dpid || null,
          ddexPartyName: formData.ddexPartyName || null,
        }),
      });
      setEditModal({ open: false, label: null });
      fetchLabels();
    } catch (e) {
      console.error(e);
      setFormError(e instanceof ApiClientError ? translateApiError(e.code, t) : t("common.errorOccurred"));
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async () => {
    const errors = validateForm();
    if (errors.length) return setFormError(errors.join("\n"));
    setSaving(true);
    setFormError("");
    try {
      await apiRequest("/api/v1/catalog/labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name.trim(),
          ...(formData.description.trim() ? { description: formData.description.trim() } : {}),
          ...(formData.logoUrl ? { logoUrl: formData.logoUrl } : {}),
          ...(formData.dpid ? { dpid: formData.dpid } : {}),
          ...(formData.ddexPartyName ? { ddexPartyName: formData.ddexPartyName } : {}),
        }),
      });
      setCreateModal(false);
      setFormData(emptyFormData);
      fetchLabels();
    } catch (e) {
      console.error(e);
      setFormError(e instanceof ApiClientError ? translateApiError(e.code, t) : t("common.errorOccurred"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const label = labels.find((l) => l.id === id);
    if (!confirm(`${t("common.confirmDeleteLabel")} "${label?.name || ""}"\n\n${t("common.deleteWillRemove")}\n${t("artist.deleteWarning")}\n\n${t("common.cannotBeUndone")}`)) return;
    try {
      await apiRequest(`/api/v1/catalog/labels/${id}`, { method: "DELETE" });
      fetchLabels();
    } catch (e) {
      console.error(e);
    }
  };

  const renderLabelFields = (showLogo: boolean) => (
    <>
      {showLogo && (
        <div className="flex justify-center">
          <ImageUpload currentUrl={formData.logoUrl} onUpload={(url) => setFormData({ ...formData, logoUrl: url })} type="labels" entityName={formData.name || t("common.draftLabel", "Draft Label")} labelName={formData.name || t("common.draftLabel", "Draft Label")} />
        </div>
      )}
      <div>
        <label className="mb-1 block text-sm text-[var(--text-tertiary)]">{t("ui.labelsPanel.ddexPartyName", "DDEX Party Name")} <span className="text-xs text-[var(--text-disabled)]">({t("common.fallbackIfEmpty")})</span></label>
        <input type="text" value={formData.ddexPartyName} onChange={(e) => setFormData({ ...formData, ddexPartyName: e.target.value })} className="w-full rounded-lg border border-[var(--border-input)] px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" placeholder={t("form.placeholder.eGBeAlpha", "e.g. beAlpha")} />
      </div>
      <div>
        <label className="mb-1 block text-sm text-[var(--text-tertiary)]">{t("ui.labelsPanel.ddexPartyIdentifierDPID", "DDEX Party Identifier (DPID)")} <span className="text-xs text-[var(--text-disabled)]">({t("common.fallbackIfEmpty")})</span></label>
        <input type="text" value={formData.dpid} onChange={(e) => setFormData({ ...formData, dpid: e.target.value })} className="w-full rounded-lg border border-[var(--border-input)] px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" placeholder={t("form.placeholder.eGPADPX", "e.g. PADPX...")} />
      </div>
    </>
  );

  return (
    <div className="p-6">
      <Modal isOpen={editModal.open} onClose={() => setEditModal({ open: false, label: null })} title={t("labels.editLabel")}>
        <div className="space-y-4">
          {formError && <div className="rounded-lg border border-red-500/30 bg-[var(--status-error-surface)] p-3 text-sm text-[var(--status-error)] whitespace-pre-line">{formError}</div>}
          <div>
            <label className="mb-1 block text-sm text-[var(--text-tertiary)]">{t("labels.labelName")}</label>
            <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="w-full rounded-lg border border-[var(--border-input)] px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-[var(--text-tertiary)]">{t("form.description", "Description")}</label>
            <textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} rows={3} className="w-full resize-none rounded-lg border border-[var(--border-input)] px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" />
          </div>
          {renderLabelFields(true)}
          <div className="flex gap-3 pt-2">
            <button onClick={() => setEditModal({ open: false, label: null })} className="flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--bg-elevated)]">{t("common.cancel")}</button>
            <button onClick={handleSave} disabled={saving} className="flex-1 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-all hover:bg-[var(--accent-hover)] disabled:opacity-50 active:scale-[0.98]">{saving ? t("common.saving") : t("common.save")}</button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={createModal} onClose={() => setCreateModal(false)} title={t("common.addLabel")}>
        <div className="space-y-4">
          {formError && <div className="rounded-lg border border-red-500/30 bg-[var(--status-error-surface)] p-3 text-sm text-[var(--status-error)] whitespace-pre-line">{formError}</div>}
          <div>
            <label className="mb-1 block text-sm text-[var(--text-tertiary)]">{t("form.labelName", "Label Name *")}</label>
            <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="w-full rounded-lg border border-[var(--border-input)] px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" placeholder={t("form.placeholder.enterLabelName", "Enter label name")} />
          </div>
          <div>
            <label className="mb-1 block text-sm text-[var(--text-tertiary)]">{t("form.description", "Description")}</label>
            <textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} rows={3} className="w-full resize-none rounded-lg border border-[var(--border-input)] px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" placeholder={t("form.placeholder.labelDescription", "Label description")} />
          </div>
          {renderLabelFields(true)}
          <div className="flex gap-3 pt-2">
            <button onClick={() => setCreateModal(false)} className="flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--bg-elevated)]">{t("common.cancel")}</button>
            <button onClick={handleCreate} disabled={saving} className="flex-1 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-all hover:bg-[var(--accent-hover)] disabled:opacity-50 active:scale-[0.98]">{saving ? t("common.creating") : t("common.create")}</button>
          </div>
        </div>
      </Modal>

      <div className="mb-6 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] p-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--text-disabled)]">{t("labels.catalogLabels", "Catalog labels")}</p>
            <h2 className="mt-2 text-2xl font-semibold text-[var(--text-primary)]">{t("labels.title", "Labels")}</h2>
            <p className="mt-1 max-w-2xl text-sm text-[var(--text-tertiary)]">{t("labels.catalogDescription", "Manage the label metadata used by catalog releases.")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canCreate && <button onClick={openLabelCreate} className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-all hover:bg-[var(--accent-hover)] active:scale-[0.98]"><AddIcon size={18} />{t("common.addLabel")}</button>}
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          {[
            { label: t("labels.catalogLabels", "Catalog labels"), value: total },
            { label: t("nav.releases", "Releases"), value: catalogReleaseTotal },
          ].map((metric) => <div key={metric.label} className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2"><p className="text-[11px] text-[var(--text-disabled)]">{metric.label}</p><p className="mt-1 text-lg font-semibold tabular-nums text-[var(--text-primary)]">{metric.value}</p></div>)}
        </div>
      </div>

      <div className="relative mb-6 max-w-md"><SearchIcon size={20} color="#6b7280" className="absolute left-3 top-1/2 -translate-y-1/2" /><input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder={t("labels.searchPlaceholder")} className="w-full rounded-lg border border-[var(--border-input)] py-2 pl-10 pr-4 text-[var(--text-primary)] placeholder-[var(--text-disabled)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" /></div>

      {loading ? <CardSkeleton count={6} /> : loadError ? <div role="alert" className="rounded-lg border border-[var(--status-error)] bg-[var(--status-error-surface)] px-6 py-12 text-center"><p className="text-sm font-medium text-[var(--status-error)]">{loadError}</p><button type="button" onClick={() => void fetchLabels()} className="mt-4 rounded-lg border border-[var(--border-primary)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]">{t("common.retry", "Retry")}</button></div> : labels.length === 0 ? <div className="rounded-lg border border-dashed border-[var(--border-primary)] bg-[var(--bg-surface)] px-6 py-12 text-center text-[var(--text-disabled)]"><BusinessIcon size={40} color="#525252" /><p className="mt-3 text-sm font-medium text-[var(--text-secondary)]">{t("labels.noLabels")}</p>{canCreate && <button onClick={openLabelCreate} className="mt-4 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-all hover:bg-[var(--accent-hover)] active:scale-[0.98]">{t("common.addLabel")}</button>}</div> : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {labels.map((label) => <div key={label.id} className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] p-4 transition-colors hover:bg-[var(--bg-elevated)]"><div className="mb-3 flex items-start justify-between"><div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg bg-[var(--status-success-surface)]">{label.logoUrl ? <SecureImage src={label.logoUrl} alt="" className="h-full w-full object-cover" /> : <BusinessIcon size={20} color="#22c55e" />}</div><div className="flex items-center gap-1">{canUpdate && <button onClick={() => openEditModal(label)} title={t("labels.editLabel")} className="rounded p-1.5 hover:bg-[var(--bg-surface)]"><EditIcon size={16} color="#a3a3a3" /></button>}{canDelete && <button onClick={() => handleDelete(label.id)} title={t("common.deleteLabel")} className="rounded p-1.5 hover:bg-[var(--status-error-surface)]"><DeleteIcon size={16} color="#ef4444" /></button>}</div></div><h3 className="font-medium text-[var(--text-primary)]">{label.name}</h3><p className="mt-1 text-sm text-[var(--text-disabled)]">{label.artistCount || 0} {t("nav.artists", "artists")} / {label.releaseCount || 0} {t("nav.releases", "releases")}</p></div>)}
        </div>
      )}
      <Pagination page={page} totalPages={totalPages} total={total} limit={limit} onPageChange={setPage} onLimitChange={(nextLimit) => { setLimit(nextLimit); setPage(1); }} />
    </div>
  );
}
