import {
  isSafeAvatarUploadUrl,
  normalizeAvatarUploadUrl,
} from "@/lib/security/avatar-url";

describe("avatar upload URL policy", () => {
  it("normalizes absolute avatar upload URLs to relative upload paths", () => {
    expect(
      normalizeAvatarUploadUrl("https://uploads.example.test/uploads/avatars/user-1/avatar.png?cache=1"),
    ).toBe("/uploads/avatars/user-1/avatar.png");
  });

  it("rejects non-avatar upload paths", () => {
    expect(normalizeAvatarUploadUrl("/uploads/audio/org-1/release/master.wav")).toBeNull();
    expect(normalizeAvatarUploadUrl("/uploads/covers/org-1/cover.jpg")).toBeNull();
    expect(isSafeAvatarUploadUrl("/uploads/audio/org-1/release/master.wav")).toBe(false);
  });

  it("rejects traversal and malformed avatar paths", () => {
    expect(normalizeAvatarUploadUrl("/uploads/avatars/user-1/%2e%2e/secret.png")).toBeNull();
    expect(normalizeAvatarUploadUrl("/uploads/avatars/user-1/%zz/secret.png")).toBeNull();
    expect(normalizeAvatarUploadUrl("/uploads/avatars/user-1/a\\secret.png")).toBeNull();
  });
});
