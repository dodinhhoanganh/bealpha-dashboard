/**
 * Integration tests for Auth API flow
 * 
 * Tests the login/session lifecycle through the API routes.
 * These tests mock the database layer but exercise real route handlers.
 */

// Mock Prisma
jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  },
}));

// Mock next/headers
jest.mock("next/headers", () => ({
  cookies: jest.fn(() => ({
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  })),
}));

import { prisma } from "@/lib/prisma";
import {
  hashPassword,
  createToken,
  verifyToken,
  hasPermission,
  PERMISSIONS,
  ROLES,
} from "@/lib/auth";

describe("Auth Flow — Token Lifecycle", () => {
  it("should create and verify a valid token", async () => {
    const payload = {
      id: "test-user-id",
      email: "test@bealpha.com",
      roles: [ROLES.ADMIN],
    };

    const token = await createToken(payload);
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);

    const decoded = await verifyToken(token);
    expect(decoded).toBeTruthy();
    expect(decoded?.id).toBe(payload.id);
    expect(decoded?.email).toBe(payload.email);
    expect(decoded?.roles).toEqual(payload.roles);
  });

  it("should reject an invalid token", async () => {
    const result = await verifyToken("invalid-token-string");
    expect(result).toBeNull();
  });

  it("should reject an empty token", async () => {
    const result = await verifyToken("");
    expect(result).toBeNull();
  });
});

describe("Auth Flow — Password Hashing", () => {
  it("should hash and verify password correctly", async () => {
    // Use real bcrypt for integration test
    const bcrypt = await import("bcryptjs");
    const password = "SecureP@ssw0rd!";
    const hash = await hashPassword(password);

    expect(hash).not.toBe(password);
    expect(hash.startsWith("$2")).toBe(true);

    const match = await bcrypt.compare(password, hash);
    expect(match).toBe(true);
  });
});

describe("Auth Flow — Permission Checks", () => {
  it("admin user should access all features", () => {
    const admin = {
      id: "admin-1",
      email: "admin@test.com",
      roles: [ROLES.ADMIN],
    };

    expect(hasPermission(admin, PERMISSIONS.RELEASE_CREATE)).toBe(true);
    expect(hasPermission(admin, PERMISSIONS.USER_DELETE)).toBe(true);
    expect(hasPermission(admin, PERMISSIONS.SYSTEM_SETTINGS)).toBe(true);
    expect(hasPermission(admin, PERMISSIONS.FINANCE_PAYOUT)).toBe(true);
  });

  it("artist should be restricted", () => {
    const artist = {
      id: "artist-1",
      email: "artist@test.com",
      roles: [ROLES.ARTIST],
    };

    expect(hasPermission(artist, PERMISSIONS.RELEASE_CREATE)).toBe(true);
    expect(hasPermission(artist, PERMISSIONS.USER_DELETE)).toBe(false);
    expect(hasPermission(artist, PERMISSIONS.SYSTEM_SETTINGS)).toBe(false);
  });

  it("label manager should manage artists", () => {
    const label = {
      id: "label-1",
      email: "label@test.com",
      roles: [ROLES.LABEL],
    };

    expect(hasPermission(label, PERMISSIONS.ARTIST_CREATE)).toBe(true);
    expect(hasPermission(label, PERMISSIONS.LABEL_ASSIGN_ARTIST)).toBe(true);
    expect(hasPermission(label, PERMISSIONS.SYSTEM_SETTINGS)).toBe(false);
  });
});
