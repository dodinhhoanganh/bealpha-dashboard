# Dashboard Development Guide

`bealpha-dashboard` is the Next.js 16 UI for catalog, media, distribution, finance, analytics, notifications, identity, and administration workflows.

## Runtime Contract

```text
Dashboard -> /api/v1 -> Nginx -> Gateway -> owning service
Dashboard -> signed media URL -> Media or Distribution data plane
```

Use `lib/api-client.ts` for authenticated JSON requests. Feature-specific clients may wrap it but must not bypass Gateway for control-plane calls. Upload and playback flows request signed URLs first; raw bytes never terminate in Dashboard.

`NEXT_PUBLIC_API_BASE_URL` controls the browser API origin:

- Empty: same-origin `/api/v1`, required for normal Nginx deployment.
- Explicit URL: local development against a separately hosted Gateway.

No database or service secrets belong in Dashboard environment files.

## Commands

```powershell
npm run dev
npm run lint -- --quiet
npx tsc --noEmit --incremental false
npm test -- --runInBand
npm run test:e2e
npm run build
npm run start
```

## Code Organization

```text
app/          pages and layouts
components/   browser UI and feature components
lib/          API clients, schemas, formatting, i18n, browser helpers
public/       static assets
tests/        unit, integration, and browser tests
proxy.ts      CSP and browser security headers
```

## Rules

- Keep Dashboard UI-only: no `app/api`, Prisma, SQL, queue consumers, mail delivery, DDEX generation, or media processing.
- Put API behavior and migrations in the owning directory under `../services/`.
- Route public control-plane endpoints through Gateway's static `/api/v1` allow-list.
- Preserve B2B2B tenant scope; never trust tenant, role, user, or entity values supplied in request bodies.
- Keep unreleased media behind short-lived, tenant-bound signed URLs.
- Use decimal strings, integer minor units, or basis points for money and splits.

## Request Security

`proxy.ts` sets CSP, HSTS in production, permissions policy, framing protection, and `no-store`. Gateway verifies ES256 access tokens, strips client-supplied internal headers, signs service context, applies rate/body/timeout limits, and returns the standard response envelope. Each service re-authorizes actor and entity scope.

## Adding Backend Behavior

1. Select the owning service.
2. Add service-local schema migration and tests.
3. Add or update a versioned contract in `../packages/contracts`.
4. Add an explicit Gateway route only when browser access is required.
5. Call the endpoint through a Dashboard client module.
6. Verify service tests, Gateway tests, Dashboard tests, and production builds.

See `../SPEC.md`, `../codestyle.md`, and `../docs/microservices/verification-status.md`.
