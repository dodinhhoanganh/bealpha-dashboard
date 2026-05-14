"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  COUNTRY_CODES,
  parsePhoneNumber,
  formatPhoneNumber,
} from "@/lib/country-codes";
import { I18nProvider, useI18n } from "@/lib/i18n/I18nProvider";
import { translateApiError } from "@/lib/i18n/translateApiError";
import { LOCALES } from "@/lib/i18n";
import {
  PersonIcon,
  LockIcon,
  SecurityIcon,
  NotificationsIcon,
  LanguageIcon,
  PaletteIcon,
  SaveIcon,
  VisibilityIcon,
  VisibilityOffIcon,
  CheckCircleIcon,
  ArrowBackIcon,
  CloudUploadIcon,
  CameraAltIcon,
  DeleteIcon,
  KeyboardArrowDownIcon,
  SearchIcon,
  EmailIcon,
  PhoneIcon,
  DesktopIcon,
  QrCodeIcon,
  ShieldIcon,
  TagIcon,
  MicrophoneIcon,
  WarningIcon,
  ClipboardIcon,
  MobileIcon,
  SmsIcon,
} from "@/components/Icon";
import { useTheme } from "@/components/ThemeProvider";
import { useUploadProgress } from "@/components/UploadProgress";

interface UserProfile {
  id: string;
  email: string;
  name: string;
  stageName: string | null;
  phone: string | null;
  avatar: string | null;
  roles: string[];
  twoFactorEnabled: boolean;
  twoFactorMethod: string | null; // comma-separated: "email,app"
  language: string;
  timezone: string;
  currency: string;
  notifyReleases: boolean;
  notifyRoyalties: boolean;
  notifyNews: boolean;
  notifyMarketing: boolean;
  createdAt: string;
}

interface ActiveSession {
  id: string;
  ipAddress: string;
  userAgent: string;
  deviceName: string;
  deviceType: string;
  location: string;
  createdAt: string;
  lastUsedAt: string;
  isCurrent: boolean;
}

const UPLOAD_SERVER = process.env.NEXT_PUBLIC_UPLOAD_URL || "";

// Small translated label component
function SettingsLabel({
  labelKey,
  fallback,
}: {
  labelKey: string;
  fallback: string;
}) {
  const { t } = useI18n();
  return <>{t(labelKey, fallback)}</>;
}

export default function SettingsPage() {
  const { t } = useI18n(); // Auto-injected

  const router = useRouter();
  const [activeTab, setActiveTab] = useState("profile");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const { theme, setTheme } = useTheme();
  const { uploadFile } = useUploadProgress();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    stageName: "",
    countryCode: "+84",
    phoneNumber: "",
  });

  // Country code dropdown state
  const [countryDropdownOpen, setCountryDropdownOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState("");
  const countryDropdownRef = useRef<HTMLDivElement>(null);

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

  const [twoFactorData, setTwoFactorData] = useState({
    enabled: false,
    methods: [] as string[], // array: ["email", "app"]
  });

  // 2FA setup flow state
  const [tfaSetupStep, setTfaSetupStep] = useState<
    "idle" | "setup-app" | "verify-app" | "recovery-codes"
  >("idle");
  const [tfaQrCode, setTfaQrCode] = useState("");
  const [tfaSecret, setTfaSecret] = useState("");
  const [tfaPendingSecretToken, setTfaPendingSecretToken] = useState("");
  const [tfaVerifyCode, setTfaVerifyCode] = useState("");
  const tfaInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [tfaSaving, setTfaSaving] = useState(false);
  const [tfaRecoveryCodes, setTfaRecoveryCodes] = useState<string[]>([]);

  // Active Sessions
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [revokingSession, setRevokingSession] = useState<string | null>(null);

  // Upload refs
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const labelLogoInputRef = useRef<HTMLInputElement>(null);
  const artistImageInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string | null>(null); // 'avatar' | 'labelLogo' | 'artistImage'
  const [dragState, setDragState] = useState<string | null>(null); // 'avatar' | 'labelLogo' | 'artistImage'

  // Language & Region preferences
  const [langPrefs, setLangPrefs] = useState({
    language: "en",
    timezone: "Asia/Ho_Chi_Minh",
    currency: "USD",
  });

  // Notification preferences
  const [notifPrefs, setNotifPrefs] = useState({
    notifyReleases: true,
    notifyRoyalties: true,
    notifyNews: true,
    notifyMarketing: false,
  });

  // Check roles
  const isLabelRole = profile?.roles?.includes("label") || false;
  const isArtistRole = profile?.roles?.includes("artist") || false;
  const isDistributorRole = profile?.roles?.includes("distributor") || false;

  useEffect(() => {
    fetchProfile();
  }, []);

  // Close country dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        countryDropdownRef.current &&
        !countryDropdownRef.current.contains(event.target as Node)
      ) {
        setCountryDropdownOpen(false);
        setCountrySearch("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fetchProfile = async () => {
    try {
      const response = await fetch("/api/auth/me");
      if (!response.ok) {
        if (response.status === 401) {
          router.push("/login");
          return;
        }
        throw new Error("Failed to fetch profile");
      }
      const data = await response.json();
      setProfile(data.user);

      // Parse phone number into country code and local number
      const { countryCode, localNumber } = parsePhoneNumber(data.user.phone);
      setFormData({
        name: data.user.name || "",
        stageName: data.user.stageName || "",
        countryCode,
        phoneNumber: localNumber,
      });
      setTwoFactorData({
        enabled: data.user.twoFactorEnabled || false,
        methods: data.user.twoFactorMethod
          ? data.user.twoFactorMethod
              .split(",")
              .map((m: string) => m.trim())
              .filter(Boolean)
          : [],
      });
      setLangPrefs({
        language: data.user.language || "en",
        timezone: data.user.timezone || "Asia/Ho_Chi_Minh",
        currency: data.user.currency || "USD",
      });
      setNotifPrefs({
        notifyReleases: data.user.notifyReleases ?? true,
        notifyRoyalties: data.user.notifyRoyalties ?? true,
        notifyNews: data.user.notifyNews ?? true,
        notifyMarketing: data.user.notifyMarketing ?? false,
      });

      // Fetch active sessions
      const sessionRes = await fetch("/api/user/sessions");
      if (sessionRes.ok) {
        const sessionData = await sessionRes.json();
        setSessions(sessionData.sessions || []);
      }
    } catch (error) {
      console.error("Error fetching profile:", error);
      setMessage({ type: "error", text: t("settings.failedLoadProfile") });
    } finally {
      setLoading(false);
    }
  };

  // Filter countries by search
  const filteredCountries = COUNTRY_CODES.filter(
    (country) =>
      country.name.toLowerCase().includes(countrySearch.toLowerCase()) ||
      country.dialCode.includes(countrySearch) ||
      country.code.toLowerCase().includes(countrySearch.toLowerCase()),
  );

  // Get selected country info
  const selectedCountry =
    COUNTRY_CODES.find((c) => c.dialCode === formData.countryCode) ||
    COUNTRY_CODES.find((c) => c.code === "VN")!;

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    // Validate
    const errors: string[] = [];
    if (formData.phoneNumber && !/^\d{4,15}$/.test(formData.phoneNumber)) {
      errors.push("Phone number must contain only digits (4-15 digits)");
    }
    if (errors.length > 0) {
      setMessage({ type: "error", text: errors.join("\n") });
      setSaving(false);
      return;
    }

    try {
      // Combine country code and phone number
      const phone = formatPhoneNumber(
        formData.countryCode,
        formData.phoneNumber,
      );

      const response = await fetch("/api/auth/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          stageName: formData.stageName,
          phone: phone || null,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(translateApiError(data.error, t));
      }

      setMessage({ type: "success", text: t("settings.profileUpdated") });
      fetchProfile();
    } catch (error) {
      setMessage({
        type: "error",
        text:
          error instanceof Error ? error.message : "Failed to update profile",
      });
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const errors: string[] = [];
    if (!passwordData.currentPassword)
      errors.push(t("settings.currentPasswordRequired"));
    if (!passwordData.newPassword) errors.push("New password is required");
    else if (passwordData.newPassword.length < 8)
      errors.push(t("settings.passwordMinLength"));
    else if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(passwordData.newPassword))
      errors.push(t("settings.passwordComplexity"));
    if (passwordData.newPassword !== passwordData.confirmPassword)
      errors.push(t("settings.passwordsMustMatch"));
    if (passwordData.newPassword === passwordData.currentPassword)
      errors.push(t("settings.passwordMustDiffer"));

    if (errors.length > 0) {
      setMessage({ type: "error", text: errors.join("\n") });
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: passwordData.currentPassword,
          newPassword: passwordData.newPassword,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(translateApiError(data.error, t));
      }

      setMessage({ type: "success", text: t("settings.passwordChanged") });
      setPasswordData({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
    } catch (error) {
      setMessage({
        type: "error",
        text:
          error instanceof Error ? error.message : "Failed to change password",
      });
    } finally {
      setSaving(false);
    }
  };

  // === 2FA Multi-Method Handlers ===
  const handleToggleMethod = async (method: string) => {
    const isCurrentlyEnabled = twoFactorData.methods.includes(method);

    // If enabling "app" and not yet set up, start TOTP setup flow
    if (!isCurrentlyEnabled && method === "app") {
      setTfaSaving(true);
      setMessage(null);
      try {
        const res = await fetch("/api/auth/2fa/setup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "setup-app" }),
        });
        const data = await res.json();
        if (!res.ok)
          throw new Error(translateApiError(data.error, t));

        setTfaQrCode(data.qrCodeUrl);
        setTfaSecret(data.secret);
        setTfaPendingSecretToken(data.pendingSecretToken);
        setTfaSetupStep("setup-app");
      } catch (error) {
        setMessage({
          type: "error",
          text:
            error instanceof Error
              ? error.message
              : "Failed to set up authenticator",
        });
      } finally {
        setTfaSaving(false);
      }
      return;
    }

    setTfaSaving(true);
    setMessage(null);

    try {
      if (isCurrentlyEnabled) {
        // Prompt for password to disable method
        const password = window.prompt(
          `SECURITY CHECK: Please enter your password to disable ${method === "app" ? "Authenticator App" : "Email"} 2FA.`,
        );

        if (!password) {
          setTfaSaving(false);
          return;
        }

        // Disabling this specific method
        const res = await fetch("/api/auth/2fa/setup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "disable-method", method, password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(translateApiError(data.error, t));

        const newMethods =
          data.methods || twoFactorData.methods.filter((m) => m !== method);
        setTwoFactorData({
          enabled: newMethods.length > 0,
          methods: newMethods,
        });
        const label = method === "app" ? "Authenticator App" : "Email";
        setMessage({ type: "success", text: `${label} 2FA disabled` });
      } else {
        // Enabling this specific method (email — app goes through setup flow above)
        const action = "enable-email";
        const res = await fetch("/api/auth/2fa/setup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(translateApiError(data.error, t));

        const newMethods = data.methods || [...twoFactorData.methods, method];
        setTwoFactorData({
          enabled: true,
          methods: newMethods,
        });
        const label = "Email";
        setMessage({ type: "success", text: `${label} 2FA enabled` });
      }
      fetchProfile();
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to update 2FA",
      });
    } finally {
      setTfaSaving(false);
    }
  };

  const handleVerifyAppCode = async () => {
    if (tfaVerifyCode.length !== 6) return;

    setTfaSaving(true);
    setMessage(null);

    try {
      const res = await fetch("/api/auth/2fa/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "verify-app",
          code: tfaVerifyCode,
          pendingSecretToken: tfaPendingSecretToken,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(translateApiError(data.error, t));

      const newMethods = data.methods || [...twoFactorData.methods, "app"];
      setTwoFactorData({ enabled: true, methods: newMethods });

      if (data.recoveryCodes && data.recoveryCodes.length > 0) {
        setTfaRecoveryCodes(data.recoveryCodes);
        setTfaSetupStep("recovery-codes");
      } else {
        setTfaSetupStep("idle");
        setTfaQrCode("");
        setTfaSecret("");
        setTfaPendingSecretToken("");
        setTfaVerifyCode("");
      }

      setMessage({
        type: "success",
        text: t("settings.app2FAEnabled"),
      });
      fetchProfile();
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Verification failed",
      });
    } finally {
      setTfaSaving(false);
    }
  };

  const handleDisableAll2FA = async () => {
    const password = window.prompt(
      t("settings.disableAll2FAPrompt"),
    );

    if (!password) {
      return;
    }

    setTfaSaving(true);
    setMessage(null);

    try {
      const res = await fetch("/api/auth/2fa/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disable", password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(translateApiError(data.error, t));

      setTwoFactorData({ enabled: false, methods: [] });
      setTfaSetupStep("idle");
      setTfaQrCode("");
      setTfaSecret("");
      setTfaVerifyCode("");
      setMessage({
        type: "success",
        text: t("settings.all2FADisabled"),
      });
      fetchProfile();
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to disable 2FA",
      });
    } finally {
      setTfaSaving(false);
    }
  };

  const handleCancelSetup = useCallback(() => {
    setTfaSetupStep("idle");
    setTfaQrCode("");
    setTfaSecret("");
    setTfaVerifyCode("");
  }, []);

  // === Image Upload Handlers ===
  const handleImageUpload = async (
    file: File,
    type: string,
    extraData: Record<string, string> = {},
  ): Promise<string | null> => {
    try {
      const data = await uploadFile(
        `${UPLOAD_SERVER}/upload/${type}`,
        file,
        file.name,
        extraData,
      );
      return data.url;
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Upload failed",
      });
      return null;
    }
  };

  const handleAvatarUpload = async (
    e: React.ChangeEvent<HTMLInputElement> | File,
  ) => {
    const file = e instanceof File ? e : e.target.files?.[0];
    if (!file) return;
    setUploading("avatar");
    setMessage(null);
    try {
      const url = await handleImageUpload(file, "avatars", {
        entityId: profile?.id || "",
      });
      if (url) {
        // Save avatar URL to profile
        const res = await fetch("/api/auth/profile", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ avatar: url }),
        });
        if (!res.ok) throw new Error("Failed to save avatar");
        setMessage({ type: "success", text: t("settings.avatarUpdated") });
        fetchProfile();
      }
    } catch (error) {
      setMessage({
        type: "error",
        text:
          error instanceof Error ? error.message : t("settings.failedUpdateAvatar"),
      });
    } finally {
      setUploading(null);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  };

  const handleremoveAvatar = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/auth/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatar: null }),
      });
      if (!res.ok) throw new Error("Failed to remove avatar");
      setMessage({ type: "success", text: "Avatar removed" });
      fetchProfile();
    } catch (error) {
      setMessage({
        type: "error",
        text:
          error instanceof Error ? error.message : "Failed to remove avatar",
      });
    } finally {
      setSaving(false);
    }
  };





  // Save Language & Region preferences
  const handleSaveLangPrefs = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/auth/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(langPrefs),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(translateApiError(data.error, t));
      }
      // Persist to localStorage for immediate i18n context pickup
      if (typeof window !== "undefined") {
        localStorage.setItem("bealpha_locale", langPrefs.language);
        localStorage.setItem("bealpha_currency", langPrefs.currency);
      }
      setMessage({
        type: "success",
        text: t("settings.prefsSaved"),
      });
      // Reload after a short delay so the user sees the success message
      setTimeout(() => {
        window.location.reload();
      }, 800);
    } catch (error: unknown) {
      setMessage({
        type: "error",
        text:
          error instanceof Error ? error.message : "Failed to save preferences",
      });
    } finally {
      setSaving(false);
    }
  };

  // Save Notification preferences
  const handleSaveNotifPrefs = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/auth/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(notifPrefs),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(translateApiError(data.error, t));
      }
      setMessage({
        type: "success",
        text: t("settings.notifSaved"),
      });
    } catch (error: unknown) {
      setMessage({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : t("settings.failedSaveNotif"),
      });
    } finally {
      setSaving(false);
    }
  };



  const handleRevokeSession = async (sessionId: string) => {
    setRevokingSession(sessionId);
    setMessage(null);
    try {
      const res = await fetch(`/api/user/sessions/${sessionId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(t("settings.failedRevokeSession"));

      setSessions(sessions.filter((s) => s.id !== sessionId));
      setMessage({ type: "success", text: t("settings.sessionRevoked") });
    } catch (error) {
      setMessage({
        type: "error",
        text:
          error instanceof Error ? error.message : "Failed to revoke session",
      });
    } finally {
      setRevokingSession(null);
    }
  };



  // Build tabs based on role
  const tabs = [
    {
      id: "profile",
      label: "Profile",
      labelKey: "settings.profile",
      icon: PersonIcon,
    },
    {
      id: "password",
      label: "Password",
      labelKey: "settings.password",
      icon: LockIcon,
    },
    {
      id: "security",
      label: "Security",
      labelKey: "settings.security",
      icon: SecurityIcon,
    },
    {
      id: "notifications",
      label: "Notifications",
      labelKey: "settings.notifications",
      icon: NotificationsIcon,
    },
    {
      id: "language",
      label: "Language",
      labelKey: "settings.language",
      icon: LanguageIcon,
    },
    {
      id: "appearance",
      label: "Appearance",
      labelKey: "settings.appearance",
      icon: PaletteIcon,
    },
  ];

  if (loading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: "var(--bg-primary)" }}
      >
        <div
          className="animate-spin rounded-full h-8 w-8"
          style={{
            borderTop: "2px solid var(--text-tertiary)",
            borderBottom: "2px solid var(--text-tertiary)",
          }}
        ></div>
      </div>
    );
  }

  return (
    <I18nProvider
      initialLanguage={profile?.language || langPrefs.language}
      initialCurrency={profile?.currency || langPrefs.currency}
    >
      <div
        className="h-screen flex flex-col overflow-hidden"
        style={{
          background: "var(--bg-primary)",
          color: "var(--text-primary)",
        }}
      >
        <div className="max-w-7xl mx-auto w-full px-8 pt-5 pb-2 flex-shrink-0">
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
                background:
                  message.type === "success"
                    ? "var(--status-success-surface)"
                    : "var(--status-error-surface)",
                color:
                  message.type === "success"
                    ? "var(--status-success)"
                    : "var(--status-error)",
              }}
            >
              {t(message.text, message.text)}
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 max-w-7xl mx-auto w-full px-8 pb-6">
          <div className="flex gap-6 h-full">
            {/* Sidebar - fixed */}
            <div className="w-52 flex-shrink-0">
              <nav
                className="rounded-xl p-2 sticky top-0"
                style={{
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border-primary)",
                  boxShadow: "var(--shadow-sm)",
                }}
              >
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-left transition-all duration-200 text-sm font-medium"
                    style={{
                      background:
                        activeTab === tab.id
                          ? "var(--accent-surface)"
                          : "transparent",
                      color:
                        activeTab === tab.id
                          ? "var(--accent-text)"
                          : "var(--text-tertiary)",
                    }}
                  >
                    <tab.icon className="w-4 h-4" />
                    <SettingsLabel
                      labelKey={tab.labelKey}
                      fallback={tab.label}
                    />
                  </button>
                ))}
              </nav>
            </div>

            {/* Content - scrollable */}
            <div
              className="flex-1 rounded-xl p-8 overflow-y-auto"
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border-primary)",
                boxShadow: "var(--shadow-sm)",
              }}
            >
              {/* Profile Tab */}
              {activeTab === "profile" && (
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
                      className={`relative w-24 h-24 group ${dragState === "avatar" ? "ring-4 ring-green-500 rounded-full" : ""}`}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragState("avatar");
                      }}
                      onDragLeave={(e) => {
                        e.preventDefault();
                        setDragState(null);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragState(null);
                        const f = e.dataTransfer.files?.[0];
                        if (f) handleAvatarUpload(f);
                      }}
                    >
                      {profile?.avatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={profile.avatar}
                          alt="Avatar"
                          className="w-24 h-24 rounded-full object-cover border-2 border-[var(--border-primary)]"
                        />
                      ) : (
                        <div className="w-24 h-24 rounded-full bg-[var(--bg-elevated)] border-2 border-[var(--border-primary)] flex items-center justify-center">
                          <PersonIcon className="w-10 h-10 text-[var(--text-disabled)]" />
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => avatarInputRef.current?.click()}
                        disabled={uploading === "avatar"}
                        className="absolute inset-0 rounded-full bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer"
                      >
                        {uploading === "avatar" ? (
                          <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                          <CameraAltIcon className="w-6 h-6 text-[var(--text-primary)]" />
                        )}
                      </button>
                      <input
                        ref={avatarInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/jpg"
                        onChange={handleAvatarUpload}
                        className="hidden"
                      />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[var(--text-primary)] mb-1">
                        {t("settings.profilePhoto")}
                      </p>
                      <p className="text-xs text-[var(--text-secondary)]">
                        {t("settings.clickPhotoToChange")}
                      </p>
                    </div>
                  </div>

                  <div className="mb-4 flex items-center gap-3">
                    <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-tertiary)] w-20">
                      {t("login.emailMethod")}
                    </span>
                    <span className="text-sm text-[var(--text-primary)]">
                      {profile?.email}
                    </span>
                  </div>

                  <div className="mb-4 flex items-center gap-3">
                    <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-tertiary)] w-20">
                      {t("settings.roles")}
                    </span>
                    <span className="text-sm text-[var(--text-primary)]">
                      {profile?.roles?.length
                        ? profile.roles.join(", ")
                        : t("settings.noRolesAssigned")}
                    </span>
                  </div>



                  <hr
                    className="my-5"
                    style={{ borderColor: "var(--border-primary)" }}
                  />
                  <form onSubmit={handleProfileSubmit} className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium uppercase tracking-wide text-[var(--text-tertiary)] mb-1.5">
                        {t("settings.fullName")}
                      </label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) =>
                          setFormData({ ...formData, name: e.target.value })
                        }
                        className="w-full px-4 py-2.5 bg-transparent border border-[var(--border-input)] rounded-md text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent)]"
                        placeholder={t("settings.fullNamePlaceholder")}
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium uppercase tracking-wide text-[var(--text-tertiary)] mb-1.5">
                        {t("artists.stageName")}
                      </label>
                      <input
                        type="text"
                        value={formData.stageName}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            stageName: e.target.value,
                          })
                        }
                        className="w-full px-4 py-2.5 bg-transparent border border-[var(--border-input)] rounded-md text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent)]"
                        placeholder={t("settings.stageNamePlaceholder")}
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium uppercase tracking-wide text-[var(--text-tertiary)] mb-1.5">
                        {t("settings.phoneNumber")}
                      </label>
                      <div className="flex gap-2">
                        {/* Country Code Dropdown */}
                        <div className="relative" ref={countryDropdownRef}>
                          <button
                            type="button"
                            onClick={() =>
                              setCountryDropdownOpen(!countryDropdownOpen)
                            }
                            className="flex items-center justify-center gap-1 min-w-[70px] px-2 py-3 bg-transparent border border-[var(--border-input)] rounded-md text-[var(--text-primary)] hover:border-[var(--accent)] focus:outline-none focus:border-[var(--accent)]"
                          >
                            <span className="text-sm font-medium">
                              {selectedCountry.dialCode}
                            </span>
                            <KeyboardArrowDownIcon
                              className={`w-4 h-4 text-[var(--text-secondary)] transition-transform ${countryDropdownOpen ? "rotate-180" : ""}`}
                            />
                          </button>

                          {countryDropdownOpen && (
                            <div className="absolute z-50 top-full left-0 mt-1 w-[320px] max-h-[300px] bg-[var(--bg-elevated)] border border-[var(--border-input)] rounded-lg shadow-xl overflow-hidden">
                              {/* Search */}
                              <div className="p-2 border-b border-[var(--border-primary)]">
                                <div className="relative">
                                  <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-secondary)]" />
                                  <input
                                    type="text"
                                    value={countrySearch}
                                    onChange={(e) =>
                                      setCountrySearch(e.target.value)
                                    }
                                    placeholder={t("settings.searchCountry")}
                                    className="w-full pl-9 pr-3 py-2 bg-transparent border border-[var(--border-input)] rounded text-[var(--text-primary)] text-sm focus:outline-none focus:border-[#1DB954]"
                                    autoFocus
                                  />
                                </div>
                              </div>

                              {/* Country List */}
                              <div className="max-h-[240px] overflow-y-auto">
                                {filteredCountries.map((country) => (
                                  <button
                                    key={country.code}
                                    type="button"
                                    onClick={() => {
                                      setFormData({
                                        ...formData,
                                        countryCode: country.dialCode,
                                      });
                                      setCountryDropdownOpen(false);
                                      setCountrySearch("");
                                    }}
                                    className={`w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-[var(--bg-elevated-hover)] transition-colors ${
                                      formData.countryCode === country.dialCode
                                        ? "bg-[#1DB954]/20 text-[#1DB954]"
                                        : "text-[var(--text-primary)]"
                                    }`}
                                  >
                                    <span className="text-lg">
                                      {country.flag}
                                    </span>
                                    <span className="flex-1 text-sm truncate">
                                      {country.name}
                                    </span>
                                    <span className="text-sm text-[var(--text-secondary)]">
                                      {country.dialCode}
                                    </span>
                                  </button>
                                ))}
                                {filteredCountries.length === 0 && (
                                  <div className="px-3 py-4 text-center text-[var(--text-secondary)] text-sm">
                                    {t("common.noCountriesFound")}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Phone Number Input */}
                        <input
                          type="tel"
                          value={formData.phoneNumber}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              phoneNumber: e.target.value.replace(
                                /[^\d\s-]/g,
                                "",
                              ),
                            })
                          }
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
              )}



              {/* Password Tab */}
              {activeTab === "password" && (
                <div>
                  <h2 className="text-xl font-semibold mb-6">
                    {t("settings.changePassword")}
                  </h2>
                  <form onSubmit={handlePasswordSubmit} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                        {t("settings.currentPassword")}
                      </label>
                      <div className="relative">
                        <input
                          type={showPasswords.current ? "text" : "password"}
                          value={passwordData.currentPassword}
                          onChange={(e) =>
                            setPasswordData({
                              ...passwordData,
                              currentPassword: e.target.value,
                            })
                          }
                          className="w-full px-4 py-3 bg-transparent border border-[var(--border-input)] rounded-md text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] pr-12"
                          placeholder={t("settings.enterCurrentPassword")}
                          required
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setShowPasswords({
                              ...showPasswords,
                              current: !showPasswords.current,
                            })
                          }
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        >
                          {showPasswords.current ? (
                            <VisibilityOffIcon />
                          ) : (
                            <VisibilityIcon />
                          )}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                        {t("settings.newPassword")}
                      </label>
                      <div className="relative">
                        <input
                          type={showPasswords.new ? "text" : "password"}
                          value={passwordData.newPassword}
                          onChange={(e) =>
                            setPasswordData({
                              ...passwordData,
                              newPassword: e.target.value,
                            })
                          }
                          className="w-full px-4 py-3 bg-transparent border border-[var(--border-input)] rounded-md text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] pr-12"
                          placeholder={t("settings.enterNewPassword")}
                          required
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setShowPasswords({
                              ...showPasswords,
                              new: !showPasswords.new,
                            })
                          }
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        >
                          {showPasswords.new ? (
                            <VisibilityOffIcon />
                          ) : (
                            <VisibilityIcon />
                          )}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                        {t("settings.confirmNewPassword")}
                      </label>
                      <div className="relative">
                        <input
                          type={showPasswords.confirm ? "text" : "password"}
                          value={passwordData.confirmPassword}
                          onChange={(e) =>
                            setPasswordData({
                              ...passwordData,
                              confirmPassword: e.target.value,
                            })
                          }
                          className="w-full px-4 py-3 bg-transparent border border-[var(--border-input)] rounded-md text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] pr-12"
                          placeholder={t("settings.confirmNewPasswordPlaceholder")}
                          required
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setShowPasswords({
                              ...showPasswords,
                              confirm: !showPasswords.confirm,
                            })
                          }
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        >
                          {showPasswords.confirm ? (
                            <VisibilityOffIcon />
                          ) : (
                            <VisibilityIcon />
                          )}
                        </button>
                      </div>
                    </div>

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
              )}

              {/* Security Tab */}
              {activeTab === "security" && (
                <div>
                  <h2 className="text-xl font-semibold mb-6">
                    {t("settings.securitySettings")}
                  </h2>

                  <div className="p-6 bg-transparent rounded-lg">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center shrink-0 mr-1">
                          <ShieldIcon size={24} className="text-white" />
                        </div>
                        <div>
                          <h3 className="font-medium">
                            {t("settings.twoFactor")}
                          </h3>
                          <p className="text-sm text-[var(--text-secondary)]">
                            {twoFactorData.enabled
                              ? `${twoFactorData.methods.length} ${t("settings.methodsActive")}`
                              : t("settings.addExtraLayer")}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`px-3 py-1 text-xs rounded-full font-medium ${
                          twoFactorData.enabled
                            ? "bg-[var(--accent-surface)] text-[var(--accent-text)]"
                            : "bg-[var(--status-warning-surface)] text-[var(--status-warning)]"
                        }`}
                      >
                        {twoFactorData.enabled ? t("settings.enabled") : t("settings.disabled")}
                      </span>
                    </div>

                    {/* === Method toggle switches === */}
                    {tfaSetupStep === "idle" && (
                      <div className="mt-4 pt-4 border-t border-[var(--border-input)] space-y-3">
                        <p className="text-sm text-[var(--text-secondary)] mb-2">
                          {t("settings.toggleMethodsDesc")}
                        </p>

                        {/* Email toggle */}
                        <div
                          className={`p-4 flex items-center justify-between ${!profile?.email ? "opacity-60" : ""}`}
                        >
                          <div className="flex items-center gap-4">
                            <div className="flex items-center justify-center shrink-0 w-8">
                              <EmailIcon className="w-6 h-6 text-white" />
                            </div>
                            <div>
                              <p className="font-medium text-sm">{t("login.emailMethod")}</p>
                              <p className="text-xs text-[var(--text-secondary)]">
                                {t("settings.receiveCodesAt")} {profile?.email || t("settings.yourEmail")}
                              </p>
                            </div>
                          </div>
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={twoFactorData.methods.includes("email")}
                              onChange={() => handleToggleMethod("email")}
                              disabled={tfaSaving}
                              className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-[var(--bg-elevated-hover)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--accent)] text-white"></div>
                          </label>
                        </div>

                        {/* Authenticator App toggle */}
                        <div className="p-4 flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <div className="flex items-center justify-center shrink-0 w-8">
                              <MobileIcon className="w-6 h-6 text-white" />
                            </div>
                            <div>
                              <p className="font-medium text-sm">
                                {t("login.authenticatorApp")}
                              </p>
                              <p className="text-xs text-[var(--text-secondary)]">
                                {t("settings.useAuthApp")}
                              </p>
                            </div>
                            <span className="px-2 py-0.5 bg-[var(--accent-surface)] text-[var(--accent-text)] text-[10px] rounded-full">
                              {t("settings.recommended")}
                            </span>
                          </div>
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={twoFactorData.methods.includes("app")}
                              onChange={() => handleToggleMethod("app")}
                              disabled={tfaSaving}
                              className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-[var(--bg-elevated-hover)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--accent)] text-white"></div>
                          </label>
                        </div>

                        {/* Disable all button */}
                        {twoFactorData.enabled &&
                          twoFactorData.methods.length > 0 && (
                            <div className="pt-2">
                              <button
                                onClick={handleDisableAll2FA}
                                disabled={tfaSaving}
                                className="text-sm text-[var(--status-error)] hover:text-red-300 transition-colors disabled:opacity-50"
                              >
                                {t("settings.disableAll2FA")}
                              </button>
                            </div>
                          )}

                        {tfaSaving && (
                          <div className="flex items-center justify-center py-2">
                            <div className="w-4 h-4 border-2 border-[var(--accent)]/30 border-t-[var(--accent)] rounded-full animate-spin"></div>
                            <span className="ml-2 text-xs text-[var(--text-secondary)]">
                              {t("common.updating")}
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* === SETUP APP: Show QR Code === */}
                    {tfaSetupStep === "setup-app" && (
                      <div className="mt-4 pt-4 border-t border-[var(--border-input)]">
                        <div className="text-center">
                          <p className="text-sm text-[var(--text-secondary)] mb-4">
                            {t("settings.scanQRCode")}
                          </p>

                          {tfaQrCode && (
                            <div className="inline-block p-4 bg-white rounded-xl mb-4">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={tfaQrCode}
                                alt="2FA QR Code"
                                className="w-48 h-48"
                              />
                            </div>
                          )}

                          <div className="mb-6">
                            <p className="text-xs text-[var(--text-disabled)] mb-2">
                              {t("settings.orEnterManually")}
                            </p>
                            <div className="inline-flex items-center gap-2 px-4 py-2 bg-transparent rounded-lg">
                              <code className="text-sm text-[#1DB954] font-mono tracking-wider select-all">
                                {tfaSecret}
                              </code>
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(tfaSecret);
                                  setMessage({
                                    type: "success",
                                    text: t("settings.secretCopied"),
                                  });
                                }}
                                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs"
                                title={t("common.copy")}
                              >
                                <ClipboardIcon
                                  size={16}
                                  className="inline-block mr-1 -mt-0.5"
                                />
                              </button>
                            </div>
                          </div>

                          <button
                            onClick={() => setTfaSetupStep("verify-app")}
                            className="w-full px-4 py-3 bg-[#1DB954] hover:opacity-85 text-[var(--text-primary)] rounded-lg font-medium transition-colors"
                          >
                            {t("settings.scannedQRNext")}
                          </button>

                          <button
                            onClick={handleCancelSetup}
                            className="mt-3 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                          >
                            {t("settings.cancelSetup")}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* === VERIFY APP: Enter code from authenticator === */}
                    {tfaSetupStep === "verify-app" && (
                      <div className="mt-4 pt-4 border-t border-[var(--border-primary)]">
                        <div className="text-center">
                          <p className="text-sm text-[var(--text-secondary)] mb-4">
                            {t("settings.enterCodeToVerify")}
                          </p>

                          <div className="flex items-center justify-center gap-2 sm:gap-3 py-4 mb-2">
                            {[0, 1, 2, 3, 4, 5].map((index) => (
                              <div key={index} className="flex items-center">
                                <input
                                  ref={(el) => {
                                    tfaInputRefs.current[index] = el;
                                  }}
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  maxLength={1}
                                  value={tfaVerifyCode[index] || ""}
                                  onChange={(e) => {
                                    const val = e.target.value.replace(
                                      /\D/g,
                                      "",
                                    );
                                    if (!val && e.target.value) return; // Prevent non-numeric

                                    const newCode = tfaVerifyCode.split("");
                                    newCode[index] = val;
                                    const joined = newCode.join("");
                                    setTfaVerifyCode(joined.substring(0, 6));

                                    // Auto-advance
                                    if (val && index < 5) {
                                      tfaInputRefs.current[index + 1]?.focus();
                                    }

                                    // Auto-submit if complete
                                    if (joined.length === 6) {
                                      setTimeout(() => {
                                        handleVerifyAppCode();
                                      }, 50);
                                    }
                                  }}
                                  onKeyDown={(e) => {
                                    if (
                                      e.key === "Backspace" &&
                                      !tfaVerifyCode[index] &&
                                      index > 0
                                    ) {
                                      tfaInputRefs.current[index - 1]?.focus();
                                    }
                                  }}
                                  onPaste={(e) => {
                                    e.preventDefault();
                                    const pasted = e.clipboardData
                                      .getData("text")
                                      .replace(/\D/g, "")
                                      .slice(0, 6);
                                    if (pasted) {
                                      setTfaVerifyCode(pasted);
                                      const nextFocus = Math.min(
                                        pasted.length,
                                        5,
                                      );
                                      if (tfaInputRefs.current[nextFocus]) {
                                        tfaInputRefs.current[
                                          nextFocus
                                        ]?.focus();
                                      } else {
                                        tfaInputRefs.current[5]?.focus();
                                      }
                                      if (pasted.length === 6) {
                                        setTimeout(
                                          () => handleVerifyAppCode(),
                                          50,
                                        );
                                      }
                                    }
                                  }}
                                  className="w-[2.75rem] h-[3.25rem] sm:w-[3.25rem] sm:h-[3.75rem] text-center text-xl sm:text-2xl font-medium rounded-xl border bg-transparent text-[var(--text-primary)] placeholder-[var(--text-disabled)] outline-none transition-all duration-200"
                                  style={{
                                    borderColor: tfaVerifyCode[index]
                                      ? "var(--border-input-hover)"
                                      : "var(--border-input)",
                                  }}
                                  onFocus={(e) => {
                                    e.currentTarget.style.borderColor =
                                      "var(--accent)";
                                    e.currentTarget.style.boxShadow =
                                      "0 0 0 2px rgba(162,56,255,0.2)";
                                  }}
                                  onBlur={(e) => {
                                    e.currentTarget.style.borderColor =
                                      tfaVerifyCode[index]
                                        ? "var(--border-input-hover)"
                                        : "var(--border-input)";
                                    e.currentTarget.style.boxShadow = "none";
                                  }}
                                  autoFocus={index === 0}
                                />
                                {index === 2 && <div className="w-1 sm:w-2" />}
                              </div>
                            ))}
                          </div>

                          <div className="flex gap-3 justify-center">
                            <button
                              onClick={() => setTfaSetupStep("setup-app")}
                              className="px-4 py-2 bg-[var(--bg-elevated)] hover:bg-[var(--bg-elevated-hover)] text-[var(--text-primary)] rounded-lg text-sm transition-colors"
                            >
                              {t("settings.backToQR")}
                            </button>
                            <button
                              onClick={handleVerifyAppCode}
                              disabled={tfaSaving || tfaVerifyCode.length !== 6}
                              className="px-6 py-2 bg-[#1DB954] hover:opacity-85 text-[var(--text-primary)] rounded-lg font-medium transition-colors disabled:opacity-50"
                            >
                              {tfaSaving ? t("login.verifying") : t("settings.verifyAndEnable")}
                            </button>
                          </div>

                          <button
                            onClick={handleCancelSetup}
                            className="mt-4 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors block mx-auto"
                          >
                            {t("settings.cancelSetup")}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* === RECOVERY CODES === */}
                    {tfaSetupStep === "recovery-codes" && (
                      <div className="mt-4 pt-4 border-t border-[var(--border-primary)]">
                        <div className="text-center">
                          <div className="flex justify-center mb-3 text-[var(--status-warning)]">
                            <WarningIcon className="w-8 h-8" />
                          </div>
                          <h4 className="text-lg font-medium text-[var(--text-primary)] mb-2">
                            {t("settings.saveRecoveryCodes")}
                          </h4>
                          <p className="text-sm text-[var(--text-secondary)] mb-4 px-4">
                            {t("settings.recoveryCodesWarning")}
                          </p>

                          <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-lg p-4 mb-4 select-all cursor-text text-left grid grid-cols-2 gap-2">
                            {tfaRecoveryCodes.map((code, idx) => (
                              <div
                                key={idx}
                                className="font-mono text-sm tracking-wider text-[var(--text-primary)]"
                              >
                                {code}
                              </div>
                            ))}
                          </div>

                          <div className="flex flex-col gap-3 max-w-[300px] mx-auto">
                            <button
                              onClick={() => {
                                const content =
                                  "BeAlpha 2FA Recovery Codes\n\nKeep these safe. Each code can only be used once.\n\n" +
                                  tfaRecoveryCodes.join("\n");
                                const blob = new Blob([content], {
                                  type: "text/plain",
                                });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement("a");
                                a.href = url;
                                a.download = "bealpha-recovery-codes.txt";
                                a.click();
                                URL.revokeObjectURL(url);
                              }}
                              className="w-full px-4 py-2 border border-[var(--border-primary)] hover:bg-[var(--bg-elevated)] text-[var(--text-primary)] rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                            >
                              <CloudUploadIcon className="w-4 h-4 rotate-180" />{" "}
                              {t("settings.downloadTxt")}
                            </button>

                            <button
                              onClick={() => {
                                setTfaSetupStep("idle");
                                setTfaRecoveryCodes([]);
                              }}
                              className="w-full px-4 py-2 bg-[#1DB954] hover:opacity-85 text-[var(--text-primary)] rounded-lg font-medium transition-colors"
                            >
                              {t("settings.codesStored")}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="mt-2 px-6 pb-6 bg-transparent rounded-lg">
                    <h3 className="font-medium mb-2">{t("settings.activeSessions")}</h3>
                    <p className="text-sm text-[var(--text-secondary)] mb-4">
                      {t("settings.manageSessionsDesc")}
                    </p>

                    <div className="space-y-3">
                      {sessions.map((session) => (
                        <div
                          key={session.id}
                          className="p-4 bg-[var(--bg-elevated)] rounded-lg flex items-center justify-between border border-[var(--border-primary)]"
                        >
                          <div className="flex items-center gap-4">
                            <div
                              className={`w-10 h-10 rounded-full flex items-center justify-center ${session.isCurrent ? "bg-[var(--accent-surface)] text-[var(--accent-text)]" : "bg-[var(--bg-surface)] text-[var(--text-secondary)]"}`}
                            >
                              {session.deviceType === "mobile" ? (
                                <PhoneIcon size={20} />
                              ) : (
                                <DesktopIcon size={20} />
                              )}
                            </div>
                            <div>
                              <p className="font-medium text-[var(--text-primary)] flex items-center gap-2">
                                {session.deviceName || t("settings.unknownDevice")}
                                {session.isCurrent && (
                                  <span className="px-2 py-0.5 bg-[var(--accent-surface)] text-[var(--accent-text)] text-[10px] rounded-full uppercase tracking-wider font-bold">
                                    {t("settings.thisDevice")}
                                  </span>
                                )}
                              </p>
                              <p className="text-xs text-[var(--text-secondary)] mt-1 flex items-center gap-2">
                                <span>{session.location && session.location !== "Unknown" ? session.location : t("settings.unknownLocation")}</span>
                                <span>•</span>
                                <span>
                                  {t("settings.lastActive")}{" "}
                                  {new Date(
                                    session.lastUsedAt,
                                  ).toLocaleString()}
                                </span>
                              </p>
                            </div>
                          </div>

                          {!session.isCurrent && (
                            <button
                              onClick={() => handleRevokeSession(session.id)}
                              disabled={revokingSession === session.id}
                              className="px-3 py-1.5 text-xs text-[var(--status-error)] hover:bg-[var(--status-error-surface)] rounded-md transition-colors disabled:opacity-50"
                            >
                              {revokingSession === session.id
                                ? t("settings.loggingOut")
                                : t("settings.logOut")}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Notifications Tab */}
              {activeTab === "notifications" && (
                <div>
                  <h2 className="text-xl font-semibold mb-6">
                    {t("settings.notificationSettings")}
                  </h2>

                  <div className="space-y-4">
                    {[
                      {
                        key: "notifyReleases" as const,
                        label: t("settings.newReleaseNotif"),
                        desc: t("settings.newReleaseNotifDesc"),
                      },
                      {
                        key: "notifyRoyalties" as const,
                        label: t("settings.royaltyReportsNotif"),
                        desc: t("settings.royaltyReportsNotifDesc"),
                      },
                      {
                        key: "notifyNews" as const,
                        label: t("settings.platformUpdatesNotif"),
                        desc: t("settings.platformUpdatesNotifDesc"),
                      },
                      {
                        key: "notifyMarketing" as const,
                        label: t("settings.marketingTipsNotif"),
                        desc: t("settings.marketingTipsNotifDesc"),
                      },
                    ].map((item) => (
                      <div
                        key={item.key}
                        className="p-4 bg-[var(--bg-surface)] rounded-lg flex items-center justify-between"
                      >
                        <div>
                          <p className="font-medium">{item.label}</p>
                          <p className="text-sm text-[var(--text-secondary)]">
                            {item.desc}
                          </p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={notifPrefs[item.key]}
                            onChange={(e) =>
                              setNotifPrefs((prev) => ({
                                ...prev,
                                [item.key]: e.target.checked,
                              }))
                            }
                            className="sr-only peer"
                          />
                          <div className="w-11 h-6 bg-[var(--bg-elevated-hover)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--accent)] text-white"></div>
                        </label>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={handleSaveNotifPrefs}
                    disabled={saving}
                    className="mt-6 flex items-center gap-2 px-6 py-3 bg-[var(--accent)] text-[var(--bg-primary)] rounded-lg font-medium hover:opacity-85 transition-colors disabled:opacity-50"
                  >
                    <SaveIcon className="w-5 h-5" />
                    {saving ? t("common.saving") : t("settings.saveSettings")}
                  </button>
                </div>
              )}

              {/* Language Tab */}
              {activeTab === "language" && (
                <div>
                  <h2
                    className="text-lg font-semibold uppercase tracking-wider mb-6 pb-2 border-b border-[var(--border-input)]"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    {t("settings.languageRegion")}
                  </h2>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                        {t("settings.displayLanguage")}
                      </label>
                      <div className="relative">
                        <select
                          value={langPrefs.language}
                          onChange={(e) =>
                            setLangPrefs((prev) => ({
                              ...prev,
                              language: e.target.value,
                            }))
                          }
                          className="w-full px-4 py-3 bg-transparent border border-[var(--border-input)] rounded-md text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] appearance-none pr-10"
                        >
                          {LOCALES.map((loc) => (
                            <option key={loc.code} value={loc.code}>
                              {loc.nativeName}
                            </option>
                          ))}
                        </select>
                        <KeyboardArrowDownIcon className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-secondary)] pointer-events-none" />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                        {t("settings.timezone")}
                      </label>
                      <div className="relative">
                        <select
                          value={langPrefs.timezone}
                          onChange={(e) =>
                            setLangPrefs((prev) => ({
                              ...prev,
                              timezone: e.target.value,
                            }))
                          }
                          className="w-full px-4 py-3 bg-transparent border border-[var(--border-input)] rounded-md text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] appearance-none pr-10"
                        >
                          <option value="Pacific/Honolulu">
                            Pacific/Honolulu (GMT-10)
                          </option>
                          <option value="America/Anchorage">
                            America/Anchorage (GMT-9)
                          </option>
                          <option value="America/Los_Angeles">
                            America/Los Angeles (GMT-8)
                          </option>
                          <option value="America/Denver">
                            America/Denver (GMT-7)
                          </option>
                          <option value="America/Chicago">
                            America/Chicago (GMT-6)
                          </option>
                          <option value="America/New_York">
                            America/New York (GMT-5)
                          </option>
                          <option value="America/Sao_Paulo">
                            America/São Paulo (GMT-3)
                          </option>
                          <option value="Europe/London">
                            Europe/London (GMT+0)
                          </option>
                          <option value="Europe/Paris">
                            Europe/Paris (GMT+1)
                          </option>
                          <option value="Europe/Berlin">
                            Europe/Berlin (GMT+1)
                          </option>
                          <option value="Europe/Moscow">
                            Europe/Moscow (GMT+3)
                          </option>
                          <option value="Asia/Dubai">Asia/Dubai (GMT+4)</option>
                          <option value="Asia/Kolkata">
                            Asia/Kolkata (GMT+5:30)
                          </option>
                          <option value="Asia/Bangkok">
                            Asia/Bangkok (GMT+7)
                          </option>
                          <option value="Asia/Ho_Chi_Minh">
                            Asia/Ho Chi Minh (GMT+7)
                          </option>
                          <option value="Asia/Jakarta">
                            Asia/Jakarta (GMT+7)
                          </option>
                          <option value="Asia/Singapore">
                            Asia/Singapore (GMT+8)
                          </option>
                          <option value="Asia/Shanghai">
                            Asia/Shanghai (GMT+8)
                          </option>
                          <option value="Asia/Tokyo">Asia/Tokyo (GMT+9)</option>
                          <option value="Asia/Seoul">Asia/Seoul (GMT+9)</option>
                          <option value="Australia/Sydney">
                            Australia/Sydney (GMT+11)
                          </option>
                          <option value="Pacific/Auckland">
                            Pacific/Auckland (GMT+12)
                          </option>
                        </select>
                        <KeyboardArrowDownIcon className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-secondary)] pointer-events-none" />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                        {t("settings.currencyDisplay")}
                      </label>
                      <div className="relative">
                        <select
                          value={langPrefs.currency}
                          onChange={(e) =>
                            setLangPrefs((prev) => ({
                              ...prev,
                              currency: e.target.value,
                            }))
                          }
                          className="w-full px-4 py-3 bg-transparent border border-[var(--border-input)] rounded-md text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] appearance-none pr-10"
                        >
                          <option value="USD">USD ($)</option>
                          <option value="VND">VND (₫)</option>
                          <option value="EUR">EUR (€)</option>
                          <option value="GBP">GBP (£)</option>
                          <option value="JPY">JPY (¥)</option>
                          <option value="KRW">KRW (₩)</option>
                          <option value="CNY">CNY (¥)</option>
                          <option value="THB">THB (฿)</option>
                          <option value="AUD">AUD (A$)</option>
                          <option value="CAD">CAD (C$)</option>
                          <option value="SGD">SGD (S$)</option>
                          <option value="BRL">BRL (R$)</option>
                        </select>
                        <KeyboardArrowDownIcon className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-secondary)] pointer-events-none" />
                      </div>
                    </div>

                    <button
                      onClick={handleSaveLangPrefs}
                      disabled={saving}
                      className="flex items-center gap-2 px-6 py-3 bg-[var(--accent)] text-[var(--bg-primary)] rounded-lg font-medium hover:opacity-85 transition-colors disabled:opacity-50"
                    >
                      <SaveIcon className="w-5 h-5" />
                      {saving ? t("common.saving") : t("settings.savePreferences")}
                    </button>
                  </div>
                </div>
              )}

              {/* Appearance Tab */}
              {activeTab === "appearance" && (
                <div>
                  <h2
                    className="text-lg font-semibold mb-6 pb-3"
                    style={{
                      color: "var(--text-primary)",
                      borderBottom: "1px solid var(--border-subtle)",
                    }}
                  >
                    Appearance
                  </h2>

                  <div className="space-y-6">
                    <div>
                      <label
                        className="block text-sm font-medium mb-4"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        {t("settings.theme")}
                      </label>
                      <div className="flex gap-3">
                        {/* Dark mode option */}
                        <button
                          onClick={() => setTheme("dark")}
                          className="flex-1 p-4 rounded-md transition-all cursor-pointer"
                          style={{
                            background:
                              theme === "dark"
                                ? "var(--accent-surface)"
                                : "var(--bg-surface)",
                            border:
                              theme === "dark"
                                ? "2px solid var(--accent)"
                                : "2px solid var(--border-input)",
                          }}
                        >
                          {/* Dark preview */}
                          <div
                            className="w-full h-20 rounded-sm mb-3 overflow-hidden"
                            style={{
                              background: "#000000",
                              border: "1px solid #282828",
                            }}
                          >
                            <div className="flex h-full">
                              <div
                                style={{
                                  width: "30%",
                                  background: "#141414",
                                  borderRight: "1px solid #282828",
                                }}
                              ></div>
                              <div className="flex-1 p-2">
                                <div
                                  className="h-2 w-12 rounded mb-1"
                                  style={{ background: "#333" }}
                                ></div>
                                <div
                                  className="h-2 w-8 rounded"
                                  style={{ background: "#222" }}
                                ></div>
                              </div>
                            </div>
                          </div>
                          <p
                            className="text-sm font-medium"
                            style={{ color: "var(--text-primary)" }}
                          >
                            {t("settings.dark")}
                          </p>
                        </button>

                        {/* Light mode option */}
                        <button
                          onClick={() => setTheme("light")}
                          className="flex-1 p-4 rounded-md transition-all cursor-pointer"
                          style={{
                            background:
                              theme === "light"
                                ? "var(--accent-surface)"
                                : "var(--bg-surface)",
                            border:
                              theme === "light"
                                ? "2px solid var(--accent)"
                                : "2px solid var(--border-input)",
                          }}
                        >
                          {/* Light preview */}
                          <div
                            className="w-full h-20 rounded-sm mb-3 overflow-hidden"
                            style={{
                              background: "#FAFAFA",
                              border: "1px solid #E5E5E5",
                            }}
                          >
                            <div className="flex h-full">
                              <div
                                style={{
                                  width: "30%",
                                  background: "#FFFFFF",
                                  borderRight: "1px solid #E5E5E5",
                                }}
                              ></div>
                              <div className="flex-1 p-2">
                                <div
                                  className="h-2 w-12 rounded mb-1"
                                  style={{ background: "#E0E0E0" }}
                                ></div>
                                <div
                                  className="h-2 w-8 rounded"
                                  style={{ background: "#EBEBEB" }}
                                ></div>
                              </div>
                            </div>
                          </div>
                          <p
                            className="text-sm font-medium"
                            style={{ color: "var(--text-primary)" }}
                          >
                            {t("settings.light")}
                          </p>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </I18nProvider>
  );
}
