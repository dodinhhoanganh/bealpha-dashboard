export interface CatalogConfig {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  logLevel: string;
  trustProxyHops: number;
  bodyLimitBytes: number;
  databaseUrl: string;
  dbPoolMax: number;
  gatewayContextPublicKeyPem: string;
  gatewayContextIssuer: string;
  gatewayContextAudience: string;
  redisUrl?: string;
  outboxPollMs?: number;
  outboxBatchSize?: number;
  spotifyClientId?: string;
  spotifyClientSecret?: string;
  mediaServiceUrl: string;
  distributionServiceUrl?: string;
  importGrantEncryptionKey: Buffer;
  importRoot: string;
  importMaxBytes: number;
  importMaxEntries: number;
  importMaxXmlBytes: number;
  importWorkerPollMs: number;
  importWorkerMaxAttempts: number;
}

function integer(name: string, value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return parsed;
}

function derPublicKey(value: string | undefined): string {
  if (!value || /change[_-]?me/i.test(value) || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error("GATEWAY_INTERNAL_CONTEXT_PUBLIC_KEY_B64 must be a base64-encoded DER PUBLIC KEY");
  const der = Buffer.from(value, "base64");
  if (der.length < 64 || der.length > 8192) throw new Error("GATEWAY_INTERNAL_CONTEXT_PUBLIC_KEY_B64 has an invalid DER key length");
  const body = der.toString("base64").match(/.{1,64}/g)?.join("\n");
  if (!body) throw new Error("GATEWAY_INTERNAL_CONTEXT_PUBLIC_KEY_B64 could not be decoded");
  return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----`;
}

function encryptionKey(value: string | undefined): Buffer {
  if (!value || /change[_-]?me/i.test(value)) throw new Error("CATALOG_IMPORT_GRANT_ENCRYPTION_KEY_B64 is required");
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("CATALOG_IMPORT_GRANT_ENCRYPTION_KEY_B64 must decode to 32 bytes");
  return key;
}

export function loadCatalogConfig(env: NodeJS.ProcessEnv = process.env): CatalogConfig {
  const nodeEnv = env.NODE_ENV === "production" || env.NODE_ENV === "test" ? env.NODE_ENV : "development";
  const databaseUrl = env.CATALOG_DATABASE_URL;
  if (!databaseUrl || !["postgres:", "postgresql:"].includes(new URL(databaseUrl).protocol)) throw new Error("CATALOG_DATABASE_URL must use PostgreSQL");
  const redisUrl = env.REDIS_URL; if (nodeEnv === "production" && !redisUrl) throw new Error("REDIS_URL is required in production");
  return {
    nodeEnv,
    host: env.CATALOG_HOST ?? "0.0.0.0",
    port: integer("CATALOG_PORT", env.CATALOG_PORT, 4102, 1, 65535),
    logLevel: env.LOG_LEVEL ?? "info",
    trustProxyHops: integer("TRUST_PROXY_HOPS", env.TRUST_PROXY_HOPS, 1, 0, 5),
    bodyLimitBytes: integer("CATALOG_BODY_LIMIT_BYTES", env.CATALOG_BODY_LIMIT_BYTES, 32768, 4096, 65536),
    databaseUrl,
    dbPoolMax: integer("CATALOG_DB_POOL_MAX", env.CATALOG_DB_POOL_MAX, 10, 1, 50),
    gatewayContextPublicKeyPem: derPublicKey(env.GATEWAY_INTERNAL_CONTEXT_PUBLIC_KEY_B64),
    gatewayContextIssuer: env.GATEWAY_INTERNAL_CONTEXT_ISSUER ?? "bealpha-gateway",
    gatewayContextAudience: env.GATEWAY_INTERNAL_CONTEXT_AUDIENCE ?? "bealpha-services",
    ...(redisUrl ? { redisUrl } : {}),
    outboxPollMs: integer("CATALOG_OUTBOX_POLL_MS", env.CATALOG_OUTBOX_POLL_MS, 1000, 250, 60000),
    outboxBatchSize: integer("CATALOG_OUTBOX_BATCH_SIZE", env.CATALOG_OUTBOX_BATCH_SIZE, 100, 1, 1000),
    ...(env.SPOTIFY_CLIENT_ID ? { spotifyClientId: env.SPOTIFY_CLIENT_ID } : {}),
    ...(env.SPOTIFY_CLIENT_SECRET ? { spotifyClientSecret: env.SPOTIFY_CLIENT_SECRET } : {}),
    mediaServiceUrl: new URL(env.MEDIA_SERVICE_URL ?? "http://media:4103").toString().replace(/\/$/, ""),
    distributionServiceUrl: new URL(env.DISTRIBUTION_SERVICE_URL ?? "http://distribution:4104").toString().replace(/\/$/, ""),
    importGrantEncryptionKey: encryptionKey(env.CATALOG_IMPORT_GRANT_ENCRYPTION_KEY_B64),
    importRoot: env.CATALOG_IMPORT_ROOT ?? "/imports",
    importMaxBytes: integer("CATALOG_IMPORT_MAX_BYTES", env.CATALOG_IMPORT_MAX_BYTES, 50 * 1024 * 1024 * 1024, 1024, 50 * 1024 * 1024 * 1024),
    importMaxEntries: integer("CATALOG_IMPORT_MAX_ENTRIES", env.CATALOG_IMPORT_MAX_ENTRIES, 10000, 1, 10000),
    importMaxXmlBytes: integer("CATALOG_IMPORT_MAX_XML_BYTES", env.CATALOG_IMPORT_MAX_XML_BYTES, 256 * 1024 * 1024, 1024, 1024 * 1024 * 1024),
    importWorkerPollMs: integer("CATALOG_IMPORT_WORKER_POLL_MS", env.CATALOG_IMPORT_WORKER_POLL_MS, 1000, 250, 60000),
    importWorkerMaxAttempts: integer("CATALOG_IMPORT_WORKER_MAX_ATTEMPTS", env.CATALOG_IMPORT_WORKER_MAX_ATTEMPTS, 3, 1, 10)
  };
}
