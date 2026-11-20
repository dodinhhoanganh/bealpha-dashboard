"use client";

import { useI18n } from "@/lib/i18n/I18nProvider";
import { VisibilityIcon, VisibilityOffIcon } from "@/components/ui/Icon";

interface CredentialsStepProps {
  email: string;
  setEmail: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  showPassword: boolean;
  setShowPassword: (v: boolean) => void;
  rememberMe: boolean;
  setRememberMe: (v: boolean) => void;
  loading: boolean;
  onSubmit: (e: React.FormEvent) => void;
}

export default function CredentialsStep({
  email, setEmail, password, setPassword,
  showPassword, setShowPassword,
  rememberMe, setRememberMe,
  loading, onSubmit,
}: CredentialsStepProps) {
  const { t } = useI18n();

  return (
    <form onSubmit={onSubmit} className="space-y-5" suppressHydrationWarning>
      <div>
        <label htmlFor="email" className="block text-xs font-semibold mb-2 uppercase tracking-[0.08em]" style={{ color: "var(--text-tertiary)" }}>
          {t("login.email")}
        </label>
        <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          required autoComplete="email" className="input-field"
          placeholder={t("placeholder.email", "Enter email address")} />
      </div>

      <div>
        <label htmlFor="password" className="block text-xs font-semibold mb-2 uppercase tracking-[0.08em]" style={{ color: "var(--text-tertiary)" }}>
          {t("login.password")}
        </label>
        <div className="relative">
          <input id="password" type={showPassword ? "text" : "password"} value={password}
            onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password"
            className="input-field pr-12 [&::-ms-reveal]:hidden [&::-ms-clear]:hidden"
            placeholder={t("login.enterPassword")} />
          <button type="button" onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded transition-colors duration-150"
            style={{ color: "var(--text-disabled)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-disabled)")}>
            {showPassword ? <VisibilityOffIcon size={18} /> : <VisibilityIcon size={18} />}
          </button>
        </div>
      </div>

      {/* Remember me */}
      <label className="flex items-center gap-3 pt-1 cursor-pointer select-none">
        <div className="relative">
          <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} className="sr-only peer" />
          <div className={`w-[18px] h-[18px] rounded-[5px] border-2 transition-all duration-200 flex items-center justify-center ${rememberMe ? "border-[var(--accent)] bg-[var(--accent)]" : "border-white/40 bg-white/10 hover:border-white/60"}`}>
            {rememberMe && (
              <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
        </div>
        <span className="text-sm" style={{ color: "var(--text-tertiary)" }}>{t("login.rememberDevice")}</span>
      </label>

      <button type="submit" disabled={loading} className="btn-primary w-full py-3.5 text-[15px] mt-2">
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
  );
}
