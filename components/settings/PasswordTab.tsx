"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { translateApiError } from "@/lib/i18n/translateApiError";
import { LockIcon, VisibilityIcon, VisibilityOffIcon } from "@/components/ui/Icon";
import type { SettingsMessage } from "./types";
import { ApiClientError, apiRequest, clearAccessToken } from "@/lib/api-client";

interface PasswordTabProps {
  onMessage: (msg: SettingsMessage | null) => void;
}

export default function PasswordTab({ onMessage }: PasswordTabProps) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [passwordData, setPasswordData] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false,
  });

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const errors: string[] = [];
    if (!passwordData.currentPassword) errors.push(t("settings.currentPasswordRequired"));
    if (!passwordData.newPassword) errors.push(t("common.newPasswordRequired"));
    else if (passwordData.newPassword.length < 8) errors.push(t("settings.passwordMinLength"));
    else if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(passwordData.newPassword)) errors.push(t("settings.passwordComplexity"));
    if (passwordData.newPassword !== passwordData.confirmPassword) errors.push(t("settings.passwordsMustMatch"));
    if (passwordData.newPassword === passwordData.currentPassword) errors.push(t("settings.passwordMustDiffer"));

    if (errors.length > 0) {
      onMessage({ type: "error", text: errors.join("\n") });
      return;
    }

    setSaving(true);
    onMessage(null);

    try {
      await apiRequest("/api/v1/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: passwordData.currentPassword,
          newPassword: passwordData.newPassword,
        }),
      });
      clearAccessToken();
      onMessage({ type: "success", text: t("settings.passwordChanged") });
      setPasswordData({ currentPassword: "", newPassword: "", confirmPassword: "" });
    } catch (error) {
      onMessage({
        type: "error",
        text: error instanceof ApiClientError ? translateApiError(error.code, t) : error instanceof Error ? error.message : t("common.failedChangePassword"),
      });
    } finally {
      setSaving(false);
    }
  };

  const fields = [
    { key: "current" as const, label: t("settings.currentPassword"), placeholder: t("settings.enterCurrentPassword"), stateKey: "currentPassword" as const },
    { key: "new" as const, label: t("settings.newPassword"), placeholder: t("settings.enterNewPassword"), stateKey: "newPassword" as const },
    { key: "confirm" as const, label: t("settings.confirmNewPassword"), placeholder: t("settings.confirmNewPasswordPlaceholder"), stateKey: "confirmPassword" as const },
  ];

  return (
    <div>
      <h2 className="text-xl font-semibold mb-6">{t("settings.changePassword")}</h2>
      <form onSubmit={handlePasswordSubmit} className="space-y-4">
        {fields.map((field) => (
          <div key={field.key}>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">{field.label}</label>
            <div className="relative">
              <input
                type={showPasswords[field.key] ? "text" : "password"}
                value={passwordData[field.stateKey]}
                onChange={(e) => setPasswordData({ ...passwordData, [field.stateKey]: e.target.value })}
                className="w-full px-4 py-3 bg-transparent border border-[var(--border-input)] rounded-md text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] pr-12"
                placeholder={field.placeholder}
                required
              />
              <button
                type="button"
                onClick={() => setShowPasswords({ ...showPasswords, [field.key]: !showPasswords[field.key] })}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                {showPasswords[field.key] ? <VisibilityOffIcon /> : <VisibilityIcon />}
              </button>
            </div>
          </div>
        ))}

        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-2 px-6 py-3 bg-[var(--accent)] text-[var(--bg-primary)] rounded-lg font-medium hover:opacity-85 transition-colors disabled:opacity-50"
        >
          <LockIcon className="w-5 h-5" />
          {saving ? t("settings.changingPassword") : t("settings.changePassword")}
        </button>
      </form>
    </div>
  );
}
