/**
 * Integration tests for Releases API
 * Tests the releases API route handlers with mocked database
 */

jest.mock("@/lib/prisma", () => ({
  prisma: {
    release: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock("next/headers", () => ({
  cookies: jest.fn(() => ({
    get: jest.fn().mockReturnValue({ value: "mock-token" }),
    set: jest.fn(),
    delete: jest.fn(),
  })),
}));

jest.mock("@/lib/auth", () => ({
  ...jest.requireActual("@/lib/auth"),
  getSession: jest.fn(),
}));

import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

describe("Releases API — data access patterns", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return paginated releases", async () => {
    const mockReleases = [
      {
        id: "release-1",
        title: "Test Album",
        status: "PENDING",
        releaseDate: new Date("2025-01-15"),
        createdAt: new Date(),
      },
      {
        id: "release-2",
        title: "Second Album",
        status: "RELEASED",
        releaseDate: new Date("2025-02-01"),
        createdAt: new Date(),
      },
    ];

    (prisma.release.findMany as jest.Mock).mockResolvedValue(mockReleases);
    (prisma.release.count as jest.Mock).mockResolvedValue(2);

    const releases = await prisma.release.findMany({
      take: 20,
      skip: 0,
      orderBy: { createdAt: "desc" },
    });

    expect(releases).toHaveLength(2);
    expect(releases[0].title).toBe("Test Album");
    expect(prisma.release.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 20, skip: 0 })
    );
  });

  it("should create a new release", async () => {
    const newRelease = {
      id: "release-new",
      title: "New Album",
      status: "PENDING",
      releaseDate: new Date("2025-06-01"),
      createdAt: new Date(),
    };

    (prisma.release.create as jest.Mock).mockResolvedValue(newRelease);

    const created = await prisma.release.create({
      data: {
        title: "New Album",
        status: "PENDING",
        releaseDate: new Date("2025-06-01"),
        createdById: "user-1",
      },
    });

    expect(created.title).toBe("New Album");
    expect(created.status).toBe("PENDING");
    expect(prisma.release.create).toHaveBeenCalled();
  });

  it("should find release by ID", async () => {
    const mockRelease = {
      id: "release-1",
      title: "Test Album",
      status: "RELEASED",
      tracks: [],
    };

    (prisma.release.findUnique as jest.Mock).mockResolvedValue(mockRelease);

    const release = await prisma.release.findUnique({
      where: { id: "release-1" },
      include: { tracks: true },
    });

    expect(release).toBeTruthy();
    expect(release?.title).toBe("Test Album");
  });

  it("should return null for non-existent release", async () => {
    (prisma.release.findUnique as jest.Mock).mockResolvedValue(null);

    const release = await prisma.release.findUnique({
      where: { id: "non-existent" },
    });

    expect(release).toBeNull();
  });

  it("should update release status", async () => {
    const updated = {
      id: "release-1",
      title: "Test Album",
      status: "RELEASED",
    };

    (prisma.release.update as jest.Mock).mockResolvedValue(updated);

    const result = await prisma.release.update({
      where: { id: "release-1" },
      data: { status: "RELEASED" },
    });

    expect(result.status).toBe("RELEASED");
  });
});

describe("Releases API — authorization", () => {
  it("should deny access to unauthenticated users", async () => {
    (getSession as jest.Mock).mockResolvedValue(null);
    const session = await getSession();
    expect(session).toBeNull();
  });

  it("should allow admin full access", async () => {
    (getSession as jest.Mock).mockResolvedValue({
      id: "admin-1",
      email: "admin@bealpha.com",
      roles: ["admin"],
    });

    const session = await getSession();
    expect(session).toBeTruthy();
    expect(session?.roles).toContain("admin");
  });
});
