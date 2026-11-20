"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { translateApiError } from "@/lib/i18n/translateApiError";
import { SaveIcon } from "@/components/ui/Icon";
import type { SettingsMessage } from "./types";
import { ApiClientError, apiRequest } from "@/lib/api-client";

interface NotificationsTabProps {
  initialPrefs: {
    notifyReleases: boolean;
    notifyRoyalties: boolean;
    notifyNews: boolean;
    notifyMarketing: boolean;
  };
  onMessage: (msg: SettingsMessage | null) => void;
}

export default function NotificationsTab({ initialPrefs, onMessage }: NotificationsTabProps) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [notifPrefs, setNotifPrefs] = useState(initialPrefs);

  const handleSaveNotifPrefs = async () => {
    setSaving(true);
    onMessage(null);
    try {
      await apiRequest("/api/v1/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(notifPrefs),
      });
      onMessage({ type: "success", text: t("settings.notifSaved") });
    } catch (error: unknown) {
      onMessage({ type: "error", text: error instanceof ApiClientError ? translateApiError(error.code, t) : error instanceof Error ? error.message : t("settings.failedSaveNotif") });
    } finally {
      setSaving(false);
    }
  };

  const items = [
    { key: "notifyReleases" as const, label: t("settings.newReleaseNotif"), desc: t("settings.newReleaseNotifDesc") },
    { key: "notifyRoyalties" as const, label: t("settings.royaltyReportsNotif"), desc: t("settings.royaltyReportsNotifDesc") },
    { key: "notifyNews" as const, label: t("settings.platformUpdatesNotif"), desc: t("settings.platformUpdatesNotifDesc") },
    { key: "notifyMarketing" as const, label: t("settings.marketingTipsNotif"), desc: t("settings.marketingTipsNotifDesc") },
  ];

  return (
    <div>
      <h2 className="text-xl font-semibold mb-6">{t("settings.notificationSettings")}</h2>
      <div className="space-y-4">
        {items.map((item) => (
          <div key={item.key} className="p-4 bg-[var(--bg-surface)] rounded-lg flex items-center justify-between">
            <div>
              <p className="font-medium">{item.label}</p>
              <p className="text-sm text-[var(--text-secondary)]">{item.desc}</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={notifPrefs[item.key]}
                onChange={(e) => setNotifPrefs((prev) => ({ ...prev, [item.key]: e.target.checked }))}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-[var(--bg-elevated-hover)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--accent)] text-white"></div>
            </label>
          </div>
        ))}
      </div>
      <button onClick={handleSaveNotifPrefs} disabled={saving}
        className="mt-6 flex items-center gap-2 px-6 py-3 bg-[var(--accent)] text-[var(--bg-primary)] rounded-lg font-medium hover:opacity-85 transition-colors disabled:opacity-50">
        <SaveIcon className="w-5 h-5" />
        {saving ? t("common.saving") : t("settings.saveSettings")}
      </button>
    </div>
  );
}
