"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { translateApiError } from "@/lib/i18n/translateApiError";
import { LOCALES } from "@/lib/i18n";
import { SaveIcon, KeyboardArrowDownIcon } from "@/components/ui/Icon";
import type { SettingsMessage } from "./types";
import { ApiClientError, apiRequest } from "@/lib/api-client";

interface LanguageTabProps {
  initialPrefs: {
    language: string;
    timezone: string;
    currency: string;
  };
  onMessage: (msg: SettingsMessage | null) => void;
}

export default function LanguageTab({ initialPrefs, onMessage }: LanguageTabProps) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [langPrefs, setLangPrefs] = useState(() => ({
    ...initialPrefs,
    // Keep legacy/unsupported profile values from leaving the select with no
    // matching option. The provider applies the same fallback at runtime.
    language: LOCALES.some((locale) => locale.code === initialPrefs.language)
      ? initialPrefs.language
      : "en",
  }));

  const handleSaveLangPrefs = async () => {
    setSaving(true);
    onMessage(null);
    try {
      await apiRequest("/api/v1/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(langPrefs),
      });
      if (typeof window !== "undefined") {
        localStorage.setItem("bealpha_locale", langPrefs.language);
        localStorage.setItem("bealpha_currency", langPrefs.currency);
      }
      onMessage({ type: "success", text: t("settings.prefsSaved") });
      setTimeout(() => { window.location.reload(); }, 800);
    } catch (error: unknown) {
      onMessage({ type: "error", text: error instanceof ApiClientError ? translateApiError(error.code, t) : error instanceof Error ? error.message : t("common.errorOccurred") });
    } finally {
      setSaving(false);
    }
  };

  const timezones = [
    { value: "Pacific/Honolulu", label: "Pacific/Honolulu (GMT-10)" },
    { value: "America/Anchorage", label: "America/Anchorage (GMT-9)" },
    { value: "America/Los_Angeles", label: "America/Los Angeles (GMT-8)" },
    { value: "America/Denver", label: "America/Denver (GMT-7)" },
    { value: "America/Chicago", label: "America/Chicago (GMT-6)" },
    { value: "America/New_York", label: "America/New York (GMT-5)" },
    { value: "America/Sao_Paulo", label: "America/São Paulo (GMT-3)" },
    { value: "Europe/London", label: "Europe/London (GMT+0)" },
    { value: "Europe/Paris", label: "Europe/Paris (GMT+1)" },
    { value: "Europe/Berlin", label: "Europe/Berlin (GMT+1)" },
    { value: "Europe/Moscow", label: "Europe/Moscow (GMT+3)" },
    { value: "Asia/Dubai", label: "Asia/Dubai (GMT+4)" },
    { value: "Asia/Kolkata", label: "Asia/Kolkata (GMT+5:30)" },
    { value: "Asia/Bangkok", label: "Asia/Bangkok (GMT+7)" },
    { value: "Asia/Ho_Chi_Minh", label: "Asia/Ho Chi Minh (GMT+7)" },
    { value: "Asia/Jakarta", label: "Asia/Jakarta (GMT+7)" },
    { value: "Asia/Singapore", label: "Asia/Singapore (GMT+8)" },
    { value: "Asia/Shanghai", label: "Asia/Shanghai (GMT+8)" },
    { value: "Asia/Tokyo", label: "Asia/Tokyo (GMT+9)" },
    { value: "Asia/Seoul", label: "Asia/Seoul (GMT+9)" },
    { value: "Australia/Sydney", label: "Australia/Sydney (GMT+11)" },
    { value: "Pacific/Auckland", label: "Pacific/Auckland (GMT+12)" },
  ];

  const currencies = [
    { value: "USD", label: "USD ($)" }, { value: "VND", label: "VND (₫)" }, { value: "EUR", label: "EUR (€)" },
    { value: "GBP", label: "GBP (£)" }, { value: "JPY", label: "JPY (¥)" }, { value: "KRW", label: "KRW (₩)" },
    { value: "CNY", label: "CNY (¥)" }, { value: "THB", label: "THB (฿)" }, { value: "AUD", label: "AUD (A$)" },
    { value: "CAD", label: "CAD (C$)" }, { value: "SGD", label: "SGD (S$)" }, { value: "BRL", label: "BRL (R$)" },
  ];

  const selects = [
    {
      label: t("settings.displayLanguage"),
      value: langPrefs.language,
      onChange: (v: string) => setLangPrefs((p) => ({ ...p, language: v })),
      options: LOCALES.map((loc) => ({ value: loc.code, label: loc.nativeName })),
    },
    {
      label: t("settings.timezone"),
      value: langPrefs.timezone,
      onChange: (v: string) => setLangPrefs((p) => ({ ...p, timezone: v })),
      options: timezones,
    },
    {
      label: t("settings.currencyDisplay"),
      value: langPrefs.currency,
      onChange: (v: string) => setLangPrefs((p) => ({ ...p, currency: v })),
      options: currencies,
    },
  ];

  return (
    <div>
      <h2 className="text-lg font-semibold uppercase tracking-wider mb-6 pb-2 border-b border-[var(--border-input)]" style={{ color: "var(--text-tertiary)" }}>
        {t("settings.languageRegion")}
      </h2>

      <div className="space-y-4">
        {selects.map((sel) => (
          <div key={sel.label}>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">{sel.label}</label>
            <div className="relative">
              <select
                value={sel.value}
                onChange={(e) => sel.onChange(e.target.value)}
                className="w-full px-4 py-3 bg-transparent border border-[var(--border-input)] rounded-md text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] appearance-none pr-10"
              >
                {sel.options.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <KeyboardArrowDownIcon className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-secondary)] pointer-events-none" />
            </div>
          </div>
        ))}

        <button onClick={handleSaveLangPrefs} disabled={saving}
          className="flex items-center gap-2 px-6 py-3 bg-[var(--accent)] text-[var(--bg-primary)] rounded-lg font-medium hover:opacity-85 transition-colors disabled:opacity-50">
          <SaveIcon className="w-5 h-5" />
          {saving ? t("common.saving") : t("settings.savePreferences")}
        </button>
      </div>
    </div>
  );
}
