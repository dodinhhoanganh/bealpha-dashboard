import { entitySnapshotSyncSchema } from "@bealpha/contracts";
import { Redis } from "ioredis";
import { z } from "zod";
import type {
  EntityAuthorizationState,
  IdentityStore
} from "./store.js";

type ProjectionStore = Pick<IdentityStore, "upsertEntitySnapshot"> &
  Partial<Pick<IdentityStore, "invalidateEntityAuthorization">>;

type ProjectionRegistry = Pick<
  import("./session-registry.js").SessionRegistry,
  "deactivateMany" | "syncAuthorization"
>;

const projectionEventSchema = z.object({
  version: z.literal(1),
  eventId: z.string().uuid(),
  type: z.enum(["catalog.entity.created", "catalog.entity.updated"]),
  payload: entitySnapshotSyncSchema
}).passthrough();

export async function consumeEntityProjectionEvent(
  store: ProjectionStore,
  raw: unknown,
  registry?: ProjectionRegistry
): Promise<boolean> {
  const event = projectionEventSchema.parse(raw);
  const applied = await store.upsertEntitySnapshot(event.payload);
  const invalidate = store.invalidateEntityAuthorization;
  if (invalidate) {
    const states = await invalidate.call(store, event.payload, applied);
    if (registry && states.length > 0) {
      await synchronizeRegistry(registry, states);
    }
  }
  return applied;
}

async function synchronizeRegistry(
  registry: ProjectionRegistry,
  states: readonly EntityAuthorizationState[]
): Promise<void> {
  for (const state of states) {
    await registry.deactivateMany(state.sessionIds);
    await registry.syncAuthorization(state.userId, state.authzVersion);
  }
}

type StreamMessage = [string, string[]];

export class EntityProjectionConsumer {
  private readonly redis: Redis;
  private ready = false;
  private polling = false;

  constructor(
    private readonly store: ProjectionStore,
    redisUrl: string,
    private readonly consumer: string,
    private readonly registry?: ProjectionRegistry
  ) {
    this.redis = new Redis(redisUrl, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 1000,
      retryStrategy: attempt => Math.min(attempt * 100, 2000)
    });
    this.redis.on("error", () => {
      this.ready = false;
    });
  }

  private async ensureGroup(): Promise<void> {
    if (this.ready) return;
    await this.redis.xgroup(
      "CREATE",
      "bealpha:events",
      "identity-entity-projection",
      "0",
      "MKSTREAM"
    ).catch(error => {
      if (!(error instanceof Error) || !error.message.includes("BUSYGROUP")) throw error;
    });
    this.ready = true;
  }

  private async process(messages: StreamMessage[]): Promise<void> {
    for (const [id, fields] of messages) {
      const index = fields.indexOf("event");
      const serialized = index < 0 ? undefined : fields[index + 1];
      if (!serialized) {
        await this.redis.xack("bealpha:events", "identity-entity-projection", id);
        continue;
      }
      try {
        const raw = JSON.parse(serialized);
        if (["catalog.entity.created", "catalog.entity.updated"].includes(raw?.type)) {
          await consumeEntityProjectionEvent(this.store, raw, this.registry);
        }
        await this.redis.xack("bealpha:events", "identity-entity-projection", id);
      } catch {
        // Invalid/transient events remain pending and are reclaimed after the idle timeout.
      }
    }
  }

  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      await this.ensureGroup();
      const claimed = await this.redis.call(
        "XAUTOCLAIM",
        "bealpha:events",
        "identity-entity-projection",
        this.consumer,
        "60000",
        "0-0",
        "COUNT",
        "50"
      ) as [string, StreamMessage[]];
      if (claimed?.[1]?.length) await this.process(claimed[1]);
      const result = await this.redis.xreadgroup(
        "GROUP",
        "identity-entity-projection",
        this.consumer,
        "COUNT",
        50,
        "BLOCK",
        100,
        "STREAMS",
        "bealpha:events",
        ">"
      ) as unknown as [string, StreamMessage[]][] | null;
      const messages = result?.[0]?.[1] ?? [];
      if (messages.length) await this.process(messages);
    } catch {
      // Redis can still be connecting when the HTTP server starts. Keep the
      // service alive and retry on the next poll instead of creating an
      // unhandled rejection that restarts the container.
      this.ready = false;
    } finally {
      this.polling = false;
    }
  }

  close(): void {
    this.redis.disconnect();
  }
}
