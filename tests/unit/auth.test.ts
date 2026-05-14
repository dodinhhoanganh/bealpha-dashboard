/**
 * Unit tests for Auth module
 * Tests role/permission system and token functions
 */

// Mock dependencies before importing
jest.mock("jose", () => ({
  SignJWT: jest.fn().mockImplementation(() => ({
    setProtectedHeader: jest.fn().mockReturnThis(),
    setIssuedAt: jest.fn().mockReturnThis(),
    setExpirationTime: jest.fn().mockReturnThis(),
    sign: jest.fn().mockResolvedValue("mock-token"),
  })),
  jwtVerify: jest.fn(),
}));

jest.mock("bcryptjs", () => ({
  hash: jest.fn().mockResolvedValue("$2a$12$hashed"),
  compare: jest.fn(),
}));

jest.mock("next/headers", () => ({
  cookies: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn() },
  },
}));

import {
  ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  hasRole,
  hasAnyRole,
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  getUserPermissions,
  isAdmin,
  isArtist,
  isLabel,
  hashPassword,
  verifyPassword,
  UserPayload,
} from "@/lib/auth";
import bcrypt from "bcryptjs";

// ── Test Data ────────────────────────────────────────────
const adminUser: UserPayload = {
  id: "admin-1",
  email: "admin@bealpha.com",
  roles: [ROLES.ADMIN],
};

const artistUser: UserPayload = {
  id: "artist-1",
  email: "artist@bealpha.com",
  roles: [ROLES.ARTIST],
};

const labelUser: UserPayload = {
  id: "label-1",
  email: "label@bealpha.com",
  roles: [ROLES.LABEL],
};

const multiRoleUser: UserPayload = {
  id: "multi-1",
  email: "multi@bealpha.com",
  roles: [ROLES.ARTIST, ROLES.LABEL],
};

// ── Tests ────────────────────────────────────────────────

describe("Auth — ROLES constant", () => {
  it("should define all 7 roles", () => {
    expect(Object.keys(ROLES)).toHaveLength(7);
    expect(ROLES.ADMIN).toBe("admin");
    expect(ROLES.ARTIST).toBe("artist");
    expect(ROLES.LABEL).toBe("label");
    expect(ROLES.DISTRIBUTOR).toBe("distributor");
    expect(ROLES.MODERATOR).toBe("moderator");
    expect(ROLES.SUPPORTER).toBe("supporter");
    expect(ROLES.FINANCE).toBe("finance");
  });
});

describe("Auth — ROLE_PERMISSIONS", () => {
  it("admin should have all permissions", () => {
    const allPerms = Object.values(PERMISSIONS);
    expect(ROLE_PERMISSIONS[ROLES.ADMIN]).toEqual(allPerms);
  });

  it("artist should have limited permissions", () => {
    const artistPerms = ROLE_PERMISSIONS[ROLES.ARTIST];
    expect(artistPerms).toContain(PERMISSIONS.RELEASE_CREATE);
    expect(artistPerms).toContain(PERMISSIONS.RELEASE_READ);
    expect(artistPerms).not.toContain(PERMISSIONS.USER_DELETE);
    expect(artistPerms).not.toContain(PERMISSIONS.SYSTEM_SETTINGS);
  });

  it("every role should have at least one permission", () => {
    for (const role of Object.values(ROLES)) {
      expect(ROLE_PERMISSIONS[role].length).toBeGreaterThan(0);
    }
  });
});

describe("Auth — hasRole", () => {
  it("should return true when user has the role", () => {
    expect(hasRole(adminUser, ROLES.ADMIN)).toBe(true);
    expect(hasRole(artistUser, ROLES.ARTIST)).toBe(true);
  });

  it("should return false when user does not have the role", () => {
    expect(hasRole(artistUser, ROLES.ADMIN)).toBe(false);
    expect(hasRole(labelUser, ROLES.ARTIST)).toBe(false);
  });

  it("should return false for null user", () => {
    expect(hasRole(null, ROLES.ADMIN)).toBe(false);
  });
});

describe("Auth — hasAnyRole", () => {
  it("should return true when user has at least one role", () => {
    expect(hasAnyRole(artistUser, [ROLES.ARTIST, ROLES.ADMIN])).toBe(true);
    expect(hasAnyRole(multiRoleUser, [ROLES.LABEL])).toBe(true);
  });

  it("should return false when user has none of the roles", () => {
    expect(hasAnyRole(artistUser, [ROLES.ADMIN, ROLES.LABEL])).toBe(false);
  });

  it("should return false for null user", () => {
    expect(hasAnyRole(null, [ROLES.ADMIN])).toBe(false);
  });
});

describe("Auth — hasPermission", () => {
  it("admin should have every permission", () => {
    for (const perm of Object.values(PERMISSIONS)) {
      expect(hasPermission(adminUser, perm)).toBe(true);
    }
  });

  it("artist should have release.create", () => {
    expect(hasPermission(artistUser, PERMISSIONS.RELEASE_CREATE)).toBe(true);
  });

  it("artist should NOT have user.delete", () => {
    expect(hasPermission(artistUser, PERMISSIONS.USER_DELETE)).toBe(false);
  });

  it("multi-role user should inherit permissions from all roles", () => {
    // Artist has RELEASE_CREATE, Label has LABEL_ASSIGN_ARTIST
    expect(hasPermission(multiRoleUser, PERMISSIONS.RELEASE_CREATE)).toBe(true);
    expect(hasPermission(multiRoleUser, PERMISSIONS.LABEL_ASSIGN_ARTIST)).toBe(true);
  });

  it("should return false for null user", () => {
    expect(hasPermission(null, PERMISSIONS.RELEASE_CREATE)).toBe(false);
  });
});

describe("Auth — hasAnyPermission", () => {
  it("should return true if user has at least one permission", () => {
    expect(
      hasAnyPermission(artistUser, [PERMISSIONS.RELEASE_CREATE, PERMISSIONS.USER_DELETE])
    ).toBe(true);
  });

  it("should return false if user has none", () => {
    expect(
      hasAnyPermission(artistUser, [PERMISSIONS.USER_DELETE, PERMISSIONS.SYSTEM_SETTINGS])
    ).toBe(false);
  });
});

describe("Auth — hasAllPermissions", () => {
  it("should return true if user has all permissions", () => {
    expect(
      hasAllPermissions(artistUser, [PERMISSIONS.RELEASE_CREATE, PERMISSIONS.RELEASE_READ])
    ).toBe(true);
  });

  it("should return false if user is missing one", () => {
    expect(
      hasAllPermissions(artistUser, [PERMISSIONS.RELEASE_CREATE, PERMISSIONS.USER_DELETE])
    ).toBe(false);
  });
});

describe("Auth — getUserPermissions", () => {
  it("should return unique permissions for multi-role user", () => {
    const perms = getUserPermissions(multiRoleUser);
    const unique = new Set(perms);
    expect(perms.length).toBe(unique.size);
  });

  it("should return empty for null user", () => {
    expect(getUserPermissions(null)).toEqual([]);
  });
});

describe("Auth — isAdmin / isArtist / isLabel", () => {
  it("isAdmin should identify admin", () => {
    expect(isAdmin(adminUser)).toBe(true);
    expect(isAdmin(artistUser)).toBe(false);
  });

  it("isArtist should identify artist", () => {
    expect(isArtist(artistUser)).toBe(true);
    expect(isArtist(adminUser)).toBe(false);
  });

  it("isLabel should identify label", () => {
    expect(isLabel(labelUser)).toBe(true);
    expect(isLabel(artistUser)).toBe(false);
  });
});

describe("Auth — hashPassword / verifyPassword", () => {
  it("hashPassword should call bcrypt.hash with cost 12", async () => {
    const result = await hashPassword("testpass");
    expect(bcrypt.hash).toHaveBeenCalledWith("testpass", 12);
    expect(result).toBe("$2a$12$hashed");
  });

  it("verifyPassword should call bcrypt.compare", async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    const result = await verifyPassword("testpass", "$2a$12$hashed");
    expect(bcrypt.compare).toHaveBeenCalledWith("testpass", "$2a$12$hashed");
    expect(result).toBe(true);
  });

  it("verifyPassword should return false on mismatch", async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
    const result = await verifyPassword("wrong", "$2a$12$hashed");
    expect(result).toBe(false);
  });
});
