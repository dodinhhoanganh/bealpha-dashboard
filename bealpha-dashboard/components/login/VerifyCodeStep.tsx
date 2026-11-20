"use client";

import { useRef } from "react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { LockOutlinedIcon } from "@/components/ui/Icon";

type TwoFactorMethod = "email" | "app" | "recovery";

interface VerifyCodeStepProps {
  selectedMethod: TwoFactorMethod | null;
  verificationCode: string;
  setVerificationCode: (v: string) => void;
  maskedContact: string;
  isNewLocation: boolean;
  loading: boolean;
  availableMethods: TwoFactorMethod[];
  onSubmit: (e?: React.FormEvent) => void;
  onResendCode: () => void;
  onSwitchToRecovery: () => void;
}

export default function VerifyCodeStep({
  selectedMethod, verificationCode, setVerificationCode,
  maskedContact, isNewLocation, loading,
  availableMethods, onSubmit, onResendCode, onSwitchToRecovery,
}: VerifyCodeStepProps) {
  const { t } = useI18n();
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  return (
    <form onSubmit={onSubmit} className="space-y-6" suppressHydrationWarning>
      <div className="text-center mb-2">
        <div className="flex items-center justify-center mb-4 text-white opacity-90">
          <LockOutlinedIcon size={40} />
        </div>
        <h3 className="text-2xl font-bold text-white tracking-tight mb-2">
          {isNewLocation ? t("login.newLocationDetected") : t("login.securityCheck")}
        </h3>
        <p className="text-sm text-white/70">
          {isNewLocation
            ? t("login.newLocationDesc")
            : selectedMethod === "app"
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
              if (val.length > 4) val = val.substring(0, 4) + "-" + val.substring(4, 8);
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
                ref={(el) => { inputRefs.current[index] = el; }}
                type="text" inputMode="numeric" pattern="[0-9]*" maxLength={1}
                value={verificationCode[index] || ""}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, "");
                  if (!val && e.target.value) return;
                  const newCode = verificationCode.split("");
                  newCode[index] = val;
                  const joined = newCode.join("");
                  setVerificationCode(joined.substring(0, 6));
                  if (val && index < 5) inputRefs.current[index + 1]?.focus();
                  if (joined.length === 6) {
                    const form = e.target.closest("form");
                    setTimeout(() => { if (form) form.requestSubmit(); }, 50);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Backspace" && !verificationCode[index] && index > 0)
                    inputRefs.current[index - 1]?.focus();
                }}
                onPaste={(e) => {
                  e.preventDefault();
                  const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
                  if (pasted) {
                    setVerificationCode(pasted);
                    const nextFocus = Math.min(pasted.length, 5);
                    if (inputRefs.current[nextFocus]) inputRefs.current[nextFocus]?.focus();
                    else inputRefs.current[5]?.focus();
                    if (pasted.length === 6) {
                      const form = e.currentTarget.closest("form");
                      setTimeout(() => { if (form) form.requestSubmit(); }, 50);
                    }
                  }
                }}
                required
                className="w-[2.75rem] h-[3.25rem] sm:w-[3.25rem] sm:h-[3.75rem] text-center text-xl sm:text-2xl font-medium rounded-xl border bg-white/5 text-white placeholder-white/20 outline-none transition-all duration-200"
                style={{ borderColor: verificationCode[index] ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.1)" }}
                onFocus={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.boxShadow = "0 0 0 2px rgba(162,56,255,0.2)"; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = verificationCode[index] ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.1)"; e.currentTarget.style.boxShadow = "none"; }}
              />
              {index === 2 && <div className="w-1 sm:w-2" />}
            </div>
          ))}
        </div>
      )}

      <button type="submit"
        disabled={loading || (selectedMethod === "recovery" ? verificationCode.length !== 9 : verificationCode.length !== 6)}
        className={`w-full py-3.5 text-[15px] font-medium rounded-xl transition-all duration-300 ${(selectedMethod === "recovery" ? verificationCode.length === 9 : verificationCode.length === 6) ? "bg-[var(--accent)] hover:brightness-110 text-white shadow-lg" : "bg-white/10 text-white/50 cursor-not-allowed"}`}
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2.5">
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            {t("login.verifying")}
          </span>
        ) : selectedMethod === "recovery" ? (
          verificationCode.length === 9 ? t("login.verify") : t("login.enterCodePrompt")
        ) : verificationCode.length === 6 ? (
          t("login.verify")
        ) : (
          `${6 - verificationCode.length} ${t("login.digitsLeft")}`
        )}
      </button>

      {selectedMethod !== "app" && selectedMethod !== "recovery" && (
        <button type="button" onClick={onResendCode} disabled={loading}
          className="w-full text-center text-sm transition-colors duration-200 disabled:opacity-50"
          style={{ color: "var(--accent-text)" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--accent-text)")}>
          {t("login.resendCode")}
        </button>
      )}

      {(selectedMethod === "app" || (selectedMethod !== "recovery" && availableMethods.includes("app"))) && (
        <button type="button" onClick={onSwitchToRecovery} disabled={loading}
          className="w-full text-center text-sm transition-colors duration-200 disabled:opacity-50 mt-2"
          style={{ color: "var(--accent-text)" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--accent-text)")}>
          {t("login.useRecoveryCode")}
        </button>
      )}
    </form>
  );
}
