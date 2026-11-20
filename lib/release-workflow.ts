export const REJECTION_REASON_MIN_LENGTH = 3;
export const REJECTION_REASON_MAX_LENGTH = 1000;

export type RejectionReasonError = "required" | "too_short" | "too_long";

export type WorkflowOwner =
  | "SUBMITTER"
  | "ORGANIZATION"
  | "SYSTEM_ADMIN"
  | "SUPER_ADMIN"
  | "DSP"
  | "FINANCE";

export type WorkflowTranslator = (key: string, fallback?: string) => string;

const WORKFLOW_OWNER_LABELS: Readonly<Record<WorkflowOwner, readonly [string, string]>> = {
  SUBMITTER: ["workflow.owner.submitter", "Submitting account"],
  ORGANIZATION: ["workflow.owner.organization", "Independent label"],
  SYSTEM_ADMIN: ["workflow.owner.systemAdmin", "Label group / aggregator"],
  SUPER_ADMIN: ["workflow.owner.superAdmin", "BeAlpha"],
  DSP: ["workflow.owner.dsp", "DSP"],
  FINANCE: ["workflow.owner.finance", "Royalty accounting"],
};

const RELEASE_HANDOFFS: Readonly<Record<string, Readonly<{
  current: WorkflowOwner;
  next: WorkflowOwner;
}>>> = {
  DRAFT: { current: "SUBMITTER", next: "ORGANIZATION" },
  PENDING_ORG_APPROVAL: { current: "ORGANIZATION", next: "SYSTEM_ADMIN" },
  ORG_REJECTED: { current: "SUBMITTER", next: "ORGANIZATION" },
  PENDING_SYS_APPROVAL: { current: "SYSTEM_ADMIN", next: "SUPER_ADMIN" },
  SYS_REJECTED: { current: "ORGANIZATION", next: "SYSTEM_ADMIN" },
  PENDING_SUPER_APPROVAL: { current: "SUPER_ADMIN", next: "DSP" },
  SUPER_REJECTED: { current: "SYSTEM_ADMIN", next: "SUPER_ADMIN" },
  APPROVED: { current: "SUPER_ADMIN", next: "DSP" },
  SCHEDULED: { current: "SUPER_ADMIN", next: "DSP" },
  LOCKED_FOR_DELIVERY: { current: "SUPER_ADMIN", next: "DSP" },
  DELIVERED: { current: "DSP", next: "FINANCE" },
  RELEASED: { current: "DSP", next: "FINANCE" },
  TAKEDOWN: { current: "SUPER_ADMIN", next: "DSP" },
};

export function validateRejectionReason(reason: string): RejectionReasonError | null {
  const length = reason.trim().length;
  if (length === 0) return "required";
  if (length < REJECTION_REASON_MIN_LENGTH) return "too_short";
  if (length > REJECTION_REASON_MAX_LENGTH) return "too_long";
  return null;
}

export function getReleaseWorkflowHandoff(status: string) {
  return RELEASE_HANDOFFS[status] ?? null;
}

export function workflowOwnerLabel(owner: WorkflowOwner, t: WorkflowTranslator): string {
  return t(...WORKFLOW_OWNER_LABELS[owner]);
}
