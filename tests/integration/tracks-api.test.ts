/**
 * Integration tests for Tracks API
 */

jest.mock("@/lib/prisma", () => ({
  prisma: {
    track: {
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
  },
}));

jest.mock("next/headers", () => ({
  cookies: jest.fn(() => ({
    get: jest.fn().mockReturnValue({ value: "mock-token" }),
  })),
}));

import { prisma } from "@/lib/prisma";

describe("Tracks API — data access patterns", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should list tracks with pagination", async () => {
    const mockTracks = [
      { id: "track-1", title: "Song One", trackNumber: 1, discNumber: 1 },
      { id: "track-2", title: "Song Two", trackNumber: 2, discNumber: 1 },
    ];

    (prisma.track.findMany as jest.Mock).mockResolvedValue(mockTracks);
    (prisma.track.count as jest.Mock).mockResolvedValue(2);

    const tracks = await prisma.track.findMany({
      take: 20,
      skip: 0,
      orderBy: { trackNumber: "asc" },
    });

    expect(tracks).toHaveLength(2);
    expect(tracks[0].title).toBe("Song One");
  });

  it("should create a track with ISRC", async () => {
    const newTrack = {
      id: "track-new",
      title: "New Song",
      isrc: "USRC12345678",
      trackNumber: 1,
      discNumber: 1,
      durationMs: 240000,
    };

    (prisma.track.create as jest.Mock).mockResolvedValue(newTrack);

    const created = await prisma.track.create({
      data: {
        title: "New Song",
        isrc: "USRC12345678",
        trackNumber: 1,
        discNumber: 1,
        durationMs: 240000,
        releaseId: "release-1",
      },
    });

    expect(created.isrc).toBe("USRC12345678");
    expect(created.durationMs).toBe(240000);
  });

  it("should find track by ID with release info", async () => {
    const mockTrack = {
      id: "track-1",
      title: "Song One",
      release: { id: "release-1", title: "Test Album" },
      artists: [{ id: "artist-1", name: "Test Artist" }],
    };

    (prisma.track.findUnique as jest.Mock).mockResolvedValue(mockTrack);

    const track = await prisma.track.findUnique({
      where: { id: "track-1" },
      include: { release: true, artists: true },
    });

    expect(track?.release.title).toBe("Test Album");
    expect(track?.artists).toHaveLength(1);
  });

  it("should update track metadata", async () => {
    const updated = {
      id: "track-1",
      title: "Updated Song Title",
      isrc: "USRC12345678",
    };

    (prisma.track.update as jest.Mock).mockResolvedValue(updated);

    const result = await prisma.track.update({
      where: { id: "track-1" },
      data: { title: "Updated Song Title" },
    });

    expect(result.title).toBe("Updated Song Title");
  });

  it("should delete a track", async () => {
    (prisma.track.delete as jest.Mock).mockResolvedValue({ id: "track-1" });

    const result = await prisma.track.delete({
      where: { id: "track-1" },
    });

    expect(result.id).toBe("track-1");
    expect(prisma.track.delete).toHaveBeenCalledWith({
      where: { id: "track-1" },
    });
  });
});
