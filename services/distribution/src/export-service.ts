import { INTERNAL_CONTEXT_HEADER, type InternalAuthContext } from "@bealpha/contracts";
import { z } from "zod";
import type { DistributionConfig } from "./config.js";
import type { DistributionDatabase } from "./database.js";
import { DistributionError } from "./errors.js";
import { createExportToken, verifyExportToken } from "./export-token.js";
import { openPackageDownload } from "./package-download-file.js";
import { encryptGrantToken } from "./grant-crypto.js";
import { Prisma } from "./generated/distribution-prisma2/client.js";
import { Queue } from "bullmq";
import { redisConnection } from "./queues.js";
import { ensureApprovedAudioPreparation } from "./approved-audio-preparation.js";

type ExportActor = InternalAuthContext & { actorId: string; entityId: string; entityPath: string };
type ExportFormat = "xlsx" | "zip";

const releaseSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  title: z.string(),
  tracks: z.array(z.object({ id: z.string().uuid(), title: z.string(), audioAssetId: z.string().uuid().nullable().optional() }).passthrough()).max(10000),
}).passthrough();
const snapshotEnvelope = z.object({ data: z.array(releaseSchema).max(10000) });
const grantSchema = z.object({ assetId: z.string().uuid(), token: z.string().min(40).max(128), expiresAt: z.string().datetime({ offset: true }), fileName: z.string().min(1).max(500), contentType: z.string().min(1).max(255), sizeBytes: z.string().regex(/^\d+$/), sha256: z.string().regex(/^[a-f0-9]{64}$/) });
const grantsEnvelope = z.object({ data: z.array(grantSchema).max(10000) });

function exportActor(context: InternalAuthContext): ExportActor {
  if (context.authType !== "user" || !context.actorId || !context.entityId || !context.entityPath) {
    throw new DistributionError(403, "FORBIDDEN", "Catalog export requires entity membership");
  }
  if (context.entityRole === "ACCOUNTANT") {
    throw new DistributionError(403, "FORBIDDEN", "Accounting access cannot export delivery packages");
  }
  return context as ExportActor;
}

function visible(pathValue: string) {
  return { OR: [{ entityPath: pathValue }, { entityPath: { startsWith: `${pathValue}.` } }] };
}

function isManualDdex(job: { payload?: unknown }): boolean {
  return Boolean(job.payload && typeof job.payload === "object" && (job.payload as { kind?: unknown }).kind === "DDEX_PACKAGE");
}

function isManualCustodian(context: InternalAuthContext): boolean {
  return context.entityType === "SUPER_ADMIN" && context.entityRole === "OWNER";
}

export class ExportService {
  constructor(private readonly database: DistributionDatabase, private readonly config: DistributionConfig, private readonly retryPublisher = async (jobId: string, data: Record<string, unknown>) => {
    const queue = new Queue("catalog-saga-queue", { connection: redisConnection(config.redisUrl) });
    try {
      const prior = await queue.getJob(jobId);
      if (prior && ["completed", "failed"].includes(await prior.getState())) await prior.remove();
      await queue.add("PrepareApprovedAudioPackageJob", data, { jobId, removeOnComplete: 1000, removeOnFail: 1000 });
    } finally {
      await queue.close();
    }
  }) {}

  private async fetchReleases(releaseId: string | undefined, requestId: string, signedContext: string) {
    const query = releaseId ? `?releaseId=${encodeURIComponent(releaseId)}` : "";
    const response = await fetch(`${this.config.catalogServiceUrl}/api/v1/catalog/releases/export-snapshot${query}`, {
      headers: { "x-request-id": requestId, [INTERNAL_CONTEXT_HEADER]: signedContext },
      signal: AbortSignal.timeout(30000),
    }).catch(() => null);
    if (!response?.ok) throw new DistributionError(response?.status === 413 ? 413 : 503, response?.status === 413 ? "EXPORT_TOO_LARGE" : "UPSTREAM_UNAVAILABLE", "Catalog export snapshot unavailable");
    const releases = snapshotEnvelope.parse(await response.json()).data;
    const trackCount = releases.reduce((sum, release) => sum + release.tracks.length, 0);
    if (trackCount > 10000) throw new DistributionError(413, "EXPORT_TOO_LARGE", "Catalog export exceeds 10000 tracks");
    return releases;
  }

  private async fetchGrants(releases: z.infer<typeof releaseSchema>[], requestId: string, signedContext: string) {
    const assetIds = [...new Set(releases.flatMap(release => release.tracks.map(track => track.audioAssetId).filter((id): id is string => Boolean(id))))];
    const trackCount = releases.reduce((sum, release) => sum + release.tracks.length, 0);
    if (assetIds.length !== trackCount) throw new DistributionError(422, "DELIVERY_ASSET_MISSING", "Every exported track requires a ready audio master");
    if (assetIds.length + 1 > this.config.packageMaxEntries) throw new DistributionError(413, "EXPORT_TOO_LARGE", "ZIP export exceeds entry limit");
    const response = await fetch(`${this.config.mediaServiceUrl}/api/v1/media/delivery-grants`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": requestId, [INTERNAL_CONTEXT_HEADER]: signedContext },
      body: JSON.stringify({ assetIds }),
      signal: AbortSignal.timeout(30000),
    }).catch(() => null);
    if (!response?.ok) throw new DistributionError(response?.status === 404 ? 404 : 503, response?.status === 404 ? "NOT_FOUND" : "UPSTREAM_UNAVAILABLE", "Media export grants unavailable");
    return grantsEnvelope.parse(await response.json()).data.map(grant => ({
      ...grant,
      token: encryptGrantToken(grant.token, this.config.deliveryGrantEncryptionKey),
    }));
  }

  async createExport(context: InternalAuthContext, input: { format: ExportFormat; releaseId?: string }, signedContext: string) {
    const current = exportActor(context);
    const releases = await this.fetchReleases(input.releaseId, context.requestId, signedContext);
    if (input.format === "zip" && releases.length !== 1) throw new DistributionError(400, "ZIP_EXPORT_REQUIRES_ONE_RELEASE", "ZIP export requires exactly one release");
    const grants = input.format === "zip" ? await this.fetchGrants(releases, context.requestId, signedContext) : [];
    const payload = JSON.parse(JSON.stringify({ releases, grants })) as Prisma.InputJsonValue;
    const job = await this.database.prisma.exportJob.create({
      data: {
        tenantId: releases[0]?.tenantId ?? current.entityId,
        entityPath: current.entityPath,
        actorId: current.actorId,
        requestId: context.requestId,
        format: input.format.toUpperCase() as "XLSX" | "ZIP",
        payload,
        expiresAt: new Date(Date.now() + this.config.exportRetentionSeconds * 1000),
      },
    });
    return this.serialize(job);
  }

  async getExport(context: InternalAuthContext, jobId: string) {
    const current = exportActor(context);
    const job = await this.database.prisma.exportJob.findFirst({ where: { id: jobId, ...visible(current.entityPath) } });
    if (!job || (isManualDdex(job) && !isManualCustodian(context))) throw new DistributionError(404, "NOT_FOUND", "Export job not found");
    return this.serialize(job);
  }

  async listExports(context: InternalAuthContext) {
    const current = exportActor(context);
    const jobs = await this.database.prisma.exportJob.findMany({ where: visible(current.entityPath), orderBy: { createdAt: "desc" }, take: 100 });
    return jobs.filter(job => !isManualDdex(job) || isManualCustodian(context)).map(job => this.serialize(job));
  }

  async retryApprovedAudioPackage(context: InternalAuthContext, jobId: string) {
    const current = exportActor(context);
    if (!isManualCustodian(context)) throw new DistributionError(404, "NOT_FOUND", "Export job not found");
    const job = await this.database.prisma.exportJob.findUnique({ where: { id: jobId } });
    const payload = job?.payload && typeof job.payload === "object" ? job.payload as { kind?: unknown; phase?: unknown; approvalEventId?: unknown; approvalOccurredAt?: unknown; approverEntityId?: unknown; snapshot?: { id?: unknown } } : undefined;
    if (!job || job.status !== "FAILED" || payload?.kind !== "DDEX_PACKAGE" || typeof payload.snapshot?.id !== "string" || typeof payload.approvalOccurredAt !== "string" || typeof payload.approverEntityId !== "string") {
      throw new DistributionError(409, "DDEX_PACKAGE_NOT_RETRYABLE", "DDEX package preparation is not retryable");
    }
    await ensureApprovedAudioPreparation(this.database, {
      packageId: job.id,
      releaseId: payload.snapshot.id,
      tenantId: job.tenantId,
      entityPath: job.entityPath,
      createdAt: payload.approvalOccurredAt,
      requestId: context.requestId,
      actorId: current.actorId,
      approverEntityId: payload.approverEntityId
    });
    try {
      await this.retryPublisher(job.id, {
        packageId: job.id,
        releaseId: payload.snapshot.id,
        createdAt: payload.approvalOccurredAt,
        requestId: context.requestId,
        actor: { ...current, requestId: context.requestId }
      });
    } catch (error) {
      await this.database.prisma.exportJob.updateMany({ where: { id: job.id, status: "RUNNING" }, data: { status: "FAILED", lastError: "DDEX_PREPARATION_FAILED: RETRY_QUEUE_UNAVAILABLE" } });
      throw error;
    }
    return this.getExport(context, job.id);
  }

  async openExport(jobId: string, token: string) {
    if (!verifyExportToken(jobId, token, this.config.exportDownloadSigningKey)) throw new DistributionError(401, "INVALID_EXPORT_TOKEN", "Export token is invalid or expired");
    const job = await this.database.prisma.exportJob.findUnique({ where: { id: jobId } });
    if (!job || job.status !== "COMPLETE" || !job.outputPath || !job.fileName || !job.contentType || !job.sizeBytes || job.expiresAt <= new Date()) throw new DistributionError(404, "NOT_FOUND", "Export file is unavailable");
    const opened = await openPackageDownload(this.config.packageRoot, job.outputPath, job.sizeBytes, "Export file is unavailable");
    return { ...opened, fileName: job.fileName, contentType: job.contentType };
  }

  private serialize(job: { id: string; format: "XLSX" | "ZIP"; status: string; fileName: string | null; contentType: string | null; sizeBytes: bigint | null; sha256: string | null; lastError: string | null; expiresAt: Date; createdAt: Date; updatedAt: Date; payload?: unknown }) {
    const payload = job.payload && typeof job.payload === "object" ? job.payload as { kind?: unknown; snapshot?: { id?: unknown; title?: unknown }; destinations?: Array<{ recipientId?: unknown }>; releases?: Array<{ id?: unknown; title?: unknown }> } : undefined;
    const releaseId = payload?.kind === "DDEX_PACKAGE" && typeof payload.snapshot?.id === "string" ? payload.snapshot.id : undefined;
    const releaseTitle = payload?.kind === "DDEX_PACKAGE" && typeof payload.snapshot?.title === "string"
      ? payload.snapshot.title
      : typeof payload?.releases?.[0]?.title === "string" ? payload.releases[0].title : undefined;
    return {
      id: job.id,
      ...(releaseId ? { releaseId } : {}),
      ...(releaseTitle ? { releaseTitle } : {}),
      ...(payload?.kind === "DDEX_PACKAGE" && Array.isArray(payload.destinations) ? { targetDsps: payload.destinations.map(item => item.recipientId).filter((item): item is string => typeof item === "string") } : {}),
      format: job.format.toLowerCase(),
      status: job.status.toLowerCase(),
      fileName: job.fileName,
      contentType: job.contentType,
      sizeBytes: job.sizeBytes?.toString() ?? null,
      sha256: job.sha256,
      error: job.lastError,
      expiresAt: job.expiresAt.toISOString(),
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
      ...(job.status === "COMPLETE" ? { downloadUrl: `${this.config.publicBaseUrl}/distribution-export/${job.id}?token=${encodeURIComponent(createExportToken(job.id, this.config.exportDownloadTtlSeconds, this.config.exportDownloadSigningKey))}` } : {}),
    };
  }
}
