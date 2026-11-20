# Microservice Cutover Runbook

## Preconditions

- Schedule a maintenance window and put the legacy application in read-only mode.
- Use a read-only `LEGACY_DATABASE_URL` for migration scripts.
- Provision service databases and storage with at least 2x current media usage plus archive headroom.
- Copy `.env.migration.example` to `.env.migration` and replace every placeholder.
- `LEGACY_DATABASE_URL` must be reachable from Docker; `LEGACY_MEDIA_HOST_ROOT` is mounted read-only.
- Migration runner and backup container use dedicated non-public `migration` network; service databases stay unbound from host ports.
- Set `MIGRATION_MAINTENANCE_CONFIRMED=YES` only after writes are disabled.
- Do not use `docker compose down`; unrelated and rollback containers remain running/available.

## Dry Run

1. Set `MIGRATION_DRY_RUN=1`.
2. Apply all service schema migration containers.
3. Run each data migration with `docker compose --env-file .env.microservices --env-file .env.migration -f docker-compose.microservices.yml run --rm migration-runner npm run migrate:<service>`.
4. Dry-run mode hashes media but writes neither target rows nor media files.
5. Run `scripts/cutover.ps1` without `-Execute` to print the procedure.
6. Resolve every schema, ownership, identifier, and media-path error.

## Cutover

1. Enable legacy maintenance/read-only mode.
2. Run `scripts/cutover.ps1 -Execute`.
3. Inspect `.migration-output/migration-verification.json`; every check must pass.
4. Verify all `/health/ready` endpoints through the private network.
5. Run auth, catalog, upload, playback, DDEX, finance, notification, tenant-isolation, and worker smoke tests.
   Run `scripts/verify-runtime.ps1 -BaseUrl https://your-edge -AccessToken <token>` for mandatory stack health and authenticated control-plane smoke checks. The command fails if either environment file or `.migration-output/migration-verification.json` is missing.
6. Switch external traffic to Nginx/Gateway only after smoke tests pass.
7. Keep the legacy application and backup available but do not permit writes.

## Rollback

1. Remove the new edge from external traffic. Do not stop unrelated Docker containers.
2. Run `scripts/rollback.ps1 -BackupFile <path>` without `-Execute` and review the commands.
3. Restore into a separate recovery database with `ROLLBACK_CONFIRMED=YES`, `ROLLBACK_DATABASE_URL`, and `-Execute`. Preflight rejects the legacy database and any target containing user tables.
4. Verify counts and identifiers on the recovery database.
5. Point the legacy application to the verified recovery database, then restore traffic.

Sessions are intentionally not migrated. All users sign in again after cutover.
