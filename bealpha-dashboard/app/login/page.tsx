"use client";

import { useEffect, useState, useRef } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTheme } from "@/components/ThemeProvider";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { translateApiError } from "@/lib/i18n/translateApiError";
import { LOCALES } from "@/lib/i18n";
import {
  LockOutlinedIcon,
  VisibilityIcon,
  VisibilityOffIcon,
  EmailIcon,
  SecurityIcon,
  MobileIcon,
  ArrowBackIcon,
} from "@/components/Icon";
import InteractiveBackground from "@/components/InteractiveBackground";
import {
  ApiClientError,
  publicApiRequest,
  startAuthSession,
} from "@/lib/api-client";
import { brandCssTokens, DEFAULT_BRAND, type TenantBrand } from "@/lib/tenant-brand";

type Step = "credentials" | "choose-method" | "verify-code";
type TwoFactorMethod = "email" | "app" | "recovery";

export default function LoginPage() {
  const router = useRouter();
  const { theme } = useTheme();
  const { t, language, setLanguage } = useI18n();
  const [langOpen, setLangOpen] = useState(false);
  const langRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // 2FA states
  const [availableMethods, setAvailableMethods] = useState<TwoFactorMethod[]>(
    [],
  );
  const [selectedMethod, setSelectedMethod] = useState<TwoFactorMethod | null>(
    null,
  );
  const [verificationCode, setVerificationCode] = useState("");
  const [tempToken, setTempToken] = useState("");
  const [maskedContact, setMaskedContact] = useState("");
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [rememberMe, setRememberMe] = useState(false);
  const [brand, setBrand] = useState<TenantBrand>(DEFAULT_BRAND);
  const [brandReady, setBrandReady] = useState(false);

  const [deviceName, setDeviceName] = useState("");
  const [deviceType, setDeviceType] = useState("");

  // Close language dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) {
        setLangOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    let cancelled = false;
    publicApiRequest<TenantBrand>("/api/v1/catalog/public-tenant-brand")
      .catch(() => DEFAULT_BRAND)
      .then((resolved) => {
        if (cancelled) return;
        setBrand(resolved);
        for (const [name, value] of Object.entries(brandCssTokens(resolved))) document.documentElement.style.setProperty(name, value);
        document.title = `${resolved.displayName} - Sign in`;
        setBrandReady(true);
      });
    return () => { cancelled = true; };
  }, []);

  // Describe the current device for session management.
  useEffect(() => {
    const ua = navigator.userAgent;
    let type = "desktop";
    if (
      /Mobile|Android|iP(hone|od)|IEMobile|BlackBerry|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/.test(
        ua,
      )
    )
      type = "mobile";
    else if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua))
      type = "tablet";
    setDeviceType(type);

    let os = "Unknown Device";
    if (ua.indexOf("Win") !== -1) os = "Windows PC";
    if (ua.indexOf("Mac") !== -1) os = "Mac";
    if (ua.indexOf("Linux") !== -1) os = "Linux PC";
    if (ua.indexOf("Android") !== -1) os = "Android Device";
    if (ua.indexOf("like Mac") !== -1) os = "iOS Device";
    setDeviceName(os);
  }, []);

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await startAuthSession("/api/v1/auth/login", {
        email,
        password,
        rememberMe,
        deviceName,
        deviceType,
      });
      setTimeout(() => {
        router.push("/");
        router.refresh();
      }, 600);
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "TWO_FACTOR_REQUIRED") {
        const details = error.details as { challengeId?: string; methods?: TwoFactorMethod[] } | undefined;
        setAvailableMethods(details?.methods ?? []);
        setTempToken(details?.challengeId ?? "");
        setStep("choose-method");
      } else if (error instanceof ApiClientError) {
        setError(translateApiError(error.code, t));
      } else {
        setError(t("login.errorOccurred"));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleMethodSelect = async (method: TwoFactorMethod) => {
    setSelectedMethod(method);
    setError("");
    setLoading(true);

    try {
      if (method === "app" || method === "recovery") {
        setStep("verify-code");
        setLoading(false);
        return;
      }

      const data = await publicApiRequest<{ maskedContact: string }>("/api/v1/auth/2fa/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: tempToken, method }),
      });
      setMaskedContact(data.maskedContact || "");
      setStep("verify-code");
    } catch (error) {
      setError(error instanceof ApiClientError ? translateApiError(error.code, t) : t("login.errorOccurred"));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (
      (selectedMethod === "recovery" && verificationCode.length !== 9) ||
      (selectedMethod !== "recovery" && verificationCode.length !== 6)
    ) return;
    setError("");
    setLoading(true);

    try {
      await startAuthSession("/api/v1/auth/2fa/verify", {
        challengeId: tempToken,
        code: verificationCode,
        method: selectedMethod,
        deviceType,
        deviceName,
      });
      setTimeout(() => {
        router.push("/");
        router.refresh();
      }, 600);
    } catch (error) {
      setError(error instanceof ApiClientError ? translateApiError(error.code, t) : t("login.errorOccurred"));
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (!selectedMethod || selectedMethod === "app") return;
    setError("");
    setLoading(true);

    try {
      await publicApiRequest("/api/v1/auth/2fa/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: tempToken, method: selectedMethod }),
      });
    } catch (error) {
      setError(error instanceof ApiClientError ? translateApiError(error.code, t) : t("login.errorOccurred"));
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    if (step === "verify-code") {
      setStep("choose-method");
      setVerificationCode("");
    } else if (step === "choose-method") {
      setStep("credentials");
      setTempToken("");
    }
    setError("");
  };

  const getMethodIcon = (method: TwoFactorMethod) => {
    switch (method) {
      case "email":
        return <EmailIcon size={25} />;
      case "app":
        return <MobileIcon size={25} />;
      case "recovery":
        return <SecurityIcon size={25} />;
    }
  };

  const getMethodLabel = (method: TwoFactorMethod) => {
    switch (method) {
      case "email":
        return t("login.emailMethod");
      case "app":
        return t("login.authenticatorApp");
      case "recovery":
        return t("login.recoveryCode");
    }
  };

  const getMethodDescription = (method: TwoFactorMethod) => {
    switch (method) {
      case "email":
        return t("login.emailDesc");
      case "app":
        return t("login.appDesc");
      case "recovery":
        return t("login.recoveryDesc");
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden"
      style={{ background: "var(--bg-primary)" }}
    >
      <InteractiveBackground />

      {/* ═══════════ Language Switcher (top-right) ═══════════ */}
      <div ref={langRef} className="fixed z-30" style={{ top: "1.5rem", right: "1.5rem" }}>
        <button
          onClick={() => setLangOpen(!langOpen)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-200 backdrop-blur-xl"
          style={{
            background: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(255,255,255,0.15)",
            color: "var(--text-secondary)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.14)";
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.25)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.08)";
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)";
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
          {LOCALES.find((l) => l.code === language)?.nativeName || "English"}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`transition-transform duration-200 ${langOpen ? "rotate-180" : ""}`}>
            <path d="M6 9l6 6 6-6"/>
          </svg>
        </button>

        {langOpen && (
          <div
            className="absolute right-0 mt-2 w-56 max-h-80 overflow-y-auto rounded-xl py-1"
            style={{
              background: "rgba(20,20,25,0.95)",
              backdropFilter: "blur(20px)",
              border: "1px solid rgba(255,255,255,0.12)",
              boxShadow: "0 20px 40px rgba(0,0,0,0.5)",
              animation: "fadeIn 0.15s ease-out",
            }}
          >
            {LOCALES.map((locale) => (
              <button
                key={locale.code}
                onClick={() => {
                  setLanguage(locale.code);
                  setLangOpen(false);
                }}
                className={`w-full text-left px-4 py-2.5 text-sm transition-colors duration-150 flex items-center justify-between ${
                  language === locale.code
                    ? "text-white bg-white/10"
                    : "text-white/70 hover:text-white hover:bg-white/5"
                }`}
              >
                <span>{locale.nativeName}</span>
                {language === locale.code && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 13l4 4L19 7"/>
                  </svg>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {!brandReady && <div role="status" aria-label={t("common.loading", "Loading")} className="absolute inset-0 z-30 bg-[var(--bg-primary)]" />}

      {/* ═══════════ Floating Logo ═══════════ */}
      <div className="absolute top-12 left-1/2 -translate-x-1/2 z-20 flex items-center justify-center w-[500px] h-[100px]">
        <Image
          src={
            brand.logoUrl ?? (theme === "dark"
              ? "/logo-white.png"
              : "/logo-black.png")
          }
          alt={`${brand.displayName} logo`}
          width={360}
          height={80}
          priority
          unoptimized
          className={brand.logoUrl ? "h-20 w-[360px] object-contain" : "h-auto w-[360px] object-contain"}
          style={{
            filter:
              theme === "dark"
                ? "drop-shadow(0 4px 20px rgba(0,0,0,0.8))"
                : "drop-shadow(0 4px 12px rgba(0,0,0,0.2))",
          }}
        />
      </div>

      {/* ═══════════ Login Card ═══════════ */}
      <div className="relative z-10 mx-4 w-full max-w-md rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-surface)] p-8 shadow-xl md:p-10">
        {/* Step title */}
        <div className="mb-6 text-center">
          <h2
            className="font-bold leading-tight"
            style={{
              fontSize: "32px",
              color: "var(--text-primary)",
              letterSpacing: "-0.04em",
              marginBottom: step !== "credentials" ? "8px" : "0",
            }}
          >
            {step === "credentials" && t("login.welcomeBack")}
            {step === "choose-method" && t("login.verifyIdentity")}
            {step === "verify-code" && t("login.enterCode")}
          </h2>
          {step !== "credentials" && (
            <p
              className="text-[15px]"
              style={{ color: "var(--text-tertiary)" }}
            >
              {step === "choose-method" &&
                t("login.chooseMethod")}
              {step === "verify-code" &&
                selectedMethod === "app" &&
                t("login.enterAuthCode")}
              {step === "verify-code" &&
                selectedMethod === "recovery" &&
                t("login.enterRecoveryCode")}
              {step === "verify-code" &&
                selectedMethod === "email" &&
                `${t("login.codeSentTo")} ${maskedContact}`}
            </p>
          )}
        </div>

        <hr
          className="border-t mb-8 -mx-8 md:-mx-10"
          style={{ borderColor: "var(--border-primary)" }}
        />

        {/* Back button for 2FA steps */}
        {step !== "credentials" && (
          <button
            onClick={handleBack}
            className="flex items-center gap-2 mb-2 transition-colors duration-200"
            style={{ color: "var(--text-tertiary)" }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.color = "var(--text-primary)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.color = "var(--text-tertiary)")
            }
          >
            <ArrowBackIcon size={16} />
            <span className="text-sm font-medium">{t("login.back")}</span>
          </button>
        )}

        {/* Error */}
        {error && (
          <div
            className="mb-6 p-3.5 rounded-xl text-sm flex items-center gap-2"
            style={{
              background: "var(--status-error-surface)",
              border: "1px solid rgba(248,113,113,0.2)",
              color: "var(--status-error)",
              animation: "fadeIn 0.2s ease-out",
            }}
          >
            <span className="text-base"></span>
            {error}
          </div>
        )}

        {/* ─── Step 1: Credentials ─── */}
        {step === "credentials" && (
          <form
            onSubmit={handleCredentialsSubmit}
            className="space-y-5"
            suppressHydrationWarning
          >
            <div>
              <label
                htmlFor="email"
                className="block text-xs font-semibold mb-2 uppercase tracking-[0.08em]"
                style={{ color: "var(--text-tertiary)" }}
              >
                {t("login.email")}
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="input-field"
                placeholder={t("placeholder.email", "Enter email address")}
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-xs font-semibold mb-2 uppercase tracking-[0.08em]"
                style={{ color: "var(--text-tertiary)" }}
              >
                {t("login.password")}
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="input-field pr-12 [&::-ms-reveal]:hidden [&::-ms-clear]:hidden"
                  placeholder={t("login.enterPassword")}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded transition-colors duration-150"
                  style={{ color: "var(--text-disabled)" }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.color = "var(--text-secondary)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.color = "var(--text-disabled)")
                  }
                >
                  {showPassword ? (
                    <VisibilityOffIcon size={18} />
                  ) : (
                    <VisibilityIcon size={18} />
                  )}
                </button>
              </div>
            </div>

            {/* Remember me */}
            <label className="flex items-center gap-3 pt-1 cursor-pointer select-none">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="sr-only peer"
                />
                <div
                  className={`w-[18px] h-[18px] rounded-[5px] border-2 transition-all duration-200 flex items-center justify-center ${rememberMe ? "border-[var(--accent)] bg-[var(--accent)]" : "border-white/40 bg-white/10 hover:border-white/60"}`}
                >
                  {rememberMe && (
                    <svg
                      className="w-2.5 h-2.5 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={3.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  )}
                </div>
              </div>
              <span
                className="text-sm"
                style={{ color: "var(--text-tertiary)" }}
              >
                {t("login.rememberDevice")}
              </span>
            </label>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-3.5 text-[15px] mt-2"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2.5">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {t("login.signingIn")}
                </span>
              ) : (
                t("login.signIn")
              )}
            </button>
          </form>
        )}

        {/* ─── Step 2: Choose 2FA Method ─── */}
        {step === "choose-method" && (
          <div className="space-y-1">
            <div className="flex flex-col gap-1">
              {availableMethods.map((method) => (
                <button
                  key={method}
                  onClick={() => handleMethodSelect(method)}
                  disabled={loading}
                  className="group w-full flex items-center gap-4 py-4 px-1 rounded-xl transition-colors duration-200 text-left disabled:opacity-50 hover:bg-white/5 bg-transparent"
                >
                  <div className="flex items-center justify-center shrink-0 w-10 text-white/60 group-hover:text-white transition-colors duration-200">
                    {getMethodIcon(method)}
                  </div>
                  <div>
                    <p className="font-semibold text-[17px] text-white group-hover:text-white transition-colors">
                      {getMethodLabel(method)}
                    </p>
                    <p className="text-[14px] mt-0.5 text-white/50 group-hover:text-white/70 transition-colors">
                      {getMethodDescription(method)}
                    </p>
                  </div>
                </button>
              ))}
            </div>
            {loading && (
              <div className="flex items-center justify-center py-4 gap-3">
                <div
                  className="w-5 h-5 border-2 rounded-full animate-spin"
                  style={{
                    borderColor: "var(--border-primary)",
                    borderTopColor: "var(--accent)",
                  }}
                />
                <span
                  className="text-sm"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  {t("login.sendingCode")}
                </span>
              </div>
            )}
          </div>
        )}

        {/* ─── Step 3: Verify Code ─── */}
        {step === "verify-code" && (
          <form
            onSubmit={handleVerifyCode}
            className="space-y-6"
            suppressHydrationWarning
          >
            <div className="text-center mb-2">
              <div className="flex items-center justify-center mb-4 text-white opacity-90">
                <LockOutlinedIcon size={40} />
              </div>
              <h3 className="text-2xl font-bold text-white tracking-tight mb-2">
                {t("login.securityCheck")}
              </h3>
              <p className="text-sm text-white/70">
                {selectedMethod === "app"
                    ? t("login.enterAuthCode")
                    : selectedMethod === "recovery"
                      ? t("login.enterRecoveryCode")
                      : `${t("login.codeSentTo")} ${maskedContact || t("login.email")}`}
              </p>
            </div>

            {selectedMethod === "recovery" ? (
              <div className="py-2">
                <input
                  type="text"
                  value={verificationCode}
                  onChange={(e) => {
                    let val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
                    if (val.length > 4) {
                      val = val.substring(0, 4) + "-" + val.substring(4, 8);
                    }
                    setVerificationCode(val);
                  }}
                  maxLength={9}
                  placeholder={t("placeholder.2faCode", "Enter 6-digit authentication code")}
                  className="w-full px-4 py-4 bg-transparent border border-[rgba(255,255,255,0.2)] rounded-xl text-white text-center text-xl tracking-[0.2em] font-mono focus:outline-none focus:border-[var(--accent)] transition-colors"
                  autoFocus
                />
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 sm:gap-3 py-2">
                {[0, 1, 2, 3, 4, 5].map((index) => (
                  <div key={index} className="flex items-center">
                    <input
                      ref={(el) => {
                        inputRefs.current[index] = el;
                      }}
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={1}
                      value={verificationCode[index] || ""}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, "");
                        if (!val && e.target.value) return; // Prevent non-numeric

                        const newCode = verificationCode.split("");
                        newCode[index] = val;
                        const joined = newCode.join("");
                        setVerificationCode(joined.substring(0, 6));

                        // Auto-advance
                        if (val && index < 5) {
                          inputRefs.current[index + 1]?.focus();
                        }

                        // Auto-submit if complete
                        if (joined.length === 6) {
                          // Small delay to let the state update
                          const form = e.target.closest("form");
                          setTimeout(() => {
                            if (form) form.requestSubmit();
                          }, 50);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (
                          e.key === "Backspace" &&
                          !verificationCode[index] &&
                          index > 0
                        ) {
                          inputRefs.current[index - 1]?.focus();
                        }
                      }}
                      onPaste={(e) => {
                        e.preventDefault();
                        const pasted = e.clipboardData
                          .getData("text")
                          .replace(/\D/g, "")
                          .slice(0, 6);
                        if (pasted) {
                          setVerificationCode(pasted);
                          const nextFocus = Math.min(pasted.length, 5);
                          if (inputRefs.current[nextFocus]) {
                            inputRefs.current[nextFocus]?.focus();
                          } else {
                            inputRefs.current[5]?.focus();
                          }
                          if (pasted.length === 6) {
                            const form = e.currentTarget.closest("form");
                            setTimeout(() => {
                              if (form) form.requestSubmit();
                            }, 50);
                          }
                        }
                      }}
                      required
                      className="w-[2.75rem] h-[3.25rem] sm:w-[3.25rem] sm:h-[3.75rem] text-center text-xl sm:text-2xl font-medium rounded-xl border bg-white/5 text-white placeholder-white/20 outline-none transition-all duration-200"
                      style={{
                        borderColor: verificationCode[index]
                          ? "rgba(255,255,255,0.4)"
                          : "rgba(255,255,255,0.1)",
                      }}
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = "var(--accent)";
                        e.currentTarget.style.boxShadow =
                          "0 0 0 2px rgba(162,56,255,0.2)";
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = verificationCode[
                          index
                        ]
                          ? "rgba(255,255,255,0.4)"
                          : "rgba(255,255,255,0.1)";
                        e.currentTarget.style.boxShadow = "none";
                      }}
                    />
                    {index === 2 && <div className="w-1 sm:w-2" />}{" "}
                    {/* Gap between 3rd and 4th */}
                  </div>
                ))}
              </div>
            )}

            <button
              type="submit"
              disabled={
                loading ||
                (selectedMethod === "recovery"
                  ? verificationCode.length !== 9
                  : verificationCode.length !== 6)
              }
              className={`w-full py-3.5 text-[15px] font-medium rounded-xl transition-all duration-300 ${(selectedMethod === "recovery" ? verificationCode.length === 9 : verificationCode.length === 6) ? "bg-[var(--accent)] hover:brightness-110 text-white shadow-lg" : "bg-white/10 text-white/50 cursor-not-allowed"}`}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2.5">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {t("login.verifying")}
                </span>
              ) : selectedMethod === "recovery" ? (
                verificationCode.length === 9 ? (
                  t("login.verify")
                ) : (
                  t("login.enterCodePrompt")
                )
              ) : verificationCode.length === 6 ? (
                t("login.verify")
              ) : (
                `${6 - verificationCode.length} ${t("login.digitsLeft")}`
              )}
            </button>

            {selectedMethod !== "app" && selectedMethod !== "recovery" && (
              <button
                type="button"
                onClick={handleResendCode}
                disabled={loading}
                className="w-full text-center text-sm transition-colors duration-200 disabled:opacity-50"
                style={{ color: "var(--accent-text)" }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.color = "var(--accent)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.color = "var(--accent-text)")
                }
              >
                {t("login.resendCode")}
              </button>
            )}

            {(selectedMethod === "app" ||
              (selectedMethod !== "recovery" &&
                availableMethods.includes("app"))) && (
              <button
                type="button"
                onClick={() => {
                  setVerificationCode("");
                  setSelectedMethod("recovery");
                }}
                disabled={loading}
                className="w-full text-center text-sm transition-colors duration-200 disabled:opacity-50 mt-2"
                style={{ color: "var(--accent-text)" }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.color = "var(--accent)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.color = "var(--accent-text)")
                }
              >
                {t("login.useRecoveryCode")}
              </button>
            )}
          </form>
        )}
      </div>

      {/* ═══════════ Footer / Copyright ═══════════ */}
      <div className="absolute bottom-6 left-0 right-0 text-center z-20">
        <p className="text-[12px] font-normal text-slate-500 drop-shadow-md">
          &copy; {new Date().getFullYear()} {brand.displayName}. {t("login.copyright")}
          {brand.supportUrl ? <> · <a href={brand.supportUrl} className="underline underline-offset-2">{t("common.support", "Support")}</a></> : brand.supportEmail ? <> · <a href={`mailto:${brand.supportEmail}`} className="underline underline-offset-2">{t("common.support", "Support")}</a></> : null}
        </p>
      </div>
    </div>
  );
}
