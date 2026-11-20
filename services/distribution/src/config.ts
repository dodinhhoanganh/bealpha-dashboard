export interface DdexParty { partyId: string; name: string; }
export interface DspRecipient extends DdexParty {}
export interface StoreTarget { name: string; recipientId?: string; releaseTypes?: Array<"AUDIO" | "VIDEO">; }
export interface SftpTarget { host: string; port: number; username: string; remoteDir: string; privateKeyPath: string; knownHostsPath: string; priority: "P" | "N" | "L"; }
export interface DistributionConfig {
  nodeEnv: "development" | "test" | "production";
  host: string; port: number; logLevel: string; trustProxyHops: number; bodyLimitBytes: number;
  databaseUrl: string; dbPoolMax: number; catalogServiceUrl: string; mediaServiceUrl: string; deliveryGrantEncryptionKey: Buffer;
  redisUrl: string;
  gatewayContextPublicKeyPem: string; gatewayContextIssuer: string; gatewayContextAudience: string;
  xsdPath?: string; acknowledgementXsdPath?: string; ddexSender: DdexParty; ddexAvsVersionId: string; dspRecipients: Record<string, DspRecipient>; storeTargets?: Record<string, StoreTarget>; workerPollMs: number; workerMaxAttempts: number; acknowledgementPollMs: number;
  autoPrepareDdexPackages?: boolean; manualDdexRecipientId?: string; sftpDeliveryEnabled?: boolean;
  packageRoot: string; packageMaxBytes: number; packageMaxEntries: number; sftpTargets: Record<string, SftpTarget>;
  publicBaseUrl: string; exportDownloadSigningKey: Buffer; exportDownloadTtlSeconds: number; exportRetentionSeconds: number;
}
function integer(name: string, value: string | undefined, fallback: number, min: number, max: number) { const parsed = value === undefined ? fallback : Number(value); if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name} must be an integer between ${min} and ${max}`); return parsed; }
function publicKey(value: string | undefined) { if (!value || /change[_-]?me/i.test(value) || value.length % 4 !== 0) throw new Error("GATEWAY_INTERNAL_CONTEXT_PUBLIC_KEY_B64 is required"); const der = Buffer.from(value, "base64"); if (der.length < 64 || der.length > 8192) throw new Error("Invalid Gateway public key"); return `-----BEGIN PUBLIC KEY-----\n${der.toString("base64").match(/.{1,64}/g)?.join("\n")}\n-----END PUBLIC KEY-----`; }
function encryptionKey(value: string | undefined) { if (!value || /change[_-]?me/i.test(value)) throw new Error("DISTRIBUTION_GRANT_ENCRYPTION_KEY_B64 is required"); const key = Buffer.from(value, "base64"); if (key.length !== 32) throw new Error("DISTRIBUTION_GRANT_ENCRYPTION_KEY_B64 must decode to 32 bytes"); return key; }
function signingKey(value: string | undefined) { if (!value || /change[_-]?me/i.test(value)) throw new Error("DISTRIBUTION_EXPORT_SIGNING_KEY_B64 is required"); const key = Buffer.from(value, "base64"); if (key.length < 32) throw new Error("DISTRIBUTION_EXPORT_SIGNING_KEY_B64 must decode to at least 32 bytes"); return key; }
function booleanFlag(name: string, value: string | undefined) { if (value === undefined || value === "false") return false; if (value === "true") return true; throw new Error(`${name} must be true or false`); }
export function normalizeDpid(value: string): string {
  const normalized = value.trim().toUpperCase().replaceAll("-", "");
  if (!/^PADPIDA[A-Z0-9]+$/.test(normalized)) throw new Error("Invalid DDEX Party ID");
  return normalized;
}
function ddexParty(partyId: string | undefined, name: string | undefined, production: boolean): DdexParty { if (!partyId || !name) { if (production) throw new Error("DISTRIBUTION_DDEX_SENDER_PARTY_ID and DISTRIBUTION_DDEX_SENDER_NAME are required"); return { partyId: "PADPIDA0000000000X", name: "BeAlpha Development" }; } const trimmedName = name.trim(); if (trimmedName.length === 0 || trimmedName.length > 255) throw new Error("Invalid DDEX sender config"); return { partyId: normalizeDpid(partyId), name: trimmedName }; }
function recipients(value: string | undefined, production: boolean) { if (!value) { if (production) throw new Error("DISTRIBUTION_DSP_RECIPIENTS_JSON is required"); return {}; } const parsed = JSON.parse(value) as Record<string, DspRecipient>; for (const [id, item] of Object.entries(parsed)) { if (!/^[a-z0-9_]{2,64}$/.test(id) || !item?.name?.trim() || item.name.length > 255) throw new Error("Invalid DSP recipient config"); try { item.partyId = normalizeDpid(item.partyId); } catch { throw new Error("Invalid DSP recipient config"); } item.name = item.name.trim(); } return parsed; }
function storeTargets(value: string | undefined, dspRecipients: Record<string, DspRecipient>, manualRecipientId: string | undefined) {
  if (!value) return Object.fromEntries(Object.entries(dspRecipients).map(([id, recipient]) => [id, { name: recipient.name, recipientId: id }]));
  const parsed = JSON.parse(value) as Record<string, StoreTarget>;
  for (const [id, item] of Object.entries(parsed)) {
    if (!/^[a-z0-9_]{2,64}$/.test(id) || !item?.name?.trim() || item.name.length > 255) throw new Error("Invalid store target config");
    item.name = item.name.trim();
    if (item.releaseTypes && (item.releaseTypes.length === 0 || item.releaseTypes.some(type => type !== "AUDIO" && type !== "VIDEO") || new Set(item.releaseTypes).size !== item.releaseTypes.length)) throw new Error("Invalid store target release types");
    const recipientId = item.recipientId?.trim() || manualRecipientId;
    if (!recipientId || !dspRecipients[recipientId]) throw new Error("Store target must map to a configured DDEX recipient or the manual recipient");
    item.recipientId = recipientId;
  }
  return parsed;
}

export function resolveDspRecipient(config: Pick<DistributionConfig, "dspRecipients" | "storeTargets" | "manualDdexRecipientId">, targetId: string): DspRecipient | undefined {
  const target = config.storeTargets?.[targetId];
  if (config.storeTargets && !target) return undefined;
  return config.dspRecipients[target?.recipientId ?? config.manualDdexRecipientId ?? targetId];
}
function sftpTargets(value: string | undefined) { if (!value) return {}; const parsed = JSON.parse(value) as Record<string, SftpTarget>; for (const [id, target] of Object.entries(parsed)) { if (!/^[a-z0-9_]{2,64}$/.test(id) || !target.host || !target.username || !/^\/[A-Za-z0-9._/-]+$/.test(target.remoteDir) || target.remoteDir.includes("..") || !target.privateKeyPath || !target.knownHostsPath) throw new Error("Invalid SFTP target config"); target.port = integer("SFTP target port", String(target.port ?? 22), 22, 1, 65535); target.priority = target.priority ?? "N"; if (!(["P", "N", "L"] as const).includes(target.priority)) throw new Error("Invalid SFTP delivery priority"); } return parsed; }
export function loadDistributionConfig(env: NodeJS.ProcessEnv = process.env): DistributionConfig {
  const nodeEnv = env.NODE_ENV === "production" || env.NODE_ENV === "test" ? env.NODE_ENV : "development";
  const databaseUrl = env.DISTRIBUTION_DATABASE_URL; if (!databaseUrl || !["postgres:", "postgresql:"].includes(new URL(databaseUrl).protocol)) throw new Error("DISTRIBUTION_DATABASE_URL must use PostgreSQL");
  const catalogServiceUrl = new URL(env.CATALOG_SERVICE_URL ?? "http://catalog:4102").toString().replace(/\/$/, "");
  const mediaServiceUrl = new URL(env.MEDIA_SERVICE_URL ?? "http://media:4103").toString().replace(/\/$/, "");
  if (nodeEnv === "production" && !env.DISTRIBUTION_ERN_XSD_PATH) throw new Error("DISTRIBUTION_ERN_XSD_PATH is required in production");
  if (nodeEnv === "production" && !env.DISTRIBUTION_ACK_XSD_PATH) throw new Error("DISTRIBUTION_ACK_XSD_PATH is required in production");
  if (nodeEnv === "production" && !env.DISTRIBUTION_DDEX_AVS_VERSION_ID) throw new Error("DISTRIBUTION_DDEX_AVS_VERSION_ID is required in production");
  const ddexAvsVersionId = env.DISTRIBUTION_DDEX_AVS_VERSION_ID ?? "9"; if (!/^\d+$/.test(ddexAvsVersionId)) throw new Error("DISTRIBUTION_DDEX_AVS_VERSION_ID must be numeric");
  const dspRecipients = recipients(env.DISTRIBUTION_DSP_RECIPIENTS_JSON, nodeEnv === "production");
  const autoPrepareDdexPackages = booleanFlag("DISTRIBUTION_AUTO_PREPARE_DDEX_PACKAGES", env.DISTRIBUTION_AUTO_PREPARE_DDEX_PACKAGES);
  const sftpDeliveryEnabled = booleanFlag("DISTRIBUTION_SFTP_DELIVERY_ENABLED", env.DISTRIBUTION_SFTP_DELIVERY_ENABLED);
  const manualDdexRecipientId = env.DISTRIBUTION_MANUAL_DDEX_RECIPIENT_ID?.trim();
  if (autoPrepareDdexPackages && Object.keys(dspRecipients).length === 0) throw new Error("DISTRIBUTION_DSP_RECIPIENTS_JSON must configure release target recipients when automatic DDEX preparation is enabled");
  if (manualDdexRecipientId && !dspRecipients[manualDdexRecipientId]) throw new Error("DISTRIBUTION_MANUAL_DDEX_RECIPIENT_ID must identify a configured DSP recipient");
  const selectableTargets = storeTargets(env.DISTRIBUTION_STORE_TARGETS_JSON, dspRecipients, manualDdexRecipientId);
  if (autoPrepareDdexPackages && Object.keys(selectableTargets).length === 0) throw new Error("DISTRIBUTION_STORE_TARGETS_JSON must configure at least one selectable DSP");
  return { nodeEnv, host: env.DISTRIBUTION_HOST ?? "0.0.0.0", port: integer("DISTRIBUTION_PORT", env.DISTRIBUTION_PORT, 4104, 1, 65535), logLevel: env.LOG_LEVEL ?? "info", trustProxyHops: integer("TRUST_PROXY_HOPS", env.TRUST_PROXY_HOPS, 1, 0, 5), bodyLimitBytes: integer("DISTRIBUTION_BODY_LIMIT_BYTES", env.DISTRIBUTION_BODY_LIMIT_BYTES, 65536, 4096, 1048576), databaseUrl, dbPoolMax: integer("DISTRIBUTION_DB_POOL_MAX", env.DISTRIBUTION_DB_POOL_MAX, 10, 1, 50), catalogServiceUrl, mediaServiceUrl, deliveryGrantEncryptionKey: encryptionKey(env.DISTRIBUTION_GRANT_ENCRYPTION_KEY_B64), redisUrl: env.REDIS_URL ?? "redis://localhost:6379", gatewayContextPublicKeyPem: publicKey(env.GATEWAY_INTERNAL_CONTEXT_PUBLIC_KEY_B64), gatewayContextIssuer: env.GATEWAY_INTERNAL_CONTEXT_ISSUER ?? "bealpha-gateway", gatewayContextAudience: env.GATEWAY_INTERNAL_CONTEXT_AUDIENCE ?? "bealpha-services", ...(env.DISTRIBUTION_ERN_XSD_PATH ? { xsdPath: env.DISTRIBUTION_ERN_XSD_PATH } : {}), ...(env.DISTRIBUTION_ACK_XSD_PATH ? { acknowledgementXsdPath: env.DISTRIBUTION_ACK_XSD_PATH } : {}), ddexSender: ddexParty(env.DISTRIBUTION_DDEX_SENDER_PARTY_ID, env.DISTRIBUTION_DDEX_SENDER_NAME, nodeEnv === "production"), ddexAvsVersionId, dspRecipients, storeTargets: selectableTargets, autoPrepareDdexPackages, sftpDeliveryEnabled, ...(manualDdexRecipientId ? { manualDdexRecipientId } : {}), workerPollMs: integer("DISTRIBUTION_WORKER_POLL_MS", env.DISTRIBUTION_WORKER_POLL_MS, 1000, 250, 60000), workerMaxAttempts: integer("DISTRIBUTION_WORKER_MAX_ATTEMPTS", env.DISTRIBUTION_WORKER_MAX_ATTEMPTS, 5, 1, 20), acknowledgementPollMs: integer("DISTRIBUTION_ACK_POLL_MS", env.DISTRIBUTION_ACK_POLL_MS, 60000, 1000, 3600000), packageRoot: env.DISTRIBUTION_PACKAGE_ROOT ?? "/packages", packageMaxBytes: integer("DISTRIBUTION_PACKAGE_MAX_BYTES", env.DISTRIBUTION_PACKAGE_MAX_BYTES, 50 * 1024 * 1024 * 1024, 1024, 50 * 1024 * 1024 * 1024), packageMaxEntries: integer("DISTRIBUTION_PACKAGE_MAX_ENTRIES", env.DISTRIBUTION_PACKAGE_MAX_ENTRIES, 10000, 1, 10000), sftpTargets: sftpTargets(env.DISTRIBUTION_SFTP_TARGETS_JSON), publicBaseUrl: new URL(env.DISTRIBUTION_PUBLIC_BASE_URL ?? "http://localhost:8080").toString().replace(/\/$/, ""), exportDownloadSigningKey: signingKey(env.DISTRIBUTION_EXPORT_SIGNING_KEY_B64), exportDownloadTtlSeconds: integer("DISTRIBUTION_EXPORT_DOWNLOAD_TTL_SECONDS", env.DISTRIBUTION_EXPORT_DOWNLOAD_TTL_SECONDS, 900, 60, 3600), exportRetentionSeconds: integer("DISTRIBUTION_EXPORT_RETENTION_SECONDS", env.DISTRIBUTION_EXPORT_RETENTION_SECONDS, 86400, 3600, 604800) };
}
