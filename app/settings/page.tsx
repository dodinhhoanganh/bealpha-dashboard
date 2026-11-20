"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { I18nProvider, useI18n } from "@/lib/i18n/I18nProvider";
import {
  PersonIcon,
  LockIcon,
  SecurityIcon,
  NotificationsIcon,
  LanguageIcon,
  PaletteIcon,
  ArrowBackIcon,
} from "@/components/ui/Icon";
import type { UserProfile, ActiveSession, SettingsMessage } from "@/components/settings/types";
import ProfileTab from "@/components/settings/ProfileTab";
import PasswordTab from "@/components/settings/PasswordTab";
import SecurityTab from "@/components/settings/SecurityTab";
import NotificationsTab from "@/components/settings/NotificationsTab";
import LanguageTab from "@/components/settings/LanguageTab";
import AppearanceTab from "@/components/settings/AppearanceTab";
import BrandTab from "@/components/settings/BrandTab";
import {
  ApiClientError,
  apiRequest,
  getIdentityProfile,
  type IdentitySession,
} from "@/lib/api-client";

// Small translated label component
function SettingsLabel({ labelKey, fallback }: { labelKey: string; fallback: string }) {
  const { t } = useI18n();
  return <>{t(labelKey, fallback)}</>;
}

export default function SettingsPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("profile");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<SettingsMessage | null>(null);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [canManageBrand, setCanManageBrand] = useState(false);

  const fetchProfile = useCallback(async () => {
    try {
      const [identity, identitySessions, twoFactor] = await Promise.all([
        getIdentityProfile(),
        apiRequest<IdentitySession[]>("/api/v1/auth/sessions"),
        apiRequest<{ enabled: boolean; methods: string[] }>("/api/v1/auth/2fa"),
      ]);
      setProfile({
        id: identity.id,
        email: identity.email,
        name: identity.name ?? "",
        stageName: identity.stageName,
        phone: identity.phone,
        avatar: identity.avatar,
        roles: identity.staffRoles,
        twoFactorEnabled: twoFactor.enabled,
        twoFactorMethod: twoFactor.methods.join(","),
        language: identity.language,
        timezone: identity.timezone,
        currency: identity.currency,
        notifyReleases: identity.notifyReleases,
        notifyRoyalties: identity.notifyRoyalties,
        notifyNews: identity.notifyNews,
        notifyMarketing: identity.notifyMarketing,
        createdAt: identity.createdAt,
      });
      setCanManageBrand(identity.membership?.entityType === "ORGANIZATION" && identity.membership.entityRole === "OWNER");
      setSessions(identitySessions.map((session) => ({
        id: session.id,
        ipAddress: session.ipAddress ?? "",
        userAgent: session.userAgent ?? "",
        deviceName: session.deviceName ?? "Unknown device",
        deviceType: session.deviceType ?? "unknown",
        location: "",
        createdAt: session.createdAt,
        lastUsedAt: session.lastUsedAt,
        isCurrent: session.current,
      })));
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 401) {
        router.push("/login");
        return;
      }
      console.error("Error fetching profile:", error);
      setMessage({ type: "error", text: t("settings.failedLoadProfile") });
    } finally {
      setLoading(false);
    }
  }, [router, t]);

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  const tabs = [
    { id: "profile", label: "Profile", labelKey: "settings.profile", icon: PersonIcon },
    { id: "password", label: "Password", labelKey: "settings.password", icon: LockIcon },
    { id: "security", label: "Security", labelKey: "settings.security", icon: SecurityIcon },
    { id: "notifications", label: "Notifications", labelKey: "settings.notifications", icon: NotificationsIcon },
    { id: "language", label: "Language", labelKey: "settings.language", icon: LanguageIcon },
    { id: "appearance", label: "Appearance", labelKey: "settings.appearance", icon: PaletteIcon },
    ...(canManageBrand ? [{ id: "brand", label: "Brand", labelKey: "settings.brand", icon: PaletteIcon }] : []),
  ];

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-primary)" }}>
        <div className="animate-spin rounded-full h-8 w-8" style={{ borderTop: "2px solid var(--text-tertiary)", borderBottom: "2px solid var(--text-tertiary)" }}></div>
      </div>
    );
  }

  return (
    <I18nProvider
      initialLanguage={profile?.language || "en"}
      initialCurrency={profile?.currency || "USD"}
    >
      <div className="h-screen flex flex-col overflow-hidden" style={{ background: "var(--bg-primary)", color: "var(--text-primary)" }}>
        <div className="max-w-7xl mx-auto w-full px-4 sm:px-8 pt-5 pb-2 flex-shrink-0">
          <div className="flex items-center gap-4 mb-6">
            <button
              onClick={() => router.push("/")}
              className="p-2 rounded-lg transition-colors"
              style={{ background: "var(--bg-elevated)" }}
              title={t("settings.backToDashboard")}
            >
              <ArrowBackIcon className="w-5 h-5" />
            </button>
            <h1 className="text-2xl font-medium">
              <SettingsLabel labelKey="settings.title" fallback="Settings" />
            </h1>
          </div>

          {message && (
            <div
              className="mb-4 p-4 rounded-lg flex items-center gap-2"
              style={{
                background: message.type === "success" ? "var(--status-success-surface)" : "var(--status-error-surface)",
                color: message.type === "success" ? "var(--status-success)" : "var(--status-error)",
              }}
            >
              {t(message.text, message.text)}
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 max-w-7xl mx-auto w-full px-4 sm:px-8 pb-6">
          <div className="flex flex-col md:flex-row gap-3 md:gap-6 h-full">
            {/* Sidebar — horizontal scroll on mobile, vertical list on desktop */}
            <div className="md:w-52 flex-shrink-0">
              <nav
                className="rounded-xl p-2 sticky top-0 flex md:block overflow-x-auto md:overflow-visible"
                style={{ background: "var(--bg-surface)", border: "1px solid var(--border-primary)", boxShadow: "var(--shadow-sm)" }}
              >
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className="flex md:w-full items-center gap-3 px-4 py-2.5 rounded-xl text-left transition-all duration-200 text-sm font-medium whitespace-nowrap"
                    style={{
                      background: activeTab === tab.id ? "var(--accent-surface)" : "transparent",
                      color: activeTab === tab.id ? "var(--accent-text)" : "var(--text-tertiary)",
                    }}
                  >
                    <tab.icon className="w-4 h-4" />
                    <SettingsLabel labelKey={tab.labelKey} fallback={tab.label} />
                  </button>
                ))}
              </nav>
            </div>

            {/* Content */}
            <div
              className="flex-1 rounded-xl p-4 sm:p-8 overflow-y-auto"
              style={{ background: "var(--bg-surface)", border: "1px solid var(--border-primary)", boxShadow: "var(--shadow-sm)" }}
            >
              {activeTab === "profile" && profile && (
                <ProfileTab profile={profile} onMessage={setMessage} onRefresh={fetchProfile} />
              )}
              {activeTab === "password" && (
                <PasswordTab onMessage={setMessage} />
              )}
              {activeTab === "security" && profile && (
                <SecurityTab
                  profile={profile}
                  sessions={sessions}
                  onMessage={setMessage}
                  onRefresh={fetchProfile}
                  onSessionRevoked={(id) => setSessions((s) => s.filter((sess) => sess.id !== id))}
                />
              )}
              {activeTab === "notifications" && profile && (
                <NotificationsTab
                  initialPrefs={{
                    notifyReleases: profile.notifyReleases ?? true,
                    notifyRoyalties: profile.notifyRoyalties ?? true,
                    notifyNews: profile.notifyNews ?? true,
                    notifyMarketing: profile.notifyMarketing ?? false,
                  }}
                  onMessage={setMessage}
                />
              )}
              {activeTab === "language" && profile && (
                <LanguageTab
                  initialPrefs={{
                    language: profile.language || "en",
                    timezone: profile.timezone || "Asia/Ho_Chi_Minh",
                    currency: profile.currency || "USD",
                  }}
                  onMessage={setMessage}
                />
              )}
              {activeTab === "appearance" && <AppearanceTab />}
              {activeTab === "brand" && canManageBrand && <BrandTab onMessage={setMessage} />}
            </div>
          </div>
        </div>
      </div>
    </I18nProvider>
  );
}
