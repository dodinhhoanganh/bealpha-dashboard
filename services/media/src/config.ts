import path from "node:path";

export interface MediaConfig {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  logLevel: string;
  trustProxyHops: number;
  controlBodyLimitBytes: number;
  databaseUrl: string;
  dbPoolMax: number;
  redisUrl: string;
  gatewayContextPublicKeyPem: string;
  gatewayContextIssuer: string;
  gatewayContextAudience: string;
  publicBaseUrl: string;
  storageRoot: string;
  uploadTtlSeconds: number;
  uploadMaxBytes: number;
  uploadConcurrency: number;
  streamGrantTtlSeconds: number;
  previewGrantMaxUses: number;
  deliveryGrantTtlSeconds: number;
  deliveryGrantMaxUses: number;
  streamConcurrency: number;
  workerPollMs: number;
  workerMaxAttempts: number;
  archiveRetentionSeconds: number;
}

function integer(name: string, value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return parsed;
}

function publicKey(value: string | undefined): string {
  if (!value || /change[_-]?me/i.test(value) || value.length % 4 !== 0) throw new Error("GATEWAY_INTERNAL_CONTEXT_PUBLIC_KEY_B64 is required");
  const der = Buffer.from(value, "base64");
  if (der.length < 64 || der.length > 8192) throw new Error("GATEWAY_INTERNAL_CONTEXT_PUBLIC_KEY_B64 has invalid length");
  return `-----BEGIN PUBLIC KEY-----\n${der.toString("base64").match(/.{1,64}/g)?.join("\n")}\n-----END PUBLIC KEY-----`;
}

export function loadMediaConfig(env: NodeJS.ProcessEnv = process.env): MediaConfig {
  const nodeEnv = env.NODE_ENV === "production" || env.NODE_ENV === "test" ? env.NODE_ENV : "development";
  const databaseUrl = env.MEDIA_DATABASE_URL;
  if (!databaseUrl || !["postgres:", "postgresql:"].includes(new URL(databaseUrl).protocol)) throw new Error("MEDIA_DATABASE_URL must use PostgreSQL");
  const redisUrl = env.MEDIA_REDIS_URL ?? env.REDIS_URL;
  if (nodeEnv === "production" && !redisUrl) throw new Error("REDIS_URL is required in production");
  const publicBaseUrl = new URL(env.MEDIA_PUBLIC_BASE_URL ?? "http://localhost:8080");
  if (nodeEnv === "production" && publicBaseUrl.protocol !== "https:") throw new Error("MEDIA_PUBLIC_BASE_URL must use HTTPS in production");
  return {
    nodeEnv,
    host: env.MEDIA_HOST ?? "0.0.0.0",
    port: integer("MEDIA_PORT", env.MEDIA_PORT, 4103, 1, 65535),
    logLevel: env.LOG_LEVEL ?? "info",
    trustProxyHops: integer("TRUST_PROXY_HOPS", env.TRUST_PROXY_HOPS, 1, 0, 5),
    controlBodyLimitBytes: integer("MEDIA_CONTROL_BODY_LIMIT_BYTES", env.MEDIA_CONTROL_BODY_LIMIT_BYTES, 32768, 4096, 65536),
    databaseUrl,
    dbPoolMax: integer("MEDIA_DB_POOL_MAX", env.MEDIA_DB_POOL_MAX, 10, 1, 50),
    redisUrl: redisUrl ?? "redis://localhost:6379",
    gatewayContextPublicKeyPem: publicKey(env.GATEWAY_INTERNAL_CONTEXT_PUBLIC_KEY_B64),
    gatewayContextIssuer: env.GATEWAY_INTERNAL_CONTEXT_ISSUER ?? "bealpha-gateway",
    gatewayContextAudience: env.GATEWAY_INTERNAL_CONTEXT_AUDIENCE ?? "bealpha-services",
    publicBaseUrl: publicBaseUrl.toString().replace(/\/$/, ""),
    storageRoot: path.resolve(env.MEDIA_STORAGE_ROOT ?? "./data"),
    uploadTtlSeconds: integer("MEDIA_UPLOAD_TTL_SECONDS", env.MEDIA_UPLOAD_TTL_SECONDS, 900, 60, 3600),
    uploadMaxBytes: integer("MEDIA_UPLOAD_MAX_BYTES", env.MEDIA_UPLOAD_MAX_BYTES, 50 * 1024 * 1024 * 1024, 1024, 50 * 1024 * 1024 * 1024),
    uploadConcurrency: integer("MEDIA_UPLOAD_CONCURRENCY", env.MEDIA_UPLOAD_CONCURRENCY, 4, 1, 32),
    streamGrantTtlSeconds: integer("MEDIA_STREAM_GRANT_TTL_SECONDS", env.MEDIA_STREAM_GRANT_TTL_SECONDS, 60, 15, 300),
    previewGrantMaxUses: integer("MEDIA_PREVIEW_GRANT_MAX_USES", env.MEDIA_PREVIEW_GRANT_MAX_USES, 8, 1, 20),
    deliveryGrantTtlSeconds: integer("MEDIA_DELIVERY_GRANT_TTL_SECONDS", env.MEDIA_DELIVERY_GRANT_TTL_SECONDS, 3600, 300, 86400),
    deliveryGrantMaxUses: integer("MEDIA_DELIVERY_GRANT_MAX_USES", env.MEDIA_DELIVERY_GRANT_MAX_USES, 5, 1, 20),
    streamConcurrency: integer("MEDIA_STREAM_CONCURRENCY", env.MEDIA_STREAM_CONCURRENCY, 32, 1, 256),
    workerPollMs: integer("MEDIA_WORKER_POLL_MS", env.MEDIA_WORKER_POLL_MS, 1000, 250, 60000),
    workerMaxAttempts: integer("MEDIA_WORKER_MAX_ATTEMPTS", env.MEDIA_WORKER_MAX_ATTEMPTS, 3, 1, 10),
    archiveRetentionSeconds: integer("MEDIA_ARCHIVE_RETENTION_SECONDS", env.MEDIA_ARCHIVE_RETENTION_SECONDS, 86400, 3600, 604800)
  };
}
