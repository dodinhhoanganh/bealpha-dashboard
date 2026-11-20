"use client";

import { useEffect, useState } from "react";
import ImageUpload from "@/components/ui/ImageUpload";
import { apiRequest } from "@/lib/api-client";
import { TENANT_BRAND_UPDATED_EVENT, type TenantBrand } from "@/lib/tenant-brand";
import type { SettingsMessage } from "./types";
import { useI18n } from "@/lib/i18n/I18nProvider";

const UUID_AT_END = /([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:$|[/?#])/i;

export default function BrandTab({ onMessage }: { onMessage: (message: SettingsMessage | null) => void }) {
  const { t } = useI18n();
  const [brand, setBrand] = useState<TenantBrand | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiRequest<TenantBrand>("/api/v1/catalog/tenant-brand")
      .then(setBrand)
      .catch(() => onMessage({ type: "error", text: t("ui.brandTab.loadFailed", "Unable to load organization branding") }));
  }, [onMessage, t]);

  if (!brand) return <p className="text-sm text-[var(--text-tertiary)]">{t("ui.brandTab.loadingBrandSettings", "Loading brand settings…")}</p>;

  const update = <K extends keyof TenantBrand>(key: K, value: TenantBrand[K]) => setBrand(current => current ? { ...current, [key]: value } : current);
  const save = async () => {
    setSaving(true);
    onMessage(null);
    try {
      const updated = await apiRequest<TenantBrand>("/api/v1/catalog/tenant-brand", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: brand.displayName,
          logoAssetId: brand.logoAssetId,
          accentColor: brand.accentColor,
          accentTextColor: brand.accentTextColor,
          supportEmail: brand.supportEmail || null,
          supportUrl: brand.supportUrl || null,
          defaultLocale: brand.defaultLocale,
          expectedVersion: brand.version,
        }),
      });
      setBrand(updated);
      window.dispatchEvent(new Event(TENANT_BRAND_UPDATED_EVENT));
      onMessage({ type: "success", text: t("ui.brandTab.saved", "Organization branding saved") });
    } catch {
      onMessage({ type: "error", text: t("ui.brandTab.saveFailed", "Branding could not be saved. Check color contrast and logo ownership.") });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="brand-settings-title" className="max-w-2xl space-y-6">
      <div>
        <h2 id="brand-settings-title" className="text-xl font-semibold">{t("ui.brandTab.organizationBrand", "Organization brand")}</h2>
        <p className="mt-1 text-sm text-[var(--text-tertiary)]">{t("ui.brandTab.inheritedByEverySubAccountDeliveryIdentities", "Used by every client account. Distribution settings and partner access are unchanged.")}</p>
      </div>

      <ImageUpload
        currentUrl={brand.logoUrl ?? undefined}
        type="labels"
        entityName={brand.displayName}
        onUpload={(url) => {
          const assetId = UUID_AT_END.exec(url)?.[1] ?? null;
          if (assetId) setBrand(current => current ? { ...current, logoAssetId: assetId, logoUrl: url } : current);
        }}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="sm:col-span-2 text-sm font-medium">{t("ui.brandTab.displayName", "Display name")}
          <input className="mt-1 w-full rounded-lg border border-[var(--border-input)] bg-transparent px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" value={brand.displayName} maxLength={80} onChange={event => update("displayName", event.target.value)} />
        </label>
        <label className="text-sm font-medium">{t("ui.brandTab.accent", "Accent")}
          <input className="mt-1 h-10 w-full rounded-lg border border-[var(--border-input)] bg-transparent p-1" type="color" value={brand.accentColor} onChange={event => update("accentColor", event.target.value.toUpperCase())} />
        </label>
        <label className="text-sm font-medium">{t("ui.brandTab.textOnAccent", "Text on accent")}
          <input className="mt-1 h-10 w-full rounded-lg border border-[var(--border-input)] bg-transparent p-1" type="color" value={brand.accentTextColor} onChange={event => update("accentTextColor", event.target.value.toUpperCase())} />
        </label>
        <label className="text-sm font-medium">{t("ui.brandTab.supportEmail", "Support email")}
          <input className="mt-1 w-full rounded-lg border border-[var(--border-input)] bg-transparent px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" type="email" value={brand.supportEmail ?? ""} onChange={event => update("supportEmail", event.target.value || null)} />
        </label>
        <label className="text-sm font-medium">{t("ui.brandTab.supportURLHTTPS", "Support URL (HTTPS)")}
          <input className="mt-1 w-full rounded-lg border border-[var(--border-input)] bg-transparent px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" type="url" value={brand.supportUrl ?? ""} onChange={event => update("supportUrl", event.target.value || null)} />
        </label>
      </div>

      <button type="button" disabled={saving || brand.displayName.trim().length < 2} onClick={save} className="rounded-lg bg-[var(--accent)] px-4 py-2 font-medium text-[var(--accent-contrast)] disabled:cursor-not-allowed disabled:opacity-50">
        {saving ? t("common.saving", "Saving…") : t("ui.brandTab.save", "Save brand")}
      </button>
    </section>
  );
}
