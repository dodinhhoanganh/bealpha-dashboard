# CI/CD

## CI

Root `.github/workflows/ci.yml` runs on every push, pull request, manual dispatch, and reusable workflow call. It verifies services, contracts, migrations, production dependency audits, Dashboard lint/typecheck/tests/build/audit, and static Compose configuration.

When `bealpha-dashboard` is used as a separate Git repository, its own `.github/workflows/ci.yml` runs the Dashboard checks. Configure branch protection to require the root `Services`, `Dashboard UI`, and `Compose Static Validation` jobs, or the Dashboard repository's `check` job.

## Deployment

Root `.github/workflows/deploy.yml` runs after reusable CI for `v*` tags or manual semantic versions. It builds immutable service images, publishes version and `latest` tags to GHCR, and includes provenance and SBOM attestations. Deployment to an environment remains an explicit infrastructure step.

## Local Docker

```powershell
docker compose up
```

`pull_policy: build` rebuilds build-backed services from current source before start. For continuous cached rebuild/recreate while source changes:

```powershell
./scripts/watch-local.ps1
```

The helper defaults `COMPOSE_PARALLEL_LIMIT` to `2` to limit CPU/RAM pressure. It does not stop unrelated containers.
