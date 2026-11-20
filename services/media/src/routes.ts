import { uploadIntentRequestSchema } from "@bealpha/contracts";
import type { FastifyInstance } from "fastify";
import type { Readable } from "node:stream";
import { z } from "zod";
import { MediaError } from "./errors.js";
import { MediaService } from "./media-service.js";
import { successEnvelope } from "./response.js";

const uuid = z.string().uuid();
const uploadToken = z.string().min(40).max(128).regex(/^[A-Za-z0-9_-]+$/);
const deliveryGrants = z.object({ assetIds: z.array(uuid).min(1).max(10000) }).strict();

function streamToken(queryToken: string | undefined, authorization: string | undefined): string {
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{40,128})$/);
  const bearerToken = match?.[1];
  if (queryToken && bearerToken && queryToken !== bearerToken) {
    throw new MediaError(400, "STREAM_TOKEN_CONFLICT", "Conflicting stream credentials");
  }
  return uploadToken.parse(bearerToken ?? queryToken);
}

function serializeAsset<T extends { id: string; fileSize: bigint; durationSeconds?: number | null; frameRate?: { toString(): string } | null }>(asset: T) {
  return {
    ...asset,
    fileUrl: `media-asset:${asset.id}`,
    fileSize: asset.fileSize.toString(),
    ...(asset.durationSeconds !== undefined ? { duration: asset.durationSeconds } : {}),
    ...(asset.frameRate !== undefined ? { frameRate: asset.frameRate?.toString() ?? null } : {}),
  };
}

export function registerMediaRoutes(app: FastifyInstance, service: MediaService) {
  app.post("/api/v1/media/upload-intents", async (request, reply) => {
    const result = await service.createUploadIntent(request.authContext!, uploadIntentRequestSchema.parse(request.body));
    reply.code(201);
    return successEnvelope(request.id, result);
  });
  app.get("/api/v1/media/assets", async request => successEnvelope(request.id, (await service.listAssets(request.authContext!)).map(serializeAsset)));
  app.get<{ Params: { assetId: string } }>("/api/v1/media/assets/:assetId", async request => successEnvelope(request.id, serializeAsset(await service.getAsset(request.authContext!, uuid.parse(request.params.assetId)))));
  app.delete<{ Params: { assetId: string } }>("/api/v1/media/assets/:assetId", async request => { await service.archiveAsset(request.authContext!, uuid.parse(request.params.assetId), request.id); return successEnvelope(request.id, { success: true }); });
  app.post<{ Params: { assetId: string } }>("/api/v1/media/assets/:assetId/publication", async request => successEnvelope(request.id, await service.publishImage(request.authContext!, uuid.parse(request.params.assetId), request.id)));
  app.post<{ Params: { assetId: string } }>("/api/v1/media/assets/:assetId/stream-grants", async request => successEnvelope(request.id, await service.createStreamGrant(request.authContext!, uuid.parse(request.params.assetId))));
  app.post<{ Params: { assetId: string } }>("/api/v1/media/assets/:assetId/delivery-grants", async request => successEnvelope(request.id, await service.createDeliveryGrant(request.authContext!, uuid.parse(request.params.assetId))));
  app.post("/api/v1/media/delivery-grants", async request => successEnvelope(request.id, await service.createDeliveryGrants(request.authContext!, deliveryGrants.parse(request.body).assetIds)));
  app.get<{ Params: { assetId: string } }>("/api/v1/media/assets/:assetId/archive-entries", async request => successEnvelope(request.id, (await service.listArchiveEntries(request.authContext!, uuid.parse(request.params.assetId))).map(entry => ({ ...entry, asset: serializeAsset(entry.asset) }))));
  app.put<{ Params: { uploadId: string }; Querystring: { token?: string } }>("/media-upload/:uploadId", async (request, reply) => {
    const lengthHeader = request.headers["content-length"];
    const contentLength = typeof lengthHeader === "string" ? Number(lengthHeader) : NaN;
    if (!Number.isSafeInteger(contentLength) || contentLength <= 0) throw new MediaError(411, "CONTENT_LENGTH_REQUIRED", "Valid Content-Length required");
    const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim();
    if (!contentType) throw new MediaError(415, "CONTENT_TYPE_REQUIRED", "Content-Type required");
    const asset = await service.receiveUpload(uuid.parse(request.params.uploadId), uploadToken.parse(request.query.token), contentLength, contentType, request.body as Readable, request.id);
    reply.code(201);
    return successEnvelope(request.id, serializeAsset(asset));
  });
  app.get<{ Params: { assetId: string }; Querystring: { token?: string } }>("/media-stream/:assetId", async (request, reply) => {
    const opened = await service.openStream(
      uuid.parse(request.params.assetId),
      streamToken(request.query.token, request.headers.authorization),
    );
    reply.header("content-length", opened.sizeBytes);
    reply.header("cache-control", "private, no-store");
    reply.header("referrer-policy", "no-referrer");
    reply.header("content-disposition", `inline; filename*=UTF-8''${encodeURIComponent(opened.fileName)}`);
    reply.type(opened.contentType);
    return reply.send(opened.stream);
  });
  app.get<{ Params: { assetId: string } }>("/media-public/:assetId", async (request, reply) => {
    const opened = await service.openPublicImage(uuid.parse(request.params.assetId));
    reply.header("content-length", opened.sizeBytes);
    reply.header("cache-control", "public, max-age=31536000, immutable");
    reply.header("referrer-policy", "no-referrer");
    reply.type(opened.contentType);
    return reply.send(opened.stream);
  });
}
