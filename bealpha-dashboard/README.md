# BeAlpha Dashboard

Next.js UI for the BeAlpha microservice platform. This package owns pages and browser-side API clients only. It has no API routes, database schema, Prisma client, media processing, or background workers.

## Architecture

```text
browser -> Nginx -> Fastify API Gateway -> domain services
```

- Browser control-plane calls use `/api/v1` through `lib/api-client.ts`.
- Raw media uses short-lived signed URLs issued by Media service. Bytes do not pass through Dashboard or Gateway.
- Authentication and tenant authorization are enforced by Gateway and each domain service.
- `proxy.ts` adds browser security headers and CSP. It does not authenticate API requests.

## Development

Prerequisites: Node.js 20.11+ and a reachable API Gateway.

```powershell
npm install
$env:NEXT_PUBLIC_API_BASE_URL='http://localhost:8080'
npm run dev
```

Leave `NEXT_PUBLIC_API_BASE_URL` empty when Nginx serves Dashboard and Gateway on the same origin.

## Verification

```powershell
npm run lint -- --quiet
npx tsc --noEmit --incremental false
npm test -- --runInBand
npm run build
```

## Boundaries

- Do not add `app/api` route handlers.
- Do not add Prisma or direct database access.
- Do not parse, store, or process raw media.
- Add backend behavior to the owning service under `../services/` and expose it through Gateway's static route allow-list.

See [DEVELOPMENT.md](./DEVELOPMENT.md), [QUICKSTART.md](./QUICKSTART.md), and [../docs/microservices/cutover-runbook.md](../docs/microservices/cutover-runbook.md).

## Repository layout

The `dashboard` branch contains this UI at its root. Use `main` for the full platform and integration testing.
