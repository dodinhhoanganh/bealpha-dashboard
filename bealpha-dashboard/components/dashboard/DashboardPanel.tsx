"use client";

/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V4
 * Component-scope: operational home · modern-minimal · locked BeAlpha tokens
 * The home surface is a work queue, not a second analytics/catalog page.
 */

import { useEffect, useMemo, useState } from "react";
import type { UserSession } from "@/lib/types";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { useToast } from "@/components/ui/Toast";
import { AlbumIcon, ArrowUpRightIcon, CheckIcon, WarningIcon } from "@/components/ui/Icon";
import { loadDashboardAggregate } from "@/lib/dashboard-aggregate";
import type { DashboardRelease } from "@/lib/dashboard-aggregate";
import { canAccessPanel, canApproveRelease, canSubmitRelease } from "@/lib/ui-capabilities";
import { getReleaseWorkflowHandoff, workflowOwnerLabel } from "@/lib/release-workflow";
import { roleLabel, type EntityRole } from "@/lib/entity-management";

type ReleaseItem = DashboardRelease;

function roleContext(t: (key: string, fallback?: string) => string): Record<string, { title: string; description: string; primaryPanel: string; primaryLabel: string }> {
  return {
  SUPER_ADMIN: {
    title: t("dashboard.roleContext.superAdmin.title", "Distribution operations"),
    description: t("dashboard.roleContext.superAdmin.description", "Prioritize releases awaiting final approval and delivery issues requiring action."),
    primaryPanel: "distribution",
    primaryLabel: t("dashboard.roleContext.superAdmin.primaryAction", "Open distribution"),
  },
  SYSTEM_ADMIN: {
    title: t("dashboard.roleContext.systemAdmin.title", "Platform review queue"),
    description: t("dashboard.roleContext.systemAdmin.description", "Review submissions from customer organizations before sending them for final BeAlpha approval."),
    primaryPanel: "releases",
    primaryLabel: t("dashboard.roleContext.systemAdmin.primaryAction", "Open catalog"),
  },
  ORGANIZATION: {
    title: t("dashboard.roleContext.organization.title", "Organization release operations"),
    description: t("dashboard.roleContext.organization.description", "Review submissions from customer accounts and complete returned releases."),
    primaryPanel: "releases",
    primaryLabel: t("dashboard.roleContext.organization.primaryAction", "Open catalog"),
  },
  SUB_ACCOUNT: {
    title: t("dashboard.roleContext.subAccount.title", "Complete your next release"),
    description: t("dashboard.roleContext.subAccount.description", "Continue a draft or correct a returned submission."),
    primaryPanel: "releases",
    primaryLabel: t("dashboard.roleContext.subAccount.primaryAction", "Open releases"),
  },
  };
}

function releaseSecondaryText(release: ReleaseItem, fallback: string) {
  return release.artist?.name || release.label?.name || fallback;
}

export default function DashboardPanel({ user, onNavigate }: { user: UserSession; onNavigate: (panel: string) => void }) {
  const [releases, setReleases] = useState<ReleaseItem[]>([]);
  const [catalogAvailable, setCatalogAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const { showToast } = useToast();
  const { t } = useI18n();

  useEffect(() => {
    let cancelled = false;
    void loadDashboardAggregate(user)
      .then((result) => {
        if (cancelled) return;
        setReleases(result.releases);
        setCatalogAvailable(result.available);
      })
      .catch(() => {
        if (cancelled) return;
        setReleases([]);
        setCatalogAvailable(false);
        showToast(t("toast.failedToLoadDashboard", "Could not load the work queue"), "error");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user, showToast, t]);

  const approvals = useMemo(
    () => releases.filter((release) => canApproveRelease(user, release.status)).slice(0, 5),
    [releases, user],
  );
  const corrections = useMemo(
    () => releases.filter((release) => canSubmitRelease(user, release.status)).slice(0, 5),
    [releases, user],
  );
  const contexts = roleContext(t);
  const context = user.entityRole === "ACCOUNTANT"
    ? { title: t("dashboard.roleContext.accountant.title", "Royalty reconciliation"), description: t("dashboard.roleContext.accountant.description", "Reports and statements remain in Earnings so this work queue does not duplicate financial data."), primaryPanel: "earnings", primaryLabel: t("dashboard.roleContext.accountant.primaryAction", "Open earnings") }
    : contexts[user.entityType] ?? contexts.ORGANIZATION!;
  const canOpenPrimary = canAccessPanel(user, context.primaryPanel);
  const hasTasks = approvals.length > 0 || corrections.length > 0;

  const openRelease = (release: ReleaseItem) => {
    const query = new URLSearchParams({ panel: "releases", releaseId: release.id, title: release.title });
    onNavigate(`/?${query.toString()}`);
  };

  const taskRows = [
    ...approvals.map((release) => ({ release, kind: "approval" as const })),
    ...corrections.map((release) => ({ release, kind: "correction" as const })),
  ];

  return (
    <div className="workbench-canvas min-w-0">
      <header className="flex min-w-0 flex-col gap-5 border-b border-[var(--border-primary)] pb-6 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 max-w-[680px]">
          <p className="mb-2 text-xs font-medium text-[var(--text-tertiary)]">{user.entityName} · {roleLabel(user.entityRole as EntityRole, t)}</p>
          <h1 className="min-w-0 text-2xl font-semibold leading-tight text-[var(--text-primary)] [overflow-wrap:anywhere] md:text-3xl">{context.title}</h1>
          <p className="mt-2 max-w-[62ch] text-sm leading-6 text-[var(--text-secondary)]">{context.description}</p>
        </div>
        {canOpenPrimary && (
          <button
            type="button"
            onClick={() => onNavigate(context.primaryPanel)}
            className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-input)] bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--accent-contrast)] transition-colors duration-[var(--dur-short)] hover:bg-[var(--accent-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)] active:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {context.primaryLabel}<ArrowUpRightIcon size={15} />
          </button>
        )}
      </header>

      <section className="mt-6" aria-labelledby="work-queue-title">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="work-queue-title" className="text-base font-semibold text-[var(--text-primary)]">{t("dashboard.pendingReview", "Needs action")}</h2>
            <p className="mt-1 text-xs text-[var(--text-tertiary)]">{t("dashboard.workQueueHelp", "Only work the current account can perform appears here.")}</p>
          </div>
          {hasTasks && (
            <div className="flex items-center gap-2 text-xs">
              {approvals.length > 0 && <span className="rounded-full bg-[var(--status-warning-surface)] px-2.5 py-1 font-medium text-[var(--status-warning)]">{approvals.length} {t("common.review", "to review")}</span>}
              {corrections.length > 0 && <span className="rounded-full bg-[var(--status-error-surface)] px-2.5 py-1 font-medium text-[var(--status-error)]">{corrections.length} {t("dashboard.correctionsCount", "to complete")}</span>}
            </div>
          )}
        </div>

        {loading ? (
          <div className="space-y-2" aria-label={t("common.loading", "Đang tải")}>
            {[0, 1, 2].map((item) => <div key={item} className="h-16 animate-pulse rounded-[var(--radius-card)] bg-[var(--bg-elevated)]" />)}
          </div>
        ) : !catalogAvailable ? (
          <div role="alert" className="rounded-[var(--radius-card)] border border-[var(--status-error)] bg-[var(--status-error-surface)] p-4 text-sm text-[var(--status-error)]">{t("dashboard.catalogUnavailable", "The catalog work queue is temporarily unavailable.")}</div>
        ) : hasTasks ? (
          <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--border-primary)] bg-[var(--bg-surface)]">
            {taskRows.map(({ release, kind }) => (
              <button
                key={`${kind}:${release.id}`}
                type="button"
                onClick={() => openRelease(release)}
                className="group grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-3 text-left transition-colors duration-[var(--dur-short)] last:border-b-0 hover:bg-[var(--bg-surface-hover)] focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-focus)] active:bg-[var(--bg-elevated)]"
              >
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${kind === "approval" ? "bg-[var(--status-warning-surface)] text-[var(--status-warning)]" : "bg-[var(--status-error-surface)] text-[var(--status-error)]"}`}>
                  {kind === "approval" ? <WarningIcon size={17} /> : <AlbumIcon size={17} />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-[var(--text-primary)]">{release.title}</span>
                  <span className="mt-0.5 block truncate text-xs text-[var(--text-tertiary)]">{releaseSecondaryText(release, t("dashboard.unknownReleaseOwner", "Artist or label not specified"))} · {(() => { const handoff = getReleaseWorkflowHandoff(release.status); return handoff ? workflowOwnerLabel(handoff.next, t) : "—"; })()}</span>
                </span>
                <span className="shrink-0 whitespace-nowrap text-xs font-medium text-[var(--accent-text)]">{kind === "approval" ? t("common.review", "Review") : t("dashboard.continue", "Continue")}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex items-start gap-3 rounded-[var(--radius-card)] border border-[var(--border-primary)] bg-[var(--bg-surface)] p-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--status-success-surface)] text-[var(--status-success)]"><CheckIcon size={17} /></span>
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">{t("dashboard.noUrgentWork", "No urgent work")}</p>
              <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{t("dashboard.noUrgentWorkHelp", "Analytics, earnings, roster, and distribution remain in their dedicated work areas.")}</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
