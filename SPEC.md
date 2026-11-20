# BeAlpha Platform Specifications

## §G
G1: dashboard/upload APIs enforce RBAC + ownership; ⊥ IDOR/bypass.
G2: replace dashboard-centered monolith → independently deployable services behind API Gateway; preserve tenant, catalog, media, DDEX, finance behavior.

## §C
- Full rewrite + maintenance-window cutover; ⊥ permanent dual writes.
- Existing monolith = behavioral reference until cutover.
- TypeScript services; Fastify Gateway; Next.js web UI only.
- PostgreSQL one server; isolated database/schema + credentials per service.
- Redis/BullMQ → queues, events, locks, rate limits.
- Nginx → TLS edge; Gateway → sole public API.
- ∀ service → own migrations, tests, Dockerfile, healthcheck.
- Money/splits → Prisma Decimal, decimal string, integer minor units, or basis points; ⊥ Float/Double.

## §I
I1 api: `app/api/assets/[id]/route.ts` → legacy asset management endpoint.
I2 api: `/api/v1/auth/*|identity/*|catalog/*|media/*|distribution/*|finance/*|notifications/*` → Gateway allow-list.
I3 http: response → `{data,error,requestId}`; error → `{code,message,details?}`.
I4 auth: `Authorization: Bearer <JWT>` → verified `{sub,tenantId?,entityPath?,roles[]}`.
I5 internal: `x-bealpha-context` → short-lived signed `{v,requestId,actorId?,tenantId?,entityPath?,roles[]}`; client value stripped.
I6 event: `{version,eventId,type,occurredAt,requestId,actorId?,tenantId?,entityPath?,payload}`.
I7 media: Gateway control-plane only; signed upload/stream URL → raw bytes terminate at media-service/object storage.
I8 compose: `docker-compose.microservices.yml` → edge/backend networks; PostgreSQL/Redis private.
I9 env: `.env.microservices.example` → required secrets, service URLs, limits.

## §V
V1: ∀ resource access requests (`GET/PATCH/DELETE`) → evaluate `createdById` + `managedById` regardless optional role/profile; creator access preserved.
V2: ∀ entity creation/import requests (`POST`) referencing existing Label/Artist → enforce authorized scope (`allUserIds` or tenant path); ⊥ hijack/mutation.
V3: after cutover, ∀ public API request → Nginx→Gateway; internal services/PostgreSQL/Redis ⊥ host-public.
V4: Gateway auth = first layer; ∀ service request → service re-authorizes signed actor + tenant/entity scope.
V5: ∀ client-supplied internal/auth scope header → strip; tenant/user/role/ownership ⊥ request-body trust.
V6: ∀ service → exclusive database/schema, credentials, migrations, ORM; ⊥ cross-service SQL/model imports.
V7: raw media bytes ∉ web/Gateway persistence or processing; only media-service/object storage accepts bytes.
V8: ∀ contract/event → explicit version; ∀ event consumer → persist dedupe key before side effect.
V9: ∀ money/split math → decimal/integer only; split total = `10000` basis points where full allocation required.
V10: release `LOCKED_FOR_DELIVERY` → UPC/EAN + track/video ISRC immutable except formal update/takedown workflow.
V11: ∀ catalog/finance/media read → authenticated B2B2B entity subtree scope; sibling tenant data inaccessible.
V12: unreleased media URL → signed + short expiry + auth/tenant binding; direct object path inaccessible.
V13: ZIP import/export → streaming/disk-spooled; compressed bytes ≤ `50 GiB`; entries ≤ `10000`; traversal, symlink, ratio bomb rejected; bounded workers.
V14: DDEX delivery → official XSD-valid immutable snapshot + idempotency key + bounded retry.
V15: ∀ deployable service → non-root container, healthcheck, CPU/memory/PID limits, bounded timeout/body/concurrency.
V16: Gateway route target → static allow-list only; unavailable/timeout upstream → stable `503` envelope; ⊥ arbitrary proxy/SSRF.
V17: identity JWT → asymmetric signature; Gateway stores public verify key only. Internal context → Gateway private signer; services store public verify key only.
V18: ∀ production package lock → `npm audit --omit=dev` = `0` vulnerabilities before release.
V19: rollback restore target ≠ legacy database; target user-table count = `0` before `pg_restore`.
V20: cutover/rollback file paths → canonical workspace path; outside-workspace path → reject.
V21: cutover dry-run → print plan without env/secrets/external process requirement.
V22: local Compose build-backed services → plain `docker compose up` rebuilds current source with bounded build parallelism; watch mode performs bounded cached rebuild/recreate on source or contract changes.

## §T
|id|status|task|cites|
|---|---|---|---|
|T1|x|fix Asset API IDOR logic in `canAccessAsset`|V1,I1|
|T2|x|fix Release POST/import entity hijacking IDORs|V2,I1|
|T3|x|freeze public API/model/owner/invariant + validation baseline|V1,V2,V9-V14|
|T4|x|create `packages/contracts` DTO/schema/event package + compatibility tests|V8-V10,I3-I7|
|T5|x|build secured Fastify Gateway + proxy/auth/rate/body/timeout tests|V3-V5,V7,V15-V17,I2-I5|
|T6|x|add microservice Compose, PostgreSQL isolation init, Nginx TLS edge, env contract|V3,V6,V15,V22,I8,I9|
|T7|x|extract identity-service + identity database|V4-V6,V8,I2-I6|
|T8|x|extract catalog-service + catalog database|V2,V4-V6,V9-V11,I2-I6|
|T9|x|extract media-service + media database/storage/workers|V4-V8,V11-V13,V15,I2-I7|
|T10|x|extract distribution-service + snapshots/workers|V4-V6,V8,V10,V11,V14,V15,I2-I6|
|T11|x|extract finance-service + streaming ingestion/calculation|V4-V6,V8,V9,V11,V15,I2-I6|
|T12|x|extract notification-service + dedupe/retry/DLQ|V4-V6,V8,V11,V15,I2-I6|
|T13|x|migrate Next.js → UI-only web using `/api/v1`|V3,V5,V7,V11,V12,I2-I7|
|T14|~|build data migration, verification, maintenance cutover + rollback|V6,V8-V14,V19-V21|
|T15|~|run full load/security/failure gates; remove monolith APIs/shared Prisma|V3-V18,V22|

## §B
|id|date|cause|fix|
|---|---|---|---|
|B1|2026-05-02|IDOR: `assets/[id]/route.ts` skipped `createdById` when `session.artistId` null|V1|
|B2|2026-05-02|IDOR: release create/import allowed arbitrary existing Label/Artist assignment/mutation outside scope|V2|
|B3|2026-07-11|catalog verification lacked service-local lockfile + Prisma env|V6|
|B4|2026-07-11|catalog Prisma blocks compressed into invalid one-line syntax|V6|
|B5|2026-07-11|catalog parsed JWT registered claims through strict auth schema|V4|
|B6|2026-07-11|broad Compose patch briefly attached PostgreSQL to edge network|V3|
|B7|2026-07-11|cross-workspace Zod instance made validation errors return 500|I3|
|B8|2026-07-11|Windows ACL locked generated media Prisma client directory|V6|
|B9|2026-07-11|npm 11 workspace selector stopped resolving valid local workspaces|V6|
|B10|2026-07-11|normal builds regenerated Prisma clients and hit Windows ACL locks|V6|
|B11|2026-07-13|finance Prisma blocks compressed into invalid one-line syntax|V6|
|B12|2026-07-13|finance request hook assumed socket `setTimeout` exists before auth|V4|
|B13|2026-08-15|media/distribution test config fixtures omitted required `redisUrl` after saga extraction|V15|
|B14|2026-08-15|service lockfiles pinned vulnerable Fastify/Prisma transitive packages|V18|
|B15|2026-08-15|rollback documented empty recovery target but did not enforce it|V19|
|B16|2026-08-15|absolute cutover path joined under workspace into invalid `E:\bealpha\C:\...` path|V20|
|B17|2026-08-15|distribution migration snapshot hash differed from runtime canonical hash|V14|
|B18|2026-08-15|cutover dry-run required missing env files before printing plan|V21|
|B19|2026-08-15|root workspace lock omitted BullMQ dependencies, causing CI `npm ci` failure|V18|
|B20|2026-08-15|plain `docker compose up` could reuse stale local images without build policy|V22|
|B21|2026-08-15|one-shot migrations could fail on transient PostgreSQL network readiness despite the health gate|V15|
|B22|2026-08-15|non-root Nginx could not create temp directories in a root-owned cache tmpfs|V15|
