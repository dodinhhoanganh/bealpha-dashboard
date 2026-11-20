import {
  canApproveVevoRelease,
  canCreateVevoSubmission,
  isAcceptedVevoVideoFile,
  isReleaseIdentifierLocked,
} from "@/lib/vevo-policy";

describe("VEVO video upload policy", () => {
  it("accepts MP4 and MOV masters but rejects MKV", () => {
    expect(isAcceptedVevoVideoFile("master.mp4", "video/mp4")).toBe(true);
    expect(isAcceptedVevoVideoFile("master.mov", "video/quicktime")).toBe(true);
    expect(isAcceptedVevoVideoFile("master.mkv", "video/x-matroska")).toBe(false);
  });
});

describe("VEVO release workflow policy", () => {
  it("exposes approval workflow states", () => {
    expect(canApproveVevoRelease("PENDING_ORG_APPROVAL")).toBe(true);
    expect(canApproveVevoRelease("PENDING_SYS_APPROVAL")).toBe(true);
    expect(canApproveVevoRelease("PENDING")).toBe(false);
  });

  it("locks UPC/EAN only in delivery-locked lifecycle states", () => {
    expect(isReleaseIdentifierLocked("APPROVED")).toBe(false);
    expect(isReleaseIdentifierLocked("LOCKED_FOR_DELIVERY")).toBe(true);
    expect(isReleaseIdentifierLocked("DELIVERED")).toBe(true);
    expect(isReleaseIdentifierLocked("RELEASED")).toBe(true);
    expect(isReleaseIdentifierLocked("TAKEDOWN")).toBe(true);
  });

  it("shows VEVO dispatch only to the BeAlpha owner after final approval", () => {
    expect(canCreateVevoSubmission("SUPER_ADMIN", "OWNER", "APPROVED", false)).toBe(true);
    expect(canCreateVevoSubmission("SUPER_ADMIN", "OWNER", "LOCKED_FOR_DELIVERY", false)).toBe(true);
    expect(canCreateVevoSubmission("SUPER_ADMIN", "ADMIN", "APPROVED", false)).toBe(false);
    expect(canCreateVevoSubmission("ORGANIZATION", "OWNER", "APPROVED", false)).toBe(false);
    expect(canCreateVevoSubmission("SUPER_ADMIN", "OWNER", "PENDING_SUPER_APPROVAL", false)).toBe(false);
    expect(canCreateVevoSubmission("SUPER_ADMIN", "OWNER", "APPROVED", true)).toBe(false);
  });
});
