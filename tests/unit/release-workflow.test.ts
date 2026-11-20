import {
  getReleaseWorkflowHandoff,
  REJECTION_REASON_MAX_LENGTH,
  validateRejectionReason,
  workflowOwnerLabel,
} from "@/lib/release-workflow";

describe("release rejection reason", () => {
  it("requires a useful reason that can be sent to the submitting tier", () => {
    expect(validateRejectionReason("   ")).toBe("required");
    expect(validateRejectionReason("no")).toBe("too_short");
    expect(validateRejectionReason("ISRC does not match the uploaded master.")).toBeNull();
    expect(validateRejectionReason("x".repeat(REJECTION_REASON_MAX_LENGTH + 1))).toBe("too_long");
  });
});

describe("release workflow handoff", () => {
  it.each([
    ["DRAFT", "SUBMITTER", "ORGANIZATION"],
    ["PENDING_ORG_APPROVAL", "ORGANIZATION", "SYSTEM_ADMIN"],
    ["PENDING_SYS_APPROVAL", "SYSTEM_ADMIN", "SUPER_ADMIN"],
    ["PENDING_SUPER_APPROVAL", "SUPER_ADMIN", "DSP"],
    ["LOCKED_FOR_DELIVERY", "SUPER_ADMIN", "DSP"],
    ["RELEASED", "DSP", "FINANCE"],
  ] as const)("maps %s to its current and next owner", (status, current, next) => {
    expect(getReleaseWorkflowHandoff(status)).toEqual({ current, next });
  });

  it("returns rejected work to the tier directly below the reviewer", () => {
    expect(getReleaseWorkflowHandoff("ORG_REJECTED")).toEqual({
      current: "SUBMITTER",
      next: "ORGANIZATION",
    });
    expect(getReleaseWorkflowHandoff("SYS_REJECTED")).toEqual({
      current: "ORGANIZATION",
      next: "SYSTEM_ADMIN",
    });
    expect(getReleaseWorkflowHandoff("SUPER_REJECTED")).toEqual({
      current: "SYSTEM_ADMIN",
      next: "SUPER_ADMIN",
    });
  });

  it("localizes workflow owners instead of exposing internal role enums", () => {
    const translations: Record<string, string> = {
      "workflow.owner.submitter": "Tài khoản gửi",
      "workflow.owner.systemAdmin": "Nhóm hãng đĩa / đơn vị tổng hợp phân phối",
    };
    const t = (key: string, fallback?: string) => translations[key] ?? fallback ?? key;

    expect(workflowOwnerLabel("SUBMITTER", t)).toBe("Tài khoản gửi");
    expect(workflowOwnerLabel("SYSTEM_ADMIN", t)).not.toBe("SYSTEM_ADMIN");
    expect(workflowOwnerLabel("DSP", t)).toBe("DSP");
  });
});
