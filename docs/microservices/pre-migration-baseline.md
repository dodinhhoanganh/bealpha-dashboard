# Pre-Migration Baseline

Captured: 2026-07-10

Scope: current dashboard APIs, shared Prisma schema, upload server, and deployment config. Existing source remains behavioral reference until cutover.

## API response conventions

- 64 public Next.js route files.
- Success JSON is inconsistent: direct objects, {data}, paginated {data,total,page,limit,totalPages}, or {success}.
- Error JSON is usually {error: ERROR_*}, with inconsistent status/message/details fields.
- Upload proxy returns upstream responses; export routes can return file responses.
- Migration target: JSON {data,error,requestId}; large exports/uploads become signed media data-plane operations.

## API ownership inventory

|Legacy route|Methods|Future owner|Current success shape|
|---|---|---|---|
|/api/analytics|GET, POST|finance|direct aggregate object|
|/api/artists|GET, POST|catalog|paginated list on GET; direct resource on POST|
|/api/artists/[id]|GET, PATCH, DELETE|catalog|direct resource/action JSON|
|/api/artists/search-dsp|GET|catalog|direct resource/action JSON|
|/api/assets|GET, POST|catalog|paginated list on GET; direct resource on POST|
|/api/assets/[id]|GET, PATCH, DELETE|catalog|direct resource/action JSON|
|/api/audit-log|GET|identity|direct resource/action JSON|
|/api/auth/2fa/send|POST|identity|direct resource/action JSON|
|/api/auth/2fa/setup|GET, POST|identity|direct resource/action JSON|
|/api/auth/2fa/toggle|POST|identity|direct resource/action JSON|
|/api/auth/2fa/verify|POST|identity|direct resource/action JSON|
|/api/auth/change-password|POST|identity|direct resource/action JSON|
|/api/auth/login|POST|identity|direct token/user or error object|
|/api/auth/logout|POST|identity|direct success/error object|
|/api/auth/me|GET|identity|direct resource/action JSON|
|/api/auth/profile|PUT|identity|direct resource/action JSON|
|/api/auth/sessions|GET, DELETE|identity|direct resource/action JSON|
|/api/auth/sessions/[id]|DELETE|identity|direct resource/action JSON|
|/api/auth/sessions/kill-all|POST|identity|direct success/error object|
|/api/compositions|GET, POST|catalog|paginated list on GET; direct resource on POST|
|/api/compositions/[id]|GET, PATCH, DELETE|catalog|direct resource/action JSON|
|/api/cron/release-scheduler|GET|distribution|direct resource/action JSON|
|/api/cron/revenue-notify|GET|notifications|direct resource/action JSON|
|/api/dashboard|GET|gateway + finance|direct aggregate object|
|/api/ddex/deliver|POST, GET|distribution|direct resource/action JSON|
|/api/ddex/deliveries|GET|distribution|paginated list on GET; direct resource on POST|
|/api/ddex/deliveries/[id]|GET, PATCH|distribution|direct resource/action JSON|
|/api/ddex/generate|POST|distribution|direct resource/action JSON|
|/api/ddex/poll|GET|distribution|direct resource/action JSON|
|/api/ddex/validate|POST|distribution|direct resource/action JSON|
|/api/entities|GET, POST|catalog|direct list/data object|
|/api/entities/[id]|GET, PUT, DELETE|catalog|direct resource/action JSON|
|/api/entities/[id]/members|GET, POST, DELETE|identity|direct resource/action JSON|
|/api/health|GET|gateway|direct health object|
|/api/invitations|GET, POST|identity|direct list/data object|
|/api/invitations/[id]|GET, DELETE, POST|identity|direct resource/action JSON|
|/api/invitations/accept|POST, GET|identity|direct resource/action JSON|
|/api/labels|GET, POST|catalog|paginated list on GET; direct resource on POST|
|/api/labels/[id]|GET, PATCH, DELETE|catalog|direct resource/action JSON|
|/api/labels/[id]/backup|GET|catalog|direct resource/action JSON|
|/api/labels/restore|POST|catalog|direct resource/action JSON|
|/api/notifications|GET, PATCH, DELETE|notifications|direct list/data object|
|/api/playlists|GET, POST|catalog|direct list/data object|
|/api/proxy_upload/[...path]|POST|media|upload upstream pass-through|
|/api/releases|GET, POST|catalog|paginated list on GET; direct resource on POST|
|/api/releases/[id]|GET, PATCH, DELETE|catalog|direct resource/action JSON|
|/api/releases/[id]/approve|POST|catalog|direct resource/action JSON|
|/api/releases/[id]/deny|POST|catalog|direct resource/action JSON|
|/api/releases/[id]/submit|POST|catalog|direct resource/action JSON|
|/api/releases/export|GET|catalog|CSV/JSON file response|
|/api/releases/import|POST|catalog|direct resource/action JSON|
|/api/roles|GET|identity|direct list/data object|
|/api/royalties|GET, POST|finance|direct aggregate object|
|/api/search|GET|catalog|direct list/data object|
|/api/stream/sign|POST|media|signed token/URL payload|
|/api/streaming|GET, POST|finance|direct aggregate object|
|/api/tracks|GET, POST|catalog|paginated list on GET; direct resource on POST|
|/api/tracks/[id]|GET, PATCH, DELETE|catalog|direct resource/action JSON|
|/api/upload/token|POST|media|signed token/URL payload|
|/api/user/sessions|GET|identity|direct resource/action JSON|
|/api/user/sessions/[id]|DELETE|identity|direct resource/action JSON|
|/api/users|GET, POST|identity|paginated list on GET; direct resource on POST|
|/api/users/[id]|GET, PATCH, DELETE|identity|direct resource/action JSON|
|/api/users/[id]/ban|POST, DELETE|identity|direct resource/action JSON|

## Prisma ownership inventory

|Future owner|Current models|
|---|---|
|identity|User, TwoFactorCode, AuthToken, Role, UserRole, UserEntityRole, Invitation, AuditLog, SystemLog|
|catalog|BusinessEntity, Label, Artist, Release, Track, TrackContributor, Asset, Composition, Playlist, PlaylistTrack|
|media|No exclusive model. Raw file state currently spans upload server filesystem/S3 and catalog Asset rows.|
|distribution|DdexMessage, DdexDelivery|
|finance|StreamingMetrics, DailyAnalytics, PlayDurationBucket, RoyaltyReport, RoyaltyLineItem|
|notifications|Notification|

Shared contract enums: EntityType, EntityRole, InviteStatus, ReleaseType, ReleaseFormat, ReleaseStatus, AssetType, AssetStatus, CopyrightStatus.

## Required behavior

- Resource access checks creator, manager, and B2B2B entity subtree.
- Existing Label/Artist references are authorized before create/import mutation.
- Money and splits never use floating point; full split allocation equals 10000 basis points.
- UPC/EAN and ISRC become immutable at delivery lock.
- Raw media avoids Next.js; unreleased streams use signed, tenant-bound expiry.
- ZIP work is disk-spooled/streamed, <= 50 GiB compressed, <= 10000 entries, path-safe, ratio-limited, and concurrency-bounded.
- DDEX uses immutable catalog snapshots, official XSD validation, idempotency, and bounded retry.

## Known migration gaps

- All domains currently share one Prisma client/database.
- Browser upload can traverse app/api/proxy_upload, so Next.js remains in media path.
- Legacy JSON lacks one stable envelope and request ID.
- DDEX transport contains non-production/stub behavior; do not treat stub success as target behavior.
- Internal service authorization, versioned events, and consumer dedupe do not exist yet.

## Validation baseline

|Check|Result|
|---|---|
|Dashboard Jest|PASS: 72/72 suites, 379/379 tests|
|Dashboard TypeScript|PASS: npx tsc --noEmit --incremental false|
|Dashboard production build|PASS; one non-security Turbopack filesystem-trace warning|
|Upload syntax|PASS: node --check server.js and node --check s3-receipt-worker.js|
|Production dependency audit|PASS: zero vulnerabilities in dashboard/upload server baseline|
|Legacy Compose parse|PASS: docker compose -f docker-compose.yml config --quiet with required secrets set|

Root Git metadata is unusable. Dashboard and upload repositories are dirty and remain untouched by Phase 0/1 scaffolding.
