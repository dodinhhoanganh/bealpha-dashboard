"use client";

import { useState, useRef, useCallback } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import {
  ShieldIcon,
  EmailIcon,
  MobileIcon,
  PhoneIcon,
  DesktopIcon,
  CloudUploadIcon,
  ClipboardIcon,
  WarningIcon,
} from "@/components/ui/Icon";
import type { UserProfile, ActiveSession, SettingsMessage } from "./types";
import QRCode from "qrcode";
import { apiRequest, clearAccessToken } from "@/lib/api-client";

interface SecurityTabProps {
  profile: UserProfile;
  sessions: ActiveSession[];
  onMessage: (msg: SettingsMessage | null) => void;
  onRefresh: () => void;
  onSessionRevoked: (sessionId: string) => void;
}

export default function SecurityTab({
  profile,
  sessions,
  onMessage,
  onRefresh,
  onSessionRevoked,
}: SecurityTabProps) {
  const { t } = useI18n();

  const [twoFactorData, setTwoFactorData] = useState(() => ({
    enabled: profile.twoFactorEnabled || false,
    methods: profile.twoFactorMethod
      ? profile.twoFactorMethod.split(",").map((m: string) => m.trim()).filter(Boolean)
      : [],
  }));

  const [tfaSetupStep, setTfaSetupStep] = useState<"idle" | "setup-app" | "verify-app" | "verify-email" | "recovery-codes">("idle");
  const [tfaQrCode, setTfaQrCode] = useState("");
  const [tfaSecret, setTfaSecret] = useState("");
  const [tfaPendingSecretToken, setTfaPendingSecretToken] = useState("");
  const [tfaMaskedContact, setTfaMaskedContact] = useState("");
  const [tfaVerifyCode, setTfaVerifyCode] = useState("");
  const tfaInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [tfaSaving, setTfaSaving] = useState(false);
  const [tfaRecoveryCodes, setTfaRecoveryCodes] = useState<string[]>([]);
  const [revokingSession, setRevokingSession] = useState<string | null>(null);

  const handleCancelSetup = useCallback(() => {
    setTfaSetupStep("idle");
    setTfaQrCode("");
    setTfaSecret("");
    setTfaVerifyCode("");
    setTfaMaskedContact("");
    setTfaPendingSecretToken("");
  }, []);

  const handleToggleMethod = async (method: string) => {
    const isCurrentlyEnabled = twoFactorData.methods.includes(method);

    if (!isCurrentlyEnabled && method === "app") {
      setTfaSaving(true);
      onMessage(null);
      try {
        const data = await apiRequest<{
          challengeId: string;
          secret: string;
          otpauthUri: string;
        }>("/api/v1/auth/2fa/setup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        setTfaQrCode(await QRCode.toDataURL(data.otpauthUri));
        setTfaSecret(data.secret);
        setTfaPendingSecretToken(data.challengeId);
        setTfaSetupStep("setup-app");
      } catch (error) {
        onMessage({ type: "error", text: error instanceof Error ? error.message : t("common.failedSetup2FA") });
      } finally {
        setTfaSaving(false);
      }
      return;
    }

    if (!isCurrentlyEnabled && method === "email") {
      setTfaSaving(true);
      onMessage(null);
      try {
        const data = await apiRequest<{
          challengeId: string;
          maskedContact: string;
          expiresIn: number;
        }>("/api/v1/auth/2fa/email/setup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        setTfaPendingSecretToken(data.challengeId);
        setTfaMaskedContact(data.maskedContact);
        setTfaVerifyCode("");
        setTfaSetupStep("verify-email");
      } catch (error) {
        onMessage({ type: "error", text: error instanceof Error ? error.message : t("common.failedSetup2FA") });
      } finally {
        setTfaSaving(false);
      }
      return;
    }

    setTfaSaving(true);
    onMessage(null);

    try {
      if (isCurrentlyEnabled) {
        const password = window.prompt(
          `${t("common.securityCheck2FA")} ${method === "app" ? t("common.authenticatorApp") : t("login.emailMethod")} 2FA.`,
        );
        if (!password) { setTfaSaving(false); return; }

        await apiRequest(`/api/v1/auth/2fa/methods/${method}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        });
        const newMethods = twoFactorData.methods.filter((m) => m !== method);
        setTwoFactorData({ enabled: newMethods.length > 0, methods: newMethods });
        const label = method === "app" ? t("common.authenticatorApp") : t("login.emailMethod");
        onMessage({ type: "success", text: `${label} ${t("common.email2FADisabled")}` });
      }
      clearAccessToken();
      window.location.assign("/login?reauth=security_changed");
    } catch (error) {
      onMessage({ type: "error", text: error instanceof Error ? error.message : t("common.failedUpdate2FA") });
    } finally {
      setTfaSaving(false);
    }
  };

  const handleVerifySetupCode = async () => {
    if (tfaVerifyCode.length !== 6) return;
    setTfaSaving(true);
    onMessage(null);

    try {
      const isEmailSetup = tfaSetupStep === "verify-email";
      const data = await apiRequest<{ recoveryCodes?: string[] }>(
        isEmailSetup ? "/api/v1/auth/2fa/email/setup/verify" : "/api/v1/auth/2fa/setup/verify",
        {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: tfaPendingSecretToken, code: tfaVerifyCode }),
      });
      const enabledMethod = isEmailSetup ? "email" : "app";
      const newMethods = [...new Set([...twoFactorData.methods, enabledMethod])];
      setTwoFactorData({ enabled: true, methods: newMethods });

      if (!isEmailSetup && data.recoveryCodes && data.recoveryCodes.length > 0) {
        setTfaRecoveryCodes(data.recoveryCodes);
        setTfaSetupStep("recovery-codes");
      } else {
        handleCancelSetup();
        onRefresh();
      }
      onMessage({ type: "success", text: isEmailSetup ? t("common.email2FAEnabled") : t("settings.app2FAEnabled") });
    } catch (error) {
      onMessage({ type: "error", text: error instanceof Error ? error.message : t("common.verificationFailed") });
    } finally {
      setTfaSaving(false);
    }
  };

  const handleDisableAll2FA = async () => {
    const password = window.prompt(t("settings.disableAll2FAPrompt"));
    if (!password) return;

    setTfaSaving(true);
    onMessage(null);

    try {
      await apiRequest("/api/v1/auth/2fa", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      setTwoFactorData({ enabled: false, methods: [] });
      handleCancelSetup();
      onMessage({ type: "success", text: t("settings.all2FADisabled") });
      clearAccessToken();
      window.location.assign("/login?reauth=security_changed");
    } catch (error) {
      onMessage({ type: "error", text: error instanceof Error ? error.message : t("common.failedDisable2FA") });
    } finally {
      setTfaSaving(false);
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    setRevokingSession(sessionId);
    onMessage(null);
    try {
      await apiRequest(`/api/v1/auth/sessions/${sessionId}`, { method: "DELETE" });
      onSessionRevoked(sessionId);
      onMessage({ type: "success", text: t("settings.sessionRevoked") });
    } catch (error) {
      onMessage({ type: "error", text: error instanceof Error ? error.message : t("common.failedRevokeSession") });
    } finally {
      setRevokingSession(null);
    }
  };

  return (
    <div>
      <h2 className="text-xl font-semibold mb-6">{t("settings.securitySettings")}</h2>

      {/* 2FA Section */}
      <div className="p-6 bg-transparent rounded-lg">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center shrink-0 mr-1">
              <ShieldIcon size={24} className="text-[var(--text-primary)]" />
            </div>
            <div>
              <h3 className="font-medium">{t("settings.twoFactor")}</h3>
              <p className="text-sm text-[var(--text-secondary)]">
                {twoFactorData.enabled
                  ? `${twoFactorData.methods.length} ${t("settings.methodsActive")}`
                  : t("settings.addExtraLayer")}
              </p>
            </div>
          </div>
          <span className={`px-3 py-1 text-xs rounded-full font-medium ${twoFactorData.enabled ? "bg-[var(--accent-surface)] text-[var(--accent-text)]" : "bg-[var(--status-warning-surface)] text-[var(--status-warning)]"}`}>
            {twoFactorData.enabled ? t("settings.enabled") : t("settings.disabled")}
          </span>
        </div>

        {/* Method toggles */}
        {tfaSetupStep === "idle" && (
          <div className="mt-4 pt-4 border-t border-[var(--border-input)] space-y-3">
            <p className="text-sm text-[var(--text-secondary)] mb-2">{t("settings.toggleMethodsDesc")}</p>

            {/* Email toggle */}
            <div className={`p-4 flex items-center justify-between ${!profile?.email ? "opacity-60" : ""}`}>
              <div className="flex items-center gap-4">
                <div className="flex items-center justify-center shrink-0 w-8"><EmailIcon className="w-6 h-6 text-[var(--text-primary)]" /></div>
                <div>
                  <p className="font-medium text-sm">{t("login.emailMethod")}</p>
                  <p className="text-xs text-[var(--text-secondary)]">{t("settings.receiveCodesAt")} {profile?.email || t("settings.yourEmail")}</p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" checked={twoFactorData.methods.includes("email")} onChange={() => handleToggleMethod("email")} disabled={tfaSaving} className="sr-only peer" />
                <div className="w-11 h-6 bg-[var(--bg-elevated-hover)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--accent)] text-white"></div>
              </label>
            </div>

            {/* App toggle */}
            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex items-center justify-center shrink-0 w-8"><MobileIcon className="w-6 h-6 text-[var(--text-primary)]" /></div>
                <div>
                  <p className="font-medium text-sm">{t("login.authenticatorApp")}</p>
                  <p className="text-xs text-[var(--text-secondary)]">{t("settings.useAuthApp")}</p>
                </div>
                <span className="px-2 py-0.5 bg-[var(--accent-surface)] text-[var(--accent-text)] text-[10px] rounded-full">{t("settings.recommended")}</span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" checked={twoFactorData.methods.includes("app")} onChange={() => handleToggleMethod("app")} disabled={tfaSaving} className="sr-only peer" />
                <div className="w-11 h-6 bg-[var(--bg-elevated-hover)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--accent)] text-white"></div>
              </label>
            </div>

            {twoFactorData.enabled && twoFactorData.methods.length > 0 && (
              <div className="pt-2">
                <button onClick={handleDisableAll2FA} disabled={tfaSaving} className="text-sm text-[var(--status-error)] hover:text-red-300 transition-colors disabled:opacity-50">
                  {t("settings.disableAll2FA")}
                </button>
              </div>
            )}

            {tfaSaving && (
              <div className="flex items-center justify-center py-2">
                <div className="w-4 h-4 border-2 border-[var(--accent)]/30 border-t-[var(--accent)] rounded-full animate-spin"></div>
                <span className="ml-2 text-xs text-[var(--text-secondary)]">{t("common.updating")}</span>
              </div>
            )}
          </div>
        )}

        {/* Setup App: QR Code */}
        {tfaSetupStep === "setup-app" && (
          <div className="mt-4 pt-4 border-t border-[var(--border-input)]">
            <div className="text-center">
              <p className="text-sm text-[var(--text-secondary)] mb-4">{t("settings.scanQRCode")}</p>
              {tfaQrCode && (
                <div className="inline-block p-4 bg-white rounded-xl mb-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={tfaQrCode} alt={t("ui.securityTab.value2faQRCode", "2FA QR Code")} className="w-48 h-48" />
                </div>
              )}
              <div className="mb-6">
                <p className="text-xs text-[var(--text-disabled)] mb-2">{t("settings.orEnterManually")}</p>
                <div className="inline-flex items-center gap-2 px-4 py-2 bg-transparent rounded-lg">
                  <code className="text-sm text-[#1DB954] font-mono tracking-wider select-all">{tfaSecret}</code>
                  <button onClick={() => { navigator.clipboard.writeText(tfaSecret); onMessage({ type: "success", text: t("settings.secretCopied") }); }}
                    className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs" title={t("common.copy")}>
                    <ClipboardIcon size={16} className="inline-block mr-1 -mt-0.5" />
                  </button>
                </div>
              </div>
              <button onClick={() => setTfaSetupStep("verify-app")} className="w-full px-4 py-3 bg-[#1DB954] hover:opacity-85 text-[var(--text-primary)] rounded-lg font-medium transition-colors">
                {t("settings.scannedQRNext")}
              </button>
              <button onClick={handleCancelSetup} className="mt-3 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                {t("settings.cancelSetup")}
              </button>
            </div>
          </div>
        )}

        {/* Verify App: Enter code */}
        {(tfaSetupStep === "verify-app" || tfaSetupStep === "verify-email") && (
          <div className="mt-4 pt-4 border-t border-[var(--border-primary)]">
            <div className="text-center">
              <p className="text-sm text-[var(--text-secondary)] mb-1">
                {tfaSetupStep === "verify-email"
                  ? t("login.enterCodeSentTo")
                  : t("settings.enterCodeToVerify")}
              </p>
              {tfaSetupStep === "verify-email" && (
                <p className="mb-4 text-xs font-medium text-[var(--text-primary)]">{tfaMaskedContact}</p>
              )}
              <div className="flex items-center justify-center gap-2 sm:gap-3 py-4 mb-2">
                {[0, 1, 2, 3, 4, 5].map((index) => (
                  <div key={index} className="flex items-center">
                    <input
                      ref={(el) => { tfaInputRefs.current[index] = el; }}
                      type="text" inputMode="numeric" pattern="[0-9]*" maxLength={1}
                      value={tfaVerifyCode[index] || ""}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, "");
                        if (!val && e.target.value) return;
                        const newCode = tfaVerifyCode.split("");
                        newCode[index] = val;
                        const joined = newCode.join("");
                        setTfaVerifyCode(joined.substring(0, 6));
                        if (val && index < 5) tfaInputRefs.current[index + 1]?.focus();
                      }}
                      onKeyDown={(e) => { if (e.key === "Backspace" && !tfaVerifyCode[index] && index > 0) tfaInputRefs.current[index - 1]?.focus(); }}
                      onPaste={(e) => {
                        e.preventDefault();
                        const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
                        if (pasted) {
                          setTfaVerifyCode(pasted);
                          const nextFocus = Math.min(pasted.length, 5);
                          tfaInputRefs.current[nextFocus]?.focus();
                        }
                      }}
                      className="w-[2.75rem] h-[3.25rem] sm:w-[3.25rem] sm:h-[3.75rem] text-center text-xl sm:text-2xl font-medium rounded-xl border bg-transparent text-[var(--text-primary)] placeholder-[var(--text-disabled)] outline-none transition-all duration-200"
                      style={{ borderColor: tfaVerifyCode[index] ? "var(--border-input-hover)" : "var(--border-input)" }}
                      onFocus={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.boxShadow = "0 0 0 2px rgba(162,56,255,0.2)"; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = tfaVerifyCode[index] ? "var(--border-input-hover)" : "var(--border-input)"; e.currentTarget.style.boxShadow = "none"; }}
                      autoFocus={index === 0}
                    />
                    {index === 2 && <div className="w-1 sm:w-2" />}
                  </div>
                ))}
              </div>
              <div className="flex gap-3 justify-center">
                <button onClick={() => tfaSetupStep === "verify-email" ? handleCancelSetup() : setTfaSetupStep("setup-app")} className="px-4 py-2 bg-[var(--bg-elevated)] hover:bg-[var(--bg-elevated-hover)] text-[var(--text-primary)] rounded-lg text-sm transition-colors">
                  {tfaSetupStep === "verify-email" ? t("common.cancel") : t("settings.backToQR")}
                </button>
                <button onClick={handleVerifySetupCode} disabled={tfaSaving || tfaVerifyCode.length !== 6}
                  className="px-6 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)] rounded-lg font-medium transition-colors disabled:opacity-50">
                  {tfaSaving ? t("login.verifying") : t("settings.verifyAndEnable")}
                </button>
              </div>
              <button onClick={handleCancelSetup} className="mt-4 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors block mx-auto">
                {t("settings.cancelSetup")}
              </button>
            </div>
          </div>
        )}

        {/* Recovery Codes */}
        {tfaSetupStep === "recovery-codes" && (
          <div className="mt-4 pt-4 border-t border-[var(--border-primary)]">
            <div className="text-center">
              <div className="flex justify-center mb-3 text-[var(--status-warning)]"><WarningIcon className="w-8 h-8" /></div>
              <h4 className="text-lg font-medium text-[var(--text-primary)] mb-2">{t("settings.saveRecoveryCodes")}</h4>
              <p className="text-sm text-[var(--text-secondary)] mb-4 px-4">{t("settings.recoveryCodesWarning")}</p>
              <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-lg p-4 mb-4 select-all cursor-text text-left grid grid-cols-2 gap-2">
                {tfaRecoveryCodes.map((code, idx) => (
                  <div key={idx} className="font-mono text-sm tracking-wider text-[var(--text-primary)]">{code}</div>
                ))}
              </div>
              <div className="flex flex-col gap-3 max-w-[300px] mx-auto">
                <button
                  onClick={() => {
                    const content = t("common.recoveryCodesHeader") + "\n\n" + t("common.recoveryCodesInstruction") + "\n\n" + tfaRecoveryCodes.join("\n");
                    const blob = new Blob([content], { type: "text/plain" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "bealpha-recovery-codes.txt";
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="w-full px-4 py-2 border border-[var(--border-primary)] hover:bg-[var(--bg-elevated)] text-[var(--text-primary)] rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                >
                  <CloudUploadIcon className="w-4 h-4 rotate-180" /> {t("settings.downloadTxt")}
                </button>
                <button onClick={() => { handleCancelSetup(); onRefresh(); }}
                  className="w-full px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast)] rounded-lg font-medium transition-colors">
                  {t("settings.codesStored")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Active Sessions */}
      <div className="mt-2 px-6 pb-6 bg-transparent rounded-lg">
        <h3 className="font-medium mb-2">{t("settings.activeSessions")}</h3>
        <p className="text-sm text-[var(--text-secondary)] mb-4">{t("settings.manageSessionsDesc")}</p>
        <div className="space-y-3">
          {sessions.map((session) => (
            <div key={session.id} className="p-4 bg-[var(--bg-elevated)] rounded-lg flex items-center justify-between border border-[var(--border-primary)]">
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${session.isCurrent ? "bg-[var(--accent-surface)] text-[var(--accent-text)]" : "bg-[var(--bg-surface)] text-[var(--text-secondary)]"}`}>
                  {session.deviceType === "mobile" ? <PhoneIcon size={20} /> : <DesktopIcon size={20} />}
                </div>
                <div>
                  <p className="font-medium text-[var(--text-primary)] flex items-center gap-2">
                    {session.deviceName || t("settings.unknownDevice")}
                    {session.isCurrent && (
                      <span className="px-2 py-0.5 bg-[var(--accent-surface)] text-[var(--accent-text)] text-[10px] rounded-full uppercase tracking-wider font-bold">{t("settings.thisDevice")}</span>
                    )}
                  </p>
                  <p className="text-xs text-[var(--text-secondary)] mt-1 flex items-center gap-2">
                    <span>{session.location && session.location !== "Unknown" ? session.location : t("settings.unknownLocation")}</span>
                    <span>•</span>
                    <span>{t("settings.lastActive")} {new Date(session.lastUsedAt).toLocaleString()}</span>
                  </p>
                </div>
              </div>
              {!session.isCurrent && (
                <button onClick={() => handleRevokeSession(session.id)} disabled={revokingSession === session.id}
                  className="px-3 py-1.5 text-xs text-[var(--status-error)] hover:bg-[var(--status-error-surface)] rounded-md transition-colors disabled:opacity-50">
                  {revokingSession === session.id ? t("settings.loggingOut") : t("settings.logOut")}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
