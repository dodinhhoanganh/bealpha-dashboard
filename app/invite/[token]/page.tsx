"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import { useTheme } from "@/components/layout/ThemeProvider";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { translateApiError } from "@/lib/i18n/translateApiError";
import InteractiveBackground from "@/components/ui/InteractiveBackground";
import {
  VisibilityIcon,
  VisibilityOffIcon,
} from "@/components/ui/Icon";
import { ApiClientError, publicApiRequest } from "@/lib/api-client";

interface InvitationData {
  id: string;
  email: string;
  role: string;
  businessTitle: string | null;
  status: string;
  expiresAt: string;
  isExpired: boolean;
  entity: {
    id: string;
    officialName: string;
    entityType: string;
    logoUrl?: string;
    isActive: boolean;
  };
  inviter?: {
    email: string;
    name?: string;
  };
  hasExistingAccount: boolean;
}

export default function InvitePage() {
  const params = useParams();
  const router = useRouter();
  const { theme } = useTheme();
  const { t } = useI18n();
  const token = params.token as string;

  const [invitation, setInvitation] = useState<InvitationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // New user fields
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Fetch invitation details on mount
  useEffect(() => {
    if (!token) return;

    const fetchInvitation = async () => {
      try {
        const data = await publicApiRequest<{
          id: string;
          email: string;
          role: string;
          businessTitle: string | null;
          status: string;
          expiresAt: string;
          expired: boolean;
          existingUser: boolean;
          entity: { id: string; type: string; name: string };
        }>("/api/v1/auth/invitations/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        setInvitation({
          id: data.id,
          email: data.email,
          role: data.role,
          businessTitle: data.businessTitle,
          status: data.status,
          expiresAt: data.expiresAt,
          isExpired: data.expired,
          hasExistingAccount: data.existingUser,
          entity: {
            id: data.entity.id,
            officialName: data.entity.name,
            entityType: data.entity.type,
            isActive: true,
          },
        });
      } catch (error) {
        setError(error instanceof ApiClientError ? error.message : t("common.failedToLoadInvitation"));
      } finally {
        setLoading(false);
      }
    };

    fetchInvitation();
  }, [token, t]);

  const handleAccept = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    // Validation for new users
    if (invitation && !invitation.hasExistingAccount) {
      if (!password || password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
        setError(t("invite.passwordMinLength", "Password must be at least 12 characters and include upper, lower, number, and symbol"));
        setSubmitting(false);
        return;
      }
      if (password !== confirmPassword) {
        setError(t("invite.passwordMismatch", "Passwords do not match"));
        setSubmitting(false);
        return;
      }
    }

    try {
      await publicApiRequest("/api/v1/auth/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          name: name.trim() || undefined,
          password: invitation?.hasExistingAccount ? undefined : password,
        }),
      });

      setSuccess(t("invite.success", "Invitation accepted successfully!"));

      // Redirect to login after a short delay
      setTimeout(() => {
        router.push("/login");
      }, 2500);
    } catch (error) {
      setError(error instanceof ApiClientError ? translateApiError(error.code, t) : t("invite.errorOccurred", "An error occurred. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  // Helper: entity type badge
  const getEntityTypeBadge = (type: string) => {
    const labels: Record<string, string> = {
      SUPER_ADMIN: t("entities.superAdmin", "BeAlpha Platform Owner"),
      SYSTEM_ADMIN: t("entities.systemAdmin", "BeAlpha Operations Team"),
      ORGANIZATION: t("entities.organization", "Customer Organization"),
      SUB_ACCOUNT: t("entities.subAccount", "Client Account"),
    };
    return labels[type] || type;
  };

  // Helper: role badge
  const getRoleBadge = (role: string) => {
    const colors: Record<string, { bg: string; text: string }> = {
      OWNER: { bg: "rgba(251,191,36,0.12)", text: "#fbbf24" },
      ADMIN: { bg: "rgba(96,165,250,0.12)", text: "#60a5fa" },
      MEMBER: { bg: "rgba(74,222,128,0.12)", text: "#4ade80" },
    };
    return colors[role] || { bg: "var(--bg-elevated)", text: "var(--text-secondary)" };
  };

  const getAccessLevelLabel = (role: string) => ({
    OWNER: t("entities.owner", "Owner"),
    ADMIN: t("entities.admin", "Administrator"),
    REVIEWER: t("entities.reviewer", "Release reviewer"),
    ACCOUNTANT: t("entities.accountant", "Accountant"),
    MEMBER: t("entities.member", "Member"),
  } as Record<string, string>)[role] || role;

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden"
      style={{ background: "var(--bg-primary)" }}
    >
      <InteractiveBackground />

      {/* ═══════════ Floating Logo ═══════════ */}
      <div className="absolute top-12 left-1/2 -translate-x-1/2 z-20 flex items-center justify-center w-[500px] h-[100px]">
        <Image
          src={theme === "dark" ? "/logo-white.png" : "/logo-black.png"}
          alt="beAlpha Logo"
          width={360}
          height={100}
          priority
          className="w-[360px] h-auto object-contain"
          style={{
            filter:
              theme === "dark"
                ? "drop-shadow(0 4px 20px rgba(0,0,0,0.8))"
                : "drop-shadow(0 4px 12px rgba(0,0,0,0.2))",
          }}
        />
      </div>

      {/* ═══════════ Invitation Card ═══════════ */}
      <div
        className="relative w-full max-w-md p-8 md:p-10 rounded-[2rem] shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] backdrop-blur-2xl bg-transparent border border-white/20 dark:border-white/10 z-10 mx-4"
        style={{ animation: "fadeIn 0.4s ease-out" }}
      >
        {/* ── Loading State ── */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <div
              className="w-10 h-10 border-3 rounded-full animate-spin"
              style={{
                borderColor: "var(--border-primary)",
                borderTopColor: "var(--accent)",
              }}
            />
            <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
              {t("invite.loading", "Loading invitation...")}
            </p>
          </div>
        )}

        {/* ── Error State (no invitation) ── */}
        {!loading && !invitation && (
          <div className="text-center py-8">
            <div
              className="w-16 h-16 mx-auto mb-5 rounded-full flex items-center justify-center"
              style={{ background: "var(--status-error-surface)" }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--status-error)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
            <h2
              className="text-xl font-bold mb-2"
              style={{ color: "var(--text-primary)" }}
            >
              {t("invite.invalidTitle", "Invalid Invitation")}
            </h2>
            <p
              className="text-sm mb-6"
              style={{ color: "var(--text-tertiary)" }}
            >
              {error || t("invite.invalidDesc", "This invitation link is invalid, expired, or has already been used.")}
            </p>
            <button
              onClick={() => router.push("/login")}
              className="btn-primary px-6 py-2.5"
            >
              {t("invite.goToLogin", "Go to Login")}
            </button>
          </div>
        )}

        {/* ── Success State ── */}
        {!loading && success && (
          <div className="text-center py-8" style={{ animation: "fadeInScale 0.3s ease-out" }}>
            <div
              className="w-16 h-16 mx-auto mb-5 rounded-full flex items-center justify-center"
              style={{ background: "var(--status-success-surface)" }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--status-success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
            <h2
              className="text-xl font-bold mb-2"
              style={{ color: "var(--text-primary)" }}
            >
              {t("invite.welcomeTitle", "Welcome!")}
            </h2>
            <p
              className="text-sm mb-2"
              style={{ color: "var(--text-tertiary)" }}
            >
              {success}
            </p>
            <p
              className="text-xs"
              style={{ color: "var(--text-disabled)" }}
            >
              {t("invite.redirecting", "Redirecting to login...")}
            </p>
          </div>
        )}

        {/* ── Invitation Details + Accept Form ── */}
        {!loading && invitation && !success && (
          <>
            {/* Header */}
            <div className="mb-6 text-center">
              <div
                className="w-14 h-14 mx-auto mb-4 rounded-2xl flex items-center justify-center text-xl font-bold"
                style={{
                  background: "var(--accent-surface)",
                  color: "var(--accent-text)",
                  border: "1px solid rgba(59,130,246,0.2)",
                }}
              >
                {invitation.entity.officialName?.[0]?.toUpperCase() || "?"}
              </div>
              <h2
                className="font-bold leading-tight"
                style={{
                  fontSize: "24px",
                  color: "var(--text-primary)",
                  letterSpacing: "-0.03em",
                }}
              >
                {t("invite.title", "You've been invited")}
              </h2>
              <p
                className="text-sm mt-2"
                style={{ color: "var(--text-tertiary)" }}
              >
                {invitation.inviter?.name || invitation.inviter?.email || "BeAlpha"}{" "}
                {t("invite.invitedYouTo", "invited you to join")}
              </p>
            </div>

            {/* Entity info card */}
            <div
              className="rounded-xl p-4 mb-6"
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border-primary)",
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <h3
                  className="text-base font-semibold"
                  style={{ color: "var(--text-primary)" }}
                >
                  {invitation.entity.officialName}
                </h3>
                <span
                  className="text-[10px] font-semibold px-2.5 py-1 rounded-full uppercase tracking-wider"
                  style={{
                    background: "var(--bg-elevated)",
                    color: "var(--text-secondary)",
                  }}
                >
                  {getEntityTypeBadge(invitation.entity.entityType)}
                </span>
              </div>
              {invitation.businessTitle && <p className="mb-2 text-sm font-medium" style={{ color: "var(--text-secondary)" }}>{invitation.businessTitle}</p>}
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                  {t("invite.roleLabel", "Your access:")}
                </span>
                <span
                  className="text-xs font-semibold px-2.5 py-0.5 rounded-full"
                  style={{
                    background: getRoleBadge(invitation.role).bg,
                    color: getRoleBadge(invitation.role).text,
                  }}
                >
                  {getAccessLevelLabel(invitation.role)}
                </span>
              </div>
            </div>

            <hr
              className="border-t mb-6 -mx-8 md:-mx-10"
              style={{ borderColor: "var(--border-primary)" }}
            />

            {/* Error */}
            {error && (
              <div
                className="mb-5 p-3.5 rounded-xl text-sm flex items-center gap-2"
                style={{
                  background: "var(--status-error-surface)",
                  border: "1px solid rgba(248,113,113,0.2)",
                  color: "var(--status-error)",
                  animation: "fadeIn 0.2s ease-out",
                }}
              >
                <span className="text-base">⚠</span>
                {error}
              </div>
            )}

            {/* Expired / Already used */}
            {(invitation.isExpired || invitation.status !== "PENDING") ? (
              <div className="text-center py-4">
                <p
                  className="text-sm mb-4"
                  style={{ color: "var(--status-warning)" }}
                >
                  {invitation.isExpired
                    ? t("invite.expired", "This invitation has expired.")
                    : t("invite.alreadyUsed", `This invitation has already been ${invitation.status.toLowerCase()}.`)}
                </p>
                <button
                  onClick={() => router.push("/login")}
                  className="btn-secondary px-6 py-2.5"
                >
                  {t("invite.goToLogin", "Go to Login")}
                </button>
              </div>
            ) : (
              <form onSubmit={handleAccept} className="space-y-4">
                {/* Email (read-only) */}
                <div>
                  <label
                    className="block text-xs font-semibold mb-2 uppercase tracking-[0.08em]"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    {t("invite.emailLabel", "Email")}
                  </label>
                  <input
                    type="email"
                    value={invitation.email}
                    readOnly
                    className="input-field"
                    style={{ opacity: 0.7, cursor: "default" }}
                  />
                </div>

                {/* New user: name + password */}
                {!invitation.hasExistingAccount && (
                  <>
                    <div>
                      <label
                        className="block text-xs font-semibold mb-2 uppercase tracking-[0.08em]"
                        style={{ color: "var(--text-tertiary)" }}
                      >
                        {t("invite.nameLabel", "Your Name")}
                      </label>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="input-field"
                        placeholder={t("invite.namePlaceholder", "Enter your name")}
                      />
                    </div>

                    <div>
                      <label
                        className="block text-xs font-semibold mb-2 uppercase tracking-[0.08em]"
                        style={{ color: "var(--text-tertiary)" }}
                      >
                        {t("invite.passwordLabel", "Password")}
                      </label>
                      <div className="relative">
                        <input
                          type={showPassword ? "text" : "password"}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                          minLength={8}
                          className="input-field pr-12 [&::-ms-reveal]:hidden [&::-ms-clear]:hidden"
                          placeholder={t("invite.passwordPlaceholder", "Min 8 characters")}
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

                    <div>
                      <label
                        className="block text-xs font-semibold mb-2 uppercase tracking-[0.08em]"
                        style={{ color: "var(--text-tertiary)" }}
                      >
                        {t("invite.confirmPasswordLabel", "Confirm Password")}
                      </label>
                      <div className="relative">
                        <input
                          type={showConfirmPassword ? "text" : "password"}
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          required
                          minLength={8}
                          className="input-field pr-12 [&::-ms-reveal]:hidden [&::-ms-clear]:hidden"
                          placeholder={t("invite.confirmPasswordPlaceholder", "Re-enter password")}
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded transition-colors duration-150"
                          style={{ color: "var(--text-disabled)" }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.color = "var(--text-secondary)")
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.color = "var(--text-disabled)")
                          }
                        >
                          {showConfirmPassword ? (
                            <VisibilityOffIcon size={18} />
                          ) : (
                            <VisibilityIcon size={18} />
                          )}
                        </button>
                      </div>
                    </div>
                  </>
                )}

                {/* Existing user info */}
                {invitation.hasExistingAccount && (
                  <div
                    className="rounded-xl p-3.5 text-sm flex items-center gap-2"
                    style={{
                      background: "var(--status-info-surface)",
                      border: "1px solid rgba(96,165,250,0.15)",
                      color: "var(--status-info)",
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="16" x2="12" y2="12" />
                      <line x1="12" y1="8" x2="12.01" y2="8" />
                    </svg>
                    {t("invite.existingAccountInfo", "You already have an account. Click below to join this entity.")}
                  </div>
                )}

                {/* Accept Button */}
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn-primary w-full py-3.5 text-[15px] mt-2"
                >
                  {submitting ? (
                    <span className="flex items-center justify-center gap-2.5">
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      {t("invite.accepting", "Accepting...")}
                    </span>
                  ) : invitation.hasExistingAccount ? (
                    t("invite.acceptAndJoin", "Accept & Join")
                  ) : (
                    t("invite.createAccountAndJoin", "Create Account & Join")
                  )}
                </button>

                {/* Already have account link */}
                <div className="text-center pt-2">
                  <button
                    type="button"
                    onClick={() => router.push("/login")}
                    className="text-sm transition-colors duration-200"
                    style={{ color: "var(--text-tertiary)" }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.color = "var(--accent-text)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.color = "var(--text-tertiary)")
                    }
                  >
                    {t("invite.backToLogin", "← Back to Login")}
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <p
        className="mt-8 text-xs z-10"
        style={{ color: "var(--text-disabled)" }}
      >
        © {new Date().getFullYear()} beAlpha
      </p>
    </div>
  );
}
