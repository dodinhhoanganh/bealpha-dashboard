# BeAlpha White-label Specification

Status: application-level tenant branding and verified-Host login are implemented. TLS certificate issuance and branded outbound-email identity remain deployment integrations.

## Current implementation audit (2026-08-22)

The repository implements the following white-label control plane:

- `TenantBrandProfile` is scoped to an active `ORGANIZATION`; `SUB_ACCOUNT` reads inherit the Organization profile.
- The authenticated `GET/PATCH /api/v1/catalog/tenant-brand` contract supports display name, one tenant media logo, accessible semantic accent colors, support contacts and locale. `PATCH` is server-authorized for `ORGANIZATION/OWNER` only.
- The dashboard applies the resolved name, logo and semantic color tokens after login. Arbitrary CSS/HTML/JavaScript and remote logo URLs are rejected by the strict contract.
- `GET /api/v1/catalog/public-tenant-brand` is an unauthenticated safe subset resolved only from the Gateway-verified exact Host. Login waits for this result before rendering, then applies the tenant logo, name, accessible colors and support link without flashing the platform brand.
- `TenantDomain` persists a globally unique normalized hostname and SHA-256 DNS challenge hash. Only the exact Organization owner can list, create, verify or delete it; only `VERIFIED` domains resolve.
- Gateway binds every authenticated custom-Host request to the signed token tenant, isolates positive Redis cache entries by normalized hostname, and rejects unknown/spoofed Hosts. CORS reflects only an exact HTTPS origin matching the verified request Host.
- Brand and domain mutations use client versions to reject stale writes. Brand logos must be READY images owned directly by the Organization, not merely visible through a descendant path.
- DDEX sender identity remains environment-owned in Distribution, and VEVO partner credentials remain environment-owned in Distribution. Branding code is not imported into either delivery path.

The following features remain external deployment/onboarding integrations:

- external certificate/ACME lifecycle, domain suspension/recovery, and edge rollout automation;
- tenant-uploaded favicon, invite/legal-page branding and fixed notification-template snapshots;
- verified email identity, DKIM/SPF/DMARC state and per-message immutable brand snapshots;
- explicit `brand.manage`/`domain.manage` capabilities, Super Admin recovery controls and audit coverage;
- XSS and “branding cannot alter DDEX/VEVO identity” integration tests.

Primary implementation references: `packages/contracts/src/branding.ts`, `services/catalog/prisma/schema.prisma`, `services/catalog/src/catalog-service.ts`, `services/catalog/src/routes.ts`, `bealpha-dashboard/components/layout/BrandProvider.tsx`, `bealpha-dashboard/components/settings/BrandTab.tsx`, and `docs/api/openapi.yaml`.

Nginx preserves an allow-listed `$host` and never redirects a custom domain to the platform hostname. Operations must add every activated hostname to `EDGE_SERVER_NAMES` and mount a certificate covering it before traffic is enabled. This repository intentionally does not implement ACME or certificate issuance.

## Meaning and boundaries

White-label lets an `ORGANIZATION` present the BeAlpha dashboard under its verified brand and domain while BeAlpha continues to operate the shared platform. A sub-account inherits its organization brand. Phase 1 has no nested brand overrides.

White-label does not grant:

- distributor-of-record status;
- a DDEX DPID or DSP agreement;
- BeAlpha/VEVO partner credentials;
- access to another tenant, platform settings or delivery secrets.

Brand identity and delivery identity are separate domains. Only `SUPER_ADMIN` manages DDEX/VEVO/DSP delivery identities unless a partner onboarding process explicitly delegates one.

## Roles and capabilities

| Actor | Read brand | Manage brand/domain | Suspend/recover |
| --- | --- | --- | --- |
| `SUPER_ADMIN/OWNER` | platform default | no tenant-targeting API | no |
| `ORGANIZATION/OWNER` | own | own | no |
| `ORGANIZATION/ADMIN` | own | no | no |
| `SYSTEM_ADMIN` | platform default | no | no |
| `finance`, `MEMBER`, `SUB_ACCOUNT` | inherited brand | no | no |

Dashboard visibility follows these rules, but every API repeats authorization server-side. Tenant onboarding uses the target Organization owner's token; the current API deliberately has no Super Admin tenant-id override or impersonation shortcut.

## Data ownership

Explicit models belong in the service that owns tenant configuration; do not hide security-sensitive configuration in generic JSON metadata.

- `TenantBrandProfile`: unique `tenantId`, display name, one logo media asset ID, semantic colors, locale, support contacts, version, updater and timestamps.
- `TenantDomain`: globally unique normalized ASCII hostname, verification-token hash, `PENDING|VERIFIED`, verification timestamps and optimistic-lock version.

Favicon variants, email identities, suspension state and entitlement models are future integrations, not current API fields.

Brand assets are tenant-owned media-service assets. The platform must not fetch arbitrary logo URLs.

## API

All control-plane endpoints go through Gateway.

| Method | Path | Audience | Behavior |
| --- | --- | --- | --- |
| `GET` | `/api/v1/catalog/public-tenant-brand` | public | Safe brand subset resolved from an exact verified Host |
| `GET` | `/api/v1/catalog/tenant-brand` | authenticated tenant | Current inherited profile and version |
| `PATCH` | `/api/v1/catalog/tenant-brand` | `ORGANIZATION/OWNER` | Typed semantic tokens and media asset IDs only |
| `POST` | `/api/v1/catalog/tenant-domains` | `ORGANIZATION/OWNER` | Register normalized domain and return DNS challenge |
| `POST` | `/api/v1/catalog/tenant-domains/:id/verify` | `ORGANIZATION/OWNER` | Verify challenge, never trust request Host as proof |
| `DELETE` | `/api/v1/catalog/tenant-domains/:id` | `ORGANIZATION/OWNER` | Remove binding before certificate cleanup |
| `GET` | `/api/v1/identity/capabilities` | authenticated | Server-derived effective capabilities |

Requests cannot set `tenantId`, delivery identity, credential references, arbitrary HTML/CSS/JS, CSP directives or redirect URLs.

## Fast configuration and deployment

The Organization owner can configure the brand in **Settings → Organization brand**, or configure brand plus domain from one JSON file with one idempotent CLI command. The CLI reads a short-lived Organization-owner token only from the process environment; it never accepts a token in JSON or on the command line and never prints it.

1. Upload the logo through Media and wait for the IMAGE asset to become `READY`.
2. Copy `docs/examples/tenant.white-label.json` to a local file such as `tenant.white-label.json` (do not commit tenant-specific files):

```json
{
  "platformBaseUrl": "https://platform.example.com",
  "brand": {
    "displayName": "Example Music",
    "logoAssetId": "00000000-0000-4000-8000-000000000000",
    "accentColor": "#172554",
    "accentTextColor": "#FFFFFF",
    "supportEmail": "support@example.com",
    "supportUrl": "https://example.com/support",
    "defaultLocale": "vi"
  },
  "hostname": "music.example.com"
}
```

3. Keep the short-lived Organization-owner access token in the process environment and run through the platform hostname:

```bash
WHITE_LABEL_ACCESS_TOKEN="$TOKEN" \
npm run white-label:configure -- ./tenant.white-label.json
```

PowerShell:

```powershell
$env:WHITE_LABEL_ACCESS_TOKEN = $TOKEN
npm run white-label:configure -- ./tenant.white-label.json
Remove-Item Env:WHITE_LABEL_ACCESS_TOKEN
```

Preview without mutation with `npm run white-label:configure -- ./tenant.white-label.json --dry-run`. The preview performs authenticated reads and reports planned brand/domain changes, but it cannot print a DNS challenge that has not yet been created.

4. Add the one-time printed TXT record. Preserve this output until DNS is configured: listing a pending domain intentionally does not reveal its challenge again. After DNS propagates, run `npm run white-label:configure -- ./tenant.white-label.json --verify`. Re-running either command leaves an equal brand untouched, reuses an existing domain, and skips an already verified domain.
5. Before exposing traffic, add the exact hostname to the space-separated `EDGE_SERVER_NAMES`, provision/mount a certificate whose SAN covers it under `./certs`, and recreate only `nginx`. `EDGE_SERVER_NAMES` configures Nginx's allow-list; Gateway resolves verified non-platform hosts dynamically from Catalog, so the hostname must not be added to `GATEWAY_PLATFORM_HOSTNAMES`.

```bash
docker compose --env-file .env.microservices --env-file .env.migration up -d --no-deps --force-recreate nginx
docker compose --env-file .env.microservices --env-file .env.migration exec nginx nginx -T
```

Application images do not require a tenant-specific build.
6. Verify `https://music.example.com/api/v1/catalog/public-tenant-brand` and the login page. A token belonging to another tenant must receive `TENANT_DOMAIN_MISMATCH`.

The CLI never writes or prints the access token. Brand fields remain in Catalog; JWT keys, DDEX identity, VEVO credentials, relay URLs and API secrets remain environment-owned platform configuration.

## Rollback

Keep the previous non-secret JSON in deployment change records. To roll back branding, run the same command with that previous JSON; optimistic version checks prevent overwriting a concurrent dashboard edit. To remove custom-domain traffic without deleting tenant state, remove the hostname from `EDGE_SERVER_NAMES` and recreate only `nginx`. This makes the edge reject the host while preserving the verified binding for a quick restore.

Delete a domain with an authenticated `DELETE /api/v1/catalog/tenant-domains/{id}` request only when decommissioning it. The body must contain the current `expectedVersion` returned by `GET /api/v1/catalog/tenant-domains`. Deletion is not the first rollback step because recreating the domain generates a new DNS challenge. Remove its DNS record and certificate only after edge traffic is disabled.

## Troubleshooting

| Result | Cause | Action |
| --- | --- | --- |
| `401` | token expired/invalid | issue a new short-lived Organization-owner token; do not store it in JSON |
| `403 FORBIDDEN` | actor is not the exact Organization owner | use the owner membership for the tenant being configured |
| `409 VERSION_CONFLICT` | concurrent brand/domain edit | rerun; the CLI refetches brand once and otherwise fails without blind overwrite |
| `409 DOMAIN_CONFLICT` | hostname is already registered | check which tenant owns it; the CLI only reuses domains visible to the same owner |
| `409 DOMAIN_NOT_VERIFIED` | TXT is missing, split incorrectly or not propagated | query `_bealpha-verification.<hostname>`, restore the exact printed value, then rerun with `--verify` |
| `421 UNRECOGNIZED_TENANT_DOMAIN` | domain is unverified or Host is absent from edge | verify DNS/API state and `EDGE_SERVER_NAMES`; never add it as a platform hostname |
| `403 TENANT_DOMAIN_MISMATCH` | token tenant differs from Host tenant | use the platform host for onboarding or a token belonging to that exact domain tenant |
| TLS handshake rejection | certificate/edge allow-list missing | provision the SAN certificate, mount `./certs`, update `EDGE_SERVER_NAMES`, recreate Nginx |

For DNS inspection: `dig TXT _bealpha-verification.music.example.com` or `Resolve-DnsName -Type TXT _bealpha-verification.music.example.com`. Do not paste access tokens into tickets or logs.

## Host and token resolution

1. Edge accepts only a normalized Host from the trusted proxy chain.
2. Normalize case, trailing dot and IDN to canonical punycode; reject invalid ports/labels.
3. Resolve an exact `VERIFIED` domain belonging to an active Organization. Lookup/cache error fails closed.
4. Authenticate token.
5. Tenant token must equal Host tenant; mismatch is `403` and audited.
6. `SUPER_ADMIN` and `SYSTEM_ADMIN` use the platform hostname. Tenant impersonation is a separate audited break-glass flow.

Never fall back from an unknown custom Host to the BeAlpha/default tenant.

## Browser and edge security

- Use host-only `Secure`, `HttpOnly` refresh cookies; prefer a `__Host-` prefix after compatibility testing.
- Custom-domain HSTS must not automatically use `includeSubDomains` or `preload`.
- CORS uses exact active origins from the verified registry, never wildcard or suffix matching.
- CSP is generated from platform-owned media origins; tenant fields cannot inject origins.
- Cache keys include normalized hostname, tenant ID and brand version.
- Redirects and email links use the stored verified canonical domain, never raw `Host`/`X-Forwarded-Host`.
- Domain deletion/suspension invalidates edge, Redis/CDN and application caches.

## UI contract

One `BrandProvider` resolves semantic tokens and assets. Components consume tokens; they do not contain tenant conditionals or copied hex colors. Allowed input is a bounded token schema with contrast checks. Custom CSS, HTML, JavaScript and remote font URLs are forbidden.

Brand applies centrally to metadata/favicon, login/invite, sidebar/header, support links and fixed notification templates. Light/dark personal preference remains separate.

## Email and notifications

- Fixed escaped templates with typed variables; no tenant HTML.
- Brand snapshot is stored when work is enqueued so a worker cannot read another tenant's current brand.
- Custom From activates only after SPF, DKIM and DMARC verification. Before that, use BeAlpha From and a verified tenant Reply-To.
- Rejection notification includes release, rejecting tier, escaped reason and a verified-domain link.
- `catalog.release.rejected` is the canonical event name.

## DDEX and VEVO

`TenantBrandProfile` never changes ERN sender DPID/name, recipient profile, SFTP/S3 credentials or VEVO partnership identity. Distribution-service environment configuration owned by the platform controls those fields. White-label readiness is not DDEX/VEVO conformance evidence.

## Rollout gates

1. API/contracts, event names, threat model and docs.
2. Additive tables plus a default BeAlpha profile; no visible behavior change.
3. Exact Host resolver, capability checks and audit events.
4. Central `BrandProvider` and public safe-brand endpoint.
5. Branded in-app/email notifications.
6. Verified custom domains and ACME/TLS edge lifecycle.
7. Verified email identities.
8. Optional delegated delivery identity only after partner onboarding.

## Required tests

- Capability matrix: hidden UI plus direct API `403`.
- Tenant-A token on Tenant-B domain; hostile Host and forwarded-host spoofing.
- Case, trailing dot, IDN/punycode and duplicate-domain handling.
- DNS verification, suspension, deletion and safe reclaim.
- Cache isolation by host/tenant/version.
- Host-only cookie, HTTPS, CORS, CSP and custom-domain HSTS.
- Brand asset tenant ownership and no server-side arbitrary URL fetch.
- XSS payloads in display name, support fields and rejection reasons.
- Correct lower-tier rejection event/in-app/email recipient.
- Brand changes do not alter DDEX sender or VEVO credentials.
- Two-domain E2E through browser, edge, Gateway, Redis and services.

Standards: ACME RFC 8555, HTTP Cookies RFC 6265, DKIM RFC 6376, SPF RFC 7208, DMARC RFC 7489, CSP Level 3 and OWASP SSRF Prevention.

## Primary references

- Cloudflare for SaaS hostname validation: https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/domain-support/hostname-validation/
- Auth0 custom-domain ownership verification and TLS lifecycle: https://auth0.com/docs/customize/custom-domains
- Amazon SES custom MAIL FROM requirements: https://docs.aws.amazon.com/ses/latest/dg/mail-from.html
- ACME certificate automation, RFC 8555: https://www.rfc-editor.org/rfc/rfc8555
- DKIM, SPF and DMARC: https://www.rfc-editor.org/rfc/rfc6376, https://www.rfc-editor.org/rfc/rfc7208, https://www.rfc-editor.org/rfc/rfc7489
- VEVO Feed Delivery (partner delivery identity and feed method): https://support.vevo.com/hc/en-us/articles/8624200408731-Feed-Delivery
