import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadDistributionConfig, type DistributionConfig } from "./config.js";
import { createDistributionDatabase, type DistributionDatabase } from "./database.js";
import { buildVevoManualPackage } from "./vevo-package-builder.js";
export { openDeliveryMediaBody } from "./vevo-package-builder.js";

export async function processNextVevoSubmission(database: DistributionDatabase, config: DistributionConfig, builder: typeof buildVevoManualPackage = buildVevoManualPackage): Promise<boolean> {
  const now = new Date();
  const submission = await database.prisma.vevoSubmission.findFirst({ where: { status: "PENDING", availableAt: { lte: now }, lockedAt: null }, include: { assets: true }, orderBy: { createdAt: "asc" } });
  if (!submission) return false;
  const claimed = await database.prisma.vevoSubmission.updateMany({ where: { id: submission.id, status: submission.status, lockedAt: null }, data: { lockedAt: now, attempts: { increment: 1 }, ...(submission.status === "PENDING" ? { status: "PROCESSING" as const } : {}) } });
  if (claimed.count !== 1) return true;
  try {
    const output = await builder(submission, config); const readyAt = new Date();
    await database.prisma.$transaction(async transaction => {
      await transaction.vevoSubmission.update({ where: { id: submission.id }, data: { status: "READY_FOR_MANUAL_DELIVERY", lockedAt: null, lastError: null, ...output } });
      await transaction.vevoSubmissionAsset.updateMany({ where: { submissionId: submission.id }, data: { consumedAt: readyAt } });
      await transaction.outboxEvent.create({ data: { eventId: randomUUID(), version: 1, type: "distribution.vevo.package-ready", requestId: submission.requestId, actorId: submission.actorId, tenantId: submission.tenantId, entityPath: submission.entityPath, payload: { submissionId: submission.id, releaseId: submission.releaseId, isrc: submission.isrc, sha256: output.packageSha256 } } });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : "VEVO_DELIVERY_FAILED";
    const terminal = submission.attempts + 1 >= config.workerMaxAttempts;
    await database.prisma.vevoSubmission.update({ where: { id: submission.id }, data: { status: terminal ? "FAILED" : submission.status, lockedAt: null, lastError: message, availableAt: new Date(Date.now() + Math.min(300_000, 5000 * 2 ** submission.attempts)) } });
  }
  return true;
}

export async function runVevoWorker() {
  const config = loadDistributionConfig(); const database = createDistributionDatabase(config);
  const stale = new Date(Date.now() - 15 * 60_000); await database.prisma.vevoSubmission.updateMany({ where: { lockedAt: { lt: stale }, status: "PROCESSING" }, data: { status: "PENDING", lockedAt: null } });
  let stopping = false; process.on("SIGTERM", () => { stopping = true; }); process.on("SIGINT", () => { stopping = true; });
  while (!stopping) if (!(await processNextVevoSubmission(database, config))) await new Promise(resolve => setTimeout(resolve, config.workerPollMs));
  await database.close();
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await runVevoWorker();
