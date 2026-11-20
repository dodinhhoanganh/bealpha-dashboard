# BeAlpha Control-plane API

Status: authoritative API overview for the microservice cutover. The Gateway is the only public control-plane origin. Service ports and `x-bealpha-context` are private implementation details and must never be exposed to browsers or white-label customers.

## Transport and authentication

- Base path: `/api/v1` through `services/gateway`.
- User requests use `Authorization: Bearer <ES256 access token>` and `X-Request-Id` (UUID).
- Refresh tokens are rotating, revocable, `HttpOnly`, `Secure` production cookies. Reuse revokes the token family.
- The Gateway verifies issuer, audience, algorithm, session and `authzVersion`, then signs a short-lived internal context. Clients cannot supply `tenantId`, `entityPath`, roles or staff roles.
- Success envelope: `{ "data": ..., "requestId": "uuid" }`.
- Error envelope: `{ "error": { "code": "...", "message": "..." }, "requestId": "uuid" }`.
- Mutating requests use `Content-Type: application/json` unless the endpoint returns a signed data-plane URL.

## Tenant and role model

| Entity | Meaning | Membership |
| --- | --- | --- |
| `SUPER_ADMIN` | Single BeAlpha platform owner | Exactly one account, `OWNER` |
| `SYSTEM_ADMIN` | Distribution/review network | `OWNER`, `ADMIN`, `ACCOUNTANT`, `MEMBER` |
| `ORGANIZATION` | Customer label tenant | `OWNER`, `ADMIN`, `ACCOUNTANT`, `MEMBER` |
| `SUB_ACCOUNT` | Artist/producer/manager customer | Exactly one account; no team/staff role |

`ACCOUNTANT` is an entity membership role with scoped catalog/analytics/finance read access and no release, user, split-rule or central-import mutation rights. Staff roles are scoped additions, never new entity levels: `admin`, `moderator`, `supporter`, `finance`. The backend remains authoritative even when the dashboard hides a capability.

Catalog rules:

- Organization data is tenant-isolated.
- Labels and artists are catalog records, not hierarchy nodes.
- A sub-account has deny-all label access until an organization owner/admin grants labels.
- Removing a grant takes effect on the next request.

## Release workflow

```text
DRAFT / rejection
  -> PENDING_ORG_APPROVAL       organization label review
  -> PENDING_SYS_APPROVAL       distribution review
  -> PENDING_SUPER_APPROVAL     BeAlpha final review
  -> APPROVED
  -> LOCKED_FOR_DELIVERY
  -> DELIVERED / RELEASED
```

No tier may skip the tier below it. Rejection states are `ORG_REJECTED`, `SYS_REJECTED`, and `SUPER_REJECTED`. Reject requests require a trimmed 3–1000 character reason. The latest reason, rejecting tier and timestamp are returned with the release and emitted in `catalog.release.rejected` for downstream notification/audit processing.

Identifiers are locked on first submission and remain immutable through delivery. Every deliverable release needs a 12–14 digit UPC/EAN, every track/video a valid 12-character ISRC, cover art and at least one track.

### Workflow endpoints

| Method | Path | Capability | Notes |
| --- | --- | --- | --- |
| `POST` | `/catalog/releases/:id/submit` | release owner | Advances from draft/rejection to its next review tier |
| `POST` | `/catalog/releases/:id/approve` | manager at the current tier | Organization → system → super only |
| `POST` | `/catalog/releases/:id/delivery-lock` | single BeAlpha owner | Idempotently changes `APPROVED` to `LOCKED_FOR_DELIVERY` before any delivery snapshot |
| `POST` | `/catalog/releases/:id/deny` | manager at the current tier | Body `{ "reason": "Metadata mismatch" }` |
| `POST` | `/distribution/deliveries` | single BeAlpha owner | Idempotent per tenant and key; async `202` |

## Endpoint inventory

All paths below are prefixed by `/api/v1` unless marked data-plane.

### Identity

- Auth: `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/change-password`.
- Recovery/invites: `POST /auth/password-reset/request`, `/auth/password-reset/confirm`, `/auth/invitations/validate`, `/auth/invitations/accept`.
- 2FA: `GET /auth/2fa`; `POST /auth/2fa/setup`, `/auth/2fa/setup/verify`, `/auth/2fa/verify`, `/auth/2fa/send`, `/auth/2fa/email`; `DELETE /auth/2fa`, `/auth/2fa/:method`.
- Profile/session: `GET /auth/me`, `/auth/profile`, `/auth/sessions`; `PATCH /auth/profile`; `POST /auth/sessions/revoke-all`; `DELETE /auth/sessions/:id`.
- Users: `GET|POST /identity/users`; `GET|PATCH|DELETE /identity/users/:id`; `PUT /identity/users/:id/membership`, `/identity/users/:id/staff-roles`; `PATCH /identity/users/:id/membership-role`, `/identity/users/:id/ban`; `POST /identity/users/:id/reset-password`.
- Entity members: `POST /identity/entities/:entityId/members`; `DELETE /identity/entities/:entityId/members/:userId`.
- Invites: `GET|POST /identity/invitations`; `DELETE /identity/invitations/:id`; `POST /identity/invitations/:id/resend`.
- Metadata: `GET /identity/roles`.
- Internal service-only: `PUT /identity/internal/entity-snapshots`.

### Catalog

- Hierarchy: `GET|POST /catalog/entities`; `PATCH /catalog/entities/:id`.
- Sub-account labels: `GET|PUT /catalog/entities/:id/label-access`; PUT replaces the complete grant set with `{ "labelIds": ["uuid"] }`.
- Labels: `GET|POST /catalog/labels`; `GET|PATCH|DELETE /catalog/labels/:id`.
- Artists: `GET|POST /catalog/artists`; `GET|PATCH|DELETE /catalog/artists/:id`; `GET /catalog/artists/search-dsp?q=`.
- Releases: `GET|POST /catalog/releases`; `GET|PATCH|DELETE /catalog/releases/:id`; workflow endpoints above.
- Tracks: `POST /catalog/releases/:releaseId/tracks`; `GET|PATCH|DELETE /catalog/tracks/:id`.
- Compositions: `GET|POST /catalog/compositions`; `GET|PATCH|DELETE /catalog/compositions/:id`.
- Imports/exports: `POST /catalog/imports`; `GET /catalog/imports/:id`; `GET /catalog/releases/export-snapshot`.
- Internal service-only: `GET /catalog/releases/:id/distribution-snapshot`, `/catalog/tracks/:id/analytics-scope`.

### Media

- `POST /media/upload-intents`; `GET /media/assets`; `DELETE /media/assets/:assetId`.
- `POST /media/assets/:assetId/stream-grants`, `/media/assets/:assetId/delivery-grants`, `/media/delivery-grants`.
- `POST /media/assets/:assetId/publication` explicitly publishes a ready image. It requires an in-scope `OWNER`/`ADMIN` (or `SUPER_ADMIN`); `SUB_ACCOUNT` and `ACCOUNTANT` cannot publish. Images remain private until this succeeds.
- Dashboard uploads persist `media-asset:<uuid>` references. Authenticated previews exchange that opaque reference through `/media/assets/:assetId/stream-grants`; capability URLs are never persisted in catalog/profile fields. Catalog publishes image references only during explicit brand, label, or artist save transitions. Release covers remain private during draft/review.
- `GET /media/assets/:assetId/archive-entries`.
- Signed data-plane: `PUT /media-upload/:uploadId?token=...`, `GET /media-stream/:assetId?token=...`. `GET /media-public/:assetId` serves only explicitly published, ready images.
- The dashboard and Gateway never parse or persist raw media.

### Distribution

- `GET /distribution/recipients?releaseType=AUDIO|VIDEO`, `/distribution/deliveries`, `/distribution/deliveries/:deliveryId`. The recipients response is the media-type-filtered customer-selectable store catalog from `DISTRIBUTION_STORE_TARGETS_JSON`; it never exposes DPIDs or credentials. Each target maps to a configured DDEX recipient profile, or explicitly to `DISTRIBUTION_MANUAL_DDEX_RECIPIENT_ID` while partner onboarding is stubbed. The supplied example exposes audio DSPs only for AUDIO and VEVO only for VIDEO.
- `POST /distribution/preview`, `/distribution/deliveries`, `/distribution/exports`.
- `GET /distribution/exports`, `/distribution/exports/:exportId`; `POST /distribution/exports/:exportId/retry` refreshes the full snapshot/media-grant preparation path for a failed automatic DDEX package and is restricted to the `SUPER_ADMIN OWNER` manual custodian.
- When `DISTRIBUTION_AUTO_PREPARE_DDEX_PACKAGES=true`, each final-approved AUDIO release is delivery-locked and queued as a downloadable DDEX ZIP for every selected store target. `DISTRIBUTION_DSP_RECIPIENTS_JSON` contains DDEX party profiles; `DISTRIBUTION_STORE_TARGETS_JSON` contains safe UI names plus optional `recipientId` mappings. Targets without a partner profile intentionally use the configured manual-custody recipient until onboarding supplies the real DPID. This artifact path reads signed Media data-plane grants and never creates a DSP/SFTP delivery job. `DISTRIBUTION_SFTP_DELIVERY_ENABLED=false` is the fail-closed default and blocks both new automated deliveries and worker transport of queued jobs.
- Final `SUPER_ADMIN OWNER` approval of a VIDEO release delivery-locks it and idempotently queues a VEVO manual package. `POST /distribution/vevo/submissions` remains the authenticated retry endpoint for the same owner.
- `GET /distribution/vevo/submissions`, `/distribution/vevo/submissions/:submissionId`: entity-path-scoped package status. `READY_FOR_MANUAL_DELIVERY` means the ZIP is available for an authorized user to download; it does not mean VEVO accepted or received the release. Encrypted media grants, manifest payloads and filesystem paths are never returned.
- Signed data-plane: `GET /distribution-export/:exportId?token=...`, `GET /vevo-package/:submissionId?token=...`. VEVO package URLs are short-lived and the service verifies token expiry, package retention, root containment and exact stored size before streaming.
- DDEX preview/delivery fails closed when configured XSD validation fails. Partner conformance is not implied until official XSD and partner sandbox tests pass.
- The active VEVO workflow prepares a ZIP for manual delivery and never uploads to VEVO, a DSP or partner object store automatically. External acceptance remains an out-of-band operational result.

### Finance

- `POST /finance/imports`: BeAlpha owner or a `SYSTEM_ADMIN` account with `finance` staff role.
- `GET /finance/reports`: BeAlpha global; organization/accounting roles get entity-path-scoped totals; sub-account gets self-service scoped statements.
- `GET /finance/summary`: server-side totals across every matching scoped report, separated by currency and serialized as exact Decimal/BigInt strings. It never derives totals from the current UI page.
- `PUT /finance/split-rules/current`: entity owner/admin; integer basis points only.
- Signed data-plane: `PUT /finance-upload/:importId?token=...`.
- Currency and revenue use Decimal; splits use basis points. Float/Double are forbidden.

### Analytics, notifications and audit

- Analytics: `GET /analytics/summary`, `/analytics/streaming`, `/analytics/duration`; `POST /analytics/metrics`.
- Notifications: `GET|PATCH|DELETE /notifications`. Direct notifications are actor-scoped; workflow notifications are exact-entity scoped with per-user read/dismiss receipts.
- Audit: `GET /audit/events` with page, limit, search, action and entity-type filters.

## White-label API boundary

White-label configuration is tenant-scoped and exposed only through Gateway contracts. Branding may control names, logos, colors, locale, support links, email presentation and verified custom domains. It may not override JWT issuer/audience, cookie security, internal service URLs, CSP trust origins, DDEX sender identity, VEVO partner credentials or another tenant's cache/storage namespace.

Tenant branding is exposed as authenticated `GET|PATCH /catalog/tenant-brand`. Public login bootstrap uses `GET /catalog/public-tenant-brand`; it accepts no tenant identifier and resolves only from the exact Host already verified by Gateway. `GET` resolves the Organization brand inherited by its sub-accounts. `PATCH` is restricted to the Organization owner and accepts typed semantic colors and tenant-owned Media asset IDs only. Verified custom domains use the tenant-domain API plus exact Host binding, tenant-isolated caching and exact HTTPS CORS. External TLS/ACME automation and branded sender domains remain deployment integrations. See `docs/WHITE_LABEL.md`.

Repeatable onboarding uses `npm run white-label:configure -- ./tenant.white-label.json [--dry-run] [--verify]`. The JSON contains `platformBaseUrl`, `brand`, and optional `hostname`; it cannot contain credentials. `WHITE_LABEL_ACCESS_TOKEN` is process-only and must identify the exact `ORGANIZATION/OWNER`. Equal state is not rewritten, existing domains are reused, and verification is opt-in after DNS propagation. The API currently has no Super Admin tenant-target parameter.

## Versioning and compatibility

- `/api/v1` changes are additive by default.
- Shared HTTP/event contracts live only in `packages/contracts`.
- Database models are service-private.
- Breaking request/response or event changes require a new API/event version and migration notes.
- Zod schemas are the executable request contract; this document explains behavior and authorization.
