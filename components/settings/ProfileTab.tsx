"use client";

import { useState, useRef } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { translateApiError } from "@/lib/i18n/translateApiError";
import {
  COUNTRY_CODES,
  parsePhoneNumber,
  formatPhoneNumber,
} from "@/lib/country-codes";
import {
  PersonIcon,
  SaveIcon,
  CameraAltIcon,
  KeyboardArrowDownIcon,
  SearchIcon,
} from "@/components/ui/Icon";
import { useUploadProgress } from "@/components/ui/UploadProgress";
import type { UserProfile, SettingsMessage } from "./types";
import { ApiClientError, apiRequest } from "@/lib/api-client";
import SecureImage from "@/components/ui/SecureImage";


interface ProfileTabProps {
  profile: UserProfile;
  onMessage: (msg: SettingsMessage | null) => void;
  onRefresh: () => void;
}

export default function ProfileTab({ profile, onMessage, onRefresh }: ProfileTabProps) {
  const { t } = useI18n();
  const { uploadMedia } = useUploadProgress();

  const [formData, setFormData] = useState(() => {
    const { countryCode, localNumber } = parsePhoneNumber(profile.phone);
    return {
      name: profile.name || "",
      stageName: profile.stageName || "",
      countryCode,
      phoneNumber: localNumber,
    };
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragState, setDragState] = useState(false);
  const [countryDropdownOpen, setCountryDropdownOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState("");
  const countryDropdownRef = useRef<HTMLDivElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const filteredCountries = COUNTRY_CODES.filter(
    (country) =>
      country.name.toLowerCase().includes(countrySearch.toLowerCase()) ||
      country.dialCode.includes(countrySearch) ||
      country.code.toLowerCase().includes(countrySearch.toLowerCase()),
  );

  const selectedCountry =
    COUNTRY_CODES.find((c) => c.dialCode === formData.countryCode) ||
    COUNTRY_CODES.find((c) => c.code === "VN")!;

  const handleImageUpload = async (file: File): Promise<string | null> => {
    try {
      const data = await uploadMedia(
        "IMAGE",
        file,
        file.name,
        { entityId: profile.id || "" },
      );
      return typeof data.url === "string" ? data.url : null;
    } catch (error) {
      onMessage({
        type: "error",
        text: error instanceof Error ? error.message : t("common.uploadFailed"),
      });
      return null;
    }
  };

  const handleAvatarUpload = async (
    e: React.ChangeEvent<HTMLInputElement> | File,
  ) => {
    const file = e instanceof File ? e : e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    onMessage(null);
    try {
      const url = await handleImageUpload(file);
      if (url) {
        await apiRequest("/api/v1/auth/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ avatar: url }),
        });
        onMessage({ type: "success", text: t("settings.avatarUpdated") });
        onRefresh();
      }
    } catch (error) {
      onMessage({
        type: "error",
        text: error instanceof Error ? error.message : t("settings.failedUpdateAvatar"),
      });
    } finally {
      setUploading(false);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  };

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    onMessage(null);

    const errors: string[] = [];
    if (formData.phoneNumber && !/^\d{4,15}$/.test(formData.phoneNumber)) {
      errors.push(t("common.phoneValidation"));
    }
    if (errors.length > 0) {
      onMessage({ type: "error", text: errors.join("\n") });
      setSaving(false);
      return;
    }

    try {
      const phone = formatPhoneNumber(formData.countryCode, formData.phoneNumber);
      await apiRequest("/api/v1/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          stageName: formData.stageName,
          phone: phone || null,
        }),
      });
      onMessage({ type: "success", text: t("settings.profileUpdated") });
      onRefresh();
    } catch (error) {
      onMessage({ type: "error", text: error instanceof ApiClientError ? translateApiError(error.code, t) : error instanceof Error ? error.message : t("common.failedUpdateProfile") });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h2
        className="text-lg font-semibold uppercase tracking-wider mb-6 pb-2 border-b border-[var(--border-primary)]"
        style={{ color: "var(--text-tertiary)" }}
      >
        {t("settings.profileSettings")}
      </h2>

      {/* Avatar Upload */}
      <div className="mb-6 flex items-center gap-6">
        <div
          className={`relative w-24 h-24 group ${dragState ? "ring-4 ring-green-500 rounded-full" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragState(true); }}
          onDragLeave={(e) => { e.preventDefault(); setDragState(false); }}
          onDrop={(e) => {
            e.preventDefault();
            setDragState(false);
            const f = e.dataTransfer.files?.[0];
            if (f) handleAvatarUpload(f);
          }}
        >
          {profile?.avatar ? (
            <SecureImage src={profile.avatar} alt={t("ui.profileTab.avatar", "Avatar")} className="w-24 h-24 rounded-full object-cover border-2 border-[var(--border-primary)]" />
          ) : (
            <div className="w-24 h-24 rounded-full bg-[var(--bg-elevated)] border-2 border-[var(--border-primary)] flex items-center justify-center">
              <PersonIcon className="w-10 h-10 text-[var(--text-disabled)]" />
            </div>
          )}
          <button
            type="button"
            onClick={() => avatarInputRef.current?.click()}
            disabled={uploading}
            className="absolute inset-0 rounded-full bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer"
          >
            {uploading ? (
              <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <CameraAltIcon className="w-6 h-6 text-[var(--text-primary)]" />
            )}
          </button>
          <input ref={avatarInputRef} type="file" accept="image/png,image/jpeg,image/jpg" onChange={handleAvatarUpload} className="hidden" />
        </div>
        <div>
          <p className="text-sm font-medium text-[var(--text-primary)] mb-1">{t("settings.profilePhoto")}</p>
          <p className="text-xs text-[var(--text-secondary)]">{t("settings.clickPhotoToChange")}</p>
        </div>
      </div>

      <div className="mb-4 flex items-center gap-3">
        <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-tertiary)] w-20">{t("login.emailMethod")}</span>
        <span className="text-sm text-[var(--text-primary)]">{profile?.email}</span>
      </div>

      <div className="mb-4 flex items-center gap-3">
        <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-tertiary)] w-20">{t("settings.roles")}</span>
        <span className="text-sm text-[var(--text-primary)]">
          {profile?.roles?.length ? profile.roles.join(", ") : t("settings.noRolesAssigned")}
        </span>
      </div>

      <hr className="my-5" style={{ borderColor: "var(--border-primary)" }} />

      <form onSubmit={handleProfileSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium uppercase tracking-wide text-[var(--text-tertiary)] mb-1.5">{t("settings.fullName")}</label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full px-4 py-2.5 bg-transparent border border-[var(--border-input)] rounded-md text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent)]"
            placeholder={t("settings.fullNamePlaceholder")}
          />
        </div>

        <div>
          <label className="block text-xs font-medium uppercase tracking-wide text-[var(--text-tertiary)] mb-1.5">{t("artists.stageName")}</label>
          <input
            type="text"
            value={formData.stageName}
            onChange={(e) => setFormData({ ...formData, stageName: e.target.value })}
            className="w-full px-4 py-2.5 bg-transparent border border-[var(--border-input)] rounded-md text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent)]"
            placeholder={t("settings.stageNamePlaceholder")}
          />
        </div>

        <div>
          <label className="block text-xs font-medium uppercase tracking-wide text-[var(--text-tertiary)] mb-1.5">{t("settings.phoneNumber")}</label>
          <div className="flex gap-2">
            <div className="relative" ref={countryDropdownRef}>
              <button
                type="button"
                onClick={() => setCountryDropdownOpen(!countryDropdownOpen)}
                className="flex items-center justify-center gap-1 min-w-[70px] px-2 py-3 bg-transparent border border-[var(--border-input)] rounded-md text-[var(--text-primary)] hover:border-[var(--accent)] focus:outline-none focus:border-[var(--accent)]"
              >
                <span className="text-sm font-medium">{selectedCountry.dialCode}</span>
                <KeyboardArrowDownIcon className={`w-4 h-4 text-[var(--text-secondary)] transition-transform ${countryDropdownOpen ? "rotate-180" : ""}`} />
              </button>

              {countryDropdownOpen && (
                <div className="absolute z-50 top-full left-0 mt-1 w-[320px] max-h-[300px] bg-[var(--bg-elevated)] border border-[var(--border-input)] rounded-lg shadow-xl overflow-hidden">
                  <div className="p-2 border-b border-[var(--border-primary)]">
                    <div className="relative">
                      <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-secondary)]" />
                      <input
                        type="text"
                        value={countrySearch}
                        onChange={(e) => setCountrySearch(e.target.value)}
                        placeholder={t("settings.searchCountry")}
                        className="w-full pl-9 pr-3 py-2 bg-transparent border border-[var(--border-input)] rounded text-[var(--text-primary)] text-sm focus:outline-none focus:border-[#1DB954]"
                        autoFocus
                      />
                    </div>
                  </div>
                  <div className="max-h-[240px] overflow-y-auto">
                    {filteredCountries.map((country) => (
                      <button
                        key={country.code}
                        type="button"
                        onClick={() => {
                          setFormData({ ...formData, countryCode: country.dialCode });
                          setCountryDropdownOpen(false);
                          setCountrySearch("");
                        }}
                        className={`w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-[var(--bg-elevated-hover)] transition-colors ${
                          formData.countryCode === country.dialCode
                            ? "bg-[#1DB954]/20 text-[#1DB954]"
                            : "text-[var(--text-primary)]"
                        }`}
                      >
                        <span className="text-lg">{country.flag}</span>
                        <span className="flex-1 text-sm truncate">{country.name}</span>
                        <span className="text-sm text-[var(--text-secondary)]">{country.dialCode}</span>
                      </button>
                    ))}
                    {filteredCountries.length === 0 && (
                      <div className="px-3 py-4 text-center text-[var(--text-secondary)] text-sm">{t("common.noCountriesFound")}</div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <input
              type="tel"
              value={formData.phoneNumber}
              onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value.replace(/[^\d\s-]/g, "") })}
              className="flex-1 px-4 py-2.5 bg-transparent border border-[var(--border-input)] rounded-md text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent)]"
              placeholder={t("settings.phoneNumberPlaceholder")}
            />
          </div>
          <p className="mt-1 text-xs text-[var(--text-disabled)]"></p>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 bg-[var(--accent)] text-[var(--bg-primary)] rounded-lg text-sm font-medium hover:opacity-85 transition-colors disabled:opacity-50"
        >
          <SaveIcon className="w-5 h-5" />
          {saving ? t("common.saving") : t("releases.saveChanges")}
        </button>
      </form>
    </div>
  );
}
