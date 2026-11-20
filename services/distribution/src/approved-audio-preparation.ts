import type { Prisma } from "./generated/distribution-prisma2/client.js";
import type { DistributionDatabase } from "./database.js";

const PREPARATION_ERROR_LIMIT = 1000;

export type ApprovedAudioPreparation = {
  packageId: string;
  releaseId: string;
  tenantId: string;
  entityPath: string;
  createdAt: string;
  requestId: string;
  actorId: string;
  approverEntityId: string;
};

export function sanitizePreparationError(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "DDEX_PREPARATION_FAILED";
  const sanitized = raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/(?:Bearer\s+)?[A-Za-z0-9_-]{40,}/gi, "[REDACTED]")
    .replace(/https?:\/\/\S+/gi, "[REDACTED_URL]")
    .replace(/\s+/g, " ")
    .trim();
  return (`DDEX_PREPARATION_FAILED: ${sanitized || "UNKNOWN"}`).slice(0, PREPARATION_ERROR_LIMIT);
}

export async function ensureApprovedAudioPreparation(database: DistributionDatabase, input: ApprovedAudioPreparation) {
  const payload = JSON.parse(JSON.stringify({
    kind: "DDEX_PACKAGE",
    phase: "PREPARING",
    approvalEventId: input.packageId,
    approvalOccurredAt: input.createdAt,
    approverEntityId: input.approverEntityId,
    snapshot: { id: input.releaseId },
    destinations: []
  })) as Prisma.InputJsonValue;
  const job = await database.prisma.exportJob.upsert({
    where: { id: input.packageId },
    create: {
      id: input.packageId,
      tenantId: input.tenantId,
      entityPath: input.entityPath,
      actorId: input.actorId,
      requestId: input.requestId,
      format: "ZIP",
      status: "RUNNING",
      lockedAt: null,
      payload,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
    },
    update: {}
  });
  if (job.status === "FAILED") {
    await database.prisma.exportJob.updateMany({
      where: { id: input.packageId, status: "FAILED" },
      data: {
        status: "RUNNING",
        lockedAt: null,
        lastError: null,
        attempts: 0,
        outputPath: null,
        fileName: null,
        contentType: null,
        sizeBytes: null,
        sha256: null,
        payload
      }
    });
  }
  return database.prisma.exportJob.findUniqueOrThrow({ where: { id: input.packageId } });
}

export async function resumeApprovedAudioPreparation(database: DistributionDatabase, packageId: string) {
  await database.prisma.exportJob.updateMany({
    where: { id: packageId, status: "FAILED" },
    data: { status: "RUNNING", lockedAt: null, lastError: null, attempts: 0 }
  });
  const job = await database.prisma.exportJob.findUnique({ where: { id: packageId } });
  if (!job) throw new Error("Automatic DDEX preparation record is missing");
  return job;
}

export async function failApprovedAudioPreparation(database: DistributionDatabase, packageId: string, error: unknown) {
  return database.prisma.exportJob.updateMany({
    where: { id: packageId, status: "RUNNING" },
    data: { status: "FAILED", lockedAt: null, lastError: sanitizePreparationError(error) }
  });
}
