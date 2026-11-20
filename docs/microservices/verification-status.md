# Microservice Verification Status

Last static verification: 2026-08-15.

## Passed

- All contracts and services: typecheck, tests, build.
- Dashboard: UI-only, zero `app/api` routes, zero Prisma dependencies, lint, typecheck, tests, production build.
- Compose: parses through default `docker-compose.yml`; backend network private; only Nginx publishes host ports.
- Every domain service: Dockerfile, non-root user, healthcheck, resource limits, isolated schema/migrations where applicable.
- Worker containers: process healthchecks and CPU/memory/PID limits.
- Gateway: ES256 auth/context, static upstream allow-list, body/rate limits, 100 concurrent authenticated catalog-read test, stable upstream 503.
- Media: scoped access, signed data plane, upload/stream concurrency tests, ZIP traversal/ratio limits.
- Distribution: immutable DDEX snapshots, retries, disk-spooled XLSX/ZIP export, 50 GiB and 10000-entry limits, signed direct download.
- Failure tests: Redis readiness, PostgreSQL readiness, upstream outage, worker retry/DLQ.
- Production dependency audit: `npm run audit:prod` reports zero vulnerabilities across contracts, Gateway, and all eight domain services.
- Migration tooling: typecheck and 16 static/unit tests pass; runtime completion gate fails closed without env files, authenticated token, or a passing migration report.
- CI/CD: service, Dashboard, Compose, migration, build, test, and dependency-audit workflows parse and are configured for pushes and pull requests; versioned deployment waits for CI and publishes GHCR images with provenance and SBOM.
- Local source freshness: all 29 build-backed Compose services use `pull_policy: build`; source/contract watch rules and `scripts/watch-local.ps1` parse successfully.
- Docker runtime: all 28 default-profile images build; 23 long-running containers report healthy; all eight migration containers exit `0`.
- Edge smoke: Dashboard login and Nginx health return `200`; unauthenticated Gateway traffic returns the expected `401` envelope with a request ID.
- Startup resilience: migration containers retry transient PostgreSQL network readiness; non-root Nginx owns its writable cache tmpfs.

## External Evidence Required

- Run migration dry-run against the real read-only legacy database and real media root.
- Execute maintenance cutover, verification report, smoke tests, and rollback rehearsal.

Do not mark `T14` or `T15` complete until this external evidence exists.
