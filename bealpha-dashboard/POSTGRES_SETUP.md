# Database Setup

Dashboard no longer owns a database. Do not configure `DATABASE_URL`, Prisma, schemas, migrations, or seed commands in this package.

Each backend service owns its PostgreSQL database/schema, credentials, Prisma schema, and migrations under `../services/<service>/prisma/`. Root deployment configuration provisions isolated credentials from `../.env.microservices.example`.

For platform setup and migration use:

- `../docker-compose.microservices.yml`
- `../.env.microservices.example`
- `../.env.migration.example`
- `../docs/microservices/cutover-runbook.md`

Run service migrations through the migration containers documented in the cutover runbook. Never grant Dashboard direct database access.
