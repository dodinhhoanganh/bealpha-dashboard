import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes
} from "node:crypto";

import {
  EVENT_VERSION,
  notificationRequestPayloadSchema,
  type EventEnvelope,
  type NotificationRequestPayload
} from "@bealpha/contracts";
import { Redis } from "ioredis";

export const BEALPHA_EVENT_STREAM = "bealpha:events";

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
}

export class SensitivePayloadCipher {
  private readonly encryptionKey: Buffer;
  private readonly blindIndexKey: Buffer;

  constructor(key: Buffer) {
    if (key.length !== 32) throw new Error("Outbox encryption key must be 32 bytes");
    this.encryptionKey = createHmac("sha256", key)
      .update("bealpha-outbox-encryption-v1")
      .digest();
    this.blindIndexKey = createHmac("sha256", key)
      .update("bealpha-blind-index-v1")
      .digest();
  }

  encrypt(payload: unknown): EncryptedPayload {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(payload), "utf8"),
      cipher.final()
    ]);
    return {
      ciphertext: ciphertext.toString("base64url"),
      iv: iv.toString("base64url"),
      authTag: cipher.getAuthTag().toString("base64url")
    };
  }

  decrypt(payload: EncryptedPayload): NotificationRequestPayload {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.encryptionKey,
      Buffer.from(payload.iv, "base64url")
    );
    decipher.setAuthTag(Buffer.from(payload.authTag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, "base64url")),
      decipher.final()
    ]).toString("utf8");
    return notificationRequestPayloadSchema.parse(JSON.parse(plaintext));
  }

  blindIndex(value: string): string {
    return createHmac("sha256", this.blindIndexKey).update(value).digest("hex");
  }
}

export interface PendingOutboxEvent {
  id: string;
  eventId: string;
  type: "notification.requested";
  requestId: string;
  actorId: string | null;
  tenantId: string | null;
  entityPath: string | null;
  payloadCiphertext: string;
  payloadIv: string;
  payloadAuthTag: string;
  occurredAt: Date;
  attempts: number;
}

export interface OutboxStore {
  listPendingOutbox(limit: number): Promise<PendingOutboxEvent[]>;
  markOutboxPublished(id: string): Promise<void>;
  markOutboxFailed(id: string, error: string, nextAttemptAt: Date): Promise<void>;
}

export class IdentityOutboxRelay {
  private timer?: NodeJS.Timeout;
  private flushing = false;

  constructor(
    private readonly store: OutboxStore,
    private readonly redis: Redis,
    private readonly cipher: SensitivePayloadCipher,
    private readonly pollIntervalMs: number,
    private readonly batchSize: number
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.flush(), this.pollIntervalMs);
    this.timer.unref();
    void this.flush();
  }

  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      const events = await this.store.listPendingOutbox(this.batchSize);
      for (const event of events) {
        try {
          const payload = this.cipher.decrypt({
            ciphertext: event.payloadCiphertext,
            iv: event.payloadIv,
            authTag: event.payloadAuthTag
          });
          const envelope: EventEnvelope<NotificationRequestPayload> = {
            version: EVENT_VERSION,
            eventId: event.eventId,
            type: event.type,
            occurredAt: event.occurredAt.toISOString(),
            requestId: event.requestId,
            ...(event.actorId === null ? {} : { actorId: event.actorId }),
            ...(event.tenantId === null ? {} : { tenantId: event.tenantId }),
            ...(event.entityPath === null ? {} : { entityPath: event.entityPath }),
            payload
          };
          await this.redis.xadd(
            BEALPHA_EVENT_STREAM,
            "MAXLEN",
            "~",
            100000,
            "*",
            "eventId",
            event.eventId,
            "event",
            JSON.stringify(envelope)
          );
          await this.store.markOutboxPublished(event.id);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Outbox publish failed";
          const delay = Math.min(60_000, 1000 * 2 ** Math.min(event.attempts, 6));
          await this.store.markOutboxFailed(
            event.id,
            message.slice(0, 500),
            new Date(Date.now() + delay)
          );
        }
      }
    } catch {
      // Readiness already reports Redis/DB failures; relay retries next interval.
    } finally {
      this.flushing = false;
    }
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
    this.redis.disconnect();
  }
}

export function createIdentityOutboxRelay(
  store: OutboxStore,
  redisUrl: string,
  cipher: SensitivePayloadCipher,
  pollIntervalMs: number,
  batchSize: number
): IdentityOutboxRelay {
  return new IdentityOutboxRelay(
    store,
    new Redis(redisUrl, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 1000,
      retryStrategy: (attempt) => Math.min(attempt * 100, 2000)
    }),
    cipher,
    pollIntervalMs,
    batchSize
  );
}
