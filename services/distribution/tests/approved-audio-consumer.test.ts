import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { enqueueApprovedAudioPackage, enqueueApprovedVideoPackage } from "../src/approved-audio-consumer.js";

function event(releaseType: "AUDIO" | "VIDEO", status: string) {
  return { version: 1, eventId: randomUUID(), type: "catalog.release.approved", occurredAt: new Date().toISOString(), requestId: randomUUID(), actorId: randomUUID(), entityPath: "root", payload: { releaseId: randomUUID(), releaseType, tenantId: randomUUID(), approverEntityId: randomUUID(), recipientEntityPath: "root.network.label", status } };
}

function database() {
  const record = { status: "RUNNING", payload: { kind: "DDEX_PACKAGE", phase: "PREPARING" } };
  return { prisma: { exportJob: { upsert: vi.fn().mockResolvedValue(record), updateMany: vi.fn(), findUniqueOrThrow: vi.fn().mockResolvedValue(record) } } };
}

describe("approved AUDIO DDEX preparation trigger", () => {
  it("queues only final SUPER_ADMIN-approved AUDIO releases idempotently", async () => {
    const queue = { add: vi.fn().mockResolvedValue({}) };
    const db = database();
    const approved = event("AUDIO", "APPROVED");
    await expect(enqueueApprovedAudioPackage(approved, queue as never, db as never)).resolves.toBe(true);
    expect(db.prisma.exportJob.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ id: approved.eventId, tenantId: approved.payload.tenantId, entityPath: approved.payload.recipientEntityPath, status: "RUNNING", lockedAt: null }) }));
    expect(db.prisma.exportJob.upsert.mock.invocationCallOrder[0]).toBeLessThan(queue.add.mock.invocationCallOrder[0]!);
    expect(queue.add).toHaveBeenCalledWith("PrepareApprovedAudioPackageJob", expect.objectContaining({ packageId: approved.eventId, releaseId: approved.payload.releaseId, actor: expect.objectContaining({ entityType: "SUPER_ADMIN", entityRole: "OWNER" }) }), expect.objectContaining({ jobId: approved.eventId }));
    expect(await enqueueApprovedAudioPackage(event("AUDIO", "PENDING_SUPER_APPROVAL"), queue as never, db as never)).toBe(false);
    expect(await enqueueApprovedAudioPackage(event("VIDEO", "APPROVED"), queue as never, db as never)).toBe(false);
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it("makes a catalog queue failure visible on the existing preparation record", async () => {
    const queue = { add: vi.fn().mockRejectedValue(new Error("redis://secret.example unavailable")) };
    const db = database(); db.prisma.exportJob.updateMany.mockResolvedValue({ count: 1 });
    const approved = event("AUDIO", "APPROVED");
    await expect(enqueueApprovedAudioPackage(approved, queue as never, db as never)).rejects.toThrow();
    expect(db.prisma.exportJob.updateMany).toHaveBeenCalledWith({ where: { id: approved.eventId, status: "RUNNING" }, data: { status: "FAILED", lastError: "DDEX_PREPARATION_FAILED: CATALOG_QUEUE_UNAVAILABLE" } });
  });

  it("queues final video approval for automatic manual VEVO preparation", async () => {
    const queue = { add: vi.fn() }; const approved = event("VIDEO", "APPROVED");
    await expect(enqueueApprovedVideoPackage(approved, queue as never)).resolves.toBe(true);
    expect(queue.add).toHaveBeenCalledWith("PrepareApprovedVideoPackageJob", expect.objectContaining({ packageId: approved.eventId, releaseId: approved.payload.releaseId, actor: expect.objectContaining({ entityType: "SUPER_ADMIN", entityRole: "OWNER" }) }), expect.objectContaining({ jobId: approved.eventId }));
    expect(await enqueueApprovedVideoPackage(event("VIDEO", "PENDING_SUPER_APPROVAL"), queue as never)).toBe(false);
    expect(await enqueueApprovedVideoPackage(event("AUDIO", "APPROVED"), queue as never)).toBe(false);
  });
});
